# Feature Research

**Domain:** Package registry / discovery platform for AI agent extensions (Agent Skills, plugins, MCP servers, commands, hooks)
**Researched:** 2026-08-10
**Confidence:** MEDIUM (cross-checked across vendor docs, competitor sites, and academic/security research; several agent-runtime conventions are moving monthly and are dated below)

**Complexity key:** S = under a day, M = a few days, L = a week+ of part-time solo work.

---

## 0. The Strategic Finding That Drives Every Category Below

Read this before the tables. It changes what "MVP" means.

**This market is already crowded, and it is crowded on the two axes AgentDock cannot win.**

| Axis | Incumbent | Their scale |
|---|---|---|
| Catalog size | claudemarketplaces.com | claims 23,600+ skills |
| Catalog size | SkillsMP | claims to search 2.5M+ skills |
| Catalog size | Claude Market | claims 13,870+ MCP servers, 4,384+ skills |
| Install convenience | `npx skills` (vercel-labs) | 75+ agents, full per-agent path mapping, `add/find/list/update/remove` |
| Curation + payments | Agensi | paid curation, 8-point scan, 70% creator revenue share |

A solo part-time maintainer cannot out-crawl an aggregator and cannot out-maintain a Vercel-backed CLI that already tracks 75 runtimes' install paths. **Any MVP feature that competes on breadth or on install automation is dead on arrival.**

**The one axis that is genuinely open is exactly the one PROJECT.md already names:** *"see what it will actually do to your machine before installing it."*

The evidence that this gap is real and urgent:

- Snyk's ToxicSkills audit scanned 3,984 skills from ClawHub and skills.sh (as of 2026-02-05): **36% contained at least one security flaw (1,467 skills), 13.4% (534) had a critical-level issue**, 76 skills were human-confirmed malicious, and **8 of those were still publicly listed at publication time**. ([Snyk](https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/))
- 100% of confirmed-malicious skills combined a code payload *with* prompt injection — a combination that defeats conventional MCP scanners.
- Of the directories surveyed above, **the free ones do no security analysis at all.** The only one that does is paid.

So the MVP thesis is: **a small, deep, capability-transparent index beats a large shallow one.** Ship 300 artifacts where every one has a complete, sourced capability disclosure, rather than 30,000 where none do.

Everything in "Later" and "Anti-Features" below follows from that.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Registry conventions users have been trained on by npm, PyPI, crates.io, pkg.go.dev, Docker Hub and the VS Code Marketplace. Missing these = the product reads as a weekend scrape.

| ID | Feature | Why Expected | Complexity | Notes |
|---|---|---|---|---|
| TS1 | Paginated artifact listing with card fields (name, one-line description, type badge, owner, runtime badges, last-updated) | Every registry opens on a browsable list; a search-box-only landing page reads as broken | S | Card fields are the whole IA decision. Keep to 6 fields; a 7th field is where these sites turn to mush. |
| TS2 | Keyword full-text search over name + description + tags + body | Non-negotiable. Nobody browses 1,000 items. | M | Postgres `tsvector` + GIN. See §2 for the ranking recommendation. |
| TS3 | Detail page: name, description, owner, repo link, artifact type, license, declared runtimes, rendered body | The npm/crates.io/pkg.go.dev detail-page anatomy is a learned expectation | M | Depends on TS12. |
| TS4 | Rendered README / SKILL.md body, **sanitized** | Users judge from the body text | S | **Not optional and not "polish".** This is untrusted third-party markdown; raw HTML/`<img onerror>`/`javascript:` links must be stripped server-side. A registry that XSSes its visitors from indexed content is the exact failure mode its own thesis warns about. |
| TS5 | Copy-to-clipboard install instruction, per runtime, **as text only** | Every registry has the copy-button install line; its absence is instantly noticed | S | Text only. No execution, no CLI. See §8 — this is the single most important scoping decision in the document. |
| TS6 | Source provenance block: repo URL + path **within** the repo + commit SHA + permalink to that file at that SHA | "Where did this come from" is the whole basis for trusting an index you didn't publish to | S | GitHub permalink form `…/blob/<sha>/<path>`. Cheap and it makes every other claim on the page auditable. |
| TS7 | Freshness signals: last upstream commit date, indexed-at date, **archived-repo flag** | crates.io/npm/PyPI all surface staleness; PyPI users explicitly fall back to "is the linked GitHub repo archived" as the unmaintained signal | S | GitHub API gives `archived: true` free. Highest-value-per-line feature in the table. |
| TS8 | Filter by artifact type (skill / plugin / MCP server / command / hook) | Five incompatible artifact kinds in one index is confusing without it | S | Low-cardinality enum column → a `WHERE` clause. Not a "faceted search system". |
| TS9 | Filter by agent runtime | The user's first question is always "does this work with my agent" | S | See §5 for how to present confidence. |
| TS10 | GitHub popularity display (stars, forks) **labeled as GitHub repo stars** | Users expect *a* popularity number | S | Must not be labeled "downloads" or "installs" — AgentDock has no telemetry and must not imply it does. See §1 and AF4. |
| TS11 | Useful zero-result state | Search that dead-ends kills the session | S | Show nearest trigram matches + "submit a repo" CTA. |
| TS12 | Ingest a public GitHub repo by URL → discover artifacts → persist | Nothing above exists without it | L | The foundational phase. See §3. |

**Table stakes AgentDock structurally CANNOT supply, and must not fake:**

| Registry convention | Why AgentDock can't | Honest substitute |
|---|---|---|
| Download / install counts | AgentDock hosts nothing and has no client telemetry | GitHub stars/forks, explicitly labeled as such. Nothing else. |
| Dependency graph | Skills have no dependency manifest | File inventory of bundled scripts + their imports (see D3) |
| Publisher-declared deprecation (`npm deprecate`) | No publisher relationship — publishers don't know AgentDock exists | Archived-repo flag + staleness (this is precisely PyPI's fallback) |
| Domain-verified publisher badge (VS Code, Docker Hub) | Requires a manual verification desk; VS Code's takes 6 months of track record + DNS TXT + human review | Show the GitHub owner as-is: org vs user, account age, repo count. No badge. |
| Provenance attestations (npm/Sigstore) | Requires the publisher to opt in at build time | Commit SHA permalink (TS6) — weaker, but it's the honest ceiling |
| Yank / unpublish | No publish relationship | Mark as `unavailable` when upstream 404s on re-index |

---

### Differentiators (Competitive Advantage)

These are the reason AgentDock exists. Every one is downstream of static analysis AgentDock is already doing during ingest, so the marginal cost is low — the expensive part (TS12) is paid once.

