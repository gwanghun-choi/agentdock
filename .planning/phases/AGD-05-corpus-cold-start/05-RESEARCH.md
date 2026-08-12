# Phase 5: Corpus & Cold Start - Research

**Researched:** 2026-08-11
**Domain:** GitHub-free registry ingestion (MCP Registry sync), operator/catalog-driven seed fan-out, GitHub search sharding, read-time listing hygiene (forks/dupes/visibility floor)
**Confidence:** HIGH — every external-service claim below was called live today (2026-08-11) and every codebase claim was read from the file cited, not recalled from `.planning/research/ARCHITECTURE.md`'s 2026-08-10 pass. Two of ARCHITECTURE.md's recorded facts are corrected below (§Q1, §Q3).

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| COR-01 | MCP registry synced without consuming GitHub quota | §Q1 — endpoint re-verified live; `.mcp.json`/`server.json` fetches happen against `registry.modelcontextprotocol.io`, never `api.github.com` |
| COR-02 | Operator seed list bulk-populates the index | §Q5 — 28 concrete `owner/repo` entries verified live, file-format recommendation |
| COR-03 | Catalog files fan out into repository seeds | §Q3 — `repo_seed` consumer design, `enqueueJob` idempotency gap found and fixed in the design |
| COR-04 | Curated link lists expand into seeds | §Q5 (awesome-list tier), §Q9 |
| COR-05 | Topic search sharded to escape the result cap | §Q4 — search-API budget re-verified live, separate from core |
| COR-06 | ≥500 parsed artifacts before browse is "ready" | §Q4 — reachable unauthenticated in one session; arithmetic shown |
| COR-07 | Submitted-but-ungated packages reachable by link, excluded from listings | §Q7 — floor design; §Q6/patterns cross-check on the `listPackages`/`getRepositoryPackages` sharing bug |
| DAT-07 | Forks stored distinctly; dedup is read-time only | §Q6 — `is_fork` already stored and unused; content-hash dedup design |
</phase_requirements>

## Summary

Two of this phase's three "fill the index" levers are nearly free and one is expensive but bounded. The MCP Registry (`registry.modelcontextprotocol.io`) is public, unauthenticated, and — re-verified today by paginating it to exhaustion — holds **21,055 servers** (at `version=latest`), of which **55.7%** carry a GitHub `repository.url` (a sampled rate over 3,000 rows) and are therefore ingestible seeds; none of this costs `api.github.com` quota. The operator seed list and catalog fan-out both spend the same flat **2 GitHub core calls per repository** regardless of repo size, because raw file bodies are free (`raw.githubusercontent.com` — reconfirmed does not move `core.used`). That arithmetic is favorable: COR-06's 500-artifact floor is reachable **within the unauthenticated 60-req/hr budget in well under an hour**, provided the seed list front-loads a few artifact-dense monorepos rather than 500 single-skill repos — a single verified repo (`davila7/claude-code-templates`) alone has ~1,300 candidate artifact paths, which the pipeline's own `CAPS.maxFiles = 400` truncates safely (visibly, without delisting) to 400 in one 2-call ingest.

The corpus-quality levers (fork suppression, dedup, visibility floor) require no new fetch and almost no new storage: `repository.isFork` is already populated from the GitHub API and simply never read by a query (identical to the `mode`/tree-entry pattern this project has hit twice before), and `package_version.contentHash` already exists for content-hash dedup. The two real design decisions are (1) `repo_seed`'s consumer — argued below for a single nullable `enqueued_at` column, not a status enum and not pure derive-by-join, though the derive-by-join alternative is live-viable if the maintainer prefers zero migration — and (2) where the read-time filter goes, because a companion pattern-mapping pass (`05-PATTERNS.md`) already found and this research independently confirmed that `getRepositoryPackages` (the detail page) calls the exact same `listPackages()` function the listing page uses — so a naive `WHERE` clause added to `listPackages` would violate COR-07's "reachable by direct link" half by hiding gated packages from their own detail page too.

**Primary recommendation:** Ship COR-01 (registry sync, its own `src/registry/` adapter) and a `repo_seed` consumer with `enqueued_at` first — they require no new host-allowlist audit surface beyond one line in `check-boundaries.mjs` and no live-corpus precision re-measurement. Populate COR-06's 500-artifact floor from the verified seed list in §Q5 (front-loaded by artifact density), not from raw seed count. Ship the fork/visibility filter as a second `and()` predicate parameter on `listPackages`, not a schema change to `getRepositoryPackages`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| MCP registry polling (COR-01) | Backend / `worker` tier (batch script, not the in-process ingest loop) | — | New external host; must stay inside its own adapter directory for `check-boundaries.mjs` rule 5 to police it (§Q2) |
| Seed fan-out (COR-03) | Backend / `db` + `ingest` tiers | — | Reads `repo_seed`, writes `ingest_job` through the existing `enqueueJob()` — no new tier |
| Sharded topic search (COR-05) | Backend / new `src/discovery/` or `src/github/search.ts` | — | Lives beside `github/` (same host, same rate-limit discipline) but is a distinct budget bucket (§Q4) — keep it a sibling file inside `src/github/` so `check-boundaries.mjs`'s existing `HOST_DIR` rule already covers it, not a new directory |
| Fork/dup/visibility suppression (DAT-07, COR-07) | Database / `db/queries` tier (query predicate) | — | Must never touch stored rows — a `WHERE` clause, not a write path (§Q6/Q7) |
| Cold-start verification (COR-06) | Operator tooling (`scripts/`) | — | A CLI script + manual procedure, not an app-tier feature (§Q9/Q10) |

## Q1 — MCP Registry contract, re-verified today

Live calls made 2026-08-11 against `registry.modelcontextprotocol.io` (all via plain `curl`/Python `urllib`, unauthenticated, no token used — this host requires none).

**Envelope and pagination.** `GET /v0/servers?limit=2` → `HTTP 200`, body shape:
```json
{"servers": [ {"server": {...}, "_meta": {"io.modelcontextprotocol.registry/official": {...}}}, ... ],
 "metadata": {"nextCursor": "<name>:<version>", "count": 2}}
```
- Cursor field is `metadata.nextCursor`, an opaque `name:version` string — not an integer offset.
- **"No more pages" is signalled by the key `nextCursor` being absent from `metadata` entirely** (not `null`, not an empty string) — confirmed by paginating to the true end: the final page's `metadata` was exactly `{"count": 55}`.
- `metadata.count` is the **page** size (echoes `len(servers)` on every page, including the last, non-full one), not a running or grand total — there is no total-count endpoint (`/v0/stats` → `404`).

**Fields genuinely present vs optional**, sampled over 3,000 rows (30 pages × `limit=100`, `version=latest`):
| Field | Presence |
|---|---|
| `server.name`, `server.description`, `server.version` | 100% (required by schema) |
| `server.repository` | 58.8% (1,681/3,000) |
| `server.repository.source === 'github'` | 55.7% (1,672/3,000) |
| `server.repository.source === 'gitlab'` | 0.3% (9/3,000) |
| `server.repository` present but an **empty object `{}`** | 2.8% (83/3,000) — a malformed/incomplete row shape a naive `repository.url` read would crash on |
| no `repository` field at all (remote-only server, no public source) | 41.2% |
| `server.repository.subfolder` | present on some rows (spot-checked, not separately tallied — schema-optional) |
| `server.remotes[]` | common on remote-hosted servers, absent on stdio-only ones |
| `_meta["io.modelcontextprotocol.registry/official"].publishedAt/updatedAt/isLatest/status` | 100% on every row observed |

**Total registry size.** Paginated to exhaustion at `version=latest` (211 requests, ~4.5 min, one unauthenticated session, zero errors): **21,055 total servers**. At the 55.7% github-source sample rate, **≈11,728 of them carry a GitHub `repository.url`** — the number that matters, since only those are ingestible. `[VERIFIED: registry.modelcontextprotocol.io/v0/servers, full pagination run 2026-08-11]`

