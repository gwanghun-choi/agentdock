---
phase: AGD-04-capability-disclosure
plan: 04
type: execute
wave: 4
depends_on: ["04-03"]
files_modified:
  - src/components/CapabilityPanel.tsx
  - src/components/CapabilityPanel.test.tsx
  - src/analyze/run.ts
  - src/analyze/run.test.ts
  - src/app/r/[owner]/[repo]/[...path]/page.tsx
  - src/db/queries/capabilities.ts
  - src/ingest/reanalyze.ts
  - src/ingest/reanalyze.test.ts
  - scripts/analyze-backfill.mjs
  - scripts/check-boundaries.mjs
  - scripts/check-boundaries.test.ts
  - package.json
  - README.md
autonomous: true
requirements: [CAP-09, CAP-10, CAP-11, CAP-12, QUA-03]

estimate:
  tokens: 100000
  raw_tokens: 100000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "Declared capabilities and observed patterns appear in two separate sections and never in one list"
    - "An artifact with findings in no category reads as not detected, and one nobody analyzed reads as not analyzed"
    - "A detector that hit its cap says so on the page rather than showing a quietly short list"
    - "A permanently visible section states what AgentDock does not check, in the product definition's own words"
    - "No page shows a score, a grade, a letter, a colour scale or a total derived from summing findings"
    - "Adding a hardcoded verdict word to a component's text fails bun run check:boundaries"
    - "The existing detail-page sentence that says AgentDock cannot say whether a file is safe still passes the lint"
    - "unverified, unsafe and cleanup are not flagged, and no explicit exception was written for them"
    - "A package version stored before this phase can be analyzed from its stored bytes, with no GitHub request"
  artifacts:
    - path: "src/components/CapabilityPanel.tsx"
      provides: "The declared and observed sections, per-category counts on their own headings, honest absence, and escaped evidence — pure, renderable with no database"
      exports: ["CapabilityPanel"]
      min_lines: 90
    - path: "src/ingest/reanalyze.ts"
      provides: "analyzePackageVersion — re-runs the shipped analyzers over stored bytes, replaces that version's findings, sets analyzed_at, and never touches GitHub"
      exports: ["analyzePackageVersion", "unanalyzedVersionIds"]
      min_lines: 60
    - path: "scripts/analyze-backfill.mjs"
      provides: "A bounded loop over versions with a null analyzed_at, so the corpus stored in Phases 1-3 stops reading as unexamined"
      min_lines: 40
  key_links:
    - from: "scripts/check-boundaries.mjs"
      to: "src/app/**, src/components/**"
      via: "a sixth rule over UI string and JSX text literals, scoped by its own exported function so an over-narrow scope is testable"
      pattern: "no-verdict-vocabulary"
    - from: "src/ingest/reanalyze.ts"
      to: "src/analyze/index.ts"
      via: "the same registry the ingest path runs, over bytes read from package_version rather than from GitHub"
      pattern: "ANALYZERS"
    - from: "src/app/r/[owner]/[repo]/[...path]/page.tsx"
      to: "src/components/CapabilityPanel.tsx"
      via: "one section rendering both channels, reading analyzed_at to tell absence from ignorance"
      pattern: "CapabilityPanel"
---

<objective>
Turn stored findings into a page a developer can act on, put the limits of the
whole exercise permanently beside them, and make the product's central promise a
failing build rather than a paragraph.

Purpose: everything in the three plans before this one is invisible. What makes
this phase the reason the product exists is a page that says what an artifact
declares, what it references, what it installs, what it hides — and, in the same
breath and permanently, what none of that covers.

Two things in this plan are load-bearing beyond their size. The vocabulary lint
is the mechanism that stops CAP-10 decaying into a preference over the next
twenty commits, and planning found it fails on the project's own shipped
disclaimer unless it carries an explicit ledger of sanctioned uses. And the
backfill is what makes the phase observable at all: Phase 2's idempotency means
re-ingesting the existing corpus creates no version rows and therefore no
findings, so without it every artifact already in the database reads as
unexamined forever.

