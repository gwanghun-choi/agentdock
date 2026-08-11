---
phase: AGD-02-durable-ingestion
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/db/schema.ts
  - drizzle/0002_*.sql
  - .drizzle-test/0002_*.sql
  - src/db/queries/jobs.ts
  - src/db/queries/jobs.test.ts
  - src/ingest/worker.ts
  - src/ingest/worker.test.ts
  - src/instrumentation.ts
  - src/env.ts
  - src/log.ts
  - src/app/actions.ts
  - src/app/jobs/[id]/page.tsx
  - src/components/PollUntilDone.tsx
  - scripts/verify-worker-boot.mjs
  - package.json
  - .env.example
  - README.md
autonomous: true
requirements: [JOB-01, JOB-04, JOB-06]

estimate:
  tokens: 85000
  raw_tokens: 85000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "Submitting a repository writes one row and returns a job id without waiting for GitHub"
    - "The worker starts from the server's own boot, with no second command and no service beyond PostgreSQL"
    - "Two workers claiming at the same moment take two different jobs, and neither blocks on the other"
    - "Submitting the same repository twice while the first is still queued or running returns the same job id"
    - "A job whose worker died is returned to the queue automatically, without a heartbeat table"
    - "A denylisted repository never becomes a row, and a flood of distinct repositories cannot fill the queue past a bound"
    - "A queued row seeded before the server starts reaches a terminal status with no HTTP request made"
  artifacts:
    - path: "src/db/schema.ts"
      provides: "ingest_job (narrow, UPDATE-hot) and ingest_attempt (append-only), with the partial unique index, the claim index and the running index"
      exports: ["ingestJob", "ingestAttempt"]
      min_lines: 220
    - path: "src/db/queries/jobs.ts"
      provides: "Enqueue with denylist and depth guards, one-statement claim, reaper, terminal write, and the two read queries the pages use"
      exports: ["enqueueJob", "claimJob", "reapAbandoned", "finishJob", "getJobView", "latestJobForTarget", "MAX_QUEUED"]
      min_lines: 150
    - path: "src/ingest/worker.ts"
      provides: "The poll loop, the reap cadence, the worker identity, and the mapping from an ingest result onto a terminal job state"
      exports: ["runWorker", "runJob", "REAP_AFTER_MS"]
      min_lines: 80
    - path: "src/app/jobs/[id]/page.tsx"
      provides: "A server-rendered job status page that a browser re-renders until the job is terminal"
      min_lines: 40
    - path: "scripts/verify-worker-boot.mjs"
      provides: "The runnable answer to whether register() fires at next start without a first request"
      min_lines: 50
  key_links:
    - from: "src/instrumentation.ts"
      to: "src/ingest/worker.ts"
      via: "the boot hook starts the loop without awaiting it, because register() must complete before the server is ready"
      pattern: "void runWorker()"
    - from: "src/app/actions.ts"
      to: "src/db/queries/jobs.ts"
      via: "the submit path writes a row and returns; it no longer calls the pipeline"
      pattern: "enqueueJob"
    - from: "src/ingest/worker.ts"
      to: "src/ingest/pipeline.ts"
      via: "the loop is the only caller of the pipeline; the pipeline itself is unchanged in this plan"
      pattern: "ingestRepository"
---

<objective>
Turn the submit path into a row and the row into work. One table pair, one claim
statement, one poll loop started from the server's own boot — and a thin path
that goes all the way from the form to a rendered terminal status, so the
architecture is proven end to end before anything is built on top of it.

Purpose: every durability property this phase needs already exists in
PostgreSQL. The risk is not capability, it is re-implementing atomicity in
TypeScript, and the one genuinely unknown is whether `register()` fires at
`next start` without a first request. Both are settled here, on the first
commit, rather than discovered after four plans have been built on the answer.

Output: `ingest_job` and `ingest_attempt` in a reviewed migration, the queue
queries, the worker, the boot wiring, an asynchronous submit, and a bare status
page. What runs inside the job is exactly what Phase 1 already ships — the
pipeline is not touched in this plan.

