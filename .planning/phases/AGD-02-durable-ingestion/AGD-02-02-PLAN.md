---
phase: AGD-02-durable-ingestion
plan: 02
type: execute
wave: 2
depends_on: ["02-01"]
files_modified:
  - src/ingest/persist.ts
  - src/ingest/persist.test.ts
  - src/ingest/pipeline.ts
  - src/ingest/pipeline.test.ts
  - src/ingest/errors.ts
  - src/ingest/worker.ts
autonomous: true
requirements: [JOB-03, JOB-02, ING-13]

estimate:
  tokens: 70000
  raw_tokens: 70000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "A scan that read only part of a repository never marks the unread artifacts as removed"
    - "A repository over the file cap keeps every package it had, and says the listing is partial"
    - "Re-indexing an unchanged repository reports what it actually did: N discovered, 0 new, 0 updated, N unchanged"
    - "An artifact that reappears at the same path revives its original row and reads as updated, not as new"
    - "Killing the process between the artifact writes and the job's terminal state is impossible, because they are one commit"
    - "A storage failure leaves the previously visible index exactly as it was and leaves the job reclaimable"
    - "Discovered always equals new plus updated plus unchanged"
  artifacts:
    - path: "src/ingest/persist.ts"
      provides: "One transaction carrying the truncation guard, the diff classification, the attempt row and the job's terminal state"
      exports: ["persistScan", "PersistResult", "DiffCounters", "JobContext"]
      min_lines: 200
    - path: "src/ingest/persist.test.ts"
      provides: "The truncation regression, the four counters, the revival case, and the one-commit and rollback proofs"
      min_lines: 200
    - path: "src/ingest/pipeline.ts"
      provides: "The job context threaded through to the transaction, and the counters carried out to the caller"
      exports: ["ingestRepository", "IngestResult"]
      min_lines: 100
  key_links:
    - from: "src/ingest/pipeline.ts"
      to: "src/ingest/persist.ts"
      via: "the job context is passed down so the terminal state commits with the artifacts rather than after them"
      pattern: "persistScan(scan, job)"
    - from: "src/ingest/persist.ts"
      to: "src/db/schema.ts"
      via: "the attempt row and the job update are the last two statements of the existing transaction"
      pattern: "ingestAttempt"
    - from: "src/ingest/worker.ts"
      to: "src/db/queries/jobs.ts"
      via: "finishJob now terminates only the paths that never opened the artifact transaction"
      pattern: "finishJob"
---

<objective>
Close the window between the artifacts landing and the job saying so, fix the
live bug that lets a partial read delete real artifacts, and replace a count
that reads as new writes with a breakdown that says what happened.

Purpose: this is the plan that earns ROADMAP criterion 2. The criterion exists
to prevent a failure that is in the code today — the delisting predicate is
driven by the artifacts that survived the read caps, so a repository over the
two-hundred-file cap marks the rest removed and they disappear from the site.
A transient failure on ten files removes ten skills. Nothing else in this phase
matters if a run can still do that.

Output: `persistScan` takes a job, skips the delisting step on an incomplete
scan, classifies every artifact it wrote against what was there before, and ends
with the attempt row and the job's terminal state inside the transaction it
already had.

Honours the CONTEXT.md decisions that a partial read is never treated as an
authoritative deletion, that the re-index wording becomes an explicit breakdown,
and that a failed run must never destroy the previously visible index.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/phases/AGD-02-durable-ingestion/CONTEXT.md
@.planning/phases/AGD-02-durable-ingestion/AGD-02-01-PLAN.md
@src/ingest/persist.ts
@src/ingest/pipeline.ts
@src/ingest/types.ts
@src/ingest/errors.ts
@src/db/schema.ts
@src/github/scan.ts
</context>

<decisions_made_while_planning>

**1. The truncation guard is its own task with its own regression test.**

It is three lines and a comment, and it is the single most consequential change
in the phase. Folding it into the counters task would bury it in a diff about
arithmetic. It ships first, alone, with a test that fails against the current
code.

**2. The classification uses one extra indexed SELECT, not the row-version
trick.**

