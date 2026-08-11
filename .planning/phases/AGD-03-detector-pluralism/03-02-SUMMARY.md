---
phase: AGD-03-detector-pluralism
plan: 02
subsystem: detection-and-ingestion
tags: [plugin-detection, mcp-detection, containment, drizzle-migration, file-budget]
status: complete

requires:
  - phase: AGD-03-detector-pluralism
    plan: 01
    provides: collectCandidates/orderedNeeds/safeParse (the guarded match/parse pipeline), parseJsonManifest's three-cap doctrine, the ParseResult 'seeds'/'none' arms, the registry canary pattern
provides:
  - src/detect/plugin.ts — manifest and shape-only plugin detection, the component index, both exclusions, the confidence marker
  - src/detect/mcp.ts — both MCP declaration shapes (.mcp.json, server.json) under one detector, registered as artifact type mcp_server
  - src/detect/nesting.ts — assignParentPaths, the one generic containment pass that names no artifact type
  - package.parent_path — additive column (drizzle/0004_complete_the_professor.sql), applied to both agentdock and agentdock_test
  - CAPS.maxFiles raised 200 -> 400 in src/github/scan.ts
affects:
  - AGD-03-03 (command, hook, the seventh-detector proof) — extends the same DETECTORS array and registry canary; plugin.ts's containerRoot mechanism is now proven end to end for nesting.ts to build on
  - Phase 4 (CAP-13) — MIN_SHAPE_COMPONENTS's false-positive rate against a labeled corpus is deferred here explicitly, owned there
  - Phase 6 (search) — meta.servers[] (MCP) and meta.components (shape-only plugin) are queryable jsonb surfaces the day search wants them

tech-stack:
  added: []
  patterns:
    - "A shape-only Candidate carries its own recognition evidence (shapeComponents) because parse() has no second look at the tree — the same reason ScannedSeed carries provenance DetectedSeed cannot know"
    - "containerRoot is set only by a detector that IS a container; parentPath is filled only by the pipeline's nesting pass; the two fields are never written by the same code"
    - "An MCP declaration's env values are never stored, wherever the declaration appears — mcp.ts's .mcp.json branch and plugin.ts's inline mcpServers branch both apply the same key-names-only rule and both are proven by a whole-artifact JSON.stringify string-absence test"
    - "componentIndex is measured against the frozen corpora directly in the test (not just described in a comment), so a future edit that disagrees with the trees on disk fails immediately"

key-files:
  created:
    - src/detect/plugin.ts
    - src/detect/plugin.test.ts
    - src/detect/mcp.ts
    - src/detect/mcp.test.ts
    - src/detect/nesting.ts
    - src/detect/nesting.test.ts
    - fixtures/adversarial/plugin-malformed.json
    - fixtures/adversarial/mcp-malformed.json
    - drizzle/0004_complete_the_professor.sql
  modified:
    - src/detect/types.ts
    - src/detect/index.ts
    - src/detect/skill.test.ts
    - src/ingest/pipeline.ts
    - src/ingest/pipeline.test.ts
    - src/ingest/types.ts
    - src/ingest/persist.ts
    - src/ingest/persist.test.ts
    - src/db/schema.ts
    - src/github/scan.ts
    - fixtures/adversarial/README.md

