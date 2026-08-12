---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
current_phase: 6
current_phase_name: Search & Browse
status: executing
stopped_at: Completed AGD-06-04-PLAN.md (working-tree only, zero commits per maintainer override; DIS-04 BLOCKED on pg_trgm install)
last_updated: "2026-08-12T05:20:22.178Z"
last_activity: 2026-08-12
last_activity_desc: "06-01 fixed the carried Phase 4/5 defect (`sourcePathFromUrl`'s unconditional `/SKILL.md` append, which 404'd 531 of 921 listed artifacts across five non-skill types) via a promoted, artifact-primary `sourcePathCandidates`/`detailHref`; added a generated, weighted `search_vector` STORED column (GIN-indexed) to `agentdock.package`, applied to both live and test schemas with zero application backfill; and shipped `searchPackages` + `/artifacts`, the phase's tracer — a query that returns server-rendered rows and a click that opens the artifact, proven live against the real corpus (25 rows for `?q=mcp`, EXPLAIN 9.4ms at 1,137 rows, GIN index chosen). `bun run ci` green: 53 files, 900 tests."
progress:
  total_phases: 7
  completed_phases: 0
  total_plans: 31
  completed_plans: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-08-10)

**Core value:** A developer who needs a specific agent capability can find a trustworthy, current artifact in one search — and can see what it will actually do to their machine before installing it.
**Current focus:** Phase 6 — Search & Browse (Plan 4 of 4 executed; DIS-04 BLOCKED pending a superuser `pg_trgm` install)

## Current Position

Phase: 6 of 9 in progress (Search & Browse)
Plan: 4 of 4 in Phase 6 complete (working-tree only — zero commits made, per explicit maintainer override; see 06-04-SUMMARY.md)
Status: 06-04 (trigram typo-tolerance fallback) implemented, boundary-clean, and unit-tested, but never applied to any database — `pg_trgm` is genuinely absent from this environment. Migration generated and hand-guarded (`drizzle/0007_green_jasper_sitwell.sql`), fuzzy fallback query written (`fuzzySearch()` in `src/db/queries/search.ts`), UI close-matches branch added to `/artifacts` — all uncommitted working-tree changes. `bun run ci` green: 53 files, 971 tests passed, 7 skipped (the 7 gated fuzzy-fallback cases, visibly skipped without the extension).
Last activity: 2026-08-12 — 06-01 fixed the carried Phase 4/5 defect (`sourcePathFromUrl`'s unconditional `/SKILL.md` append, which 404'd 531 of 921 listed artifacts across five non-skill types) via a promoted, artifact-primary `sourcePathCandidates`/`detailHref`; added a generated, weighted `search_vector` STORED column (GIN-indexed) to `agentdock.package`, applied to both live and test schemas with zero application backfill; and shipped `searchPackages` + `/artifacts`, the phase's tracer — a query that returns server-rendered rows and a click that opens the artifact, proven live against the real corpus (25 rows for `?q=mcp`, EXPLAIN 9.4ms at 1,137 rows, GIN index chosen). `bun run ci` green: 53 files, 900 tests.

Every wave falsified a plan claim by running it rather than reading it — five in total, each fixed with a regression test: a registry watermark that would have permanently skipped part of the name space; a global seed ordering needing 11.1 days of quota to reach the operator's own seeds; a floor predicate that would have cut the listing to 469, below COR-06's own floor, by treating `partial` as failure; `bun run db:test:setup`, used by the plan as both "empty the schema" and "restore it", which empties nothing; and a fixture capture filter that would have logged a second fabricated "absence of data" for `allowed-tools`. (Phase 5 findings, carried forward below.)

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**

- Total plans completed: 0
- Average duration: —
- Total execution time: —

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**

- Last 5 plans: —
- Trend: —

**Per-Plan Metrics:**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase AGD-06-search-browse P02 | 25min | 3 tasks | 8 files |
| Phase AGD-06-search-browse P03 | 55min | 3 tasks | 6 files |
| Phase AGD-06-search-browse P04 | 90min | 3 tasks | 7 files |

