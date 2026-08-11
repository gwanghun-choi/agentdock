---
phase: AGD-03-detector-pluralism
plan: 02
type: execute
wave: 2
depends_on: ["03-01"]
files_modified:
  - src/detect/plugin.ts
  - src/detect/plugin.test.ts
  - src/detect/mcp.ts
  - src/detect/mcp.test.ts
  - src/detect/nesting.ts
  - src/detect/nesting.test.ts
  - src/detect/types.ts
  - src/detect/index.ts
  - src/detect/skill.test.ts
  - src/github/scan.ts
  - src/ingest/pipeline.ts
  - src/ingest/pipeline.test.ts
  - src/ingest/types.ts
  - src/ingest/persist.ts
  - src/ingest/persist.test.ts
  - src/db/schema.ts
  - drizzle/0004_*.sql
  - fixtures/adversarial/plugin-malformed.json
  - fixtures/adversarial/mcp-malformed.json
  - fixtures/adversarial/README.md
autonomous: true
requirements: [DET-02, DET-04, DET-06, QUA-03, QUA-05]

estimate:
  tokens: 90000
  raw_tokens: 90000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "A directory holding .claude-plugin/plugin.json is a plugin, named by the manifest when it names itself and by its directory when it does not"
    - "A directory holding two or more component shapes and no manifest is a plugin, recorded as shape-only and never as ok"
    - "A directory holding exactly one component shape is not a plugin"
    - "Neither .github nor .claude nor the repository root is ever a shape-only plugin"
    - "An .mcp.json declaring servers produces one row; an .mcp.json declaring none produces no row"
    - "A server.json carrying none of the registry manifest's fields produces no row"
    - "No environment variable value from any MCP declaration is stored anywhere"
    - "A skill inside a plugin directory records that plugin as its parent, and is still its own package row"
    - "The nesting pass names no artifact type, so a seventh container type needs no pipeline edit"
    - "The largest frozen corpus ingests all 91 of its plugins and does not report itself truncated"
  artifacts:
    - path: "src/detect/plugin.ts"
      provides: "Manifest and shape-only plugin detection, the component index, the two exclusions, and the confidence marker"
      exports: ["plugin", "COMPONENT_DIRS", "COMPONENT_FILES", "MIN_SHAPE_COMPONENTS"]
      min_lines: 120
    - path: "src/detect/mcp.ts"
      provides: "Both MCP declaration shapes under one detector — .mcp.json's mcpServers map and server.json's registry manifest"
      exports: ["mcp"]
      min_lines: 110
    - path: "src/detect/nesting.ts"
      provides: "The one generic containment pass, naming no artifact type"
      exports: ["assignParentPaths"]
      min_lines: 30
  key_links:
    - from: "src/detect/plugin.ts"
      to: "src/detect/nesting.ts"
      via: "the plugin detector sets containerRoot; the pass reads containerRoot and never reads a type"
      pattern: "containerRoot"
    - from: "src/ingest/pipeline.ts"
      to: "src/detect/nesting.ts"
      via: "one call over the flattened candidate set, after the match pass and before the parse loop"
      pattern: "assignParentPaths"
    - from: "src/ingest/types.ts"
      to: "src/db/schema.ts"
      via: "ScannedPackage.parentPath is written by the same upsert that already writes every other package column"
      pattern: "parentPath"
    - from: "src/github/scan.ts"
      to: "src/detect/run.ts"
      via: "the raised file cap is what lets six detectors' interleaved needs fit for the largest measured corpus"
      pattern: "CAPS.maxFiles"
---

<objective>
Detect plugins whether or not they declare themselves, detect both shapes of MCP
declaration, and link every artifact to the container it sits inside — with one
generic pass that names no artifact type.

Purpose: this is the plan where DET-02's hard half lives. A manifest-less plugin
is recognised by directory shape alone, and the same directory shapes are also the
shape of an ordinary skills collection, a `.github` folder, and a source tree with
a `commands/` directory in it. The rule that separates them is the phase's only
genuinely lossy judgement, so it ships with its threshold as one named constant,
both exclusions as named rules, and every negative case in the four frozen corpora
locked by a test.

It is also where the file budget stops fitting. Measured against
`fixtures/wshobson-agents/tree.json`: 180 skills plus 91 plugin manifests plus 109
commands plus 2 hooks plus 1 MCP declaration plus 1 catalog is 384 wanted files,
against a cap of 200. Left alone the largest real corpus is permanently truncated,
and since Phase 2 a truncated scan suppresses delisting — so it would also never
converge.