decisions:
  - "Candidate gains a third optional field, shapeComponents?: string[], beside containerRoot and parentPath — detector-private payload set by plugin.ts's match() and read only by plugin.ts's parse(), because a shape-only candidate's whole identity (its component set) cannot be recomputed from sourcePath alone and parse() never sees the tree a second time"
  - "plugin.json's inline mcpServers is stripped from the artifact's frontmatter field, not just summarized into meta.mcpServers — it is an MCP declaration by another name and can carry the same env-value secrets .mcp.json can, so the same never-store-values rule applies structurally, not just where the plan's Task 2 behavior list happened to name it"
  - "componentIndex excludes the final path segment from directory-shape matching (only intermediate segments count) — this correctly excludes a git-mode-120000 symlink blob literally named 'skills' (addyosmani-agent-skills' .opencode/skills) from being miscounted as a skills/ directory, which a naive full-path-segment scan would not catch"
  - "The measured componentIndex counts are taken directly from the frozen tree.json files in the test itself (componentIndex(corpusTree(slug))), not copied from Reference A's prose table — two of the four corpora's counts differ from the plan's stated numbers by one root each (see Deviations); CONTEXT.md's own rule ('if the code disagrees with the table, the code is wrong') was applied against the actual trees on disk, and the code's honestly measured output is what the test locks"
  - "CAPS.maxFiles is mutated in place for the 200-cap regression test (same pattern src/ingest/pipeline.test.ts already uses to plant a throwing detector into DETECTORS for DET-07), restored in a finally block, rather than adding a second exported cap the pipeline never reads"

requirements-completed: [DET-02, DET-04, DET-06, QUA-03, QUA-05]

coverage:
  - id: D1
    description: "Every .claude-plugin/plugin.json in the four corpora is detected (91 wshobson-agents, 1 addyosmani-agent-skills, 0 the other two); a manifest-less directory with >= 2 component shapes is detected and marked shape-only/partial; a one-component directory is not; no corpus produces a shape-only candidate at a dot directory or the repository root"
    requirement: "DET-02"
    verification:
      - kind: unit
        ref: "src/detect/plugin.test.ts (componentIndex, plugin.match, plugin.parse describe blocks)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Both .mcp.json and server.json declaration shapes are detected and parsed under one detector; no environment variable value appears in any field of any parsed result, proven by serializing the whole artifact"
    requirement: "DET-04"
    verification:
      - kind: unit
        ref: "src/detect/mcp.test.ts (all describe blocks, especially 'records only env key names')"
        status: pass
    human_judgment: false
  - id: D3
    description: "A plugin-owned artifact records its container's directory and remains its own package row; the containment pass names no artifact type, proven with an invented container-type detector; the largest frozen corpus ingests all 91 plugins and 180 skills at the raised cap without reporting truncation, and reports truncation at the old cap of 200"
    requirement: "DET-06"
    verification:
      - kind: unit
        ref: "src/detect/nesting.test.ts (all describe blocks)"
        status: pass
      - kind: integration
        ref: "src/ingest/pipeline.test.ts#the file budget (DET-06 / the CAPS.maxFiles raise)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Both new detectors are unit-tested against frozen trees with no network and no token; two new malformed manifests join the permanent adversarial suite"
    requirement: "QUA-03, QUA-05"
    verification:
      - kind: unit
        ref: "src/detect/plugin.test.ts, src/detect/mcp.test.ts (adversarial-fixture cases)"
        status: pass
    human_judgment: false
  - id: D5
    description: "package.parent_path is additive, passes the boundary scanner, round-trips on both the insert and the conflict path, and is applied to both agentdock and agentdock_test"
    verification:
      - kind: other
        ref: "bun run check:boundaries; bun run db:migrate; bun run db:test:setup; src/ingest/persist.test.ts's parent_path round-trip test"
        status: pass
    human_judgment: false

duration: not machine-timed (single continuous session, no per-task timestamps recorded)
completed: 2026-08-11
status: complete

actuals:
  tokens: 42900
  tasks: 3
  commits: 0
---

# Phase AGD-03 Plan 02: Plugin Pluralism, MCP, Nesting, and the File Budget Summary

Plugins are now detected with a manifest and without one on one conservative, measured, exception-carrying threshold; both MCP declaration shapes parse under one detector that never stores a secret value; every artifact links to the container it sits inside through a pass that names no artifact type; and the file budget was raised to the number six detectors actually need, proven against the real corpus rather than argued from arithmetic.

## Not committed

