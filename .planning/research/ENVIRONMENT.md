# Environment Research — Verified Local Facts

Measured directly on the target machine on **2026-08-10**. Unlike the other research
documents, nothing here is from documentation or web search — every line was observed by
running a command. These are the hard constraints the architecture must fit.

## Toolchain

| Tool | Version | Path |
|------|---------|------|
| Bun | 1.3.14 | `~/.bun/bin/bun` |
| Node | 22.22.3 | `~/.nvm/versions/node/v22.22.3/bin/node` |
| Python | 3.12.3 | `/usr/bin/python3` |
| Docker | present | `/usr/bin/docker` |
| gh CLI | present, authenticated | `/usr/bin/gh` |
| `psql` client | **NOT installed on host** | — access DB via `docker exec` or a driver |

Planning/workflow tooling: GSD Core 1.9.1 (`~/.claude/gsd-core`), Ponytail 4.8.4,
gstack skill suite, cc-devops-skills 1.0.0.

**Status:** 검증됨 — observed
**Evidence:** `bun --version`, `node --version`, `python3 --version`, `command -v`
**Last verified:** 2026-08-10

## PostgreSQL — the instance AgentDock must share

Running as Docker container `didim-mcp-service-backend-db-1`, image `postgres:16-alpine`
(PostgreSQL 16.14), published on `0.0.0.0:5432`.

| Property | Value |
|----------|-------|
| Database | `mcpdb` (owner: `mcp`) |
| Connecting role | `mcp` |
| Role privileges | `rolsuper=t`, `rolcreatedb=t`, `rolcreaterole=t` |
| Existing schemas | `public` (owner `pg_database_owner`), `didim_mcp` (owner `mcp`) |
| `agentdock` schema | **does not exist — the name is free** |
| Login roles in cluster | **exactly one: `mcp`, and it is superuser** |

### The isolation problem, stated precisely

`mcp` is a **superuser**, owns the `mcpdb` database, and owns the `didim_mcp` schema. It
is also the *only* login role in the cluster.

This matters because it invalidates the obvious mitigation. **`REVOKE` does not constrain
a superuser** — PostgreSQL bypasses all privilege checks for superusers, and an object
owner can re-grant to itself regardless. So a defensive script that revokes AgentDock's
access to `public` and `didim_mcp` while AgentDock still connects as `mcp` provides
**zero** real protection; it only provides the feeling of protection.

There are exactly two honest options:

1. **Create a dedicated non-superuser role** (e.g. `agentdock_app`) that owns only the
   `agentdock` schema and has no privileges on `public` or `didim_mcp`. This is the only
   configuration where the database itself enforces the boundary, turning a
   silent-catastrophic failure mode into a loud, harmless permission error. Creating the
   role is a one-time manual superuser step.
2. **Connect as `mcp` and accept that isolation is enforced only by application
   discipline** — schema-qualified DDL, a pinned `search_path`, and never running
   generative `push`/`pull` migration commands. One tooling bug or one careless command
   can still reach another application's data.

Option 1 costs a few minutes once and cannot be safely retrofitted after migrations have
already run under the wrong owner. It should be the first task in the roadmap. Note that
this is a change to a database shared with a *running* application, so it requires the
maintainer's explicit go-ahead — it is deliberately **not** performed as part of this
planning work.

Credentials exist in the container environment and are deliberately not recorded here.

### Extensions

| Extension | Available | Installed |
|-----------|-----------|-----------|
| `pg_trgm` | yes (1.6) | no |
| `pgcrypto` | yes (1.3) | no |
| `unaccent` | yes (1.1) | no |
| `uuid-ossp` | yes (1.1) | no |
| **`vector` (pgvector)** | **NO — not present in this image** | no |

### Consequences for architecture

1. **The `agentdock` schema name is confirmed free.** No collision with `public` or
   `didim_mcp`. Proceed with it.
2. **The connecting role is a superuser that also owns the other application's schema.**
   This is the single largest operational risk in the project — see "The isolation
   problem, stated precisely" above. Creating a dedicated non-superuser role is the only
   mechanism that actually enforces the boundary; everything at the application layer is
   defense in depth on top of it.
3. **pgvector is unavailable.** Semantic search is not merely "later" — it would require
   swapping the shared database image, which affects another running application. This
   effectively rules embeddings out of the MVP and raises the bar for adding them later.
   `pg_trgm` + native full-text search is the search story.
4. **No host `psql`.** Migration tooling must connect over TCP with a driver rather than
   shelling out to `psql`.

**Status:** 검증됨 — observed
**Evidence:** `docker inspect`, `psql \dn`, `pg_available_extensions`, `pg_roles`
**Last verified:** 2026-08-10

## A second, remote PostgreSQL exists — capabilities differ from the local one

On 2026-08-10 the maintainer supplied credentials for a **remote** PostgreSQL instance and
asked for a connectivity check. It was inspected **read-only**; nothing was created,
altered, or written, and no credential is recorded in this repository.

