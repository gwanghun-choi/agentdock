# Requirements: AgentDock

**Defined:** 2026-08-10
**Core Value:** A developer who needs a specific agent capability can find a trustworthy, current artifact in one search — and can see what it will actually do to their machine before installing it.

Derived from `research/SUMMARY.md`. Every requirement traces to a phase in `ROADMAP.md`.

## Product claim these requirements must protect

> AgentDock reads an artifact's files and reports, with a source line for each, what the
> artifact declares it can do, what it bundles, what it references, and what it hides.
> It does not run anything and it cannot tell you whether the artifact is safe.

Any requirement that would weaken this claim into a safety verdict is out of scope by
construction, not by prioritization.

---

## v1 Requirements

### Foundation & Isolation

- [ ] **FND-01**: All AgentDock tables, indexes, types, and the migration-history table live in the `agentdock` schema and nowhere else
- [ ] **FND-02**: The application refuses to start if its connection `search_path` is not confined to `agentdock`
- [ ] **FND-03**: No migration command capable of generating destructive DDL against other schemas is reachable from `package.json` scripts
- [ ] **FND-04**: A dev-reset routine exists that can affect only the `agentdock` schema
- [ ] **FND-05**: CI fails if generated migration SQL references `public`, `didim_mcp`, or contains an unreviewed `DROP`
- [ ] **FND-06**: All configuration comes from validated environment variables; the app fails fast with a readable error on missing or malformed config
- [ ] **FND-07**: `.env.example` documents every variable with placeholders only, and states that `GITHUB_TOKEN` requires no scopes
- [ ] **FND-08**: No credential appears in Git, logs, error payloads, or planning documents
- [ ] **FND-09**: `bun install` followed by a single documented command runs the full app against the existing PostgreSQL instance

### GitHub Ingestion

- [ ] **ING-01**: A user submits a public GitHub repository and AgentDock discovers the agent artifacts inside it
- [ ] **ING-02**: Submission accepts `owner/repo` only; arbitrary URLs are never fetched, and the fetch host allowlist is hardcoded
- [ ] **ING-03**: Redirects are not followed off the allowlisted hosts
- [ ] **ING-04**: Repository file enumeration uses one Trees API call; file bodies are read from `raw.githubusercontent.com`
- [ ] **ING-05**: No repository content is ever written to disk or extracted from an archive
- [ ] **ING-06**: Per-file size, per-repo file-count, tree-depth, and wall-clock budgets are enforced, with streaming abort rather than trusting `Content-Length`
- [ ] **ING-07**: A truncated Git tree is surfaced as a visible state, never silently treated as complete
- [ ] **ING-08**: Rate-limit headers are tracked and the client backs off before exhaustion
- [ ] **ING-09**: The GitHub token is never logged and is stripped from serialized errors
- [ ] **ING-10**: Ingestion never executes any script, installer, or package manager from a scanned repository
- [ ] **ING-11**: URLs discovered *inside* repository content are extracted and displayed but never fetched
- [ ] **ING-12**: Re-ingesting an unchanged repository is a no-op detected by commit SHA
- [ ] **ING-13**: Ingestion is idempotent — the same `(repository, commit SHA)` always produces the same stored result

### Durable Job Processing

- [ ] **JOB-01**: Submission enqueues a job and returns immediately; ingestion runs asynchronously
- [ ] **JOB-02**: A user can observe job progress and its terminal outcome
- [ ] **JOB-03**: A crash mid-ingest leaves no partially-applied package state
- [ ] **JOB-04**: Jobs abandoned by a dead worker are automatically reclaimed
- [ ] **JOB-05**: A failed job records a readable reason and can be retried
- [ ] **JOB-06**: Job processing requires no service beyond PostgreSQL

### Data Model & Identity

- [ ] **DAT-01**: A repository's identity survives rename and transfer
- [ ] **DAT-02**: A package's identity is stable across re-ingestion
- [ ] **DAT-03**: A package version is identified by its content hash, making re-ingest naturally idempotent
- [ ] **DAT-04**: `commit_sha`, `scanned_at`, `etag`, `content_hash`, and `license_spdx` are populated from the first release
- [ ] **DAT-05**: Type-specific metadata is stored without forcing unrelated artifact types into one another's shape
- [ ] **DAT-06**: A denylist exists that survives re-crawling, so a removed repository is not silently re-added
- [ ] **DAT-07**: Forks are stored distinctly; duplicate suppression is a read-time concern that can never corrupt stored data