Output: `CapabilityPanel.tsx`, the "What AgentDock does not check" block,
`check-boundaries.mjs` rule six with its sanctioned list, `analyzePackageVersion`
with its backfill script, and the phase gate.

Honours the CONTEXT.md decisions that declared and observed never merge, that
`analyzed_at` forbids "not detected" while it is null, that the lint ships with a
`SANCTIONED` list because Measurement 7 says it must, and that the accepted
ceiling of a static lint is stated rather than engineered around.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/phases/AGD-04-capability-disclosure/CONTEXT.md
@.planning/phases/AGD-04-capability-disclosure/04-03-SUMMARY.md
@.planning/PROJECT.md
@.planning/REQUIREMENTS.md
@src/analyze/types.ts
@src/analyze/index.ts
@src/analyze/run.ts
@src/components/JobPanel.tsx
@src/components/HiddenContentPanel.tsx
@src/app/r/[owner]/[repo]/[...path]/page.tsx
@src/db/queries/capabilities.ts
@src/db/queries/packages.ts
@src/ingest/persist.ts
@scripts/check-boundaries.mjs
@scripts/check-boundaries.test.ts
@scripts/seed-fixture.mjs
</context>

<decisions_made_while_planning>

**1. The lint ships with a `SANCTIONED` list on its first commit, because
without one it fails on correct shipped copy.**

`page.tsx:155-156` already says *"AgentDock reads this file; it does not run it,
and it cannot say whether it is safe."* That sentence is the shipped, correct,
CAP-09-shaped disclaimer, and a rule banning the word in UI string literals fails
on it immediately. `04-RESEARCH.md` §Q13 specified the rule and did not catch
this.

The alternative — teaching the pattern to recognise negation — is an unbounded
English-grammar problem inside a regex, and it would pass *"this file is not
unsafe"* while failing something harmless. An exact-substring exclusion list is
bounded, is exact, and is the product's own ledger of every place it is allowed
to use the word. Adding to it is a visible diff a reviewer reads.

**2. Word anchoring makes the exceptions §Q13 worried about unnecessary.**

`(?<![a-z])word\b`, case-insensitive, exempts `unverified`, `unsafe` and
`cleanup` **by construction**. §Q13 recommended an explicit exemption for
`unverified`; none is written, because a rule with a special case invites a
second special case and this one needs neither.

**3. Per-category counts live on the section headings, not in a stat block.**

The maintainer asked for counts per category. A separate block of numbers is one
CSS change away from a dashboard, and a dashboard is where a grade eventually
appears. A heading reading "Observed in this file — 3 install directives, 1
outbound URL" carries the same information and cannot be mistaken for a score.
**No total, anywhere.** A total is a score with one term.

**4. A capped detector has to say so, and the cheapest honest way is one more
finding.**

`analyzeArtifact` already computes an overflow count, and that count dies in
memory at persist time. A list showing three of sixty install directives with no
indication is exactly the quiet lie CAP-11 forbids. Rather than a new column or a
new UI branch, an overflowing detector emits one additional finding in its own
category, with no line, whose summary names the number withheld. The panel
renders it without knowing it is special.

**5. `analyzePackageVersion` lives in `src/ingest/`, not in `src/analyze/`.**

`src/analyze/` is pure by design and its purity is proven structurally — a
one-parameter function cannot reach a database, the same proof
`run.test.ts:224` makes for detectors. A db-touching function in that directory
would break the proof for the whole folder. This plan also adds the assertion
that makes it permanent: no file under `src/analyze/` imports the database
client.

**6. The backfill script is not deferred, and the reason is mechanical.**

