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

| Analyzer | Version | Corpus | Hits | Hand-checked | FP | Rate | Verdict |
|---|---|---|---|---|---|---|---|
| `html_comment_naive` | n/a — never shipped | 4 frozen corpora, 6 files | 26 | 26 | 26 | 100% | **deleted** |
| `install` | 1 | 4 frozen corpora | 78 | 20 | 2 | 10% | shipped |
| `declaredCapabilities` | 1 | 4 frozen corpora | 0 | 0 (no real instance) | 0 | 0% | shipped, no corpus validation |
| `observedNetwork` — `network_request` | 1 | 4 frozen corpora | 13 | 13 (fewer than 20 exist) | 2 | 15% | shipped |
| `observedNetwork` — `external_reference` | 1 | 4 frozen corpora | 51 | 20 | 1 | 5% | shipped |
| `observedRemoteExecution` | 1 | 4 frozen corpora | 0 | 0 (no real instance) | 0 | 0% | shipped, precision untested |
| `observedHiddenContent` | 1 | 4 frozen corpora | 0 | 0 (no real instance) | 0 | 0% | shipped, no corpus validation |
| `hidden_style` | n/a — never shipped | 4 frozen corpora | 1 | 1 | 1 | 100% | **deleted** |

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

**`declaredCapabilities` — CAP-02's own honest state.** `allowed-tools` appears
zero times across the four frozen corpora (Measurement 6). This is the one
requirement in the phase with no real-world instance to validate against; the 0%
is not a measured rate on real data, it is the absence of data, and is recorded as
such rather than presented as a clean pass. Validated only against
`fixtures/adversarial/tools-list.md` (YAML list) and `allowed-tools-coarse.md`
(coarse `Bash(*)`, asserting exactly one un-decomposed finding).

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
