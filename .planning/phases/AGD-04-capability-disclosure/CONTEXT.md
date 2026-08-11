# Phase 4 Context — Capability Disclosure

There was no `/gsd-discuss-phase` for this phase; the maintainer chose to plan from
`04-RESEARCH.md`, `04-PATTERNS.md` and `REQUIREMENTS.md` directly, the same way Phase 3 was
planned. Every decision below is therefore the planner's, made explicitly rather than
inherited, and each one names the mechanism that forced it. Where a decision contradicts
`04-RESEARCH.md` or the maintainer's own taxonomy, that is called out in its own table.

Seven things were measured while planning, at **zero GitHub cost**, against the four frozen
corpora already on disk (`fixtures/*/tree.json` — 3,831 entries; `fixtures/*/files/*` — 84
captured bodies, 19,909 lines). One of those measurements — M4 — **fires the ROADMAP's kill
switch during planning**, before a line of code exists. The measurements are reproduced in
full below because four plans depend on them.

## Scope

Answer "what will this artifact do to my machine" from the artifact's own bytes, with a
source line for every claim, and never answer "is it safe". One new `src/analyze/`
directory of pure functions, one new findings table, one new jsonb column for the file
inventory, two new panels, and one new CI rule.

Not in this phase: search integration, corpus acquisition, seed fan-out, compatibility,
registry sync, freshness.

## Measurement 1 — the executable bit is already in hand and thrown away

Every `mode` value across the four frozen `tree.json` files:

| corpus | entries | `040000` tree | `100644` file | `100755` exec | `120000` symlink |
|---|---|---|---|---|---|
| `addyosmani-agent-skills` | 261 | 77 | 176 | 7 | 1 |
| `anthropics-skills` | 501 | 90 | 385 | 26 | 0 |
| `baoyu-skills` | 1,077 | 157 | 910 | 10 | 0 |
| `wshobson-agents` | 1,992 | 832 | 1,152 | 7 | 1 |
| **total** | **3,831** | 1,156 | 2,623 | **50** | **2** |

`mode` is present on **every** entry of every captured response — the exact response
`fetchRepoTree` already issues. `src/github/tree.ts:43-50` maps `path`, `type`, `sha`,
`size` and drops it. CAP-01 therefore costs **zero new GitHub requests**; it is a mapper
fix plus two type edits.

**Both** `TreeEntry` declarations must change in the same task. `src/github/types.ts:1-6`
has `type: 'blob'|'tree'|'commit'`; `src/detect/types.ts:1` has a structurally looser
`type: string`. Because the detect one is wider, TypeScript accepts the github one where
the detect one is expected and **silently drops `mode`** with no error. A task that edits
one and not the other produces an inventory in which every file reads as non-executable and
no test that uses hand-built entries can see it.

`120000` is a symlink and is not a regular file. It is inventoried as type `symlink` and
never as executable; a symlink's `mode` is `120000`, not `100755`, so the `=== '100755'`
rule already gets this right and the fixture proves it.

## Measurement 2 — how big a file inventory actually is

Applying the skill detector's own path rule to the four trees yields 244 `SKILL.md` paths
(more than the 84 captured bodies, because `CAPS.maxFiles` bounded the capture, not the
tree). For each, the blobs under its directory prefix:

| statistic | value |
|---|---|
| artifacts | 244 |
| artifacts holding more than the manifest itself | 186 (76%) |
| artifacts holding at least one `100755` entry | 14 (5.7%) |
| inventory size — median | 2 |
| inventory size — p90 | 9 |
| inventory size — max | **83** (`anthropics-skills`, `skills/canvas-design/`) |
| artifacts over 20 files | 15 |
| artifacts over 50 files | 5 |

Two consequences: the inventory is small enough to store inline as jsonb rather than as a
child table (Assumption A4 resolved — 83 entries is not a table), and the cap on it is
`200`, which is 2.4× the largest real case.

## Measurement 3 — line and body geometry, which sets every CAP-14 number

Over the 84 captured bodies, 19,909 lines:

| statistic | value |
|---|---|
| line length — median | 27 chars |
| line length — p99 | 377 chars |
| line length — max | 1,352 chars (`anthropics-skills skills/claude-api/SKILL.md:196`) |
| lines over 500 chars | 85 (0.4%) |
| **lines over 2,000 chars** | **0** |
| body size — median | 9,748 chars |
| body size — max | 72,088 chars |
| **bodies over `MAX_BODY` (32,768)** | **2 of 84 (2.4%)** |
| max hits for one detector in one file (install) | 7 |
| max hits for one detector in one file (bare URL) | 7 |

