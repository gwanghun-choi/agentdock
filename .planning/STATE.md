---
gsd_state_version: '1.0'
status: planning
progress:
  total_phases: 9
  completed_phases: 0
  total_plans: 27
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-08-10)

**Core value:** A developer who needs a specific agent capability can find a trustworthy, current artifact in one search — and can see what it will actually do to their machine before installing it.
**Current focus:** Phase 0 — Database Isolation Bootstrap (blocked on maintainer decision)

## Current Position

Phase: 0 of 9 (Database Isolation Bootstrap)
Plan: 0 of 2 in current phase
Status: Ready to plan — blocked on one maintainer decision
Last activity: 2026-08-10 — Project research, requirements, and roadmap completed

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
| Database role decision | Blocks Phase 0, and determines the ORM choice for every later phase | Maintainer approval to create a dedicated non-superuser `agentdock_app` role in the shared database (Branch A), or a decision to accept application-layer discipline only and switch to hand-written SQL migrations (Branch B) |

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

Resolve the Phase 0 database role decision, then run `/gsd-plan-phase 0`.

---
*Last updated: 2026-08-10 after project research and roadmap creation*
