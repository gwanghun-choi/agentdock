# Phase AGD-02: Durable Ingestion — Research

**Researched:** 2026-08-10
**Domain:** PostgreSQL-only durable job processing inside a Next.js 16 self-hosted app
**Confidence:** HIGH — every load-bearing SQL and Drizzle claim in this document was executed live
against the project's own PostgreSQL 16.14 instance and its installed `drizzle-orm@0.45.2` during
this session. Transcripts are inline.

---

## User Constraints

**No `CONTEXT.md` exists for this phase** (`.planning/phases/AGD-02-durable-ingestion/` was empty at
research time). The constraints below are the ones handed to this research task and the ones
already locked by Phase 0 / Phase 1 artifacts. They are binding on the planner exactly as a
`CONTEXT.md` would be.

### Locked Decisions

- Stack: TypeScript 5.9.3, Next.js 16.3.0 App Router, Node 22.22.3 runtime, Bun as
  installer/script-runner only, Drizzle 0.45.2 (`generate` → hand-review → `bun run db:migrate`
  via `scripts/migrate.mjs`), Biome, Vitest.
- DB: existing PostgreSQL 16, non-superuser role `agentdock_app`, schema `agentdock` only.
  `pgSchema()` on every table. `drizzle-kit push`/`pull` banned. `pg_trgm` not installed and not
  to be installed.
- **No Redis, no BullMQ, no pg-boss, no graphile-worker.** Rejected specifically because each
  installs its own DDL-running migration system into a database shared with another application.
  The queue is a plain table in `agentdock`.
- Existing tables: `repository`, `package`, `package_version`, `artifact_type`,
  `repository_denylist`, `schema_meta`, `__drizzle_migrations`.
- `package` already has `delisted_at`. `package_version` already has `commit_sha`, `blob_sha`,
  `content_hash`, `parse_status`, `parse_errors`, `ingested_at`. `repository` already has
  `scanned_at`, `etag`, `license_spdx`, `stars`, `pushed_at`, `last_ingested_sha`.
- `GITHUB_TOKEN` is empty: unauthenticated, 60 core requests/hour, one ingest costs 2.
- Verified in Phase 1 and NOT to be re-measured: `raw.githubusercontent.com` costs no core quota;
  the Trees API returns the **commit** sha when given a ref; **a 304 conditional request DOES
  consume quota when unauthenticated**; GraphQL is unavailable unauthenticated;
  `GET /rate_limit` is free.
- Security policy unchanged: never execute repo content, never write it to disk, `owner/repo`
  only, hardcoded host allowlist, no risk score.

### Claude's Discretion

Worker execution model, exact job/attempt schema, claim SQL, reaper strategy, retry policy,
polling interval, diff-counter algorithm, log field set, test strategy. All are answered
prescriptively below.

### Deferred Ideas (OUT OF SCOPE)

ETag conditional requests as a quota optimisation (see §4 — worthless without a token),
`LISTEN/NOTIFY` (see §2), batched/scheduled refresh sweeps (Phase 8), job kinds beyond
`repo` ingestion (Phase 5), multi-worker deployment, dead-letter service, heartbeat protocol.

---

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ING-08 | Rate-limit headers tracked; client backs off before exhaustion | §8 — preemptive `remaining < 2` gate before claim + `pausedUntil` process gate. `rateLimitState()` already exists at `src/github/client.ts:32`. |
| ING-09 | Token never logged, stripped from serialized errors | §9 — closed log union, `errorDetail` drawn only from `OUTCOME_MESSAGES`. `githubFetch` already discards the fetch `cause` (`src/github/client.ts:133-137`). |
| ING-12 | Re-ingesting an unchanged repository is a no-op detected by commit SHA | §4 — tree-sha short circuit before the raw reads. Honest cost analysis: saves 0 core calls, saves up to 200 raw fetches and up to 120 s wall clock. |
| ING-13 | Same `(repository, commit SHA)` always produces the same stored result | §7 — already guaranteed by `package_version_content_key`; §6 adds the missing truncation guard. |
| JOB-01 | Submission enqueues and returns immediately | §1, §3 — Server Action validates → enqueues → returns `jobId`. |
| JOB-02 | User can observe job progress and terminal outcome | §1 (`/jobs/[id]` + `router.refresh()`), §5 (`ingest_attempt` is the display source). |
| JOB-03 | A crash mid-ingest leaves no partially-applied package state | §6 — one transaction, already true in `persist.ts`; extended to cover the job terminal state. |
| JOB-04 | Jobs abandoned by a dead worker are automatically reclaimed | §2 — `started_at < now() - interval '15 minutes'` sweep. No heartbeat table. |
| JOB-05 | A failed job records a readable reason and can be retried | §5, §8 — `ingest_attempt.outcome` + `error_detail`; retry = a new enqueue, deduped by the partial unique index. |
| JOB-06 | Job processing requires no service beyond PostgreSQL | Entire document. Zero new runtime dependencies. |
| QUA-04 | API routes have integration tests covering success and failure paths | §10 — the submit Server Action and `/jobs/[id]` are plain functions; call them directly. |

---

## Summary

Phase 1 built a synchronous pipeline that is already 80% of the way to durable: `persistScan`
is a single transaction, identity is three unique constraints, and every write is an upsert.
What is missing is a place to record that work was *asked for*, a loop that picks it up, and a
sweep that notices nobody finished.

The decisive question is where the worker runs. `after()` from `next/server` is not the answer:
Next 16's own docs bound it to the route's max duration and guarantee it only across a *graceful*
`SIGTERM`, which is precisely the failure ROADMAP criterion 2 excludes. A separate `bun run worker`
process is durable but adds a second command a solo maintainer must remember on every reboot. The
recommendation is the middle option the project's own `ARCHITECTURE.md` already anticipated: start
the poll loop from the existing `src/instrumentation.ts` behind an env flag, and get durability
from the job **table** rather than from the worker's lifetime. Because claiming uses
`FOR UPDATE SKIP LOCKED`, the well-documented Next dev-mode behaviour of calling `register()` more
than once is not a bug to work around — two pollers in one process is exactly the case
`SKIP LOCKED` exists for. The same exported `runWorker()` is launchable as a standalone process
with zero code change on the day that becomes worth doing.

Two findings change what the plan must contain. First, **`persist.ts` currently delists packages
it merely failed to read**: the delisting predicate is `id NOT IN (packageIds)`, and `packageIds`
only contains artifacts that survived the file-read caps. A truncated or partially-failed scan
therefore destroys the previously visible index — which directly violates the phase's own
durability intent. Second, the commit-SHA short circuit does **not** save GitHub quota. Repo
metadata and the tree are one core call each and both are spent before the sha is known; what the
short circuit saves is up to 200 raw fetches and up to 120 seconds of wall clock. That is still
worth ~5 lines, but the plan must not claim a quota win it does not get.

**Primary recommendation:** two tables (`ingest_job` narrow and UPDATE-hot, `ingest_attempt`
append-only), a single-statement `UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED)` claim,
a partial unique index on `(target) WHERE status IN ('queued','running')` for both duplicate-submit
dedupe and reaper safety, a 15-minute `started_at` sweep with no heartbeat, and the job's terminal
row committed inside the same transaction as the artifact writes.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Validate `owner/repo`, enqueue, return job id | Frontend Server (Server Action) | — | Trust boundary. `normalizeRepo` must run before a row is written, not after. |
| Durable queue, claim arbitration, dedupe | Database | — | `FOR UPDATE SKIP LOCKED` + a partial unique index are the only mechanisms that cannot race. Application-level checks can. |
| Job execution loop, backoff scheduling, reaping | API/Backend (`src/ingest/worker.ts`) | — | The only component allowed to be slow. |
| Rate-limit accounting and preemptive pause | API/Backend (`src/github/*`) | Worker reads it | `github/` is already the wall; the worker asks it, never re-implements it. |
| Job status display | Frontend Server (RSC) | Browser (`router.refresh()` poll) | Server-rendered so it works with JS off; the client only re-triggers the render. |
| Transactional artifact + job-state write | Database | `src/ingest/persist.ts` | One transaction is the whole of JOB-03. |

---

## §1 Worker execution model — the verdict

### What Next 16 actually guarantees

| Mechanism | Survives crash / `SIGKILL`? | Survives `next start` restart? | Second command? | Behaviour in `bun run dev` |
|---|---|---|---|---|
| `after()` from `next/server` | **No** | **No** | No | Runs, bounded by route duration |
| In-process loop from `instrumentation.ts` | **Yes — via the job table + reaper** | **Yes — via the job table + reaper** | No | `register()` may run more than once; harmless |
| Separate `bun run worker` process | **Yes — via the job table + reaper** | Yes | **Yes** | Independent of the dev server |

Note the middle column: *no* mechanism survives a crash by itself. Durability comes from the row
in `ingest_job`, never from the process. That reframing is what makes the choice a DX question
rather than a correctness question.

**On `after()` specifically, because it is commonly misunderstood.** Next 16.3's reference page
says only that it schedules work "to be executed after a response (or prerender) is finished"
and that it "will run for the platform's default or configured max duration of your route"
[CITED: nextjs.org/docs/app/api-reference/functions/after]. The self-hosting guide adds the one
real guarantee: *"`after` is fully supported when self-hosting with `next start`. When stopping
the server, ensure a graceful shutdown by sending `SIGINT` or `SIGTERM` signals and waiting. The
Next.js server will finish in-flight requests and execute any pending `after()` callbacks before
exiting."* [CITED: nextjs.org/docs/app/guides/self-hosting#after]

Read precisely, that is a *graceful-shutdown* guarantee, not a durability guarantee. It says
nothing about `SIGKILL`, an OOM kill, a WSL host reboot, or an unhandled rejection — and ROADMAP
criterion 2 is literally *"Killing the process mid-ingest."* `after()` also produces no row, so
there is nothing for criterion 1 ("watch the job progress") to poll and nothing for criterion 3
("picked up again automatically") to reclaim. **`after()` is rejected for ingestion.** It remains
the correct tool for fire-and-forget logging, and nothing in this phase needs it.

### Recommendation

**Start the poll loop from `src/instrumentation.ts`, gated by `INGEST_WORKER`, defaulting to on.**

```ts
// src/instrumentation.ts — appended to the existing register()
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { assertSchemaIsolation, db } = await import('@/db/client');
  // ... existing boot assertion and schema_meta write, unchanged ...

  if (process.env.INGEST_WORKER === '0') return;
  const { runWorker } = await import('@/ingest/worker');
  // Deliberately NOT awaited. Next documents that register() "must complete
  // before the server is ready to handle requests" — awaiting a poll loop here
  // means the server never becomes ready.
  void runWorker();
}
```

