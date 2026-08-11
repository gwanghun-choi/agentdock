---
phase: AGD-02-durable-ingestion
plan: 03
type: execute
wave: 3
depends_on: ["02-02"]
files_modified:
  - src/github/scan.ts
  - src/github/scan.test.ts
  - src/ingest/persist.ts
  - src/ingest/persist.test.ts
  - src/ingest/pipeline.ts
  - src/ingest/pipeline.test.ts
  - src/log.ts
  - src/log.test.ts
  - src/ingest/errors.test.ts
autonomous: true
requirements: [ING-12, ING-09]

estimate:
  tokens: 65000
  raw_tokens: 65000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "Re-indexing a repository whose commit has not moved reads none of its files"
    - "That run still refreshes stars, description, licence and the last-looked timestamp, because those move independently of the commit"
    - "That run writes to no package row and to no version row, so an unchanged repository does not float to the top of the listing"
    - "That run still costs exactly two GitHub requests, because both are spent before the commit sha is known"
    - "Every ingestion emits exactly one log line, whose outcome field cannot hold an exception message because the type does not permit one"
    - "No log line and no stored error detail can carry a token or a connection string, proven for every outcome"
  artifacts:
    - path: "src/github/scan.ts"
      provides: "An optional known-commit argument that returns early with no file reads"
      exports: ["fetchRepoScanInputs", "ScanInputs", "CAPS"]
      min_lines: 95
    - path: "src/ingest/persist.ts"
      provides: "The narrow repository-only write path the no-change run uses instead of the full transaction"
      exports: ["persistScan", "touchRepository", "lastIngestedSha"]
      min_lines: 250
    - path: "src/log.ts"
      provides: "One closed shape per event, with the outcome narrowed to a union so an exception cannot be passed where an outcome belongs"
      exports: ["log"]
      min_lines: 45
    - path: "src/log.test.ts"
      provides: "The secret-absence proof, for every outcome, against planted sentinels"
      min_lines: 60
  key_links:
    - from: "src/ingest/pipeline.ts"
      to: "src/github/scan.ts"
      via: "the stored commit sha is handed down so the scan can return before reading anything"
      pattern: "fetchRepoScanInputs(owner, repo, selectPaths, known)"
    - from: "src/ingest/pipeline.ts"
      to: "src/ingest/persist.ts"
      via: "the no-change run takes the narrow repository write, never the full transaction, so no package timestamp moves"
      pattern: "touchRepository"
    - from: "src/log.ts"
      to: "src/ingest/errors.ts"
      via: "the outcome field is the union itself, which is what makes an exception message fail to compile"
      pattern: "AttemptOutcome"
---

<objective>
Stop re-reading two hundred files to learn nothing, and close the last place a
secret could reach a log line.

Purpose: the commit sha already arrives inside a response the pipeline is
already making — the tree endpoint returns it and the code already asserts it is
a forty-character commit sha. Comparing it to the one stored costs about five
lines and skips up to two hundred raw fetches and up to two minutes of wall
clock. It saves **no GitHub quota**: both core calls are issued concurrently
before the sha is known and the metadata is wanted regardless. The plan says so
because a claim of quota saving would be wrong, and a test asserts the request
count so the claim cannot drift.

Output: an optional known-commit argument on the scan, a narrow repository-only
write for the no-change run, and a log line whose field set closes the one
remaining hole — an outcome typed as a free string, which accepts a stringified
exception.

Honours the CONTEXT.md decisions that the short circuit must not be presented as
a quota saving, that conditional requests are deferred until a token exists, and
that no token, connection string, or response body appears in any log line.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/phases/AGD-02-durable-ingestion/CONTEXT.md
@.planning/phases/AGD-02-durable-ingestion/AGD-02-02-PLAN.md
@src/github/scan.ts
@src/github/repo.ts
@src/github/tree.ts
@src/ingest/pipeline.ts
@src/ingest/persist.ts
@src/ingest/errors.ts
@src/log.ts
</context>

<decisions_made_while_planning>

**1. No conditional requests, and the roadmap line that promised them is struck.**

Phase 1 measured a not-modified response consuming quota and found the reason in
GitHub's own wording: the exemption applies only to a request made while
correctly authorized, and unauthenticated is not that. The stored entity tag
keeps being written because a requirement asks for it; nothing is built on top
of it until a token exists.

**2. No freshness gate on the upstream push timestamp either.**

Comparing the stored push timestamp to the fetched one would let the tree call
be skipped and would genuinely halve the core cost. It rests on an unverified
assumption about that timestamp always moving, and it is only sound for an
automated sweep — a person who clicks re-index has explicitly asked AgentDock to
look. It belongs to the batched-refresh phase, where the arithmetic matters.

