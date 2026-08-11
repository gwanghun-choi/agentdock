---
phase: AGD-03-detector-pluralism
plan: 03
type: execute
wave: 3
depends_on: ["03-01", "03-02"]
files_modified:
  - src/detect/command.ts
  - src/detect/command.test.ts
  - src/detect/hook.ts
  - src/detect/hook.test.ts
  - src/detect/index.ts
  - src/detect/run.test.ts
  - src/detect/skill.test.ts
  - src/ingest/pipeline.test.ts
  - fixtures/adversarial/hooks-malformed.json
  - fixtures/adversarial/settings-no-hooks.json
  - fixtures/adversarial/README.md
  - README.md
autonomous: true
requirements: [DET-05, DET-09, DET-10, QUA-03, QUA-05]

estimate:
  tokens: 80000
  raw_tokens: 80000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "A commands/*.md file is detected and parsed by the frontmatter parser the skill detector already uses"
    - "A command takes its name from its filename, not from its parent directory"
    - "A README inside a commands directory is not a command"
    - "A hook config file produces one row carrying its event names and its handler count"
    - "A .claude/settings.json with no hooks key produces no row at all — not a failed row, no row"
    - "A hook command is stored verbatim and interpreted nowhere"
    - "Registering a seventh detector requires one new file and one new array element, proven by a detector defined inside a test"
    - "All six detectors run against frozen trees with no network access and no token"
    - "The README no longer says AgentDock indexes skills only"
  artifacts:
    - path: "src/detect/command.ts"
      provides: "Flat-file command detection reusing parseFrontmatter, with the filename naming rule"
      exports: ["command"]
      min_lines: 70
    - path: "src/detect/hook.ts"
      provides: "Both hook config scopes, the event-name extraction, and the no-hooks-key silent drop"
      exports: ["hook", "HOOK_CAPS"]
      min_lines: 90
    - path: "src/detect/run.test.ts"
      provides: "The seventh-detector proof: a detector defined in the test file flows through with no production change"
      min_lines: 120
  key_links:
    - from: "src/detect/command.ts"
      to: "src/detect/frontmatter.ts"
      via: "the same parser, unmodified — a second frontmatter splitter would have to re-earn the CRLF, BOM, duplicate-key and alias-bomb handling AGD-01 measured"
      pattern: "parseFrontmatter"
    - from: "src/detect/hook.ts"
      to: "src/detect/json.ts"
      via: "the shared cap doctrine, not a fourth hand-rolled JSON guard"
      pattern: "parseJsonManifest"
    - from: "src/detect/run.test.ts"
      to: "src/detect/run.ts"
      via: "collectCandidates and safeParse take the detector list as a parameter, which is what makes DET-09 runtime-testable instead of a review checklist item"
      pattern: "collectCandidates(["
---

<objective>
Add the two cheapest detectors, then prove out loud the thing the whole phase was
for: that the seventh costs one file and one array element.

Purpose: commands and hooks are the phase's smallest work — a command is the
skill detector with a different naming rule, and a hook is a JSON file with an
event map. They are last because they are cheapest and because the DET-09 proof
wants all six registered before it is worth running.

`03-RESEARCH.md`'s Test Map marks DET-09 as "manual-only — a structural property,
verified by review, not runtime-testable". That is no longer true. 03-01 put the
detector list behind a parameter, so a detector defined inside a test file can be
run through the same code the pipeline runs, and the claim becomes an assertion.
A promise nobody can fail is not a promise.

Output: `command.ts`, `hook.ts`, six registered detectors, a runtime DET-09 proof,
and a README that no longer says AgentDock indexes skills only.

Honours the CONTEXT.md decisions on one hook row per file, on a `settings.json`
with no hooks key producing no row, on reusing `parseFrontmatter` rather than
writing a second one, and on never interpreting a hook command.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/phases/AGD-03-detector-pluralism/CONTEXT.md
@.planning/phases/AGD-03-detector-pluralism/AGD-03-01-PLAN.md
@.planning/phases/AGD-03-detector-pluralism/AGD-03-02-PLAN.md
@src/detect/types.ts
@src/detect/run.ts
@src/detect/json.ts
@src/detect/skill.ts
@src/detect/frontmatter.ts
@src/detect/index.ts
@src/detect/skill.test.ts
@README.md
</context>

