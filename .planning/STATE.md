---
gsd_state_version: '1.0'
status: planning
progress:
  total_phases: 9
  completed_phases: 3
  total_plans: 32
  completed_plans: 15
  percent: 47
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-08-10)

**Core value:** A developer who needs a specific agent capability can find a trustworthy, current artifact in one search — and can see what it will actually do to their machine before installing it.
**Current focus:** Phase 3 — Detector Pluralism (not yet planned)

## Current Position

Phase: 2 of 9 complete (Durable Ingestion)
Plan: 5 of 5 in Phase 2
Status: Phase 2 complete and verified live — ready to plan Phase 3
Last activity: 2026-08-10 — Phase 2 executed. Submit is asynchronous and returns immediately; an in-process worker claims jobs with `FOR UPDATE SKIP LOCKED`; re-index reports `24 discovered · 0 new · 0 updated · 24 unchanged` in 366 ms without re-reading files; a failing job left the 24 previously indexed packages untouched. A live delisting bug found in Phase 1's code was reproduced and fixed.

Progress: [█████░░░░░] 47%

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

### Blockers

| Blocker | Impact | Needs |
|---------|--------|-------|
| ~~Database role decision~~ | — | **RESOLVED 2026-08-10.** Branch A approved and applied: `agentdock_app` created as a non-superuser owning only `agentdock` and `agentdock_test`. Isolation verified 7/7. |

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

Run `/gsd-plan-phase 3` to plan Detector Pluralism.

---
*Last updated: 2026-08-10 after Phase 2 execution and live verification*