Honours the CONTEXT.md decisions that the worker is an in-process loop gated by
`INGEST_WORKER`, that there are two tables and not one, that `status` is `text`
rather than a Postgres enum, that retry never leaves `queued`, and that the
denylist is checked at enqueue as well as at execution.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/phases/AGD-02-durable-ingestion/CONTEXT.md
@src/db/schema.ts
@src/db/client.ts
@src/ingest/pipeline.ts
@src/ingest/errors.ts
@src/app/actions.ts
@src/instrumentation.ts
@src/log.ts
@src/github/scan.ts
</context>

<decisions_made_while_planning>

**1. The tracer is the whole path, not the whole feature.**

One task takes a submitted repository from the form to a rendered terminal
status through a real queue row. No counters, no retry, no short circuit, no
rate-limit gate — those are the following plans, and each one fills in a branch
rather than moving a boundary. What this proves on the first commit is the thing
that cannot be proven by reading: that the loop starts, claims, executes and
terminates without a second process.

**2. `finishJob` stays, even though plan 02-02 moves the success path inside the
artifact transaction.**

Five of the outcomes — denylisted, no artifacts, unreadable, unavailable, an
exhausted budget — never reach `persistScan` at all, so they have no artifact
transaction to ride inside. `finishJob` is what terminates those, permanently.
Plan 02-02 removes exactly one of its callers, not the function.

**3. The denylist check and the queue-depth guard live in `enqueueJob`, not in
the Server Action.**

The action is one caller. The seed loader in Phase 5 will be another. A guard
that lives in the caller is a guard the second caller forgets, and this one is
the only thing standing between an unauthenticated POST and a permanently
starved 60-per-hour budget.

**4. No `deduped` flag comes back from `enqueueJob`.**

Distinguishing "you just created this" from "this already existed" costs either a
transaction-id internal or a timestamp comparison, and buys one adjective. The
status page reads the row's own status and its requested time, which is the
same information from a source that cannot be wrong.

**5. The reap threshold is derived from the caps, not chosen.**

`CAPS.wallClockMs` bounds the file-reading stage and `REQUEST_TIMEOUT_MS` bounds
each individual call, so a legitimate ingest cannot exceed roughly 150 seconds.
The threshold is six times that, computed from those two constants rather than
written as a number — so a future cap change moves it instead of silently
invalidating it. That relationship is exactly what makes a heartbeat table
redundant.

**6. The boot-timing question gets a script, not an assumption.**

`register()` is documented as running once per server instance, is reported to
run more than once in dev, and is reported in older versions to be deferred
until a route is visited. The probe seeds a denylisted target so the whole path
executes and terminates without spending a single GitHub request, and it exits
non-zero if the row has not moved.

</decisions_made_while_planning>

<reference>

## Reference A — the two tables, appended to `src/db/schema.ts`

`smallint` must be added to the existing import list from `drizzle-orm/pg-core`.