| ID | Feature | Value Proposition | Complexity | Notes |
|---|---|---|---|---|
| D1 | **Capability disclosure panel** — what this artifact can touch: bundled executable scripts, shell invocations, outbound network hosts/URLs found in text, filesystem paths written, env vars read, `allowed-tools` declarations | The core value from PROJECT.md, and the one thing no free competitor does. Snyk found 13.4% of scanned skills carry critical issues; users currently have no way to see this before installing. | L | Depends on TS12. Present as **observed facts with a source line link**, never as a score. Model the presentation on Socket.dev's per-capability alerts (`networkAccess`, `filesystemAccess`, install scripts, obfuscation, env access) rather than a single number. |
| D2 | **Prompt-injection surface flags** — instruction-shaped text: "ignore previous instructions", directives to read `~/.ssh`/`.env`/credentials, instructions to fetch and execute remote content, front-loaded coercion | SKILL.md body loads straight into agent context with no sanitization layer; it *is* the primary injection carrier. Snyk documented 3 lines of markdown exfiltrating SSH keys. | M | Depends on D1's parser. **Wording is the whole feature** — see §4. Every flag links to the exact source line so the user judges, not AgentDock. |
| D3 | **Full artifact file inventory** — every bundled file with path, size, type, executable bit | Makes the "3-line SKILL.md that ships a 400-line `install.sh`" pattern visible at a glance. Trivially cheap, enormous signal, nobody does it. | S | Falls out of the Git Trees API call TS12 already makes. Best value-per-line-of-code in the entire document. |
| D4 | **Compatibility vocabulary** — `declared` / `inferred` / `unknown`, each with its evidence | Every competitor shows a boolean or a logo row with no basis. An explicit confidence vocabulary is instantly more credible and is *cheaper* than pretending to know. | M | See §5. `verified` is deliberately excluded at MVP. |
| D5 | Cross-ecosystem index in one search (skills + plugins + MCP servers + commands + hooks) | Existing directories are single-ecosystem. A developer asking "Kubernetes troubleshooting" doesn't care whether the answer is a skill or an MCP server. | M | Mostly falls out of a per-type parser interface in TS12. The cost is one parser per type, not a new subsystem. |
| D6 | **Honest identity line** — "indexed at `abc1234`, committed 2026-08-01" in place of a fabricated version | Sets AgentDock apart from directories that invent `v1.0.0` for unversioned files | S | See §6. |
| D7 | **Capability facet filter** — e.g. "text-only skills: no scripts, no network, no shell" | The killer query. It is what a security-conscious developer actually wants and it is currently impossible to ask anywhere. | S (once D1 exists) | Three boolean columns + a `WHERE`. The differentiator that costs almost nothing because D1 already paid for it. |
| D8 | Every analysis claim deep-links to the exact upstream source line | Converts AgentDock from "a site with opinions" into "a site that shows its work" — and structurally caps liability | S | Depends on TS6. |

---

### Later (Real Value, Wrong Time)

| ID | Feature | Why deferred | Complexity | Trigger to build |
|---|---|---|---|---|
| L1 | Re-index + change detection ("capabilities changed since last index") | Needs TS12 stable and a scheduler; a repo can turn malicious after indexing, so this eventually becomes load-bearing | M | As soon as the index exceeds ~200 artifacts or the first stale entry is noticed |
| L2 | **Watch / notify on capability change** | The genuinely great feature — "this skill you installed just gained network access". Requires either accounts or email delivery, i.e. the whole auth cost. | L | After L1 works and there is real usage. Strong candidate for v2's headline feature. |
| L3 | Curated collections / themed lists | Manual curation at scale does not survive a part-time maintainer (PROJECT.md constraint). Ship as a static hand-written page if wanted, not a feature. | M | Only if a second maintainer appears |
| L4 | Read-only CLI (`agentdock search` / `info`) | The website delivers the core value first; capability disclosure is a *reading* experience with links and rendered markdown. A CLI is a second frontend on an unproven product. | M | After web search is used enough that terminal access is requested |
| L5 | CLI `install` | See §8. Six structurally different install mechanics across runtimes, changing monthly. | L | Probably never — `npx skills` already owns this |
| L6 | Semantic / embedding search | `pgvector` is not in the current DB image; adding it means changing the image, which the PROJECT.md constraint gates. Query vocabulary here is highly lexical ("FastAPI", "pytest", "Kubernetes") — exactly where keyword search is strongest. | M + a DB image change | Measurable trigger in §2 |
| L7 | Accounts, server-side favorites, profiles | See §7. The largest permanent cost multiplier available. | L | Only when L2 (watch/notify) is being built — that is the first feature that genuinely needs identity |
| L8 | Publisher claiming / verification | VS Code's equivalent takes a 6-month track record, DNS TXT, and human review. A verification desk is manual curation by another name. | L | Not before real publisher demand |
| L9 | Public read API + JSON endpoints | Cheap once the schema is stable, but nobody consumes an API for an index of 300 items | S–M | On first third-party request |
| L10 | Trends / "new this week" / analytics | Needs a corpus and time series | M | 6 months of index history |
| L11 | SEO surface: sitemap, OG images, structured data | PROJECT.md scopes this milestone to local WSL only — zero SEO value while unpublished | S | At public deploy |

---

### Anti-Features (Deliberately Never)