<decisions_made_while_planning>

**1. The command detector reuses `parseFrontmatter` and adds nothing to it.**

Claude Code merged custom commands into skills: `[CITED:
code.claude.com/docs/en/skills]` *"A file at `.claude/commands/deploy.md` and a
skill at `.claude/skills/deploy/SKILL.md` both create `/deploy` and work the same
way... Files in `.claude/commands/` support the same frontmatter."* The only
differences are the path shape — one flat file, not a directory with a manifest —
and the name source: the filename minus its extension, not the parent directory.

A second frontmatter splitter would have to re-earn the CRLF, BOM, duplicate-key,
alias-bomb and horizontal-rule handling AGD-01 measured against 100 real files.
This detector is the concrete proof of DET-09's "one file" promise: the seventh
flat-frontmatter format costs a `match()` and a naming rule.

**2. Command matching is path segments, not a regex.**

`e.path.endsWith('.md') && e.path.split('/').includes('commands')` has no
backtracking to be pathological about, and it covers `.claude/commands/x.md`, a
plugin's `commands/x.md`, and nested `commands/sub/x.md` in one rule — the same
way `skill.ts:44` covers three layouts with one `endsWith`.

`README.md` inside a `commands/` directory is excluded by basename. Without that,
every commands directory carrying a README produces a `failed` row for a file
that was never a command, which is noise dressed as disclosure. The corpora
contain 117 command-shaped files, so this is a real count, not a hypothetical.

**3. One row per hook config file, and a `settings.json` with no hooks is not a
failure.**

A hook entry has no name, no description, and no meaning outside the file it sits
in — an event handler is not something a user searches for. `meta.events` and
`meta.hookCount` are the queryable surface, mirroring the decision that a
`marketplace.json` is one catalog and not N plugins.

`.claude/settings.json` exists in many repositories for `enabledPlugins` alone.
Path-only `match()` cannot see whether it carries hooks, so `match()` returns the
candidate cheaply and `parse()` returns `status: 'none'` when the parsed JSON has
no non-empty `hooks` key. That is not a malformed hook artifact; it is not a hook
artifact, and it deserves the same silence a repository with no `SKILL.md` gets.
This is the case `03-RESEARCH.md` Pitfall 4 names, and 03-01 built the `'none'`
arm precisely for it.

**4. Event names are read from the file, never from a hardcoded list.**

Claude Code's lifecycle vocabulary spans thirty-plus events and grows between
releases. `Object.keys(json.hooks)` is what the file said; a hardcoded allowlist
would silently go stale and start dropping real hooks on a Claude Code release
AgentDock did not notice.

**5. `plugin.json`'s inline `hooks` field is not this detector's business.**

Per 03-02, `plugin.json`'s component fields — including `hooks` — are recorded in
`meta.declaredComponents` by the plugin detector and never resolved. A path-valued
`hooks` field pointing at `./config/hooks.json` is followed by nobody: resolving it
needs a second fetch round after the first parse, which the two-phase `needs`
contract forbids. If that file happens to live under a `hooks/` directory, this
detector finds it independently, by path, at no extra cost.

**6. DET-09's proof is a test, not a checklist item.**

Because `collectCandidates` and `safeParse` take `detectors` as a parameter, the
test defines a seventh detector of an invented type inside the test file, runs it
through the same functions the pipeline runs, and asserts a candidate and an
artifact come out. It proves the registry contract — one file, one array element —
and it does not prove persistence, which needs an `artifact_type` row and is
therefore honestly outside what a registry test can claim. Say that in the test's
own comment rather than overstating it.

**7. The README's Phase 1 sentence is corrected here, and no other UI text is
touched.**

`README.md:11` says *"Phase 1 indexes Agent Skills only. Plugins, MCP servers,
commands and hooks come..."* — that sentence becomes false the moment this plan
lands, and it is the first thing a reader sees. Lines 4 and 115 describe the
detector directory the same way. Three sentences. Nothing else in the UI is
touched: the detail page and the capability panel are Phase 4.

</decisions_made_while_planning>

<reference>

