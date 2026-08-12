# Phase 5: Corpus & Cold Start - Pattern Map

**Mapped:** 2026-08-11
**Files analyzed:** ~8 new/modified files (registry adapter, seed consumer, 2 CLI scripts, listing filter, migration, tests)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/registry/client.ts` (or `src/registry/mcp.ts`) | service (external adapter) | request-response | `src/github/client.ts` | role-match (different host, same discipline) |
| `src/registry/types.ts` | model | — | `src/github/types.ts` | exact |
| `src/registry/sync.ts` | service | batch | `src/github/scan.ts` (`fetchRepoScanInputs`) | role-match |
| `src/ingest/seedConsumer.ts` (or `src/corpus/fanout.ts`) | service | event-driven/batch | `src/ingest/worker.ts` (claim loop) + `src/db/queries/jobs.ts` (`enqueueJob`) | role-match |
| `scripts/corpus-sync.mjs` | CLI | batch | `scripts/analyze-backfill.mjs` | exact |
| `scripts/corpus-seed.mjs` | CLI | batch | `scripts/analyze-backfill.mjs` (not `seed-fixture.mjs`, no network fake needed) | exact |
| `src/db/queries/packages.ts` (`listPackages`/`countPackages` edit) | query/filter | CRUD | itself (in-place edit) | exact |
| `drizzle/00NN_*.sql` (repo_seed status cols / gate columns) | migration | — | `drizzle/0005_rainy_saracen.sql` | exact |
| `src/registry/client.test.ts` | test | fixture-backed | `src/github/scan.test.ts` | exact |
| `src/ingest/seedConsumer.test.ts` / fanout test | test | DB-backed | `src/db/queries/jobs.test.ts` | exact |

## Pattern Assignments

### 1. External-source adapter for `registry.modelcontextprotocol.io`

**Analog:** `src/github/client.ts:1-208`, `src/github/types.ts`, `src/github/repo.ts:1-40`

`src/github/client.ts` centralizes every host-contact decision in one file so `scripts/check-boundaries.mjs` rule 5 (`HOST_PATTERN`/`HOST_DIR`, lines 209-212, 251-253) can grep for it: **any file naming `api.github.com`/`raw.githubusercontent.com` outside `src/github/` fails CI.** The same rule will fire for `registry.modelcontextprotocol.io` the moment it appears outside a dedicated directory — so a Phase 5 registry client MUST live in its own `src/registry/` directory (its own `HOST_PATTERN`/`HOST_DIR` pair is not yet registered in `check-boundaries.mjs`; that file needs a one-line edit adding the new host string and directory, mirroring lines 211-212, or the check will simply not police it — flag this as a required companion edit, not optional).

Concrete decisions to copy verbatim rather than re-derive, from `src/github/client.ts`:
- `ALLOWED_HOSTS` set + `assertAllowedHost()` (lines 7, 80-94): hardcoded, not configurable; https-only.
- `REQUEST_TIMEOUT_MS = 10_000` + `AbortSignal.timeout(...)` per hop (lines 16, 141).
- `MAX_REDIRECTS = 2`, manual redirect handling re-validating each hop against the allowlist (lines 17, 126-178) — `redirect: 'manual'`, re-checks `assertAllowedHost` on the `location` header before following.
- `GitHubError`-shaped custom error class carrying a `failure` union + optional rate-limit payload (lines 19-28) — new adapter should define its own `RegistryError` with an analogous `RegistryFailure` union (`'invalid_response' | 'unavailable' | 'rate_limited' | 'too_large'`), copying the shape not the name.
- Rate-limit header capture as module-level mutable state (`lastRateLimit`/`rateLimitState()`, lines 30-34, 96-107) — MCP registry likely has no rate-limit headers; skip this piece rather than invent headers that don't exist. Confirm registry's actual response headers before copying.
- `readCapped()` (lines 187-208): byte-capped body reader that never trusts `Content-Length`, cancels the stream over cap. Reuse directly — import from `@/github/client` is disallowed by the same host-sprawl reasoning (that file lives under `src/github/`), so **either move `readCapped` to a shared non-host-specific location (e.g. `src/net/capped.ts`) or duplicate the ~15 lines** into the new adapter. Duplication is smaller and matches this codebase's stated preference (widening a shared abstraction ahead of a second real need is not this codebase's style — `packages.ts:98` ponytail comment on `sourcePathFromUrl` shows the same restraint). Recommend duplicating.
- `normalizeRepo`/`OWNER_REPO` regex pattern (lines 14, 43-60) — anchored, length-bounded validation before any string reaches URL construction. The registry entry's own identifier (likely a UUID or `owner/repo` github URL) needs the same anchored-regex-before-URL-construction discipline; do not skip validation because the source is "trusted" (it is operator-supplied/public, not user-supplied, but still untrusted input).

`src/github/repo.ts:5-40` is the shape for a single-endpoint fetch-and-shape function: `githubFetch()` call, explicit status-code branches (404 vs. non-ok vs. ok), `JSON.parse(readCapped(...))`, then field-by-field extraction with explicit `String()`/`Boolean()`/`Number()` coercion and comments justifying each null-vs-empty-string quirk (e.g. line 28: `homepage: json.homepage ? String(json.homepage) : null`). Copy this shape for the registry list/detail endpoint parser — do not trust the registry's JSON shape without the same defensive coercion.

**Smallest new module:** `src/registry/client.ts` (fetch + host-lock + capped read, ~60 lines by reusing the trimmed-down subset above) + `src/registry/types.ts` (mirrors `src/github/types.ts:39-52`'s `RateLimit`/failure-union shape, minus rate limit if unused) + `src/registry/sync.ts` (the parse-and-upsert-into-`repo_seed` loop, analogous to `scan.ts`'s bounded-fetch-with-caps pattern at `src/github/scan.ts:44-56` — define a `CAPS`-like const with a documented, measured cap rather than an arbitrary number).

---

### 2. Seed consumer (repo_seed → enqueueJob fan-out)

**Analogs:** `src/ingest/worker.ts:114-148` (poll/claim/sleep loop shape), `src/db/queries/jobs.ts:34-62` (`enqueueJob`, `MAX_QUEUED = 500` budget check), `src/ingest/persist.ts` transaction discipline.

Key transferable decisions:
- `enqueueJob()` (`src/db/queries/jobs.ts:34-62`) already returns a `{kind: 'queued'|'denylisted'|'flooded'}` result and enforces `MAX_QUEUED` against **all** queued jobs regardless of source. **A Phase 5 fan-out MUST call this exact function per `repo_seed` row rather than inserting into `ingest_job` directly** — it is the only place the denylist check and flood ceiling are enforced, and bypassing it reopens both.
- The `onConflictDoUpdate` no-op pattern at lines 51-58 (matching the partial unique index on active status) is why re-running fan-out over the same seed rows is safe/idempotent — do not add a second dedup layer on top; rely on this existing one.
- `runWorker`'s poll/sleep/reap shape (`worker.ts:114-148`) is for a *long-running* loop; a seed-fan-out is closer to a **batch job invoked from a CLI script** (see pattern 3) that iterates seed rows once and calls `enqueueJob` per row, budget-checking the `MAX_QUEUED` flood signal to stop early rather than looping. Do not copy the `while (!signal?.aborted)` infinite-poll shape — that belongs to the always-on worker process, not a cron/manual sync.
- `finishJob`/`scheduleRetry` (`jobs.ts:154-193`) wrap writes in `db.transaction(...)`. If fan-out needs to mark `repo_seed` rows as "enqueued" (a column Phase 5 will likely add — see migration section, since `repoSeed`'s own doc at `src/db/schema.ts:277-280` explicitly defers this: *"No status column and no enqueued_at... Phase 5 (COR-03) owns fan-out"*), wrap the `repo_seed` UPDATE and `enqueueJob` INSERT in one `db.transaction` the same way, so a crash mid-fan-out cannot both mark-enqueued and fail-to-enqueue.
- `Executor` type alias pattern (`jobs.ts:83`) — `Pick<typeof db, 'update'>` — is how this codebase types a parameter accepting either `db` or a `tx`, used for testability (see `claimJob`'s `client: Executor = db` at line 88). Copy this exact typing trick for any new query function that needs to be called both standalone and inside another transaction.

---

### 3. CLI script (`corpus:sync` / `corpus:seed`)

**Analogs:** `scripts/analyze-backfill.mjs` (closest — no network fake needed, reads/writes DB via imported `src/` modules), `scripts/capability-precision.mjs` (no-DB, fixture-only — not the right shape here), `scripts/seed-fixture.mjs` (network-faking pattern, only relevant if a "fixture registry" dev mode is wanted), `scripts/migrate.mjs` (DB-connection-lifecycle idiom).

Exact conventions, confirmed across all four scripts:
- **File extension:** `.mjs`, always, never `.ts`. Node ESM directly, no build step. Header comment format: `#!/usr/bin/env node` then `// scripts/<name>.mjs` then a prose block explaining *why this script exists* and what it deliberately does NOT do (network/disk/budget claims).
- **Loading `src/` code:** `await import('../src/....ts')` — dynamic import of a `.ts` file by relative path with explicit `.ts` extension (`analyze-backfill.mjs:21-22`, `seed-fixture.mjs:35-36`). This works because these scripts run under **Bun** (comment at `analyze-backfill.mjs:9-11`: "Bun's ... TypeScript execution with no build step"), which resolves the `.ts` extension and executes TS directly — no `tsx`/`ts-node`, no path-alias (`@/...`) usage inside these scripts (path aliases only resolve inside Next's own bundler/vitest, not under Bun's raw script execution — confirmed by every relative `../src/...ts` import in all three scripts; **a new corpus script must NOT use `@/` aliases**, must use relative paths).
- **DB handle:** `const { sql } = await import('../src/db/client.ts')` then `await sql.end()` at the very end, always, including on early-exit branches (`analyze-backfill.mjs:22,38`; `seed-fixture.mjs:36,40`). `migrate.mjs` instead builds its own raw `postgres(url, ...)` connection because it needs `search_path` control the shared `db` client doesn't expose (lines 39, 48) — irrelevant for a corpus script, which should use the shared `src/db/client.ts` handle like `analyze-backfill.mjs` does.
- **Argument parsing:** manual `process.argv[N]`, validated inline, `throw new Error(...)` on bad input (`analyze-backfill.mjs:15-19`) — no CLI-args library, ever.
- **Summary printing:** plain `console.log` with a `<script-name>: <verb> N item(s), M created, Xms` line built from counters accumulated in the loop (`analyze-backfill.mjs:25,33-36`). No JSON output mode exists in any current script — don't add one speculatively.
- **Exit code:** `seed-fixture.mjs:41` — `if (!result.ok) process.exit(1)` after `sql.end()`. `analyze-backfill.mjs` has no non-zero exit path (nothing in it can fail meaningfully). A corpus:sync/seed script touching a network adapter should follow `seed-fixture.mjs`'s explicit-nonzero-exit-on-failure convention since registry sync can fail (network/parse errors).
- **package.json script names:** check `scripts/check-boundaries.mjs:149-162` (`checkPackageScripts`) — bans `db:push`/`db:pull` names and any script invoking `drizzle-kit push|pull`. `corpus:sync`/`corpus:seed` names are safe under this rule as long as they don't shell out to `drizzle-kit push/pull`.

