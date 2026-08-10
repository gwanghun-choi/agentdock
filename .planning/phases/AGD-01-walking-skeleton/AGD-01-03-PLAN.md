---
phase: AGD-01-walking-skeleton
plan: 03
type: tdd
wave: 2
depends_on: ["01-01"]
files_modified:
  - scripts/capture-fixtures.mjs
  - fixtures/addyosmani-agent-skills/
  - fixtures/baoyu-skills/
  - fixtures/wshobson-agents/
  - fixtures/adversarial/
  - src/detect/types.ts
  - src/detect/frontmatter.ts
  - src/detect/frontmatter.test.ts
  - src/detect/skill.ts
  - src/detect/skill.test.ts
  - src/detect/index.ts
autonomous: true
requirements: [DET-01, DET-08, DET-10, QUA-03, QUA-05, PRV-05, PRV-06]

estimate:
  tokens: 60000
  raw_tokens: 60000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "All 18 skills in the reference repository parse, including the one whose declared name contradicts its directory and the one whose description exceeds the documented cap — a strict schema would have discarded about a quarter of the measured corpus"
    - "A file that violates the specification is recorded as partial with named warnings, never dropped"
    - "A file with no frontmatter fence, or with YAML that throws, produces a failed row rather than an exception that loses the other files in the repository"
    - "An 800-byte alias bomb is refused, because the cap is on the serialized output and not only on the input"
    - "A YAML tag that would construct a function is refused by the loader's schema, not by a denylist"
    - "The set of frontmatter keys is recorded, so specification conformance is computable later without re-reading a single file"
    - "Detection reads paths only: a repository with no skills costs zero file reads"
  artifacts:
    - path: "src/detect/frontmatter.ts"
      provides: "Fence splitting, BOM handling, safe YAML load, and both size caps"
      exports: ["splitFrontmatter", "parseFrontmatter", "FRONTMATTER_CAPS"]
      min_lines: 60
    - path: "src/detect/skill.ts"
      provides: "The skill detector: path-only match, tolerant parse, conformance warnings"
      exports: ["skill", "SPEC_KEYS"]
      min_lines: 90
    - path: "src/detect/types.ts"
      provides: "Detector / Candidate / ParseResult — the whole extension point Phase 3 widens"
      exports: ["Detector", "Candidate", "ParseResult", "DetectedArtifact"]
      min_lines: 25
    - path: "src/detect/skill.test.ts"
      provides: "The four frozen corpora plus the adversarial fixtures as permanent regressions"
      min_lines: 90
  key_links:
    - from: "src/detect/skill.ts"
      to: "src/detect/frontmatter.ts"
      via: "the detector never calls a YAML loader directly; both caps live in one place"
      pattern: "parseFrontmatter"
    - from: "src/detect/index.ts"
      to: "src/detect/skill.ts"
      via: "the one-line registry Phase 3 appends to"
      pattern: "DETECTORS"
---

<objective>
Read a `SKILL.md` the way the world actually writes them, not the way the
specification says they are written, and refuse the two things that turn an
untrusted parser into an incident: code construction and unbounded expansion.

Purpose: 100 real skill files were measured for this phase, and the result is
unambiguous — the reference implementation violates its own specification. One
file declares a name that contradicts its directory, one exceeds the documented
description cap, a quarter carry a field that appears in no specification, and a
fifth nest structures inside a field documented as flat. A strict schema
transcribed from the specification discards roughly a quarter of the corpus and
calls it validation. The parser therefore validates and records, and never
validates and rejects. Separately, the obvious YAML defence is the wrong one: an
alias bomb parses in two milliseconds and only explodes on the way into the
database, so the size cap has to be applied to the serialized result as well as
to the input.

Output: `src/detect/` — the detector interface Phase 3 widens, a frontmatter
reader with both caps, the skill detector, and a test suite that runs the four
frozen corpora plus the adversarial fixtures with no network and no token.