Output: `plugin.ts`, `mcp.ts`, `nesting.ts`, `package.parent_path`, and a file cap
that fits what six detectors actually ask for.

Honours the CONTEXT.md decisions on the ≥2 threshold and its two exclusions, on
one MCP row per file rather than per server, on never storing an environment
variable's value, on the containment pass naming no type, and on stating the cost
of any change to fetch volume.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/phases/AGD-03-detector-pluralism/CONTEXT.md
@.planning/phases/AGD-03-detector-pluralism/AGD-03-01-PLAN.md
@src/detect/types.ts
@src/detect/run.ts
@src/detect/json.ts
@src/detect/catalog.ts
@src/detect/skill.ts
@src/detect/index.ts
@src/ingest/pipeline.ts
@src/ingest/persist.ts
@src/ingest/types.ts
@src/db/schema.ts
@src/github/scan.ts
</context>

<decisions_made_while_planning>

**1. The ≥2 threshold is measured, not assumed — and the measurement was free.**

`03-RESEARCH.md` A3 flags the threshold as unmeasured and proposes sampling 20–30
live repositories. That sampling is not in this plan. The four frozen corpora
already hold 3,831 blob entries and answer it directly: a ≥1 rule false-positives
on `.github/workflows` in three of the four, on `.claude/skills` in two, on
`anthropics-skills`'s own root, and on `baoyu-skills`'s
`packages/baoyu-fetch/src/commands` — which is a source directory, not a plugin.
The ≥2 rule produces zero false positives and zero false negatives across all four.
`workflows` is in Claude Code's own component list and `.github/workflows/` may be
the most common directory path on GitHub; that single fact decides the threshold.

Sampling would cost roughly fifty of the sixty unauthenticated core requests
available per hour to produce a number the corpora give for nothing, and CAP-13 in
Phase 4 already mandates a hand-checked false-positive rate per detector against a
labeled corpus. Measuring here would duplicate Phase 4 with worse instrumentation.

**2. Two exclusions, both empirical and both semantic.**

Dot-prefixed directories are never shape-only plugin roots: `.github`, `.gemini`
and `.claude` all appear in the corpora with component directories beneath them and
none is a plugin. `.claude/` in particular is Claude Code's *project config*
directory, and Claude Code's own three-way distinction between a skill, a
`@skills-dir` plugin and a plugin-bundled skill turns on
`.claude-plugin/plugin.json`, which a config directory does not have.

The repository root is never a shape-only plugin root: it has no directory path to
use as an identity, and a `parent_path` of `''` on every artifact in the repository
says nothing `repository_id` did not already say. The cost is a manifest-less
root-level plugin going unrecorded as a container — its skills, commands and hooks
are each still detected and stored, which is what DET-06 actually asks for.

A declared manifest overrides both exclusions. Nothing overrides them for
shape-only.

**3. The containment pass reads `containerRoot`, never a type name.**

Had it read `c.type === 'plugin'`, a seventh container type would need a pipeline
edit and DET-09 would already be false. The plugin detector marks its own
candidates as containers; the pass links by longest strict directory prefix and
knows nothing about plugins.

**4. One MCP row per file, not per server.**

The pipeline keys the raw body, the content hash and the package identity on one
file path. Per-server rows need either a synthetic `source_path` like
`.mcp.json#name` or a per-server content hash, and both are pipeline changes bought
to gain search granularity Phase 6 has not asked for, against a corpus containing
exactly one `.mcp.json`. When a file declares exactly one server the row takes that
server's name, which is the common case and the one that makes the row readable.

**5. `plugin.json`'s `mcpServers` field is read by the plugin detector, not the
MCP detector.**

It is inline data in a manifest the plugin detector already fetched. Handing it to
`mcp.ts` would mean either a second read of the same file or a detector reading a
path it did not declare in `needs` — Pitfall 3 in one move.

Its *path-valued* forms are recorded and not followed. `plugin.json` can point
`hooks`, `mcpServers` and the component directories at arbitrary paths, and
resolving them needs a second fetch round after the first parse, which is exactly
what the two-phase `needs` contract exists to prevent. They land in
`meta.declaredComponents` as observed facts.

**6. `CAPS.maxFiles` 200 → 400, and the cost is stated.**

