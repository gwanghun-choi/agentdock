# Architecture Research

**Domain:** Open registry / discovery platform for AI agent extensions (single-node, local-first)
**Researched:** 2026-08-10
**Confidence:** HIGH for GitHub API mechanics and data model (docs + live API verification against `api.github.com` on 2026-08-10); MEDIUM for cold-start volume estimates (extrapolated from measured per-repo call cost).

> Every GitHub API number below was **verified live**, not recalled. Verification commands and their output are recorded inline. Live probes ran authenticated as `gwanghun-choi` via `gh`.

---

## Executive Summary (the six decisions)

| # | Question | Verdict |
|---|----------|---------|
| 1 | Components | **6 modules, 1 process.** `web`, `api`, `worker`, `github`, `detect`, `db`. Worker is in-process behind a `WORKER=1` flag so it can split out later with zero code change. |
| 2 | GitHub access | **GraphQL for repo metadata (batched, ~1 point per 50 repos), REST Trees API for file enumeration, `raw.githubusercontent.com` for file bodies (free — does not consume core quota).** Auth = fine-grained PAT. |
| 3 | Acquisition | **A (submit URL) + C (seed list) for the walking skeleton; then repo-search sharding + catalog expansion + MCP Registry sync for cold start. Code Search (strategy B as literally specified) is DEAD — verified 0 results.** D deferred. |
| 4 | Parser | **Two-phase detector array**: pure `match(tree)` over paths (free), then `parse(candidate, read)` (costs a fetch). Adding a 6th type = one file + one array entry. |
| 5 | Data model | **`repository` keyed on immutable GitHub `node_id`; `package` keyed on `(repository_id, type, source_path)`; `package_version` keyed on `(package_id, content_hash)`.** Shared core columns + `meta jsonb` for type-specific fields. Generated `tsvector` column. |
| 6 | Jobs | **PostgreSQL `ingest_job` table with `FOR UPDATE SKIP LOCKED`.** No Redis, no BullMQ. Crash recovery = a 15-minute lock reaper. |

---

## Standard Architecture

### System Overview

```
┌───────────────────────────────────────────────────────────────────────┐
│                        Browser (developer)                            │
└───────────────┬───────────────────────────────────┬───────────────────┘
                │ HTML pages                        │ POST /api/submit
                │ GET  /api/jobs/:id (poll)         │
┌───────────────┴───────────────────────────────────┴───────────────────┐
│                 Single Bun process  (bun run src/server.ts)           │
│                                                                       │
│  ┌──────────────────┐        ┌──────────────────────────────────┐     │
│  │      web         │        │            api                   │     │
│  │  list / detail   │        │  /api/submit  /api/jobs/:id      │     │
│  │  search / facets │        │  /api/search                     │     │
│  └────────┬─────────┘        └───────┬──────────────────┬───────┘     │
│           │ SELECT                   │ SELECT           │ INSERT job   │
│           │                          │                  │              │
│  ┌────────┴──────────────────────────┴──────────────────┴───────┐     │
│  │                          db  (Drizzle)                       │     │
│  │            schema = agentdock  (and ONLY agentdock)          │     │
│  └────────▲──────────────────────────────────────────▲──────────┘     │
│           │ claim job / write results                │ enqueue        │
│  ┌────────┴────────────────────────────────────────┐ │                │
│  │            worker  (WORKER=1 flag)              │ │                │
│  │  claim → fetch → detect → parse → analyze → save│ │                │
│  └───┬───────────────────────┬─────────────────┬───┘ │                │
│      │ RepoMeta / Tree /     │ pure call       │      │                │
│      │ file bytes            │ (no I/O)        │      │                │
│  ┌───┴──────────┐   ┌────────┴────────┐  ┌─────┴────┐ │                │
│  │   github     │   │     detect      │  │ analyze  │ │                │
│  │ rate limit   │   │ skill │ plugin  │  │ capability│ │               │
│  │ etag cache   │   │ mcp   │ market  │  │ signals  │ │                │
│  │ retry/backoff│   │ command │ hook  │  │ (static) │ │                │
│  └───┬──────────┘   └─────────────────┘  └──────────┘ │                │
└──────┼────────────────────────────────────────────────┴────────────────┘
       │  ONLY these three hosts, hardcoded, no redirects off-host
       ▼
  api.github.com   raw.githubusercontent.com   registry.modelcontextprotocol.io
       │
       ▼
┌───────────────────────────────────────────────────────────────────────┐
│  PostgreSQL 16  (docker: didim-mcp-service-backend-db-1, db=mcpdb)    │
│  ┌───────────────┐  ┌────────────────┐  ┌────────────────────────┐    │
│  │   agentdock   │  │     public     │  │      didim_mcp         │    │
│  │  OURS         │  │  NOT OURS      │  │  NOT OURS              │    │
│  └───────────────┘  └────────────────┘  └────────────────────────┘    │
└───────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Owns | Never does | Why the boundary earns its keep |
|-----------|------|-----------|--------------------------------|
| `web` | HTML rendering, listing/detail/search pages | Never calls `github`. Never writes packages. | Reads are a different failure mode than ingestion; keeping them apart means a wedged crawl can't take the site down. |
| `api` | JSON endpoints: submit, job status, search | Never runs ingestion inline (after Phase 2) | Thin. Not a "service layer" — handlers call `db` directly. |
| `worker` | Job claim loop, pipeline orchestration, transactional persistence | Never renders. Never parses YAML itself. | The only component that is allowed to be slow. |
| `github` | **The only module that knows a GitHub URL exists.** Token handling, `x-ratelimit-*` accounting, ETag store, retry/backoff, host allowlist. | Never touches the DB schema. | This is the boundary that pays for itself twice: rate-limit logic lives in one place, and it is the single seam you stub to test the pipeline offline. |
| `detect` | Path→candidate matching and manifest parsing. **Pure functions.** | No network. No DB. No filesystem. | This is the part that grows from 5 artifact types to 10. Purity means new types are testable against frozen fixtures with zero infrastructure. |
| `analyze` | Static capability extraction from already-parsed text | No execution, ever | Separate from `detect` because the security signal evolves independently of format support. |
| `db` | Drizzle schema (all `pgSchema('agentdock')`), query helpers | Never reaches outside the `agentdock` schema | Schema isolation is a hard constraint; funneling all SQL through one module makes it auditable by `grep`. |

### Boundaries deliberately NOT created

Each of these is a cost with no matching benefit at this scale:

- **No separate search service.** Search is `SELECT ... WHERE search_tsv @@ ...`. A "SearchService" class wrapping one query is a file you have to open to find out it does nothing.
- **No repository/service/controller triple layering.** Handlers call query functions. Two layers, not four.
- **No DTO/mapper layer.** Drizzle row types are the API types. Add a mapper the day the shapes actually diverge.
- **No event bus / pub-sub.** The job table *is* the queue. One mechanism.
- **No microservice split of the worker.** Same binary, gated by an env flag. Splitting later is a process-manager change, not a code change.

---

## Recommended Project Structure

```
agentdock/
├── src/
│   ├── server.ts                  # entry: mounts web+api, starts worker if WORKER=1
│   ├── env.ts                     # env parsing + boot assertions (search_path check)
│   │
│   ├── db/
│   │   ├── client.ts              # pool; connection string carries options=-c search_path=agentdock
│   │   ├── schema.ts              # pgSchema('agentdock') — ALL tables defined here
│   │   └── queries/
│   │       ├── packages.ts        # list, facets, detail
│   │       ├── search.ts          # tsvector + trgm
│   │       └── jobs.ts            # claim (SKIP LOCKED), reap, progress
│   │
│   ├── github/
│   │   ├── client.ts              # fetch wrapper: token, host allowlist, retry, Retry-After
│   │   ├── ratelimit.ts           # x-ratelimit-* accounting + preemptive throttle
│   │   ├── repos.ts               # GraphQL batched repo metadata
│   │   ├── tree.ts                # Trees API recursive + truncation fallback
│   │   └── raw.ts                 # raw.githubusercontent.com, size-capped
│   │
│   ├── detect/
│   │   ├── types.ts               # Detector, Candidate, DetectedArtifact
│   │   ├── index.ts               # export const DETECTORS = [skill, plugin, ...]  <-- add line 6 here
│   │   ├── skill.ts               # SKILL.md
│   │   ├── plugin.ts              # .claude-plugin/plugin.json
│   │   ├── marketplace.ts         # .claude-plugin/marketplace.json -> SEEDS, not packages
│   │   ├── mcp.ts                 # .mcp.json / mcpServers / server.json
│   │   ├── command.ts             # commands/*.md
│   │   └── hook.ts                # hooks/hooks.json
│   │
│   ├── analyze/
│   │   └── capabilities.ts        # bundled scripts, allowed-tools, network egress, installers
│   │
│   ├── ingest/
│   │   ├── pipeline.ts            # the 12-step flow, pure orchestration
│   │   ├── persist.ts             # one transaction: upsert repo/packages/versions, delist
│   │   ├── worker.ts              # poll loop + reaper
│   │   └── sources/
│   │       ├── mcpRegistry.ts     # registry.modelcontextprotocol.io sync
│   │       ├── seedList.ts        # operator-curated repos (a .txt file)
│   │       └── repoSearch.ts      # /search/repositories sharded by stars/pushed
│   │
│   └── web/
│       ├── routes/                # /, /p/:id/:slug, /search, /submit
│       └── components/
│
├── drizzle/                       # generated migrations (NEVER `drizzle-kit push`)
├── fixtures/                      # frozen tree.json + file bodies for detector tests
├── scripts/
│   ├── dev-reset.sql              # guarded schema reset
│   └── bootstrap-role.sql         # least-privilege role (run once, as superuser)
├── drizzle.config.ts              # schemaFilter: ['agentdock'] — LOAD-BEARING
└── .env.example
```

### Structure rationale

- **`detect/index.ts` is the extension point and nothing else is.** The stated requirement is "adding a sixth type later is cheap." Cheap means: one new file, one new array element, one new fixture directory. No registration DSL, no dynamic loading, no base class.
- **`github/` is a wall.** Grep for `api.github.com` should return hits in exactly one directory. That is the auditable form of the "never fetch arbitrary hosts" security constraint.
- **`fixtures/` is not optional.** Detectors are the highest-churn, highest-risk code (untrusted input, many formats). Frozen fixtures let you add a format without a network call or a token.

---

## Data Flow: GitHub URL → rendered detail page

```
  [1] POST /api/submit  {url: "https://github.com/anthropics/skills"}
        │  parse -> {owner:"anthropics", repo:"skills"}   (URL is DISCARDED, never fetched)
        ▼
  [2] INSERT agentdock.ingest_job (kind='repo', target='anthropics/skills')
        │  partial unique index rejects a duplicate active job -> return the existing id
        ▼  202 {jobId}
  [3] worker: UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1)
        ▼
  [4] github.repos: 1 GraphQL call  ->  node_id, defaultBranch, HEAD oid, stars,
        │                               license, topics, pushedAt, isFork, parent
        │   cost: 1 point  (measured: 3 repos in one query = cost 1, nodeCount 10)
        ▼
  [5] SHORT CIRCUIT: if HEAD oid == repository.last_ingested_sha  ->  job done, 0 further calls
        ▼
  [6] github.tree: GET /repos/{o}/{r}/git/trees/{oid}?recursive=1     (1 core call)
        │   measured anthropics/skills: 501 entries, 128 KB, truncated=false
        │   if truncated -> walk likely subtrees non-recursively (skills/, plugins/, .claude/)
        ▼
  [7] detect: for each DETECTOR, match(tree) -> candidates   (PURE, 0 calls)
        │   measured on that tree: 18 SKILL.md candidates
        ▼
  [8] github.raw: fetch only the files the candidates asked for, pinned to {oid}
        │   https://raw.githubusercontent.com/{o}/{r}/{oid}/{path}
        │   *** VERIFIED: these do NOT consume core quota (core.used unchanged) ***
        │   caps: 256 KB per manifest, 1 MB per body, N files per repo
        ▼
  [9] detect.parse: YAML frontmatter / JSON, safe loader, size+time capped
        │   per-candidate try/catch -> parse_status ok|partial|failed, never abort the repo
        ▼
 [10] analyze.capabilities: bundled scripts? allowed-tools? network URLs? install commands?
        ▼
 [11] persist (ONE transaction):
        │   upsert repository        ON CONFLICT (github_node_id)
        │   upsert package           ON CONFLICT (repository_id, type, source_path)
        │   insert package_version   ON CONFLICT (package_id, content_hash) DO NOTHING
        │   UPDATE package SET delisted_at = now() WHERE repository_id = $1 AND id <> ALL(seen)
        │   search_tsv is a GENERATED column -> the search index updates in this same write
        ▼
 [12] job -> done, result = {packages: 18, new: 3, unchanged: 15}
        ▼
 [13] browser polls GET /api/jobs/:id  ->  status=done  ->  redirect /p/{id}/{slug}
        ▼
 [14] detail page = ONE SELECT: package JOIN latest package_version JOIN repository
