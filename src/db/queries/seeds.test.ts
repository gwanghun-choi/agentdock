import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// Database-backed tests write, so they write to the test schema. The schema
// module reads this at import time, hence the assignment before any import of
// it. Vitest isolates files into separate workers, so this cannot leak.
process.env.DATABASE_SCHEMA = 'agentdock_test';

const DB_URL = process.env.DATABASE_URL;

// Sentinels, with a prefix distinct from queue-spec, persist and corpus-spec:
// vitest runs test FILES in parallel against the one test schema, and the seed
// queries below read the whole table rather than a scoped slice, so every
// assertion here is written against this suite's own rows only.
const PREFIX = 'test-owner/corpus-seed-';
const A = `${PREFIX}a`;
const B = `${PREFIX}b`;
const C = `${PREFIX}c`;

describe.skipIf(!DB_URL)('repo_seed queries', () => {
  let seeds: typeof import('./seeds');
  let sql: typeof import('@/db/client').sql;

  async function clean() {
    await sql`DELETE FROM ingest_job WHERE target LIKE ${`${PREFIX}%`}`;
    await sql`DELETE FROM repo_seed WHERE full_name LIKE ${`${PREFIX}%`}`;
    await sql`DELETE FROM repository_denylist WHERE full_name LIKE ${`${PREFIX}%`}`;
  }

  function seed(fullName: string, hint: Record<string, unknown> = {}) {
    return {
      fullName,
      sourceKind: 'github',
      discoveredFrom: 'corpus-seed-spec',
      discoveredPath: `path/${fullName}`,
      hint,
    };
  }

  /** This suite's own rows, in the order fan-out would see them. */
  async function ours(limit = 100) {
    return (await seeds.unenqueuedSeeds(limit + 500)).filter((n) => n.startsWith(PREFIX));
  }

  beforeAll(async () => {
    seeds = await import('./seeds');
    ({ sql } = await import('@/db/client'));
    await clean();
  });

  afterAll(async () => {
    await clean();
    await sql.end();
  });

  beforeEach(clean);

  describe('upsertSeeds', () => {
    it('is idempotent over the same rows, and refreshes updated_at', async () => {
      expect(await seeds.upsertSeeds([seed(A), seed(B)])).toBe(2);

      const before = await sql<{ updated_at: string }[]>`
        SELECT updated_at FROM repo_seed WHERE full_name = ${A}
      `;
      await new Promise((r) => setTimeout(r, 20));
      await seeds.upsertSeeds([seed(A, { v: 2 }), seed(B)]);

      const [row] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM repo_seed WHERE full_name LIKE ${`${PREFIX}%`}
      `;
      expect(row.n).toBe(2);

      const after = await sql<{ updated_at: string; hint: Record<string, unknown> }[]>`
        SELECT updated_at, hint FROM repo_seed WHERE full_name = ${A}
      `;
      expect(Date.parse(String(after[0].updated_at))).toBeGreaterThan(
        Date.parse(String(before[0].updated_at)),
      );
      expect(after[0].hint).toEqual({ v: 2 });
    });

    it('collapses duplicates inside one batch instead of failing the statement', async () => {
      // The registry lists one server once per published version, and those
      // versions name one repository. Without the in-memory dedup Postgres
      // refuses the whole page: ON CONFLICT DO UPDATE cannot touch a row twice.
      expect(await seeds.upsertSeeds([seed(A), seed(A, { v: 2 }), seed(B)])).toBe(2);
    });

    it('lowercases at write, so the anti-join below is an equality', async () => {
      await seeds.upsertSeeds([seed(A.toUpperCase())]);
      const [row] = await sql<{ full_name: string }[]>`
        SELECT full_name FROM repo_seed WHERE lower(full_name) = ${A}
      `;
      expect(row.full_name).toBe(A);
    });
  });

  describe('unenqueuedSeeds', () => {
    it('orders by (created_at, id), so a bulk insert keeps the source order', async () => {
      // One statement stamps one created_at across all three rows, so without
      // the id tie-break this order is undefined — and 05-02's cold-start
      // argument depends on a seed file's density order surviving into fan-out.
      await seeds.upsertSeeds([seed(C), seed(A), seed(B)]);
      expect(await ours()).toEqual([C, A, B]);
    });

    it('omits a seed that already has a job, in every status including terminal ones', async () => {
      await seeds.upsertSeeds([seed(A), seed(B), seed(C)]);
      // Never `queued`: claimJob takes the oldest claimable row in the whole
      // schema, so a queued row left here for even a moment is a row
      // jobs.test.ts can claim — and then this suite's clean() deletes a job
      // that suite is mid-way through writing an attempt for. persist.test.ts
      // inserts `running` rows for the same reason.
      await sql`INSERT INTO ingest_job (target, status) VALUES (${A}, 'running')`;
      await sql`INSERT INTO ingest_job (target, status) VALUES (${B}, 'failed')`;

      // A permanently failed repository must not be re-offered: retry belongs to
      // scheduleRetry, and re-offering failures loops forever at two core
      // requests each.
      expect(await ours()).toEqual([C]);
    });

    it('omits a denylisted seed, which otherwise sits pending forever', async () => {
      await seeds.upsertSeeds([seed(A), seed(B)]);
      await sql`INSERT INTO repository_denylist (full_name, reason) VALUES (${A}, 'test')`;

      // enqueueJob writes no ingest_job row for a denylisted repository, so
      // without this anti-join the seed is re-offered on every run forever and
      // the pending count never converges.
      expect(await ours()).toEqual([B]);
    });

    it('stops at the limit it was given', async () => {
      await seeds.upsertSeeds([seed(A), seed(B), seed(C)]);
      expect((await seeds.unenqueuedSeeds(1)).length).toBe(1);
    });

    it('offers only the names it was given, because the global order is arrival order', async () => {
      // The defect this closes, measured on the dev schema on 2026-08-11: 7,971
      // registry seeds written in wave 1 preceded all fifteen operator seed
      // rows, so an unscoped offer put the densest repository in the seed list
      // 319 capped invocations and ~15,900 core requests behind the front. A
      // source's own density order is only reachable inside its own name set.
      await seeds.upsertSeeds([seed(A), seed(B), seed(C)]);

      expect(await seeds.unenqueuedSeeds(500, [C, B])).toEqual([B, C]);
      expect(await seeds.unenqueuedSeeds(500, [`${PREFIX}absent`])).toEqual([]);

      // Unscoped is unchanged: every seed, arrival order.
      expect(await ours()).toEqual([A, B, C]);
    });

    it('selects nothing for an empty name set rather than widening to the whole table', async () => {
      // The dangerous default. A source that produced no seed must fan out
      // nothing, not everything an unrelated source is holding.
      await seeds.upsertSeeds([seed(A), seed(B)]);
      expect(await seeds.unenqueuedSeeds(500, [])).toEqual([]);
    });

    it('still excludes a scoped name that has a job or is denylisted', async () => {
      // The scope narrows the offer; it must not bypass either anti-join.
      await seeds.upsertSeeds([seed(A), seed(B), seed(C)]);
      await sql`INSERT INTO ingest_job (target, status) VALUES (${A}, 'running')`;
      await sql`INSERT INTO repository_denylist (full_name, reason) VALUES (${B}, 'test')`;

      expect(await seeds.unenqueuedSeeds(500, [A, B, C])).toEqual([C]);
    });
  });

  describe('countUnenqueuedSeeds', () => {
    it('counts what fan-out has not reached, and drops a seed once it has a job', async () => {
      // Deliberately not a delta assertion. This helper counts the WHOLE table —
      // that is its job, since the operator's "still-pending" line is about the
      // whole corpus — and vitest runs test files in parallel, so a sibling file
      // writes and deletes seeds of its own between any two measurements taken
      // here. What is assertable without a race is that this suite's rows are
      // inside the count, and that a seed leaves it the moment it has a job.
      await seeds.upsertSeeds([seed(A), seed(B)]);

      expect(await ours()).toEqual([A, B]);
      expect(await seeds.countUnenqueuedSeeds()).toBeGreaterThanOrEqual(2);

      await sql`INSERT INTO ingest_job (target, status) VALUES (${A}, 'running')`;

      expect(await ours()).toEqual([B]);
      expect(await seeds.countUnenqueuedSeeds()).toBeGreaterThanOrEqual(1);
    });
  });

  describe('newestRegistryUpdatedAt', () => {
    it('returns the maximum stored timestamp for its source, and null when there is none', async () => {
      // Scoped to this suite's own provenance value rather than 'mcp-registry',
      // so it reads only rows this file wrote.
      expect(await seeds.newestRegistryUpdatedAt('corpus-seed-spec')).toBeNull();

      await seeds.upsertSeeds([
        seed(A, { registryUpdatedAt: '2026-01-02T03:04:05.000Z' }),
        seed(B, { registryUpdatedAt: '2026-06-07T08:09:10.000Z' }),
        // No timestamp at all: absent costs the watermark, not the seed.
        seed(C),
      ]);

      expect(await seeds.newestRegistryUpdatedAt('corpus-seed-spec')).toBe(
        '2026-06-07T08:09:10.000Z',
      );
    });
  });
});