So: `maxLineChars = 2000` skips nothing in the real corpus and exists only for hostile
input. `maxFindingsPerDetector = 50` is 7× the measured worst case. And **2.4% of real
bodies are already truncated at 32 KB today** — a number the CAP-09 block states rather
than a hypothetical.

## Measurement 4 — the kill switch fires during planning, on HTML comments

`04-RESEARCH.md` §Q7 proposes `<!--[\s\S]*?-->` as the HTML-comment class of CAP-06's
hidden-content detector, citing `SkillBody.test.tsx:52-56` as proof that the render pipeline
drops comment text entirely. That proof is real, and the pattern built on it is still wrong.

Two counts, both taken this session:

1. A bare `<!--...-->` scan over the 84 real bodies finds **26 comments in 6 files**.
2. Rendering each of those 6 bodies through **the actual `SkillBody` component**
   (`renderToStaticMarkup`, the same harness `SkillBody.test.tsx:20-22` uses) and searching
   the output for each comment's own inner text finds that text present **26 times out of
   26**. Twenty-five sit inside fenced code blocks; the twenty-sixth
   (`anthropics-skills skills/pptx/SKILL.md:15`) sits inside an inline-code span in a table
   cell. **Zero of the 26 are hidden from a reader.**

The claim a hidden-content finding makes is *"this content is in the file and the page does
not show it."* Measured against the only rule that can settle that claim — does the text
appear in the render — the naive pattern's false-positive rate is **26/26 = 100%**, five
times the ROADMAP's 20% kill line.

**Binding: the naive HTML-comment pattern is deleted, not tuned.** It never ships.

What ships in its place is **not a tuned version of it**. It is a different detector making
a different claim: *an HTML comment that is outside a fenced code block and outside an
inline-code span*. The distinction is mechanical rather than statistical — a fence and a
code span change whether the Markdown renderer parses the text as markup at all, and that
is precisely what decides whether the reader sees it. The tuning the ROADMAP forbids is
moving a threshold until a bad pattern passes; this is discarding a mis-specified pattern
and specifying the claim correctly. **The replacement gets its own measurement row and dies
by the same rule if it fails it.** Measured now: **0 hits in 84 real bodies**, so it ships
with precision untested-on-real-data and validated only by
`fixtures/xss/html-comment.md` — recorded honestly, exactly as the remote-execution
detector is.

**Fence-awareness applies to the HTML-comment class only, and to no other detector.** A
zero-width character inside a fence is still invisible, so the codepoint classes ignore
fences. A `curl … | sh` inside a fence is still a directive the reader is meant to run, so
the capability detectors ignore fences too — `04-RESEARCH.md` §Q6 is right about that and
this decision does not weaken it. What the fence changes is whether *markup* is parsed, and
only one class of hidden content is markup.

## Measurement 5 — the capability detectors, confirmed and bounded

Over the same 84 bodies:

| pattern | hits | note |
|---|---|---|
| install shape (`npm install\|npm i\|npx\|pip install\|pip3 install\|uvx\|brew install\|uv add\|uv pip install\|bunx`) | 78 | `04-RESEARCH.md` §Q5 hand-checked the first 20: **5% FP**. Survives. |
| remote-execution shape (`curl/wget/iwr … \| sh/bash/iex`, `&& bash`) | **0** | Never fires on real data. Ships un-tuned, precision unproven — not proven-clean. |
| bare `http(s)://` on a line | 65 | of which **1** is an `xmlns=` namespace URI (`baoyu-diagram/SKILL.md:214`) — the one named false-positive class |
| bare URL with a fetch verb on the same line | 6 | the `network_request` subset under a strict same-line rule; §Q4's looser sentence rule counted ~15 |
| hidden-styled HTML (`display:none`, `font-size:0`, `visibility:hidden`) | **0** | — |
| bare `hidden` attribute | 1 | and it is a legitimate ARIA `tabpanel` example, not concealment |
| zero-width / bidi / Unicode-tag / soft-hyphen codepoints | **0** | present only in `fixtures/adversarial/bidi.md` |
| `allowed-tools` | **0** | confirms the orchestrator's finding — see "Anti-goals" |

Two things fall out. **The hidden-styled-HTML rule is not worth a detector**: one hit in
84 files and it is an accessibility example, so the rule would ship with a 100% measured FP
rate and no true positive anywhere. It is dropped, and CAP-06's "hidden-styled text" clause
is recorded as unimplemented with this measurement as the reason. And **`network_request`
cannot reach 20 hits in this corpus at all**, so its precision record says "all 6 hits
hand-checked, fewer than 20 exist" rather than pretending to a 20-sample rate.