---

### 4. Read-time listing filters (fork/dup suppression, low-signal gating)

**Analog:** `src/db/queries/packages.ts:23-71` (`listPackages`, `countPackages`), and callers `src/app/page.tsx:12` (`listPackages({limit:10})`+`countPackages()`), plus `src/db/queries/packages.ts:147-162` (`getRepositoryPackages`, which calls `listPackages({fullName, limit:250})` for the **detail** page).

Exact insertion point: `listPackages`'s `where(and(isNull(packageTable.delistedAt), fullName ? ... : undefined))` at lines 54-59, and `countPackages`'s `where(isNull(packageTable.delistedAt))` at line 69. Both already `.innerJoin(repository, eq(packageTable.repositoryId, repository.id))` (line 53) so `repository.isFork` (schema.ts:83) is already joined and available — **a fork/visibility predicate is one more `and(...)` clause referencing `repository.isFork`/a new `repository.isDuplicateOf` column, added to both `listPackages` and `countPackages`'s `where(...)`, nothing else needs to change.**

Critical: `getRepositoryPackages` (detail page, line 160) calls `listPackages({fullName, limit: 250})` — the SAME function. **If the fork/gate filter goes inside `listPackages`'s `where`, it silently also hides gated packages from their own detail page**, which the task explicitly says must NOT happen ("suppress forks/duplicates at read time... gate low-signal packages out of listings" — listings only, not detail pages). Two options, pick one explicitly in the plan:
- (a) Add a `includeGated?: boolean` param to `listPackages`, defaulted `false`, threaded through the `and()`, with `getRepositoryPackages` passing `true` — mirrors how `fullName` is already an optional narrowing param (lines 27-32).
- (b) Add a **separate** `listPackagesForListing()` wrapper around `listPackages` that adds the extra predicate, used only by `page.tsx` and the future `/skills` listing route, leaving `listPackages`/`getRepositoryPackages` untouched.
(a) is smaller and matches the existing `fullName?:` optional-param convention exactly (same function, same `cache()` wrapper) — recommend (a).