Implements the CONTEXT.md binding facts on tolerant parsing, on capping both YAML
input and serialized output, and on artifact-level parse status.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/phases/AGD-01-walking-skeleton/CONTEXT.md
@.planning/phases/AGD-01-walking-skeleton/AGD-01-01-PLAN.md
@scripts/capture-fixtures.mjs
@src/ingest/types.ts
</context>

<decisions_made_while_planning>

**1. The specification is encoded as a conformance report, not as a schema.**

Every rule the specification states is checked, and every violation becomes a
named warning attached to the row. None of them can prevent the row from being
written. Parsing fails on exactly three conditions: there is no frontmatter
fence, the YAML throws, or `name` or `description` is missing or empty. That
threshold is chosen from measurement — all 100 sampled files had a fence and both
fields — so a file missing them is genuinely anomalous rather than merely
non-conforming.

**2. Duplicate keys are allowed to throw, and that is the correct outcome.**

The loader throws on a duplicate key by default, which lands the file in the
failed state. That is right: two different values for the same key means the file
does not have one meaning, and picking either silently is worse than saying so.

**3. `metadata` is stored as an opaque object.**

The specification documents it as a map of strings to strings. A fifth of the
sampled corpus nests maps and arrays inside it. Any validator asserting the
documented shape rejects those files, so the value is recorded as it arrived and
the mismatch becomes a warning.

**4. `allowed-tools` is normalized but not interpreted.**

The specification says space-separated string; the runtime that popularized the
format also accepts commas and a YAML list. All three shapes are normalized to an
array of tokens and stored. Nothing in this phase interprets what a token permits
— capability meaning is Phase 4's problem, and guessing at it now would put a
judgment into a phase that has no way to check it.

**5. `declared_version` comes from a field in no specification, and that is
recorded as an assumption.**

A quarter of the corpus carries a `version` field that neither document defines.
It is the only available source for a declared version, and the requirement
forbids inventing one, so it is read when present and rendered as absent
otherwise. If it later turns out to mean something else, the blast radius is one
nullable column.

**6. Fixture capture happens here for the three remaining repositories, and the
tests still touch no network.**

Capturing is a manual maintainer action against repositories the maintainer
chose; the requirement that detectors run against frozen fixtures with no network
constrains the test run, not how the bytes were obtained. The bodies of the
180-file repository are sampled rather than captured whole: path matching reads
an in-memory array and never opens a file, so its tree alone tests the scale case.

**7. Invisible characters are retained, not stripped.**

A bidi override or a zero-width character in a description survives into the
database byte for byte. Sentinels are a later phase's requirement, and that phase
needs the original bytes to exist. Stripping here would destroy the evidence and
be indistinguishable, downstream, from the character never having been there.

</decisions_made_while_planning>

<reference>

## Reference A — the additional pins for `scripts/capture-fixtures.mjs`

Appended to the `PINS` array. Nothing else in the script changes.

```js
  {
    slug: 'addyosmani-agent-skills',
    owner: 'addyosmani',
    repo: 'agent-skills',
    sha: '7676817c12a1317454ae3898a0c5c1eacf5dd3d5',
    bodies: 'all', // 24 files: the clean, specification-conformant baseline
  },
  {
    slug: 'baoyu-skills',
    owner: 'JimLiu',
    repo: 'baoyu-skills',
    sha: '6b7a2e417500561a5ecdd0b168332f4142584617',
    bodies: 'all', // 22 files: nested metadata, non-ASCII, two skill roots
  },
  {
    slug: 'wshobson-agents',
    owner: 'wshobson',
    repo: 'agents',
    sha: 'c4b82b0ad771190355eb8e204b1329732a18449a',
    // 180 SKILL.md files. match() reads paths from tree.json and never opens a
    // body, so the tree alone tests the scale case; 20 bodies are enough to
    // exercise parse() against the non-specification version field.
    bodies: 20,
  },
```

## Reference B — `src/detect/types.ts`