## Measurement 6 — the corpus cannot validate the declared-capability path

`allowed-tools` appears **zero times** in all 84 real bodies. CAP-02 is the one requirement
in this phase with **no real-world instance to test against**. It still ships — the field is
in the specification, `skill.ts:31-35`'s `toolTokens()` already normalizes it, and
`fixtures/adversarial/tools-list.md` already exercises it — but its test comes from a
hand-written fixture and **no plan may claim corpus validation for it**. The honest
consequence for the UI is that "not declared" is the common path, not the edge case, exactly
as `page.tsx:80-83` already records for `licenseSpdx`.

## Measurement 7 — the vocabulary lint fails on the project's own honest sentence

`src/app/r/[owner]/[repo]/[...path]/page.tsx:155-156` already ships this JSX text:

> AgentDock reads this file; it does not run it, and it cannot say whether it is safe.

That sentence is the shipped, correct, CAP-09-shaped disclaimer. A CAP-10 lint that bans the
word in UI string literals — which is exactly what `04-RESEARCH.md` §Q13 specifies — **fails
CI on the first run, against copy the requirement wants kept**. §Q13 did not catch this.

The resolution is not to weaken the pattern into a negation-detector, which would be an
unbounded English-grammar problem. It is an explicit `SANCTIONED` list of exact substrings,
excised from the text before the banned-word scan runs, each entry carrying the reason it is
sanctioned. That list is the product's own ledger of every place it is allowed to say the
word, it is short, and adding to it is a visible diff a reviewer sees. See "Binding
decisions", item 8.

## Resolved open questions

1. **`packageVersion.files` or reused `meta`?** (`04-RESEARCH.md` Open Question 1.) **Neither.**
   The inventory goes on `package`, the mutable row — see Binding decisions item 3. The
   research framed the choice as "which jsonb home on the version row"; the question it did
   not ask is whether the version row is the right lifetime at all, and measured against how
   a version is minted, it is not.

2. **Does any requirement pull `catalog` into capability scope?** No. `04-RESEARCH.md` §Q14
   checked CAP-01…CAP-14 and none names a catalog or `marketplace.json`, and DET-03 means a
   well-formed catalog produces no package row to hang findings on. The one asymmetry
   already recorded in `03-CONTEXT.md` — a *malformed* catalog does produce a
   `type: 'catalog'`, `parse_status: 'failed'` row with a raw truncated body — is handled by
   doing nothing special: the analyzers run over whatever `body` exists and produce whatever
   they find in that JSON text, which is honest. **No `supports(type)` hook, no branch.**

3. **Is a `Bash(*)` grant one finding, three, or none?** One: itself, verbatim, in the
   declared channel. Accepted from `04-RESEARCH.md` §Q3 unchanged, and the mechanical
   argument is its own: decomposing a coarse grant converts an observed fact about the file
   into an inferred judgment about behaviour, which is the exact move CAP-11/CAP-12 forbid.
   The observed-capability detectors answer network/install/shell on their own evidence or
   not at all, and the two channels never inform each other.

4. **What does Phase 2's idempotency imply for findings?** More than "no duplicates". Because
   `package_version`'s insert is `onConflictDoNothing` on `(package_id, content_hash)`, an
   unchanged re-ingest returns **no row and no id** — so findings cannot be written on that
   path even if someone wanted to. Gating on `inserted.length > 0` is therefore not a
   performance choice, it is the only place a `package_version.id` exists. The consequence
   the research did not draw: **every `package_version` row that already exists when this
   phase ships can never acquire findings through the ingest path**, because re-ingesting
   unchanged content creates no version row at all. See Binding decisions items 4 and 9.

5. **Is stored-source re-analysis lossy?** Declared: no — `frontmatter` is stored whole under
   a 256 KB cap and the largest real block is ~1.2 KB. Observed: yes, bounded by the same
   32 KB excerpt, and M3 says that bites 2.4% of real bodies today. Not fixable here:
   fixing it means storing full bodies, which contradicts PRV-07.

## Binding decisions

**1. `src/analyze/` is a sibling of `src/detect/`, and the `Detector` interface is not
reused, extended, or subclassed.**

A detector's `match()` answers "what kind of file is this?" from **paths only** and never
sees content. An analyzer answers "what signals are in this content?" and sees nothing but
content. They share a motive (bounded, pure, capped, individually testable) and no
mechanism: an analyzer has no `needs`, no two-phase fetch contract, no candidate, and
produces 0..N outputs rather than at most one.