`isDuplicateOf`/fork suppression needs the predicate to check `repository.isFork` and/or the new "canonical" flag; `countPackages` needs the identical predicate or the homepage's `Browse all {total} skills` count (page.tsx:51) will disagree with what's actually rendered — this is the kind of mismatch `src/app/page.tsx` already trusts `countPackages()` for one truth.

---

### 5. New migration

**Analog:** `drizzle/0005_rainy_saracen.sql:1-22`, rules enforced by `scripts/check-boundaries.mjs:38-142` (`checkMigrationSql`).

Rules a Phase 5 migration must satisfy (from `check-boundaries.mjs`):
1. **Every schema referenced must be `agentdock`** (or `pg_catalog`) — `ALLOWED_SCHEMAS`/`ownedSchema` check at lines 111-117. Table/index DDL must be `"agentdock"."table_name"`, exactly like `0005_rainy_saracen.sql:1,19,20,21,22`.
2. **Every CREATE TABLE/ALTER TABLE/CREATE TYPE/CREATE VIEW/CREATE SEQUENCE/CREATE INDEX...ON target must be schema-qualified** (`QUALIFIED_TARGETS`, lines 38-48, 119-131) — e.g. `ALTER TABLE "agentdock"."repo_seed" ADD COLUMN ...`, never a bare `repo_seed`.
3. **Any destructive verb** (`DROP|TRUNCATE|GRANT|REVOKE|CREATE ROLE|ALTER ROLE|CREATE SCHEMA|ALTER SCHEMA|CREATE EXTENSION|CREATE DATABASE`, line 36) **requires a `agentdock:reviewed-destructive: <reason>` comment in the same file** (lines 133-139) or CI fails. Adding `enqueued_at`/status columns to `repo_seed` per the schema doc's own plan (schema.ts:277-280) is additive (`ALTER TABLE ... ADD COLUMN`) and triggers none of these — keep it that way; do not combine with any DROP/rename in the same migration without the marker.
4. **`drizzle-kit push|pull` must never appear in package.json scripts** (lines 149-162) — irrelevant to authoring the migration file itself, just don't add such a script.
5. Every table must hang off `agentdock.table(...)` (the `pgSchema()` object), never bare `pgTable(...)` (lines 169-180) — this is a `schema.ts` rule, not a `.sql` rule; new schema.ts changes for `repo_seed` columns follow the existing `agentdock.table('repo_seed', {...})` block at `src/db/schema.ts:282-301` — just add columns inside that same `{...}`, e.g. `enqueuedAt: timestamp('enqueued_at', {withTimezone:true})`.