Raw reads cost no GitHub core quota — that is why they are on
`raw.githubusercontent.com` and why `scan.ts` says so at line 61. The entire cost
is wall clock and abuse-throttle exposure: 400 files at `CAPS.concurrency = 2`
inside `CAPS.wallClockMs = 120_000` allows 600 ms per file, well above a typical
raw read. `scan.test.ts` refers to the cap symbolically at lines 124–132, so no
test asserts the literal 200. Zero core requests are added.

**7. `package.parent_path` gets its own migration, in the plan that writes it.**

03-01 shipped `0003` with `repo_seed` and the artifact types. This plan ships
`0004` with one `ADD COLUMN`. Splitting a column from the code that writes it
across two plans means a migration nothing exercises for a wave; keeping them
together means each plan's DDL is reviewable on its own.

**8. `parent_path` stays out of `unique('package_identity')`.**

`(repository_id, type, source_path)` already disambiguates a plugin-owned skill
from a top-level one, because `source_path` differs. Adding a fourth column to a
populated table's unique constraint is a `DROP CONSTRAINT`, which this project's
boundary scanner classifies as destructive — for one bit of information the key
already carries.

</decisions_made_while_planning>

<reference>

## Reference A — the component index

No helper in `src/` groups tree entries by parent directory today; `directoryOf()`
at `skill.ts:21` returns a single segment and is the only path decomposition that
exists. This is new code, and it is the only new *structure* in the phase.

```ts
/** Directories whose presence beneath a root is evidence of a plugin. */
export const COMPONENT_DIRS = ['skills', 'commands', 'agents', 'workflows', 'output-styles'] as const;
/** Files whose presence at a root is the same evidence. */
export const COMPONENT_FILES = ['.mcp.json', '.lsp.json'] as const;
/**
 * Two, not one.
 *
 * Measured against the four frozen corpora (3,831 blob entries): a threshold of
 * one classifies `.github/workflows` as a plugin in three of the four,
 * `.claude/skills` in two, `anthropics-skills`'s own root, and
 * `baoyu-skills`'s packages/baoyu-fetch/src/commands — a source directory. Two
 * produces no false positive and no false negative across all four. `workflows`
 * is in Claude Code's component vocabulary and `.github/workflows/` is close to
 * the most common directory path on GitHub, which is what decides it.
 *
 * Recorded as a false-positive rate against a labeled corpus in Phase 4 (CAP-13).
 */
export const MIN_SHAPE_COMPONENTS = 2;

/** Every directory that has component shapes directly beneath it, and which. */
function componentIndex(tree: TreeEntry[]): Map<string, Set<string>>;
```

The index walks each blob path's segments once. A segment matching a
`COMPONENT_DIR` makes everything before it a candidate root; a basename matching a
`COMPONENT_FILE` makes its own directory one; `<root>/hooks/hooks.json` makes
`<root>` one with the component `hooks`. Path depth is already capped at
`CAPS.maxDepth = 10` by `scan.ts:56`, so the walk is bounded without its own limit.

Measured output on the corpora, which the test asserts verbatim:

| corpus | roots with ≥2 components | roots with exactly 1 |
|---|---|---|
| `addyosmani-agent-skills` | repo root (4) — and it has a manifest | `.claude`, `.gemini`, `.github` |
| `anthropics-skills` | none | repo root, `skills/skill-creator` |
| `baoyu-skills` | none | repo root, `.claude`, `.github`, `packages/baoyu-fetch/.github`, `packages/baoyu-fetch/src`, two nested `skills/*` paths |
| `wshobson-agents` | 71 of the 91 `plugins/*` roots | `.github`, and 20 `plugins/*` roots |

Note the last row: 20 of `wshobson-agents`'s 91 declared plugins carry only one
component. They are all detected anyway, because they all have manifests. That
number is the honest recall cost of the ≥2 rule if those manifests vanished, and
it belongs in the summary.

## Reference B — the plugin detector's two paths

```ts
export const plugin: Detector = {
  type: 'plugin',

  // Path-only, two rules. A declared manifest is a plugin wherever it is. A
  // directory with no manifest is a plugin only on the conservative rule above,
  // and only outside the two excluded locations.
  match(tree: TreeEntry[]): Candidate[] {
    // 1. every `<root>/.claude-plugin/plugin.json`
    //    -> { sourcePath: that file, needs: [that file], containerRoot: root }
    // 2. every componentIndex root with >= MIN_SHAPE_COMPONENTS, no manifest,
    //    a non-empty path, and no path segment beginning with '.'
    //    -> { sourcePath: root, needs: [], containerRoot: root }
  },
  ...
};
```