```ts
export type TreeEntry = { path: string; type: string; sha: string; size?: number };

export type Candidate = {
  type: string;
  /** The manifest file. Becomes part of the package identity key. */
  sourcePath: string;
  /** Containing plugin or catalog directory. Unused in this phase; Phase 3 fills it. */
  parentPath?: string;
  /** Every path parse() will read, declared up front so the fetch set is cappable. */
  needs: string[];
};

export type DetectedArtifact = {
  name: string;
  slug: string;
  summary: string | null;
  licenseText: string | null;
  declaredVersion: string | null;
  body: string;
  frontmatter: Record<string, unknown>;
  meta: Record<string, unknown>;
};

export type ParseResult =
  | { ok: true; status: 'ok' | 'partial'; artifact: DetectedArtifact; warnings: string[] }
  | { ok: false; status: 'failed'; artifact?: Partial<DetectedArtifact>; errors: string[] };

export type Detector = {
  type: string;
  /** PURE. Path-only. No network, no database, no filesystem. Runs over every tree. */
  match(tree: TreeEntry[]): Candidate[];
  /** Reads only the paths declared in candidate.needs. */
  parse(c: Candidate, read: (path: string) => Promise<string>): Promise<ParseResult>;
};
```

## Reference C — `src/detect/frontmatter.ts`

```ts
import yaml from 'js-yaml';

export const FRONTMATTER_CAPS = {
  /** Largest frontmatter block in the 100-file sample is about 1.2 KB. */
  inputBytes: 64 * 1024,
  /**
   * The alias-bomb defence, and the one that is easy to leave out.
   *
   * Aliases are stored as shared references, so an 800-byte document parses in
   * about two milliseconds — an input cap never fires. The expansion happens when
   * something walks the graph, and the very next thing this pipeline does is
   * serialize the result into a jsonb column. Measured: 800 bytes in, 205 MB out.
   */
  serializedBytes: 256 * 1024,
} as const;

// Anchored at position zero and non-greedy, so a horizontal rule in the body
// cannot end the block early. Only the FIRST closing fence counts.
const FENCE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

export function splitFrontmatter(source: string): { frontmatter: string; body: string } | null {
  // A byte order mark before the opening fence stops the anchor matching.
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const m = FENCE.exec(text);
  if (!m) return null;
  return { frontmatter: m[1], body: text.slice(m[0].length) };
}

export type FrontmatterResult =
  | { ok: true; data: Record<string, unknown>; body: string }
  | { ok: false; errors: string[] };

/**
 * Parses the frontmatter block of an untrusted file.
 *
 * The loader runs under the core schema rather than the default one. That is not
 * about code execution — neither schema can construct a function, and the tag
 * that could lives in a separate package that is not installed. It is because the
 * core schema returns plain JSON-serializable values: the default schema turns a
 * timestamp into a Date and a binary tag into a buffer, neither of which
 * round-trips through a jsonb column the way the caller expects. It also excludes
 * the merge key, which removes an alias-amplification vector for nothing.
 */
export function parseFrontmatter(source: string, sourcePath: string): FrontmatterResult {
  const split = splitFrontmatter(source);
  if (!split) return { ok: false, errors: ['no frontmatter fence at the start of the file'] };

  const size = Buffer.byteLength(split.frontmatter, 'utf8');
  if (size > FRONTMATTER_CAPS.inputBytes) {
    return { ok: false, errors: [`frontmatter is ${size} bytes, over the input cap`] };
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(split.frontmatter, {
      schema: yaml.CORE_SCHEMA,
      // Duplicate keys throw. Two values for one key means the file has no single
      // meaning, and silently choosing one is worse than reporting it.
      json: false,
      // Appears in the exception message. A repository path, never a secret.
      filename: sourcePath,
    });
  } catch (error) {
    return { ok: false, errors: [`frontmatter is not valid YAML: ${(error as Error).message}`] };
  }

  if (parsed === null || parsed === undefined) return { ok: true, data: {}, body: split.body };
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, errors: ['frontmatter is not a mapping'] };
  }

  // The input cap above does NOT protect this. Both caps are required.
  let serialized: string;
  try {
    serialized = JSON.stringify(parsed);
  } catch {
    return { ok: false, errors: ['frontmatter could not be serialized'] };
  }
  if (serialized.length > FRONTMATTER_CAPS.serializedBytes) {
    return { ok: false, errors: ['frontmatter expands beyond the serialized size cap'] };
  }

  return { ok: true, data: parsed as Record<string, unknown>, body: split.body };
}
```

