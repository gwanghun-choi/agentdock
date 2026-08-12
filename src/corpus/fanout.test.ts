import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepoScan, ScannedPackage, ScannedSeed } from '@/ingest/types';

// The integration block at the bottom writes, so it writes to the test schema.
// The schema module reads this at import time, hence the assignment before any
// import of it. Vitest isolates files into separate workers, so this cannot leak.
process.env.DATABASE_SCHEMA = 'agentdock_test';

const DB_URL = process.env.DATABASE_URL;

// The unit block below mocks at the module boundary rather than running against
// the schema. The facts it owns are loop facts — every seed goes through
// enqueueJob, the loop stops on the first flooded result, the scope is passed
// through — and all of them are about calls, not rows.
//
// The last hop, a persisted scan's seeds actually becoming ingest_job rows, is
// asserted against the real database in the final describe, which rebinds these
// same doubles to the real implementations. That block is only writable because
// unenqueuedSeeds now takes a name set: wave 1 could not write it, because an
// unscoped fan-out inside a test enqueues a sibling suite's seed and leaves a
// queued job behind — the exact nondeterminism jobs.test.ts warns about.
const enqueueJob = vi.hoisted(() => vi.fn());
const unenqueuedSeeds = vi.hoisted(() => vi.fn());
const countUnenqueuedSeeds = vi.hoisted(() => vi.fn());

vi.mock('@/db/queries/jobs', () => ({ enqueueJob }));
vi.mock('@/db/queries/seeds', () => ({ unenqueuedSeeds, countUnenqueuedSeeds }));

const { fanOutSeeds } = await import('./fanout');

const A = 'test-owner/corpus-fan-a';
const B = 'test-owner/corpus-fan-b';
const C = 'test-owner/corpus-fan-c';

beforeEach(() => {
  vi.clearAllMocks();
  countUnenqueuedSeeds.mockResolvedValue(0);
});

describe('fanOutSeeds', () => {
  it('routes every seed through enqueueJob rather than inserting a job itself', async () => {
    unenqueuedSeeds.mockResolvedValue([A, B, C]);
    enqueueJob.mockResolvedValue({ kind: 'queued', id: 1 });

    const result = await fanOutSeeds({ limit: 3 });

    expect(enqueueJob.mock.calls.map(([t]) => t)).toEqual([A, B, C]);
    expect(result).toMatchObject({ considered: 3, enqueued: 3, denylisted: 0, flooded: false });
  });

  it('asks for no more seeds than the cap it was given', async () => {
    unenqueuedSeeds.mockResolvedValue([A]);
    enqueueJob.mockResolvedValue({ kind: 'queued', id: 1 });

    await fanOutSeeds({ limit: 7 });
    expect(unenqueuedSeeds).toHaveBeenCalledWith(7, undefined);
  });

  it('passes the name scope through, so a later source is not buried by an earlier one', async () => {
    unenqueuedSeeds.mockResolvedValue([A]);
    enqueueJob.mockResolvedValue({ kind: 'queued', id: 1 });

    await fanOutSeeds({ limit: 3, only: [A, B] });
    expect(unenqueuedSeeds).toHaveBeenCalledWith(3, [A, B]);
  });

  it('reports the residual across every source even when the offer was scoped', async () => {
    // A scoped run reporting only its own residual would read as "the corpus is
    // drained" while thousands of seeds from another source sat waiting.
    unenqueuedSeeds.mockResolvedValue([A]);
    enqueueJob.mockResolvedValue({ kind: 'queued', id: 1 });
    countUnenqueuedSeeds.mockResolvedValue(7984);

    const result = await fanOutSeeds({ limit: 1, only: [A] });
    expect(countUnenqueuedSeeds).toHaveBeenCalledWith();
    expect(result.remaining).toBe(7984);
  });

  it('counts a denylisted seed and keeps going', async () => {
    unenqueuedSeeds.mockResolvedValue([A, B]);
    enqueueJob
      .mockResolvedValueOnce({ kind: 'denylisted' })
      .mockResolvedValueOnce({ kind: 'queued', id: 2 });

    const result = await fanOutSeeds({ limit: 2 });
    expect(result).toMatchObject({ considered: 2, enqueued: 1, denylisted: 1 });
  });

  it('stops on the first flooded result instead of asking again per remaining seed', async () => {
    unenqueuedSeeds.mockResolvedValue([A, B, C]);
    enqueueJob.mockResolvedValue({ kind: 'flooded' });

    const result = await fanOutSeeds({ limit: 3 });

    expect(enqueueJob).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ considered: 1, enqueued: 0, flooded: true });
  });

  it('reports how many seeds still hold no job, measured after the loop', async () => {
    unenqueuedSeeds.mockResolvedValue([A]);
    enqueueJob.mockResolvedValue({ kind: 'queued', id: 1 });
    countUnenqueuedSeeds.mockResolvedValue(41);

    // A cap that prints nothing reads as "we covered everything".
    expect((await fanOutSeeds({ limit: 1 })).remaining).toBe(41);
  });

  it('offers nothing, rather than everything, when the scope is an empty set', async () => {
    // The dangerous default: a source that produced no name must not fall back
    // to the global queue. Enforced in the query, asserted here at the boundary.
    unenqueuedSeeds.mockResolvedValue([]);
    const result = await fanOutSeeds({ limit: 25, only: [] });
    expect(unenqueuedSeeds).toHaveBeenCalledWith(25, []);
    expect(result).toMatchObject({ considered: 0, enqueued: 0 });
  });

  it('does nothing, and says so, when no seed is waiting', async () => {
    unenqueuedSeeds.mockResolvedValue([]);
    const result = await fanOutSeeds({ limit: 25 });
    expect(enqueueJob).not.toHaveBeenCalled();
    expect(result).toMatchObject({ considered: 0, enqueued: 0, remaining: 0 });
  });
});