```

**Total GitHub cost for a first ingest of a 500-file repo: 2 core calls + 1 GraphQL point + N free raw fetches.**
**Total cost for a re-ingest of an unchanged repo: 1 GraphQL point (0 core calls).**

At 5,000 core calls/hour, that is roughly **1,500–2,000 first-time repos per hour**, which is the number that makes the cold-start plan below feasible.

---

## GitHub Ingestion Pipeline (verified)

### Rate limits — measured, not recalled

Live output of `gh api rate_limit` while authenticated, 2026-08-10:

```json
{"code_search":{"limit":10},"core":{"limit":5000},"search":{"limit":30},"graphql":{"limit":5000}}
```

Unauthenticated, same moment: `{"core":{"limit":60},"search":{"limit":10},"graphql":{"limit":0}}`

| Auth mode | Core REST | Search | Code Search | GraphQL |
|-----------|-----------|--------|-------------|---------|
| Unauthenticated | 60 /hr | 10 /min | n/a (requires auth) | **0 — GraphQL is unavailable** |
| PAT (classic or fine-grained) | 5,000 /hr | 30 /min | 10 /min | 5,000 points/hr |
| GitHub App installation | 5,000 /hr base; scales +50/repo over 20 and +50/user over 20, **max 12,500 /hr** | 30 /min | 10 /min | 5,000 points/hr |
| `GITHUB_TOKEN` in Actions | 1,000 /hr per repository | — | — | — |
| Enterprise Cloud | 15,000 /hr | — | — | 10,000 points/hr |

Secondary rate limits (these bite before the primary one does, and they are the reason to run serially):

- **No more than 100 concurrent requests.**
- **No more than 900 points/minute for REST** (GET/HEAD/OPTIONS = 1 point; POST/PATCH/PUT/DELETE = 5 points).
- **No more than 2,000 points/minute for GraphQL.**
- **No more than 90 seconds of CPU time per 60 seconds of real time.**
- Docs are explicit: *"you should make requests serially instead of concurrently. To achieve this, you can implement a queue system for requests."*

Headers to honour: `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-used`, `x-ratelimit-reset`, `x-ratelimit-resource`, `retry-after`.

Backoff rule from the docs, in priority order:
1. `retry-after` present → wait that many seconds, do not retry earlier.
2. `x-ratelimit-remaining` is 0 → wait until `x-ratelimit-reset` (UTC epoch seconds).
3. Otherwise → wait ≥ 60 s, then exponential, then give up after N.

### Conditional requests — verified

```
$ curl -D- -H "Authorization: Bearer ***" -H "If-None-Match: \"0945a0c3...\"" \
       https://api.github.com/repos/anthropics/skills
HTTP/2 304
```

Docs: *"does not count against your primary rate limit if a `304` response is returned and the request was made while correctly authorized."*

**Implication for the refresh loop:** store `etag` on `repository`. Freshness polling for thousands of repos costs approximately nothing.

### REST vs GraphQL for repository metadata — GraphQL wins, decisively

Live test: an aliased 3-repo query returned `rateLimit { cost: 1, nodeCount: 10 }`.

The GraphQL cost formula is *"(1) add up the requests needed per connection, (2) divide by 100 and round, minimum 1 point."* Plain `repository(...)` lookups with no paginated connections cost **1 point regardless of how many aliases you stack**, up to the 500,000-node ceiling and the practical query-size limit.

```graphql
query {
  r0: repository(owner:"anthropics", name:"skills") { ...RepoCore }
  r1: repository(owner:"modelcontextprotocol", name:"servers") { ...RepoCore }
  # ... alias up to ~50-100 per call
}
fragment RepoCore on Repository {
  id nameWithOwner description homepageUrl stargazerCount forkCount
  isFork isArchived pushedAt
  licenseInfo { spdxId }
  defaultBranchRef { name target { oid } }
  repositoryTopics(first: 20) { nodes { topic { name } } }
  parent { id nameWithOwner }
}
```

→ **Use GraphQL for all repository metadata and for the periodic freshness sweep.** 5,000 points/hour with ~50 repos per point is ~250,000 repo refreshes/hour. The metadata refresh is effectively free; the *file* fetching is the real budget.

**But**: GraphQL cannot enumerate a repo tree efficiently (the `Tree` object requires recursive `object(expression:)` traversal, one level per nesting depth). Use REST for trees.

### Enumerating files without cloning — cost comparison per repo

| Method | Calls | Quota cost | Gets you | Verdict |
|--------|-------|-----------|----------|---------|
| **Git Trees API `?recursive=1`** | 1 | 1 core | Every path + blob SHA + size, whole repo | **Use this.** Measured: 501 entries / 128 KB for anthropics/skills. |
| Contents API directory walk | 1 per directory | N core | Same info, N× the cost | No. A skills monorepo has 50+ directories. |
| Tarball download (`/tarball`) | 1 | 1 core | Every byte, including gigabytes you don't want | No. Forces disk I/O, decompression of untrusted archives (zip-bomb surface), and tempts you toward "just run the install script". |
| `git clone --filter=blob:none` | 0 API | 0 | Full tree | No. Adds a git binary dependency, disk state, cleanup, and path-traversal surface for zero quota savings over one Trees call. |

**Trees API limits (official):** *"The limit for the tree array is 100,000 entries with a maximum size of 7 MB when using the recursive parameter."* When `truncated: true`, docs say *"use the non-recursive method of fetching trees, and fetch one sub-tree at a time."*

Practical fallback: on `truncated`, do a non-recursive root listing, then recurse only into directories that could plausibly hold artifacts (`skills/`, `plugins/`, `.claude/`, `commands/`, `agents/`, `hooks/`, `packages/`, `src/`), capped at depth 4 and 30 subtree calls. Record `tree_truncated: true` on the repository so the limitation is visible rather than silent.

### Fetching file contents — raw wins

| Method | Size limit | Quota | Notes |
|--------|-----------|-------|-------|
| Contents API (default) | ≤ 1 MB base64 | 1 core each | *"All features of this endpoint are supported"* only at ≤1 MB. |
| Contents API `Accept: application/vnd.github.raw` | 1–100 MB | 1 core each | Above 100 MB: *"This endpoint is not supported."* |
| Git Blobs API `/git/blobs/{sha}` | 100 MB | 1 core each | Useful when you have the blob SHA from the tree and want exact-commit pinning without a path. |
| **`raw.githubusercontent.com/{owner}/{repo}/{sha}/{path}`** | large | **0 core — verified** | **Use this.** Pin to the commit SHA so the bytes match the tree you enumerated. |

Verification:
```
core.used before = 0
  curl raw.githubusercontent.com/.../SKILL.md   -> 200, 11939 bytes
  curl raw.githubusercontent.com/.../SKILL.md   -> 200