### Artifact Detection

- [ ] **DET-01**: Agent Skills (`SKILL.md` + frontmatter) are detected and parsed
- [ ] **DET-02**: Claude Code plugins are detected, including when `plugin.json` is absent, via directory shape
- [ ] **DET-03**: `marketplace.json` is treated as a catalog that emits repository seeds, not as a package
- [ ] **DET-04**: MCP server declarations are detected and parsed
- [ ] **DET-05**: Commands and hooks are detected
- [ ] **DET-06**: Repositories containing many artifacts (monorepos) yield all of them
- [ ] **DET-07**: A malformed or partial artifact is recorded with an explicit parse status rather than failing the whole repository
- [ ] **DET-08**: YAML and JSON parsing of untrusted input uses a safe loader with no code-execution path
- [ ] **DET-09**: Adding a new artifact type requires one new detector file and one registration, with no change to the pipeline
- [ ] **DET-10**: Every detector is unit-tested against frozen fixtures with no network access

### Capability Disclosure (the differentiator)

- [ ] **CAP-01**: A package detail page lists the artifact's file inventory (path, size, type, executable bit)
- [ ] **CAP-02**: Declared capabilities (`allowed-tools` and equivalents) are extracted and displayed
- [ ] **CAP-03**: Bundled executable scripts are inventoried and labeled as not analyzed
- [ ] **CAP-04**: Outbound URLs referenced by the artifact are inventoried
- [ ] **CAP-05**: Remote-execution and package-installation directives are surfaced
- [ ] **CAP-06**: Hidden or invisible content — Unicode tag characters, zero-width characters, bidi controls, HTML comments, hidden-styled text — is detected
- [ ] **CAP-07**: Hidden content is rendered with visible sentinels; it is never silently stripped, and the raw bytes are retained
- [ ] **CAP-08**: Every finding carries a file path, line number, and a permalink to that line at the pinned commit SHA
- [ ] **CAP-09**: A permanently visible section states what AgentDock does not check
- [ ] **CAP-10**: The UI never displays an aggregate risk score, letter grade, or any of the words *safe*, *clean*, *verified*, *trusted*, or *approved* as a verdict on an artifact
- [ ] **CAP-11**: Absence of a finding renders as "not detected", never as an assurance
- [ ] **CAP-12**: Findings use verbs of observation, never verbs of judgment
- [ ] **CAP-13**: Each shipped detector has a hand-checked false-positive rate recorded against a labeled fixture corpus
- [ ] **CAP-14**: Analyzer patterns are bounded and input-capped so that hostile input cannot cause catastrophic backtracking

### Safe Rendering

- [ ] **REN-01**: Artifact and README bodies render through a sanitizing Markdown pipeline with raw HTML passthrough disabled
- [ ] **REN-02**: A Content-Security-Policy is served that would contain a sanitizer failure
- [ ] **REN-03**: Package names, descriptions, and tags are escaped at every sink, including page titles, meta tags, and structured data
- [ ] **REN-04**: An XSS fixture suite passes before any ingested content is rendered

### Discovery & Browse

- [ ] **DIS-01**: A visitor can browse a paginated listing of indexed packages without an account
- [ ] **DIS-02**: A package detail page shows name, description, type, source repository, path within repository, license, and freshness
- [x] **DIS-03**: Full-text search returns relevance-ranked results
- [ ] **DIS-04**: Search tolerates typos via trigram fallback (06-04: `fuzzySearch()` implemented, tested, and boundary-clean in the working tree, but **BLOCKED** — `pg_trgm` is not installed on this environment's PostgreSQL instance, so the migration was never applied and the three maintainer-named typo queries were never verified live. Unblock: `CREATE EXTENSION pg_trgm SCHEMA agentdock;` as a superuser, then apply `drizzle/0007_green_jasper_sitwell.sql` and re-run 06-04's Task 4 measurement)
- [x] **DIS-05**: Results can be filtered by artifact type
- [x] **DIS-06**: Results can be filtered by declared capability, including "no scripts, no network, no shell"
- [x] **DIS-07**: A zero-result search offers a useful next step rather than an empty page
- [x] **DIS-08**: Search queries and result counts are logged from the first search release
- [ ] **DIS-09**: Pages are server-rendered and indexable by search engines
- [x] **DIS-10**: Search uses only PostgreSQL — no external search service (06-01: `search_vector`/GIN/`websearch_to_tsquery`, no new dependency, `package.json` unchanged)
- [ ] **DIS-11**: Every page is usable in light and dark mode, is responsive to mobile width, and meets basic accessibility requirements
- [ ] **DIS-12**: Long descriptions and long identifiers cannot break page layout

