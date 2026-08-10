# Project Research Summary

**Project:** AgentDock
**Domain:** Public discovery index for AI agent extensions (Agent Skills, Claude Code plugins, MCP servers, commands, hooks) built by ingesting public GitHub repositories
**Researched:** 2026-08-10
**Confidence:** MEDIUM-HIGH overall (HIGH on environment, GitHub mechanics, stack versions, and artifact formats; MEDIUM on competitive scale figures; LOW on the security-research effect sizes drawn from 2026 preprints)

Source documents: `ECOSYSTEM.md`, `STACK.md`, `FEATURES.md`, `ARCHITECTURE.md`, `PITFALLS.md`, `ENVIRONMENT.md`, `SKILLMARU.md`.

---

## Executive Summary

AgentDock is a read-only, pull-model public index: it discovers artifacts that already live in public GitHub repositories, parses them, and presents them with provenance. Research overturned two premises the project started with. First, Agent Skills is no longer an Anthropic format — it is a governed multi-vendor spec at `agentskills.io/specification` adopted by ~48 runtimes, so cross-ecosystem *translation* is a solved problem and not a wedge. Second, the market is not empty: at least eight live directories exist, `skills.sh` is already cross-runtime with an `/audits` page, and `SkillMaru` — named in the brief as the primary reference — turned out to be an authenticated in-house publishing registry forked from `openclaw/clawhub`, structurally the opposite of AgentDock and not a competitor at all.

What remains genuinely open is narrow and defensible: **nobody derives, from an artifact's own files, what that artifact will do to your machine.** skills.sh outsources to Socket and Snyk (dependency-graph scanners pointed at prompt bundles, mostly showing "Pending"); Glama scores MCP servers only; the official MCP Registry deliberately does no analysis; SkillMaru never displays `allowed-tools` at all. AgentDock's product is therefore a **capability disclosure and hidden-content surface**, not a malware detector — a distinction the research forces rather than suggests, because static analysis of skills has documented recall near 1.5% against behaviorally confirmed malware. The corollary is a hard product constraint: no score, no badge, no "safe". Every finding is a fact with a `file:line` permalink at a pinned commit SHA, and the list of things AgentDock does *not* check is permanently visible on every detail page.

The build is small and boring by design: TypeScript everywhere, Next.js 16 App Router, PostgreSQL 16 (an existing shared instance) doing storage, full-text search, and the job queue, Drizzle in `generate`/`migrate`-only mode, and a single process with the worker behind a flag. The two largest risks are operational rather than technical. One: the database is shared with a running application and the only login role is a superuser that owns the other app's schema, so schema isolation is currently *unenforced* and a dedicated non-superuser role must be created — a change that needs the maintainer's explicit go-ahead. Two: a discovery strategy that assumed GitHub Code Search is dead on arrival (verified 0 results for the intended patterns), so acquisition is seed-list + catalog fan-out + MCP Registry sync + repo-search sharding, never a crawler.

---

## Key Findings

### Recommended Stack

One language, one process, one database. TypeScript covers HTTP, Markdown/YAML parsing, static analysis, SQL, and a server-rendered faceted search UI; nothing in the workload is numerical or ML, so a Python or Go split would buy a second toolchain and an IPC boundary for zero capability. Next.js 16 Server Components map exactly onto the shape of the product (`?q=…&type=…` → one SQL query → indexable HTML), which eliminates a client state manager, a data-fetching library, and an API layer for the UI. PostgreSQL does storage, search, and the queue, so there is no Redis, no search cluster, and no second stateful service to operate.

**Core technologies:**
- **TypeScript 5.9.3** — one language everywhere. Deliberately *not* 7.0.2: no stable programmatic API until 7.1, which blocks framework/lint tooling, and there is no compile-speed problem to solve.
- **Node 22.22.3 runtime + Bun 1.3.14 as installer/script-runner only** — Bun's `node:http` client bodies are buffered not streamed and `Bun.sql` lacks `LISTEN/NOTIFY`; no upside on localhost.
- **Next.js 16.3.0 App Router + React 19.2.8** — RSC is the request/response shape of this product. Note: caching opt-in, async `searchParams`, `middleware.ts` → `proxy.ts`, `next lint` removed.
- **PostgreSQL 16 (`agentdock` schema)** — storage + generated `tsvector`/GIN FTS + `pg_trgm` fuzzy + `ingest_job` with `FOR UPDATE SKIP LOCKED`. No pgvector (unavailable in the image).
- **Drizzle 0.45.2 + drizzle-kit 0.31.10, `generate`→review→`migrate` only** — `push`/`pull` are banned; four documented incidents of emitting DDL against schemas excluded by `schemaFilter`.
- **`@octokit/rest` + throttling + retry, `gray-matter`, `zod`, `unified`/`remark`/`rehype-sanitize`, `pino`, Tailwind 4 + shadcn/ui, Biome, Vitest.**

### Expected Features

The MVP thesis is inverted from the usual registry instinct: **a small, deeply analyzed index beats a large shallow one.** Catalog size and install automation are both taken by better-resourced incumbents (`npx skills` maintains per-agent paths for 75+ runtimes) and both are structurally unwinnable for one part-time maintainer.