| ID | Anti-Feature | Why Requested | Why Problematic | Instead |
|---|---|---|---|---|
| AF1 | **A "SAFE" / "VERIFIED" / green-check security verdict, or a single 0–100 security score** | It's the most legible possible UI and every stakeholder asks for it | This is the single most dangerous thing AgentDock could ship. Snyk demonstrated a malicious skill rated **"CLEAN. 0 findings"** by a denylist skill scanner, and argued you "simply cannot enumerate every possible way to ask an LLM to do something dangerous." A clean verdict is *more dangerous than no scanning* because users stop reading. It also converts an informational site into something that made a safety representation. | Observed capabilities + source links (D1, D2, D8). Let the user conclude. Wording rules in §4. |
| AF2 | Executing, `npm install`-ing, sandbox-running, or dry-running indexed code | "Real behavioral analysis is better than static" — and it *is* | Already out of scope per PROJECT.md, and correctly so: the entire security model is that ingestion is read-only. A sandbox is a multi-month project with its own escape surface, run by one part-time person against deliberately hostile input. | Static analysis only. Say so on the page. |
| AF3 | **Ratings and comments** | "Community signal" | Requires auth, moderation, and anti-brigading — permanent unpaid labor. At low volume, ratings are pure noise; at high volume they are gamed, exactly as GitHub stars were (§ AF4). A 5-star average over 3 votes is worse than nothing because it looks authoritative. | Objective signals only: capabilities, freshness, GitHub stars labeled honestly |
| AF4 | Download / install counts | Every registry has them | AgentDock has no telemetry and no hosting. Deriving them from stars would be fabrication — and stars are themselves discredited: CMU's ICSE 2026 study found **~6 million suspected fake stars across 18,617 repos and 301,000 accounts**, with stars correlating poorly with actual downloads. | Show stars, label them "GitHub stars", never sort primarily by them |
| AF5 | Hosting/mirroring artifact content as the canonical copy | "Faster, avoids upstream deletion" | Turns an index into a distributor: licensing exposure, becomes the delivery vector for the malware it's warning about, and needs an abuse takedown process. | Cache text for search/display; **always link to upstream as canonical** |
| AF6 | Any authentication in MVP | Feels like table stakes for "a platform" | See §7. Auth costs session management, CSRF, OAuth flow, recovery, deletion, and moderation of everything it unlocks — permanently, for one part-time maintainer. It buys favorites (which `localStorage` gives free). | No auth. `localStorage` favorites. Revisit only for L2. |
| AF7 | Chasing catalog size / mass-crawling GitHub | "We need 10,000 entries to look real" | Directly loses to incumbents claiming 23,600 and 2.5M. It also destroys the differentiator: mass crawl means capability analysis becomes shallow or absent, at which point AgentDock is a worse copy of claudemarketplaces.com. Also blows the GitHub API rate-limit budget (a PROJECT.md constraint). | Deliberately small, deeply analyzed index. Say "300 artifacts, all fully analyzed" as a *feature*. |
| AF8 | LLM-generated summaries of each artifact presented as description | "Better than the author's description" | Hallucination risk on a page whose entire premise is factual accuracy about untrusted code. Also: summarizing an artifact whose text is a known prompt-injection carrier means feeding attacker-controlled instructions to your own model. | Show the author's `description` frontmatter verbatim |
| AF9 | An AgentDock-specific manifest that publishers must add to their repo | "Then we'd have clean metadata" | Zero publishers will adopt a manifest for an unknown index. It inverts the core value (works on repos as they exist today). | Parse existing formats: `SKILL.md` frontmatter, `.claude-plugin/marketplace.json`, `server.json`, `gemini-extension.json` |
| AF10 | Payments / creator revenue share | Agensi does it | Explicitly out of scope in PROJECT.md; adds tax, fraud, and payout obligations to a non-commercial solo project | — |
| AF11 | Real-time updates, websockets, live ingest progress streaming | "Feels modern" | Ingest is a background job measured in seconds-to-minutes. Polling a status endpoint is one line. | Poll on the submission page |
| AF12 | Full repository mirroring / cloning during ingest | "Simpler than tree-walking the API" | Cloning arbitrary attacker-chosen repos to local disk is unbounded disk usage and a hostile-input filesystem surface (symlinks, huge files, path traversal on extract). | GitHub Trees + Contents API with explicit size caps |

---

## 1. What Established Registries Actually Show (and what AgentDock can supply)

| Registry element | npm | PyPI | crates.io | pkg.go.dev | Docker Hub | VS Code MP | AgentDock can? |
|---|---|---|---|---|---|---|---|
| Search + sort options | ✓ | ✓ | ✓ (Relevance / All-time DL / Recent DL / Recent Updates / Newly Added) | ✓ | ✓ | ✓ | **Yes** — relevance + recently-updated + stars |
| Rendered README | ✓ | ✓ | ✓ | ✓ (godoc) | ✓ | ✓ | **Yes** (sanitized) |
| Version list | ✓ | ✓ | ✓ | ✓ (incl. pseudo-versions) | tags | ✓ | **Partial** — see §6 |
| Dependencies | ✓ | ✓ | ✓ | ✓ | layers | — | **No** — substitute file inventory (D3) |
| Install command + copy | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **Yes**, as text (TS5) |
| Publisher identity | ✓ | ✓ | ✓ | module path | ✓ | ✓ | **Partial** — GitHub owner only |
| Verified-publisher badge | — | — | — | — | ✓ (Verified Publisher / Official / DSOS badges) | ✓ (DNS TXT + 6mo track record + manual review) | **No** (AF-adjacent; L8) |
| Download stats | ✓ | ✓ | ✓ | — | pulls | installs | **No** (AF4) |
| Freshness | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **Yes** (TS7) |
| Deprecation / yank | ✓ `npm deprecate` (removed from search + banner) | ✓ yank (installer-ignored) | ✓ yank | retracted | — | deprecated ext. | **Substitute**: archived-repo flag |
| Security warnings | ✓ advisories | — | ✓ RustSec | ✓ vulns | scan results | runtime security docs | **Yes — this is D1/D2, the differentiator** |
| Provenance / attestation | ✓ Sigstore | — | — | checksum db | — | — | **No** — commit SHA permalink is the ceiling |

**On provenance, for calibration:** npm's Sigstore attestations answer "did this come from the claimed pipeline", **not** "is the content safe" — as one analysis put it, provenance is "notarization of who claimed what", and a compromised pipeline yields a perfectly valid attestation of compromise. Worth internalizing: even the strongest supply-chain signal in the industry doesn't say "safe". AgentDock's much weaker signal must be worded far more carefully still.

---

## 2. Search Depth: What the MVP Actually Needs

Corpus assumption: a few hundred to a few thousand artifacts. That is *small*. Most search sophistication is dead weight at this size.

| Capability | Impl. cost | Real value at MVP scale | Verdict |
|---|---|---|---|
| Keyword full-text (`tsvector` + GIN over name, description, tags, body) | S–M | **High.** Query vocabulary is technical and lexical: "FastAPI", "pytest", "Kubernetes", "terraform". This is keyword search's strongest case. | **MVP** |
| Trigram fuzzy fallback (`pg_trgm`) | S | Medium. Catches typos and partial names; powers the zero-result state (TS11). `pg_trgm` is already available in the target instance. | **MVP** |
| Type + runtime filters | S | High. Two `WHERE` clauses on enum columns. | **MVP** |
| Capability filters (D7) | S | **High and unique.** Nowhere else can you ask "no scripts, no network". | **MVP** |
| Relevance ranking | S | Medium. `ts_rank_cd` with field weights: name > description > tags > body. Do this and stop. | **MVP** |
| License facet | S | Low. Most artifacts will be MIT or unlicensed; a facet with two values is UI noise. | Display on detail page only |
| Freshness facet | S | Low as a *facet*, medium as a *sort*. | Sort option, not facet |
| Popularity ranking (stars) | S | **Low, and actively harmful as a primary sort.** ~6M suspected fake stars; stars don't track real usage. crates.io deliberately defaults search to relevance, not downloads. | Secondary sort only, never default |
| Faceted counts ("Skills (142)") | M | Low. A `GROUP BY` per request is fine at this size, but the UI complexity isn't repaid. | Skip |
| Semantic / embedding search | M + **DB image change** | **Low now.** `pgvector` is absent from the current image (PROJECT.md), so this breaches a stated constraint *and* adds an embedding-inference dependency. It buys conceptual matching over a corpus small enough to scroll. | **Not MVP** |

