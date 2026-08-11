---
phase: AGD-04-capability-disclosure
plan: 03
subsystem: capability-analysis
tags: [hidden-content, unicode, html-comment, markup-tracker, sentinel, capability-precision, cap-06, cap-07]
status: complete

requires:
  - phase: AGD-04-capability-disclosure
    plan: 01
    provides: "src/analyze/{types,lines,run,index}.ts, the Analyzer type, ANALYZE_CAPS, CAPABILITY_CATEGORIES's hidden_content row, permalinkAtLine"
  - phase: AGD-04-capability-disclosure
    plan: 02
    provides: "fixtures/capability-precision.md, scripts/capability-precision.mjs, src/analyze/precision.test.ts (coverage/drift/kill-line), the already-earned html_comment_naive row"
provides:
  - src/analyze/markup.ts — markupRegions/isInCode/MarkupState, a bounded line-based tracker for fenced blocks and inline code spans, under-reporting by design
  - src/analyze/hidden.ts — observedHiddenContent, sentinelize, HIDDEN_CLASSES, HIDDEN_VERSION — the codepoint classes (fence-blind) plus the fence-and-code-span-aware HTML-comment rule
  - src/analyze/types.ts — Finding.column (optional), populated only by hidden.ts's codepoint classes
  - src/components/HiddenContentPanel.tsx — a pure, DB-free panel rendering sentinel-substituted evidence as escaped JSX text, modeled on JobPanel.tsx
  - src/db/queries/capabilities.ts — splitHiddenContent, so the generic list and the Hidden Content panel never show the same row twice
  - four new fixtures/adversarial/hidden-*.md files plus two new fixtures/capability-precision.md rows (observedHiddenContent shipped, hidden_style deleted)
  - a persist.test.ts assertion that package_version.body retains the raw invisible codepoint after a hidden-content finding is stored (CAP-07's storage half, proven against the database, not the analyzer)
affects:
  - AGD-04-04 (full panel, "not checked" copy, vocabulary lint, backfill) — the vocabulary lint's SANCTIONED-list scan will pass over src/components/HiddenContentPanel.tsx's own copy; the backfill script is what will make this plan's analyzer visible on the existing corpus (item 9 in 04-CONTEXT.md's Binding decisions)

tech-stack:
  added: []
  patterns:
    - "markup.ts is a bounded line-based approximation of CommonMark, not a parser: fence state precomputed once per body into MarkupState[], inline code spans computed per non-fenced line by a linear backtick-run scan — no regex for code spans, the same 'one linear pass, no regex' posture plugin.ts uses for paths, applied to characters"
    - "hidden.ts's HTML-comment rule is the one analyzer in src/analyze/ that scans the whole body in one regex pass rather than per-line via scanLines — safe because the pattern has no nested quantifier and the body is already capped at ANALYZE_CAPS.maxBodyChars before any analyzer runs, the same reasoning frontmatter.ts's own FENCE regex relies on"
    - "sentinel substitution (sentinelize) happens in the analyzer, applied uniformly to every finding's evidenceText — including the comment class, which has no hidden codepoints of its own in the corpus but could in principle — so the panel is a dumb renderer with exactly one substitution site to audit"
    - "HiddenContentPanel takes a permalinkFor function prop rather than importing permalinkAtLine from @/db/queries/packages, because importing that module pulls @/db/client (and its own DATABASE_URL-dependent postgres.js client construction) in at module load — the same reason JobPanel.tsx takes retry as a ReactNode instead of importing a server action"
    - "splitHiddenContent (capabilities.ts) partitions one query's rows by category so the generic 'Observed in this file' list and the Hidden Content panel never duplicate a row; the not-detected/not-analyzed branch still reads the WHOLE finding set, not just the non-hidden subset, so 'not detected' never renders false next to a Hidden Content panel that disagrees with it"