**Must have (table stakes):**
- Ingest a public GitHub repo by URL → discover artifacts → confirm → persist (the foundation)
- Paginated listing (6-field cards) + detail page with the learned registry anatomy
- Postgres FTS with `pg_trgm` fallback, weighted `ts_rank_cd`, type + runtime filters, useful zero-result state
- **Sanitized** rendered SKILL.md/README body — security-critical, not polish
- Source provenance: repo + path-within-repo + commit SHA + permalink to that file at that SHA
- Freshness: last commit touching *the artifact's own path*, indexed-at, archived-repo flag
- Copyable per-runtime install instruction as **text only**; GitHub stars labeled as GitHub stars

**Should have (the reason the product exists):**
- **Capability disclosure panel** — bundled scripts, shell invocations, egress URLs, filesystem paths, env reads, `allowed-tools` — each as an observed fact with a source-line link
- **Hidden-content detection with visible sentinels** — Unicode tags (U+E0000–E007F), zero-width, bidi, HTML comments, `display:none` text. Deterministic, near-zero false positives, the single best detector available. Never silently strip; make the invisible visible.
- **File inventory** (path, size, type, exec bit) — falls out of the tree walk, cheapest differentiator
- **Capability facet filter** ("no scripts, no network, no shell") — the query nobody else can answer
- **Derived compatibility** — see Contradiction 4; derived-first, declared text shown separately and labeled as author claim
- **Honest identity line** — `indexed at <sha> · committed <date> · indexed <date>`; no invented semver
- Cross-ecosystem types in one search; content hash column stored day one; search query logging

**Defer (v1.x / v2+):** re-index + capability-change detection (L1), public read API, SEO surface, read-only CLI, watch/notify (the v2 headline, the only feature that genuinely needs accounts), accounts, semantic search, curated collections, publisher claiming.

**Never:** an aggregate risk score or SAFE/VERIFIED badge; execution or sandboxing of indexed code; ratings/comments; download counts; mirroring as canonical; chasing catalog size; LLM-generated summaries of ingested text; an AgentDock-specific manifest publishers must adopt; `agentdock install`.

### Architecture Approach

Six modules in one process: `web`, `api`, `worker`, `github`, `detect`, `analyze`, over a `db` module that is the only thing that speaks SQL. The worker runs in-process behind `WORKER=1` so splitting it out later is a process-manager change, not a code change. `github/` is a wall — a grep for `api.github.com` should hit exactly one directory — and `detect/` is pure functions over an in-memory tree, so new artifact types are testable against frozen fixtures with no network and no token. The ingest pipeline never writes scanned content to disk, which deletes the entire zip-slip / path-traversal / archive-bomb class by construction rather than mitigating it.

**Major components:**
1. **`github`** — the only module that knows a GitHub URL exists: token, `x-ratelimit-*` accounting, ETag store, retry/backoff, hardcoded three-host allowlist, no off-host redirects.
2. **`detect`** — two-phase detector array: pure `match(tree)` over paths (free), then `parse(candidate, read)` (costs a fetch, declares its `needs` up front). Adding a seventh type = one file + one array entry.
3. **`analyze`** — static capability extraction over already-parsed text. Separate from `detect` because the security signal evolves independently of format support.
4. **`db`** — Drizzle, every table via `pgSchema('agentdock')`, `repository` keyed on immutable GitHub `node_id`, `package` on `(repository_id, type, source_path)`, `package_version` on `(package_id, content_hash)`, generated `search_tsv`.
5. **`worker` + `ingest_job`** — `FOR UPDATE SKIP LOCKED` claim, 15-minute lock reaper, terminal state and package writes in one transaction. Idempotent because the pipeline is a pure function of `(node_id, commit_sha)`.
6. **`web`/`api`** — server-rendered pages plus submit/job-status/search JSON. Rides along from Phase 1; a vertical slice with no page to look at is not a slice.

**Verified cost model:** first ingest of a 500-file repo = 2 core calls + 1 GraphQL point + N free raw fetches. Re-ingest of an unchanged repo = 1 GraphQL point, 0 core calls.

### Critical Pitfalls

1. **The false-assurance badge.** A `Risk: LOW` pill converts a cautious user into an infected one, because the payload the analyzer structurally cannot see is invisible in the demo. Ship a capability list, never a score, never the words safe/clean/verified/trusted. Socket.dev already made this mistake and walked it back (`Safe` → `Undetected`); inherit the disclaimers, not the number. **Write this into PROJECT.md as a constraint before the analysis phase is planned**, or a later "let's make it sortable" impulse will silently reverse it.
2. **AgentDock as the injection delivery vector.** The whole value proposition is "read the SKILL.md first", so AgentDock renders attacker-controlled instruction text. Invisible Unicode survives every step of a normal pipeline. Store raw bytes *and* a `display_body` with visible sentinels plus a findings record. If an API or MCP endpoint ever ships, it returns sentinel-annotated text, never raw — write that constraint down now.
3. **Stored XSS.** No `rehype-raw`, ever; `remark-gfm` + `rehype-sanitize` on the AST, plus CSP. And escape *metadata* — names, descriptions, tags reach `<title>`, meta tags, JSON-LD and exports through paths where nobody is thinking about the Markdown body.
4. **SSRF.** Do not accept URLs. Accept `owner/repo`, discard the rest, construct API URLs yourself, hardcode the host allowlist, `redirect: 'manual'`, pin the resolved IP. Never fetch a URL discovered *inside* repo content (`marketplace.json` `source.url`, `.well-known`, MCP remotes) — extract, display, flag, never resolve.
5. **Staleness as a silent lie.** A stale capability disclosure is an actively false security claim, and rug-pull (approve benign, mutate later) is the documented attack. `commit_sha`, `scanned_at`, `etag`, `content_hash` are day-one columns — the refresh *job* can be a later phase, the *columns* cannot.
6. **Over-generalizing across five artifact types before one works** — and **cold start**, an empty index nobody returns to. These pull in opposite directions and the resolution is ordering: skills end-to-end first, then bulk seed, then detector pluralism.