**Concrete trigger to reconsider semantic search** — build it only when *both* hold:
1. Logged search queries show **>25–30% zero-result rate**, and
2. Manual review of those zero-result queries shows they are **conceptual** ("make my code faster") rather than **misspellings or absent artifacts**.

That requires one cheap dependency: **log every query string + result count.** No auth, no PII, one table. Do this in MVP; it is the evidence base for the entire search roadmap and costs an afternoon.

Ranking signals for MVP, in order: text relevance (`ts_rank_cd`, weighted) → recency of upstream commit → stars (tiebreak only). Deliberately *not* a learned or blended score; there is no data to tune one with.

---

## 3. Submission / Ingestion UX

**How comparable directories accept entries:**

| Mechanism | Who uses it | Cost to maintainer | Spam surface |
|---|---|---|---|
| PR to a GitHub repo | awesome-lists, Awesome-SKILL.md, addyosmani/agent-skills | **High.** `awesome-nodejs` literally paused submissions due to spam and low-quality PRs; GitHub is shipping PR-archiving tooling specifically for this maintainer burden. | Low quality, high volume |
| Automated crawling | ClaudeSkills.info, SkillsMP | Low ongoing, high build | Ingests garbage at scale (→ AF7) |
| Web form / URL paste | most modern directories | Low | Unauthenticated job trigger |
| GitHub App | (none in this space) | High build + permissions review | Low |
| Publish API with namespace ownership | official MCP Registry (`server.json`, validates namespace ownership) | Medium | Low, but requires publisher adoption (→ AF9) |

**Recommended MVP flow — paste GitHub URL → discover → confirm:**

```
1. User pastes https://github.com/owner/repo  (optionally .../tree/<ref>/<subdir>)
2. Normalize + validate: owner/repo shape, strip .git, reject non-github hosts
3. Dedupe check on (owner, repo, path) BEFORE any API call
4. GitHub API: repo metadata → 404/private/rate-limit handled distinctly
5. Recursive tree walk (bounded) → candidate artifacts by convention:
      */SKILL.md                    → skill
      .claude-plugin/marketplace.json → plugin marketplace (parse entries)
      .claude-plugin/plugin.json    → plugin
      server.json / mcp manifest    → MCP server
      .claude/commands/*.md         → command
      hooks config                  → hook
      gemini-extension.json         → Gemini extension
      .cursor/rules/*.mdc           → Cursor rule
6. Present: "Found 3 artifacts in this repo" with checkboxes + parsed name/description
7. User confirms → persist + run static analysis (D1/D2/D3)
```

**Cases the flow must handle explicitly (each is a real failure mode, not a nicety):**

| Case | Handling |
|---|---|
| Monorepo, many artifacts | Multi-select confirm step. Each artifact is its own record keyed by `(repo, path)`. **Do not** collapse a repo into one entry — that is the single biggest IA mistake available here. |
| Zero artifacts found | Explain *what was looked for*, don't just say "nothing found" |
| Private / 404 / deleted repo | Distinct message per case. A 404 on a private repo is indistinguishable from a deleted one via the API — say "not publicly accessible", not "does not exist". |
| Fork | Detect `fork: true`; show the upstream parent and default to indexing the parent. Forks are how a malicious near-copy hides next to a popular original. |
| Already indexed | Show the existing entry + offer "re-index" rather than erroring. Re-submission is the most common repeat action. |
| Duplicate content in a different repo | Content-hash the artifact; surface "identical content also at X" — a cheap typosquat/clone signal |
| Huge repo / tree truncation | Bound depth and entry count; if the tree is truncated, say so rather than silently indexing a partial view |
| Rate limit exhausted | Queue and tell the user, don't fail silently. GitHub API budget is the scarce resource here (PROJECT.md constraint). |

**Abuse surface this opens:** an unauthenticated endpoint that makes attacker-directed outbound API calls. The scarce asset is not CPU — it is the **GitHub rate-limit budget**, which one script can exhaust for everyone.

MVP mitigations, in cost order (none require auth):
1. Per-IP rate limit on submission (a counter table or in-memory bucket)
2. Global daily submission cap — a hard ceiling on the blast radius
3. Strict URL allowlist regex (github.com only) — also closes SSRF
4. Dedupe before fetch (step 3 above) — cheapest and most effective
5. Response size + tree-depth caps on every fetch

For this milestone (local WSL, single user) the practical risk is ~zero, but the endpoint should not be *designed* assuming that, because the fix later is a rewrite of the ingest entry point.

---

## 4. Trust / Security Surface: How to Word It

**How others show trust:**

| Signal | Mechanism | What it actually proves |
|---|---|---|
| npm provenance (Sigstore) | Signed attestation binding version → CI workflow, in a public transparency log | Which pipeline built it. **Not** that contents are safe. |
| OpenSSF Scorecard | 18+ automated checks (branch protection, code review, CI tests, dependency update tooling, binary artifacts…), 0–10 per check | *Process hygiene* of the repo. Not artifact safety. |
| Socket.dev | 70+ alert categories from static analysis (install scripts, network access, filesystem access, env access, obfuscation, telemetry), scored across supply-chain/quality/maintenance/vuln/license | Observed capabilities and anomalies |
| VS Code Marketplace | Blue check = DNS TXT domain proof + ≥6mo extension track record + ≥6mo domain age + manual review | Publisher identity continuity |
| Docker Hub | Official Images / Verified Publisher / DSOS badges | Commercial or program relationship with Docker |
| GitHub | stars, forks, archived flag, org vs user | Popularity (compromised — see AF4) and lifecycle |

**What AgentDock can realistically present from static analysis alone:**

- Presence and count of executable/bundled scripts, with paths and sizes (D3)
- Shell invocation patterns found in scripts and in SKILL.md body
- Network egress: hostnames and URLs appearing in scripts and instructions
- Filesystem paths referenced, especially sensitive ones (`~/.ssh`, `.env`, credential stores)
- Environment variables read
- Declared `allowed-tools` / permission frontmatter
- Instruction-shaped injection patterns (D2)
- Repo lifecycle facts: archived, fork, last commit, owner type
- **Optionally**, since it's free and honest: link out to the artifact's OpenSSF Scorecard rather than reimplementing it

**Wording rules — treat these as hard product constraints, not copy suggestions:**

| Do | Don't |
|---|---|
| "This skill bundles 2 executable scripts." | "This skill is safe." |
| "Network references found: `api.example.com` — [line 42](permalink)" | "No malicious behavior detected." |
| "No scripts, no network references, no shell invocations found by static analysis." | "✅ Verified safe" / "Security score: 92/100" |
| "AgentDock performs static text analysis only. It does not execute artifacts and cannot detect obfuscated or intentionally hidden behavior." | Any badge, shield, or checkmark on the security surface |
| Verbs of observation: *found*, *references*, *declares*, *bundles* | Verbs of judgment: *safe*, *clean*, *verified*, *trusted*, *approved* |