key-files:
  created:
    - src/analyze/markup.ts
    - src/analyze/markup.test.ts
    - src/analyze/hidden.ts
    - src/analyze/hidden.test.ts
    - src/components/HiddenContentPanel.tsx
    - src/components/HiddenContentPanel.test.tsx
    - fixtures/adversarial/hidden-zero-width.md
    - fixtures/adversarial/hidden-tags.md
    - fixtures/adversarial/hidden-comment.md
    - fixtures/adversarial/hidden-comment-visible.md
  modified:
    - src/analyze/index.ts
    - src/analyze/types.ts
    - src/db/queries/capabilities.ts
    - src/app/r/[owner]/[repo]/[...path]/page.tsx
    - src/components/SkillBody.test.tsx
    - src/ingest/persist.test.ts
    - fixtures/adversarial/README.md
    - fixtures/capability-precision.md

decisions:
  - "Finding gained an optional column field (types.ts) rather than stuffing a column offset into metadata — the only analyzer precise enough for a column to mean anything (a single invisible character at a known offset on its line, versus every other detector's whole-matched-phrase granularity) is hidden.ts, so every other analyzer literal in the codebase is unaffected by leaving it unset"
  - "The HTML-comment rule scans the whole (already-capped) body in one regex pass rather than per line via scanLines, the one deliberate divergence from every other analyzer's convention — because an HTML comment can legitimately span multiple lines (the real corpus has exactly one such case, and it happens to sit inside a fence) and the pattern's own safety argument (non-greedy, fixed terminator, no nested quantifier) does not depend on a per-line cap the way a catastrophic-backtracking pattern would"
  - "markupRegions/isInCode take the whole body's precomputed MarkupState[] rather than a per-call (state, line, offset) triple, so a body with many comment matches pays the O(body length) tracking cost once, not once per match — Reference A's illustrative signature was a sketch of the mechanism, not a literal contract, and this shape satisfies the same exports (markupRegions, isInCode, MarkupState) with a cleaner call site"
  - "The generic 'Observed in this file' list's not-analyzed/not-detected branch reads findings.length (the whole set), not observedFindings.length (the non-hidden subset) — an artifact whose only finding is hidden content still needs 'not detected' to be literally true, and it is the Hidden Content panel immediately below that speaks to that case, not a false claim above it"

requirements-completed: [CAP-06, CAP-07, CAP-13, QUA-03, QUA-05]