---

## Contradictions Resolved

The research dimensions disagreed in five places. Each is resolved below with the adopted position and its reason. These are decisions, not summaries.

### 1. What the security analysis actually is

**The tension.** FEATURES.md names security analysis as the one open axis. ECOSYSTEM.md notes `skills.sh` already has an `/audits` section. PITFALLS.md reports static analysis has ~1.5% recall against behaviorally confirmed malicious skills, and that 84.2% of vulnerabilities live in natural-language `SKILL.md` prose rather than in code.

**Adopted position.** AgentDock ships a **capability disclosure and hidden-content surface**. It is explicitly *not* a malware detector, and the UI says so permanently. The precise, defensible claim is:

> AgentDock reads an artifact's files and reports, with a source line for each, what the artifact declares it can do, what it bundles, what it references, and what it hides. It does not run anything and it cannot tell you whether the artifact is safe.

**Why this is defensible against the three objections.** Against the 1.5% recall figure: recall is irrelevant to a product that makes no detection claim — disclosure of `allowed-tools`, bundled script inventory, and invisible-character findings is deterministic and near-100% precise on the things it does report. Against "prose, not code": that *supports* the wedge rather than undermining it, because the highest-value detector available (invisible/hidden content, visible sentinels) is a prose-level detector and is exactly what a dependency scanner cannot see. Against skills.sh `/audits`: that page aggregates third-party verdicts from Socket, Snyk, and Gen Agent Trust Hub — package-dependency scanners pointed at prompt bundles, largely showing "Pending" — and none of them will tell you a `SKILL.md` declares `allowed-tools: Bash(curl *)` or ships a `scripts/install.sh`. Different axis, not a crowded one.

**Enforcement.** MVP detector set is six, all high-precision, all disclosure-framed: hidden/invisible content, declared capabilities, bundled-executable inventory (labeled "contents not analyzed"), remote-execution directives (`curl|sh` literal shapes), install directives, egress inventory. Each new detector is gated on "sample 20 real hits, kill it if >20% false positives." Generic env-var reads and destructive-command matching are excluded as pure noise — a noisy detector is worse than a missing one because it trains users to dismiss the whole UI.

### 2. Schema isolation — REVOKE is theater; a dedicated role is the only enforcement

**The tension.** STACK.md and ARCHITECTURE.md both prescribe `REVOKE ALL ON SCHEMA public/didim_mcp FROM …` as the enforcement layer. ENVIRONMENT.md observed directly that the connecting role `mcp` is a **superuser**, owns both `mcpdb` and the `didim_mcp` schema, and is the **only login role in the cluster**.

**Adopted position — ENVIRONMENT.md is authoritative, because it is direct observation.** PostgreSQL bypasses privilege checks for superusers, and an object owner can re-grant to itself regardless. A REVOKE script executed while AgentDock still connects as `mcp` provides **zero** real protection — only the feeling of protection, which is worse than none because it stops the search for a real control.

There is exactly one mechanism that makes the database enforce the boundary: **a dedicated non-superuser role (`agentdock_app`) owning only the `agentdock` schema, with no table privileges in `public` or `didim_mcp`.** Note the precise guarantee: `USAGE` on `public` is held by `PUBLIC` and must **not** be revoked from `PUBLIC` (that would affect the other application), so the boundary comes from the *table* level — the role holds no privileges on any table in either schema, which is sufficient and is the honest statement.

**This requires the maintainer's explicit go-ahead.** It is a change to a database shared with a running application, so it is a gated first task in the roadmap, not something planning performs. It also cannot be safely retrofitted after migrations have run under the wrong owner.

**Application-layer discipline is defense-in-depth on top, never a substitute:** `pgSchema()` qualification on every table, `search_path` on the connection string, a boot assertion that refuses to start if `search_path` is wrong, `schemaFilter: ['agentdock']`, `migrations.schema: 'agentdock'` (the default lands in a *third* schema named `drizzle`), `push`/`pull` absent from `package.json`, and a CI grep for `DROP` and `didim_mcp` in generated SQL.

**Contingency, stated now so it is not rediscovered under pressure:** if the maintainer declines the dedicated role, switch from Drizzle to Kysely with hand-written SQL migrations. When the database will not stop a bad statement, the tool must not be able to generate one.

### 3. Acquisition — seed list + registry sync + pull-by-URL; no crawler

**The tension.** Neither document actually disagrees; they arrived at the same verdict from different directions and the convergence is worth stating as one position.

ARCHITECTURE.md verified live that GitHub Code Search returns **0 results** for the intended discovery patterns (`path:.claude-plugin/marketplace.json name`, `description path:**/SKILL.md`, `allowed-tools path:SKILL.md`), and that the API cannot express "every repo containing a file named X" at all — it rejects qualifier-only queries, indexes only default branches and files under 384 KB, caps at 1,000 results, and runs at 10 requests/minute. ECOSYSTEM.md independently concluded that ~40k candidate repos across the relevant topics puts a full crawl outside a solo-maintainer PAT budget.

**Converged verdict.** Strategy B as literally specified (code-search by file pattern) is **struck from the roadmap.** Acquisition is four tiers, cheapest first:

- **Tier 0 — MCP Registry sync.** `registry.modelcontextprotocol.io/v0/servers` is public, unauthenticated, cursor-paginated, supports `updated_since`. Thousands of entries for a few dozen plain HTTPS requests and **zero GitHub quota**, and every `repository.url` in it is a free GitHub seed. This alone takes the index from empty to browsable.
- **Tier 1 — catalog fan-out.** `.claude-plugin/marketplace.json` is a *catalog*, not an artifact: the marketplace detector emits repo **seeds**, not packages. Twenty marketplace repos can enqueue several hundred plugin repos with metadata already in hand.
- **Tier 2 — operator seed list** (`scripts/seeds.txt`, ~30 lines). ~2 core calls per repo, 10–100 artifacts each. This is what produces the first few hundred entries and it takes an afternoon.
- **Tier 3 — awesome-list link extraction** via `raw.githubusercontent.com` (free), regex out repo links, enqueue.
- **Tier 4 — repo-search sharding (B′).** `/search/repositories` on `topic:agent-skills`, `topic:claude-skills`, `topic:claude-code-plugin`, `topic:mcp-server`, sharded by star buckets to escape the verified hard 1,000-result cap. ~100 search calls per topic; at ~2 core calls per repo, 3,000 repos is an overnight run.

Strategy D (community submission queue) is deferred indefinitely — it is ongoing moderation, which a part-time maintainer cannot sustain. Abuse containment for the submit endpoint that exists from day one is a **visibility gate**, not a moderation queue: one nullable `approved_at` column and one `WHERE` clause, with submitted-but-ungated packages reachable by direct link.

### 4. Compatibility is a derived fact, not a declared field

**The finding that changes the feature.** ECOSYSTEM.md established that the spec's `compatibility` field is **free prose up to 500 characters** ("Designed for Claude Code (or similar products)", "Requires git, docker, jq, and access to the internet"). It is not an enum and not machine-parseable, so **declared compatibility is worthless as a filter facet.** Meanwhile the frontmatter *field set* versus each runtime's *accepted field set* is exactly computable.

**Adopted position: compatibility is derived-first.** AgentDock computes and presents as facts:

1. **Spec conformance.** Frontmatter keys ⊆ the six spec fields (`name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools`) → portable everywhere including claude.ai upload. Any extra key → hard-fails claude.ai packaging with a named error. Claude Code accepts 20+ fields; a skill using `context: fork` is Claude-Code-locked. **No competitor surfaces this and it is exactly computable.**
2. **Per-runtime field support** as a versioned data table (Cursor supports `paths`, `disable-model-invocation`, `metadata`; OpenCode supports the spec six) — data, not code, because runtimes drift.
3. **Discovery-path reachability.** `.agents/skills/` is the emerging neutral path (Cursor + Codex + Gemini CLI + OpenCode); `.claude/skills/` is read by Cursor and OpenCode as a compatibility path, so a skill checked in there is already loadable by at least three non-Anthropic runtimes unmodified.
4. **Artifact-type gating.** `.claude-plugin/plugin.json` → Claude Code only. `.cursor/rules/*.mdc` → Cursor only. `gemini-extension.json` → Gemini CLI only. `server.json`/`.mcp.json` → any MCP client.
5. **Name/directory mismatch** — the spec requires `name` == parent directory name; a mismatch is a computable defect.

The declared `compatibility` string is displayed **verbatim, in a separate place, labeled as an author claim**, and never feeds a filter. The presentation vocabulary is `derived` / `declared` / `unknown`, with `unknown` shown rather than hidden, and `verified` reserved and never used (it would require execution). `derived` must not get a green check — otherwise the vocabulary is decoration. One nuance the UI must not paper over: compatibility applies *within* an artifact type. A `.mdc` Cursor rule does not "work with Claude Code."

### 5. File acquisition: Trees + raw, not tarball

**The tension.** PITFALLS.md calls "tarball over Contents API" the single biggest rate-limit lever and then spends a full pitfall on safely handling hostile archives. ARCHITECTURE.md rejects tarballs outright in favor of the Trees API plus `raw.githubusercontent.com`.

**Adopted position: ARCHITECTURE.md wins, on a verified fact PITFALLS.md did not have.** `raw.githubusercontent.com` fetches do **not** consume core quota (measured: `core.used` unchanged across fetches). That removes the rate-limit argument for tarballs entirely — one Trees call plus N free raw fetches beats one tarball call *and* costs no quota for the bodies. And because nothing is ever written to disk, the whole zip-slip / symlink / gzip-bomb / path-traversal class disappears by construction rather than being mitigated by a careful extractor.

PITFALLS.md's caps survive and are still required, applied to the in-memory path instead: byte caps with a streaming abort (never trust `Content-Length`), per-file and per-repo file-count caps, tree depth caps, a `tree_truncated` flag surfaced rather than silently swallowed, and a wall-clock budget per job.

### 6. Where the security phase sits

ARCHITECTURE.md's build order puts the security signal at Phase 6, after search. ECOSYSTEM.md and FEATURES.md both insist the capability analyzer is the reason the product exists and must not be deferred. **Resolution: pull it forward to sit immediately after detector pluralism and before search relevance.** Search *ranking* genuinely needs a corpus to tune against, which is the one non-obvious ordering constraint and it holds; but listing and type filtering exist from Phase 1, so nothing about the security panel depends on relevance tuning. The phase plan below reflects the swap.

---

## Verified Facts