The maintainer allows deferring a bulk re-analysis job. It cannot be deferred
here: re-ingesting an unchanged repository produces no `package_version` row and
therefore no findings, so without a backfill the only way to see this phase's
output on the existing corpus is to drop the database. It is a bounded loop over
versions with a null `analyzed_at`, following `scripts/seed-fixture.mjs`'s
existing pattern of importing the real code path from a `.mjs` script.

**7. The CAP-09 block quotes the product definition and adds the four numbers
this phase measured.**

`REQUIREMENTS.md`'s product claim is the source of the wording, not a new draft.
What this phase adds to it are the bounds nobody knew before: the 32 KB excerpt
and the 2-in-84 truncation rate, the fact that precision was measured on a benign
sample and recall was not measured at all, and the fact that two shipped
detectors have never fired on real data. Short lines, no legalese.

</decisions_made_while_planning>

<reference>

## Reference A — `src/components/CapabilityPanel.tsx`

Pure, in `JobPanel.tsx`'s sense: it takes rows, holds nothing, reaches nothing,
and renders where there is neither a database nor a browser. Every value is a
JSX text node React escapes; nothing is parsed as markup and no sanitizer is
imported, because there is nothing to sanitize.

**Two sections, never one list.**

- **Declared by the author** — `category === 'declared'`. Each row is the token
  or command verbatim in a `<code>`, with no line link, because a multi-token
  frontmatter field has no single useful line.
- **Observed in the file text** — every `observed`-shaped category. Each row is
  the summary, the source path, and a link to `permalinkAtLine(...)`.

The distinction is the whole point. A `Bash(git:*)` grant is a fact about what
the author declared; a `curl` in prose is a fact about what the text says.
Merging them erases exactly the thing that makes the declared signal worth
trusting.

**Absence, in three states, and the third is the one that is easy to get wrong.**

| state | renders |
|---|---|
| `analyzedAt` is null | `not analyzed` |
| `analyzedAt` set, no findings in this section | `not detected` |
| `analyzedAt` set, findings present | the rows |

`page.tsx:78-86`'s `?? 'not declared'` / `?? 'not detected'` is the existing
precedent for the shape, including its comment acknowledging that the null path
is the common path rather than the edge case. For CAP-02 that is literally true:
`allowed-tools` appears zero times in 84 real bodies.

**Counts on the headings, and no total.** "Observed in the file text — 3 install
directives, 1 outbound URL". A separate stat block is a dashboard waiting to
happen; a summed number is a score with one term.

**Forbidden in this component, permanently:** any numeric total across
categories, any letter, any colour scale keyed to finding count, any icon
conveying severity, any badge. `dl.facts`'s existing register is the whole visual
vocabulary available.

## Reference B — the overflow finding

`analyzeArtifact` already computes an overflow per analyzer and drops it at
persist. Instead, when an analyzer exceeds `maxFindingsPerDetector`, the pass
appends one finding in that analyzer's own category with
`signal: 'cap'`, `startLine: null`, `evidenceText: null`, and a summary naming
the number withheld. The panel renders it as an ordinary row.

No new column, no new UI branch, and the honesty is stored rather than
recomputed. A list showing three of sixty with no indication is the quiet lie
CAP-11 exists to prevent.

## Reference C — the CAP-09 block

A permanently visible section on every detail page — not collapsed, not behind a
link, not conditional on findings existing. Its opening sentence is
`REQUIREMENTS.md`'s own product claim, near-verbatim, because the requirement is
that the page and the product definition say the same thing.

The list below it carries what this phase measured and nobody knew before:

- AgentDock reads files and does not run them.
- Bundled scripts are named, never opened. Nothing here says what one does.
- Only the first 32 KB of a file is read. Two of the eighty-four files in the
  reference sample are longer than that, and the rest of those two was never
  scanned.
- Patterns were checked against a sample of ordinary published artifacts to see
  how often they raise a false alarm. Nothing here measures how much they miss.
- Two of the checks have never matched anything in that sample, so they are
  unproven rather than proven quiet. *(Name which two, from 04-02's and 04-03's
  recorded rows.)*