coverage:
  - id: D1
    description: "A zero-width space, non-joiner, joiner and a soft hyphen each yield one finding carrying their codepoint, line and column; a non-leading U+FEFF yields one finding, a leading one yields none"
    requirement: "CAP-06"
    verification:
      - kind: unit
        ref: "src/analyze/hidden.test.ts — 'the codepoint classes' (all five tests)"
        status: pass
    human_judgment: false
  - id: D2
    description: "bidi.md's U+202E inside description is found (the frontmatter fence is part of body); bom.md's leading byte order mark yields nothing; a Unicode-tag-block character yields one finding per character"
    requirement: "CAP-06"
    verification:
      - kind: unit
        ref: "src/analyze/hidden.test.ts — the bidi.md, bom.md and hidden-tags.md assertions"
        status: pass
    human_judgment: false
  - id: D3
    description: "An HTML comment in ordinary prose yields one finding whose evidence carries its inner text; the same text inside a fenced code block and inside an inline code span yields nothing; a zero-width character inside a fence still yields a finding (fence-awareness is scoped to the comment rule alone); a multi-line comment inside a fence yields nothing"
    requirement: "CAP-06 / CAP-07"
    verification:
      - kind: unit
        ref: "src/analyze/hidden.test.ts — 'the HTML-comment rule' (all four tests)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The four frozen corpora produce zero hidden-content findings, including zero at anthropics-skills skills/pptx/SKILL.md:15 — the one line a fence-only rule would misreport"
    requirement: "CAP-06 / CAP-13"
    verification:
      - kind: unit
        ref: "src/analyze/hidden.test.ts — 'measured against the four frozen corpora'"
        status: pass
    human_judgment: false
  - id: D5
    description: "Every evidence string carries a sentinel and no raw invisible codepoint; no summary contains a word of judgment"
    requirement: "CAP-06 / CAP-07"
    verification:
      - kind: unit
        ref: "src/analyze/hidden.test.ts — 'evidence and wording' (both tests)"
        status: pass
    human_judgment: false
  - id: D6
    description: "A 32 KB body of entirely zero-width characters yields at most maxFindingsPerDetector findings and reports the overflow, via the generic analyzeArtifact cap"
    requirement: "CAP-14"
    verification:
      - kind: unit
        ref: "src/analyze/hidden.test.ts — 'the volume cap'"
        status: pass
    human_judgment: false
  - id: D7
    description: "The panel renders one row per finding with class label, line-anchored permalink and sentinel-substituted evidence; escapes angle brackets, quotes, ampersand and a script tag, creating no element; renders nothing when findings is empty; runs with no database and no browser"
    requirement: "CAP-07"
    verification:
      - kind: unit
        ref: "src/components/HiddenContentPanel.test.tsx (all describe blocks)"
        status: pass
    human_judgment: false
  - id: D8
    description: "package_version.body still contains the raw invisible codepoint after a hidden-content finding is persisted for that version"
    requirement: "CAP-07"
    verification:
      - kind: unit
        ref: "src/ingest/persist.test.ts#capability findings > retains the raw invisible codepoint in package_version.body after a hidden-content finding is stored"
        status: pass
    human_judgment: false
  - id: D9
    description: "src/components/SkillBody.tsx is byte-identical to its state before this plan; SkillBody.test.tsx's two hidden-content assertions are unchanged, with a comment added above each naming the proof they now carry"
    requirement: "CAP-07"
    verification:
      - kind: other
        ref: "git status --porcelain shows no change to SkillBody.tsx at all; git diff on SkillBody.test.tsx shows only two added comment blocks, no assertion line touched"
        status: pass
    human_judgment: true
  - id: D10
    description: "fixtures/capability-precision.md carries a row for the shipped observedHiddenContent analyzer and a row for the deleted hidden_style rule, both hand-checked against the real corpus, and precision.test.ts's coverage/drift/kill-line checks pass with them present"
    requirement: "CAP-13"
    verification:
      - kind: unit
        ref: "src/analyze/precision.test.ts (all three describe-level assertions, re-run with observedHiddenContent registered)"
        status: pass
    human_judgment: true
  - id: D11
    description: "markupRegions/isInCode correctly classify fenced-block lines (both delimiters, tilde and backtick fences, unclosed fences, the 0-3-space allowance) and inline code spans (single and multiple spans per line, an unterminated trailing run), with a fenced line reporting no code spans of its own"
    requirement: "CAP-06 (fence-awareness mechanism)"
    verification:
      - kind: unit
        ref: "src/analyze/markup.test.ts (all describe blocks)"
        status: pass
    human_judgment: false
  - id: D12
    description: "Every analyzer and component added this plan has a direct unit test with no database, no network, no token — hidden.ts and markup.ts import neither @/db nor a network client, and HiddenContentPanel.tsx's only @/db import is type-only (erased at compile time)"
    requirement: "QUA-03"
    verification:
      - kind: unit
        ref: "src/analyze/{markup,hidden}.test.ts, src/components/HiddenContentPanel.test.tsx (none imports @/db or opens a socket at runtime)"
        status: pass
    human_judgment: false

duration: not machine-timed (single continuous session, no per-task timestamps recorded)
completed: 2026-08-11
status: complete

actuals:
  tokens: 13000
  tasks: 2
  commits: 0
---

# Phase AGD-04 Plan 03: Hidden Content — Visible Sentinels, Raw Bytes Retained Summary

A right-to-left override, a zero-width space, a Unicode-tag-block instruction and a fence-and-code-span-aware HTML comment rule are now detected and shown with a named sentinel in a panel that parses nothing — `SkillBody.tsx` untouched, `package_version.body` proven to still hold the raw byte, and the fence-only false-positive that killed the naive comment pattern (`anthropics-skills skills/pptx/SKILL.md:15`) proven to still produce zero findings.