```ts
/**
 * The queue. Deliberately narrow: every claim, every reap and every terminal
 * transition UPDATEs this row, so anything wide belongs in ingest_attempt
 * instead. A jsonb column here would turn the hottest UPDATE in the schema into
 * a non-HOT one and grow the claim index for no read that needs it.
 *
 * No `kind` column and no `priority` column. Phase 5's registry-sync jobs are a
 * different shape and a five-line migration away; guessing at their key now
 * costs the same migration and would be wrong.
 *
 * `status` is text with a comment rather than an enum or a CHECK, for the reason
 * already recorded on artifact_type above: widening a constrained type on a
 * populated table is a DROP, which this project's boundary scanner treats as
 * destructive. The union is enforced in TypeScript.
 */
export const ingestJob = agentdock.table(
  'ingest_job',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    // Always a validated `owner/repo` — normalizeRepo() runs before this row exists.
    target: text('target').notNull(),
    // queued | running | succeeded | failed
    status: text('status').notNull().default('queued'),
    attempts: smallint('attempts').notNull().default(0),
    // Both the retry backoff and the rate-limit reset schedule land here. This
    // column is the scheduler; there is no cron and no timer.
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    // Set on claim, cleared on reap and on terminal. This column IS the liveness
    // signal, which is why there is no heartbeat table.
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    workerId: text('worker_id'),
  },
  (t) => [
    // Dedupes duplicate submits AND makes the reaper's running->queued
    // transition collision-free, because the row never leaves this index.
    // Including 'running' in the predicate is what buys the second property.
    uniqueIndex('ingest_job_active_key')
      .on(t.target)
      .where(sql`${t.status} in ('queued','running')`),
    // The claim's only index. Partial, so it holds claimable rows and nothing else.
    index('ingest_job_claim_idx')
      .on(t.nextAttemptAt)
      .where(sql`${t.status} = 'queued'`),
    // The reaper's scan.
    index('ingest_job_running_idx').on(t.startedAt).where(sql`${t.status} = 'running'`),
  ],
);

/**
 * Append-only. One row per claim, written exactly once when the attempt ends.
 * Never updated, so it can be as wide as the status page needs — which is the
 * whole reason it is a second table.
 */
export const ingestAttempt = agentdock.table(
  'ingest_attempt',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    jobId: bigint('job_id', { mode: 'number' })
      .notNull()
      .references(() => ingestJob.id, { onDelete: 'cascade' }),
    attemptNo: smallint('attempt_no').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }).notNull().defaultNow(),

    // The IngestOutcome union, plus 'unchanged'. Not a free string: this value
    // is rendered and is filtered on.
    outcome: text('outcome').notNull(),
    // The reason a person reads. Drawn only from the outcome message table,
    // never from an exception's message.
    errorDetail: text('error_detail'),

    commitSha: text('commit_sha'),
    filesRead: integer('files_read').notNull().default(0),
    artifactsFound: integer('artifacts_found').notNull().default(0),
    artifactsNew: integer('artifacts_new').notNull().default(0),
    artifactsUpdated: integer('artifacts_updated').notNull().default(0),
    artifactsUnchanged: integer('artifacts_unchanged').notNull().default(0),
    artifactsRemoved: integer('artifacts_removed').notNull().default(0),
    parseFailed: integer('parse_failed').notNull().default(0),
    // True when the tree was cut short OR a file-read cap fired. Both are
    // indistinguishable to a reader and both mean the same thing: partial.
    truncated: boolean('truncated').notNull().default(false),

    rateRemaining: integer('rate_remaining'),
    rateReset: timestamp('rate_reset', { withTimezone: true }),
  },
  (t) => [index('ingest_attempt_job_idx').on(t.jobId, t.attemptNo.desc())],
);
```

## Reference B — `src/db/queries/jobs.ts`

```ts
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

/** `client` is a transaction only in the test that proves two claims do not collide. */
export async function claimJob(workerId: string, client = db): Promise<ClaimedJob | null> {
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
export async function reapAbandoned(afterMs: number, client = db): Promise<{ id: number }[]> {
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
```

## Reference C — `src/ingest/worker.ts`