The type is `type Analyzer = (input: AnalyzeInput) => Finding[]` and nothing larger. What
**is** copied verbatim from Phase 3 is the two properties that made DET-07 and DET-09 real:
`src/detect/run.ts`'s guarded pass, and its habit of taking the list as a parameter rather
than importing the registry — which is what lets the CAP-13 measurement swap in a candidate
pattern without touching the shipped set.

Purity is proven by arity, the way `run.test.ts:224` already proves it for detectors: a
one-parameter pure function cannot reach a database. The analyzer suite asserts it.

**2. Isolation matters more here than it did in Phase 3, because analysis runs inside the
persist transaction.** An unguarded analyzer throw does not lose a finding — it rolls back
the `package_version` insert, the `package` upsert and the job's terminal state. So every
analyzer call is wrapped, one analyzer's throw costs only its own findings, and the failure
is counted into the ingest log line rather than swallowed. **Raw source, evidence text, and
anything credential-shaped never enter that error string** — the recorded value is the
analyzer id and the exception message only, and the plan's test asserts the recorded string
does not contain the body.

**3. The file inventory lives on `package`, not on `package_version`. Findings live on
`package_version`, never on `package`.** These point in opposite directions on purpose.

A version is minted by `contentHash` over the manifest's own bytes. Add `scripts/steal.sh`
next to an unchanged `SKILL.md` and the content hash does not move, no version row is
created, and an inventory stored on the version would be **permanently stale about the exact
thing CAP-03 exists to disclose**. The inventory's real lifetime is the scan: it is derived
from the tree, it is refreshed by the `package` upsert that already runs on every scan, and
the page already displays "Last read by AgentDock" as its provenance. Findings, by contrast,
are derived from the stored body and are meaningless outside the version whose bytes
produced them.

This does not contradict the maintainer's "findings attach to the immutable
`package_version`" directive: the file inventory is an inventory, not a finding. No finding
row is ever keyed on `package.id`.

Stated cost: on a commit where the tree moved but the manifest did not, the Files table
refreshes and the findings do not. That is each thing behaving according to what it is
derived from, and the page labels both.

**4. `package_version.analyzed_at` exists, and "not detected" is forbidden while it is
null.** An artifact with zero findings and an artifact nobody analyzed are indistinguishable
by row count, and CAP-11 is the requirement that they must not read the same. Without this
column every `package_version` row created in Phases 1–3 — the entire existing corpus —
would render as "not detected", which is precisely the assurance CAP-11 forbids. One
nullable timestamp, set by the same code path that writes the findings, and one branch in
the panel: `not analyzed` when null, `not detected` when non-null and empty.

**5. `capability_finding` carries the maintainer's field set, including `commit_sha`, and
the redundancy is deliberate and asserted.** `commit_sha` is derivable from the row's own
`package_version`, so it buys no query. It is kept because the maintainer's directive names
it and because it makes a finding row self-describing in the CAP-13 audit trail, where rows
are read outside their join. The cost of a denormalized column is that it can disagree with
its source, so **a test asserts every finding's `commit_sha` equals its version's.**
`source_path` is *not* redundant — a `bundled_script`-adjacent or multi-file finding names a
path that is not the artifact's own `source_path`.

No `capability_category` dimension table, and no reference data of any kind in this phase's
migration. `category`, `detector_id` and `signal` are `text` with comments, for the reason
`repo_seed.source_kind` already records: widening a constrained type on a populated table is
a `DROP`, which the boundary scanner treats as destructive. **This also keeps
`scripts/migrate.mjs` out of the phase entirely** — `03-PATTERNS.md`'s Trap 1 fires only on
a hand-added `INSERT`, and there is none. Any plan that reaches for a dimension table has
bought that trap for nothing.

**6. Seven categories ship. Two of the maintainer's starting taxonomy do not, and the
measurement is the reason.**

| shipped category | detector | source |
|---|---|---|
| `declared` | `allowed-tools` tokens; per-type `meta.servers[].command`, `meta.handlers[].command` | frontmatter / detector `meta`, structured, no line number |
| `remote_execution` | `curl/wget/iwr … \| sh/bash/iex` | body scan |
| `package_install` | the measured install shape | body scan |
| `network_request` | a URL with a fetch verb or as a command argument | body scan |
| `external_reference` | a URL with neither, `xmlns` context excluded | body scan |
| `hidden_content` | codepoint classes; fence-aware HTML comment | body scan |
| *(inventory, not a finding)* | file inventory + bundled-script derivation | tree slice |