`runWorker()` is a plain exported function with no Next import in it, so the escape hatch is a
`package.json` line and nothing else:

```json
"worker": "INGEST_WORKER=0 next start & node --experimental-strip-types -e \"import('./src/ingest/worker.ts').then(m=>m.runWorker())\""
```

Do not add that script in this phase. `// ponytail: in-process worker; split to its own process
the day one ingest measurably delays a page render.`

### What it costs, named

1. **`register()` can fire more than once in `next dev`.** This is a long-standing, documented
   Next behaviour, not a rumour [CITED: github.com/vercel/next.js/issues/51450,
   github.com/vercel/next.js/discussions/15341]. Two poll loops in one process is exactly the
   case `SKIP LOCKED` handles — verified live in §2, where two concurrent claims returned two
   *different* rows and neither blocked. Add a module-level `let started = false` guard anyway,
   because two loops double the idle query rate for no benefit.
2. **`register()` may not fire until the first request is served** in some Next configurations
   [CITED: github.com/vercel/next.js/issues/59999]. Acceptable here — a submit *is* a request —
   but the plan must include a verification step that starts `next start`, waits, and confirms a
   pre-seeded `queued` row is claimed without any HTTP traffic. If it is not, the fallback is one
   line: also call `runWorker()` lazily from the submit Server Action. The project already stakes
   `assertSchemaIsolation()` on `register()`, so this risk is already accepted elsewhere.
3. **An ingest shares the event loop with page renders.** Ingestion is network- and DB-bound
   (`AbortSignal.timeout` on every fetch, concurrency 2), and the unauthenticated ceiling is 30
   ingests/hour, so the loop is idle almost always. If this ever bites, the fix is the
   `INGEST_WORKER=0` flag that already exists.
4. **A dev-server hot restart orphans an in-flight job.** The reaper reclaims it in 15 minutes.
   During active development that is annoying; the mitigation is `bun run db:reset`, not code.

**Loop shape.** Poll → claim → if claimed, run then immediately poll again (drain); if nothing
claimed, sleep 2 s. Every 60 s, run the reaper sweep in the same loop — no second timer.

```ts
export async function runWorker(signal?: AbortSignal): Promise<void> {
  let lastReap = 0;
  while (!signal?.aborted) {
    if (Date.now() - lastReap > 60_000) { await reapAbandoned(); lastReap = Date.now(); }
    const job = await claimJob(WORKER_ID);
    if (!job) { await sleep(2_000); continue; }
    await runJob(job);            // never throws; records its own terminal state
  }
}
```

**Job status UI.** The status page is a Server Component reading `ingest_job` joined to its latest
`ingest_attempt`. Live updates are one client component:

```tsx
'use client';
export function PollUntilDone({ done }: { done: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (done) return;
    const t = setInterval(() => router.refresh(), 1500);
    return () => clearInterval(t);
  }, [done, router]);
  return null;
}
```

No `/api/jobs/:id` route handler is needed in this phase. `// ponytail: router.refresh() instead
of a JSON endpoint; add the endpoint when a non-browser client wants job status.`

---

## §2 `FOR UPDATE SKIP LOCKED` claiming

### The claim, as one statement

```sql
UPDATE agentdock.ingest_job
   SET status      = 'running',
       attempts    = agentdock.ingest_job.attempts + 1,
       started_at  = now(),
       worker_id   = $1
 WHERE agentdock.ingest_job.id = (
         SELECT id FROM agentdock.ingest_job
          WHERE status = 'queued' AND next_attempt_at <= now()
          ORDER BY next_attempt_at, id
          LIMIT 1
          FOR UPDATE SKIP LOCKED
       )
RETURNING *;
```

### Drizzle 0.45.2 expresses this natively — no raw SQL required

`.for('update', { skipLocked: true })` exists and emits ` skip locked`
[VERIFIED: node_modules/drizzle-orm/pg-core/query-builders/select.types.d.ts:60-71 —
`export type LockStrength = 'update' | 'no key update' | 'share' | 'key share';` and the
`LockConfig` union member `{ noWait?: undefined; skipLocked: true; }`;
node_modules/drizzle-orm/pg-core/dialect.js:301-302 —
`} else if (lockingClause.config.skipLocked) { clauseSql.append(sql\` skip locked\`); }`].

```ts
const claimable = db
  .select({ id: ingestJob.id })
  .from(ingestJob)
  .where(and(eq(ingestJob.status, 'queued'), lte(ingestJob.nextAttemptAt, sql`now()`)))
  .orderBy(ingestJob.nextAttemptAt, ingestJob.id)
  .limit(1)
  .for('update', { skipLocked: true });

export async function claimJob(workerId: string) {
  const [job] = await db
    .update(ingestJob)
    .set({
      status: 'running',
      startedAt: sql`now()`,
      attempts: sql`${ingestJob.attempts} + 1`,
      workerId,
    })
    .where(eq(ingestJob.id, sql`(${claimable.getSQL()})`))
    .returning();
  return job ?? null;
}
```

Emitted SQL, printed from the installed Drizzle in this session
[VERIFIED: `.toSQL()` on drizzle-orm@0.45.2, run locally 2026-08-10]:

```
update "agentdock"."ingest_job"
   set "status" = $1, "attempts" = "agentdock"."ingest_job"."attempts" + 1,
       "started_at" = now(), "worker_id" = $2
 where "agentdock"."ingest_job"."id" = (
         select "id" from "agentdock"."ingest_job"
          where ("agentdock"."ingest_job"."status" = $3
             and "agentdock"."ingest_job"."next_attempt_at" <= now())
          order by "agentdock"."ingest_job"."next_attempt_at", "agentdock"."ingest_job"."id"
          limit $4 for update skip locked)
returning "id", "target", "status", "attempts", "next_attempt_at", ...
```

And executed live against PostgreSQL 16.14 with two concurrent transactions
[VERIFIED: live probe against `agentdock_test`, 2026-08-10]:

```
concurrent claim A [ { id: 1, target: 'anthropics/skills', worker: 'A' } ]
concurrent claim B [ { id: 3, target: 'obra/superpowers',  worker: 'B' } ]
third claim (queue empty) []
```

Transaction A held its row for 400 ms; B started 80 ms later, skipped A's locked row, and took
the next one. Neither blocked, neither came back empty, and neither took the other's row. That is
the whole proof `SKIP LOCKED` needs, and it is reproducible as a test (§10).

### Why the claim must be one statement

A `SELECT` followed by an `UPDATE` has a window between them in which a second worker can read the
same row. `SELECT ... FOR UPDATE` closes it *only if both statements sit inside one transaction*,
at which point you have a two-round-trip transaction that must be held open — and if the worker
dies between the two, the row is locked until the connection is reaped by TCP timeout rather than
by your reaper. The single statement is atomic by construction: the row lock, the status flip and
the `RETURNING` all happen in one commit. This is exactly the discipline `src/ingest/persist.ts`
already states in its own header comment — *"An application-level 'select then insert' races with
itself the moment two ingests overlap; ON CONFLICT cannot."*

### The dead-worker reaper: no heartbeat

```sql
UPDATE agentdock.ingest_job
   SET status = 'queued', started_at = NULL, worker_id = NULL
 WHERE status = 'running'
   AND started_at < now() - $1::interval
RETURNING id;
```

[VERIFIED: executed live, reclaimed a backdated row and returned it.]

| Option | Correct? | Cost | Verdict |
|---|---|---|---|
| `started_at < now() - interval '15 min'` sweep | Yes, given a bounded max runtime | One indexed UPDATE per minute | **Use this** |
| `heartbeat_at` column, updated every 30 s | Also yes, tighter reclaim | An UPDATE per job per 30 s, on the UPDATE-hottest table in the schema, forever | No |

The threshold is not arbitrary and it is not guesswork — it is derived from the caps this
codebase already enforces. `CAPS.wallClockMs = 120_000` bounds the whole file-reading stage
[VERIFIED: src/github/scan.ts:16 — `wallClockMs: 120_000,`] and `REQUEST_TIMEOUT_MS = 10_000`
bounds each individual call [VERIFIED: src/github/client.ts:16 —
`export const REQUEST_TIMEOUT_MS = 10_000;`]. A legitimate ingest therefore cannot exceed roughly
150 seconds. **900 seconds is six times the maximum legitimate runtime**, which is precisely what a
heartbeat buys you and what makes a heartbeat redundant. Put the threshold in a named constant
next to those caps so the relationship is visible and survives a future cap change.

Reclaiming is safe because re-running a job is safe: every write in `persistScan` is an upsert.
Note that `attempts` is *not* reset by the reaper — an abandoned job burns an attempt, which is
correct: a job that reliably kills its worker must eventually stop being retried.

**No unique-index hazard.** A reclaim moves `running → queued`, and the partial unique index
predicate is `status IN ('queued','running')`, so the row never leaves and never re-enters the
index. The transition cannot collide with a concurrent submit. This is a direct consequence of
including `'running'` in the predicate and is the second reason to do so.

### `LISTEN/NOTIFY` vs polling

**Poll.** At the unauthenticated ceiling of 30 ingests/hour, a 2 s poll issues ~1,800 queries an
hour against `ingest_job_claim_idx`, a partial index that is empty almost all the time — a
sub-millisecond index-only probe. `LISTEN/NOTIFY` would buy ~2 s of latency on a page that
already re-renders on a 1.5 s client interval, and would cost a dedicated held connection, a
`pg_notify` call or a trigger (a trigger is DDL, and this project spends its DDL budget
deliberately), plus reconnect-and-resubscribe handling for a connection that will drop. Reject.
`// ponytail: 2 s polling; add LISTEN/NOTIFY when someone complains about a 2 s wait, which they
won't.`

**Interval:** `found ? 0 : 2000`. Draining without a sleep matters the day Phase 5 enqueues 200
seeds at once; it is one ternary today.

---

## §3 Idempotency and duplicate submit

### Recommendation: a partial unique index. Exact DDL:

```sql
CREATE UNIQUE INDEX ingest_job_active_key
  ON agentdock.ingest_job (target)
  WHERE status IN ('queued', 'running');
```

Drizzle:

```ts
uniqueIndex('ingest_job_active_key')
  .on(t.target)
  .where(sql`${t.status} in ('queued','running')`),
```

`.where()` on an index builder exists in this Drizzle version
[VERIFIED: node_modules/drizzle-orm/pg-core/indexes.d.ts:67 — `where(condition: SQL): this;`].

