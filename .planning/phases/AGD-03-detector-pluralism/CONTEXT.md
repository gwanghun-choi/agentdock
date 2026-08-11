# Phase 3 Context — Detector Pluralism

There was no `/gsd-discuss-phase` for this phase; the maintainer chose to plan from
`03-RESEARCH.md` and `REQUIREMENTS.md` directly. Every decision below is therefore the
planner's, made explicitly rather than inherited, and each one names the mechanism that
forced it. Where a decision contradicts `03-RESEARCH.md`, that is called out.

Two things were measured while planning, at **zero GitHub cost**, by reading the four
frozen corpora already on disk (`fixtures/*/tree.json`, 3,831 blob entries total). Those
measurements decided three of the design questions the research left open, and they are
reproduced in full below because the plans depend on them.

## Scope

Grow the detector set from one to six, and pay the one-time pipeline cost that makes the
seventh free. Nothing else.

Not in this phase: capability extraction, seed fan-out, search, UI, registry sync,
compatibility.

## The correction that reshapes the phase

`03-RESEARCH.md` §7 / Pitfall 2 states that `parse()` is already wrapped in a per-candidate
try/catch and only `match()` is unguarded. **That is wrong, and it was verified wrong
against the source.** `grep -n "try\s*{\|catch" src/ingest/pipeline.ts` returns exactly two
hits — `try {` at line 125 and `} catch (error) {` at line 287. That single block spans the
whole repository body: the known-SHA short circuit, the entire detector loop, and
`persistScan()`.

So the true state today is:

- `detector.match()` is unguarded at **two** call sites — `pipeline.ts:192` (the candidate
  loop) and `pipeline.ts:137` (the `fetchRepoScanInputs` needs-collector callback, which
  runs during the scan, before any file is read).
- `detector.parse()` is **also** unguarded, at `pipeline.ts:198`.
- A throw at any of those three points propagates to the outer catch and fails the entire
  repository with an `IngestOutcome`.

The only reason this has never bitten is `src/detect/skill.ts:52`, which catches internally
and returns `{ok:false}`. **Isolation today is a property of the one detector that exists,
not of the pipeline.** DET-07 is therefore a first-class task with its own regression test,
it ships first, and it ships before any of the five new detectors — several of which do
JSON parsing and directory grouping, which is exactly the code that throws.

## Measurement 1 — what the four frozen corpora actually contain

Every count below is from `fixtures/*/tree.json`, bounded the way `scan.ts` bounds a tree
(blobs only, depth ≤ `CAPS.maxDepth`). No network, no token.

| corpus | bounded blobs | skill | plugin manifest | catalog | mcp | command | hook | **total `needs`** |
|---|---|---|---|---|---|---|---|---|
| `addyosmani-agent-skills` | 184 | 24 | 1 | 1 | 0 | 8 | 1 | **35** |
| `anthropics-skills` | 411 | 18 | 0 | 1 | 0 | 0 | 0 | **19** |
| `baoyu-skills` | 920 | 22 | 0 | 1 | 0 | 0 | 0 | **23** |
| `wshobson-agents` | 1,160 | 180 | 91 | 1 | 1 | 109 | 2 | **384** |

Three consequences, all binding:

1. **Almost no new fixture directories are needed.** `03-RESEARCH.md`'s Wave 0 list asks
   for eleven hand-written corpus directories. All four corpora already on disk carry a
   `marketplace.json`; two carry real plugin manifests (one of them 91 of them); two carry
   commands and hooks; one carries an `.mcp.json`; and `wshobson-agents` is a genuine
   `plugins/*/skills/*/SKILL.md` monorepo. Hand-writing eleven fake `tree.json` +
   `files/` directories to re-create what is already frozen on disk is ceremony.
   **Binding: `match()` is tested against the real corpora with real counts; `parse()` is
   tested with inline strings (`skill.test.ts`'s Idiom B); only genuinely hand-authored
   malformed manifests go to `fixtures/adversarial/`.** `scripts/capture-fixtures.mjs` is
   not touched, so gap G5 in `03-PATTERNS.md` stays closed.

2. **`CAPS.maxFiles = 200` is now genuinely contended.** `wshobson-agents` wants 384 files
   after this phase where it wanted 180 before. Left alone, the largest real corpus is
   permanently truncated — and since Phase 2, a truncated scan suppresses delisting, so it
   would also read as permanently partial and never converge. See "Binding decisions" for
   what is done about it and what it costs.

3. **The ≥2-component threshold is answered, empirically, for free.** See Measurement 2.

## Measurement 2 — Assumption A3 is resolved by the corpora, not by sampling

`03-RESEARCH.md` A3 flags the "≥2 component shapes" rule for manifest-less plugin
detection as unmeasured and suggests sampling 20–30 live repositories. That sampling is
**not done**, and it is not deferred out of laziness — it is unnecessary, because the four
corpora already answer it. Applying the candidate rule to their trees:

| root | components found | correct verdict | ≥1 rule | ≥2 rule |
|---|---|---|---|---|
| `wshobson-agents` `plugins/*` (91 roots) | 1–4 each | plugin | ✓ (all have manifests anyway) | ✓ |
| `addyosmani` repo root | agents, commands, hooks, skills (4) | plugin (has a manifest) | ✓ | ✓ |
| `anthropics-skills` repo root | skills (1) | **not** a plugin | ✗ false positive | ✓ |
| `anthropics-skills` `skills/skill-creator` | agents (1) | **not** a plugin | ✗ false positive | ✓ |
| `baoyu-skills` `packages/baoyu-fetch/src` | commands (1) | **not** a plugin — source code | ✗ false positive | ✓ |
| `.github` (3 of 4 corpora) | workflows (1) | **not** a plugin | ✗ false positive | ✓ |
| `.claude` (2 of 4 corpora) | skills / commands (1) | **not** a plugin — project config | ✗ false positive | ✓ |

`workflows` is in Claude Code's own component list and `.github/workflows/` is very likely
the most common directory path on GitHub. A ≥1 rule would classify most of GitHub as a
Claude Code plugin. **≥2 survives every negative in the corpora with zero false positives
and zero false negatives.**

Two additional exclusions fall straight out of the same table, and both are semantic as
well as empirical:

- **A dot-prefixed directory is never a shape-only plugin root.** `.github`, `.gemini`, and
  `.claude` all appear with component directories under them, and none is a plugin.
  `.claude/` in particular is Claude Code's *project config* directory — a skill at
  `.claude/skills/x/SKILL.md` is a project skill, and Claude Code's own three-way
  distinction turns on `.claude-plugin/plugin.json`, which a config directory does not
  have. A declared manifest overrides this exclusion; nothing overrides it for shape-only.
- **The repository root is never a shape-only plugin root.** A root-level plugin has no
  directory path to use as an identity, and a `parent_path` of `''` on every artifact in
  the repository says nothing the `repository_id` did not already say.

**Binding: ship the ≥2 rule with both exclusions, `meta.detectionConfidence: 'shape-only'`,
and a forced `partial` parse status. Do not spend a task sampling live repositories.**
The GitHub budget argument is secondary but real (a 25-repo sample is ~50 core requests,
most of the 60/hr unauthenticated allowance, for a number the corpora already give free),
and the deciding argument is that **CAP-13 in Phase 4 already mandates a hand-checked
false-positive rate per detector against a labeled corpus** — measuring here duplicates
Phase 4 with worse instrumentation. The threshold ships as one exported constant with the
rule in a comment and the negative cases locked by tests, so revising it later is a visible
diff rather than an archaeology exercise.

Known residual failure mode, stated rather than hidden: a non-`.`-prefixed subdirectory
that legitimately holds two of the component names for unrelated reasons — say
`docs/commands/` beside `docs/agents/` — still false-positives. It is recorded as
`shape-only` and `partial`, never `ok`. That is the honest ceiling of a path-only rule.

## Resolved open questions

1. **Does the catalog belong as a `Detector` at all?** Yes — but not via
   `03-RESEARCH.md`'s `producesPackages?: boolean` + `seeds?()` proposal, which is
   rejected. See "Binding decisions", item 1. The deciding argument is mechanical: the
   pipeline has to branch on a *per-candidate* fact, and `producesPackages` is a *static
   per-detector* flag that additionally does not solve the hook case at all.

2. **Does `parentPath` honour `plugin.json`'s component path-override fields?** No. Doing
   so would require reading every plugin's manifest before computing `parentPath` for every
   other candidate, which is a second fetch round and breaks the two-phase `needs` contract
   that keeps a zero-artifact repository free. The prefix heuristic gets the common case
   right and degrades gracefully: a plugin using an override path simply does not get its
   children linked, and each child is still discovered and stored independently, which is
   what DET-06 actually asks for.

3. **Where does a *malformed* catalog's parse status go, given a catalog is never a
   package?** Into a package row of type `catalog` with `parse_status='failed'` — the
   asymmetry is deliberate. `package_version.parse_status` is the only place in the schema
   where a parse status can be recorded, and the row a failure would hang on in `repo_seed`
   does not exist precisely because the parse failed. A `catalog` row therefore appears in
   the index exactly when AgentDock could not read the catalog, which is a disclosure, and
   it delists itself on the next successful ingest because a parsed catalog contributes no
   package id. The alternative — dropping it silently — makes a broken `marketplace.json`
   indistinguishable from an absent one, which this project does not do anywhere else.

4. **Is `server.json`'s schema stable enough to build on?** (A2 — MCP registry is
   self-described as "in preview".) Handled by tolerance, not by verification: the
   `server.json` branch reads `name`, `description`, `version`, `packages[]` if present,
   warns if absent, and returns `status: 'none'` — no row at all — when a file named
   `server.json` carries none of them. A generic non-MCP `server.json` therefore costs one
   read and produces nothing, and a schema drift degrades to a `partial` row rather than a
   failure.