```ts
import { randomUUID } from 'node:crypto';
import { type AttemptRecord, type ClaimedJob, claimJob, finishJob, reapAbandoned } from '@/db/queries/jobs';
import { REQUEST_TIMEOUT_MS } from '@/github/client';
import { CAPS } from '@/github/scan';
import { ingestRepository } from '@/ingest/pipeline';
import { log } from '@/log';

/**
 * Derived, not chosen. CAPS.wallClockMs bounds the whole file-reading stage and
 * REQUEST_TIMEOUT_MS bounds each of the three calls that bracket it, so a
 * legitimate ingest cannot exceed roughly 150 seconds. Six times that is what
 * makes a heartbeat table redundant — and computing it here means a future cap
 * change moves the threshold instead of quietly invalidating it.
 */
export const REAP_AFTER_MS = 6 * (CAPS.wallClockMs + 3 * REQUEST_TIMEOUT_MS);

const POLL_IDLE_MS = 2_000;
const REAP_EVERY_MS = 60_000;

/** Outcomes where the job did its work, whatever the answer turned out to be. */
const SUCCEEDED: ReadonlySet<string> = new Set(['ok', 'denylisted', 'no_artifacts']);

const WORKER_ID = `${process.pid}-${randomUUID().slice(0, 8)}`;

// register() is documented as running once per server instance and is reported
// to run more than once in dev. Two loops in one process is exactly the case
// SKIP LOCKED handles, so this guard is not a correctness control — it just
// stops the idle query rate doubling for no benefit.
let started = false;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runJob(job: ClaimedJob): Promise<void> {
  const startedAt = job.startedAt ?? new Date();
  const result = await ingestRepository(job.target);

  const record: AttemptRecord = {
    jobId: job.id,
    attemptNo: job.attempts,
    startedAt,
    outcome: result.ok ? 'ok' : result.outcome,
    errorDetail: result.ok ? null : result.message,
    commitSha: result.ok ? result.commitSha : null,
    filesRead: result.ok ? result.found : 0,
    artifactsFound: result.ok ? result.found : 0,
    artifactsNew: 0,
    artifactsUpdated: 0,
    artifactsUnchanged: 0,
    artifactsRemoved: 0,
    parseFailed: result.ok ? result.failed : 0,
    truncated: result.ok ? result.truncated : false,
    rateRemaining: null,
    rateReset: null,
  };

  await finishJob(record, SUCCEEDED.has(record.outcome) ? 'succeeded' : 'failed');
}

/**
 * Poll, claim, drain, sleep. The reap runs on the same loop rather than on a
 * second timer, because a second timer is a second thing that can be running
 * when the first one is not.
 */
export async function runWorker(signal?: AbortSignal): Promise<void> {
  if (started) return;
  started = true;
  log({ event: 'worker', state: 'started', jobId: null });

  let lastReap = 0;
  while (!signal?.aborted) {
    try {
      if (Date.now() - lastReap > REAP_EVERY_MS) {
        await reapAbandoned(REAP_AFTER_MS);
        lastReap = Date.now();
      }

      const job = await claimJob(WORKER_ID);
      if (!job) {
        await sleep(POLL_IDLE_MS);
        continue;
      }
      await runJob(job);
    } catch {
      // A database blip must not end the loop, and the exception must not be
      // logged: it can carry statement text. The row is still in the table.
      log({ event: 'worker', state: 'error', jobId: null });
      await sleep(POLL_IDLE_MS);
    }
  }
}
```

## Reference D — `src/log.ts`, extended with a second closed shape

```ts
type IngestLog = {
  event: 'ingest';
  owner: string;
  repo: string;
  commitSha: string | null;
  outcome: string;
  found: number;
  stored: number;
  failed: number;
  durationMs: number;
  rateRemaining: number | null;
};

/** The loop's own lifecycle. No message field, so there is nothing to interpolate into. */
type WorkerLog = {
  event: 'worker';
  state: 'started' | 'error';
  jobId: number | null;
};

/**
 * One line, one shape. The field set is closed on purpose: a free-form payload
 * parameter is how a response body, a header, or a connection string ends up in
 * a log file six months from now.
 */
export function log(entry: IngestLog | WorkerLog): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...entry }));
}
```

## Reference E — boot wiring, environment, and the asynchronous submit

```ts
// src/instrumentation.ts — appended to the existing register()
  if (process.env.INGEST_WORKER === '0') return;
  const { runWorker } = await import('@/ingest/worker');
  // Deliberately not awaited. register() must complete before the server is
  // ready to handle requests, and a poll loop never completes.
  void runWorker();
```

```ts
// src/env.ts — added to envSchema
  // Not a secret. '0' disables the in-process loop, which is the escape hatch
  // for the day an ingest measurably delays a page render.
  INGEST_WORKER: z.enum(['0', '1']).default('1'),
```

```ts
// src/app/actions.ts — the whole file
'use server';

import { enqueueJob } from '@/db/queries/jobs';
import { messageFor } from '@/ingest/errors';
import { normalizeRepo } from '@/github/client';

export type SubmitState = {
  status: 'idle' | 'ok' | 'error';
  message: string;
  href?: string;
  jobId?: number;
};

/**
 * A server function is reachable by a direct request, not only through the form
 * above it. Its validation is therefore a trust boundary, and it runs before a
 * row exists rather than after.
 *
 * It returns rather than redirects, for the reason recorded in Phase 1: a
 * redirect throws a control-flow exception that any wrapping catch swallows,
 * leaving a form that submitted and did not navigate.
 */
export async function submitRepo(_prev: SubmitState, formData: FormData): Promise<SubmitState> {
  const normalized = normalizeRepo(String(formData.get('repo') ?? ''));
  if (!normalized) return { status: 'error', message: messageFor('invalid_input') };

  const fullName = `${normalized.owner}/${normalized.repo}`;
  const result = await enqueueJob(fullName);

  if (result.kind === 'denylisted') {
    return { status: 'error', message: messageFor('denylisted') };
  }
  if (result.kind === 'flooded') {
    return {
      status: 'error',
      message:
        'AgentDock already has as many repositories waiting as it will hold. ' +
        'Try again once the queue has drained.',
    };
  }

  return {
    status: 'ok',
    message: `Queued as job ${result.id}.`,
    href: `/jobs/${result.id}`,
    jobId: result.id,
  };
}
```

