# Phase AGD-01: Walking Skeleton — Research

**Researched:** 2026-08-10
**Domain:** GitHub ingestion (unauthenticated) → Agent Skills parsing → PostgreSQL persistence → sanitized server-rendered pages (Next.js 16)
**Confidence:** HIGH on the spec, the GitHub call sequence, the sanitizer schema, and the Drizzle API (all verified live this session). MEDIUM on Next 16 caching/CSP composition (verified against 16.3.0 docs, not exercised in this repo yet).

---

## Summary

Four findings change how this phase should be planned, and none of them are recoverable cheaply later.

**One.** `GET /repos/{o}/{r}/git/trees/{branch}?recursive=1` returns `sha` equal to the **commit SHA**, not the tree SHA — verified on two repos. That collapses the whole ingest to **two unauthenticated core calls** (repo metadata + tree), because the pinned commit SHA needed for every PRV-01 permalink falls out of the tree call for free. It also matters that it is the *commit* SHA: `github.com/o/r/blob/<tree-sha>/path` returns **404**, while `<commit-sha>` returns 200. Get the wrong one and every permalink on every detail page is broken.

**Two.** The Agent Skills spec is small and precise, and real repositories — including Anthropic's own — violate it. Across **100 real `SKILL.md` files sampled from 4 repos this session**: `name` and `description` appear 100%, `version` (not in the spec) appears 24%, `metadata` 20%, `license` 15%, and **`allowed-tools` and `compatibility` appear zero times**. Anthropic's `skills/claude-api/SKILL.md` has a 1,077-character description against a documented 1,024 cap; `template/SKILL.md` declares `name: template-skill` in a directory named `template`, violating the spec's must-match-parent-directory rule. `metadata` is spec'd as a string→string map but real files nest maps and arrays inside it. **A strict Zod schema rejects a meaningful fraction of the real corpus.** The parser must validate-and-record, never validate-and-reject.

**Three.** The YAML resource-exhaustion risk is in the wrong place. `js-yaml` parses a 205 MB alias bomb in **2 ms** — aliases are shared references, so the parser never expands them. `JSON.stringify()` on that result produces a **205,817,161-character string**. The DoS lands on the write to the `jsonb` column, not on `yaml.load()`. The cap must be applied to the *serialized* frontmatter after parsing, which is not where a size cap would naturally be written.

**Four.** Next.js 16's no-nonce CSP recipe requires `script-src 'unsafe-inline'`, which PITFALLS.md forbids by name. The resolution is not a compromise: every page in this phase reads the database and is therefore dynamic already, so the nonce-based `src/proxy.ts` approach costs nothing that has not already been spent. Note the filename — Next 16 renamed `middleware` to `proxy` (`PROXY_LOCATION_REGEXP = (?:src/)?proxy`, read from the installed 16.3.0).

**Primary recommendation:** Two GitHub calls per repo (`/repos/{o}/{r}` then `/git/trees/{HEAD}?recursive=1`), take the commit SHA from the tree response, read every `SKILL.md` free from `raw.githubusercontent.com` pinned to that SHA, parse with `js-yaml@4.3.1` under `CORE_SCHEMA`, persist tolerantly with `parse_status`, and render with `react-markdown` + `remark-gfm` + `rehype-sanitize` (no `rehype-raw`, ever) behind a nonce CSP served from `src/proxy.ts`.

---

## Locked Decisions (from the orchestrator brief)

No `CONTEXT.md` exists for this phase; the brief carries the locked decisions. Copied verbatim — the planner must honour these and must not research alternatives.

### Stack and database — locked
- TypeScript 5.9.3, Next.js 16 App Router, React 19, Node runtime, Bun as installer/script-runner, Drizzle ORM (`generate` → review → `migrate` via `scripts/migrate.mjs`), Biome, Vitest.
- Existing PostgreSQL 16, non-superuser role `agentdock_app`, schemas `agentdock` (dev) and `agentdock_test`. Every table must use `pgSchema('agentdock')`. `drizzle-kit push`/`pull` are banned. `pg_trgm` is NOT installed and must not be installed in this phase.
- Existing tables: `agentdock.__drizzle_migrations`, `agentdock.schema_meta`.

### Acquisition — locked
- Submit-by-`owner/repo` only. No crawler, no code search, no MCP registry sync in this phase.
- **`GITHUB_TOKEN` is currently EMPTY in this environment.** Phase 1 must work unauthenticated and degrade gracefully.

### Security policy — locked
- Never execute anything from a scanned repo; never write repo content to disk; accept `owner/repo` only (never fetch an arbitrary URL); no risk score or safety badge anywhere.

### Out of scope for this phase
Async job queue, ETag conditional refresh loop, rate-limit backoff scheduler, plugin/MCP/command/hook detectors, capability disclosure, full-text search, trigram fallback, fork dedup, MCP registry sync. All are later phases; `ROADMAP.md` assigns each one.

---

## Phase Requirements