**`scripts/migrate.mjs` companion-edit trap** (documented at `migrate.mjs:97-110`): `db:test:setup` regenerates `agentdock_test`'s DDL **from scratch** from `schema.ts`, not by replaying `drizzle/*.sql` files. So:
- Any hand-added `INSERT`/seed-data statement placed inside a `drizzle/0006_*.sql` migration file **will apply to `agentdock` but never reach `agentdock_test`**, silently breaking every DB-backed test that depends on that seed row (exactly what happened historically with `artifact_type`, which is why `migrate.mjs:111-121` now re-asserts that seed data with `ON CONFLICT DO NOTHING` inside the script itself, for both schemas, rather than only inside a `drizzle/` migration).
- **If Phase 5 needs any reference/seed data** (e.g. a `source_kind` lookup, or a default gate threshold row), it MUST be added to `scripts/migrate.mjs`'s own `ON CONFLICT DO NOTHING` INSERT block (mirroring lines 111-121), not solely inside the generated `drizzle/*.sql` file — or write a plain migration test asserting the row exists in `agentdock_test` after `db:test:setup`, which will fail and catch the omission.
- The migration file itself is still generated the normal way by `drizzle-kit generate` (unaffected, offline, per `migrate.mjs:24`); this trap is purely about seed-data statements, which pure `ALTER TABLE ADD COLUMN` migrations (no seed rows) don't trigger at all.

