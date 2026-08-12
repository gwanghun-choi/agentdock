---
phase: AGD-05-corpus-cold-start
plan: 05
type: execute
wave: 5
depends_on: [05-04]
files_modified:
  - scripts/capture-fixtures.mjs
  - src/analyze/corpora.ts
  - scripts/capability-precision.mjs
  - src/analyze/precision.test.ts
  - fixtures/capability-precision.md
  - fixtures/obra-superpowers/repo.json
  - fixtures/obra-superpowers/tree.json
  - fixtures/disler-hooks-mastery/repo.json
  - fixtures/disler-hooks-mastery/tree.json
  - fixtures/anthropics-claude-code/repo.json
  - fixtures/anthropics-claude-code/tree.json
autonomous: false
requirements: [CAP-13]

estimate:
  tokens: 90000
  raw_tokens: 90000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "The corpus every precision measurement runs against is declared in exactly one place, so a one-sided edit is impossible rather than merely discouraged"
    - "A precision row names which corpus set it was measured against, and the test recomputes it against that same set"
    - "The npx hits carry their own row with their own hand-checked number, and so does the residue that remains when they are removed"
    - "Both readings of the npx question are computed and recorded before anyone chooses between them"
    - "No detector pattern is changed anywhere in this plan"
    - "CAP-13's kill rule is applied by the shipped test, mechanically, to whatever the numbers turn out to be"
    - "A detector with no real-world instance on the expanded corpus is recorded as absence of data, never as zero false positives"
    - "Recall is measured on a hand-picked slice and the record says that is what it is"
  artifacts:
    - path: "src/analyze/corpora.ts"
      provides: "The named corpus sets: the four-corpus set Phase 4 measured against, frozen, and the expanded set Phase 5 measures against — one declaration, two consumers"
      exports: ["CORPORA_V1", "CORPORA_V2", "CORPUS_SETS", "NEWEST_CORPUS_SET"]
      min_lines: 30
  key_links:
    - from: "src/analyze/corpora.ts"
      to: "scripts/capability-precision.mjs"
      via: "the sampling script and the CI test read the same declaration, so a hand-check cannot be made against a different corpus than the one the test recomputes"
      pattern: "CORPUS_SETS"
    - from: "fixtures/capability-precision.md"
      to: "src/analyze/precision.test.ts"
      via: "a row's corpus-set token selects which fixtures liveHits recomputes over, so old rows stay valid and new rows are additive"
      pattern: "corpusSet"
---

<objective>
Re-measure every shipped detector against a corpus roughly twice the size of the
one that produced their current numbers, and turn the one contested label in the
record — `npx` — from an argument into two numbers a maintainer chooses between.

Purpose: three of this project's recorded precision facts are known to be weak.
`install` sits at 10% with an unhandled negation class, and 13 of its 20
hand-checked hits are `npx <tool>` scored positive on a reading that, if
rejected, moves it to 75% and kills the detector. `network_request` is the
closest shipped margin at 15%. And `declaredCapabilities`, `observedRemoteExecution`
and `observedHiddenContent` have zero real-world instances, so their 0% is the
absence of data rather than a clean pass. All five facts share one cause: eighty-four
captured bodies from four repositories. This plan adds three more repositories,
recomputes everything, and records what changed.

It changes no detector. Step 6 of the procedure forbids narrowing a pattern until
it passes, and 05-CONTEXT D-09 forbids tuning before the expanded measurement
exists. This plan produces the measurement; whether anything is then tuned is a
later decision with numbers behind it.

Output: three new frozen corpora; one declaration of what "the corpus" means;
per-signal precision rows for `install` including both readings of `npx`; a
recall probe with its limitation stated; and a corpus set in which the
zero-instance detectors have either their first real hit or a second, larger
absence of data.

Honours 05-CONTEXT's finding that `npx` is already a distinct signal and the
split therefore needs no detector change (C3), that `CORPORA` is duplicated and
a one-sided edit reads as detector drift (C4), that the taxonomy call is a
blocking maintainer decision carrying computed numbers (D-09), and that recall
gets twenty hand-picked lines rather than a framework (D-10).
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/phases/AGD-05-corpus-cold-start/05-CONTEXT.md
@.planning/phases/AGD-05-corpus-cold-start/05-04-SUMMARY.md
@fixtures/capability-precision.md
@src/analyze/precision.test.ts
@scripts/capability-precision.mjs
@scripts/capture-fixtures.mjs
@src/analyze/install.ts
@src/analyze/index.ts
</context>