/**
 * COR-03's last hop, against the database rather than the network.
 *
 * Everything upstream of it has shipped and been tested since Phase 3:
 * catalog.ts's seedFor, the pipeline's seeds branch, persist.ts's repo_seed
 * upsert. What never existed until 05-01 was a consumer, so no test could carry
 * a catalog-discovered seed from a persisted scan into a queued job. This one
 * does, and it fails without that consumer.
 *
 * The doubles above are rebound to the real implementations here. Only the reads
 * are narrowed, and they are narrowed the way production narrows them — by the
 * name set the source produced — so nothing in this block can enqueue a sibling
 * suite's seed and leave a claimable row behind.
 */
const SPEC = 'test-owner/corpus-spec';
const NODE_ID = 'TEST_NODE_ID_corpus_spec';
const SEED_OK = 'corpus-spec-seed-owner/corpus-spec-reachable';
const SEED_BLOCKED = 'corpus-spec-seed-owner/corpus-spec-denylisted';

describe.skipIf(!DB_URL)('fanOutSeeds against the database', () => {
  let sql: typeof import('@/db/client').sql;
  let persistScan: typeof import('@/ingest/persist').persistScan;

  async function clean() {
    // repo_seed rows included, and the jobs first: a queued ingest_job row left
    // behind is a row jobs.test.ts claims by mistake.
    await sql`DELETE FROM ingest_job WHERE target IN (${SEED_OK}, ${SEED_BLOCKED})`;
    await sql`DELETE FROM repo_seed WHERE full_name IN (${SEED_OK}, ${SEED_BLOCKED})`;
    await sql`DELETE FROM repository_denylist WHERE full_name IN (${SEED_OK}, ${SEED_BLOCKED})`;
    await sql`DELETE FROM repository WHERE github_node_id = ${NODE_ID}`;
  }

  function seed(fullName: string): ScannedSeed {
    return {
      fullName,
      sourceKind: 'github',
      discoveredFrom: SPEC,
      discoveredPath: '.claude-plugin/marketplace.json',
      hint: { name: fullName },
    };
  }

  /** persist.test.ts's scan shape, carrying seeds. */
  function scan(seeds: ScannedSeed[]): RepoScan {
    const pkg: ScannedPackage = {
      type: 'skill',
      sourcePath: 'skills/corpus-spec/SKILL.md',
      name: 'corpus-spec',
      slug: 'corpus-spec',
      summary: null,
      licenseText: null,
      meta: {},
      blobSha: null,
      contentHash: 'corpus-spec-hash',
      declaredVersion: null,
      body: 'body',
      frontmatter: {},
      parseStatus: 'ok',
      parseErrors: [],
      parentPath: null,
      findings: [],
      files: [],
    };
    return {
      githubNodeId: NODE_ID,
      fullName: SPEC,
      owner: 'test-owner',
      defaultBranch: 'main',
      description: null,
      homepage: null,
      licenseSpdx: null,
      stars: 1,
      isFork: false,
      isArchived: false,
      topics: [],
      pushedAt: null,
      scannedAt: new Date(),
      etag: null,
      commitSha: 'f17010c9bb483898c1d9c9f42dde2b3a98889434',
      treeTruncated: false,
      packages: [pkg],
      seeds,
    };
  }

  async function jobsFor(): Promise<{ target: string; status: string }[]> {
    return sql`
      SELECT target, status FROM ingest_job
      WHERE target IN (${SEED_OK}, ${SEED_BLOCKED}) ORDER BY target
    `;
  }

  beforeAll(async () => {
    ({ sql } = await import('@/db/client'));
    ({ persistScan } = await import('@/ingest/persist'));
    await clean();
  });

  afterAll(async () => {
    await clean();
    await sql.end();
  });

  beforeEach(async () => {
    await clean();
    // Rebind after the outer beforeEach's clearAllMocks, which runs first.
    const realSeeds =
      await vi.importActual<typeof import('@/db/queries/seeds')>('@/db/queries/seeds');
    const realJobs = await vi.importActual<typeof import('@/db/queries/jobs')>('@/db/queries/jobs');
    unenqueuedSeeds.mockImplementation(realSeeds.unenqueuedSeeds);
    countUnenqueuedSeeds.mockImplementation(realSeeds.countUnenqueuedSeeds);
    enqueueJob.mockImplementation(realJobs.enqueueJob);
  });

  it('carries a persisted scan’s seed into a queued job', async () => {
    await persistScan(scan([seed(SEED_OK)]));

    const result = await fanOutSeeds({ limit: 10, only: [SEED_OK] });

    expect(result).toMatchObject({ considered: 1, enqueued: 1, flooded: false });
    expect(await jobsFor()).toEqual([{ target: SEED_OK, status: 'queued' }]);
  });

  it('adds no second job when fan-out runs again over the same seed', async () => {
    await persistScan(scan([seed(SEED_OK)]));
    await fanOutSeeds({ limit: 10, only: [SEED_OK] });

    const second = await fanOutSeeds({ limit: 10, only: [SEED_OK] });

    // The seed now has a job, so the anti-join no longer offers it at all —
    // idempotence by exclusion, before enqueueJob's ON CONFLICT is even reached.
    expect(second).toMatchObject({ considered: 0, enqueued: 0 });
    expect(await jobsFor()).toHaveLength(1);
  });

  it('creates no job for a denylisted seed, and does not leave it pending either', async () => {
    await persistScan(scan([seed(SEED_OK)]));
    await sql`INSERT INTO repo_seed (full_name, source_kind, discovered_from, discovered_path, hint)
              VALUES (${SEED_BLOCKED}, 'github', ${SPEC}, 'x', '{}'::jsonb)`;
    await sql`INSERT INTO repository_denylist (full_name, reason) VALUES (${SEED_BLOCKED}, 'test')`;

    const result = await fanOutSeeds({ limit: 10, only: [SEED_OK, SEED_BLOCKED] });

    expect(result).toMatchObject({ considered: 1, enqueued: 1 });
    expect(await jobsFor()).toEqual([{ target: SEED_OK, status: 'queued' }]);

    // Reported by absence from BOTH sides, which is the honest description: the
    // denylist anti-join removes it before enqueueJob sees it, so it never
    // reaches the `denylisted` counter — and it is not silently pending either,
    // because countUnenqueuedSeeds applies the same anti-join. The counter path
    // is exercised in the mocked block above, where enqueueJob is what refuses.
    const scoped = await vi
      .importActual<typeof import('@/db/queries/seeds')>('@/db/queries/seeds')
      .then((m) => m.unenqueuedSeeds(10, [SEED_BLOCKED]));
    expect(scoped).toEqual([]);
  });

  it('writes the seed with the catalog’s own repository as its provenance', async () => {
    await persistScan(scan([seed(SEED_OK)]));

    const [row] = await sql<{ discovered_from: string; discovered_path: string }[]>`
      SELECT discovered_from, discovered_path FROM repo_seed WHERE full_name = ${SEED_OK}
    `;
    // Distinguishable by query from an operator row and a registry row, and not
    // a hostname (05-CONTEXT D-12).
    expect(row.discovered_from).toBe(SPEC);
    expect(row.discovered_path).toBe('.claude-plugin/marketplace.json');
  });
});
