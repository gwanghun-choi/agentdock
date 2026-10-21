import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IngestResult } from './pipeline';

// The worker module reaches the database client transitively, and that module
// reads the schema name at import time.
process.env.DATABASE_SCHEMA = 'agentdock_test';

const DB_URL = process.env.DATABASE_URL;

// Sentinel, and always seeded `running`: the queue suite shares this schema and
// its claim takes the oldest claimable row anywhere in it. Every row this suite
// leaves behind is either terminal or scheduled into the future, so none of them
// is claimable.
const TARGET = 'test-owner/worker-spec';

const HOUR_MS = 60 * 60 * 1000;

// The pipeline is stubbed rather than driven: every behaviour below is about
// what the loop does with an outcome, and provoking a real exhausted budget
// would spend the whole hourly budget to learn a header's semantics.
const ingestRepository = vi.hoisted(() => vi.fn());
vi.mock('@/ingest/pipeline', () => ({ ingestRepository }));

const failure = (over: Partial<Extract<IngestResult, { ok: false }>> = {}): IngestResult => ({
  ok: false,
  outcome: 'unavailable',
  message: 'AgentDock could not reach GitHub. Try again shortly.',
  ...over,
});

describe.skipIf(!DB_URL)('REAP_AFTER_MS', () => {
  it('is at least six times the longest runtime the caps permit', async () => {
    const { REAP_AFTER_MS } = await import('./worker');
    const { CAPS } = await import('@/github/scan');
    const { REQUEST_TIMEOUT_MS } = await import('@/github/client');

    // Arithmetic against the two constants it is derived from, so a future cap
    // change either keeps the relationship or fails here — rather than silently
    // letting the reaper fire during a legitimate run.
    const longestLegitimateRunMs = CAPS.wallClockMs + 3 * REQUEST_TIMEOUT_MS;
    expect(REAP_AFTER_MS).toBeGreaterThanOrEqual(6 * longestLegitimateRunMs);
  });
});