There is no `revalidatePath` call and there must not be one. Every page that
reads this data is already `force-dynamic`, so no route cache entry exists to
invalidate — and the worker runs outside any request, where the function is not
callable at all.

## Reference F — the bare status page and its refresher

```tsx
// src/app/jobs/[id]/page.tsx
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { PollUntilDone } from '@/components/PollUntilDone';
import { getJobView } from '@/db/queries/jobs';

export const dynamic = 'force-dynamic';

// bigserial, so bounded above by the safe-integer range rather than by a guess.
const jobId = z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER);

type Props = { params: Promise<{ id: string }> };

export default async function JobPage({ params }: Props) {
  const parsed = jobId.safeParse((await params).id);
  if (!parsed.success) notFound();

  const job = await getJobView(parsed.data);
  if (!job) notFound();

  const done = job.status === 'succeeded' || job.status === 'failed';

  return (
    <>
      <h1>{job.target}</h1>
      <p className="lede">{job.status}</p>
      {job.attempt ? <p className="row-meta">{job.attempt.outcome}</p> : null}
      <PollUntilDone done={done} />
    </>
  );
}
```

```tsx
// src/components/PollUntilDone.tsx
'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Holds no data and renders nothing. The page is server-rendered and works with
 * JavaScript off; this only re-triggers that render while there is something
 * left to see.
 *
 * ponytail: router.refresh() rather than a JSON endpoint; add the endpoint the
 * day a non-browser client wants job status.
 */
export function PollUntilDone({ done }: { done: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (done) return;
    const timer = setInterval(() => router.refresh(), 1500);
    return () => clearInterval(timer);
  }, [done, router]);
  return null;
}
```

## Reference G — the boot probe, `scripts/verify-worker-boot.mjs`

The probe seeds a **denylisted** target, so the whole claim → execute → terminate
path runs and spends zero GitHub requests.

```js
#!/usr/bin/env node
// Answers one question with a run rather than a reading: does register() fire
// at `next start` without a first request? Seeds a queued job whose target is
// denylisted — so the pipeline refuses it before any network call — starts the
// server, makes no HTTP request, and asserts the row reached a terminal status.

import { spawn } from 'node:child_process';
import postgres from 'postgres';

const TARGET = 'test-owner/agentdock-boot-probe';
const WAIT_MS = 30_000;
const PORT = process.env.PROBE_PORT ?? '3123';

const sql = postgres(process.env.DATABASE_URL, {
  connection: { search_path: 'agentdock' },
  onnotice: () => {},
});

async function clean() {
  await sql`DELETE FROM ingest_job WHERE target = ${TARGET}`;
  await sql`DELETE FROM repository_denylist WHERE full_name = ${TARGET}`;
}

let server;
try {
  await clean();
  await sql`INSERT INTO repository_denylist (full_name, reason) VALUES (${TARGET}, 'boot probe')`;
  const [job] = await sql`
    INSERT INTO ingest_job (target) VALUES (${TARGET}) RETURNING id
  `;

  server = spawn('npx', ['next', 'start', '-p', PORT], {
    stdio: 'inherit',
    env: { ...process.env },
  });

  const deadline = Date.now() + WAIT_MS;
  let status = 'queued';
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1_000));
    const [row] = await sql`SELECT status FROM ingest_job WHERE id = ${job.id}`;
    status = row.status;
    if (status === 'succeeded' || status === 'failed') break;
  }

  if (status === 'succeeded' || status === 'failed') {
    console.log(`verify-worker-boot: OK — the job reached "${status}" with no HTTP request made.`);
  } else {
    console.error(
      `verify-worker-boot: the job is still "${status}" after ${WAIT_MS / 1000}s with no ` +
        'request served. register() does not fire at boot in this configuration — apply the ' +
        'fallback recorded in the plan.',
    );
    process.exitCode = 1;
  }
} finally {
  server?.kill('SIGTERM');
  await clean();
  await sql.end();
}
```