## Not committed

**No `git commit`, `git add`, or `git push` was run**, per this plan's hard constraint. `git status --porcelain` shows every changed file as ` M` or `??`; nothing is staged. Recommended commit message at the bottom.

## Accomplishments

**Task 1 — detection.** `src/analyze/markup.ts`'s `markupRegions`/`isInCode`/`MarkupState` are a bounded line-based tracker, not a Markdown parser: fence state (`^ {0,3}(?:\`{3,}|~{3,})`) is precomputed once per body into one `MarkupState` per line, and inline code spans are found by a linear backtick-run scan over each non-fenced line's characters — no regex, no lookahead. Its own doc states both rejected alternatives to `remark-parse` (a new declared runtime dependency; an unbounded AST parse over untrusted bytes, exactly what CAP-14 bounds) and its two known ceilings (a fence closed by a shorter backtick run than it opened with; a code span containing an escaped backtick — both under-report, never over-report).

`src/analyze/hidden.ts`'s `observedHiddenContent` ships two rule families. The codepoint classes (`HIDDEN_CLASSES`: zero-width, bidi control, Unicode tag, soft hyphen) are fence-blind by design and scan per line via `scanLines`, so every existing cap (`maxLineChars`, truncation-counted-not-dropped) applies unchanged. A leading `U+FEFF` (offset 0 of line 1) is exempted by position, not codepoint — `bom.md` proves it, `bidi.md` proves the frontmatter-is-part-of-body claim by finding `U+202E` on line 3, inside `description:`. The HTML-comment rule replaces the killed `html_comment_naive` pattern with a different claim: a comment `isInCode` says the renderer will not show. It is the one analyzer that scans the whole (already-capped) body in one regex pass rather than per line, because a comment can legitimately span multiple lines and the pattern's own safety (non-greedy, fixed terminator, no nested quantifier) does not need a per-line cap — the same reasoning `frontmatter.ts`'s `FENCE` relies on. `sentinelize` substitutes every hidden codepoint with `[U+XXXX NAME]` and is applied to every finding's `evidenceText` uniformly, comment class included.

`types.ts` gained an optional `Finding.column` field, populated only by `hidden.ts`'s codepoint classes (the one detector precise enough for a column to mean anything); every other analyzer's finding literals are unaffected. `index.ts` registers `observedHiddenContent` as the fifth `ANALYZERS` entry.

**Task 2 — the panel, and the proof it changes nothing else.** `src/components/HiddenContentPanel.tsx` is modeled on `JobPanel.tsx`, not `SkillBody.tsx`: pure, takes `findings: CapabilityFindingView[]` and a `permalinkFor` function prop (rather than importing `permalinkAtLine`, which would pull `@/db/client` in at module load), renders nothing when `findings` is empty, and renders `evidenceText` as a bare JSX text node with no Markdown parser, no `dangerouslySetInnerHTML`, no `rehype-raw` anywhere in the file. `src/db/queries/capabilities.ts` gained `splitHiddenContent`, a pure filter that partitions one query's rows so the generic "Observed in this file" list and the new panel never show the same row twice; the not-detected/not-analyzed branch still reads the *whole* finding set (not just the non-hidden subset), so "not detected" can never render next to a Hidden Content panel that disagrees with it. `page.tsx` renders the panel between "Observed in this file" and "Files". `src/components/SkillBody.tsx` was not opened for editing at any point; `SkillBody.test.tsx` gained one comment block above each of its two hidden-content assertions, naming the proof they now carry together, with no other line in the file touched. `persist.test.ts` gained a database-backed test proving `package_version.body` still contains the raw `U+200B` after a hidden-content finding is stored for that version — CAP-07's storage-retention half, asserted where the claim is either true or false.

## The four new fixtures, and what each produced

