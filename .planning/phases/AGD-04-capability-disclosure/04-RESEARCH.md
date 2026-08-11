# Phase 4: Capability Disclosure - Research

**Researched:** 2026-08-11
**Domain:** Static capability extraction and disclosure UI for untrusted AI agent artifacts (no execution, no scoring)
**Confidence:** MEDIUM-HIGH. HIGH on what the code currently does (all claims below are Read/grep-verified against `src/`). MEDIUM on classification design (Q3) because it is a product judgment call, not a fact. MEDIUM-LOW on the false-positive pilot (Q5) because the 84-file corpus is skills-only and benign — no confirmed-malicious sample exists to validate recall, only precision on a clean sample.

No `CONTEXT.md` exists for this phase (same as Phase 3: the maintainer plans from research directly). This document is therefore the sole upstream input to the planner.

---

## Summary

Phase 3 left six detectors that each read one manifest and store one artifact row with a capped, mostly-unstructured `body`. Phase 4 does not add a seventh detector — it adds a second pass, over data the pipeline already has in memory or already wrote to `package_version`, that answers "what can this artifact do" as a set of independently-testable, disclosure-framed observations. The central engineering finding is that **almost none of the "hard" classification problem is actually hard once measured**: across 84 real `SKILL.md` bodies from four frozen corpora, `allowed-tools` frontmatter appears **zero times**, `curl | sh`-shaped remote execution appears **zero times**, and a naive install-directive pattern (`npm install|npx|pip install|brew install`) measured a **5% false-positive rate on 20 hand-checked hits** (§Q5) — comfortably under the ROADMAP's 20% kill line. The genuinely hard, real, and previously-undocumented finding is Q4: bare URLs split roughly **77% documentation-reference / 23% fetch-request** in this corpus (§Q4), and a naive bare-URL regex has a **concrete false-positive class** (XML namespace URIs such as `xmlns="http://www.w3.org/2000/svg"`) that a plan must exclude by name.

Three findings are load-bearing for planning and are not obvious without reading the code:

1. **CAP-01's executable bit is thrown away today, for free data already in hand.** GitHub's Trees API returns `mode` on every entry (`100755` = executable) and the project's own captured fixture (`fixtures/anthropics-skills/tree.json:1533-1538`) proves it is present in the exact response AgentDock already fetches — `src/github/tree.ts`'s mapper simply never reads it. Fixing this costs zero new GitHub requests.
2. **CAP-07 conflicts with the code Phase 1 shipped, not with nothing.** `SkillBody.tsx`'s current sanitizing pipeline *already silently drops HTML comments* (`SkillBody.test.tsx:52-56`, asserting `expect(html).not.toContain('<!--')`) and this is *correct and must not change* — Pitfall 3's XSS control depends on it. CAP-06/07 cannot be satisfied by changing that component; it requires a **separate detection pass over the raw stored body**, feeding a **separate disclosure panel**, never re-injecting attacker text into the safe-render path.
3. **Phase 2's idempotency already solves Phase 4's hardest persistence question for free.** Because `package_version` re-ingest with unchanged content is `ON CONFLICT DO NOTHING` (no new row, `schema.ts:166-168`), findings keyed on `package_version_id` cannot duplicate on re-ingest by construction — provided analysis runs only when a new version row is actually inserted, never on the `unchanged` short-circuit path.

**Primary recommendation:** Build capability disclosure as a new `src/analyze/` sibling to `src/detect/` — pure, synchronous, line-based (not AST, not a general regex framework) functions that take a `body: string` and return `Finding[]`, run once per genuinely-new `package_version` row inside the existing ingest transaction, persisted to one new additive table keyed on `package_version_id`. Ship the six detectors the project's own `PITFALLS.md` already named as high-precision (declared capability, bundled-script inventory, remote-execution shape, install shape, egress inventory, hidden content) and nothing else. No new runtime dependency.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| File inventory (CAP-01) | API/Backend — computed inside the existing ingest pipeline from the already-fetched tree | Frontend Server (SSR) — renders the table | The bounded tree (`fetchRepoScanInputs`) already holds every entry's `path`/`size`/`type`; only `mode` needs to be added. Zero new GitHub calls. |
| Declared capability extraction (CAP-02) | API/Backend — reads `packageVersion.frontmatter`, already stored intact | Frontend Server (SSR) | `allowed-tools` is already parsed and normalized to tokens by `skill.ts`/`command.ts` (`meta.allowedTools`); Phase 4 adds interpretation of an existing field, not new parsing. |
| Observed capability detection (CAP-04, CAP-05) | API/Backend — new `src/analyze/` pure functions over `packageVersion.body` | — | New code, but the same "pure, path/text-only, capped input" shape every existing detector already uses. |
| Bundled-script inventory (CAP-03) | API/Backend — derived from the tree, same as CAP-01 | Frontend Server (SSR) | A subset of the file inventory: entries under the artifact's directory matching an executable-script extension. No script content is read. |
| Hidden-content detection (CAP-06) | API/Backend — new analyzer, runs once at ingest on the raw stored body | — | Detection must run on unmodified raw text, before any markdown/sanitize transform. |
| Hidden-content sentinel rendering (CAP-07) | Frontend Server (SSR) — a **new, separate** display path from `SkillBody` | — | Must not touch `SkillBody.tsx`'s sanitize pipeline (Pitfall 3 depends on it dropping raw HTML/comments). A dedicated "Hidden content" panel shows escaped, sentinel-substituted text. |
| Source-line permalinks (CAP-08) | API/Backend — line offsets computed against the exact string a detector scanned | Frontend Server (SSR) — renders `permalink() + '#L' + n` | `permalink()` already exists (`src/db/queries/packages.ts`); only the `#L<n>` suffix and the line-counting rule are new. |
| "Not checked" block (CAP-09) | Frontend Server (SSR) — static copy | — | No backend logic; a fixed, permanently-visible paragraph. |
| Vocabulary lint (CAP-10, CAP-12) | Build/CI tooling — extends `scripts/check-boundaries.mjs` | — | Not a runtime tier at all; a static-analysis gate over `src/app` and `src/components` source, following the project's own established pattern (Rule 5). |
| Absence-as-fact rendering (CAP-11) | Frontend Server (SSR) | — | A rendering convention ("not detected"), not new data. |
| False-positive measurement (CAP-13) | Process/tooling — a recorded, auditable measurement, not a runtime feature | — | Lives in a committed corpus + test file, per the project's own `fixtures/adversarial/README.md` convention. |
| Input caps / ReDoS bound (CAP-14) | API/Backend — bounded, non-backtracking scan functions | — | Same posture as `json.ts`/`frontmatter.ts`: caps checked before/during the scan, never "trust the regex engine." |

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CAP-01 | File inventory: path, size, type, executable bit | §Q11 — `mode` is already fetched and discarded; fix in `src/github/tree.ts` + `types.ts`, zero new requests |
| CAP-02 | Declared capabilities extracted and displayed | §Q2 — `allowed-tools` vocabulary confirmed from official spec; zero real occurrences in the 84-file corpus, so display must handle the empty case honestly |
| CAP-03 | Bundled executable scripts inventoried, labeled not-analyzed | §Q12 — 248 real bundled script files measured across the four corpora; inventory-only, derived from the tree, no content read |
| CAP-04 | Outbound URLs inventoried | §Q1, §Q4 — 66 bare-URL occurrences measured and hand-classified; `external_reference` design |
| CAP-05 | Remote-execution and install directives surfaced | §Q1, §Q3, §Q5 — pilot measurement on real corpus; `Bash(*)` classification rule |
| CAP-06 | Hidden/invisible content detected | §Q7 — codepoint list, and what the current render pipeline already does to each class |
| CAP-07 | Hidden content shown with visible sentinels, never stripped, raw bytes retained | §Q7 — conflict with `SkillBody.tsx`'s existing (correct) comment-stripping identified and resolved |
| CAP-08 | Every finding has file path, line number, permalink at pinned commit | §Q6 — `body` is unstripped raw source (not `parsed.body`), so line numbers computed on `body` already align with GitHub; truncation is a coverage bound, not a correctness bug |
| CAP-09 | Permanent "not checked" section | Standard Stack / Code Examples — static copy block |
| CAP-10 | No risk score/grade/safe-verdict vocabulary, ever | §Q13 — lint design extending `scripts/check-boundaries.mjs` |
| CAP-11 | Absence renders as "not detected" | Common Pitfalls — rendering convention, ties to CAP-10 |
| CAP-12 | Verbs of observation, never judgment | §Q13 — same lint mechanism as CAP-10 |
| CAP-13 | Hand-checked false-positive rate per detector, ≥20% kills the detector | §Q5 — measurement procedure specified and piloted live |
| CAP-14 | Bounded, capped patterns; no catastrophic backtracking | §Q8 — line-based scanning recommended over general regex; caps specified |
| QUA-03 | Detectors/analyzers/identity logic unit-tested | Validation Architecture — mirrors the existing `src/detect/*.test.ts` pattern |
| QUA-05 | Security fixtures are permanent regression tests | Validation Architecture — hidden-content and ReDoS fixtures join `fixtures/adversarial/` |
</phase_requirements>

---

## Central Research Questions — Findings

### Q1. Capability expression patterns in real artifacts

Read all 84 real bodies across `fixtures/{addyosmani-agent-skills,anthropics-skills,baoyu-skills,wshobson-agents}/files/*` `[VERIFIED: fixtures/*/files/* — grep executed this session over every file]`.

