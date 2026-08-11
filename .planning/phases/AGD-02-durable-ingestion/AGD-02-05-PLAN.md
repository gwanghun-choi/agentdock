---
phase: AGD-02-durable-ingestion
plan: 05
type: execute
wave: 4
depends_on: ["02-03", "02-04"]
files_modified:
  - src/ingest/retry.ts
  - src/ingest/retry.test.ts
  - src/db/queries/jobs.ts
  - src/db/queries/jobs.test.ts
  - src/ingest/worker.ts
  - src/ingest/worker.test.ts
  - src/ingest/pipeline.ts
  - src/ingest/pipeline.test.ts
  - README.md
autonomous: true
requirements: [ING-08, JOB-05]

estimate:
  tokens: 60000
  raw_tokens: 60000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "A transient failure is tried again on a widening delay and then stops, rather than forever"
    - "A failure that will give the same answer next time is not tried again at all"
    - "Running out of GitHub budget defers the job to when the budget returns, and does not spend one of its attempts"
    - "A hostile or absent reset header cannot park a job further away than an hour"
    - "A retrying job stays queued, so a submission that arrives during its wait joins it rather than colliding with it"
    - "When the budget is nearly gone the loop stops claiming, so an empty budget produces one deferral rather than a wall of errors"
    - "A job that exhausted its attempts shows the reason it stored and can be started again"
  artifacts:
    - path: "src/ingest/retry.ts"
      provides: "The whole policy as pure functions: the delay curve, the per-outcome disposition, and the clamped reset schedule"
      exports: ["MAX_ATTEMPTS", "backoffMs", "dispositionFor", "rateLimitedUntil", "RATE_CLAMP_MS", "Disposition"]
      min_lines: 70
    - path: "src/ingest/retry.test.ts"
      provides: "The policy's proof, with no clock and no database, so it stays visible in CI"
      min_lines: 80
    - path: "src/db/queries/jobs.ts"
      provides: "The scheduling write, which returns a job to the queue without it ever leaving the active-job index"
      exports: ["scheduleRetry"]
      min_lines: 190
  key_links:
    - from: "src/ingest/worker.ts"
      to: "src/ingest/retry.ts"
      via: "the loop asks the policy what to do and never re-decides it inline"
      pattern: "dispositionFor"
    - from: "src/ingest/worker.ts"
      to: "src/github/client.ts"
      via: "the loop reads the rate figures the client already saw rather than spending a call to ask"
      pattern: "rateLimitState()"
    - from: "src/db/queries/jobs.ts"
      to: "src/db/schema.ts"
      via: "the scheduled column is the scheduler; there is no cron and no timer"
      pattern: "nextAttemptAt"
---

<objective>
Decide, once and in pure functions, what happens after each of the nine ways an
ingest can end — and make running out of GitHub budget a deferral rather than a
failure.

Purpose: on sixty requests an hour, retrying is not free and retrying the wrong
things is how a budget disappears. GitHub returns a byte-identical response for a
repository that is absent and one that is private, so retrying that answer burns
two requests to learn the same thing three times. Meanwhile the one condition
that genuinely resolves on its own — an exhausted budget — is the one that must
not consume a job's attempts, because a job that spends its retries waiting for a
clock fails permanently for a reason that was temporary.

Output: a policy module with no clock and no database in it, a scheduling write
that returns a job to the queue without it ever leaving the active-job index, and
a gate that stops the loop claiming when the budget is nearly gone.

Honours the CONTEXT.md decisions that retry never leaves `queued`, that
rate-limit exhaustion is scheduled rather than backed off, that its schedule is
clamped to one hour because the reset value is attacker-adjacent input, and that
the claim's attempt increment is undone for that case.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/phases/AGD-02-durable-ingestion/CONTEXT.md
@.planning/phases/AGD-02-durable-ingestion/AGD-02-01-PLAN.md
@.planning/phases/AGD-02-durable-ingestion/AGD-02-03-PLAN.md
@src/ingest/errors.ts
@src/ingest/pipeline.ts
@src/github/client.ts
@src/github/types.ts
</context>

<decisions_made_while_planning>

**1. An unreadable repository is not retried.**

GitHub answers a repository that does not exist and one that is private
identically, on purpose. The answer will not be different in sixty seconds, and
on a sixty-per-hour budget three attempts spend six requests to learn it three
times. It is terminal on the first attempt, and so is a repository past the size
cap, for the same reason: the tree will be the same size next time.

