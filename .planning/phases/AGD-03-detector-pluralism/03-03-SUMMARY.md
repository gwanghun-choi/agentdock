---
phase: AGD-03-detector-pluralism
plan: 03
subsystem: detection-and-ingestion
tags: [command-detection, hook-detection, det-09-proof, det-10-proof, phase-gate]
status: complete

requires:
  - phase: AGD-03-detector-pluralism
    plan: 01
    provides: collectCandidates/orderedNeeds/safeParse (the guarded match/parse pipeline), parseJsonManifest, the ParseResult 'seeds'/'none' arms, the registry canary pattern
  - phase: AGD-03-detector-pluralism
    plan: 02
    provides: the four-detector registry (skill, catalog, plugin, mcp_server), the assignParentPaths containment pass, CAPS.maxFiles raised to 400
provides:
  - src/detect/command.ts — flat-file command detection reusing parseFrontmatter unmodified, filename-is-authoritative naming
  - src/detect/hook.ts — both hook config scopes (plugin hooks/*.json, project .claude/settings.json), event-name extraction read from the file, the silent no-hooks-key drop
  - DETECTORS — the phase's final six-element registry (skill, catalog, plugin, mcp_server, command, hook)
  - the runtime DET-09 proof (src/detect/run.test.ts) — a seventh detector defined only inside a test, run through collectCandidates/safeParse with zero production change beyond the registry
  - the runtime DET-10 proof — all six detectors over all four frozen corpora with fetch stubbed to throw and GITHUB_TOKEN stubbed empty
  - the phase-gate integration test (src/ingest/pipeline.test.ts) — all four corpora ingested end to end with the per-type package counts their trees hold
affects:
  - Phase 4 (CAP-01..CAP-14) — six detected artifact types, including a hook's verbatim-stored command field, are the surface capability extraction reads from; no capability was extracted, scored, or flagged here
  - Phase 6 (search) — command and hook rows are now indexable alongside the other four types

tech-stack:
  added: []
  patterns:
    - "A second flat-frontmatter format (command) costs a match() rule and a naming-source substitution, nothing in the parser — proven by driving the same four adversarial fixtures (alias-bomb, bad-yaml, no-fence, bom) through both skill.ts and command.ts and asserting identical failure behavior"
    - "A detector's own tighter byte cap (HOOK_CAPS.inputBytes = 64 KB) is checked before calling the shared JSON parser's own cap (JSON_CAPS.inputBytes = 256 KB) — input byte cap before parse, as always, even when a second, tighter cap exists for one format"
    - "The DET-09 promise is asserted at runtime, not reviewed: a detector type that appears nowhere in src/ is pushed through collectCandidates/safeParse in a test file, because both take the detector list as a parameter rather than importing DETECTORS"
    - "The no-network property (DET-10) is proved twice: structurally (match() has arity 1, parse() takes read as a parameter) and at runtime (every detector runs over every corpus with global fetch stubbed to throw)"

key-files:
  created:
    - src/detect/command.ts
    - src/detect/command.test.ts
    - src/detect/hook.ts
    - src/detect/hook.test.ts
    - fixtures/adversarial/hooks-malformed.json
    - fixtures/adversarial/settings-no-hooks.json
  modified:
    - src/detect/index.ts
    - src/detect/skill.test.ts
    - src/detect/run.test.ts
    - src/ingest/pipeline.test.ts
    - fixtures/adversarial/README.md
    - README.md

decisions:
  - "command.ts duplicates skill.ts's small validation constants (SPEC_KEYS, NAME_RULE, MAX_NAME, MAX_DESCRIPTION, MAX_COMPATIBILITY, MAX_BODY, toolTokens) rather than importing them — skill.ts is untouched in every plan of this phase and exports none of these under a name meant for reuse, so importing them would mean editing skill.ts's export surface for a detector it does not know about. The duplication is four constants and one helper function."
  - "A command's missing name or missing description can never fail the detector — only an unparsable frontmatter block can (the same three parser-level failures a skill gets: no fence, bad YAML, the alias-bomb serialized-size cap). The filename is always available and always authoritative, so the identity-missing failure branch skill.ts has does not exist for command.ts at all; a missing/mismatched name and a missing/empty description are warnings."
  - "hook.ts's own HOOK_CAPS.inputBytes (64 KB) is checked before parseJsonManifest is called, not after — matching the project-wide input-byte-cap-before-parse doctrine even though a second, looser cap (JSON_CAPS.inputBytes, 256 KB) exists inside the shared parser."
  - "hooks-malformed.json is a syntactically valid top-level JSON array (mirroring plugin-malformed.json's precedent), not genuinely invalid JSON syntax — a checked-in fixture with a JSON syntax error cannot pass biome's own JSON parser/formatter, which runs over fixtures/ same as source. The 'not valid JSON' failure path is tested inline (Idiom B, '{not valid json'), matching the existing precedent in plugin.test.ts and mcp.test.ts, neither of which uses a fixture file for that specific case either."
  - "The DET-10 runtime proof and the DET-09 seventh-detector proof both live in src/detect/run.ts's own test file, not in pipeline.test.ts — pipeline.test.ts is describe.skipIf(!DB_URL) in its entirety, so either proof placed there would silently not run without a database, which is exactly the reason 03-01 built collectCandidates/safeParse as pure functions in the first place."

requirements-completed: [DET-05, DET-09, DET-10, QUA-03, QUA-05]

coverage:
  - id: D1
    description: "A commands/*.md file is detected via the same parseFrontmatter call skill.ts makes, named by its filename (not its directory), and a README inside a commands directory produces no candidate at all"
    requirement: "DET-05"
    verification:
      - kind: unit
        ref: "src/detect/command.test.ts (all describe blocks)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A hook config produces one row per file carrying its event names (read from the file, not a hardcoded list) and its handler count; a .claude/settings.json with no hooks key produces no row at all, not a failed row; a hook command round-trips verbatim"
    requirement: "DET-05"
    verification:
      - kind: unit
        ref: "src/detect/hook.test.ts (all describe blocks)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Registering a seventh artifact type costs one file and one array element, proven by a detector defined inside a test file that runs through collectCandidates/safeParse and perturbs none of the six real detectors"
    requirement: "DET-09"
    verification:
      - kind: unit
        ref: "src/detect/run.test.ts#DET-09 — a seventh detector, defined only inside this test"
        status: pass
      - kind: unit
        ref: "src/detect/skill.test.ts#the registry (the six-element canary)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Every detector's match() has arity 1 (structural proof it cannot fetch), and all six detectors run over all four frozen corpora with global fetch stubbed to throw and GITHUB_TOKEN stubbed empty, completing and producing artifacts"
    requirement: "DET-10"
    verification:
      - kind: unit
        ref: "src/detect/run.test.ts#DET-10 — every detector runs against frozen fixtures, no network, no token"
        status: pass
    human_judgment: false
  - id: D5
    description: "All four corpora ingest end to end through the real pipeline with the per-type package counts their trees hold, contacting only the two allowlisted hosts"
    requirement: "DET-05 / DET-09 / DET-10 (integration)"
    verification:
      - kind: integration
        ref: "src/ingest/pipeline.test.ts#the phase gate: all six detectors over all four corpora (DET-05 / DET-09 / DET-10)"
        status: pass
    human_judgment: false
  - id: D6
    description: "The README no longer claims AgentDock indexes skills only; all six detected types are named"
    verification:
      - kind: other
        ref: "README.md lines 3-12 and the detect/ directory description; no automated test asserts prose, checked by direct read"
        status: pass
    human_judgment: true

duration: not machine-timed (single continuous session, no per-task timestamps recorded)
completed: 2026-08-11

actuals:
  tokens: 18800
  tasks: 3
  commits: 0
---

# Phase AGD-03 Plan 03: Command, Hook, and the DET-09/DET-10 Runtime Proofs Summary

The two cheapest detectors landed last, the seventh-detector promise stopped being a review checklist item and became a runtime assertion, and the phase closes with all six detectors ingesting all four frozen corpora end to end at the exact per-type counts their trees hold.

## Not committed

**No `git commit` and no `git push` were run**, per this plan's hard constraint (inherited from CONTEXT.md across all three plans in this phase). Everything below, and everything from 03-01 and 03-02, is unstaged in the working tree. `git status --porcelain` shows every changed/new path with a leading space or `??` — nothing staged. Recommended commit message for the whole phase is at the bottom.

## Accomplishments

- `src/detect/command.ts`: reuses `parseFrontmatter` from `src/detect/frontmatter.ts` **unmodified** — the same function `skill.ts` calls, byte for byte. `match()` is a path-segment filter (`.md`, `commands` among the intermediate segments, not the leaf, and not `README.md` by basename) — no regex, nothing to backtrack. A command's name is always its filename minus `.md`; a frontmatter `name` that disagrees is a warning, never a rejection, and a missing `name` or `description` can never fail the detector (only the shared parser's own three failures — no fence, bad YAML, the alias-bomb serialized-size cap — can).
- `src/detect/hook.ts`: one detector, two match rules — a plugin's `hooks/hooks.json` and a project's `.claude/settings.json` (root or nested, either scope). `parse()` reads event names via `Object.keys(json.hooks)`, never from a hardcoded vocabulary, and sums handler counts across every matcher entry. A `hooks` key that is absent, non-object, or empty produces `status: 'none'` — **no row at all**, proven against a realistic `settings.json` carrying `enabledPlugins`, `pluginConfigs`, and `permissions`. Every handler's `command` field is stored verbatim in `meta.handlers` and interpreted nowhere.
- `src/detect/index.ts`: `DETECTORS = [skill, catalog, plugin, mcp, command, hook]` — the phase's final six-element registry, one import line and one array element added for each of the two new detectors, no other file touched to register them.
- The DET-09 registry canary in `skill.test.ts` reaches its final form: `['skill', 'catalog', 'plugin', 'mcp_server', 'command', 'hook']`.
- **The DET-09 runtime proof** (`src/detect/run.test.ts`): a detector of an invented type (`'invented'`), defined only inside the test file, is pushed through `collectCandidates([...DETECTORS, seventh], tree)` and `safeParse`. It produces exactly one candidate and one artifact, and a second assertion confirms the six real detectors' candidate counts are byte-for-byte identical whether the seventh is present or not. The test's own comment states what this does **not** prove: persistence, which needs an `artifact_type` row and therefore a migration — a schema change that was never claimed to be free.
- **The DET-10 runtime proof** (same file): every registered detector's `match` has arity 1 (`d.match.length === 1` for all six — structural proof none of them can fetch, since there is no reader to call), and a second test runs all six detectors over all four frozen corpora with `globalThis.fetch` stubbed to a function that throws and `GITHUB_TOKEN` stubbed empty. The run completes, produces a non-zero artifact count, and `fetch` is never called.
- **The phase-gate integration test** (`src/ingest/pipeline.test.ts`): all four corpora are ingested end to end through the real pipeline (real `ingestRepository`, a generic path-pattern fetch stub answering every requested file with a minimal valid, type-appropriate body), and the resulting `package` table rows are grouped by type and compared against the exact counts CONTEXT.md's Measurement 1 table holds. See the table below.
- Two new permanent adversarial fixtures: `fixtures/adversarial/hooks-malformed.json` (a top-level JSON array, mirroring `plugin-malformed.json`'s precedent — a checked-in fixture cannot be genuinely invalid JSON syntax and still pass `biome check`) and `fixtures/adversarial/settings-no-hooks.json` (a realistic settings file with `enabledPlugins`, `pluginConfigs`, and `permissions`, no `hooks` key). Both rowed into the adversarial README. `command.test.ts` gains a second consumer of four existing fixtures (`alias-bomb.md`, `bad-yaml.md`, `no-fence.md`, `bom.md`) — same bytes, same failures, through `command.ts` instead of `skill.ts`.
- README's three stale sentences fixed: the opening paragraph now names all six file kinds instead of `SKILL.md` only; "Phase 1 indexes Agent Skills only..." is replaced with a sentence naming all six detected types and pointing capability disclosure at what comes next; the `detect/` line in "What is where" now says "six detectors, tolerant frontmatter parsing, capped JSON parsing" instead of "SKILL.md detection and tolerant frontmatter parsing." Nothing else in the UI was touched, per CONTEXT.md decision 7.

## Per-type package counts, all four corpora, end to end (the phase's real output)

Measured by `src/ingest/pipeline.test.ts`'s phase-gate describe block: the real `ingestRepository` pipeline, a generic stub answering every requested raw file with a minimal valid body for its detected type (real bodies were never captured for anything but `SKILL.md` — `capture-fixtures.mjs` is hard-coded to it), grouped by `package.type` after ingest.

| corpus | skill | plugin | mcp_server | command | hook | catalog (→ `repo_seed`, never a package) | truncated |
|---|---|---|---|---|---|---|---|
| `anthropics-skills` | 18 | — | — | — | — | 1 file read, 0 seeds (empty-marketplace stub) | false |
| `addyosmani-agent-skills` | 24 | 1 | — | 8 | 1 | 1 file read, 0 seeds (empty-marketplace stub) | false |
| `baoyu-skills` | 22 | — | — | — | — | 1 file read, 0 seeds (empty-marketplace stub) | false |
| `wshobson-agents` | 180 | 91 | 1 | 109 | 2 | 1 file read, 0 seeds (empty-marketplace stub) | false |

Every number matches CONTEXT.md's Measurement 1 table exactly (that table's "total `needs`" column is one higher per corpus than the sum above, because it counts the `marketplace.json` file itself as a `needs` entry even though `catalog` never produces a package row for it — 35−1=34, 19−1=18, 23−1=22, 384−1=383, which is exactly the sum of this table's five package-producing columns per row). `catalog.ts`'s real seed-producing behavior against non-empty marketplace content (2 seeds from a well-formed marketplace, 0 from a malformed one) is proven separately and unchanged from 03-01, in `catalog.test.ts` and `pipeline.test.ts`'s dedicated `catalog (DET-03)` block — the phase-gate test above uses an empty, well-formed marketplace uniformly across all four corpora because its assertion is the five package-producing types' counts, not catalog's seed count.

No corpus reported itself truncated, at the `CAPS.maxFiles = 400` cap this phase inherited from 03-02.

## What the DET-09 proof establishes, and what it deliberately does not

**Proves:** the registry contract. A detector type nothing in `src/` has ever seen — never imported, never added to `DETECTORS`, unknown to the pipeline — flows through `collectCandidates` and `safeParse` (the two functions `pipeline.ts` actually calls) and produces exactly the candidate and the artifact its own `match()`/`parse()` would produce standing alone. A second assertion confirms its presence changes nothing about the six real detectors' own candidate counts over the same tree, closing the one gap a naive "it works" test would leave: a detector reaching across into another's candidates.

**Does not prove:** persistence. Storing a seventh type's package row needs an `artifact_type` foreign-key row in the database, which needs a migration — `agentdock.artifact_type` currently holds exactly the six ids this phase's three plans seeded (`skill`, `catalog`, `plugin`, `mcp_server`, `command`, `hook`; see 03-01's migration `0003` and 03-02's `0004`, neither of which added a seventh). A `package.type` insert for `'invented'` would fail its FK constraint today. This was never claimed to be free — CONTEXT.md's binding decision 2 states the promise's real boundary explicitly: "a new output channel is a new persistence target, which is a schema change, which is not a one-file change under any design." The test's own comment states this limit rather than overclaiming it.

## Verification run (in the required order)

| Command | Result |
|---|---|
| `bun install --frozen-lockfile` | `Checked 199 installs across 328 packages (no changes)` |
| `bun run check:boundaries` | `5 migration file(s), package.json, 1 schema module, 45 source file(s)` — OK |
| `bun run lint` (`biome check .`) | `Checked 99 files` — clean, after fixing two `noNonNullAssertion` findings and letting biome auto-fix import order/formatting in the four touched files |
| `bun run typecheck` | clean |
| `bun run test` | **538 passed** across **28 files**, 0 failed, 0 skipped — up from the 491/26 baseline (+47 new tests: 25 command, 17 hook, 5 run.ts DET-09/DET-10, 4 pipeline.test.ts phase-gate; database was available, so every `describe.skipIf(!DB_URL)` block ran) |
| `bun run build` (Next.js) | compiled and type-checked successfully; every route generated |
| `bun run ci` | all four gates, in sequence, all green |

## Falsification signals from CONTEXT.md, walked one by one

1. **A repository with a `SKILL.md` and a crash-inducing path still yields packages.** Unaffected by this plan; 03-01's DET-07 regression (`pipeline.test.ts`'s `detector isolation (DET-07)` block) is part of the 538 passing tests. NOT triggered.
2. **`wshobson-agents` yields ≥91 plugin rows and does not report itself truncated.** Both `pipeline.test.ts`'s `the file budget` block (from 03-02) and this plan's phase-gate block independently assert `plugin: 91, truncated: false` for `wshobson-agents`. NOT triggered.
3. **No corpus produces a `plugin` row at `.github`, `.claude`, or the repository root without a manifest.** `plugin.test.ts`'s exclusion tests (03-02) are part of the 538 passing tests; this plan added no plugin-detection code. NOT triggered.
4. **A `marketplace.json` produces no `package` row on the success path.** `catalog.test.ts` and `pipeline.test.ts`'s `catalog (DET-03)` block (03-01) are unchanged and passing; this plan's own phase-gate table shows zero `catalog`-type package rows across all four corpora. NOT triggered.
5. **A `.claude/settings.json` with no `hooks` key produces no row.** Directly tested three ways in `hook.test.ts`: the permanent adversarial fixture (`enabledPlugins` + `pluginConfigs` + `permissions`, no `hooks` key), an empty `hooks: {}` object, and a settings file with no `hooks` key at all — all three assert `status: 'none'`, which the pipeline (`pipeline.ts:243`, `if (result.status === 'none') continue;`) writes no row for. NOT triggered.
6. **Registering a seventh detector touches nothing but `src/detect/index.ts` and the new file.** This is the DET-09 runtime proof itself (`run.test.ts`) — the seventh detector is defined entirely inside the test file, touching zero production files, and flows through unmodified `collectCandidates`/`safeParse`. NOT triggered.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 1 — bug] The dangerous hook command test string contained a literal double quote, which `JSON.stringify` escapes, breaking a byte-for-byte substring assertion**

- **Found during:** Task 2, first `bun run test` pass on `hook.test.ts`.
- **Issue:** the planted "hostile command" string used a bash `"$(...)"` construction with literal double quotes. `JSON.stringify(result.artifact)` escapes those quotes to `\"`, so the exact planted substring no longer appears verbatim in the serialized artifact — the assertion `serialized.split(dangerous)).toHaveLength(2)` failed (found 0 occurrences, not 1), even though the underlying field (`handlers[0].command`) was in fact stored byte-for-byte correctly.
- **Fix:** the test string was rewritten to use single quotes for the inner shell grouping (`sh -c '$(cat /etc/passwd)'`) instead of double quotes, so it survives JSON serialization unescaped and the substring assertion tests what it claims to test.
- **Files:** `src/detect/hook.test.ts`.
- **Verification:** the test passes; `handlers[0].command === dangerous` (the primary, unconditional assertion) was correct throughout and never needed fixing — only the secondary serialization-substring assertion's test data was flawed.

**2. [Rule 1 — bug, corrected against the project's own lint config] `hooks-malformed.json` cannot be genuinely invalid JSON syntax**

- **Found during:** Task 2, first `bun run ci` pass.
- **Issue:** the plan's Reference/behavior text implies a hooks fixture testing "not valid JSON." An initial version of `hooks-malformed.json` used a trailing comma to be syntactically broken JSON. `biome check .` runs its own JSON parser over every file under `fixtures/` (no exclusion in `biome.json`), and a genuinely malformed JSON file fails biome's parse step outright — not a lint warning, a hard error that fails `bun run ci` before any test even runs. The three existing malformed-manifest fixtures (`marketplace-malformed.json`, `plugin-malformed.json`, `mcp-malformed.json`) are all **syntactically valid** JSON with the wrong shape (an object instead of an array, or a missing required field) for exactly this reason — precedent already avoided this trap, and it was missed initially.
- **Fix:** `hooks-malformed.json` is now a syntactically valid top-level JSON array (mirroring `plugin-malformed.json`'s exact precedent — "a top-level JSON array, not an object"), which fails `parseJsonManifest`'s "manifest is not a JSON object" check. The genuinely-invalid-JSON-syntax case (`'{not valid json'`) is tested inline (Idiom B) in `hook.test.ts`, matching the identical precedent already set in `plugin.test.ts` and `mcp.test.ts` — neither of which uses a checked-in fixture file for that specific case either.
- **Files:** `fixtures/adversarial/hooks-malformed.json`, `fixtures/adversarial/README.md`, `src/detect/hook.test.ts`.
- **Verification:** `bun run ci`'s lint gate passes; both the inline "not valid JSON" test and the fixture-based "top-level array" test pass independently.

**3. [Rule 1 — bug] Two `noNonNullAssertion` lint findings**

- **Found during:** Task 1 and Task 3, first `bun run ci` pass.
- **Issue:** `command.ts` used `c.sourcePath.split('/').pop()!.replace(...)` and `run.test.ts` used `seventhPass!.candidates[0]`. Both are structurally safe (`.split('/').pop()` on a non-empty string never returns `undefined`; `seventhPass` is `passes.at(-1)` on a provably non-empty array) but the project's biome config forbids the non-null assertion operator outright (`lint/style/noNonNullAssertion`), preferring an explicit guard.
- **Fix:** `command.ts` now destructures the path into `segments` and indexes the last element directly (no assertion needed, and arguably clearer than a `.pop()!` chain). `run.test.ts` now has an explicit `if (!seventhPass) throw new Error('unreachable: passes is non-empty')` guard before use, matching the pattern `pipeline.test.ts` already uses elsewhere in this codebase (`if (!result.ok) throw new Error('unreachable')`).
- **Files:** `src/detect/command.ts`, `src/detect/run.test.ts`.
- **Verification:** `bun run lint` clean; both files' logic is unchanged, only the null-safety expression.

### Deliberately out of scope

**`src/ingest/errors.ts`'s `no_artifacts` message** ("AgentDock found no SKILL.md files in that repository. It currently indexes Agent Skills only.") **was not updated**, even though it is now the most out-of-date sentence in the codebase — a repository whose only artifact is a hook config, a command, an MCP server, or a plugin would also avoid `no_artifacts` and the message doesn't say so. 03-02's SUMMARY explicitly deferred this exact fix to "once all six detectors exist," which is now. It remains deferred because: `errors.ts` is not in this plan's `files_modified` frontmatter list; no `<behavior>`/`<verify>`/`<done>` criterion in any of this plan's three tasks touches it; and CONTEXT.md's own decision 7 bounds the README correction to exactly three named sentences, explicitly stating "Nothing else in the UI is touched." Changing this message would also require updating `pipeline.test.ts`'s existing `expect.stringContaining('no SKILL.md files')` assertion (from 03-01/before) and `errors.test.ts`'s message-shape tests, which is real additional surface area the plan's task list never asked for. Not a stub — the message is still literally true (a repository containing genuinely none of the six types' evidence produces exactly this outcome) — merely less complete than it could be. Recorded here as the phase's own honest ledger entry, exactly as 03-02 recorded it as pending.

---

**Total deviations:** 3 auto-fixed (2 Rule 1 test-authoring bugs caught by the test/lint gates themselves before they could hide a real defect, 1 Rule 1 correction against the project's own established fixture precedent), 1 deliberately out-of-scope wording nit (documented above, carried forward from 03-02's own deferral, required by no task criterion in any of the three plans).
**Impact on plan:** All fixes were required for `bun run ci` to pass; none add scope beyond what Task 1–3's `<behavior>` lists already specified.

## TDD Gate Compliance

This plan's frontmatter is `type: execute` (not `type: tdd`), so the plan-level RED/GREEN/REFACTOR gate sequence validation (checking `git log` for `test(...)` then `feat(...)` commits) does not apply as a phase-level gate. Individual tasks 1 and 2 carry `tdd="true"`, but this plan's own hard constraint — inherited from CONTEXT.md and stated in the critical overrides — forbids any `git commit` at all, so there is no commit history for a gate-sequence check to inspect regardless. Behavioral TDD discipline was followed in substance rather than in commit form: for both `command.ts` and `hook.ts`, tests were written to state every `<behavior>` bullet as an assertion before the implementation was considered complete, and the existing shared-fixture reuse (`alias-bomb.md`, `bad-yaml.md`, `no-fence.md`, `bom.md` for `command.ts`; the same JSON manifest tolerance doctrine `catalog.ts`/`plugin.ts`/`mcp.ts` already established, for `hook.ts`) meant the failure paths were proven correct by construction rather than by a separate RED phase — the parser being reused was already RED/GREEN-proven in AGD-01 and 03-01/03-02.

## Requirements satisfied

| ID | Evidence |
|---|---|
| DET-05 | `command.ts` and `hook.ts` each detected and parsed; command reuses `parseFrontmatter` unmodified (proven by four shared adversarial fixtures failing identically through both detectors); hook produces one row per file with events read from the file and a verbatim-stored command field |
| DET-09 | `run.test.ts`'s seventh-detector proof: a type unknown to `src/` flows through `collectCandidates`/`safeParse` with zero production change beyond the registry; the six-element registry canary in `skill.test.ts` fails if a detector file exists without an array element |
| DET-10 | Every detector's `match` has arity 1; all six detectors run over all four frozen corpora with `fetch` stubbed to throw and `GITHUB_TOKEN` empty, completing and producing artifacts, never calling `fetch` |
| QUA-03 / QUA-05 | `command.test.ts` and `hook.test.ts` run with no network and no token; two new fixtures join the permanent adversarial suite; four existing fixtures gain a second consumer |

## Known Stubs

None. Every artifact field this plan writes is wired to a real detector output; nothing renders a hardcoded placeholder. The phase-gate integration test's stub response bodies (`bodyForAnyType`) exist only inside the test file, to answer a fetch stub — they are test fixtures, not production stubs, exactly like the `the file budget` block's `bodyFor` from 03-02.

## Next Phase Readiness

- Phase 3 is complete: all six detectors are registered, isolated (DET-07, 03-01), capped (DET-08, 03-01), and proven cheap to extend (DET-09, this plan) and network-free (DET-10, this plan).
- `bun run ci` and `bun run build` are both green across the whole accumulated three-plan diff. `git status --porcelain` shows every path from all three plans as unstaged (` M` or `??`), nothing staged, no commit or push run at any point in the phase.
- Phase 4 (capability extraction, CAP-01..CAP-14) can now read `meta.handlers[].command` (hook), `meta.servers[].command`/`args`/`url` (MCP), and `meta.mcpServers`/`meta.declaredComponents` (plugin) as its raw input surface — all of it stored verbatim by this phase and interpreted by none of it, which is the boundary Phase 4 is explicitly scoped to cross.
- No blockers.

## Recommended commit message (not executed) — for the whole phase

Nothing in Phase 3 (03-01, 03-02, 03-03) has been committed. One combined message for the maintainer to use when committing the whole phase together:

```
feat(AGD-03): detector pluralism — six detectors, isolated, capped, and proven cheap to extend

Detector isolation, the widened ParseResult, and the catalog tracer (03-01):
- src/detect/run.ts: one guarded match() pass, round-robin needs, guarded parse()
- ParseResult widened with 'seeds'/'none' arms; skill.ts untouched
- src/detect/json.ts: byte/array-length/depth caps for untrusted JSON manifests
- src/detect/catalog.ts: marketplace.json -> repo_seed, never a package
- agentdock.repo_seed (drizzle/0003_flaky_selene.sql), applied to both schemas

Plugin pluralism, MCP, nesting, and the file budget (03-02):
- src/detect/plugin.ts: manifest + shape-only plugin detection, componentIndex,
  MIN_SHAPE_COMPONENTS=2 with its measured justification, both exclusions
- src/detect/mcp.ts: .mcp.json and server.json under one detector (mcp_server);
  env values never stored, key names only
- src/detect/nesting.ts: assignParentPaths, the one generic containment pass
- package.parent_path (drizzle/0004_complete_the_professor.sql)
- CAPS.maxFiles 200 -> 400 (src/github/scan.ts), zero added core requests

Command, hook, and the DET-09/DET-10 runtime proofs (03-03):
- src/detect/command.ts: flat-file commands, reusing parseFrontmatter unmodified
- src/detect/hook.ts: both hook scopes, events read from the file, verbatim
  command storage, silent drop of a settings.json with no hooks key
- src/detect/index.ts: DETECTORS = [skill, catalog, plugin, mcp, command, hook]
- src/detect/run.test.ts: DET-09 (a seventh detector, defined only in a test)
  and DET-10 (no detector reaches fetch/GITHUB_TOKEN) as runtime assertions
- src/ingest/pipeline.test.ts: all four corpora ingest end to end at the exact
  per-type counts their trees hold
- README.md: three sentences corrected; AgentDock detects six types, not one

scripts/migrate.mjs carries the six-type artifact_type seed list throughout;
both migrations are additive only, applied to both agentdock and agentdock_test.
```

## Self-Check: PASSED

- All 6 created files exist on disk (`src/detect/command.ts`, `command.test.ts`, `hook.ts`, `hook.test.ts`, `fixtures/adversarial/hooks-malformed.json`, `settings-no-hooks.json`) — confirmed via the tool calls that created them.
- `DETECTORS` in `src/detect/index.ts` reads `[skill, catalog, plugin, mcp, command, hook]` — confirmed by direct read, and by the passing registry canary test in `skill.test.ts`.
- `bun run ci` passed in full: boundaries OK, lint clean, typecheck clean, 538/538 tests across 28 files. `bun run build` also passed.
- `git status --porcelain` shows every changed/new path across all three plans with no staged entries (no leading `M`/`A` without a space) — nothing was `git add`ed at any point in this session; no commit or push was run.

---
*Phase: AGD-03-detector-pluralism*
*Plan: 03*
*Completed: 2026-08-11*