## Accumulated Context

### Decisions

| Decision | Rationale |
|----------|-----------|
| Reuse the existing PostgreSQL instance with a dedicated `agentdock` schema | Instance already running and reachable; the schema name is verified free |
| Full TypeScript, one repository, one process | Nothing in the workload (HTTP, Markdown/YAML parsing, static text analysis, SQL, server-rendered UI) favors Python or Go; a split would add a toolchain and an IPC boundary for no capability |
| Server-side rendering | Organic search is the primary acquisition channel for a discovery product; the closest reference product is client-rendered and therefore invisible to search engines |
| PostgreSQL does storage, search, and the job queue | No Redis, no search cluster, no second stateful service for one maintainer to operate |
| Capability disclosure, never a risk score or safety badge | Static analysis cannot see most malicious content; a verdict would replace the user's judgment with a signal that is structurally blind |
| Ingestion is read-only static analysis; nothing is ever executed or written to disk | Untrusted supply-chain input; not writing to disk eliminates the archive-extraction vulnerability class by construction |
| Acquisition is registry sync + seed list + catalog fan-out + sharded topic search | GitHub Code Search returns zero results for the intended patterns (verified), and a full crawl exceeds a solo token budget |
| Compatibility is derived from files, not read from the declared field | The spec's `compatibility` field is free prose, so declared compatibility is useless as a filter |
| No authentication in v1 | Everything in v1 is read-only over public data; auth earns its place only when watch/notify exists |
| Artifact identity is source_path-primary; `skill` is one variant, not the default | Five of six types have no manifest filename to append (a shape-only plugin has none at all); the literal `source_path` is already the disambiguating value, so the URL should carry it directly instead of reconstructing it |
| `search_vector` is a STORED generated column, not a trigger | Generated columns cannot reference another table (verified live), so no cross-table need remains once repository-name matching is split out at query time; a STORED column is always consistent by construction with no trigger to maintain |

- [Phase ?]: 06-02: D-12 ranking is four summed terms (exact name 2.0, prefix 1.0, ts_rank, repo-name ILIKE 0.1), each above ts_rank's measured ceiling so name matches can never be outranked by description relevance
- [Phase ?]: 06-02: searchWhere(q) branches on empty query before building any predicate — websearch_to_tsquery('') matches nothing via @@, so browse mode must never apply it
- [Phase ?]: 06-02: /skills -> /artifacts via next.config.ts redirects() (308, permanent), verified live to preserve the query string; no fallback page needed
- [Phase ?]: 06-03: filters are conjuncts inside searchWhere() (never a second predicate), absence-only capability filters (no_network/no_shell/no_scripts), catalog needs a regression test and no code
- [Phase ?]: 06-03: SearchLog joins IngestLog/WorkerLog on the one log() function; query is the sole deliberate free-form field, bounded and documented rather than dropped (D-44)
- [Phase ?]: 06-03: zero-result page always shows Clear filters + Browse all links (not gated on hasFilters), so a plain zero-result search still offers two next steps
- [Phase ?]: 06-04: zero commits made per explicit maintainer override (no git commit/push policy); all trigram-fallback work is working-tree-only, HEAD unchanged at 7a95708
- [Phase ?]: 06-04: migration generated/guarded/boundary-checked but never applied — pg_trgm genuinely absent from this environment; DIS-04 remains BLOCKED pending superuser CREATE EXTENSION pg_trgm SCHEMA agentdock
- [Phase ?]: 06-04: fuzzySearch() reuses searchWhere('', filters) for suppression/type/capability filters rather than a second predicate; catches PG_UNDEFINED_FUNCTION ('42883') only around the fallback call, verified live since this environment has the extension genuinely absent

### Blockers