**The fallback, if the probe exits non-zero.** Add one line to `submitRepo` in
`src/app/actions.ts`, before the enqueue, and record in the summary that
`register()` is lazy in this configuration:

```ts
  // register() does not fire at boot here, so a submit — which is a request —
  // starts the loop. runWorker() is guarded against a second start.
  void import('@/ingest/worker').then((m) => m.runWorker());
```

</reference>

<tasks>

<task type="tracer">
  <name>Task 1: End-to-end — a submitted repository becomes a row, a claim, an ingest and a rendered status</name>
  <files>src/db/schema.ts, drizzle/0002_*.sql, .drizzle-test/0002_*.sql, src/db/queries/jobs.ts, src/ingest/worker.ts, src/instrumentation.ts, src/env.ts, src/log.ts, .env.example, src/app/actions.ts, src/app/jobs/[id]/page.tsx, src/components/PollUntilDone.tsx</files>
  <action>
    Wire one path through every layer this phase touches, and no second path.

    Append the two tables to `src/db/schema.ts` exactly as Reference A, adding
    `smallint` to the existing pg-core import list. Then run
    `bun run db:generate` and **read the emitted SQL before applying it** — that
    review is what the generate-review-migrate workflow exists for. Confirm four
    things in the generated file: every object is qualified to `agentdock`, no
    `DROP` of any kind appears, no `CREATE SCHEMA` statement appears (delete it
    if one does), and all four indexes are present with their `WHERE` clauses
    intact. Then `bun run db:migrate`, then `bun run db:test:setup` so the test
    schema carries the same two tables — without that step every database-backed
    test in the phase fails at once.

    One thing in the generated DDL is inferred rather than measured and must be
    checked at apply time: the partial index predicates may be emitted with
    schema-qualified column references. If PostgreSQL rejects any of the three
    `WHERE` clauses, rewrite them by hand in the migration to the bare-column
    form that was executed live during research — status in ('queued','running')
    for the unique index, status = 'queued' for the claim index, and
    status = 'running' for the running index — and record the edit in the
    summary. The `ON CONFLICT` inference does not depend on which form is used,
    because PostgreSQL proves implication rather than comparing text.

    Write `src/db/queries/jobs.ts` as Reference B. Three things in it are
    load-bearing and none is stylistic. The enqueue conflict clause is a
    deliberate no-op update rather than a do-nothing, because a do-nothing
    conflict produces no row for the returning clause and the handler would
    receive undefined on every duplicate — the comment in the reference says so
    and must survive into the code. The claim is one statement with its
    subquery locking and skipping locked rows, so two workers arbitrate in the
    database instead of in TypeScript. The reaper's predicate reads only
    `started_at`, and it does not reset `attempts`.

    Write `src/ingest/worker.ts` as Reference C. It calls the Phase 1 pipeline
    unchanged — this plan adds no argument to `ingestRepository` and edits
    neither `pipeline.ts` nor `persist.ts`. Note the loop's catch: it records a
    lifecycle line with no message field and sleeps, because an exception here
    can carry statement text and because a database blip must not end the loop.

    Extend `src/log.ts` as Reference D with the second closed shape. Wire
    `src/instrumentation.ts`, `src/env.ts` and `.env.example` as Reference E,
    documenting `INGEST_WORKER` in the example file as optional and defaulting
    to on. Replace `src/app/actions.ts` wholesale with Reference E's version —
    it validates, enqueues and returns, and it calls neither the pipeline nor
    `revalidatePath`. Add the bare status page and its refresher as Reference F.

    Do not build retry, backoff, a rate-limit gate, diff counters, or the
    commit-SHA short circuit. Each is a following plan and each fills in a
    branch of what this task establishes.
  </action>
  <verify>
    <automated>bun run check:boundaries &amp;&amp; bun run typecheck &amp;&amp; bun run lint &amp;&amp; bun run build</automated>
  </verify>
  <done>Both tables exist in `agentdock` and in `agentdock_test` via a reviewed migration containing no unqualified target and no destructive verb. Submitting a repository through the form returns a job id immediately, the loop claims and runs it, and `/jobs/{id}` renders a terminal status. `bun run build` passes.</done>