- Re-checking an artifact later uses the same stored excerpt, so a check added
  in future cannot see what was never stored.
- AgentDock cannot tell you whether an artifact is safe.

Every line is a fact with a number or a mechanism behind it. No legalese, no
hedging verbs, and no sentence that could be read as reassurance.

`page.tsx:149-157`'s existing "File" paragraph is the short form of this block
and stays where it is; this is its long form and it goes above the body.

## Reference D — `check-boundaries.mjs` rule six

The existing `SOURCE_RULES` entries are `{ id, pattern, message }` with a comment
naming the requirement they enforce. This rule needs three things they do not
have, and each gets its own named export so it is testable:

**A narrower scope.** `sourceFiles('src')` is the whole tree; this rule covers
`src/app/**` and `src/components/**` only, because the banned words are
legitimate in backend comments, detector rationale and test names, and CAP-10 is
about copy shown to a user. Following `sourceFiles`'s own docstring — *"Exported
so the test-file exemption is checkable: it is the one part of this rule whose
failure would be silent"* — the scope filter is an exported function, because a
silently over-narrow scope is a lint that passes by inspecting nothing.

**A sanctioned list.** An exported array of exact substrings, each with a comment
saying why it is allowed, excised from the text before the scan. It ships
carrying the existing `page.tsx:155-156` sentence and whatever lines of the
CAP-09 block need it. This is the product's ledger of every place it says the
word.

**Boundary-aware matching.** After `stripJsComments` and after excising the
sanctioned substrings, match only where the word sits inside a quoted string or
JSX text — approximated by requiring a quote or angle-bracket boundary on either
side, per §Q13, rather than by adding a parser dependency for one rule.

Anchoring is `(?<![a-z])word\b`, case-insensitive, which exempts `unverified`,
`unsafe` and `cleanup` with no special case.

The rule's inspected-file count joins the "say what was inspected" line in
`main()`, so zero files inspected reads as zero rather than as a pass.

**Accepted ceiling, recorded in the rule's own comment:** a dynamically
constructed string walks past a static check. The existing five rules accept the
same limit, and this copy is the project's own, reviewed in every diff, not
attacker-controlled. Runtime enforcement would need data-flow analysis wildly
disproportionate to the risk.

`scripts/check-boundaries.test.ts:1-10` imports named exports from the `.mjs`
module and asserts on returned problem arrays; the new tests follow it exactly.
No `package.json` change is needed — `check:boundaries` is already the first step
of `ci`.

## Reference E — `src/ingest/reanalyze.ts` and the backfill

```ts
/**
 * Re-runs the shipped analyzers over one stored version's own bytes.
 *
 * Reads package_version.body and .frontmatter from the database and never
 * touches GitHub — which is the whole point: a detector rule change must be
 * replayable across the index without spending any of a 60-per-hour budget.
 *
 * Lossy, and the loss is permanent rather than a bug to fix here. body is a
 * 32 KB excerpt (PRV-07), so content past the cut was never stored anywhere and
 * a detector added later cannot retroactively see it. Two of the eighty-four
 * sampled real files are affected. Declared-capability re-analysis is NOT
 * lossy: frontmatter is stored whole.
 *
 * Replaces rather than appends: this version's findings are deleted and
 * rewritten in one transaction, so a rule change cannot leave a page showing
 * both the old finding and the new one.
 */
export async function analyzePackageVersion(packageVersionId: number): Promise<number>;
```

The file inventory is **not** recomputed here. It lives on `package` and is
derived from a tree this function does not have; re-analysis is over stored
bytes, and inventing an inventory from nothing would be worse than leaving the
one the last scan wrote.

`scripts/analyze-backfill.mjs` follows `scripts/seed-fixture.mjs`'s shape —
`await import('../src/...')` under bun — loops `unanalyzedVersionIds(limit)`,
prints a count, and closes the connection. One `--limit` argument with a default,
so a first run on a large index is bounded. Registered as
`"analyze:backfill"` in `package.json`. Not wired into `ci`: it needs a database
and CI has none.