Returning whether a tuple was freshly inserted by comparing a transaction-id
internal is shorter and it works. It is also an implementation detail that is
not part of PostgreSQL's contract and reads as magic at three in the morning.
One indexed read of a few dozen rows per repository is not a cost worth that.

**3. A revived artifact counts as updated.**

A file that returns at the same path is the same package row with the same id,
the same permalink and its full version history — the existing upsert already
clears the tombstone, so no un-delete code exists or should. Counting it as new
would claim AgentDock discovered something it had all along; counting it as
unchanged would hide that the listing changed. The classification therefore
reads three facts: whether the key existed at all, whether it was tombstoned,
and whether a version row was minted.

**4. `persistScan`'s job parameter is optional.**

The existing suite persists scans with no queue involved, and so will any future
caller that is not the worker. An optional parameter keeps both true without a
second function that would drift.

**5. One invariant governs which terminal path a job takes.**

A successful ingest terminates inside the artifact transaction. Every other
outcome — denylisted, nothing found, unreadable, unreachable, an exhausted
budget, a storage failure — never opened that transaction, so it terminates in
the worker through `finishJob`. Stating it that way is what stops a job being
written twice, and it is the reason a rolled-back transaction leaves the job
`running` and therefore reclaimable rather than falsely `succeeded`.

**6. `parse_failed` is counted where the counters are assembled.**

The pipeline already tracks a failure count, but deriving it inside the
transaction from the scan being written keeps every number on the attempt row
consistent with every other number on the same row.

</decisions_made_while_planning>

<reference>

## Reference A — the guard, verbatim

The current predicate is driven by `packageIds`, which holds only artifacts whose
file was actually read. `fetchRepoScanInputs` drops files on three separate
paths — past the file cap, past the wall clock, and on a read that threw — and
each merely appends to `skipped`. `treeTruncated` is already
`tree.truncated || artifactsTruncated`, and `artifactsTruncated` is
`skipped.length > 0`, so the flag already carries exactly the right meaning and
no new plumbing is needed.

```ts
    // A partial read is not evidence of absence. Delisting from an incomplete
    // scan removes artifacts because a cap fired, which is the one way a failed
    // ingest can destroy the previously visible index.
    const delisted = scan.treeTruncated
      ? []
      : await tx
          .update(packageTable)
          .set({ delistedAt: sql`now()`, updatedAt: sql`now()` })
          .where(
            and(
              eq(packageTable.repositoryId, repo.id),
              isNull(packageTable.delistedAt),
              packageIds.length > 0 ? not(inArray(packageTable.id, packageIds)) : sql`true`,
            ),
          )
          .returning({ id: packageTable.id });
```

## Reference B — the counters, and the shape they leave in

```ts
/** What one run did to a repository's listing, in one pass over what it wrote. */
export type DiffCounters = {
  discovered: number;
  new: number;
  updated: number;
  unchanged: number;
  removed: number;
  parseFailed: number;
};

/** Everything the transaction needs to terminate the job it is running under. */
export type JobContext = {
  id: number;
  attemptNo: number;
  startedAt: Date;
  rateRemaining: number | null;
};

export type PersistResult = {
  repositoryId: number;
  packageIds: number[];
  newVersions: number;
  delisted: number;
  counters: DiffCounters;
};
```

The classification, placed immediately after the repository upsert — the
repository id does not exist before it:

```ts
    // What the listing held before this run. One indexed read of a few dozen
    // rows, which is the whole cost of an honest counter breakdown.
    const before = await tx
      .select({
        type: packageTable.type,
        sourcePath: packageTable.sourcePath,
        delistedAt: packageTable.delistedAt,
      })
      .from(packageTable)
      .where(eq(packageTable.repositoryId, repo.id));

    const key = (type: string, sourcePath: string) => `${type} ${sourcePath}`;
    const prior = new Map(before.map((r) => [key(r.type, r.sourcePath), r.delistedAt]));
```

And inside the existing per-package loop, after the version insert whose length
is already computed:

