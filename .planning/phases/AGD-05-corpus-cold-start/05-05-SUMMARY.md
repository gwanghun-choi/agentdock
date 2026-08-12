---
phase: AGD-05-corpus-cold-start
plan: 05
subsystem: capability detector precision measurement
status: complete
tags: [cap-13, precision, corpus, npx, declared-capabilities, recall, tokenizer]
requirements: [CAP-13]
tasks_complete: 2
tasks_total: 2
key-files:
  created:
    - src/analyze/corpora.ts
    - fixtures/anthropics-claude-code/
    - fixtures/disler-hooks-mastery/
    - fixtures/obra-superpowers/
  modified:
    - src/detect/skill.ts
    - src/detect/command.ts
    - src/detect/skill.test.ts
    - src/analyze/declared.ts
    - src/analyze/precision.test.ts
    - scripts/capture-fixtures.mjs
    - scripts/capability-precision.mjs
    - fixtures/capability-precision.md
    - biome.json
migrations_added: 0
actuals:
  tokens: 11278
  tasks: 2
  commits: 0
---

# Phase AGD-05 Plan 05: Expanded Corpus, Detector Re-measurement, and the `npx` Decision

`bun run ci`: **52 test files, 883 tests, all passing** — 882 at wave 4 plus one
new tokenizer test. Zero migrations; `drizzle/` still holds 6 SQL files and
`scripts/migrate.mjs` is unmodified. Nine core requests, exactly the budget.

The corpus went from four repositories and 84 bodies to **seven and 169**. That
expansion did three things the plan expected and one it did not: it gave
`declaredCapabilities` its first real-world instances ever — and they killed it
at 50.9% before a shared-helper fix brought the corrected version to 0%.

---

## The finding, first: the plan's capture instruction would have fabricated a second "absence of data"

Reference D says `bodies: 'all'` for all three new pins. `capture-fixtures.mjs`
filters bodies to `SKILL.md`:

```js
const skills = tree.tree.filter((e) => e.type === 'blob' && e.path.endsWith('SKILL.md'));
if (skills.length === 0) throw new Error(`${pin.slug}: no SKILL.md in the tree`);
```

Measured against the three trees before spending a capture request:

| repository | SKILL.md | what `bodies: 'all'` would have done |
|---|---|---|
| `disler/claude-code-hooks-mastery` | **0** | thrown; captured nothing |
| `anthropics/claude-code` | 10 | 10 skills, **0 of its 18 commands** |
| `obra/superpowers` | 14 | fine, but contributes no commands either |

The second is the consequential one. The plan's own decision 5 chose
`anthropics/claude-code` because *"Commands are where `allowed-tools` lives, so
this is the best chance `declaredCapabilities` has ever had at a real
instance."* Executed as written, the capture would have contained zero command
files, `declaredCapabilities` would have returned zero hits again, and the
record would have gained a **second absence-of-data row caused by the capture
filter rather than by the corpus** — the exact failure the plan's Reference G
exists to prevent, arrived at from the other direction.

This is the fifth plan claim in five waves to die on contact with execution, and
the one with the largest consequence so far. Every previous one cost time; this
one would have written a false fact into the record and closed CAP-13 on it.

### The fix

A per-pin `select` field. Existing pins keep `skills`, so the four v1 corpora
still re-capture byte for byte. New pins use `artifacts`, which asks the shipped
detector registry which paths it would read:

```js
artifacts: (tree) => {
  const needed = new Set(orderedNeeds(collectCandidates(DETECTORS, tree)));
  return tree.filter((e) => e.type === 'blob' && needed.has(e.path));
},
```

No new glob was written, so the captured corpus cannot drift from what
`src/ingest/pipeline.ts` actually ingests — it is the same
`collectCandidates`/`orderedNeeds` pair, which are pure and import only types.

| slug | commit sha | tree entries | artifact paths | bodies | permalink |
|---|---|---|---|---|---|
| `anthropics-claude-code` | `54cc51a08a5d3900e5abd02ad75a2ce46f3f008c` | 333 | 46 | 46 | 200 |
| `disler-hooks-mastery` | `052ad1cbd5aeb1ec4a1def22012d1293c6225625` | 153 | 22 | 22 | 200 |
| `obra-superpowers` | `44c9b2d6e889982ac18c27d05a19fefe335194e1` | 234 | 17 | 17 | 200 |