## Reference A — the command detector

```ts
import { parseFrontmatter } from './frontmatter';

/** The largest sampled command file is well under this; same excerpt rule as skills. */
const MAX_BODY = 32 * 1024;

export const command: Detector = {
  type: 'command',

  // Path segments, not a regex — no nested quantifiers, nothing to backtrack.
  // Covers .claude/commands/x.md, a plugin's commands/x.md, and a nested
  // commands/sub/x.md in one rule. A README inside a commands directory is not a
  // command; without that exclusion every such README becomes a failed row for a
  // file that was never an artifact.
  match(tree: TreeEntry[]): Candidate[] {
    return tree
      .filter((e) => {
        if (e.type !== 'blob' || !e.path.endsWith('.md')) return false;
        const segments = e.path.split('/');
        if (segments[segments.length - 1].toUpperCase() === 'README.MD') return false;
        return segments.slice(0, -1).includes('commands');
      })
      .map((e) => ({ type: 'command', sourcePath: e.path, needs: [e.path] }));
  },
```

`parse()` is `skill.parse` with one substitution. Same `parseFrontmatter` call,
same warnings array, same three ways to fail, same
`status: warnings.length > 0 ? 'partial' : 'ok'`. The one change:

```ts
    // The naming rule, verbatim from code.claude.com/docs/en/skills: "File under
    // .claude/commands/ -> File name without extension -> .claude/commands/
    // deploy.md -> /deploy". skill.ts derives its name from the parent directory;
    // this is the whole structural difference between the two formats.
    const fileName = c.sourcePath.split('/').pop()!.replace(/\.md$/, '');
```

The directory-name-mismatch warning `skill.ts:90` emits does not apply — a
command has no directory to mismatch. A missing `name` in the frontmatter falls
back to the filename rather than failing, because unlike a skill the filename is
the authoritative name. A missing `description` is still a warning, not a failure,
for the same reason it is a warning everywhere else: rejecting on it discarded a
quarter of AGD-01's measured corpus.

Corpus counts `match()` must produce, computed from the trees on disk:
`wshobson-agents` 109, `addyosmani-agent-skills` 8, the other two 0.

## Reference B — the hook detector

```ts
export const HOOK_CAPS = {
  /**
   * A hook config is a small event map. This is far below the shared JSON input
   * cap and exists so a hooks.json cannot become the one oversized manifest the
   * generic cap still allows.
   */
  inputBytes: 64 * 1024,
  /** Beyond this many handlers the file is a generated artifact, not a config. */
  maxHandlers: 500,
} as const;

export const hook: Detector = {
  type: 'hook',

  // Two locations, one detector. A plugin declares hooks in a JSON file directly
  // inside a hooks/ directory; a project declares them under .claude/settings.json's
  // top-level "hooks" key, alongside unrelated settings. Path-only match() cannot
  // tell a settings.json with hooks from one without, so it returns both and
  // parse() decides.
  match(tree: TreeEntry[]): Candidate[] {
    // <anything>/hooks/<name>.json  OR  <anything>/.claude/settings.json (and the root one)
  },
```

`parse()`:

- `parseJsonManifest` from 03-01, then the `HOOK_CAPS.inputBytes` check.
- No `hooks` key, or `hooks` is not an object, or it has no keys →
  `{ ok: true, status: 'none', reason: 'no hooks declared' }`. **No row.**
- Otherwise one row:

```ts
      // A hook has no name of its own. The file's basename is the only honest
      // identity, and source_path is the identity key anyway, so two hook files
      // in one repository never collide.
      name: <basename without .json>,
      summary: null,   // never invented; a hook config declares no description
      meta: {
        scope: <'plugin' | 'project'>,
        // Read from the file, never from a hardcoded list. Claude Code's
        // lifecycle vocabulary spans thirty-plus events and grows between
        // releases; an allowlist here would silently start dropping real hooks.
        events: Object.keys(json.hooks),
        hookCount: <sum of the inner hooks[] lengths>,
        // Verbatim. Whether a hook command reaches the network or installs a
        // package is CAP-05 and Phase 4 owns it. Stored, never interpreted.
        handlers: [{ event, matcher, type, command }],
      },
```