<decisions_made_while_planning>

**1. Corpus sets are named and versioned, so the existing rows survive.**

The obvious move — add three slugs to `CORPORA` and re-measure everything — makes
every recorded number in `fixtures/capability-precision.md` wrong at once, forces
a fresh twenty-hit hand-check for all six shipped rows in one sitting, and
destroys the historical rows the file exists to preserve (`html_comment_naive`
and `hidden_style` are there *so the patterns they name are not silently
reintroduced*).

Instead `src/analyze/corpora.ts` declares two named sets: `CORPORA_V1`, the four
corpora Phase 4 measured against, frozen forever; and `CORPORA_V2`, those four
plus three. Each record row names its set in the existing `Corpus` column, and
`liveHits` recomputes against the set that row names. Old rows stay true and
keep recomputing; new rows are additive; the hand-check work is the new rows'
work, not a redo of everything.

A superseded v1 row's verdict is reworded to say so — and deliberately **without**
the word `deleted`, because `precision.test.ts:139` matches that word
case-insensitively and would demand a rate at or above the kill line for a row
that measured 10%.

**2. The `npx` split costs no detector change, because the signal already exists.**

05-CONTEXT C3: `install.ts:44` already writes `signal: match[1]`, so every `npx`
hit is already distinguishable from every `pip install` hit in the findings table
and in the analyzer's return value. Only the `category` is shared. The research
framed this as a product taxonomy decision requiring a new detector; it is four
lines in `liveHits` and two new rows in the record.

That matters beyond convenience. It means the measurement can be taken **without
committing to a reading**, which is precisely what the phase brief asks for:
compute both outcomes, record both, and let the maintainer choose with the
numbers in front of them.

**3. Three rows for `install`, not two, and the third is the one that decides.**

- `install` over all signals — the shipped reading, directly comparable to the v1 row.
- `install — npx` — the contested hits alone.
- `install — not-npx` — everything else.

The third is the load-bearing one. Research §Q8 extrapolated it at 28.6% from a
sample of seven, which crosses the kill line — but seven hand-checked hits is not
the procedure's twenty, and an extrapolation is not a measurement. The expanded
corpus should hold enough non-`npx` install directives for a real twenty-hit
sample, and that number decides whether the residue survives on its own merits
rather than being carried by the `npx` hits.

**4. `bunx` and `uvx` share the argued reading and are named at the checkpoint.**

`INSTALL_PATTERN` (`install.ts:30-31`) carries `npx`, `bunx` and `uvx`, all three
of which run a tool that is fetched first. The record and this project's prior
discussion name only `npx`, so the rows do too — but the executor counts `bunx`
and `uvx` separately and puts those counts in front of the maintainer at the
checkpoint. A taxonomy decision made about `npx` that silently leaves two
identical cases on the other side of the line is not a decision, it is an
oversight.

**5. Three repositories, chosen for the shapes the current corpus lacks.**

Not for size. The four existing corpora are skill-heavy and contain zero
`allowed-tools` declarations and zero `curl | sh` shapes.

| slug | repository | why it, specifically |
|---|---|---|
| `anthropics-claude-code` | `anthropics/claude-code` | 18 commands and 12 plugin manifests. Commands are where `allowed-tools` lives, so this is the best chance `declaredCapabilities` has ever had at a real instance. |
| `disler-hooks-mastery` | `disler/claude-code-hooks-mastery` | 21 commands and a hook config, from an independent author with different conventions. |
| `obra-superpowers` | `obra/superpowers` | 14 skills, a plugin, a catalog and a hook, from an author with no Anthropic adjacency — the current corpus's biggest blind spot is that three of its four repositories share a house style. |

`davila7/claude-code-templates` is deliberately **not** captured. At 11,499 tree
entries it would dominate every count and commit a very large `tree.json` for
paths the detectors would then be measured against at a 400-file cap anyway.