- **`credentials` is not shipped.** `04-RESEARCH.md` §Q5 piloted it: 27 hits for
  `.env` / `ANTHROPIC_API_KEY` / `~/.ssh/id_`, and **every one** is defensive prose —
  gitignore hygiene, credential-resolution documentation, a skill's own config template.
  Scored against the claim "this line represents the artifact reading a credential", the
  rate is near 100%. It dies by the kill rule before it ships. The maintainer's directive
  ("detect the ACT, never the value") is right and unreachable: the corpus shows no bounded
  pattern separates the act from prose about the act.
- **`filesystem` is not shipped.** No pattern was proposed and none was measured, and a path
  mentioned in prose is not a filesystem action — the same failure mode as `credentials`,
  with no pilot to redeem it. Shipping an unmeasured detector is the one thing CAP-13
  forbids by name.
- **`shell` is narrowed to `remote_execution`.** The maintainer's own directive settles it:
  the presence of the words bash/shell/exec is not a finding. What is left after removing
  prose about shells is the remote-execution shape, and that is what ships under its own
  name so the category label cannot over-claim.

Because `credentials` never ships, the maintainer's "never store a secret VALUE" rule is
enforced structurally rather than by masking: **no analyzer extracts a credential-shaped
token at all**, and the generic evidence cap plus HTML escaping covers the residual case
where a secret happens to sit on a line another detector matched.

**7. Every finding is capped, escaped, and rendered as a JSX text node — never through a
Markdown renderer, and never through `SkillBody`.** `evidence_text` is capped at 200
characters of the matched line, single-line, and React's default JSX escaping is the only
sanitizer involved because nothing is parsed as markup. `check-boundaries.mjs`'s existing
`no-raw-html` rule already fails CI if either new panel reaches for
`dangerouslySetInnerHTML` or `rehype-raw`, so no new enforcement is needed for this.

**`src/components/SkillBody.tsx` is not modified, and neither are its two hidden-content
assertions.** `04-PATTERNS.md` concludes the new panel is purely additive, and the mechanism
holds under inspection: raw bytes are retained losslessly at the *storage* sink
(`skill.ts:124`, `body: source.slice(0, MAX_BODY)`), and the comment is dropped only at the
*render* sink. Detection reads storage. The two paths never meet. What changes is that
`SkillBody.test.tsx:52-56` (comment text absent) and `:92-95` (U+202E survives) now carry a
second load: together they are the proof that the Hidden Content panel is the **only** place
a user can see this content. A plan that edits either assertion has reopened Pitfall 3 by
definition. A comment is added naming that; nothing else about the file moves.

**8. The vocabulary lint bans words in UI string literals, and ships with an explicit
`SANCTIONED` list, because M7 shows the naive rule fails on shipped correct copy.**

Scope is `src/app/**` and `src/components/**` only, expressed as its own exported
scope function so an over-narrow scope is testable — a lint that passes by inspecting
nothing is the failure mode `check-boundaries.mjs`'s own `sourceFiles` docstring already
warns about. Backend comments, detector rationale and test descriptions are out of scope
because CAP-10 is about copy shown to a user.

Words: `safe`, `clean`, `verified`, `trusted`, `approved`, `malicious`, `grade`, and the
phrase `risk score`. Anchored as `(?<![a-z])word\b`, case-insensitive, which exempts
`unverified`, `unsafe` and `cleanup` **by construction rather than by special case** —
§Q13's worry about needing an exception for `unverified` is answered by the lookbehind. The
`SANCTIONED` substrings are excised from the text before the scan, so the check is exact and
needs no grammar.

Accepted ceiling, stated rather than discovered: a dynamically constructed string
(`'ver' + 'ified'`) walks past a static lint. `check-boundaries.mjs` already accepts that
limit for its other five rules, and this copy is the project's own, reviewed in every diff,
not attacker-controlled.

**9. `analyzePackageVersion(packageVersionId)` and a backfill script both ship in this
phase, and the reason is that the phase cannot otherwise be verified.**

The maintainer allows deferring a bulk re-analysis job. It cannot be deferred here, for a
mechanical reason: item 4's finding means **re-ingesting the existing corpus produces zero
new version rows and therefore zero findings**. Without a backfill, the only way to see a
single finding on a real page is to drop the database. The domain operation reads
`body` and `frontmatter` from storage (never GitHub), replaces that version's findings, and
sets `analyzed_at`; the script is a bounded loop over versions where `analyzed_at is null`.
That is also the mechanism a later detector-version bump uses.

