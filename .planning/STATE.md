---
gsd_state_version: '1.0'
status: planning
progress:
  total_phases: 9
  completed_phases: 2
  total_plans: 30
  completed_plans: 10
  percent: 33
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-08-10)

**Core value:** A developer who needs a specific agent capability can find a trustworthy, current artifact in one search — and can see what it will actually do to their machine before installing it.
**Current focus:** Phase 2 — Durable Ingestion (not yet planned)

## Current Position

Phase: 1 of 9 complete (Walking Skeleton)
Plan: 6 of 6 in Phase 1
Status: Phase 1 complete and verified against a live repository — ready to plan Phase 2
Last activity: 2026-08-10 — Phase 1 executed. Live ingest of `addyosmani/agent-skills` found and stored 24 skills; list and detail pages render; the stored permalink resolves on GitHub; re-ingest produced no duplicate rows.

Progress: [███░░░░░░░] 33%

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

### Carried into Phase 2

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
- The connecting role is currently a superuser that owns the other application's schema, so `REVOKE`-based isolation is ineffective
- Vector support is unavailable in the shared database image, so semantic search would require changing an image another application depends on
- The GitHub token must be dedicated and scopeless; the ambient `gh` credential must never be reused
- WSL local development only; no Kubernetes, no production deployment in this milestone
- One part-time maintainer — anything requiring ongoing manual curation or moderation will not survive

### Open Questions

- Exact grant set for the dedicated role against a live shared database
- Whether `pg_trgm` installation needs coordination with the other application's owner
- False-positive rate of injection-shaped detection on a real corpus — decides whether that detector ships as flags, as "patterns worth reading", or not at all
- Actual distribution of artifact types in the wild, which affects detector priority
- Several security effect sizes rest on unverified 2026 preprints; they shape the framing, not the design, and must not be quoted publicly

## Next Action

Run `/gsd-plan-phase 2` to plan Durable Ingestion.

---
*Last updated: 2026-08-10 after Phase 1 execution and live verification*