**2. An exhausted budget is scheduled, and refunds the attempt the claim spent.**

Waiting for a clock is not a failed attempt. If it consumed one, three quiet
hours of exhausted quota would permanently fail every queued repository — a
failure whose cause was time. The job goes back to the queue with its schedule
set from the reset header and its attempt count returned to what it was.

**3. The reset header is clamped to one hour, because it is a response header.**

It comes from the far side of the trust boundary. A malformed or hostile value
must not park a job in the next century, and GitHub's window is an hour, so an
hour from now is the correct ceiling. An absent value takes the ceiling too:
knowing nothing about when the budget returns is not a reason to guess early.

**4. Retry is modelled as staying queued, never as failed-then-requeued.**

The active-job index covers rows that are queued or running. A job that went to
failed and came back would have to re-enter that index, and if a submission for
the same repository arrived during the gap it would collide — a rare production
error that reproduces once a month. Staying queued means the row never leaves
the index and the collision cannot exist. The suite proves it by submitting the
same repository while its job sits waiting.

**5. The whole policy is pure, and the tests have no clock in them.**

The delay is a function of a number. The disposition is a lookup over the
outcome union. The schedule is a function of a header value and a reference time
passed in. None of them needs a fake timer, and the timestamps that actually
matter are written by the database anyway, where a TypeScript clock has no
reach — so the database tests backdate rows in SQL instead.

**6. No jitter.**

Jitter decorrelates many workers. There is one.

**7. The preemptive gate reads what the client already saw.**

The client records the rate figures from every response it receives, and asking
GitHub for them would itself be a request. Two comparisons and a module-level
number are the whole of "backs off before exhaustion", and keeping that number
in the process is correct: with one worker there is nothing to coordinate, and
persisting it would create a second source of truth about a fact the next
response restates.

</decisions_made_while_planning>

<reference>

## Reference A — `src/ingest/retry.ts`

```ts
import type { IngestOutcome } from './errors';

/** Two GitHub requests per attempt out of sixty an hour is what bounds this. */
export const MAX_ATTEMPTS = 3;

/** GitHub's own window, and therefore the furthest a job may ever be deferred. */
export const RATE_CLAMP_MS = 60 * 60 * 1000;

export type Disposition = 'succeeded' | 'terminal' | 'retryable' | 'rate_limited';

/**
 * Pure, so it is testable without a clock. Sixty seconds, then two minutes, then
 * four, capped at fifteen.
 */
export function backoffMs(attempts: number): number {
  return Math.min(60_000 * 2 ** (attempts - 1), 15 * 60_000);
}

/**
 * What happens after each way an ingest can end. Exhaustive over the outcome
 * union by construction, so adding a tenth outcome fails to compile until it is
 * classified here rather than defaulting to something.
 *
 * `denylisted` and `no_artifacts` are successes: the job did its work and the
 * answer is "no". Marking either a failure would put it in the retry path, where
 * every attempt produces the same answer.
 *
 * `unreadable` and `too_large` are terminal on the first attempt. GitHub returns
 * a byte-identical response for an absent repository and a private one, and a
 * tree past the size cap will be past it again.
 */
const DISPOSITION: Record<IngestOutcome, Disposition> = {
  ok: 'succeeded',
  denylisted: 'succeeded',
  no_artifacts: 'succeeded',
  invalid_input: 'terminal',
  unreadable: 'terminal',
  too_large: 'terminal',
  unavailable: 'retryable',
  storage_failed: 'retryable',
  rate_limited: 'rate_limited',
};

export function dispositionFor(outcome: IngestOutcome): Disposition {
  return DISPOSITION[outcome];
}

/**
 * When to try again after the budget ran out.
 *
 * The reset value is a response header — input from the far side of the trust
 * boundary — so it is clamped above at GitHub's own window and below at now. A
 * hostile value cannot park a job in the next century, and a stale one cannot
 * schedule it into the past.
 */
export function rateLimitedUntil(
  resetEpochSeconds: number | null | undefined,
  now: number = Date.now(),
): Date {
  const ceiling = now + RATE_CLAMP_MS;
  if (!resetEpochSeconds || !Number.isFinite(resetEpochSeconds)) return new Date(ceiling);
  return new Date(Math.min(Math.max(resetEpochSeconds * 1000, now), ceiling));
}
```

## Reference B — the scheduling write, added to `src/db/queries/jobs.ts`

