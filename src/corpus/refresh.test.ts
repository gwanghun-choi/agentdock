import { afterAll, beforeEach, describe, expect, it } from 'vitest';

process.env.DATABASE_SCHEMA = 'agentdock_test';

const DB_URL = process.env.DATABASE_URL;

// Sentinels no other suite can produce. Vitest runs files in parallel against
// one schema and `repository` carries unique indexes on BOTH github_node_id and
// full_name, so both have to be distinctive.
const PREFIX = 'test-owner/refresh-spec';
const NODE = 'refresh-spec-node';

const HOUR = 60 * 60 * 1000;

describe.skipIf(!DB_URL)('refreshStaleRepositories', () => {
  let refreshStaleRepositories: typeof import('./refresh').refreshStaleRepositories;
  let sql: typeof import('@/db/client').sql;

  /**
   * One repository row, with only the fields this scheduler reads set
   * meaningfully. It writes no package and no version: refresh decides WHICH
   * repositories pay for a change check, and knows nothing about what is under
   * them.
   */
  async function seed(
    name: string,
    fields: { scannedAt: Date | null; isFork?: boolean; isArchived?: boolean; stars?: number },
  ) {
    // ISO string, not a Date. postgres.js infers a parameter's type from the
    // value, and `Date | null` gives it nothing to infer from on the null
    // branch, so it falls through to its byte encoder and throws on the Date.
    // The column is timestamptz and parses the string.
    const scannedAt = fields.scannedAt?.toISOString() ?? null;
    await sql`
      INSERT INTO repository
        (github_node_id, full_name, owner, default_branch, stars, is_fork, is_archived, scanned_at)
      VALUES (
        ${`${NODE}-${name}`}, ${`${PREFIX}-${name}`}, 'test-owner', 'main',
        ${fields.stars ?? 500}, ${fields.isFork ?? false}, ${fields.isArchived ?? false},
        ${scannedAt}
      )
    `;
  }

  async function clean() {
    await sql`DELETE FROM ingest_job WHERE target LIKE ${`${PREFIX}%`}`;
    await sql`DELETE FROM repository WHERE github_node_id LIKE ${`${NODE}%`}`;
  }

  /** Only this suite's own rows, so a parallel suite's queue cannot be read as ours. */
  async function queued(): Promise<string[]> {
    const rows = await sql<{ target: string }[]>`
      SELECT target FROM ingest_job WHERE target LIKE ${`${PREFIX}%`} ORDER BY id
    `;
    return rows.map((r) => r.target);
  }

  beforeEach(async () => {
    ({ refreshStaleRepositories } = await import('./refresh'));
    ({ sql } = await import('@/db/client'));
    await clean();
  });

  afterAll(async () => {
    await clean();
    await sql.end();
  });

  it('offers a repository last read longer ago than the cutoff', async () => {
    await seed('stale', { scannedAt: new Date(Date.now() - 30 * HOUR) });

    const result = await refreshStaleRepositories({ limit: 10, staleAfterMs: 12 * HOUR });

    expect(result.enqueued).toBe(1);
    expect(await queued()).toEqual([`${PREFIX}-stale`]);
  });

  /**
   * The idempotency property the twice-daily schedule depends on. A repository
   * read an hour ago must not be re-offered by the afternoon run, or two syncs a
   * day would spend the whole budget re-checking the same handful of
   * repositories and never reach the tail.
   */
  it('does not offer one read more recently than the cutoff', async () => {
    await seed('fresh', { scannedAt: new Date(Date.now() - 1 * HOUR) });

    const result = await refreshStaleRepositories({ limit: 10, staleAfterMs: 12 * HOUR });

    expect(result.considered).toBe(0);
    expect(await queued()).toEqual([]);
  });

  it('treats a repository that was never read as the most stale thing there is', async () => {
    await seed('never', { scannedAt: null });
    await seed('old', { scannedAt: new Date(Date.now() - 100 * HOUR) });

    const result = await refreshStaleRepositories({ limit: 1, staleAfterMs: 12 * HOUR });

    expect(result.enqueued).toBe(1);
    // NULLS FIRST: without it the null row sorts last and a corpus with one
    // never-read repository would never get to it.
    expect(await queued()).toEqual([`${PREFIX}-never`]);
  });

  it('offers least-recently-read first, so repeated runs rotate rather than starve', async () => {
    await seed('newer', { scannedAt: new Date(Date.now() - 20 * HOUR) });
    await seed('older', { scannedAt: new Date(Date.now() - 50 * HOUR) });

    await refreshStaleRepositories({ limit: 1, staleAfterMs: 12 * HOUR });

    expect(await queued()).toEqual([`${PREFIX}-older`]);
  });

  // Not deleted, not hidden — skipped. An archived repository has no next
  // commit and a fork was never something automatic discovery added, so two
  // core requests to confirm either is the cheapest thing to stop spending.
  it.each([
    ['a fork', { isFork: true }],
    ['an archived repository', { isArchived: true }],
  ])('does not spend requests re-checking %s', async (_label, fields) => {
    await seed('skipped', { scannedAt: new Date(Date.now() - 99 * HOUR), ...fields });

    const result = await refreshStaleRepositories({ limit: 10, staleAfterMs: 12 * HOUR });

    expect(result.considered).toBe(0);
    expect(await queued()).toEqual([]);
  });

  /**
   * Stars are an entry gate, never a maintenance rule. A repository whose star
   * count fell below the floor after being read keeps being re-read; the
   * alternative is a corpus that silently freezes, then rots, around whatever
   * went out of fashion.
   */
  it('re-checks a stored repository that has fallen below the star floor', async () => {
    const { MIN_REPOSITORY_STARS } = await import('./policy');
    await seed('unpopular', {
      scannedAt: new Date(Date.now() - 30 * HOUR),
      stars: MIN_REPOSITORY_STARS - 40,
    });

    const result = await refreshStaleRepositories({ limit: 10, staleAfterMs: 12 * HOUR });

    expect(result.enqueued).toBe(1);
    expect(await queued()).toEqual([`${PREFIX}-unpopular`]);
  });

  it('says how many stale repositories the cap left behind', async () => {
    for (const n of ['a', 'b', 'c']) {
      await seed(n, { scannedAt: new Date(Date.now() - (30 + n.charCodeAt(0)) * HOUR) });
    }

    const result = await refreshStaleRepositories({ limit: 1, staleAfterMs: 12 * HOUR });

    expect(result.considered).toBe(1);
    // A cap that printed nothing would read as "the whole corpus was checked".
    expect(result.notReached).toBe(2);
  });

  it('re-offering a repository already queued raises no conflict', async () => {
    await seed('twice', { scannedAt: new Date(Date.now() - 30 * HOUR) });

    await refreshStaleRepositories({ limit: 10, staleAfterMs: 12 * HOUR });
    // scanned_at only moves when the job actually RUNS, so the second sync sees
    // the same stale row. The partial unique index on (target) where status is
    // queued or running is what makes this a no-op instead of a duplicate.
    await refreshStaleRepositories({ limit: 10, staleAfterMs: 12 * HOUR });

    expect(await queued()).toEqual([`${PREFIX}-twice`]);
  });

  it('does not re-offer a repository the denylist covers', async () => {
    await seed('blocked', { scannedAt: new Date(Date.now() - 30 * HOUR) });
    await sql`
      INSERT INTO repository_denylist (full_name, reason)
      VALUES (${`${PREFIX}-blocked`}, 'refresh spec')
      ON CONFLICT DO NOTHING
    `;
    try {
      const result = await refreshStaleRepositories({ limit: 10, staleAfterMs: 12 * HOUR });

      expect(result.denylisted).toBe(1);
      expect(result.enqueued).toBe(0);
      expect(await queued()).toEqual([]);
    } finally {
      await sql`DELETE FROM repository_denylist WHERE full_name = ${`${PREFIX}-blocked`}`;
    }
  });
});