The shape-only candidate declares `needs: []`. It is a directory, not a file, and
03-01 already taught the pipeline that a candidate with no needs is not cut by the
file cap. Its version identity comes from `contentBasis` — the sorted component
list joined — so a component appearing or disappearing mints a version and nothing
else does.

Its artifact:

```ts
      name: <manifest name if a string, else the root's last segment>,
      slug: <the root's last segment>,
      summary: <manifest description, or null — never invented>,
      meta: {
        // 'manifest' | 'shape-only'. The UI's whole basis for distinguishing a
        // declared plugin from one that merely looks like one.
        detectionConfidence,
        components: [...sorted],
        // plugin.json's path-override fields, recorded as observed and never
        // followed: resolving them needs a second fetch round after the first
        // parse, which is what the two-phase needs contract exists to prevent.
        declaredComponents: { commands?, agents?, skills?, hooks?, mcpServers?, ... },
        // Inline server names only. Structural data, never a capability signal.
        mcpServers: [...names],
      },
```

A shape-only plugin **always** carries a warning, which forces
`status: warnings.length > 0 ? 'partial' : 'ok'` — the exact expression
`skill.ts:111` already uses — to `partial`. Do not special-case the status
expression; push the warning and let the existing rule decide. The warning text
names the rule, not the verdict: *"recognised by directory shape (skills,
commands); no plugin.json"*.

## Reference C — the MCP detector, two match rules under one detector

```ts
  match(tree: TreeEntry[]): Candidate[] {
    // `.mcp.json` at the repository root or any directory, and `server.json` at
    // the repository root or any directory. endsWith and equality only — no
    // regex, so there is no backtracking to be pathological about.
  },
```

`parse()` branches on the basename.

**`.mcp.json`** — the project/plugin scope map. `mcpServers` absent, not an
object, or empty → `{ ok: true, status: 'none', reason }`, no row. Otherwise one
row:

```ts
      // A file declaring exactly one server takes its name; that is the common
      // case and the only one where a filename would be a worse name than what
      // is inside. Otherwise the containing directory, with the count in meta.
      name: keys.length === 1 ? keys[0] : (dirOf(c.sourcePath) || 'mcp-servers'),
      meta: {
        serverCount: keys.length,
        servers: keys.map((k) => ({
          name: k,
          // `stdio` when a command is present, per the documented default.
          transport: srv.type ?? (srv.command ? 'stdio' : null),
          command: srv.command ?? null,   // stored verbatim, NEVER interpreted
          args: srv.args ?? null,          // Phase 4 (CAP-05) reads these, not this phase
          url: srv.url ?? null,            // data; nothing here fetches it
          // KEY NAMES ONLY. A committed .mcp.json can carry a credential in a
          // value; it is already public, and AgentDock must not become the
          // second place it lives (FND-08, QUA-06).
          envKeys: Object.keys(srv.env ?? {}),
        })),
      },
```

**`server.json`** — the MCP registry publishing manifest, an entirely different
schema. `name` present → that is the row's name and `description` its summary;
`packages[]` and `remotes[]` land in `meta` as `{registryType, identifier,
version, transport}`. A `server.json` carrying **none** of `name`, `description`,
`packages`, `remotes` → `{ ok: true, status: 'none' }`, because a file called
`server.json` in a Node repository is usually not an MCP manifest at all. A
`server.json` with `packages` but no `name` → `failed`, named after its directory
on the failure path, the way `skill.ts:74` does.

The registry is documented by its own maintainers as "in preview" with breaking
changes possible (`03-RESEARCH.md` A2). The tolerance above is the mitigation:
schema drift degrades to `partial` or to no row, never to a failed repository, and
the blast radius is one file.

## Reference D — the containment pass

```ts
/**
 * One generic pass. A candidate sits inside a container when a DIFFERENT
 * candidate declared a containerRoot that is a strict directory prefix of its
 * source path; the longest such root wins, so an artifact inside a plugin inside
 * a plugin links to the nearer one.
 *
 * This function names no artifact type on purpose. Reading `c.type === 'plugin'`
 * here would mean a seventh container type needs a pipeline edit, and DET-09
 * would already be false.
 *
 * A containerRoot of '' links nothing: a container that IS the repository adds
 * nothing that repository_id does not already say, and writing an empty string
 * onto every row would make the column noise.
 */
export function assignParentPaths(candidates: Candidate[]): void;
```