**`updated_since` works, verified two ways**: `updated_since=2027-01-01T00:00:00Z` (future) → `{"servers": [], "metadata": {"count": 0}}`; `updated_since=2020-01-01T00:00:00Z` (past) → normal results. `search=github` returns name-filtered results. All three params from `.planning/research/ARCHITECTURE.md`'s openapi.yaml read (`cursor`, `limit`, `updated_since`, `search`, `version`, `include_deleted`) are confirmed functional live, not merely documented.

**Preview/instability warning — status is more nuanced than "still in preview".** The registry's own `README.md` (fetched live from `github.com/modelcontextprotocol/registry`, `main` branch) carries two dated entries, newest first:
> **2025-10-24 update**: The Registry API has entered an **API freeze (v0.1)**. For the next month or more, the API will remain stable with no breaking changes...
>
> **2025-09-08 update**: The registry has launched in preview 🎉 ... this is still a preview release and breaking changes or data resets may occur.

The 2025-09-08 "preview, breaking changes may occur" wording that Phase 3's research quoted is **still literally present in the file**, but it has been superseded by a newer entry declaring an **API freeze** — whose own stability promise ("for the next month or more") is now roughly 9-10 months stale relative to today with no further dated update superseding it. `[CITED: github.com/modelcontextprotocol/registry/blob/main/README.md, fetched 2026-08-11]` **Practical read for Phase 5:** treat the schema as frozen-but-unconfirmed-current — the same tolerant, never-fail-the-repo posture Phase 3 already committed to for `server.json` (`04-CONTEXT.md`/`03-RESEARCH.md` A2) is the correct posture for the registry list endpoint too. Do not add a "registry is stable now" comment anywhere; the evidence for that claim is a 10-month-old sentence with no corroboration.

**Data-quality finding, unprompted:** one page (page 11 of the raw, non-`version=latest` pagination) failed strict JSON parsing with `Invalid control character` — a raw control byte inside a `description` field from a third-party publisher. `strict=False` parsing (Python) recovered it; a Node/TS `JSON.parse` would **throw** on the same byte. This is direct, live evidence that the registry accepts publisher-supplied text with **no server-side sanitization**, and the adapter must defend against it explicitly (§Q2).

## Q2 — Where the adapter boundary goes

Follow `src/github/` exactly, in its own directory, for one hard reason verified by reading `scripts/check-boundaries.mjs:209-212`:
```js
const HOST_PATTERN = /api\.github\.com|raw\.githubusercontent\.com/;
const HOST_DIR = 'src/github/';
```
This regex is hardcoded and does **not** match `registry.modelcontextprotocol.io`. A registry client written anywhere is **completely unpoliced** by CI's "no host sprawl" rule today. `[VERIFIED: scripts/check-boundaries.mjs:209-212]` Two consequences, both required, neither optional:
1. Put the new client in its own directory (`src/registry/`), mirroring `src/github/`'s "grep for the host, get exactly the files that touch it" property.
2. Extend `HOST_PATTERN`/`HOST_DIR` in `check-boundaries.mjs` to a registered pair (e.g. `{pattern: /registry\.modelcontextprotocol\.io/, dir: 'src/registry/'}`), or the new host goes unaudited by the one CI check that exists specifically to prevent this. This is a required companion task, not a nice-to-have — flag it explicitly in the plan.

**What the adapter returns.** A normalized internal type, never the raw registry JSON threaded further into the pipeline — mirroring `src/github/repo.ts:5-40`'s pattern exactly (one function, explicit status-code branch, `JSON.parse` inside a capped reader, then field-by-field `String()`/`Boolean()`/coercion with a comment justifying every null-vs-empty quirk). Concretely:
```ts
// src/registry/types.ts
export type RegistrySeed = {
  registryName: string;        // "ac.tandem/docs-mcp" — the registry's own namespaced id
  githubFullName: string | null; // lowercased owner/repo, or null if repository.source !== 'github'
  version: string;
  updatedAt: Date;
};
```
**What it validates — zod, matching this project's existing discipline** (`src/env.ts`'s own pattern, and `detect/json.ts`'s size-capped-then-parsed convention). Given today's live finding that 2.8% of rows carry an empty `repository: {}` object and the registry has no server-side sanitization of publisher text (the control-character page), the schema must be defensive, not optimistic:
```ts
const registryRow = z.object({
  server: z.object({
    name: z.string().min(1),
    version: z.string().min(1),
    repository: z.object({
      url: z.string().url().optional(),
      source: z.enum(['github', 'gitlab']).optional(),
    }).partial().optional(), // partial() because {} is a real, observed shape
  }),
  _meta: z.object({
    'io.modelcontextprotocol.registry/official': z.object({
      updatedAt: z.string(),
      isLatest: z.boolean().optional(),
    }).partial(),
  }).partial().optional(),
});
```
**What it does when a row is malformed or the shape shifts.** Same posture as `detect/*.ts`'s `ParseResult.status = 'partial' | 'failed'`, never an exception that aborts the sync: `safeParse` each row independently, skip rows that fail validation, count and log the skip total (mirroring the `seedsSkipped` gap Phase 4 recorded as observability debt — don't repeat it silently here), and **never throw out of the sync loop on one bad row**, exactly the "per-candidate try/catch, never per-repo" discipline `pipeline.ts` already applies to detectors.

**Byte cap.** Reuse `readCapped()`'s discipline (`src/github/client.ts:187-208`) — do not trust `Content-Length`; a hostile or misconfigured mirror of this endpoint is still an unauthenticated HTTP response AgentDock reads. The patterns doc recommends duplicating the ~15-line function rather than importing across the `src/github/` boundary (consistent with this codebase's stated aversion to premature shared abstractions, e.g. `packages.ts:98`'s own `ponytail:` comment) — agreed, duplicate it.

## Q3 — `repo_seed` is written and never read. What is the minimum consumer?

**Columns that exist today**, read from `src/db/schema.ts` (`repoSeed`, and `drizzle/0003_flaky_selene.sql`): `id`, `full_name` (unique, lowercased), `source_kind` (text, comment-documented as `github | url | git-subdir`), `discovered_from`, `discovered_path`, `hint` (jsonb), `created_at`, `updated_at`. **No `status`, no `enqueued_at`.** The schema's own comment states this was deliberate: *"No status column and no enqueued_at. Phase 5 (COR-03) owns fan-out and needs to decide how seed volume interacts with MAX_QUEUED before any of it exists; a nullable timestamp is a one-line additive migration when it does."* `[VERIFIED: src/db/schema.ts repoSeed table doc comment, lines documenting the deferral]`

**Three options, argued:**

