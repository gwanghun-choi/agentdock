import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubmitState } from './actions';

// Database-backed tests write, so they write to the test schema. The schema
// module reads this at import time, hence the assignment before any import of
// it. Vitest isolates files into separate workers, so this cannot leak.
process.env.DATABASE_SCHEMA = 'agentdock_test';

const DB_URL = process.env.DATABASE_URL;

// Sentinels. vitest runs test FILES in parallel against the one test schema and
// `ingest_job_active_key` is unique on target, so a suite that borrowed a real
// repository name would collide with any suite that enqueues it for real.
//
// Every row this suite creates is seeded here rather than left behind by the
// action under test, and every seeded `queued` row is scheduled far enough
// ahead that `claimJob` cannot see it. The queue suite asserts that an empty
// queue returns nothing, and it takes the oldest claimable row anywhere in the
// schema — so a claimable row left here would make that assertion flaky.
const ACTIVE = 'test-owner/actions-spec-active';
const RUNNING = 'test-owner/actions-spec-running';
const BLOCKED = 'test-owner/actions-spec-denied';

const initial: SubmitState = { status: 'idle', message: '' };

const form = (repo: unknown): FormData => {
  const data = new FormData();
  if (repo !== undefined) data.set('repo', String(repo));
  return data;
};

/** What a thrown redirect carries. `digest` is the framework's own encoding. */
function redirectTarget(error: unknown): string {
  const digest = (error as { digest?: string })?.digest;
  if (typeof digest !== 'string' || !digest.startsWith('NEXT_REDIRECT')) {
    throw new Error(`not a redirect: ${String(error)}`);
  }
  return digest.split(';')[2];
}

describe.skipIf(!DB_URL)('the submit surface', () => {
  let actions: typeof import('./actions');
  let sql: typeof import('@/db/client').sql;
  /** Every host the call touched. The load-bearing assertion is that it is empty. */
  let contacted: string[];

  async function clean() {
    await sql`DELETE FROM ingest_job WHERE target LIKE 'test-owner/actions-spec%'`;
    await sql`DELETE FROM repository_denylist WHERE full_name = ${BLOCKED}`;
  }

  /**
   * A queued job nobody can claim.
   *
   * It is in the active-job index, so a submit for the same target dedupes onto
   * it — which is the behaviour under test — but its scheduled time is a day
   * out, so the worker's claim skips it and the queue suite stays deterministic.
   */
  async function seedQueued(target: string): Promise<number> {
    const [row] = await sql<{ id: number }[]>`
      INSERT INTO ingest_job (target, status, next_attempt_at)
      VALUES (${target}, 'queued', now() + interval '1 day')
      RETURNING id
    `;
    // bigserial comes back as a string on this raw path; the query layer hands
    // the same column back as a number.
    return Number(row.id);
  }

  async function seedRunning(target: string): Promise<number> {
    const [row] = await sql<{ id: number }[]>`
      INSERT INTO ingest_job (target, status, attempts, started_at, worker_id)
      VALUES (${target}, 'running', 1, now(), 'actions-spec')
      RETURNING id
    `;
    // bigserial comes back as a string on this raw path; the query layer hands
    // the same column back as a number.
    return Number(row.id);
  }

  async function jobCount(target: string): Promise<number> {
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM ingest_job WHERE target = ${target}
    `;
    return row.n;
  }

  beforeAll(async () => {
    actions = await import('./actions');
    ({ sql } = await import('@/db/client'));
    await clean();
  });

  afterAll(async () => {
    await clean();
    await sql.end();
  });

  beforeEach(async () => {
    await clean();
    contacted = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        contacted.push(new URL(String(input)).hostname);
        throw new Error('a submit must not open a socket');
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('submitRepo', () => {
    it('returns a job id and a link to that job, without opening a socket', async () => {
      const id = await seedQueued(ACTIVE);

      const state = await actions.submitRepo(initial, form(ACTIVE));

      expect(state).toEqual({
        status: 'ok',
        message: expect.stringContaining('is queued'),
        href: `/jobs/${id}`,
        jobId: id,
      });
      // The whole difference between an enqueue and an ingest. Without this the
      // suite cannot tell a request that returned immediately from one that
      // merely looked like it did.
      expect(contacted).toEqual([]);
    });

    it('says the reading happens in the background rather than claiming it is done', async () => {
      await seedQueued(ACTIVE);

      const state = await actions.submitRepo(initial, form(ACTIVE));

      expect(state.message).toContain('in the background');
      expect(state.message).not.toMatch(/indexed|stored|\bread\b(?!s)/i);
    });

    it('sends a duplicate submit to the same job while the first is still queued', async () => {
      const id = await seedQueued(ACTIVE);

      const first = await actions.submitRepo(initial, form(ACTIVE));
      const second = await actions.submitRepo(initial, form(ACTIVE));

      // Deduped, not rejected: telling someone off for doing the ordinary thing
      // and giving them nothing to click is worse than sending them to the run
      // that is already happening.
      expect(second).toEqual(first);
      expect(second.jobId).toBe(id);
      expect(await jobCount(ACTIVE)).toBe(1);
    });

    it('sends a submit for a repository already being read to that same job', async () => {
      const id = await seedRunning(RUNNING);

      const state = await actions.submitRepo(initial, form(RUNNING));

      expect(state.jobId).toBe(id);
      expect(await jobCount(RUNNING)).toBe(1);
    });

    it.each([
      ['a value that is not owner/repo', 'not a repository'],
      ['a full URL', 'https://github.com/anthropics/skills'],
      ['a path with a traversal segment', '../../etc/passwd'],
      ['an empty value', ''],
    ])('refuses %s, creating no row and making no request', async (_label, value) => {
      const state = await actions.submitRepo(initial, form(value));

      expect(state.status).toBe('error');
      expect(state.message).toContain('does not accept full URLs');
      expect(state.href).toBeUndefined();
      expect(contacted).toEqual([]);
      const [row] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM ingest_job WHERE target LIKE 'test-owner/actions-spec%'
      `;
      expect(row.n).toBe(0);
    });

    it('refuses a denylisted repository, creating no row', async () => {
      await sql`INSERT INTO repository_denylist (full_name, reason) VALUES (${BLOCKED}, 'test')`;

      const state = await actions.submitRepo(initial, form(BLOCKED));

      expect(state.status).toBe('error');
      expect(state.message).toContain('removed from AgentDock');
      expect(await jobCount(BLOCKED)).toBe(0);
      expect(contacted).toEqual([]);
    });
  });

  describe('requeueJob', () => {
    it('sends the caller to the job for that repository', async () => {
      const id = await seedQueued(ACTIVE);

      const thrown = await actions.requeueJob(form(ACTIVE)).catch((e) => e);

      expect(redirectTarget(thrown)).toBe(`/jobs/${id}`);
      expect(contacted).toEqual([]);
    });

    it('sends a value that is not owner/repo home, without touching the queue', async () => {
      const thrown = await actions.requeueJob(form('https://github.com/a/b')).catch((e) => e);

      expect(redirectTarget(thrown)).toBe('/');
      const [row] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM ingest_job WHERE target LIKE 'test-owner/actions-spec%'
      `;
      expect(row.n).toBe(0);
    });

    it('sends a denylisted repository home rather than minting a job for it', async () => {
      await sql`INSERT INTO repository_denylist (full_name, reason) VALUES (${BLOCKED}, 'test')`;

      const thrown = await actions.requeueJob(form(BLOCKED)).catch((e) => e);

      expect(redirectTarget(thrown)).toBe('/');
      expect(await jobCount(BLOCKED)).toBe(0);
    });
  });
});
