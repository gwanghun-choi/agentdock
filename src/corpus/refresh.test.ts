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
    fields: {
      scannedAt: Date | null;
      isFork?: boolean;
      isArchived?: boolean;
      stars?: number;
      checkedAt?: Date | null;
      checkFailures?: number;
    },
  ) {
    // ISO string, not a Date. postgres.js infers a parameter's type from the
    // value, and `Date | null` gives it nothing to infer from on the null
    // branch, so it falls through to its byte encoder and throws on the Date.
    // The column is timestamptz and parses the string.
    const scannedAt = fields.scannedAt?.toISOString() ?? null;
    const checkedAt = fields.checkedAt?.toISOString() ?? null;
    await sql`
      INSERT INTO repository
        (github_node_id, full_name, owner, default_branch, stars, is_fork, is_archived, scanned_at,
         checked_at, check_failures)
      VALUES (
        ${`${NODE}-${name}`}, ${`${PREFIX}-${name}`}, 'test-owner', 'main',
        ${fields.stars ?? 500}, ${fields.isFork ?? false}, ${fields.isArchived ?? false},
        ${scannedAt}, ${checkedAt}, ${fields.checkFailures ?? 0}
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

  /**
   * R1's remainder. A stored repository that turned 404 or too_large never
   * moves scanned_at (nothing was read, and the UI prints scanned_at as "read
   * on"), so before checked_at it held the oldest scanned_at in the corpus and
   * a refresh slot every run, forever.
   */
  describe('stored repositories whose checks fail', () => {
    const ago = (hours: number) => new Date(Date.now() - hours * HOUR);

    it('orders by the last check, so a failed one goes behind the rest', async () => {
      // Read 100 h ago, failed a check an hour ago → not due, not first.
      await seed('just-failed', { scannedAt: ago(100), checkedAt: ago(1), checkFailures: 1 });
      await seed('plain', { scannedAt: ago(20) });

      const result = await refreshStaleRepositories({ limit: 10, staleAfterMs: 12 * HOUR });

      expect(await queued()).toEqual([`${PREFIX}-plain`]);
      expect(result.failingChecks).toBeGreaterThanOrEqual(1);
    });

    it('doubles the wait per consecutive failure', async () => {
      // One failure: due after 24 h. Two: after 48 h.
      await seed('f1-early', { scannedAt: ago(200), checkedAt: ago(20), checkFailures: 1 });
      await seed('f1-due', { scannedAt: ago(200), checkedAt: ago(30), checkFailures: 1 });
      await seed('f2-early', { scannedAt: ago(200), checkedAt: ago(40), checkFailures: 2 });
      await seed('f2-due', { scannedAt: ago(200), checkedAt: ago(50), checkFailures: 2 });

      await refreshStaleRepositories({ limit: 10, staleAfterMs: 12 * HOUR });

      // Oldest check first among the due ones.
      expect(await queued()).toEqual([`${PREFIX}-f2-due`, `${PREFIX}-f1-due`]);
    });

    it('caps the wait, so a repository that comes back is found within days', async () => {
      const { CORPUS_CAPS } = await import('./caps');
      const capHours = 12 * 2 ** CORPUS_CAPS.maxCheckBackoffDoublings;
      await seed('long-gone', {
        scannedAt: ago(5000),
        checkedAt: ago(capHours + 1),
        checkFailures: 40,
      });
      await seed('not-yet', {
        scannedAt: ago(5000),
        checkedAt: ago(capHours - 1),
        checkFailures: 40,
      });

      await refreshStaleRepositories({ limit: 10, staleAfterMs: 12 * HOUR });

      expect(await queued()).toEqual([`${PREFIX}-long-gone`]);
    });

    it('keeps treating a row from before checked_at existed by its scanned_at', async () => {
      await seed('legacy', { scannedAt: ago(30), checkedAt: null });

      await refreshStaleRepositories({ limit: 10, staleAfterMs: 12 * HOUR });

      expect(await queued()).toEqual([`${PREFIX}-legacy`]);
    });

    it('a pile of failing repositories no longer holds every slot', async () => {
      // Thirty, past the unauthenticated cap of 25, each read long ago and each
      // failing — the shape that used to fill the whole refresh every run.
      for (let i = 0; i < 30; i += 1) {
        await seed(`dead-${String(i).padStart(2, '0')}`, {
          scannedAt: ago(500 + i),
          checkedAt: ago(2),
          checkFailures: 1,
        });
      }
      await seed('alive', { scannedAt: ago(13) });

      const result = await refreshStaleRepositories({ limit: 25, staleAfterMs: 12 * HOUR });

      expect(await queued()).toEqual([`${PREFIX}-alive`]);
      expect(result.notReached).toBe(0);
      expect(result.failingChecks).toBeGreaterThanOrEqual(30);
    });
  });
});