**The liability argument, stated plainly.** A "SAFE" verdict is not merely inaccurate — it inverts the product's value. The user came to AgentDock precisely because they could not evaluate the artifact themselves. Handing them a green check replaces their judgment with AgentDock's, and AgentDock's judgment is a regex over text that Snyk has already demonstrated returns **"CLEAN. 0 findings"** on a working malicious skill. At that point AgentDock is not neutral about a bad install; it *caused* it. The absence of a verdict is the feature. Every finding must be a fact with a link, so the reader draws the conclusion and can check the work (D8).

One more framing worth putting in the UI: **absence of evidence is displayed as absence of evidence.** "No capability indicators found" — never "nothing dangerous here".

---

## 5. Compatibility Presentation

A boolean or a row of runtime logos implies knowledge AgentDock does not have. Use a four-term vocabulary, of which MVP supports three:

| Term | Meaning | Evidence | In MVP? |
|---|---|---|---|
| **Declared** | The artifact itself claims it | `compatibility` frontmatter field, `marketplace.json` entry, `gemini-extension.json`, `server.json` | **Yes** |
| **Inferred** | AgentDock deduced it from location or format convention | Found at `.claude/skills/` → Claude Code; `.cursor/rules/*.mdc` → Cursor; `.agents/skills/` → any SKILL.md-compatible client; `gemini-extension.json` → Gemini CLI | **Yes** |
| **Unknown** | Neither declared nor inferable | — | **Yes** (and shown, not hidden) |
| **Verified** | Actually observed loading and working in that runtime | Requires execution | **No — and not soon.** Execution is out of scope per PROJECT.md. Reserve the word; never use it before it's earned. |

Presentation rules:
- Each runtime chip shows its term. Hover/expand reveals the evidence ("inferred from path `.claude/skills/foo/SKILL.md`").
- **`inferred` must not get a green check.** Visually distinguish declared vs inferred vs unknown — otherwise the vocabulary is decoration.
- Show `unknown` explicitly. "We don't know" is information; a blank chip is not.
- The generic SKILL.md format is broadly portable (six major agents supported it natively as of March 2026), so *most* skills will infer to "any SKILL.md-compatible client" rather than to a specific vendor. That is the honest answer and it should be a first-class value, not a fallback.

**Important nuance the vocabulary must not paper over:** "compatible" is not one thing across artifact types. A Claude Code *plugin* and a Gemini CLI *extension* and a Cursor *rule* are not the same artifact wearing different labels — they are different formats with different manifests. Compatibility applies within an artifact type, not across them. The UI should never suggest a `.mdc` Cursor rule "works with Claude Code".

---

## 6. Versioning and Freshness for Unversioned Artifacts

Most indexed artifacts are plain files in a Git repo with no semantic version. Inventing one is a lie; omitting all identity makes the page unciteable.

**The precedent is Go.** For untagged commits, `pkg.go.dev` displays a *pseudo-version*: `v0.0.0-<UTC yyyymmddhhmmss>-<12-char commit hash>` — a base prefix, the commit timestamp, and a truncated SHA. It is explicitly ordered *below* any real tag, so a tagged version always wins. That's the right mental model: **a synthetic identity that is transparently synthetic.**

**Minimum useful thing to show (MVP):**

```
Indexed at  a1b2c3d  ·  committed 2026-08-01  ·  indexed 2026-08-10
```

Three facts, all verifiable via the TS6 permalink. Plus:

- **Content hash** of the artifact's files, stored but not necessarily displayed — it is what makes "changed since indexed" (L1) and duplicate detection (§3) possible later. Store it from day one; it costs nothing and cannot be backfilled for history.
- **If the repo has tags/releases**, show the latest tag *and* be explicit that the tag versions the repository, not necessarily this file. A repo tag on a monorepo says almost nothing about one `SKILL.md` inside it.
- **`updated_at` should be the last commit touching the artifact's own path**, not the repo's last push. Repo-level push dates make a two-year-old abandoned skill in an active monorepo look fresh — a directly misleading freshness signal.

**What "version history" means for an unversioned SKILL.md:** at MVP, nothing — and pretending otherwise is worse than omitting it. There is exactly one honest version-history feature and it belongs to L1: *"the content at this path changed between index N and index N+1, and here is the capability delta."* That is genuinely valuable (it is how a benign skill turning malicious becomes visible), and it is the natural v1.x headline. It requires only the content hash and a re-index job — not a version model. **Do not build a version table in MVP.** Build the hash column.

---

## 7. Account-Gated Features: The Blunt Assessment

**An MVP with zero authentication is achievable here, and that is worth a great deal.**

Everything in Table Stakes and Differentiators above is a read-only view over publicly-sourced data. Submission (§3) is the only write, and it is rate-limited rather than authenticated. That means the MVP ships with: no session management, no CSRF surface, no password or OAuth flow, no account recovery, no email delivery, no deletion/GDPR obligation, no user-generated content to moderate, no ban/abuse tooling, and no user-data breach exposure.

**What auth would cost.** Not the login button — the login button is a day. The cost is that auth is a *permanent tax on every subsequent feature*: every new page acquires an authorization question, every new table acquires an ownership column, every write path acquires a CSRF and rate-limit consideration, and anything user-generated acquires a moderation queue that a part-time solo maintainer must service forever. PROJECT.md's own constraint — "anything requiring ongoing manual curation at scale will not survive" — applies to moderation more sharply than to anything else.

| Feature | Needs auth? | Verdict |
|---|---|---|
| Favorites / bookmarks | **No** | `localStorage`. Ships in an hour, works offline, zero backend. The lazy answer is the correct answer. Sync across devices is the only thing lost, and nobody has two devices for a local WSL app. |
| Collections | Only if shared | `localStorage` for private; **Later (L3)** for public — and public collections are curation, which doesn't survive (AF7 reasoning) |
| Ratings | Yes | **Anti-feature (AF3).** Noise at low volume, gamed at high volume. |
| Comments | Yes | **Anti-feature (AF3).** Moderation is unbounded unpaid labor. |
| User profiles | Yes | No purpose without ratings/comments/collections. Circular. |
| Watch / notify (L2) | **Yes — genuinely** | The *only* feature that truly requires identity, because it requires a delivery address. This is the correct trigger for introducing auth, and it should be introduced *for* this feature, not before it. |
| Publisher claiming (L8) | Yes | Later, and only with real publisher demand |

**Recommendation: no authentication in this milestone.** Introduce it exactly once, when building L2 (watch/notify), and prefer the narrowest possible mechanism at that time (e.g. GitHub OAuth only, no local passwords, no profile pages).

---

## 8. CLI: Investigated Concretely

### Does the CLI or the website deliver the core value first?