`03-RESEARCH.md` A1 flags the project-scope wrapping as CITED-but-not-verbatim.
The mitigation is tolerance rather than verification: read `hooks` if present,
return `none` if not, and record whatever inner shape arrives. If the wrapping
turns out to differ, the blast radius is this one file.

## Reference C — the seventh-detector proof

In `src/detect/run.test.ts`, beside the isolation tests 03-01 put there:

```ts
/**
 * DET-09, as an assertion rather than a review note.
 *
 * This detector exists only inside this file. It is never imported by src/, never
 * added to DETECTORS, and nothing in the pipeline knows its type — which is the
 * point: registering a seventh artifact type is one new file and one new element
 * in the DETECTORS array, and everything between match() and a parsed artifact
 * already accepts it.
 *
 * What this does NOT prove: persistence. A package row needs an artifact_type row
 * and therefore a migration, which is a schema change and was never claimed to be
 * free. The promise is about the detector contract, and that is what is asserted.
 */
const seventh: Detector = { type: 'invented', match(tree) { ... }, async parse(c, read) { ... } };

it('runs a detector that the registry has never seen', async () => {
  const passes = collectCandidates([...DETECTORS, seventh], tree);
  expect(passes).toHaveLength(DETECTORS.length + 1);
  expect(passes.at(-1)?.candidates).toHaveLength(1);
  const result = await safeParse(seventh, passes.at(-1)!.candidates[0], read);
  expect(result.ok && result.artifact.name).toBe('...');
});

it('leaves the six real detectors' output identical whether or not it is present', () => {
  // The seventh cannot perturb the other six. This is the half of DET-09 that
  // would fail if a detector ever reached across into another's candidates.
});
```

The registry test in `skill.test.ts` reaches its final form here:

```ts
    expect(DETECTORS.map((d) => d.type)).toEqual([
      'skill', 'catalog', 'plugin', 'mcp_server', 'command', 'hook',
    ]);
```

## Reference D — DET-10, stated as a runnable property

`03-RESEARCH.md` and the ROADMAP both ask that every detector run against frozen
fixtures with no network and no token. Three assertions make that structural
rather than aspirational, and they belong in one test:

```ts
// match() cannot fetch, because it has no reader to call. skill.test.ts:59
// already asserts this for one detector; it holds for all six or the interface
// has drifted.
for (const d of DETECTORS) expect(d.match).toHaveLength(1);

// No detector module reaches the network. check:boundaries rule 5 fails the build
// if a GitHub host is named outside src/github/, and parse() takes its reader as
// a parameter — so a detector that wanted to fetch would have to import one.
// Asserted at runtime by running the whole registry with fetch stubbed to throw.
```

Run the whole registry over every frozen corpus with `globalThis.fetch` replaced
by a function that throws, and with `GITHUB_TOKEN` stubbed empty. If any detector
reaches for either, the test says which.

## Reference E — the README's three sentences

Line 4: *"reads the `SKILL.md` files inside"* → the artifact files inside, naming
the six types.
Line 11: *"Phase 1 indexes Agent Skills only. Plugins, MCP servers, commands and
hooks come..."* → the six types are detected; capability disclosure is what comes
next.
Line 115: *"detect/  SKILL.md detection and tolerant frontmatter parsing"* → six
detectors, tolerant frontmatter and capped JSON parsing.

Nothing else. No new section, no feature tour. Three sentences that are currently
false.

