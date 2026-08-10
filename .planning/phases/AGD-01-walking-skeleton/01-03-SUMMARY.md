---
phase: AGD-01-walking-skeleton
plan: 03
subsystem: detection-and-parsing
tags: [yaml, frontmatter, alias-bomb, fixtures, tolerant-parse]
status: complete

requires:
  - 01-01 (js-yaml@4.3.1, scripts/capture-fixtures.mjs, fixtures/anthropics-skills)
provides:
  - src/detect/types.ts — Detector / Candidate / ParseResult / DetectedArtifact
  - src/detect/frontmatter.ts — splitFrontmatter / parseFrontmatter / FRONTMATTER_CAPS
  - src/detect/skill.ts — the skill detector, SPEC_KEYS
  - src/detect/index.ts — DETECTORS, the one-line registry Phase 3 appends to
  - fixtures/addyosmani-agent-skills, fixtures/baoyu-skills, fixtures/wshobson-agents
  - fixtures/adversarial/ — 20 hand-written hostile frontmatter files
affects:
  - scripts/capture-fixtures.mjs (3 new pins)

tech-stack:
  added: []
  patterns:
    - The specification is a conformance report, never a schema
    - Two size caps, because an input cap does not stop an alias bomb
    - Detection is path-only, so a repository with no skills costs zero file reads

key-files:
  created:
    - src/detect/types.ts
    - src/detect/frontmatter.ts
    - src/detect/frontmatter.test.ts
    - src/detect/skill.ts
    - src/detect/skill.test.ts
    - src/detect/index.ts
    - fixtures/adversarial/ (20 fixtures + README.md)
    - fixtures/addyosmani-agent-skills/ (24 bodies)
    - fixtures/baoyu-skills/ (22 bodies)
    - fixtures/wshobson-agents/ (20 of 180 bodies)
  modified:
    - scripts/capture-fixtures.mjs

decisions:
  - The alias bomb is SIX alias levels, not eight — eight takes the suite down with it
  - A JSON.stringify RangeError reports the serialized cap, because that IS the expansion
  - The serialized cap measures UTF-8 bytes, not UTF-16 code units

metrics:
  duration: ~30m
  completed: 2026-08-10

actuals:
  tokens: 52000
  tasks: 3
  commits: 0
---

# Phase AGD-01 Plan 03: Detection and Tolerant Parsing Summary

A `SKILL.md` reader that indexes the corpus as it actually exists — all 84
captured real files parse and none is dropped — behind a YAML loader that refuses
code construction and unbounded expansion, with the size cap applied to the
serialized output as well as the input.

## Not committed

**No `git commit` or `git push` was run.** The maintainer commits.

## What was verified, with real output

| Command | Result |
|---|---|
| `bun run fixtures:capture addyosmani-agent-skills baoyu-skills wshobson-agents` | see the table below — all three permalinks 200 |
| `bun run typecheck` | clean |
| `bun run test` | 12 files, **184 passed** |
| `bun run check:boundaries` | `23 source file(s)` → OK |
| `bun run ci` | boundaries OK, biome clean, tsc clean, 184 passed |
| `CI=1 bun run test` | `175 passed \| 9 skipped` — no database, no network |

Capture output, verbatim:

```
addyosmani-agent-skills: 261 entries, 24 SKILL.md, 24 bodies captured, permalink 200
baoyu-skills: 1077 entries, 22 SKILL.md, 22 bodies captured, permalink 200
wshobson-agents: 1992 entries, 180 SKILL.md, 20 bodies captured, permalink 200
```

**Core requests spent: 6** (two per repository). The 66 body fetches went to
`raw.githubusercontent.com`, which costs no core quota. Every pinned SHA was
confirmed to be a **commit** SHA by the blob-permalink assertion in the capture
script — three more independent confirmations of the finding this phase rests on.

## Measured match and parse counts per corpus

Every number below is what the code actually produced, not what the plan
predicted — and they agree.

| Corpus | Tree entries | `match()` | Bodies | ok | partial | failed |
|---|---|---|---|---|---|---|
| `anthropics-skills` | 501 | **18** | 18 | 16 | **2** | 0 |
| `addyosmani-agent-skills` | 261 | **24** | 24 | **24** | **0** | 0 |
| `baoyu-skills` | 1,077 | **22** | 22 | 1 | **21** | 0 |
| `wshobson-agents` | 1,992 | **180** | 20 sampled | 14 | 6 | 0 |

**Nothing failed anywhere in 84 real files.** The two partials in the reference
repository are exactly the two specification violations the research predicted:

| File | Warning |
|---|---|
| `skills/claude-api/SKILL.md` | `description is 1068 characters, over 1024` |
| `template/SKILL.md` | `name "template-skill" does not match directory "template"` |

A strict schema would have discarded both. Neither is dropped; both are stored
with the warning attached.

`baoyu-skills` produces 21 partials, all of them the same warning — `keys outside
the specification: version` — which is where the declared version is read from. It
is the field that appears in no specification and in a quarter of the corpus; it
is read where present and `null` otherwise, never synthesized.