## Reference F — the page, assembled

Final section order on the detail page:

1. the existing `dl.facts` block
2. the existing parse-notes and parse-failure blocks
3. **Files** (04-01) — path, size, type, executable bit, scripts labelled not analyzed
4. **Declared by the author** and **Observed in the file text** (this plan)
5. **Hidden content** (04-03), only when present
6. **What AgentDock does not check** (this plan), always
7. the existing Install block
8. the existing File block and `SkillBody`

`getPackageDetail` already gained `analyzedAt` and `files` in 04-01;
`getCapabilityFindings` is `cache()`-wrapped so the page and `generateMetadata`
make one query between them.

</reference>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Two channels, honest absence, and a cap that admits itself</name>
  <files>src/components/CapabilityPanel.tsx, src/components/CapabilityPanel.test.tsx, src/analyze/run.ts, src/analyze/run.test.ts, src/db/queries/capabilities.ts, src/app/r/[owner]/[repo]/[...path]/page.tsx</files>
  <behavior>
    - Declared findings and observed findings render in two separate sections with two headings, and no list contains both.
    - A declared row shows the grant text verbatim and carries no line link.
    - An observed row shows its summary, its source path, and a link ending in the line fragment for its line.
    - Evidence containing angle brackets, quotes and an ampersand renders escaped and creates no element.
    - With analyzedAt null, both sections read not analyzed.
    - With analyzedAt set and no findings, both sections read not detected.
    - With analyzedAt set and findings in one category only, the other section reads not detected while the first shows rows.
    - Each section heading carries its per-category counts, and no rendered output contains a total across categories.
    - An analyzer that exceeds maxFindingsPerDetector produces one extra finding in its own category whose summary names the number withheld, and the panel renders it as an ordinary row.
    - The panel renders from an array of plain objects with no database and no browser.
  </behavior>
  <action>
    Apply References A, B and the panel half of F.

    Keep the two channels apart at the type level and at the render level. A
    single list sourced from either erases the distinction that makes a declared
    grant worth more than a pattern match, and it is the pitfall the research
    names by name because two sections is more work than one.

    Read analyzedAt before deciding what absence says. An empty section is either
    a finding or an admission depending on that column, and rendering the second
    as the first is the assurance CAP-10 forbids — in the component whose job is
    disclosure.

    Put the counts on the headings. Do not build a stat block, do not add an
    icon, do not key a colour to a count, and do not sum anything across
    categories. A total is a score with one term, and a stat block is one CSS
    change from a dashboard.

    Emit the overflow as a finding rather than as a column. analyzeArtifact
    already computes the count and currently drops it at persist; a list showing
    three of sixty with nothing said is the quiet lie CAP-11 exists to prevent.
    One extra row in the same category, with no line, whose summary names the
    number withheld, costs no schema change and no branch in the panel.

    Render every value as a JSX text node. Do not import a Markdown renderer, do
    not import a sanitizer, and do not reach for React's raw-HTML escape hatch —
    there is nothing to sanitize when nothing is parsed, and check-boundaries
    already fails CI on the shortcut.

    Test the panel with renderToStaticMarkup and string assertions, the harness
    the component suites already use. No testing-library and no jsdom.
  </action>
  <verify>
    <automated>bun run test src/components src/analyze &amp;&amp; bun run typecheck &amp;&amp; bun run check:boundaries</automated>
  </verify>
  <done>A detail page shows declared capabilities and observed patterns in two sections that never merge, tells absence from ignorance by reading analyzed_at, names the number withheld when a cap fires, and shows no total, grade, colour or badge anywhere.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Say what is not checked, and make the promise a failing build</name>
  <files>src/app/r/[owner]/[repo]/[...path]/page.tsx, scripts/check-boundaries.mjs, scripts/check-boundaries.test.ts, README.md</files>
  <behavior>
    - Every detail page renders the "What AgentDock does not check" section, whether or not any finding exists, not collapsed and not behind a link.
    - The section states the 32 KB read limit, the two-of-eighty-four truncation figure, that precision was sampled and recall was not measured, which two checks have never matched real data, and that re-analysis is bound by the same excerpt.
    - bun run check:boundaries passes against the repository as it stands, including the existing detail-page sentence about what AgentDock cannot say.
    - The lint reports a problem for a component containing a hardcoded verdict word in JSX text.
    - The lint reports a problem for the same word in a quoted string literal in a UI file.
    - The lint reports nothing for a word appearing only inside a comment.
    - The lint reports nothing for a UI file that renders a runtime variable, even when that variable's value would contain the word.
    - The lint reports nothing for the word forms carrying a leading un- or a trailing -up, and no explicit exception is written for them.
    - The lint reports nothing for a file outside src/app and src/components, including a detector module and a test file.
    - The scope function returns a non-empty file list against the real tree, so an over-narrow scope fails rather than passing silently.
    - The inspected-file count for the new rule appears in the tool's own summary line.
  </behavior>
  <action>
    Apply References C and D.

    Write the sanctioned list in the same change as the rule, not after the first
    CI failure. The rule fails on src/app/r/[owner]/[repo]/[...path]/page.tsx as
    it stands today, and that sentence is copy CAP-09 wants kept — planning found
    this and the research did not. Seed the list with that sentence and with
    whatever lines of the new section need it, and give each entry a comment
    saying why it is allowed. That list is the product's ledger of every place it
    is permitted to use one of these words, which is the whole reason it is
    exact substrings rather than a cleverer pattern.

    Excise the sanctioned substrings before the scan rather than trying to teach
    the pattern about negation. Recognising negation inside a regex is an
    unbounded grammar problem that would pass a double negative and fail
    something harmless.

    Anchor with a negative lookbehind for a letter and a trailing word boundary.
    That exempts the un- and -up forms by construction. Do not add an explicit
    exception list for them: the research recommended one, and a rule with a
    special case invites a second.

    Make the scope a named exported function and test it against the real tree.
    A lint whose scope silently matches nothing passes forever, and the file's
    own sourceFiles docstring already names that as the failure mode worth
    guarding.

    Add the rule's inspected-file count to the summary line main() already
    prints. Zero problems over zero files must read as zero files, not as a pass.

    Record the static-analysis ceiling in the rule's own comment. A dynamically
    built string walks past this rule, the other five accept the same limit, and
    the copy is the project's own and reviewed in every diff. Write the ceiling
    down rather than building data-flow analysis for it.

    Source the section's opening sentence from REQUIREMENTS.md's product claim
    rather than drafting a new one — the requirement is that the page and the
    product definition agree. Take the two never-matched check names from the
    rows 04-02 and 04-03 recorded, not from memory.

    Add one README line naming the new section and the new lint rule, in the
    register the README already uses for the other five.
  </action>
  <verify>
    <automated>bun run check:boundaries &amp;&amp; bun run test scripts/check-boundaries.test.ts &amp;&amp; bun run typecheck</automated>
  </verify>
  <done>Every detail page permanently states what AgentDock does not check, with this phase's own measured bounds in it, and a hardcoded verdict word in UI copy now fails the build — while the project's existing honest disclaimer, and the un- and -up word forms, pass without a special case.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Re-analysis from stored bytes, the backfill, and the phase gate</name>
  <files>src/ingest/reanalyze.ts, src/ingest/reanalyze.test.ts, scripts/analyze-backfill.mjs, package.json, README.md</files>
  <behavior>
    - analyzePackageVersion reads body and frontmatter from the database and issues no network request.
    - Running it on a version with existing findings replaces them rather than appending, so a rule change cannot leave both generations on the page.
    - Running it twice in a row leaves the same finding count as running it once.
    - Running it sets analyzed_at even when it produces no findings.
    - Running it on a version whose body is null completes and produces no findings.
    - unanalyzedVersionIds returns only versions whose analyzed_at is null, bounded by its limit argument.
    - The backfill script processes the versions the query returns, reports a count, and closes its connection.
    - The backfill leaves package.files untouched, because the inventory comes from a tree this path does not have.
    - No file under src/analyze imports the database client.
    - bun run ci passes, and a production build succeeds.
  </behavior>
  <action>
    Apply Reference E.

    Put the function in src/ingest/, not in src/analyze/. That directory's purity
    is proven structurally rather than promised, and one database import in it
    breaks the proof for every file beside it. Add the assertion that keeps it
    true: a test that walks src/analyze and fails if any file imports the client.

    Delete and rewrite that version's findings in one transaction. Appending
    leaves a page showing both a detector's old output and its new output with no
    way for a reader to tell which is which, and a partial replace leaves it
    showing neither.

    Never fetch from GitHub in this path. The whole reason the function exists is
    that a rule change must be replayable across the index without spending any
    of a sixty-per-hour budget, and a fallback fetch would quietly convert a
    backfill into a crawl.

    Do not recompute the file inventory here. It is derived from a tree this
    function does not have and does not fetch; leaving the one the last scan
    wrote is more honest than inventing one from nothing. Say so in the file.

    State the lossy bound in the function's own comment with its number. Content
    past the 32 KB cut was never stored anywhere, two of the eighty-four sampled
    real files are affected, and a detector added later cannot retroactively see
    it. Declared-capability re-analysis is not lossy, because frontmatter is
    stored whole — the two halves have different guarantees and the comment must
    not blur them.

    Bound the backfill loop with a limit argument that has a default. An
    unbounded loop over a future index is a script nobody dares run.

    Run the backfill against the local database and record what it produced: how
    many versions had a null analyzed_at, how many findings the run created, and
    how long it took. That number is the phase's own answer to whether the
    existing corpus was worth analyzing.

    Finish with the phase gate in order: install with a frozen lockfile, build,
    the full ci gate, then migrate. Record any step that needed a retry.
  </action>
  <verify>
    <automated>bun run test src/ingest src/analyze &amp;&amp; bun run build &amp;&amp; bun run ci</automated>
  </verify>
  <done>A version stored before this phase can be analyzed from its own stored bytes with no GitHub request, re-running is idempotent, the backfill has actually run against the local database and its numbers are recorded, no file in src/analyze can reach the database, and the full gate passes.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| a stored finding → the rendered page | Attacker-chosen text reaching a browser through a component built this phase |