## Reference D — `src/detect/skill.ts`

```ts
import type { Candidate, Detector, ParseResult, TreeEntry } from './types';
import { parseFrontmatter } from './frontmatter';

/** The complete specification field set. Anything else means runtime-locked. */
export const SPEC_KEYS = [
  'name',
  'description',
  'license',
  'compatibility',
  'metadata',
  'allowed-tools',
] as const;

const NAME_RULE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_NAME = 64;
const MAX_DESCRIPTION = 1024;
const MAX_COMPATIBILITY = 500;
/** Excerpt, not a mirror. The largest sampled file is 72 KB. */
const MAX_BODY = 32 * 1024;

function directoryOf(sourcePath: string): string {
  const parts = sourcePath.split('/');
  return parts.length > 1 ? parts[parts.length - 2] : '';
}

/** Code points, not bytes: a byte cap is wrong for a CJK description. */
function length(value: string): number {
  return [...value].length;
}

function toolTokens(value: unknown): string[] | null {
  if (typeof value === 'string') return value.split(/[\s,]+/).filter(Boolean);
  if (Array.isArray(value)) return value.map(String);
  return null;
}

export const skill: Detector = {
  type: 'skill',

  // Path-only, so a repository with no skills costs zero file reads. Covers the
  // root file, the conventional layout, and the nested plugin layout in one rule.
  match(tree: TreeEntry[]): Candidate[] {
    return tree
      .filter((e) => e.type === 'blob' && (e.path === 'SKILL.md' || e.path.endsWith('/SKILL.md')))
      .map((e) => ({ type: 'skill', sourcePath: e.path, needs: [e.path] }));
  },

  async parse(c: Candidate, read: (path: string) => Promise<string>): Promise<ParseResult> {
    let source: string;
    try {
      source = await read(c.sourcePath);
    } catch (error) {
      return { ok: false, status: 'failed', errors: [`could not read: ${(error as Error).message}`] };
    }

    const parsed = parseFrontmatter(source, c.sourcePath);
    if (!parsed.ok) return { ok: false, status: 'failed', errors: parsed.errors };

    const fm = parsed.data;
    const name = typeof fm.name === 'string' ? fm.name.trim() : '';
    const description = typeof fm.description === 'string' ? fm.description.trim() : '';

    // The only three ways to fail. All 100 sampled files clear this bar, so a
    // file that does not is anomalous rather than merely non-conforming.
    if (name.length === 0 || description.length === 0) {
      return {
        ok: false,
        status: 'failed',
        errors: ['frontmatter is missing a non-empty name or description'],
        artifact: { name: directoryOf(c.sourcePath) || 'unnamed' },
      };
    }

    // Every rule below is a warning. None of them can drop a row: rejecting on
    // them would have discarded roughly a quarter of the measured corpus,
    // including files from the reference repository.
    const warnings: string[] = [];
    const keys = Object.keys(fm);
    const extraKeys = keys.filter((k) => !SPEC_KEYS.includes(k as (typeof SPEC_KEYS)[number]));

    if (length(name) > MAX_NAME) warnings.push(`name is ${length(name)} characters, over 64`);
    if (!NAME_RULE.test(name)) {
      warnings.push('name is not lowercase alphanumeric with single hyphens');
    }
    const dir = directoryOf(c.sourcePath);
    if (dir && name !== dir) warnings.push(`name "${name}" does not match directory "${dir}"`);
    if (length(description) > MAX_DESCRIPTION) {
      warnings.push(`description is ${length(description)} characters, over 1024`);
    }
    if (typeof fm.compatibility === 'string' && length(fm.compatibility) > MAX_COMPATIBILITY) {
      warnings.push('compatibility is over 500 characters');
    }
    if (fm.metadata !== undefined && typeof fm.metadata !== 'object') {
      warnings.push('metadata is not a mapping');
    }
    if (extraKeys.length > 0) {
      warnings.push(`keys outside the specification: ${extraKeys.join(', ')}`);
    }

    const tools = toolTokens(fm['allowed-tools']);
    if (fm['allowed-tools'] !== undefined && tools === null) {
      warnings.push('allowed-tools is neither a string nor a list');
    }

    return {
      ok: true,
      status: warnings.length > 0 ? 'partial' : 'ok',
      warnings,
      artifact: {
        name,
        slug: dir || name,
        summary: description,
        // The specification's own field, stored as written. The sampled corpus
        // puts free prose here ("Complete terms in LICENSE.txt"), so it is never
        // an SPDX identifier and never feeds the repository licence column.
        licenseText: typeof fm.license === 'string' ? fm.license : null,
        // Defined in neither document; observed in a quarter of the corpus. The
        // only honest source for a declared version, and never synthesized.
        declaredVersion: typeof fm.version === 'string' ? fm.version : null,
        body: source.slice(0, MAX_BODY),
        frontmatter: fm,
        meta: {
          // Computed free here so a later phase can answer "is this uploadable
          // as written" without re-reading a single file.
          frontmatterKeys: keys,
          specPure: extraKeys.length === 0,
          allowedTools: tools,
        },
      },
    };
  },
};
```

