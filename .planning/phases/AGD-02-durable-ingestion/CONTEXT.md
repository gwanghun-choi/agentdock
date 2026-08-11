# Phase 2 Context — Durable Ingestion

Decisions confirmed before planning. `RESEARCH.md` in this directory carries the evidence,
all of it executed live against this project's own PostgreSQL 16.14 and `drizzle-orm@0.45.2`.

## Scope

Turn Phase 1's synchronous single-shot ingest into a durable, resumable, observable one.
**No new feature surface** beyond what the state model requires.

Not in this phase: capability detectors, search, MCP registry sync, corpus seeding,
compatibility, additional artifact types.

## A live bug this phase must fix

`src/ingest/persist.ts` delists with `id NOT IN (packageIds)`, where `packageIds` contains
only the artifacts that survived the read caps. So a repository over `CAPS.maxFiles = 200`,
or a transient failure on a handful of files, marks previously-good packages `delisted_at`
and they disappear from the index.

This is exactly the failure ROADMAP criterion 2 exists to prevent, and it is in the code
today. **Fix: do not delist when `scan.treeTruncated` is set** — that flag already carries
the right meaning. Partial reads must never be treated as authoritative deletions.

## Resolved open questions from RESEARCH.md

1. **`no_artifacts` is a `succeeded` job, not a failure.** AgentDock read the repository
   correctly; "this repo contains no skills" is a true answer, not an error. Marking it
   failed would put it in the retry path where every retry produces the same answer. The
   UI must still say plainly that nothing was found — a successful job with zero artifacts
   is not the same sentence as "indexed 24 skills".
2. **Denylist is checked at enqueue AND at execution.** One indexed lookup each. The
   denylist can change between the two moments, and the execution-time check is the one
   that actually protects the fetch.
3. **`register()` firing at `next start` boot is a plan verification step, not an
   assumption.** Seed a queued row, start the server, wait, assert it moved. If it does not
   fire without a first request, the fallback is a one-line nudge from the submit action.

## Binding decisions

- **Worker: in-process loop started from `src/instrumentation.ts`, gated by an
  `INGEST_WORKER` env flag.** `after()` is rejected: Next 16 only guarantees it across a
  *graceful* shutdown, which is precisely the case criterion 2 excludes, and it leaves no
  row to reclaim. Durability lives in the job row, not in the mechanism.
- **Two tables.** `ingest_job` is UPDATE-hot (claim, reap, terminal transition) and stays
  narrow so updates stay HOT and the claim index small. `ingest_attempt` is INSERT-only
  and carries the wide history the UI reads. This is a mutability argument, not tidiness.
- **Claim is one statement** using `FOR UPDATE SKIP LOCKED` — verified to emit
  ` skip locked` and to hand two concurrent transactions two different rows without
  blocking.
- **Duplicate submit dedupes onto the in-flight job**, via a partial unique index over
  `status IN ('queued','running')` plus `onConflictDoUpdate({ targetWhere })`, verified to
  return the same job id. **Trap to avoid: `ON CONFLICT DO NOTHING ... RETURNING` returns
  zero rows**, so a submit handler written that way silently gets `undefined`.
- **Retry never leaves `queued`**, so a retrying job never re-enters the partial unique
  index and can never collide with a concurrent submit.
- **Rate-limit exhaustion is scheduled, not backed off.** It undoes the claim's `attempts`
  increment and schedules to `x-ratelimit-reset`, clamped to `now + 1h` because that header
  is attacker-adjacent input.
- **Reaper is a `started_at` age sweep, no heartbeat table.** 900 s is 6× the maximum
  legitimate runtime (`CAPS.wallClockMs = 120_000`), which is what makes a heartbeat
  redundant.
- **Polling, not `LISTEN/NOTIFY`**, at this scale.

## Honest accounting on the commit-SHA short circuit (ING-12)

It saves **zero GitHub core quota** — both core calls are spent concurrently before the sha
is known. What it saves is up to 200 raw fetches and up to 120 s of wall clock. That is
still worth the ~5 lines, and ROADMAP criterion 4 asks literally for "without re-reading
its files", which is what it delivers. **The plan must not claim a quota saving.**

The `pushed_at` gate that *would* halve core cost is deferred to Phase 8: it rests on an
unverified assumption, and a user who clicks re-index has asked you to look.

## Documents that are now partly superseded — do not follow blindly

- `ARCHITECTURE.md`'s `ingest_job` sketch puts `progress`/`result` jsonb on the hot row.
  Rejected; that is what `ingest_attempt` is for.
- `STACK.md`'s `job_status` Postgres enum type. Use `text` with a check — this repo has a
  recorded reason to avoid enum widening, since `DROP CONSTRAINT` is what its own boundary
  scanner classifies as destructive.
- **ROADMAP plan `02-02` mentions "ETag conditional requests" — strike it.** A 304 consumes
  quota when unauthenticated, so conditional requests buy nothing until a token exists.

## Re-index result wording (fixes a Phase 1 complaint)

Re-indexing an unchanged repository currently reports "24 stored", which reads as new
writes. Replace with an explicit breakdown:

```
24 discovered · 0 new · 0 updated · 24 unchanged
```

and, when a partial read happened, say so instead of implying completeness.

## Hard constraints (unchanged from Phases 0–1)

- `agentdock` schema only. `pgSchema()` on every table. `check:boundaries` must pass.
  `generate` → hand-review → `bun run db:migrate`. No `drizzle-kit push`/`pull`/`migrate`.
  Delete any `CREATE SCHEMA "agentdock";` from generated SQL. Do not install `pg_trgm`.
- **No Redis, BullMQ, pg-boss, or graphile-worker.** Each of the latter two installs its own
  DDL-running migration system into a database shared with another application.
- Never execute repo content; never write it to disk. `owner/repo` only; hardcoded host
  allowlist; no arbitrary-URL fetch.
- No risk score, grade, or SAFE/VERIFIED badge.
- No token, connection string, or response body in any log line.
- A failed new ingest must never destroy the previously visible index.
- `bun run test` is the test entrypoint; `bun test` hangs.
- Final verification order: `bun install --frozen-lockfile` → `bun run build` → `bun run ci`.
- Do NOT `git commit` or `git push`.