**The website.** The core value is *"see what it will actually do to your machine before installing it."* That is a reading task: rendered markdown, a file inventory table, capability findings each linking to a highlighted upstream source line. It is a poor fit for a terminal and an excellent fit for a page. A CLI that prints capability findings is strictly worse than a URL.

### What does `install` actually mean across the runtimes?

This is where the feature dies. It is not one operation with five paths — it is **at least six structurally different operations**, several of which are not "copy a directory" at all:

| # | Mechanism | Runtimes | What it actually is |
|---|---|---|---|
| 1 | Copy a directory containing `SKILL.md` | Claude Code (`~/.claude/skills/<name>/`, `.claude/skills/<name>/`); cross-client (`~/.agents/skills/<name>/`, `<proj>/.agents/skills/<name>/`); OpenCode (`~/.config/opencode/skills/`); Cursor (`~/.cursor/skills/`) | File copy — the easy case, and even here the target differs per runtime and per scope |
| 2 | Register a marketplace, then install a named plugin | Claude Code plugins — `.claude-plugin/marketplace.json` at repo root, install syntax `<plugin>@<marketplace>` | Two-step stateful operation against the client's own config, not a file copy |
| 3 | Invoke the vendor's own installer | Gemini CLI — `gemini extensions install <git-url>` → `~/.gemini/extensions/<name>/` | Shelling out to a third-party binary AgentDock does not control |
| 4 | Author a differently-formatted file | Cursor rules — `.cursor/rules/*.mdc`, MDC = markdown + YAML frontmatter with `globs` / `alwaysApply` activation fields | **Not a copy.** A `SKILL.md` is not an `.mdc`; converting requires inventing activation globs. |
| 5 | Merge text into an existing instruction file | Codex — files pulled from `~/.codex` plus every directory from repo root to cwd, merged in order | Editing a user's existing file, with conflict and idempotency problems |
| 6 | Edit a JSON config to add a server entry | MCP servers across every client — `claude_desktop_config.json`, `.mcp.json`, `.cursor/mcp.json`, `opencode.json`, … | JSON surgery on user config, different shape per client |

Add: user vs project scope for each; name-collision precedence rules (project overrides user, per the emerging convention); and the fact that **these conventions are changing monthly** — `.agents/skills/` only became the widely-adopted cross-client path during 2026.

### The decisive fact

**This problem is already solved by a better-resourced team.** `npx skills` (vercel-labs) supports **75+ agents** with a maintained per-agent path table, plus `add`, `use`, `find`, `list`, `update`, `remove`, bounded 3-level skill discovery covering flat and category layouts, and `.claude-plugin/marketplace.json` compatibility. A desktop `skills-manager` covers 52 agents. A solo part-time maintainer re-implementing and *maintaining* that path table against monthly vendor changes is signing up for an unbounded treadmill that produces no differentiation.

### Recommendation

| | Verdict |
|---|---|
| **MVP** | **No CLI.** Ship TS5: a per-runtime install instruction rendered as **copyable text**, with a copy button. Zero execution, zero state on the user's machine, zero blast radius. When an instruction goes stale the user sees a wrong command and notices — versus a tool that silently writes to the wrong directory. Where a mature installer exists, link to it (`npx skills add owner/repo`, `gemini extensions install <url>`). |
| **Later (L4)** | A **read-only** `agentdock search` / `agentdock info` CLI, if and only if web usage generates demand. Thin HTTP client over L9's API. Cheap, no filesystem writes. |
| **L5 / effectively never** | `agentdock install`. Six mechanics × N runtimes × 2 scopes × monthly churn, in a domain where a bug means writing attacker-supplied files into a user's agent config. Cede this to `npx skills`. |

---

## Feature Dependencies

```
TS12 (ingest by GitHub URL)          ← the foundation; nothing exists without it
  ├──requires──> GitHub API client (rate-limit aware, ETag conditional requests)
  ├──requires──> per-type artifact parsers (skill / plugin / MCP / command / hook)
  │                └──enables──> D5 (cross-ecosystem index)
  ├──enables──> TS1, TS3, TS6, TS7, TS10
  ├──enables──> D3 (file inventory)   ← falls out of the tree walk, nearly free
  │                └──enables──> D1 (capability disclosure)
  │                                 ├──enables──> D2 (injection surface flags)
  │                                 ├──enables──> D7 (capability facet filter)
  │                                 └──requires──> D8 (source-line permalinks)
  ├──enables──> D4 (compatibility vocabulary)   ← "inferred" comes from discovery path
  ├──enables──> D6 (honest identity line)
  └──produces──> content hash ──enables──> L1 (change detection)
                                              └──enables──> L2 (watch/notify)
                                                               └──requires──> L7 (accounts)

TS2 (full-text search) ──requires──> TS12 (something to search)
       └──enhanced by──> TS8, TS9, D7 (filters compose as WHERE clauses)
       └──requires──> query logging ──gates──> L6 (semantic search decision)

TS4 (rendered body) ──requires──> HTML sanitization   ← hard dependency, security-critical

D1 (capability disclosure) ──conflicts with──> AF1 (safety verdict)
       Showing both destroys the first: users read the badge and skip the facts.

AF7 (catalog size) ──conflicts with──> D1 (depth)
       Crawl breadth and analysis depth trade directly against one maintainer's time.

L4 (read-only CLI) ──requires──> L9 (public API)
L2 (watch/notify) ──requires──> L1 + L7 + email delivery
```

### Dependency Notes

- **D1 requires D3, not the reverse.** Build the file inventory first — it is S complexity, immediately shippable, and is the data structure capability analysis walks over.
- **D7 is nearly free once D1 exists.** Three boolean columns. Do not defer it to a "filters phase"; ship it with D1 or the differentiator is invisible in the listing view.
- **D8 must be designed into D1 from the start.** Retrofitting source-line provenance onto findings means re-running every analysis. Every finding record carries `(file_path, line_number, commit_sha)` from day one.
- **Content hash is a day-one column with a v1.x payoff.** It cannot be backfilled for history, and it is the sole prerequisite for the strongest future feature (L1→L2).
- **Search query logging gates the semantic-search decision.** Without it, L6 becomes a taste argument instead of a measurement.
- **D1 conflicts with AF1 in the UI, not just in policy.** If a summary badge appears anywhere on the card or page, users stop reading the panel — the badge wins attention every time. This is why AF1 is an anti-feature rather than "later".

---

## MVP Definition

### Launch With (v1)

**Theme: a small index where every entry is fully analyzed, honestly labeled, and traceable to source.**