## Reference E — `src/detect/index.ts`

```ts
import { skill } from './skill';
import type { Detector } from './types';

/**
 * The entire extension point. Phase 3 adds plugin, catalog, mcp, command and
 * hook by writing one file each and appending one element here.
 */
export const DETECTORS: Detector[] = [skill];
```

## Reference F — the adversarial fixtures

Hand-written into `fixtures/adversarial/`, each a complete `SKILL.md`:

| File | Content | Expected |
|---|---|---|
| `no-fence.md` | body text with no `---` at position 0 | failed |
| `unterminated.md` | opening fence, never closed | failed |
| `body-hr.md` | valid frontmatter, then a horizontal rule in the body | ok — the rule is not read as a closing fence |
| `bad-yaml.md` | `name: [unclosed` | failed |
| `duplicate-keys.md` | `name` twice with different values | failed |
| `not-a-mapping.md` | a YAML list inside the fence | failed |
| `missing-name.md` | description only | failed |
| `empty-description.md` | `description: ""` | failed |
| `alias-bomb.md` | eight levels of nine-way aliases, under 1 KB | failed, naming the serialized cap |
| `js-function.md` | a tag that would construct a function | failed |
| `bom.md` | byte order mark, then a valid fence | ok |
| `crlf.md` | valid frontmatter with Windows line endings | ok |
| `unicode.md` | CJK and emoji in `description` | ok, and the stored text is byte-identical |
| `bidi.md` | a right-to-left override inside `description` | ok, and the override character survives |
| `long-description.md` | 2,000 characters | partial, warning names the cap |
| `nested-metadata.md` | maps and arrays under `metadata` | partial, warning names the mapping rule |
| `name-mismatch.md` | in a directory whose name differs | partial, warning names both |
| `tools-list.md` | `allowed-tools` as a YAML list | ok, normalized to tokens |
| `huge-frontmatter.md` | 100 KB inside the fence | failed, naming the input cap |

</reference>

<tasks>