</task>

<task type="auto">
  <name>Task 2: Prove the arbitration — SKIP LOCKED, dedupe, reclaim, and the two enqueue guards</name>
  <files>src/db/queries/jobs.test.ts, src/ingest/worker.test.ts</files>
  <behavior>
    - Two claims running concurrently in two transactions return two different jobs, and the second does not block on the first.
    - A third claim against an empty queue returns nothing rather than waiting.
    - Enqueueing the same target twice while the first is still queued returns the same job id.
    - Enqueueing a target whose job is already running returns that same running job's id.
    - Enqueueing after the job reached a terminal status mints a new job with a different id.
    - A running job whose `started_at` is older than the threshold is returned to the queue, with `worker_id` cleared and `attempts` left alone.
    - A running job inside the threshold is left alone.
    - Enqueueing a denylisted target creates no row.
    - Enqueueing when the queued depth is at the cap creates no row.
    - The reap threshold is at least six times the longest runtime the caps permit.
  </behavior>
  <action>
    Write both suites following the conventions the existing database tests
    already set: assign the test schema before importing anything that reads it,
    guard the suite on the database URL rather than on the CI flag, and key
    every row on sentinel targets under `test-owner/` — vitest runs files in
    parallel against one test schema and the active-job index is unique on
    target, so two suites using a real repository name would collide.

    The concurrency case is the one that needs care and it needs exactly one
    timing pair. Open a transaction, claim inside it, hold for 300 ms, and start
    a second transaction 50 ms in so it lands inside that window. A local update
    completes in single-digit milliseconds, so the margin is six-fold rather
    than a race. Assert three things and no fewer: both claims returned a job,
    they returned different jobs, and the second one returned rather than
    blocking. Pass the transaction as the claim's client argument, which is the
    only reason that argument exists.

    The reclaim case backdates the row in SQL rather than moving a clock. The
    timestamps that matter are written by the database, so a TypeScript clock
    has no reach over them, and a fake timer only fights the driver.

    The threshold assertion is arithmetic against the two constants it is
    derived from, so a future cap change either keeps the relationship or fails
    here rather than silently making the reaper fire during a legitimate run.

    Do not start the poll loop in any test. Its parts are what is worth testing;
    the loop itself is a while and a sleep.
  </action>
  <verify>
    <automated>bun run test src/db/queries/jobs.test.ts src/ingest/worker.test.ts &amp;&amp; CI=1 bun run test src/db/queries/jobs.test.ts src/ingest/worker.test.ts</automated>
  </verify>
  <done>All ten behaviours pass against the test schema, and the same files skip visibly with no database URL rather than failing.</done>
</task>

<task type="auto">
  <name>Task 3: Answer the boot-timing question with a run, and record the answer</name>
  <files>scripts/verify-worker-boot.mjs, package.json, README.md, .env.example</files>
  <precondition>`DATABASE_URL` points at a database whose `agentdock` schema already carries the migration from Task 1, and port 3123 is free.</precondition>
  <action>
    Write `scripts/verify-worker-boot.mjs` as Reference G and add a
    `verify:worker` script for it. Do not add it to the `ci` script — it starts
    a server and needs a database, and CI has neither.

    The probe seeds a denylisted target on purpose. The pipeline refuses a
    denylisted repository before any request is made, so the whole claim,
    execute and terminate path runs for zero GitHub requests out of a
    sixty-per-hour budget. It makes no HTTP request to the server it starts,
    because the question is precisely whether the loop needs one.

    Run it. If it exits zero, record in the summary that the boot hook fires
    without a first request in this configuration, and change nothing else. If
    it exits non-zero, apply the one-line fallback shown at the end of Reference
    G to the submit action, run the probe again to confirm the failure is
    understood rather than papered over, and record both the failure and the
    fallback in the summary. Do not guess which branch applies.

    Document in `README.md`, beside the existing run instructions, that
    ingestion now happens in the background, that `INGEST_WORKER=0` turns the
    loop off, and that a job's progress is visible at its own page. Add
    `INGEST_WORKER` to `.env.example` with a placeholder and a one-line
    explanation, never a value that looks like a credential.
  </action>
  <verify>
    <automated>bun run build &amp;&amp; bun run verify:worker &amp;&amp; bun run ci</automated>
  </verify>
  <done>The probe ran and its result is recorded. A queued row seeded before boot reaches a terminal status with no HTTP request made, either natively or via the recorded one-line fallback. `bun run ci` passes and `README.md` documents the background worker and its off switch.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| submitted string → `ingest_job.target` | The action is reachable by a direct request, so the value that lands in a durable row must already be two validated components. |