```ts
      const k = key(found.type, found.sourcePath);
      const seenBefore = prior.has(k);
      // The upsert's conflict branch already cleared the tombstone, so this is
      // read from the snapshot taken before the loop, not from the row.
      const wasDelisted = seenBefore && prior.get(k) !== null;

      if (!seenBefore) counters.new += 1;
      else if (inserted.length > 0 || wasDelisted) counters.updated += 1;
      else counters.unchanged += 1;
```

Assembled after the delisting step:

```ts
    const counters: DiffCounters = {
      discovered: scan.packages.length,
      new: newCount,
      updated: updatedCount,
      unchanged: unchangedCount,
      removed: delisted.length,
      parseFailed: scan.packages.filter((p) => p.parseStatus === 'failed').length,
    };
```

## Reference C — the last two statements of the transaction

```ts
    if (job) {
      await tx.insert(ingestAttempt).values({
        jobId: job.id,
        attemptNo: job.attemptNo,
        startedAt: job.startedAt,
        outcome: 'ok',
        errorDetail: null,
        commitSha: scan.commitSha,
        filesRead: scan.packages.length,
        artifactsFound: counters.discovered,
        artifactsNew: counters.new,
        artifactsUpdated: counters.updated,
        artifactsUnchanged: counters.unchanged,
        artifactsRemoved: counters.removed,
        parseFailed: counters.parseFailed,
        truncated: scan.treeTruncated,
        rateRemaining: job.rateRemaining,
        rateReset: null,
      });

      // The last statement, deliberately. There is now no window in which the
      // artifacts are committed and the job still reads as running — and if
      // anything above throws, the job stays running and the reaper reclaims it
      // rather than a half-written state being reported as finished.
      await tx
        .update(ingestJob)
        .set({ status: 'succeeded', finishedAt: sql`now()`, startedAt: null, workerId: null })
        .where(eq(ingestJob.id, job.id));
    }
```

## Reference D — the pipeline's new shape

```ts
export type IngestResult =
  | {
      ok: true;
      owner: string;
      repo: string;
      fullName: string;
      commitSha: string;
      found: number;
      stored: number;
      failed: number;
      truncated: boolean;
      counters: DiffCounters;
    }
  | { ok: false; outcome: IngestOutcome; message: string };

export async function ingestRepository(
  input: string,
  job?: Omit<JobContext, 'rateRemaining'>,
): Promise<IngestResult>;
```

The pipeline supplies the rate figure it already reads for its log line, so the
transaction never reaches into the GitHub client:

```ts
    const persisted = await persistScan(
      scan,
      job ? { ...job, rateRemaining: rateLimitState()?.remaining ?? null } : undefined,
    );
```

## Reference E — `src/ingest/errors.ts`, three added lines

```ts
/**
 * What an attempt row can record. Every ingestion outcome, plus the no-change
 * short circuit, which is a true answer about a repository rather than a
 * failure of one.
 */
export type AttemptOutcome = IngestOutcome | 'unchanged';
```

## Reference F — the worker's one changed line

```ts
  const result = await ingestRepository(job.target, {
    id: job.id,
    attemptNo: job.attempts,
    startedAt,
  });

  // A successful ingest already terminated the job inside the same transaction
  // that wrote its artifacts. Every other outcome never opened that
  // transaction, so it terminates here.
  if (result.ok) return;
```