| Blocker | Impact | Needs |
|---------|--------|-------|
| ~~Database role decision~~ | — | **RESOLVED 2026-08-10.** Branch A approved and applied: `agentdock_app` created as a non-superuser owning only `agentdock` and `agentdock_test`. Isolation verified 7/7. |

- DIS-04 (typo-tolerance search) is implemented in the working tree but not shipped: pg_trgm is not installed on this environment's PostgreSQL instance. Needs: a superuser to run CREATE EXTENSION pg_trgm SCHEMA agentdock; then apply drizzle/0007_green_jasper_sitwell.sql to both agentdock and agentdock_test, then re-run 06-04's Task 4 measurement and live verification.

### Carried into Phase 6

| Item | Note |
|------|------|
| `artifactsTruncated` conflates three unrelated causes | `skipped.length > 0` mixes the file cap, the wall-clock deadline, and a raw fetch that threw, and the count itself is destroyed at `src/ingest/pipeline.ts:377`. Measured consequence: `anthropics/skills` reads truncated with **19 of 19 candidates readable today**, and since Phase 2 a truncated scan suppresses delisting — so one transient blip marks a repository permanently partial and it never converges. `davila7/claude-code-templates` is the genuine case: 1,300 candidates against a cap of 400, 900 unread. Found during Phase 5, deliberately **not fixed** — it is a logging-and-classification change outside that phase's files. Same shape as Phase 4's `seedsSkipped`, which Phase 5 did close. |
| `src/db/queries/jobs.test.ts` has two intermittently flaky concurrency tests | ~2 runs in 14, pre-existing, and aggravated by the DB-backed test files Phase 5 added. It failed once running in isolation, which rules out only cross-suite contention. A `pg_advisory_xact_lock` would remove the class permanently; Phase 5 deliberately did not expand into test-infrastructure work. |
| ~~The detail page is still reachable only for `skill` artifacts~~ | **RESOLVED 2026-08-12 (06-01).** `sourcePathFromUrl` replaced by `sourcePathCandidates` (literal-first, `/SKILL.md`-fallback-second); `detailHref` is type-aware. All six artifact types verified live at their own `/r/{owner}/{repo}/{path}` URL against the real corpus; every existing skill URL is byte-identical to before. |
| Fork suppression ships with zero real positives | Sixteen repositories, none a fork. `repository.isFork` was already fetched and stored (`src/github/repo.ts:35`, `src/db/schema.ts:83`) and is now read, but the path is fixture-validated only. No fork was hunted down to make the number non-zero. Absence of data, not a clean pass. |
| `network_request` gained **zero** hits from a doubled corpus | Still 2/13 = 15%, the narrowest shipped margin, now on seven corpora and 169 files instead of four and 84. The corpus grew and this detector learned nothing — that is a fact about the corpus, not a re-validation of the detector. |
| `install` detects 0 of 6 real install directives found by hand | `npm ci` appears six times in `addyosmani-agent-skills skills/ci-cd-and-automation/SKILL.md` and the alternation does not contain it. Twenty other install shapes were searched for and appear zero times, so the corpus cannot speak to them. This is the phase's only recall measurement and it is a floor on a hand-picked sample, not a corpus-wide rate. |
| `observedRemoteExecution` and `observedHiddenContent` remain at zero across seven corpora | 169 files, no `curl \| sh` shape, no hidden-content instance. A **larger** absence of data than Phase 4 recorded, and still not a measured clean pass. |
| Provenance is single-valued and last-writer-wins | Three sources can name one repository; `repo_seed.discovered_from` keeps only the most recent. Measured during Phase 5: a curated-link run re-tagged 253 registry seeds and 4 of the 15 operator seeds. No single-valued column makes "which source found this" true when three did. Left alone deliberately — the phase brief forbids an elaborate provenance graph — and recorded as a maintainer decision. |
| COR-05 ships as measured incompleteness, by design | `topic:claude-code` holds 57,970 repositories with 36,487 at 0–1 stars; a star ladder cannot subdivide that below the 1,000-result cap, and 58,000 repos × 2 calls is eighty days of quota. The sweep therefore names every shard it could not reach with that shard's measured size. Criterion 4's intent — no *silent* truncation — is met; blanket coverage was never reachable and is not claimed. |
| `.env.example` is still unverified | The harness denies all `.env*` access. Phase 5 added no new secret and needs no new variable, so nothing changed — but the Phase 0..4 items (`DATABASE_URL`, `GITHUB_TOKEN`, `INGEST_WORKER`) remain confirmable only by hand. Not circumvented. |