**6. The kill rule is applied by the shipped test, not by the executor.**

`precision.test.ts:137-151` already enforces the relationship mechanically in
both directions. The executor's job is to record honest rows; if a row crosses
20%, the test fails until the signal is removed from the alternation, which is
deletion rather than tuning and is exactly what CAP-13 asks for.
`observedNetwork`'s two independently-scored category rows are the precedent for
per-scope rows each carrying their own verdict.

The one thing the executor must never do is choose the labelling that makes a row
survive. The labelling is the checkpoint's output, and it is made before any row
is written, because the labelling *is* the false-positive count.

**7. The recall probe is deliberately outside the machine-checked table.**

`precision.test.ts:40` skips any table row that does not have exactly eight cells,
so a recall table with different columns is invisible to the parser. That is not
a loophole being exploited — it is the right shape. A recall figure taken over a
hand-selected slice is not a drift target the way a hit count is: re-running a
detector cannot recompute which twenty lines a human picked. The section says so
in its own first sentence.

</decisions_made_while_planning>

<reference>

## Reference A — `src/analyze/corpora.ts`

```ts
/**
 * Which frozen corpora a precision measurement was taken against.
 *
 * Declared once because it was declared twice: scripts/capability-precision.mjs
 * and src/analyze/precision.test.ts each carried their own four-element array,
 * and a one-sided edit would have made the script print a sample over one set
 * while the test recomputed hit counts over another — surfacing as
 * "drifted from its recorded hit count", which accuses the detector of changing
 * when the fault is a missed edit in a constant.
 *
 * V1 is frozen. It is what every Phase 4 row in fixtures/capability-precision.md
 * was measured against, and re-pointing those rows at a larger corpus would make
 * six recorded numbers wrong at once and destroy the historical rows that file
 * exists to preserve.
 */
export const CORPORA_V1 = [
  'addyosmani-agent-skills', 'anthropics-skills', 'baoyu-skills', 'wshobson-agents',
] as const;

export const CORPORA_V2 = [
  ...CORPORA_V1, 'anthropics-claude-code', 'disler-hooks-mastery', 'obra-superpowers',
] as const;

export const CORPUS_SETS = { v1: CORPORA_V1, v2: CORPORA_V2 };
export const NEWEST_CORPUS_SET = 'v2';
```

`scripts/capability-precision.mjs:26` and `src/analyze/precision.test.ts:13` both
delete their local arrays and import from here. The script defaults to
`NEWEST_CORPUS_SET`, takes a set name as an optional argument, and **prints which
set it used** — a hand-check made against the wrong corpus is otherwise
undetectable.

## Reference B — the record's `Corpus` column becomes machine-read

The table shape does not change: eight cells,
`| Analyzer | Version | Corpus | Hits | Hand-checked | FP | Rate | Verdict |`.
The `Corpus` cell gains a leading set token so `liveHits` can resolve it, e.g.
`v2 — 7 frozen corpora`. Existing rows become `v1 — 4 frozen corpora`.

`Row` in `precision.test.ts:16-23` gains `corpusSet: string`, parsed from that
cell with a fallback to `v1` so a row written before this change still resolves.
`corpusFiles()` (`:61-73`) takes the set. `liveHits` (`:81-114`) passes the row's
set through.

## Reference C — `liveHits` learns the install scopes

The analyzer cell is already split on an em dash into an analyzer and a scope
(`precision.test.ts:44`), and `observedNetwork` already uses the scope to filter
by category (`:101-105`). Install uses it to filter by **signal**, which requires
no detector change (decision 2):

- scope absent → every finding.
- scope `` `npx` `` → `findings.filter(f => f.signal === 'npx')`.
- scope `` `not-npx` `` → `findings.filter(f => f.signal !== 'npx')`.

Rename the `Row` field from `category` to `scope` while touching it, with a
comment saying it means a category for `observedNetwork` and a signal for
`install`. Two meanings behind one column is fine; two meanings behind a name
that claims one of them is not.

## Reference D — capture