| Fixture | Content | Findings |
|---|---|---|
| `hidden-zero-width.md` | ZWSP, ZWNJ, ZWJ, soft hyphen, non-leading BOM — one per line | 5, one per occurrence, signals `U+200B U+200C U+200D U+00AD U+FEFF` in that order |
| `hidden-tags.md` | a 3-character Unicode-tag-block sequence spelling `run` (`U+E0072 U+E0075 U+E006E`) | 3, one per character |
| `hidden-comment.md` | one HTML comment in ordinary prose | 1, evidence carrying the comment's inner text |
| `hidden-comment-visible.md` | the same comment text once fenced, once in an inline code span | 0 — the negative case the CAP-13 measurement earned |

Two pre-existing fixtures join the suite's coverage without modification: `bidi.md` (1 finding, `U+202E`, line 3, inside `description`) and `bom.md` (0 findings, the leading-BOM exemption).

## The CAP-13 measurement — two new rows

| Analyzer | Hits | Hand-checked | FP | Rate | Verdict |
|---|---|---|---|---|---|
| `observedHiddenContent` | 0 | 0 (no real instance) | 0 | 0% | shipped, no corpus validation |
| `hidden_style` | 1 | 1 | 1 | 100% | **deleted** |

`observedHiddenContent` measured zero hits across all four frozen corpora for both halves: the codepoint classes (already known from 04-CONTEXT.md Measurement 5/7) and, newly measured this plan, the fence-and-code-span-aware comment rule — the 26 real comments in 6 files are all excluded (25 fenced, 1 in an inline code span), confirmed at the exact regression line `anthropics-skills skills/pptx/SKILL.md:15` (`` `<!-- Slide number: N -->` `` inside a backtick-delimited table cell). This is the one requirement in the plan with no real-world *positive* instance to validate against — recorded honestly as absence of data, the same shape as `declaredCapabilities` and `observedRemoteExecution` from 04-02.

`hidden_style` (hidden-styled HTML — `display:none`, `font-size:0`, a bare `hidden` attribute) is recorded as never shipped: one hit in 84 real bodies, and that hit — `wshobson-agents skills/screen-reader-testing/SKILL.md:464`, `<div role="tabpanel" ... hidden>` — is a legitimate ARIA accessibility pattern, not concealment. 1/1 = 100%, deleted before any code existed, per the same kill rule as `html_comment_naive`.

## Sentinel strings shipped

`[U+200B ZERO WIDTH SPACE]`, `[U+200C ZERO WIDTH NON-JOINER]`, `[U+200D ZERO WIDTH JOINER]`, `[U+FEFF ZERO WIDTH NO-BREAK SPACE]`, `[U+00AD SOFT HYPHEN]`, `[U+202A LEFT-TO-RIGHT EMBEDDING]` through `[U+202E RIGHT-TO-LEFT OVERRIDE]`, `[U+2066 LEFT-TO-RIGHT ISOLATE]` through `[U+2069 POP DIRECTIONAL ISOLATE]`, and `[U+E0000 UNICODE TAG]` through `[U+E007F UNICODE TAG]` for every codepoint in the Unicode Tag block (one shared name, 128 codepoints, rather than a 128-entry table). An unrecognised codepoint outside every named class never reaches `sentinelize` in the first place — `classify()` returns `undefined` and the character passes through unchanged.

## The markup tracker's observed ceilings

Both stated in `markup.ts`'s own doc comment, neither newly discovered this session: (1) a fence opened with a longer backtick/tilde run than its closer is matched by the same three-character prefix regardless of run length, so a closer shorter than its opener still closes the fence — CommonMark requires the closer to be at least as long, and this under-reports by treating the block as closed early; (2) a code span containing an escaped backtick is not honoured — every backtick is treated as a run boundary with no backslash-escape awareness, so an odd stray backtick can close a span early. Both ceilings under-report (move text OUT of "is code", never in), the deliberately chosen bias given the naive comment pattern's own 26/26 measured false-positive rate.

## Deviations from Plan

### Auto-fixed / necessary companion decisions

**1. [Rule 2 — missing critical] `Finding` needed a `column` field the plan's must_haves named but the existing type had nowhere to put**