### Provenance & Freshness

- [ ] **PRV-01**: Every package links to its exact source file at the exact indexed commit
- [ ] **PRV-02**: The detail page distinguishes when the artifact was last changed upstream from when AgentDock last looked
- [ ] **PRV-03**: GitHub stars are labeled as GitHub stars, never as an AgentDock quality signal
- [ ] **PRV-04**: Archived or unavailable upstream repositories are flagged
- [ ] **PRV-05**: No semantic version is invented for an artifact that does not declare one
- [ ] **PRV-06**: Licence is shown as detected, with unknown shown honestly rather than guessed
- [ ] **PRV-07**: Only an excerpt of upstream content is stored and displayed, with attribution and a link to the source

### Install Guidance

- [ ] **INS-01**: The detail page provides copyable install instructions as text for the runtimes the artifact supports
- [ ] **INS-02**: AgentDock never executes an install on the user's behalf

### Corpus & Cold Start

- [ ] **COR-01**: The public MCP registry is synced without consuming GitHub quota
- [ ] **COR-02**: An operator seed list can bulk-populate the index
- [ ] **COR-03**: Catalog files fan out into repository seeds
- [ ] **COR-04**: Curated link lists can be expanded into seeds
- [ ] **COR-05**: Topic-based repository search is sharded to escape the result cap
- [ ] **COR-06**: At least 500 parsed artifacts exist before the browse experience is presented as ready
- [ ] **COR-07**: Submitted-but-ungated packages are reachable by direct link but excluded from listings and search until they clear a visibility floor

### Derived Compatibility

- [ ] **CMP-01**: Spec conformance is computed from the artifact's own frontmatter field set
- [ ] **CMP-02**: Runtime support is derived from computable evidence, backed by a versioned data table rather than hardcoded logic
- [ ] **CMP-03**: Compatibility is presented as `derived` / `declared` / `unknown`; `unknown` is shown, not hidden
- [ ] **CMP-04**: The author's free-text compatibility claim is displayed separately and labeled as an author claim, and never feeds a filter
- [ ] **CMP-05**: Compatibility is scoped within an artifact type and never implies cross-type portability

### Quality Engineering

- [ ] **QUA-01**: The codebase type-checks with no errors
- [ ] **QUA-02**: Lint and format run as one command and pass
- [ ] **QUA-03**: Detectors, analyzers, and identity logic have unit tests
- [ ] **QUA-04**: API routes have integration tests covering success and failure paths
- [ ] **QUA-05**: Security fixtures (XSS, SSRF, invisible characters, malformed frontmatter, oversized repository) are permanent regression tests
- [ ] **QUA-06**: Logging is structured, and no secret or full response body is logged
- [ ] **QUA-07**: Errors surface actionable messages to the user without leaking internals
- [ ] **QUA-08**: CI runs type-check, lint, tests, and the migration-safety check on every push

---

## v2 Requirements

Tracked, deliberately not in the v1 roadmap.

### Freshness Automation

- **V2-FRS-01**: Scheduled re-ingestion keeps the index current
- **V2-FRS-02**: Capability changes between versions are computed and shown as a diff
- **V2-FRS-03**: Stale entries visibly degrade rather than silently misinform

### Distribution

- **V2-API-01**: A public read-only API, returning sentinel-annotated content and never raw hidden payloads
- **V2-CLI-01**: A read-only CLI for search and inspection
- **V2-COL-01**: Curated collections