core.used after  = 0
```

This is the single most important cost fact in the design: **file bodies are free, repo enumeration is not.** So the pipeline should fetch the tree once and then read as many files as it wants.

Caveats to encode in `github/raw.ts`:
- `raw.githubusercontent.com` has its own undocumented abuse throttling. Keep it serial with a small delay, honour `Retry-After` if it appears, and cap concurrency at 2.
- Enforce a byte cap with a streaming abort — do not trust `Content-Length`.
- Hardcode the host. Never construct the URL from a user-supplied string; construct it from `(owner, repo, sha, path)` components that you validated.

### Code Search API — verified dead for this purpose

The required investigation asks whether Code Search is viable for automated discovery. **It is not.** Evidence, run live:

```
q='path:.claude-plugin/marketplace.json name'   -> total_count: 0
q='description path:**/SKILL.md'                -> total_count: 0
q='allowed-tools path:SKILL.md'                 -> total_count: 0
q='name path:SKILL.md'                          -> total_count: 84
     top hits: LuxAlgo/pinets-cli  path "SKILL.md/README.md"   <- matched a DIRECTORY named SKILL.md
```

Documented constraints that explain the failure:
- **Requires authentication**, and *"limits you to 10 requests per minute."*
- *"You must always include at least one search term... searching for `language:go` is not valid."* — you cannot express "every repo with a file named X".
- *"Only the default branch is considered."*
- *"Only files smaller than 384 KB are searchable."*
- Max 1,000 results per query, 100 per page.
- `sort` and `order` are marked as closing down.

At 10 requests/minute and 1,000 results/query, even the theoretical ceiling is 600,000 results/hour of results you cannot reliably target. Combined with the empirical 0-result outcomes, **strategy B as literally specified (code-search by file pattern) must be struck from the roadmap.**

### Repository Search — the actual discovery engine

```
topic:mcp-server                  -> 23,150 repos
topic:agent-skills                -> 14,303 repos
topic:claude-skills               ->  6,653 repos
topic:claude-code-plugin          ->  5,010 repos
claude skills in:name,description -> 72,472 repos
```

30 requests/minute authenticated, 100 results/page, **hard 1,000-result cap per query** (verified: page 11 returns HTTP 422 `"Only the first 1000 search results are available"`).

The cap is escaped by sharding the query on a disjoint dimension:

```
topic:claude-skills stars:>200
topic:claude-skills stars:50..200
topic:claude-skills stars:10..49
topic:claude-skills stars:3..9
topic:claude-skills stars:<3 pushed:>2026-06-01
...
```

Each shard yields ≤1,000; union the shards. 10 shards × 10 pages = 100 search calls ≈ 4 minutes of the 30/min budget. Easily covers the top several thousand repos per topic.

### Auth verdict: fine-grained PAT

| Option | Quota | Setup cost | Verdict |
|--------|-------|-----------|---------|
| Unauthenticated | 60/hr core, **0 GraphQL** | none | Unusable. GraphQL is entirely unavailable, which kills the batched metadata design. |
| **Fine-grained PAT, public-repo read only** | 5,000/hr | one env var | **Use this.** |
| OAuth App | 5,000/hr | full OAuth flow + callback URL + client secret | Only needed to act *as a user*. AgentDock reads public data only. |
| GitHub App | 5,000/hr base, up to 12,500 with scaling | app registration, private key, JWT→installation-token exchange, token refresh every hour | The upgrade path if quota becomes the bottleneck. Not now. |

A fine-grained PAT with no repository access at all still gets 5,000/hr for public reads and cannot touch anything private — the least-privilege choice. Store as `GITHUB_TOKEN` in `.env`, never in Git. Design `github/client.ts` to read the token from a single injected function so swapping in GitHub App installation tokens later is a 10-line change.

---

## Acquisition Strategy — comparison and verdict

| | A. Submit URL | B. GitHub-wide file-pattern discovery | C. Curated seed list | D. Community queue |
|---|---|---|---|---|
| **Coverage** | 1 repo per human action — near zero | **0 via Code Search (verified).** Via repo-search sharding: several thousand per topic | 10–100 artifacts per seed repo; marketplace/awesome repos fan out 10–100× | Grows with community; zero at launch |
| **Rate-limit feasibility** | Trivial | Code Search: infeasible. Repo search: 30/min, 1,000-cap, shardable — feasible | Excellent: ~2 core calls per repo | Trivial |
| **Spam/abuse exposure** | Medium — anyone can inject a repo of adversarial content | Low — no submitter, but you index whatever GitHub has | **None** — operator chooses | **High** — the classic registry attack surface (typosquats, prompt-injection payloads) |
| **Maintainer effort** | Zero ongoing | Zero ongoing once the crawler runs | **Ongoing curation — the thing a part-time maintainer cannot sustain at scale** | **Ongoing moderation — worse** |
| **Cold start** | Does not solve it | Solves it, once built | Solves the *first hundred*, not the first thousand | Does not solve it |

### Verdict

**Ship A + C. Build the crawler as C′ (catalog expansion) + B′ (repo-search sharding). Defer D indefinitely.**

The literal strategy B (Code Search by file pattern) is struck. Its replacement, B′, is repository search sharded by topic and stars, which is verified to work and returns 6,000–23,000 repos per topic.

### The cold-start plan — how AgentDock reaches a few hundred entries (and then a few thousand)

Ordered by cost-per-entry, cheapest first:

**Tier 0 — Official MCP Registry sync. Thousands of entries, ZERO GitHub quota.**

Verified live:
```
GET https://registry.modelcontextprotocol.io/v0/servers?limit=2   -> HTTP 200
```
It is **public, unauthenticated, cursor-paginated**, and supports `updated_since` (RFC3339), `search`, `version=latest`, and `include_deleted`; `limit` max 100. The `server.json` payload already carries `name`, `description`, `title`, `version`, `repository {url, source, subfolder}`, `remotes[]`, and registry metadata (`publishedAt`, `updatedAt`, `isLatest`).

```json
{"server":{"name":"agency.goji/goji","description":"...","repository":{"url":"https://github.com/goji-agency/website","source":"github","subfolder":"mcp"},"version":"1.0.0","remotes":[{"type":"streamable-http","url":"https://mcp.goji.agency/mcp"}]},
 "_meta":{"io.modelcontextprotocol.registry/official":{"status":"active","publishedAt":"...","updatedAt":"...","isLatest":true}}}
```

One paginated sweep at `limit=100` populates the entire MCP server corpus for the price of a few dozen plain HTTPS requests. `updated_since` makes the daily delta job trivial. **This alone takes the registry from "empty and useless" to "browsable" on day one of Phase 5**, and every `repository.url` in it is also a free GitHub seed.

**Tier 1 — `marketplace.json` catalogs. The force multiplier.**

A `.claude-plugin/marketplace.json` is not an artifact — it is a *catalog*. One file yields N plugin entries **already carrying `name`, `description`, `version`, `author`, `license`, `homepage`, `repository`, `category`, `tags`, and a `source`** pointing at the plugin's real location (`github {repo, ref, sha}`, `url`, `git-subdir {url, path}`, `npm {package}`, `archive {url, sha256}`).

So the marketplace detector emits **discovered-repo seeds, not packages**, and each seed is a fresh ingest job. Ingesting 20 marketplace repos can enqueue several hundred plugin repos with metadata already in hand.

**Tier 2 — Operator seed list (~30 lines of text).**

`scripts/seeds.txt` containing known high-signal repos (`anthropics/skills`, `modelcontextprotocol/servers`, `obra/superpowers`, the major `awesome-*` lists, the well-known marketplaces). Cost: ~2 core calls each. Yield: 10–100 artifacts per repo, plus fan-out from any catalogs inside them. **This is what gets you the first few hundred entries and it takes an afternoon.**

**Tier 3 — Awesome-list link extraction.**

Fetch each awesome-list README via `raw.githubusercontent.com` (free), regex out `github.com/{owner}/{repo}` links, enqueue as seeds. Hundreds of seeds for zero core quota.

**Tier 4 — Repo-search sharding (B′).**

`topic:agent-skills`, `topic:claude-skills`, `topic:claude-code-plugin`, `topic:mcp-server`, sharded by star buckets. ~100 search calls per topic gets the top 1,000 per shard. Enqueue all of them. At ~2 core calls per repo and 5,000/hr, **3,000 repos ingests in about two hours** — an overnight run.

**Abuse containment, since A exists from day one:** ingest anything submitted, but gate *visibility*. Surface a package in listings/search only when its repository clears a floor (stars ≥ N, or age ≥ 30 days, or operator-approved). Submitted-but-ungated packages remain reachable by direct link. That is one nullable `approved_at` column and one `WHERE` clause — far cheaper than a moderation queue, and it defuses the spam vector that strategy D would otherwise force you to staff.

---

## Parser Architecture

### The detector interface

```ts
// src/detect/types.ts
export type TreeEntry = { path: string; type: 'blob' | 'tree'; sha: string; size?: number };