## Binding decisions

**1. The `Detector` type does not change. `ParseResult` grows two arms, discriminated by
the `status` field that already exists on every arm.**

```ts
export type ParseResult =
  | { ok: true;  status: 'ok' | 'partial'; artifact: DetectedArtifact; warnings: string[] }  // unchanged
  | { ok: false; status: 'failed'; artifact?: Partial<DetectedArtifact>; errors: string[] }  // unchanged
  | { ok: true;  status: 'seeds';  seeds: DetectedSeed[]; warnings: string[] }               // new
  | { ok: true;  status: 'none';   reason: string };                                          // new
```

`producesPackages?: boolean` and `seeds?()` on `Detector` are **rejected**, for three
mechanical reasons:

- The fact the pipeline must branch on is per-candidate, not per-detector. One
  `.claude/settings.json` carries hooks and another does not, and path-only `match()`
  cannot tell them apart. A static flag cannot express that; a fourth `ParseResult` arm can.
- `producesPackages` does not solve the "produce no row" case at all, so it would ship
  alongside a third-arm change anyway — two mechanisms for one problem.
- A second method (`seeds()`) means the pipeline branches twice: once on the flag, once to
  choose which method's output to read. Returning seeds from `parse()` means it branches
  once, on a value it already holds.

The payoff is that `skill.ts` is not touched, and neither are the ~30 existing assertions
in `skill.test.ts`. `03-RESEARCH.md`'s claim that the skill detector needs refactoring onto
a new interface is wrong: its shape is already the target shape.

**2. The pipeline changes exactly once, in four named places, and then stops.**

This is the honest form of DET-09, and it is stated here so it can be checked rather than
believed. The four changes:

- `collectCandidates(DETECTORS, tree)` replaces the two separate, unguarded `match()`
  passes with **one** guarded pass, captured inside the `selectPaths` callback and reused
  by the candidate loop. One call site instead of two means one guard instead of two, and
  the two can no longer diverge.
- The candidate's body is keyed on `candidate.needs[0]` rather than `candidate.sourcePath`,
  and the skip guard becomes "asked for a file and did not get it". A manifest-less plugin
  is a directory, not a file; it declares `needs: []` and would otherwise be dropped at
  `pipeline.ts:194`.
- One `switch (result.status)` routes a candidate to the package channel, the seed channel,
  or the floor.
- One generic `assignParentPaths()` pass, which names no artifact type (see item 5).

**After that, a new detector that emits an artifact or a seed is one new file plus one new
array element in `src/detect/index.ts`, with no pipeline change.** What would still force a
pipeline change is a detector that invents a genuinely new *output channel* — and a new
output channel is a new persistence target, which is a schema change, which is not a
one-file change under any design. That limit is the promise's real boundary and it is
recorded here rather than discovered later.