| Category | How it actually appears | Real excerpt (source) |
|---|---|---|
| `allowed-tools` frontmatter | **Never** — 0 occurrences of the literal key in 84 files (`grep -rn "allowed-tools" fixtures/*/files/*` returns nothing) | — |
| Shell / fenced code | Overwhelmingly `\`\`\`bash` (76 fences) and `\`\`\`python` (32), never a bare shell prompt outside a fence | `fixtures/anthropics-skills/files/skills%2Fslack-gif-creator%2FSKILL.md:253` — `pip install pillow imageio numpy` inside a ` ```bash ` fence |
| Network — request | **Prose imperative naming a tool**, not a `curl` command. The dominant shape is "Use WebFetch to load `<url>`" / "Fetch from `<url>`" | `fixtures/anthropics-skills/files/skills%2Fmcp-builder%2FSKILL.md:61` — `**TypeScript SDK**: Use WebFetch to load \`https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/main/README.md\`` |
| Network — reference | Markdown link, `homepage:` frontmatter value, or inline code citing a URL with no fetch verb | `fixtures/baoyu-skills/files/skills%2Fbaoyu-post-to-x%2FSKILL.md:7` — `homepage: https://github.com/JimLiu/baoyu-skills#baoyu-post-to-x` |
| Credentials | Almost always **defensive/instructional prose about handling secrets**, not an exfiltration attempt | `fixtures/addyosmani-agent-skills/files/skills%2Fgit-workflow-and-versioning%2FSKILL.md:247` — `**Don't commit** build output (\`dist/\`, \`.next/\`), environment files (\`.env\`)...` |
| `package_install` | Mostly **conditional prose** ("preinstalled — do not run X first; only if Y fails") rather than a bare imperative | `fixtures/anthropics-skills/files/skills%2Fdocx%2FSKILL.md:21` — `` `docx` is preinstalled — do not run `npm install` first; write the script and `require('docx')` directly. Only if that require fails: `npm install docx`. `` |
| `external_reference` (docs) | Markdown link or `homepage:` field; never a fetch instruction | `fixtures/addyosmani-agent-skills/files/skills%2Fcode-simplification%2FSKILL.md:8` — `> Inspired by the [Claude Code Simplifier plugin](https://github.com/anthropics/claude-plugins-official/...)` |
| `hidden_content` | **Never observed in the 84 real files** (this corpus is benign, no adversarial submissions). Present only in the project's own hand-written `fixtures/adversarial/{bidi,unicode}.md` and `fixtures/xss/*.md` `[VERIFIED: fixtures/adversarial/bidi.md, fixtures/xss/html-comment.md — Read this session]` | `fixtures/adversarial/bidi.md:3` — `description: "safe‮gnp.exe"` (U+202E right-to-left override) |
| MCP `command`/`args` | Structured JSON, not prose — already captured verbatim by `src/detect/mcp.ts`'s `meta.servers[].command` | `fixtures/addyosmani-agent-skills/files/skills%2Fbrowser-testing-with-devtools%2FSKILL.md:34` — `"command": "npx",` inside an `.mcp.json`-shaped example |

**Consequence for the plan:** a detector design built only around fenced `bash` blocks and literal `curl`/`wget` will catch almost nothing in this corpus for the network category, because the actual disclosure-worthy shape is an imperative sentence naming a fetch tool. Detector 5 (remote-execution/install, §Q3/Q5) is validated by fenced code; the network detector (§Q4) must scan prose imperatives, not just code fences.

### Q2. Declared vs. observed capability (CAP-02)

`allowed-tools` vocabulary, from the authoritative spec `[CITED: agentskills.io/specification]`, fetched live this session:

> The optional `allowed-tools` field: A space-separated string of tools that are pre-approved to run. Experimental. Support for this field may vary between agent implementations.
> Example: `allowed-tools: Bash(git:*) Bash(jq:*) Read`

The project's own detectors already normalize this correctly: `skill.ts`'s `toolTokens()` (`src/detect/skill.ts:31-35`) splits on whitespace/commas and also accepts a YAML list (tested at `skill.test.ts:206-216` and `fixtures/adversarial/tools-list.md`). The complete field set (`SPEC_KEYS`, `skill.ts:5-12`) is: `name, description, license, compatibility, metadata, allowed-tools` — verified by reading `src/detect/skill.ts:5-12`, matching the spec table exactly.

**Real-world hit rate is zero in this corpus** (§Q1). This must be stated in the plan as an honest fact: `allowed-tools` is the ONE reliably-parseable declared-capability signal, and in the 84 sampled real skills it never fires. CAP-02's UI must render "not declared" cleanly — this is the common case, not an edge case (mirrors the existing pattern for `licenseSpdx` at `PackageRows`/`page.tsx:80-83`, which already documents "Null on the reference repository, so the honest-unknown path is the common path").

**Recommendation — declared vs. observed must be two visually and structurally distinct sections, never merged into one list:**
- `declared` findings: `source: 'frontmatter'`, extracted from `packageVersion.frontmatter['allowed-tools']` — already-parsed, structured, no new detection code, one row per declared tool token.
- `observed` findings: `source: 'body-scan'`, extracted from `packageVersion.body` by the new `src/analyze/*` functions — probabilistic, pattern-based, requires a line number.

A `Bash(git:*)` grant is a fact about what the *author* declared. A `curl` command found in prose is a fact about what the *text says*. Conflating them (e.g., "this skill uses shell" as one bullet, sourced from either) erases exactly the distinction that makes the declared signal trustworthy — the prompt's own instruction to avoid this is correct and is now grounded in a concrete UI design: two headed subsections, "Declared by the author" and "Observed in the file text", never interleaved.

### Q3. The classification question ROADMAP names as the hard one

**"What counts as network access inside a shell-tool grant? Does `Bash(*)` produce three findings, one, or none?"**

**Recommendation: none.** A `Bash(*)` or bare `Bash` grant is a **declared capability finding** in the "Declared by the author" section (§Q2) with its literal text shown verbatim (`allowed-tools: Bash(*)`). It does **not** additionally produce a synthetic "network access", "filesystem access", and "install" finding.

**The mechanical argument:** AgentDock's own hard constraint is "never execute" — it cannot know what a shell grant will actually be used for at runtime, and inferring three sub-capabilities from a coarse grant is exactly the move CAP-11/CAP-12 forbid: it converts an *observed fact about the file* ("the frontmatter says `Bash(*)`") into an *inferred judgment about behavior* ("therefore this skill does network + filesystem + install"). That inference is also frequently wrong in the specific way that damages trust fastest: a `Bash(git:*)` grant (real syntax from the spec) implies none of the three; `Bash(*)` is rare and, when present, its own literal text already communicates unrestricted shell access more honestly than three derived bullets would. **Showing the grant verbatim and stopping there is strictly more accurate than decomposing it**, and decomposition is the kind of "coverage feels like rigor" trap the project's own `PITFALLS.md` Pitfall 6 already names.

The **observed-capability detectors** (curl/wget shape, install shape, egress URLs — §Q1) are separately and independently scanned against the *body text*, regardless of what `allowed-tools` says. A skill can have no `allowed-tools` field at all and still show three observed findings from its prose; a skill can declare `Bash(*)` and show zero observed findings if its prose never mentions a network or install action. **The two channels never inform each other** — this is the same "declared vs. observed, never merged" design from §Q2, and it is what answers the ROADMAP's question cleanly: a coarse grant produces exactly one finding (itself, verbatim), and network/filesystem/install questions are answered entirely by the independent body-text detectors, which will fire on their own evidence or not at all.

### Q4. Network: reference vs. request (prompt §11)

Measured across the corpus: 65 lines contain a bare `http(s)://` URL `[VERIFIED: grep executed this session over fixtures/*/files/*]`. Hand-classified all 65 by the following rule: **request-shaped** = an explicit fetch verb or tool name is directed at the URL in the same sentence, or the URL is passed as a literal argument to a script invocation shown in the text (`WebFetch`, `Fetch from`, `GET`/`POST <url>`, `Navigate to`/`Open ... to <url>`, a shell/script command line containing the URL as an argument). **Reference-shaped** = everything else (a `homepage:` frontmatter field, a Markdown citation link, "Source:", an embedded `<script src>`/`@import url()` template value, an example/pattern value shown for illustration, an XML namespace URI).

| Class | Count | Share | Representative example |
|---|---|---|---|
| `network_request` (explicit fetch/navigate verb, or URL as a live command argument) | ~15 | ~23% | `mcp-builder/SKILL.md:61,65,203,212,213` — five "Use WebFetch to load"/"Fetch from" instructions; `baoyu-post-to-wechat/SKILL.md:212` — `` Endpoint: `POST https://api.weixin.qq.com/cgi-bin/draft/add?...` ``; `baoyu-post-to-x/SKILL.md:266` — `${BUN_X} {baseDir}/scripts/x-quote.ts https://x.com/user/status/123 "..."` |
| `external_reference` (citation, metadata, template value) | ~49 | ~75% | `baoyu-skills/*/SKILL.md:7` — `homepage: https://github.com/JimLiu/baoyu-skills#...` (20 of the 65 hits are this exact frontmatter pattern) |
| **Not a URL at all — false-positive class for a naive detector** | 1 | ~2% | `baoyu-diagram/SKILL.md:214` — `` Include `xmlns="http://www.w3.org/2000/svg"` `` — an XML namespace URI, never fetched, matched by any bare `https?://` regex |

**Recommendation:** `external_reference` and `network_request` are **separate categories**, and the boundary is the presence of an explicit fetch/navigate verb or the URL appearing as a literal argument in a shown command — not the URL's syntactic shape, which is identical in both cases. A naive URL-extraction detector that does not exclude `xmlns=`/`xmlns:*=` context will misclassify XML/SVG namespace declarations as network findings; this must be excluded by name in the pattern (a namespace URI never varies in practice — `http://www.w3.org/2000/svg`, `http://www.w3.org/1999/xhtml`, `http://www.w3.org/1999/xlink` cover the overwhelming majority) or, more simply, by requiring the match to not be immediately preceded by `xmlns` (case-insensitive) within the same line.

