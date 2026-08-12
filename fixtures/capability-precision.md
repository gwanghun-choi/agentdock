# Capability detector precision record (CAP-13)

The ROADMAP's kill switch, in writing: "Any detector exceeding a 20% false-positive
rate on twenty hand-checked hits is deleted rather than tuned — a noisy detector
trains users to dismiss the entire panel." One row per shipped analyzer, plus every
detector this measurement has already killed. A pattern change that shifts a
recorded hit count, or a row missing for a registered analyzer, is what
`src/analyze/precision.test.ts` fails on — this file is a claim the code makes
about itself, not a note nobody re-derives.

Reproduce any row with `bun run precision [analyzer-name]`, which prints the exact
sample (`corpus/file:line` + matched text) each hand-check below was made against.

The `Corpus` cell leads with a set token naming which frozen corpora the row was
measured against. `src/analyze/corpora.ts` declares them: `v1` is the four
repositories Phase 4 measured, frozen forever; `v2` is those four plus three
added in Phase 5. Rows are additive — a `v1` row stays true and keeps
recomputing against `v1`, so a larger corpus never makes a recorded number
retroactively wrong.

| Analyzer | Version | Corpus | Hits | Hand-checked | FP | Rate | Verdict |
|---|---|---|---|---|---|---|---|
| `html_comment_naive` | n/a — never shipped | v1 — 4 frozen corpora, 6 files | 26 | 26 | 26 | 100% | **deleted** |
| `install` | 1 | v1 — 4 frozen corpora | 78 | 20 | 2 | 10% | shipped, superseded by the v2 rows |
| `declaredCapabilities` | 1 | v1 — 4 frozen corpora | 0 | 0 (no real instance) | 0 | 0% | shipped, no corpus validation |
| `observedNetwork` — `network_request` | 1 | v1 — 4 frozen corpora | 13 | 13 (fewer than 20 exist) | 2 | 15% | shipped |
| `observedNetwork` — `external_reference` | 1 | v1 — 4 frozen corpora | 51 | 20 | 1 | 5% | shipped, superseded by the v2 row |
| `observedRemoteExecution` | 1 | v1 — 4 frozen corpora | 0 | 0 (no real instance) | 0 | 0% | shipped, precision untested |
| `observedHiddenContent` | 1 | v1 — 4 frozen corpora | 0 | 0 (no real instance) | 0 | 0% | shipped, no corpus validation |
| `hidden_style` | n/a — never shipped | v1 — 4 frozen corpora | 1 | 1 | 1 | 100% | **deleted** |
| `install` | 1 | v2 — 7 frozen corpora | 87 | 20 (first-twenty unchanged from v1) | 2 | 10% | shipped, label-contested — the sum of the two rows below |
| `install` — `npx` | 1 | v2 — 7 frozen corpora | 63 | 20 | 3 | 15% | shipped |
| `install` — `not-npx` | 1 | v2 — 7 frozen corpora | 24 | 20 of 24 | 3 | 15% | shipped |
| `declaredCapabilities` | 2 | v2 — 7 frozen corpora | 77 | 20 | 0 | 0% | shipped, first measured rate on real data |
| `observedNetwork` — `network_request` | 1 | v2 — 7 frozen corpora | 13 | 13 (fewer than 20 exist) | 2 | 15% | shipped, on no new evidence |
| `observedNetwork` — `external_reference` | 1 | v2 — 7 frozen corpora | 83 | 20 (first-twenty unchanged from v1) | 1 | 5% | shipped |
| `observedRemoteExecution` | 1 | v2 — 7 frozen corpora | 0 | 0 (no real instance) | 0 | 0% | shipped, precision untested |
| `observedHiddenContent` | 1 | v2 — 7 frozen corpora | 0 | 0 (no real instance) | 0 | 0% | shipped, no corpus validation |

### The v2 rows that re-measured nothing, and the ones that did

Corpus expansion does **not** re-measure a saturated row. The four `v1` corpora
are iterated first, so for any analyzer that already had twenty hits on `v1`,
the procedure's "first twenty" over `v2` is the *same twenty hits* and the rate
is arithmetically forced to reproduce the `v1` figure. Two rows above are marked
`first-twenty unchanged from v1`; they carry no new information and must not be
read as confirmation. The new information is in the hits the three new corpora
contributed, hand-checked separately:

| Row | new-corpus hits | hand-checked | FP | Rate on the new corpora alone |
|---|---|---|---|---|
| `install` | 9 | 9 (all of them) | 0 | 0% |
| `declaredCapabilities` | 77 (all of its hits) | 20 | 0 | 0% |
| `observedNetwork` — `external_reference` | 32 | 32 (all of them) | 0 | 0% |
| `observedNetwork` — `network_request` | **0** | — | — | **no new evidence at all** |

The next corpus expansion should sample the new corpora deliberately rather than
taking the first twenty hits of the combined set, or it will re-record the same
numbers a third time.

## The procedure (verbatim from 04-RESEARCH.md §Q5)

1. Run the pattern over all four frozen corpora.
2. Take the first twenty hits, or all of them if fewer than twenty exist, and
   **record which case applies**.
3. Label each **positive** (the matched text genuinely represents the claimed
   capability), **negative** (the pattern matched but the text does not represent
   it — prose about the tool, a namespace URI, a negated instruction), or
   **ambiguous**.
4. **Score ambiguous as negative.** A detector whose hits need an argued judgment
   to defend is exactly the kind that trains users to dismiss the whole panel.
5. Record corpus, hit count, sample size, FP count and rate.
6. **At or above 20%, delete the detector.** Do not narrow it until it passes.
7. **Corpus expansion does not re-measure a saturated row** (added 05-05). The
   older corpora are iterated first, so "the first twenty hits" of a larger set
   are the same twenty hits a row already recorded, and its rate is forced to
   reproduce itself. When a corpus grows, sample the *new* corpora deliberately
   and record that figure beside the procedure-literal one. Two rows in the
   table above re-measured nothing and say so in their own cells.

A row marked **deleted** is exempt from the "under 20%" line by construction — the
row exists *because* the rate reached the line, and it stays in this file exactly
so the pattern it names is not silently reintroduced. `precision.test.ts` enforces
the inverse relationship mechanically: a rate at or above 20% requires a `deleted`
verdict, and a `deleted` verdict requires a rate at or above 20%.

## Row-by-row notes