### Identity

- **V2-ACC-01**: Accounts — introduced only in service of watch/notify, the first feature that genuinely needs a delivery address
- **V2-WAT-01**: Watch an artifact and be notified when its capabilities change
- **V2-PUB-01**: Publisher claiming of a source repository

### Search Depth

- **V2-SEM-01**: Semantic search — gated on logged evidence of intent-shaped zero-result queries, and on a database image that provides vector support

---

## Out of Scope

| Feature | Reason |
|---------|--------|
| Aggregate risk score, letter grade, or SAFE/VERIFIED badge | A verdict replaces the user's judgment with a regex on a signal that cannot see most malicious content. Actively harmful, not merely unhelpful. |
| Executing, sandboxing, or dynamically analyzing indexed artifacts | The ingestion pipeline processes untrusted supply-chain input. Execution is the one thing that must never happen. |
| `agentdock install` and any installation automation | Six structurally different install mechanics across runtimes, times two scopes, times monthly vendor churn. Already served by an incumbent with more resources. |
| Ratings, comments, reviews | Requires accounts and moderation; a solo part-time maintainer cannot sustain moderation. |
| Download counts | AgentDock does not serve artifacts, so any download number would be fabricated. |
| Chasing catalog size | Incumbents claim far larger catalogs. A small, deeply analyzed index is the deliberate opposing bet. |
| LLM-generated descriptions or summaries of ingested content | Ingested text is attacker-controlled; summarizing it with a model creates a prompt-injection path and fabrication risk. |
| An AgentDock-specific manifest that publishers must adopt | Requires ecosystem adoption AgentDock cannot command; the value must come from artifacts as they already exist. |
| Mirroring upstream content as canonical | Legal exposure and a staleness liability. Excerpt and link instead. |
| Community submission queue with moderation | Ongoing moderation burden. Replaced by an automatic visibility gate. |
| Authentication in v1 | Everything in v1 is read-only over public data. Auth earns its place only when watch/notify exists. |
| Semantic search / vector database in v1 | Vector support is absent from the shared database image, and no evidence of need has been collected yet. |
| Kubernetes, Kafka, Redis, OpenSearch, Elasticsearch, microservices | No scale driver. One maintainer, one machine, one database. |
| Provisioning a new PostgreSQL server or Docker database | An instance already exists and is reachable; a dedicated schema provides the required isolation. |

---

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| FND-01 … FND-09 | Phase 0, Phase 1 | Pending |
| ING-01 … ING-07, ING-10, ING-11 | Phase 1 | Pending |
| ING-08, ING-09, ING-12, ING-13 | Phase 2 | Pending |
| JOB-01 … JOB-06 | Phase 2 | Pending |
| DAT-01 … DAT-06 | Phase 1 | Pending |
| DAT-07 | Phase 5 | Pending |
| DET-01, DET-08, DET-10 | Phase 1 | Pending |
| DET-02 … DET-07, DET-09 | Phase 3 | Pending |
| CAP-01 … CAP-14 | Phase 4 | Pending |
| REN-01 … REN-04 | Phase 1 | Pending |
| DIS-01, DIS-02, DIS-09, DIS-11, DIS-12 | Phase 1 | Pending |
| DIS-03 … DIS-08, DIS-10 | Phase 6 | Pending |
| PRV-01, PRV-02, PRV-03, PRV-05, PRV-06, PRV-07 | Phase 1 | Pending |
| PRV-04 | Phase 8 | Pending |
| INS-01, INS-02 | Phase 1 | Pending |
| COR-01 … COR-07 | Phase 5 | Pending |
| CMP-01 … CMP-05 | Phase 7 | Pending |
| QUA-01, QUA-02, QUA-06, QUA-07 | Phase 1 | Pending |
| QUA-03, QUA-05 | Phase 1, Phase 3, Phase 4 | Pending |
| QUA-04 | Phase 2 | Pending |
| QUA-08 | Phase 1 | Pending |

**Coverage:**

- v1 requirements: 103 total
- Mapped to phases: 103
- Unmapped: 0

---
*Requirements defined: 2026-08-10*
*Last updated: 2026-08-10 after project research synthesis*
