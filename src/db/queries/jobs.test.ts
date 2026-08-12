import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// Database-backed tests write, so they write to the test schema. The schema
// module reads this at import time, hence the assignment before any import of
// it. Vitest isolates files into separate workers, so this cannot leak.
process.env.DATABASE_SCHEMA = 'agentdock_test';

const DB_URL = process.env.DATABASE_URL;

// Sentinels. vitest runs test FILES in parallel against the one test schema and
// `ingest_job_active_key` is unique on target, so a suite that borrowed a real
// repository name would collide with any suite that enqueues it for real.
const A = 'test-owner/queue-spec-a';
const B = 'test-owner/queue-spec-b';
const BLOCKED = 'test-owner/queue-spec-denied';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!DB_URL)('the queue', () => {
  let jobs: typeof import('./jobs');
  let db: typeof import('@/db/client').db;
  let sql: typeof import('@/db/client').sql;

  // claimJob takes the oldest claimable row in the whole schema, so this suite
  // only works if no other suite leaves a `queued` row behind. persist.test.ts
  // shares the schema and writes ingest_job rows too — it inserts them already
  // `running`, for exactly this reason. Keep it that way.
  async function clean() {
    // lower() so a regression in enqueueJob's normalization leaks no row a
    // later suite would collide with, instead of hiding behind the cleanup.
    await sql`DELETE FROM ingest_job WHERE lower(target) LIKE 'test-owner/queue-spec%'`;
    await sql`DELETE FROM repository_denylist WHERE full_name = ${BLOCKED}`;
  }

  beforeAll(async () => {
    jobs = await import('./jobs');
    ({ db, sql } = await import('@/db/client'));
    await clean();
  });

  afterAll(async () => {
    await clean();
    await sql.end();
  });

  beforeEach(clean);

  describe('claimJob', () => {
    it('hands two concurrent claims two different jobs, and neither blocks', async () => {
      await jobs.enqueueJob(A);
      await jobs.enqueueJob(B);

      const t0 = Date.now();
      let bFinishedAfterMs = Number.POSITIVE_INFINITY;

      const [a, b] = await Promise.all([
        db.transaction(async (tx) => {
          const claimed = await jobs.claimJob('A', tx);
          // Held so the second claim lands inside the window. A local UPDATE
          // completes in single-digit milliseconds, so 300 ms is a six-fold
          // margin rather than a race.
          await sleep(300);
          return claimed;
        }),
        (async () => {
          await sleep(50);
          const claimed = await db.transaction((tx) => jobs.claimJob('B', tx));
          bFinishedAfterMs = Date.now() - t0;
          return claimed;
        })(),
      ]);

      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
      expect(a?.id).not.toBe(b?.id);
      // The whole point: B skipped A's locked row instead of waiting for it.
      expect(bFinishedAfterMs).toBeLessThan(300);
    });

    it('returns nothing rather than waiting when the queue is empty', async () => {
      expect(await jobs.claimJob('C')).toBeNull();
    });

    it('skips a job whose scheduled time has not arrived', async () => {
      const queued = await jobs.enqueueJob(A);
      if (queued.kind !== 'queued') throw new Error('unreachable');
      // Set in SQL, because next_attempt_at is written by the database and a
      // TypeScript clock has no reach there.
      await sql`
        UPDATE ingest_job SET next_attempt_at = now() + interval '1 hour' WHERE id = ${queued.id}
      `;

      // The scheduled column IS the scheduler: there is no cron and no timer.
      expect(await jobs.claimJob('D')).toBeNull();
    });
  });

  describe('scheduleRetry', () => {
    /** A job as the claim leaves it. */
    async function claimedJob() {
      await jobs.enqueueJob(A);
      const claimed = await jobs.claimJob('W');
      if (!claimed) throw new Error('unreachable');
      return claimed;
    }

    function record(jobId: number, attemptNo: number) {
      return {
        jobId,
        attemptNo,
        startedAt: new Date(),
        outcome: 'unavailable',
        errorDetail: 'AgentDock could not reach GitHub. Try again shortly.',
        commitSha: null,
        filesRead: 0,
        artifactsFound: 0,
        artifactsNew: 0,
        artifactsUpdated: 0,
        artifactsUnchanged: 0,
        artifactsRemoved: 0,
        parseFailed: 0,
        truncated: false,
        rateRemaining: 3,
        rateReset: null,
      };
    }

    async function row(id: number) {
      const [found] = await sql<
        { status: string; attempts: number; worker_id: string | null; started_at: Date | null }[]
      >`SELECT status, attempts, worker_id, started_at FROM ingest_job WHERE id = ${id}`;
      return found;
    }

    it('never leaves the queue, so the row never leaves the active-job index', async () => {
      const claimed = await claimedJob();

      await jobs.scheduleRetry(record(claimed.id, claimed.attempts), {
        nextAttemptAt: new Date(Date.now() + 60_000),
        refundAttempt: false,
      });

      expect(await row(claimed.id)).toMatchObject({
        status: 'queued',
        attempts: 1,
        worker_id: null,
        started_at: null,
      });
      // A submission arriving during the wait joins it rather than colliding.
      expect(await jobs.enqueueJob(A)).toEqual({ kind: 'queued', id: claimed.id });
    });

    it('gives the attempt back when the wait was for a clock, not a failure', async () => {
      const claimed = await claimedJob();
      expect(claimed.attempts).toBe(1);

      await jobs.scheduleRetry(record(claimed.id, claimed.attempts), {
        nextAttemptAt: new Date(Date.now() + 60_000),
        refundAttempt: true,
      });

      // Back to what it was before the claim. Without the refund, three quiet
      // hours of exhausted budget would permanently fail every queued
      // repository for a reason that was temporary.
      expect((await row(claimed.id)).attempts).toBe(0);
    });

    it('writes exactly one attempt row, in the same transaction', async () => {
      const claimed = await claimedJob();

      await jobs.scheduleRetry(record(claimed.id, claimed.attempts), {
        nextAttemptAt: new Date(Date.now() + 60_000),
        refundAttempt: false,
      });

      const rows = await sql<{ outcome: string; error_detail: string }[]>`
        SELECT outcome, error_detail FROM ingest_attempt WHERE job_id = ${claimed.id}
      `;
      expect(rows).toHaveLength(1);
      expect(rows[0].outcome).toBe('unavailable');
      expect(rows[0].error_detail).toContain('could not reach GitHub');
    });
  });

  describe('enqueueJob', () => {
    it('returns the same job id while the first is still queued', async () => {
      const first = await jobs.enqueueJob(A);
      const second = await jobs.enqueueJob(A);
      expect(first).toEqual({ kind: 'queued', id: expect.any(Number) });
      expect(second).toEqual(first);
    });

    it('returns the running job id when one is already in flight', async () => {
      const first = await jobs.enqueueJob(A);
      const claimed = await jobs.claimJob('W');
      expect(claimed?.target).toBe(A);

      const again = await jobs.enqueueJob(A);
      expect(again).toEqual(first);
    });

    it('mints a new job once the previous one reached a terminal status', async () => {
      const first = await jobs.enqueueJob(A);
      if (first.kind !== 'queued') throw new Error('unreachable');
      await sql`UPDATE ingest_job SET status = 'succeeded', finished_at = now() WHERE id = ${first.id}`;

      const second = await jobs.enqueueJob(A);
      if (second.kind !== 'queued') throw new Error('unreachable');
      expect(second.id).not.toBe(first.id);
    });

    it('treats a mixed-case name as the same repository, and stores it lowercase', async () => {
      // Without the boundary lowercase these are two active rows for one
      // repository, at two GitHub requests each out of sixty an hour — and seed
      // fan-out, which always emits lowercase, would collide with every human
      // submission that did not.
      const first = await jobs.enqueueJob(A.toUpperCase());
      const second = await jobs.enqueueJob(A);
      expect(second).toEqual(first);

      const rows = await sql<{ target: string }[]>`
        SELECT target FROM ingest_job WHERE lower(target) = ${A}
      `;
      expect(rows).toHaveLength(1);
      expect(rows[0].target).toBe(A);
    });

    it('still refuses a denylisted repository when the caller passes mixed case', async () => {
      await sql`INSERT INTO repository_denylist (full_name, reason) VALUES (${BLOCKED}, 'test')`;
      expect(await jobs.enqueueJob(BLOCKED.toUpperCase())).toEqual({ kind: 'denylisted' });
    });

    it('creates no row for a denylisted target', async () => {
      await sql`INSERT INTO repository_denylist (full_name, reason) VALUES (${BLOCKED}, 'test')`;

      expect(await jobs.enqueueJob(BLOCKED)).toEqual({ kind: 'denylisted' });

      const [row] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM ingest_job WHERE target = ${BLOCKED}
      `;
      expect(row.n).toBe(0);
    });

    it('creates no row once the queued depth is at the cap', async () => {
      await sql`
        INSERT INTO ingest_job (target)
        SELECT 'test-owner/queue-spec-flood-' || g
          FROM generate_series(1, ${jobs.MAX_QUEUED}) g
      `;

      expect(await jobs.enqueueJob(A)).toEqual({ kind: 'flooded' });

      const [row] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM ingest_job WHERE target = ${A}
      `;
      expect(row.n).toBe(0);
    });
  });

  describe('reapAbandoned', () => {
    it('returns an abandoned job to the queue without touching its attempt count', async () => {
      await jobs.enqueueJob(A);
      const claimed = await jobs.claimJob('gone');
      if (!claimed) throw new Error('unreachable');
      expect(claimed.attempts).toBe(1);

      // Backdated in SQL, not on a fake clock: started_at is written by the
      // database, where a TypeScript clock has no reach.
      await sql`UPDATE ingest_job SET started_at = now() - interval '20 minutes' WHERE id = ${claimed.id}`;

      const reaped = await jobs.reapAbandoned(15 * 60_000);
      expect(reaped.map((r) => r.id)).toEqual([claimed.id]);

      const [row] = await sql<
        { status: string; attempts: number; worker_id: string | null; started_at: Date | null }[]
      >`SELECT status, attempts, worker_id, started_at FROM ingest_job WHERE id = ${claimed.id}`;
      expect(row).toMatchObject({ status: 'queued', attempts: 1, worker_id: null });
      expect(row.started_at).toBeNull();
    });

    it('leaves a running job that is still inside the threshold alone', async () => {
      await jobs.enqueueJob(A);
      const claimed = await jobs.claimJob('alive');
      if (!claimed) throw new Error('unreachable');

      expect(await jobs.reapAbandoned(15 * 60_000)).toEqual([]);

      const [row] = await sql<{ status: string; worker_id: string | null }[]>`
        SELECT status, worker_id FROM ingest_job WHERE id = ${claimed.id}
      `;
      expect(row).toMatchObject({ status: 'running', worker_id: 'alive' });
    });
  });
});