```ts
/**
 * Returns a job to the queue with a time attached.
 *
 * The status stays `queued` throughout, which is not incidental: the active-job
 * index covers rows that are queued or running, so a job scheduled this way
 * never leaves that index and can never collide with a submission that arrives
 * during its wait. Modelling retry as failed-then-requeued would reintroduce
 * exactly that collision.
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
```

## Reference C — the worker's terminal branch, replacing the tracer's set lookup

```ts
export async function runJob(job: ClaimedJob): Promise<void> {
  const startedAt = job.startedAt ?? new Date();
  const result = await ingestRepository(job.target, {
    id: job.id,
    attemptNo: job.attempts,
    startedAt,
  });

  // A successful ingest — full or short-circuited — already terminated its own
  // job inside the transaction that wrote its artifacts.
  if (result.ok) return;

  const rate = rateLimitState();
  const record: AttemptRecord = {
    jobId: job.id,
    attemptNo: job.attempts,
    startedAt,
    outcome: result.outcome,
    // The only source this column ever has. Not an exception's message.
    errorDetail: result.message,
    commitSha: null,
    filesRead: 0,
    artifactsFound: 0,
    artifactsNew: 0,
    artifactsUpdated: 0,
    artifactsUnchanged: 0,
    artifactsRemoved: 0,
    parseFailed: 0,
    truncated: false,
    rateRemaining: rate?.remaining ?? null,
    rateReset: rate?.reset ? new Date(rate.reset * 1000) : null,
  };

  switch (dispositionFor(result.outcome)) {
    case 'succeeded':
      return finishJob(record, 'succeeded');

    case 'rate_limited': {
      const until = rateLimitedUntil(result.resetAt ?? rate?.reset ?? null);
      pausedUntil = until.getTime();
      return scheduleRetry(record, { nextAttemptAt: until, refundAttempt: true });
    }

    case 'retryable':
      if (job.attempts < MAX_ATTEMPTS) {
        return scheduleRetry(record, {
          nextAttemptAt: new Date(Date.now() + backoffMs(job.attempts)),
          refundAttempt: false,
        });
      }
      return finishJob(record, 'failed');

    case 'terminal':
      return finishJob(record, 'failed');
  }
}
```

## Reference D — the preemptive gate, in the loop

```ts
const PAUSED_POLL_MS = 5_000;

// Process-local on purpose. With one worker there is nothing to coordinate, and
// persisting it would be a second source of truth about a fact GitHub restates
// on every response.
let pausedUntil = 0;
```

```ts
      // An ingest costs two core requests, so fewer than two left means the next
      // claim would spend one only to discover the wall. Deferring one job is
      // not enough — this is what turns an empty budget into a single deferral
      // instead of a queue's worth of failures.
      const rate = rateLimitState();
      if (rate && rate.remaining < 2) {
        pausedUntil = rateLimitedUntil(rate.reset).getTime();
      }
      if (Date.now() < pausedUntil) {
        await sleep(PAUSED_POLL_MS);
        continue;
      }
```

## Reference E — the pipeline surfaces the reset it already reads

The catch block already extracts the reset value to build its message. The
failure branch of the result carries it out so the worker does not re-derive it.

```ts
  | { ok: false; outcome: IngestOutcome; message: string; resetAt?: number };
```