</reference>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: A partial read stops deleting artifacts</name>
  <files>src/ingest/persist.ts, src/ingest/persist.test.ts</files>
  <behavior>
    - A scan whose truncation flag is set, and which carries fewer artifacts than the repository already had, leaves every existing package live.
    - The same scan with the flag clear still marks the missing artifacts as removed, so the guard has not simply disabled delisting.
    - A truncated scan still upserts the artifacts it did read, and still mints versions for changed content.
    - The reported removal count is zero on a truncated scan.
  </behavior>
  <action>
    Write the failing test first, against the current code, and watch it fail —
    that failure is the bug this phase exists to close and the summary should
    record that it reproduced.

    Then apply Reference A. The flag it reads is set when the tree itself was
    cut short or when a file-read cap fired, and both mean the same thing to
    whoever reads the page: this listing is incomplete. An incomplete listing is
    not evidence that anything was deleted upstream.

    Keep the delisting inside the transaction where it already is. The comment
    already in the file explains why, and that reasoning is unchanged: doing it
    first leaves a window in which a live artifact reads as removed, and doing it
    in a separate transaction leaves that window open permanently on a crash.

    Change nothing else in this task. The counters and the job's terminal state
    are the two tasks after it, and the point of shipping this one alone is that
    its diff is readable.
  </action>
  <verify>
    <automated>bun run test src/ingest/persist.test.ts &amp;&amp; bun run typecheck</automated>
  </verify>
  <done>A truncated scan carrying a subset of a repository's artifacts leaves all of them live and reports zero removals; the same scan untruncated still removes them. The regression test failed before the change and passes after it.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Say what the run actually did — discovered, new, updated, unchanged, removed</name>
  <files>src/ingest/persist.ts, src/ingest/persist.test.ts, src/ingest/pipeline.ts, src/ingest/errors.ts</files>
  <behavior>
    - A first run over a repository with three artifacts reports three discovered and three new.
    - An identical second run reports three discovered, zero new, zero updated and three unchanged.
    - Changing one artifact's content reports one updated and two unchanged.
    - Adding a fourth artifact reports one new and three unchanged.
    - Removing an artifact from an untruncated scan reports one removed.
    - An artifact that was removed and then reappears at the same path reports as updated, keeps its original package id, and has its removal cleared.
    - Discovered always equals new plus updated plus unchanged, on every one of the cases above.
    - The failed-parse count on the result matches the number of artifacts whose parse status is a failure.
  </behavior>
  <action>
    Apply References B and E, and thread the counters out through the pipeline's
    success result as Reference D shows.

    Place the snapshot read immediately after the repository upsert and nowhere
    earlier — the repository id does not exist before that statement, and a
    snapshot keyed on anything else would be silently empty.

    Classify from three facts and not two. Whether the key existed at all
    separates new from everything else. Whether it carried a removal timestamp
    in the snapshot separates a revival from a genuinely untouched artifact —
    read that from the snapshot, because by the time the loop runs the upsert's
    conflict branch has already cleared the tombstone on the row itself.
    Whether the version insert returned a row separates changed content from
    identical content, and that length is already computed in the loop today.

    Assert the sum invariant in the test rather than in the code. It is a
    property of the classification, so a test that checks it on every case is
    what catches a fourth branch being added later that forgets to count.

    Do not update a version row's commit sha when the content is unchanged.
    A version row is an immutable snapshot: its hash is a claim about the bytes
    at that commit, and rewriting the commit while keeping the hash breaks the
    pairing. Freshness is not lost — the repository's own last-scanned timestamp
    moves on every run and is what the pages render.
  </action>
  <verify>
    <automated>bun run test src/ingest/persist.test.ts &amp;&amp; bun run typecheck</automated>
  </verify>
  <done>Every counter case above passes, the sum invariant holds on all of them, and a revived artifact reports as updated with its original package id intact.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: The artifacts and the job's terminal state are one commit</name>
  <files>src/ingest/persist.ts, src/ingest/persist.test.ts, src/ingest/pipeline.ts, src/ingest/pipeline.test.ts, src/ingest/worker.ts</files>
  <behavior>
    - Persisting a scan under a job writes exactly one attempt row carrying the counters, the commit sha and the truncation flag, and leaves the job succeeded.
    - The attempt row's outcome is the success value and its error detail is empty.
    - A transaction that fails part way through leaves no attempt row, leaves the job still running rather than succeeded, and leaves every previously stored artifact exactly as it was.
    - A job left running by such a failure is reclaimable by the reaper.
    - Running the full pipeline under a job produces one attempt row and one terminal job, not two of either.
    - Persisting without a job still works and writes no attempt row.
  </behavior>
  <action>
    Apply References C, D and F.

    The two statements go last, in that order, inside the transaction that
    already exists. That placement is the whole of the crash requirement: the
    question "what if the process dies between committing the artifacts and
    recording that it did" stops having an answer, because there is no longer a
    between.

    Then hold the invariant in the worker. A successful ingest has already
    terminated its own job, so the worker returns; every other outcome never
    opened the transaction, so the worker terminates it as it already does. Two
    writes to one job is the failure this guard exists to prevent, and it is
    worth a comment naming which paths take which route.

    For the rollback case, provoke a real database failure rather than mocking
    one — an artifact whose type is not a row in the artifact-type table
    violates a foreign key and aborts the transaction, which is exactly the
    shape a storage failure has in production. Assert three things afterwards:
    no attempt row, a job that is still running, and a package listing identical
    to the one before the run. That third assertion is ROADMAP criterion 2 in
    its strictest form.

    Run the full suite at the end of this task, not just the two files it
    touched. The pipeline's result shape changed, and the Phase 1 suite is what
    proves nothing else moved with it.
  </action>
  <verify>
    <automated>bun run test &amp;&amp; bun run typecheck &amp;&amp; bun run check:boundaries</automated>
  </verify>
  <done>An ingest under a job produces one attempt row and one terminal transition, both in the same commit as the artifacts. A failed transaction leaves no attempt row, a job still running, and the prior listing untouched. The whole existing suite still passes.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| a partial scan → the stored listing | Whatever a run failed to read is indistinguishable, at the database, from something that was deleted upstream — unless the flag is honoured. |