Called once in the pipeline, over the flattened candidate set, after the match
pass and before the parse loop:

```ts
    assignParentPaths(passes.flatMap((p) => p.candidates));
```

`Candidate` gains `containerRoot?: string`, documented as *set by a detector*,
beside `parentPath?: string`, documented as *filled by the pipeline, never by a
detector*.

## Reference E — the column and its migration

```ts
    // Nullable, no default, not in the identity key: (repository_id, type,
    // source_path) already disambiguates a plugin-owned skill from a top-level
    // one, because source_path differs. Adding a fourth column to a populated
    // table's unique constraint is a DROP CONSTRAINT for one bit the key already
    // carries.
    parentPath: text('parent_path'),
```

```sql
ALTER TABLE "agentdock"."package" ADD COLUMN "parent_path" text;
```

Schema-qualified, additive, no review marker needed —
`scripts/check-boundaries.mjs:38` matches the `ALTER TABLE` target and
`DESTRUCTIVE` at line 33 does not fire. `persistScan` writes it in both the
insert values and the `onConflictDoUpdate` set, alongside every other column it
already writes.

## Reference F — the cap, and the arithmetic behind the number

`src/github/scan.ts:12`:

```ts
  /**
   * Six detectors share this budget, not one. Measured on the largest frozen
   * corpus (wshobson-agents, 1,160 bounded blobs): 180 skills + 91 plugin
   * manifests + 109 commands + 2 hook configs + 1 MCP declaration + 1 catalog =
   * 384 wanted files, against the 180 a skills-only pipeline wanted.
   *
   * Raw reads cost no core quota — that is the whole reason they are on the raw
   * host, per the note above. The cost of this number is wall clock and
   * abuse-throttle exposure: 400 files at concurrency 2 inside wallClockMs
   * allows 600 ms per file, comfortably above a measured raw read.
   */
  maxFiles: 400,
```

`orderedNeeds` from 03-01 interleaves before this cap is applied, so a repository
past 400 loses files proportionally across types rather than starving whichever
detector sits last in `DETECTORS`.