Directly observed on 2026-08-10, by running a command against the real system. Treat as HIGH confidence and do not re-litigate.

| Fact | Consequence |
|---|---|
| `raw.githubusercontent.com` fetches do **not** consume GitHub core quota (`core.used` unchanged across fetches) | File bodies are free; repo enumeration is not. Fetch the tree once, then read as many files as needed. Kills the tarball argument. |
| `registry.modelcontextprotocol.io/v0/servers` is public, unauthenticated, HTTP 200, cursor-paginated, `limit` max 100, supports `updated_since` | Tier-0 cold start: thousands of entries for zero GitHub quota. |
| Authenticated limits: core 5,000/hr, graphql 5,000 pts/hr, search 30/min, code_search 10/min. Unauthenticated: core 60/hr, search 10/min, **graphql 0** | A token is mandatory. Unauthenticated ingestion is not viable — GraphQL is entirely unavailable. |
| GraphQL aliased 3-repo query → `cost: 1, nodeCount: 10` | ~50 repos per point. Metadata refresh across thousands of repos is effectively free. |
| Conditional request with `If-None-Match` → HTTP 304, does not count against the primary limit | Store `etag` from day one; freshness polling is nearly free later. |
| Code Search: `path:.claude-plugin/marketplace.json name` → 0; `description path:**/SKILL.md` → 0; `allowed-tools path:SKILL.md` → 0; `name path:SKILL.md` → 84 (matching a *directory* named `SKILL.md`) | Strategy B struck. |
| `/search/repositories` page 11 → HTTP 422 "Only the first 1000 search results are available" | Sharding by star bucket is mandatory, not an optimization. |
| Topic counts: `mcp-server` 23,150 · `agent-skills` 14,303 · `claude-skills` 6,653 · `claude-code-plugin` 5,010 | ~40k candidate repos. Full crawl is outside a solo PAT budget. |
| `anthropics/skills` tree: 501 entries, 128 KB, `truncated: false`, 18 `SKILL.md` files | Monorepos with many artifacts are the normal case, not an edge case. |
| The `agentdock` schema name is free; only `public` and `didim_mcp` exist | Proceed with the name. |
| Connecting role `mcp` is `rolsuper=t`, owns `mcpdb` and `didim_mcp`, and is the **only login role in the cluster** | REVOKE-based isolation is ineffective. See Contradiction 2. |
| pgvector is **not available** in the running `postgres:16-alpine` image; `pg_trgm`, `pgcrypto`, `unaccent`, `uuid-ossp` are available but not installed | Semantic search would require swapping a shared DB image. Ruled out of MVP. |
| No host `psql` client | Migration tooling must connect over TCP with a driver. |
| The `gh` CLI token on this machine carries `repo`, `admin:org`, `admin:enterprise`, `delete_repo`, `workflow` | AgentDock must **never** reuse it or fall back to `gh auth token`. A scopeless / fine-grained public-read token gets the same 5,000/hr. |
| SkillMaru: `/api/web/packages` → 401; OG description `사내 에이전트 스킬 레지스트리`; runtime global `window.__SKILLHUB_RUNTIME_CONFIG__`; npm `@cookyman/skillmaru` from `github.com/cookyman74/skillhub` | Push-model private registry, a fork of `openclaw/clawhub`. Reference for information architecture only; not a competitor. |
| npm registry dist-tags for every pinned version in STACK.md | Version numbers are authoritative as of 2026-08-10. |

Everything else in this summary came from documents — vendor specs, official docs, competitor sites, vendor security research, and preprints — and carries the confidence recorded below.

---

## Implications for Roadmap

Eight phases. The dependency graph is nearly linear. `web` is not a phase — it rides along from Phase 1, because a vertical slice with no page to look at is not a slice.

### Phase 0: Database role bootstrap (gated on maintainer approval)
**Rationale:** The only layer a code bug cannot defeat, and it cannot be safely retrofitted after migrations have run under the wrong owner. It is also the one task that touches a database another running application depends on, so it is explicitly gated.
**Delivers:** `scripts/bootstrap-role.sql` creating `agentdock_app`, `CREATE SCHEMA agentdock AUTHORIZATION agentdock_app`, superuser-installed `pg_trgm`, `.env.example` with a **no-scopes** `GITHUB_TOKEN`.
**Avoids:** silent catastrophic writes to `didim_mcp`.
**Blocking decision for the maintainer:** approve the dedicated role, or accept application-layer discipline only — in which case the stack switches to Kysely + hand-written SQL migrations.

### Phase 1: Walking skeleton — skills only, end to end
**Rationale:** PITFALLS Pitfall 9 (over-generalizing across five artifact types before one works) and ARCHITECTURE's build order agree exactly: one type, all the way through. It also touches every boundary — schema isolation, GraphQL, Trees, raw fetching, safe YAML, the identity key, sanitized rendering — so if an assumption is wrong the blast radius is one table and one detector.
**Delivers:** Paste a GitHub URL → the repo's `SKILL.md` artifacts appear on a list page and a detail page. Schema (all day-one columns: `commit_sha`, `scanned_at`, `etag`, `content_hash`, `license_spdx`), `github` client with host allowlist and rate-limit accounting, the `skill` detector, synchronous ingest, two pages.
**Addresses:** TS12, TS1, TS3, TS4, TS6, TS7, TS10, D6.
**Avoids:** Pitfalls 3 (XSS — `rehype-sanitize`, no `rehype-raw`, CSP, metadata escaped at every sink), 4 (SSRF — `owner/repo` only, hardcoded allowlist, manual redirects, IP pinning), 7 (staleness columns), 9 (scope), 12 (licence columns + `excluded_repos` denylist).
**Hard gate:** the XSS fixture test and the SSRF bypass suite pass before anything renders.