- [ ] **TS12** Ingest a public GitHub repo by URL → discover artifacts → confirm → persist — *nothing works without it*
- [ ] **TS1** Paginated listing with 6-field cards — *the front door*
- [ ] **TS2** Postgres FTS (`tsvector`+GIN) with `pg_trgm` fallback and weighted `ts_rank_cd` — *search is the product's verb*
- [ ] **TS3** Detail page with the standard registry anatomy — *learned expectation*
- [ ] **TS4** Sanitized rendered SKILL.md / README body — *security-critical, non-negotiable*
- [ ] **TS5** Per-runtime install instruction as copyable text — *closes the loop without a CLI*
- [ ] **TS6** Source provenance: repo + path + SHA + permalink — *makes every other claim auditable*
- [ ] **TS7** Freshness: artifact-path last-commit date, indexed-at, archived-repo flag — *best value per line in the build*
- [ ] **TS8 / TS9** Type and runtime filters — *two WHERE clauses*
- [ ] **TS10** GitHub stars/forks, honestly labeled — *never as downloads, never the default sort*
- [ ] **TS11** Zero-result state with trigram suggestions + submit CTA
- [ ] **D3** Full artifact file inventory (path, size, type, exec bit) — *cheapest differentiator*
- [ ] **D1** Capability disclosure panel — ***the product***
- [ ] **D2** Prompt-injection surface flags, worded per §4 — *the urgent half of D1*
- [ ] **D7** Capability facet filter — *the query nobody else can answer*
- [ ] **D8** Source-line permalinks on every finding — *shows the work, caps liability*
- [ ] **D4** Compatibility vocabulary: declared / inferred / unknown — *credible where competitors guess*
- [ ] **D6** Honest identity line (SHA + commit date + indexed date) — *no fake versions*
- [ ] **D5** Cross-ecosystem types in one index — *falls out of the parser interface*
- [ ] Content hash column (stored, not surfaced) — *unlocks L1/L2 later, unbackfillable*
- [ ] Search query + result-count logging — *the evidence base for the search roadmap*

**Explicitly NOT in v1:** authentication, ratings, comments, collections, CLI, semantic search, notifications, public API, SEO surface, version tables.

### Add After Validation (v1.x)

- [ ] **L1** Re-index + change detection with capability delta — *trigger: index >200 artifacts, or first stale entry noticed*
- [ ] **L9** Public read-only JSON API — *trigger: first third-party asks*
- [ ] **L11** SEO surface (sitemap, OG, structured data) — *trigger: public deploy*
- [ ] **L4** Read-only `agentdock search` / `info` CLI — *trigger: repeated requests from web users; requires L9*

### Future Consideration (v2+)

- [ ] **L2** Watch / notify on capability change — *the strongest future feature; requires L1 + L7 + email*
- [ ] **L7** Accounts — *introduce only in service of L2, GitHub OAuth only*
- [ ] **L6** Semantic search — *only on the §2 measured trigger, and only if the DB image change is justified*
- [ ] **L10** Trends / new-this-week — *needs 6 months of index history*
- [ ] **L8** Publisher claiming — *needs real publisher demand*
- [ ] **L3** Public curated collections — *needs a second maintainer*

---

## Feature Prioritization Matrix

| Feature | User Value | Impl. Cost | Priority |
|---|---|---|---|
| TS12 Ingest pipeline | HIGH | HIGH | P1 |
| D1 Capability disclosure | HIGH | HIGH | P1 |
| D3 File inventory | HIGH | LOW | **P1 — build first** |
| D7 Capability filter | HIGH | LOW | **P1 — build with D1** |
| TS7 Freshness + archived flag | HIGH | LOW | **P1** |
| TS6 Source provenance | HIGH | LOW | **P1** |
| D6 Honest identity line | MEDIUM | LOW | P1 |
| TS2 Full-text search | HIGH | MEDIUM | P1 |
| TS4 Sanitized body render | HIGH | LOW | P1 |
| TS5 Copyable install text | HIGH | LOW | P1 |
| D2 Injection surface flags | HIGH | MEDIUM | P1 |
| D4 Compatibility vocabulary | MEDIUM | MEDIUM | P1 |
| TS1 / TS3 Listing + detail | HIGH | MEDIUM | P1 |
| TS8 / TS9 Type + runtime filters | MEDIUM | LOW | P1 |
| D8 Source-line permalinks | MEDIUM | LOW | P1 |
| D5 Cross-ecosystem types | MEDIUM | MEDIUM | P1 |
| TS10 Stars display | LOW | LOW | P1 (cheap, expected) |
| Content hash column | (future) | LOW | **P1 — unbackfillable** |
| Query logging | (future) | LOW | **P1 — unbackfillable** |
| L1 Change detection | HIGH | MEDIUM | P2 |
| L9 Public API | LOW | LOW | P2 |
| L4 Read-only CLI | LOW | MEDIUM | P3 |
| L2 Watch/notify | HIGH | HIGH | P3 (v2 headline) |
| L7 Accounts | LOW (alone) | HIGH | P3 |
| L6 Semantic search | LOW | HIGH | P3 |
| L5 CLI install | LOW | VERY HIGH | **Never** |

---

## Competitor Feature Analysis