| AgentDock's own UI copy → a user's installation decision | The one place the product could accidentally give the assurance it exists to withhold |
| `analyzePackageVersion` → the GitHub budget | A re-analysis path that fetched would turn a backfill into an unbudgeted crawl |
| `scripts/analyze-backfill.mjs` → the whole index | A script that writes to every version row in one unbounded loop |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-04-23 | Tampering (of the product's own guarantee) | UI copy drifting into a verdict | critical | mitigate | `check-boundaries.mjs` rule six over `src/app/**` and `src/components/**` string and JSX-text literals, with an exact `SANCTIONED` ledger, a testable scope function, and its own inspected-file count in the summary line. Runs first in `ci`. |
| T-04-24 | Tampering | a lint that passes by inspecting nothing | high | mitigate | The scope filter is an exported function asserted to return a non-empty list against the real tree — the failure mode `sourceFiles`'s own docstring names. |
| T-04-25 | Tampering | vocabulary smuggled past a static lint by string concatenation | low | accept | Recorded ceiling. The existing five rules accept the same limit; this copy is the project's own, reviewed in every diff, not attacker-controlled. Data-flow analysis is disproportionate. |
| T-04-26 | Tampering / XSS | finding `summary` and `evidence_text` on the page | high | mitigate | JSX text nodes only, escaped by React, no Markdown and no sanitizer imported. `no-raw-html` fails CI on the shortcut. Asserted with angle brackets, quotes, an ampersand and a script tag. |
| T-04-27 | Spoofing | a capped list read as a complete one | high | mitigate | An overflowing analyzer emits one additional finding naming the number withheld, so the page cannot show a short list silently. |
| T-04-28 | Spoofing | "not detected" shown for a version nobody analyzed | high | mitigate | Three-state rendering keyed on `analyzed_at`, plus the backfill that removes the state from the existing corpus rather than leaving it to accumulate. |
| T-04-29 | Denial of Service | the backfill against a large index | medium | mitigate | A bounded `--limit` with a default, one version per transaction, no network. Not wired into `ci` and not run by the worker. |
| T-04-30 | Elevation of Privilege | `src/analyze/` gaining database access | medium | mitigate | A test walks the directory and fails on any import of the client, which is what keeps the arity-based purity proof true for the whole folder. |
| T-04-31 | Information Disclosure | a backfill log line carrying scanned content | high | mitigate | The script prints counts and durations only. Aggregate observability, per CONTEXT.md decision 12. |
</threat_model>

<verification>
1. Declared and observed render in two sections and never in one list.
2. Absence renders as `not detected`, and a null `analyzed_at` renders as `not analyzed`.
3. A capped detector's page output names the number withheld.
4. No rendered output contains a total, a grade, a letter, a colour scale or a badge.
5. Every detail page renders the "What AgentDock does not check" section unconditionally, carrying the 32 KB bound, the two-of-eighty-four figure, the precision-not-recall statement, and the two never-matched checks by name.
6. `bun run check:boundaries` passes against the repository as it stands, including the existing detail-page disclaimer.
7. The lint fails on a hardcoded verdict word in JSX text and in a string literal, and passes on a comment, on a runtime variable, on the un- and -up forms, and on files outside the two UI directories.
8. The scope function returns a non-empty list against the real tree, and its count appears in the summary line.
9. `analyzePackageVersion` reads stored bytes only, replaces rather than appends, is idempotent, and sets `analyzed_at` even with no findings.
10. No file under `src/analyze/` imports the database client.
11. The backfill ran against the local database and its counts are recorded.
12. `bun install --frozen-lockfile`, `bun run build`, `bun run ci` and `bun run db:migrate` all succeed, in that order.
</verification>

<success_criteria>
- **CAP-09** — a permanently visible section states what AgentDock does not check, in the product definition's own words plus this phase's own measured bounds.
- **CAP-10** — no page displays a risk score, a grade, or a verdict word, and the constraint is a failing build rather than a convention.
- **CAP-11** — absence renders as `not detected`, never-looked renders as `not analyzed`, and a capped list says what it withheld.
- **CAP-12** — findings use verbs of observation, enforced by the same rule that enforces CAP-10.
- **QUA-03** — the panel, the lint and the re-analysis path all have unit tests; the panel's and the lint's run with no database at all.
- ROADMAP criteria 5, 6 and 7 — the permanent "not checked" section; no score, grade or verdict word; and an artifact with no findings reading as "not detected" rather than as an assurance.
- **Phase gate** — `bun install --frozen-lockfile` → `bun run build` → `bun run ci` → `bun run db:migrate`, in that order, all green.
</success_criteria>

<output>
Create `.planning/phases/AGD-04-capability-disclosure/04-04-SUMMARY.md` when done.
Record: the final section order on the detail page; every entry that went into the
`SANCTIONED` list and the reason for each; the file count the new lint rule reports; the
exact text of the "What AgentDock does not check" block as shipped; the backfill's numbers
— versions with a null `analyzed_at`, findings created, wall clock; and the result of each
phase-gate step in order. Record no credential, no connection string, and no scanned
content.

**Do not `git add`, do not `git commit`, do not `git push`.** End with a recommended commit
message for the whole phase and leave the working tree for the maintainer.
</output>
