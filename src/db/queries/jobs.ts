import { and, desc, eq, lte, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { ingestAttempt, ingestJob, repositoryDenylist } from '@/db/schema';

/**
 * Submit is unauthenticated and now writes a durable row that consumes a shared
 * 60-per-hour budget. The partial unique index already caps duplicates of one
 * repository at one row; this caps distinct repositories. Generous on purpose —
 * it is a flood ceiling, not a policy.
 */
export const MAX_QUEUED = 500;

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export type EnqueueResult =
  | { kind: 'queued'; id: number }
  | { kind: 'denylisted' }
  | { kind: 'flooded' };

export type ClaimedJob = {
  id: number;
  target: string;
  attempts: number;
  startedAt: Date | null;
};

/**
 * Writes the row, or explains why it will not.
 *
 * The denylist is checked here as well as inside the pipeline. Here it means a
 * removed repository never becomes a row a maintainer has to look at; there it
 * is the durable guarantee, because the list can change between the two moments.
 */
export async function enqueueJob(fullName: string): Promise<EnqueueResult> {
  const [blocked] = await db
    .select({ fullName: repositoryDenylist.fullName })
    .from(repositoryDenylist)
    .where(eq(repositoryDenylist.fullName, fullName.toLowerCase()))
    .limit(1);
  if (blocked) return { kind: 'denylisted' };

  const [depth] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(ingestJob)
    .where(eq(ingestJob.status, 'queued'));
  if ((depth?.n ?? 0) >= MAX_QUEUED) return { kind: 'flooded' };

  const [row] = await db
    .insert(ingestJob)
    .values({ target: fullName })
    .onConflictDoUpdate({
      target: ingestJob.target,
      targetWhere: sql`${ingestJob.status} in ('queued','running')`,
      // A deliberate no-op, and it must stay one. ON CONFLICT DO NOTHING with a
      // RETURNING clause returns zero rows, so the same handler written that way
      // silently receives undefined and has no job id to send anyone to.
      set: { target: sql`excluded.target` },
    })
    .returning({ id: ingestJob.id });

  return { kind: 'queued', id: row.id };
}

// Built once. A SELECT followed by an UPDATE has a window between them in which
// a second worker reads the same row; closing it with a held transaction trades
// that window for a lock nothing but a TCP timeout will release if the worker
// dies. One statement has neither problem.
const claimable = db
  .select({ id: ingestJob.id })
  .from(ingestJob)
  .where(and(eq(ingestJob.status, 'queued'), lte(ingestJob.nextAttemptAt, sql`now()`)))
  .orderBy(ingestJob.nextAttemptAt, ingestJob.id)
  .limit(1)
  .for('update', { skipLocked: true });

/**
 * The one method the two queue statements below need.
 *
 * Typed as a subset rather than as `typeof db`, because a transaction is not
 * assignable to the full handle — it carries no `$client` — and passing a
 * transaction is the entire reason the parameter exists.
 */
type Executor = Pick<typeof db, 'update'>;

/** `client` is a transaction only in the test that proves two claims do not collide. */
export async function claimJob(
  workerId: string,
  client: Executor = db,
): Promise<ClaimedJob | null> {
  const [job] = await client
    .update(ingestJob)
    .set({
      status: 'running',
      startedAt: sql`now()`,
      attempts: sql`${ingestJob.attempts} + 1`,
      workerId,
    })
    .where(eq(ingestJob.id, sql`(${claimable.getSQL()})`))
    .returning({
      id: ingestJob.id,
      target: ingestJob.target,
      attempts: ingestJob.attempts,
      startedAt: ingestJob.startedAt,
    });
  return job ?? null;
}

/**
 * Returns a job whose worker is gone. `attempts` is deliberately not reset: an
 * abandoned job burns an attempt, because a job that reliably kills its worker
 * must eventually stop being retried.
 */
export async function reapAbandoned(
  afterMs: number,
  client: Executor = db,
): Promise<{ id: number }[]> {
  return client
    .update(ingestJob)
    .set({ status: 'queued', startedAt: null, workerId: null })
    .where(
      and(
        eq(ingestJob.status, 'running'),
        sql`${ingestJob.startedAt} < now() - (${`${afterMs} milliseconds`}::interval)`,
      ),
    )
    .returning({ id: ingestJob.id });
}

export type AttemptRecord = {
  jobId: number;
  attemptNo: number;
  startedAt: Date;
  outcome: string;
  errorDetail: string | null;
  commitSha: string | null;
  filesRead: number;
  artifactsFound: number;
  artifactsNew: number;
  artifactsUpdated: number;
  artifactsUnchanged: number;
  artifactsRemoved: number;
  parseFailed: number;
  truncated: boolean;
  rateRemaining: number | null;
  rateReset: Date | null;
};

/**
 * Terminates a job that never opened the artifact transaction — a denylisted
 * repository, one with nothing in it, one that could not be read. Plan 02-02
 * moves the success path inside `persistScan`'s transaction; every path listed
 * above still ends here, permanently.
 */
export async function finishJob(record: AttemptRecord, status: JobStatus): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(ingestAttempt).values(record);
    await tx
      .update(ingestJob)
      .set({ status, finishedAt: sql`now()`, startedAt: null, workerId: null })
      .where(eq(ingestJob.id, record.jobId));
  });
}

/**
 * Returns a job to the queue with a time attached.
 *
 * The status stays `queued` throughout, which is not incidental: the active-job
 * index covers rows that are queued or running, so a job scheduled this way
 * never leaves that index and can never collide with a submission that arrives
 * during its wait. Modelling retry as failed-then-requeued would reintroduce
 * exactly that collision — rarely, and in production.
 */
export async function scheduleRetry(
  record: AttemptRecord,
  options: { nextAttemptAt: Date; refundAttempt: boolean },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(ingestAttempt).values(record);
    await tx
      .update(ingestJob)
      .set({
        status: 'queued',
        nextAttemptAt: options.nextAttemptAt,
        startedAt: null,
        workerId: null,
        // Waiting for a clock is not a failed attempt. Without this refund,
        // three quiet hours of exhausted budget would permanently fail every
        // queued repository for a reason that was temporary.
        ...(options.refundAttempt ? { attempts: sql`${ingestJob.attempts} - 1` } : {}),
      })
      .where(eq(ingestJob.id, record.jobId));
  });
}

export type JobView = {
  id: number;
  target: string;
  status: string;
  attempts: number;
  requestedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  nextAttemptAt: Date;
  attempt: typeof ingestAttempt.$inferSelect | null;
};

/** Two indexed reads rather than a join, because the page renders both rows whole. */
export async function getJobView(id: number): Promise<JobView | null> {
  const [job] = await db.select().from(ingestJob).where(eq(ingestJob.id, id)).limit(1);
  if (!job) return null;
  const [attempt] = await db
    .select()
    .from(ingestAttempt)
    .where(eq(ingestAttempt.jobId, id))
    .orderBy(desc(ingestAttempt.attemptNo))
    .limit(1);
  return { ...job, attempt: attempt ?? null };
}

/** What the repository page shows when it wants to say what AgentDock is doing about it. */
export async function latestJobForTarget(fullName: string): Promise<JobView | null> {
  const [job] = await db
    .select({ id: ingestJob.id })
    .from(ingestJob)
    .where(sql`lower(${ingestJob.target}) = ${fullName.toLowerCase()}`)
    .orderBy(desc(ingestJob.id))
    .limit(1);
  return job ? getJobView(job.id) : null;
}