</reference>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: A command is the skill detector with a different name source</name>
  <files>src/detect/command.ts, src/detect/command.test.ts, src/detect/index.ts, src/detect/skill.test.ts</files>
  <behavior>
    - match finds 109 commands in wshobson-agents and 8 in addyosmani-agent-skills, and none in the other two corpora.
    - match covers .claude/commands/x.md, a plugin's commands/x.md, and a nested commands/sub/x.md.
    - match excludes a README.md inside a commands directory, a .md outside any commands directory, a non-.md file inside one, and a tree entry of type tree.
    - A command's name is its filename without the extension, even when the frontmatter declares a different one — and the mismatch is a warning, not a rejection.
    - A command with frontmatter but no name field takes the filename as its name and does not fail.
    - A command with no description is partial, not failed.
    - A command with no frontmatter fence fails with the same message a skill does, because it is the same parser.
    - The alias-bomb adversarial fixture fails a command the same way it fails a skill.
    - allowed-tools normalizes from a string, a comma list and a list, identically to skills.
  </behavior>
  <action>
    Apply Reference A. Import `parseFrontmatter` and change nothing in
    `frontmatter.ts` — the whole value of this detector is that it is proof the
    parser was worth generalising.

    Do not copy `skill.ts` wholesale and edit it. Read it, take the tolerance
    doctrine, and write the smaller thing: a command has no directory to mismatch,
    so the directory warning is gone, and the filename is authoritative, so a
    missing frontmatter `name` is a fallback rather than a failure. Those two
    differences are the entire diff between the formats, and the file should read
    that way.

    Point the existing adversarial fixtures at this detector too. `alias-bomb.md`,
    `bad-yaml.md`, `no-fence.md` and `bom.md` are in `fixtures/adversarial/`
    already and they are the same bytes whether the file is called `SKILL.md` or
    `deploy.md`. Reusing them costs one `it.each` and proves the shared parser
    really is shared. No new fixture files in this task.

    Register in `src/detect/index.ts` and extend the registry test's list.
  </action>
  <verify>
    <automated>bun run test src/detect/command.test.ts &amp;&amp; bun run typecheck</automated>
  </verify>
  <done>117 commands are found across the corpora with the counts the trees hold; a command is named by its filename; a README in a commands directory is not a command; the existing adversarial fixtures fail a command exactly as they fail a skill, through the same unmodified parser.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: A hook config is one row, and a settings file without hooks is nothing at all</name>
  <files>src/detect/hook.ts, src/detect/hook.test.ts, src/detect/index.ts, src/detect/skill.test.ts, fixtures/adversarial/hooks-malformed.json, fixtures/adversarial/settings-no-hooks.json, fixtures/adversarial/README.md</files>
  <behavior>
    - match finds the 2 hook configs in wshobson-agents and the 1 in addyosmani-agent-skills, and none in the other two corpora.
    - match finds a .json directly inside a hooks/ directory, at the repository root and nested, and finds .claude/settings.json at the root and nested.
    - match ignores hooks/README.md, a .json one level below a hooks directory, and a tree entry of type tree.
    - A plugin hooks.json with two events produces one row with both event names in meta.events and the summed handler count in meta.hookCount.
    - A project settings.json carrying a hooks key produces one row with scope project.
    - A settings.json with enabledPlugins and no hooks key produces no row — not a failed row, no row.
    - A settings.json whose hooks key is an empty object produces no row.
    - A hooks file that is not valid JSON produces one failed row.
    - A handler command containing shell metacharacters, a pipe, and a URL is stored verbatim and appears in no interpreted form.
    - An event name AgentDock has never heard of is recorded, because the list is read from the file and not from a hardcoded vocabulary.
    - A file over the handler cap fails naming the cap rather than storing five hundred handlers.
  </behavior>
  <action>
    Apply Reference B. Use `parseJsonManifest` from 03-01 — this is the fourth JSON
    manifest format in the phase and the third caller of that function, which is
    the argument for it having existed.

    Get the no-row case right first, before anything else in this task. It is the
    one Pitfall 4 names and the one that decides whether every repository with a
    checked-in `.claude/settings.json` shows a spurious hook artifact. Write
    `fixtures/adversarial/settings-no-hooks.json` as a realistic settings file —
    `enabledPlugins`, `pluginConfigs`, permissions — so the test is about a file
    that really exists in the wild rather than an empty object.

    Read the event names from the file. Do not write a list of Claude Code
    lifecycle events into this repository: it spans thirty-plus names, it grows
    between releases, and an allowlist would silently start dropping real hooks on
    a release nobody here noticed.

    Store handler commands verbatim and interpret nothing. No splitting on shell
    metacharacters, no URL extraction, no flag, no score. CAP-05 in Phase 4 owns
    surfacing remote-execution directives, and it owns the false-positive rate that
    comes with it. Write the test that asserts a metacharacter-laden command
    round-trips byte for byte — that assertion is what stops a well-meaning later
    edit from starting to parse it.

    Add both new fixtures to the adversarial README. Register in
    `src/detect/index.ts` and extend the registry test's list to all six.
  </action>
  <verify>
    <automated>bun run test src/detect/hook.test.ts &amp;&amp; bun run typecheck</automated>
  </verify>
  <done>Both hook scopes produce one row per file carrying their event names and handler count; a realistic settings.json with no hooks key produces no row at all; an unknown event name is recorded; a hostile command round-trips verbatim and is interpreted nowhere.</done>