1. **Nullable `enqueued_at timestamptz`.** Written once, by the fan-out script, the moment `enqueueJob(seed.fullName)` is called for that row. Candidate-selection query becomes `SELECT * FROM repo_seed WHERE enqueued_at IS NULL LIMIT N` — cheap with a partial index (`WHERE enqueued_at IS NULL`). It answers exactly one question — "has fan-out already acted on this row" — and nothing more. **This is the recommendation.**
2. **`status` enum/text-with-CHECK.** Rejected on the project's own established convention: every other constrained-but-growable column in this schema (`artifact_type.id`, `repoSeed.sourceKind`, `ingestJob.status`) is deliberately **text with a comment, never an enum or CHECK constraint**, because `scripts/check-boundaries.mjs`'s destructive-verb rule treats widening a CHECK on a populated table as a reviewable `DROP`-class change. A richer `status` also duplicates truth that already lives in `ingest_job.status` + `ingest_attempt` — and nothing currently touches `repo_seed` from `persist.ts`/`worker.ts`/`jobs.ts`, so keeping a second status column in sync would require adding a write to those paths that they don't need for their own job today. That's real coupling cost for a value derivable elsewhere.
3. **Derive-by-join, no column at all.** Genuinely viable and worth stating precisely: `repo_seed LEFT JOIN ingest_job ON ingest_job.target = repo_seed.full_name WHERE ingest_job.id IS NULL` answers "never enqueued" with zero migration and zero drift risk — the join reads ground truth every time. **The blocking cost, verified by reading the schema**: `ingest_job`'s only index on `target` is the **partial** unique index `ingest_job_active_key ... WHERE status IN ('queued','running')` (`src/db/schema.ts` `ingestJob` indexes). A join or anti-join that needs to see **terminal** jobs too (succeeded/failed — to avoid re-enqueueing a seed whose job already completed and was denylisted, or permanently failed as `invalid_input`) has **no supporting index today** and would force a sequential scan of `ingest_job` on every fan-out run once that table has tens of thousands of rows. The derive-by-join option is real but requires its own additive change (`CREATE INDEX ON ingest_job (lower(target))`, unconditional) to stay cheap — which is a smaller, less-committal change than a data column, so if the maintainer prefers zero denormalization, this is defensible and the index is the one thing to add alongside it.

**Recommendation: `enqueued_at`.** It is the literal fulfillment of the schema comment's own stated plan, it is strictly additive (no `DROP`, no CHECK), and it decouples seed-consumption bookkeeping from `ingest_job`'s retention/indexing story, which the maintainer may change independently later (e.g. archiving old attempts). For "what happened to this seed" beyond "was it turned into a job", the answer is still always a join to `ingest_job`/`ingest_attempt` on `target = full_name` — `enqueued_at` never tries to duplicate that richer state, only the one boolean the fan-out loop needs to not repeat itself.

**A real idempotency gap was found, not assumed — must be fixed regardless of which option above is chosen.** `repo_seed.fullName` is always lowercased (`schema.ts` comment: *"Lowercased owner/repo"*, and `catalog.ts`'s `seedFor()` calls `.toLowerCase()` on every emitted seed). But `ingest_job.target` is **not** lowercased anywhere in the write path: `src/app/actions.ts:28` builds `fullName = \`${normalized.owner}/${normalized.repo}\`` from `normalizeRepo()` (`src/github/client.ts:43-60`), which validates and trims but never lowercases. And `ingest_job`'s active-key uniqueness index is on the raw column: `uniqueIndex('ingest_job_active_key').on(t.target).where(...)` — **no `lower()` wrapper**, unlike `repository`'s own `uniqueIndex('repository_full_name_key').on(sql\`lower(${t.fullName})\`)`. `[VERIFIED: src/db/schema.ts ingestJob and repository index definitions]` **Consequence:** a user who submits `Anthropics/Skills` via the form and a seed-fan-out that later tries `anthropics/skills` (lowercased, from a catalog) will **not** collide on the partial unique index — two separate `ingest_job` rows, two separate attempts, racing to write the same `repository` row (harmless there, since `repository` dedups by `github_node_id`) but wasting queue depth and GitHub calls. `src/db/queries/jobs.test.ts` has no case-insensitivity test, confirming this was never exercised. **Fix required for COR-03 idempotency to actually hold**: lowercase `target` before every `enqueueJob` insert (one-line change in `jobs.ts`'s `enqueueJob`, applied uniformly so the submit form and the seed consumer agree), or change the index to `lower(target)`. This is not optional polish — without it, seed fan-out can silently double-enqueue any repository a human has also submitted by hand with different casing.