<task type="auto">
  <name>Task 1: Freeze the remaining three corpora and the adversarial set</name>
  <files>scripts/capture-fixtures.mjs, fixtures/addyosmani-agent-skills/, fixtures/baoyu-skills/, fixtures/wshobson-agents/, fixtures/adversarial/</files>
  <precondition>`api.github.com` is reachable and at least eight of the sixty hourly unauthenticated core requests remain.</precondition>
  <action>
    Append the three pins in Reference A to the `PINS` array in
    `scripts/capture-fixtures.mjs` and run the capture for those three slugs only,
    leaving the already-frozen first corpus untouched. It spends six of the sixty
    hourly requests: two per repository, and the bodies cost nothing.

    Each of the three earns its place for a different reason. One is the clean
    baseline that carries only the two required fields, so a warning appearing
    against it means the conformance checker is wrong. One carries nested
    structures inside the flat-documented field, non-ASCII descriptions, and
    skills under two different roots. The third is the scale case: 1,992 tree
    entries and 180 skill files, which is what proves the path matcher and the
    file cap against something real rather than against a number.

    Only twenty bodies are taken from the third. Path matching reads an in-memory
    array and never opens a file, so its tree alone tests the scale case, and
    committing 180 bodies to prove a function that does not read them is storage
    spent on nothing.

    Then hand-write the nineteen adversarial fixtures in Reference F into
    `fixtures/adversarial/`. These are the cases the real corpus does not contain
    and an attacker would: an unterminated fence, a document that is a list rather
    than a mapping, a tag that would construct a function, and the alias bomb —
    which must stay under a kilobyte, because a bomb large enough to trip the
    input cap tests the wrong control entirely.

    Write the expectations table from Reference F into a short README beside the
    fixtures, so the next person to add one knows what the directory is for.
  </action>
  <verify>
    <automated>bun run fixtures:capture addyosmani-agent-skills baoyu-skills wshobson-agents &amp;&amp; test -f fixtures/wshobson-agents/tree.json &amp;&amp; test -f fixtures/adversarial/alias-bomb.md &amp;&amp; test "$(ls fixtures/adversarial/*.md | wc -l)" -ge 19 &amp;&amp; test "$(grep -o '/SKILL\.md' fixtures/wshobson-agents/tree.json | wc -l)" -ge 150 &amp;&amp; test "$(ls fixtures/addyosmani-agent-skills/files | wc -l)" -ge 24</automated>
  </verify>
  <done>Four frozen corpora exist at their pinned SHAs, each with its blob-permalink assertion passed. The scale corpus carries at least 150 skill paths in its tree. Nineteen adversarial fixtures and their expectations table exist on disk.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Frontmatter — one fence, one loader, two caps</name>
  <files>src/detect/types.ts, src/detect/frontmatter.ts, src/detect/frontmatter.test.ts</files>
  <behavior>
    - A horizontal rule in the body does not end the frontmatter block.
    - A byte order mark before the opening fence does not prevent the match.
    - Windows line endings parse identically to Unix ones.
    - A file with no fence, an unterminated fence, invalid YAML, a duplicate key, or a document that is a list all return the failed result with a named reason, and none of them throw.
    - A 100 KB frontmatter block is refused by the input cap.
    - A sub-kilobyte alias bomb is refused by the serialized cap — proving the input cap alone would not have caught it.
    - A tag that would construct a function is refused by the loader.
    - A timestamp-shaped value comes back as a string, not as a date object.
    - CJK text and a bidi override both survive the round trip byte for byte.
  </behavior>
  <action>
    Write `src/detect/types.ts` and `src/detect/frontmatter.ts` exactly as
    References B and C, then the test file covering every behaviour above against
    `fixtures/adversarial/`.

    Three properties in that module are the point of it and must not be
    simplified into one.

    The fence pattern is anchored at position zero and non-greedy, and takes only
    the first closing fence. Splitting on the delimiter is the obvious
    implementation and it ends the block at the first horizontal rule in the body.

    The loader runs under the core schema. The reason is not code execution —
    neither available schema can construct a function, and the tag that could
    lives in a package that is not installed. It is that the core schema returns
    plain JSON-serializable values, and the default one hands back date and buffer
    objects that do not round-trip through a JSON column the way the caller
    assumes. It also excludes the merge key, removing an alias-amplification
    vector at no cost. Both properties get a test, so a later change of schema
    fails here rather than in production.

    Both caps are enforced separately, and the alias-bomb case is what proves the
    second one is not redundant. Aliases are stored as shared references, so the
    document parses in about two milliseconds and an input cap never fires; the
    expansion happens on serialization, which is the very next thing the pipeline
    does on the way into the database. Measured: eight hundred bytes in, two
    hundred megabytes out. If a refactor ever removes the serialized check, the
    bomb fixture is what notices.

    Do not reach for the popular frontmatter convenience package. It depends on
    the previous major of this loader — the one whose default load was the unsafe
    path — and it supports a pluggable engine that evaluates JavaScript
    frontmatter. Handing attacker-controlled supply-chain content to that is the
    single thing this project's execution rule forbids, and the fence split it
    replaces is five lines.
  </action>
  <verify>
    <automated>bun run typecheck &amp;&amp; bun run test &amp;&amp; bun run check:boundaries</automated>
  </verify>
  <done>All nineteen adversarial fixtures produce their tabulated outcome and none of them throws. The alias bomb is refused by the serialized cap while passing the input cap. A function-constructing tag is refused by the loader. Timestamps stay strings, and CJK and bidi bytes survive unchanged.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: The skill detector against four real corpora</name>
  <files>src/detect/skill.ts, src/detect/skill.test.ts, src/detect/index.ts</files>
  <behavior>
    - Path matching finds all 18 skills in the reference corpus, all 24 in the baseline corpus, all 22 in the nested corpus, and at least 150 in the scale corpus — reading paths only, opening no file.
    - Matching covers a root-level file, the conventional directory layout, and the nested plugin layout, and matches nothing whose filename merely contains the manifest name.
    - Every one of the 18 reference-corpus files parses. None is dropped.
    - The file whose declared name contradicts its directory parses as partial with a warning naming both.
    - The file whose description exceeds the documented cap parses as partial with a warning naming the length.
    - Files carrying the non-specification version field parse, and the declared version is read from it; a file without it yields null rather than an invented value.
    - A file whose frontmatter nests structures inside the flat-documented field parses as partial rather than failing.
    - The recorded key set and the specification-purity flag are present on every parsed artifact.
    - The clean baseline corpus produces zero warnings across all 24 files.
    - The stored body is capped, and the licence prose from frontmatter is stored separately from anything SPDX-shaped.
  </behavior>
  <action>
    Write `src/detect/skill.ts` and `src/detect/index.ts` exactly as References D
    and E, then the test file covering every behaviour above.

    The test loads a corpus by reading its frozen tree and building a map from the
    captured bodies, and passes a reader closed over that map. No mocking library
    is involved, because the interface already takes the reader as a parameter —
    that is dependency injection that was designed in rather than bolted on. For
    the scale corpus, assert on matching only: its bodies are sampled, and
    matching is the property that corpus exists to test.

    The zero-warning assertion on the clean baseline is the one that catches a
    conformance checker that has become too strict. Without it, every warning
    added later looks correct because something always fires.

    The registry file is one array with one element. Resist making it anything
    else: adding the sixth artifact type should be one file and one array element,
    and a base class, a plugin loader, or a configuration format would each make
    that harder rather than easier while there is exactly one implementation to
    generalize from.

    Do not add a strict validation mode, a rejection path, or a switch that turns
    warnings into errors. The measured corpus is the argument: the reference
    repository violates its own specification in two distinct ways, and a registry
    that indexes reality has to index non-conforming reality. Surfacing the
    non-conformance is the product, not a compromise.
  </action>
  <verify>
    <automated>bun run typecheck &amp;&amp; bun run test &amp;&amp; bun run check:boundaries &amp;&amp; bun run ci</automated>
  </verify>
  <done>All four corpora match at their measured counts. All 18 reference-corpus files parse; the two known specification violations arrive as partial with named warnings; the clean corpus produces none. Declared versions are read where present and null otherwise. `bun run ci` passes with no network and no database.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| repository file bytes → the YAML loader | The entire file is attacker-controlled, including its structure, its tags, and its alias graph. |