**3. The no-change run reports the listing it already holds, not zero.**

Nothing was read, so a literal count of what this run discovered is zero — and
printing zero discovered next to a page showing twenty-four skills is a worse
lie than the count it replaces. The repository's live artifact count is one
indexed read, and reporting it as discovered and unchanged is true: the sha
equality is a statement that those artifacts are still there, at that commit.

**4. The no-change run terminates its own job, the same way the full run does.**

It opens a transaction to write the repository row, so the attempt row and the
terminal transition go inside it. That keeps one invariant rather than two: a
result that reports success has already terminated its job, whichever of the two
write paths produced it.

**5. The narrow write deliberately omits the truncation flag and every package
timestamp.**

The commit has not moved, so whatever was partial about the previous read is
still partial and the stored flag is still correct. And the listing is ordered by
the package update timestamp, so bumping it on a run that changed nothing would
float every unchanged repository to the top of the recent list forever.

**6. Closing the log hole is a type change, not a filter.**

A redaction pattern is a filter that has to anticipate every shape a secret can
take. A field typed as the outcome union is a wall the compiler enforces: there
is no longer anywhere in the entry to put a stringified exception, and the type
check that already runs in the build is what enforces it.

</decisions_made_while_planning>

<reference>

## Reference A — `src/github/scan.ts`

`ScanInputs` gains one field, and the function gains one optional argument. The
early return goes after the tree is bounded and before any path selection, so
the returned tree is the same shape the full path would have produced.

```ts
export type ScanInputs = {
  metadata: RepoMetadata;
  tree: RepoTree;
  files: Map<string, string>;
  /** Paths that matched but were not read, because a cap was reached. */
  skipped: string[];
  artifactsTruncated: boolean;
  /** The commit has not moved since the last ingest, so nothing was read. */
  unchanged: boolean;
};

export async function fetchRepoScanInputs(
  owner: string,
  repo: string,
  selectPaths: (tree: RepoTree) => string[],
  knownSha?: string | null,
): Promise<ScanInputs> {
  // ... unchanged: deadline, the two concurrent calls, `bounded` ...

  // Both core calls are already spent — the sha arrives inside the tree
  // response, which is why this saves no GitHub quota at all. What it saves is
  // up to CAPS.maxFiles raw fetches and up to CAPS.wallClockMs of wall clock,
  // plus the raw-host abuse-throttle exposure this file's header warns about.
  if (knownSha && bounded.commitSha === knownSha) {
    return {
      metadata,
      tree: bounded,
      files: new Map(),
      skipped: [],
      artifactsTruncated: false,
      unchanged: true,
    };
  }

  // ... unchanged: selectPaths, the capped queue, the two workers ...

  return { metadata, tree: bounded, files, skipped, artifactsTruncated: skipped.length > 0, unchanged: false };
}
```

## Reference B — the narrow write, added to `src/ingest/persist.ts`

```ts
/** The commit sha of the last ingest of this repository, matched the way the pages match. */
export async function lastIngestedSha(fullName: string): Promise<string | null> {
  const [row] = await db
    .select({ sha: repository.lastIngestedSha })
    .from(repository)
    .where(sql`lower(${repository.fullName}) = ${fullName.toLowerCase()}`)
    .limit(1);
  return row?.sha ?? null;
}

export type TouchResult = {
  repositoryId: number;
  liveCount: number;
  treeTruncated: boolean;
};

/**
 * The no-change path's only write.
 *
 * Repository metadata moves independently of the commit sha, and all of it was
 * just fetched, so it is refreshed. Nothing below the repository is touched: no
 * package upsert, no version insert, and above all no delisting and no package
 * timestamp bump — the listing is ordered by that timestamp, so bumping it here
 * would float every unchanged repository to the top of the recent list forever.
 *
 * The truncation flag is deliberately not written. The commit has not moved, so
 * whatever was partial about the previous read of it is still partial.
 */
export async function touchRepository(
  metadata: RepoMetadata,
  commitSha: string,
  scannedAt: Date,
  job?: JobContext,
): Promise<TouchResult> {
  return db.transaction(async (tx) => {
    const [repo] = await tx
      .insert(repository)
      .values({ /* ...metadata..., scannedAt, etag: metadata.etag, lastIngestedSha: commitSha */ })
      .onConflictDoUpdate({
        target: repository.githubNodeId,
        set: {
          fullName: metadata.fullName,
          owner: metadata.owner,
          defaultBranch: metadata.defaultBranch,
          description: metadata.description,
          homepage: metadata.homepage,
          licenseSpdx: metadata.licenseSpdx,
          stars: metadata.stars,
          isFork: metadata.isFork,
          isArchived: metadata.isArchived,
          topics: metadata.topics,
          pushedAt: metadata.pushedAt,
          scannedAt,
          etag: metadata.etag,
          lastIngestedSha: commitSha,
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: repository.id, treeTruncated: repository.treeTruncated });

    const [live] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(packageTable)
      .where(and(eq(packageTable.repositoryId, repo.id), isNull(packageTable.delistedAt)));

    if (job) {
      await tx.insert(ingestAttempt).values({
        jobId: job.id,
        attemptNo: job.attemptNo,
        startedAt: job.startedAt,
        outcome: 'unchanged',
        errorDetail: null,
        commitSha,
        filesRead: 0,
        artifactsFound: live.n,
        artifactsNew: 0,
        artifactsUpdated: 0,
        artifactsUnchanged: live.n,
        artifactsRemoved: 0,
        parseFailed: 0,
        truncated: repo.treeTruncated,
        rateRemaining: job.rateRemaining,
        rateReset: null,
      });
      await tx
        .update(ingestJob)
        .set({ status: 'succeeded', finishedAt: sql`now()`, startedAt: null, workerId: null })
        .where(eq(ingestJob.id, job.id));
    }

    return { repositoryId: repo.id, liveCount: live.n, treeTruncated: repo.treeTruncated };
  });
}
```