</task>

<task type="auto">
  <name>Task 3: Prove the seventh is free, prove nothing touches the network, and close the phase</name>
  <files>src/detect/run.test.ts, src/detect/skill.test.ts, src/ingest/pipeline.test.ts, README.md</files>
  <behavior>
    - A detector defined inside the test file, of a type no production file mentions, produces candidates through collectCandidates and an artifact through safeParse.
    - Adding that detector changes none of the six real detectors' output for the same tree.
    - The registry holds exactly six elements, in order, each with a distinct type — and the test fails if a detector file exists without an array element.
    - Every detector's match takes exactly one parameter, so none of them can fetch.
    - Running all six detectors over all four frozen corpora with fetch stubbed to throw and GITHUB_TOKEN empty completes and produces artifacts.
    - Ingesting each of the four corpora end to end produces the per-type counts the trees hold, and no run contacts a host outside the two allowlisted ones.
    - The README no longer states that AgentDock indexes skills only.
    - bun run ci passes, and bun run build succeeds.
  </behavior>
  <action>
    Apply References C, D and E.

    The seventh-detector test is the phase's thesis, so write its comment as
    carefully as its assertions, and be precise about what it does not prove: a
    package row needs an `artifact_type` row and therefore a migration, and that
    was never claimed to be free. Overstating it here would make the phase's own
    record dishonest.

    The no-network test is DET-10 made structural. Stub `globalThis.fetch` with a
    function that throws, stub `GITHUB_TOKEN` empty, run every detector over every
    corpus, and let the failure name the detector. Combined with
    `check:boundaries` rule 5 — which fails the build if a GitHub host appears
    outside `src/github/` — that is the requirement satisfied by construction and
    by assertion, not by convention.

    Then run the four corpora through the pipeline end to end and record the
    per-type counts in the summary. Those numbers are the phase's real output and
    the baseline every later phase compares against. Where a corpus body was never
    captured the stub answers with a minimal valid body for that type — the
    assertion is the count, not the content.

    Fix the three README sentences. Three sentences, no new section. The file
    currently tells a reader the product does one sixth of what it does.

    Finish with `bun install --frozen-lockfile`, then `bun run build`, then
    `bun run ci`, in that order. The build is in the list because a type union
    widened in 03-01 and Next's build is the only thing that type-checks the app
    router's own generated types.

    **Do not commit and do not push.** Write the recommended commit message into
    the summary and stop.
  </action>
  <verify>
    <automated>bun run ci &amp;&amp; bun run build</automated>
  </verify>
  <done>A detector the registry has never seen runs through the same code the pipeline runs, and perturbs nothing; all six detectors run over all four corpora with fetch stubbed to throw; the four corpora ingest end to end with the counts their trees hold; the README is true; `bun run ci` and `bun run build` both pass.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| a `commands/**/*.md` body → the frontmatter parser | Untrusted YAML, already the parser's threat model, now reached by a second path |