**`repo_seed` row count in the dev database, measured, not assumed:** `0`. `[VERIFIED: SELECT count(*) FROM agentdock.repo_seed, run 2026-08-11]` The single ingested repository in this dev DB (`repository` count = 1, `package` count = 18, `capability_finding` count = 20 — matching the `anthropics/skills` live-verification fixture from Phase 4) contains only `.claude-plugin/marketplace.json`... actually contains a marketplace.json per the tree scan in §Q1's corpus check, but its `plugins[]` entries evidently weren't seedable (relative sources point inside the same repo per `catalog.ts`'s own `seedFor()` exclusion) — zero rows is consistent, not a bug.

## Q4 — Fan-out budget arithmetic

**Confirmed live, 2026-08-11:** unauthenticated core = 60/hr, search = 10/min-bucket (separate resource, confirmed via `GET https://api.github.com/rate_limit` returning a distinct `search` object), GraphQL = 0 (unavailable unauthenticated). `GITHUB_TOKEN` is confirmed still absent from the shell environment (`env | grep -i github` → empty) and `src/env.ts`'s own comment states the unauthenticated posture is the deliberate baseline (*"AgentDock runs unauthenticated at 60 core requests an hour... and must degrade to that rather than depend on a token existing"*). `.env`/`.env.example` are both blocked by this environment's permission sandbox (directory-level deny) — **could not directly confirm whether a real value is set there; the process environment carries none, and the code's own default assumes none.** `[unverified: .env contents — sandboxed]`

**Two GitHub core calls per repo ingest, confirmed by reading the code, not estimating**: `src/ingest/retry.ts:5`'s own comment — *"Two GitHub requests per attempt out of sixty an hour is what bounds this."* — and `src/github/scan.ts:59-60` issues exactly `fetchRepoMetadata` + `fetchRepoTree` concurrently. Every subsequent file read is a free `raw.githubusercontent.com` fetch (reconfirmed live today, §Q1 methodology note: `core.used` unaffected by two `raw.githubusercontent.com` GETs during this session).

**Drain time for a 500-deep `MAX_QUEUED` queue:**
| Auth mode | Core budget | Repo-ingests/hr (÷2) | Time to drain 500 jobs |
|---|---|---|---|
| Unauthenticated | 60/hr | 30 | **≈16h 40m** |
| Fine-grained PAT | 5,000/hr | 2,500 | **≈12 min** |

**Per-sync / per-source caps to keep `corpus:sync` bounded and re-runnable.** Given the flat 2-call cost, the binding constraint on a single unauthenticated run is **repo count**, not artifact count. Recommend:
- A hard per-invocation cap on repos enqueued (e.g. 25, leaving headroom under the 60/hr ceiling for the app's own in-process worker and any concurrent human submission).
- `enqueueJob`'s existing `MAX_QUEUED = 500` ceiling (`src/db/queries/jobs.ts:11`) already caps total queue depth regardless of source — the fan-out script must call this exact function per row (per `05-PATTERNS.md`'s correct finding) rather than inserting into `ingest_job` directly, both for the denylist check and so a `corpus:sync` run naturally stops once the queue is full instead of piling up unreachable rows.
- Re-runnability is free: `onConflictDoUpdate` targeting the partial active-status index (`jobs.ts:51-58`) makes re-running `corpus:sync` over the same seed rows a no-op for anything already queued/running — confirmed by reading the exact conflict clause.

**Is COR-06's "≥500 parsed artifacts" reachable on an unauthenticated 60/hr budget within one session? Yes, plainly — but only if the seed order is chosen for artifact density, not repo count**, verified with real numbers from §Q5's live tree scans (not estimates):

| Repo | GitHub cost | SKILL.md-shaped paths | command paths | Notes |
|---|---|---|---|---|
| `davila7/claude-code-templates` | 2 calls | 896 | 393 | 11,499 tree entries; `CAPS.maxFiles = 400` truncates the candidate set to 400 on read (visible `tree_truncated`/`artifactsTruncated` flag, delisting correctly suppressed — verified in `src/ingest/pipeline.ts:362`) |
| `wshobson/agents` | 2 calls | 18 (skill) + ~91 plugin + ~109 command + 2 hook + 1 mcp + 1 catalog (measured in `CAPS.maxFiles`'s own doc comment, `src/github/scan.ts:14-16`) | — | Already a frozen fixture; all six detector types in one repo |
| `anthropics/claude-code` | 2 calls | 10 | 18 | Plus 12 plugin, 1 catalog, 5 hook markers |
| `upstash/context7` | 2 calls | 9 | 2 | Plus 1 plugin, 4 mcp markers |
| `anthropics/skills`, `addyosmani/agent-skills`, `JimLiu/baoyu-skills` | 6 calls total | 18 + 24 + 21 | — | Already-fixture, already-verified live |

Six repos, **12 core calls**, well inside the unauthenticated hourly ceiling, and the file-cap-truncated `davila7/claude-code-templates` alone accounts for up to 400 stored artifacts on its own. **500 is reachable in under 20 core calls (~10 minutes of wall clock, bounded further by `CAPS.wallClockMs = 120_000` per repo), not the 500-repo/16-hour worst case a naive "500 artifacts ≈ 500 repos" reading would produce.** State this plainly to correct that naive framing: the constraint is repo *diversity of artifact density*, not raw repo count.

**Sharded topic search (COR-05) cost — GitHub Search API, re-verified live and confirmed as a separate budget from core**, matching `.planning/research/ARCHITECTURE.md`'s prior finding: `curl https://api.github.com/rate_limit` returned a distinct `search: {limit: 10, remaining: 10, ...}` resource object alongside `core`, confirming the two buckets do not share quota. Per GitHub's own documented limits (`[CITED: docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api]`, unchanged since Phase 0's original research): 10 req/min unauthenticated, 30 req/min authenticated, 1,000-result hard cap per query, 100 results/page. A 10-shard-by-stars sweep at 10 pages/shard = 100 search calls, ≈10 min at the unauthenticated 10/min rate (or ≈4 min authenticated) — the same shape ARCHITECTURE.md already recorded; today's live check adds only the confirmation that the separate-bucket claim still holds.

**Budget actually spent verifying this phase's own research**: the unauthenticated core quota was **fully exhausted** during this session — `GET /rate_limit` after ~28 HEAD/metadata calls plus ~18 recursive tree fetches (verifying §Q5's seed candidates) showed `remaining: 0, used: 60`. This is itself a live demonstration of the arithmetic above: **~28-30 repository checks is the real-world ceiling of one unauthenticated hour**, matching `STATE.md`'s carried estimate exactly.

## Q5 — Operator seed list: what actually goes in it

**Verification spend**: 20 `HEAD`-equivalent metadata calls (existence) + 18 recursive tree fetches (artifact-type marker check) = **38 of the 60 unauthenticated core requests available this hour**, plus the 4 already-known fixture repos (zero additional spend — already live-verified in Phases 1-4). Two candidates 404'd and are dropped: `affaan-m/claude-code-plugins-hub`, `ericbuess/claude-code-tools`.

**One correction found live: `upstash/context7-mcp` no longer exists as that name.** `GET /repos/upstash/context7-mcp` → `301`, `Location: /repositories/955620917` → resolves to `upstash/context7` (60,575 stars). This is a live, real-world instance of exactly the rename problem `ARCHITECTURE.md` designed the `github_node_id` identity key to survive — use the corrected name below.

**The four already-frozen corpora**, re-read from `fixtures/*/tree.json` today (not re-fetched — already on disk and already exercised by CI), turn out to cover far more than "skill" alone:
| Repo | Markers found in the tree (path-only, from `fixtures/*/tree.json`) |
|---|---|
| `anthropics/skills` | 18 SKILL.md, 1 `.claude-plugin/marketplace.json` (catalog) |
| `addyosmani/agent-skills` | 24 SKILL.md, 1 `.claude-plugin/marketplace.json`, 1 `.claude-plugin/plugin.json`, 8 `commands/*.md`, `hooks/hooks.json` — **5 of 6 types**, only `mcp` missing |
| `JimLiu/baoyu-skills` | 21 SKILL.md, 1 marketplace.json |
| `wshobson/agents` | 18 SKILL.md (nested `plugins/*/skills/*/`), **91 `.claude-plugin/plugin.json`**, 3 `marketplace.json` variants, **~109 `commands/*.md`**, 2 `hooks/hooks.json`, **1 `.mcp.json`** (`plugins/runapi-mcp/.mcp.json`) — **all 6 detector types in one repository** |

Given that, the operator seed list's real job is **not** MCP coverage — COR-01's registry sync already supplies ~11,728 GitHub-backed MCP seeds for free (§Q1) — it is covering the five types the registry cannot: skill, plugin, catalog, command, hook. The list below is weighted accordingly.

| owner/repo | Verified | Why it's there / expected yield |
|---|---|---|
| `anthropics/skills` | 200, in fixtures | Canonical skill corpus, 18 SKILL.md |
| `addyosmani/agent-skills` | 200, in fixtures | 5/6 types in one repo (skill, plugin, catalog, command, hook) |
| `JimLiu/baoyu-skills` | 200, in fixtures | Non-ASCII skill names, nested metadata edge cases |
| `wshobson/agents` | 200, in fixtures | **All 6 types in one repo** — the single highest-value seed |
| `obra/superpowers` | 200 (`entries: 234`) | 14 SKILL.md, 1 plugin.json, 1 marketplace.json, 1 hook marker — independent author, not Anthropic-adjacent |
| `davila7/claude-code-templates` | 200 (`entries: 11,499`) | Largest verified repo: 896 skill-shaped, 393 command-shaped paths — single biggest COR-06 contributor; will hit `CAPS.maxFiles=400` truncation (visible, non-destructive per `pipeline.ts:362`) |
| `anthropics/claude-code` | 200 (`entries: 333`) | 10 skill, 12 plugin, 1 catalog, 18 command, 5 hook — the reference implementation's own dogfood content |
| `anthropics/claude-cookbooks` | 200 (`entries: 794`) | 4 skill, 11 command, 1 hook — secondary Anthropic source, diversifies away from `claude-code` |
| `upstash/context7` | 200 (renamed from `context7-mcp`) | 9 skill, 1 plugin, 1 catalog, 4 mcp, 2 command — third-party org, demonstrates the rename-tracking need live |
| `disler/claude-code-hooks-mastery` | 200 (`entries: 153`) | 21 command, 1 hook marker — hook-focused independent author |
| `centminmod/my-claude-code-setup` | 200 (`entries: 177`) | 7 skill, 20 command, 1 hook — independent, dense in command/hook |
| `cloudflare/mcp-server-cloudflare` | 200 | 1 mcp marker — real org-owned MCP server, path-level presence not deep-verified this session (core budget spent) |
| `github/github-mcp-server` | 200 | 1 mcp marker — official GitHub-authored MCP server |
| `modelcontextprotocol/servers` | 200 | 1 mcp marker — canonical MCP org monorepo; low marker density confirms most servers here are source code, not `.mcp.json` declarations — include for completeness, not yield |
| `qdrant/mcp-server-qdrant` | 200 (`entries: 38`) | 0 markers found — kept only as a small, fast smoke-test repo (near-zero cost, near-zero yield); **candidate for removal**, listed honestly rather than dropped silently |
| `modelcontextprotocol/inspector` | 200 (`entries: 1,266`) | 1 mcp, 1 hook marker — large repo, low artifact density; low priority |
| `anthropics/claude-agent-sdk-python` | 200 (`entries: 159`) | 1 skill, 1 plugin, 4 command, 1 hook — small but touches 4 types |
| `simonw/llm` | 200 | 0 markers — **not a Claude-ecosystem repo; drop from the seed list**, kept in this table only to show it was checked and rejected |
| `steipete/agent-rules` | 200 | 0 markers — likely predates the current directory-shape conventions; **drop** |
| `hesreallyhim/awesome-claude-code` | 200 | 0 markers, pure README link list — **not a COR-02 seed; a COR-04 curated-link-list candidate instead** (see below) |
| `punkpeye/awesome-mcp-servers` | 200 | 0 markers, pure README link list — COR-04 candidate |
| `wong2/awesome-mcp-servers` | 200 | 0 markers, pure README link list — COR-04 candidate, redundant with `punkpeye`'s; pick one |
| `affaan-m/claude-code-plugins-hub` | **404** | Dropped |
| `ericbuess/claude-code-tools` | **404** | Dropped |

**Count of usable COR-02 (direct seed) entries: 15** (dropping the two 404s, the three zero-marker repos, and treating the three awesome-lists as COR-04 material instead). This is below the 20-40 target as pure repo count, but — per §Q4's arithmetic — repo count is the wrong metric: these 15 repos alone carry well over 1,500 candidate artifact paths before any cap is applied. If a strict 20-40 *line count* is wanted for the file itself, add the three zero-marker repos back in with a documented "kept as smoke/negative-control" annotation rather than silently padding the list with unverified guesses — do not add repos this session had no budget left to verify.

**File format: recommend `config/seeds.json`, not a `.txt` list.** COR-02 wants bulk population (either format satisfies that), but the phase brief's own §4 (referencing the wider PROJECT.md provenance requirements — every package traces to its exact source) wants a source label per repository, which a bare `.txt` cannot carry without inventing a second file. `repo_seed.sourceKind`/`discoveredFrom` already model provenance for catalog-discovered seeds (`origin: 'mcp_registry' | 'marketplace' | 'awesome' | 'search' | 'manual'` was `ARCHITECTURE.md`'s original proposal; the shipped column is `source_kind`, text, not yet carrying an `'operator'` value). A JSON seed file lets each entry declare `{"fullName": "wshobson/agents", "note": "all six artifact types in one repo"}` and the loader writes `discoveredFrom: 'operator-seed-list'` uniformly — one honest provenance tag, matching the existing `repo_seed.discoveredFrom` column exactly rather than inventing a parallel concept. `.txt` would need a comment-parsing convention this project has nowhere else.

## Q6 — DAT-07: fork and duplicate suppression at READ time

**Does `repository` already store `is_fork`? Yes — and it is fetched, stored, and simply never read by any query.** `[VERIFIED: src/db/schema.ts:87 \`isFork: boolean('is_fork').notNull().default(false)\`]`, populated at `src/github/repo.ts:35 isFork: Boolean(json.fork)` from the same `GET /repos/{owner}/{repo}` call every ingest already makes — **zero new GitHub calls needed.** This is the third instance of this project's own recurring pattern (Phase 3's `mode`, Phase 4's tree entries) where a field GitHub already returns sits unused. `src/db/queries/packages.ts`'s `listPackages()` already `.innerJoin(repository, ...)` (line 53), so `repository.isFork` is already in scope at the exact query that needs it.

**What is NOT stored, verified by the same read**: `fork_parent_node_id`. `ARCHITECTURE.md`'s original schema proposed it; `types.ts`'s shipped `RepoMetadata` type has no `parent` field and `repo.ts` never reads `json.parent`. GitHub's REST response for a fork **does** include a `parent` object in the same response already fetched (no extra call), so adding it is free in the same sense `isFork` was, but it is not required for DAT-07's stated bar ("forks are stored distinctly") — `is_fork` alone already satisfies that; `fork_parent_node_id` would only be needed for a "grouped under its canonical upstream" UI, which is out of scope for this phase's read-time suppression.

**Cheapest read-time suppression: a `WHERE` clause, confirmed as the only change needed — but NOT inside `listPackages` unconditionally.** This research independently confirms `05-PATTERNS.md`'s finding by reading `src/db/queries/packages.ts` directly: `getRepositoryPackages` (the **detail** page's data source, line 160) calls `listPackages({fullName, limit: 250})` — the exact same function `page.tsx`'s home listing calls. If a fork/gate predicate is added unconditionally to `listPackages`'s `where(and(...))`, it silently also removes gated packages from their own detail page — which directly violates COR-07's explicit requirement that gated packages stay "reachable by direct link." **Recommendation, matching the existing optional-parameter convention already used for `fullName`**: add `includeGated?: boolean` (default `false`) to `listPackages`, threaded into the `and(...)`, with `getRepositoryPackages` passing `true`. This is the smallest correct change — no new function, no new query, no `listPackagesForListing()` wrapper — and it cannot alter a stored row, satisfying DAT-07's "can never corrupt stored data" clause by construction (it is a `SELECT`-only predicate).

