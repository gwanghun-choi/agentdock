---
gsd_state_version: '1.0'
status: planning
progress:
  total_phases: 9
  completed_phases: 5
  total_plans: 32
  completed_plans: 22
  percent: 69
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-08-10)

**Core value:** A developer who needs a specific agent capability can find a trustworthy, current artifact in one search — and can see what it will actually do to their machine before installing it.
**Current focus:** Phase 5 — Corpus & Cold Start (not yet planned)

## Current Position

Phase: 4 of 9 complete (Capability Disclosure)
Plan: 4 of 4 in Phase 4
Status: Phase 4 complete and verified — ready to plan Phase 5
Last activity: 2026-08-11 — Phase 4 executed. A detail page now carries a file inventory with the executable bit, a two-section capability panel (declared by the author / observed in the file text), a hidden-content panel with visible sentinels, and a permanent "What AgentDock does not check" block. Every finding links to its exact line at the pinned commit — verified live: `anthropics/skills` `skills/xlsx/SKILL.md#L16` returns HTTP 200 and the stored evidence matches that GitHub line byte-for-byte. CAP-10 is enforced mechanically by a sixth `check-boundaries` rule that fails CI on a verdict word in UI copy; demonstrated by injecting "verified and safe", watching CI fail, and removing it. ROADMAP's CAP-13 kill switch fired three times and deleted three detectors on measured evidence — the naive HTML-comment pattern at 26/26 false positives (25 of them inside fenced code blocks), a hidden-styled-HTML class at 1/1, and a credentials pilot whose 27 hits were all defensive prose.

Progress: [███████░░░] 69%

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

### Carried into Phase 5

| Item | Note |
|------|------|
| The disclosure panel is reachable only for `skill` artifacts | `sourcePathFromUrl` in `src/db/queries/packages.ts` hardcodes `SKILL.md`, so a plugin, MCP, command or hook package has no detail URL that resolves. Findings ARE computed and stored for every artifact with a body — only the page is unreachable. CAP-01..14 do not require the other five, so it was left and recorded rather than widened silently. |
| `install` sits at 10%, not the 5% first recorded | Re-labelled during phase verification: the first hand-check missed a negated instruction (`"preinstalled — do not run npm install first"`), which the procedure explicitly defines as a negative. The negation class is systematic, not a one-off. Still under the 20% kill line, so it ships. |
| `install`'s 13 `npx <tool>` hits are scored positive on an argued reading | `npx tsc --noEmit` runs a tool rather than installing one; they count as positives because `npx` fetches from the registry before executing. If that reading is ever rejected the rate goes to 75% and the detector dies. Recorded in `fixtures/capability-precision.md` so the decision is visible. |
| `network_request` is the closest shipped margin at 15% | Both false positives are on one line, and both come from a same-line rule rather than a verb-adjacent-to-URL rule. A tighter rule is a different claim needing its own twenty hits. |
| `declaredCapabilities` and `observedRemoteExecution` have zero real-world instances | `allowed-tools` appears zero times across the four frozen corpora, and no `curl \| sh` shape exists in them either. Both ship validated only against hand-written fixtures; their 0% is the absence of data, not a clean pass. Phase 5's corpus growth is the first chance to measure them for real. |
| All precision figures are precision, not recall | Nothing measures what the detectors MISS. The CAP-09 block says so on every detail page. |

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

Run `/gsd-plan-phase 5` to plan Corpus & Cold Start.

---
*Last updated: 2026-08-10 after Phase 2 execution and live verification*