| Mechanism | Verdict |
|---|---|
| **Partial unique index** | **Use.** Enforced by the database, cannot race, and returns the existing job id for free via `ON CONFLICT`. |
| `pg_advisory_xact_lock(hashtext(target))` | No. Serialises concurrent inserts but is not a constraint — nothing stops a duplicate row appearing across transactions, so you still need the check. Adds hash-collision reasoning for nothing. |
| Application `SELECT` then `INSERT` | No. Races with itself, for the reason `persist.ts` already documents. |

### Enqueue: dedupe onto the existing job

```ts
const [job] = await db
  .insert(ingestJob)
  .values({ target: fullName })
  .onConflictDoUpdate({
    target: ingestJob.target,
    targetWhere: sql`${ingestJob.status} in ('queued','running')`,
    set: { target: sql`excluded.target` },   // deliberate no-op
  })
  .returning({ id: ingestJob.id, status: ingestJob.status });
```

`targetWhere` exists [VERIFIED: node_modules/drizzle-orm/pg-core/query-builders/insert.d.ts:65 —
`targetWhere?: SQL;`], and the whole statement was executed live
[VERIFIED: live probe, PostgreSQL 16.14 + drizzle-orm@0.45.2, 2026-08-10]:

```
enqueue #1   [ { id: 1, status: 'queued' } ]
enqueue dup  [ { id: 1, status: 'queued' } ]   <- same id
enqueue #2   [ { id: 3, status: 'queued' } ]
```

**Trap the planner must encode.** `ON CONFLICT ... DO NOTHING ... RETURNING` returns **zero rows**
on conflict — verified live (`ON CONFLICT DO NOTHING ... RETURNING row count: 0`). A submit
handler written with `DO NOTHING` silently gets `undefined` and cannot redirect the user anywhere.
The no-op `DO UPDATE SET target = excluded.target` is what makes the existing id come back. Write
this as a comment in the code, not just in the plan.

Second verified fact: once the job reaches a terminal status it leaves the index, and a
re-submission mints a genuinely new job (`re-submit after done mints a NEW job: id 6`). That is
what makes "retry" require no retry-specific code path at all (§8).

Third, cosmetic: a conflicting `INSERT` still consumes an identity value, so `ingest_job.id` has
gaps (1 → 3 above). Do not present job ids as a count of anything.

### UI behaviour on a duplicate submit

**Dedupe, do not reject.** Redirect to `/jobs/{existingId}` and let the status page say
"Already queued — watching the existing job." Rejecting tells a user they did something wrong when
they did the ordinary thing, and gives them nothing to click.

One accepted imprecision, worth a code comment: if a job for repo X is already `running` and the
user submits X again because they just pushed a commit, they are deduped onto a run that already
read the older tree. The honest fix is a re-queue-after-completion flag; the honest assessment is
that it is not worth a column in Phase 2. `// ponytail: dedupe onto the running job; add a
"re-run requested" flag the first time someone actually notices.`

---

## §4 Commit-SHA short circuit (ING-12) and the freshness trade-off

### The cheapest correct way to learn HEAD, unauthenticated

There is none cheaper than 1 core call, and every candidate costs exactly 1:

| Call | Core cost | Gives |
|---|---|---|
| `GET /repos/{o}/{r}/git/trees/HEAD?recursive=1` | 1 | **commit sha *and* the whole tree** |
| `GET /repos/{o}/{r}/commits/HEAD` | 1 | commit sha only |
| `GET /repos/{o}/{r}/git/ref/heads/{branch}` | 1 | commit sha only; needs the branch name first |
| `GET /repos/{o}/{r}` | 1 | metadata, **no head sha** |

The project already makes the best of these: `fetchRepoTree` reads `json.sha` off the recursive
tree response and asserts it is a 40-hex commit sha
[VERIFIED: src/github/tree.ts:38-41 — `const commitSha = String(json.sha ?? ''); if
(!SHA40.test(commitSha)) { throw new GitHubError('unavailable', 'GitHub returned a tree without a
usable commit SHA.'); }`]. So the sha arrives for free inside a call already being made.

### The honest arithmetic

`fetchRepoScanInputs` issues both core calls concurrently before anything else
[VERIFIED: src/github/scan.ts:44-47 — `const [metadata, tree] = await Promise.all([
fetchRepoMetadata(owner, repo), fetchRepoTree(owner, repo), ]);`].

| | Core calls | Raw fetches | Wall clock |
|---|---|---|---|
| Full ingest today | 2 | up to 200 | up to 120 s |
| With the sha short circuit | **2** | **0** | ~1 s |

**The short circuit saves zero core quota.** Both calls are spent before the sha is known, and you
want the metadata call anyway. What it saves is up to 200 raw fetches at concurrency 2 and up to
120 seconds of wall clock, plus the `raw.githubusercontent.com` abuse-throttle exposure that
`scan.ts` already warns about in its header comment.

Is that worth the code? **Yes, and the code is about five lines** — `fetchRepoScanInputs` takes an
optional `knownSha`, and returns early with an empty `files` map when `tree.commitSha === knownSha`.
No new call, no reordering, no new failure mode. Ship it, and state in the plan that it is a
latency and throttle optimisation, not a quota one. ROADMAP criterion 4 says *"completes without
re-reading its files"* — which this satisfies exactly and literally.

**Explicitly do NOT build the `pushed_at` gate in this phase.** Comparing `repository.pushed_at` to
the freshly-fetched `pushed_at` *would* let you skip the tree call and halve core cost to 1 — but
it is only sound for an automated sweep, it depends on an unverified assumption that `pushed_at`
never fails to move when the default branch does, and a user who clicks "re-index" has explicitly
asked you to look. It belongs in Phase 8's batched refresh, where the quota maths actually matters.
[ASSUMED — the `pushed_at`-always-moves property was not verified this session.]

### What a "no change" run must still update, and what it must skip

Repository metadata moves independently of the commit sha; `repo.ts` already reads all of it
[VERIFIED: src/github/repo.ts:23-42 — returns `githubNodeId, fullName, owner, defaultBranch,
description, homepage, licenseSpdx, stars, isFork, isArchived, topics, pushedAt, etag`].

| On a no-change run | Action |
|---|---|
| `repository`: `stars`, `description`, `homepage`, `topics`, `is_archived`, `is_fork`, `license_spdx`, `full_name`, `default_branch`, `pushed_at`, `etag`, `scanned_at`, `last_ingested_sha` | **UPDATE.** Cheap, already fetched, and `scanned_at` is the field PRV-02 shows as "when AgentDock last looked." |
| `package` rows | **Do not touch.** No upsert, no `updated_at` bump, and above all no delisting. |
| `package_version` rows | **Do not touch.** |
| `ingest_attempt` | INSERT one row with `outcome = 'unchanged'` and all diff counters zero. |

Concretely, this means the short-circuit path must call a *narrow* repository-only upsert, not
`persistScan`. Bumping `package.updated_at` on a no-change run would corrupt `package_live_idx`'s
ordering [VERIFIED: src/db/schema.ts:128 — `index('package_live_idx').on(t.type,
t.updatedAt.desc()),`], making every unchanged repo re-surface at the top of the listing.

### ETag conditional requests: do not implement in this phase

Phase 1 measured a 304 consuming quota (`used` 11 → 12) and identified why: GitHub's exemption is
worded *"does not count against your primary rate limit if a `304` response is returned and the
request was made **while correctly authorized**"* — unauthenticated is not correctly authorized
[VERIFIED: .planning/phases/AGD-01-walking-skeleton/RESEARCH.md:341-343]. Keep writing the `etag`
column (DAT-04 requires it, and it is already populated). Implement nothing on top of it. The
ROADMAP's plan line "02-02: … ETag conditional requests …" should be struck or rewritten as
"store the ETag; conditional requests deferred until a token exists."

---

## §5 Ingestion attempt history schema

### Verdict: TWO tables

The queue row and the attempt row have opposite mutability and opposite access patterns, and that
is the argument — not tidiness.

`ingest_job` is UPDATE-hot: every claim, every reap, every terminal transition rewrites it. In
PostgreSQL each of those creates a dead tuple. Keeping the row **narrow and free of `jsonb`/long
`text`** is what keeps those updates HOT (heap-only) and keeps the claim index small and the
autovacuum cheap. Hanging ten counters, a commit sha and a sanitized error string off that row
guarantees non-HOT updates on the hottest table in the schema. `ingest_attempt` is INSERT-only and
never updated after it terminates, so it can be as wide as the UI needs.

The behavioural argument seconds it: with the retry policy in §8, a job that fails twice and then
succeeds is a *single* `ingest_job` row. In one table, attempts 1 and 2 are overwritten and the
maintainer sees `attempts = 3, succeeded` with no record of the two rate-limit walls that caused
it. Diagnosing ingestion is the entire point of this phase.

The rejected middle option is a `jsonb` array of attempts on the job row: it restores the history
but keeps the width on the hot row *and* makes "show me every `rate_limited` failure this week" a
`jsonb_array_elements` scan instead of a `WHERE outcome = 'rate_limited'`.

### Drizzle schema (append to `src/db/schema.ts`)

```ts
/**
 * The queue. Deliberately narrow: every claim, reap and terminal transition
 * UPDATEs this row, so anything wide belongs in ingest_attempt instead.
 *
 * No `kind` column. Phase 5's registry-sync and search-shard jobs are a
 * different shape and a five-line migration away; guessing at their key now
 * would cost the same migration and be wrong.
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
    // Both the retry-backoff schedule and the rate-limit-reset schedule land here.
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    // Set on claim, cleared on reap. This column IS the liveness signal — see §2.
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    workerId: text('worker_id'),
  },
  (t) => [
    // Both dedupes duplicate submits AND makes the reaper's running->queued
    // transition collision-free, because the row never leaves the index.
    uniqueIndex('ingest_job_active_key')
      .on(t.target)
      .where(sql`${t.status} in ('queued','running')`),
    // The claim's only index. Partial, so it holds only claimable rows.
    index('ingest_job_claim_idx')
      .on(t.nextAttemptAt)
      .where(sql`${t.status} = 'queued'`),
    // The reaper's scan, and the "what is running" panel.
    index('ingest_job_running_idx').on(t.startedAt).where(sql`${t.status} = 'running'`),
  ],
);

/**
 * Append-only. One row per claim, written exactly once when the attempt ends,
 * inside the same transaction as the artifact writes (see §6).
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

    // Exactly the IngestOutcome union in src/ingest/errors.ts, plus 'unchanged'.
    // Not a free string: this value is rendered and is filtered on.
    outcome: text('outcome').notNull(),
    // The reason a person reads. Drawn ONLY from OUTCOME_MESSAGES — never from
    // an exception's .message. See §9.
    errorDetail: text('error_detail'),

    commitSha: text('commit_sha'),
    filesRead: integer('files_read').notNull().default(0),
    artifactsFound: integer('artifacts_found').notNull().default(0),
    artifactsNew: integer('artifacts_new').notNull().default(0),
    artifactsUpdated: integer('artifacts_updated').notNull().default(0),
    artifactsUnchanged: integer('artifacts_unchanged').notNull().default(0),
    artifactsRemoved: integer('artifacts_removed').notNull().default(0),
    parseFailed: integer('parse_failed').notNull().default(0),
    // True when the tree was cut short OR a file-read cap was reached — the two
    // are indistinguishable to a reader, and both mean "this listing is partial".
    truncated: boolean('truncated').notNull().default(false),

    rateRemaining: integer('rate_remaining'),
    rateReset: timestamp('rate_reset', { withTimezone: true }),
  },
  (t) => [
    // The status page's only query: the latest attempt for a job.
    index('ingest_attempt_job_idx').on(t.jobId, t.attemptNo.desc()),
  ],
);
```