describe.skipIf(!DB_URL)('what the loop does with each outcome', () => {
  let worker: typeof import('./worker');
  let jobs: typeof import('@/db/queries/jobs');
  let sql: typeof import('@/db/client').sql;

  async function clean() {
    await sql`DELETE FROM ingest_job WHERE target LIKE 'test-owner/worker-spec%'`;
  }

  /** A job as the claim leaves it: running, with its attempt already counted. */
  async function claimed(attempts: number): Promise<{ id: number; attempts: number }> {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO ingest_job (target, status, attempts, started_at, worker_id)
      VALUES (${TARGET}, 'running', ${attempts}, now(), 'worker-spec')
      RETURNING id
    `;
    return { id: Number(row.id), attempts };
  }

  async function jobRow(id: number) {
    const [row] = await sql<
      {
        status: string;
        attempts: number;
        next_attempt_at: string | Date;
        worker_id: string | null;
        started_at: string | Date | null;
      }[]
    >`SELECT status, attempts, next_attempt_at, worker_id, started_at
        FROM ingest_job WHERE id = ${id}`;
    return row;
  }

  async function attemptsOf(id: number) {
    return sql<Record<string, unknown>[]>`
      SELECT * FROM ingest_attempt WHERE job_id = ${id} ORDER BY attempt_no
    `;
  }

  const scheduledInMs = (row: { next_attempt_at: string | Date }) =>
    new Date(row.next_attempt_at).getTime() - Date.now();

  beforeAll(async () => {
    worker = await import('./worker');
    jobs = await import('@/db/queries/jobs');
    ({ sql } = await import('@/db/client'));
    await clean();
  });

  afterAll(async () => {
    await clean();
    await sql.end();
  });

  beforeEach(async () => {
    await clean();
    ingestRepository.mockReset();
  });

  it('leaves a retryable failure queued, scheduled ahead, with its attempt spent', async () => {
    const job = await claimed(1);
    ingestRepository.mockResolvedValue(failure());

    const run = await worker.runJob({
      id: job.id,
      target: TARGET,
      attempts: 1,
      startedAt: new Date(),
    });

    expect(run).toEqual({ outcome: 'unavailable', removed: 0, retryScheduled: true });
    const row = await jobRow(job.id);
    expect(row).toMatchObject({ status: 'queued', attempts: 1, worker_id: null });
    expect(row.started_at).toBeNull();
    expect(scheduledInMs(row)).toBeGreaterThan(30_000);
  });

  it('fails a retryable failure once the attempt ceiling is reached', async () => {
    const job = await claimed(3);
    ingestRepository.mockResolvedValue(
      failure({ outcome: 'storage_failed', message: 'stored no' }),
    );

    const run = await worker.runJob({
      id: job.id,
      target: TARGET,
      attempts: 3,
      startedAt: new Date(),
    });

    expect(run.retryScheduled).toBe(false);
    const row = await jobRow(job.id);
    expect(row.status).toBe('failed');
    expect(scheduledInMs(row)).toBeLessThanOrEqual(0);

    const [attempt] = await attemptsOf(job.id);
    expect(attempt).toMatchObject({ outcome: 'storage_failed', error_detail: 'stored no' });
  });

  it.each(['unreadable', 'too_large', 'invalid_input'] as const)(
    'fails a %s job on its first attempt',
    async (outcome) => {
      const job = await claimed(1);
      ingestRepository.mockResolvedValue(failure({ outcome, message: `${outcome} message` }));

      await worker.runJob({ id: job.id, target: TARGET, attempts: 1, startedAt: new Date() });

      const row = await jobRow(job.id);
      // GitHub will give the same answer next time, so a retry spends two of
      // sixty hourly requests to learn it again.
      expect(row.status).toBe('failed');
      expect(scheduledInMs(row)).toBeLessThanOrEqual(0);
    },
  );

  it.each(['denylisted', 'no_artifacts'] as const)(
    'records a %s job as succeeded, not failed',
    async (outcome) => {
      const job = await claimed(1);
      ingestRepository.mockResolvedValue(failure({ outcome, message: `${outcome} message` }));

      await worker.runJob({ id: job.id, target: TARGET, attempts: 1, startedAt: new Date() });

      // AgentDock did its work and the answer is "no". A failure here would put
      // it in the retry path, where every attempt produces the same answer.
      expect((await jobRow(job.id)).status).toBe('succeeded');
    },
  );

  describe('an exhausted budget', () => {
    it('defers the job and gives back the attempt the claim spent', async () => {
      const job = await claimed(2);
      const resetAt = Math.floor((Date.now() + 12 * 60_000) / 1000);
      ingestRepository.mockResolvedValue(
        failure({ outcome: 'rate_limited', message: 'budget gone', resetAt }),
      );

      await worker.runJob({ id: job.id, target: TARGET, attempts: 2, startedAt: new Date() });

      const row = await jobRow(job.id);
      // Compared against the count before the claim, not merely checked for
      // being queued: requiring only the status would pass while the count crept
      // upward on every hour of exhausted budget until the job failed for good.
      expect(row).toMatchObject({ status: 'queued', attempts: 1 });
      expect(new Date(row.next_attempt_at).getTime()).toBe(resetAt * 1000);
    });

    it('clamps a reset a year away to within an hour', async () => {
      const job = await claimed(1);
      const resetAt = Math.floor((Date.now() + 365 * 24 * HOUR_MS) / 1000);
      ingestRepository.mockResolvedValue(
        failure({ outcome: 'rate_limited', message: 'budget gone', resetAt }),
      );

      await worker.runJob({ id: job.id, target: TARGET, attempts: 1, startedAt: new Date() });

      const row = await jobRow(job.id);
      expect(row.status).toBe('queued');
      expect(scheduledInMs(row)).toBeLessThanOrEqual(HOUR_MS);
      expect(scheduledInMs(row)).toBeGreaterThan(HOUR_MS - 60_000);
    });
  });

  it('writes exactly one attempt row on every path, carrying the outcome', async () => {
    for (const outcome of ['unavailable', 'unreadable', 'rate_limited', 'no_artifacts'] as const) {
      await clean();
      const job = await claimed(1);
      ingestRepository.mockResolvedValue(failure({ outcome, message: `${outcome} message` }));

      await worker.runJob({ id: job.id, target: TARGET, attempts: 1, startedAt: new Date() });

      const rows = await attemptsOf(job.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ outcome, attempt_no: 1 });
    }
  });

  it('writes nothing when the ingest succeeded, because it terminated itself', async () => {
    const job = await claimed(1);
    ingestRepository.mockResolvedValue({
      ok: true,
      outcome: 'ok',
      counters: { removed: 2 },
    } as IngestResult);

    const run = await worker.runJob({
      id: job.id,
      target: TARGET,
      attempts: 1,
      startedAt: new Date(),
    });

    // What the sync's summary adds up: the read's delistings, carried out.
    expect(run).toEqual({ outcome: 'ok', removed: 2, retryScheduled: false });
    expect(await attemptsOf(job.id)).toHaveLength(0);
    // Untouched: the pipeline's own transaction owns this row on the ok path.
    expect((await jobRow(job.id)).status).toBe('running');
  });

  /**
   * R1's remainder: a failed job about a STORED repository is a check that
   * read nothing. checked_at moves and the streak grows, so the refresh stops
   * putting it first (src/corpus/refresh.ts); scanned_at — "read on" — and the
   * artifacts stay exactly as they were.
   */
  describe('a stored repository whose job fails', () => {
    const NODE = 'worker-spec-stored-node';
    const READ_AT = '2026-01-02T03:04:05.000Z';

    async function stored() {
      await sql`DELETE FROM repository WHERE github_node_id = ${NODE}`;
      // Upper case on purpose: the job's target and the stored name are matched
      // case-insensitively, as the unique index on lower(full_name) is.
      await sql`
        INSERT INTO repository (github_node_id, full_name, owner, default_branch, scanned_at)
        VALUES (${NODE}, ${TARGET.toUpperCase()}, 'test-owner', 'main', ${READ_AT})`;
    }

    async function checkState() {
      const [row] = await sql<
        { scanned_at: Date; checked_at: Date | null; check_failures: number }[]
      >`SELECT scanned_at, checked_at, check_failures FROM repository WHERE github_node_id = ${NODE}`;
      return row;
    }

    afterAll(async () => {
      await sql`DELETE FROM repository WHERE github_node_id = ${NODE}`;
    });

    it.each([
      ['unreadable', 1],
      ['too_large', 1],
      ['unavailable', 3],
      ['storage_failed', 3],
    ] as const)('records a %s that ended the job as a failed check', async (outcome, attempts) => {
      await stored();
      for (const round of [1, 2]) {
        await clean();
        const job = await claimed(attempts);
        ingestRepository.mockResolvedValue(failure({ outcome, message: `${outcome} message` }));

        await worker.runJob({ id: job.id, target: TARGET, attempts, startedAt: new Date() });

        const row = await checkState();
        expect(row.check_failures).toBe(round);
        expect(Date.now() - new Date(row.checked_at as Date).getTime()).toBeLessThan(60_000);
        expect(new Date(row.scanned_at).toISOString()).toBe(READ_AT);
      }
    });

    it.each([
      ['a retry still to come', 'unavailable'],
      ['an exhausted budget', 'rate_limited'],
    ] as const)('leaves the check alone for %s', async (_label, outcome) => {
      await stored();
      const job = await claimed(1);
      ingestRepository.mockResolvedValue(failure({ outcome, message: `${outcome} message` }));

      await worker.runJob({ id: job.id, target: TARGET, attempts: 1, startedAt: new Date() });

      // Neither says anything about the repository: the job is still queued.
      expect(await checkState()).toMatchObject({ checked_at: null, check_failures: 0 });
    });
  });

  it('joins a submission that arrives while the job is waiting, raising no conflict', async () => {
    const job = await claimed(1);
    ingestRepository.mockResolvedValue(failure());
    await worker.runJob({ id: job.id, target: TARGET, attempts: 1, startedAt: new Date() });

    // The failure this design exists to prevent, rather than a property of it: a
    // retry that went to failed and came back would have to re-enter the
    // active-job index, and a submission arriving in that gap would collide.
    const result = await jobs.enqueueJob(TARGET);

    expect(result).toEqual({ kind: 'queued', id: job.id });
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM ingest_job WHERE target = ${TARGET}
    `;
    expect(row.n).toBe(1);
  });
});

// The preemptive gate's assertions live beside the rest of the policy, in
// src/ingest/retry.test.ts, so they run where there is no database.