**10. Line numbers get their own module and their own falsifiable test.** This codebase has
never computed one — `04-PATTERNS.md` reports zero hits for `split('\n')`, `lineNumber` or
`#L` anywhere in `src/` or `scripts/`. The rules, all from `04-RESEARCH.md` §Q6 and all
load-bearing:

- Split on `'\n'`, never `'\r\n'`, and strip a trailing `\r` before matching a line. A file
  in either line-ending style must yield the same number, and `fixtures/adversarial/crlf.md`
  already exists to prove it.
- 1-indexed, and **no frontmatter offset arithmetic**: the stored `body` is
  `source.slice(0, MAX_BODY)` over the *unmodified raw file*, fence included, so body line N
  is file line N on GitHub. Adding an offset would break every permalink.
- A leading BOM survives into `body` (`frontmatter.ts:23` strips it into a local only). It
  is zero-width and consumes no line, so numbering is unaffected — but the hidden-content
  scanner must not report a **leading** U+FEFF as a finding, because at offset 0 it is a byte
  order mark, not concealment. `fixtures/adversarial/bom.md` is the negative case.
- Truncation removes trailing content and never shifts a surviving line, so CAP-08's promise
  holds for every finding that exists and makes no claim about coverage. M3 puts the real
  cost at 2.4% of bodies.

The falsifiable test is not "the permalink returns 200" — GitHub ignores an out-of-range
`#L` fragment, so a wrong number returns 200 too. It is: **the line the finding names, read
back out of `package_version.body`, contains the text the finding claims to have matched.**

**11. `ANALYZE_CAPS`, with every number carrying its measurement.** Following
`JSON_CAPS`/`FRONTMATTER_CAPS`/`HOOK_CAPS`: one exported `as const`, one JSDoc block per
number, each naming what it does *not* cover.

| cap | value | measurement (M2/M3) |
|---|---|---|
| `maxBodyChars` | 32,768 | equals `MAX_BODY`; asserted as defense-in-depth against a future uncapped caller, not as the primary control |
| `maxLineChars` | 2,000 | longest real line is 1,352; **zero** of 19,909 lines exceed the cap. Skips are counted, never silent. |
| `maxFindingsPerDetector` | 50 | largest single-detector-in-one-file count measured is 7 |
| `maxEvidenceChars` | 200 | median line is 27 chars; p99 is 377, so 200 keeps the common case whole and truncates the outlier visibly |
| `maxInventoryEntries` | 200 | largest real inventory is 83 (`skills/canvas-design/`) |

`maxLineChars` bounds per-line regex cost and does **not** bound total findings.
`maxFindingsPerDetector` bounds row volume and does **not** bound scan time. Both sentences
belong in the file, per the doctrine `json.ts:1-25` already sets.

CAP-14 is locked by a test, not by prose: a new `fixtures/adversarial/redos-*.md` built from
backtracking bait, asserted to complete under a generous wall-clock bound. The bound is a
smoke alarm for a super-linear regression, not a performance budget.

**12. Observability is aggregate counts only.** The ingest log line gains `findings`,
`detectorFailures` and `detectionDurationMs` and nothing else. No evidence text, no matched
line, no source excerpt, no credential-shaped token ever reaches a log.

## Deviations from `04-RESEARCH.md` and from the maintainer's taxonomy

| Source says | This phase does | Why |
|---|---|---|
| RESEARCH §Q7: ship `<!--[\s\S]*?-->` as the HTML-comment class | Delete it; ship a fence-and-code-span-aware rule instead, with its own precision row | M4 — 26/26 measured false positives against the real render |
| RESEARCH §Q7: detect hidden-styled HTML (`display:none`, `hidden`) | Not shipped; recorded as unimplemented | M5 — one hit in 84 files and it is an ARIA `tabpanel` example |
| RESEARCH §Q11 / Open Question 1: inventory on `packageVersion.files` | Inventory on `package.files` | A version is minted by manifest bytes; a sibling script changing mints nothing, so a version-scoped inventory is stale about exactly what CAP-03 discloses |
| RESEARCH §Q13: ban the words in UI literals | Same, plus a `SANCTIONED` exact-substring list | M7 — the shipped `page.tsx:155-156` disclaimer trips the naive rule on its first run |
| RESEARCH §Q13: `unverified` needs an explicit exemption | No exemption needed | `(?<![a-z])verified\b` exempts it by construction |
| RESEARCH §Q10: a bulk re-analysis job may be deferred | Ships in 04-04 | Item 9 — without it the phase's own findings are unobservable on the existing corpus |
| RESEARCH Test Map: `bundled_script` is a finding category | An inventory on `package`, with scripts derived at render | One source of truth; CAP-01 needs the whole inventory anyway, so storing scripts a second time as rows is duplication |
| Maintainer taxonomy starts from `shell`, `filesystem`, `credentials` | `shell` → `remote_execution`; `filesystem` and `credentials` not shipped | Measurement — §Q5's credential pilot is near-100% FP, `filesystem` has no measured pattern, and the maintainer's own "the word bash is not a finding" rule leaves only the remote-execution shape |
| Maintainer: a finding carries `commit_sha` | Kept, with an equality test against its version | It buys no query, so the only defence against drift is an assertion; the directive is honoured and its cost is paid |