`scripts/capture-fixtures.mjs`'s `PINS` gains three entries. Each pin needs a
commit sha up front, so per repository the executor spends one call to read the
sha at the default branch, then the script spends two more — **nine core requests
total** for the three, plus free `raw.githubusercontent.com` body reads.

`bodies: 'all'` for all three: the largest is `anthropics/claude-code` at 333 tree
entries, well inside what the existing corpora already commit, and the whole point
of these three is their bodies rather than their trees.

The script's own assertion — that the sha the Trees API returns for a ref is the
commit sha and that `blob/<that>/path` resolves — runs for free on each capture
and is worth naming in the summary when it passes for three new repositories.

## Reference E — the measurement, in order

1. Capture the three corpora, commit them.
2. `bun run precision` against `v2`. Record every analyzer's total, and for
   `install` the totals broken out by signal — `npx`, `bunx`, `uvx`, and the rest.
3. Hand-check twenty hits per row under the procedure verbatim
   (`fixtures/capability-precision.md:25-38`), or all of them when fewer than
   twenty exist, **recording which case applies**. Score ambiguous as negative.
4. For `install`, compute all three arithmetics — all signals, `npx` alone,
   `not-npx` alone — under **both** candidate readings of `npx`, so the checkpoint
   has the full table.
5. Stop. Take the checkpoint.
6. Write the rows for the chosen labelling. Let the shipped test apply the kill
   rule.

Do not skip step 5 to keep momentum. The labelling determines the false-positive
count, so a row written before the decision is a decision made silently.

## Reference F — the recall probe

A new section in `fixtures/capability-precision.md`, whose first sentence states
the limitation, in the register the `declaredCapabilities` note already uses:

> This measures recall on a hand-selected slice, not true recall against an
> unknown ground truth. Twenty lines per category were found by a human reading
> the corpus; a detector cannot be scored against lines nobody looked for.

Then, per detector category, a table with columns that are **not** the eight the
parser reads (decision 7): the category, the twenty lines' locations, how many
the shipped detector flagged, and how many it missed — with the missed ones named
by `corpus/file:line` so a future rule change has something concrete to be tested
against.

Method, from D-10: grep the corpus by hand for the shape, pick twenty a human
confirms genuinely declare the capability, then run the detector over those same
files and compare. This is `scripts/capability-precision.mjs`'s existing
print-the-sample mechanism used in reverse, and it needs no new code.

Cost, stated because it is the largest single time cost in this phase: roughly an
afternoon per detector category, the same hand-labelling effort that produced the
existing precision rows. If the budget only covers two categories, do two and say
which two are missing — a partial recall probe with its gaps named is worth more
than none, and far more than a full one with invented labels.

## Reference G — the zero-instance detectors

`declaredCapabilities`, `observedRemoteExecution` and `observedHiddenContent` each
have zero real hits on v1. On v2:

- **If still zero**, the row reads `absence of data, not a clean pass`, in the
  exact register `fixtures/capability-precision.md:89-95` already uses, and the
  note says the corpus is now seven repositories rather than four — a larger
  absence is a stronger statement than a smaller one and deserves to be recorded
  as such.
- **If non-zero**, hand-check every hit. `allowed-tools` appearing for the first
  time in `anthropics/claude-code`'s commands would be the first real validation
  `declaredCapabilities` has ever had, and it gets the full procedure, not a
  glance.

Under no circumstances does a 0% row lose its qualifier. A detector that has never
fired on real data has not been measured, and the record has said so from the
beginning.

</reference>

<tasks>