</reference>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: The whole policy, as functions with no clock and no database</name>
  <files>src/ingest/retry.ts, src/ingest/retry.test.ts</files>
  <behavior>
    - The delay is one minute at the first attempt, two at the second, four at the third.
    - The delay never exceeds fifteen minutes however many attempts have been made.
    - The delay never decreases as attempts rise.
    - Every value of the outcome union has a disposition, checked by iterating the union rather than by listing cases by hand.
    - A repository that could not be read, one past the size cap, and an invalid value are each terminal.
    - A repository that was removed, and one containing nothing, are each successes.
    - Only an unreachable GitHub and a storage failure are retryable.
    - An exhausted budget is its own disposition and is not among the retryable ones.
    - A reset an hour and a half away is clamped to an hour from the reference time.
    - A reset already in the past schedules at the reference time, not before it.
    - A missing, zero, or non-finite reset schedules an hour from the reference time.
  </behavior>
  <action>
    Write Reference A and its suite.

    Pass the reference time into the schedule function rather than reading the
    clock inside it. That is the entire reason the suite needs no fake timer, and
    a fake timer here would fight the database driver in every file that imports
    this one.

    Make the disposition table a total record over the outcome union rather than
    a switch with a default. A default is what lets a tenth outcome added in a
    later phase silently inherit a policy nobody chose for it; a total record
    fails to compile until somebody chooses.

    Drive the exhaustiveness test from the union itself so the suite cannot fall
    behind the type. Assert the clamp in both directions — a hostile far-future
    value and a stale past one — because the ceiling is the security control and
    the floor is the correctness one.

    Add no jitter. Jitter decorrelates many workers and there is one.
  </action>
  <verify>
    <automated>bun run test src/ingest/retry.test.ts &amp;&amp; CI=1 bun run test src/ingest/retry.test.ts &amp;&amp; bun run typecheck</automated>
  </verify>
  <done>All eleven policy behaviours pass with no clock and no database, and the suite runs and passes in CI.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Apply the policy — bounded retries, a refunded attempt, and a job that never leaves the queue</name>
  <files>src/db/queries/jobs.ts, src/db/queries/jobs.test.ts, src/ingest/worker.ts, src/ingest/worker.test.ts, src/ingest/pipeline.ts</files>
  <behavior>
    - A retryable failure below the ceiling leaves the job queued with a future scheduled time and its attempt count incremented.
    - A retryable failure at the ceiling leaves the job failed, with the stored reason readable.
    - A terminal failure leaves the job failed on the first attempt, with no scheduled time in the future.
    - An exhausted budget leaves the job queued, scheduled at the reset, with its attempt count back to what it was before the claim.
    - An exhausted budget carrying a reset a year away schedules within an hour.
    - Every one of those paths writes exactly one attempt row, carrying the outcome and the rate figures.
    - The claim does not return a job whose scheduled time is in the future.
    - Submitting the same repository while its job sits waiting returns that same job's id and raises no constraint violation.
  </behavior>
  <action>
    Apply References B, C and E.

    The last behaviour is the one to write first, because it is the failure this
    design exists to prevent rather than a property of it. A job scheduled for a
    later attempt is still queued, so it is still in the active-job index, so a
    submission arriving during its wait finds it and joins it. Had retry been
    modelled as failed-then-requeued, that submission would create a second row
    and the requeue would then violate the index — rarely, and in production.

    The refund is the second. Assert the attempt count before the claim and after
    the deferral and require them equal, rather than merely requiring the job to
    be queued. Requiring only the status would pass while the count crept upward
    on every hour of exhausted budget until the job failed permanently.

    Stub the exhausted-budget response rather than provoking a real one.
    Reproducing it live would spend the whole hourly budget, and it is the header
    semantics the classification reads.

    Backdate and set scheduled times directly in SQL. The timestamps that matter
    are written by the database, so a TypeScript clock cannot move them.

    Keep the pipeline change to the one field. The catch block already extracts
    the reset value to build its message; carrying it out on the result is what
    stops the worker deriving the same fact a second way.
  </action>
  <verify>
    <automated>bun run test src/db/queries/jobs.test.ts src/ingest/worker.test.ts &amp;&amp; bun run typecheck &amp;&amp; bun run check:boundaries</automated>
  </verify>
  <done>All eight behaviours pass. A deferred job is queued with its attempt count restored, a hostile reset is clamped inside an hour, and a submission arriving during a wait joins the existing job without a constraint violation.</done>
</task>

<task type="auto">
  <name>Task 3: Stop claiming before the budget is gone, and close the phase</name>
  <files>src/ingest/worker.ts, src/ingest/worker.test.ts, src/ingest/pipeline.test.ts, README.md</files>
  <behavior>
    - With fewer than two requests left in the recorded budget, the loop defers instead of claiming.
    - Once the recorded reset has passed, claiming resumes without any restart.
    - An exhausted-budget response still surfaces its reset value on the ingest result.
  </behavior>
  <action>
    Apply Reference D.

    Deferring one job is not what the criterion asks for. If the budget is gone,
    every queued job hits the same wall and each claim spends a request to
    discover it — which is precisely the wall of errors the criterion names. The
    gate reads the figures the client already recorded from its last response,
    so it costs no request, and it is checked before the claim rather than after
    the failure.

    Keep the paused-until value in the process. There is one worker, so there is
    nothing to coordinate, and writing it to a table would create a second source
    of truth about something the next response restates.

    Then run the phase gate in full and in order: install from the lockfile,
    build, and the whole check suite. Then run the suite once more with the CI
    flag set, which reproduces the runner exactly and proves the four
    database-free suites — the outcome table, the policy, the log line and the
    job panel — stand on their own rather than passing only where a database
    happens to exist.

    Finish the README section this phase owes: that ingestion runs in the
    background, that the off switch exists and what it costs, that a repository
    is read at most three times before it stops being tried, and that an
    exhausted budget defers rather than fails. Write no value that looks like a
    credential.
  </action>
  <verify>
    <automated>bun install --frozen-lockfile &amp;&amp; bun run build &amp;&amp; bun run ci &amp;&amp; CI=1 bun run test</automated>
  </verify>
  <done>The loop defers instead of claiming when fewer than two requests remain and resumes once the reset passes. The full verification order passes, and the database-free suites pass with the CI flag set. The README documents the background worker, its off switch, the attempt ceiling and the budget deferral.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| the rate-limit reset header → a stored schedule | A response header decides how long a durable row waits, which makes it input rather than fact. |