### Carried into Phase 4

| Item | Note |
|------|------|
| Shape-only plugin detection is unexercised against live data | The `≥2 component shapes` threshold plus the dot-directory and repository-root exclusions were calibrated against the four frozen corpora (3,831 blobs, zero GitHub cost) and are locked by tests, but every plugin in those corpora carries a manifest. The manifest-less path has never fired on a real repository. **CAP-13 already mandates a hand-checked false-positive rate per detector against a labeled corpus — that is where this gets measured.** |
| `seedsSkipped` is not a structured log field | A `marketplace.json` entry with an `npm`, `archive`, or relative source is counted and dropped, and the count reaches no log line. Observability gap, not a correctness one. |
| `repo_seed` has no consumer | Rows are written and nothing reads them until Phase 5 (COR-03) designs seed→job fan-out against `MAX_QUEUED = 500`. Deliberate: no `status` or `enqueued_at` column was added for a consumer that does not exist. |
| `CAPS.maxFiles` is now 400 | Raised from 200 because six detectors want 384 files from the largest frozen corpus, and since Phase 2 a truncated scan suppresses delisting — so the largest real repository would have read as permanently partial and never converged. Cost is raw fetches and wall clock only; raw reads consume no GitHub core quota. At `CAPS.concurrency = 2` this is a 600 ms/file budget inside `CAPS.wallClockMs = 120_000`. |
| One `.mcp.json` in the whole corpus | The MCP detector's two shapes (`.mcp.json`, `server.json`) are tested, but `server.json` has no real-world instance on disk and the MCP registry schema is self-described as "in preview". Re-check before Phase 5's registry sync. |
| Per-file, not per-server, MCP identity | One package row per MCP declaration file. If Phase 6's search wants per-server rows, that is a re-key and should be decided with query-log evidence. |

### Carried into Phase 3

| Item | Note |
|------|------|
| A second, remote PostgreSQL was inspected on 2026-08-10 | `49.50.138.22 / didim_api`. **pgvector 0.8.2 is available there and `pg_trgm` is already installed** — the "pgvector is unavailable" premise in `PROJECT.md`, `SUMMARY.md`, and `REQUIREMENTS.md` is true of the *local* instance only. Availability is not a reason to build semantic search; Phase 6 still gates it on logged evidence. Details in `research/ENVIRONMENT.md`. **Whether AgentDock moves there is an open maintainer decision** — if it does, Phase 0's bootstrap must be repeated, since that instance hosts five applications and its only login role is a superuser. |
| `test-owner/*` sentinel discipline across five parallel DB suites | Load-bearing but only documented in comments. A future suite that leaves a `queued` row with a past `next_attempt_at` will make `claimJob`'s null-return assertions flaky. A `pg_advisory_xact_lock` would remove the class permanently. |
| `runWorker()`'s loop body is untested | The `while`+`sleep` is covered only by `bun run verify:worker`, which needs a build and a database and is therefore not in `ci`. |
| `.env.example` needs one documented line | `INGEST_WORKER` — optional, `0` turns the in-process ingest loop off. Not a secret. This environment denies all `.env*` access, so it must be added by hand. |
| Ingestion still has no abuse protection | Acceptable for local development; tracked for any public exposure. |

### Carried from Phase 1