<task type="auto">
  <name>Task 1: Three more corpora, one declaration of what the corpus is, and every number recomputed</name>
  <files>scripts/capture-fixtures.mjs, src/analyze/corpora.ts, scripts/capability-precision.mjs, src/analyze/precision.test.ts, fixtures/obra-superpowers/repo.json, fixtures/obra-superpowers/tree.json, fixtures/disler-hooks-mastery/repo.json, fixtures/disler-hooks-mastery/tree.json, fixtures/anthropics-claude-code/repo.json, fixtures/anthropics-claude-code/tree.json</files>
  <precondition>GitHub core quota is available — `curl -s https://api.github.com/rate_limit` reports `resources.core.remaining` of at least 9, which is what three pinned captures cost.</precondition>
  <behavior>
    - Three new fixture directories exist, each with repo.json, tree.json and captured bodies, pinned to an exact commit sha.
    - The sampling script and the precision test both read their corpus list from src/analyze/corpora.ts, and neither declares its own.
    - The sampling script prints which corpus set it sampled.
    - A record row carrying no set token resolves to v1, so every existing row still recomputes to its recorded number.
    - liveHits for a row scoped to npx counts only findings whose signal is npx, and a row scoped to not-npx counts only the rest, with the two summing to the unscoped total.
    - The full test suite passes with the existing record unchanged, because every existing row is still measured against v1.
  </behavior>
  <action>
    Apply References A, B, C and D.

    Resolve each repository's commit sha first, then pin it. A fixture captured at
    a branch name drifts with upstream and the whole corpus exists to not do that.

    Delete both local CORPORA arrays. Leaving one behind is the exact failure this
    task is here to remove, and it would be invisible until a hand-check was made
    against the wrong set.

    Add the set token to every existing row's Corpus cell and change no other cell
    on any of them. Run the suite immediately afterward: every existing hit count
    must still recompute to its recorded value, because those rows are still
    measured against the same four corpora. If one moves, the corpus-set plumbing
    is wrong and nothing further in this plan is trustworthy.

    Rename the Row field from category to scope, and say in its comment that it
    means a category for observedNetwork and a signal for install. Do not add a
    second column to carry the second meaning — the record's shape is parsed by a
    deliberately small hand-rolled reader and widening it is a cost with no buyer.

    Change no detector. Not install's pattern, not network's same-line rule, not
    anything. The negation class and the 15% margin are both known and both stay
    exactly as they are until this measurement exists.

    Run bun run precision against v2 and capture the raw output. Record every
    analyzer's total, and for install the breakdown by signal including bunx and
    uvx, which share npx's argued reading and which the existing record never
    counted separately.
  </action>
  <verify>
    <automated>bun run test src/analyze &amp;&amp; bun run typecheck &amp;&amp; bun run lint</automated>
  </verify>
  <done>Seven frozen corpora exist, the corpus list is declared in one place that both consumers import, every pre-existing precision row still recomputes to exactly the number it records, and the v2 totals — including install broken out by signal — are captured and ready for a hand-check.</done>
</task>

<task type="checkpoint:decision" gate="blocking">
  <decision>
    How `npx` — and, since they are the identical case, `bunx` and `uvx` — should
    be labelled when scoring the `install` detector's false-positive rate on the
    expanded corpus.
  </decision>
  <context>
    `npx tsc --noEmit` runs a tool rather than installing one. The shipped record
    scores such hits **positive**, on the reading that `npx` fetches from the
    registry before executing, and that fetch is the capability being disclosed.
    That reading is defensible and not obvious, and the record has said so since
    Phase 4 (`fixtures/capability-precision.md:81-87`).

    On the four-corpus set, 13 of the 20 hand-checked hits were `npx`. Rejecting
    the reading moved the recorded rate from 10% to 75% and would have killed the
    detector under CAP-13's 20% line.

    Nothing about the detector has changed, and nothing will change as a result of
    this decision except which rows get written: `npx` is already a distinct
    `signal` in the code (`install.ts:44`), so both labellings are already
    measurable and both have been measured. Present here are the real numbers from
    the expanded seven-corpus set, not the old extrapolation from a sample of
    seven.

    The executor must bring to this checkpoint, filled in from Task 1's run:
    total install hits on v2; the split by signal across `npx`, `bunx`, `uvx` and
    everything else; the hand-checked sample and false-positive count for each of
    the three candidate rows; and the resulting rate for each row under **both**
    readings — six numbers, computed, not argued.
  </context>
  <options>
    <option id="keep-positive">
      <name>Keep the current reading: an ephemeral runner discloses a fetch, and its hits are positives</name>
      <pros>Continuous with the shipped record and with the number CAP-13's test already enforces; the fetch genuinely happens and is genuinely a capability a reader wants disclosed; no row's meaning changes retroactively.</pros>
      <cons>The summary sentence a user reads says "references an install directive" for a line that installs nothing permanent; the reading has to be defended every time someone new reads the record.</cons>
    </option>
    <option id="reject-positive">
      <name>Reject the reading: an ephemeral runner invocation is a false positive for an install-directive claim</name>
      <pros>The disclosure matches the words on the page; no argued reading needs defending.</pros>
      <cons>Under CAP-13's mechanical rule the `npx` row is then deleted — the signal comes out of the alternation — and whether the whole detector survives depends on the `not-npx` row's own measured rate.</cons>
    </option>
    <option id="separate-claim">
      <name>Keep the hits but stop calling them installs: they remain a measured signal under a distinct claim</name>
      <pros>Loses no disclosure and drops no hits; the two claims can then carry separate rates, which is what the record's per-scope rows already make possible.</pros>
      <cons>A new category is a new `CAPABILITY_CATEGORIES` value, a UI section it renders in, and its own twenty-hit hand-check — real work in a phase that has none of it budgeted, and therefore a Phase 6 or later decision rather than one to execute now.</cons>
    </option>
  </options>
  <resume-signal>Select: keep-positive, reject-positive, or separate-claim — and say whether `bunx` and `uvx` follow `npx` or are scored separately.</resume-signal>