### Phase 2: Durable ingestion
**Rationale:** Bulk seed is impossible without a resumable queue, and a slow repo must not wedge the server.
**Delivers:** `ingest_job` + `SKIP LOCKED` claim + progress polling UI + 15-minute reaper + commit-SHA short circuit + ETag conditional requests.
**Uses:** PostgreSQL job table (no Redis, no pg-boss — each ships its own DDL-running migration system into the shared database, spending exactly the risk budget Phase 0 exists to protect).
**Avoids:** Pitfall 8 (rate-limit exhaustion, PAT leakage — floor-and-sleep, `Authorization` stripped before error serialization, no bodies logged).

### Phase 3: Detector pluralism
**Rationale:** Two-phase detectors are pure functions over frozen fixtures; this is where the fixture corpus is built, and it is the prerequisite for both the corpus and the security signal.
**Delivers:** `plugin.json` (+ directory-shape fallback, since the manifest is optional), `marketplace.json` **as seeds not packages**, `.mcp.json`/`server.json`, `commands/` (treated as a skill variant — commands have been merged into skills), `hooks/hooks.json`; nested + monorepo handling; per-candidate try/catch with `parse_status ok|partial|failed`; Zod schema per type.
**Addresses:** D5 (cross-ecosystem index).

### Phase 4: Security signal — the differentiator
**Rationale:** Moved ahead of search (see Contradiction 6). This is the reason the product exists and it depends only on Phase 3.
**Delivers:** File inventory (D3) first, then the six MVP detectors, the capability disclosure panel, the capability facet filter (D7), source-line permalinks on every finding (D8), visible sentinels for hidden content, and the permanent "What AgentDock does not check" block.
**Avoids:** Pitfalls 1 (no score, no badge, no safety word — enforced in schema, API, and UI), 2 (sentinels, raw bytes retained), 6 (six high-precision detectors, each gated on 20 hand-checked hits), ReDoS (bounded anchored patterns, input caps, timeouts).
**Constraint to write into PROJECT.md before this phase is planned:** the wording rules — verbs of observation (*found*, *references*, *declares*, *bundles*), never verbs of judgment (*safe*, *clean*, *verified*, *trusted*, *approved*).

### Phase 5: Corpus / cold start
**Rationale:** An empty registry kills more solo registries than any bug, and search relevance cannot be tuned against twenty rows.
**Delivers:** MCP Registry sync (Tier 0), operator seed list (Tier 2), awesome-list link extraction (Tier 3), repo-search sharding (Tier 4), fork filter, content-hash dedup with "also found in N repos", visibility gate (`approved_at`).
**Avoids:** Pitfalls 10 (cold start — ≥500 parsed artifacts before the browse UI is shown to anyone) and 11 (fork/duplicate flooding — cheap now, expensive after 10k rows).

### Phase 6: Search & browse
**Rationale:** Relevance needs data, which Phase 5 supplies.
**Delivers:** Generated `tsvector` (literal `'english'` regconfig — the one-arg form is only STABLE and will be rejected in a generated column; `readme_excerpt` capped at ~8 KB, never the full README), `websearch_to_tsquery` (never `to_tsquery`, which 500s on an apostrophe), `ts_rank_cd(…, 32)`, `pg_trgm` fallback for the zero-result state, type/runtime/capability facets, category mapping rules, and **search query + result-count logging** (the evidence base for the entire search roadmap, and unbackfillable).
**Avoids:** premature semantic search — `pgvector` requires swapping a shared DB image; escalate only on >15–25% zero-result rate on *intent-shaped* queries, not typos.

### Phase 7: Derived compatibility matrix
**Rationale:** Per Contradiction 4 this needs a versioned runtime-capability **data file**, not code, and it deserves its own design pass. It is a strong second differentiator and it is exactly computable.
**Delivers:** Spec-conformance computation, per-runtime field-support table, discovery-path reachability, artifact-type gating, name/directory mismatch check; declared `compatibility` shown verbatim and labeled as author claim.

### Phase 8: Freshness
**Rationale:** A stale capability disclosure is an actively false security claim. The columns existed from Phase 1; this is the job.
**Delivers:** Batched GraphQL refresh sweep (~50 repos/point), ETag-conditional requests, scheduled re-ingest, soft-delete delisting, "last checked" surfacing with visible degradation past 90 days, and the capability-change delta (L1) that becomes v2's watch/notify headline.
**Avoids:** Pitfall 7, and the denylist re-add bug (`excluded_repos` consulted at crawl time).

### Phase Ordering Rationale