export type Candidate = {
  type: ArtifactType;
  sourcePath: string;              // the manifest file; becomes part of the identity key
  parentPath?: string;             // containing plugin/marketplace dir, for nesting
  needs: string[];                 // paths parse() will read — declared up front
};

export type ParseResult =
  | { ok: true;  artifact: DetectedArtifact }
  | { ok: false; status: 'partial' | 'failed'; artifact?: Partial<DetectedArtifact>; errors: string[] };

export type Detector = {
  type: ArtifactType;
  /** PURE. Path-only. No network, no DB, no fs. Runs over every tree, must be cheap. */
  match(tree: TreeEntry[]): Candidate[];
  /** Reads only the paths declared in candidate.needs. */
  parse(c: Candidate, read: (path: string) => Promise<string>): Promise<ParseResult>;
  /** Optional: emit new ingest seeds instead of (or as well as) packages. */
  seeds?(c: Candidate, parsed: ParseResult): RepoSeed[];
};
```

```ts
// src/detect/index.ts  — the ENTIRE extension point
import { skill } from './skill';
import { plugin } from './plugin';
import { marketplace } from './marketplace';
import { mcp } from './mcp';
import { command } from './command';
import { hook } from './hook';

export const DETECTORS: Detector[] = [skill, plugin, marketplace, mcp, command, hook];
//                                                                              ^ add #7 here
```

Adding a seventh artifact type: one file, one import, one array element, one fixture directory. No base class, no registry DSL, no dynamic loading, no config.

**Why two phases matter:** `match` is free (it reads an in-memory array of paths), `parse` costs an HTTP fetch. Splitting them means a repo with zero artifacts costs zero file fetches, and a repo with 18 skills fetches exactly 18 files. The `needs` array makes the fetch set explicit and cappable.

### Handling the hard cases

**Monorepos with many artifacts.** This is the normal case, not an edge case — measured 18 `SKILL.md` files in one repo. `match` returns 18 candidates; each becomes a `package` row keyed by its own `source_path`. Nothing special is needed because path *is* the identity.

**Nested artifacts.** A plugin at `plugins/foo/` containing `plugins/foo/skills/bar/SKILL.md` produces **both** a plugin package and a skill package. The Claude Code docs make this explicit: plugins bundle skills, commands, agents, hooks, MCP servers, and LSP servers, and a plugin's components are discovered in `skills/`, `commands/`, `agents/`, `hooks/hooks.json`, `.mcp.json`, `.lsp.json`. Do **not** try to suppress the inner artifacts — a user searching "pdf skill" should find the skill even if it ships inside a plugin. Record `parent_path` on the child so the UI can render containment, and rank the parent higher in listings.

**Ambiguous / partial matches.** A JSON file at `.claude-plugin/plugin.json` that fails to parse still produces a row: `parse_status='failed'`, `parse_errors=[...]`, and the raw excerpt stored. A visible broken row is strictly better than a silently missing artifact — it is also how you find out your detector needs work. The plugin manifest is documented as **optional** (`"The manifest is optional. If omitted, Claude Code auto-discovers components... and derives the plugin name from the directory name"`), so the plugin detector must also match on the *absence* of a manifest when component directories are present.

**Malformed frontmatter.** Per-candidate `try/catch`, never per-repo. One bad `SKILL.md` must not lose the other 17.

**Format-specific validation.** One Zod (or equivalent) schema per artifact type, applied after the YAML/JSON parse. It gives you the type-specific validation that the JSONB `meta` column cannot. Known field constraints worth encoding for skills: `name` ≤ 64 chars, lowercase/numbers/hyphens only, no XML tags, cannot contain "anthropic"/"claude"; `description` non-empty, ≤ 1024 chars, no XML tags. Violations become `parse_status='partial'` with a warning, **not** a rejection — the registry indexes reality, and reality includes non-conforming skills. Surfacing conformance is itself a useful signal on the detail page.

### Untrusted-input hardening (non-negotiable)

Every byte from a scanned repo is hostile supply-chain input.

- **YAML.** `js-yaml` latest is **5.2.3** (`v4-legacy` = 4.3.1). Its default schema is **`CORE_SCHEMA`**, described as *"a superset of `JSON_SCHEMA`, accepting more notations for the same types"* — no custom types, no JS type resolution, therefore **no code execution path**. `safeLoad` was removed in v4 precisely because `load` became safe by default. Verdict: **`yaml.load()` from js-yaml ≥ 4 is safe against RCE by default; do not add `safeLoad` shims.** (Verified default: `npm view js-yaml version` → `5.2.3`.)
- **The residual YAML risk is resource exhaustion, not execution.** Anchor/alias expansion ("billion laughs") and pathological documents are not blocked by the schema. Defend with: a hard input cap (reject frontmatter blocks > 256 KB before parsing), and a wall-clock timeout around the parse.
  `// ponytail: size cap + timeout instead of an alias-depth limiter; add depth accounting only if a real repo trips it`
- **JSON.** `JSON.parse` is safe; still cap input size. Note that `plugin.json` explicitly tolerates unknown fields (*"Claude Code ignores top-level fields it does not recognize"*) — so parse permissively and store the unknown remainder in `meta`.
- **Markdown bodies.** Stored as `text`, rendered with escaping and HTML sanitization. Never `dangerouslySetInnerHTML` on unsanitized output. Remember what a SKILL.md body *is*: instruction text designed to steer an agent. **If AgentDock ever adds LLM-based enrichment, the model's output must be constrained to a fixed enum and never written as free text** — otherwise ingested content becomes a prompt-injection channel with a direct write path into the database.
- **Path traversal: eliminated by design.** Tree paths are attacker-controlled strings. This architecture **never writes a scanned repo to the local filesystem** — everything is in memory, size-capped, and streamed to Postgres. That removes the entire path-traversal and zip-bomb class, and it is the concrete reason to prefer Trees+raw over tarball or clone.
- **SSRF: eliminated by allowlist.** The submitted URL is parsed into `(owner, repo)` and then **discarded**. Only `api.github.com`, `raw.githubusercontent.com`, and `registry.modelcontextprotocol.io` are ever fetched, from hardcoded constants, with redirects off-host refused. A `marketplace.json` `source: { url: "..." }` or `archive: { url: "..." }` is **stored as data and never fetched** in the MVP.
- **No execution. Ever.** No `npm install`, no `pip install`, no `bash`, no dynamic `import()` of scanned content, no archive extraction. Written down here so it survives into the roadmap.

---

## Data Model

### Canonical identity — the subtle part, resolved

Three separate identity problems, three separate answers:

**1. Repository identity across renames and transfers.**
`owner/repo` is mutable — repos get renamed and transferred constantly. The GitHub **`node_id`** (REST `node_id`, GraphQL `Repository.id`) is immutable across both. Verified present in the batched GraphQL response.

→ **`repository.github_node_id` is the natural key.** `full_name` is a mutable display attribute, refreshed on every ingest. A renamed repo produces an `UPDATE`, not a duplicate row.

**2. Package identity across re-ingestion.**
Candidate keys and why they fail:

| Candidate | Fails because |
|-----------|--------------|
| Declared `name` from frontmatter | Collides across repos (a hundred repos ship a skill named `code-review`), and authors change it between commits. |
| Public URL | Contains `owner/repo`, so it breaks on rename. |
| Content hash | Changes on every edit — that is a *version* identity, not a *package* identity. |
| **`(repository_id, artifact_type, source_path)`** | **Stable across re-ingestion, stable across rename (because `repository_id` is), and correctly distinguishes 18 skills in one repo.** |

→ **`UNIQUE (repository_id, type, source_path)`.**

Known limitation, accepted for MVP: if an author *moves* `skills/foo/SKILL.md` → `skills/bar/SKILL.md`, that reads as delete + create. The old row is delisted and a new id is minted. This is acceptable now because no user-owned data (stars, comments, installs) hangs off a package id yet. `// ponytail: path is identity; add rename carry-forward (same repo+type, exactly one delisted row with a matching declared name) only when user data attaches to package ids`

**3. Forks.**
A fork has a different `node_id` → a different `repository` row → different packages. That is **correct**: a fork may have diverged and is a legitimately different artifact. The problem forks cause is *listing spam*, not *identity*, so solve it in the query layer, not the schema:

- Store `content_hash` on `package_version` (sha256 of normalized frontmatter + body).
- Store `fork_parent_node_id` on `repository`.
- In listing/search, group by `content_hash` and surface the highest-starred non-fork member with an "N similar" affordance.

Keeping deduplication as a query concern means a bad dedupe heuristic never corrupts stored data.

**4. Public URL.** Row id + human slug: `/p/{id}/{name-slug}`. Stable through every rename because the id is. The slug is decorative and mismatches redirect.

### MVP schema (DDL)

All objects schema-qualified. This is the complete MVP surface — six tables.