DET-09 is also made runtime-testable rather than review-only, contradicting
`03-RESEARCH.md`'s Test Map: because `collectCandidates` and `safeParse` take the detector
list as a parameter, a test can register a seventh detector defined inside the test file
and assert it flows through with no production change beyond the registry. `pipeline.test.ts`
is `describe.skipIf(!DB_URL)` in its entirety, so a DET-07 or DET-09 test placed there
would silently not run without a database — which is the mechanical reason these helpers
are pure functions in `src/detect/run.ts` rather than inline pipeline code.

**3. Seeds are persisted inside the existing `persistScan` transaction, not by a separate
`persistSeeds()`.** `03-RESEARCH.md` recommends a second function; it is rejected because a
run that commits seeds and then fails to commit packages is a state nobody wants and the
transaction already exists. `RepoScan` gains `seeds: DetectedSeed[]`; the upsert loop is
five lines inside the transaction that already runs.

**4. `repo_seed` holds only GitHub-reachable entries, and carries no status column.**

| `marketplace.json` source | seed? | why |
|---|---|---|
| relative `./plugins/x` | **no** | it is inside the same repository, and the plugin detector already found it in this very scan |
| `github` | yes | `repo` is literally `owner/repo` |
| `url` | only `github.com` | anything else has no `owner/repo` to normalize, and this project fetches nothing else |
| `git-subdir` | only `github.com` | same, with `path` kept in `hint` |
| `npm` | **no** | no repository exists |
| `archive` | **no** | no repository exists, and dereferencing the URL is the SSRF this project forbids by construction |

Non-seedable entries are counted and named in the ingest's structured log line and nowhere
else. A seed row no phase can ever act on is a row every consumer has to filter forever.

No `status` column and no `enqueued_at`. Phase 5 (COR-03) owns fan-out and a nullable
timestamp is a one-line additive migration when it needs one; adding it now is a column
nothing writes. This mirrors `ingest_job`'s own recorded reasoning about `kind` and
`priority`.

**Seeds are filtered against `repository_denylist` at insert.** One `NOT EXISTS` inside a
transaction that is already open. DAT-06 says a removed repository is not silently
re-added; storing it as a seed is one bug away from re-adding it.

**5. `parentPath` is filled by one generic pipeline pass that names no artifact type.**
`Candidate` gains `containerRoot?: string`, set by a detector that *is* a container (only
`plugin.ts` this phase). The pass links a candidate to the longest `containerRoot` of a
*different* candidate that is a strict directory prefix of its source path. A
`containerRoot` of `''` links nothing, for the reason given in Measurement 2. Had the pass
instead read `c.type === 'plugin'`, a seventh container type would need a pipeline edit,
and DET-09 would already be false.

**6. `CAPS.maxFiles` rises from 200 to 400. Stated cost: raw fetches only, zero core
quota.** Forced by Measurement 1 — `wshobson-agents` wants 384 files after this phase.
Raw reads cost no GitHub core quota (that is why they are on `raw.githubusercontent.com`),
so the entire cost is wall clock and abuse-throttle exposure: 400 files at
`CAPS.concurrency = 2` fits inside `CAPS.wallClockMs = 120_000` with a budget of 600 ms per
file, against a measured typical raw read well under that. `scan.test.ts` refers to the cap
symbolically, so no test asserts the literal 200.

**7. `needs` are interleaved round-robin across detectors before the cap is applied.**
Today the cap takes the first 200 paths in registry-array order, so on a large repository
the last detector in the array would silently receive nothing. Six lines make the cut
proportional across types instead of dependent on array position — a correctness property
that is invisible to every test that does not use a 400-file repository.

**8. One package row per MCP declaration *file*, not per declared server.** The pipeline
keys the raw body, the content hash and the package identity on one file path; per-server
rows need either a synthetic `source_path` (`.mcp.json#name`) or a per-server content hash,
and both are pipeline changes bought to gain search granularity that Phase 6 has not asked
for, against a corpus that currently contains exactly one `.mcp.json`. When a file declares
exactly one server the row takes that server's name — the common case, and the one that
makes the row readable; otherwise the name is the containing directory and
`meta.serverCount` says how many. `meta.servers[]` is queryable jsonb the day Phase 6 wants
it. Carried into Phase 6: if search wants per-server rows, that is a re-key and should be
decided with query-log evidence.