| a hook config's JSON → the validation walk | Untrusted, and specifically likely to carry shell-shaped strings |
| a hook `command` string → any interpretation | The line between disclosure and a safety verdict |
| a detector module → the network | DET-10 asks that no detector can reach it, which is a property to assert, not to assume |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-03-18 | Denial of Service | command frontmatter | medium | mitigate | The same `parseFrontmatter` with the same two caps, reached by a second path. The existing `alias-bomb.md`, `bad-yaml.md`, `no-fence.md` and `bom.md` fixtures are driven through the command detector, so the caps are asserted for this path and not merely inherited on paper. |
| T-03-19 | Denial of Service | a hook config with thousands of handlers | medium | mitigate | `HOOK_CAPS.maxHandlers` on top of the shared `JSON_CAPS` array cap, plus a tighter per-file byte cap than the generic one, because a hook config is small and a large one is not a config. |
| T-03-20 | Tampering | a hook `command` interpreted rather than stored | high | mitigate | Stored verbatim, split by nothing, matched against nothing. A test asserts a metacharacter- and URL-laden command round-trips byte for byte, which is what stops a later edit from beginning to parse it. CAP-05 in Phase 4 owns surfacing, with the false-positive discipline that requires. |
| T-03-21 | Spoofing | a `.claude/settings.json` presented as a hook artifact | medium | mitigate | `parse()` returns `none` and writes no row when there is no non-empty `hooks` key, tested against a realistic settings file carrying `enabledPlugins` and permissions rather than an empty object. |
| T-03-22 | Information Disclosure | a detector reaching the network | high | mitigate | Asserted twice: `check:boundaries` rule 5 fails the build on a GitHub host named outside `src/github/`, and a runtime test runs all six detectors over all four corpora with `fetch` stubbed to throw and the token stubbed empty. `parse()` takes its reader as a parameter, so a detector that wanted to fetch would have to import one. |
| T-03-23 | Denial of Service | ReDoS in the command path rule | low | mitigate | Segment comparison and `endsWith`, no regex with nested quantifiers. The one regex in the file strips a literal `.md` suffix. |
| T-03-24 | Repudiation | the project-scope hook wrapping being wrong (A1) | low | accept | The shape was CITED but not verbatim-verified. Tolerance is the mitigation — an unrecognised wrapping yields `none`, not a wrong row — and the blast radius is one file. Re-verify if a real corpus shows hooks going undetected. |
</threat_model>

<verification>
1. 117 commands are found across the four corpora, matching the counts their trees hold; a README inside a commands directory is not one of them.
2. A command is named by its filename; a frontmatter name that disagrees is a warning.
3. The existing adversarial fixtures fail a command exactly as they fail a skill, through the unmodified shared parser.
4. Both hook scopes produce one row per file with event names read from the file.
5. A realistic `settings.json` with no `hooks` key produces no row at all.
6. A hostile hook command round-trips byte for byte and is interpreted nowhere.
7. A detector defined inside a test, of a type no production file mentions, runs through `collectCandidates` and `safeParse` and perturbs none of the six.
8. `DETECTORS` holds exactly six elements with distinct types, and the registry test fails if a detector is added without an element.
9. All six detectors run over all four corpora with `fetch` stubbed to throw and no token present.
10. The four corpora ingest end to end and contact only the two allowlisted hosts.
11. The README no longer says AgentDock indexes skills only.
12. `bun install --frozen-lockfile`, `bun run build`, and `bun run ci` all succeed.
</verification>

<success_criteria>
- **DET-05** — commands and hooks are each detected and parsed; the command half reuses the existing frontmatter parser unmodified, and the hook half produces one row per config file with its events and handler count.
- **DET-09** — registering a seventh artifact type is one new file and one new array element, asserted at runtime by a detector defined inside a test, with the limit of the claim stated in the test itself.
- **DET-10** — every detector runs against frozen fixtures with no network access and no token, asserted by a stubbed `fetch` that throws and enforced by `check:boundaries`.
- **QUA-03 / QUA-05** — all six detectors are unit-tested; the adversarial suite grows by two hook fixtures and gains a second consumer for four existing ones.
- ROADMAP criteria 3, 5 and 6 — commands and hooks each detected and parsed; a hypothetical new type needs one detector file and one registration; every detector runs against frozen fixtures with no network and no token.
</success_criteria>

<output>
Create `.planning/phases/AGD-03-detector-pluralism/03-03-SUMMARY.md` when done.
Record: the per-type artifact counts each of the four corpora produced end to end
— skill, plugin, catalog seeds, mcp_server, command, hook — because those numbers
are the phase's real output and every later phase's baseline; whether any corpus
reported itself truncated; what the seventh-detector test proves and what it
deliberately does not; and the recommended commit message for the whole phase.
Record no credential and no connection string.

**Do not `git commit` and do not `git push`.** The phase ends with a working tree
and a recommended message, and the maintainer decides.
</output>