```sql
-- ============================================================
-- Bootstrap (run once, as a superuser)
-- ============================================================
CREATE SCHEMA IF NOT EXISTS agentdock;

-- Install into OUR schema so no objects land in public.
-- NOTE: an extension is per-database; if the other app later installs pg_trgm
-- into public it will conflict. Coordinate, or accept the failure and reuse theirs.
CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA agentdock;

-- ============================================================
-- Lookup: artifact types. A table, not an enum, so adding a 6th/7th
-- artifact type is an INSERT rather than a schema migration.
-- ============================================================
CREATE TABLE agentdock.artifact_type (
  code  text PRIMARY KEY,
  label text NOT NULL,
  sort  smallint NOT NULL DEFAULT 100
);
INSERT INTO agentdock.artifact_type (code, label, sort) VALUES
  ('skill',      'Agent Skill', 10),
  ('plugin',     'Plugin',      20),
  ('mcp_server', 'MCP Server',  30),
  ('command',    'Command',     40),
  ('agent',      'Subagent',    50),
  ('hook',       'Hook',        60);

-- ============================================================
-- Repository: keyed on the immutable GitHub node id
-- ============================================================
CREATE TABLE agentdock.repository (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  github_node_id      text        NOT NULL UNIQUE,   -- survives rename + transfer
  full_name           text        NOT NULL,          -- "owner/repo", MUTABLE display value
  owner               text        NOT NULL,
  default_branch      text        NOT NULL,
  description         text,
  homepage            text,
  license_spdx        text,
  stars               integer     NOT NULL DEFAULT 0,
  is_fork             boolean     NOT NULL DEFAULT false,
  is_archived         boolean     NOT NULL DEFAULT false,
  fork_parent_node_id text,
  topics              text[]      NOT NULL DEFAULT '{}',
  pushed_at           timestamptz,
  etag                text,                          -- conditional refresh; 304 is quota-free
  tree_truncated      boolean     NOT NULL DEFAULT false,
  last_ingested_sha   text,                          -- re-ingest short circuit
  last_ingested_at    timestamptz,
  approved_at         timestamptz,                   -- visibility gate for submitted repos
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX repository_full_name_key ON agentdock.repository (lower(full_name));
CREATE INDEX repository_stars_idx           ON agentdock.repository (stars DESC);

-- ============================================================
-- Package: one row per artifact instance in a repo
-- ============================================================
CREATE TABLE agentdock.package (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  repository_id     bigint NOT NULL REFERENCES agentdock.repository(id) ON DELETE CASCADE,
  type              text   NOT NULL REFERENCES agentdock.artifact_type(code),
  source_path       text   NOT NULL,            -- 'skills/canvas-design/SKILL.md'
  parent_path       text,                       -- containing plugin dir, for nesting

  name              text   NOT NULL,            -- declared, or derived from the directory
  slug              text   NOT NULL,            -- decorative; the id is the real key
  summary           text,                       -- description, capped at ~1024 chars
  readme_excerpt    text,                       -- capped at ~8 KB: FTS input, NOT the full body

  -- promoted to real columns BECAUSE the listing UI filters/sorts on them
  runtimes          text[] NOT NULL DEFAULT '{}',   -- ['claude-code','codex','cursor']
  tags              text[] NOT NULL DEFAULT '{}',   -- free tags: topics + keywords + manifest tags
  category          text,                           -- controlled taxonomy, mapped from tags
  license_spdx      text,
  has_scripts       boolean NOT NULL DEFAULT false, -- headline security signal
  has_network       boolean NOT NULL DEFAULT false,

  -- everything else, type-specific
  meta              jsonb  NOT NULL DEFAULT '{}'::jsonb,

  latest_version_id bigint,                     -- FK added after package_version exists
  delisted_at       timestamptz,                -- absent from the most recent scan
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT package_identity UNIQUE (repository_id, type, source_path),

  search_tsv tsvector GENERATED ALWAYS AS (
      setweight(to_tsvector('english', coalesce(name, '')),                    'A') ||
      setweight(to_tsvector('english', coalesce(summary, '')),                 'B') ||
      setweight(to_tsvector('english', array_to_string(tags, ' ')),            'C') ||
      setweight(to_tsvector('english', coalesce(readme_excerpt, '')),          'D')
  ) STORED
);

CREATE INDEX package_search_idx   ON agentdock.package USING gin (search_tsv);
CREATE INDEX package_name_trgm    ON agentdock.package USING gin (name agentdock.gin_trgm_ops);
CREATE INDEX package_tags_idx     ON agentdock.package USING gin (tags);
CREATE INDEX package_runtimes_idx ON agentdock.package USING gin (runtimes);
CREATE INDEX package_meta_idx     ON agentdock.package USING gin (meta jsonb_path_ops);
CREATE INDEX package_live_idx     ON agentdock.package (type, updated_at DESC)
                                  WHERE delisted_at IS NULL;

-- ============================================================
-- PackageVersion: immutable snapshot, one per distinct content
-- ============================================================
CREATE TABLE agentdock.package_version (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  package_id       bigint NOT NULL REFERENCES agentdock.package(id) ON DELETE CASCADE,
  commit_sha       text   NOT NULL,          -- repo HEAD at ingest time
  blob_sha         text,                     -- git blob sha of the manifest file
  content_hash     text   NOT NULL,          -- sha256 of normalized frontmatter+body
  declared_version text,                     -- semver from the manifest, if present

  body             text,                     -- SKILL.md / README body, capped
  frontmatter      jsonb  NOT NULL DEFAULT '{}'::jsonb,
  files            jsonb  NOT NULL DEFAULT '[]'::jsonb,   -- [{path,size,mode}] bundled files
  capabilities     jsonb  NOT NULL DEFAULT '{}'::jsonb,   -- static security signal
  parse_status     text   NOT NULL DEFAULT 'ok',          -- ok | partial | failed
  parse_errors     jsonb  NOT NULL DEFAULT '[]'::jsonb,
  ingested_at      timestamptz NOT NULL DEFAULT now(),

  -- idempotency: re-ingesting unchanged content is ON CONFLICT DO NOTHING
  CONSTRAINT package_version_content_key UNIQUE (package_id, content_hash)
);
CREATE INDEX package_version_recent_idx ON agentdock.package_version (package_id, ingested_at DESC);

ALTER TABLE agentdock.package
  ADD CONSTRAINT package_latest_version_fk
  FOREIGN KEY (latest_version_id) REFERENCES agentdock.package_version(id) ON DELETE SET NULL;

-- ============================================================
-- Ingest job: the entire queue
-- ============================================================
CREATE TABLE agentdock.ingest_job (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind       text        NOT NULL DEFAULT 'repo',     -- repo | mcp_registry_sync | repo_search | seed_expand
  target     text        NOT NULL,                    -- 'owner/repo', a cursor, or a search shard
  status     text        NOT NULL DEFAULT 'pending',  -- pending | running | done | failed
  priority   smallint    NOT NULL DEFAULT 100,        -- lower runs first; user submits = 10
  attempts   smallint    NOT NULL DEFAULT 0,
  run_after  timestamptz NOT NULL DEFAULT now(),
  locked_at  timestamptz,
  locked_by  text,
  progress   jsonb       NOT NULL DEFAULT '{}'::jsonb,  -- {step, found, parsed} for the UI
  result     jsonb,
  error      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- prevents duplicate active work for the same target
CREATE UNIQUE INDEX ingest_job_active_key ON agentdock.ingest_job (kind, target)
  WHERE status IN ('pending', 'running');
CREATE INDEX ingest_job_claim_idx ON agentdock.ingest_job (priority, run_after)
  WHERE status = 'pending';

-- ============================================================
-- Seeds discovered from catalogs (marketplace.json, awesome lists, MCP registry)
-- ============================================================
CREATE TABLE agentdock.repo_seed (
  full_name   text PRIMARY KEY,          -- 'owner/repo'
  origin      text NOT NULL,             -- 'mcp_registry' | 'marketplace' | 'awesome' | 'search' | 'manual'
  origin_ref  text,                      -- which catalog produced it
  hint        jsonb NOT NULL DEFAULT '{}'::jsonb,   -- pre-declared metadata from the catalog
  queued_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
```

### The JSONB tradeoff, stated honestly

**The rule: anything the listing UI filters or sorts on is a real column. Everything else is `meta jsonb`.**

That draws the line concretely:

| Real column | JSONB `meta` |
|---|---|
| `type`, `runtimes`, `tags`, `category`, `license_spdx`, `has_scripts`, `has_network`, `stars` (on repository) | `allowed_tools[]`, MCP `transport`/`remotes[]`/`packages[]`, hook `events[]`, LSP `extensionToLanguage`, plugin `dependencies[]`, `defaultEnabled`, marketplace `source` descriptor, every unrecognized manifest field |

Honest costs of the JSONB half:

- **Queryability is real but second-class.** `meta @> '{"transport":"stdio"}'` works with `jsonb_path_ops` GIN. Range queries, ordering, and joins on JSONB fields are awkward. The planner has **no column statistics** for JSONB keys, so selectivity estimates on `@>` are guesses and can produce bad plans on large tables.
- **Zero database-level validation.** Postgres will accept `{"transport": 12345}`. The compensating control is the per-type Zod schema in `detect/` — you are already validating untrusted input there, so this is not new work, but it *is* work that must not be skipped.
- **Index sizing.** Use `jsonb_path_ops` (containment only, substantially smaller) rather than the default `jsonb_ops` (which indexes every key and every value separately). Do not index `meta` at all until a query actually needs it.
- **The escape hatch is cheap.** When a `meta` field graduates into a UI filter, promote it: add a real column, backfill with `UPDATE ... SET col = meta->>'x'`, add the index, change the writer. One migration.

The alternatives are both worse: a god-table needs a nullable column per field per type (and a migration for every new type, which directly contradicts the "sixth type is cheap" requirement), while a table-per-type turns every listing query into a six-way `UNION ALL` that must be rewritten each time a type is added.

### Tags: both, and the relationship between them