**Content-hash dedup: can two different repositories holding a byte-identical `SKILL.md` be collapsed at read time?** Yes — `package_version.contentHash` already exists (`schema.ts`, `unique('package_version_content_key').on(t.packageId, t.contentHash)`), computed as sha256 of normalized frontmatter+body per the constraint's own scope: **within one package's version history**, not across packages/repositories. Collapsing across repositories requires a **new** read-time query — `GROUP BY content_hash` (or a correlated subquery) over `package_version` joined to `package`/`repository`, picking one canonical row per hash. **Correct canonical choice**: highest `repository.stars`, tie-broken by earliest `repository.createdAt` if that column existed (it doesn't currently — only `package`/`repository` `created_at` from AgentDock's own ingest time, which is a weaker signal since ingest order isn't upstream creation order). Recommend stars-only for this phase, documented as a known limitation. **What breaks**: (1) the correlated subquery is now a real per-listing-query cost at scale — not before it hurts (per `ARCHITECTURE.md`'s own "materialized view when it hurts" guidance) but worth flagging now; (2) `content_hash` is scoped to one artifact's frontmatter+body — two artifacts that are functionally identical but differ in a trailing comment or whitespace normalization edge case will **not** collapse, which is honest (exact-match only) rather than a false claim of near-duplicate detection; (3) DAT-07 requires stored data untouched — a `GROUP BY`/window-function read-time collapse satisfies that by construction, same as the fork filter.

## Q7 — COR-07 visibility floor