**9. One package row per hook config *file*, not per hook entry** — accepted from
`03-RESEARCH.md` unchanged. A hook entry has no name and no identity outside its file.
`meta.events`, `meta.hookCount`, `meta.scope` carry the queryable surface. A
`.claude/settings.json` with no `hooks` key returns `status: 'none'` and produces no row;
it is not a malformed hook artifact, it is not a hook artifact.

**10. Environment variable *values* in an MCP declaration are never stored — key names
only.** A committed `.mcp.json` can carry a leaked credential in `env`. It is already
public, but AgentDock must not become a second place it lives, and FND-08/QUA-06 say no
credential appears in AgentDock's storage or logs. `meta.servers[].envKeys` stores the key
names; the values are dropped at parse.

**11. A shared `src/detect/json.ts` caps every JSON manifest before and during parse.**
`JSON.parse` has no alias mechanism, so the post-parse serialization cap that
`frontmatter.ts` needs for YAML buys nothing here; the real control is an **array-length
cap** (a `marketplace.json` with 100,000 entries) and a **depth cap** (so the project's own
validation walk cannot blow the stack). Input byte cap before parse, as always. No `zod`:
`grep` confirms it appears only in `src/env.ts`, and AGD-01 already shipped and tested the
tolerant hand-rolled `{ok, status, warnings[]}` pattern.

## Deviations from `03-RESEARCH.md`, listed

| Research says | This phase does | Why |
|---|---|---|
| `parse()` is already guarded; only `match()` needs a try/catch | Neither is guarded; all three call sites get one | Verified against source; see "The correction" |
| Extend `Detector` with `producesPackages?` + `seeds?()` | Extend `ParseResult` with two arms; `Detector` unchanged | Per-candidate fact, and the flag does not solve the `none` case |
| Add `persistSeeds()` beside `persistScan()` | Seeds persist inside `persistScan`'s existing transaction | A half-committed run is a state nobody wants |
| Eleven new hand-written fixture directories | Zero; the four frozen corpora already cover every type | Measurement 1 |
| Sample 20–30 live repositories to calibrate A3 | Ship ≥2 plus two exclusions; defer calibration to CAP-13 | Measurement 2 answers it at zero cost; Phase 4 already owns the labeled corpus |
| Refactor the skill detector onto the new interface | `skill.ts` is not touched | Its shape is already the target shape |
| The `Detector` extension point comment stays in `index.ts` | Run helpers move to `src/detect/run.ts`; `index.ts` stays the 8-line registry | Keeps "the entire extension point is this file" literally true |
| `.claude/settings.json` project-hooks schema is CITED-but-unverified (A1) | Detector tolerates both wrappings and returns `none` on neither | Blast radius is one file, and tolerance costs less than re-verification |

## Anti-goals — state these so execution does not drift

- **NO capability detection.** Shell / network / filesystem / secret / package-install /
  hidden-content extraction is CAP-01..CAP-14, Phase 4. Where a detector *sees* something
  capability-shaped — an MCP server's `command`/`args`, a hook's `command` — it is stored
  verbatim in `meta` as structural data and **never** interpreted as a risk signal, never
  scored, never flagged.
- **No risk score, no safety verdict, no grade.** None of *safe*, *clean*, *verified*,
  *trusted*, *approved* as a verdict on an artifact. Project-wide and permanent.
- **No UI work.** Phase 3 is backend detection. The detail page and capability panel are
  Phase 4. No page, component, or query file is touched except where a type union forces a
  compile fix.
- **No seed → job fan-out.** `repo_seed` rows are written; turning them into `ingest_job`
  rows is Phase 5 (COR-03). `MAX_QUEUED = 500` is a shared flood ceiling and one
  200-plugin marketplace must not consume 40% of it before Phase 5 has designed seed
  prioritization.
- **No search integration.** Findings and types do not enter ranking here; Phase 6.
- **No plugin-framework abstraction.** No base class, no registration DSL, no dynamic
  loading, no factory. One file plus one array element.

## Hard constraints (unchanged from Phases 0–2, restated because they bind every task)

- **Never execute repository content.** No `eval`, no `Function()`, no `child_process`, no
  `node:vm`, no dynamic import of repository files, no package-manager invocation.
  `check:boundaries` rule 5 enforces this and must keep passing.