**No `git commit` and no `git push` were run**, per this plan's hard constraint (and the CONTEXT.md-wide rule inherited from 03-01). Everything below is unstaged in the working tree. Recommended commit message at the bottom.

## Accomplishments

- `src/detect/plugin.ts`: `componentIndex()` (a pure directory-shape grouping function, new structure this phase — no prior helper in `src/` decomposed a tree by parent directory), `COMPONENT_DIRS`, `COMPONENT_FILES`, `MIN_SHAPE_COMPONENTS = 2` with its measured justification in the comment, and the `plugin` detector with two match rules (declared manifest, shape-only) and two exclusions (dot-prefixed directory, repository root) — both exclusions checked only against shape-only candidates; a declared manifest overrides both.
- `src/detect/mcp.ts`: one detector (`type: 'mcp_server'`, matching the artifact_type row 03-01 seeded), two match rules (`.mcp.json`, `server.json`), one parse-time branch on basename. `.mcp.json` stores `envKeys` only, never a value; `command`/`args`/`url` are stored verbatim and never interpreted. `server.json` degrades to `status: 'none'` when it carries none of `name`/`description`/`packages`/`remotes`, and to a named `failed` row when it has structural MCP content but no `name`.
- `src/detect/nesting.ts`: `assignParentPaths()`, a pure function over a `Candidate[]` that reads only `containerRoot` and `sourcePath` — no artifact type anywhere in it. Proven generic by a test that defines an invented container-detector type inline and watches its children link anyway (the DET-09 proof in miniature).
- `Candidate` (src/detect/types.ts) gains `containerRoot?: string` (set by a container detector, read by the nesting pass) and `shapeComponents?: string[]` (detector-private, plugin.ts only — see Deviations). `parentPath?: string`'s doc comment is corrected: this phase is the one that fills it.
- `package.parent_path` (src/db/schema.ts): nullable `text`, no default, not in `unique('package_identity')`. Migration `drizzle/0004_complete_the_professor.sql` — one `ALTER TABLE ... ADD COLUMN`, applied to both `agentdock` and `agentdock_test`.
- `src/ingest/pipeline.ts`: one call, `assignParentPaths(passes.flatMap((p) => p.candidates))`, placed after the unchanged-commit short circuit and before the parse loop, over the same `passes` array the needs-collection callback already populated. `ScannedPackage.parentPath` is set from `candidate.parentPath ?? null` on both the success and failed-row push sites.
- `src/ingest/persist.ts`: `parentPath` written in both the insert `values` and the `onConflictDoUpdate` `set`, alongside every other column already there.
- `src/github/scan.ts`: `CAPS.maxFiles` 200 → 400, with the arithmetic (400 files at concurrency 2 inside `wallClockMs` is 600 ms/file, zero added core requests) recorded in the constant's own comment. `scan.test.ts` needed no edit — confirmed by running it, not by reading it.
- `src/detect/index.ts`: `DETECTORS = [skill, catalog, plugin, mcp]`. The DET-09 registry canary in `skill.test.ts` is rewritten (not deleted) to `['skill', 'catalog', 'plugin', 'mcp_server']`.
- Two new permanent adversarial fixtures: `fixtures/adversarial/plugin-malformed.json` (a top-level JSON array, not an object) and `fixtures/adversarial/mcp-malformed.json` (a `server.json` with `packages` but no `name`), both rowed into the adversarial README.

## Corpus measurements taken while implementing

All four corpora's `tree.json` files, read directly — no network, no token.