</task>

<task type="auto">
  <name>Task 2: Write the rows the numbers earned, and say what is still not measured</name>
  <files>fixtures/capability-precision.md, src/analyze/precision.test.ts</files>
  <behavior>
    - Every registered analyzer has at least one v2 row.
    - Every v2 row's recorded hit count recomputes exactly against the v2 corpus set.
    - The install rows for npx and not-npx sum to the unscoped install row's hit count.
    - Every row at or above 20% is marked deleted and every row below it is not, enforced by the shipped test rather than by review.
    - A superseded v1 row states that it is superseded without using the word the kill-line test matches on.
    - A detector with zero hits on the expanded corpus carries the absence-of-data qualifier, not a bare 0%.
    - The recall section exists, states its limitation in its first sentence, and is not parsed by the record's table reader.
    - No detector source file changed in this plan.
  </behavior>
  <action>
    Apply References E, F and G, and the labelling the checkpoint chose.

    Write the rows for the chosen labelling and let the shipped test apply the kill
    rule. If a row crosses the line, the remedy is deletion — the signal comes out
    of the alternation — and not narrowing. That is step 6 of the procedure, in the
    file's own words, and it is the rule that has already deleted three detectors
    in this project on measured evidence.

    Reword a superseded v1 row to say it is superseded, and check the wording
    against the kill-line test before running it: the test matches "deleted"
    case-insensitively in the verdict cell and would then demand a rate at or
    above 20% from a row that measured 10%.

    Keep every 0% row's qualifier. If allowed-tools finally appears in the new
    command-heavy corpora, that is the first real instance declaredCapabilities has
    ever had and it gets the full twenty-hit procedure, not a glance. If it does
    not appear, the row says absence of data over seven corpora rather than four —
    a larger absence is a stronger statement and should read as one.

    Write the recall section with the limitation as its first sentence, and give
    its table a column count other than eight so the record's parser continues to
    ignore it. Name every missed line by corpus, file and line: a miss with an
    address is something a future rule can be tested against, and a miss recorded
    as a count is not.

    If the hand-labelling budget covers only some categories, do those and name the
    ones left undone. A partial probe with its gaps stated is worth more than none
    and far more than a complete one with invented labels.

    Change no detector source file. Verify that at the end by confirming the diff
    for this plan touches only the record, the test and the corpus declaration.
  </action>
  <verify>
    <automated>bun run test src/analyze &amp;&amp; bun run precision &amp;&amp; bun run ci</automated>
  </verify>
  <done>Every shipped detector carries a precision row measured against seven corpora, install's contested npx hits carry their own hand-checked row alongside the residue that remains without them, CAP-13's kill rule has been applied mechanically to whatever the numbers turned out to be, the zero-instance detectors are recorded as absence of data over a larger corpus, and recall has a first number with its limitation stated in the same breath.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| captured fixture bodies → the analyzers | Third-party file contents, now from three more authors, run through every shipped pattern |
