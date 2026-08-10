# Ecosystem & Competitive Landscape

**Domain:** AI agent extension distribution (Agent Skills, plugins, MCP servers, commands, hooks)
**Researched:** 2026-08-10
**Overall confidence:** HIGH for artifact formats and SkillMaru (fetched from official specs and live APIs). MEDIUM for competitor scale numbers (self-reported / third-party blogs).

---

## Executive Verdict

Three findings overturn assumptions currently written into `PROJECT.md`.

**1. Agent Skills is no longer an Anthropic format. It is a governed multi-vendor open standard.**
`SKILL.md` has a published specification at [agentskills.io/specification](https://agentskills.io/specification) with hard constraints (`name` max 64 chars, `description` max 1024, `compatibility` max 500), a reference validator (`skills-ref`), and a public GitHub spec repo ([agentskills/agentskills](https://github.com/agentskills/agentskills), 24,074 stars). The [client showcase](https://agentskills.io/) lists ~48 adopting runtimes including Cursor, Gemini CLI, OpenCode, ChatGPT/Codex, GitHub Copilot, VS Code, Goose, Amp, Roo Code, Kiro, Letta, Factory, Tabnine, and Snowflake Cortex Code.

Consequence: **"cross-ecosystem translation" is not a wedge.** Portability already exists at the format layer. AgentDock must not build a translation or normalization layer for skills — it would be solving a solved problem.

**2. `PROJECT.md` line 58 is now false.** It states "No neutral cross-ecosystem registry with a security lens exists yet." At least eight live directories exist, and [skills.sh](https://www.skills.sh/) is already cross-runtime (20+ agent filters) *and* has a security-audit surface at [skills.sh/audits](https://www.skills.sh/audits). This claim must be corrected before requirements are written.

**3. SkillMaru is not an original product.** It is a self-hosted rebrand of the open-source [openclaw/clawhub](https://github.com/openclaw/clawhub) registry, published as `@cookyman/skillmaru` from `github.com/cookyman74/skillhub` (verified via npm registry metadata). Its own `og:description` is `사내 에이전트 스킬 레지스트리` — "in-house agent skill registry." It is a **private corporate publish-and-govern registry**, structurally the opposite of what AgentDock is (a public GitHub-ingest discovery index). Treating it as the primary competitive reference will lead the roadmap in the wrong direction.

**The one genuinely open wedge:** nobody derives and displays, per artifact, *what the artifact will actually do to your machine* — computed from the files in the repo rather than declared by the author or outsourced to a package-level scanner. See [Unmet Need](#unmet-need--ranked-wedges).

---

## 1. Primary Reference: SkillMaru

**URL:** https://skillmaru.hell0world.net/
**Lineage:** Fork/derivative of [openclaw/clawhub](https://github.com/openclaw/clawhub) (MIT). CLI published as [`@cookyman/skillmaru`](https://registry.npmjs.org/@cookyman/skillmaru) v0.1.9 from `github.com/cookyman74/skillhub`. The bundle still contains untranslated upstream strings referencing `npx clawhub search <keyword>` and "ClawHub CLI".
**Stack (observed):** React 19 + Vite SPA over a Spring Boot backend (Spring Security `SESSION`/`XSRF-TOKEN` cookies, `x-request-id`, RFC-style `{code,msg,data,timestamp,requestId}` envelope).
**Method:** Analyzed via its public JSON API (`/api/v1/*`) and its shipped JS bundle (`/assets/main-B46Hd5hd.js`, 640 KB), because the site is client-rendered and returns no server HTML.

### 1.1 Metadata model (verified from live API responses)

`GET /api/v1/skills/{slug}` returns exactly:

```json
{
  "skill":  { "slug", "displayName", "summary", "tags": {}, "stats": {},
              "createdAt", "updatedAt" },
  "latestVersion": { "version", "createdAt", "changelog", "license" },
  "owner": null,
  "moderation": { "isSuspicious", "isMalwareBlocked", "verdict",
                  "reasonCodes": [], "updatedAt", "engineVersion", "summary" }
}
```

List records add `stats: { downloads, stars }`.

Concrete observations:

- **`tags` was an empty object on every one of the ~425 list records sampled.** The taxonomy field exists in the schema and is unused in practice.
- **`stats` is near-zero.** Highest `downloads` observed was 35 (`korean-humanizer`); `stars` was `0` on every record sampled. Popularity signal is effectively absent.
- **`version` is usually a publish timestamp** (`20260810.023433`), not semver. Only some records use semver (`1.0.0`). Version comparison across the catalog is therefore not meaningful.
- **`license` was `null`** on every record sampled.
- **`changelog` was `""`** on every record sampled.
- `owner` was `null` on public records.

### 1.2 Information architecture (extracted from SPA route table)

```
/                                   home
/skills                             listing
/categories                         category browse
/search                             search
/space/$namespace                   namespace (org/user) page
/space/$namespace/$slug             package detail
/space/$namespace/$slug/compare     version diff  ← notable
/dashboard/publish                  publish flow
/dashboard/reviews, /reviews/$id    review + approval queue
/dashboard/namespaces/$slug/reviews review per namespace
/dashboard/governance               governance
/dashboard/promotions               promote skill to global
/dashboard/subscriptions, /stars, /tokens, /reports, /notifications
/admin/labels, /admin/labels/sort-order, /admin/users, /admin/audit-log
/cli/auth                           CLI device auth
/login /register /reset-password /terms /privacy
```

This route set is the product definition: **namespaces, API tokens, publish, human review/approval, promotion, governance, admin-curated labels, audit log.** That is npm-for-skills inside a company, not a discovery index of the public world.

### 1.3 Search, filters, sorting

- `GET /api/v1/search?q=` — separate search endpoint returning `{slug, displayName, summary, version, score, updatedAt}`, fixed **20 results, no pagination**. `score` was `0` on every result, suggesting the ranking field is unpopulated.
- `GET /api/v1/skills?q=` — list endpoint also accepts `q`; ignores `size` (hard 25/page) and paginates only via `?page=N`.
- Sort options in the bundle: `name`, `updated`, `stars`, `downloads`, `relevance`, `newest`. Korean UI labels confirm `최신순` (newest) / `오래된순` (oldest).
- `/api/v1/tags`, `/api/v1/categories`, `/api/v1/stats` all return **401** — the taxonomy is not publicly readable.
- Rate limiting is enforced and aggressive (`429 {"code":429,"msg":"Rate limit exceeded"}` after roughly 10 rapid requests).

### 1.4 Install instructions

Two install paths, surfaced from i18n strings:

- CLI: `npm i -g @cookyman/skillmaru`, then `skillmaru install`
- Agent-driven: a prompt template `Read {{url}} and follow the instructions to setup {{product}} Skills Registry`
- Detail pages show "one-click install commands including environment variables" (`스킬 상세 페이지에서 환경 변수가 포함된 원클릭 설치 명령을 확인할 수 있습니다`)

### 1.5 Security posture — what it actually does

Two real mechanisms, both **publish-time**, not ingest-time:

1. **Secret pre-check on publish.** String: `발행 전 검사 실패 — 패키지에 비밀키·토큰·비밀번호가 포함된 것으로 보입니다` ("Pre-publish check failed — the package appears to contain a secret key / token / password"). Publisher may override and continue.
2. **Frontmatter validation on publish.** `SKILL.md 형식이 올바르지 않습니다` with a YAML-colon-quoting hint.
3. **Moderation verdict** (`clean` / `isSuspicious` / `isMalwareBlocked` / `reasonCodes` / `engineVersion`). On sampled records `engineVersion` and `summary` were `null` and `reasonCodes` empty — **UNVERIFIED whether the scanning engine is actually wired up**, or whether the field is a schema placeholder.

There is a scan-state vocabulary in the UI (`검사 중` scanning, `검사 실패` scan failed) and a review workflow (`검토 대기` pending / `승인됨` approved / `반려됨` rejected / `검토자` reviewer), so the trust model is fundamentally **human review**, not automated analysis.

### 1.6 Concrete strengths

| Strength | Why it matters |
|---|---|
| Version diff between releases (`/compare`, "N files changed", file search within diff) | Genuinely rare. No public skill directory surveyed offers file-level diff between versions. Worth stealing conceptually. |
| Publish-time secret scanning with an explicit override | The right ergonomics: warn, explain, let the human decide. |
| Namespace + token + review + audit-log model | Correct for a corporate registry. |
| Progressive install surfaces (CLI / agent-prompt / manual) | Recognizes that the *consumer* is often an agent, not a human. |
| Tight CSP, HSTS, `X-Frame-Options: DENY`, rate limiting | Security hygiene is real and worth matching. |

### 1.7 Concrete limitations and gaps

| Gap | Evidence |
|---|---|
| **No source-repository link in the product.** | `grep -c` over the 640 KB bundle: `repositoryUrl` 0, `githubUrl` 0, `sourceUrl` 0, `homepage` 0. A `provenance` i18n block exists with a `repository: "원 저장소"` ("Original repository") key, so the field is *designed* but the sampled public API records return no repo. Provenance is effectively absent. |
| **Skills only.** | `mcpServers` appears 0 times in the bundle. Only `/api/v1/skills` exists. No MCP servers, no plugins, no hooks, no commands. |
| **No capability/permission surface.** | `allowed-tools` appears **0 times** in the bundle. The single most security-relevant field in the Agent Skills spec is not displayed. |
| **Taxonomy exists but is empty.** | `tags: {}` on all sampled records; categories are admin-curated `labels` with manual `sort-order` — requires ongoing human effort. |
| **Popularity signal is dead.** | max 35 downloads, 0 stars everywhere, `score: 0` in search results. |
| **No license data.** | `license: null` across sampled records. |
| **Search is a 20-row fixed list.** | No pagination, no facets on the search endpoint. |
| **Closed catalog.** | Publish-only. Nothing enters unless a human uploads it, so coverage of the public GitHub ecosystem is near zero. |
| **Korean-language, single-tenant.** | Not positioned as a public neutral index. |

### 1.8 What AgentDock can materially do better

1. **Provenance as a first-class, mandatory field.** Every record links to `owner/repo@sha`, path within repo, and the exact upstream commit. SkillMaru has none of this; a GitHub-ingest model gets it for free.
2. **Derive the taxonomy instead of curating it.** SkillMaru's admin-curated labels do not survive a solo maintainer (`PROJECT.md` constraint: "Anything requiring ongoing manual curation at scale will not survive"). Derive categories from repo topics, frontmatter, and directory paths.
3. **Display `allowed-tools` and bundled-script capability.** Zero competitors do this well.
4. **Cover more than one artifact type per repo.** SkillMaru sees a repo as one skill; a real repo is often 3 skills + an MCP server + 2 hooks.
5. **Use upstream stars/commit recency as the popularity signal.** SkillMaru's internal download counter is dead on arrival for a new registry; borrowed GitHub signal is not.

**Do not copy:** the publish/namespace/token/review/governance half of the product. It is ~60% of SkillMaru's routes and it is entirely irrelevant to a read-only public index with one maintainer.

---

## 2. Competitive Landscape

### 2.1 Summary matrix

| Product | Indexes | Scale (claimed/measured) | Source model | Cross-runtime? | Security analysis |
|---|---|---|---|---|---|
| [registry.modelcontextprotocol.io](https://registry.modelcontextprotocol.io/) | MCP servers | **≥20,000 version records measured** (paging capped; 15,162 of first 20,000 carried `repository`) | Publish + namespace auth | Protocol-neutral by design | None (metadata only) |
| [skills.sh](https://www.skills.sh/) | Agent Skills | 1.19M "skills" claimed — **UNVERIFIED**, likely counts installs or per-repo skills | GitHub (`npx skills add owner/repo`) | **Yes — 20+ agent filters** | Aggregates Socket + Snyk + Gen Agent Trust Hub; **mostly "Pending"** |
| [ClawHub](https://github.com/openclaw/clawhub) | Skills + OpenClaw plugins | 13,000+ skills (early 2026, third-party) | Publish (GitHub-account gated) | OpenClaw-centric | Publish-time checks |
| [Glama](https://glama.ai/) | MCP servers | 22,000–37,000 (third-party reports) | Crawl + rebuild | MCP only | **Yes — quality + safety score, continuous rebuild, codebase scan** |
| [mcp.so](https://mcp.so/) | MCP servers | ~20,222 (Apr 2026, third-party) | Crawl | MCP only | None reported |
| [Smithery](https://smithery.ai/) | MCP servers | "largest catalog", breadth-focused | Publish + crawl | MCP only | None ("index, don't review") |
| [PulseMCP](https://pulsemcp.com/) | MCP servers | 6,970+ (third-party) | Curated + crawl | MCP only | None reported |
| [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) | Claude Code plugins | **284 plugins measured** | Curated `marketplace.json` | Claude Code only | Anthropic curation |
| [claudepluginhub.com](https://www.claudepluginhub.com/) | Plugins + skills | UNVERIFIED (403 to automated fetch) | UNVERIFIED | Claude Code only | UNVERIFIED |
| [agenticskills.io](https://agenticskills.io/) | Skills + MCP | 181+ skills, 200+ MCP (self-reported) | Curated | Partial | "Verified" badge, method UNVERIFIED |
| [skillregistry.io](https://skillregistry.io/) | Skills | UNVERIFIED | UNVERIFIED | Claude + ChatGPT claimed | UNVERIFIED |
| [openagentskill.com](https://www.openagentskill.com/) | Skills | UNVERIFIED | UNVERIFIED — positions as "npm for skills" with a discovery API for agents | UNVERIFIED | UNVERIFIED |
| [agent-skill.co](https://www.agent-skill.co/) | Skills | UNVERIFIED | Editorial index pointing at others | 9 platforms listed | None |
| [geminicli.com/extensions](https://geminicli.com/extensions) | Gemini CLI extensions | UNVERIFIED | Official vendor directory | Gemini only | None reported |
| [heilcheng/awesome-agent-skills](https://github.com/heilcheng/awesome-agent-skills) | Links to directories | — | Manual awesome-list | — | None |

### 2.2 The ones that actually matter for AgentDock

**skills.sh — the closest real competitor, and the reason the "coverage" wedge is closed.**
GitHub-sourced, `npx skills add <owner/repo>` install, sorting by All Time / Trending 24h / Hot, topic categories (React, Next.js, Design & UI, Mobile, Agent workflows, Databases, Testing, Marketing), **filters by 20+ agent runtimes**, and a `/audits` page. Its audit page is the important detail: it does **not** analyze artifacts itself. It aggregates three third-party verdicts — Gen Agent Trust Hub ("Safe"), Socket (alert count), Snyk (Low/Medium/Critical risk) — and a large share of listed skills show **"Pending" on all three**. Those are *package-dependency* scanners pointed at a *prompt-and-script* artifact. They will not tell you that a `SKILL.md` declares `allowed-tools: Bash(curl *)` or ships a `scripts/install.sh`.

**Official MCP Registry — the model to imitate for schema discipline.**
Live API, versioned JSON Schema (`schemas/2025-12-11/server.schema.json`), reverse-DNS namespacing, `_meta["io.modelcontextprotocol.registry/official"]` with `status`/`publishedAt`/`updatedAt`/`isLatest`. It deliberately does no security analysis — it is a metadata substrate that subregistries build on. AgentDock consuming it rather than re-crawling MCP servers is the correct call.

**Glama — proof that the security-signal wedge is real but MCP-only.**
Continuous rebuild, quality and safety scoring, an embeddable badge. Nobody has done the equivalent for Agent Skills.

### 2.3 GitHub-side scale (measured 2026-08-10, unauthenticated GitHub API)

| Query | Repos |
|---|---|
| `topic:mcp-server` | 23,150 |
| `topic:agent-skills` | 14,303 |
| `topic:claude-skills` | 6,653 |
| `topic:claude-code-plugin` | 5,010 |
| `"awesome" claude skills in:name` | 194 |

Reference-point repos: [anthropics/skills](https://github.com/anthropics/skills) **167,279 stars**, [agentskills/agentskills](https://github.com/agentskills/agentskills) 24,074, [modelcontextprotocol/registry](https://github.com/modelcontextprotocol/registry) 7,130.

Implication for `PROJECT.md`'s GitHub rate-limit constraint: topic search alone surfaces ~40k candidate repos. Full-ecosystem crawl is **not** achievable under a solo-maintainer PAT budget. The ingestion design must be **pull-by-URL plus a bounded seed list**, not a crawler. This is a hard scoping input for the roadmap.

---

## 3. Artifact Formats: Spec vs Convention

This is the table that determines what AgentDock can auto-detect. "Parseable" means a machine-readable manifest or a formally specified frontmatter schema exists.

| Artifact | Manifest / location | Status | Auto-detectable? |
|---|---|---|---|
| **Agent Skill** | `<name>/SKILL.md`, YAML frontmatter | **SPEC** — [agentskills.io/specification](https://agentskills.io/specification); 6 fields; validator `skills-ref validate` | **Yes, strongly.** Highest-confidence target. |
| **MCP server** | `server.json` | **SPEC** — versioned JSON Schema at `static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json` + live registry API | **Yes, strongest of all.** Consume the registry API. |
| **Claude Code marketplace** | `.claude-plugin/marketplace.json` | **SPEC** — documented schema + `json.schemastore.org/claude-code-marketplace.json` | **Yes.** Single file yields N plugins with sources pinned to `ref`/`sha`. |
| **Claude Code plugin** | `.claude-plugin/plugin.json` | **SPEC, but the manifest is OPTIONAL** — Claude Code auto-discovers components from default paths and derives the name from the directory | **Partly.** Absence of `plugin.json` does not mean "not a plugin". Must fall back to directory-shape detection (`commands/`, `agents/`, `skills/`, `hooks/`, `.mcp.json`). |
| **Claude Code hooks** | `hooks/hooks.json` in a plugin; `"hooks"` key in `settings.json` | **SPEC** — JSON, 30+ named events, typed handlers (`command`/`http`/`mcp_tool`/`prompt`/`agent`) | **Yes for plugin `hooks.json`.** Weak for `settings.json`, which is often gitignored or `settings.local.json`. |
| **Claude Code command** | `.claude/commands/*.md` | **MERGED INTO SKILLS.** Official docs now state "Custom commands have been merged into skills" and commands support the same frontmatter | **Yes**, but treat as a skill variant, not a separate artifact type. |
| **Gemini CLI extension** | `gemini-extension.json` | **SPEC** — required `name`/`version`/`description`; optional `mcpServers`, `contextFileName`, `excludeTools`, `settings`, `themes`, `plan`, `migratedTo`; commands as `commands/*.toml`; skills as `skills/<n>/SKILL.md` | **Yes.** |
| **Codex skill extras** | `agents/openai.yaml` alongside `SKILL.md` | **VENDOR SPEC** — `interface` (display_name, icon, brand_color), `policy.allow_implicit_invocation`, `dependencies` | **Yes**, low priority. |
| **Cursor rules** | `.cursor/rules/**/*.mdc` | **CONVENTION + frontmatter** — `description`, `globs`, `alwaysApply`. `.md` files in that dir are *ignored*. No manifest, no registry. | **Weakly.** Frontmatter parses; there is no catalog concept. |
| **OpenCode config** | `opencode.json` | **UNVERIFIED as a distribution format.** Documented as user config with pattern-based skill permissions; no evidence of a publishable plugin manifest. | No. |
| **AGENTS.md** | repo root | **CONVENTION ONLY** — plain markdown, no frontmatter, no schema | **No.** Do not model it as an artifact. |
| **`.mcp.json` in a repo** | project MCP server declaration | **DE-FACTO CONVENTION**, shape mirrors `mcpServers` | Yes, heuristically. |

### 3.1 The Agent Skills spec, precisely

Required: `name` (1–64 chars, lowercase `a-z0-9` and `-` only, no leading/trailing hyphen, no `--`, **must match parent directory name**), `description` (1–1024 chars, non-empty).
Optional: `license`, `compatibility` (≤500 chars), `metadata` (string→string map), `allowed-tools` (space-separated string, marked **Experimental**).

### 3.2 The trap: Claude Code extends the spec, and the extension is a portability cliff

Claude Code accepts 20+ frontmatter fields (`when_to_use`, `argument-hint`, `arguments`, `disable-model-invocation`, `user-invocable`, `disallowed-tools`, `model`, `effort`, `context`, `agent`, `background`, `hooks`, `paths`, `shell`, plus the 6 spec fields). But claude.ai upload, the Skills API, and `package_skill.py` accept **only the 6 spec fields** and **hard-fail** otherwise:

```
Unexpected key(s) in SKILL.md frontmatter: argument-hint.
Allowed properties are: allowed-tools, compatibility, description, license, metadata, name
```

**This is a computable, high-value fact.** Given a `SKILL.md`, AgentDock can determine with certainty whether it is spec-pure or Claude-Code-locked. No competitor surfaces this.

---

## 4. Cross-Runtime Compatibility: What Is Derivable vs Declared

### 4.1 Skill discovery paths per runtime (from official docs)

| Runtime | Reads |
|---|---|
| Claude Code | `~/.claude/skills/`, `.claude/skills/` (incl. nested + parents), plugin `skills/` |
| Cursor | `.agents/skills/`, `.cursor/skills/`, `~/.agents/skills/`, `~/.cursor/skills/`, **plus legacy `.claude/skills/`, `.codex/skills/`, `~/.claude/skills/`, `~/.codex/skills/`** |
| OpenCode | `.opencode/skills/`, `~/.config/opencode/skills/`, **`.claude/skills/`, `~/.claude/skills/`**, `.agents/skills/`, `~/.agents/skills/` |
| Codex / ChatGPT | `$CWD/.agents/skills`, `$CWD/../.agents/skills`, `$REPO_ROOT/.agents/skills`, `$HOME/.agents/skills`, `/etc/codex/skills` |
| Gemini CLI | `~/.gemini/skills/`, `~/.agents/skills/`, `.gemini/skills/`, `.agents/skills/`, extension `skills/` |

`.agents/skills/` is the emerging neutral path (Cursor + Codex + Gemini CLI + OpenCode). `.claude/skills/` is read by Cursor and OpenCode as a compatibility path. **A skill checked into `.claude/skills/` is already loadable by at least three non-Anthropic runtimes without modification.**

### 4.2 The three tiers of compatibility claim

**DERIVABLE from files in the repo — AgentDock should compute these and present them as facts:**

1. **Spec conformance.** Frontmatter keys ⊆ the 6 spec fields → portable to essentially every skills client and to claude.ai/Skills API upload. Any extra key → fails claude.ai packaging.
2. **Per-runtime field support.** Cursor documents support for `paths`, `disable-model-invocation`, `metadata` (and legacy `globs`) beyond the spec 6; OpenCode documents `name`, `description`, `license`, `compatibility`, `metadata`. So a skill using `context: fork` is Claude-Code-only; a skill using only `paths` still works in Cursor. This is a **field-set × runtime matrix**, computable exactly.
3. **Discovery-path reachability.** Which runtimes will find the skill given where it sits in the repo, per the table above.
4. **Artifact-type gating.** `.claude-plugin/plugin.json` → Claude Code only. `hooks/hooks.json` → Claude Code only. `.cursor/rules/*.mdc` → Cursor only. `gemini-extension.json` → Gemini CLI only. `server.json` / `.mcp.json` → any MCP client.
5. **Name/directory mismatch.** Spec requires `name` == parent directory name. A mismatch is a computable defect.

**DECLARED ONLY — never trustworthy as a facet:**

- The `compatibility:` field is **free prose up to 500 characters** ("Designed for Claude Code (or similar products)", "Requires git, docker, jq, and access to the internet"). It is not an enum and not machine-parseable. **Do not build a compatibility filter on it.** At most, display it verbatim and extract keywords as a low-confidence hint.
- README claims, badges, marketing copy.
- `plugin.json` `keywords` and marketplace `category`/`tags` — author-supplied, unvalidated.

**COMMUNITY-REPORTED ONLY — out of scope for a solo maintainer:**

- Whether the skill actually *triggers* correctly in runtime X.
- Whether bundled scripts run on a given OS.
- Subjective quality.

**Design consequence:** AgentDock's compatibility model must be **derived-first**, with declared text shown separately and labelled as author claim. This is both the honest design and the defensible one — and it is only possible because the format landscape is now specified well enough to compute against.

---

## 5. Unmet Need — Ranked Wedges

The space is crowded. Coverage, search quality, and install ergonomics are all taken. Four candidate wedges, ranked by defensibility for one part-time maintainer with no ability to sustain manual curation.

### Wedge 1 — Derived capability & permission transparency (STRONGEST)

**The gap.** No product answers "what will this artifact do to my machine?" from the artifact's own files.
- skills.sh outsources to Socket/Snyk (dependency-graph scanners aimed at npm packages, not prompt bundles) and most entries are Pending.
- Glama scores MCP servers only.
- SkillMaru scans for secrets at publish time and never displays `allowed-tools` at all.
- The official MCP Registry explicitly does no analysis.

**What AgentDock computes**, purely by reading text (fully compatible with the `PROJECT.md` no-execution constraint):
- `allowed-tools` / `disallowed-tools` parsed into capability classes: shell execution, network, filesystem write, git mutation.
- Presence, count, language, and size of `scripts/` — plus whether `SKILL.md` instructs the agent to run them.
- Hook declarations: which of the 30+ events fire, with what matcher, running what command. A `PreToolUse` hook on `Bash` executing a repo script is a very different risk profile from a `Stop` hook that prints a message.
- MCP `Input.isSecret` / `environmentVariables` — the MCP schema already flags which inputs are credentials.
- `Package.fileSha256` presence/absence — integrity verification available or not.
- Prompt-injection surface: the fact that `SKILL.md` body text is injected verbatim into agent context is itself the threat model in `PROJECT.md`.

**Why defensible:** 100% static, zero curation, zero ongoing human cost, and it degrades gracefully — partial analysis is still more than any competitor shows. It is also the only wedge that matches the maintainer's stated framing ("treat every ingested artifact as untrusted supply-chain input").

**Risk:** Socket or Snyk could ship skill-aware analysis. Mitigation: AgentDock's value is the *artifact-semantic* layer (hooks, allowed-tools, injection surface), not dependency CVEs — a different axis.

### Wedge 2 — Derived cross-runtime compatibility matrix (STRONG)

**The gap.** skills.sh filters by "agent", but that is a *declared/assumed* tag. Nobody computes, per skill, "spec-pure → works everywhere; uses `context: fork` → Claude Code only; sits in `.claude/skills/` → also found by Cursor and OpenCode." The spec's own `compatibility` field is prose and therefore useless as a facet — which is exactly why the derived version is valuable.

**Why defensible:** fully computable, needs no curation, and requires knowing five runtimes' field-support and discovery-path rules — real research effort that a generic directory has no incentive to do.

**Risk:** field-support tables drift as runtimes evolve. Mitigation: model them as versioned data, not code.

### Wedge 3 — Multi-artifact repository graph (MODERATE)

**The gap.** Every competitor indexes exactly one artifact type. Real repos are mixed: `anthropics/skills` ships `skills/`, `spec/`, `template/`, and `.claude-plugin/`. A single `marketplace.json` yields 284 plugins, each of which can carry skills + agents + hooks + MCP servers. Nobody presents "this repo contains 3 skills, 1 MCP server, 2 hooks — and here is how they interconnect."

**Why defensible:** it is a natural consequence of GitHub-ingest and costs almost nothing once the parsers exist. Weaker on its own; strong as the substrate that makes Wedge 1 possible (the hook that runs the script that the skill invokes).

### Wedge 4 — Freshness and upstream SHA tracking (WEAK as a wedge, REQUIRED as table stakes)

Glama already continuously rebuilds; skills.sh already has Trending/Hot; the MCP Registry already tracks `isLatest`/`updatedAt`. Pinning to `owner/repo@sha` is necessary for AgentDock to be trustworthy, but it will not differentiate. **Build it; do not market on it.**

### Explicitly rejected: quality scoring / curation
Requires sustained human judgment. Directly violates the "no ongoing manual curation" constraint. SkillMaru's own dead `tags: {}` and `score: 0` fields are the cautionary evidence.

---

## 6. What AgentDock Should NOT Compete On

| Do not build | Why |
|---|---|
| **Catalog size / breadth** | mcp.so ~20k, Glama 22k–37k, ClawHub 13k+, skills.sh at scale. GitHub rate limits make full crawl impossible for one maintainer. Compete on *depth per artifact*, not count. |
| **A skills-to-runtime translation layer** | Solved by the agentskills.io standard. Nothing to translate. |
| **Semantic / vector search** | ClawHub already ships embedding search; `pgvector` is unavailable in the target DB image. PostgreSQL FTS + `pg_trgm` is correct for v1 and this research adds no evidence to override that. |
| **Its own MCP server crawler** | The official registry has a public paginated API with a versioned schema. Consume it. |
| **Publish / namespace / token / review / governance** | ~60% of SkillMaru's routes, and pure overhead for a read-only public index. |
| **Hosting, proxying, or executing MCP servers** | Smithery and Glama do this with infrastructure budgets. Also directly violates the no-execution constraint. |
| **An install CLI in v1** | `npx skills add`, `clawhub install`, `/plugin install`, `gemini extensions install` all exist. Copyable install *commands* on the detail page get 90% of the value for 2% of the work. |
| **Download counts / stars / ratings** | A new registry's internal counters are structurally dead (SkillMaru: max 35 downloads, 0 stars). Borrow upstream GitHub stars and commit recency instead. |
| **Modelling `AGENTS.md` as an artifact** | Convention only, no schema, nothing to parse. |

---

## 7. Implications for Requirements and Roadmap

**Corrections required in `PROJECT.md`:**
1. Line 58 ("No neutral cross-ecosystem registry with a security lens exists yet") is false — replace with the narrower, defensible claim: *no registry derives per-artifact capability and permission facts from artifact source.*
2. Line 49 (SkillMaru as reference) should be re-scoped: SkillMaru is a private corporate fork of ClawHub. Take its **version-diff** and **secret-scan-with-override** ideas; discard its publish/governance model wholesale.
3. Add the ingestion-scope constraint: pull-by-URL plus a bounded seed list. A crawler does not fit the PAT budget against ~40k candidate repos.

**Phase-ordering signal:**
- Parsers first, in descending spec-confidence order: `SKILL.md` (spec + validator) → `marketplace.json` (one file, many plugins, best coverage-per-request) → `plugin.json` + directory-shape fallback → `hooks.json` → `server.json` via the MCP Registry API.
- The capability/permission analyzer (Wedge 1) is the differentiator and should **not** be deferred to a late phase — it is the reason the product exists. But it depends on the parsers, so it is phase 2, not phase 1.
- The compatibility matrix (Wedge 2) needs a versioned runtime-capability data file, not code. Flag for its own design pass.

**Phases likely to need deeper research later:**
- Capability classification taxonomy (what counts as "network access" in a `Bash()` rule) — genuinely hard, needs its own spike.
- GitHub rate-limit budgeting and incremental re-ingest strategy.

**Phases that are standard and need no further research:**
- Frontmatter/YAML parsing, PostgreSQL FTS + `pg_trgm` search, listing/detail UI.

**Taxonomy starting point (borrow, do not invent):** the 13 categories in use by `anthropics/claude-plugins-official` — `security, design, development, productivity, database, location, monitoring, migration, deployment, automation, learning, testing, math`. Note one plugin in that file has an empty-string category, so validate on ingest.

---

## 8. Confidence & Open Questions

| Area | Confidence | Basis |
|---|---|---|
| Agent Skills spec fields and constraints | HIGH | Fetched from agentskills.io/specification |
| Claude Code plugin/marketplace/hooks schemas | HIGH | Fetched from code.claude.com official docs |
| MCP `server.json` schema | HIGH | Fetched the JSON Schema file directly |
| SkillMaru metadata model, routes, gaps | HIGH | Live API responses + shipped JS bundle |
| SkillMaru = ClawHub fork | HIGH | npm registry metadata + untranslated upstream strings in bundle |
| Runtime skill-discovery paths | HIGH | Each vendor's own docs |
| Competitor catalog sizes | **MEDIUM/LOW** | Mostly third-party blog posts; only the MCP Registry and claude-plugins-official were measured directly |
| skills.sh audit methodology | LOW | Dashboard shows vendor names and verdicts; methodology not published |

**Unresolved / UNVERIFIED:**
- Whether SkillMaru's `moderation.engineVersion` scanner is actually wired up (all sampled records: `null`).
- `claudepluginhub.com` returned 403 to automated fetch — scope and scale unknown. Worth a manual browser check before finalizing requirements.
- skills.sh's "1,193,145 skills" figure is almost certainly not distinct skills; do not cite it.
- OpenCode's plugin/extension distribution format (as distinct from skills) — no evidence found of a publishable manifest.
- Whether `.agents/skills/` will be formally adopted into the agentskills.io spec as the canonical path. Currently a de-facto convergence across four runtimes.
- The exact distinct-server count in the official MCP Registry (paging was capped at 20,000 version records, which include multiple versions per server).

---

## Sources

**Specifications and official documentation**
- https://agentskills.io/ — Agent Skills overview, client showcase (~48 runtimes)
- https://agentskills.io/specification — normative frontmatter spec, constraints, directory layout, `skills-ref` validator
- https://github.com/agentskills/agentskills — spec repository (24,074 stars)
- https://code.claude.com/docs/en/skills.md — Claude Code frontmatter reference, skill locations, spec-vs-extension table, `allowed-tools` semantics
- https://code.claude.com/docs/en/plugins-reference.md — `plugin.json` schema, component paths, directory layout, optional-manifest behavior
- https://code.claude.com/docs/en/plugin-marketplaces.md — `marketplace.json` schema, plugin entry fields, source types (`github`, `url`, `git-subdir`, `npm`, `archive`), reserved names, strict mode
- https://code.claude.com/docs/en/hooks.md — hook event list (30+), handler types, plugin `hooks/hooks.json`
- https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json — MCP `server.json` JSON Schema (`ServerDetail`, `Package`, `Repository`, transports, `Input.isSecret`)
- https://modelcontextprotocol.io/registry/about — MCP Registry positioning
- https://cursor.com/docs/context/skills — Cursor skill paths and supported frontmatter fields
- https://cursor.com/docs/context/rules — `.cursor/rules` `.mdc` format
- https://opencode.ai/docs/skills/ — OpenCode skill paths and fields
- https://learn.chatgpt.com/docs/build-skills — Codex/ChatGPT skill paths, `agents/openai.yaml`
- https://geminicli.com/docs/cli/skills/ — Gemini CLI skill discovery order
- https://geminicli.com/docs/extensions/reference/ — `gemini-extension.json` schema

**Registries and directories**
- https://skillmaru.hell0world.net/ — primary reference (analyzed via `/api/v1/skills`, `/api/v1/search`, `/assets/main-B46Hd5hd.js`)
- https://registry.npmjs.org/@cookyman/skillmaru — SkillMaru CLI provenance (`github.com/cookyman74/skillhub`)
- https://registry.npmjs.org/clawhub — ClawHub CLI (`github.com/openclaw/clawhub`)
- https://github.com/openclaw/clawhub — upstream open-source skill+plugin registry
- https://registry.modelcontextprotocol.io/ and `/v0/servers` — official MCP Registry API
- https://github.com/anthropics/claude-plugins-official — 284-plugin official marketplace (`marketplace.json` fetched raw)
- https://github.com/anthropics/skills — 167,279 stars; `skills/`, `spec/`, `template/`, `.claude-plugin/`
- https://www.skills.sh/ and https://www.skills.sh/audits — cross-runtime skills directory + aggregated third-party audits
- https://glama.ai/ — MCP registry with quality/safety scoring
- https://smithery.ai/ , https://mcp.so/ , https://pulsemcp.com/ — MCP directories
- https://agenticskills.io/ , https://skillregistry.io/ , https://www.openagentskill.com/ , https://www.agent-skill.co/ — skill directories
- https://www.claudepluginhub.com/ — plugin/skill hub (403 to automated fetch; UNVERIFIED)
- https://github.com/heilcheng/awesome-agent-skills — awesome-list of skill directories
- https://geminicli.com/extensions — official Gemini CLI extension directory

**Third-party analysis (lower confidence, used only for scale figures)**
- https://www.agensi.io/learn/smithery-vs-glama-vs-agensi-comparison
- https://www.explainx.ai/blog/top-10-mcp-server-directories-2026
- https://www.truefoundry.com/blog/best-mcp-registries
- https://tallyfy.com/how-to-list-mcp-server-registry-smithery-glama-pulsemcp/
- https://safedep.io/the-state-of-mcp-registries/
- https://agentman.ai/blog/agent-skills-ecosystem-report-2026

**Measured directly on 2026-08-10 via GitHub API:** repository topic counts, star counts, `marketplace.json` contents, MCP Registry pagination and metadata coverage.