| Property | Local (`mcpdb`, Docker) | Remote (`didim_api`) |
|----------|-------------------------|----------------------|
| Version | 16.14 (Alpine) | 16.14 (Debian) |
| Schemas in use | `didim_mcp`, `public` | `bidpilot`, `didim_mcp`, `didim_rag`, `didim_vault`, `report`, `public` |
| Tables | 10 | 46, across five applications |
| Login roles | `mcp` only, superuser | `postgres` only, superuser |
| `pg_trgm` | available, **not installed** | **installed** (1.6) |
| `vector` (pgvector) | **not available at all** | **available** (0.8.2), not installed |
| `agentdock` schema | created in Phase 0 | does not exist |

### What this changes, and what it does not

**Changes:** the claim repeated across `PROJECT.md`, `SUMMARY.md`, and `REQUIREMENTS.md`
that "pgvector is unavailable, so semantic search would require swapping a shared database
image" is true of the *local* instance only. On the remote instance pgvector is one
`CREATE EXTENSION` away. `pg_trgm` is likewise already installed there, which removes the
superuser coordination step Phase 6 anticipated.

**Does not change:** whether semantic search is *warranted*. The gating decision was always
evidence — a measured rate of intent-shaped zero-result queries — not availability. Phase 6
still logs queries first. Availability removes an obstacle; it does not supply a reason.

### If AgentDock ever moves to this instance

The isolation problem is **worse** here, not better: five applications share it, and the
only login role is a superuser. Every argument from Phase 0 applies with more force, so the
same bootstrap is required — a dedicated non-superuser `agentdock_app` owning only an
`agentdock` schema. Connecting AgentDock as `postgres` would hand an ingestion service that
processes untrusted input full authority over five applications' data.

Two further differences to check before any move: it is reachable over the network rather
than a local socket, and its `pg_hba` rules were not inspected.

**Status:** 검증됨 — observed read-only
**Evidence:** `psql` against the remote host, 2026-08-10; catalog queries only
**Last verified:** 2026-08-10

## GitHub API — live rate limits measured from this machine

Measured against `https://api.github.com/rate_limit`.

| Resource | Unauthenticated | Authenticated (PAT) |
|----------|-----------------|---------------------|
| `core` (REST) | **60 / hour** | **5,000 / hour** |
| `graphql` | 0 (unavailable) | **5,000 points / hour** |
| `search` | 10 / minute | **30 / minute** |
| `code_search` | (reported 60, but code search requires auth) | **10 / minute** |

### Consequences for architecture

1. **Unauthenticated ingestion is not viable.** 60 REST calls/hour is roughly one
   repository per hour once tree and file fetches are counted. A token is mandatory.
2. **`code_search` at 10 requests/minute is the binding constraint on automated
   GitHub-wide discovery** (acquisition strategy B). Any crawl-the-world plan must be
   designed around ~600 code-search requests/hour maximum, and GitHub's Code Search API
   caps result pagination besides. This strongly favors URL-submission and curated seeding
   for the MVP, with code search as a slow background top-up.
3. **GraphQL's 5,000 points/hour with batching** is materially better than REST for
   refreshing metadata across many already-known repositories — one query can carry many
   repos. Worth using specifically for the periodic refresh path.

**Status:** 검증됨 — observed
**Evidence:** `gh api rate_limit`, `curl -s https://api.github.com/rate_limit`
**Last verified:** 2026-08-10

## GitHub credentials — a finding that requires action

The `gh` CLI on this machine is authenticated as `gwanghun-choi` with a classic PAT whose
scopes include `repo`, `admin:org`, `admin:enterprise`, `delete_repo`, `workflow`,
`write:packages`, and more.

**AgentDock must not reuse this token.** Reading public repository metadata and public
file contents requires **no scopes at all** — a fine-grained token with public read-only
access, or even a scopeless classic token, gets the full 5,000/hour `core` limit. Handing
an ingestion service a token that can delete repositories and administer organizations is
an unnecessary blast radius on a service whose entire job is processing untrusted input.

**Decision to carry into architecture:** AgentDock reads its token from a dedicated
environment variable (e.g. `GITHUB_TOKEN`), documented in `.env.example` as requiring
*no scopes*. It must never fall back to `gh auth token` or to an ambient developer
credential.

**Status:** 확정 — decision follows directly from observed scope list
**Evidence:** `gh auth status` (token values redacted, scope list observed)
**Last verified:** 2026-08-10

## Sources

All facts in this document were produced by direct observation on the target machine on
2026-08-10; there are no external sources. Commands used:

- `bun --version`, `node --version`, `python3 --version`, `command -v <tool>`
- `docker ps`, `docker inspect didim-mcp-service-backend-db-1`
- `docker exec … psql -U mcp -d mcpdb -c "\dn"`
- `docker exec … psql -U mcp -d mcpdb -c "SELECT … FROM pg_available_extensions …"`
- `docker exec … psql -U mcp -d mcpdb -c "SELECT rolsuper … FROM pg_roles …"`
- `gh auth status`, `gh api rate_limit`
- `curl -s https://api.github.com/rate_limit`