| the precision record → a product claim | The numbers a detail page's disclaimer implicitly rests on |
| a hand-applied label → a recorded rate | The one input in this project that no test can check |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-05-30 | Denial of Service | a pathological body in a new corpus | medium | mitigate | `ANALYZE_CAPS.maxLineChars` is applied before any pattern runs and every shipped pattern is fixed-alternation with nothing to backtrack over; `src/analyze/redos.test.ts` already locks that and now runs over three more corpora's worth of real input. |
| T-05-31 | Repudiation | a hand-check made against a different corpus than the test recomputes | high | mitigate | One `corpora.ts` declaration imported by both consumers, the sampling script printing which set it used, and a per-row set token the test resolves (C4). |
| T-05-32 | Repudiation | a labelling chosen to make a row survive | high | mitigate | The labelling is a blocking maintainer checkpoint taken **before** any row is written, carrying both readings' computed arithmetic (D-09). |
| T-05-33 | Repudiation | a 0% row read as a clean pass | medium | mitigate | The absence-of-data qualifier is mandatory on any row with no real instance, and the note names the corpus size so a larger absence reads as the stronger statement it is. |
| T-05-34 | Tampering | a fixture drifting with upstream | medium | mitigate | Every pin carries an exact commit sha, and `capture-fixtures.mjs` asserts on every run that the sha resolves as a commit and that a `blob/<sha>/path` URL is valid. |
| T-05-35 | Information Disclosure | a captured body containing a real credential | low | mitigate | Bodies are public repository files already world-readable; nothing is fetched with a token and no captured byte is echoed into a log line. Unchanged posture from the four existing corpora. |
</threat_model>

<verification>
1. Three new corpora exist, pinned to exact commit shas, with bodies captured.
2. `CORPORA` is declared once and imported by both consumers; neither keeps a local copy.
3. Every pre-existing record row still recomputes to its recorded hit count against v1.
4. The sampling script prints which corpus set it sampled.
5. `install — npx` and `install — not-npx` hit counts sum to the unscoped `install` count.
6. Both readings of the `npx` question were computed and put in front of the maintainer before any row was written.
7. `bunx` and `uvx` counts were presented alongside `npx` at the checkpoint.
8. Every v2 row's rate and verdict satisfy the kill-line test mechanically.
9. A superseded v1 row says so without tripping the kill-line test's word match.
10. Every 0% row carries the absence-of-data qualifier and names the corpus size.
11. The recall section exists, leads with its limitation, names every missed line by address, and is not parsed by the record's table reader.
12. No file under `src/analyze/` other than `corpora.ts` and `precision.test.ts` changed.
13. `bun run ci` passes.
</verification>

<success_criteria>
- **CAP-13** — every shipped detector has a hand-checked false-positive rate recorded against a labelled corpus, now seven repositories rather than four, with the kill rule applied mechanically.
- 05-CONTEXT C3 — the `npx` question is settled by a maintainer choosing between two computed numbers, not by an executor picking a reading.
- 05-CONTEXT C4 — the duplicated corpus constant is gone, so the failure mode it enabled cannot recur.
- 05-CONTEXT D-10 — recall has a first measurement and an honest statement of what it does not cover.
- The three STATE.md items carried into Phase 5 about `install`, `network_request` and the zero-instance detectors each have a new number behind them, or a recorded reason they still do not.
</success_criteria>

<output>
Create `.planning/phases/AGD-05-corpus-cold-start/05-05-SUMMARY.md` when done.
Record: the three pinned commit shas and how many bodies each capture produced; each
analyzer's v1 and v2 hit totals side by side; the install breakdown by signal including
`bunx` and `uvx`; the full six-number arithmetic put in front of the maintainer at the
checkpoint and the labelling they chose; every row whose verdict changed and why; whether
`allowed-tools` or a `curl | sh` shape appeared for the first time; which recall categories
were probed, their found-and-missed counts, and which categories were left undone; and
confirmation that no detector source file changed. Record no credential and no connection
string.

**Do not `git add`, do not `git commit`, do not `git push`.** End with a recommended commit
message and leave the working tree for the maintainer. The branch stays `develop`.
</output>