The script's load-bearing assertion — that the sha the Trees API returns for a
ref is the commit sha and that `blob/<that>/path` resolves — **passed for all
three new repositories**, which is now seven consecutive confirmations of the
finding Phase 1 leaned the whole permalink design on.

---

## Every analyzer, v1 beside v2

| analyzer / scope | v1 hits | v2 hits | contributed by the new corpora |
|---|---|---|---|
| `install` (all signals) | 78 | 87 | 9 |
| `install` — `npx` | 60 | 63 | 3 |
| `install` — `not-npx` | 18 | 24 | 6 |
| `declaredCapabilities` | **0** | **110** → **77** after the fix | all of them |
| `observedNetwork` — `network_request` | 13 | **13** | **0** |
| `observedNetwork` — `external_reference` | 51 | 83 | 32 |
| `observedRemoteExecution` | 0 | **0** | 0 |
| `observedHiddenContent` | 0 | **0** | 0 |

`bunx` = **0** and `uvx` = **0** in both versions.

---

## Task 1 — one declaration of what the corpus is

`src/analyze/corpora.ts` declares `CORPORA_V1` (frozen), `CORPORA_V2`,
`CORPUS_SETS` and `NEWEST_CORPUS_SET`. Both consumers import it and neither
keeps a local array. The sampling script prints which set it sampled on every
run. Each record row's `Corpus` cell leads with its set token and `liveHits`
recomputes against that set, with a fallback to `v1` so a row written before the
change still resolves.

**Every pre-existing row still recomputed to exactly its recorded hit count** —
verified before the set tokens were added and again after.

**05-CONTEXT C4 undercounts by ten.** It says `CORPORA` is declared twice. It is
declared in **twelve** places. `corpora.ts` unifies the two that feed the CAP-13
measurement; the other ten are per-suite arrays each paired with its own
hardcoded assertion about those four corpora, and re-pointing them would
invalidate their numbers for no gain. Left alone, with the reason written into
`corpora.ts`'s own doc so the next reader does not "finish the job".

The `Row` field `category` became `scope`, because it means a category for
`observedNetwork` and a `Finding.signal` for `install`. Two meanings behind one
column is fine; two meanings behind a name claiming one of them is not.

---

## The `npx` decision — separate-claim, two rows, no detector change

`install.ts:44` has always written `signal: match[1]`, so measuring `npx`
separately cost **no detector change** — only rows. Both readings were computed
before any row was written:

| Row | v2 hits | checked | keep-positive | reject-positive |
|---|---|---|---|---|
| `install` (all signals) | 87 | 20 | 2 FP — **10%** | 17 FP — **85%** |
| `install` — `npx` | 63 | 20 | 3 FP — **15%** | 20 FP — **100%** |
| `install` — `not-npx` | 24 | 20 of 24 | 3 FP — **15%** | 3 FP — **15%** |

**Chosen: separate-claim.** The two scoped rows ship, each with its own
hand-checked number, and the all-signals row is kept marked as their sum and as
the label-contested figure. Neither reading had to win and no detector died on a
contested label.

**The residue survives on its own merits, and the extrapolation that said it
would not is falsified.** `04-RESEARCH.md` §Q8 put the non-`npx` rate at 28.6%
from a sample of seven, over the kill line. Measured on twenty of the
twenty-four that exist: **15%**, and all three false positives are the same
already-recorded negation class (`pptx:31`, `docx:21`, `xlsx:16`).

**A prose count and a signal count disagreed.** v1's note says "13 of the 20
hand-checked hits are `npx`" and predicts 75% on rejection. Counted by
`Finding.signal` over those same twenty hits it is **16**, and the rejection
figure is **85%**. The prose count appears to have excluded `"command": "npx"`,
one prose mention, and a bare `npx` in a frontmatter requirements list. The v1
note is left as written — it is the history — and the record now states plainly
which count it uses and why: the signal count is the one the shipped test
recomputes.

`bunx`/`uvx` follow the `npx` row by construction, and the record says they have
**no instances**, not that they are clean.

---

## `declaredCapabilities` — 0% → 70% → 0%, and the rule was applied to each

**v1: 0 hits.** Absence of data, never a clean pass.

**v2, version 1: 110 hits over 21 files — its first real instances ever, and
they failed.** 14 FP in the first twenty (**70%**); checked exhaustively against
every file's own declared grants, **56 of 110 (50.9%)**. Both far over the line.