### Resulting SQL (what `bun run db:generate` must produce, and what review must confirm)

```sql
CREATE TABLE "agentdock"."ingest_job" (
  "id"              bigserial PRIMARY KEY NOT NULL,
  "target"          text NOT NULL,
  "status"          text NOT NULL DEFAULT 'queued',
  "attempts"        smallint NOT NULL DEFAULT 0,
  "next_attempt_at" timestamp with time zone NOT NULL DEFAULT now(),
  "requested_at"    timestamp with time zone NOT NULL DEFAULT now(),
  "started_at"      timestamp with time zone,
  "finished_at"     timestamp with time zone,
  "worker_id"       text
);

CREATE TABLE "agentdock"."ingest_attempt" (
  "id"                  bigserial PRIMARY KEY NOT NULL,
  "job_id"              bigint NOT NULL,
  "attempt_no"          smallint NOT NULL,
  "started_at"          timestamp with time zone NOT NULL,
  "finished_at"         timestamp with time zone NOT NULL DEFAULT now(),
  "outcome"             text NOT NULL,
  "error_detail"        text,
  "commit_sha"          text,
  "files_read"          integer NOT NULL DEFAULT 0,
  "artifacts_found"     integer NOT NULL DEFAULT 0,
  "artifacts_new"       integer NOT NULL DEFAULT 0,
  "artifacts_updated"   integer NOT NULL DEFAULT 0,
  "artifacts_unchanged" integer NOT NULL DEFAULT 0,
  "artifacts_removed"   integer NOT NULL DEFAULT 0,
  "parse_failed"        integer NOT NULL DEFAULT 0,
  "truncated"           boolean NOT NULL DEFAULT false,
  "rate_remaining"      integer,
  "rate_reset"          timestamp with time zone
);

ALTER TABLE "agentdock"."ingest_attempt"
  ADD CONSTRAINT "ingest_attempt_job_id_ingest_job_id_fk"
  FOREIGN KEY ("job_id") REFERENCES "agentdock"."ingest_job"("id") ON DELETE cascade;

CREATE UNIQUE INDEX "ingest_job_active_key" ON "agentdock"."ingest_job" ("target")
  WHERE "agentdock"."ingest_job"."status" in ('queued','running');
CREATE INDEX "ingest_job_claim_idx"   ON "agentdock"."ingest_job" ("next_attempt_at")
  WHERE "agentdock"."ingest_job"."status" = 'queued';
CREATE INDEX "ingest_job_running_idx" ON "agentdock"."ingest_job" ("started_at")
  WHERE "agentdock"."ingest_job"."status" = 'running';
CREATE INDEX "ingest_attempt_job_idx" ON "agentdock"."ingest_attempt" ("job_id","attempt_no" DESC);
```

Every object is schema-qualified to `agentdock`, no `DROP` appears, and no other schema is named —
so `bun run check:boundaries` passes. Confirm this by reading the generated file, not by assuming
it.

**Design notes the planner should not relitigate.**
- No `kind` column, and no `priority` column. Both are Phase 5's, and Phase 5 pays the same
  five-line migration either way. Guessing now buys nothing.
- No `progress jsonb` for live step-by-step progress. An ingest is 1–150 seconds; the status page
  shows queued → running → terminal, and that is what criterion 1 asks for.