---

### 6. Tests (DB-touching isolation)

**Analog:** `src/db/queries/jobs.test.ts:1-60` in full detail.

- `process.env.DATABASE_SCHEMA = 'agentdock_test'` set **before any import** of the schema module (line 6), because the schema module reads it at import time. Copy verbatim at the top of any new corpus/seed test file.
- `describe.skipIf(!DB_URL)(...)` (line 19) — every DB-backed suite skips cleanly with no `DATABASE_URL` set (e.g. CI stages that don't provision a DB), rather than failing.
- **Sentinel discipline:** all target/repo-shaped strings used in tests are prefixed `test-owner/<suite-name>-...` (lines 13-15: `test-owner/queue-spec-a` etc.) — this is load-bearing, not cosmetic: `claimJob` operates over the **entire schema**, so a suite using a real-looking repo name risks colliding with another suite's rows (`jobs.test.ts:24-27` comment explains this explicitly). **A new corpus/seed test MUST use its own `test-owner/corpus-spec-*` (or similar) prefix**, distinct from `queue-spec` and `persist` prefixes already in use, and its `clean()` function must `DELETE ... WHERE target LIKE 'test-owner/<its-prefix>%'` (mirroring line 29) plus clean any `repo_seed` rows it inserts.
- **Known flakiness / fragility:** `jobs.test.ts:24-27` comments that `claimJob` takes "the oldest claimable row in **the whole schema**" — meaning any test file that inserts a `queued` `ingest_job` row and doesn't clean it up before another suite's `claimJob` test runs will nondeterministically steal that other suite's claim. `persist.test.ts` sidesteps this by always inserting rows already `running` (never `queued`) — copy that convention: **a corpus/seed test that calls `enqueueJob` (which inserts `queued` rows) must clean them up in `beforeEach`/`afterAll` with the same rigor as `jobs.test.ts`'s `clean()` (lines 28-31), and must not leave any `queued` row behind between tests**, or it reintroduces the exact cross-suite race this codebase already fought once.
- `beforeAll`/`afterAll`/`beforeEach(clean)` pattern (lines 33-44) — import DB modules dynamically inside `beforeAll` (`jobs = await import('./jobs')`), not at top-level, to respect the `DATABASE_SCHEMA` env-var timing constraint above.
- Concurrency proof pattern (lines 46-60): `db.transaction(async (tx) => ...)` + `sleep(300)` to hold a lock open long enough for a second concurrent claim to prove `SKIP LOCKED` works — reuse only if a corpus/seed suite needs to prove concurrent-fan-out safety; otherwise skip, it's the more expensive pattern and this codebase doesn't reach for it without a specific race to prove (YAGNI — most corpus tests are sequential CRUD assertions, not concurrency proofs).

---

### 7. Fixture-based external-API tests

**Analog:** `src/github/scan.test.ts:1-40+`, fixtures at `fixtures/{addyosmani-agent-skills,anthropics-skills,baoyu-skills,wshobson-agents}/{repo.json,tree.json}`, and `fixtures/adversarial/*-malformed.json`.

Pattern:
- A realistic literal JSON object built inline in the test file (`REPO_JSON` at `scan.test.ts:8-21`), not loaded from a fixture file, for the "shape of a normal response" case — used to build stub `Response` objects.
- `treeJson(paths, extra)` helper (lines 24-30) — a small builder function producing response bodies parametrically, so "empty" and "malformed" variants are one-line calls (`treeJson([])`, `treeJson(paths, {truncated: true})`) rather than separate fixture files.
- Malformed/adversarial cases use **separate fixture files** under `fixtures/adversarial/*-malformed.json` (e.g. `mcp-malformed.json`) when the malformed shape needs to be committed and reused across tests, vs. inline literals when it's local to one test.
- A `hosts: string[]` / `urls: string[]` capture array (lines 34-35) populated by the stubbed `fetch`, asserted against afterward to prove the adapter called the right host and no more than expected (the "two-call and zero-quota claims" comment, line 34) — this is how `githubFetch`'s host-allowlisting and call-count budget get proven under test.

**For the registry adapter test**, mirror this exactly: build `fixtures/mcp-registry/list-normal.json`, `list-empty.json` (empty array or `{servers: []}`), `list-malformed.json` (adversarial shape — missing required field, wrong type), plus an inline-stubbed `fetch` for the error-status case (mirroring how `scan.test.ts` presumably stubs a 404/500 `Response` — check `beforeEach`/`Stubs` type at lines 32-40 for the exact stub-injection mechanism used across the whole file before finalizing). Four cases minimum: normal, empty, malformed, HTTP-error — matching the task's explicit request.

---

## Shared Patterns

### Host allowlisting + boundary enforcement
**Source:** `src/github/client.ts:7,80-94` + `scripts/check-boundaries.mjs:209-257`
**Apply to:** `src/registry/client.ts`. Requires a companion one-line edit to `check-boundaries.mjs` adding the registry host pattern/dir, or the new adapter is unpoliced by CI rule 5.

### enqueueJob as the single ingest-job entry point
**Source:** `src/db/queries/jobs.ts:34-62`
**Apply to:** seed consumer / fan-out — never insert into `ingestJob` directly, always route through `enqueueJob` to preserve denylist + `MAX_QUEUED` budget semantics.

### Transaction discipline for paired writes
**Source:** `src/db/queries/jobs.ts:154-193` (`finishJob`, `scheduleRetry`), `Executor` type at line 83
**Apply to:** any function that must mark a `repo_seed` row as consumed and enqueue a job atomically.

### Bun-executed `.mjs` CLI scripts, no path aliases, shared `sql.end()` lifecycle
**Source:** `scripts/analyze-backfill.mjs` (whole file)
**Apply to:** `scripts/corpus-sync.mjs`, `scripts/corpus-seed.mjs`.

### `test-owner/<suite>-*` sentinel + `LIKE` cleanup
**Source:** `src/db/queries/jobs.test.ts:13-15,28-31`
**Apply to:** every new DB-backed test file in this phase, with a prefix distinct from `queue-spec`/`persist` already in use.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| Topic-sharded search query logic | service/query | batch | No existing sharding/pagination-by-topic pattern in `packages.ts`; nearest is plain `limit`/`offset` (lines 61-62) — will need new design, not adapted from an analog. |
| `check-boundaries.mjs` registry-host rule | config/tooling | — | Requires editing the boundary scanner itself (not just adding a new source file) to register the new host/dir pair — flag as a required task, not a copyable pattern. |

## Metadata

**Analog search scope:** `src/github/`, `src/ingest/`, `src/db/queries/`, `src/db/schema.ts`, `scripts/`, `drizzle/`, `fixtures/`, `src/app/page.tsx`
**Files scanned:** ~20 read directly (client.ts, types.ts, repo.ts, scan.ts, scan.test.ts, worker.ts, jobs.ts, jobs.test.ts, persist.ts (referenced), packages.ts, schema.ts, page.tsx, 0005 migration, check-boundaries.mjs, migrate.mjs, analyze-backfill.mjs, capability-precision.mjs, seed-fixture.mjs)
**Pattern extraction date:** 2026-08-11