The defect was not in the analyzer. `toolTokens` split a string-form field on
`/[\s,]+/`:

```
allowed-tools: Bash(git checkout --branch:*), Bash(git add:*)      <- 2 grants
version 1 emitted: Bash(git | checkout | --branch:*) | Bash(git | add:*)
```

A reader saw `declares allowed-tools: add:*)`. Five files fragmented. List form
and space-free string form were always correct — which is exactly why four
corpora containing neither could not see it.

**Root cause, fixed once.** `src/detect/command.ts:32` held a **byte-identical
private copy** of `toolTokens`, and commands are where `allowed-tools` actually
lives — fixing only the exported copy would have left the fault on the artifact
type with the most instances of it. The copy was deleted and `command.ts` now
imports the one implementation. The split is now depth-aware: a delimiter counts
only at parenthesis depth zero, with the depth clamped at zero so a stray `)` in
malformed input cannot disable splitting for the rest of the string.

**v2, version 2: 77 hits, 20 hand-checked against the raw frontmatter, 0 FP —
0%.** The 33-finding drop is exactly the fragments the five files produced.
`DECLARED_VERSION` bumped to `2`, because what the analyzer emits changed and a
rate recorded against version 1 is not a rate about version 2.

**The rule was not waived.** It was applied to the fixed version on its own
measured number. Had version 2 still reached 20% the detector would have been
deleted; it did not, so it ships. Two limits are recorded with the 0%: it is
twenty hits from three files, because only 21 files in seven repositories
declare `allowed-tools` at all; and the exhaustive 77-of-77 agreement is weaker
evidence than the hand-check, because the reference and the fixed implementation
now share the same comma rule.

### The shared-helper blast radius, checked before proceeding

`toolTokens` is Phase 3 code used by `skill.parse` and `command.parse`. The full
suite was re-run before anything else: **52 files, 882 tests, all passing, no
Phase 3 assertion changed.** The skill, command, pipeline and declared suites
specifically: 101 tests, all green. `skill.test.ts`'s existing tokenizer test
(`Read Write, Bash` → three tokens) still passes unchanged. One new test covers
the parenthesised, no-space-after-comma, nested and stray-paren cases plus every
shape that already worked.

---

## The procedure defect: corpus expansion does not re-measure a saturated row

The four v1 corpora are iterated first, so for any analyzer that already had
twenty hits on v1, the procedure's "first twenty" over v2 is the **same twenty
hits** and the rate is arithmetically forced to reproduce itself. `install`
all-signals and `external_reference` both re-measured nothing. Both rows now
carry `first-twenty unchanged from v1` in their own cells, and a seventh step
was added to the procedure so the next expansion samples the new corpora
deliberately.

The new information, hand-checked separately:

| Row | new-corpus hits | checked | FP | Rate |
|---|---|---|---|---|
| `install` | 9 | 9 (all) | 0 | 0% |
| `declaredCapabilities` | 77 (all its hits) | 20 | 0 | 0% |
| `external_reference` | 32 | 32 (all) | 0 | 0% |
| `network_request` | **0** | — | — | **no new evidence at all** |

**`network_request` stays at 2/13 = 15% on no new evidence.** The corpus doubled
from 84 files to 169 and this rule gained zero hits. It is still the closest
margin of any shipped row and the expansion tested it not at all.
`disler-hooks-mastery` contributed no hits in either network category.

One labelling worth naming: a placeholder such as `"url":
"https://api.example.com/mcp"` in a documentation example is scored **positive**,
because the claim the code makes is `references an external URL` and the file
does reference it. v1's lone FP was `http://localhost:3000`, which fails on the
word *external*, not on being a placeholder.

---

## Recall — a floor on a hand-picked sample

Stated in the record's own first sentence: this measures recall on a
hand-selected slice, not true recall against an unknown ground truth. A detector
cannot be scored against lines nobody looked for. Two categories probed, three
not: `observedNetwork` (both), `observedRemoteExecution` and
`observedHiddenContent` have **no recall measurement at all**.

**`install` — 6 real install directives, 0 detected.** All 169 files were
searched for 21 install-directive shapes outside the alternation. Exactly one
occurs: `npm ci`, six times, all in
`addyosmani-agent-skills skills/ci-cd-and-automation/SKILL.md:82,126,150,338,347,356`.
`npm ci` installs a project's dependencies from its lockfile; the shipped rule
finds none of them. Every miss is named by address so a future rule has
something concrete to be tested against. The other 20 shapes have zero
occurrences, so the corpus cannot say whether they would be missed.