- **Found during:** Task 1, implementing the codepoint-class findings.
- **Issue:** the plan's own `<behavior>` requires "each yields one finding carrying their codepoint, line and column," but `Finding` (04-01) has no column field — only `startLine`/`endLine`.
- **Fix:** added `column?: number | null` to `Finding` in `types.ts`, documented as populated only by detectors precise enough for a column to mean something (hidden.ts's codepoint classes). Optional, so every existing analyzer literal (install, network, shell, declared) is unaffected.
- **Files:** `src/analyze/types.ts`.
- **Verification:** `src/analyze/hidden.test.ts` — every codepoint-class finding asserts `typeof f.column === 'number'`.

**2. [Rule 1 — mechanical] Numeric object keys in `CODEPOINT_NAMES` were reformatted from hex to decimal by the project's own formatter**

- **Found during:** Task 1, running `bun run ci` for the first time.
- **Issue:** `biome check --write .` normalizes numeric object-literal keys to their canonical decimal form (`0x200b` → `8203`), which is standard JS key-normalization behaviour the formatter enforces project-wide, not a bug in the written code.
- **Fix:** kept the formatter's decimal form (fighting it would mean disabling a project-wide rule for one file) and added a `// U+200B` style comment beside each entry so the hex identity stays legible.
- **Files:** `src/analyze/hidden.ts`.
- **Verification:** `bun run lint` clean; `src/analyze/hidden.test.ts`'s sentinel assertions pass against the same table.

### Deliberately scoped decisions (not deviations, but worth stating)

**`markupRegions`/`isInCode` take the whole body's precomputed `MarkupState[]`, not the per-call `(state, line, offset)` triple Reference A's illustrative type sketch showed.** The exports (`markupRegions`, `isInCode`, `MarkupState`) and the mechanism (bounded, linear, under-reporting bias) match the reference exactly; the call shape is a cleaner realization of the same idea — one `O(body length)` pass computed once, consulted per match, rather than re-deriving fence state on every call. `ponytail: if a future caller genuinely needs a streaming, one-line-at-a-time API, add it then — nothing in this plan's must_haves requires it.`

**The not-detected/not-analyzed branch on "Observed in this file" reads the whole `findings` set, not `observedFindings`.** Not explicitly specified by the plan, but necessary for CAP-11's own honesty rule to keep holding under `splitHiddenContent`: an artifact whose only finding is hidden content must not render "not detected" immediately above a Hidden Content panel that shows something. Documented in a page.tsx comment at the point it matters.

## Migration

None. This plan is pure `src/analyze/`, `src/components/`, `src/db/queries/` and page code, tests, and fixtures — no schema change. `git diff scripts/migrate.mjs` is empty; `src/db/schema.ts` carries no new change from this plan (its existing diff is entirely 04-01's `capability_finding` table, untouched here).

## Verification run (in the required order)

| Command | Result |
|---|---|
| `bun run check:boundaries` | `6 migration file(s), package.json, 1 schema module, 58 source file(s)` — OK |
| `bun run lint` | clean (`biome check --write .` applied formatting to 6 newly-created/modified files once, then clean) |
| `bun run typecheck` | clean |
| `bun run test` | **668 passed** across **41 files** (baseline was 632/38 — +36 tests, +3 files, 0 regressions) |
| `bun run ci` | all four gates above, in sequence, all green (668/668), run twice to confirm stability after the page.tsx not-detected fix |

## Requirements satisfied

| ID | Evidence |
|---|---|
| CAP-06 | `hidden.ts`: all four codepoint classes plus the fence-and-code-span-aware comment rule; hidden-styled HTML measured and recorded as unimplemented (`hidden_style` row) rather than silently dropped |
| CAP-07 | Every finding's `evidenceText` carries a sentinel, never a raw invisible codepoint; `package_version.body` proven (against the database) to retain the raw byte after a finding exists; `HiddenContentPanel.tsx` is the one place a reader sees it, parsing nothing |
| CAP-13 | `observedHiddenContent` and `hidden_style` both hand-checked and recorded in `fixtures/capability-precision.md`; `precision.test.ts`'s coverage/drift/kill-line checks pass with both rows present |
| QUA-03 / QUA-05 | `markup.ts`/`hidden.ts` have direct, DB-free, network-free, token-free unit tests; four new hidden-content fixtures join the permanent adversarial suite with README rows |

## Known Stubs

None. `HiddenContentPanel` is wired into the live page against real query data (`splitHiddenContent(findings)`), not a placeholder; every new analyzer is registered and exercised by the existing `analyzeArtifact` pass.

## Next Phase Readiness

- `src/analyze/index.ts`'s `ANALYZERS` array now carries five analyzers; 04-04 registers nothing new into it (its scope is the vocabulary lint, the "not checked" copy, and the backfill script).
- `fixtures/capability-precision.md` has eight rows; 04-04 does not need to append to it (no new detector ships there).
- `analyzePackageVersion(id)` and the bulk backfill script (04-CONTEXT.md Binding decision 9) are **not** built here — every `package_version` row that already existed before a fresh ingest still reads `analyzed_at: null`, and this plan's `observedHiddenContent` findings are only visible on freshly-ingested content until 04-04 ships the backfill.
- No blockers. `bun run ci` is green (668/668); no migration to apply; nothing is staged for commit.

## Recommended commit message (not executed)

```
feat(04-03): hidden content — visible sentinels, raw bytes retained

- src/analyze/markup.ts: markupRegions/isInCode/MarkupState — a bounded
  line-based tracker for fenced blocks and inline code spans, under-report
  biased, no Markdown parser
- src/analyze/hidden.ts: observedHiddenContent/sentinelize/HIDDEN_CLASSES —
  the codepoint classes (fence-blind) plus the fence-and-code-span-aware
  HTML-comment rule that replaces the killed html_comment_naive pattern
- src/analyze/types.ts: Finding.column (optional), populated by hidden.ts only
- src/analyze/index.ts: register observedHiddenContent as the fifth analyzer
- src/components/HiddenContentPanel.tsx: a pure, DB-free panel rendering
  sentinel-substituted evidence as escaped JSX text, modeled on JobPanel.tsx
- src/db/queries/capabilities.ts: splitHiddenContent
- src/app/r/[owner]/[repo]/[...path]/page.tsx: wire the panel in; the
  not-detected branch now reads the whole finding set, not the non-hidden
  subset
- src/components/SkillBody.test.tsx: comment above the two hidden-content
  assertions naming the proof they now carry; SkillBody.tsx untouched
- src/ingest/persist.test.ts: assert package_version.body retains the raw
  codepoint after a hidden-content finding is stored
- fixtures/adversarial/hidden-{zero-width,tags,comment,comment-visible}.md,
  README.md: the four new fixtures
- fixtures/capability-precision.md: observedHiddenContent (shipped) and
  hidden_style (deleted) rows
```

## Self-Check: PASSED

- All 10 created files exist on disk (`src/analyze/{markup,markup.test,hidden,hidden.test}.ts`, `src/components/{HiddenContentPanel,HiddenContentPanel.test}.tsx`, `fixtures/adversarial/hidden-{zero-width,tags,comment,comment-visible}.md`) — confirmed via the tool calls that created them and via the passing test suites that read them.
- `bun run ci` passed in full, twice: boundaries OK, lint clean, typecheck clean, 668/668 tests across 41 files.
- `fixtures/capability-precision.md`'s two new rows are hand-verified against the real corpus (the `hidden_style` line number confirmed at `wshobson-agents .../screen-reader-testing/SKILL.md:464`, the pptx regression confirmed at `anthropics-skills skills/pptx/SKILL.md:15`) and `precision.test.ts` passes against them.
- `git status --porcelain` shows every changed/new path as ` M` or `??`, none staged — nothing was `git add`ed at any point in this session; no commit or push was run. `src/components/SkillBody.tsx` shows no change at all.

---
*Phase: AGD-04-capability-disclosure*
*Plan: 03*
*Completed: 2026-08-11*