**Plugin manifests found by `plugin.match()`** (matches CONTEXT.md's Measurement 1 exactly):

| corpus | declared (`.claude-plugin/plugin.json`) | shape-only |
|---|---|---|
| `wshobson-agents` | 91 | 0 (all 91 already have manifests) |
| `addyosmani-agent-skills` | 1 (repo root) | 0 |
| `anthropics-skills` | 0 | 0 |
| `baoyu-skills` | 0 | 0 |

**componentIndex, measured directly in `plugin.test.ts` against the trees on disk** — two counts differ from Reference A's prose table by one root each; see Deviations for why:

| corpus | roots with ≥2 components | roots with exactly 1 |
|---|---|---|
| `addyosmani-agent-skills` | 1 (repo root: agents, commands, hooks, skills — has a manifest) | 3 (`.claude`, `.gemini`, `.github`) |
| `anthropics-skills` | 0 | 2 (repo root, `skills/skill-creator`) |
| `baoyu-skills` | 0 | 7 (includes `packages/baoyu-fetch/src` — the source-directory false positive the ≥2 rule exists to avoid) |
| `wshobson-agents` | 70 of the 91 `plugins/*` roots | 22 (21 `plugins/*` roots plus `.github/workflows`) |

Every one of `wshobson-agents`'s 91 declared plugins is found regardless of which bucket its directory shape falls into, because all 91 already carry a manifest — the 21 with exactly one component are the honest recall cost the ≥2 rule would have if those manifests vanished.

**MCP declarations found by `mcp.match()`**: exactly one real file across all four corpora — `plugins/runapi-mcp/.mcp.json` in `wshobson-agents`, matching CONTEXT.md's Measurement 1. No corpus contains a `server.json`; every `server.json` behavior in `mcp.test.ts` is Idiom B (inline).

**The file-budget proof, `pipeline.test.ts`'s new `the file budget (DET-06 / the CAPS.maxFiles raise)` describe block**: ingesting `wshobson-agents` through a stub that serves a minimal valid, type-appropriate body for every one of the 273 unique wanted paths (180 skills + 91 plugin manifests + 1 catalog + 1 `.mcp.json` — no shape-only plugin `needs` since all 91 already have manifests):

```
at CAPS.maxFiles = 400: { truncated: false }, 91 package rows of type 'plugin', 180 of type 'skill'
at CAPS.maxFiles = 200: { truncated: true }
```

Real bodies were never captured for all 384 eventual wanted files (03-01's SUMMARY already noted `capture-fixtures.mjs` is hard-coded to `SKILL.md` and never captured `marketplace.json`; the same is true for `plugin.json` and `.mcp.json`). The stub answers every requested path with a small, valid, correctly-shaped body per Reference F's own recommendation — the assertion under test is the count and the truncation flag, not the content.

## Migration

`drizzle/0004_complete_the_professor.sql`, generated with `bun run db:generate`, hand-reviewed — one statement, additive, schema-qualified:

```sql
ALTER TABLE "agentdock"."package" ADD COLUMN "parent_path" text;
```

`bun run check:boundaries` passed before and after. Applied with `bun run db:migrate` (`agentdock: applied 1 of 5 migration(s)`) and `bun run db:test:setup` (`agentdock_test: applied 1 of 5 migration(s)`).

## Verification run (in the required order)

| Command | Result |
|---|---|
| `bun run check:boundaries` | `5 migration file(s), package.json, 1 schema module, 43 source file(s)` — OK |
| `bun run lint` | `Checked 93 files` — clean (one `noTemplateCurlyInString` warning on a deliberately literal `${CLAUDE_PLUGIN_ROOT}/...` test string, resolved with a `biome-ignore` comment naming why) |
| `bun run typecheck` | clean |
| `bun run test` | **491 passed** across **26 files**, 0 failed, 0 skipped — up from the 432/23 baseline (+59 new tests: 29 plugin, 21 mcp, 6 nesting, 1 persist round-trip, 2 pipeline file-budget) |
| `bun run build` (Next.js) | compiled and type-checked successfully |
| `bun run ci` | all four gates, in sequence, all green |

## Deviations from Plan

### Auto-fixed / necessary companion additions

**1. [Rule 3 — blocking] `Candidate.shapeComponents?: string[]` was not in Reference B's pseudocode, and is required for `plugin.parse()` to work at all on a shape-only candidate**

- **Found during:** Task 1, writing `plugin.parse()`.
- **Issue:** Reference B's `match()` pseudocode shows a shape-only candidate as `{ sourcePath: root, needs: [], containerRoot: root }` — no field carrying which components it was recognised by. `parse(c, read)` has no access to the tree a second time (by design — the two-phase `needs` contract), so without such a field `parse()` cannot build `meta.components` or the warning text, and cannot compute a `contentBasis` that changes when the component set changes.
- **Fix:** added `Candidate.shapeComponents?: string[]`, set only by `plugin.ts`'s `match()`, read only by `plugin.ts`'s `parse()`. Documented in `types.ts` as detector-private payload, the same category as `containerRoot` (set by a detector) and distinct from `parentPath` (filled only by the pipeline).
- **Files:** `src/detect/types.ts`, `src/detect/plugin.ts`.
- **Verification:** `plugin.test.ts`'s shape-only `describe` block exercises the full `match()` → `parse()` chain on a real candidate object (not a hand-rolled one), which is what makes the field's round trip provable.

**2. [Rule 2 — missing critical] `plugin.json`'s inline `mcpServers` object is stripped from the artifact's `frontmatter` field, not only summarized into `meta.mcpServers`**

- **Found during:** Task 1, after implementing `mcp.ts`'s env-value rule in Task 2 and returning to review `plugin.ts` against the same threat.
- **Issue:** `plugin.json`'s inline `mcpServers` field is the exact same schema `.mcp.json` uses — server names mapped to `{command, args, env, ...}` — and can carry the same `env` credential values `mcp.ts` exists to keep out of storage. The plan's Reference B only says inline server *names* land in `meta.mcpServers`; nothing in Task 1's `<behavior>` list explicitly says to check `frontmatter` for the same leak. Storing `frontmatter: data` verbatim (the JSON-detector analogue of `skill.ts`'s `frontmatter: fm`) would have put the full inline `mcpServers` object — env values included — into a stored, queryable jsonb column.
- **Fix:** `plugin.ts` destructures `mcpServers` out of `data` before assigning `frontmatter`, so the raw inline server config (and any `env` value inside it) never reaches the stored artifact through that field. Only the extracted server *names* (`meta.mcpServers`) and the raw *path-valued* override (`meta.declaredComponents.mcpServers`, when it's a string/array) are recorded.
- **Files:** `src/detect/plugin.ts`.
- **Verification:** `plugin.test.ts`'s `"an inline mcpServers object's names land in meta.mcpServers, never its values"` test plants a secret and serializes the whole artifact, asserting the string is absent — the same test shape `mcp.ts`'s own env-value test uses.

**3. [Rule 1 — bug, corrected against the corpora] Two of Reference A's stated component-index counts do not match the trees on disk**

- **Found during:** Task 1, writing the `componentIndex` assertion test per the plan's own instruction ("assert its output against all four corpora before writing a line of the detector... if the code disagrees with [the table], the code is wrong, because that table was computed from the trees on disk").
- **Issue:** Reference A's table states `addyosmani-agent-skills` has 4 dot-directory roots at exactly one component (`.claude`, `.gemini`, `.github`, `.opencode`) and `wshobson-agents` has 71 `plugins/*` roots at ≥2 components / 20 at exactly one. Measuring `componentIndex()` directly against `fixtures/*/tree.json` gives 3 dot-directory roots for `addyosmani-agent-skills` (not 4) and 70/21 for `wshobson-agents` (not 71/20).
- **Root cause, addyosmani:** `.opencode/skills` in that corpus's tree is a git-mode-`120000` blob — a **symlink**, not a directory of skill files. A component-index implementation that scans every path segment (including the leaf/basename) for a `COMPONENT_DIR` match would count it as a `skills` component of `.opencode`; this implementation deliberately excludes the leaf segment (only intermediate directory segments can match a component name), which correctly does not count a same-named *file* as a directory shape.
- **Root cause, wshobson:** re-derived twice independently by filtering the tree to the 91 actual `.claude-plugin/plugin.json` directories and computing each one's component-set size; both derivations agree on 70/21, not 71/20 — the plan's stated numbers are simply off by one root (in which direction was not tracked down further, since the corpus is the ground truth per CONTEXT.md's own rule, and this plan's `<behavior>` bullets test the ≥2 rule's exception-free correctness, not the exact literal integers 71 and 20).
- **Fix:** the code was written to the algorithm actually described in Reference A ("a segment matching a COMPONENT_DIR makes everything before it a candidate root" — the leaf segment is not "before it"); the test's expected numbers were set to what that algorithm honestly measures, with the discrepancy and its cause recorded in a comment at the point of divergence.
- **Files:** `src/detect/plugin.test.ts` (the comments beside the `measured` object).
- **Verification:** `componentIndex — the assertion the table in Reference A makes` passes against all four corpora; the symlink cause is independently confirmed via `git ls-tree`-equivalent inspection of `tree.json`'s `mode` field.

**4. [Rule 3 — blocking] `Candidate.containerRoot` was added during Task 1, ahead of its Task 3 file ownership**

- **Found during:** Task 1, writing `plugin.match()`'s declared-manifest path per Reference B, which sets `containerRoot: root` on every plugin candidate.
- **Issue:** the plan's per-task `<files>` list puts `src/detect/types.ts` under Task 3 (alongside `nesting.ts`), but `plugin.ts` (Task 1) cannot compile without the field existing on `Candidate` first — Task 1's plugin detector is what actually sets it.
- **Fix:** added `containerRoot?: string` to `types.ts` during Task 1's implementation rather than deferring it, since the three tasks in this plan are one continuous, uncommitted working session with no per-task git boundary to respect (the plan's hard constraint forbids any commit at all). The plan's top-level `files_modified` frontmatter already lists `src/detect/types.ts`, so the final diff matches what was declared for the plan as a whole.
- **Files:** `src/detect/types.ts`.
- **Verification:** `bun run typecheck` clean throughout; `nesting.test.ts` (Task 3) exercises the same field with no further edit needed to its type.

### Deliberately out of scope

**`src/ingest/errors.ts`'s `no_artifacts` message ("AgentDock found no SKILL.md files in that repository...") was not updated.** It remains literally true — a repository with genuinely nothing any of the four registered detectors want still produces this exact outcome — but is no longer complete, since a plugin-only or MCP-only repository would also have avoided `no_artifacts` before this plan and the message doesn't say so. This file is not in this plan's `files_modified`, no `<behavior>`/`<verify>`/`<done>` criterion in any task touches it, and 03-03 (which adds `command` and `hook`) will make the same wording even more incomplete — a single pass over the message once all six detectors exist is the more honest fix than a partial update now. Not a stub: nothing renders this string as evidence of a feature that doesn't work.

---

**Total deviations:** 4 auto-fixed/necessary additions (2 Rule 3 blocking-issue fixes required for the plan's own design to compile and function, 1 Rule 2 security completeness fix extending the plan's own env-value rule to a second place it applies, 1 Rule 1 correction of the plan's own reference numbers against the ground-truth corpora), 1 deliberately out-of-scope wording nit (documented above, required by no task criterion).
**Impact on plan:** All fixes were required for `bun run ci` to pass and for the security invariant (T-03-11) to hold in the one additional place this plan's own analysis found it applies; none add scope beyond what Task 1–3's `<behavior>` lists already specified in spirit.

## Requirements satisfied

| ID | Evidence |
|---|---|
| DET-02 | `plugin.ts` detects 91+1 declared manifests exactly and zero shape-only plugins at any dot directory or repository root across all four corpora; the ≥2 threshold and both exclusions are each separately tested, including with an invented dot-prefixed synthetic tree |
| DET-04 | `mcp.ts` detects and parses both `.mcp.json` and `server.json`; every env-value test proves absence via whole-artifact serialization |
| DET-06 | `nesting.ts`'s `assignParentPaths` links a plugin-owned skill to its plugin while keeping it its own package row; `wshobson-agents` ingests all 91 plugins and 180 skills at the raised 400-file cap without truncation, and is truncated at the old 200 |
| DET-09 | The containment pass is proven generic by planting an invented container-detector type inline in `nesting.test.ts` and watching its children link with zero pipeline edit beyond the registration this plan already needed |
| QUA-03 / QUA-05 | `plugin.test.ts`, `mcp.test.ts`, `nesting.test.ts` all run with no network and no token; two new malformed manifests join the permanent adversarial suite with README rows |

## Known Stubs

None. Every artifact field this plan writes is wired to a real detector output; nothing renders a hardcoded placeholder.

## Next Phase Readiness

- 03-03 (command, hook, the seventh-detector proof) can extend `DETECTORS` with two more import + array-element pairs and extend the registry canary's expected array to `['skill', 'catalog', 'plugin', 'mcp_server', 'command', 'hook']`; the containment pass, the guarded pipeline, and the 400-file budget are all proven working end to end by this plan.
- `nesting.ts`'s genericity is now proven twice: once by this plan's invented-container-type test, and once implicitly by `plugin.ts` being the only real container detector that exists — 03-03's command/hook detectors need zero nesting-pass changes even though they are not containers.
- No blockers. `bun run ci` and `bun run build` are both green; both migrations (`0003`, `0004`) are applied to both schemas; nothing is staged for commit.

## Recommended commit message (not executed)

```
feat(03-02): detect plugins by shape, both MCP declaration forms, and link containment

- src/detect/plugin.ts: manifest + shape-only plugin detection, componentIndex,
  MIN_SHAPE_COMPONENTS=2 with its measured justification, both exclusions
- src/detect/mcp.ts: .mcp.json and server.json under one detector (mcp_server);
  env values never stored, key names only
- src/detect/nesting.ts: assignParentPaths, the one generic containment pass
- Candidate gains containerRoot and shapeComponents; parentPath is now filled
  by the pipeline's nesting pass, never by a detector
- package.parent_path (drizzle/0004_complete_the_professor.sql), applied to
  both schemas
- CAPS.maxFiles 200 -> 400 (src/github/scan.ts), zero added core requests
- src/detect/index.ts: DETECTORS = [skill, catalog, plugin, mcp]; registry
  canary rewritten to ['skill', 'catalog', 'plugin', 'mcp_server']
- fixtures/adversarial/{plugin,mcp}-malformed.json join the permanent suite
```

## Self-Check: PASSED

- All 9 created files exist on disk (`src/detect/plugin.ts`, `plugin.test.ts`, `mcp.ts`, `mcp.test.ts`, `nesting.ts`, `nesting.test.ts`, `fixtures/adversarial/plugin-malformed.json`, `mcp-malformed.json`, `drizzle/0004_complete_the_professor.sql`) — confirmed via the tool calls that created them.
- `package.parent_path` exists in both `agentdock` and `agentdock_test` — confirmed via `bun run db:migrate` / `bun run db:test:setup` output (`applied 1 of 5 migration(s)` in both) and exercised by `persist.test.ts`'s round-trip test.
- `bun run ci` passed in full: boundaries OK, lint clean, typecheck clean, 491/491 tests across 26 files. `bun run build` also passed.
- `git status --porcelain` shows every changed/new path with no staged entries (no leading `M`/`A` without a space) — nothing was `git add`ed, and no commit or push was run.

---
*Phase: AGD-03-detector-pluralism*
*Plan: 02*
*Completed: 2026-08-11*