| a repeatedly failing job → a shared request budget | Every attempt spends two of sixty hourly requests on behalf of one repository. |
| a job re-entering the queue → the active-job index | Any transition that leaves and re-enters a unique index is a collision waiting for a concurrent write. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-02-23 | Tampering | the reset header driving the schedule | high | mitigate | Clamped above at GitHub's own one-hour window and below at the reference time; asserted in both directions, including a value a year out. |
| T-02-24 | Denial of Service | a job that always fails re-spending the budget | high | mitigate | Three attempts at most, and the two outcomes that will give the same answer next time are terminal on the first; the retryable set is only an unreachable GitHub and a storage failure. |
| T-02-25 | Denial of Service | an empty budget producing a failure per queued job | high | mitigate | The loop defers before claiming when fewer than two requests remain, so an empty budget costs one deferral rather than one failed attempt per job. |
| T-02-26 | Tampering | a retrying job colliding with a concurrent submission | medium | mitigate | A retry never leaves the queued status, so the row never leaves the active-job index; a submission arriving during a wait joins it, asserted in the suite. |
| T-02-27 | Denial of Service | a job exhausting its retries while waiting for a clock | medium | mitigate | The deferral refunds the attempt the claim spent, asserted by comparing the count before and after rather than by checking the status alone. |
| T-02-28 | Information Disclosure | the stored reason on a failed attempt | high | mitigate | Written from the pipeline's outcome message and from nothing else; the outcome message table interpolates no exception, hostname, query or credential, which the outcome suite asserts. |
</threat_model>

<verification>
1. The delay curve is one, two and four minutes, capped at fifteen and never decreasing.
2. Every outcome in the union has a disposition, driven from the union itself.
3. An unreadable repository and one past the size cap are terminal on the first attempt.
4. A retryable failure below the ceiling leaves the job queued with a future schedule; at the ceiling it leaves it failed with a readable reason.
5. An exhausted budget leaves the job queued, scheduled at the reset, with its attempt count restored.
6. A reset a year away schedules within an hour; a stale reset schedules no earlier than now.
7. The claim skips a job whose scheduled time is in the future.
8. A submission arriving while a job waits returns that job's id and raises no constraint violation.
9. With fewer than two requests recorded as remaining, the loop defers rather than claiming, and resumes once the reset passes.
10. `bun install --frozen-lockfile`, `bun run build`, `bun run ci` and `CI=1 bun run test` all pass, in that order.
</verification>

<success_criteria>
- **ING-08** — the recorded rate-limit headers are read before every claim and the loop backs off before exhaustion rather than after it, at the cost of one module-level number and no extra request.
- **JOB-05** — a failed job records a readable reason drawn only from the fixed message table, and starting it again needs no retry-specific path because a terminal job has left the active-job index.
- ROADMAP criterion 5 — a failed job shows a readable reason and can be retried.
- ROADMAP criterion 6 — approaching the rate limit causes backoff rather than a wall of errors, with the empty-budget case producing one deferral rather than one failure per queued job.
- Phase gate: `bun install --frozen-lockfile`, then `bun run build`, then `bun run ci`, then the same suite under the CI flag.
</success_criteria>

<output>
Create `.planning/phases/AGD-02-durable-ingestion/02-05-SUMMARY.md` when done.
Record: the delay values the curve produced, the disposition assigned to each of
the nine outcomes, the schedule a year-away reset was clamped to, and the attempt
count observed before and after a deferral. Record the final state of the phase
gate. Record no credential.
</output>