| Item | Note |
|------|------|
| Re-ingest reports "24 stored" on an unchanged repo | Data is correct — no duplicate rows are created. The *wording* implies new writes. Phase 2 owns the commit-SHA short circuit and should make the message say nothing changed. |
| `GITHUB_TOKEN` is empty; unauthenticated 60/hr | ~30 repo ingests an hour. The client already sends the token when present, so this is a config change, not a code change. |
| Ingestion is synchronous in the request | Phase 2 moves it to the `ingest_job` queue. A large repo currently occupies a request for its duration. |
| `.env.example` could not be verified | This environment denies all access to `.env*`. Confirm by hand that it contains a `GITHUB_TOKEN=` line and placeholders only. |
| Submit endpoint has no abuse protection | Acceptable for local development, tracked for any public exposure. |

### Carried from Phase 0

| Item | Note |
|------|------|
| Status page discloses role name and `search_path` | Acceptable on localhost; must move or be gated before any network exposure |
| `bun test` (Bun's own runner) hangs on vitest files | Use `bun run test`. Documented in README, not fixed — fixing means config for no behavior change |
| `pg_hba.conf` grants `trust` on the container's loopback | Anyone with `docker exec` is already superuser-equivalent. Pre-existing environment property, not introduced here; not changed because the co-tenant depends on it. The app's real path (host → published port) correctly enforces `scram-sha-256`, verified both ways. |
| `drizzle-kit migrate` unusable; replaced by `scripts/migrate.mjs` | Drizzle's migrator emits `CREATE SCHEMA IF NOT EXISTS`, and PostgreSQL checks database-level `CREATE` before the existence check — so it fails `42501` for a correctly-confined role. The replacement reuses drizzle's own `__drizzle_migrations` format, so switching back later needs no data change. |

### Constraints

- AgentDock owns the `agentdock` schema and nothing else; it must never read, write, or migrate `public` or `didim_mcp`
- AgentDock connects as the non-superuser `agentdock_app`, which owns only `agentdock` and `agentdock_test` and holds no privilege on any pre-existing table. The database enforces this; application-layer schema qualification is defense in depth on top. *(Superseded the earlier note that isolation could not be enforced — that was true only while connecting as `mcp`.)*
- Vector support is absent from the **local** database image. It **is** available (0.8.2) on the remote `didim_api` instance inspected 2026-08-10. Either way, semantic search is gated on measured evidence from Phase 6's query log, not on availability.
- The GitHub token must be dedicated and scopeless; the ambient `gh` credential must never be reused
- WSL local development only; no Kubernetes, no production deployment in this milestone
- One part-time maintainer — anything requiring ongoing manual curation or moderation will not survive

### Open Questions

- Whether AgentDock stays on the local instance or moves to the remote `didim_api` one — the maintainer's call; a move repeats the Phase 0 bootstrap
- `pg_trgm` is not installed locally (needs a superuser) but **is already installed** on the remote instance, so which instance Phase 6 targets changes whether that coordination is needed at all
- False-positive rate of injection-shaped detection on a real corpus — decides whether that detector ships as flags, as "patterns worth reading", or not at all
- Actual distribution of artifact types in the wild, which affects detector priority
- Several security effect sizes rest on unverified 2026 preprints; they shape the framing, not the design, and must not be quoted publicly

## Next Action

Execute `06-02-PLAN.md` (ranking, filters foundation, pagination, `/skills` → `/artifacts`
redirect) — it builds directly on 06-01's `searchPackages`, `sourcePathCandidates`/`detailHref`,
and the `search_vector` column. 06-03 and 06-04 (trigram fallback, gated on the maintainer's
out-of-band `pg_trgm` install) follow.

---
*Last updated: 2026-08-12 after Phase 5 execution, independent verification (16/16) and the browser checkpoint*

## Session

**Last session:** 2026-08-12T05:20:22.155Z
**Stopped at:** Completed AGD-06-04-PLAN.md (working-tree only, zero commits per maintainer override; DIS-04 BLOCKED on pg_trgm install)
**Resume file:** None