**`html_comment_naive` — the row earned before any code in this plan was written.**
`04-RESEARCH.md` §Q7 proposed `<!--[\s\S]*?-->` as CAP-06's hidden-content class. A
bare scan over the 84 real bodies finds 26 comments in 6 files. Rendering each of
those 6 bodies through the actual `SkillBody` component
(`renderToStaticMarkup`, `SkillBody.test.tsx:20-22`'s own harness) and searching the
output for each comment's own inner text finds it present **26 times out of 26** —
25 inside fenced code blocks, 1 inside an inline-code span in a table cell
(`anthropics-skills skills/pptx/SKILL.md:15`). Zero of the 26 are hidden from a
reader. The claim a hidden-content finding makes is "this content is in the file
and the page does not show it" — measured against the only rule that can settle
that claim, the rate is 100%. Never shipped; the replacement (fence-and-code-span
aware) belongs to 04-03 and gets its own row there.

**`install` — carried forward from 04-01, re-labelled during phase verification.**
`04-RESEARCH.md` §Q5 hand-checked the first 20 of 78 corpus hits and recorded 1
false positive: `browser-testing-with-devtools/SKILL.md:41` — "`-y` skips the npx
install confirmation" — prose about the tool's own behaviour.

**That label was incomplete.** A re-read of the same twenty found a second false
positive the first pass missed: `anthropics-skills skills/pptx/SKILL.md:31` —
"`pptxgenjs` is preinstalled — **do not run** `npm install` first". Step 3 of the
procedure names "a negated instruction" as a negative in so many words, so this is
not a judgment call that went the other way; it is a hit that was scored against
the procedure. The same shape appears again outside the sample at
`skills/xlsx/SKILL.md:16` ("are preinstalled — do not run `pip install` first"),
so the class is systematic rather than a one-off.

Corrected: **2/20 = 10%.** Under the kill line, so the detector ships — but at
double the recorded rate, and the negation class is a known, unhandled weakness
rather than a surprise. It is not patched around here: step 6 forbids narrowing a
pattern until it passes, and at 10% there is nothing to narrow it *for*. A
negation-aware rule would be a different claim and would need its own row and its
own twenty hits.

Also worth naming, because a reader of this row will notice it: 13 of the 20
hand-checked hits are `npx <tool>` invocations that run a tool rather than install
one (`npx tsc --noEmit`, `npx playwright test`). They are scored positive on the
grounds that `npx` fetches from the registry before executing, which is the
capability being disclosed. That is a defensible reading, not an obvious one, and
if it is ever rejected the rate moves to 75% and the detector dies. Recorded so
that decision is visible rather than implicit.

**`install` on v2 — the `npx` question, settled by splitting the row rather than
by winning the argument.** `src/analyze/install.ts:44` has always written
`signal: match[1]`, so every `npx` hit was already distinguishable from every
`pip install` hit. Measuring them apart therefore cost **no detector change** —
only two more rows. Both readings were computed before any row was written:

| Row | v2 hits | checked | keep-positive | reject-positive |
|---|---|---|---|---|
| `install` (all signals) | 87 | 20 | 2 FP — 10% | 17 FP — 85% |
| `install` — `npx` | 63 | 20 | 3 FP — 15% | 20 FP — 100% |
| `install` — `not-npx` | 24 | 20 of 24 | 3 FP — 15% | 3 FP — 15% |

The two scoped rows are what ship, each carrying its own hand-checked number.
Neither reading had to win: a reader who rejects the ephemeral-runner reading
reads the `not-npx` row and ignores the other, and the `npx` hits stay disclosed
under their own measured rate instead of being deleted on a contested label.

**The residue survives on its own merits.** `04-RESEARCH.md` §Q8 extrapolated
the non-`npx` rate at 28.6% from a sample of seven, which crosses the kill line.
Measured on twenty of the twenty-four that exist, it is **15%**, and all three
false positives are the same already-recorded negation class (`do not run
`npm install` first` — `anthropics-skills skills/pptx/SKILL.md:31`,
`skills/docx/SKILL.md:21`, `skills/xlsx/SKILL.md:16`). The extrapolation was
wrong and the measurement replaces it.

**A prose count and a signal count disagreed, and the record now uses the signal
count.** The v1 note below says "13 of the 20 hand-checked hits are `npx`" and
predicts 75% if the reading is rejected. Counted by `Finding.signal` over those
same twenty hits it is **16**, and the rejection figure is **85%**. The prose
figure appears to have counted only `npx <tool>`-shaped invocations, excluding
`"command": "npx"`, the one prose mention, and a bare `npx` in a frontmatter
requirements list. The v1 note is left as written — it is the historical record —
but the arithmetic above is the one to trust, because it is the one the shipped
test recomputes.

**`bunx` and `uvx` have no instances.** `INSTALL_PATTERN` carries both, and both
run a fetched tool exactly as `npx` does, so a decision about `npx` that left
them unmentioned would be an oversight rather than a decision. Counted:
**zero occurrences in v1 and zero in v2.** They follow the `npx` row by
construction. That is an absence of instances, not a clean rate — nothing has
been measured about them.

**`declaredCapabilities` — CAP-02's own honest state, and the first time real
data ever tested it.** The full history, because the history is this row's value:

*Version 1 on v1.* `allowed-tools` appears zero times across the four frozen
corpora (Measurement 6). The 0% is not a measured rate on real data, it is the
absence of data, and is recorded as such rather than presented as a clean pass.
Validated only against `fixtures/adversarial/tools-list.md` (YAML list) and
`allowed-tools-coarse.md` (coarse `Bash(*)`, asserting exactly one
un-decomposed finding).

*Version 1 on v2 — the first real measurement, and it failed.* The three
repositories added in Phase 5 carry 21 files with an `allowed-tools` field, and
version 1 produced **110 findings** over them. Hand-checked under the procedure:
**14 false positives in the first twenty, 70%.** Checked exhaustively against
every file's own declared grants: **56 of 110, 50.9%.** Both far above the kill
line.

The defect was not in this analyzer. `toolTokens`, which it reuses from
`src/detect/skill.ts`, split a string-form field on `/[\s,]+/`, so a grant whose
parentheses contain a space became several fragments that are not grants:

```
allowed-tools: Bash(git checkout --branch:*), Bash(git add:*)      <- 2 grants
version 1 emitted: Bash(git | checkout | --branch:*) | Bash(git | add:*)
```

Five files produced fragments; the summary a reader saw was
`declares allowed-tools: add:*)`. List form and space-free string form were
always correct, which is exactly why four corpora containing neither could not
see the fault.

*Version 2 on v2.* `toolTokens` now splits only at parenthesis depth zero.
This is **not** step 6's forbidden narrowing — narrowing makes a rule match less
in order to improve a rate; this makes it emit the grants the file actually
declares, and the corrected output is strictly closer to the source text.
**77 findings, twenty hand-checked against the raw frontmatter, 0 false
positives.** The 33-finding drop is exactly the fragments the five files
produced. The kill rule was then applied to the fixed version on its own
measured number, not waived: had it still reached 20% the detector would have
been deleted.

Two honest limits on that 0%. It is twenty hits from three files, because only
21 files in seven repositories declare `allowed-tools` at all. And the
exhaustive 77-of-77 agreement is weaker evidence than the hand-check, because
the reference it was compared against and the fixed implementation now share the
same comma rule; the hand-check against the raw files is what carries the claim.

**`observedNetwork` — `network_request` on v2: 15% on no new evidence.** The
corpus doubled from 84 files to 169 and this rule gained **zero** hits. All 13
are the same 13 measured on v1, so the rate is the same 2/13 = 15% — still the
closest margin of any shipped row, and the expansion tested it not at all. The
three new repositories are command-, plugin- and hook-heavy, and a
`network_request` needs a fetch verb on the same line as a URL;
`disler-hooks-mastery` contributed no hits in either category. Recorded as an
untested carry-forward rather than as a rate that held up.

**`observedNetwork` — `external_reference` on v2.** 51 hits became 83. The
first-twenty sample is unchanged from v1, so that row's 5% re-measured nothing;
the 32 hits the new corpora contributed were all hand-checked separately and
**none is a false positive**. Worth naming because it looks like one: a
placeholder such as `"url": "https://api.example.com/mcp"` inside a
documentation example is scored **positive**, because the claim the code makes
is `references an external URL` and the file does reference that URL. v1's lone
false positive was `http://localhost:3000`, which fails the claim on the word
*external*, not on being a placeholder.

**`observedNetwork` — `network_request`, 13 hits, fewer than 20 exist, so all 13
are hand-checked (§Q5 step 2).** 11 true positives — an explicit `WebFetch`/`Fetch
from`/`POST`/`Navigate to`/`Open` verb genuinely aimed at the URL on that line.
2 false positives, both on the **same line**
(`anthropics-skills skills/claude-api/SKILL.md:185`): "...see [Bedrock](url) or
[Vertex AI](url). For WebFetch, use the Pricing row in `shared/live-sources.md`."
— `WebFetch` is present on the line but names a *different, non-URL* target
elsewhere in the sentence; neither the Bedrock nor the Vertex AI link is what gets
WebFetched. This is the concrete cost of a same-line rule rather than a
verb-adjacent-to-URL rule: 2/13 = 15%, under the kill line but the closest margin
of any shipped row, and named here rather than smoothed over.

**`observedNetwork` — `external_reference`, 51 hits, first 20 hand-checked.**
19 true positives — homepage fields, Markdown documentation links, a `<script
src>` tag, a URL argument in a shown command (`page.goto(...)`). 1 false positive:
`addyosmani-agent-skills skills/security-and-hardening/SKILL.md:170` —
`origin: process.env.ALLOWED_ORIGINS?.split(',') || 'http://localhost:3000'`, a
CORS configuration default value, not a reference pointing the reader anywhere.
Scored negative rather than argued into a positive, per step 4. 1/20 = 5%.

**`observedRemoteExecution` — zero hits on real data**, matching
`04-RESEARCH.md`'s own prediction exactly. Recorded honestly: untested, not proven
clean. Validated only against the three literal shapes in
`src/analyze/shell.test.ts` and the negative case (all four shell words, no
pipe, no download).

**On v2 it is still zero — over seven repositories and 169 files rather than
four and 84.** No `curl | sh` shape appeared anywhere in the three added
corpora. This is a *larger* absence of data than the v1 row records, and a
larger absence is a stronger statement than a smaller one: the rule has now
been offered twice as much real input and has never once fired on it. It is
still not a measured false-positive rate, and 0% here still means nothing was
measured.

**`observedHiddenContent` — zero hits on real data, both halves.** The
codepoint classes (zero-width, bidi control, Unicode tag, soft hyphen) are
fence-blind and were already measured at zero occurrences across the four
frozen corpora before this plan wrote any code (04-CONTEXT.md Measurement 5 /
7) — present only in the hand-written adversarial fixtures. The
fence-and-code-span-aware HTML-comment rule replaces `html_comment_naive`
(below) and was measured at zero comments surviving the fence/code-span
exclusion — the 26 real comments in the corpus (6 files) are all excluded,
including the one line named below. This is the one requirement in the phase
with no real-world *positive* instance to validate against, same honest shape
as `declaredCapabilities` and `observedRemoteExecution`: recorded as absence
of data, not a measured clean pass. Validated against
`fixtures/adversarial/{hidden-zero-width,hidden-tags,hidden-comment,hidden-comment-visible,bidi,bom}.md`
and, as a corpus regression, against `anthropics-skills
skills/pptx/SKILL.md:15` — `` `<!-- Slide number: N -->` `` inside a
backtick-delimited inline code span in a table cell, the one line a
fence-only version of this rule would still misreport. `src/analyze/hidden.test.ts`
asserts zero findings at that exact path and line, so a regression there is a
regression the corpus scan itself catches.

**On v2 it is also still zero — seven repositories, 169 files.** Same reading as
`observedRemoteExecution` above: a bigger absence, not a better result. Nothing
has been measured about this rule's false-positive rate on real data, and the
0% in its v2 row says so rather than reading as a pass.

**`hidden_style` — never shipped, recorded so it is not silently reintroduced.**
`04-RESEARCH.md` §Q7 proposes hidden-styled HTML (`display:none`,
`font-size:0`, `visibility:hidden`, a bare `hidden` attribute) as a CAP-06
class. Measured over the 84 real bodies: zero style-based hits and exactly
one `hidden` attribute hit —
`wshobson-agents skills/screen-reader-testing/SKILL.md:464`, an ARIA
`<div role="tabpanel" ... hidden>` example inside a skill about accessibility
testing, not concealment. One hit, that hit a false positive, no true
positive anywhere: 1/1 = 100%. Deleted before any code existed, per the same
kill rule as `html_comment_naive` — a rule with a 100% rate on a sample of
one is still a rule that dies by the line, not a rule too small to measure.

## Recall — a floor on a hand-picked sample (05-05)

This measures recall on a hand-selected slice, not true recall against an
unknown ground truth. The lines below were found by a human reading the corpus;
a detector cannot be scored against lines nobody looked for. Every number here
is a **floor** on what the detector finds and says nothing about shapes no one
thought to search for.

It is deliberately outside the table above. A recall figure is not a drift
target the way a hit count is — re-running a detector cannot recompute which
lines a human chose to look for — so these tables carry a column count the
record's parser ignores.

**Two categories were probed. Three were not:** `observedNetwork` (both
`network_request` and `external_reference`), `observedRemoteExecution` and
`observedHiddenContent` have **no recall measurement at all**. Their
false-positive rows say nothing about what they miss.

### `install` — 6 real install directives found, 0 detected

The headline result of this probe, and the most useful line in this file for a
reader asking what the panel misses. All 169 files of `v2` were searched for 21
install-directive shapes outside `INSTALL_PATTERN`'s alternation — `yarn add`,
`yarn global add`, `pnpm add`, `pnpm i`, `pnpm install`, `bun add`,
`bun install`, `cargo install`, `go install`, `gem install`, `apt install`,
`apt-get install`, `poetry add`, `uv sync`, `conda install`,
`dotnet add package`, `composer require`, `choco install`, `winget install`,
`pipx install`, `npm ci`.

Exactly one of those shapes occurs in the corpus at all:

| shape | occurrences | detected | missed | addresses |
|---|---|---|---|---|
| `npm ci` | 6 | **0** | **6** | `addyosmani-agent-skills skills/ci-cd-and-automation/SKILL.md:82`, `:126`, `:150`, `:338`, `:347`, `:356` |
| the other 20 shapes | 0 | — | — | not present in the corpus, so it cannot say whether they would be missed |

`npm ci` installs a project's dependencies from its lockfile. It is an install
directive by any reading, it is in six lines of one file, and the shipped rule
finds none of them. Named by address so a future rule has something concrete to
be tested against rather than a count to be argued with.

### `declaredCapabilities` — 21 of 21 files found

| population | files | detector fired | missed |
|---|---|---|---|
| files whose frontmatter carries an `allowed-tools` field | 21 | **21** | **0** |

Measured against version 2. Three further files contain the literal
`allowed-tools:` only inside documentation examples in their body —
`anthropics-claude-code plugins/plugin-dev/skills/{command-development,plugin-settings,mcp-integration}/SKILL.md`
— and are correctly not counted: they declare nothing, they document how to
declare. That distinction is the probe's one judgment call and it is recorded
rather than folded into the number.

This is a file-level probe, not a grant-level one. It says the analyzer never
fails to fire on a file that declares capabilities; it does not say every grant
within those files is emitted. The version 1 defect above was precisely a
grant-level fault that a file-level recall probe would have scored 21/21 and
called clean — which is why this probe is reported as a floor and not as
validation.