| ID | Description | Research support |
|----|-------------|------------------|
| FND-06 | Validated env vars, fail fast | Already implemented in `src/env.ts`; add optional `GITHUB_TOKEN` — see [Environment Availability](#environment-availability) |
| FND-08 | No credential in git/logs/errors | `src/env.ts` sentinel test already enforces; extend to the GitHub client's error serializer |
| FND-09 | `bun install` + one command | Existing `bun run dev`; unchanged |
| ING-01 | Submit repo → discover artifacts | [GitHub call sequence](#the-exact-call-sequence-2-core-calls-verified) |
| ING-02 | `owner/repo` only, hardcoded host allowlist | [Input validation](#pitfall-4-a-permissive-ownerrepo-regex-reopens-ssrf) |
| ING-03 | Redirects not followed off-allowlist | [Redirect handling](#redirects-manual-works-in-node-22-verified) — verified `redirect: 'manual'` returns a readable 301 |
| ING-04 | One Trees call; bodies from raw | [Cost table](#cost-verified-live-unauthenticated-2026-08-10) — raw verified 0 core |
| ING-05 | Never written to disk | Architectural; no `fs` write path exists in the recommended design |
| ING-06 | Size/count/depth/wall-clock caps, streaming abort | [Resource caps](#resource-caps-concrete-numbers) |
| ING-07 | Truncated tree is a visible state | [`truncated` flag](#the-truncated-flag) |
| ING-10 | Never execute anything from a repo | Architectural; no `child_process`, no dynamic `import()`, no archive extraction |
| ING-11 | URLs in content extracted, never fetched | Store as data; the host allowlist makes fetching structurally impossible |
| DAT-01 | Repo identity survives rename | `github_node_id` — verified present unauthenticated (`R_kgDOP0wfhg`) |
| DAT-02 | Package identity stable across re-ingest | `UNIQUE (repository_id, type, source_path)` |
| DAT-03 | Version identified by content hash | `UNIQUE (package_id, content_hash)` + `onConflictDoNothing` |
| DAT-04 | `commit_sha`/`scanned_at`/`etag`/`content_hash`/`license_spdx` from day one | [Schema](#drizzle-patterns-for-this-data-model) — all five present |
| DAT-05 | Type-specific metadata without cross-type contamination | `meta jsonb` + per-type Zod |
| DAT-06 | Denylist survives re-crawl | `repository_denylist` table, checked before enqueue |
| DET-01 | Skills detected and parsed | [Agent Skills spec](#1-agent-skills-format--the-current-official-specification) |
| DET-08 | Safe YAML/JSON loader, no code-execution path | [`CORE_SCHEMA` verified to reject `!!js/function`](#yaml-parsing-verified-safe-configuration) |
| DET-10 | Detectors unit-tested against frozen fixtures, no network | [Testing](#7-testing-ingestion-without-github) — 100-file corpus already sampled below |
| REN-01 | Sanitizing Markdown pipeline, raw HTML off | [Rendering pipeline](#4-markdown-rendering--the-exact-safe-pipeline) |
| REN-02 | CSP that contains a sanitizer failure | [CSP](#csp-the-nonce-approach-is-the-only-one-that-satisfies-ren-02) |
| REN-03 | Escape at every sink incl. title, meta, structured data | [Metadata escaping](#generatemetadata-and-untrusted-text) |
| REN-04 | XSS fixture suite passes first | [XSS fixtures](#xss-fixture-corpus) |
| DIS-01 | Paginated listing, no account | [Route layout](#recommended-route-layout) |
| DIS-02 | Detail page shows name/desc/type/repo/path/licence/freshness | [Detail page fields](#detail-page-field-inventory) |
| DIS-09 | Server-rendered, indexable | RSC by default; `generateMetadata` per detail page |
| DIS-11 | Light/dark, responsive, accessible | [UI notes](#ui-constraints-dis-11-dis-12) |
| DIS-12 | Long strings cannot break layout | [UI notes](#ui-constraints-dis-11-dis-12) |
| PRV-01 | Link to exact file at exact commit | [Commit SHA discovery](#finding-1-the-trees-api-hands-you-the-commit-sha-verified) — **the tree SHA does not work** |
| PRV-02 | Distinguish upstream change from AgentDock scan | `pushed_at` vs `scanned_at`, rendered separately |
| PRV-03 | Stars labelled as GitHub stars | Copy rule, not a technical one |
| PRV-05 | No invented semver | `declared_version` nullable; render "not declared" |
| PRV-06 | Licence shown as detected, unknown honestly | **`anthropics/skills` returns `license: null` from the API** and its `SKILL.md` files say `license: Complete terms in LICENSE.txt` — neither is an SPDX id |
| PRV-07 | Excerpt only, with attribution and link | `body` capped; link to the pinned blob |
| INS-01 | Copyable install text | Static text per runtime; no execution |
| INS-02 | Never execute an install | Architectural |
| QUA-01/02 | Typecheck, lint one command | Existing `bun run ci` |
| QUA-03 | Unit tests for detectors/identity | [Testing](#7-testing-ingestion-without-github) |
| QUA-05 | XSS + SSRF fixtures are permanent regressions | [XSS fixtures](#xss-fixture-corpus), [SSRF fixtures](#ssrf-fixture-corpus) |
| QUA-06 | Structured logging, no secret or full body | Log `{owner, repo, sha, status, durationMs}` only |
| QUA-07 | Actionable errors, no internals | [404 ambiguity](#the-404-ambiguity-there-is-no-honest-fix) |
| QUA-08 | CI runs everything on push | Existing `.github/workflows/ci.yml` |

---

## Architectural Responsibility Map

| Capability | Primary tier | Secondary tier | Rationale |
|------------|--------------|----------------|-----------|
| `owner/repo` input validation | API / server (Server Action) | Browser (`pattern=` attr, cosmetic only) | ING-02 is a trust-boundary control. A client-side check is a UX affordance, never the enforcement point. |
| GitHub HTTP calls | API / server (`src/github/*`) | — | Runs in the Node runtime only. `src/github/` is the single directory where `api.github.com` may appear — that grep is the auditable form of the allowlist. |
| Tree enumeration + detection | API / server (`src/detect/*`) | — | Pure functions over an in-memory path array. No I/O, so unit-testable with zero mocking. |
| YAML parsing of untrusted frontmatter | API / server | — | Never in the browser. `CORE_SCHEMA`, capped input, capped serialized output. |
| Persistence + idempotency | Database | API / server | The `UNIQUE` constraints are the idempotency mechanism. Application-level "check then insert" races; `onConflictDoNothing` does not. |
| Markdown → React | API / server (RSC) | — | Sanitize on the server. Nothing untrusted crosses into a Client Component. |
| CSP header | Frontend server (`src/proxy.ts`) | — | Per-request nonce cannot be generated at build time. |
| Metadata / `<title>` escaping | API / server (`generateMetadata`) | — | React escapes; the danger is any `dangerouslySetInnerHTML` JSON-LD block, which this phase must not add. |
| Light/dark + responsive | Browser (CSS) | — | `prefers-color-scheme` + `color-scheme`. No JS theme toggle in this phase. |

---

## 1. Agent Skills format — the current official specification

**Source:** `https://agentskills.io/specification`, fetched 2026-08-10. `[CITED: agentskills.io/specification]`

### Frontmatter fields — complete, normative

| Field | Required | Type | Documented constraint (verbatim where quoted) |
|-------|----------|------|-----------------------------------------------|
| `name` | **Yes** | string | *"Max 64 characters. Lowercase letters, numbers, and hyphens only. Must not start or end with a hyphen."* |
| `description` | **Yes** | string | *"Max 1024 characters. Non-empty. Describes what the skill does and when to use it."* |
| `license` | No | string | *"License name or reference to a bundled license file."* |
| `compatibility` | No | string | *"Max 500 characters. Indicates environment requirements (intended product, system packages, network access, etc.)."* |
| `metadata` | No | map | *"Arbitrary key-value mapping for additional metadata (a map from string keys to string values)."* |
| `allowed-tools` | No | string | *"Space-separated string of pre-approved tools the skill may use. (Experimental)"* |

The `name` section is more specific than the table `[CITED: agentskills.io/specification]`:

> * Must be 1-64 characters
> * May only contain unicode lowercase alphanumeric characters (`a-z`, `0-9`) and hyphens (`-`)
> * Must not start or end with a hyphen (`-`)
> * Must not contain consecutive hyphens (`--`)
> * **Must match the parent directory name**

`description`: *"Must be 1-1024 characters"*. `compatibility`: *"Must be 1-500 characters if provided"*.

`allowed-tools` documented example: `allowed-tools: Bash(git:*) Bash(jq:*) Read` — a space-separated string of tool tokens, where a token may itself be `Tool(pattern)` with a `:`-separated and `*`-globbed inner pattern. **Splitting on whitespace is correct for the spec form**, but see the Claude Code divergence below.

### Directory layout `[CITED: agentskills.io/specification]`

```
skill-name/
├── SKILL.md          # Required: metadata + instructions
├── scripts/          # Optional: executable code
├── references/       # Optional: documentation
├── assets/           # Optional: templates, resources
└── ...               # Any additional files or directories
```

Validator: `skills-ref validate ./my-skill`, from `github.com/agentskills/agentskills` (`skills-ref/`). Not needed in this phase — the rules are short enough to encode directly, and shelling out to an external validator would violate the no-execution posture by reflex.

### The divergence: Claude Code vs the spec

**Source:** `https://code.claude.com/docs/en/skills`, fetched 2026-08-10. `[CITED: code.claude.com/docs/en/skills]`

Claude Code accepts the six spec fields **plus fourteen extensions**: `when_to_use`, `argument-hint`, `arguments`, `disable-model-invocation`, `user-invocable`, `disallowed-tools`, `model`, `effort`, `context`, `agent`, `background`, `hooks`, `paths`, `shell`.

Three contradictions between the two documents matter to the parser:

| Point | Spec says | Claude Code says |
|-------|-----------|------------------|
| `name` required? | **Yes** | **No** — *"Display name shown in skill listings. Defaults to the directory name."* |
| `name` == directory? | **"Must match the parent directory name"** | No such rule. In a plugin skill *"the frontmatter `name` replaces the directory name in the last segment of the command"* |
| `allowed-tools` syntax | *"Space-separated string"* | *"Accepts a space- or comma-separated string, **or a YAML list**"* |
| `metadata` value type | *"a map from string keys to string values"* | *"Free-form YAML map for your own key-value data... drops a value that isn't a map"* |

Claude Code also documents the exact hard-fail from the strict path `[CITED: code.claude.com/docs/en/skills]`:

```
Unexpected key(s) in SKILL.md frontmatter: argument-hint. Allowed properties are: allowed-tools, compatibility, description, license, metadata, name
```

**This is the CMP-01 signal in Phase 7 and it is computable here for free:** `keys ⊆ {name, description, license, compatibility, metadata, allowed-tools}` → spec-pure → uploadable to claude.ai and the Skills API. Any extra key → Claude-Code-locked. Store the key set in `meta` now so Phase 7 does not need a re-ingest.

---

## 2. Real-world `SKILL.md` variance — measured, not assumed

**Method:** 100 `SKILL.md` files fetched from `raw.githubusercontent.com` this session, pinned to commit SHAs, across four repositories. `anthropics/skills` (18/18), `addyosmani/agent-skills` (24 files, sampled), `wshobson/agents` (180 files, every 5th sampled), `JimLiu/baoyu-skills` (22 files, sampled). `[VERIFIED: raw.githubusercontent.com, 2026-08-10]`

### Field frequency across 100 files

| Field | Count | In spec? |
|-------|-------|----------|
| `name` | 100 | yes |
| `description` | 100 | yes |
| `version` | 24 | **no — Claude Code does not document it either** |
| `metadata` | 20 | yes |
| `license` | 15 | yes |
| `allowed-tools` | **0** | yes |
| `compatibility` | **0** | yes |

**Frontmatter was present in 100/100 files.** No file lacked a `---` fence. That is a strong enough signal to treat missing frontmatter as `parse_status='failed'` rather than as an expected shape.

### Concrete spec violations found in the wild

**`name` ≠ parent directory (`anthropics/skills`, `template/SKILL.md`)** — verbatim:
```yaml
---
name: template-skill
description: Replace with description of the skill and when Claude should use it.
---
```
Directory is `template`. **Anthropic's own reference repository violates the spec's must-match rule.**

**`description` exceeds the 1,024 cap (`anthropics/skills`, `skills/claude-api/SKILL.md`)** — measured length **1,077 characters**, using a YAML block scalar:
```yaml
description: |-
  Reference for the Claude API / Anthropic SDK — model ids, pricing, params, streaming, tool use, MCP, agents, caching, token counting, model migration.
  TRIGGER — read BEFORE opening the target file; ...
```
That value contains backticks, asterisks, pipes, brackets, parentheses, an em-dash, and an embedded shell command (`grep -rE 'openai|langchain_openai|...'`). Anything that renders a description into Markdown must escape it.

**`license` is free prose, not SPDX (`anthropics/skills`, 15 of 18 files)** — three distinct forms observed verbatim:
```yaml
license: Complete terms in LICENSE.txt
license: Proprietary. LICENSE.txt has complete terms
license: Apache-2.0        # spec example only; not seen in the sampled corpus
```
**Do not write `license_spdx` from frontmatter.** The API's repository-level `license.spdx_id` is the only SPDX-shaped source, and it is `null` for `anthropics/skills`. PRV-06 ("unknown shown honestly") is not a nicety here; it is the common case.

**`metadata` is nested, not string→string (`JimLiu/baoyu-skills`)** — verbatim:
```yaml
metadata:
  openclaw:
    homepage: https://github.com/JimLiu/baoyu-skills#baoyu-comic
    requires:
      anyBins:
        - bun
        - npx
```
`z.record(z.string())` **rejects this**. Use `z.record(z.unknown())` or `z.unknown()` and store the raw object.

**Non-spec `version` field (`wshobson/agents`, `JimLiu/baoyu-skills`)** — verbatim:
```yaml
name: multi-reviewer-patterns
description: Coordinate parallel code reviews ...
version: 1.0.2
```
This is the only sane source for `declared_version` (PRV-05). It is not in the spec and not in the Claude Code table — treat it as an observed convention, populate `declared_version` when present, render "not declared" otherwise, and never synthesize one.

**Double-quoted descriptions with escaped quotes (`anthropics/skills`, `pptx`, `xlsx`, `docx`)** — verbatim fragment:
```yaml
description: "Use this skill any time a .pptx or .potx file is involved ... Trigger whenever the user mentions \"deck,\" \"slides,\" ..."
```
This is exactly the case a hand-rolled `key: value` splitter gets wrong. Use a real YAML parser.

**Non-ASCII in descriptions (`JimLiu/baoyu-skills`)** — verbatim fragment: `Use when user says "release", "发布", "new version", ...`. Byte-length caps are wrong; use code-point or grapheme counts, and make sure the DB column and any truncation are UTF-8 safe.

**Raw HTML-ish content in bodies: 6 of 100 files** matched `<script|<img|<iframe|onerror=`. Including `anthropics/skills/skills/algorithmic-art/SKILL.md`. This is not hypothetical attacker content — legitimate skills contain HTML that must not reach the DOM as markup.

### What breaks naive parsing — the concrete list

1. Splitting on `---` naively: a body containing a `---` horizontal rule ends the frontmatter early. Match `/^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/` anchored at position 0 and take the **first** closing fence only.
2. Regex `^name:\s*(.*)$`: breaks on block scalars, quoted values, and any `name:` appearing in the body.
3. `z.record(z.string())` on `metadata`: rejects the nested real-world form.
4. `z.string()` on `allowed-tools`: Claude Code permits a YAML list, so the value may arrive as `string[]`.
5. Byte-length caps on `description`: wrong for CJK content.
6. Assuming `name` matches the directory: false in Anthropic's own repo.
7. Assuming `description ≤ 1024`: false in Anthropic's own repo.

### The strict-vs-tolerant rule

Encode the spec as a **conformance report**, not a gate.

```ts
// PARSE succeeds if: frontmatter fence exists, YAML parses, `name` and
// `description` are both present non-empty strings.  Everything else is a
// recorded warning.
type ParseStatus = 'ok' | 'partial' | 'failed';
```

| Condition | Status |
|-----------|--------|
| No `---` fence, or YAML throws, or `name`/`description` missing | `failed` |
| Parses, but violates any spec rule (length, charset, name≠dir, non-spec keys, nested `metadata`) | `partial` + warnings array |
| Parses and `keys ⊆ spec six` and all constraints hold | `ok` |

Rejecting `partial` would have discarded **`anthropics/skills/skills/claude-api`, `anthropics/skills/template`, all 24 `version`-bearing files, and all 20 nested-`metadata` files** — roughly a quarter of the measured corpus. A registry that indexes reality must index non-conforming reality, and surfacing the non-conformance is itself the differentiating signal.

---

## 3. GitHub API calls for exactly this phase, unauthenticated

All figures measured live 2026-08-10 with `GITHUB_TOKEN` empty. `[VERIFIED: api.github.com, 2026-08-10]`

### Confirmed quota

```json
"core":   {"limit": 60, "remaining": 56, "reset": 1786347413, "used": 4}
"search": {"limit": 10}
"graphql":{"limit": 0, "remaining": 0}
"code_search": {"limit": 60}
```

**GraphQL limit is 0.** The batched-GraphQL metadata plan in `ARCHITECTURE.md` is unavailable in this environment and must not appear in a Phase 1 task. `GET /rate_limit` itself does **not** consume quota (`used` unchanged across two calls around it) — it is the correct way to surface remaining budget in the UI.

### Finding 1: the Trees API hands you the commit SHA (verified)

```
GET /repos/anthropics/skills/git/trees/main?recursive=1
  → sha: f17010c9bb483898c1d9c9f42dde2b3a98889434

GET /repos/anthropics/skills/commits/main
  → sha:             f17010c9bb483898c1d9c9f42dde2b3a98889434   ← identical
  → commit.tree.sha: 0fe4c0c8372b239b13062036d08d05f79d4055a1   ← different
```

Repeated on `agentskills/agentskills` with both `main` and `HEAD` as the ref — both returned `69ef37e9...`, which `GET /commits/HEAD` confirms is the commit SHA (its `commit.tree.sha` is `65e11c9f...`).

**Why it is load-bearing:**

```
github.com/anthropics/skills/blob/f17010c9…/skills/canvas-design/SKILL.md  → 200   (commit sha)
github.com/anthropics/skills/blob/0fe4c0c8…/skills/canvas-design/SKILL.md  → 404   (tree sha)
```

PRV-01 requires a permalink to the exact file at the exact indexed commit. Using the tree SHA produces a 404 on every link. `raw.githubusercontent.com` happens to accept **both** (both returned 200), so a raw-only smoke test would not catch the mistake — only the `blob/` permalink does.

**Caveat — this is empirical, not documented.** The REST reference describes the parameter as `tree_sha` and does not state what `sha` contains when a ref name is passed. Defend against a future change: assert `/^[0-9a-f]{40}$/`, and add one integration test that fetches `https://github.com/{owner}/{repo}/blob/{sha}/{path}` and asserts 200. If that test ever fails, fall back to `GET /repos/{o}/{r}/commits/{branch}` at a cost of one extra core call.

### The exact call sequence (2 core calls, verified)

```
1. GET https://api.github.com/repos/{owner}/{repo}                 → 1 core
2. GET https://api.github.com/repos/{owner}/{repo}/git/trees/HEAD?recursive=1  → 1 core
3. GET https://raw.githubusercontent.com/{owner}/{repo}/{sha}/{path}  × N → 0 core
```

Passing `HEAD` in step 2 avoids needing `default_branch` from step 1 first, so the two API calls can run concurrently if desired. **60 core/hr unauthenticated ⇒ 30 repositories per hour maximum.** Surface that number; do not let a user submit into a wall silently.

### Cost verified live, unauthenticated 2026-08-10

| Call | Cost | Evidence |
|------|------|----------|
| `/repos/{o}/{r}` | 1 core | `x-ratelimit-used` 3 → 4 |
| `/git/trees/{ref}?recursive=1` | 1 core | `used` 4 → 5 |
| `raw.githubusercontent.com/...` | **0 core** | `core.used` **8 before, 8 after** an 11,939-byte fetch |
| `/rate_limit` | 0 core | `used` unchanged |
| `/repos/{o}/{r}` with `If-None-Match` → **304** | **1 core** | `used` **11 → 12** |

**The 304 finding contradicts the plan in `ARCHITECTURE.md`.** GitHub's exemption reads *"does not count against your primary rate limit if a `304` response is returned and the request was made while correctly authorized"* — unauthenticated is not "correctly authorized." Store the `etag` (DAT-04 requires the column anyway), but do not plan any Phase-2 quota saving on conditional requests until a token exists. Flag this to the maintainer.

### Repository metadata — fields verified present unauthenticated

From `GET /repos/anthropics/skills`, verbatim response subset:

```json
{
  "id": 1061953414,
  "node_id": "R_kgDOP0wfhg",
  "name": "skills",
  "full_name": "anthropics/skills",
  "owner": { "login": "anthropics", "node_id": "MDEyOk9yZ2FuaXphdGlvbjc2MjYzMDI4" },
  "description": "Public repository for Agent Skills",
  "fork": false,
  "archived": false,
  "default_branch": "main",
  "stargazers_count": 167297,
  "license": null,
  "html_url": "https://github.com/anthropics/skills",
  "homepage": "",
  "topics": ["agent-skills"],
  "pushed_at": "2026-08-07T17:14:15Z",
  "updated_at": "2026-08-10T07:01:39Z",
  "created_at": "2025-09-22T15:53:31Z",
  "size": 4478
}
```

Every field DAT-01/DAT-04/DIS-02/PRV-02/PRV-03/PRV-06 needs is present without a token. Three notes:

- `node_id` (`R_kgDOP0wfhg`) is the rename-and-transfer-stable key for DAT-01.
- `license: null` on a 167k-star Anthropic repo. PRV-06's honest-unknown path is the **default** path, not the edge case.
- `homepage: ""` — empty string, not `null`. Normalize before storing or the UI renders an empty link.
- `pushed_at` (upstream change) vs your own `scanned_at` (when AgentDock looked) is exactly PRV-02. `updated_at` is *not* the upstream-change timestamp — it moves on metadata edits like a star count refresh (here `updated_at` is 3 days newer than `pushed_at`).

### Rate-limit headers, verified verbatim

```
x-ratelimit-limit: 60
x-ratelimit-remaining: 55
x-ratelimit-used: 5
x-ratelimit-resource: core
x-ratelimit-reset: 1786347413
```

`x-ratelimit-reset` is UTC epoch **seconds**. `retry-after` appears only on secondary-limit responses (not observed this session).

### 403 vs 429 vs 404 — how to distinguish

**Distinguishing exhaustion from not-found is a header check, not a status check.** GitHub documents both `403` and `429` for rate limiting, so branching on status alone is fragile. The reliable rule:

```ts
const remaining = Number(res.headers.get('x-ratelimit-remaining'));
const isRateLimited =
  (res.status === 403 || res.status === 429) &&
  (res.headers.has('retry-after') || remaining === 0);
```

A `403` **with** `x-ratelimit-remaining > 0` and no `retry-after` is a permissions/abuse response, not exhaustion. A `404` is never a rate limit. `[ASSUMED — the 403/429 body shape was not observed live; only the header semantics above were verified. The exhaustion path must be tested with a stubbed response, not by burning the live 60/hr budget.]`

### The 404 ambiguity: there is no honest fix

Verified byte-identical responses:

```
GET /repos/anthropics/definitely-not-a-real-repo-xyz123  → 404
{"message":"Not Found","documentation_url":"https://docs.github.com/rest/repos/repos#get-a-repository","status":"404"}

GET /repos/github/github                                 → 404
{"message":"Not Found","documentation_url":"https://docs.github.com/rest/repos/repos#get-a-repository","status":"404"}
```

Identical `message`, identical `documentation_url`, identical status. GitHub does this deliberately, so a private repo's existence is not leaked. Unauthenticated, **there is no way to tell them apart, and there will not be one.**

**Honest UX consequence — the copy must not guess.** Do not write "That repository does not exist." Write something like:

> AgentDock could not read `{owner}/{repo}`. GitHub returns the same response for a repository that does not exist and one that is private, so AgentDock cannot tell which. Check the spelling; if the repository is private, AgentDock cannot index it.

This is a QUA-07 requirement (actionable without leaking internals) and it is also a correctness requirement: the alternative sentence is a false statement about a repo that does exist.

### Redirects: `manual` works in Node 22 (verified)

Node 22.22.3 / undici, unlike a browser, returns a **real, readable** 3xx under `redirect: 'manual'` — not an opaque response:

```
fetch('https://api.github.com/repos/facebook/create-react-app', { redirect: 'manual' })
  → status 301, type 'basic', location: https://api.github.com/repositories/63537249

fetch('http://github.com/anthropics/skills', { redirect: 'manual' })
  → status 301, type 'basic', location: https://github.com/anthropics/skills
```

So ING-03 is implementable exactly as `PITFALLS.md` specifies: `redirect: 'manual'`, read `location`, re-validate the target host against the hardcoded allowlist, cap follows at 2.

**Do not skip redirect following entirely.** A renamed repository legitimately 301s to `https://api.github.com/repositories/{id}` — same host, so it passes the allowlist and must be followed, or every renamed repo fails to ingest. That same-host 301 is also where the immutable `id`/`node_id` proves its worth (DAT-01).

### The `truncated` flag

Documented limit `[CITED: docs.github.com/rest/git/trees]`: *"The limit for the tree array is 100,000 entries with a maximum size of 7 MB when using the recursive parameter."*

Measured this session — none of these are near the limit:

| Repo | Entries | `truncated` | `SKILL.md` files |
|------|---------|-------------|------------------|
| `anthropics/skills` | 501 | `false` | 18 |
| `agentskills/agentskills` | 198 | `false` | — |
| `addyosmani/agent-skills` | 261 | `false` | 24 |
| `JimLiu/baoyu-skills` | 1,077 | `false` | 22 |
| `wshobson/agents` | **1,992** | `false` | **180** |

**`truncated` cannot appear on a modest repo.** 7 MB of tree JSON is roughly 25,000–30,000 entries; the largest sampled real skills repo is 1,992. **For Phase 1, do not build the subtree-walk fallback.** Set `tree_truncated = true`, refuse to claim completeness on that repo's page, and stop — that is exactly what ING-07 asks for ("surfaced as a visible state, never silently treated as complete"). The recursive fallback belongs in a later phase, gated on a real repo tripping it.

`// ponytail: truncated => visible flag, no subtree walk; build the walk when a real submission trips it`

`wshobson/agents` is the honest stress case: **180 `SKILL.md` files at 0 core cost but 180 sequential raw fetches**. At ~150 ms each that is ~27 s of wall clock inside a synchronous Server Action. See [resource caps](#resource-caps-concrete-numbers).

### Resource caps — concrete numbers

Grounded in the measured corpus, not invented:

| Cap | Value | Grounding |
|-----|-------|-----------|
| Max `SKILL.md` files fetched per repo | **200** | Largest sampled repo has 180. 200 clears reality with headroom; record `truncated_artifacts` when exceeded. |
| Max single file bytes | **512 KB** | Largest sampled `SKILL.md` is 72,088 bytes (`claude-api`). 512 KB is 7× headroom. |
| Max frontmatter block bytes (pre-parse) | **64 KB** | Largest sampled frontmatter is ~1.2 KB. |
| Max **serialized** frontmatter JSON | **256 KB** | The alias-bomb defence — see the [YAML section](#yaml-parsing-verified-safe-configuration). Applied to `JSON.stringify(parsed)`, not to the input. |
| Max tree entries processed | **100,000** | GitHub's own documented tree ceiling. |
| Max path depth considered | **10** | Deepest sampled is `plugins/x/skills/y/SKILL.md` = 4. |
| Wall-clock budget per ingest | **120 s** | 180 files × ~150 ms ≈ 27 s + margin. |
| Concurrent raw fetches | **2** | `raw.githubusercontent.com` has undocumented abuse throttling; keep it near-serial. |
| Per-request timeout | **10 s** | |
| Stored `body` excerpt | **32 KB** | PRV-07 (excerpt, not mirror). `claude-api` at 72 KB is the case that proves a cap is needed. |

**Enforce the byte cap with a streaming counter, never `Content-Length`.** `Content-Length` is attacker-influenced. Read the body as a stream, count as you go, and abort the reader when the counter exceeds the cap.

---

## 4. Markdown rendering — the exact safe pipeline

### Packages — versions verified on npm 2026-08-10

| Package | Version | Published | Weekly downloads | Repo | Verdict |
|---------|---------|-----------|------------------|------|---------|
| `react-markdown` | **10.1.0** | 2025-03-07 | 30,391,695 | `github.com/remarkjs/react-markdown` | OK |
| `remark-gfm` | **4.0.1** | 2025-02-10 | 35,039,689 | `github.com/remarkjs/remark-gfm` | OK |
| `rehype-sanitize` | **6.0.0** | 2023-08-26 | 8,852,414 | `github.com/rehypejs/rehype-sanitize` | OK |
| `js-yaml` | **4.3.1** (`v4-legacy` tag) | 2026-07-31 | 292,265,394 | `github.com/nodeca/js-yaml` | see audit |

`react-markdown@10.1.0` peer deps: `{ react: '>=18', '@types/react': '>=18' }` — satisfied by React 19.2.8. It bundles `remark-parse@^11`, `remark-rehype@^11`, `unified@^11`, `hast-util-to-jsx-runtime@^2`. **Do not install those separately** — `react-markdown` composes them and renders straight to React elements.

**Installation:**
```bash
bun add react-markdown@10.1.0 remark-gfm@4.0.1 rehype-sanitize@6.0.0 js-yaml@4.3.1
bun add -d @types/js-yaml
```

### No `dangerouslySetInnerHTML` is needed — this is the answer to "how do you render safely"

`react-markdown` renders mdast → hast → **React elements** via `hast-util-to-jsx-runtime`. It never touches `dangerouslySetInnerHTML`. From its documented security section, verbatim `[CITED: github.com/remarkjs/react-markdown]`:

> "Use of `react-markdown` is secure by default. Overwriting `urlTransform` to something insecure will open you up to XSS vectors. Furthermore, the `remarkPlugins`, `rehypePlugins`, and `components` you use may be insecure."

And on raw HTML: it *"typically escapes HTML (or ignores it, with `skipHtml`) because it is dangerous and defeats the purpose of this library."* Without `rehype-raw`, HTML in the source is **never parsed into element nodes at all** — `<script>alert(1)</script>` is text, not markup. That is REN-01 satisfied structurally.

`rehype-sanitize` is therefore **defense in depth**, not the primary control. Keep it: it is the thing that still holds when someone adds a plugin in month six.

### The default `rehype-sanitize` schema — what it does and does not do

Read verbatim from `hast-util-sanitize@5` `lib/schema.js`, the module `rehype-sanitize@6` depends on. `[VERIFIED: github.com/syntax-tree/hast-util-sanitize/lib/schema.js]`

**`tagNames` is an allowlist** — verbatim, complete:
```
a, b, blockquote, br, code, dd, del, details, div, dl, dt, em, h1, h2, h3, h4,
h5, h6, hr, i, img, input, ins, kbd, li, ol, p, picture, pre, q, rp, rt, ruby,
s, samp, section, source, span, strike, strong, sub, summary, sup, table, tbody,
td, tfoot, th, thead, tr, tt, ul, var
```

| Question | Answer | Evidence |
|----------|--------|----------|
| `<script>` stripped? | **Yes** | Not in `tagNames`, and additionally `strip: ['script']` (removes the element *and its text*, rather than unwrapping it) |
| `<iframe>` / `<object>` / `<embed>` stripped? | **Yes** | Absent from `tagNames`; an allowlist, so absence is removal |
| `<style>` element stripped? | **Yes** | Absent from `tagNames` |
| `style` **attribute** stripped? | **Yes** | `attributes` is an allowlist and `style` appears in **no** entry, including `'*'` |
| Event handlers (`onerror`, `onload`, …) stripped? | **Yes** | Same reason — allowlist; no `on*` appears anywhere |
| `javascript:` URLs blocked? | **Yes, on `href` and `src`** | `protocols: { href: ['http','https','irc','ircs','mailto','xmpp'], src: ['http','https'], cite: ['http','https'], longDesc: ['http','https'] }` |
| Comments (`<!-- payload -->`) kept? | **No** | `allowComments` defaults to `false` |
| Doctypes kept? | **No** | `allowDoctypes` defaults to `false` |
| `id` clobbering prevented? | **Yes** | `clobber: ['ariaDescribedBy','ariaLabelledBy','id','name']`, `clobberPrefix: 'user-content-'` |

**Three gaps the default schema leaves. Add all three explicitly.**

1. **`rel` and `target` are not allowed on `a`, so you cannot add them via the schema.** The default `a` attribute list is `[ariaDescribedBy, ariaLabel, ariaLabelledBy, dataFootnoteBackref, dataFootnoteRef, ['className','data-footnote-backref'], href]`. Add `rel` and `target` to the schema **and** set them via `react-markdown`'s `components` override so untrusted links get `rel="noopener noreferrer nofollow ugc"`.
2. **`srcSet` on `<source>` has no protocol restriction.** `attributes.source: ['srcSet']` exists, but `protocols` has no `srcSet` entry. Drop `source` and `picture` from `tagNames` — this phase has no responsive-image requirement and a `srcSet` with an unvalidated scheme is free attack surface for nothing.
3. **`img src` permits any `https://` host.** Every detail page then leaks visitors' IPs and a load signal to whatever host an author chose, and CSP `img-src 'self'` will block them anyway (producing broken images plus a console full of violations). Decide once: either drop `img` from `tagNames` in this phase, or allow it and set `img-src` accordingly. Recommendation: **drop `img`** — a skill body's images are not the product, and the alternative is an image proxy this phase does not need.

### The prescribed pipeline

```tsx
// src/components/SkillBody.tsx  — a Server Component. No 'use client'.
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import type { Schema } from 'hast-util-sanitize';

// Narrowed from the GitHub-style default. Every deviation is deliberate:
//  - img/source/picture removed: no remote loads, no unrestricted srcSet.
//  - a gains rel/target so untrusted links cannot reach window.opener.
const schema: Schema = {
  ...defaultSchema,
  tagNames: (defaultSchema.tagNames ?? []).filter(
    (t) => t !== 'img' && t !== 'source' && t !== 'picture',
  ),
  attributes: {
    ...defaultSchema.attributes,
    a: [...(defaultSchema.attributes?.a ?? []), 'rel', 'target'],
  },
};

export function SkillBody({ markdown }: { markdown: string }) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[[rehypeSanitize, schema]]}
      // urlTransform is left at the default. The default permits only
      // http/https/mailto/irc/ircs/xmpp and relative URLs. Overriding it is
      // the one documented way to reintroduce XSS here.
      components={{
        a: ({ node: _node, ...props }) => (
          <a {...props} rel="noopener noreferrer nofollow ugc" target="_blank" />
        ),
      }}
    >
      {markdown}
    </Markdown>
  );
}
```

**Never add `rehype-raw`.** If a future commit does, `rehype-sanitize` must run *after* it in the array — but the correct answer is that the commit does not happen. Add a lint rule or a grep in CI: `rehype-raw|dangerouslySetInnerHTML|allowDangerousHtml` must not appear in `src/`.

### CSP: the nonce approach is the only one that satisfies REN-02

Next's own no-nonce recipe is, verbatim `[CITED: nextjs.org/docs/app/guides/content-security-policy]`:

```
script-src 'self' 'unsafe-inline';
style-src 'self' 'unsafe-inline';
```

`'unsafe-inline'` in `script-src` is precisely what `PITFALLS.md` forbids, and it makes the CSP worthless as a second layer. The docs also state the cost of the alternative: *"you **must use dynamic rendering** to add nonces"*, *"Static optimization and Incremental Static Regeneration (ISR) are disabled"*, *"Partial Prerendering (PPR) is incompatible with nonce-based CSP"*.

**That cost is already sunk.** Every page in this phase reads PostgreSQL and must be dynamic anyway (see the caching section). The nonce approach removes `'unsafe-inline'` for free.

Next 16 renamed the file: `PROXY_LOCATION_REGEXP = (?:src/)?proxy` — read from the installed `next@16.3.0` `dist/lib/constants.js`. `[VERIFIED: node_modules/next/dist/lib/constants.js]` The project uses `src/`, so the file is **`src/proxy.ts`**. `middleware` is still recognised (`MIDDLEWARE_FILENAME = middleware`) but `proxy` is the Next 16 name.

```ts
// src/proxy.ts
import { NextResponse, type NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const isDev = process.env.NODE_ENV === 'development';

  // img-src 'self' only: the sanitizer already drops <img>, so a remote image
  // request would be a bug, and the CSP is where that bug becomes visible.
  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' ${isDev ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    `img-src 'self'`,
    `font-src 'self'`,
    `connect-src 'self'`,
    `object-src 'none'`,
    `base-uri 'none'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `upgrade-insecure-requests`,
  ].join('; ');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
```

`'unsafe-eval'` in dev is required and documented: *"In development, `'unsafe-eval'` is required because React uses `eval` to provide enhanced debugging information... `unsafe-eval` is not required for production."*

Next attaches the nonce to framework scripts, page bundles, and its own inline styles automatically — no per-tag work.

Non-CSP headers (`X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`) go in `next.config.ts` `async headers()` with `source: '/(.*)'`. `X-Frame-Options` is superseded by `frame-ancestors 'none'` and can be omitted. `[CITED: nextjs.org/docs/app/api-reference/config/next-config-js/headers]`

### Syntax highlighting — no

Skip it in this phase. It adds `rehype-highlight` or `shiki`, and `rehype-highlight` writes `className` values that must survive sanitization (the default schema allows only `code[className=/^language-./]`). It is pure polish against a requirement list that does not mention it. `// ponytail: no highlighting; add shiki when someone complains about a code block`

### `generateMetadata` and untrusted text

React escapes text children and attribute values it renders, and the Metadata API renders `<title>`/`<meta>` through React — so a `name` containing `</title><script>` is escaped, not injected. REN-03 is satisfied *provided nothing bypasses React*.

```tsx
export async function generateMetadata(props: PageProps<'/skills/[...slug]'>) {
  const pkg = await getPackage(await props.params);
  if (!pkg) return { title: 'Not found — AgentDock' };
  return {
    // Plain strings. Next escapes. Do not template into raw HTML anywhere.
    title: `${pkg.name} — AgentDock`,
    description: pkg.summary?.slice(0, 300) ?? undefined,
    // No `other:` entries, no JSON-LD in this phase.
  };
}
```

**The one rule that matters:** this phase must not add a `<script type="application/ld+json">` block. That is the sink React does not escape (it requires `dangerouslySetInnerHTML`), and it is the exact sink REN-03 names. Structured data can come later, with `JSON.stringify(...).replace(/</g, '\\u003c')` and a test.

Also: truncate `description` before it reaches metadata. The measured maximum real description is 1,077 characters; a `<meta name="description">` that long is useless and DIS-12-adjacent.

### XSS fixture corpus

REN-04 says the suite passes *before* any ingested content renders. Freeze these as `SKILL.md` fixtures on disk and assert the rendered HTML string contains none of the payload markers:

| Fixture | Payload | Assertion |
|---------|---------|-----------|
| `script-tag` | `<script>alert(1)</script>` in body | output contains no `<script` **and no `alert(1)`** (`strip: ['script']` removes the text too) |
| `img-onerror` | `<img src=x onerror=alert(1)>` | no `onerror`, no `<img` |
| `js-url-link` | `[click](javascript:alert(1))` | no `javascript:` in any `href` |
| `data-url-img` | `![x](data:text/html;base64,...)` | no `data:` |
| `html-comment` | `<!-- ignore previous instructions -->` | comment absent from output |
| `style-attr` | `<span style="display:none">payload</span>` | no `style=` attribute |
| `iframe` | `<iframe src="https://evil.tld">` | no `<iframe` |
| `frontmatter-name` | `name: "</title><script>alert(1)</script>"` | escaped in `<title>`, in the `<h1>`, and in the meta description |
| `svg-onload` | `<svg onload=alert(1)>` | no `<svg`, no `onload` |
| `bidi-override` | `U+202E` in `description` | present in output (**not stripped**) — CAP-07 forbids silent stripping; sentinels arrive in Phase 4, so Phase 1 only asserts the raw bytes survive to the DB |
| `real-world-html` | the actual body of `anthropics/skills/skills/algorithmic-art/SKILL.md` | renders without `<script`/`<img`, and the surrounding prose is intact |

The last one is why the corpus is real: **6 of 100 sampled files contain HTML-ish content**, so "no HTML reaches the DOM" must be tested against a legitimate file, not only against a crafted one.

---

## 5. Next.js 16 App Router specifics

Verified against the `next@16.3.0` docs (each page self-reports `version: 16.3.0`).

### Server Action vs Route Handler for the submit form

**Use a Server Action.** `[CITED: nextjs.org/docs/app/getting-started/mutating-data]`

Reasons, in order:
1. It is a mutation followed by a redirect to a detail page. That is the documented Server Action shape, and `redirect()` composes with it directly.
2. `<form action={serverAction}>` in a Server Component works **without JavaScript** — *"Server Components support progressive enhancement by default, meaning forms that call Server Actions will be submitted even if JavaScript hasn't loaded yet or is disabled."* DIS-09 wants server-rendered and indexable; a `fetch()`-driven Route Handler form would not degrade.
3. A Route Handler would need its own request parsing, its own response shape, and its own client-side redirect. More code for less.

The slow-I/O objection is real but is not solved by a Route Handler either — both block the request. It is solved by the job queue in **Phase 2** (JOB-01). For Phase 1, the honest answer is a synchronous action with the 120 s wall-clock budget and a `useActionState` pending indicator.

```ts
// src/app/actions.ts
'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

// Anchored, bounded, and strict. See the SSRF pitfall for why each part matters.
const OWNER_REPO = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;

export async function submitRepo(
  _prev: { error?: string } | undefined,
  formData: FormData,
): Promise<{ error?: string }> {
  const raw = String(formData.get('repo') ?? '').trim();
  if (!OWNER_REPO.test(raw)) {
    // Rejected with NO network request made — success criterion 4.
    return { error: 'Enter a repository as owner/repo, for example anthropics/skills.' };
  }
  const [owner, repo] = raw.split('/');

  const result = await ingestRepository(owner, repo);
  if (!result.ok) return { error: result.message };

  revalidatePath('/skills');
  // redirect() throws a framework control-flow exception. It MUST NOT sit
  // inside a try/catch, and nothing after it runs.
  redirect(`/r/${owner}/${repo}`);
}
```

**The `redirect()` trap, documented verbatim** `[CITED: nextjs.org/docs/app/getting-started/mutating-data]`: *"Calling `redirect` throws a framework handled control-flow exception. Any code after it won't execute. If you need fresh data, call `revalidatePath` or `revalidateTag` beforehand."* A `try { ... redirect() } catch { }` around the whole action swallows the redirect and the page silently does not navigate. Put the `redirect()` outside every `try`.

Also from the docs, and relevant even without auth: *"Server Functions are reachable via direct POST requests, not just through your application's UI."* The `owner/repo` validation is therefore a real trust boundary, not a form-validation nicety.

### `searchParams` and `params` are Promises — exact shape

`[CITED: nextjs.org/docs/app/api-reference/file-conventions/page]`

```tsx
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { slug } = await params;
  const { page } = await searchParams;
}
```

| URL | `searchParams` resolves to |
|-----|---------------------------|
| `/shop?a=1` | `{ a: '1' }` |
| `/shop?a=1&b=2` | `{ a: '1', b: '2' }` |
| `/shop?a=1&a=2` | `{ a: ['1', '2'] }` |

**The repeated-key case is the bug source.** `?page=1&page=2` yields `string[]`, so `Number(page)` becomes `NaN` and a naive `LIMIT`/`OFFSET` breaks. Coerce with Zod:

```ts
const pageSchema = z.coerce.number().int().min(1).max(10_000).catch(1);
const page = pageSchema.parse(Array.isArray(raw) ? raw[0] : raw);
```

Prefer the generated helper — it types `params` keys from the route literal and needs no import:
```tsx
export default async function Page(props: PageProps<'/skills/[...slug]'>) {
  const { slug } = await props.params;
}
```
*"Types are generated during `next dev`, `next build`, or with `next typegen`."* Note that `bun run typecheck` on a clean checkout may fail until types are generated — add `next typegen` ahead of `tsc --noEmit` in the `ci` script if CI trips on it.

Also documented: *"`searchParams` is a **Request-time API**... Using it will opt the page into **dynamic rendering** at request time."* and *"`searchParams` is a plain JavaScript object, not a `URLSearchParams` instance."*

### Caching: what actually makes a freshly ingested skill visible

`cacheComponents` is **not** enabled (there is no `next.config.*` in the repo at all), so the previous model applies. `[CITED: nextjs.org/docs/app/guides/caching-without-cache-components]`

- *"By default, `fetch` requests are not cached."* — so the GitHub client needs no cache opt-out. Still pass `cache: 'no-store'` explicitly on GitHub calls; it documents intent and survives a future `fetchCache` change.
- **Drizzle queries are not `fetch`, so they are not memoized and not cached** — but the *route* still is. `dynamic` defaults to `'auto'`: *"cache as much as possible without preventing any components from opting into dynamic behavior."* A page whose only async work is a Drizzle query, with no request-time API, **is prerendered at build time** and will serve build-time rows forever.

This is the trap. It has already been dodged once in this repo — `src/app/page.tsx` carries `export const dynamic = 'force-dynamic'` with the comment *"`next build` runs in CI, where there is no database."* Every new DB-reading page needs the same treatment.

**Prescription — pick one and apply it to every page in this phase:**

```ts
// Top of every page that reads PostgreSQL.
export const dynamic = 'force-dynamic';
```

Rationale over the alternatives:
- `revalidate = 0` also forces dynamic, but reads as a caching tweak rather than a decision.
- `connection()` from `next/server` is the Cache-Components-era idiom and is more surgical, but this project is not on Cache Components.
- The nonce CSP requires dynamic rendering anyway, so `force-dynamic` is not a cost — it is the state the app is already in.
- `next build` runs in CI with no database. `force-dynamic` is what keeps the build from trying to prerender a DB read.

`revalidatePath('/skills')` in the Server Action then clears the **client Router Cache** so a client-side navigation back to the listing does not show a stale RSC payload. With `force-dynamic` the server never serves a stale page, but the router cache is a separate store — keep the `revalidatePath` call.

Use React's `cache()` to dedupe a query used by both `generateMetadata` and the page body — they run in the same render pass and would otherwise hit the DB twice:

```ts
import { cache } from 'react';
export const getPackage = cache(async (owner: string, repo: string, path: string) => { /* ... */ });
```

### URL shape for the detail page

A package is identified by (repository, artifact type, `source_path`). Three candidate shapes:

| Shape | Verdict |
|-------|---------|
| `/p/{id}/{slug}` (`ARCHITECTURE.md`'s proposal) | Stable through rename, but opaque and unguessable. |
| `/skills/{owner}/{repo}/{...path}` | Readable, guessable, obviously correct for SEO — but breaks on repo rename, and `source_path` contains `/` so it needs a catch-all. |
| **`/r/{owner}/{repo}` + `/r/{owner}/{repo}/{...path}`** | **Recommended.** |

**Recommended:** `/r/{owner}/{repo}/{...path}` where `path` is the `SKILL.md`'s **directory** (e.g. `/r/anthropics/skills/skills/canvas-design`). Reasons: it mirrors the source layout so it is self-explanatory; the repo page falls out for free as the parent route; it is fully server-renderable and indexable; and `owner/repo` is already the submission unit, so no new identifier vocabulary is introduced. Look the row up by `lower(full_name)` + `source_path`, and keep the immutable `id` as the internal key so a `repository_alias` table can be added later without changing stored data.

`// ponytail: path-shaped URLs, resolved via lower(full_name); add repository_alias when the first rename breaks an inbound link`

### Recommended route layout

```
src/
├── proxy.ts                              # CSP nonce (Next 16 name for middleware)
├── app/
│   ├── layout.tsx                        # existing; add color-scheme + skip link
│   ├── page.tsx                          # home: submit form + recent packages
│   ├── actions.ts                        # 'use server' — submitRepo
│   ├── skills/
│   │   └── page.tsx                      # DIS-01 paginated listing (?page=)
│   └── r/
│       └── [owner]/
│           └── [repo]/
│               ├── page.tsx              # repository page: its packages
│               └── [...path]/
│                   └── page.tsx          # DIS-02 package detail + generateMetadata
├── components/
│   ├── SkillBody.tsx                     # the sanitized renderer
│   └── SubmitForm.tsx                    # 'use client' — useActionState pending only
├── github/                               # the wall: api.github.com appears ONLY here
│   ├── client.ts                         # allowlist, manual redirects, caps, streaming abort
│   ├── repo.ts                           # GET /repos/{o}/{r}
│   ├── tree.ts                           # GET /git/trees/HEAD?recursive=1
│   └── raw.ts                            # raw.githubusercontent.com, 0-quota reads
├── detect/
│   ├── types.ts                          # Detector, Candidate, ParseResult
│   ├── index.ts                          # export const DETECTORS = [skill]  ← the whole extension point
│   └── skill.ts                          # match() path-only, parse() reads declared paths
├── ingest/
│   ├── pipeline.ts                       # orchestration only
│   └── persist.ts                        # one transaction
└── db/
    ├── schema.ts                         # existing; add the new tables
    ├── client.ts                         # existing
    └── queries/packages.ts               # list + detail
```

`src/github/` being the only directory containing `api.github.com` is the auditable form of ING-02. Add a CI grep asserting it.

### Detail page field inventory

DIS-02 + PRV-01/02/03/05/06/07 + INS-01 in one list, so the planner can build the component against a fixed set:

| Field | Source | Note |
|-------|--------|------|
| name | frontmatter `name`, else directory name | |
| description | frontmatter `description` | escape; truncate for `<meta>` |
| type | constant `'skill'` in this phase | |
| source repository | `repository.full_name` | link to `html_url` |
| path within repository | `package.source_path` | |
| licence | repo `license.spdx_id` **and** frontmatter `license` | show both, labelled; "not detected" when null — the common case |
| freshness | `pushed_at` (upstream) **and** `scanned_at` (AgentDock) | PRV-02 requires both, distinctly labelled |
| permalink | `github.com/{o}/{r}/blob/{commit_sha}/{source_path}` | **commit SHA, not tree SHA** |
| stars | `stargazers_count` | label "GitHub stars" (PRV-03) |
| declared version | frontmatter `version` if present | else "not declared" (PRV-05) |
| conformance | computed key-set ⊆ spec six | free CMP-01 groundwork |
| parse status | `ok`/`partial`/`failed` + warnings | DET-07 |
| body | `package_version.body` excerpt via `SkillBody` | attribution + source link (PRV-07) |
| install text | static per runtime, copyable | INS-01; never executed (INS-02) |

### UI constraints (DIS-11, DIS-12)

- **Light/dark without JS:** `<html style={{ colorScheme: 'light dark' }}>` plus `light-dark()` CSS or `@media (prefers-color-scheme: dark)`. No toggle, no localStorage, no flash-of-wrong-theme script — which also means no inline script fighting the CSP.
- **DIS-12 is a real risk here, not a hypothetical one.** The measured corpus includes a 1,077-character description and paths like `plugins/accessibility-compliance/skills/screen-reader-testing/SKILL.md`. Apply `overflow-wrap: anywhere` to descriptions and `word-break: break-all` (or `<wbr>` insertion) to paths and identifiers. A `min-width: 0` on flex children is the usual missing piece.
- Accessibility floor: one `<h1>` per page, a skip link, `<main>`/`<nav>` landmarks, visible focus rings, form inputs with real `<label>`s, and the error message from the Server Action wired via `aria-describedby` in an `aria-live="polite"` region.

---

## 6. Drizzle patterns for this data model

Verified against **`drizzle-orm@0.45.2`** typings in `node_modules`. `[VERIFIED: node_modules/drizzle-orm/pg-core/*.d.ts]`

### The extra-config callback must return an ARRAY

From `pg-core/table.d.ts`, the object-returning overload is marked verbatim:
> `@deprecated The third parameter of pgTable is changing and will only accept an array instead of an object`

```ts
// CORRECT for 0.45.2
export const users = pgTable('users', { id: integer() }, (t) => [
  index('custom_name').on(t.id),
]);
```

Most Drizzle examples on the web still show the object form. Using it compiles but emits a deprecation and will break on the next major.

### Verified API surface

| Need | API | Verified signature |
|------|-----|--------------------|
| Schema | `pgSchema(name)` | `export declare function pgSchema<T extends string>(name: T): PgSchema<T>` |
| Table in schema | `agentdock.table(...)` | `PgSchema.table: PgTableFn<TName>` |
| Composite unique | `unique(name?)` | `export declare function unique(name?: string): UniqueOnConstraintBuilder` |
| Index | `index(name?)` | `export declare function index(name?: string): IndexBuilderOn` |
| Unique index | `uniqueIndex(name?)` | `export declare function uniqueIndex(name?: string): IndexBuilderOn` |
| `timestamptz` | `timestamp(name, { withTimezone: true })` | `withTimezone: boolean; precision: number \| undefined` |
| `jsonb` | `jsonb(name)` | `export declare function jsonb<TName extends string>(name: TName)` |
| `bigint` PK | `bigint(name, { mode: 'number' })` | `mode: 'number'` → JS `number` (safe to 2^53); `'bigint'` → `BigInt` |
| Generated column | `.generatedAlwaysAs(sql\`...\`)` | `generatedAlwaysAs(as: SQL \| T['data'] \| (() => SQL))` |
| Upsert | `.onConflictDoUpdate({ target, set, targetWhere?, setWhere? })` | `target: IndexColumn \| IndexColumn[]; set: PgUpdateSetSource<...>` |
| Insert-if-absent | `.onConflictDoNothing({ target?, where? })` | |

Note: `generatedAlwaysAsIdentity` is **not** on the column-builder type in 0.45.2's `common.d.ts`. Use `bigserial({ mode: 'number' })` for the primary keys, or `sql` in a hand-reviewed migration if `GENERATED ALWAYS AS IDENTITY` is specifically wanted. The `generate` → review → `migrate` workflow makes the reviewed-SQL route cheap.

### The Phase-1 schema

```ts
// src/db/schema.ts — additions. `agentdock` is the existing pgSchema export.
import {
  bigserial, boolean, index, integer, jsonb, text, timestamp, unique, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const repository = agentdock.table(
  'repository',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    // Immutable across rename AND transfer. Verified present unauthenticated.
    githubNodeId: text('github_node_id').notNull(),
    fullName: text('full_name').notNull(),        // MUTABLE display value
    owner: text('owner').notNull(),
    defaultBranch: text('default_branch').notNull(),
    description: text('description'),
    homepage: text('homepage'),                   // API returns "" not null — normalize
    licenseSpdx: text('license_spdx'),            // null is the COMMON case (PRV-06)
    stars: integer('stars').notNull().default(0),
    isFork: boolean('is_fork').notNull().default(false),
    isArchived: boolean('is_archived').notNull().default(false),
    topics: text('topics').array().notNull().default(sql`'{}'::text[]`),
    pushedAt: timestamp('pushed_at', { withTimezone: true }),      // upstream change
    scannedAt: timestamp('scanned_at', { withTimezone: true }),    // AgentDock looked
    etag: text('etag'),                           // DAT-04; no quota saving until a token exists
    lastIngestedSha: text('last_ingested_sha'),
    treeTruncated: boolean('tree_truncated').notNull().default(false),  // ING-07
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('repository_node_id_key').on(t.githubNodeId),
    uniqueIndex('repository_full_name_key').on(sql`lower(${t.fullName})`),
    index('repository_stars_idx').on(t.stars.desc()),
  ],
);

export const packageTable = agentdock.table(
  'package',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    repositoryId: bigserial('repository_id', { mode: 'number' })
      .notNull()
      .references(() => repository.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),                 // 'skill' only in this phase
    sourcePath: text('source_path').notNull(),    // 'skills/canvas-design/SKILL.md'
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    summary: text('summary'),
    licenseText: text('license_text'),            // frontmatter `license` — free prose
    meta: jsonb('meta').notNull().default(sql`'{}'::jsonb`),
    delistedAt: timestamp('delisted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // DAT-02: stable across re-ingestion AND across repo rename (repositoryId is stable)
    unique('package_identity').on(t.repositoryId, t.type, t.sourcePath),
    index('package_live_idx').on(t.type, t.updatedAt.desc()),
  ],
);
// NOTE: no search_tsv column and no pg_trgm index in this phase.
// pg_trgm is not installed and must not be installed here (locked decision).

export const packageVersion = agentdock.table(
  'package_version',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    packageId: bigserial('package_id', { mode: 'number' })
      .notNull()
      .references(() => packageTable.id, { onDelete: 'cascade' }),
    commitSha: text('commit_sha').notNull(),      // COMMIT sha — permalinks 404 on a tree sha
    blobSha: text('blob_sha'),
    contentHash: text('content_hash').notNull(),  // sha256(normalized frontmatter + body)
    declaredVersion: text('declared_version'),    // non-spec `version:`; null => "not declared"
    body: text('body'),                           // capped excerpt (PRV-07)
    frontmatter: jsonb('frontmatter').notNull().default(sql`'{}'::jsonb`),
    parseStatus: text('parse_status').notNull().default('ok'),   // ok | partial | failed
    parseErrors: jsonb('parse_errors').notNull().default(sql`'[]'::jsonb`),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // DAT-03 + ING-13: identical content re-ingested is ON CONFLICT DO NOTHING
    unique('package_version_content_key').on(t.packageId, t.contentHash),
    index('package_version_recent_idx').on(t.packageId, t.ingestedAt.desc()),
  ],
);

// DAT-06: survives re-crawling
export const repositoryDenylist = agentdock.table('repository_denylist', {
  fullName: text('full_name').primaryKey(),       // store lowercased
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

### Idempotent upsert — the exact calls

```ts
// Repository: keyed on the immutable node id, so a rename is an UPDATE.
const [repo] = await tx
  .insert(repository)
  .values(row)
  .onConflictDoUpdate({
    target: repository.githubNodeId,
    set: {
      fullName: row.fullName, owner: row.owner, description: row.description,
      stars: row.stars, isArchived: row.isArchived, pushedAt: row.pushedAt,
      scannedAt: row.scannedAt, licenseSpdx: row.licenseSpdx, etag: row.etag,
      treeTruncated: row.treeTruncated, lastIngestedSha: row.lastIngestedSha,
      updatedAt: sql`now()`,
    },
  })
  .returning();

// Package: composite target — pass an ARRAY of columns.
const [pkg] = await tx
  .insert(packageTable)
  .values(pkgRow)
  .onConflictDoUpdate({
    target: [packageTable.repositoryId, packageTable.type, packageTable.sourcePath],
    set: { name: pkgRow.name, summary: pkgRow.summary, meta: pkgRow.meta,
           delistedAt: null, updatedAt: sql`now()` },
  })
  .returning();

// Version: identical content is a genuine no-op. ING-13 falls out of the constraint.
await tx
  .insert(packageVersion)
  .values(versionRow)
  .onConflictDoNothing({
    target: [packageVersion.packageId, packageVersion.contentHash],
  });
```

Two things to get right:

1. **`onConflictDoUpdate` targets a unique *index or constraint*, and the columns must match one exactly.** `unique('package_identity').on(repositoryId, type, sourcePath)` creates it; the array in `target` must list the same three columns in the same order.
2. **Delisting must happen in the same transaction as the upserts.** After writing every package found in this scan, `UPDATE package SET delisted_at = now() WHERE repository_id = $1 AND delisted_at IS NULL AND id <> ALL($2)`. Doing it before the upserts leaves a window where a live package reads as delisted; doing it in a separate transaction leaves that window permanently open on a crash.

### `content_hash` normalization

The hash defines version identity, so define it once and test it:

```ts
// sha256 over the raw UTF-8 bytes, with only line endings normalized.
// CRLF-only commits must not mint a new version; anything else must.
const canonical = raw.replace(/\r\n/g, '\n');
const contentHash = createHash('sha256').update(canonical, 'utf8').digest('hex');
```

Do not hash the *parsed* object: key order and YAML type coercion make that unstable across `js-yaml` versions, and a dependency bump would silently mint a version for every row in the database.

---

## 7. Testing ingestion without GitHub

### The recommendation: injection for detectors, `vi.stubGlobal` for the client

**Detectors need no mocking at all.** The `Detector` interface in `ARCHITECTURE.md` already takes `read: (path: string) => Promise<string>` as a parameter. That is dependency injection, already designed in. Pass a `Map`:

```ts
// src/detect/skill.test.ts — no network, no token, no mock library.
import { readFileSync, readdirSync } from 'node:fs';
import { skill } from './skill';

const fixture = (name: string) => {
  const dir = new URL(`../../fixtures/${name}/`, import.meta.url);
  const tree = JSON.parse(readFileSync(new URL('tree.json', dir), 'utf8'));
  const files = new Map<string, string>(
    readdirSync(new URL('files/', dir)).map((f) => [
      decodeURIComponent(f),
      readFileSync(new URL(`files/${f}`, dir), 'utf8'),
    ]),
  );
  const read = async (p: string) => {
    const v = files.get(p);
    if (v === undefined) throw new Error(`fixture missing ${p}`);
    return v;
  };
  return { tree, read };
};

test('finds all 18 skills in anthropics/skills', async () => {
  const { tree, read } = fixture('anthropics-skills');
  const candidates = skill.match(tree.tree);
  expect(candidates).toHaveLength(18);
  const results = await Promise.all(candidates.map((c) => skill.parse(c, read)));
  expect(results.filter((r) => r.ok)).toHaveLength(18);
});
```

**For `src/github/client.ts`, use `vi.stubGlobal('fetch', ...)`.** Vitest 4.1.10 is installed and supports it (`unstubGlobals` config option present in `node_modules/vitest/dist/chunks/reporters.d.*.d.ts`). `[VERIFIED: node_modules/vitest@4.1.10]`

```ts
import { afterEach, expect, test, vi } from 'vitest';
afterEach(() => vi.unstubAllGlobals());

test('does not follow a redirect off the allowlist', async () => {
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(null, { status: 301, headers: { location: 'https://evil.tld/x' } }),
  ));
  await expect(getRepo('a', 'b')).rejects.toThrow(/redirect/i);
});
```

**Why not MSW:** it is a whole HTTP interception layer (a service worker in the browser, an interceptor in Node) to test roughly six call sites, and it adds a dependency plus a server lifecycle to every suite. It earns its place when there are many endpoints and shared handlers across suites. There are two endpoints here.

**Why not a hand-rolled injected `HttpClient` interface:** it is an interface with exactly one production implementation, created only to make a test possible — the abstraction the ponytail ladder exists to refuse. `vi.stubGlobal` tests the real code path including the real `fetch` call, which is the thing that can be wrong.

`// ponytail: vi.stubGlobal over MSW; adopt MSW if the endpoint count passes ~10 and handlers start being shared`

### Fixture corpus — capture these exact SHAs

Frozen this session and verified reachable. Capture `tree.json` plus the `SKILL.md` bodies from `raw.githubusercontent.com` at these pins, commit them under `fixtures/`, and never refetch:

| Repo | Commit SHA (pin) | Tree entries | `SKILL.md` | Why it is in the corpus |
|------|------------------|--------------|------------|-------------------------|
| `anthropics/skills` | `f17010c9bb483898c1d9c9f42dde2b3a98889434` | 501 | 18 | Canonical. Contains the `name`≠dir violation and the 1,077-char description. `license: null` at repo level. |
| `addyosmani/agent-skills` | `7676817c12a1317454ae3898a0c5c1eacf5dd3d5` | 261 | 24 | Clean spec-conformant baseline: only `name` + `description`. |
| `JimLiu/baoyu-skills` | `6b7a2e417500561a5ecdd0b168332f4142584617` | 1,077 | 22 | Nested `metadata`, non-ASCII descriptions, skills under both `.claude/skills/` and `skills/`. |
| `wshobson/agents` | `c4b82b0ad771190355eb8e204b1329732a18449a` | 1,992 | **180** | Scale + `plugins/*/skills/*/SKILL.md` nesting + non-spec `version:`. |

Add hand-written adversarial fixtures alongside: the [XSS corpus](#xss-fixture-corpus), a `truncated: true` tree, a `SKILL.md` with no frontmatter fence, one with unparseable YAML, one with duplicate keys, one 600 KB body, and the alias bomb below.

### SSRF fixture corpus

Table-driven; every one must be rejected **before any network call**, asserted by a `fetch` stub that fails the test if called:

```
"https://github.com/anthropics/skills"      → reject (not owner/repo)
"anthropics/skills/../../etc/passwd"        → reject
"anthropics/skills?x=1"                     → reject
"anthropics/skills#frag"                    → reject
"anthropics/skills/tree/main"               → reject (extra segment)
"http://169.254.169.254/latest/meta-data"   → reject
"localhost:5432/x"                          → reject
"anthropics@evil.tld/skills"                → reject
"../../anthropics/skills"                   → reject
"a".repeat(500) + "/b"                      → reject (length bound)
"anthropics/skills\n"                       → reject after trim? assert exact behaviour
"ANTHROPICS/Skills"                         → ACCEPT (GitHub names are case-insensitive)
"anthropics/skills"                          → ACCEPT
```

Plus redirect tests: a 301 to `https://evil.tld` (reject), to `http://api.github.com` (reject — scheme downgrade), to `https://api.github.com/repositories/123` (**accept** — the real rename case), and a 3-hop chain (reject at hop 3).

### Nyquist sampling rate

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.10 (installed) |
| Config | `vitest.config.ts` (exists) |
| Quick run (per task commit) | `bun run test` — full suite is still seconds at this size |
| Full suite (per wave merge) | `bun run ci` (boundaries → lint → typecheck → test) |
| Phase gate | `bun run ci` green, plus the XSS and SSRF suites green |

Existing `vitest.config.ts` loads `.env` only when `CI` is unset, so DB-backed tests skip visibly in CI. Detector, parser, sanitizer, and SSRF tests must have **no** DB dependency so they run in CI unconditionally — that is the QUA-05 guarantee.

**Wave 0 gaps:**
- [ ] `fixtures/` directory with the four pinned trees + bodies
- [ ] `src/detect/skill.test.ts` — DET-01, DET-10
- [ ] `src/detect/frontmatter.test.ts` — DET-08 (YAML safety, caps, malformed input)
- [ ] `src/github/client.test.ts` — ING-02, ING-03, ING-06 (SSRF + caps)
- [ ] `src/components/SkillBody.test.tsx` — REN-01, REN-04 (needs `environment: 'jsdom'` or `renderToStaticMarkup` from `react-dom/server`; prefer the latter, no new dependency)
- [ ] `src/ingest/persist.test.ts` — ING-13, DAT-02, DAT-03 (DB-backed; skips in CI)

`renderToStaticMarkup` is already available via the installed `react-dom` and needs no jsdom, no `@testing-library/react`, and no environment switch. Use it. `// ponytail: renderToStaticMarkup over jsdom + RTL; the assertion is "this string does not contain <script"`

---

## YAML parsing — verified safe configuration

### Use `js-yaml@4.3.1` with `CORE_SCHEMA`

Empirically verified this session against `js-yaml@4.3.1`. `[VERIFIED: js-yaml@4.3.1, executed 2026-08-10]`

```
CORE_SCHEMA rejects !!js/function:      YES: YAMLException
CORE_SCHEMA on "d: 2020-01-01":         {"d":"2020-01-01"}      ← a string
DEFAULT_SCHEMA on "d: 2020-01-01":      [object Date]           ← a Date
duplicate keys "a: 1\na: 2":            THROWS
```

`DEFAULT_SCHEMA` is `core.extend({ implicit: [timestamp, merge], explicit: [binary, omap, pairs, set] })` `[VERIFIED: github.com/nodeca/js-yaml/blob/4.1.0/lib/schema/default.js]`. Neither schema contains `!!js/function` — those types live in the separate `js-yaml-js-types` package, which is why `safeLoad` was removed in v4 (*"Function yaml.safeLoad is removed in js-yaml 4. Use yaml.load instead, which is now safe by default."* `[VERIFIED: js-yaml 4.1.0 index.js]`).

**`CORE_SCHEMA` is still the better choice** for three concrete reasons, none of them about RCE:
1. It returns plain JSON-serializable values. `DEFAULT_SCHEMA` returns `Date` for `!!timestamp` and `Buffer` for `!!binary` — neither round-trips through a `jsonb` column the way you expect, and both change what `content_hash` sees if you ever hash the parsed form.
2. It excludes `!!merge` (`<<`), removing an alias-amplification vector for free.
3. It is a smaller attack surface for zero cost, because the corpus does not use any of the excluded types.

```ts
import yaml from 'js-yaml';

const parsed = yaml.load(frontmatterText, {
  schema: yaml.CORE_SCHEMA,
  json: false,      // duplicate keys throw -> parse_status='failed', which is correct
  filename: sourcePath,   // appears in YAMLException.message; a repo path, not a secret
});
```

### The alias bomb lands on `JSON.stringify`, not on `load()`

Measured this session with an 8-level ×9 alias bomb:

```
yaml.load(bomb, { schema: CORE_SCHEMA })  → parsed in 2 ms
shared references?                        → true  (r.b[0] === r.b[1])
JSON.stringify(result).length             → 205,817,161   ← 205 MB
```

`js-yaml` stores aliases as **shared object references**, so the parse is O(document size). The exponential expansion only materializes when something walks the graph — and the very next thing this pipeline does is serialize the frontmatter into a `jsonb` column.

**Therefore the cap must be applied to the serialized output:**

```ts
const parsed = yaml.load(text, { schema: yaml.CORE_SCHEMA, json: false });

// The input cap (64 KB) does NOT protect this. An 800-byte document expands
// to 205 MB of JSON through aliases. Measured, not theoretical.
const serialized = JSON.stringify(parsed);
if (serialized.length > 256 * 1024) {
  return { ok: false, status: 'failed', errors: ['frontmatter expands beyond the size cap'] };
}
```

An input-size cap alone — the obvious defence, and the one `ARCHITECTURE.md` proposes — does **not** stop this. Both caps are needed.

`// ponytail: input cap + serialized cap instead of an alias-depth limiter; add depth accounting only if a real repo trips both`

### Do NOT use `gray-matter`

It is the obvious "parse frontmatter" package and it is the wrong choice here. Its dependency set is `{ 'js-yaml': '^3.13.1', 'kind-of': ^6, 'section-matter': ^1, 'strip-bom-string': ^1 }` `[VERIFIED: npm view gray-matter dependencies]` — that is **js-yaml v3**, whose `load()` is the unsafe one (v3 is where `safeLoad` still had to be called explicitly). `gray-matter` also supports pluggable engines including a JavaScript engine that **evaluates** `---js` frontmatter. Feeding attacker-controlled supply-chain content to it is exactly the thing ING-10 forbids.

Splitting the fence yourself is ~5 lines and strictly safer:

```ts
const FENCE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
export function splitFrontmatter(src: string) {
  const text = src.charCodeAt(0) === 0xfeff ? src.slice(1) : src;   // BOM
  const m = FENCE.exec(text);
  if (!m) return null;
  return { frontmatter: m[1], body: text.slice(m[0].length) };
}
```

---

## Don't Hand-Roll

| Problem | Don't build | Use instead | Why |
|---------|-------------|-------------|-----|
| YAML frontmatter parsing | `key: value` line splitter | `js-yaml@4.3.1` + `CORE_SCHEMA` | Real corpus has block scalars (`\|-`), double-quoted strings with escaped quotes, nested maps, and arrays. Measured. |
| Frontmatter fence splitting | `gray-matter` | 5 lines of regex | `gray-matter` pulls js-yaml **v3** and supports a JS engine that evaluates frontmatter |
| Markdown → HTML | `marked` + `DOMPurify` + `dangerouslySetInnerHTML` | `react-markdown` + `rehype-sanitize` | Renders to React elements; no `dangerouslySetInnerHTML` exists to get wrong |
| HTML sanitization | An element/attribute blocklist | `rehype-sanitize` default schema, narrowed | The default is an **allowlist** with protocol restrictions. Blocklists lose to `<svg/onload>`, mXSS, and the next parser quirk. |
| SSRF defence | URL string checks | Accept `owner/repo`, construct the URL from validated parts | Defeats `github.com.evil.tld`, userinfo tricks, and DNS rebinding **by construction** |
| Repo file enumeration | Contents API directory walk, tarball, `git clone` | One Trees call `?recursive=1` | 1 core call vs N; no disk, so no zip-slip and no path traversal to defend |
| File bodies | Contents API | `raw.githubusercontent.com` pinned to the commit SHA | **0 core quota — verified**. On a 60/hr budget this is the whole design. |
| Idempotency | `SELECT` then `INSERT` | `UNIQUE` + `onConflictDoNothing` | The app-level version races; the constraint cannot |
| HTTP mocking | An `HttpClient` interface with one impl | `vi.stubGlobal('fetch', …)` | An interface created only for a test is the abstraction to refuse |
| Rate-limit math | Local counters | `x-ratelimit-*` headers + `GET /rate_limit` (free) | The server's number is the true one; a local counter drifts |
| Commit SHA lookup | Extra `GET /commits/{branch}` | The `sha` from the Trees response | Verified identical on two repos; saves a call from a 60/hr budget |
| Theme switching | JS toggle + localStorage + anti-FOUC inline script | `color-scheme: light dark` + `prefers-color-scheme` | The inline script is exactly what the nonce CSP is there to forbid |

**Key insight:** every custom solution in this domain is a security control in disguise. A hand-rolled YAML splitter is a parser-differential bug; a hand-rolled sanitizer is an XSS; a hand-rolled URL validator is an SSRF. The libraries are not saving typing — they are the reviewed implementations of controls this phase cannot afford to get subtly wrong.

---

## Common Pitfalls

### Pitfall 1: using the tree SHA as the permalink SHA
**What goes wrong:** Every "view source at the indexed commit" link 404s.
**Why:** `GET /git/trees/{ref}` names its parameter `tree_sha`, and `commit.tree.sha` is a real, adjacent, plausible value. A developer who reads the parameter name and reaches for `commit.tree.sha` gets a valid-looking 40-hex string that is wrong.
**Avoid:** Take `sha` from the Trees response body (verified = commit SHA). Assert `/^[0-9a-f]{40}$/`.
**Warning sign:** `raw.githubusercontent.com` works fine — it accepts **both** SHAs (verified 200 for each). Only the `github.com/.../blob/` permalink fails. Test the permalink, not the raw URL.

### Pitfall 2: a strict Zod schema silently discards a quarter of the corpus
**What goes wrong:** `z.object({...}).strict()` with `z.record(z.string())` on `metadata` rejects the 24 `version`-bearing files and the 20 nested-`metadata` files out of 100 sampled.
**Why:** The spec reads like a schema, so it gets transcribed as one.
**Avoid:** Two layers — a permissive parse that produces a row, and a conformance check that produces warnings. Never let the conformance check block the insert.
**Warning sign:** Any `.strict()` in `src/detect/`. Any `parse()` that is not `safeParse()`. A test asserting a non-conforming skill is *rejected* rather than *recorded as partial*.

### Pitfall 3: the size cap is on the input, so the alias bomb still wins
**What goes wrong:** An 800-byte `SKILL.md` passes a 64 KB input cap, parses in 2 ms, and produces a 205 MB `JSON.stringify` on the way into `jsonb`.
**Why:** "Cap the input" is the natural reading of billion-laughs advice, and it is wrong for a parser that shares alias references.
**Avoid:** Cap `JSON.stringify(parsed).length` as well. Both caps, separately enforced.
**Warning sign:** A single `if (text.length > CAP)` and nothing after `yaml.load`.

### Pitfall 4: a permissive `owner/repo` regex reopens SSRF
**What goes wrong:** `/^[\w-]+\/[\w.-]+$/` without anchors, or with `.` unescaped in a character class it does not belong in, accepts `../..`, `a/b/../c`, or a newline-terminated value that later gets interpolated into a URL.
**Why:** The validation is written as a form check, not as a trust boundary, and the Server Action is reachable by direct POST — Next documents this explicitly.
**Avoid:** Anchored, length-bounded, and validated **before** any string reaches URL construction:
```ts
const OWNER_REPO = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
```
Then build the URL from the two captured parts with `encodeURIComponent`, never from the original string.
**Warning sign:** No `^`/`$`. `new URL(userInput)` anywhere. A test suite with only happy-path inputs. Success criterion 4 requires asserting **no network call is made** — stub `fetch` to throw.

### Pitfall 5: forgetting `dynamic = 'force-dynamic'` on a new DB-reading page
**What goes wrong:** The listing page is prerendered at build time. Newly ingested skills never appear. Or `next build` fails in CI because there is no database.
**Why:** `dynamic` defaults to `'auto'`, and a Drizzle query is not a request-time API, so nothing opts the route into dynamic rendering.
**Avoid:** `export const dynamic = 'force-dynamic'` on every page that touches PostgreSQL. `src/app/page.tsx` already does this — copy the pattern *and its comment*.
**Warning sign:** `next build` succeeds locally (where `.env` exists) but the listing shows no new rows. A CI build that fails with a connection error is the friendlier symptom.

### Pitfall 6: `redirect()` inside a `try/catch`
**What goes wrong:** The form submits, the ingest succeeds, and the page does not navigate. Silently.
**Why:** `redirect()` throws a control-flow exception, documented verbatim. A `try { … } catch { return { error: 'something went wrong' } }` wrapped around the whole action swallows it and returns a bogus error.
**Avoid:** `redirect()` outside every `try`, as the last statement. `revalidatePath()` before it.
**Warning sign:** An action whose body is one big `try/catch`.

### Pitfall 7: "repository not found" as an error message
**What goes wrong:** A user submits a private repo they can see and is told it does not exist.
**Why:** GitHub returns byte-identical 404s for missing and private — verified.
**Avoid:** Say what is actually known: AgentDock could not read it, and GitHub does not distinguish the two cases.
**Warning sign:** The string "does not exist" anywhere in the error copy.

### Pitfall 8: 180 sequential raw fetches inside a Server Action
**What goes wrong:** `wshobson/agents` has **180** `SKILL.md` files. At ~150 ms each that is ~27 s in one request, and any proxy or platform timeout kills it mid-transaction.
**Why:** Raw fetches cost no quota, so the natural instinct is that they are free. They cost wall clock.
**Avoid:** Concurrency 2, a 200-file cap, a 120 s wall-clock budget, and a partial-result path that persists what was read and marks the rest truncated. Phase 2 makes this asynchronous — do not pre-build that here, but do not let this phase hang either.
**Warning sign:** `await Promise.all(paths.map(fetchRaw))` over an unbounded array.

### Pitfall 9: `license_spdx` populated from frontmatter
**What goes wrong:** The licence facet fills with `"Complete terms in LICENSE.txt"` and `"Proprietary. LICENSE.txt has complete terms"`.
**Why:** The field is called `license` in both places and looks interchangeable.
**Avoid:** Two columns. `repository.license_spdx` from the API's `license.spdx_id` (often `null` — it is `null` for `anthropics/skills`). `package.license_text` from frontmatter, rendered as free prose, never faceted.
**Warning sign:** One `license` column fed by whichever source is non-empty.

### Pitfall 10: assuming `updated_at` is the upstream-change timestamp
**What goes wrong:** PRV-02's "last changed upstream" moves whenever the star count refreshes.
**Why:** `pushed_at` and `updated_at` both look like the answer. On `anthropics/skills` they differ by 3 days (`pushed_at: 2026-08-07T17:14:15Z`, `updated_at: 2026-08-10T07:01:39Z`).
**Avoid:** `pushed_at` for upstream change; your own `scanned_at` for when AgentDock looked. Ignore `updated_at`.

---

## State of the Art

| Old approach | Current approach | When changed | Impact here |
|---|---|---|---|
| `middleware.ts` | **`proxy.ts`** (`(?:src/)?proxy`) | Next 16 | The CSP nonce file is `src/proxy.ts`; `middleware` still resolves |
| `params`/`searchParams` synchronous | **Promises** | Next 15 RC | `await params` everywhere; `?a=1&a=2` yields `string[]` |
| `fetch` cached by default | **Not cached by default** | Next 15 | GitHub calls need no opt-out |
| Route-level caching implicit | **Cache Components (`cacheComponents: true`) opt-in**, `use cache` | Next 16 | Not enabled here; the "previous model" guide applies |
| `pgTable(name, cols, (t) => ({ ... }))` | **`(t) => [ ... ]`** (array) | Drizzle ~0.36 | Object form is `@deprecated` in the installed 0.45.2 typings |
| `yaml.safeLoad()` | **`yaml.load()`, safe by default** | js-yaml 4 | v4 throws a named error if `safeLoad` is called |
| GitHub Code Search for discovery | **Dead for this purpose** | — | Requires auth, 10 req/min, cannot express "files named X" |
| GraphQL for batched repo metadata | **Unavailable unauthenticated** (limit 0) | — | REST-only in this phase |

**Deprecated / not applicable here:**
- `drizzle-kit push` / `pull` — banned by locked decision, and destructive against a shared database.
- `rehype-raw` — never, in any configuration, in this project.
- `gray-matter` — pulls js-yaml v3 and supports an evaluating JS engine.
- Conditional-request quota savings — verified **not** to apply unauthenticated (304 consumed quota).

---

## Package Legitimacy Audit

Verified via `gsd-tools query package-legitimacy check --ecosystem npm` plus `npm view`, 2026-08-10.

| Package | Registry | Latest published | Weekly downloads | Source repo | Verdict | Disposition |
|---------|----------|------------------|------------------|-------------|---------|-------------|
| `react-markdown` | npm | 2025-03-07 (10.1.0) | 30,391,695 | `github.com/remarkjs/react-markdown` | **OK** | Approved |
| `remark-gfm` | npm | 2025-02-10 (4.0.1) | 35,039,689 | `github.com/remarkjs/remark-gfm` | **OK** | Approved |
| `rehype-sanitize` | npm | 2023-08-26 (6.0.0) | 8,852,414 | `github.com/rehypejs/rehype-sanitize` | **OK** | Approved |
| `js-yaml` | npm | 2026-08-01 (5.2.3) | 292,265,394 | `github.com/nodeca/js-yaml` | **SUS** (`too-new`) | **Approved at `4.3.1`, not `5.x`** |

`postinstall` is `null` for all four (checked individually with `npm view <pkg> scripts.postinstall`; none produced output).

**On the `js-yaml` SUS verdict.** The seam flags `too-new` because the current `latest` (5.2.3) was published nine days ago. The *package* is not new — 292M weekly downloads, a 2011 repository — but the **5.x major line genuinely is**: `5.0.0` shipped `2026-06-20`, under eight weeks ago, and five patch releases have followed in that window. That release cadence on a brand-new major, in a parser that eats attacker-controlled supply-chain input, is a real signal rather than a false positive.

**Recommendation: pin `js-yaml@4.3.1`**, the head of the `v4-legacy` dist-tag (`{"latest":"5.2.3","v4-legacy":"4.3.1","v3-legacy":"3.15.1"}`). The v4 line is five years mature, still maintained (4.3.1 published 2026-07-31), and every safety property required here was verified against 4.3.1 directly this session: `CORE_SCHEMA` rejects `!!js/function`, duplicate keys throw, timestamps stay strings. Nothing in 5.x is needed.

The planner should **not** add a `checkpoint:human-verify` for this — the SUS reason is understood, documented, and resolved by pinning a different version of the same package. Note the pin decision in the plan so a future `bun update` does not silently jump the major.

**Packages removed due to SLOP:** none.
**Packages flagged SUS:** `js-yaml` — resolved by pinning `4.3.1`.
**Explicitly rejected:** `gray-matter` (js-yaml v3 + evaluating JS engine), `rehype-raw` (defeats REN-01), `msw` (see [testing](#7-testing-ingestion-without-github)), `rehype-highlight`/`shiki` (not required by any Phase-1 requirement).

---

## Environment Availability

| Dependency | Required by | Available | Version | Fallback |
|---|---|---|---|---|
| Node.js | Next runtime, Vitest | ✓ | v22.22.3 | — |
| PostgreSQL 16 | everything | ✓ | in use as `agentdock_app` | — |
| `api.github.com` | ING-01/04 | ✓ | reachable, **60/hr unauthenticated** | none — hard ceiling |
| `raw.githubusercontent.com` | ING-04 | ✓ | reachable, 0 quota | none |
| `GITHUB_TOKEN` | 5,000/hr | **✗ empty** | — | **Run unauthenticated at 60/hr** |
| `pg_trgm` | DIS-04 (Phase 6) | ✗ | — | not needed in this phase; must not be installed |
| GraphQL API | batched metadata | **✗ limit 0** | — | REST `/repos/{o}/{r}` |
| `agentdock_test` schema | DB-backed tests | ✓ | exists | tests skip when `.env` absent |

**Missing with no fallback:** none blocks this phase.

**Missing with a fallback — the one that shapes the phase:** `GITHUB_TOKEN` is empty, so core is **60 requests/hour = 30 repository ingests/hour**. This must be surfaced, not absorbed:

1. `GITHUB_TOKEN` stays **optional** in the Zod env schema (`z.string().optional()`), and the client attaches `Authorization: Bearer` only when it is a non-empty string. Never log it; strip it from any serialized error (FND-08, ING-09).
2. Before each ingest, read `x-ratelimit-remaining` from the previous response (or `GET /rate_limit`, which is free). If `< 2`, refuse before making a call and tell the user when the window resets — `x-ratelimit-reset` is UTC epoch seconds.
3. The submit page states the current mode and the remaining budget. "Unauthenticated: 55 of 60 requests left this hour, resets at 16:56" is honest and turns a mystery failure into an understood one.
4. `.env.example` already documents that `GITHUB_TOKEN` needs no scopes (FND-07, done in Phase 0). Add one line: with no token, AgentDock indexes ~30 repositories per hour.

---

## Security Domain

### Applicable ASVS categories

| ASVS category | Applies | Standard control in this phase |
|---|---|---|
| V2 Authentication | **No** | Everything is read-only over public data. Auth is explicitly out of scope for v1. |
| V3 Session Management | **No** | No sessions, no cookies. |
| V4 Access Control | **Partial** | The Server Action is reachable by direct POST (Next documents this). Its control is input validation, not identity. |
| V5 Input Validation | **Yes** | `owner/repo` regex (ING-02); Zod on `searchParams`; Zod on frontmatter; input **and serialized** size caps |
| V6 Cryptography | **Partial** | `sha256` for `content_hash` via `node:crypto` — an integrity key, not a secret. Nothing hand-rolled. |
| V7 Error Handling & Logging | **Yes** | QUA-06/07: structured logs of `{owner, repo, sha, status, durationMs}`; never a token, never a response body |
| V12 Files & Resources | **Yes** | ING-05/06: nothing written to disk; streaming byte caps; no archive extraction |
| V13 API & Web Service | **Yes** | ING-02/03: hardcoded host allowlist, `redirect: 'manual'`, re-validate every hop |
| V14 Configuration | **Yes** | REN-02: CSP via `src/proxy.ts`; security headers via `next.config.ts` |

### Threat patterns for this stack

| Pattern | STRIDE | Standard mitigation |
|---|---|---|
| Stored XSS via `SKILL.md` body | Tampering / EoP | `react-markdown` without `rehype-raw` + `rehype-sanitize` allowlist + nonce CSP. **6 of 100 real sampled files contain HTML-ish content** — this fires on legitimate input. |
| Stored XSS via frontmatter `name`/`description` reaching `<title>`/`<meta>` | Tampering | React escapes; **do not add a JSON-LD `dangerouslySetInnerHTML` block in this phase** |
| SSRF via the submit field | Info disclosure | Accept `owner/repo`, construct URLs from validated parts, hardcoded host allowlist |
| SSRF via redirect | Info disclosure | `redirect: 'manual'` (verified to return a readable 301 in Node 22), re-validate host, cap at 2 hops |
| SSRF via URLs found inside repo content | Info disclosure | ING-11: extract and display, never resolve. Structurally impossible given the allowlist. |
| YAML deserialization RCE | EoP | `js-yaml@4` `CORE_SCHEMA` — verified to reject `!!js/function` |
| Resource exhaustion via YAML aliases | DoS | **Cap `JSON.stringify(parsed).length`** — the input cap does not catch this. Measured: 800 bytes → 205 MB. |
| Resource exhaustion via a large repo | DoS | 200-file cap, 512 KB/file, 120 s wall clock, concurrency 2 |
| Path traversal / zip slip | Tampering | Eliminated by construction — nothing is written to disk, no archive is opened |
| Prompt injection reaching a downstream agent | Tampering | ING-10 + the no-LLM-enrichment rule. Invisible-character sentinels are Phase 4 (CAP-06/07); this phase must **retain raw bytes** so Phase 4 has something to work with. |
| False-assurance verdict | — | CAP-10: no risk score, grade, or the words *safe*/*clean*/*verified*/*trusted*/*approved*. Add the vocabulary lint in Phase 4, but **do not write those words now** — they are cheaper to never introduce. |

---

## Assumptions Log

| # | Claim | Section | Risk if wrong |
|---|---|---|---|
| A1 | The Trees API's `sha` will keep being the commit SHA when a ref name is passed. Verified on two repos today; **not documented**. | [Finding 1](#finding-1-the-trees-api-hands-you-the-commit-sha-verified) | Every PRV-01 permalink 404s. **Mitigation: assert 40-hex, plus one integration test that fetches the `blob/` permalink and asserts 200.** |
| A2 | The 403/429 rate-limit *body* shape. Only the header semantics were verified; the exhaustion response was never observed (doing so would burn the 60/hr budget). | [403 vs 429](#403-vs-429-vs-404--how-to-distinguish) | Error handling mis-branches under exhaustion. Mitigation: branch on headers, not status; test with a stubbed response. |
| A3 | ~150 ms per `raw.githubusercontent.com` fetch, used to size the 120 s wall-clock budget. Not benchmarked at volume. | [Resource caps](#resource-caps-concrete-numbers) | A 180-file repo times out. Mitigation: the cap is a budget with a partial-result path, not a hard assumption. |
| A4 | Non-spec `version:` is the right source for `declared_version`. It appears in 24% of the sample but is in neither the spec nor the Claude Code field table. | [Real-world variance](#2-real-world-skillmd-variance--measured-not-assumed) | A field that means something else gets rendered as a version. Low blast radius; PRV-05 already forbids inventing one. |
| A5 | `renderToStaticMarkup` is sufficient for the XSS suite, with no jsdom. `react-dom` is installed but this was not executed. | [Testing](#7-testing-ingestion-without-github) | Needs `environment: 'jsdom'` and possibly `@testing-library/react`. One-line config change. |
| A6 | `bun run typecheck` works without a prior `next typegen` when `PageProps<'/route'>` is used. Docs say types are generated during `dev`/`build`/`typegen`. | [searchParams](#searchparams-and-params-are-promises--exact-shape) | CI typecheck fails on a clean checkout. Mitigation: add `next typegen` before `tsc --noEmit`, or use explicit `Promise<...>` prop types instead of the helper. |
| A7 | The `js-yaml` 5.x line is not worth adopting yet. A judgement call from release cadence, not a known defect. | [Package audit](#package-legitimacy-audit) | Pinning 4.3.1 is conservative and costs nothing. Revisit when 5.x is ~6 months old. |
| A8 | Dropping `img` from the sanitizer allowlist is acceptable. No requirement asks for images in skill bodies; it is a product judgement. | [Sanitize schema](#the-default-rehype-sanitize-schema--what-it-does-and-does-not-do) | Bodies with meaningful diagrams render without them. **Worth a maintainer decision during discuss-phase.** |

---

## Open Questions

1. **Does the maintainer want to create a `GITHUB_TOKEN` before this phase ships?**
   - Known: unauthenticated = 60/hr = 30 repo ingests/hour, GraphQL unavailable, conditional requests save nothing.
   - Unclear: whether 30/hour is acceptable for a single-maintainer submit-driven phase.
   - Recommendation: **ship unauthenticated.** 30 repos/hour is far above manual submission rate, and the token is a one-line env change later. The design must not *assume* a token; it should merely use one if present.

2. **`img` in rendered bodies: drop or proxy?**
   - Known: the default schema permits any `https://` src; CSP `img-src 'self'` blocks them anyway, producing broken images plus console noise.
   - Recommendation: drop `img`/`source`/`picture` from `tagNames` in this phase and render a small "image omitted" placeholder. An image proxy is a whole subsystem and no requirement asks for one.

3. **Does an artifact-type lookup table earn its place at one type?**
   - `ARCHITECTURE.md` proposes `artifact_type` as a table so a sixth type is an `INSERT`. In this phase there is exactly one type.
   - Recommendation: **create it now.** It is three lines of DDL and one seed row, and adding an FK to an already-populated `package` table later is a migration against live data. This is the one place where building slightly ahead is cheaper than not.

4. **`repository_alias` for renames — now or later?**
   - Known: `node_id` handles identity; only inbound *URLs* break on rename, and the URL shape is `/r/{owner}/{repo}/...`.
   - Recommendation: **later.** `ARCHITECTURE.md` already names the trigger ("first reported broken inbound link"). No user data hangs off these URLs yet.

5. **Where does the "AgentDock does not check X" disclosure block live in Phase 1?**
   - CAP-09 is a Phase 4 requirement, but Phase 1 already renders skill bodies — the moment a user could mistake rendering for review.
   - Recommendation: put a one-sentence static footer line on the detail page now ("AgentDock reads files; it does not run them and cannot tell you whether an artifact is safe."). Cheap, and it establishes the vocabulary before any judgement word can creep in.

---

## Sources

### Primary (HIGH confidence — verified live this session)
- `https://api.github.com/repos/anthropics/skills` — full response, headers, rate-limit headers
- `https://api.github.com/repos/{owner}/{repo}/git/trees/{ref}?recursive=1` — on `anthropics/skills`, `agentskills/agentskills`, `addyosmani/agent-skills`, `wshobson/agents`, `JimLiu/baoyu-skills`
- `https://api.github.com/repos/{owner}/{repo}/commits/{ref}` — commit SHA vs tree SHA comparison
- `https://api.github.com/rate_limit` — unauthenticated quota, zero-cost confirmation
- `https://raw.githubusercontent.com/...` — 100 real `SKILL.md` files; 0-quota confirmation; response headers
- `https://github.com/{o}/{r}/blob/{sha}/{path}` — commit SHA 200 vs tree SHA 404
- `https://api.github.com/search/repositories?q=topic:agent-skills+stars:>50` — corpus selection
- `npm view` — versions, publish dates, dependencies, `scripts.postinstall` for all recommended packages
- `gsd-tools query package-legitimacy check --ecosystem npm` — verdicts for all four packages
- `node_modules/drizzle-orm@0.45.2/pg-core/*.d.ts` — `pgSchema`, `PgTableFn`, `index`, `uniqueIndex`, `unique`, `timestamp`, `jsonb`, `bigint`, `onConflictDoUpdate`
- `node_modules/next@16.3.0/dist/lib/constants.js` — `PROXY_FILENAME`, `PROXY_LOCATION_REGEXP`, `MIDDLEWARE_FILENAME`
- `node_modules/vitest@4.1.10` — `unstubGlobals` support
- `js-yaml@4.3.1` executed locally — `CORE_SCHEMA` rejects `!!js/function`; timestamp/Date behaviour; duplicate-key throw; alias-bomb parse time and `JSON.stringify` size
- `https://raw.githubusercontent.com/syntax-tree/hast-util-sanitize/main/lib/schema.js` — the complete `defaultSchema`
- `https://raw.githubusercontent.com/syntax-tree/hast-util-sanitize/main/lib/index.js` — `allowComments` / `allowDoctypes` defaults
- `https://raw.githubusercontent.com/nodeca/js-yaml/4.1.0/lib/schema/default.js` and `/index.js` — schema composition, exported schemas, `safeLoad` removal message
- `https://raw.githubusercontent.com/nodeca/js-yaml/4.1.0/lib/loader.js` — the alias-expansion comment
- Node 22.22.3 `fetch` with `redirect: 'manual'` — verified readable 301 with `location`, `type: 'basic'`

### Primary (HIGH confidence — official documentation)
- `https://agentskills.io/specification` — the Agent Skills spec, quoted verbatim
- `https://code.claude.com/docs/en/skills` — Claude Code frontmatter reference and the spec-divergence table
- `https://nextjs.org/docs/app/api-reference/file-conventions/page` (v16.3.0) — `params`/`searchParams` shapes, `PageProps`
- `https://nextjs.org/docs/app/getting-started/mutating-data` (v16.3.0) — Server Actions, `redirect()` throwing, `revalidatePath`
- `https://nextjs.org/docs/app/guides/caching-without-cache-components` (v16.3.0) — the caching model that applies here
- `https://nextjs.org/docs/app/getting-started/caching` (v16.3.0) — Cache Components (opt-in; not used)
- `https://nextjs.org/docs/app/guides/content-security-policy` (v16.3.0) — nonce vs static CSP, dynamic-rendering cost, dev `'unsafe-eval'`
- `https://nextjs.org/docs/app/api-reference/config/next-config-js/headers` (v16.3.0) — `async headers()`
- `https://github.com/remarkjs/react-markdown` — security section, raw-HTML behaviour, `urlTransform`/`components`

### Project-internal
- `.planning/ROADMAP.md`, `.planning/REQUIREMENTS.md`
- `.planning/research/ARCHITECTURE.md`, `PITFALLS.md`, `ECOSYSTEM.md`
- `src/env.ts`, `src/db/client.ts`, `src/db/schema.ts`, `src/app/page.tsx`, `drizzle.config.ts`, `vitest.config.ts`, `package.json`

### Secondary (MEDIUM confidence)
- GitHub Trees API 100,000-entry / 7 MB limit — quoted from `ARCHITECTURE.md`'s prior citation of `docs.github.com/rest/git/trees`, not re-fetched this session. The measured maximum (1,992 entries) is three orders of magnitude below it, so the exact figure is not load-bearing.

---

## Metadata

**Confidence breakdown:**
- Agent Skills spec: **HIGH** — official spec fetched and quoted verbatim; cross-checked against Claude Code docs and 100 real files
- Real-world variance: **HIGH** — 100 files measured this session, not estimated
- GitHub call sequence and costs: **HIGH** — every figure measured live, unauthenticated, with quota deltas
- Sanitizer behaviour: **HIGH** — the actual `defaultSchema` source read, not the README's description of it
- YAML safety and the alias bomb: **HIGH** — executed against the pinned version
- Drizzle API: **HIGH** — read from the installed 0.45.2 typings
- Next.js 16 specifics: **MEDIUM-HIGH** — 16.3.0 docs, self-versioned; the nonce CSP + `force-dynamic` combination is not yet exercised in this repo
- Rate-limit exhaustion handling: **MEDIUM** — header semantics verified, response body assumed (see A2)

**Research date:** 2026-08-10
**Valid until:** 2026-09-09 for the GitHub and Drizzle facts (stable). **2026-08-24** for the Agent Skills spec and the Claude Code field table — the ecosystem is moving fast enough that a 24% non-spec `version:` rate today could be a documented field next month.