**`declaredCapabilities` — 21 of 21 files, 0 missed.** Three further files carry
`allowed-tools:` only inside documentation examples in their body and are
correctly not counted. This is a **file-level** probe: the version 1 defect was a
grant-level fault that this same probe would have scored 21/21 and called clean,
which is why it is reported as a floor rather than as validation.

---

## Zero-instance detectors, over seven corpora rather than four

`observedRemoteExecution` and `observedHiddenContent` are **still zero** across
169 files. No `curl | sh` shape appeared anywhere in the three new corpora. The
record states this as a *larger* absence of data — the rules have now been
offered twice as much real input and have never fired on it — and never as 0%
false positives. `allowed-tools`, by contrast, **did** appear for the first time,
which is what makes its row the one genuinely new measurement in this plan.

---

## Deviations from plan

1. **[Rule 3 — blocking] `bodies: 'all'` replaced with a per-pin `select`.** The
   plan's capture instruction throws on one repository and silently drops the
   commands from the one chosen for its commands. Detailed above.
2. **[Authorized by the maintainer] `toolTokens` fixed in `src/detect/skill.ts`,
   and its duplicate in `src/detect/command.ts` deleted.** Outside
   `files_modified`. Not a narrowing: it makes the rule emit the grants the file
   declares rather than matching less to improve a rate. CAP-13 was then applied
   to the fixed version.
3. **`DECLARED_VERSION` bumped 1 → 2 in `src/analyze/declared.ts`.** Outside
   `files_modified`. The file's own comment mandates it — what the analyzer emits
   changed, so the record's Version column has to distinguish the two rates.
4. **[Rule 3 — blocking] `!fixtures/*/files` added to `biome.json`.** The
   `artifacts` selector puts `.json` manifests in `fixtures/*/files/` for the
   first time and biome would reformat frozen third-party bytes, silently
   changing what every precision row is measured against — surfacing later as
   "drifted from its recorded hit count", blaming the detector. Generalises the
   existing `!fixtures/mcp-registry/list-control-byte.json` precedent.
5. **05-CONTEXT C4 undercounts `CORPORA`'s duplication by ten.** Only the two
   that feed the measurement were unified, deliberately.
6. **The all-signals `install` row was kept** rather than replaced by the two
   scoped rows, marked as their sum and as the label-contested figure.
7. **One new test added** (`skill.test.ts`, the tokenizer). Test count 882 → 883.

**No detector pattern was changed.** `install.ts`, `network.ts`, `shell.ts` and
`hidden.ts` are byte-for-byte unmodified.

---

## Verification checklist (the plan's own list)

| # | Item | Result |
|---|---|---|
| 1 | Three corpora, exact commit shas, bodies captured | pass — 46/22/17 bodies, permalink 200 each |
| 2 | `CORPORA` declared once, imported by both consumers | pass — neither keeps a local copy |
| 3 | Every pre-existing row recomputes against v1 | pass — checked before and after the set tokens |
| 4 | Sampling script prints which set it sampled | pass |
| 5 | `npx` + `not-npx` sum to the unscoped count | pass — 63 + 24 = 87 |
| 6 | Both readings computed before any row written | pass — six numbers, at the checkpoint |
| 7 | `bunx`/`uvx` presented alongside `npx` | pass — zero instances in both versions |
| 8 | Every v2 row satisfies the kill-line test mechanically | pass — and proved non-vacuous: changing 77 to 78 fails the suite |
| 9 | A superseded v1 row says so without tripping the word match | pass — "superseded", which `/deleted/i` does not match |
| 10 | Every 0% row carries the qualifier and names the corpus size | pass — except `declaredCapabilities` v2, whose 0% is a *measured* rate and says so |
| 11 | Recall section leads with its limitation, names misses by address, not parsed | pass — 5- and 4-column tables |
| 12 | No file under `src/analyze/` other than `corpora.ts` and `precision.test.ts` changed | **deliberately not met** — `declared.ts` version bump, deviation 3 |
| 13 | `bun run ci` passes | pass — 52 files, **883 tests** |

---

## Cost