</reference>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: A plugin that declares itself, and one that only looks like one</name>
  <files>src/detect/plugin.ts, src/detect/plugin.test.ts, src/detect/index.ts, src/detect/skill.test.ts, fixtures/adversarial/plugin-malformed.json, fixtures/adversarial/README.md</files>
  <behavior>
    - Every .claude-plugin/plugin.json in the corpora yields exactly one candidate: 91 in wshobson-agents, 1 in addyosmani-agent-skills, 0 in the other two.
    - A manifest candidate's needs is the manifest path; a shape-only candidate's needs is empty.
    - anthropics-skills yields zero plugin candidates: its root has one component and skills/skill-creator has one.
    - baoyu-skills yields zero: every root in it has exactly one component, including packages/baoyu-fetch/src, which is a source directory.
    - No corpus yields a shape-only candidate at .github, .gemini, .claude, or the repository root.
    - A synthetic tree with plugins/x/skills/ and plugins/x/agents/ and no manifest yields one shape-only candidate at plugins/x.
    - The same tree with only plugins/x/skills/ yields nothing.
    - A shape-only plugin parses to status partial with meta.detectionConfidence shape-only and a warning naming the components it was recognised by.
    - A manifest plugin with a name parses to that name; one without a name parses to its directory name, which is Claude Code's own auto-discovery rule.
    - A manifest that is not valid JSON, or is a JSON array, parses as failed with a readable error and a fallback name, not an exception.
    - Unknown top-level manifest fields are a warning, never a rejection.
    - A manifest's inline mcpServers names land in meta; its path-valued component overrides land in meta.declaredComponents and are not fetched.
    - Two shape-only plugins in one repository yield two candidates with distinct source paths.
  </behavior>
  <action>
    Build the component index first, as its own exported function with its own
    tests, and assert its output against all four corpora before writing a line of
    the detector. The table in Reference A is the assertion — if the code disagrees
    with it, the code is wrong, because that table was computed from the trees on
    disk.

    Then the two match rules and the parse. Reuse `parseJsonManifest` from 03-01;
    do not write a second JSON cap. Reuse `skill.ts`'s tolerance doctrine
    literally: `failed` only when identity is unusable, everything else a warning,
    unknown keys a warning, and `status: warnings.length > 0 ? 'partial' : 'ok'`
    unchanged — a shape-only plugin becomes `partial` by pushing a warning, not by
    special-casing the expression.

    Write the threshold as `MIN_SHAPE_COMPONENTS` with the measurement in its
    comment, and both exclusions as named, separately tested rules. This constant
    is the phase's one lossy judgement; someone will revisit it, and what they need
    is the evidence beside the number, not a magic 2.

    Do not add a base class, a registration DSL, or a shared detector factory.
    Two detectors now share a JSON parser and a tolerance doctrine, and that is
    what shared functions are for.

    Register in `src/detect/index.ts` as one import and one array element, and
    extend the registry test's expected type list.

    Record, in the summary, that 20 of wshobson-agents's 91 declared plugins carry
    only one component. That is the recall the ≥2 rule would cost if those
    manifests were absent, and it is the number a future revisit needs.
  </action>
  <verify>
    <automated>bun run test src/detect/plugin.test.ts &amp;&amp; bun run typecheck</automated>
  </verify>
  <done>All 92 manifest-declared plugins across the corpora are found; no corpus produces a shape-only plugin at a dot directory or at the repository root; a two-component directory without a manifest is found and marked shape-only and partial; a one-component directory is not found; a malformed manifest is one failed row.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Both shapes of MCP declaration, and no environment variable value anywhere</name>
  <files>src/detect/mcp.ts, src/detect/mcp.test.ts, src/detect/index.ts, src/detect/skill.test.ts, fixtures/adversarial/mcp-malformed.json, fixtures/adversarial/README.md</files>
  <behavior>
    - match finds .mcp.json and server.json at the repository root and at any directory, and finds the one .mcp.json wshobson-agents actually contains at plugins/runapi-mcp.
    - match ignores my.mcp.json, .mcp.json.bak, mcp.json, and a tree entry of type tree.
    - An .mcp.json with two servers produces one row named after its directory, with meta.serverCount 2 and both server names in meta.servers.
    - An .mcp.json with exactly one server produces one row named after that server.
    - An .mcp.json whose mcpServers key is absent, empty, or not an object produces no row at all and no failure.
    - A stdio server with no explicit type records transport stdio; an http server records what it declared.
    - A server declaring env records only the key names — the values appear nowhere in the artifact, the meta, or the warnings.
    - A command containing shell metacharacters is stored verbatim and is never split, interpreted, scored, or flagged.
    - A server.json with name and description produces one row carrying both, with packages[] in meta.
    - A server.json with none of name, description, packages or remotes produces no row.
    - A server.json with packages but no name produces one failed row named after its directory.
    - Malformed JSON in either shape produces a failed row, not an exception.
  </behavior>
  <action>
    One detector, two match rules, one branch in parse on the basename.
    `03-RESEARCH.md` Pitfall 1 is the reason: the two schemas share the word MCP
    and both live at a repository root, which invites one regex that gets both
    wrong.

    The environment-variable rule is not a nicety. A committed `.mcp.json` can
    carry a credential in an `env` value. It is already public in the source
    repository, but FND-08 and QUA-06 say no credential appears in AgentDock's
    storage or logs, and a package index that mirrors them into a searchable
    column is a materially worse artifact than the repository it copied. Store
    `envKeys` and drop the values at parse. Write the test that asserts a planted
    value appears in no field of the result — serialize the whole artifact and
    assert the string is absent, so the test keeps holding when someone adds a
    field.

    Store `command`, `args` and `url` verbatim and interpret nothing. Whether an
    MCP server's command reaches the network or installs a package is CAP-05, and
    Phase 4 owns it. A detector that starts scoring here is the anti-goal.

    Nothing in this file fetches a URL. `check:boundaries` rule 5 will fail the
    build if a GitHub host name appears outside `src/github/`; the same discipline
    applies by hand to every other host, and the pipeline test's
    contacted-hosts assertion is what proves it at runtime.

    Test `match()` against the corpora and `parse()` inline, the same split as
    03-01. `fixtures/adversarial/mcp-malformed.json` is the one file on disk;
    add its line to the adversarial README.
  </action>
  <verify>
    <automated>bun run test src/detect/mcp.test.ts &amp;&amp; bun run typecheck</automated>
  </verify>
  <done>Both declaration shapes are detected and parsed under one detector; an .mcp.json with no servers and a server.json that is not an MCP manifest each produce no row; no environment variable value appears anywhere in a parsed result; commands and URLs are stored as data and interpreted nowhere.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Nesting, and a file budget that fits six detectors</name>
  <files>src/detect/nesting.ts, src/detect/nesting.test.ts, src/detect/types.ts, src/ingest/pipeline.ts, src/ingest/pipeline.test.ts, src/ingest/types.ts, src/ingest/persist.ts, src/ingest/persist.test.ts, src/db/schema.ts, drizzle/0004_*.sql, src/github/scan.ts</files>
  <behavior>
    - A skill at plugins/foo/skills/bar/SKILL.md records parentPath plugins/foo when a plugin candidate declares that root, and is still its own package row with its own identity.
    - A top-level skill in the same repository records no parent.
    - An artifact inside nested containers records the nearer one.
    - A container declaring the repository root records no parent on anything.
    - A container records no parent on itself.
    - assignParentPaths over a candidate list containing no container leaves every parentPath undefined.
    - The pass contains no artifact type name — asserted by adding a test-local container detector of an invented type and watching its children link anyway.
    - parent_path round-trips through persistScan into the package row, on both the insert and the conflict path.
    - Ingesting wshobson-agents through the stubbed fetch stores 91 plugin rows and 180 skill rows, and reports itself not truncated.
    - The same ingest at the old cap of 200 does report itself truncated — so the cap raise is what changed it, and the test says which.
  </behavior>
  <action>
    Apply References D, E and F.

    Write `assignParentPaths` as a pure function over a candidate array with no
    knowledge of the pipeline, no knowledge of a detector, and no artifact type
    name in it. The test that proves the last part is the one that matters: define
    a container detector of an invented type inside the test file, run the pass,
    and assert its children linked. That test is DET-09 in miniature and it is
    cheaper than the argument about whether the code is generic.

    Generate `0004` with `bun run db:generate`, read it, apply it with
    `bun run db:migrate`, then `bun run db:test:setup`. One `ADD COLUMN`, no review
    marker needed. Do not touch `unique('package_identity')`.

    Raise `CAPS.maxFiles` with the arithmetic in the comment. State the cost where
    someone will read it: no core requests are added, the change is wall clock and
    raw-host exposure, and the number comes from a measured corpus rather than a
    guess. `scan.test.ts` uses the constant symbolically, so it needs no edit —
    confirm that by running it rather than by reading it.

    Prove the cap with the corpus rather than with arithmetic. `wshobson-agents`'s
    `tree.json` is complete on disk even though only twenty of its bodies were
    captured, so a `pipeline.test.ts` run against it exercises the real 384-file
    demand. Where a body is missing the pipeline already skips the candidate —
    which means the not-truncated assertion needs the stub to answer for every
    requested path, not only the captured ones. Serve a minimal valid body per
    type from the stub rather than capturing 384 more files; the assertion under
    test is the count and the truncation flag, not the content.

    Run the whole suite at the end. Two detectors and a new column landed, and the
    Phase 1 and Phase 2 suites are what prove the identity key, the delisting guard
    and the counters did not move with them.
  </action>
  <verify>
    <automated>bun run test &amp;&amp; bun run typecheck &amp;&amp; bun run check:boundaries</automated>
  </verify>
  <done>A plugin-owned artifact records its container and remains its own package row; the pass names no artifact type and a test with an invented container type proves it; parent_path persists on both upsert paths; the largest frozen corpus ingests all 91 plugins and 180 skills without reporting truncation, and the same run at the old cap does report it.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| a repository's directory names → a claim that it is a plugin | Path shape is attacker-chosen and the only evidence a manifest-less plugin offers |