- `status` is a `text` column with a comment, not an enum and not a `CHECK`. This matches the
  precedent already set for exactly this reason [VERIFIED: src/db/schema.ts:52-64 — *"widening a
  CHECK constraint on a populated table is a DROP CONSTRAINT, which this project's boundary
  scanner treats as destructive"*]. Enforce the union in TypeScript.
- `attempts` is denormalised onto the job so the claim's `WHERE` never needs a join.

---

## §6 Transaction boundaries and "last good state survives"

### The structure

```
1. claim                          COMMIT #1   (one statement: status=running, attempts+1)
2. denylist check                 read only
3. GitHub: metadata + tree        network, NO transaction open
4. short circuit?  ── yes ──▶  5b
5. GitHub: raw file reads         network, NO transaction open
6. detect + parse                 pure, in memory
7. persistScan(scan, job)         COMMIT #2   ◀── everything below is ONE transaction
     ├ upsert repository
     ├ upsert every package
     ├ insert every package_version (ON CONFLICT DO NOTHING)
     ├ delist packages absent from this scan  ── SKIPPED if truncated, see below
     ├ INSERT ingest_attempt
     └ UPDATE ingest_job SET status, finished_at
   5b. narrow repository-only upsert + ingest_attempt + job terminal   COMMIT #2'
```

**All artifact writes for a repository go in one transaction.** This is already true and already
correct [VERIFIED: src/ingest/persist.ts:21 — `return db.transaction(async (tx) => {`, with the
delisting inside it and its own comment explaining why: *"Same transaction as the upserts.
Delisting first would leave a window in which a live package reads as delisted; a separate
transaction would leave that window open permanently on a crash."*].

**The job's terminal state must be committed inside that same transaction.** This is the change
Phase 2 makes, and it answers the "process dies between the artifact commit and the job-status
commit" question by **eliminating that window entirely**. `persistScan` takes the job id and the
attempt payload, and its last two statements inside the existing `tx` are the `ingest_attempt`
INSERT and the `ingest_job` UPDATE. Cost: two parameters.

That is worth doing rather than tolerating, even though the two-transaction fallback is survivable
(the reaper reclaims a `running` job whose artifacts already landed, the re-run is a no-op by
upsert, and it reports zero new). Survivable costs 2 core calls out of 60/hour and produces a
confusing duplicate attempt row. One transaction costs two parameters.

**Why the long GitHub fetch is outside the transaction** — and must stay outside. Steps 3–6 take up
to 150 seconds. An open transaction across them would pin an `xmin` for that whole window,
blocking vacuum on a shared database that another application depends on. The transaction opens
only for the DB-only write, which is milliseconds.

**A failed ingest cannot destroy the previously visible index**, because a failure in steps 2–6
means the transaction never opened. Verified by reading the code: `persistScan(scan)` is reached
only on the success path, after all fetching [VERIFIED: src/ingest/pipeline.ts:168 — `const
persisted = await persistScan(scan);`, inside the `try` at line 75, with every GitHub failure
caught at line 194 and converted to an outcome without any write].

### The one real bug this phase must fix

**`persist.ts` delists packages it merely failed to read.** The delisting predicate is
[VERIFIED: src/ingest/persist.ts:128-134]:

```ts
.where(
  and(
    eq(packageTable.repositoryId, repo.id),
    isNull(packageTable.delistedAt),
    packageIds.length > 0 ? not(inArray(packageTable.id, packageIds)) : sql`true`,
  ),
)
```

`packageIds` contains only artifacts whose file was actually read. But `fetchRepoScanInputs` drops
files on three separate paths, each of which merely appends to `skipped`
[VERIFIED: src/github/scan.ts:57-78 — `const skipped = wanted.slice(CAPS.maxFiles);`, then
`if (Date.now() > deadline) { skipped.push(path); continue; }`, then
`catch { skipped.push(path); }`] — and `pipeline.ts` silently skips those candidates
[VERIFIED: src/ingest/pipeline.ts:93-94 — `if (raw === undefined) continue; // a cap was reached;
already counted as skipped`].

So: a repo with 250 skills is capped at `CAPS.maxFiles = 200`, and the 50 unread ones are marked
`delisted_at = now()` and vanish from the site. A transient network blip on ten files delists ten
skills. This is exactly the failure ROADMAP criterion 2 is trying to prevent, and it exists today.

**Fix, and it is small:** skip the delisting step entirely when `scan.treeTruncated` is true.

```ts
// A partial read is not evidence of absence. Delisting on an incomplete scan
// deletes real artifacts because a cap fired, which is the one way a failed
// ingest can destroy the previously visible index.
const delisted = scan.treeTruncated ? [] : await tx.update(packageTable)/* ...unchanged... */;
```

`scan.treeTruncated` already carries exactly the right meaning — it is set to
`inputs.tree.truncated || inputs.artifactsTruncated`
[VERIFIED: src/ingest/pipeline.ts:164 — `treeTruncated: inputs.tree.truncated ||
inputs.artifactsTruncated,`] and `artifactsTruncated` is `skipped.length > 0`
[VERIFIED: src/github/scan.ts:88 — `artifactsTruncated: skipped.length > 0,`]. No new plumbing.

This must be a task with its own regression test, not a line in another task.

---

## §7 Diffing for the re-index counters

### The algorithm: one extra SELECT, no `xmax` trick

Inside the existing transaction, before any upsert:

```ts
const before = await tx
  .select({
    id: packageTable.id,
    type: packageTable.type,
    sourcePath: packageTable.sourcePath,
    delistedAt: packageTable.delistedAt,
  })
  .from(packageTable)
  .where(eq(packageTable.repositoryId, repo.id));

const key = (t: string, p: string) => `${t} ${p}`;
const priorLive = new Map(before.filter(r => !r.delistedAt).map(r => [key(r.type, r.sourcePath), r]));
```

Then, per scanned package (the loop that already exists), classify from two facts you already have:
whether the key existed before, and whether the `package_version` insert returned a row.

| Existed before | `package_version` insert returned a row | Counter |
|---|---|---|
| no | yes (always, for a new package) | `artifacts_new` |
| yes | yes — a new `content_hash` | `artifacts_updated` |
| yes | no — `ON CONFLICT DO NOTHING` fired | `artifacts_unchanged` |
| — | — | `artifacts_removed` = the delisting UPDATE's `RETURNING` length |

`inserted.length` is already computed [VERIFIED: src/ingest/persist.ts:101-119 — the
`.onConflictDoNothing({ target: [packageVersion.packageId, packageVersion.contentHash] })
.returning({ id: packageVersion.id })` whose length feeds `newVersions += inserted.length;`], so
the only new code is the pre-SELECT and a four-way `if`.

**Reject the `RETURNING (xmax = 0) AS inserted` trick.** It is shorter, it works, and it depends on
a transaction-id internal that is not part of PostgreSQL's contract and reads as magic at 3am. One
indexed SELECT of a few dozen rows per repo is not a cost worth that.

Also note: a package that was `delisted` and reappears counts as **updated**, not new — the row and
its id survive, and the upsert clears the tombstone. That is deliberate; see below.

### An artifact whose content is unchanged but whose commit sha moved

**No version row is created, and none should be.** `package_version` is unique on
`(package_id, content_hash)` [VERIFIED: src/db/schema.ts:160 —
`unique('package_version_content_key').on(t.packageId, t.contentHash),`], and the insert is
`ON CONFLICT DO NOTHING`. So `package_version.commit_sha` keeps the sha at which that content was
*first* seen.

**Do not "fix" this by updating `commit_sha` on conflict.** A `package_version` row is an immutable
snapshot: `content_hash` is a claim about the bytes *at* `commit_sha`, and rewriting the sha while
keeping the hash breaks that pairing. The permalink still resolves — GitHub does not garbage-collect
reachable commits, and the file at the older commit is byte-identical by definition of the hash.
Freshness is not lost either: `repository.scanned_at` moves on every run and is what PRV-02 renders
as "when AgentDock last looked," while `package_version.ingested_at` correctly means "when this
content first appeared." Both facts stay available and both stay true.

### An artifact that disappears from the new tree

Set `delisted_at` — already implemented [VERIFIED: src/ingest/persist.ts:125-135], now guarded by
the truncation check from §6.

**What un-deletes it: the existing upsert, already.** The package upsert's conflict branch sets
`delistedAt: null` [VERIFIED: src/ingest/persist.ts:93 — `delistedAt: null,` inside
`.onConflictDoUpdate({ target: [repositoryId, type, sourcePath], set: { ... } })`]. So a file that
returns at the same path revives the same row with the same id, the same permalink, and its full
version history intact. No un-delete code is needed and none should be written.

The known limitation is unchanged from Phase 1 and stays accepted: a *moved* file
(`skills/foo/SKILL.md` → `skills/bar/SKILL.md`) reads as one removal plus one addition, because
path is identity. `// ponytail: path is identity; add rename carry-forward when user data attaches
to package ids.`

---

## §8 Retry policy

### Classification of the nine existing outcomes

Every value below is quoted from the live union [VERIFIED: src/ingest/errors.ts:3-12 —
`'ok' | 'invalid_input' | 'denylisted' | 'unreadable' | 'rate_limited' | 'too_large' |
'no_artifacts' | 'unavailable' | 'storage_failed'`].

| Outcome | Job status | Retry? | Why |
|---|---|---|---|
| `ok` | `succeeded` | — | |
| `invalid_input` | never enqueued | — | Rejected by `normalizeRepo` at the Server Action, before a row exists. If it ever reaches the worker, that is a bug: fail terminal and log it. |
| `denylisted` | `succeeded` | No | The job did its work; the answer is "no". Better: check the denylist at enqueue and never create the row. |
| `no_artifacts` | `succeeded` | No | A true, stable answer about the repository. |
| `unreadable` | `failed` | **No** | GitHub returns a byte-identical response for absent and private, so the answer will not change on retry. On a 60/hour budget, three retries burn six calls to learn the same thing. |
| `too_large` | `failed` | No | Deterministic: the tree exceeds the 8 MB cap and will again. |
| `unavailable` | `failed` after max | **Yes** | Network, DNS, 5xx, timeout. Genuinely transient. |
| `storage_failed` | `failed` after max | **Yes** | A database blip. Retrying is safe because every write is an upsert. |
| `rate_limited` | stays `queued` | **Scheduled, not retried** | See below. |

### Bounded backoff

```ts
const MAX_ATTEMPTS = 3;

/** Pure, so it is unit-testable without a clock. */
export function backoffMs(attempts: number): number {
  return Math.min(60_000 * 2 ** (attempts - 1), 15 * 60_000);  // 60s, 120s, 240s … capped
}
```

On a retryable failure with `attempts < MAX_ATTEMPTS`: leave `status = 'queued'`, set
`next_attempt_at = now() + backoffMs(attempts)`, clear `started_at` and `worker_id`, and write the
`ingest_attempt` row. On `attempts >= MAX_ATTEMPTS`: `status = 'failed'`, `finished_at = now()`.

Two consequences worth stating explicitly:

- **A retry never leaves the partial unique index.** A retrying job stays `queued`, so it never has
  to re-enter the index, so it can never collide with a submit that arrived in the meantime. Had
  retry been modelled as `failed → queued`, that collision would be a real and rare production
  error. This is the second design decision that falls out of putting `'running'` in the predicate.
- **User-initiated retry needs no code.** A terminally `failed` job has left the index, so
  re-submitting the repo mints a fresh job — verified live in §3. The "Retry" button on the status
  page is a form posting to the same Server Action. ROADMAP criterion 5 is satisfied by the
  submit path that already exists.

No jitter. Jitter exists to decorrelate many workers; there is one.
`// ponytail: no jitter, one worker.`

### Rate-limit exhaustion is a schedule, not a backoff

`GitHubError` already carries the parsed headers [VERIFIED: src/github/client.ts:19-28 — the
constructor's third parameter `readonly rateLimit?: RateLimit`, and src/github/client.ts:84-88
which reads `x-ratelimit-reset` into `state.reset`], and `pipeline.ts` already extracts it
[VERIFIED: src/ingest/pipeline.ts:196 — `const reset = error instanceof GitHubError ?
error.rateLimit?.reset : undefined;`].

```ts
// Not a failure of the job — a failure of the budget. attempts is NOT incremented,
// because a job must not exhaust its retries waiting for a clock.
nextAttemptAt = new Date(Math.min(reset * 1000, Date.now() + 60 * 60 * 1000));
status = 'queued';
attempts = attempts - 1;   // undo the increment the claim applied
```

The clamp matters: `reset` is attacker-adjacent input (a response header). A malformed or hostile
value must not park a job in the year 3000. GitHub's window is one hour, so `now + 1h` is the
correct ceiling.

### The part that satisfies criterion 6 — "backoff rather than a wall of errors"

Deferring one job is not enough. If the budget is gone, every job hits the same wall, and claiming
the next one burns a call to learn it. Two guards, three lines each:

```ts
// 1. Preemptive, before claiming. An ingest costs 2 core calls.
const rl = rateLimitState();
if (rl && rl.remaining < 2) { pausedUntil = rl.reset * 1000; }

// 2. In the loop, before claimJob().
if (Date.now() < pausedUntil) { await sleep(5_000); continue; }
```

`rateLimitState()` already exists and already returns the most recent headers seen
[VERIFIED: src/github/client.ts:30-34 — `let lastRateLimit: RateLimit | null = null; export
function rateLimitState(): RateLimit | null { return lastRateLimit; }`]. This is ING-08's "backs
off *before* exhaustion" and it costs a module-level number. `pausedUntil` is process-local, which
is correct: with one worker there is nothing to coordinate, and persisting it would be a second
source of truth about a fact GitHub already tells you on every response.

---

## §9 Structured logging

`src/log.ts` is already the right shape — a single closed union with no free-form field, and its
header already states why [VERIFIED: src/log.ts:14-18 — *"The field set is closed on purpose: a
free-form payload parameter is how a response body, a header, or a connection string ends up in a
log file six months from now."*]. Phase 2 extends it and closes one remaining hole.

```ts
import type { IngestOutcome } from '@/ingest/errors';

type IngestLog = {
  event: 'ingest';
  jobId: number;
  attempt: number;
  owner: string;
  repo: string;
  commitSha: string | null;
  // Was `outcome: string`. Narrowing it to the union is the whole guarantee:
  // a caller can no longer pass an exception message where an outcome belongs.
  outcome: IngestOutcome | 'unchanged';
  found: number;
  stored: number;
  failed: number;
  newCount: number;
  updated: number;
  unchanged: number;
  removed: number;
  truncated: boolean;
  durationMs: number;
  rateRemaining: number | null;
  rateReset: number | null;
};
```

### The mechanism that guarantees a secret can never appear

It is not a redaction regex. It is four structural properties, in order of strength:

1. **The type has no field that accepts an arbitrary object, array, or `unknown`.** Every field is
   a number, a boolean, a `string | null` with a documented provenance, or a closed union. There is
   no `payload`, no `meta`, no `...rest`. A caller that wants to log a response body has nowhere to
   put it, and `tsc --noEmit` — already in `bun run ci` — fails them.
2. **`outcome` is a union, not a string.** This is the hole Phase 2 closes. `outcome: string`
   accepts `String(error)`; `outcome: IngestOutcome` does not.
3. **The only human-readable text anywhere is `OUTCOME_MESSAGES[outcome]`**, a nine-entry frozen
   record of hand-written constants that interpolates nothing [VERIFIED: src/ingest/errors.ts:19
   — `export const OUTCOME_MESSAGES: Record<Exclude<IngestOutcome, 'ok'>, string> = {`, with the
   comment at lines 14-18: *"the only strings that reach the interface. Nothing here interpolates
   an exception, a hostname, a query, or a token — there is no code path along which one could."*].
   The same rule now governs `ingest_attempt.error_detail`: it is assigned from `messageFor()` and
   from nothing else, ever.
4. **The exception never crosses the boundary.** `githubFetch` throws a fresh `GitHubError` and
   discards the original entirely, with the reason written down [VERIFIED: src/github/client.ts:133-137
   — `} catch { // The token lives in \`headers\`, which some runtimes attach to a fetch error.
   Nothing from the cause is propagated for that reason. throw new GitHubError('unavailable',
   'AgentDock could not reach GitHub.'); }`]. Postgres notices are suppressed for the same reason
   [VERIFIED: src/db/client.ts:16 — `// Server notices echo statement text, which can carry values.
   onnotice: () => {},`].

**The check that keeps it true** (§10): a unit test that constructs a log line for every outcome
and asserts the serialized string contains neither `process.env.DATABASE_URL` nor a synthetic
token value planted in `process.env.GITHUB_TOKEN`. It is five lines and it is the runnable proof
QUA-06 and ING-09 need.

---

## §10 Testing a queue without flakiness

### No injectable clock. Backdate the rows instead.

The temptation is a `Clock` interface. Resist it: the timestamps that matter live in PostgreSQL
and are written by `now()`, so a TypeScript clock cannot move them anyway. Two mechanisms replace
it, both simpler:

1. **The reaper takes its threshold as a parameter**, and the test backdates a row directly:
   ```ts
   await sql`UPDATE agentdock_test.ingest_job
                SET started_at = now() - interval '20 minutes' WHERE id = ${id}`;
   expect(await reapAbandoned('15 minutes')).toHaveLength(1);
   ```
   This is exactly what the live probe did in §2, and it reclaimed the row. Deterministic, no fake
   timers, no `vi.useFakeTimers()` fighting `postgres.js`.
2. **Backoff is a pure function.** `backoffMs(1) === 60_000`, `backoffMs(9) === 900_000`. The caller
   does `new Date(Date.now() + backoffMs(n))` and is not itself tested. Zero abstraction.

Similarly, do not fake the poll loop's `sleep`. Test `claimJob`, `reapAbandoned` and `runJob`
directly and never start `runWorker()` in a test. `// ponytail: the loop is three lines and a
while; test its parts, not the while.`

### Proving `SKIP LOCKED` in one test

Two concurrent transactions, one holding its row briefly:

```ts
describe.skipIf(!DB_URL)('claimJob', () => {
  it('two concurrent claims take different jobs and neither blocks', async () => {
    await enqueue('test-owner/skip-locked-a');
    await enqueue('test-owner/skip-locked-b');

    const [a, b] = await Promise.all([
      db.transaction(async (tx) => {
        const claimed = await claimJobIn(tx, 'A');
        await new Promise((r) => setTimeout(r, 300));   // hold the row lock
        return claimed;
      }),
      (async () => {
        await new Promise((r) => setTimeout(r, 50));    // start inside A's window
        return db.transaction((tx) => claimJobIn(tx, 'B'));
      })(),
    ]);

    expect(a).not.toBeNull();
    expect(b).not.toBeNull();                            // B did NOT block on A
    expect(a!.id).not.toBe(b!.id);                       // and did NOT take A's row
  });
});
```

The 300 ms / 50 ms pair is the only timing in the suite and it is a 6× margin, not a race: B needs
only to *start* inside A's window, and a local `UPDATE` completes in single-digit milliseconds.
This test was run in its raw-SQL form during this research and passed
[VERIFIED: live probe, PostgreSQL 16.14, 2026-08-10].

### Fitting the existing conventions

- **Live-DB tests guard on `DB_URL`, not on `CI`.** The established pattern is
  `describe.skipIf(!DB_URL)` [VERIFIED: src/ingest/persist.test.ts:57 —
  `describe.skipIf(!DB_URL)('persistScan', () => {`; same at src/ingest/pipeline.test.ts:84 and
  src/db/client.test.ts:6]. `vitest.config.ts` loads `.env` only when `CI` is unset
  [VERIFIED: vitest.config.ts — `if (!process.env.CI && existsSync('.env'))
  process.loadEnvFile('.env');`], so `CI=1 bun run test` locally reproduces the runner exactly.
- **DB tests write to `agentdock_test`**, set before any schema import, because the schema module
  reads the variable at module load [VERIFIED: src/ingest/persist.test.ts:7 —
  `process.env.DATABASE_SCHEMA = 'agentdock_test';` with the comment *"The schema module reads this
  at import time, hence the assignment before any import of it."*].
- **Sentinel targets, not real repo names.** Vitest runs files in parallel against one test schema,
  and `ingest_job_active_key` is unique on `target` — two suites enqueueing `anthropics/skills`
  would collide. Use `test-owner/queue-spec-*`, following the precedent
  [VERIFIED: src/ingest/persist.test.ts:15-16 — `const FULL_NAME = 'test-owner/persist-spec';`
  with the comment explaining the exact collision].
- **The new migration must be applied to the test schema too** — `bun run db:test:setup` regenerates
  into `.drizzle-test`. Add it to the plan's setup step or every DB test in the phase fails at once.

### The tests this phase owes

| Test | Type | Runs in CI without a DB? |
|---|---|---|
| `backoffMs` shape and cap | unit | yes |
| outcome → retryable/terminal classification | unit | yes |
| log line contains no secret, for all outcomes | unit | yes |
| enqueue dedupes onto the existing job id | integration | no |
| enqueue after terminal mints a new job | integration | no |
| two concurrent claims, `SKIP LOCKED` | integration | no |
| reaper reclaims a backdated `running` row | integration | no |
| **truncated scan does NOT delist** (§6 regression) | integration | no |
| unchanged re-ingest reads zero files and mints zero versions | integration | no |
| crash-shaped: artifacts + job terminal are one commit | integration | no |
| submit Server Action: success, duplicate, invalid input (QUA-04) | integration | no |

The four unit rows are the CI-visible ones. The frozen fixtures in `fixtures/` (five corpora
including `adversarial` and `xss`) are the input for the unchanged-re-ingest and truncation tests
via `bun run db:seed`, so those need no network and no token.

---

## Don't Hand-Roll

| Problem | Don't build | Use instead | Why |
|---|---|---|---|
| Two workers claiming one job | A `locked_by` compare-and-swap loop, a mutex, an advisory lock | `UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1)` | One statement, atomic by construction, verified live. |
| Duplicate submit | `SELECT` then `INSERT`, or a `Set` of in-flight targets | Partial unique index + `ON CONFLICT ... targetWhere ... DO UPDATE` | Races cannot be fixed in application code; a constraint cannot race. |
| Detecting a dead worker | Heartbeat table, `SELECT pg_stat_activity`, PID files | `started_at < now() - interval '15 min'` | The 120 s wall-clock cap already bounds legitimate runtime at 6× below the threshold. |
| Idempotent re-ingest | Diffing logic, "have I seen this?" caches | `package_version_content_key` + `ON CONFLICT DO NOTHING` | Already built in Phase 1, already correct. |
| Undoing a delisting | An "un-delete" code path | `delistedAt: null` in the existing upsert's conflict branch | Already built. Adding a second path creates two truths. |
| Job scheduling / cron | `node-cron`, a scheduler library | `next_attempt_at` + the poll loop's `WHERE next_attempt_at <= now()` | The column *is* the scheduler. Backoff and rate-limit-reset both land in it. |
| Not logging secrets | A redaction regex over the log line | A closed TypeScript union with no free-form field | A regex is a filter that must anticipate every shape; a type is a wall the compiler enforces. |
| Deterministic time in tests | A `Clock` interface injected everywhere | Backdate rows in SQL; keep `backoffMs` pure | The timestamps live in PostgreSQL, where a TypeScript clock has no reach. |

**Key insight:** every durability property this phase needs is already a PostgreSQL feature the
project can express in Drizzle. The failure mode to guard against is not missing capability — it is
re-implementing atomicity in TypeScript, which is exactly how a queue develops a race that
reproduces once a month.

---

## Common Pitfalls

### Pitfall 1: `ON CONFLICT DO NOTHING ... RETURNING` returns nothing
**What goes wrong:** the submit handler gets `undefined` on a duplicate and cannot redirect.
**Why:** `DO NOTHING` produces no row for `RETURNING` to return — measured live: row count 0.
**Avoid:** `DO UPDATE SET target = excluded.target`, a deliberate no-op that yields the existing id.
**Warning sign:** duplicate submits render a blank page or throw on `job.id`.

### Pitfall 2: delisting on an incomplete scan
**What goes wrong:** capped or failed file reads mark real packages `delisted_at` and they vanish.
**Why:** the predicate is `id NOT IN (packageIds)` and `packageIds` holds only successfully-read
artifacts. This is live in the code today (§6).
**Avoid:** skip delisting entirely when `scan.treeTruncated`.
**Warning sign:** re-ingesting a large repo reduces its listed skill count.

### Pitfall 3: `register()` fires more than once in dev, or not until the first request
**What goes wrong:** two poll loops, or no poll loop until someone loads a page.
**Why:** documented Next behaviour, not a project bug.
**Avoid:** a module-level `started` guard (for the first) and an explicit verification step against
`next start` (for the second). `SKIP LOCKED` already makes the first harmless.
**Warning sign:** duplicated boot log lines; a `queued` row that never moves on a fresh server.

### Pitfall 4: modelling retry as `failed → queued`
**What goes wrong:** a unique-violation on `ingest_job_active_key` when a submit landed while the
job sat in `failed`.
**Why:** `failed` is outside the index predicate, so re-entering it can collide.
**Avoid:** a retrying job never leaves `queued`; only exhausted jobs become `failed`.
**Warning sign:** a rare `duplicate key value violates unique constraint "ingest_job_active_key"`.

### Pitfall 5: incrementing `attempts` on rate-limit exhaustion
**What goes wrong:** three quiet hours of exhausted quota permanently fail every queued repo.
**Why:** waiting for a clock is not a failed attempt.
**Avoid:** on `rate_limited`, undo the claim's increment and set `next_attempt_at` from
`x-ratelimit-reset`, clamped to `now + 1h`.
**Warning sign:** `attempts = 3, status = failed, outcome = rate_limited`.

### Pitfall 6: bumping `package.updated_at` on a no-change run
**What goes wrong:** unchanged repositories float to the top of the listing forever.
**Why:** `package_live_idx` is ordered by `updated_at DESC`, and a full `persistScan` upsert always
sets it.
**Avoid:** the short-circuit path calls a repository-only upsert, never `persistScan`.
**Warning sign:** the "recent" listing stops changing meaningfully.

### Pitfall 7: holding a transaction open across the GitHub fetch
**What goes wrong:** a 150-second `xmin` pin blocks vacuum on a database another application owns.
**Why:** the natural refactor is "open a transaction at claim, commit at the end."
**Avoid:** claim is its own one-statement commit; the transaction opens only for the DB write.
**Warning sign:** rising `n_dead_tup` on tables AgentDock does not own.

### Pitfall 8: unbounded enqueue from an unauthenticated endpoint
**What goes wrong:** the queue is filled with thousands of distinct repos, permanently consuming
the 60/hour budget.
**Why:** submit has no authentication and none is planned before v2.
**Avoid:** reject enqueue when `count(*) WHERE status = 'queued'` exceeds a cap (500 is generous).
One query, one guard. See Security Domain.

---

## Code Examples

### Terminating a job inside the artifact transaction

```ts
// src/ingest/persist.ts — extended signature
export async function persistScan(
  scan: RepoScan,
  job: { id: number; attemptNo: number; startedAt: Date },
): Promise<PersistResult> {
  return db.transaction(async (tx) => {
    const before = await tx.select({ /* ... §7 ... */ }).from(packageTable)
      .where(eq(packageTable.repositoryId, /* set after the repo upsert */ 0));

    // ... existing repository upsert, package upserts, version inserts ...

    // A partial read is not evidence of absence.
    const delisted = scan.treeTruncated ? [] : await tx.update(packageTable)/* unchanged */;

    await tx.insert(ingestAttempt).values({
      jobId: job.id,
      attemptNo: job.attemptNo,
      startedAt: job.startedAt,
      outcome: 'ok',
      commitSha: scan.commitSha,
      artifactsFound: scan.packages.length,
      artifactsNew: counters.new,
      artifactsUpdated: counters.updated,
      artifactsUnchanged: counters.unchanged,
      artifactsRemoved: delisted.length,
      truncated: scan.treeTruncated,
      rateRemaining: rateLimitState()?.remaining ?? null,
    });

    // Last statement. There is now no window in which artifacts are committed
    // and the job still reads as running.
    await tx.update(ingestJob)
      .set({ status: 'succeeded', finishedAt: sql`now()`, startedAt: null, workerId: null })
      .where(eq(ingestJob.id, job.id));

    return { /* ... */ };
  });
}
```

### The unchanged short circuit

```ts
// src/github/scan.ts — three added lines
export async function fetchRepoScanInputs(
  owner: string, repo: string,
  selectPaths: (tree: RepoTree) => string[],
  knownSha?: string | null,
): Promise<ScanInputs> {
  const [metadata, tree] = await Promise.all([
    fetchRepoMetadata(owner, repo),
    fetchRepoTree(owner, repo),
  ]);

  // Both core calls are already spent — the sha arrives inside the tree response.
  // What this saves is up to 200 raw fetches and up to 120 s, not GitHub quota.
  if (knownSha && tree.commitSha === knownSha) {
    return { metadata, tree, files: new Map(), skipped: [], artifactsTruncated: false, unchanged: true };
  }
  // ... unchanged ...
}
```

---

## Runtime State Inventory

Phase 2 is additive: two new tables, one new poll loop, no rename and no migration of existing data.

| Category | Items Found | Action Required |
|---|---|---|
| Stored data | None — `ingest_job` and `ingest_attempt` are new and start empty. No existing row is rewritten; `package.delisted_at` semantics are unchanged. | None |
| Live service config | None — no external service holds AgentDock state. GitHub is read-only and anonymous. | None |
| OS-registered state | **None today, and this phase must not create any.** The in-process worker means no systemd unit, no pm2 entry, no Task Scheduler job. This is a positive reason for the §1 recommendation. | None |
| Secrets / env vars | One new **optional** variable, `INGEST_WORKER` (`'0'` disables). It is not a secret. Must be added to `.env.example` (FND-07) and to the zod contract in `src/env.ts` as optional with a default. | Add to `.env.example` + `src/env.ts` |
| Build artifacts | The test schema `agentdock_test` will be missing the two new tables until `bun run db:test:setup` regenerates `.drizzle-test/`. Every DB-backed test fails until it does. | Run `bun run db:test:setup` as a plan step |

---

## Project Constraints (from CLAUDE.md)

**No `./CLAUDE.md` exists in this repository** (verified: absent from the working directory
listing). The user-global `~/.claude/CLAUDE.md` governs Obsidian knowledge capture, not this
codebase, and imposes no constraints on the implementation.

The equivalent in-repo directives live in `README.md` and in the code's own header comments, and
the planner must honour them:

- `bun run test`, never bare `bun test` — Bun's own runner hangs on these Vitest files
  [VERIFIED: README.md:121].
- `bun run db:generate` (offline) → **read the SQL** → `bun run db:migrate`. Never
  `drizzle-kit push`/`pull`.
- `bun run ci` = `check:boundaries && lint && typecheck && test`, and it is what CI runs
  [VERIFIED: package.json — `"ci": "bun run check:boundaries && bun run lint && bun run typecheck
  && bun run test"`].
- Every table hangs off `agentdock = pgSchema(AGENTDOCK_SCHEMA)`; a new table declared any other
  way fails the boundary scan.

---

## Environment Availability

| Dependency | Required by | Available | Version | Fallback |
|---|---|---|---|---|
| PostgreSQL | The entire queue | ✓ | **16.14** on x86_64-pc-linux-musl [VERIFIED: `SELECT version()`, live, 2026-08-10] | none needed |
| `FOR UPDATE SKIP LOCKED` | Claiming | ✓ | PG 9.5+; executed live | none |
| Partial unique index with `ON CONFLICT ... WHERE` | Dedupe | ✓ | executed live | none |
| Node.js | Runtime | ✓ | 22.22.3 | — |
| `drizzle-orm` `.for('update', {skipLocked:true})` | Claim in TS | ✓ | 0.45.2, installed | raw `db.execute(sql\`...\`)` |
| `drizzle-orm` `onConflictDoUpdate({targetWhere})` | Dedupe in TS | ✓ | 0.45.2, installed | raw SQL |
| `drizzle-orm` `uniqueIndex().where()` | Partial index DDL | ✓ | 0.45.2, installed | hand-written migration |
| `GITHUB_TOKEN` | Quota headroom | ✗ | — | Documented: 60/hr, 2 per ingest. The rate-limit gate in §8 is the fallback. |
| Redis / pg-boss / graphile-worker | — | n/a | — | Forbidden by locked decision |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** `GITHUB_TOKEN` — absent by design; §8's preemptive gate is
the compensating control.

**Zero new runtime or dev dependencies.** This phase installs nothing.

---

## Package Legitimacy Audit

**Not applicable — this phase installs no external packages.**

Everything required is either already in `package.json` (`drizzle-orm@0.45.2`, `postgres@3.4.9`,
`next@16.3.0`, `zod@4.4.3`, `vitest@4.1.10`) or is a PostgreSQL 16 feature. The three Drizzle APIs
this phase depends on were verified present in the *installed* `node_modules` and then executed
against the live database, so no registry lookup or supply-chain check is needed.

If the planner finds itself reaching for a package — a cron library, a UUID generator, a backoff
library, a mutex — that is the signal to re-read the "Don't Hand-Roll" table. `gen_random_uuid()`
is built into PostgreSQL 13+, `bigserial` is already the project's id convention, and the backoff
formula is one line.

**Packages removed due to `[SLOP]` verdict:** none.
**Packages flagged as suspicious `[SUS]`:** none.

---

## Validation Architecture

### Test framework

| Property | Value |
|---|---|
| Framework | Vitest 4.1.10 |
| Config file | `vitest.config.ts` |
| Quick run command | `bun run test` |
| Full suite command | `bun run ci` |
| DB-test prerequisite | `bun run db:test:setup` (regenerates `.drizzle-test/` for `agentdock_test`) |

### Phase requirements → test map

| Req | Behaviour | Type | Command | File exists? |
|---|---|---|---|---|
| JOB-01 | Submit returns a job id without ingesting | integration | `bun run test src/app/actions.test.ts` | ❌ Wave 0 |
| JOB-01 | Duplicate submit returns the same id | integration | `bun run test src/db/queries/jobs.test.ts` | ❌ Wave 0 |
| JOB-02 | Status page renders queued / running / terminal | integration | `bun run test src/app/jobs.test.tsx` | ❌ Wave 0 |
| JOB-03 | Truncated scan does not delist (§6 regression) | integration | `bun run test src/ingest/persist.test.ts` | ✅ extend |
| JOB-03 | Artifacts + job terminal commit together | integration | `bun run test src/ingest/persist.test.ts` | ✅ extend |
| JOB-04 | Reaper reclaims a backdated `running` row | integration | `bun run test src/ingest/worker.test.ts` | ❌ Wave 0 |
| JOB-04 | Two concurrent claims, `SKIP LOCKED` | integration | `bun run test src/ingest/worker.test.ts` | ❌ Wave 0 |
| JOB-05 | Exhausted job is `failed`; re-submit mints a new job | integration | `bun run test src/db/queries/jobs.test.ts` | ❌ Wave 0 |
| ING-08 | `remaining < 2` pauses before claiming | unit | `bun run test src/ingest/retry.test.ts` | ❌ Wave 0 |
| ING-08 | `rate_limited` schedules to reset, does not burn an attempt | unit | `bun run test src/ingest/retry.test.ts` | ❌ Wave 0 |
| ING-09 | No log line and no `error_detail` can carry a secret | unit | `bun run test src/log.test.ts` | ❌ Wave 0 |
| ING-12 | Unchanged re-ingest reads zero files, mints zero versions | integration | `bun run test src/ingest/pipeline.test.ts` | ✅ extend |
| ING-13 | Same `(repo, sha)` twice ⇒ identical stored state | integration | `bun run test src/ingest/pipeline.test.ts` | ✅ extend |
| QUA-04 | Submit action: success / duplicate / invalid input | integration | `bun run test src/app/actions.test.ts` | ❌ Wave 0 |

### Sampling rate

- **Per task commit:** `bun run test <the touched spec>` — under 10 s.
- **Per wave merge:** `bun run test`.
- **Phase gate:** `bun run ci` green, *and* `CI=1 bun run test` green (proving the non-DB suites
  stand alone), before `/gsd-verify-work`.

### Wave 0 gaps

- [ ] `src/ingest/worker.test.ts` — claim, `SKIP LOCKED`, reaper (JOB-04)
- [ ] `src/ingest/retry.test.ts` — `backoffMs`, outcome classification, rate-limit scheduling (ING-08)
- [ ] `src/db/queries/jobs.test.ts` — enqueue, dedupe, terminal-then-resubmit (JOB-01, JOB-05)
- [ ] `src/log.test.ts` — secret-absence assertion for every outcome (ING-09, QUA-06)
- [ ] `src/app/actions.test.ts` — the three submit paths (QUA-04)
- [ ] `src/app/jobs.test.tsx` — status page render states (JOB-02)
- [ ] Setup step: `bun run db:test:setup` after the migration lands, or every DB test fails at once

No framework install required.

---

## Security Domain

### Applicable ASVS categories (level 1)

| Category | Applies | Standard control |
|---|---|---|
| V2 Authentication | no | No accounts in v1; deliberate and recorded in `REQUIREMENTS.md` "Out of Scope". |
| V3 Session Management | no | No sessions. |
| V4 Access Control | **yes — newly relevant** | The submit endpoint is unauthenticated and now writes a durable row that consumes a shared budget. Control: a queue-depth cap at enqueue (see below) plus the existing denylist. |
| V5 Input Validation | **yes** | `normalizeRepo()` before any row is written [VERIFIED: src/github/client.ts:43-60]. `ingest_job.target` must never hold an unvalidated string. |
| V6 Cryptography | no | `content_hash` is `sha256` via `node:crypto`, already implemented; nothing new. |
| V7 Error Handling & Logging | **yes** | §9. Closed log union, `error_detail` from `OUTCOME_MESSAGES` only, exception cause never propagated. |
| V13 API & Web Service | yes | The Server Action is the API surface. It is reachable by direct request, which the code already documents [VERIFIED: src/app/actions.ts:16-19 — *"A server function is reachable by a direct request, not only through the form above it"*]. |

### Threat patterns for this stack

| Pattern | STRIDE | Mitigation |
|---|---|---|
| **Queue flooding** — unauthenticated POST enqueues thousands of distinct repos, permanently starving a 60/hour budget | Denial of Service | Reject enqueue when `count(*) WHERE status = 'queued'` exceeds a cap (500). One `SELECT`, one guard. The partial unique index already caps *per-repo* duplicates at one. |
| **Retry amplification** — a job that always fails re-consumes 2 core calls per attempt | Denial of Service | `MAX_ATTEMPTS = 3`; `unreadable` and `too_large` terminal on the first attempt. |
| **Hostile `x-ratelimit-reset`** — a bad or malicious header parks a job indefinitely | Tampering | Clamp `next_attempt_at` to `now + 1h`. §8. |
| **Secret leakage into a durable row** — an exception message reaches `ingest_attempt.error_detail` and is then rendered on a page | Information Disclosure | `error_detail` is assigned only from `messageFor()`. Enforced by type and by test. §9. |
| **SQL injection via `target`** | Tampering | Drizzle parameterises everything; the live probe's params came back as `["running","w1","queued",1]`, not interpolated. `normalizeRepo` is the second wall. |
| **SSRF via a queued target** | Tampering | Unchanged from Phase 1: `owner`/`repo` are validated components, hosts are a hardcoded set, redirects are re-validated per hop [VERIFIED: src/github/client.ts:7, 62-76, 141-151]. |
| **Stored XSS via a job's error text on the status page** | Tampering | The rendered string is one of nine constants. React escapes by default; do not add `dangerouslySetInnerHTML` to the status page. |

---

## State of the Art

| Old approach | Current approach | When changed | Impact here |
|---|---|---|---|
| `unstable_after` | `after` stable | Next 15.1 | Available, and deliberately not used for ingestion (§1). |
| `middleware.ts` | `proxy.ts` | Next 16 | Already adopted — `src/proxy.ts` exists. |
| A dedicated queue service (Redis/BullMQ) | `SKIP LOCKED` on a plain table | PG 9.5, 2016 | The whole basis of JOB-06. |
| `SELECT ... FOR UPDATE` + separate `UPDATE` | Single-statement claim with a `FOR UPDATE SKIP LOCKED` subquery | — | Removes the window a two-statement claim has. |
| Heartbeat / lease-renewal protocols | Timeout sweep bounded by an enforced wall-clock cap | — | Correct here *because* the cap exists; it would not be correct without one. |

**Deprecated / outdated in this project's own docs:**
- `ARCHITECTURE.md`'s GraphQL-batched metadata plan — GraphQL is unavailable unauthenticated
  (Phase 1, verified). Any Phase 2 task must use REST.
- `ARCHITECTURE.md`'s claim that ETag 304s make freshness polling "cost approximately nothing" —
  measured false unauthenticated (Phase 1).
- `ARCHITECTURE.md`'s `ingest_job` sketch (`kind`, `priority`, `progress jsonb`, `result jsonb`,
  `locked_at`/`locked_by`) — superseded by §5. `progress`/`result` jsonb on the UPDATE-hot row is
  the specific thing §5 argues against.
- `STACK.md`'s `job_status` **enum type** — superseded. This project has an established reason to
  prefer a `text` column over a constrained type [VERIFIED: src/db/schema.ts:52-64].
- `ROADMAP.md` plan line "02-02: … ETag conditional requests …" — should be struck (§4).

---

## Assumptions Log

| # | Claim | Section | Risk if wrong |
|---|---|---|---|
| A1 | `register()` fires at `next start` boot without requiring a first request | §1 | The worker starts lazily. Low impact (a submit *is* a request), but the plan must verify it rather than assume it. Fallback is one line. |
| A2 | GitHub's `pushed_at` always moves when the default branch head moves | §4 | Only affects the deferred Phase 8 optimisation. Not built here, which is why it is deferred. |
| A3 | A 404 from `GET /repos/{o}/{r}` costs 1 core call unauthenticated | §8 | If a 404 were free, `unreadable` could be retried cheaply. Conservative either way — the recommendation is not to retry. |
| A4 | A duplicate-submit rate high enough to bloat `ingest_job` via no-op `DO UPDATE` will not occur | §3 | Bloat on a tiny table; autovacuum handles it. Negligible. |
| A5 | An in-process ingest will not measurably delay page renders | §1 | If wrong, `INGEST_WORKER=0` plus the standalone script is the pre-built escape hatch. |
| A6 | 500 is a sensible queued-depth cap | Security | A guess. Tune it once Phase 5 enqueues real seed volumes; the number is a constant, not a design. |

---

## Open Questions

1. **Does `register()` run before the first request under `next start`?**
   - Known: `register()` is documented as called once per server instance and must complete before
     the server is ready; it is also reported to run more than once in dev, and (in older versions)
     to be deferred until a route is visited.
   - Unclear: the behaviour of Next 16.3 specifically, on WSL, under `next start`.
   - Recommendation: make it an explicit verification step in the plan — seed a `queued` row, run
     `next start`, wait 10 s with no HTTP traffic, assert the row moved. If it did not, add a lazy
     `void runWorker()` to the submit action. Do not guess.

2. **Should `no_artifacts` be `succeeded` or `failed` on the job?**
   - Known: `IngestOutcome` treats it as not-`ok`, and Phase 1's UI shows it as an error message.
   - Unclear: whether a user reading a job list expects a red row.
   - Recommendation: `status = 'succeeded'`, `outcome = 'no_artifacts'`. The job did its work; the
     answer is "nothing here." The status page renders the outcome, so nothing is hidden. Flag to
     the maintainer during `/gsd-discuss-phase` — it is a UX call, not a technical one.

3. **Should the denylist be checked at enqueue, at execution, or both?**
   - Known: it is checked at execution today [VERIFIED: src/ingest/pipeline.ts:54-73].
   - Recommendation: **both.** At enqueue it gives the user an immediate answer and creates no row;
     at execution it is the durable guarantee for a repo denylisted after enqueue. The check is one
     indexed primary-key lookup.

---

## Sources

**Live verification performed during this research (HIGH confidence — executed, not recalled):**
- `SELECT version()` against the project's `DATABASE_URL` → `PostgreSQL 16.14 on
  x86_64-pc-linux-musl, compiled by gcc (Alpine 15.2.0) 15.2.0, 64-bit`
- Raw-SQL probe in `agentdock_test`: partial-unique-index dedupe, `ON CONFLICT DO NOTHING ...
  RETURNING` row count, two concurrent `FOR UPDATE SKIP LOCKED` claims across two connections,
  reaper sweep on a backdated `started_at`, re-submit after terminal
- Drizzle probe with `drizzle-orm@0.45.2`: `.toSQL()` output for the claim and the dedupe-enqueue,
  then both executed live against `agentdock_test` with two concurrent transactions

**Installed source read this session (HIGH confidence):**
- `node_modules/drizzle-orm/pg-core/query-builders/select.types.d.ts:60-71` — `LockStrength`, `LockConfig`
- `node_modules/drizzle-orm/pg-core/dialect.js:301-302` — ` skip locked` emission
- `node_modules/drizzle-orm/pg-core/query-builders/insert.d.ts:63-66` — `targetWhere`, `setWhere`
- `node_modules/drizzle-orm/pg-core/indexes.d.ts:67` — `where(condition: SQL): this`

**Project source read this session (HIGH confidence):**
- `src/ingest/pipeline.ts`, `src/ingest/persist.ts`, `src/ingest/errors.ts`, `src/ingest/types.ts`
- `src/db/schema.ts`, `src/db/client.ts`
- `src/github/client.ts`, `src/github/scan.ts`, `src/github/repo.ts`, `src/github/tree.ts`
- `src/log.ts`, `src/instrumentation.ts`, `src/app/actions.ts`
- `src/ingest/persist.test.ts`, `vitest.config.ts`, `package.json`, `README.md`
- `.planning/ROADMAP.md`, `.planning/REQUIREMENTS.md`, `.planning/config.json`
- `.planning/research/ARCHITECTURE.md`, `.planning/research/STACK.md`
- `.planning/phases/AGD-01-walking-skeleton/RESEARCH.md` (lines 288-343, 1395, 1431 — GitHub quota facts)

**Official documentation (MEDIUM–HIGH confidence):**
- https://nextjs.org/docs/app/api-reference/functions/after — `after` semantics, duration bound,
  platform support table, `waitUntil` mechanism (page version 16.3.0, updated 2026-03-13)
- https://nextjs.org/docs/app/guides/self-hosting — the `after` section: *"fully supported when
  self-hosting with `next start`"*, graceful-shutdown wording, drain period (updated 2026-04-30)
- https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation — `register` *"is
  called **once** when a new Next.js server instance is initiated, and must complete before the
  server is ready to handle requests"* (updated 2026-06-09)

**Reported behaviour (MEDIUM confidence — corroborated across independent reports):**
- https://github.com/vercel/next.js/issues/51450 — `register()` called multiple times
- https://github.com/vercel/next.js/discussions/15341 — run-once-per-server-start discussion
- https://github.com/vercel/next.js/issues/59999 — instrumentation deferred until a route is visited
- https://github.com/vercel/next.js/issues/55885 — modules imported more than once on the server

---

## Metadata

**Confidence breakdown:**
- Claim SQL and Drizzle expression: **HIGH** — printed and executed against the real database
- Dedupe / partial unique index: **HIGH** — executed, including the `DO NOTHING ... RETURNING`
  trap and the terminal-then-resubmit case
- Reaper strategy: **HIGH** — executed; the threshold is derived from caps read in this repo
- Schema shape: **HIGH** on correctness, **MEDIUM** on the exact column set (a UX review may add or
  drop a counter)
- Transaction boundaries: **HIGH** — read from the current `persist.ts`
- The delist-on-truncation bug: **HIGH** — traced through four files, line by line
- Worker execution model: **MEDIUM-HIGH** — the doc guarantees are quoted verbatim; the
  `register()` boot-timing question (A1) is the one live unknown and has a named verification step
- GitHub cost arithmetic: **HIGH** — Phase 1 measurements plus the call sites read this session
- Retry classification: **MEDIUM-HIGH** — derived from the outcome union; the `no_artifacts`
  terminal-status call is a UX question raised in Open Questions

**Research date:** 2026-08-10
**Valid until:** 2026-09-09 (30 days). The PostgreSQL and Drizzle findings are stable; the Next.js
`after` / `instrumentation` behaviour is the part worth re-checking on a Next minor bump.