## Anti-goals — state these so execution does not drift

- **No risk score, no aggregate grade, no safety verdict, ever.** No summing findings into a
  number, no letter, no colour scale, no badge. None of *safe*, *clean*, *verified*,
  *trusted*, *approved*, *malicious* as a verdict on an artifact. Project-wide, permanent,
  and from this phase onward mechanically enforced.
- **No execution of artifact content.** No `eval`, no `Function()`, no `child_process`, no
  `node:vm`, no dynamic import of repository files, no package-manager invocation.
  `check:boundaries` rule 5 enforces it and must keep passing.
- **No search integration.** Findings and categories do not enter ranking or filtering. Phase
  6 (DIS-06) consumes the `category` column this phase creates; building the filter now is
  out of scope.
- **No corpus acquisition.** The four frozen corpora plus `fixtures/adversarial/` and
  `fixtures/xss/` are the entire dataset. Phase 5 owns bulk acquisition. **Nothing is added
  under `fixtures/<slug>/files/`** — `skill.test.ts`'s measured `COUNTS` table iterates those
  directories, so a new file there breaks a passing suite for an unrelated reason. New
  fixtures go in the flat `fixtures/adversarial/`.
- **No detector framework.** No base class, no registration DSL, no dynamic loading, no
  factory, no `supports(type)` hook. One file per concern, one array of pure functions.
- **No whole-document evidence.** Every `summary` and `evidence_text` is capped and escaped.
- **No warning dashboard.** No red gauges, no shield icons, no threat meters, no badges.
  Counts per category and source-backed findings, in the same visual register as the
  existing `dl.facts` block.
- **No UI beyond the artifact detail page.** The listing, the repository page and the job
  page are untouched.
- **The catalog stays out of capability scope** — verified against CAP-01…CAP-14, which name
  it nowhere.

## Hard constraints (unchanged from Phases 0–3, restated because they bind every task)

- **Never execute repository content**, per the anti-goal above.
- **Safe scanning only.** Bounded, non-backtracking, anchored patterns; no nested unbounded
  quantifiers. Cap before the expensive operation, never after — slice a line to
  `maxLineChars` *before* `regex.exec`, the way `frontmatter.ts:48-51` caps bytes before
  parse. Where a line scanner or a character walk is safer than a regex, use it and say why.
- **Migrations touch `agentdock` only.** Additive DDL, no `DROP`, no `REVOKE`, nothing in
  `public` or `didim_mcp`. `bun run db:generate` → hand-review → `bun run db:migrate` →
  `bun run db:test:setup`. Never `drizzle-kit push`/`pull`/`migrate`. **This phase adds no
  reference data, so `scripts/migrate.mjs` must not change** — if a task finds itself editing
  it, a dimension table has crept in and Binding decision 5 says remove it.
- **No new stateful services. PostgreSQL only. No new runtime dependencies** — the research
  confirmed none is needed, and every mechanism here is native `RegExp`, native string
  iteration, and the already-installed `drizzle-orm`.
- **All Phase 0–3 invariants hold:** non-superuser `agentdock_app` and `agentdock` schema
  isolation; commit-SHA-pinned provenance and no artifact execution; previous-good-state
  preservation, bounded retry, idempotency, truncated-scan-no-delist, PostgreSQL-only jobs;
  per-candidate detector isolation, multi-artifact detection, malformed-artifact isolation,
  catalog→seed semantics.
- **GitHub budget: ~60 core requests/hour, unauthenticated.** This phase adds **zero**
  GitHub requests: `mode` rides on a response already fetched, and re-analysis reads storage.
- **`bun run test`, never raw `bun test`** (Bun's runner hangs on this project's vitest
  suite). Full gate is `bun run ci`. Final order: `bun install --frozen-lockfile` →
  `bun run build` → `bun run ci` → `bun run db:migrate`.