| Feature | skills.sh / `npx skills` (Vercel) | Agensi (paid) | ClaudeSkills.info / claudemarketplaces.com / SkillsMP | Official MCP Registry | **AgentDock** |
|---|---|---|---|---|---|
| Entry method | Community + GitHub as registry | Curated submission | Automated GitHub scraping | Publish API, namespace-validated `server.json` | URL paste → discover → confirm |
| Catalog size | Large | Small, curated | Very large (23,600 / 2.5M claimed) | Growing | **Deliberately small** |
| Search / filters | ✓ (`skills find`) | ✓ | ✓ | REST API | ✓ FTS + type/runtime/**capability** |
| Security analysis | ✗ | ✓ 8-point scan (paid) | ✗ | ✗ | **✓ free, capability-level, sourced** |
| Safety verdict shown | — | Implied by curation | — | — | **Deliberately none (AF1)** |
| Install CLI | ✓ **75+ agents, maintained** | ✓ one-command | Manual | Client-dependent | **Copyable text only — cede this** |
| Accounts | Not required | ✓ (payments) | Not required | Publisher auth | **None** |
| Ratings | Leaderboard via telemetry | Revenue share | ✗ | ✗ | **Never (AF3)** |
| Cross-ecosystem | Skills only | Skills only | Skills + MCP + plugins (separate silos) | MCP only | **✓ one search** |
| Version honesty | Git-based | — | Varies | `server.json` versions | **✓ SHA + dates, no fake semver** |

**Where AgentDock wins:** capability transparency, honest labeling, cross-ecosystem single search, compatibility confidence vocabulary.
**Where AgentDock must not compete:** catalog size, install automation, curation-at-scale, payments.

---

## Confidence & Gaps

| Area | Confidence | Basis |
|---|---|---|
| Established-registry table stakes | MEDIUM–HIGH | Vendor docs cross-checked (npm, PyPI, crates.io, pkg.go.dev, Docker, VS Code) |
| Agent-runtime install paths | MEDIUM | Cross-checked against `vercel-labs/skills` README path table and the agentskills.io client-implementation guide. **Volatile — re-verify before implementing TS5.** |
| Security-signal presentation | MEDIUM–HIGH | Snyk ToxicSkills + skill-scanner critique, Socket.dev docs, npm provenance analyses |
| Competitor feature matrix | MEDIUM–LOW | Partly from a competitor's own comparison article (agensi.io), which is not disinterested. Catalog-size claims are self-reported marketing numbers, treat as order-of-magnitude only. |
| Search sizing recommendation | MEDIUM | Corpus size is an assumption, not a measurement — hence the query-logging requirement |
| SkillMaru reference product | **LOW / UNVERIFIED** | `skillmaru.hell0world.net` returned no analyzable content (likely a client-rendered SPA). **Gap: the maintainer should inspect it manually** — PROJECT.md names it the closest analog for information architecture. |

**Open questions for later phases:**
- Actual artifact-type distribution in the wild (how many MCP servers vs skills) — affects parser priority ordering
- Whether `.agents/skills/` consolidation continues or fragments again — affects D4's inference rules
- Whether prompt-injection pattern detection produces a tolerable false-positive rate on real corpora; if it doesn't, D2 ships as "instruction patterns worth reading" rather than as flags

---

## Sources

**Reference product**
- https://skillmaru.hell0world.net/ (attempted; no analyzable content returned)

**Agent runtime formats and install locations**
- https://code.claude.com/docs/en/skills
- https://code.claude.com/docs/en/plugin-marketplaces
- https://github.com/anthropics/claude-code/blob/main/.claude-plugin/marketplace.json
- https://agentskills.io/client-implementation/adding-skills-support
- https://github.com/vercel-labs/skills/blob/main/README.md
- https://www.skills.sh/docs/cli
- https://www.skills.sh/agent/claude-code
- https://cursor.com/docs/rules
- https://google-gemini.github.io/gemini-cli/docs/extensions/
- https://github.com/google-gemini/gemini-cli/blob/main/docs/extensions/reference.md
- https://github.com/google-gemini/gemini-cli/issues/5990
- https://opencode.ai/docs/config/
- https://developers.openai.com/codex/cli
- https://developers.openai.com/codex/config-advanced
- https://github.com/xingkongliang/skills-manager
- https://www.mdskills.ai/docs/install-skills

**Registry conventions**
- https://docs.npmjs.com/deprecating-and-undeprecating-packages-or-package-versions/
- https://docs.npmjs.com/using-deprecated-packages/
- https://docs.pypi.org/project-management/yanking/
- https://discuss.python.org/t/marking-packages-on-pypi-as-unmaintained-or-obsolete/37742
- https://crates.io/search
- https://rust-lang.github.io/rfcs/1824-crates.io-default-ranking.html
- https://blog.rust-lang.org/2026/07/13/crates-io-development-update/
- https://go.dev/ref/mod
- https://go.dev/doc/modules/version-numbers
- https://research.swtch.com/vgo-module
- https://docs.docker.com/docker-hub/repos/manage/trusted-content/
- https://www.docker.com/blog/docker-verified-publisher-trusted-sources-trusted-content/
- https://code.visualstudio.com/api/working-with-extensions/publishing-extension
- https://code.visualstudio.com/docs/configure/extensions/extension-runtime-security
- https://developer.microsoft.com/blog/security-and-trust-in-visual-studio-marketplace/
- https://github.com/microsoft/vscode/issues/127825
- https://registry.modelcontextprotocol.io/
- https://modelcontextprotocol.io/registry/about
- https://github.com/modelcontextprotocol/registry
- https://blog.modelcontextprotocol.io/posts/2025-09-08-mcp-registry-preview/

**Trust, security, provenance**
- https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/
- https://snyk.io/blog/skill-scanner-false-security/
- https://snyk.io/blog/clawhub-malicious-google-skill-openclaw-malware/
- https://labs.cloudsecurityalliance.org/research/csa-research-note-skill-md-agent-context-poisoning-20260506/
- https://arxiv.org/html/2602.14211 (SkillJect)
- https://arxiv.org/pdf/2606.19191 (PhantomSkill)
- https://arxiv.org/pdf/2606.18198 (Multimodal hidden instruction attacks on skill scanners)
- https://arxiv.org/html/2604.06550v1 (SkillSieve)
- https://www.hiddenlayer.com/research/the-next-ai-supply-chain-risk-malicious-skills-in-agentic-ai
- https://obot.ai/blog/mcp-security-agent-skills-supply-chain/
- https://docs.socket.dev/docs/package-scores
- https://docs.socket.dev/docs/organization-alerts
- https://github.com/ossf/scorecard/blob/main/docs/checks.md
- https://scorecard.dev/
- https://docs.npmjs.com/generating-provenance-statements/
- https://github.blog/security/supply-chain-security/introducing-npm-package-provenance/
- https://blog.sigstore.dev/cosign-verify-bundles/
- https://www.endorlabs.com/learn/malicious-package-detection
- https://safedep.io/the-state-of-mcp-registries/

**Popularity signal quality**
- https://cmustrudel.github.io/papers/icse2026fakestars.pdf
- https://arxiv.org/html/2412.13459v2
- https://dev.to/alanwest/how-to-spot-fake-github-stars-before-they-burn-you-28op

**Competitive landscape**
- https://www.agensi.io/learn/complete-list-ai-agent-skill-directories-2026
- https://www.agensi.io/learn/best-ai-agent-skills-marketplaces-2026
- https://claudemarketplaces.com/skills
- https://www.claudemarket.ai/
- https://lobehub.com/skills
- https://skillsmp.com/
- https://mcpmarket.com/tools/skills
- https://awesomeclaude.ai/awesome-claude-skills
- https://dev.to/stevengonsalvez/skillssh-npm-for-agent-skills-35jc

**Submission / curation burden**
- https://github.blog/open-source/maintainers/how-pull-request-limits-are-cutting-down-the-noise/
- https://github.blog/open-source/maintainers/welcome-to-the-eternal-september-of-open-source-heres-what-we-plan-to-do-for-maintainers/
- https://github.com/orgs/community/discussions/185387
- https://dev.to/opensauced/navigating-spammy-and-low-quality-prs-a-guide-for-maintainers-39p3

**Search implementation**
- https://github.com/aiven-labs/pg-text-search-comparisons
- https://aiven.io/blog/different-ways-to-search-text-in-postgresql
- https://anyblockers.com/posts/postgres-as-a-search-engine
- https://www.enterprisedb.com/blog/enhancing-search-capabilities-postgresql-standard-semantic

---
*Feature research for: AI agent extension registry / discovery platform*
*Researched: 2026-08-10*