Every `network_request` and `external_reference` finding still becomes exactly one `outbound_url` inventory row for CAP-04 (both are "outbound URLs referenced"); the `category` field is what carries the reference/request distinction into the UI and into Phase 6's future filter, per CAP-04's plain requirement ("outbound URLs are inventoried" — it does not ask for the distinction, but §Q3's discipline says do not collapse a real distinction the corpus proves exists).

### Q5. False-positive measurement (CAP-13) — procedure and live pilot

**Procedure the plan must execute, generalized from this session's pilot:**

1. For each candidate detector pattern, run it over all four frozen corpora (`fixtures/{addyosmani-agent-skills,anthropics-skills,baoyu-skills,wshobson-agents}/files/*`), which is the committed, reproducible, zero-GitHub-cost sample the project already has.
2. Take the first 20 hits (or all hits, if fewer than 20 exist — record which case applies).
3. Hand-label each hit **positive** (the matched text genuinely represents the capability the detector claims — e.g., a real install invocation, a real fetch instruction), **negative** (the pattern matched but the text does not represent that capability — e.g., prose *about* the tool's own behavior, a namespace URI, a negated instruction that never executes), or **ambiguous** (a reasonable reader could argue either way, e.g. a conditional/negated directive that also contains a genuine positive clause in the same line).
4. **Score ambiguous as negative** for the purposes of the 20% kill threshold — the ROADMAP's bar exists to protect user trust, and a detector whose hits require an argued judgment call to defend is exactly the kind that "trains users to dismiss the entire panel" (`PITFALLS.md` Pitfall 6). Scoring ambiguous as negative is the conservative, correctly-biased choice.
5. Record the corpus size, hit count, labels, and computed rate in a committed file — `fixtures/adversarial/README.md`'s own table format is the project's precedent (`| File | Content | Expected |`); the equivalent for capability detectors is one row per detector in a new `fixtures/capability-precision.md`, each row naming the pattern version, hit count, FP count, and rate, so a later pattern change is a visible diff against a recorded number rather than an unrecorded rewrite.
6. A detector at or above 20% FP is **removed from the plan entirely**, not tuned — per the ROADMAP's own binding instruction.

**Live pilot run this session, install-directive detector**, pattern `\b(npm install|npm i\b|npx|pip install|pip3 install|uvx|brew install|uv add|uv pip install|bunx)\b` — 78 raw hits, 20 hand-checked in file order `[VERIFIED: grep executed this session, full transcript reproducible from fixtures/*/files/*]`:

| # | Hit | Label | Why |
|---|---|---|---|
| 1 | `npx migrate-check` | Positive | Genuine npx invocation |
| 2 | `npm install` (bare, "Install dependencies:") | Positive | Genuine install directive |
| 3 | `npx tsc --noEmit` | Positive | Genuine npx invocation (may fetch `tsc` if not cached) |
| 4 | `"command": "npx",` (MCP-shaped JSON example) | Positive | Genuine npx invocation, shown as example config |
| 5 | "`-y` skips the **npx install confirmation**" | **Negative** | Prose describing npx's own interactive prompt, not a command being run |
| 6 | `npx prisma migrate rollback` | Positive | Genuine npx invocation |
| 7 | "do not run `npm install` first; ... Only if that require fails: `npm install docx`" | Positive | Contains a genuine conditional install directive in the same line |
| 8 | `# Requires: pip install pytesseract pdf2image` | Positive | Genuine install requirement |
| 9 | "do not run `pip install` first ... `pip install` the missing package" | Positive | Genuine conditional install directive |
| 10 | `- npx` (YAML config list item) | Positive | Genuine npx reference in a runnable config |
| 11 | "if `npx` available → `npx -y bun`" | Positive | Genuine conditional npx invocation |
| 12 | `- npx` (YAML config list item, 2nd file) | Positive | Same as #10 |
| 13 | "if `npx` available → `npx -y bun`" (2nd file) | Positive | Same as #11 |
| 14 | `- npx` (YAML config list item, 3rd file) | Positive | Same as #10 |
| 15 | "prefer `bun`; else `npx -y bun`; else suggest `brew install oven-sh/bun/bun`" | Positive | Two genuine conditional directives in one line |
| 16 | `npx tsc --noEmit` (inside a CI workflow YAML example) | Positive | Genuine npx invocation, shown as generated CI config |
| 17 | `npx prisma migrate deploy` (CI workflow YAML) | Positive | Genuine npx invocation |
| 18 | `npx playwright install --with-deps chromium` (CI workflow YAML) | Positive | Genuine npx invocation (and itself an install) |
| 19 | `npx playwright test` (CI workflow YAML) | Positive | Genuine npx invocation |
| 20 | `npx vercel --token=${{ secrets.VERCEL_TOKEN }}` (CI workflow YAML) | Positive | Genuine npx invocation |

**Result: 1/20 = 5% false-positive rate.** Well under the 20% kill line. **This naive pattern survives and should ship as the install-directive detector**, with one refinement earned by hit #5: exclude a match that is immediately followed by a noun phrase about the tool's own behavior rather than a package name — in practice this is cheap to approximate by requiring the matched token to be followed by whitespace and then something that is not one of a small set of English function words (`install confirmation`, `install prompt`); given this fired once in 78 candidates, the plan may reasonably choose to accept the 5% rate as-is rather than add pattern complexity for a single case (CAP-14 favors fewer, simpler patterns).

**Network-request detector was not independently pilotable at 20 hits** — only ~15 real `network_request`-shaped hits exist in the whole corpus (§Q4), all already hand-classified above with zero false positives when using the "explicit verb + URL" rule (every one of the 15 genuinely names a fetch/navigate action). The one false-positive class found (`xmlns=` namespace URIs) belongs to the broader bare-URL/`external_reference` pattern, not to the verb-gated `network_request` pattern — confirming that gating on an explicit verb, not on URL shape alone, is what keeps this detector's precision high.

**Remote-execution (`curl|sh` shape) could not be measured — zero hits in 84 real files.** This matches `PITFALLS.md`'s own prediction ("HIGH PRECISION... very low FP. Ship it.") and confirms the pattern is rare-but-clean in this corpus; the plan should ship it un-tuned (it is a narrow, literal shape: `curl ... | (sh|bash)`, `wget ... && bash`, `iwr ... | iex`) and rely on the adversarial fixture corpus (a new hand-written positive case) plus the false-positive audit finding zero hits as its "20 hits" evidence — record explicitly in the precision file that 0 real hits were found and the detector's precision is therefore untested-on-real-data, not proven-clean, and flag this honestly in the UI copy's "not checked" section language (it means the detector has never fired, not that it has been validated).

**Credential-path literals were piloted and should NOT ship as a standalone detector.** 27 hits for `.env`/`ANTHROPIC_API_KEY`/`~/.ssh/id_` across the corpus; on inspection every single one is defensive/instructional prose (gitignore hygiene, credential-resolution documentation, a skill's own legitimate `.env` config template) — zero hits represent an actual credential-access action by the artifact. If scored as "does this line represent the artifact reading/exfiltrating a credential," this pattern would be near-100% false positive. This directly confirms `PITFALLS.md`'s own "DETECTABLE, HIGH FP" verdict on this category and the recommendation to exclude it from MVP.

### Q6. Line-number provenance (CAP-08, prompt §7)

Read `src/detect/skill.ts:124` and `src/detect/command.ts:131` `[VERIFIED: src/detect/skill.ts:124]`: `body: source.slice(0, MAX_BODY)`, where `source` is the **unmodified raw file content read from `raw.githubusercontent.com`** (`src/detect/skill.ts:49-51`, `source = await read(c.sourcePath)`) — **not** `parsed.body` (the post-frontmatter-fence content `parseFrontmatter` returns at `src/detect/frontmatter.ts:83`). This is a load-bearing, easy-to-miss fact: the stored `body` includes the frontmatter fence and every byte of the original file up to the cap, so **line 1 of `packageVersion.body` is line 1 of the file as GitHub renders it.**

Four specific traps, checked against the actual code:

- **CRLF:** `contentHash()` (`src/ingest/pipeline.ts:62-64`) normalizes `\r\n → \n` **only for hashing identity** — the stored `body` retains the original line endings verbatim (confirmed: `contentHash(result.artifact.contentBasis ?? raw)` at `pipeline.ts:291` hashes the separately-held `raw` variable, while `body: result.artifact.body...` at `pipeline.ts:293` stores the detector's own `source.slice()`, never touched by the CRLF replace). Splitting `body` on plain `\n` (not `\r\n`) for a line counter produces the same line count as GitHub's blob viewer regardless of line-ending style, because a trailing `\r` is invisible and does not consume a line — **the plan must specify `body.split('\n')`, never `body.split('\r\n')`**, or an all-LF file and a CRLF file would be counted differently by an inconsistent implementation.
- **BOM:** `splitFrontmatter()` (`src/detect/frontmatter.ts:23`) strips a leading BOM only in a **local variable** used for its own regex match (`const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source`) — it does not mutate `source`, so the BOM (if present) survives into the stored `body` as the first character of line 1. A BOM is zero-width and does not itself occupy a line, so line numbering is unaffected; a detector must simply not choke on it if scanning starts at offset 0.
- **Frontmatter offset:** because `body` is the *entire file* (fence included), no offset arithmetic is needed — a finding at `body` line 12 is genuinely line 12 of the file on GitHub. This is the opposite of what `03-RESEARCH.md`'s Phase-3-superseded assumption might suggest and must be stated plainly so the plan does not add unnecessary frontmatter-line-offset math.
- **Code-fence interiors:** line counting is a raw-text operation (`\n`-splitting), completely unaffected by whether a given line sits inside a ` ``` ` fence — fence nesting is a Markdown-AST concept the plan's line-based scanner never constructs. **The harder, real question CAP-08 does not ask but the plan must not accidentally answer wrong is classification, not line number**: whether a `curl|sh` shown inside a fenced example is "this skill's own bundled behavior" vs. "documentation the skill teaches the reader to paste into their own terminal" is exactly the shape-vs-intent problem §Q1's CI-workflow-YAML hits already demonstrate (hits #16-20 in §Q5) — the recommendation there stands: treat both uniformly as disclosure-worthy (do not attempt fence-aware suppression in MVP; the shape is real either way, and under-flagging is the worse failure mode for a security-adjacent disclosure product).

**Truncation is a coverage bound, not a correctness bug.** `MAX_BODY = 32 * 1024` (`skill.ts:19`, `command.ts:25`) truncates via JavaScript string `.slice()`, which operates on **UTF-16 code units, not bytes** — the code comment ("Excerpt, not a mirror. The largest sampled file is 72 KB") frames this as a byte cap, but the actual mechanism caps at 32,768 UTF-16 code units, which is close to but not identical to 32 KB of UTF-8 bytes for non-ASCII-heavy files (an `[ASSUMED]` nuance worth flagging to the planner but not urgent — the measured corpus is >95% ASCII prose). Critically: truncation only ever **removes trailing content**; it never shifts or corrupts line numbers for content that survives the cut. A finding at line 40 in a file truncated after line 38 simply cannot exist (the content past line 38 was never read), which is an honest gap — CAP-08's guarantee ("every finding carries a line number") holds for every finding that is actually produced; it does not and cannot promise full-file coverage, exactly mirroring PRV-07's existing "excerpt, not a mirror" framing. State this in the "not checked" block (CAP-09): *"AgentDock reads the first 32 KB of each file. Content beyond that is not scanned."*

### Q7. Hidden content (CAP-06, CAP-07)

**Codepoint/construct list to detect**, drawn from the project's own prior research `[CITED: .planning/research/PITFALLS.md Pitfall 2]` and confirmed against official mitigation guidance already cited there (Cisco, AWS):

| Class | Codepoints/pattern | Detectable how |
|---|---|---|
| Unicode Tags block | `U+E0000`–`U+E007F` | `codePointAt` range check per character |
| Zero-width | `U+200B` (ZWSP), `U+200C` (ZWNJ), `U+200D` (ZWJ), `U+FEFF` (ZWNBSP/BOM, non-leading) | Character-class check |
| Bidi controls | `U+202A`–`U+202E`, `U+2066`–`U+2069` | Character-class check |
| Soft hyphen | `U+00AD` | Character-class check |
| HTML comments with imperative-shaped text | `<!--...-->` in body text | Simple non-nested regex `<!--[\s\S]*?-->` (bounded, no catastrophic backtrack: non-greedy with a fixed terminator, same shape as the project's own `FENCE` regex in `frontmatter.ts:19`) |
| Hidden-styled HTML | `style="...display:none|font-size:0|color:...same-as-background..."`, `hidden` attribute | Regex over the raw attribute text — this is disclosure of the *shape*, not execution of the style |

**What the current render pipeline already does — read and confirmed this session:**

`SkillBody.tsx` (`src/components/SkillBody.tsx`) is a Server Component with **no `rehype-raw` plugin** — the file's own comment states the primary control is structural: "with no raw-HTML plugin, HTML in the source is never parsed into element nodes at all — a script tag in a body is a text node." This means:
- **HTML comments are silently dropped end-to-end today.** `SkillBody.test.tsx:52-56` (`fixtures/xss/html-comment.md`, containing `<!-- IGNORE PREVIOUS INSTRUCTIONS, xss-marker -->`) asserts `expect(html).not.toContain('<!--')` **and** `expect(html).not.toContain('IGNORE PREVIOUS INSTRUCTIONS')` — the comment's text is completely absent from the rendered output, not merely escaped `[VERIFIED: src/components/SkillBody.test.tsx:52-56 — Read this session]`. This is Pitfall 3's XSS control working correctly and **must not be undone**.
- **Zero-width and bidi characters currently survive rendering, invisibly.** `SkillBody.test.tsx:92-95` explicitly asserts the opposite behavior for the bidi override character: `expect(html).toContain('‮')` (U+202E survives). This is documented in the test as deliberate ("KEEPS a right-to-left override — it is surfaced later, never stripped") — but "surfaced later" has never actually been built. Today the character is present in the DOM but genuinely **invisible to a human reader**, which is precisely Pitfall 2's failure mode: the raw bytes are retained (already true, CAP-07's second half is already satisfied structurally), but there is no visible sentinel (CAP-07's first half is not yet built).

**Recommendation — concrete sentinel mechanism:** CAP-06/CAP-07 must **not** be implemented by changing `SkillBody.tsx`'s sanitize schema (that would either re-open the HTML-comment injection vector Pitfall 3 closed, or require re-injecting raw markup into a component whose entire safety argument is "HTML is never parsed"). Instead:

1. A new pure function `detectHiddenContent(body: string): HiddenFinding[]` (in `src/analyze/hidden.ts`) scans the **raw stored `body`** (before any Markdown processing) for the codepoint classes above, returning `{ kind, codepoint, line, column, contextExcerpt }` per hit, capped (§Q8).
2. A new, **separate** display component (e.g. `HiddenContentPanel`) renders each finding as escaped, human-visible text with an explicit sentinel — e.g. a zero-width space becomes the literal string `[ZERO-WIDTH SPACE, U+200B]` inside a `<code>` element (never interpolated back into live Markdown), and an HTML comment's inner text is shown as escaped plain text next to a `Hidden HTML comment` label. This satisfies "rendered with visible sentinels; never silently stripped; raw bytes retained" without touching the sanitize-render path at all — the two paths are structurally independent, exactly matching the "declared vs. observed" separation pattern already recommended in §Q2/Q3.
3. `SkillBody.tsx` itself is untouched. It continues to safely drop raw HTML and continues to (already, today) pass through zero-width/bidi characters invisibly in the main body — that invisibility inside the main prose is now *compensated for*, not fixed, by the fact that the same characters are independently flagged and shown legibly in the adjacent Hidden Content panel. A user reading the page sees both the (invisibly-affected) prose and an explicit callout naming exactly what is hidden in it.

### Q8. ReDoS and pathological input (CAP-14, prompt §17)

**Regex is the wrong default tool here, and the project's own code already knows this** — `command.ts:41-44`'s own comment states the design principle directly: *"Path segments, not a regex — no nested quantifiers, nothing to backtrack."* The same discipline must extend to capability detection.

**Recommendation:**
- **Line-based scanning, not a general-purpose regex engine run over the whole 32 KB body.** Split `body` into lines once (`body.split('\n')`, capped — see below), then run small, anchored, non-backtracking patterns per line. A per-line cap bounds worst-case regex cost by construction: even a pathological pattern can only backtrack within one line's length, not the whole file.
- **Bounded patterns only — no nested quantifiers, no unbounded `.*` adjacent to another quantifier.** Every pattern proposed in this document (§Q1, §Q4, §Q5, §Q7) is a fixed-alternation, non-nested shape (e.g., `\b(npm install|npx|...)\b`, a character-class scan, a non-greedy `<!--[\s\S]*?-->` with a required terminator) — the same shape as the project's existing `FENCE` regex (`frontmatter.ts:19`) and `HOST_PATTERN` (`check-boundaries.mjs:209`), both already reviewed and shipped.
- **Concrete caps, named as constants following the `*_CAPS` convention already established** (`FRONTMATTER_CAPS`, `JSON_CAPS`, `HOOK_CAPS`):
  - Input bytes: bounded already — `packageVersion.body` is capped at `MAX_BODY = 32 * 1024` before analysis ever runs (§Q6), so no new input cap is needed at the analyzer boundary; analyzers should assert this via a `if (body.length > MAX_BODY) throw` guard as defense-in-depth against a future caller passing an uncapped string.
  - Per-line length: cap at, e.g., 2,000 characters — a line longer than this (a minified asset accidentally pasted into a body, or an attacker-crafted single giant line) is scanned only up to the cap; the rest of that line is skipped and the skip is counted, never silently ignored.
  - Total findings per detector per artifact: cap at a small number (e.g. 50) — beyond that the file is disclosure-worthy in a different way ("this file triggers an unusual volume of X") and the UI should say "and N more", never render an unbounded list.
  - Per-detector wall-clock budget: not needed as a runtime timer if the above three caps hold, because a bounded-pattern, per-line, capped-length scan has a mathematically bounded worst case — but CAP-14 says this must be **locked by a test, not asserted in prose**: the plan should include one adversarial fixture (a single very long line built from a pattern designed to maximize backtracking in a *naive* version of each pattern, e.g. `'a'.repeat(5000) + '!'`) with a test asserting completion under a short timeout (e.g. 100ms), proving the shipped pattern is linear-time on the worst input the fixture can construct.
- **This is a genuinely new fixture, not reused from `fixtures/adversarial/`** — none of the existing 26 adversarial fixtures target analyzer ReDoS (they target frontmatter/JSON parsing). A new `fixtures/adversarial/redos-*.md` (or a same-directory addition, following the existing single-flat-directory convention) is needed.

### Q9. Persistence (prompt §5, §6, §21, §30)

Read `src/db/schema.ts:142-171` (`packageVersion`) `[VERIFIED: src/db/schema.ts:166-168]`: `unique('package_version_content_key').on(t.packageId, t.contentHash)`, and `src/ingest/persist.ts:154-172`, where the insert uses `.onConflictDoNothing({ target: [packageVersion.packageId, packageVersion.contentHash] })`.

**Recommendation — table shape:**

```
capability_finding
  id                bigserial primary key
  package_version_id  bigint not null references package_version(id) on delete cascade
  category          text not null   -- 'declared' | 'observed_shell' | 'observed_network_request' |
                                     -- 'observed_network_reference' | 'observed_install' |
                                     -- 'bundled_script' | 'hidden_content'
  detector          text not null   -- which pattern/rule produced this, for the CAP-13 audit trail
  summary           text not null   -- the verbatim or minimally-formatted text of the finding
  line_number       integer         -- null for detectors that are not line-anchored (e.g. bundled-script inventory)
  excerpt           text            -- capped context around the match, escaped at render, never a whole document
  meta              jsonb not null default '{}'::jsonb  -- detector-specific structured extras (codepoint, url, etc.)
  created_at        timestamptz not null default now()

  unique (package_version_id, category, detector, line_number, summary)  -- the dedup constraint
```

This follows every existing schema convention: `jsonb meta` for detector-specific extras (mirrors `packageTable.meta`), `text` with a comment instead of a constrained enum for `category`/`detector` (mirrors `repoSeed.sourceKind`'s stated reasoning: "widening a constrained type on a populated table is a DROP, which this project's boundary scanner treats as destructive"), and cascade-delete from `package_version` (mirrors every other child table).

**Dedup on re-ingestion with identical content — this is where Phase 2's existing design does the work for free.** Because `packageVersion`'s insert is `ON CONFLICT DO NOTHING` on `(package_id, content_hash)`, an unchanged re-ingest produces **zero new `package_version` rows** — `inserted.length === 0` at `pipeline.ts:172`, confirmed by reading the surrounding code. **The concrete implication for Phase 4: capability analysis must run only for `package_version` rows that were genuinely newly inserted (`inserted.length > 0`), never speculatively for every scan.** If analysis instead ran unconditionally on every `ScannedPackage`, it would either (a) need to re-derive the `package_version.id` for the *existing, unchanged* row — which the current `onConflictDoNothing().returning()` call does **not** provide, since Postgres returns no row on a no-op conflict — or (b) silently do nothing on conflict and never notice, which is fine but wasteful. The correct, minimal design: **gate analysis on `inserted.length > 0`** inside the same loop that already knows this (`persist.ts:154-172`, immediately after the `packageVersion` insert), so capability findings are computed exactly once per distinct content, exactly when a new version row is created, inside the same transaction that creates it. This requires zero new dedup logic — it inherits Phase 2's idempotency guarantee by construction.

### Q10. Re-analysis (prompt §22)

**Recommendation — signature:** `analyzePackageVersion(packageVersionId: number): Promise<void>`, reading `packageVersion.body` and `packageVersion.frontmatter` from the database (not re-fetching GitHub), running the same `src/analyze/*` pure functions the ingest path calls, and replacing (delete-then-insert, or upsert on the unique constraint from §Q9) that version's `capability_finding` rows. This is the mechanism a future detector-version-bump or new-detector-addition uses to backfill findings on already-stored versions without re-crawling.

**Is stored-source re-analysis lossy? Yes, partially, and this must be stated plainly, per the prompt's own instruction:**
- **Declared-capability re-analysis is NOT lossy.** `packageVersion.frontmatter` is stored as full parsed `jsonb`, not truncated — `FRONTMATTER_CAPS.serializedBytes = 256 * 1024` (`frontmatter.ts:14`) is far larger than any real frontmatter block observed (largest sampled is ~1.2 KB per the same file's own comment), and the whole parsed object is stored, not an excerpt. Re-running the `allowed-tools` extraction from stored `frontmatter` is byte-for-byte equivalent to running it at ingest time.
- **Observed-capability re-analysis over `body` IS lossy for any file whose original content exceeded `MAX_BODY` (32 KB / 32,768 UTF-16 code units).** `packageVersion.body` is explicitly documented as a capped excerpt (`schema.ts:156`, `body: text('body'), // capped excerpt, never a mirror`) — content past the cut was never stored anywhere and cannot be recovered without re-fetching the file from GitHub at its original commit SHA (which `analyzePackageVersion` is explicitly designed *not* to do). **State this plainly in the plan and in the "not checked" UI copy**: re-analysis of observed capabilities is bounded by the same 32 KB excerpt the original scan used; a detector added later cannot retroactively see content beyond what Phase 1/2 already chose to store. This is a real, permanent limitation, not a bug to fix in Phase 4 — fixing it would mean storing full file bodies, which contradicts PRV-07 ("only an excerpt... is stored and displayed") and is out of this phase's scope.

### Q11. File inventory (CAP-01)

**What GitHub's Trees API actually returns**, confirmed via official docs `[CITED: docs.github.com — REST API endpoints for Git trees]`: each tree entry carries `path`, `mode`, `type` (`blob`/`tree`), `size`, `sha`, `url`. `mode` values include `100644` (regular file), `100755` (executable file), `040000` (directory/tree), `120000` (symlink), `160000` (submodule).

**Does the current scan retain it? No — confirmed by reading the code, and confirmed the data is already present and simply discarded.**

- `src/github/types.ts` (`TreeEntry`) declares only `{ path, type, sha, size? }` — no `mode` field.
- `src/github/tree.ts`'s mapper (`fetchRepoTree`) builds `TreeEntry` objects with exactly `{ path: String(e.path), type: e.type, sha: String(e.sha), size: ... }` — `e.mode` is never read.
- The raw API response **is already captured in the project's own frozen fixtures with `mode` present**, proving the field arrives in the exact response AgentDock fetches, at zero additional cost. Read directly this session: `fixtures/anthropics-skills/tree.json:1533-1538` —

  ```
  {
    "path": "skills/docx/scripts/__init__.py",
    "mode": "100755",
    "type": "blob",
    "sha": "8b137891791fe96927ad78e64b0aad7bded08bdc",
    "size": 1,
    "url": "https://api.github.com/repos/anthropics/skills/git/blobs/8b137891791fe96927ad78e64b0aad7bded08bdc"
  }
  ```

  `[VERIFIED: fixtures/anthropics-skills/tree.json:1533-1538]`. A scripted count over the same file found **26 entries with `mode: "100755"`** in this one corpus alone.

**Recommendation:** Add `mode?: string` to `TreeEntry` (`src/github/types.ts`) and extract it in `tree.ts`'s mapper (one line: `mode: typeof e.mode === 'string' ? e.mode : undefined`). Derive `executable: boolean = entry.mode === '100755'` at the point CAP-01's file inventory is computed. This is a genuine, additive, zero-new-request schema/scan change the plan must include as its first task (everything else in CAP-01 depends on it), and it costs nothing beyond a type change and one extra field read — the API call and its cost are unchanged.

**Where does the inventory live?** The bounded tree (`inputs.tree.entries`, already fully in memory during ingest, per `src/github/scan.ts`) already contains every file in the repository up to `CAPS.maxTreeEntries` (100,000) and `CAPS.maxDepth` (10) — filtering it to entries whose path starts with an artifact's own directory prefix (the same prefix logic `nesting.ts`'s `assignParentPaths` already uses for containment) produces that artifact's file inventory **for free, with no additional GitHub fetch**, because the full tree was already fetched to compute `needs` in the first place. Store it as a capped JSON array (path, size, type, executable) inside `packageVersion.meta` or a new `packageVersion.files jsonb` column (following the `repoSeed.hint`/`packageTable.meta` jsonb-for-structured-per-row-data convention already established), computed once at ingest time alongside the rest of `ScannedPackage`.

### Q12. CAP-03 bundled scripts "labeled as not analyzed"

Measured against the real corpora's full `tree.json` files (not just the captured 84 bodies — the full tree includes every file, not only the ones the pipeline reads) `[VERIFIED: python script executed this session over fixtures/*/tree.json, counting blob entries matching (^|/)skills/[^/]+/scripts/.*\.(sh|py|js|ts|rb|ps1)$]`:

| Corpus | Bundled script files inside a `skills/<name>/scripts/` directory |
|---|---|
| `addyosmani-agent-skills` | 1 |
| `anthropics-skills` | 64 |
| `baoyu-skills` | 177 |
| `wshobson-agents` | 6 |
| **Total** | **248** |

This is not a rare edge case — `anthropics-skills` (the reference/canonical corpus) alone bundles 64 executable script files across its skills (mostly Python, e.g. `skills/docx/scripts/accept_changes.py`, `skills/pdf/scripts/extract_form_structure.py`), and `baoyu-skills` bundles 177 (`.ts`/`.sh` scripts under a Bun-based runtime convention). **The inventory row for each is concrete and simple:** path (relative to the artifact's directory), size, file extension/interpreter guess (from extension only — never opened), and the executable bit from §Q11's `mode`. No script content is read. The label is the fixed UI string "not analyzed" (matching CAP-11's absence-as-fact convention) — never "safe" or "clean" even for a zero-byte or trivially-short script.

### Q13. Vocabulary lint (ROADMAP plan 04-04)

The project already has a working precedent for exactly this mechanism, read and confirmed this session: `scripts/check-boundaries.mjs`'s Rule 5 (`src/detect/*.ts` Wait — actually `SOURCE_RULES`, `check-boundaries.mjs:180-232`) scans every non-test `.ts`/`.tsx`/`.js`/`.mjs` file under `src/`, strips comments first (`stripJsComments`, `check-boundaries.mjs:68-70`), then regex-matches a small fixed list of forbidden patterns, reporting file + reason on failure. This is run by `bun run check:boundaries`, which is the first step of `bun run ci` (`package.json:17`).

**Recommendation:** add a sixth rule, `no-verdict-vocabulary`, to the same file, with the same shape as the existing five:

- **Scope: `src/app/**` and `src/components/**` only** (UI-facing source), not the whole of `src/` — this is a deliberate narrowing from the existing Rule 5's whole-`src/` scope, because the banned words are legitimate in backend code comments, detector rationale, and test descriptions (e.g. this very research document's own extensive, legitimate use of "verified"), and the CAP-10/12 requirement is specifically about **UI copy shown to a user**, not about internal engineering vocabulary.
- **Match only string/JSX-text literals, not identifiers or all text** — practically, after stripping comments (reusing `stripJsComments`), match the banned-word regex only when it falls inside a quoted string literal or JSX text node. A cheap, sufficiently-precise approximation (matching the project's existing regex-over-stripped-source style, not a full parser): require the match to be adjacent to a quote character or JSX angle-bracket boundary, which the existing `stripJsComments` + a simple `/['"`>][^'"`<]*\b(safe|clean|verified|trusted|approved|malicious)\b[^'"`<]*['"`<]/i` pattern approximates without needing an AST.
- **Why this avoids false-positiving on dynamic content:** the banned words would only trip this rule if they appear as a **literal string constant** in the source file — e.g. a hardcoded `<p>This skill is verified</p>`. A skill's own body text (rendered from `detail.body`, a runtime variable, never a source-code string literal) can freely contain the word "trusted" in its own prose (it is the artifact author's text, displayed as a quotation, not AgentDock's own claim) — the lint physically cannot see database content, only source code, so this class of false positive is structurally impossible, not merely unlikely. The `.planning/` research documents (including this one) are also outside `src/`, so they are never scanned.
- **Words to ban**, from CAP-10 verbatim: `safe`, `clean`, `verified`, `trusted`, `approved`, plus (from CAP-12/CAP-10's spirit) `risk score`, `grade`, `malicious` as a verdict-shaped noun phrase. Case-insensitive, word-boundary-anchored (so `unverified` does not need special-casing since it does not contain the word `verified` at a word boundary the way the pattern is written — actually it does contain the substring `verified`; the pattern must be `\bverified\b` so `unverified` is also caught unless deliberately excepted. **Recommendation: `unverified` should be exempted explicitly** (it is the honest CAP-11-style negative, e.g. "Declared compatibility (unverified)" already used in `PITFALLS.md`'s own recommended UI vocabulary) — implement as a negative lookbehind or simply check the word list against `(?<![a-z])verified\b` combined with an explicit allow of the literal string `unverified`.
- **Test the lint itself**, mirroring `check-boundaries.test.ts`'s existing pattern (already present at `scripts/check-boundaries.test.ts:10`, importing named exports from the `.mjs` module) — add unit tests asserting both a true positive (a hardcoded `"This skill is verified"` string trips it) and the two false-positive-avoidance cases explicitly (a `.test.ts` file using "verified" in a `describe()` string is out of scope by directory; a component that only ever prints `{detail.body}` verbatim, even if the underlying data happens to say "verified", is not caught because no literal exists in source).

### Q14. Artifact-type applicability (prompt §23)

| Artifact type | Static source worth analyzing? | Reasoning |
|---|---|---|
| `skill` | Yes | `body` (prose + fenced examples) is exactly the surface §Q1 measured |
| `command` | Yes | Identical frontmatter/body shape to `skill` (`command.ts` reuses `parseFrontmatter` unmodified — confirmed by reading `src/detect/command.ts:69-71`'s own comment) |
| `plugin` | Partial | A manifest-declared plugin has JSON structure (`meta.mcpServers`, `meta.declaredComponents`) worth surfacing as declared capability; a shape-only plugin (`meta.detectionConfidence: 'shape-only'`) has no manifest text to scan at all — `body` is always `''` for plugins (`plugin.ts:202`, `plugin.ts:286`) |
| `mcp_server` | Partial | `meta.servers[].command`/`args` are already structured declared data (§Q2's "declared" channel); `body` is always `''` (`mcp.ts:81`, `mcp.ts:142`) — no prose to scan |
| `hook` | Partial | `meta.handlers[].command` is structured declared data; `body` is always `''` (`hook.ts:149`) |
| `catalog` | **No — never produces a package row at all** (DET-03, confirmed by reading `catalog.ts:125`: `status: 'seeds'`, always) | Catalogs fan out into `repo_seed` rows, never into `package`/`package_version` rows. There is no `package_version.body` for a catalog to analyze under normal operation. |

**Does a requirement demand catalog be brought into scope? Checked REQUIREMENTS.md's full CAP-01..14 list — no.** None of CAP-01 through CAP-14 names `catalog` or `marketplace.json`. The one edge case worth naming for the planner: `03-CONTEXT.md`'s resolved-open-question #3 records that a **malformed** catalog *does* produce a `package` row with `type: 'catalog'`, `parse_status: 'failed'` (the asymmetric failure-disclosure case) — such a row has `body` set to the raw truncated file content (same `raw.slice(0, MAX_BODY)` path every failed candidate uses, `pipeline.ts:273`). If Phase 4's analyzers run unconditionally over every `package_version.body`, this failed-catalog row would be scanned too, harmlessly (it is just JSON text, and the detectors are indifferent to what kind of file produced the body) — **no special-casing is needed**, but the plan should note this is why `body` is never `null`-guarded away for `catalog`-typed rows even though the success path never produces one.

**Is a `supports(type)` hook genuinely needed, or does every detector just run over whatever body exists?** **The latter — no hook needed.** Every analyzer function in `src/analyze/` should simply run over `body: string`; for artifact types whose `body` is always `''` (`plugin` shape-only, `mcp_server`, `hook`), every body-scanning detector correctly and trivially produces zero findings on empty input, with no special-casing required. This mirrors the project's own established minimalism (`plugin.ts`/`mcp.ts`/`hook.ts` do not check "am I a skill" anywhere) and avoids inventing the "plugin-framework abstraction" the project's Phase 3 `CONTEXT.md` explicitly rejected as an anti-goal ("No plugin-framework abstraction. No base class, no registration DSL, no dynamic loading, no factory.") — the same discipline applies here. The **declared-capability channel** (§Q2), by contrast, legitimately differs per type (it reads `frontmatter['allowed-tools']` for `skill`/`command`, but `meta.servers[].command` for `mcp_server` and `meta.handlers[].command` for `hook`) — this is naturally expressed as one function per type-specific `meta` shape, not a `supports()` predicate, matching how `mcp.ts` and `hook.ts` already each define their own `meta` shape independently.

### Q15. QUA-03 / QUA-05

Read `REQUIREMENTS.md:157,159` verbatim:

> **QUA-03**: Detectors, analyzers, and identity logic have unit tests
> **QUA-05**: Security fixtures (XSS, SSRF, invisible characters, malformed frontmatter, oversized repository) are permanent regression tests

**QUA-03** names "analyzers" as a distinct category from "detectors" — confirming this phase's own architectural distinction (§ above: `src/detect/` finds and parses artifacts; `src/analyze/` is new, and extracts capability findings from an already-parsed artifact). Every function in `src/analyze/` must have direct unit tests, mirroring the existing `src/detect/*.test.ts` pattern exactly (pure function in, `Finding[]` out, no database, no network — `run.test.ts`'s own proof that this style runs without `DB_URL` is the precedent to follow).

**QUA-05** explicitly names "invisible characters" as one of the permanent regression categories — this phase is where that named requirement is finally implemented as a shipped test (Phase 1 built the render-side "keep, don't strip" assertion in `SkillBody.test.tsx`; Phase 4 is where the **detection** side — the actual `detectHiddenContent` finding, not just the character surviving into HTML — gets its own fixture and test). The plan must add fixtures for each hidden-content class in §Q7 (Unicode tags, zero-width, bidi, HTML comment, hidden-style) to `fixtures/adversarial/`, each with a corresponding assertion, per that directory's own stated convention ("A fixture with no assertion is storage, not a regression").

---

## Anti-Goals

Restated here so execution does not drift, per the task's own instruction:

- **No risk score, aggregate grade, or safety verdict — ever.** Never the words *safe*, *clean*, *verified* (unqualified), *trusted*, *approved*, or *malicious* applied to an artifact as a judgment. Project-wide, permanent, mechanically enforced (§Q13).
- **No execution of artifact content.** No `eval`, `Function()`, `child_process`, `node:vm`, dynamic import of repository files. `check:boundaries` Rule 5 already enforces this and must keep passing.
- **No search integration.** Findings and categories do not feed ranking or filtering logic in this phase; that is Phase 6 (DIS-06 will consume the `category` column this phase creates, but building the filter is out of scope now).
- **No corpus acquisition.** The four frozen corpora plus `fixtures/adversarial/`/`fixtures/xss/` are the entire dataset this phase uses; Phase 5 owns bulk acquisition.
- **No dynamic plugin loading, DSL, or detector framework.** `src/analyze/` follows `src/detect/`'s own established shape: one file per detector concern, one array of pure functions, no base class, no registry abstraction, no `supports()` hook (§Q14).
- **Findings never carry a whole document.** Every `excerpt`/`summary` field is capped (mirroring `MAX_BODY`'s own posture) and HTML-escaped at every render sink, never a raw dump of the matched region beyond a short context window.

---

## Standard Stack

### Core

No new runtime dependency is proposed. Every mechanism in this phase is built from what is already installed and already reviewed:

| Capability | Existing tool used | Why no new package |
|---|---|---|
| Hidden-content codepoint scanning | Native JS string iteration (`for...of`, `codePointAt`) | Unicode range checks are simple arithmetic; no library adds value over 6-8 range comparisons |
| Line-based capability pattern matching | Native `RegExp`, bounded/anchored per §Q8 | The project's own established style (`command.ts`, `frontmatter.ts`) already does this without a library |
| JSON structured findings storage | `drizzle-orm` 0.45.2 `jsonb` (already a dependency) | Matches `packageTable.meta`'s existing convention |

### Alternatives Considered

| Instead of | Could use | Tradeoff — why not chosen |
|---|---|---|
| Hand-rolled Unicode range checks | A dedicated "invisible character" npm package | None found in this session's search that is both actively maintained and narrowly scoped; the codepoint list is short, stable, and already fully specified in this document — a dependency would add supply-chain surface for ~30 lines of range checks |
| Line-based regex scanning | An AST-based Markdown/prose NLP library for intent classification | Explicitly rejected by the ROADMAP's own framing ("the hard question is classification, not extraction") — §Q3/Q4's findings show the *shape*-based approach already achieves acceptable precision; an NLP dependency would add real complexity and a new false-positive surface for a problem the corpus shows is already tractable with patterns |

**Installation:** none — no `package.json` change required for this phase's detection code.

**Version verification:** N/A — no packages proposed.

## Package Legitimacy Audit

**No external packages are proposed by this research.** All capability-detection code is hand-rolled JavaScript/TypeScript using already-installed dependencies (`drizzle-orm`, native `RegExp`/Unicode APIs). The Package Legitimacy Gate protocol is therefore not applicable to this phase's core work.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---|---|---|---|---|---|---|
| *(none proposed)* | — | — | — | — | — | N/A |

**Packages removed due to [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** none.

---

## Architecture Patterns

### System Architecture Diagram

```
GitHub Trees API response
        |
        v
  fetchRepoTree()  --------------------------->  TreeEntry[] { path, mode*, type, sha, size }
        |                                              (*mode: NEW field this phase adds, §Q11)
        v
  collectCandidates() / DETECTORS.match()  -- unchanged from Phase 3
        |
        v
  safeParse() -> ParseResult { artifact: { body, frontmatter, meta } }
        |
        v
  persistScan() transaction
        |-- packageTable upsert                       (unchanged)
        |-- packageVersion insert ON CONFLICT DO NOTHING
        |         |
        |         +-- inserted.length > 0? ---- NO ---> skip analysis (§Q9)
        |         |
        |        YES
        |         v
        |   analyzeCapabilities(body, frontmatter, meta, tree-slice-for-this-artifact)
        |         |          (src/analyze/*.ts — new, pure functions, no I/O)
        |         |-- declaredCapabilities(frontmatter)         -> category: 'declared'
        |         |-- observedShell(body)                       -> category: 'observed_shell'
        |         |-- observedNetwork(body)                     -> category: 'observed_network_request' | '_reference'
        |         |-- observedInstall(body)                     -> category: 'observed_install'
        |         |-- bundledScripts(treeSliceForArtifact)      -> category: 'bundled_script'  (no body read)
        |         |-- detectHiddenContent(body)                 -> category: 'hidden_content'
        |         v
        |   capability_finding rows inserted, same transaction, keyed on package_version_id
        v
  UI: /r/[owner]/[repo]/[...path]/page.tsx
        |-- existing detail sections (unchanged)
        |-- NEW: "Declared capabilities" section (from category='declared')
        |-- NEW: "Observed in this file" section (from category='observed_*', with line -> permalink#L<n>)
        |-- NEW: "Bundled files" table (from file inventory + bundled_script findings, executable bit shown)
        |-- NEW: "Hidden content" panel (from category='hidden_content', sentinel-rendered, NEVER via SkillBody)
        |-- NEW: permanent "What AgentDock does not check" block (static copy, CAP-09)
        |-- SkillBody (unchanged — still safely drops raw HTML/comments, still lets zero-width/bidi through invisibly
        |               in the main prose, which the Hidden Content panel now compensates for)
```

### Recommended Project Structure

```
src/
├── detect/          # unchanged — finds and parses artifacts (Phase 1-3)
├── analyze/          # NEW — pure functions, artifact-already-parsed -> Finding[]
│   ├── types.ts      # Finding, HiddenFinding, CAPABILITY_CATEGORIES
│   ├── declared.ts   # reads frontmatter['allowed-tools'] and per-type meta.* command fields
│   ├── shell.ts       # curl|sh, wget&&bash, iwr|iex — remote-execution shape (§Q1/§Q5)
│   ├── install.ts    # npm/npx/pip/uvx/brew install shapes (§Q5, piloted, 5% FP)
│   ├── network.ts    # bare-URL extraction + request-vs-reference classification (§Q4)
│   ├── hidden.ts      # codepoint/HTML-comment/hidden-style detection (§Q7)
│   ├── files.ts       # file inventory + bundled-script inventory from the tree slice (§Q11/§Q12)
│   └── run.ts          # analyzeCapabilities() orchestrator, mirrors detect/run.ts's shape
├── ingest/
│   ├── pipeline.ts   # gains one call to analyzeCapabilities(), gated on inserted.length > 0 (§Q9)
│   └── persist.ts    # gains one capability_finding insert loop, same transaction
├── db/
│   └── schema.ts       # gains capabilityFinding table (§Q9), TreeEntry.mode (§Q11)
├── components/
│   ├── SkillBody.tsx     # UNCHANGED
│   └── CapabilityPanel.tsx  # NEW — declared/observed sections, never touches raw HTML
│   └── HiddenContentPanel.tsx  # NEW — sentinel rendering, structurally separate from SkillBody
└── app/r/[owner]/[repo]/[...path]/page.tsx  # gains the new sections
```

### Pattern 1: Two-channel capability model (declared vs. observed)

**What:** Every capability finding is tagged `declared` (from structured, already-parsed data: frontmatter or detector `meta`) or `observed_*` (from a pattern match over free-text `body`). The two are never merged into one list or one sentence.

**When to use:** Every capability-adjacent UI element in this phase.

**Example:**
```typescript
// src/analyze/declared.ts
export function declaredCapabilities(
  frontmatter: Record<string, unknown>,
): Finding[] {
  const raw = frontmatter['allowed-tools'];
  const tokens =
    typeof raw === 'string' ? raw.split(/[\s,]+/).filter(Boolean)
    : Array.isArray(raw) ? raw.map(String)
    : [];
  return tokens.map((token) => ({
    category: 'declared',
    detector: 'allowed-tools',
    summary: token,       // shown verbatim, e.g. "Bash(git:*)" — never decomposed, §Q3
    lineNumber: null,      // frontmatter has no useful single line for a multi-token field
  }));
}
```

### Anti-Patterns to Avoid

- **Decomposing a coarse grant into inferred sub-capabilities** (`Bash(*)` -> "network + filesystem + install" findings): rejected by §Q3's mechanical argument — it converts an observed fact into an inferred judgment.
- **Running capability analysis on the `unchanged` short-circuit path:** wastes work and risks accidentally creating a code path that could double-insert findings; gate strictly on `inserted.length > 0` (§Q9).
- **Feeding a hidden-content finding's raw text back into `SkillBody`'s Markdown renderer:** re-opens exactly the injection-delivery-vector risk `PITFALLS.md` Pitfall 2 exists to prevent. Hidden content is displayed in its own escaped, non-Markdown panel.

---

## Don't Hand-Roll

| Problem | Don't build | Use instead | Why |
|---|---|---|---|
| Markdown-body HTML/script suppression | A second sanitizer for the capability panel | The existing `rehype-sanitize` pipeline stays untouched for `SkillBody`; the new panels never parse Markdown at all — they render pre-escaped plain text via JSX text nodes, which React already escapes by default | Two sanitizers is two places to keep in sync and two places to get wrong; zero Markdown parsing in the new panels means there is nothing to sanitize |
| Unicode codepoint classification | A general-purpose "Unicode security" library | ~30 lines of range checks against the fixed codepoint list in §Q7 | The list is short, stable, and fully specified by this research; a dependency adds supply-chain surface for a solved, bounded problem |
| Vocabulary-lint AST matching | A full TypeScript/JSX AST parser (e.g. `@babel/parser`) to precisely find string literals | The existing `stripJsComments` + a boundary-aware regex, extending `check-boundaries.mjs`'s own established style | The existing tool already ships this exact shape of check (Rule 5) and is already reviewed; a parser dependency for one additional rule is disproportionate, and the false-positive risk is already structurally bounded (§Q13) without one |

**Key insight:** every "don't hand-roll" temptation in this phase points toward adding either a new sanitizer or a new parsing dependency. The research consistently finds that the existing, already-reviewed, already-tested primitives (the sanitize pipeline, the boundary scanner, plain regex) cover the actual measured need — the risk in this phase is over-building, not under-tooling.

---

## Common Pitfalls

### Pitfall 1: Re-injecting hidden content into the safe-render path

**What goes wrong:** A developer implementing CAP-07 ("show the hidden content") takes the shortest path — feed the raw body (with its invisible characters and HTML comments intact) back through `SkillBody` with `rehype-raw` newly enabled "just for this one view," to make the hidden content visible via literal HTML rendering.
**Why it happens:** It looks like the fastest way to satisfy "never silently stripped."
**How to avoid:** The Hidden Content panel is a **separate, non-Markdown, plain-text-escaped** component (§Q7). It never parses the body as Markdown and never enables raw HTML anywhere.
**Warning signs:** `rehype-raw` or `allowDangerousHtml` appears anywhere in a new component; `check:boundaries` Rule 5 (`no-raw-html`) already catches this mechanically and must keep passing.

### Pitfall 2: Treating "declared" and "observed" as one list

**What goes wrong:** A single "Capabilities" bullet list mixes `allowed-tools: Bash(git:*)` with "mentions curl in prose" with no visual distinction, so a user cannot tell which claims are author-asserted facts and which are pattern-matched inferences.
**Why it happens:** It is less UI work than two sections.
**How to avoid:** Two headed subsections always, per §Q2/§Q3.
**Warning signs:** A `Finding` type with no `category` discriminator reaching the UI, or a single `<ul>` rendering both channels.

### Pitfall 3: Analyzing on every scan instead of on new versions only

**What goes wrong:** `analyzeCapabilities()` is called for every `ScannedPackage` in the loop regardless of whether a new `package_version` row was created, wasting CPU on every re-ingest of unchanged repositories and risking a code path that assumes a `packageVersion.id` exists when the insert actually conflicted and returned nothing.
**Why it happens:** It is the more "obviously correct" placement if the `inserted.length > 0` gate (§Q9) is not read closely.
**How to avoid:** Gate strictly on the existing `inserted.length` check already present at `persist.ts:172`.
**Warning signs:** A test that re-ingests unchanged content and asserts capability-finding count grows, when it should assert it stays flat.

### Pitfall 4: Shipping a detector nobody piloted

**What goes wrong:** A detector ships with a "looks reasonable" pattern and no recorded hand-check, silently violating CAP-13's binding measurement requirement.
**Why it happens:** Writing the pattern feels like the deliverable; measuring it feels like optional polish.
**How to avoid:** §Q5 specifies the exact procedure and demonstrates it on two detectors this session (install: 5% FP, survives; remote-execution: 0 real hits, ship with an honest "untested-on-real-data" note). The plan must run the same procedure for every detector before it ships, and record the result in `fixtures/capability-precision.md`.
**Warning signs:** A detector file with no corresponding row in the precision-record file.

---

## Code Examples

### Bounded hidden-content scan (CAP-06/CAP-14)

```typescript
// Source: this research, §Q7/§Q8 — pattern shape follows the project's own
// frontmatter.ts FENCE regex precedent (non-greedy, fixed terminator, no nesting)
const ZERO_WIDTH = /[​‌‍﻿]/g;
const BIDI = /[‪-‮⁦-⁩]/g;
const TAGS_BLOCK = /[\u{E0000}-\u{E007F}]/gu;
const HTML_COMMENT = /<!--[\s\S]*?-->/g; // non-greedy, terminated — cannot backtrack unboundedly

function scanLine(line: string, lineNo: number, findings: HiddenFinding[]): void {
  for (const re of [ZERO_WIDTH, BIDI, TAGS_BLOCK]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line.slice(0, MAX_LINE_CHARS))) && findings.length < MAX_FINDINGS) {
      findings.push({ line: lineNo, codepoint: m[0].codePointAt(0)!, column: m.index });
    }
  }
}
```

### Declared-vs-observed section split (CAP-02/CAP-05)

```typescript
// Source: this research, §Q2/§Q3
const declared = findings.filter((f) => f.category === 'declared');
const observed = findings.filter((f) => f.category.startsWith('observed_'));
// Rendered as two headed <section>s, never interleaved.
```

---

## State of the Art

| Old approach (what a naive implementation would do) | Current/recommended approach | When changed | Impact |
|---|---|---|---|
| Score/decompose a coarse `Bash(*)` grant into inferred sub-capabilities | Show the grant verbatim; let independent body-text detectors answer network/filesystem/install questions on their own evidence | This phase (§Q3) | Avoids the single most likely CAP-10/12 violation in the whole feature |
| Detect `curl`/network only via fenced-code-block scanning | Also scan prose imperatives ("Use WebFetch to load...") — §Q1 shows this is the dominant real shape | This phase (§Q1) | A code-fence-only detector would miss the majority of real network-request-shaped text in this corpus |
| Strip hidden Unicode at render time | Detect at analysis time, retain raw bytes (already true), add a visible sentinel in a **separate** panel, leave `SkillBody` untouched | This phase (§Q7) | Satisfies CAP-07 without reopening the XSS control Phase 1 shipped |

**Deprecated/outdated:** none — this is greenfield work within an established codebase; no prior AgentDock capability-detection code exists to deprecate.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|---|---|---|
| A1 | `MAX_BODY = 32 * 1024` is described in code comments as a byte cap but is mechanically a UTF-16 code-unit cap via `.slice()`; the corpus is assumed >95% ASCII so the practical difference is negligible | §Q6 | If a large non-ASCII-heavy artifact exists in the wild, the effective byte-excerpt size could be up to ~2x smaller than the comment implies for multi-byte-heavy text — low impact (still an honest excerpt, just a slightly smaller one than documented) |
| A2 | The recommended vocabulary-lint boundary-matching regex (quote/JSX-boundary adjacency) is a sufficient approximation of "string/JSX-text literal" without a full parser | §Q13 | Could under- or over-match in an edge case (e.g., a template literal with interpolation); mitigated by the lint's own test suite catching regressions, and the cost of a miss is a CI failure a human reviews, not a shipped vocabulary violation |
| A3 | The 84-file, four-corpus sample is representative enough for the CAP-13 precision pilot's install-directive and hidden-content-absence findings to generalize | §Q1, §Q5 | The corpus is skills-only (no plugins/MCP/commands/hooks body text) and entirely benign (no confirmed-malicious sample) — precision (few false alarms on clean input) is measured; recall (catching real bad actors) is NOT measured and cannot be from this corpus alone, consistent with the project's own `PITFALLS.md` finding that static analysis has near-zero recall against confirmed-malicious content regardless |
| A4 | `packageVersion.files jsonb` (or reuse of `packageVersion.meta`) is the right storage shape for CAP-01's file inventory, rather than a new child table | §Q11 | If Phase 6 later needs to query/filter by individual file properties across all artifacts (e.g., "find all skills with an executable script"), a jsonb array is harder to index than a child table — this is a plausible future migration, not a correctness risk now |

**If this table is empty:** N/A — see above.

---

## Open Questions

1. **Should `packageVersion.files` be a new column or reused `meta`?**
   - What we know: both are additive, jsonb, and consistent with existing conventions.
   - What's unclear: whether Phase 6's future capability-filter (DIS-06: "no scripts, no network, no shell") will want to query file-level executable-bit data directly, which favors a dedicated column with its own index-friendly shape.
   - Recommendation: ship as a new `files jsonb` column this phase (simplest, additive); the planner/executor should not block on this — it is a one-line schema change either way and easy to adjust before Phase 6 if query patterns demand it.

2. **Exact wording of the CAP-09 "not checked" block.**
   - What we know: the project's own `PITFALLS.md` already drafted strong candidate language ("AgentDock reads files. It does not run them. It cannot tell you what a script does."), and this research adds the 32 KB-truncation and lossy-re-analysis facts (§Q6, §Q10) that the block should also state.
   - What's unclear: final copy is a product/UX decision, not a research question.
   - Recommendation: the planner should treat the PITFALLS.md draft plus this document's §Q6/§Q10 caveats as the required content, and let plan 04-04 finalize exact phrasing.

---

## Environment Availability

Skipped — this phase has no new external dependencies. All work is code/schema changes against the existing PostgreSQL instance and existing GitHub-fetch pipeline, both already verified operational in Phases 0-3.

---

## Validation Architecture

### Test Framework

| Property | Value |
|---|---|
| Framework | Vitest 4.1.10 |
| Config file | `vitest.config.ts` (repo root) |
| Quick run command | `bun run test src/analyze` (once the directory exists) |
| Full suite command | `bun run test` (this is `vitest run`, per `package.json:13`) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|---|---|---|---|---|
| CAP-01 | Executable bit extracted from `mode` | unit | `bun run test src/github/tree.test.ts` | ❌ Wave 0 — needs a `mode`-bearing fixture case added to the existing tree test |
| CAP-02 | `allowed-tools` extracted from frontmatter, both channels kept separate | unit | `bun run test src/analyze/declared.test.ts` | ❌ Wave 0 |
| CAP-03 | Bundled scripts inventoried from tree slice, never content-read | unit | `bun run test src/analyze/files.test.ts` | ❌ Wave 0 |
| CAP-04, CAP-05 | Network/install/shell shapes detected with recorded precision | unit | `bun run test src/analyze/{network,install,shell}.test.ts` | ❌ Wave 0 |
| CAP-06, CAP-07 | Hidden content detected, sentinel-rendered, raw bytes retained | unit + component | `bun run test src/analyze/hidden.test.ts src/components/HiddenContentPanel.test.tsx` | ❌ Wave 0 |
| CAP-08 | Line numbers correct against CRLF/BOM fixtures | unit | `bun run test src/analyze/lines.test.ts` | ❌ Wave 0 — new fixtures needed (§Q6) |
| CAP-10, CAP-12 | Vocabulary lint fails on a hardcoded verdict word | unit | `bun run test scripts/check-boundaries.test.ts` (extended) | ✅ file exists, extend it |
| CAP-13 | Recorded false-positive rate per detector | process | manual + `fixtures/capability-precision.md` reviewed in PR | ❌ Wave 0 — new file |
| CAP-14 | ReDoS-shaped input completes under timeout | unit | `bun run test src/analyze/redos.test.ts` | ❌ Wave 0 — new adversarial fixture needed |

### Sampling Rate
- **Per task commit:** `bun run test src/analyze` (and `scripts/check-boundaries.test.ts` when touched)
- **Per wave merge:** `bun run ci` (matches every prior phase's convention)
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `src/analyze/` directory and its `*.test.ts` files (all detectors, §Q1-Q8)
- [ ] `fixtures/adversarial/redos-*.md` and hidden-content fixtures (§Q7, §Q8) — extend the existing flat `fixtures/adversarial/` directory per its own stated convention
- [ ] `fixtures/capability-precision.md` — the CAP-13 audit record (§Q5)
- [ ] `scripts/check-boundaries.test.ts` extension for the new vocabulary rule (§Q13)
- [ ] A `mode`-bearing case added to `src/github/tree.test.ts` (§Q11) — check whether this file currently exists; if not, it is a new Wave 0 file alongside the `tree.ts` change

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---|---|---|
| V2 Authentication | No | This phase has no auth surface (v1 has none, per PROJECT.md) |
| V3 Session Management | No | N/A |
| V4 Access Control | No | All data is public-repository-derived and publicly displayed |
| V5 Input Validation | Yes | Every new analyzer function treats `body`/`frontmatter` as untrusted; caps enforced before/during scan (§Q8), mirroring `json.ts`/`frontmatter.ts`'s existing caps-before-parse discipline |
| V6 Cryptography | No | No new cryptographic operations |
| V12 File and Resources | Yes | File inventory (CAP-01/CAP-03) reads only metadata (`path`, `size`, `mode`) from the already-fetched tree — never opens bundled script content, consistent with the project's permanent "never execute, never analyze bundled script bytes" posture |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---|---|---|
| ReDoS via a crafted `SKILL.md`/bundled-manifest body | Denial of Service | Line-based scanning, bounded non-backtracking patterns, per-line and per-finding caps, locked by a timeout-asserting test (§Q8, CAP-14) |
| Hidden-content payload delivered to the analyzer, re-emitted uninspected into the render path | Tampering / Elevation of Privilege (prompt-injection-adjacent) | Hidden content is escaped plain text in a dedicated panel, never Markdown-rendered, never fed through `rehype-raw` (§Q7, Pitfall 1) |
| Vocabulary-lint bypass via dynamic string construction (`'ver' + 'ified'`) to smuggle a verdict word past the static check | Tampering (of the product's own trust guarantee) | Out of scope for a static lint by design — the project's existing `check-boundaries.mjs` accepts this same limitation for its other four rules; note this explicitly as a known, accepted ceiling rather than attempt runtime enforcement, which would require a data-flow analysis disproportionate to the risk (this is the project's own UI copy, reviewed in every PR, not attacker-controlled) |

---

## Sources

### Primary (HIGH confidence)
- `src/detect/*.ts`, `src/ingest/{pipeline,persist,types}.ts`, `src/db/schema.ts`, `src/github/{tree,types,scan}.ts`, `src/components/SkillBody.tsx`, `src/app/r/[owner]/[repo]/**` — all read directly this session, cited by path and line throughout
- `fixtures/{addyosmani-agent-skills,anthropics-skills,baoyu-skills,wshobson-agents}/files/*` (84 real files) — grepped and hand-classified this session (§Q1, §Q4, §Q5, §Q12)
- `fixtures/anthropics-skills/tree.json:1533-1538` — Read directly this session, quoted verbatim (§Q11)
- `fixtures/adversarial/{bidi,unicode}.md`, `fixtures/xss/html-comment.md`, `src/components/SkillBody.test.tsx` — Read directly this session (§Q7)
- `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md`, `.planning/STATE.md`, `.planning/phases/AGD-03-detector-pluralism/{CONTEXT,VERIFICATION}.md` — read directly this session
- agentskills.io/specification — fetched live this session via WebFetch (§Q2)
- docs.github.com REST API endpoints for Git trees — fetched via WebSearch this session, confirming `mode`/`path`/`type`/`size`/`sha` fields (§Q11)

### Secondary (MEDIUM confidence)
- `.planning/research/PITFALLS.md` — the project's own prior research, read this session; its detector-precision table (Pitfall 6) and hidden-content mitigation guidance are cited and, where testable, independently confirmed against the real corpus in this session (§Q1, §Q5, §Q7)

### Tertiary (LOW confidence)
- None used without independent confirmation in this session.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies proposed, zero ambiguity
- Architecture: HIGH — every recommendation traces to code actually read this session, following patterns the codebase already establishes
- Pitfalls / classification design (§Q3): MEDIUM — this is a product/security judgment call defended by mechanical argument, not an empirically-checkable fact
- False-positive rates (§Q5): MEDIUM-LOW — precision is measured on a real, if small and skills-only, corpus; recall against genuinely malicious content is unmeasurable from this corpus and unmeasured, consistent with the project's own prior research's finding that this is a structural limit of static analysis, not a gap in this session's work

**Research date:** 2026-08-11
**Valid until:** 30 days, or immediately upon any change to `src/detect/*`, `src/ingest/pipeline.ts`, `src/db/schema.ts`, or `SkillBody.tsx` (this document's line/file citations would need re-verification)