## Reference C — the pipeline's short-circuit branch

```ts
    const known = await lastIngestedSha(fullName);

    const inputs = await fetchRepoScanInputs(
      owner,
      repo,
      (tree) => DETECTORS.flatMap((d) => d.match(tree.entries)).flatMap((c) => c.needs),
      known,
    );

    if (inputs.unchanged) {
      const scannedAt = new Date();
      const touched = await touchRepository(
        inputs.metadata,
        inputs.tree.commitSha,
        scannedAt,
        job ? { ...job, rateRemaining: rateLimitState()?.remaining ?? null } : undefined,
      );

      const counters: DiffCounters = {
        discovered: touched.liveCount,
        new: 0,
        updated: 0,
        unchanged: touched.liveCount,
        removed: 0,
        parseFailed: 0,
      };

      log({ /* ... event: 'ingest', outcome: 'unchanged', ...counters ... */ });

      return {
        ok: true,
        outcome: 'unchanged',
        owner,
        repo,
        fullName: inputs.metadata.fullName,
        commitSha: inputs.tree.commitSha,
        found: touched.liveCount,
        stored: touched.liveCount,
        failed: 0,
        truncated: touched.treeTruncated,
        counters,
      };
    }
```

## Reference D — `src/log.ts`

```ts
import type { AttemptOutcome } from '@/ingest/errors';

type IngestLog = {
  event: 'ingest';
  jobId: number | null;
  attempt: number | null;
  owner: string;
  repo: string;
  commitSha: string | null;
  // Was a bare string. Narrowing it to the union is the whole guarantee: a
  // caller can no longer pass a stringified exception where an outcome belongs,
  // and the type check that already runs in the build is what stops them.
  outcome: AttemptOutcome;
  found: number;
  stored: number;
  failed: number;
  new: number;
  updated: number;
  unchanged: number;
  removed: number;
  truncated: boolean;
  durationMs: number;
  rateRemaining: number | null;
  /** UTC epoch seconds, as GitHub reports it. */
  rateReset: number | null;
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
 * a log file six months from now. Every field here is a number, a boolean, a
 * nullable string with a documented provenance, or a closed union — there is no
 * key an arbitrary object could be assigned to.
 */
export function log(entry: IngestLog | WorkerLog): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...entry }));
}
```

## Reference E — the secret-absence proof, `src/log.test.ts`

The suite runs with no database, so it is one of the four that stay visible in CI.

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AttemptOutcome } from '@/ingest/errors';
import { messageFor, OUTCOME_MESSAGES } from '@/ingest/errors';
import { log } from '@/log';

const OUTCOMES: AttemptOutcome[] = [
  'ok', 'invalid_input', 'denylisted', 'unreadable', 'rate_limited',
  'too_large', 'no_artifacts', 'unavailable', 'storage_failed', 'unchanged',
];