| parsed object → the database | Whatever the loader returns is serialized into a JSON column, and serialization is where an alias graph becomes real. |
| one artifact's failure → the repository's ingest | A thrown exception in one file's parse can lose the other seventeen. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-01-21 | Elevation of Privilege | the YAML loader | critical | mitigate | The core schema is selected explicitly and a fixture carrying a function-constructing tag asserts refusal; the convenience wrapper that depends on the previous major and supports an evaluating engine is rejected by name in the plan and absent from the manifest. |
| T-01-22 | Denial of Service | alias expansion on serialization | critical | mitigate | A cap on the serialized length in addition to the input length, with a sub-kilobyte bomb fixture proving the input cap alone does not fire. The merge key is excluded by the chosen schema. |
| T-01-23 | Denial of Service | oversized frontmatter | high | mitigate | 64 KB input cap measured against a 1.2 KB real maximum; the body is stored as a 32 KB excerpt rather than mirrored. |
| T-01-24 | Denial of Service | one malformed file failing a repository | high | mitigate | Parsing returns a result object on every path and throws on none; the failure is recorded per artifact, which a fixture asserts. |
| T-01-25 | Tampering | hidden characters silently normalized | medium | accept | Bidi and zero-width characters are retained byte for byte. Stripping them would destroy the evidence a later phase needs and would be indistinguishable downstream from the character never existing. Visible sentinels are that phase's requirement; a fixture here asserts survival. |
| T-01-26 | Tampering | parser differential via a hand-rolled splitter | high | mitigate | A real YAML parser and an anchored, non-greedy fence pattern; fixtures cover block scalars, escaped quotes inside double-quoted values, body horizontal rules, byte order marks and Windows line endings. |
| T-01-27 | Repudiation | silent discard of non-conforming files | medium | mitigate | There is no rejection path for a conformance violation. Every violation is a named warning attached to the stored row, and the clean-corpus zero-warning assertion keeps the checker from drifting strict. |
</threat_model>