- **Phase 0 is first and gated** because a dedicated role cannot be safely retrofitted after migrations run under the wrong owner, and because it needs a human decision about a shared production database.
- **One artifact type end to end before any second type** resolves the direct tension between PITFALLS Pitfall 9 (over-generalization) and the five-type vision — ordering, not scope reduction.
- **Detectors before security signal** because capability analysis walks over parsed artifacts and their file inventories.
- **Security signal before search** because it is the differentiator; search ranking is the only thing that genuinely needs a corpus first, and listing/type-filtering already exist from Phase 1.
- **Corpus before search relevance** is the one non-obvious ordering, and Tier 0 makes it cheap: the MCP Registry sync produces thousands of rows for zero GitHub quota, so Phase 5 is not a long detour.
- **Freshness last** because the day-one columns already made staleness a *disclosed* fact rather than a silent one; only the sweep job is deferred.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 0** — the exact grant set for `agentdock_app` against a shared, live database, and what breaks if the maintainer declines (the Kysely contingency needs a concrete migration workflow).
- **Phase 4** — the capability classification taxonomy is genuinely hard: what counts as "network access" inside a `Bash()` allowed-tools rule, and what false-positive rate prompt-injection-shaped detection produces on a real corpus. Needs its own spike with a labeled fixture set.
- **Phase 5** — GitHub rate-limit budgeting and the incremental re-ingest strategy under real shard volumes.
- **Phase 7** — the per-runtime field-support matrix must be built from five vendors' current docs and versioned as data; runtimes drift monthly.

Phases with standard patterns (skip research-phase):
- **Phase 1** — frontmatter/YAML parsing, sanitized Markdown rendering, and the listing/detail UI are all well-documented; the security requirements are already fully specified in PITFALLS.md.
- **Phase 2** — `FOR UPDATE SKIP LOCKED` job tables are a settled pattern; the SQL is already written in both STACK.md and ARCHITECTURE.md.
- **Phase 6** — PostgreSQL FTS + `pg_trgm` is documented down to the exact gotchas (IMMUTABLE regconfig, `unaccent` exclusion, `websearch_to_tsquery`).
- **Phase 8** — batched GraphQL + ETag conditional requests are verified and costed.

---

## Confidence Ledger

### By area