// Sentinels, not real values. If either of these can appear in a line, so can
// the real thing.
const TOKEN = 'ghp_SENTINEL_TOKEN_VALUE_0000000000';
const DSN = 'postgres://sentinel_user:sentinel_pw@db.internal:5432/sentinel_db';
```

Each case builds a full entry for one outcome, captures the serialized line,
and asserts that neither sentinel appears in it, that the key set is exactly the
declared one, and that no message the outcome table can produce contains either
sentinel.

</reference>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: The scan returns early when the commit has not moved, and the narrow write is what a no-change run uses</name>
  <files>src/github/scan.ts, src/github/scan.test.ts, src/ingest/persist.ts, src/ingest/persist.test.ts</files>
  <behavior>
    - Called with a known sha matching the tree's, the scan returns with an empty file map, an empty skipped list, and its no-change flag set.
    - It still returns the freshly fetched metadata and the tree, because both were already paid for.
    - Called with a known sha that does not match, or with none, it behaves exactly as before.
    - The narrow write refreshes the repository's stars, description, licence, upstream push time and last-looked time.
    - The narrow write leaves every package row's update timestamp exactly as it was.
    - The narrow write leaves the stored truncation flag exactly as it was.
    - The narrow write returns the count of artifacts the repository currently lists.
    - Given a job, it writes one attempt row recording no files read and leaves the job succeeded, in the same commit.
  </behavior>
  <action>
    Apply References A and B.

    Place the early return after the tree has been bounded and before any path
    selection, so the tree it hands back is the same shape the full path would
    have produced and no caller has to know which branch ran.

    The narrow write is a separate function and not a flag on the full
    transaction, for one reason that is worth stating in its comment: the
    listing is ordered by the package update timestamp, so any code path that
    reaches the package upsert on a no-change run floats every unchanged
    repository to the top of the recent list forever. Making it a different
    function makes that impossible rather than remembered.

    Leave the stored truncation flag alone in the narrow write. The commit has
    not moved, so whatever was partial about the previous read of it is still
    partial, and overwriting the flag would quietly upgrade a partial listing to
    a complete-looking one.

    The timestamp assertion is the one worth being careful about: read the
    package update timestamps before the narrow write and compare them after,
    rather than checking they are merely recent. Recent is what the bug looks
    like.
  </action>
  <verify>
    <automated>bun run test src/github/scan.test.ts src/ingest/persist.test.ts &amp;&amp; bun run typecheck</automated>
  </verify>
  <done>The scan returns without reading files when the commit matches and is otherwise unchanged. The narrow write refreshes repository metadata, leaves every package timestamp and the truncation flag untouched, reports the live artifact count, and terminates its job inside its own transaction.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: A re-index of an unchanged repository reads nothing and says so honestly</name>
  <files>src/ingest/pipeline.ts, src/ingest/pipeline.test.ts</files>
  <behavior>
    - Ingesting the reference fixture twice makes zero requests to the raw host on the second run.
    - The second run still makes exactly two requests to the API host, so the short circuit is not presented as a quota saving.
    - The second run reports the repository's live artifact count as both discovered and unchanged, and zero for new, updated and removed.
    - The second run mints no version row and creates no package row.
    - The second run still moves the repository's last-looked timestamp.
    - A second run whose tree carries a different commit sha takes the full path and reads files again.
    - A repository AgentDock has never seen takes the full path, because there is no stored sha to compare.
  </behavior>
  <action>
    Apply Reference C.

    The request-count assertion is the honest-accounting control and it is the
    reason this behaviour is a test rather than a sentence. Both rate-limited
    calls are issued concurrently before the commit sha is known, and the
    metadata call is wanted regardless, so the second run costs the same two
    requests as the first. Asserting that number pins the claim: what was saved
    is file reads and wall clock, and a future edit that starts describing it as
    a quota saving will contradict a passing test.

    Take the stored sha from the repository row by lowercased full name, which
    is how every other lookup in this codebase matches. A renamed repository
    misses and takes the full path — which is correct, because a rename is
    exactly when the stored row and the fetched one need reconciling.

    Do not implement conditional requests on the stored entity tag. Keep writing
    the column, because a data requirement asks for it, and build nothing on it:
    an unauthenticated not-modified response consumes quota, which was measured
    rather than assumed.
  </action>
  <verify>
    <automated>bun run test src/ingest/pipeline.test.ts &amp;&amp; bun run typecheck</automated>
  </verify>
  <done>A second ingest at the same commit reads zero files, writes no package or version row, still spends exactly two API-host requests, still moves the last-looked timestamp, and reports the live count as discovered and unchanged.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: One line per ingestion, with no field a secret could occupy</name>
  <files>src/log.ts, src/log.test.ts, src/ingest/errors.test.ts, src/ingest/pipeline.ts, src/ingest/pipeline.test.ts</files>
  <behavior>
    - Every ingestion, on every path, emits exactly one line.
    - That line carries the job id, the attempt number, the commit, the outcome, the five counters, the truncation flag, the duration and the rate figures.
    - The serialized key set is exactly the declared one, with no additional key.
    - For every outcome, a fully populated line contains neither a planted credential sentinel nor a planted connection-string sentinel.
    - No message the outcome table can produce contains either sentinel.
    - The outcome field rejects a value outside the union at type-check time.
  </behavior>
  <action>
    Apply References D and E, and update every call site in the pipeline to
    supply the new fields.

    Move the log assertions out of the outcome suite into their own file and
    delete the block they came from, so the file that owns the log line owns its
    proof. Extending the entry adds required fields, so leaving the old block
    behind would fail to compile anyway — moving it is the smaller diff and the
    better home.

    The narrowing of the outcome field is the change that matters and it is one
    word. A field typed as a bare string accepts a stringified exception; a field
    typed as the union does not, and the type check that already runs in the
    build is what enforces it. Write that reason into the comment beside the
    field, because it is the difference between a convention and a wall.

    Use sentinels rather than real values in the test. Planting a fabricated
    credential and a fabricated connection string and asserting neither can
    appear is the runnable form of the claim; asserting against the real
    environment would make the test pass on a machine that happens to have
    neither set.
  </action>
  <verify>
    <automated>bun run test &amp;&amp; CI=1 bun run test src/log.test.ts &amp;&amp; bun run typecheck &amp;&amp; bun run ci</automated>
  </verify>
  <done>Every ingestion emits one line carrying the full counter set and the job identity. The key set is closed, the outcome field is the union, and no line or stored message can carry either planted sentinel. The log suite runs and passes with no database.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| an exception → a log line | Every exception in this path can carry a header, a statement, or a hostname; a log line is where those become durable. |
| a fetched commit sha → a decision to skip reading | Deciding not to read based on a value the remote supplied is a decision the remote can influence. |
| a no-change run → the ordering of the public listing | A write on a run that changed nothing is how an ordering silently stops meaning anything. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-02-13 | Information Disclosure | the ingestion log line | high | mitigate | The outcome field is the union rather than a string, no field accepts an arbitrary object, and a suite plants a credential and a connection-string sentinel and asserts neither can appear for any outcome. |
| T-02-14 | Information Disclosure | the exception raised by a failed GitHub call | high | mitigate | Unchanged and relied upon: the client throws a fresh error and discards the cause, because the credential lives in the header object some runtimes attach to a fetch failure. |
| T-02-15 | Tampering | the commit sha driving the skip decision | medium | mitigate | The sha is already asserted to be a forty-character commit sha where it is parsed; a wrong value causes a full read, which is the safe direction, and never a write of unread state. |
| T-02-16 | Tampering | listing order after a no-change run | medium | mitigate | The no-change path is a separate function that cannot reach the package upsert, and a test compares package timestamps before and after rather than checking they look recent. |
| T-02-17 | Denial of Service | conditional requests on the stored entity tag | medium | accept | Not implemented. An unauthenticated not-modified response was measured consuming quota, so building on the stored tag would spend budget to save none. Deferred until a token exists. |
</threat_model>

<verification>
1. A second ingest at the same commit makes zero raw-host requests and exactly two API-host requests.
2. That run creates no package row, mints no version row, and leaves every package timestamp identical.
3. That run refreshes repository metadata and the last-looked timestamp, and leaves the truncation flag as stored.
4. That run reports the live artifact count as discovered and unchanged, and zero for new, updated and removed.
5. A moved commit sha, and a repository never seen before, both take the full path.
6. Every ingestion emits exactly one line with the declared key set and no other key.
7. For every outcome, a populated line carries neither planted sentinel, and no outcome message does either.
8. `bun run ci` passes, and the log suite runs with no database.
</verification>

<success_criteria>
- **ING-12** — re-ingesting an unchanged repository is detected by commit sha and reads none of its files, with the saving stated as file reads and wall clock rather than quota.
- **ING-09** — the token cannot reach a log line or a stored error detail, enforced by a closed type rather than by a filter, and proven for every outcome against planted sentinels.
- ROADMAP criterion 4 — re-submitting an unchanged repository completes without re-reading its files.
- ROADMAP criterion 7 — no token and no response body appears in any log line.
- The struck roadmap line: the stored entity tag is written and nothing is built on it, because an unauthenticated not-modified response costs quota.
</success_criteria>

<output>
Create `.planning/phases/AGD-02-durable-ingestion/02-03-SUMMARY.md` when done.
Record: the request counts observed on the first and second ingest of the
reference fixture, the counter breakdown the second run reported, and the exact
key set the log line serializes. Record the sentinel values only as the fact
that they were absent, never any real credential or connection string.
</output>