| `plugin.json` / `.mcp.json` / `server.json` bytes → the validation walk | Untrusted JSON, sized and shaped by whoever wrote the repository |
| an `.mcp.json` `env` value → AgentDock's storage and logs | A committed credential must not gain a second, searchable home |
| an MCP `command` / hook `command` → any interpretation | The line between disclosure and a safety verdict, which this project does not cross |
| six detectors' `needs` → the shared file budget | One detector can starve the others if the cut is ordered rather than proportional |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-03-10 | Spoofing | shape-only plugin detection | medium | mitigate | `MIN_SHAPE_COMPONENTS = 2` plus the dot-directory and repository-root exclusions, each separately tested; every result marked `meta.detectionConfidence: 'shape-only'` and forced to `partial`, never `ok`, so a claim of "plugin" is never presented at the same confidence as a declared one. Residual false positives are recorded in CONTEXT.md rather than claimed away. |
| T-03-11 | Information Disclosure | `.mcp.json` `env` values | high | mitigate | Only key names are stored. The test serializes the whole parsed artifact and asserts a planted value string is absent, so the property survives a later field being added. |
| T-03-12 | Denial of Service | `componentIndex` over an adversarial tree | medium | mitigate | One linear pass over blob paths with no regex; path depth is already bounded at `CAPS.maxDepth = 10` by `scan.ts:56`, and 03-01's guarded `match()` means a throw here costs one detector rather than the repository. |
| T-03-13 | Denial of Service | six detectors sharing one file budget | medium | mitigate | Cap raised to a measured 400 with its arithmetic recorded, and 03-01's `orderedNeeds` interleaves so a repository past the cap loses files proportionally rather than by registry position. |
| T-03-14 | Tampering | `plugin.json` path-override fields | medium | mitigate | Recorded in `meta.declaredComponents` and never resolved. Following them needs a second fetch round after the first parse, which would let a manifest choose what AgentDock reads — the two-phase `needs` contract forbids it structurally. |
| T-03-15 | Tampering | a hook or MCP `command` interpreted as a risk signal | medium | mitigate | Stored verbatim, never split, scored, or flagged. CAP-05 in Phase 4 owns surfacing remote-execution directives; a detector doing it here would be the anti-goal and would ship an unmeasured false-positive rate. |
| T-03-16 | Elevation of Privilege | the `0004` migration | high | mitigate | One `ALTER TABLE ... ADD COLUMN`, schema-qualified, additive, generated then hand-reviewed before `db:migrate`; `check:boundaries` runs in the task's own verify command; `unique('package_identity')` is untouched so no `DROP CONSTRAINT` appears. |
| T-03-17 | Repudiation | `server.json` schema drift | low | accept | The MCP registry is self-described as in preview. Tolerance is the mitigation: unknown shapes degrade to `partial` or to no row, never to a failed repository, and the blast radius is one file. Re-checking against a live `server.json` is a Phase 5 concern, when the registry sync makes it cheap. |
</threat_model>