- **No `git commit`, no `git push`, no `git add`.** The executor must not touch git state.
  Each task is still an atomic unit of work with its own verification, but the phase ends
  with a recommended commit message and nothing staged. This deliberately overrides GSD's
  default atomic-commit behaviour and is restated in every plan.

## Known ceilings carried out of this phase

- **Only `skill`-typed artifacts have a detail page at all.**
  `packages.ts:84-90`'s `sourcePathFromUrl` appends `SKILL.md` unconditionally, so
  `detailHref` on a command, plugin, MCP or hook row produces a URL that resolves to
  nothing. That is a Phase 3 leftover (Phase 3's anti-goals excluded all UI work), not a
  Phase 4 regression, and it is **not fixed here** — routing five artifact types is UI scope
  this phase did not budget and CAP-01…CAP-14 do not require. The consequence to state
  plainly: **the disclosure panel is reachable only for skills**, which is where 244 of the
  corpus's artifacts and every measured signal live. Carried to Phase 6, which owns browse.
- **Recall is unmeasured and unmeasurable from this corpus.** Every rate in this document is
  precision on a benign sample. No confirmed-malicious artifact exists on disk, so nothing
  here says what the detectors would catch. The CAP-09 block says so.
- **`network_request` shipped on fewer than 20 hits.** Six exist in the whole corpus. All six
  are hand-checked; the rate is honest and the sample is small.

## Plan split, and why it differs from the ROADMAP lines

The plan **count stays at four**; the contents move, and `ROADMAP.md` is updated to match.
The ROADMAP's four lines are four horizontal layers — corpus, detectors, hidden content, UI
— which would mean nothing is visible end to end until the fourth plan lands. The three
mechanical reasons the contents move:

| ROADMAP said | Now | Why it moved |
|---|---|---|
| 04-01: labeled fixture corpus and the file inventory | 04-01: the `mode` fix, then a **tracer** — one detector from tree to rendered line-anchored permalink — then the inventory | There is no corpus to build (the four frozen corpora are the labelled sample, and acquiring more is an anti-goal). What 04-01 actually owed was the persistence and line-number machinery every later plan sits on, and proving it on one signal costs one plan instead of discovering it wrong in three. |
| 04-02: the six MVP detectors with bounded patterns and input caps | 04-02: the remaining detectors, the CAP-14 lock, **and the executed CAP-13 measurement** | The measurement had no home in the ROADMAP split. It cannot live in 04-01 (only one detector exists) and it cannot live in 04-04 (a detector that fails must be deleted before the UI is built around it). |
| 04-03: hidden-content detection with visible sentinels | 04-03: unchanged in intent, reduced in content | M4 deleted one of its two classes before planning finished and M5 deleted a second. What is left is the codepoint classes and a fence-aware comment rule. |
| 04-04: disclosure panel, permalinks, "not checked", vocabulary lint | 04-04: the full panel, the "not checked" block, the lint **with its sanctioned list**, and the re-analysis backfill | Permalinks moved into 04-01's tracer, because a finding with no resolvable line is not a tracer. The backfill moved in because without it the phase's own output is invisible on the existing corpus. |

Four waves, sequential. Every plan writes to `src/analyze/`, to the detail page, or to
both, and the ordering is mechanical anyway: 04-02's measurement needs every detector
registered, 04-03 appends a row to the precision record 04-02 creates, and 04-04's lint
needs the final copy that 04-03 and 04-04 write.

## What would falsify this phase

- Any page displays a number, letter, colour or badge derived from summing or grading
  findings.
- A page renders "not detected" for a `package_version` whose `analyzed_at` is null.
- `bun run check:boundaries` passes after a hardcoded verdict word is added to a component's
  JSX text — or fails on `src/app/r/[owner]/[repo]/[...path]/page.tsx` as it stands today.
- An HTML comment inside a fenced code block produces a `hidden_content` finding.
  (Measurement 4 regressed; the killed pattern came back.)
- Re-ingesting an unchanged repository grows the `capability_finding` row count.
- A finding's line number, used to index `package_version.body`, lands on a line that does
  not contain the text the finding names — in any of the LF, CRLF and BOM fixtures.
- A shipped detector has no row in `fixtures/capability-precision.md`, or a row whose
  recorded rate is at or above 20%.
- `src/components/SkillBody.tsx` changed, or either of its two hidden-content assertions
  changed.
- An analyzer that throws loses the package version, the repository, or another analyzer's
  findings — or its error string contains any of the body it was scanning.
- `scripts/migrate.mjs` changed. (A dimension table crept in.)
- The ingest log line carries evidence text, a matched line, or any source excerpt.
- `bun run ci` does not pass.