- **Safe parsers only.** `JSON.parse`, and the existing `js-yaml` `CORE_SCHEMA` path via
  `parseFrontmatter`. Never `yaml.load` under a permissive schema. Size-cap before parse,
  and cap array length and depth, not only bytes.
- **Migrations touch `agentdock` only.** Additive DDL, no `DROP`, no `REVOKE`, nothing in
  `public` or `didim_mcp`. `bun run db:generate` → hand-review → `bun run db:migrate`.
  Never `drizzle-kit push`/`pull`/`migrate`. `bun run check:boundaries` must pass. The test
  schema regenerates from scratch into `.drizzle-test/`, so **anything hand-added to a
  `drizzle/` migration must also be added to `scripts/migrate.mjs`** — the artifact-type
  seed list is the specific trap, and forgetting it fails every database-backed suite on
  `package_type_artifact_type_id_fk`.
- **No new stateful services. PostgreSQL only. No new runtime dependencies** — the research
  confirmed none is needed and `zod` is deliberately not adopted for detector validation.
- **Phase 2 invariants must not regress:** previous-good-state preservation, the commit-SHA
  no-op, idempotent submit, truncated-scan-no-delist, package version history, bounded
  retries, the PostgreSQL-only queue.
- **GitHub budget: ~60 core requests/hour, unauthenticated.** `match()` stays path-only so
  a repository with no artifacts costs zero file fetches. Any change to fetch volume states
  its cost — item 6 above is the only one in this phase.
- **`bun run test`, never raw `bun test`** (Bun's runner hangs on this project's vitest
  suite). Full gate is `bun run ci`. Final order: `bun install --frozen-lockfile` →
  `bun run build` → `bun run ci`.
- **No `git commit` and no `git push`.** The executor must not run either. Each task is
  still an atomic unit of work with its own verification, but the phase ends with a
  recommended commit message and nothing staged. This deliberately overrides GSD's default
  atomic-commit behaviour.

## Plan split, and why it differs from the ROADMAP lines

The ROADMAP's three lines were written before the isolation correction and before the
corpus measurement. The plan **count stays at three**; the contents move, and
`ROADMAP.md` is updated to match.

| ROADMAP said | Now | Why it moved |
|---|---|---|
| 03-01: interface and registration, **skill detector refactored onto it** | 03-01: isolation, the widened result, seed storage, and the catalog as the tracer | `skill.ts` needs no refactor. Isolation must land *before* five throwing-capable detectors, not after — putting it last is mechanically backwards. The catalog is the one detector that exercises every new mechanism end to end, so it is the tracer. |
| 03-02: plugin, catalog-as-seeds, MCP | 03-02: plugin, MCP, nesting, and the file-cap raise | Catalog moved into 03-01 as the tracer. Nesting moved here because `containerRoot` is dead code until the plugin detector sets it, and the cap raise is forced by the plugin detector's 91 new `needs` in the largest corpus. |
| 03-03: command, hook, monorepo/nesting, **per-candidate failure isolation** | 03-03: command, hook, the seventh-detector proof, and the phase gate | Isolation moved to 03-01 Task 1. Nesting moved to 03-02. What is left is the two cheapest detectors plus the DET-09 proof, which needs all six registered to be worth running. |

Three waves, sequential. 03-02 and 03-03 both append to `src/detect/index.ts`, which the
project's own rule makes a serializing file — and the ordering is mechanical anyway:
03-03's seventh-detector proof wants all six registered, and 03-02's nesting test wants the
plugin detector that only 03-02 creates.

## What would falsify this phase

- A repository with a `SKILL.md` and a deliberately crash-inducing path yields zero
  packages. (Isolation did not hold.)
- `wshobson-agents` ingests and reports fewer than 91 plugin rows, or reports itself
  truncated. (The cap raise or the interleave did not land.)
- Any of the four corpora produces a `plugin` row at `.github`, `.claude`, or the
  repository root without a manifest. (The shape-only exclusions regressed.)
- A `marketplace.json` produces a `package` row on the success path. (DET-03 violated.)
- A `.claude/settings.json` with no `hooks` key produces any row. (Pitfall 4 regressed.)
- Registering a seventh detector requires editing anything but `src/detect/index.ts` and
  the new file. (DET-09 is false, and item 2 above is the record of the promise.)