- **Free tags** (`tags text[]`, GIN-indexed): union of GitHub `topics`, manifest `keywords`, and marketplace `tags`. Normalized to lowercase and deduped. These give you the long tail, and they cost nothing because upstream already wrote them.
- **Controlled category** (`category text`, one value): a short operator-owned list (~15 entries) mapped from tags by a rules table at ingest time. This is what powers browsable navigation, because a 4,000-entry tag cloud is not navigable.

Free tags alone → unbrowsable long tail. Controlled taxonomy alone → cannot keep pace with a fragmenting ecosystem and becomes manual curation the maintainer cannot sustain. Both, with tags auto-feeding the category, is the only combination that survives a part-time maintainer.

**No `package_tag` join table in the MVP.** A `text[]` with a GIN index does filtering and, via `unnest`, facet counting. Add the join table the day tags need their own attributes (display name, description, alias-of).

### Full-text search: generated column, not a separate table

`search_tsv` is a `GENERATED ALWAYS AS (...) STORED` column on `package`. It updates inside the same transaction as the row, needs no trigger, and cannot drift.

Three gotchas that must be honoured:

1. **The generation expression must be `IMMUTABLE`.** Use `to_tsvector('english', ...)` with a **literal** config name. `to_tsvector(regconfig_column, text)` is only `STABLE` and will be rejected.
2. **`unaccent()` is not `IMMUTABLE`** and therefore **cannot** appear in a generated column expression. If accent folding is needed later, wrap it: `CREATE FUNCTION agentdock.immutable_unaccent(text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;` — and understand that you are asserting immutability that the dictionary does not actually guarantee across dictionary updates (a REINDEX is required if it ever changes). Defer until proven necessary.
3. **Do not put the full README into the tsvector.** `readme_excerpt` is capped at ~8 KB. Uncapped, the GIN index bloats and D-weight noise swamps A-weight name matches. The full body lives in `package_version.body`, which is displayed but not indexed.

`pg_trgm` covers what FTS cannot: typo tolerance and prefix autocomplete on `name`, via `GIN (name gin_trgm_ops)`.

**pgvector is unavailable in this image and is not needed.** Prove FTS + trgm insufficient on a real corpus before proposing a DB image change.

### Later-extension schema (explicitly NOT MVP)

| Table | Purpose | Trigger to build it |
|-------|---------|---------------------|
| `repository_alias(old_full_name, repository_id)` | Old URLs keep resolving after rename | First reported broken inbound link |
| `package_tag` / `tag` | Tag aliases, descriptions, curated display | Tags need attributes of their own |
| `package_cluster(content_hash, canonical_package_id)` | Materialized fork/duplicate grouping | The listing query's on-the-fly grouping gets slow |
| `capability_rule` | Operator-editable static-analysis rules | Rules change more often than deploys |
| `app_user`, `submission`, `moderation_event` | Community submissions (strategy D) | A community exists |
| `package_event` | Views/clicks/copies telemetry | You want popularity ranking |
| `package_embedding` | Semantic search | FTS proven insufficient **and** pgvector available |

---

## Schema Isolation Mechanics

Four layers. They are listed in increasing order of actual guarantee — layers 1–3 are conventions a bug can defeat, layer 4 is enforced by the database.

### Layer 1 — connection-level `search_path`

```
DATABASE_URL=postgres://agentdock_app:***@localhost:5432/mcpdb?options=-c%20search_path%3Dagentdock
```

The `options` parameter is passed through by libpq and by `postgres.js` / `node-postgres`. This makes every unqualified identifier resolve inside `agentdock`. It does **not** stop a query that explicitly names `public.foo` — it is a default, not a fence.

Belt-and-braces at boot (`src/env.ts`), because a mistyped connection string is silent otherwise:

```ts
const { search_path } = await db.execute(sql`SELECT current_setting('search_path') AS search_path`);
if (!/^agentdock\b/.test(search_path)) {
  throw new Error(`search_path is "${search_path}", expected agentdock. Refusing to start.`);
}
```

### Layer 2 — schema-qualify everything in the ORM

```ts
// src/db/schema.ts
import { pgSchema } from 'drizzle-orm/pg-core';
export const agentdock = pgSchema('agentdock');

export const repository = agentdock.table('repository', { /* ... */ });
export const pkg        = agentdock.table('package',    { /* ... */ });
```

Every table defined via `agentdock.table(...)` emits schema-qualified DDL and schema-qualified queries. Nothing in `src/db/schema.ts` may use bare `pgTable` — that is a one-line CI grep.

### Layer 3 — migration configuration (the highest-risk item in the project)

```ts
// drizzle.config.ts
export default {
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL! },

  // WITHOUT THIS, drizzle-kit sees public/didim_mcp tables as "not in my schema"
  // and generates DROP statements for another application's data.
  schemaFilter: ['agentdock'],

  // Default is __drizzle_migrations in a `drizzle` schema — a THIRD schema
  // in someone else's database. Pin it inside ours.
  migrationsSchema: 'agentdock',
  migrationsTable: '__drizzle_migrations',
} satisfies Config;
```

> **`drizzle-kit push` is banned in this project.** `push` diffs the live database against the schema file and destructively reconciles. Against a shared database, a misconfiguration is other-people's-data loss. Use `drizzle-kit generate` → review the emitted SQL by eye → `drizzle-kit migrate`. Put `"push"` nowhere in `package.json` scripts so it cannot be run by muscle memory.

The docs confirm both knobs: *"schemaFilter option lets you specify glob based schema names filter"* and *"migrations config options lets you change both migrations log `table` name and `schema`"* (default: `__drizzle_migrations` in a `drizzle` schema).

### Layer 4 — dedicated least-privilege role. **Do this now, not later.**

This is the only layer a code bug cannot defeat. It is six lines of SQL. Retrofitting it later means discovering every missing grant at that point anyway — you pay the same cost, just after you have already spent a milestone running as superuser against another team's data.

```sql
-- scripts/bootstrap-role.sql   — run ONCE, as a superuser
CREATE ROLE agentdock_app LOGIN PASSWORD :'agentdock_pw';

CREATE SCHEMA IF NOT EXISTS agentdock AUTHORIZATION agentdock_app;

-- No privileges anywhere else. The role owns agentdock and nothing more.
REVOKE ALL ON SCHEMA public    FROM agentdock_app;
REVOKE ALL ON SCHEMA didim_mcp FROM agentdock_app;
REVOKE ALL ON ALL TABLES IN SCHEMA public    FROM agentdock_app;
REVOKE ALL ON ALL TABLES IN SCHEMA didim_mcp FROM agentdock_app;

-- Defaults for this session too
ALTER ROLE agentdock_app SET search_path = agentdock, pg_catalog;
```

**Be precise about what this does and does not guarantee.** In PostgreSQL 16 the `public` schema no longer grants `CREATE` to `PUBLIC`, but `USAGE` on `public` is still held by `PUBLIC`, and `REVOKE ... FROM agentdock_app` does not strip a privilege inherited from `PUBLIC`. Revoking from `PUBLIC` itself would affect the other application and must **not** be done. The practical guarantee therefore comes from the *table* level: `agentdock_app` holds no privileges on any table in `public` or `didim_mcp`, so it cannot read or write them regardless of `USAGE`. That is sufficient, and it is the honest statement of the boundary.

`pg_trgm` still needs a superuser to install (one time, from the bootstrap script). Everything after bootstrap runs as `agentdock_app`.

### Safe dev reset

```sql
-- scripts/dev-reset.sql
-- Refuses to run anywhere but the intended database, and can only ever name one schema.
DO $$
BEGIN
  IF current_database() <> 'mcpdb' THEN
    RAISE EXCEPTION 'Refusing to reset: current_database() is %, expected mcpdb', current_database();
  END IF;
  IF current_setting('agentdock.allow_reset', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to reset: run with -c agentdock.allow_reset=yes';
  END IF;
END $$;

DROP SCHEMA IF EXISTS agentdock CASCADE;
CREATE SCHEMA agentdock AUTHORIZATION agentdock_app;
```

Run as: `psql "$DATABASE_URL" -c "SET agentdock.allow_reset='yes'" -f scripts/dev-reset.sql`

**Why `CASCADE` is safe here:** `DROP SCHEMA ... CASCADE` drops objects *inside* the schema plus objects elsewhere that *depend on* them. AgentDock never creates a cross-schema reference and the other application does not know `agentdock` exists, so the dependency set is closed inside `agentdock`. The literal schema name is hardcoded — the script takes no schema parameter, so there is no substitution that could point it at `public`.

---

## Background Job / Ingestion Execution Model

### PostgreSQL job table vs an external queue

| | Postgres + `SKIP LOCKED` | Redis + BullMQ | RabbitMQ / SQS |
|---|---|---|---|
| New infrastructure | **none** | a Redis container | a broker, or a cloud dependency |
| Transactional with the data write | **yes — job completion and package upserts commit together** | no (two-phase problem: job acked, DB write lost) | no |
| Crash recovery | one `UPDATE` (the reaper) | built in | built in |
| Throughput ceiling | thousands/sec — orders of magnitude above need | higher | higher |
| Operability for one part-time maintainer | one thing to back up | two | two, one of them stateful |

**Verdict: Postgres job table.** The stated constraints (single node, no broker) make this the only compliant option, and it happens to also be the better one here: **the job's terminal state and the packages it produced commit in the same transaction**, which removes an entire class of "job said done but nothing was written" bugs that an external queue creates for free.

Only real downside is polling latency. Fix it with `LISTEN`/`NOTIFY` to wake the loop on enqueue, with a 5-second poll as the floor so a missed notification self-heals.

### Claim