**The clean-baseline assertion is the important one.** All 24 `addyosmani`
files produce **zero warnings**. If that ever fires, the conformance checker has
drifted strict — not the corpus. Without it, every warning added later would look
correct because something always does.

## The alias bomb, measured

`fixtures/adversarial/alias-bomb.md` — real numbers from this machine:

| | |
|---|---|
| File on disk | **319 bytes** |
| Frontmatter block | 303 bytes — the 64 KB input cap can never fire |
| `yaml.load` | **2.62 ms** |
| `JSON.stringify` | 8.7 ms |
| Serialized output | **2,541,062 bytes (2.4 MB)** |
| Refused by | the **256 KB serialized cap** |

That is the whole argument for the second cap in one row: 319 bytes in, 2.4 MB
out, parsed in under three milliseconds. An input cap alone never sees it.

## Deviations from Plan

### 1. The alias bomb is six alias levels, not eight

Reference F specifies "eight levels of nine-way aliases". Nine to the eighth is
43 million leaves; serializing that does not finish, it exhausts the heap and
takes the test suite with it. Six levels is 531,441 leaves → **2.4 MB serialized
in 8.7 ms**, which is ten times past the 256 KB cap and still instant.

It remains **under a kilobyte on disk** (319 bytes), which is the property that
actually matters: a bomb large enough to trip the input cap would be testing the
wrong control entirely. Recorded in `fixtures/adversarial/README.md` beside the
fixture.

### 2. A `JSON.stringify` RangeError reports the serialized cap

Reference C returns `'frontmatter could not be serialized'` when stringify
throws. But the only realistic way stringify throws on plain data is a string
longer than V8's maximum — which **is** the expansion the cap exists to stop.
Reporting it as an unrelated serialization problem would send whoever hits it
looking in the wrong place, so both paths now return
`'frontmatter expands beyond the serialized size cap'`.

### 3. The serialized cap measures UTF-8 bytes

Reference C compares `serialized.length`, which counts UTF-16 code units. The
constant is named `serializedBytes`. For a CJK-heavy document those differ by up
to 3×, so `Buffer.byteLength(serialized, 'utf8')` is used instead — the cap now
means what it is named.

### 4. A twentieth adversarial fixture

`timestamp.md` was added beyond the plan's nineteen. The plan's behaviour list
requires "a timestamp-shaped value comes back as a string, not as a date object",
and a behaviour with no fixture is not a regression. It also covers the merge key
(`<<`), which the core schema does not define — asserted to survive verbatim
rather than expanding an alias.

### 5. `normalizeRepo`-style edge case in `match()`

Added a case the plan does not list but which the requirement implies: a tree
entry of type `tree` whose path is `x/SKILL.md` is a directory, not a manifest,
and must not match. Along with `SKILL.md.bak`, `MY-SKILL.md` and lowercase
`skill.md`.

### 6. Per-task commits skipped

Forbidden by the phase's hard constraints.

## Requirements satisfied

| ID | Evidence |
|---|---|
| DET-01 | 244 skills matched across four corpora by path alone; 84 real bodies parsed, none dropped |
| DET-08 | `yaml.CORE_SCHEMA` set explicitly; `js-function.md` refused by the loader; both caps enforced with the sub-kilobyte bomb proving the second |
| DET-10 | Every detector test reads frozen fixtures; `CI=1 bun run test` passes with no network, no token, no database |
| QUA-03 | Fence splitting, the conformance checker, and slug/name derivation each have unit tests |
| QUA-05 | 20 adversarial fixtures are permanent regressions, including the bomb, the 100 KB block, and the invisible-character cases |
| PRV-05 | `declaredVersion` is read only from a `version` field that exists; all 18 reference files yield `null` |
| PRV-06 | `licenseText` holds frontmatter prose (`Complete terms in LICENSE.txt`) and never feeds an SPDX column — asserted |

## Known Stubs

| Stub | File | Reason |
|---|---|---|
| `Candidate.parentPath` declared, never set | `src/detect/types.ts` | Phase 3 fills it for the plugin and catalog layouts. There is nothing to put there with one detector. |
| `meta.allowedTools` stored, never interpreted | `src/detect/skill.ts` | What a token permits is Phase 4's problem; guessing now would put a judgement into a phase with no way to check it. |
| Only 20 of 180 `wshobson-agents` bodies captured | `fixtures/wshobson-agents/` | `match()` reads an in-memory array and never opens a file, so the tree alone tests the scale case. |
| Detector output is not yet wired to `persistScan()` | — | The pipeline that joins `src/github/` → `src/detect/` → `src/ingest/` is a later plan's. |

## Notes for later plans

- Invisible characters are **retained byte for byte**. A bidi override survives
  from the fixture through the parser into the stored summary; a later phase
  needs those bytes in order to surface them.
- Duplicate YAML keys throw, and that lands the file in the failed state. It is
  correct: two values for one key means the file has no single meaning.
- The registry is one array with one element. Adding an artifact type should be
  one file and one array element.

## Self-Check: PASSED

All six source files and the four fixture directories exist on disk. Nothing was
committed, by constraint.