| Area | Confidence | Notes |
|------|------------|-------|
| Local environment (DB, roles, extensions, toolchain, tokens) | **HIGH** | Direct observation on the target machine. Authoritative over every document. |
| GitHub API mechanics, costs, and limits | **HIGH** | Live-verified with recorded commands and outputs, corroborated by official docs. |
| Artifact format specs (Agent Skills, `plugin.json`, `marketplace.json`, `server.json`, `gemini-extension.json`, hooks) | **HIGH** | Fetched from official specs and vendor docs. |
| Stack versions and package facts | **HIGH** | Queried live from the npm registry. |
| Drizzle `push`/`pull` schema-drop risk | **HIGH** | Four numbered issues with fetched statuses; the #5329 fix landed only in the 1.0 beta line, which is not `latest`. |
| SkillMaru analysis and positioning | **HIGH** | Live API responses, served bundle, npm provenance. |
| Runtime skill-discovery paths | **HIGH** | Each vendor's own docs. Volatile — re-verify before implementing install instructions. |
| Architecture / data model | **MEDIUM-HIGH** | Sound and internally consistent, but unexercised. Phase 1 is the test of the identity key and the isolation design. |
| Feature landscape and registry conventions | **MEDIUM-HIGH** | Vendor docs cross-checked across npm, PyPI, crates.io, pkg.go.dev, Docker Hub, VS Code Marketplace. |
| Security-signal presentation (no-score, Socket's `Safe`→`Undetected`) | **MEDIUM-HIGH** | Vendor documentation plus a well-argued industry precedent. The *argument* is stronger than the citations. |
| Competitor catalog sizes | **MEDIUM-LOW** | Mostly self-reported marketing numbers and third-party blogs. Order-of-magnitude only. Only the MCP Registry and `claude-plugins-official` (284 plugins) were measured directly. |
| skills.sh audit methodology | **LOW** | Vendor names and verdicts visible on the dashboard; methodology unpublished. |
| Legal / licensing posture | **MEDIUM** | No lawyer consulted; GitHub policy is prose, not spec. The excerpt-not-mirror default is conservative and correct regardless. |
| Cold-start volume estimates | **MEDIUM** | Extrapolated from measured per-repo call cost, not observed at volume. |

### Claims resting on unverified 2026 arXiv preprints — do NOT treat as settled

These shaped the *framing* of the security wedge and are cited throughout PITFALLS.md. They were read at abstract level and were **not independently reproduced**. The product decisions they support (no score, disclosure-only, six high-precision detectors) are correct on independent grounds — Socket's own `Safe`→`Undetected` walk-back, OpenSSF Scorecard's documented score-vs-vulnerability problem, and the plain liability argument — so the roadmap does not fall if these numbers are wrong. But do not quote these figures in the product UI, in a README, or in any public writing.

| Claim | Source | Status |
|---|---|---|
| Static analysis alone has **~1.5% recall** against behaviorally confirmed malicious skills | arXiv:2602.06547 | **UNVERIFIED preprint.** Load-bearing for the framing; not for the decision. |
| **84.2%** of vulnerabilities live in `SKILL.md` natural-language prose rather than code | arXiv:2602.06547 | **UNVERIFIED preprint.** |
| **73.2%** of malicious skills contain undocumented "shadow features" | arXiv:2602.06547 | **UNVERIFIED preprint.** |
| **54.1%** of one malicious corpus came from a single actor via templated brand impersonation | arXiv:2602.06547 | **UNVERIFIED preprint.** |
| 98,380 skills surveyed; 157 behaviorally confirmed malicious | arXiv:2602.06547 | **UNVERIFIED preprint.** |
| `node-tar` gzip-bomb DoS CVE-2026-59873 | single search result | **UNVERIFIED.** Moot anyway — nothing is extracted to disk. |
| SkillJect / PhantomSkill / SkillSieve / MCP-38 / "Parasites in the Toolchain" taxonomies | arXiv preprints | **UNVERIFIED.** Background only; no decision depends on them. |

**Treated as HIGH confidence by contrast** (named vendors, named CVEs, reproducible artifacts): Snyk ToxicSkills (3,984 skills, 36.8% with a flaw, 13.4% critical, 76 human-confirmed malicious, 8 still listed at publication), Check Point CVE-2025-59536 / CVE-2026-21852, Tenable TRA-2026-27, Invariant Labs tool poisoning, Cisco/AWS Unicode-tag smuggling guidance, CMU ICSE 2026 fake-stars study (peer-reviewed).

### Overall confidence: MEDIUM-HIGH

The things the build depends on — the environment, the GitHub cost model, the formats, the versions — are verified. The things that are softer are competitive sizing (doesn't change the plan) and security effect sizes (which shape the pitch, not the design).

### Gaps to Address

- **The DB role decision is unresolved and blocking.** Surface it as the first thing the maintainer must decide. Both branches are specified (dedicated role + Drizzle, or superuser + Kysely); planning must not silently pick one.
- **`pg_trgm` installation requires coordination.** Extensions are per-database. If the other application later installs it into `public`, a second `CREATE EXTENSION` fails. Confirm before Phase 1; be prepared to reuse theirs.
- **Detector precision is unmeasured.** No labeled corpus exists. Phase 4 must build one (benign skill, invisible-chars skill, bundled-script skill, `curl|sh` skill, 100k-file monster, malformed frontmatter) and record a hand-checked FP count per detector before shipping it.
- **Runtime install paths are volatile** — `.agents/skills/` only consolidated during 2026 and may fragment again. Re-verify immediately before implementing install instructions, and model the runtime tables as versioned data.
- **Artifact-type distribution in the wild is unknown** (how many MCP servers vs skills), which affects parser priority ordering. Phase 5's corpus answers it empirically.
- **`claudepluginhub.com` returned 403 to automated fetch.** Scope and scale unknown; worth a manual browser check, though nothing in the plan depends on it.
- **Whether prompt-injection-shaped detection has a tolerable FP rate on real corpora.** If it doesn't, that detector ships as "instruction patterns worth reading," not as flags — or not at all.
- **~~`PROJECT.md` needs two edits before roadmapping~~** — **DONE.** The "no neutral cross-ecosystem registry with a security lens exists" claim has been struck and replaced with the narrower derived-capability claim, and the SkillMaru reference has been re-scoped to information architecture only.

---

## Sources

Full source lists live in each research document. Aggregated by tier:

### Primary (HIGH confidence)
- **Direct observation on the target machine, 2026-08-10** — `docker inspect`, `psql \dn` / `pg_available_extensions` / `pg_roles`, `gh auth status`, `gh api rate_limit`, `gh api …/git/trees`, GraphQL cost probe, `If-None-Match` 304 probe, `raw.githubusercontent.com` quota probe, `gh api search/code`, `gh api search/repositories`, `registry.modelcontextprotocol.io` probes. Recorded in `ENVIRONMENT.md` and inline in `ARCHITECTURE.md`.
- **Official specifications** — `agentskills.io/specification`, `code.claude.com/docs` (skills, plugins-reference, plugin-marketplaces, hooks), `static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json`, `cursor.com/docs`, `opencode.ai/docs`, `learn.chatgpt.com/docs/build-skills`, `geminicli.com/docs`.
- **Official product docs** — `nextjs.org/blog/next-16`, `orm.drizzle.team/docs`, `postgresql.org/docs/16/textsearch-tables.html`, `bun.com/docs`, `tailwindcss.com`, `ui.shadcn.com`, `biomejs.dev`, GitHub REST/GraphQL/Search/Trees/rate-limit docs, GitHub ToS and Acceptable Use.
- **npm registry** — live dist-tags for every pinned version.
- **Vendor security research with named CVEs** — Snyk ToxicSkills, Check Point, Tenable, Invariant Labs, Cisco, AWS, Socket.dev, OpenSSF Scorecard.
- **Peer-reviewed** — CMU ICSE 2026 fake-stars study; ACM TOSEM on open-source licence inconsistencies.

### Secondary (MEDIUM confidence)
- Competitor sites analyzed live — `skills.sh` + `/audits`, `registry.modelcontextprotocol.io`, `anthropics/claude-plugins-official`, `glama.ai`, `smithery.ai`, `mcp.so`, `pulsemcp.com`, `skillmaru.hell0world.net` (API + bundle), `openclaw/clawhub`.
- TypeScript 7.0 programmatic-API reporting (InfoQ, The Register) — corroborated by two outlets plus the beta announcement.
- Registry-convention docs — npm, PyPI, crates.io, pkg.go.dev, Docker Hub, VS Code Marketplace.

### Tertiary (LOW confidence — needs validation, do not cite publicly)
- **arXiv 2026 preprints** — 2602.06547, 2602.14211, 2606.19191, 2606.18198, 2604.06550, 2603.18063, 2509.06572. See the Confidence Ledger.
- Third-party blog posts used only for competitor catalog-size figures (agensi.io, explainx.ai, truefoundry, tallyfy, safedep, agentman.ai).
- `skills.sh`'s "1,193,145 skills" figure — almost certainly not distinct skills. Do not cite.
- CVE-2026-59873 (`node-tar` gzip bomb) — single source, and moot under the no-disk-writes design.

---
*Research completed: 2026-08-10*
*Ready for roadmap: yes — with one blocking maintainer decision (Phase 0 database role)*