| an aborted transaction → what a page shows | A rollback that leaves the job reading as finished converts a transient failure into a permanent lie. |
| the attempt row's error text → a rendered page | Anything written to that column will eventually be shown to somebody. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-02-08 | Denial of Service | the delisting predicate in `persistScan` | critical | mitigate | Delisting is skipped entirely when the scan is flagged incomplete; a regression test drives a truncated subset scan and asserts every prior artifact stays live. |
| T-02-09 | Tampering | job terminal state versus artifact writes | high | mitigate | Both are statements in one transaction, with the job update last; a provoked foreign-key violation proves the rollback leaves no attempt row and no false success. |
| T-02-10 | Information Disclosure | `ingest_attempt.error_detail` | high | mitigate | On the success path it is written as empty and on every other path it is drawn from the fixed outcome message table, never from an exception; plan 02-03 adds the type that makes any other source fail to compile. |
| T-02-11 | Repudiation | a job written twice | medium | mitigate | One documented invariant decides the route — the success path terminates inside the transaction, every other path terminates in the worker — and the worker returns immediately on success. |
| T-02-12 | Tampering | rewriting a version's commit sha on unchanged content | medium | mitigate | The version insert stays a do-nothing on conflict, so the hash keeps its pairing with the commit it was read at; freshness is carried by the repository's scanned timestamp instead. |
</threat_model>

<verification>
1. A truncated scan carrying a subset of a repository's artifacts leaves all of them live and reports zero removals.
2. The same scan with the flag clear still removes them, so delisting was guarded and not disabled.
3. Re-indexing an unchanged repository reports every artifact as unchanged and none as new or updated.
4. A content change reports one updated; an addition reports one new; a disappearance reports one removed.
5. A reappearing artifact reports as updated, keeps its package id, and has its removal cleared.
6. Discovered equals new plus updated plus unchanged on every case.
7. One ingest under a job writes exactly one attempt row and one terminal transition, in the artifacts' own commit.
8. A provoked storage failure leaves no attempt row, a job still running, and the previous listing byte for byte.
9. `bun run test` and `bun run check:boundaries` pass.
</verification>

<success_criteria>
- **JOB-03** — the artifact writes and the job's terminal state are one commit, so no interruption can leave a half-applied package state paired with a finished job.
- **JOB-02** — every attempt leaves a durable row carrying what it found, what it changed and whether it was complete.
- **ING-13** — the same repository at the same commit still produces the same stored result, and the counters now say so out loud.
- ROADMAP criterion 2 — killing the process mid-ingest leaves no half-written package state, and a failed run cannot destroy the previously visible index.
- The re-index wording complaint from Phase 1 is answered with a breakdown rather than a stored count.
</success_criteria>

<output>
Create `.planning/phases/AGD-02-durable-ingestion/02-02-SUMMARY.md` when done.
Record: that the truncation regression test failed against the pre-change code
and the shape of that failure; the counter values observed on a first run, an
identical second run, and a truncated run of the reference fixture; and what the
provoked rollback left behind. Record no credential.
</output>