<verification>
1. Four frozen corpora exist at their pinned SHAs; the scale corpus tree carries at least 150 skill paths.
2. Nineteen adversarial fixtures produce their tabulated outcomes, and none throws.
3. The alias bomb is refused by the serialized cap while clearing the input cap.
4. A function-constructing tag is refused by the loader; a timestamp value comes back as a string.
5. All 18 reference-corpus files parse; the name-mismatch and over-length-description files arrive as partial with named warnings.
6. The clean baseline corpus produces zero warnings across all 24 files.
7. Matching finds the measured count in every corpus while opening no file.
8. CJK text and a bidi override survive the round trip byte for byte.
9. `bun run ci` passes with no network access and no database.
</verification>

<success_criteria>
- **DET-01** — skills are detected by path and parsed from frontmatter, proven against 64 real files across three corpora plus a 180-file scale corpus.
- **DET-08** — the loader is configured with an explicitly restricted schema, both size caps are enforced, and the two hostile shapes are permanent fixtures.
- **DET-10** — every detector test runs from frozen fixtures with no network and no token; the suite passes under CI with no database.
- **QUA-03** — the parser, the conformance checker and the identity-adjacent slug and name derivation all have unit tests.
- **QUA-05** — malformed frontmatter, an oversized document, an alias bomb and invisible characters are permanent regression fixtures.
- **PRV-05** — the declared version is read only from a field that exists, and is null otherwise; nothing synthesizes one.
- **PRV-06** — frontmatter licence prose is stored in its own field and never written into the SPDX column.
</success_criteria>

<output>
Create `.planning/phases/AGD-01-walking-skeleton/01-03-SUMMARY.md` when done.
Record the measured match count per corpus, the number of files that parsed as
partial and the warnings that produced them, and the alias-bomb serialized length
the cap refused. Record no credential.
</output>