| | measured |
|---|---|
| Core requests | **9** — 3 tree reads (which falsified the capture claim before any capture was spent) + 6 capture. Reference D budgeted 9 |
| Migrations | **0** |
| New fixture bodies | 85 (corpus 84 → 169 files) |
| Test count | 882 → **883** |

The second cost projection in this project to survive contact with execution.

---

## Known ceilings carried forward

- **`network_request` is untested by the expansion.** 13 hits, 2 FP, 15%, the
  closest shipped margin, and zero new evidence from a doubled corpus. The next
  expansion should target files with fetch verbs deliberately.
- **`install` misses `npm ci`** — six real occurrences, none detected. The
  alternation carries no lockfile-install shape.
- **Recall is unmeasured for three of five analyzers**: `observedNetwork` (both
  categories), `observedRemoteExecution`, `observedHiddenContent`.
- **`declaredCapabilities`' recall probe is file-level, not grant-level.** It
  would have scored the version 1 defect 21/21 and called it clean.
- **`declaredCapabilities`' 0% rests on 21 files in seven repositories.** Small,
  and the record says so.
- **Two zero-instance detectors remain** across 169 files. A bigger absence, not
  a better result.
- **`CORPORA` is still duplicated in ten test files**, each with its own
  hardcoded four-corpus assertions.
- **`jobs.test.ts`'s two concurrency tests remain intermittently flaky.** Not
  observed in this wave's three full `ci` runs, all green first time.

---

## Nothing was committed

Working tree left for the maintainer, branch `develop`. `.planning/STATE.md` and
`ROADMAP.md` were **not** advanced — left to the orchestrator, as in waves 1–4.

Recommended commit message:

```
feat(05-05): re-measure every detector on seven corpora, and split the npx claim

- three corpora added (anthropics/claude-code, disler/claude-code-hooks-mastery,
  obra/superpowers), pinned to exact commit shas: 84 -> 169 bodies, nine core
  requests, permalink assertion green on all three
- the plan's `bodies: 'all'` could not run. capture-fixtures.mjs filters bodies
  to SKILL.md; disler has zero of them and would have thrown, and
  anthropics/claude-code would have contributed none of the 18 commands it was
  chosen FOR, writing a second fabricated "absence of data" for
  declaredCapabilities. Body selection is now per-pin, and the new pins ask the
  shipped collectCandidates/orderedNeeds which paths AgentDock actually reads
- src/analyze/corpora.ts: one declaration of what "the corpus" means, imported
  by the sampling script and the record's test. Rows name their set, so every
  Phase 4 number stays true and keeps recomputing against v1
- npx: separate-claim. `install — npx` 63 hits 3 FP 15%, `install — not-npx` 24
  hits 3 FP 15%, both shipped, all-signals kept as their sum and marked
  label-contested. No detector change — signal already distinguished them.
  The residue's measured 15% falsifies §Q8's 28.6% extrapolation from seven.
  A prose count and a signal count disagreed on the v1 sample (13 vs 16, 75% vs
  85%); the record now says which it uses. bunx/uvx: zero instances, recorded as
  no instances rather than as clean
- declaredCapabilities got its first real data ever and it killed the shipped
  version: 110 findings, 70% on the first twenty, 50.9% exhaustive. toolTokens
  split string-form allowed-tools on /[\s,]+/, so `Bash(git add:*)` became two
  fragments that are not grants. command.ts held a byte-identical copy of the
  same defect on the artifact type that carries the most instances of it; both
  are now one depth-aware implementation. Re-measured: 77 findings, 0 FP.
  DECLARED_VERSION 1 -> 2. The kill rule was applied to the fixed version, not
  waived — the full suite was re-run first and no Phase 3 assertion moved
- the procedure had a defect: corpus expansion does not re-measure a saturated
  row, because the older corpora are iterated first and "the first twenty" are
  the same twenty. Affected rows now carry both figures, and step 7 says so
- network_request stays at 2/13 = 15% on ZERO new evidence from a doubled corpus
- recall, a floor on a hand-picked sample: install misses six real `npm ci`
  occurrences and finds none of them; declaredCapabilities finds 21 of 21 files.
  Three analyzers have no recall measurement and the record names them
- observedRemoteExecution and observedHiddenContent still zero across seven
  corpora and 169 files — a larger absence of data, never a clean pass
- biome must not reformat fixtures/*/files: the new corpora put JSON manifests
  there and a reformat would silently change what every precision row measures
- no detector pattern changed. no migration. 52 files, 883 tests
```