```sql
UPDATE agentdock.ingest_job j
   SET status='running', locked_at=now(), locked_by=$1,
       attempts=attempts+1, updated_at=now()
 WHERE j.id = (
       SELECT id FROM agentdock.ingest_job
        WHERE status='pending' AND run_after <= now()
        ORDER BY priority, run_after
          FOR UPDATE SKIP LOCKED
        LIMIT 1)
RETURNING *;
```

`SKIP LOCKED` means N workers never collide and never block each other. Scaling from 1 to 4 workers is a config change, not a code change.

### Progress reporting

The worker writes `progress` after each pipeline step, in its own short transaction (not the main one), so the UI sees movement during a long ingest:

```sql
UPDATE agentdock.ingest_job
   SET progress = $2, locked_at = now(), updated_at = now()   -- locked_at doubles as the heartbeat
 WHERE id = $1;
```

`GET /api/jobs/:id` returns `{status, progress, result}`. The submit page polls it every 1.5 s and redirects on `done`. No WebSocket, no SSE — a poll on a page the user is already staring at is the correct amount of machinery.

### Crash recovery

`locked_at` is the heartbeat. One reaper query, run every minute by the same loop:

```sql
UPDATE agentdock.ingest_job
   SET status    = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'pending' END,
       run_after = now() + (interval '1 minute' * power(3, attempts)),
       locked_at = NULL, locked_by = NULL, updated_at = now()
 WHERE status = 'running'
   AND locked_at < now() - interval '15 minutes';
```

A worker killed mid-ingest leaves a stale `running` row; fifteen minutes later it is `pending` again. That is the entire crash story, and it is correct because of idempotency below.

### Idempotency

The pipeline is a **pure function of `(repository_node_id, commit_sha)`**. Persistence is upserts on stable keys inside one transaction:

- `repository` → `ON CONFLICT (github_node_id) DO UPDATE`
- `package` → `ON CONFLICT (repository_id, type, source_path) DO UPDATE`
- `package_version` → `ON CONFLICT (package_id, content_hash) DO NOTHING`

Re-running a job that already partially committed produces the same final state. Re-running a job whose transaction was rolled back produces the same final state. **No compensating logic is needed anywhere.** This is why the crash story can be one `UPDATE`.

### Re-ingestion diff

1. **Short circuit.** `if (headOid === repository.last_ingested_sha) return done` — costs 1 GraphQL point and zero core calls. For a periodic sweep over thousands of repos, almost every job stops here.
2. **Changed repo:** run the full pipeline, collect the set of package ids seen this scan.
3. **New content** → a new `package_version` row (the `content_hash` unique constraint decides).
4. **Unchanged content** → `DO NOTHING`; the `package.updated_at` bump alone records the re-check.
5. **Disappeared artifacts** → soft delete, never hard delete:

```sql
UPDATE agentdock.package
   SET delisted_at = now()
 WHERE repository_id = $1
   AND delisted_at IS NULL
   AND id <> ALL($2::bigint[]);          -- ids seen in this scan
```

Soft-delete because a truncated tree, a transient parse failure, or a detector regression must not silently erase the corpus. A row that reappears in the next scan simply has `delisted_at` cleared.

### Freshness sweep (Phase 7)

A `kind='refresh'` job that batches ~50 repos per GraphQL call (measured cost: 1 point) comparing `pushedAt` and `defaultBranchRef.target.oid` against `last_ingested_sha`, and enqueues a `repo` job only for those that moved. Combined with ETag-conditional REST where used, keeping thousands of repos current costs a rounding error of the hourly budget.

---

## Build Order

The dependency graph is nearly linear, which makes this easy:

```
 db schema + isolation
        │
        ▼
   github client ──────────► detect (pure; testable without github)
        │                        │
        └────────┬───────────────┘
                 ▼
            ingest pipeline
                 │
        ┌────────┴────────┐
        ▼                 ▼
     corpus            search
        │                 │
        └────────┬────────┘
                 ▼
          security signal
                 │
                 ▼
            freshness
```

`web` is not a phase — it rides along from the first slice, because a vertical slice without a page to look at is not a slice.

### Phase candidates

| # | Phase | Delivers | Depends on | Vertical? |
|---|-------|----------|-----------|-----------|
| **1** | **Walking skeleton** | Paste a GitHub URL → the repo's `SKILL.md` artifacts appear on a list page and a detail page. Schema + role isolation + `github` client (GraphQL repo, Trees, raw) + the `skill` detector only + synchronous ingest + two pages. | — | **Yes — this is the slice.** |
| 2 | Durable ingestion | `ingest_job` + `SKIP LOCKED` worker + progress polling UI + reaper + commit-SHA short circuit. Now hundreds of repos can be processed unattended. | 1 | Yes (same UX, now robust) |
| 3 | Detector pluralism | `plugin.json`, `marketplace.json` (as **seeds**, not packages), `.mcp.json`/`mcpServers`, `commands/`, `hooks/`, nested + monorepo handling, fixture test suite. | 2 | Yes (more types visible on the same pages) |
| 4 | Corpus / cold start | MCP Registry sync (free, thousands of rows), operator seed list, awesome-list link extraction, repo-search sharding crawler, visibility gate. | 3 | Yes (the site stops being empty) |
| 5 | Search & browse | Generated `tsvector` + `pg_trgm` + facets (type, runtime, license, tags, category) + ranking + category mapping rules. | 4 | Yes |
| 6 | Security signal | Static capability extraction (bundled scripts, `allowed-tools`, network egress in scripts, install commands in bodies), risk badges, "what will this do to my machine" panel. | 3 | Yes |
| 7 | Freshness | Batched GraphQL refresh sweep, ETag conditional requests, scheduled re-ingest, delisting, "last checked" surfacing. | 4 | Yes |

**Why Phase 1 is exactly this and nothing more:** it touches every boundary in the system — schema isolation, GraphQL, the Trees API, raw fetching, safe YAML parsing, the canonical identity key, and rendering. If any of those assumptions is wrong (particularly schema isolation and the identity key), Phase 1 is where you find out, while the blast radius is one table and one detector.

**Why search comes after corpus (Phase 5 after Phase 4), which is the one non-obvious ordering:** ranking cannot be tuned against twenty rows. Phase 4's MCP Registry sync alone is cheap enough (a few dozen unauthenticated HTTPS calls) to produce a corpus of thousands before any GitHub crawling exists, so Phase 4 is not a long detour. Listing and filtering by type exist from Phase 1 — Phase 5 is *relevance*, and relevance needs data.

**Phase 6 could move earlier** if the security lens is the differentiator you want to demo. It depends only on Phase 3 (you need parsed artifacts with file listings). Swapping 5 and 6 is a valid roadmap variant.

---

## Scaling Considerations

Be honest about the numbers: this is a single-maintainer local project. The interesting limits are not user counts.

| Scale | What actually happens |
|-------|----------------------|
| 0–10k packages | Everything above is comfortable. One Postgres, one worker, sub-10 ms queries. |
| 10k–100k packages | FTS ranking degrades **only if** the README went into the tsvector (it does not, by design). Facet counts (`unnest(tags)` + `GROUP BY`) get slow — fix with a materialized view refreshed after each ingest batch. |
| 100k+ packages | Not a scale this project will reach. If it does, the fix is a read replica, not a rewrite. |

### Actual bottlenecks, in the order they will bite

1. **GitHub core rate limit (5,000/hr).** Hits first, during Phase 4 crawling. Mitigations in priority order: the commit-SHA short circuit (eliminates most re-ingests), ETag conditional requests (free 304s), moving file bodies to `raw.githubusercontent.com` (already free), batching metadata through GraphQL (~50 repos/point). Only after all four are exhausted does a GitHub App's 12,500/hr ceiling become worth the setup cost.
2. **Ingest wall-clock.** Fixed by raising worker concurrency to 2–4 — `SKIP LOCKED` already supports it, no code change. Careful: GitHub docs say make requests *serially*, so concurrency belongs at the job level with a shared token-bucket limiter in `github/ratelimit.ts`, not at the HTTP level.
3. **Facet count queries.** Materialized view. Not before it hurts.
4. **The database is not the bottleneck** and will not be. Do not optimize it preemptively.

---

## Anti-Patterns

### 1. Running `drizzle-kit push` against a shared database
**What people do:** use `push` for convenience in dev.
**Why it's wrong:** `push` reconciles the live database against the schema file. Without `schemaFilter`, it treats `public` and `didim_mcp` tables as drift and generates `DROP` statements for another application's data. This is the single highest-severity risk in the project.
**Do this instead:** `schemaFilter: ['agentdock']`, `generate` → read the SQL → `migrate`. Keep `push` out of `package.json` entirely.

### 2. Cloning or tarballing repos to disk to scan them
**What people do:** `git clone` or download `/tarball` and walk the filesystem.
**Why it's wrong:** it introduces archive-bomb, path-traversal, and disk-exhaustion surface; it needs cleanup logic; and once the repo is sitting on disk it is one lazy afternoon away from someone running its install script "just to get the dependency list."
**Do this instead:** Trees API + `raw.githubusercontent.com`, in memory, size-capped. Nothing untrusted ever reaches the filesystem, which deletes the whole vulnerability class rather than mitigating it.

### 3. A table per artifact type
**What people do:** `skill`, `plugin`, `mcp_server` as separate tables with separate columns.
**Why it's wrong:** every listing and search query becomes a six-way `UNION ALL` that must be rewritten each time a type is added — the exact opposite of "adding a sixth type is cheap."
**Do this instead:** one `package` table, `type` as a lookup FK, type-specific fields in `meta jsonb`, promote to real columns when a field becomes a UI filter.