**What AgentDock already has, without any new fetch**: `repository.stars` (int), `repository.pushedAt` (upstream last-changed), `repository.isArchived`, `package_version.parseStatus` (`ok`/`partial`/`failed`), and a derivable **live artifact count per repository** (`touchRepository`'s own `live.n` query pattern, `persist.ts:431-434`, already computed on every re-ingest — the same `count(*) WHERE repository_id = $1 AND delisted_at IS NULL` shape).

**Simplest defensible rule**: a repository clears the floor when it has **at least one non-delisted package whose latest `package_version.parseStatus = 'ok'`** — i.e., something actually parsed cleanly exists, not merely "a repo was submitted." This is strictly a parse-outcome fact (verb of observation, matching CAP-12's vocabulary discipline that already governs this codebase's UI copy), not a quality/trust judgment — it answers "is there anything here to show," not "is this good." Optionally combine with a trivial staleness guard already available for free (`pushedAt` older than some window is *not* recommended as a floor input — that conflates freshness with visibility and both DAT-07 and PRV-02 already keep those concepts separate elsewhere in this project).

**Explicitly reject stars/age as floor inputs.** Both were considered and dropped: a stars-based floor directly risks becoming a de facto popularity-as-trust signal, which is exactly what `PROJECT.md`'s "Capability disclosure, never a risk score" constraint and CAP-10's word-ban exist to prevent for *artifact* pages — the same reasoning extends to *listing inclusion*, since excluding a package from search because it has few stars **is** a trust judgment wearing a different hat. Age-since-submission similarly punishes a legitimate but recently-submitted repository for no fact about the artifact itself.

**Cost in false exclusions**: the parse-status floor excludes (a) repositories where every candidate artifact failed to parse — correctly, since there is genuinely nothing to show — and (b) nothing else, because it does not touch content quality, popularity, or freshness. This is the narrowest floor that still satisfies "excluded from listings... until it clears a visibility floor" as a real gate rather than a no-op (a floor of "submitted" alone would never exclude anything, which fails COR-07 by construction).

**UI phrasing matters — write it now so it isn't improvised later**: never "verified," "trusted," or "approved" (all CAP-10-banned words). Use observation-only phrasing consistent with the rest of this codebase's disclosure vocabulary, e.g. *"AgentDock found no parseable artifacts in this repository yet"* for a below-floor repo's direct-link page, and simply omit below-floor repos from listing/search rather than showing a placeholder card. This is a listing-noise control, not a trust score, and the copy must not accidentally imply the opposite.

## Q8 — Detector precision on an expanded corpus

**Where the measurement runs today: exclusively against the four frozen fixture corpora, never live data, verified by reading both the tool and its CI enforcement.** `scripts/capability-precision.mjs`'s own header states it plainly (*"No network, no token, no database: the corpora are on disk"*), and `src/analyze/precision.test.ts` — the file CI actually runs — re-executes every re-runnable analyzer against `fixtures/{addyosmani-agent-skills,anthropics-skills,baoyu-skills,wshobson-agents}/files/*` and asserts the live hit count matches the recorded number in `fixtures/capability-precision.md`, plus enforces the 20%-kill-line invariant mechanically. `[VERIFIED: src/analyze/precision.test.ts:81-135, scripts/capability-precision.mjs:1-16]`

**If the measurement must move to an expanded corpus — it should not become live-network-dependent in CI.** The correct mechanism already exists and needs no new tooling: `scripts/capture-fixtures.mjs` is the manual, pinned-commit-SHA freezing tool that produced the four existing corpora (`PINS` array names each `owner/repo` + exact commit SHA). Extending precision measurement to Phase 5's larger seed corpus means: (1) manually run `bun scripts/capture-fixtures.mjs <new-slug>` against a handful of the §Q5 seed repos, pinned to a specific SHA; (2) commit the resulting frozen `fixtures/<slug>/{repo.json,tree.json,files/}`; (3) add the new slug to `capability-precision.mjs`'s and `precision.test.ts`'s `CORPORA` arrays; (4) re-run `bun run precision`, hand-check the new hits per the same 20-sample procedure, update `fixtures/capability-precision.md`. **CI stays exactly as deterministic as it is today** — this is a manual, one-time, developer-driven corpus-growth step, not a live-fetch code path added anywhere near `bun run ci`.

**The `npx` labelling question — a product taxonomy decision, laid out with computed consequences, not resolved here.** Current recorded state (`fixtures/capability-precision.md`, re-read verbatim): `install` detector, 78 total hits across the 4 corpora, 20 hand-checked, 2 false positives, **10%**, of which 13 of the 20 checked hits are `npx <tool>` invocations counted positive under an "npx fetches from the registry before executing" reading.

| Option | Numerator (FP) | Denominator (hand-checked sample) | Resulting rate |
|---|---|---|---|
| Current: count `npx` as install-disclosure (shipped) | 2 | 20 | **10%** |
| Exclude `npx` hits entirely from the `install` category (reclassify as a separate signal or drop) | 2 | 20 − 13 = 7 | **28.6%** — crosses the 20% kill line |
| Count `npx <tool>` as a false positive outright (reject the "fetches before executing" reading) | 2 + 13 = 15 | 20 | **75%** — the exact number `capability-precision.md` itself already names as the consequence of rejecting the reading |

**Recommendation, marked clearly as a maintainer decision, not a research finding**: keep the current reading (10%, shipped) for this phase — changing it requires a new 20-hit hand-check on whichever reclassification is chosen, and the existing reading is both defensible and already the one CAP-13's kill-switch test enforces. If the maintainer wants `npx` split into its own signal (e.g. `tool_invocation` vs `package_install`), that is a Phase-5-scale product decision that should go through `/gsd-discuss-phase`, not be silently changed in a research pass — flagging it here is the deliverable, not resolving it.

**Recall — the smallest measurable proxy, given the project explicitly forbids building a benchmark framework** (per `PITFALLS.md`'s Pitfall 6 framing and this project's own "no dynamic analysis, ever" constraint): hand-pick 20 known-positive lines across the expanded corpus per detector category (e.g. 20 lines that a human reading the raw file confirms genuinely declare `allowed-tools`, genuinely pipe curl to sh, etc.), run each shipped detector over the same files, and record how many of the 20 it actually flags. Cost: roughly the same effort already spent producing `capability-precision.md`'s precision rows — one afternoon per detector category, no new code, no new fixture format, reusing `scripts/capability-precision.mjs`'s existing print-the-sample mechanism in reverse (grep the corpus for the pattern manually first, then check the detector's output against that hand-picked set rather than against the detector's own hits). This measures recall on a hand-selected slice, not true recall against an unknown ground truth — state that limitation in whatever file records the result, the same honesty `declaredCapabilities`'s "0% — absence of data, not a clean pass" row already models.

## Q9 — Scheduler

**Argue for no cron/interval worker. An explicit `bun run corpus:sync` script suffices, matching this codebase's own conventions exactly.** Reasons, all grounded in files actually read:
- `PROJECT.md`'s own constraints: *"WSL local development only... no production deploy in this milestone"* and *"One part-time maintainer — anything requiring ongoing manual curation at scale will not survive."* A scheduler is infrastructure a manual invocation avoids needing.
- `ingest_job` has **no `kind` column** — confirmed by reading the schema comment directly (*"No kind column and no priority column. Phase 5's registry-sync jobs are a different shape and a five-line migration away; guessing at their key now costs the same migration and would be wrong."*) — meaning registry-sync and topic-search jobs are **not** modeled as `ingest_job` rows today, and building a scheduler around a job-kind distinction the schema explicitly deferred would require exactly the migration the comment predicts, for no proven need yet.
- The existing worker (`src/ingest/worker.ts`, gated by `INGEST_WORKER`) already handles the one thing that genuinely needs to be always-on: draining `ingest_job`. Corpus *acquisition* (finding new seeds) is a fundamentally different cadence — bursty, operator-triggered, bounded by the same 60/hr wall §Q4 computed — not a continuous loop.
- `package.json`'s existing script conventions (`precision`, `analyze:backfill`, `db:seed`, all `bun scripts/<name>.mjs`) are the established shape for exactly this kind of manual, developer-invoked batch operation. A new `"corpus:sync": "bun scripts/corpus-sync.mjs"` entry matches every existing pattern: `.mjs`, Bun-executed, relative `../src/...ts` imports (not `@/` aliases — confirmed those only resolve under Next's bundler/vitest, not raw Bun script execution, per `05-PATTERNS.md`'s correct reading of `analyze-backfill.mjs`'s import style), shared `src/db/client.ts` handle with `sql.end()` on every exit path, manual `process.argv` parsing, plain `console.log` summary line, non-zero exit on failure (mirroring `seed-fixture.mjs:41`'s convention since a registry-sync script can genuinely fail on network/parse errors, unlike `analyze-backfill.mjs` which cannot).

If genuine automation is wanted later, the smallest addition is an OS-level `crontab` entry invoking the same script — not an in-app scheduler, not a new `ingest_job.kind`. That is explicitly a v2/later decision, matching this project's `V2-FRS-01` ("Scheduled re-ingestion") already tracked as deliberately out of v1 scope.

## Q10 — Cold-start verification

**The safe, concrete procedure, built entirely from mechanisms already in the codebase**, verified by reading `scripts/dev-reset.mjs`, `scripts/sql/dev-reset.sql`, and the existing `agentdock_test`-schema test convention (`src/db/queries/jobs.test.ts` and five other `*.test.ts` files all set `process.env.DATABASE_SCHEMA = 'agentdock_test'` before any schema import):

1. **Never touch `agentdock` (the dev schema) for this verification.** Run the whole cold-start proof against `agentdock_test`, which already exists as a sibling schema created in Phase 0's one-time superuser bootstrap (`agentdock_app` owns both `agentdock` and `agentdock_test`, confirmed live in `STATE.md`'s isolation verification).
2. **Empty it safely**: `DATABASE_SCHEMA=agentdock_test bun run db:test:setup` (regenerates DDL from `schema.ts` into a fresh `agentdock_test`, per `db:test:generate` + `db:test:migrate`'s existing script pair) — this is the "empty DB" starting state, achieved without ever running `dev-reset.mjs` against the real `agentdock` schema. `dev-reset.sql`'s own safety rails (asserted `current_database() = 'mcpdb'`, an explicit session flag, hardcoded schema literal with no parameter — `scripts/sql/dev-reset.sql:18-24`) mean even a mistaken invocation against the wrong schema name fails loudly rather than silently, but the test schema avoids the question entirely by never touching the schema that holds real ingested data.
3. **Run `corpus:sync` (§Q9) against `DATABASE_SCHEMA=agentdock_test`**: registry sync + a small slice of §Q5's seed list (2-3 repos, not the full list, to keep the proof fast and cheap on GitHub quota) + the seed-consumer fan-out.
4. **Drain the queue**: run the worker loop briefly against the test schema (`DATABASE_SCHEMA=agentdock_test INGEST_WORKER=1`, or a bounded one-shot claim loop) until `ingest_job` reaches a terminal state for the seeded batch.
5. **Assert the outcome**: query `agentdock_test.package` for `count(*) WHERE delisted_at IS NULL >= N` (N scaled to whatever the sampled seed slice should yield, computed from §Q4/§Q5's per-repo numbers, not the full 500 — this is a fast CI-adjacent proof, not the real cold-start run), and that `listPackages()`/`countPackages()` against the test schema return non-empty, non-error results — i.e. "usable catalog" is defined as the same query the real home page runs, executed against the test schema.
6. **Clean up**: `DATABASE_SCHEMA=agentdock_test bun run db:reset --confirm` afterward, or simply leave it — `agentdock_test` is explicitly disposable, unlike `agentdock`.

This touches nothing outside `agentdock`/`agentdock_test`, reuses `dev-reset.mjs`'s existing guard rails rather than writing new ones, and gives a repeatable, cheap (small seed slice) proof of the full "empty → seed → usable" path without spending real ingest quota against production data or risking the dev schema.

## Package Legitimacy Audit

No new external packages are required for this phase. Registry sync uses native `fetch` (already the pattern in `src/github/client.ts`); validation uses `zod` (already a dependency, `package.json`); persistence uses `drizzle-orm`/`postgres` (already dependencies). If a link-extraction regex for COR-04's awesome-list tier is needed, it is pure regex over `raw.githubusercontent.com`-fetched Markdown text — no Markdown-parsing library required beyond what `react-markdown`/`remark-gfm` already provide for rendering (not needed here at all, since extraction is regex-over-raw-text, not rendering).

| Package | Registry | Verdict | Disposition |
|---|---|---|---|
| *(none)* | — | — | No new packages this phase |

## Common Pitfalls

Two pitfalls from `.planning/research/PITFALLS.md` apply directly and were re-verified as still current, not re-derived:

**Pitfall 10 (Cold start)** — `PITFALLS.md`'s prescription ("batch-import 500-2,000 artifacts before showing anyone... inventory is not the constraint") is confirmed correct and, per §Q4's live arithmetic, achievable in a single unauthenticated hour with the right seed ordering — the pitfall's own warning sign ("fewer than 100 packages in the index a month in") is avoidable by front-loading `davila7/claude-code-templates` and `wshobson/agents` first in any seed run.

**Pitfall 11 (Fork/duplicate flooding)** — `PITFALLS.md`'s recommended mitigations ("skip forks by default... content-hash dedup... one column and one unique index") map exactly onto what §Q6 found already exists (`is_fork`, `content_hash`) and what remains to build (the read-time `WHERE`/`GROUP BY`, not a stored-data change). The pitfall's warning sign — "no `content_hash` column" — does **not** apply here; the column exists and is unused for cross-repository dedup, which is the gap this phase closes.

A third, project-specific pitfall surfaced by this research and not in the original `PITFALLS.md` pass: **the `ingest_job.target` case-sensitivity gap (§Q3)** is a concrete, verified instance of the general "idempotency constraint assumed sufficient but not actually verified" failure mode this project has hit before (Phase 2's ETag/304 assumption, Phase 3's "parse() already isolated" assumption). Treat it the same way those were treated: fix it in the same plan that ships the seed consumer, with a regression test proving `enqueueJob('Owner/Repo')` and `enqueueJob('owner/repo')` collide.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|---|---|---|---|---|
| `registry.modelcontextprotocol.io` | COR-01 | ✓ (live, verified 2026-08-11) | API freeze v0.1 (per registry's own README) | — |
| `api.github.com` (unauthenticated) | COR-02/03/04/05 | ✓ (verified, 60/hr core confirmed live) | REST | Fine-grained PAT raises to 5,000/hr — not currently configured (process env has no `GITHUB_TOKEN`; `.env` unverifiable, sandboxed) |
| `GITHUB_TOKEN` | Higher-throughput seed fan-out | ✗ (unverified in `.env`, absent from process env) | — | Unauthenticated 60/hr is the documented, code-supported default (`src/env.ts`); phase is designed to work without it per §Q4 |
| PostgreSQL `agentdock_test` schema | Q10 cold-start verification | ✓ (exists, Phase 0 bootstrap) | PG 16 | — |

**Missing dependencies with no fallback:** none — the phase is explicitly designed to complete on the unauthenticated baseline.

**Missing dependencies with fallback:** `GITHUB_TOKEN` absence is fully covered by existing code (§Q4's arithmetic assumes unauthenticated as the baseline case, not the degraded case).

## Validation Architecture

### Test Framework
| Property | Value |
|---|---|
| Framework | Vitest 4.1.10 (`vitest.config.ts`) |
| Config file | `vitest.config.ts` |
| Quick run command | `bun run test` (NOT `bun test` — Bun's own runner hangs on vitest files, documented pitfall carried from Phase 0) |
| Full suite command | `bun run ci` (`check:boundaries && lint && typecheck && test`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|---|---|---|---|---|
| COR-01 | Registry client parses normal/empty/malformed/HTTP-error responses, never touches `api.github.com` | unit, fixture-backed (mirroring `src/github/scan.test.ts`'s host-capture pattern) | `bun run test src/registry/client.test.ts` | ❌ Wave 0 |
| COR-02 | Seed list entries produce `repo_seed` rows with correct provenance | integration, `agentdock_test`-backed | `bun run test src/registry/seedList.test.ts` | ❌ Wave 0 |
| COR-03 | `enqueueJob` case-insensitivity fix; seed fan-out respects `MAX_QUEUED` and denylist | unit + DB-backed | `bun run test src/db/queries/jobs.test.ts` (extend existing file) | ✅ existing file, ❌ new cases |
| COR-05 | Shard-boundary generation is a pure function producing disjoint star-range queries | unit, no network | `bun run test src/github/search.test.ts` | ❌ Wave 0 |
| COR-06 | Cold-start procedure produces a non-empty, queryable catalog | manual/scripted smoke (§Q10) — not CI-automatable against live GitHub | `DATABASE_SCHEMA=agentdock_test bun scripts/corpus-sync.mjs && ...` | ❌ Wave 0 (script) |
| COR-07 | `listPackages(includeGated=false)` excludes below-floor packages; `getRepositoryPackages` still returns them | unit, DB-backed | `bun run test src/db/queries/packages.test.ts` | ❌ Wave 0 (no existing `packages.test.ts`) |
| DAT-07 | Fork suppression is read-time only; stored row proven unchanged | unit, DB-backed | `bun run test src/db/queries/packages.test.ts` | ❌ Wave 0 (same file as above) |

### Sampling Rate
- **Per task commit:** `bun run test <changed file>.test.ts`
- **Per wave merge:** `bun run ci`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `src/registry/client.test.ts` — covers COR-01, mirrors `src/github/scan.test.ts`'s stub-`fetch`/host-capture shape
- [ ] `src/registry/sync.test.ts` — covers registry→`repo_seed` write path
- [ ] `src/db/queries/packages.test.ts` — does not exist today; needed for COR-07/DAT-07's read-time filter proofs
- [ ] `src/github/search.test.ts` — covers COR-05's pure shard-generation logic
- [ ] Extend `src/db/queries/jobs.test.ts` with a case-insensitive `enqueueJob` collision test (§Q3 gap)
- [ ] `scripts/corpus-sync.mjs` — no test framework needed (CLI script, matches `analyze-backfill.mjs`'s untested-by-design convention), but Q10's manual procedure should be written down as a `README`/`CONTEXT.md` runbook, not left implicit

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---|---|---|
| V5 Input Validation | yes | zod schema on every registry response row (§Q2), reused caps discipline from `detect/json.ts` |
| V12/SSRF-adjacent (no single ASVS number covers this project's own SSRF discipline, which exceeds baseline ASVS) | yes | New host (`registry.modelcontextprotocol.io`) must go through the exact same hardcoded-allowlist + manual-redirect pattern as `src/github/client.ts` — no exceptions for a "friendlier" host |
| V6 Cryptography | no | No new crypto surface this phase |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---|---|---|
| Malformed/hostile registry JSON (confirmed live today: an unescaped control character in a publisher-supplied description broke strict JSON parsing) | Tampering | zod `safeParse` per row, skip-and-count on failure, never throw out of the sync loop (§Q2) |
| New host added outside `check-boundaries.mjs`'s policed set | Elevation of Privilege (unaudited egress) | Extend `HOST_PATTERN`/`HOST_DIR` in the same CI check (§Q2) — required, not optional |
| Case-insensitive job collision allowing duplicate GitHub calls for the same repo | Denial of Service (quota exhaustion via redundant work) | Lowercase `ingest_job.target` uniformly at write time (§Q3) |
| Awesome-list link extraction (COR-04) over untrusted README text | Tampering (ReDoS) | Bounded, anchored regex matching the existing detector discipline (`ANALYZE_CAPS.maxLineChars`-style caps); extract-and-record only, never fetch the extracted URL (per `ING-11`'s existing constraint, unchanged) |
| Visibility-floor rule drifting into a trust/popularity signal | (product-integrity risk, not STRIDE) | Parse-status-only floor (§Q7), explicit rejection of stars/age as inputs, CAP-10 vocabulary discipline applied to floor copy |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|---|---|---|
| A1 | `.env`'s actual `GITHUB_TOKEN` value could not be read (sandboxed); process env and code defaults both indicate unauthenticated is the operative mode | §Q4 | If a token is actually configured, §Q4's arithmetic is pessimistic (favorably) — no risk to the plan, only to the precision of the stated numbers |
| A2 | `cloudflare/mcp-server-cloudflare`, `github/github-mcp-server`, `modelcontextprotocol/servers`, `modelcontextprotocol/inspector`'s single "mcp" marker each was confirmed by path-pattern match on the tree, not by fetching and parsing the actual file content (core budget was exhausted before deeper verification) | §Q5 | The matched path could be a false positive (e.g. a `server.json` inside `node_modules` or an unrelated build artifact) — verify with one raw fetch (free, no core cost) before relying on these four for artifact-yield planning |
| A3 | `davila7/claude-code-templates`'s 896/393 marker counts are raw path-suffix matches (`endsWith('SKILL.md')`, `/commands/.*\.md`), not a run of the actual `skill`/`command` detectors — the real detectors may exclude some of these paths (e.g. nested exclusions the `plugin` detector's containment pass applies) | §Q4, §Q5 | The real yield from this repo could be lower than 896+393; still very likely to exceed the 400-file cap regardless, so the COR-06 conclusion is robust to this uncertainty |
| A4 | `enqueued_at` is recommended over derive-by-join primarily on coupling-cost grounds; both are defensible and the maintainer may reasonably prefer zero migration | §Q3 | If derive-by-join is chosen instead, the missing `ingest_job(lower(target))` general index (not just the partial active-status one) must be added or the anti-join degrades to a sequential scan at scale |

## Sources

### Primary (HIGH confidence — live verification, 2026-08-11)
- `registry.modelcontextprotocol.io/v0/servers` — full pagination to exhaustion (211 requests), field-presence sampling (3,000 rows), `updated_since`/`search`/`version` parameter behavior
- `github.com/modelcontextprotocol/registry` (raw `README.md`, `main` branch) — API freeze vs. preview status
- `api.github.com` — `rate_limit` (unauthenticated core/search/graphql buckets), 40 repository existence/tree checks for §Q5's seed list, `upstash/context7-mcp` → `upstash/context7` rename discovery
- This repository's own source, read directly: `src/db/schema.ts`, `src/db/queries/{packages,jobs}.ts`, `src/ingest/{persist,pipeline,retry,worker}.ts`, `src/github/{client,repo,types,scan}.ts`, `src/detect/{catalog,types}.ts`, `src/analyze/types.ts`, `src/env.ts`, `src/log.ts`, `scripts/{check-boundaries,dev-reset,migrate,capability-precision,capture-fixtures}.mjs`, `scripts/sql/dev-reset.sql`, `src/analyze/precision.test.ts`, `fixtures/capability-precision.md`, `fixtures/*/tree.json`, `drizzle/000{3,4,5}_*.sql`, `package.json`
- Live database query against the dev `agentdock` schema (row counts for `repository`, `package`, `package_version`, `ingest_job`, `repo_seed`, `capability_finding`)

### Secondary (MEDIUM confidence)
- `05-PATTERNS.md` (companion agent's pattern-mapping pass, same session) — cross-checked independently rather than trusted wholesale; the `listPackages`/`getRepositoryPackages` sharing finding and the `check-boundaries.mjs` host-rule gap were both independently re-verified by reading the cited files directly

### Tertiary (LOW confidence)
- `.env`/`.env.example` contents — blocked by this environment's directory-level permission sandbox; reported as unverified per the task's explicit instruction, not worked around

## Metadata

**Confidence breakdown:**
- MCP Registry contract (Q1): HIGH — every number is a live call made today, not a recall of yesterday's research
- `repo_seed` consumer design (Q3): HIGH for the schema facts and the case-sensitivity bug (both read from source); MEDIUM for the `enqueued_at` vs. derive-by-join recommendation (a genuine judgment call, argued both ways)
- Fan-out budget arithmetic (Q4): HIGH — grounded in a live rate-limit exhaustion event during this same research session
- Seed list (Q5): HIGH for existence and marker-pattern presence (live-verified); MEDIUM for exact artifact yield per repo (marker counts are path-pattern approximations of what the real detectors would find, not detector re-runs — see A2/A3)
- Fork/dedup/floor design (Q6/Q7): HIGH for what exists in the schema; MEDIUM for the specific floor rule (a product decision this research recommends but does not lock)
- Detector precision on expanded corpus (Q8): HIGH for the current-state facts (all read from source); the `npx` taxonomy question is explicitly left as a maintainer decision, not resolved

**Research date:** 2026-08-11
**Valid until:** ~7 days for the GitHub rate-limit/registry-content numbers (fast-moving, third-party-controlled); ~30 days for the codebase-internal facts (schema, query functions) unless Phase 5 planning itself changes them first