| unauthenticated POST → a shared GitHub budget | Every enqueued row will eventually spend two of sixty hourly requests, on behalf of nobody in particular. |
| a dead worker → a stuck row | Nothing in the process can report its own death; the reclaim has to be observable from the table alone. |
| two workers → one job | Arbitration in application code is arbitration with a window in it. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-02-01 | Denial of Service | `enqueueJob` reached by an unauthenticated POST | high | mitigate | A queued-depth ceiling of 500 rejects the flood before the row is written; the partial unique index already caps duplicates of any one repository at one row. |
| T-02-02 | Tampering | `ingest_job.target` | high | mitigate | `normalizeRepo` runs in the Server Action before the insert, so the column holds validated components and never an arbitrary string; Drizzle parameterises the insert. |
| T-02-03 | Elevation of Privilege | the migration | critical | mitigate | Generated SQL is read before it is applied; the boundary scanner rejects an unqualified target, a foreign schema, and any destructive verb lacking a review marker. |
| T-02-04 | Repudiation | a repository removed from the index | medium | mitigate | The denylist is consulted at enqueue as well as at execution, and a denylisted target creates no row at all. |
| T-02-05 | Denial of Service | two workers claiming one job | medium | mitigate | Arbitration is a single statement whose subquery locks and skips locked rows; proven by two concurrent transactions taking two different jobs without blocking. |
| T-02-06 | Information Disclosure | the worker loop's exception handler | high | mitigate | The caught exception is discarded; the recorded line has a closed field set with no message field, so there is nowhere for statement text or a connection string to go. |
| T-02-07 | Denial of Service | a job that reliably kills its worker | medium | accept | The reaper deliberately does not reset `attempts`, so such a job burns attempts and stops being retried once plan 02-04 bounds them. |
</threat_model>

<verification>
1. The generated migration names only `agentdock`, qualifies every target, contains no `DROP` and no `CREATE SCHEMA`, and carries all four indexes with their predicates.
2. Both tables exist in `agentdock` and in `agentdock_test`.
3. Submitting a repository returns a job id without waiting for GitHub, and the page it links to renders that job.
4. The loop claims the row and runs the Phase 1 pipeline unchanged, and the job reaches a terminal status.
5. Two concurrent claims take two different jobs and neither blocks.
6. A duplicate submit returns the same job id; a submit after a terminal status mints a new one.
7. A backdated running job is returned to the queue with its attempt count untouched.
8. A denylisted target and a full queue each create no row.
9. The reap threshold is at least six times the longest runtime the caps permit, computed rather than written.
10. A queued row seeded before boot reaches a terminal status with no HTTP request made.
11. `bun run ci` passes, and the database-backed suites skip visibly with no database URL.
</verification>

<success_criteria>
- **JOB-01** — the submit path writes one row and returns a job id; the pipeline is no longer called from a request.
- **JOB-04** — a job abandoned by a dead worker returns to the queue on a `started_at` sweep, with no heartbeat table and a threshold derived from the caps that make one redundant.
- **JOB-06** — the queue, the arbitration, the dedupe and the reclaim are all PostgreSQL features; nothing is installed and no second process is required.
- ROADMAP criterion 1, first half — submitting returns immediately and there is a page to watch.
- ROADMAP criterion 3 — an abandoned job is picked up again automatically.
</success_criteria>

<output>
Create `.planning/phases/AGD-02-durable-ingestion/02-01-SUMMARY.md` when done.
Record: the exact index predicates the migration applied and whether the
schema-qualified form was accepted or rewritten; the result of the boot probe
and whether the fallback was applied; and the reap threshold the derivation
produced. Record no credential and no connection string.
</output>
