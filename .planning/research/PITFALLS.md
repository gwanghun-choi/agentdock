# Pitfalls Research

**Domain:** Open registry indexing untrusted third-party AI agent extensions (Agent Skills, Claude Code plugins, MCP servers, commands, hooks) from public GitHub
**Researched:** 2026-08-10
**Confidence:** HIGH on threat landscape and ingestion-pipeline security (multiple primary sources, published CVEs, peer-reviewed and preprint studies). MEDIUM on legal/ToS specifics (no lawyer, GitHub policy is prose not spec). MEDIUM on solo-maintainer execution pitfalls (pattern-matched from comparable registries, not from a study of agent-extension registries specifically — none has been running long enough to post-mortem).

---

## Executive Framing: Why This Project Is Unusually Dangerous To Build

AgentDock is not a package directory that happens to include security metadata. It is a **distribution channel for prompt-injection payloads that presents itself as a trust signal.** That inversion is the single most important fact in this document.

Three empirical results establish the base rate:

- Snyk's **ToxicSkills** audit (3,984 skills from ClawHub and skills.sh, snapshot 2026-02-05): **13.4% (534) contained at least one critical-level security issue; 36.82% (1,467) had at least one security flaw.** 76 malicious payloads confirmed by manual review; 8 still publicly available at publication. Of *confirmed malicious* skills, **100% contained malicious code patterns and 91% simultaneously used prompt-injection techniques.** ([Snyk](https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/))
- **"Malicious Agent Skills in the Wild"** (arXiv:2602.06547, Feb 2026) surveyed **98,380 skills** across two registries; 4,287 flagged by static analysis, **157 behaviorally confirmed malicious**. Critical finding: **84.2% of vulnerabilities live in the `SKILL.md` natural-language documentation, not in executable code**, and static analysis alone caught only **1.5%** of actual malicious skills without behavioral verification. 73.2% of malicious skills contained *shadow features* — undocumented capabilities. A single actor accounted for 54.1% of the malicious corpus via templated brand impersonation. ([arXiv](https://arxiv.org/html/2602.06547v1))
- The barrier to publishing on ClawHub was a `SKILL.md` and a one-week-old GitHub account. No signing, no review. ([Snyk](https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/))

The second bullet is the one that should reshape the roadmap. **Static analysis of agent skills, run alone, has a documented recall of ~1.5% against behaviorally confirmed malware.** AgentDock's stated differentiator is static security analysis, and AgentDock has correctly forbidden execution. Therefore AgentDock's analyzer *cannot* be a malware detector. It can only be a **capability disclosure and hidden-content detector.** Any roadmap that positions it as the former is built on a false premise.

**Marked unverified:** the 2602.06547 and 2603.xxxxx/2606.xxxxx arXiv items are preprints surfaced via search; abstract-level claims were read but not independently reproduced. The Snyk, Check Point, Tenable, and Invariant Labs items are vendor/CERT publications with named CVEs and are treated as HIGH confidence.

---

## Critical Pitfalls

### Pitfall 1: The False-Assurance Badge — shipping a security verdict at all

**What goes wrong:**
AgentDock renders `Risk: LOW` (or a green shield, or `7.8/10`) next to a skill. A user who would otherwise have skimmed the `SKILL.md` installs it without reading. The skill contains an instruction-level payload that the analyzer structurally cannot see. AgentDock has now *converted* a cautious user into an infected one. The registry has made the ecosystem worse than no registry at all. This is the worst outcome available to this project and it is reachable by shipping a feature the PROJECT.md already lists as a requirement.

**Why it happens:**
Security scoring feels like the deliverable. A score is a satisfying UI object: sortable, filterable, comparable. Capability lists are not. The maintainer builds the score because it demos well, and the 1.5%-recall reality is invisible in the demo because the demo repo is benign.

Compounding: an aggregate score **launders unknowns into a number.** If 11 signals are checked and none fire, the honest output is "11 things checked, 11 clean, N unknown." The score turns that into "LOW RISK," which is a claim about the artifact, not about the analysis.

**How to avoid — firm recommendation:**

**Ship a capability disclosure list. Do NOT ship an aggregate risk score. Not in MVP, not later.**

The industry has already converged here, and has already made the mistake and walked it back:

- **Socket.dev** replaced the `Safe` label with **`Undetected`** specifically so the UI indicates "no impact matched" rather than implying a guarantee. Its core product is literally *capability detection*: does the package use network, shell, filesystem, `eval()`, environment variables. ([Socket docs](https://docs.socket.dev/docs/faq), [Socket blog](https://socket.dev/blog/introducing-safe-npm))
- **OpenSSF Scorecard** carries an explicit framing that it measures *process hygiene, not vulnerabilities*, and peer-reviewed work found no clean correlation between high Scorecard scores and fewer vulnerabilities. Its own maintainers state it is not a substitute for code audit and that every scoring choice is opinionated. ([scorecard.dev](https://scorecard.dev/), [ossf/scorecard](https://github.com/ossf/scorecard))
- Scorecard's remaining problem — a single 0–10 number that users read as a grade despite the disclaimers — is exactly the failure mode to avoid inheriting. Do not copy the number. Copy the disclaimers.

**Concrete UI vocabulary for AgentDock:**

| Use | Never use |
|-----|-----------|
| **"Capabilities requested"** (section header) | "Security score", "Risk level", "Safety rating" |
| **"This skill can run shell commands"** | "Low risk", "Safe", "Verified", "Trusted" |
| **"Contains 3 bundled scripts (not analyzed)"** | "No threats found", "Clean", "Passed" |
| **"No hidden-content signals detected"** | "No malicious content" |
| **"Not analyzed"** (for anything outside the detector set) | *(silence — silence reads as "fine")* |
| **"Reviewed by: nobody. This listing is automated."** | any badge, shield, checkmark, or green pill |
| **"AgentDock reads files. It does not run them. It cannot tell you what a script does."** | — |

Three hard rules for the detail page:
1. **Every capability statement is a fact about the file, with a file path and line number the user can click.** "Requests `Bash` — `SKILL.md:4`". Never an inference.
2. **Absence of a signal is rendered as "not detected", never as an affirmative negative.** Socket's `Safe`→`Undetected` migration is the precedent.
3. **The set of things AgentDock does NOT check is displayed on the page, permanently, not in a footer or a tooltip.** A visible "Not checked: what bundled scripts actually do at runtime, whether instructions are malicious, upstream changes after this scan" block.

Sorting/filtering by "safety" is banned. Filtering by *capability* ("show me skills that request no shell access") is good, honest, and more useful anyway.

**Warning signs:**
- A `risk_score` / `security_score` numeric column appears in a schema draft.
- Anyone (including the maintainer, in a README) writes the word "safe" about an indexed artifact.
- A design mockup contains a green badge.
- The word "verified" appears anywhere it is not describing a *cryptographic* verification that was actually performed.

**Phase to address:** The static-analysis phase, and the package-detail-UI phase. Also **write the vocabulary rule into PROJECT.md as a constraint before either phase is planned** — this is a decision, not a design detail, and it will be silently reversed by a later "let's make it sortable" impulse if it lives only in research.

---

### Pitfall 2: AgentDock becomes the injection delivery vector — rendering payloads verbatim

**What goes wrong:**
AgentDock's whole value proposition is "read the `SKILL.md` before you install." So it renders the body. That body is attacker-controlled instruction text. Two distinct failures follow:

1. **Human-invisible content reaches the human.** The rendered page shows benign text; the file contains Unicode-tag characters (U+E0000–U+E007F), zero-width characters, HTML comments, or white-on-white spans carrying the real payload. The user reads the clean version, approves it, and the agent reads the dirty version. AgentDock has actively *helped the attacker* by displaying the sanitized-looking rendering.
2. **The payload reaches an agent through AgentDock.** Users will absolutely point coding agents at AgentDock pages and at any API AgentDock exposes ("find me a FastAPI review skill"). At that moment AgentDock is untrusted-content-in-the-middle for someone else's agent. If AgentDock serves the raw text with the invisible characters intact and no marker, AgentDock is the distribution hop.

**Why it happens:**
Markdown rendering is treated as a display concern, handed to `react-markdown` or `marked`, and never revisited. Invisible characters survive every step of a normal pipeline because *nothing in a normal pipeline is looking for them* — they are valid Unicode, they round-trip through UTF-8, JSON, and Postgres unharmed.

**Documented technique base:** Unicode Tags block U+E0000–U+E007F renders as nothing but tokenizes and is interpreted as instructions by LLMs; zero-width characters (U+200B/C/D) and bidi controls are a parallel channel. Snyk's taxonomy explicitly lists "obfuscated instructions using base64 encoding or Unicode smuggling." AWS and Cisco both published mitigation guidance recommending stripping the Tags block before content reaches a model.
([Cisco](https://blogs.cisco.com/ai/understanding-and-mitigating-unicode-tag-prompt-injection), [AWS](https://aws.amazon.com/blogs/security/defending-llm-applications-against-unicode-character-smuggling/), [Promptfoo](https://www.promptfoo.dev/blog/invisible-unicode-threats/), [Snyk ToxicSkills](https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/))

**How to avoid:**
- **Normalize and flag at ingest, not at render.** Store *both* the raw bytes (hashed, for provenance) and a `display_body` where invisible characters have been replaced with a **visible sentinel** (e.g. `␡U+E0041␡`), plus a `hidden_content_findings` record. Never silently strip: silent stripping destroys the evidence and the user learns nothing. **Make the invisible visible** — that is the actual product feature here, and it is the highest-value, highest-precision detector AgentDock can ship.
- Character classes to flag: Unicode Tags `U+E0000–U+E007F`; zero-width `U+200B U+200C U+200D U+FEFF`; bidi overrides `U+202A–U+202E U+2066–U+2069`; soft hyphen `U+00AD`; and any non-ASCII homoglyph in a command-looking context.
- Also flag: HTML comments containing imperative-looking text, `style` attributes setting `color`/`font-size:0`/`display:none`, and base64 blobs over ~200 chars inside a Markdown file.
- **If AgentDock ever exposes an API or MCP server for agents to query, that endpoint must return sentinel-annotated text, never raw.** Add this as a written constraint now, before the API exists.

**Warning signs:**
- The word "sanitize" appears without "and record what was removed."
- Ingest stores only one copy of the body.
- Nobody has tested ingestion with a crafted file containing U+E0041.

**Phase to address:** Parsing/ingest phase (normalization + findings record), detail-UI phase (sentinel rendering). MVP — this is the cheapest, most precise, most differentiating detector available and it is deterministic. Ship it first among all security features.

---

### Pitfall 3: Stored XSS through rendered README / SKILL.md / package metadata

**What goes wrong:**
Markdown permits raw HTML. GitHub READMEs use it constantly (`<img>`, `<details>`, `<div align="center">`, badge tables). The natural implementation — enable `rehype-raw` or `marked` with default settings so READMEs "look right" — hands attackers `<img src=x onerror=...>` on an AgentDock page. Since AgentDock is local-first and single-user, the immediate blast radius looks small; that is a trap, because (a) the maintainer's own browser is the target, (b) session/localStorage and any GitHub PAT surfaced in a settings page go with it, and (c) "local only" reliably becomes "deployed" in month four without a security review.

Secondary vector, often missed: **package names, descriptions, tags, and author strings** from frontmatter also reach the DOM, and they reach it through code paths (list items, `<title>`, meta tags, filter chips) where a developer who carefully sanitized the Markdown body is not thinking about escaping at all. Frontmatter `name:` values are as attacker-controlled as the body.

**Why it happens:**
Fidelity pressure. A GitHub README rendered without raw HTML looks broken, and the maintainer turns HTML on to fix the visual bug. The security consequence is one commit away from the cosmetic motivation.

**How to avoid — named, concrete approach:**

**Do not render raw HTML. Markdown-only.** This is the recommendation across the current guidance and it is also the ponytail-correct answer: the safest configuration is the one where the dangerous feature does not exist.

Concretely, for a React/unified stack:
```
unified()
  .use(remarkParse)
  .use(remarkGfm)          // tables/strikethrough — the actual reason READMEs look broken
  .use(remarkRehype)       // WITHOUT allowDangerousHtml
  .use(rehypeSanitize, schema)   // defense in depth even without rehype-raw
  .use(rehypeStringify)
```
- **Omit `rehype-raw` entirely.** If a README loses a `<details>` block, that is an acceptable, visible, non-exploitable degradation. `remark-gfm` recovers most of the perceived loss.
- `rehype-sanitize` with the **default GitHub schema**, further narrowed: drop `img` `src` to an https-only allowlist or proxy it, and force all `a` to `rel="noopener noreferrer nofollow ugc" target="_blank"`.
- **Block `javascript:`, `data:`, and `vbscript:` URL schemes on links and images explicitly** — sanitizer defaults handle this, but link rewriting code added later often reintroduces it.
- If raw HTML is ever genuinely required, the *only* acceptable configuration is `rehype-raw` **plus** `rehype-sanitize` after it (order matters) or DOMPurify applied immediately before `dangerouslySetInnerHTML` with nothing mutating the string afterward. ([HackerOne](https://www.hackerone.com/blog/secure-markdown-rendering-react-balancing-flexibility-and-safety), [Strapi](https://strapi.io/blog/react-markdown-complete-guide-security-styling))
- **Content-Security-Policy as the second layer**, since layer one will eventually be misconfigured: `default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; img-src 'self' https: data:` (drop `data:` if avoidable). No `unsafe-inline` in `script-src`. CSP is what saves the project when someone adds a Markdown plugin in month six.
- **Never render on the client from an unsanitized field.** Sanitize once at render time on the server, or store a sanitized HTML column — but if storing, store the sanitizer version alongside it so a sanitizer upgrade can trigger a re-render.
- **Escape metadata everywhere, including non-HTML sinks:** `<title>`, OpenGraph tags, JSON-LD, CSV/JSON export, and log lines. React escapes JSX text by default; it does not escape values you interpolate into `dangerouslySetInnerHTML`, `<script type="application/ld+json">`, or a generated `.md`/`.csv` file.

**Warning signs:**
- `dangerouslySetInnerHTML` appears anywhere in the codebase.
- `allowDangerousHtml: true` or `rehype-raw` in the pipeline.
- A commit message like "fix README rendering."
- No CSP header in the dev server config.

**Phase to address:** The first phase that renders any ingested content in a browser. **MVP, non-negotiable.** Add one test that ingests a fixture repo whose README contains `<img src=x onerror=alert(1)>` and `<script>`, and asserts neither appears in the response body. That test is the whole guardrail.

---

### Pitfall 4: SSRF and the ingestion pipeline as attack surface

**What goes wrong:**
"Submit a GitHub URL" is a request to make AgentDock fetch a URL of the attacker's choosing. On a WSL dev box this reaches `localhost`, the Docker bridge (`172.17.0.0/16` — including `didim-mcp-service-backend-db-1`, an unrelated application's Postgres), the Windows host, and the WSL gateway. On any future cloud host it reaches the metadata service. The submitted URL is also the *least* dangerous fetch: the pipeline then follows URLs found inside repo content (submodules, `mcp.json` server URLs, README image sources, `.well-known` manifests) which are attacker-controlled with no user in the loop at all.

**Why it happens:**
Validation is written as a string check (`url.startsWith('https://github.com/')`) which is bypassed by `https://github.com.evil.tld/`, `https://github.com@evil.tld/`, userinfo tricks, and — critically — by **redirects**, since the check runs once and the HTTP client follows 30x automatically. DNS rebinding defeats even a correct check-then-fetch, because the name resolves benign at validation and hostile at connection.

**How to avoid:**
- **Do not accept arbitrary URLs. Accept `owner/repo`.** Parse the input, extract owner and repo, discard everything else, and construct the API URL yourself. This eliminates the entire class in one decision and costs nothing — the UI can still accept a pasted GitHub URL and parse it client-side or server-side into the two fields. This is the lazy fix and it is also the correct fix.
- **All outbound requests go to a hardcoded host allowlist**: `api.github.com`, `raw.githubusercontent.com`, `codeload.github.com`. Nothing else. Not configurable.
- **`redirect: 'manual'` (or `maxRedirects: 0`).** Re-validate any redirect target against the allowlist before following, and cap follows at 2. Every redirect is a new authorization decision. ([OWASP SSRF Prevention in Node.js](https://owasp.org/www-community/pages/controls/SSRF_Prevention_in_Nodejs))
- **Pin the resolved IP.** Resolve the hostname yourself, reject any result in private/loopback/link-local/CGNAT/IPv6-ULA/IPv4-mapped ranges, then pass the *approved address* to the connection via a custom `lookup`/undici dispatcher. Checking then re-resolving is the DNS-rebinding hole. ([OWASP](https://owasp.org/www-community/pages/controls/SSRF_Prevention_in_Nodejs), [windshock](https://windshock.github.io/en/post/2025-06-25-ssrf-defense/))
- **Never fetch a URL discovered inside repo content.** Extract, display, flag — never resolve. That includes MCP `.well-known` endpoints and `server.json` URLs. There is no product reason to fetch them and every reason not to.
- Set a hard per-request timeout (10s) and a per-response byte cap (`Content-Length` check *and* a streaming counter, since `Content-Length` lies).

**Warning signs:**
- A `url` TEXT column on the submission table instead of `owner`/`repo`.
- `fetch(userInput)` anywhere.
- Default `redirect: 'follow'`.
- Any code path that resolves a hostname found in ingested content.

**Phase to address:** Ingest phase. MVP.

---

### Pitfall 5: Archive handling — zip slip, decompression bombs, and the 100k-file repo

**What goes wrong:**
The efficient way to get a repo is the tarball (`codeload.github.com/.../tar.gz`) — one request instead of hundreds of Contents API calls. It is also a hostile input. Three failures:
- **Zip slip / tar path traversal**: an entry named `../../../../home/ghchoi/.ssh/authorized_keys` writes outside the extraction directory. Symlink entries are the sneakier variant: extract a symlink `x -> /home/user/.ssh`, then a file `x/authorized_keys`. ([Snyk](https://snyk.io/blog/severe-security-vulnerability-in-bowers-zip-archive-extraction/), [Sonar](https://www.sonarsource.com/blog/openrefine-zip-slip/))
- **Gzip bomb**: a few KB inflating to gigabytes, filling the WSL disk. `node-tar` itself carried a gzip-bomb DoS (CVE-2026-59873 per search results — *unverified, single source*).
- **Resource exhaustion without any malice**: a legitimate monorepo with 100k files. The parser walks all of them, the DB gets 100k rows, and a single submission wedges the pipeline.

**How to avoid:**
- **Extract with entry filtering, streaming, and caps, before writing anything to disk.** Reject entries whose resolved canonical path escapes the target dir. Reject any entry type that is not a regular file or directory — **no symlinks, no hardlinks, no devices, no FIFOs**. Reject absolute paths.
- **Cap before inflating**: max total decompressed bytes (e.g. 100 MB), max entry count (e.g. 20,000), max single-file size (e.g. 2 MB for text files AgentDock will actually parse). Check the running counter during the stream, not after.
- **Better: consider never extracting to disk at all.** Stream the tarball and keep only entries matching the artifact patterns (`SKILL.md`, `**/skills/**`, `.mcp.json`, `plugin.json`, `README*`, `*.sh|*.py|*.js` inside a skill dir). Everything else is discarded mid-stream. This kills zip slip by construction — there is no write path to traverse — and caps memory. It is less code than a safe extractor.
- **Depth/breadth caps on artifact discovery**: max directory depth 6, max artifacts per repo 200 (record "truncated" and surface it, do not silently drop).
- Set a wall-clock budget per ingest job (e.g. 120s) and kill it.

**Warning signs:**
- `tar -xzf` shelled out, or any extractor used with defaults.
- No byte counter in the decompression path.
- A test fixture set that contains only small, well-formed repos.

**Phase to address:** Ingest phase. MVP for the caps and entry filtering; the streaming-only refinement can follow.

---

### Pitfall 6: Believing the static analyzer sees more than it does

**What goes wrong:**
The analyzer ships with 15 detectors. The maintainer, and then users, treat the absence of hits as evidence of benignity. The measured recall of static analysis alone against confirmed malicious skills is **1.5%** (arXiv:2602.06547). Meanwhile the noisy detectors (`rm -rf`, `curl | sh`) fire constantly on legitimate DevOps and security skills, users learn the flags are noise, and the two or three flags that actually matter get ignored along with the rest. **A noisy detector is worse than a missing one** because it trains users to dismiss the UI.

**Why it happens:**
Coverage feels like rigor. Adding a regex is cheap; measuring its precision requires a labeled corpus the maintainer does not have.

**Honest capability assessment:**

| Signal | Static detectability | Reality |
|---|---|---|
| `allowed-tools` / `permissions` frontmatter | **RELIABLE** | Declarative YAML. Parse it. But *absence proves nothing* — an unlisted skill can still say "run `curl ...`" in prose. |
| Bundled executable files present (`.sh/.py/.js/.ts`) | **RELIABLE** (existence) / **UNDETECTABLE** (behavior) | You can list and hash them. You cannot say what they do without executing, which is forbidden. Disclose the inventory, disclose the non-analysis. |
| External URLs in instruction text | **RELIABLE** (extraction) / **UNDETECTABLE** (intent) | `https://cdn.example.com/setup.sh` is extractable. Whether it is malicious is a runtime, mutable property. |
| `curl \| sh`, `iwr \| iex`, `wget && bash` | **HIGH PRECISION** | Distinctive literal shape. Very low FP. Ship it. |
| `npm install` / `pip install` / `uvx` / `brew install` directives | **HIGH PRECISION** (as disclosure) | Trivial to match; meaningless as a *risk* verdict (half of all legitimate skills install something). Report as capability, never as risk. |
| Invisible Unicode (tags, ZW, bidi) | **RELIABLE, near-zero FP** | Deterministic character-class check. The single best detector available. |
| Hidden HTML content (comments, `display:none`, white text, `font-size:0`) | **RELIABLE** | Deterministic. Low FP in `SKILL.md` context (README badges are the only noise source). |
| Base64/hex blobs > N chars in an instruction file | **RELIABLE** (shape) / **FALSE POSITIVES** (meaning) | Inline images and test fixtures are legitimate. Report as "encoded blob present", decode-and-preview optionally, never assert malice. |
| Credential-path literals (`~/.aws/credentials`, `~/.ssh/id_`, `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, `.env`, `security find-generic-password`) | **DETECTABLE, HIGH FP** | Security/DevOps skills legitimately reference these constantly. High value *as disclosure*, poor as verdict. |
| Env-var reads generally (`process.env`, `os.environ`) | **DETECTABLE, VERY HIGH FP** | Near-universal. Exclude from MVP; it is pure noise. |
| Network egress from a bundled script | **FALSE POSITIVES** | Regex over source misses `getattr(__import__('requests'),'post')` and flags a docstring. |
| Filesystem read/write **scope** | **EFFECTIVELY UNDETECTABLE** | Scope is expressed in natural language ("read the user's project files"). There is no scope declaration to parse. |
| Destructive intent (`rm -rf`, `DROP TABLE`, `git push --force`) | **DETECTABLE, VERY HIGH FP** | A "git cleanup skill" and a wiper look identical statically. This is the classic noise detector. Exclude or bury it. |
| Prompt-injection-shaped instructions ("ignore previous instructions", role impersonation, coercive framing) | **FALSE POSITIVES; classifier territory** | Snyk reports 90–100% recall at 0% FP for its critical prompt-injection detectors — but that is with a tuned engine (`mcp-scan`) plus human-in-the-loop, measured against a *confirmed-malicious* set, not against the open world. Regex versions of this will be noise. |
| Overall malicious intent | **UNDETECTABLE** | Requires behavior. AgentDock has correctly forbidden execution, so this is permanently out of reach. Say so in the UI. |
| MCP server *declared* config (`.mcp.json`, `server.json`, command, args, env) | **RELIABLE** | Parse the config. Very useful — `"command": "npx"` with a remote package is a real, factual disclosure. |
| MCP server *actual* tool set and descriptions | **UNDETECTABLE without connecting** | The tool list comes from the running server and can change after approval — that is precisely the **rug-pull** attack. AgentDock can never know it. State this explicitly on MCP pages. |

**Recommended MVP detector set — six, all high-precision, all disclosure-framed:**

1. **Invisible/hidden content** — Unicode tags, zero-width, bidi controls, HTML comments with imperative text, zero-size/transparent styled text. *Rendered as visible sentinels.*
2. **Declared capabilities** — `allowed-tools`/frontmatter permissions, `.mcp.json`/`server.json` command+args+env. Verbatim, with source line.
3. **Bundled executable inventory** — path, size, SHA-256, interpreter. Explicitly labeled **"contents not analyzed."**
4. **Remote-execution directives** — `curl|sh`, `iwr|iex`, `wget && bash`, `eval $(curl ...)`. Literal shapes only.
5. **Install directives** — `npm i`, `pip install`, `uvx`, `bunx`, `brew install`, plus the package name. Disclosure, not risk.
6. **Egress inventory** — every external URL and domain found in instruction text and bundled scripts, deduped, with file:line. Never fetched.

Explicitly **not** in MVP: aggregate scoring, malicious-intent classification, LLM-based judgment, generic env-var reads, destructive-command matching, dynamic analysis of any kind.

**Warning signs:**
- Detector count growing faster than the fixture corpus.
- No labeled fixture repos in the test suite (need at least: one benign skill, one with invisible chars, one with a bundled script, one with `curl|sh`, one 100k-file monster, one malformed frontmatter).
- Any detector shipped without a hand-checked precision estimate on real indexed data.

**Phase to address:** Static-analysis phase. Ship detectors 1–3 first; 4–6 next. Gate each new detector on "sample 20 real hits, count the false positives, kill it if >20%."

---

### Pitfall 7: Data staleness — the index rots and the security signal becomes a lie

**What goes wrong:**
A repo is ingested once. Six months later the page shows a `SKILL.md` that no longer exists, an "capabilities: none" disclosure for a skill that has since added `Bash`, and a commit SHA nobody has checked. This is not just a quality problem: **a stale capability disclosure is an actively false security claim**, and the rug-pull pattern (approve benign, mutate later) is the documented attack. ([Invariant Labs](https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks), OWASP MCP03:2025)

**Why it happens:**
Re-crawl is unglamorous, costs rate limit, and has no visible payoff on day one. It is always deferrable and therefore always deferred.

**How to avoid:**
- **Every displayed fact is pinned to a commit SHA and a `scanned_at` timestamp, both visible on the page, always.** "Analyzed at commit `a1b2c3d`, 2026-08-10." This converts staleness from a silent lie into a disclosed fact — cheap, and it is the honest framing regardless of whether re-crawl ever ships.
- **Store the ETag / `Last-Modified` from the GitHub API from day one, even before re-crawl exists.** A `304 Not Modified` does not count against the primary rate limit ([GitHub docs](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)), which makes refresh nearly free later. Not storing them now costs a migration and a full re-crawl later.
- **Refresh is a cheap two-step**: compare default-branch HEAD SHA (1 request, or 0 if 304) → only re-ingest on change. At 5,000 req/hr authenticated, a 10,000-repo index is fully SHA-checked in ~2 hours; the vast majority will be 304s.
- **Show age prominently and degrade the page when stale**: >90 days → "Last checked 4 months ago. Capabilities may have changed."

**Warning signs:**
- No `scanned_at` / `commit_sha` columns in the first schema.
- ETags not captured.
- The word "later" attached to re-crawl in a phase plan.

**Phase to address:** Schema/ingest phase must include `commit_sha`, `scanned_at`, `etag`, `content_hash`. The refresh *job* can be a later phase; the *columns* cannot.

---

### Pitfall 8: GitHub rate-limit exhaustion and PAT handling

**What goes wrong:**
Unauthenticated: 60 req/hr — enough for one repo. Authenticated PAT: 5,000 req/hr. **Search API: 30 req/min authenticated (10 unauthenticated)** — and discovery ("find repos containing `SKILL.md`") is naturally a Search API workload, which will be the first thing to die. Secondary limits (no more than 100 concurrent requests; ~900 points/min on REST) trigger on bursty parallel crawls and produce opaque 403s rather than clean 429s. ([GitHub docs](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api))

Then: the PAT ends up in a `.env` that gets committed, in an error message rendered to the page, in a log line, or in a URL query string that lands in access logs.

**How to avoid:**
- **Tarball over Contents API.** One `codeload` request per repo beats N per-file requests by an order of magnitude. This is the single biggest rate-limit lever.
- **Conditional requests everywhere** — send `If-None-Match`; 304s are free.
- **Read `x-ratelimit-remaining` and `x-ratelimit-reset` on every response; stop at a floor (e.g. 200 remaining) and sleep to reset.** Do not discover the limit by hitting it.
- **Respect `Retry-After`; exponential backoff with jitter on 403/429.** Serial-or-low-concurrency ingest (2–3 workers) avoids secondary limits entirely at this project's scale.
- **A persistent job queue with resumable state** (a Postgres table is sufficient — no Redis, no broker). A run that dies at hour 3 must resume, not restart.
- **PAT hygiene**: fine-grained token, public-repo read only, no `repo`/`write` scopes. Env var only. `.env` in `.gitignore` from commit #1 with `.env.example` alongside. Never in a URL. Redact `ghp_`/`github_pat_` patterns in a log formatter, and **strip the `Authorization` header before any error object is serialized** — the usual leak is an axios/undici error dump including `config.headers`.
- **Secrets in logs generally**: never log full request/response objects; log method + host + path + status. Never log ingested file bodies at info level (they may contain the *submitter's* leaked secrets, which AgentDock then persists).

**Warning signs:**
- No rate-limit headers read anywhere.
- Ingest implemented as `Promise.all` over file paths.
- A stack trace in a browser response.
- `console.log(error)` on an HTTP failure path.

**Phase to address:** Ingest phase. MVP.

---

### Pitfall 9: Over-generalizing the data model across five artifact types before one works

**What goes wrong:**
PROJECT.md names five artifact types (Skills, plugins, MCP servers, commands, hooks). The instinct is a polymorphic `artifacts` table with a `type` discriminator, a `capabilities` join table, a plugin-parser interface with five implementations, and a `manifest_schema` abstraction — all designed before a single `SKILL.md` has been parsed end to end. The abstraction is then wrong in ways only discovered after the schema has data in it, and the maintainer spends a weekend on a migration instead of on the product.

**Why it happens:**
The five types are all listed in the vision doc, so they all feel like scope. Designing for all five feels responsible. It is the most reliable way to spend three weeks and ship nothing.

**How to avoid:**
- **Agent Skills only, end to end, first.** Ingest → parse → store → browse → detail page → capability disclosure. One artifact type, all the way through, deployed and used by the maintainer. Skills are the right choice: `SKILL.md` + frontmatter is the simplest format, the largest corpus, and the type where the security story is strongest.
- **Model concretely.** A `skills` table with real columns. Add MCP servers as a *second concrete table* when the time comes; only extract shared structure after two real implementations exist and the duplication is visible. Two concrete tables beat one abstract one until proven otherwise.
- **One parser function per format. No parser interface, no registry, no plugin system** until there are three parsers and the duplication actually hurts.
- Treat the other four types as roadmap phases, not schema requirements.

**Warning signs:**
- A `type` enum with five values before type #2 is implemented.
- An `AbstractArtifactParser` / `ParserRegistry`.
- A JSONB `metadata` column used to avoid deciding what the fields are.
- Zero packages in the DB after two weeks of work.

**Phase to address:** Schema/data-model phase — constrain it in the roadmap explicitly. **Must handle in MVP** (as a scope constraint, not a feature).

---

### Pitfall 10: Cold start — an empty registry nobody uses

**What goes wrong:**
The product ships, contains 12 packages, and is less useful than the awesome-list it was meant to replace. Nobody returns. The maintainer, seeing no usage, stops. This kills more solo registries than any bug.

**Why it happens:**
Registries are two-sided (publishers ↔ consumers) and the founder builds the *publisher* side (submit form, account, ownership verification) because it is the interesting engineering — while the consumer side has no inventory to consume.

**How to avoid:**
- **There is no publisher side. Seed by crawling.** The corpus already exists on GitHub: awesome-lists, `anthropics/skills`, ClawHub-adjacent repos, `modelcontextprotocol/servers`, the `mcp-server` / `claude-skill` topic tags. Batch-import 500–2,000 artifacts before showing anyone. Snyk found ~4,000 skills across two registries; arXiv:2602.06547 found ~98,000 across two others. **Inventory is not the constraint — it is sitting there.**
- **The first user is the maintainer.** If the maintainer does not use AgentDock to find skills, nobody will. Ship the thing that makes the maintainer's own next skill search faster, and dogfood it weekly.
- **Do not build accounts, submission, ownership verification, or claiming until inventory exists and someone asks.** The official MCP Registry has namespace verification via GitHub OAuth and DNS TXT — worth copying *eventually*, and worth copying *nothing of* on day one. ([MCP Registry](https://modelcontextprotocol.io/registry/about))
- Seed quality gate: require the artifact to parse and to have a non-empty description. Do not index every fork.

**Warning signs:**
- A `users` table before there are 500 packages.
- Login/OAuth work scheduled before search works.
- Fewer than 100 packages in the index a month in.

**Phase to address:** A dedicated bulk-seed phase, immediately after ingest+parse works for one repo and before (or alongside) the browse UI. Auth belongs in a much later milestone, if ever.

---

### Pitfall 11: Fork spam and duplicate flooding destroying the quality signal

**What goes wrong:**
Popular skill repos have hundreds of forks. Awesome-lists are forked reflexively. Crawl them all and the index becomes 40 copies of `anthropics/skills` with different owner names, and search returns the same skill twenty times. npm's registry absorbed 43,000–67,000 spam packages over two years; winget was flooded with duplicate submissions. Registries do not degrade gracefully under duplication — search relevance collapses. ([The Hacker News](https://thehackernews.com/2025/11/over-46000-fake-npm-packages-flood.html), [BleepingComputer](https://www.bleepingcomputer.com/news/security/windows-10s-package-manager-flooded-with-duplicate-malformed-apps/))

**How to avoid:**
- **Skip forks by default.** `fork: true` from the GitHub API is a free, reliable filter. Index a fork only on explicit submission *and* only if its artifact content differs from upstream.
- **Content-hash dedup**: SHA-256 of the normalized `SKILL.md` body. Identical hash across repos → one canonical record with an "also found in N repos" list, upstream (earliest-created / most-starred) as canonical. This is one column and one unique index; it pays for itself immediately.
- **Near-duplicate** (same name + same frontmatter description, different body) → cluster and show once with a variants disclosure. Defer until exact-hash dedup is proven insufficient.
- **Brand impersonation is a real observed pattern** — 54.1% of the malicious corpus in arXiv:2602.06547 came from one actor using templated impersonation. A skill named `anthropic-official-*` from an unrelated owner is a *disclosure* ("owner does not match claimed brand"), not a verdict.

**Warning signs:**
- Search for a common term returns visibly identical results.
- No `content_hash` column.
- Fork filtering not applied at crawl time.

**Phase to address:** Bulk-seed phase (fork filter + content hash at ingest). MVP-adjacent — cheap now, expensive to retrofit after 10k rows.

---

### Pitfall 12: Legal, licensing, and consent

**What goes wrong:**
AgentDock mirrors full READMEs and `SKILL.md` bodies from repos whose licences it did not check, displays them without attribution, has no takedown path, and indexes repos whose owners never consented. Any one of these produces an angry issue; together they produce the kind of reputational event a solo OSS project does not recover from.

**Why it happens:**
"It's public on GitHub" is treated as "it's freely reusable." Public ≠ licensed. A repo with no LICENSE file is **all rights reserved by default** — GitHub's own ToS grants *GitHub* rights to serve the content, and grants other users the right to view and fork *within GitHub*, but does not grant a third-party site a licence to reproduce it elsewhere. ([GitHub ToS](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service))

**How to avoid:**
- **Excerpt, don't mirror, when the licence is unknown.** For unlicensed/unknown-licence repos: show frontmatter metadata (name, description — short factual metadata), a **truncated excerpt** of the body (e.g. first ~500 chars or the first section), the detected capabilities, and a prominent **"Read the full skill on GitHub →"** link. Full-body mirroring only for permissive detected licences (MIT/Apache-2.0/BSD/ISC/CC0/Unlicense). This is also the better product: it drives users to the source, which is where they should be reading instruction text anyway.
- **Always attribute**: owner, repo, canonical GitHub link, licence, commit SHA — on every page, above the fold. Preserve copyright notices found in the source.
- **Licence detection is unreliable — say so.** GitHub's `licensee` mis-detects on optional-text variations, SPDX covers ~400 licences and misses custom ones, and detectors provide no legal guarantee. ([licensee#395](https://github.com/licensee/licensee/issues/395), [ACM TOSEM: Open Source License Inconsistencies on GitHub](https://dl.acm.org/doi/10.1145/3571852)) Use the GitHub API's `license` field (SPDX id + `confidence`), display it verbatim, and render three distinct states: **detected SPDX id**, **"licence file present but unrecognised"**, and **"No licence — all rights reserved by the author."** Never display "Unknown" as if it meant "probably fine," and never omit the field.
- **Scraping**: use the REST/GraphQL API, not HTML scraping. GitHub's Acceptable Use Policy governs scraping and its API terms prohibit sharing tokens to exceed rate limits; excessively frequent requests can get an account suspended at GitHub's sole discretion. Staying inside documented rate limits with a PAT and identifying via `User-Agent` is the compliant posture. ([GitHub Acceptable Use](https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies)) Also honour the *personal information* clause — do not build a searchable index of committer emails.
- **Ship a takedown path before the first public link.** A `SECURITY.md`/`CONTENT-POLICY.md` stating: how to request removal (a GitHub issue template is sufficient), expected response time, and that removal on repo-owner request is unconditional and immediate. Add a `takedowns` table with an `excluded_repos` denylist consulted at crawl time — otherwise the next crawl re-adds what was just removed. That re-add bug is the most common and most infuriating version of this failure.
- **Opt-out, not opt-in, is the norm for directories** (the official MCP Registry runs self-publish + report-based denylisting with no review queue). Opt-out is defensible *if* it is honoured cheaply and quickly. Also honour repository archival/deletion: a 404 on refresh should unpublish, not error.
- **Do not mirror avatars or user photos.** Hotlink or omit.

**Warning signs:**
- Full README bodies stored with no `license` column.
- No `excluded_repos` table.
- A crawler that re-adds a removed repo.
- Committer emails in the schema.

**Phase to address:** Storage/schema phase (licence + attribution columns, denylist table); a small content-policy task before any public exposure. **Must not forget later** — but the *columns* and the *denylist consultation* are MVP because retrofitting them means re-crawling.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|---|---|---|---|
| No `commit_sha` / `scanned_at` / `etag` columns | Simpler first schema | Full re-crawl + migration; staleness undetectable; capability disclosures become silent lies | **Never** — three columns, add them on day one |
| Aggregate risk score "just as a sortable number" | Nice UI, easy filters | Users read it as a guarantee; reputational damage on the first bad call; culturally irreversible once shipped | **Never** |
| `rehype-raw` on to make READMEs look right | READMEs render like GitHub | Stored XSS on every page | **Never** without `rehype-sanitize` after it *and* CSP |
| Full-body mirroring regardless of licence | Better-looking pages, works offline | Takedown requests; possible copyright exposure | Only for detected permissive licences |
| Accepting arbitrary URLs instead of `owner/repo` | Flexible input | SSRF class permanently open | **Never** — parsing to `owner/repo` is less code |
| Indexing forks | Bigger number on the homepage | Search relevance collapse; duplicate-riddled index | Never at crawl; only on explicit submission with content diff |
| Storing only the sanitized body | One column, simpler | Cannot re-analyze with better detectors; provenance gone; cannot prove what was found | Never — store raw bytes + hash + a derived display body |
| JSONB `metadata` catch-all to avoid schema decisions | Fast start | Unqueryable, undocumented, becomes the schema | Acceptable for genuinely open-ended parser output; never for fields you filter on |
| Regex-only prompt-injection detection | Ships in an afternoon | False positives train users to ignore all flags | Only if precision is hand-measured and the detector is killable |
| No job queue — ingest runs inline in the HTTP handler | Trivially simple, correct for one repo | Bulk seed impossible; a slow repo blocks the server; no resume | Acceptable **only** through the single-repo-ingest phase; must be replaced before bulk seed |
| Skipping the `excluded_repos` denylist ("I'll just delete the row") | One less table | Next crawl re-adds removed content | Never once crawling is automated |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|---|---|---|
| GitHub REST API | Per-file Contents API calls; no conditional requests; `Promise.all` bursts | Tarball via `codeload`; `If-None-Match` (304s are free); 2–3 workers; read `x-ratelimit-remaining` and stop at a floor |
| GitHub Search API | Assuming the 5,000/hr limit applies | Search is **30/min authenticated** and has its own bucket — budget it separately and cache aggressively |
| GitHub tarball | `tar -xzf` with defaults | Stream with entry filtering: reject `..`, absolute paths, symlinks, hardlinks; cap bytes + entry count pre-inflation |
| Frontmatter YAML | `yaml.load()` / PyYAML `yaml.load()` | `js-yaml` v4+ removed unsafe loading entirely — **use js-yaml ≥4 and never call a custom-schema loader**; in Python, `yaml.safe_load` only. Note `safe_load` does *not* protect against app-registered custom tags — do not register any. ([GHSA-xxvw-45rp-3mj2](https://github.com/advisories/GHSA-xxvw-45rp-3mj2)) |
| Frontmatter parsers (`gray-matter` etc.) | Assuming the wrapper is safe because js-yaml is | Pin the wrapper's js-yaml to v4+; also cap frontmatter size — a 10 MB YAML block with deep nesting is a parser DoS |
| Markdown rendering | `marked()` → `innerHTML` | Markdown-only pipeline, no raw HTML; `rehype-sanitize`; CSP; sanitize immediately before the DOM sink with no post-mutation |
| PostgreSQL (shared instance) | Running migrations against `public`; relying on default `search_path` | Dedicated `agentdock` schema; a role scoped to it; `search_path` set explicitly on the connection; **never** `CREATE EXTENSION` outside a reviewed migration (extensions are database-wide and affect the other app) |
| PostgreSQL FTS | `to_tsvector` computed per query | Stored generated `tsvector` column + GIN index; `pg_trgm` GIN for fuzzy name match. Prove FTS insufficient before considering anything else |
| MCP server configs | Fetching the server's `.well-known` or connecting to enumerate tools | Parse the *declared* config only. Never connect. State on the page that the live tool set is unknowable and mutable — that is the rug-pull vector |
| Regex-based detectors | Nested quantifiers over untrusted input | Anchored, bounded patterns; no `(a+)+`; per-file input length cap; per-regex timeout or a linear-time engine (Rust `regex`, RE2). ReDoS here is remote-triggerable by any submitter |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|---|---|---|---|
| Per-file Contents API ingestion | Rate limit gone after ~30 repos | Tarball fetch | Immediately at bulk seed |
| No job queue; ingest in the request handler | Request timeouts; a bad repo wedges the server | Postgres-backed queue table + worker loop | First 10k-file repo |
| Unbounded artifact discovery | One monorepo produces 40k rows | Depth/count caps + "truncated" flag | First large monorepo |
| ReDoS in detector regexes | One repo pins a CPU forever | Bounded patterns; input caps; timeouts | First crafted submission — this is attacker-controlled |
| Full-text search without a stored `tsvector` | Search latency climbs with row count | Generated column + GIN index | ~50k rows |
| `ILIKE '%term%'` for search | Seq scan every query | `pg_trgm` GIN index | ~20k rows |
| Storing full README + full SKILL.md bodies inline | Table bloat; slow `SELECT *` | Bodies in a separate table; never `SELECT *` on list views; consider TOAST-friendly access patterns | ~100k artifacts / a few GB |
| No pagination on browse | Full-table render | Keyset pagination from the first list view | ~1k rows |
| Re-analyzing unchanged content on every refresh | Refresh takes hours | `content_hash` short-circuit | First full refresh cycle |

At this project's realistic scale (single maintainer, 10k–100k artifacts, one machine) PostgreSQL is comfortably sufficient. The constraint in PROJECT.md — prove Postgres insufficient before adding anything — is correct and should be defended against the urge to add a search cluster.

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---|---|---|
| Aggregate risk score / "safe" badge | Users install malware because AgentDock vouched for it | Capability disclosure only; Socket's `Undetected` vocabulary |
| Rendering raw HTML from ingested Markdown | Stored XSS; PAT and session theft | No `rehype-raw`; `rehype-sanitize`; CSP |
| Unescaped package names/descriptions/tags in list views, `<title>`, JSON-LD, exports | Stored XSS through the path nobody sanitized | Escape at every sink, not just the Markdown body |
| Silently stripping invisible Unicode | Evidence destroyed; user learns nothing; payload still in the raw file users clone | Flag + render visible sentinels; keep raw bytes |
| Serving raw ingested text via an API/MCP endpoint | AgentDock becomes the injection delivery hop for other people's agents | Sentinel-annotated output only; document the boundary |
| `fetch(userSubmittedUrl)` | SSRF into localhost, Docker bridge (the *other app's* Postgres), WSL host, cloud metadata | Accept `owner/repo`; hardcoded host allowlist; manual redirects; IP pinning |
| Fetching URLs discovered inside repo content | Attacker-controlled SSRF with no human in the loop | Extract and display; never resolve |
| Default archive extraction | Arbitrary file write outside the target dir (incl. `~/.ssh`) | Reject `..`/absolute/symlink/hardlink entries; canonical-path check |
| No decompression caps | Disk exhaustion from a KB-sized gzip bomb | Byte + entry caps enforced during the stream |
| `yaml.load()` on frontmatter | RCE via `!!js/function` / Python object tags | js-yaml ≥4 only; `yaml.safe_load` in Python; no custom tags |
| Unbounded regex on untrusted files | ReDoS DoS, remotely triggerable | Bounded patterns; input length caps; timeouts |
| PAT in logs, error dumps, or URLs | Credential compromise | Strip `Authorization` before serializing errors; redact `ghp_`/`github_pat_`; env vars only; fine-grained public-read token |
| Logging ingested file bodies | AgentDock persists *other people's* leaked secrets into its own logs | Log path + hash, never content |
| Stack traces rendered to the browser | Path and config disclosure | Generic error pages; details to server log only |
| Trusting frontmatter `name`/`description` as identity | Brand impersonation (54.1% of one malicious corpus) | Display owner/repo as the identity; flag brand-mismatch as disclosure |
| Treating "no LICENSE" as permissive | Copyright exposure | Excerpt-only for unknown licences; explicit "All rights reserved" state |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---|---|---|
| Green shield / "Safe" badge | Users skip the review the product exists to enable | Neutral capability list; no shields, no colours that read as endorsement |
| Colour-coded risk (red/yellow/green) | Colour *is* a verdict even without words | Neutral typography; icons denote *capability type*, not severity |
| Burying "not analyzed" in a tooltip | Users assume full coverage | Permanent, visible "What AgentDock does not check" block |
| Twenty flags on every package | Alarm fatigue; all flags ignored | Six high-precision detectors; kill anything above ~20% FP |
| No source line for a finding | Users cannot verify or dispute | Every finding links to file:line in the source repo at the scanned SHA |
| Hiding scan age | Users trust stale data | SHA + date above the fold; visible degradation past 90 days |
| Install command copy-button as the primary CTA | One-click path from "found it" to "running it", skipping review | Primary CTA is "View the instructions"; install command secondary, with the capability list adjacent |
| Rendering hidden characters invisibly (i.e. correctly) | The attack works exactly as designed, on AgentDock's page | Visible sentinels — make the invisible visible |
| Search returning 20 copies of the same skill | Product feels broken | Content-hash dedup with "also in N repos" |
| Claiming compatibility from a frontmatter field | Users install into the wrong runtime | Label it "Declared compatibility (unverified)" |

---

## "Looks Done But Isn't" Checklist

- [ ] **Markdown rendering:** often missing raw-HTML suppression and CSP — verify a fixture README containing `<img src=x onerror=alert(1)>` and `<script>` produces neither in the response body, and that a CSP header is present.
- [ ] **Metadata escaping:** often missing on non-body sinks — verify a package named `"><svg onload=alert(1)>` is safe in list views, `<title>`, meta tags, JSON-LD, and any export.
- [ ] **Invisible-character handling:** often missing entirely — verify a `SKILL.md` containing U+E0041 and U+200B produces a finding *and* a visible sentinel in the rendered output.
- [ ] **SSRF:** often only string-validated — verify `https://github.com.evil.tld/a/b`, `https://github.com@127.0.0.1/a/b`, and a URL that 302s to `http://169.254.169.254/` are all rejected.
- [ ] **Archive extraction:** often missing entry-type filtering — verify a tarball containing `../escape.txt`, an absolute path, and a symlink to `/etc/passwd` writes nothing outside the target dir.
- [ ] **Decompression caps:** often missing — verify a 10 KB gzip bomb is rejected before disk fills.
- [ ] **YAML parsing:** often on an old parser — verify the resolved `js-yaml` version is ≥4 (check the lockfile, not `package.json`), and that a `!!js/function` frontmatter is rejected.
- [ ] **Rate limiting:** often no header reading — verify the crawler pauses at the floor rather than 403ing, and resumes after reset.
- [ ] **PAT redaction:** often leaks in error dumps — verify an HTTP failure's logged error contains no `Authorization` header.
- [ ] **Staleness:** often no visible provenance — verify every detail page shows the commit SHA and scan timestamp.
- [ ] **Takedown:** often deletes the row only — verify a removed repo is not re-added by the next crawl.
- [ ] **Licence:** often shows "Unknown" ambiguously — verify the three distinct states render differently and unknown-licence pages excerpt rather than mirror.
- [ ] **Dedup:** often absent — verify indexing a repo and its fork produces one canonical entry.
- [ ] **Detector precision:** often unmeasured — verify each shipped detector has 20 hand-checked real hits with a recorded FP count.
- [ ] **Ingest resumability:** often not tested — verify killing the worker mid-crawl and restarting does not duplicate or skip.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---|---|---|
| Shipped a risk score, users trusted it | **HIGH** (reputational, partly unrecoverable) | Remove the score immediately; publish a plain post explaining what the analyzer can and cannot see; replace with capability disclosure; expect the score to persist in screenshots and third-party writeups |
| Stored XSS discovered | **MEDIUM** | Disable raw HTML; add CSP; re-render all stored content; rotate the PAT and any session secret; audit for stored payloads via a scan of bodies for `<script`/`onerror` |
| SSRF discovered | **MEDIUM** | Switch to `owner/repo` input + host allowlist; audit outbound-request logs for internal destinations; rotate anything reachable from the pipeline (incl. the shared Postgres credentials) |
| Missing provenance columns after 10k rows | **MEDIUM** | Add columns nullable; backfill by re-crawling (SHA check is cheap with ETags); display "unknown" until backfilled |
| Index polluted with forks/duplicates | **LOW–MEDIUM** | Add `content_hash`; batch-compute over existing rows; collapse to canonical; add the fork filter at crawl |
| Over-abstracted schema before type #2 | **MEDIUM** | Collapse to concrete tables; the migration is painful in proportion to row count — do it early, not later |
| Rate limit exhausted mid-seed | **LOW** | Resumable queue + backoff; wait for reset |
| Takedown request received | **LOW if prepared, HIGH if not** | Denylist entry + row deletion + a public policy doc. Without a denylist table this recurs on every crawl and becomes a public argument |
| Copyright complaint | **MEDIUM** | Switch unknown-licence artifacts to excerpt-only globally; honour removal; add attribution retroactively |
| Detector proved noisy after launch | **LOW** | Kill the detector. Deleting a detector is always cheaper than defending it |

---

## Pitfall-to-Phase Mapping

Phase names below are *themes*; the roadmapper should align them to the actual phase list. "MVP" = must be handled before anything is exposed to another human.

| # | Pitfall | Severity | Prevention Phase | MVP? | Verification |
|---|---|---|---|---|---|
| 1 | False-assurance badge / risk score | **CRITICAL** | Written into PROJECT.md constraints *before* the analysis phase; enforced in analysis + detail-UI phases | **MVP** | No numeric score or safety word anywhere in schema, API, or UI; "not checked" block present on every detail page |
| 2 | AgentDock as injection delivery vector | **CRITICAL** | Ingest/parse (normalize + flag), detail UI (sentinels) | **MVP** | Fixture with U+E0041/U+200B produces a finding and a visible sentinel |
| 3 | Stored XSS from rendered Markdown/metadata | **CRITICAL** | First rendering phase | **MVP** | XSS fixture test passes; CSP header asserted; no `dangerouslySetInnerHTML` in the tree |
| 4 | SSRF in ingestion | **CRITICAL** | Ingest phase | **MVP** | Bypass-suite test (subdomain, userinfo, redirect-to-metadata) all rejected |
| 5 | Archive attacks / resource exhaustion | **HIGH** | Ingest phase | **MVP** | Zip-slip, symlink, and gzip-bomb fixtures rejected; 100k-file repo capped |
| 6 | Static analysis over-promise | **HIGH** | Static-analysis phase | **MVP** | Every detector has 20 hand-checked hits and a recorded FP rate; UI states the limits |
| 7 | Staleness / silent lies | **HIGH** | Schema phase (columns) → refresh phase (job) | **MVP for columns** | `commit_sha`, `scanned_at`, `etag`, `content_hash` present and displayed |
| 8 | Rate limits + PAT leakage | **HIGH** | Ingest phase | **MVP** | Crawler pauses at floor and resumes; error dump contains no `Authorization` |
| 9 | Over-generalized data model | **HIGH** | Schema/data-model phase (as a scope constraint) | **MVP** | Skills only, end to end, before any second artifact type exists in schema |
| 10 | Cold start | **HIGH** | Bulk-seed phase, right after single-repo ingest works | **MVP** | ≥500 parsed artifacts before the browse UI is shown to anyone |
| 11 | Fork/duplicate flooding | **MEDIUM-HIGH** | Bulk-seed phase | **MVP** (cheap now, costly later) | Repo + its fork → one canonical entry |
| 12 | Legal / licensing / takedown | **MEDIUM-HIGH** | Schema phase (licence + denylist columns); content-policy task before public exposure | **MVP for columns + denylist**; policy doc before first public link | Unknown-licence pages excerpt only; removed repo not re-added by next crawl |
| — | ReDoS in detectors | **MEDIUM** | Static-analysis phase | **MVP** | Pathological-input fixture completes under timeout |
| — | Search built before it is needed / semantic search premature | **MEDIUM** | Search phase | Not MVP | Postgres FTS + `pg_trgm` shipped and its failure modes documented before `pgvector` is even discussed (and it would require changing the shared DB image — a cost that must be justified) |
| — | CLI before the web product delivers value | **MEDIUM** | Deferred milestone | Not MVP | The maintainer uses the web UI weekly before any CLI work starts |
| — | Auth before there is anything worth an account | **MEDIUM** | Deferred milestone | Not MVP | No `users` table until a named use case requires identity |

---

## Sources

**Agent-skill and MCP threat research**
- Snyk — ToxicSkills: Prompt Injection in 36%, 1,467 Malicious Payloads: https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/
- Malicious Agent Skills in the Wild: A Large-Scale Security Empirical Study (arXiv:2602.06547): https://arxiv.org/html/2602.06547v1 *(preprint — abstract-level claims, not reproduced)*
- Invariant Labs — MCP Security Notification: Tool Poisoning Attacks: https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks
- Cloud Security Alliance — MCP Tool Poisoning: Adversarial Hijacking of AI Agent Workflows: https://labs.cloudsecurityalliance.org/research/csa-research-note-mcp-tool-poisoning-ai-agent-exfiltration-2/
- Elastic Security Labs — MCP Tools: Attack Vectors and Defense Recommendations: https://www.elastic.co/security-labs/mcp-tools-attack-defense-recommendations
- CyberArk — Poison everywhere: No output from your MCP server is safe: https://www.cyberark.com/resources/threat-research-blog/poison-everywhere-no-output-from-your-mcp-server-is-safe
- Parasites in the Toolchain: A Large-Scale Analysis of Attacks on the MCP Ecosystem (arXiv:2509.06572): https://arxiv.org/pdf/2509.06572 *(preprint)*
- MCP-38: A Comprehensive Threat Taxonomy for MCP Systems (arXiv:2603.18063): https://arxiv.org/pdf/2603.18063 *(preprint, unverified)*
- Repello AI — Claude Code Skill Security: How to Audit Any Skill Before You Run It: https://repello.ai/blog/claude-code-skill-security

**CVEs and vendor advisories**
- Check Point Research — RCE and API Token Exfiltration Through Claude Code Project Files (CVE-2025-59536, CVE-2026-21852): https://research.checkpoint.com/2026/rce-and-api-token-exfiltration-through-claude-code-project-files-cve-2025-59536/
- Tenable TRA-2026-27 — Claude Code Action Runner arbitrary code execution via malicious MCP server configuration: https://www.tenable.com/security/research/tra-2026-27
- OX Security — MCP Supply Chain Advisory: RCE Vulnerabilities Across the AI Ecosystem: https://www.ox.security/blog/mcp-supply-chain-advisory-rce-vulnerabilities-across-the-ai-ecosystem/
- CSO Online — Claude Code has an MCP security problem: https://www.csoonline.com/article/4181230/claude-code-has-an-mcp-security-problem-and-your-developers-are-already-using-it.html

**Invisible / encoded injection**
- Cisco — Understanding and Mitigating Unicode Tag Prompt Injection: https://blogs.cisco.com/ai/understanding-and-mitigating-unicode-tag-prompt-injection
- AWS Security Blog — Defending LLM applications against Unicode character smuggling: https://aws.amazon.com/blogs/security/defending-llm-applications-against-unicode-character-smuggling/
- Promptfoo — The Invisible Threat: Zero-Width Unicode Characters: https://www.promptfoo.dev/blog/invisible-unicode-threats/
- Promptfoo — ASCII Smuggling for LLMs: https://www.promptfoo.dev/docs/red-team/plugins/ascii-smuggling/

**Structurally analogous supply-chain incidents**
- ReversingLabs — Malicious pull request infects VS Code extension: https://www.reversinglabs.com/blog/malicious-pull-request-infects-vscode-extension
- SecurityOnline — VS Code Supply Chain Attack: 19 Extensions Used Typosquatting & Steganography: https://securityonline.info/vs-code-supply-chain-attack-19-extensions-used-typosquatting-steganography-to-deploy-rust-trojan/
- The Hacker News — VSCode Marketplace Removes Two Extensions Deploying Ransomware: https://thehackernews.com/2025/03/vscode-marketplace-removes-two.html
- Wiz — Supply Chain Risk in VSCode Extension Marketplaces: https://www.wiz.io/blog/supply-chain-risk-in-vscode-extension-marketplaces
- The Hacker News — Over 67,000 Fake npm Packages Flood Registry in Worm-Like Spam Attack: https://thehackernews.com/2025/11/over-46000-fake-npm-packages-flood.html
- BleepingComputer — Windows 10's package manager flooded with duplicate, malformed apps: https://www.bleepingcomputer.com/news/security/windows-10s-package-manager-flooded-with-duplicate-malformed-apps/

**Signal presentation / false assurance**
- Socket.dev FAQ (the `Safe` → `Undetected` change; capability detection): https://docs.socket.dev/docs/faq
- Socket.dev — Introducing "safe npm": https://socket.dev/blog/introducing-safe-npm
- OpenSSF Scorecard: https://scorecard.dev/ and https://github.com/ossf/scorecard
- Ry Walker — OpenSSF Scorecard research notes (score-vs-vulnerability correlation): https://rywalker.com/research/openssf-scorecard

**Ingestion-pipeline security**
- OWASP — SSRF Prevention in Node.js: https://owasp.org/www-community/pages/controls/SSRF_Prevention_in_Nodejs
- The Limitations of "Secure" SSRF Patches: Advanced Bypasses and Defense-in-Depth: https://windshock.github.io/en/post/2025-06-25-ssrf-defense/
- Snyk — Severe security vulnerability in Bower's zip archive extraction (Zip Slip): https://snyk.io/blog/severe-security-vulnerability-in-bowers-zip-archive-extraction/
- Sonar — Unzipping Dangers: OpenRefine Zip Slip Vulnerability: https://www.sonarsource.com/blog/openrefine-zip-slip/
- Medium/intrinsic — Protecting Node.js Applications from Zip Slip: https://medium.com/intrinsic-blog/protecting-node-js-applications-from-zip-slip-b24a37811c10
- GitHub Advisory GHSA-xxvw-45rp-3mj2 — Deserialization Code Execution in js-yaml: https://github.com/advisories/GHSA-xxvw-45rp-3mj2
- HackTricks — Python YAML Deserialization: https://hacktricks.wiki/en/pentesting-web/deserialization/python-yaml-deserialization.html
- HackerOne — Secure Markdown Rendering in React: Balancing Flexibility and Safety: https://www.hackerone.com/blog/secure-markdown-rendering-react-balancing-flexibility-and-safety
- Strapi — Secure Markdown Rendering in React with react-markdown: https://strapi.io/blog/react-markdown-complete-guide-security-styling
- mdx-js Discussion #2613 — Security Concerns When Rendering MDX/Markdown Content: https://github.com/orgs/mdx-js/discussions/2613

**Operations, legal, licensing**
- GitHub Docs — Rate limits for the REST API: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
- GitHub Docs — Acceptable Use Policies: https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies
- GitHub Docs — Terms of Service (incl. Section H, API Terms): https://docs.github.com/en/site-policy/github-terms/github-terms-of-service
- Jamie Magee — Making the most of GitHub rate limits (ETags / conditional requests): https://jamiemagee.co.uk/blog/making-the-most-of-github-rate-limits/
- licensee issue #395 — MIT License not detected: https://github.com/licensee/licensee/issues/395
- ACM TOSEM — Open Source License Inconsistencies on GitHub: https://dl.acm.org/doi/10.1145/3571852
- Model Context Protocol — The MCP Registry (namespace verification, moderation policy): https://modelcontextprotocol.io/registry/about
- Model Context Protocol — Security Best Practices: https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices

---
*Pitfalls research for: open registry of untrusted third-party AI agent extensions*
*Researched: 2026-08-10*
