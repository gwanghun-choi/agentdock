# AgentDock

## What This Is

AgentDock is an open registry and discovery platform for AI agent extensions — Agent
Skills, plugins, MCP servers, commands, and hooks. It ingests public GitHub
repositories, parses the agent artifacts inside them, and lets developers search,
compare, and evaluate those artifacts in one place instead of hunting across scattered
awesome-lists and vendor-specific marketplaces.

It is a personal open-source project by a single maintainer, run locally first.

## Core Value

A developer who needs a specific agent capability ("FastAPI review skill", "Kubernetes
troubleshooting") can find a trustworthy, current artifact in one search — and can see
what it will actually do to their machine before installing it.

## Requirements

### Validated

(None yet — nothing shipped)

### Active

<!-- Scoped after research. Full detail with traceable IDs in REQUIREMENTS.md. -->

- [ ] Ingest a public GitHub repository and discover the agent artifacts inside it
- [ ] Detect and parse all five artifact types — skills, plugins, MCP servers, commands, hooks
- [ ] **Capability disclosure**: report what an artifact declares, bundles, references, and
      hides, with a source line for every finding — and never a safety verdict
- [ ] Browse and search from a server-rendered web UI, with no account required
- [ ] Package detail: metadata, provenance to the exact file at the exact commit, rendered
      body, install text, and the permanent list of what AgentDock does not check
- [ ] **Derived** compatibility computed from the artifact's own files
- [ ] Fill the index without a crawler: registry sync, seed list, catalog fan-out
- [ ] Run entirely on a local WSL machine against the existing PostgreSQL instance

### Out of Scope

<!-- Explicit boundaries, with reasoning, so they are not silently re-added. -->

- Executing any code, script, or installer from a scanned repository — the whole point of
  the security model is that ingestion is read-only static analysis
- Kubernetes, Kafka, service mesh, microservice decomposition — single maintainer, single
  machine, no scale problem to justify them
- A separate search cluster (OpenSearch / Elasticsearch) or vector database (Milvus) —
  PostgreSQL must be proven insufficient first
- Payments, billing, tenant management — non-commercial personal OSS project
- Cloning SkillMaru's design or code — it is a reference for information architecture
  only

## Context

**Ecosystem (corrected after research — two initial assumptions were wrong).**
Agent Skills is **no longer an Anthropic-specific format**. It is a governed multi-vendor
standard published at `agentskills.io/specification` with hard field constraints and a
reference validator, adopted by roughly 48 runtimes including Cursor, Gemini CLI,
OpenCode, Codex, Copilot, VS Code, Goose, Amp and Kiro. Portability between runtimes
already largely exists, so **cross-ecosystem translation is not an available wedge**.

The market is also **not empty**: at least eight live directories exist, and `skills.sh`
is already both cross-runtime (20+ agent filters) and security-adjacent (it has an
`/audits` section). The initial premise that "no neutral cross-ecosystem registry with a
security lens exists" was false and has been struck.

**What remains genuinely open:** nobody derives *what an artifact will do to your machine*
from the artifact's own files. Existing sites either outsource to dependency scanners
(Socket/Snyk pointed at prompt bundles, largely showing "Pending"), score only MCP, or
deliberately do nothing. Derived capability and permission transparency is the wedge.

**Reference product.** `https://skillmaru.hell0world.net/` turned out **not** to be a
comparable product. It requires authentication even to browse (`/api/web/packages` → 401)
and describes itself as a 사내 (in-house) registry; its API is built on namespaces,
publish tokens, and admin-curated labels. It is a push-model private publishing registry —
structurally the opposite of a public GitHub-ingest index — and is a fork of the
open-source `openclaw/clawhub`. It is a reference for information architecture only, not a
competitor. See `research/SKILLMARU.md`.

**Supply chain framing.** A Skill is not inert Markdown. It is instruction text injected
into an agent's context, often bundled with executable scripts and allowed-tools
declarations. Treat every ingested artifact as untrusted supply-chain input.

**Local environment (verified 2026-08-10).** An existing PostgreSQL 16 instance is
already running and reachable on this machine (Docker container
`didim-mcp-service-backend-db-1`, database `mcpdb`). Its current schemas are `public` and
`didim_mcp` — no `agentdock` schema exists, so the name is free. The connecting role has
superuser rights. `pg_trgm`, `pgcrypto`, `unaccent`, and `uuid-ossp` are available but not
yet installed. **`pgvector` is NOT available in that image** — adding semantic search
would require changing the database image, which is a cost that must be justified before
it is considered.

**Toolchain present.** Bun 1.3.14, Node 22.22.3, Python 3.12.3, Docker. GSD Core 1.9.1,
Ponytail 4.8.4, gstack skills, cc-devops-skills.

## Constraints

- **Database**: Reuse the existing shared PostgreSQL instance; own a dedicated `agentdock`
  schema and nothing else — AgentDock must never read, write, or migrate `public` or
  `didim_mcp` objects, because another application owns them.
- **Deployment**: WSL local development only. `bun install` → run → working app. No
  Kubernetes, no production deploy in this milestone.
- **Search**: PostgreSQL-native first (full-text search + `pg_trgm`). `pgvector` is
  unavailable in the current DB image, so semantic search is gated behind a proven need.
- **Security**: The ingestion pipeline performs metadata fetch, file download, text
  parsing, and static analysis only. Never `npm install`, `pip install`, or `bash` a
  scanned repository.
- **Secrets**: GitHub tokens and DB credentials live in environment variables only.
  `.env.example` ships placeholders; no real credential enters Git or planning docs.
- **Team**: One maintainer, part-time. Anything requiring ongoing manual curation at scale
  will not survive.
- **Data source**: GitHub REST/GraphQL under unauthenticated and PAT rate limits — the
  ingestion design must fit inside those limits.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Reuse existing PostgreSQL with a dedicated `agentdock` schema | Instance already running; schema name verified free | — Pending |
| A dedicated non-superuser DB role is required for real isolation | The current role is a superuser that owns the other application's schema, so `REVOKE` is ineffective — PostgreSQL bypasses privilege checks for superusers | — Pending (blocking) |
| No arbitrary execution of ingested repositories, and nothing written to disk | Untrusted supply-chain input; not writing to disk removes the archive-extraction vulnerability class entirely | — Pending |
| Local-first, single repository, single process | Solo maintainer, no scale driver for distribution | — Pending |
| Full TypeScript; Next.js App Router with server rendering | Nothing in the workload favors another language; SSR is required because organic search is the acquisition channel for a discovery product | — Pending |
| PostgreSQL for storage, search, and the job queue | Avoids Redis, a search cluster, and a second stateful service | — Pending |
| **Capability disclosure, never a risk score or safety badge** | Static analysis cannot see most malicious content; a verdict would replace the user's judgment with a structurally blind signal. This is a product constraint, not a preference — it must not be relaxed into a sortable score later. | — Pending |
| Acquisition without a crawler | GitHub Code Search returns zero results for the intended patterns (verified live), and a full crawl exceeds a solo token budget | — Pending |
| Compatibility derived from files, not from the declared field | The spec's `compatibility` field is free prose, so declared compatibility cannot drive a filter | — Pending |
| No authentication in v1 | All v1 functionality is read-only over public data | — Pending |

---
*Last updated: 2026-08-10 at project initialization (pre-research)*