<verification>
1. All 92 manifest-declared plugins across the four corpora are detected; the counts match the trees on disk.
2. No corpus produces a shape-only plugin at `.github`, `.gemini`, `.claude`, or the repository root.
3. A two-component directory without a manifest is detected, marked `shape-only`, and reported `partial`; a one-component directory is not detected.
4. Both MCP declaration shapes are detected; an `.mcp.json` with no servers and a non-MCP `server.json` each produce no row.
5. No environment variable value appears in any field of any parsed MCP result.
6. `assignParentPaths` links children to the nearest container, links nothing for a root container, and contains no artifact type name — proven with an invented container type.
7. `parent_path` persists on both the insert and the conflict path, and is absent from the identity constraint.
8. `wshobson-agents` ingests 91 plugin rows and 180 skill rows without reporting truncation; at the old cap it reports truncation.
9. `bun run check:boundaries` passes on `0004`.
10. `bun run ci` passes.
</verification>

<success_criteria>
- **DET-02** — plugins are detected with a manifest and without one, and the manifest-less rule carries its threshold, its two exclusions, its confidence marker and its measured evidence.
- **DET-04** — both MCP declaration shapes are detected and parsed, with a documented reason for one row per file.
- **DET-06** — a monorepo yields every artifact it holds, each as its own package row, each linked to the container it sits in, and the largest measured corpus fits inside the file budget.
- **DET-09** — the containment pass names no artifact type; the invented-container-type test is the proof.
- **QUA-03 / QUA-05** — both detectors are unit-tested against frozen trees with no network and no token; the malformed manifests join the permanent adversarial suite.
- ROADMAP criteria 1 and 3 (in part) — plugins detected without a manifest via directory shape, MCP declarations detected and parsed.
</success_criteria>

<output>
Create `.planning/phases/AGD-03-detector-pluralism/03-02-SUMMARY.md` when done.
Record: the component-index table as the code actually produced it for all four
corpora; the plugin candidate count per corpus; how many of wshobson-agents's 91
declared plugins carry fewer than two components; the `.mcp.json` and `server.json`
counts found; the observed file-demand total for `wshobson-agents` and whether it
reported truncation at 400 and at 200; and the exact `0004` migration filename.
Record no credential and no connection string.

**Do not `git commit` and do not `git push`.** End with a recommended commit
message and leave the working tree for the maintainer.
</output>