### 4. `owner/repo` as the repository key
**What people do:** it is what appears in the URL, so it looks canonical.
**Why it's wrong:** repositories are renamed and transferred routinely, and the next ingest then creates a duplicate with a duplicate package set.
**Do this instead:** GitHub `node_id` as the natural key; `full_name` is a mutable attribute.

### 5. Treating Code Search as the discovery engine
**What people do:** assume "find every repo with a `SKILL.md`" is a solved query.
**Why it's wrong:** verified — requires auth, 10 req/min, 1,000-result cap, rejects qualifier-only queries, default branch only, <384 KB files only, and `path:.claude-plugin/marketplace.json name` returns **0**.
**Do this instead:** `/search/repositories` sharded by topic and star buckets, plus catalog expansion, plus the MCP Registry.

### 6. Maintaining `tsvector` with a trigger
**What people do:** a `BEFORE INSERT OR UPDATE` trigger calling `to_tsvector`.
**Why it's wrong:** it can silently drift if a code path bypasses it, and it is code to maintain.
**Do this instead:** `GENERATED ALWAYS AS (...) STORED`. Postgres keeps it correct for free. Just keep the expression `IMMUTABLE` — no `unaccent`, no `regconfig` columns.

### 7. Feeding ingested artifact text to an LLM for enrichment without treating it as hostile
**What people do:** "let an LLM auto-categorize each SKILL.md."
**Why it's wrong:** a `SKILL.md` body is, by construction, instruction text engineered to steer an agent. Piping it into a model whose output is written back to your database is prompt injection with a direct write path — and Anthropic's own docs warn that malicious Skills can direct an agent to act against its stated purpose.
**Do this instead:** if you do it at all, constrain the model's output to a fixed enum of category codes, validate it against the enum before writing, and never persist free-form model output derived from ingested content.

### 8. Building a moderation queue before there is a community
**What people do:** implement submission review up front because "a registry needs moderation."
**Why it's wrong:** it is unbounded recurring work for a part-time maintainer and it solves a problem you do not have at zero users.
**Do this instead:** a visibility gate (`approved_at`, or a star/age floor) — one column and one `WHERE` clause. Add review workflow when submissions actually arrive.

---

## Integration Points

### External services

| Service | Pattern | Gotchas |
|---------|---------|---------|
| `api.github.com` (GraphQL) | Batched aliased `repository(...)` queries, ~50 per call | Cost 1 point per call for non-connection fields (verified). **Unavailable unauthenticated** (`graphql.limit = 0`). |
| `api.github.com` (REST Trees) | `GET /repos/{o}/{r}/git/trees/{sha}?recursive=1` | 100,000-entry / 7 MB truncation; handle `truncated: true` with a targeted subtree walk. |
| `api.github.com` (REST Search) | `/search/repositories`, sharded | 30/min; **hard 1,000-result cap** (verified HTTP 422 at page 11). |
| `raw.githubusercontent.com` | `{owner}/{repo}/{sha}/{path}` | **Does not consume core quota (verified).** Has separate undocumented throttling — keep serial, cap concurrency at 2. Always pin to a SHA, never a branch name. |
| `registry.modelcontextprotocol.io` | `GET /v0/servers?limit=100&cursor=...`, `updated_since=<RFC3339>` | Public, unauthenticated, cursor-paginated, `limit` max 100. Returns a versioned `server.schema.json` payload — pin to the `$schema` version you parsed against. |
| PostgreSQL 16 (`mcpdb`) | Shared instance, `agentdock` schema only | No pgvector. `pg_trgm` must be installed by a superuser; install it `SCHEMA agentdock`. |

### Internal boundaries

| Boundary | Communication | Invariant |
|----------|--------------|-----------|
| `web` ↔ `db` | Direct function calls, read-only | `web` never writes and never calls `github` |
| `api` → `ingest_job` | One `INSERT` | Submission never runs the pipeline inline (after Phase 2) |
| `worker` ↔ `ingest_job` | `FOR UPDATE SKIP LOCKED` claim | Terminal state and package writes share one transaction |
| `worker` → `github` | Async calls, one shared rate limiter | Only `worker` calls `github` |
| `worker` → `detect` | Plain function call with a `read` callback | **`detect` performs no I/O.** This is the invariant that makes detectors testable and safe. |
| `github` → internet | Hardcoded host allowlist, no off-host redirects | Only 3 hosts, ever |
| anything → filesystem | **Never for scanned content** | No untrusted bytes touch disk |

---

## Open Questions for the Roadmap

1. **SkillMaru information architecture could not be extracted** — the site renders client-side and returned no content to a fetch. A browser-based pass (the `browse` skill) is needed before the listing/detail IA is finalized. This is a FEATURES-research dependency, not an architecture blocker.
2. **`pg_trgm` installation requires coordination** with the owner of the shared database. It is per-database; if the other application later installs it into `public`, the second `CREATE EXTENSION` fails. Confirm before Phase 1.
3. **Runtime compatibility (`runtimes[]`) is mostly undeclared in the wild.** Skills and plugins rarely state which agent runtimes they target; it must be *inferred* from format (a `.claude-plugin/` directory implies Claude Code; a `server.json` implies any MCP client). The inference rules are a Phase 3 design detail.
4. **Rename carry-forward for moved artifact paths** is deliberately deferred. Revisit when user-owned data (favourites, comments) attaches to a package id.

---

## Sources

**GitHub REST API**
- https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api — primary/secondary limits, point values, header names
- https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api — conditional requests, 304 not counting against the limit, serial-request guidance, backoff order
- https://docs.github.com/en/rest/git/trees — 100,000 entry / 7 MB recursive limit, `truncated` semantics and fallback
- https://docs.github.com/en/rest/repos/contents — 1 MB / 1–100 MB / >100 MB size tiers, raw and object media types
- https://docs.github.com/en/rest/search/search — 30/min, 10/min code search, 1,000-result cap, 384 KB indexing limit, default-branch-only, mandatory search term
- https://docs.github.com/en/rest/search/search?apiVersion=2022-11-28#search-code — code search auth requirement and closing-down fields
- https://docs.github.com/en/search-github/searching-on-github/searching-code — qualifiers and repository indexing constraints
- https://docs.github.com/en/graphql/overview/rate-limits-and-node-limits-for-the-graphql-api — 5,000 points/hr, point formula, 500,000-node limit, `first`/`last` 1–100, 2,000 points/min secondary

**Live verification, 2026-08-10** (authenticated via `gh`, account `gwanghun-choi`)
- `gh api rate_limit` → `core 5000`, `search 30`, `code_search 10`, `graphql 5000`; unauthenticated → `core 60`, `search 10`, `graphql 0`
- `gh api repos/anthropics/skills/git/trees/f17010c9...?recursive=1` → 501 entries, 128,467 bytes, `truncated: false`, 18 `SKILL.md` paths
- GraphQL 3-repo aliased query → `rateLimit { cost: 1, nodeCount: 10 }`
- `curl -H "If-None-Match: ..." api.github.com/repos/anthropics/skills` → `HTTP/2 304`
- Two `raw.githubusercontent.com` fetches → `core.used` unchanged at 0
- `gh api search/code -f q='path:.claude-plugin/marketplace.json name'` → `total_count: 0`
- `gh api search/code -f q='name path:SKILL.md'` → `total_count: 84`, top hits matching a *directory* named `SKILL.md`
- `gh api search/repositories` → `topic:mcp-server` 23,150 · `topic:agent-skills` 14,303 · `topic:claude-skills` 6,653 · `topic:claude-code-plugin` 5,010
- `gh api search/repositories ... -f page=11` → `HTTP 422 "Only the first 1000 search results are available"`
- `curl https://registry.modelcontextprotocol.io/v0/servers?limit=2` → `HTTP 200` (unauthenticated), cursor pagination confirmed
- `curl https://registry.modelcontextprotocol.io/openapi.yaml` → `/v0/servers` params: `cursor`, `limit` (max 100), `updated_since`, `search`, `version`, `include_deleted`
- `npm view js-yaml version` → `5.2.3` (`v4-legacy` 4.3.1)

**Artifact formats**
- https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview — `SKILL.md` frontmatter (`name` ≤64 chars lowercase/hyphen, `description` ≤1024), `.claude/skills/` and `~/.claude/skills/` conventions, progressive disclosure, security warnings about untrusted Skills
- https://code.claude.com/docs/en/plugins-reference — `.claude-plugin/plugin.json` full schema, optional-manifest auto-discovery, component paths (`skills/`, `commands/`, `agents/`, `hooks/hooks.json`, `.mcp.json`, `.lsp.json`), unrecognized-field tolerance
- https://code.claude.com/docs/en/plugin-marketplaces — `.claude-plugin/marketplace.json` schema (`name`, `owner`, `plugins[]`), plugin entry fields (`source`, `category`, `tags`, `strict`, `relevance`), source types (relative path, `github`, `url`, `git-subdir`, `npm`, `archive`)
- https://registry.modelcontextprotocol.io/v0/servers — live `server.json` payload shape
- https://github.com/nodeca/js-yaml — default `CORE_SCHEMA`, untrusted-input guidance

**Persistence**
- https://orm.drizzle.team/docs/drizzle-config-file — `schemaFilter`, `migrations: { table, schema }` (default `__drizzle_migrations` in a `drizzle` schema), `pgSchema()`

**Project context**
- `/home/ghchoi/workspace_gh/agentdock/.planning/PROJECT.md` — verified local environment constraints

---
*Architecture research for: open registry / discovery platform for AI agent extensions*
*Researched: 2026-08-10*
