---
phase: AGD-04-capability-disclosure
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/github/types.ts
  - src/github/tree.ts
  - src/github/tree.test.ts
  - src/detect/types.ts
  - src/analyze/types.ts
  - src/analyze/lines.ts
  - src/analyze/lines.test.ts
  - src/analyze/install.ts
  - src/analyze/install.test.ts
  - src/analyze/files.ts
  - src/analyze/files.test.ts
  - src/analyze/run.ts
  - src/analyze/run.test.ts
  - src/analyze/index.ts
  - src/db/schema.ts
  - drizzle/0005_*.sql
  - src/db/queries/capabilities.ts
  - src/db/queries/packages.ts
  - src/ingest/types.ts
  - src/ingest/pipeline.ts
  - src/ingest/pipeline.test.ts
  - src/ingest/persist.ts
  - src/ingest/persist.test.ts
  - src/app/r/[owner]/[repo]/[...path]/page.tsx
autonomous: true
requirements: [CAP-01, CAP-03, CAP-05, CAP-08, CAP-11, CAP-14, QUA-03]

estimate:
  tokens: 105000
  raw_tokens: 105000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "Every tree entry carries its mode, and both TreeEntry declarations agree, so a 100755 blob reads as executable everywhere"
    - "A finding names a line number that, used to index package_version.body, lands on the line holding the text the finding matched — identically for LF, CRLF and BOM bodies"
    - "A detail page shows one install directive as an observed fact, linked to github.com/.../blob/<commit>/<path>#L<n>"
    - "An analyzer that throws loses only its own findings; the package version, the repository and the other analyzers' findings all still commit"
    - "An analyzer's recorded error string never contains any of the body it was scanning"
    - "Re-ingesting a repository whose content has not changed creates no new capability_finding rows"
    - "A package_version that has never been analyzed renders as 'not analyzed', never as 'not detected'"
    - "A detail page lists the artifact's files with path, size, type and executable bit, and labels bundled scripts as not analyzed"
    - "A file inventory refreshes on a scan where the tree moved but the manifest did not"
    - "No page displays a count, score or grade derived from summing findings"
  artifacts:
    - path: "src/analyze/types.ts"
      provides: "Finding, AnalyzeInput, FileEntry, the seven category identifiers, and ANALYZE_CAPS with every number carrying its measurement"
      exports: ["Finding", "AnalyzeInput", "FileEntry", "Analyzer", "ANALYZE_CAPS", "CAPABILITY_CATEGORIES"]
      min_lines: 80
    - path: "src/analyze/lines.ts"
      provides: "The project's first line-number computation: 1-indexed, split on \\n, CR-tolerant, no frontmatter offset, per-line cap applied before any pattern runs"
      exports: ["scanLines", "lineAt", "LineScan"]
      min_lines: 50
    - path: "src/analyze/run.ts"
      provides: "The guarded analyzer pass, taking the analyzer list as a parameter so a candidate pattern can be measured without touching the shipped set"
      exports: ["analyzeArtifact", "AnalyzePass"]
      min_lines: 50
    - path: "src/analyze/files.ts"
      provides: "The file inventory and bundled-script derivation from the tree slice — path-only, no content read"
      exports: ["fileInventory", "isBundledScript", "SCRIPT_EXTENSIONS"]
      min_lines: 60
    - path: "src/db/queries/capabilities.ts"
      provides: "The findings read for one package version, cache()-wrapped, with the #L permalink helper beside permalink()"
      exports: ["getCapabilityFindings", "CapabilityFindingView"]
      min_lines: 50
  key_links:
    - from: "src/github/tree.ts"
      to: "src/analyze/files.ts"
      via: "mode rides the already-fetched tree response into the inventory, at zero new GitHub cost"
      pattern: "mode"
    - from: "src/ingest/pipeline.ts"
      to: "src/analyze/run.ts"
      via: "analysis runs once per scanned package, pure, before the transaction opens"
      pattern: "analyzeArtifact"
    - from: "src/ingest/persist.ts"
      to: "src/db/schema.ts"
      via: "findings insert gated on inserted.length > 0, the only point at which a package_version.id exists"
      pattern: "capabilityFinding"
    - from: "src/app/r/[owner]/[repo]/[...path]/page.tsx"
      to: "src/db/queries/capabilities.ts"
      via: "the detail page reads findings for the version it is already rendering and links each to its own line"
      pattern: "getCapabilityFindings"
---

<objective>
Prove the whole phase on one signal, end to end, before four more detectors are
written against machinery nobody has run.

Purpose: three of this phase's hardest facts are unprecedented in this codebase
and none of them is visible from a unit test of a pattern. Line numbers have
never been computed here at all. A finding row has never been stored. Analysis
has never run inside the persist transaction, where an unguarded throw does not
lose a finding — it rolls back the package version. Building six detectors first
and discovering any of those three wrong afterwards means rewriting six.

So this plan takes the one detector whose false-positive rate is already measured
(install directives, 5% on twenty hand-checked hits) and carries it the whole
way: the executable bit off a response AgentDock already fetches, a line number
that survives CRLF and a BOM, a row keyed on the immutable version, a guarded
pass that cannot take the repository with it, and a rendered permalink ending in
`#L<n>`. Then it adds the file inventory, which needs the `mode` fix Task 1 makes
and nothing else.

Output: `src/analyze/` with its caps, line module, guarded runner, one detector
and the inventory; `agentdock.capability_finding`; `package.files`;
`package_version.analyzed_at`; and a detail page showing one source-backed
observation.

Honours the CONTEXT.md decisions that the `Detector` interface is not reused,
that the inventory lives on `package` and findings on `package_version`, that
`analyzed_at` forbids "not detected" while it is null, that no reference data
enters the migration, and that this phase adds zero GitHub requests.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/phases/AGD-04-capability-disclosure/CONTEXT.md
@.planning/phases/AGD-04-capability-disclosure/04-PATTERNS.md
@src/github/types.ts
@src/github/tree.ts
@src/detect/types.ts
@src/detect/json.ts
@src/detect/frontmatter.ts
@src/detect/run.ts
@src/detect/hook.ts
@src/db/schema.ts
@src/db/queries/packages.ts
@src/ingest/types.ts
@src/ingest/pipeline.ts
@src/ingest/persist.ts
@src/app/r/[owner]/[repo]/[...path]/page.tsx
</context>

<decisions_made_while_planning>

**1. The `mode` fix ships alone, first, because its failure mode is silent.**

`src/detect/types.ts:1` declares `type: string` where `src/github/types.ts:3`
declares a union. The detect declaration is structurally looser, so a
`github.TreeEntry` is assignable to a `detect.TreeEntry` and TypeScript raises
nothing when only one of the two grows a field. A task that edits one and not the
other ships an inventory in which every file reads as non-executable, and no test
built from hand-written entries can see it. Both declarations change in Task 1,
and the assertion is made against a real captured `tree.json`, not a hand-built
array — the fixture is where the 50 real `100755` entries live.

**2. Analysis is computed in the pipeline and persisted in the transaction, not
computed inside the transaction.**

`04-RESEARCH.md` §Q9 says "inside the existing ingest transaction". Half of that
is right. The *insert* must be inside it, gated on `inserted.length > 0`, because
that is the only point at which a `package_version.id` exists and because a
findings write in a later transaction leaves a window where a version row has no
findings and the page reads "not detected" — a false negative that violates
CAP-11 while it lasts.

But the *computation* must not be in there. It is pure, it takes tens of
milliseconds over a 32 KB body times up to 400 artifacts, and running it inside
`db.transaction` holds a connection open for the duration for no reason.
Findings ride on `ScannedPackage.findings`, computed in the loop that already
holds the body and the tree, exactly the way `contentHash` already is.

**3. `install` is the tracer detector, and it is the only one in this plan.**

It is the one detector whose precision is already measured (78 hits, 20
hand-checked, 5% — `04-RESEARCH.md` §Q5), so if the tracer shows a finding on a
real corpus body, the finding is probably true. A tracer built on the
remote-execution shape would show nothing at all: zero hits in 84 files.

**4. The line module is separate from the detector, with its own test, because
it is the only genuinely unprecedented computation here.**

`04-PATTERNS.md` reports zero hits for `split('\n')`, `lineNumber` or `#L`
anywhere in `src/` or `scripts/`. Folding line counting into `install.ts` would
make the CRLF and BOM cases properties of one detector rather than of the layer,
and the second detector would reimplement them slightly differently. The three
fixtures that settle it — `crlf.md`, `bom.md` and any LF body — already exist.

**5. The line-number test asserts against the body, not against GitHub.**

A `#L` fragment GitHub cannot resolve still returns 200, so "the permalink loads"
proves nothing. The assertion is that `body.split('\n')[n - 1]` contains the text
the finding matched. One live URL is hand-checked once and recorded in the
summary; no test touches the network.

**6. `package_version.analyzed_at` is added in this plan, not in the UI plan.**

The moment the first finding row exists, the page has to distinguish "analyzed,
nothing found" from "never analyzed". Adding the column later means shipping a
tracer that renders the second as the first, which is the exact assurance CAP-11
forbids — in the plan whose job is to prove the pipeline honest.

**7. The inventory is written by the `package` upsert, which already runs on
every scan.** `persist.ts:124-149` upserts `package` with `meta` and
`parentPath`; `files` is one more field in the same two lists. No new statement,
no new round trip.

</decisions_made_while_planning>

<reference>

## Reference A — the two `TreeEntry` declarations

`src/github/types.ts` gains one optional field:

```ts
export type TreeEntry = {
  path: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
  size?: number;
  /**
   * The raw Git mode string, present on every entry of the Trees response and
   * discarded until now. 100644 regular, 100755 executable, 040000 tree,
   * 120000 symlink, 160000 submodule. Measured across the four frozen corpora:
   * 2,623 regular, 50 executable, 2 symlinks, 1,156 trees. Costs no request —
   * it rides the response fetchRepoTree already issues.
   */
  mode?: string;
};
```

`src/detect/types.ts:1` gains the same field. It is a **separate declaration**
whose `type` is a wide `string`, so a github entry is assignable to a detect
entry and TypeScript will not flag a one-sided edit. Both change together.

`tree.ts:43-50`'s mapper follows its own defensive-coercion convention —
`String(...)` for required strings, `typeof x === 'number' ? x : undefined` for
optionals — so `mode` takes the optional string form.

## Reference B — `src/analyze/types.ts`

```ts
/**
 * What one analyzer observed. Never a whole document: summary and evidence are
 * both capped, and every render sink escapes them as a JSX text node.
 */
export type Finding = {
  detectorId: string;
  /** Bumped when the rule changes, so a precision row names a specific version. */
  detectorVersion: string;
  category: (typeof CAPABILITY_CATEGORIES)[number];
  /** Which rule inside the detector fired: 'npx', 'pip install', 'U+202E'. */
  signal: string;
  /** Observation, never judgment. Verbs: declares, references, invokes, contains. */
  summary: string;
  /** The file the observation is in. Not always the artifact's own manifest. */
  sourcePath: string;
  /** 1-indexed against package_version.body. Null for a structured declaration. */
  startLine: number | null;
  endLine: number | null;
  /** Capped at ANALYZE_CAPS.maxEvidenceChars, single line, escaped at render. */
  evidenceText: string | null;
  metadata: Record<string, unknown>;
};

/** One artifact's whole analysable surface. One parameter, so an analyzer
 *  structurally cannot reach a database — the same proof detect/run.test.ts:224
 *  makes for detectors by asserting match() has arity 1. */
export type AnalyzeInput = {
  sourcePath: string;
  body: string;
  frontmatter: Record<string, unknown>;
  meta: Record<string, unknown>;
  /** Blobs under this artifact's directory prefix. Paths and modes, never bytes. */
  files: FileEntry[];
};

export type Analyzer = (input: AnalyzeInput) => Finding[];
```

`CAPABILITY_CATEGORIES` is the seven identifiers from CONTEXT.md decision 6.
`FileEntry` is `{ path; size: number | null; kind: 'file' | 'symlink'; executable: boolean }`.

`ANALYZE_CAPS` follows `JSON_CAPS`'s doctrine exactly — one JSDoc block per
number, each naming its measurement **and what it does not cover**:

| cap | value | the sentence it carries |
|---|---|---|
| `maxBodyChars` | `32 * 1024` | equals the pipeline's `MAX_BODY`; asserted as defence-in-depth against a future uncapped caller, not as the primary control |
| `maxLineChars` | `2000` | longest real line in 19,909 is 1,352; zero exceed the cap. Bounds per-line regex cost. Does **not** bound total findings. |
| `maxFindingsPerDetector` | `50` | largest single-detector-in-one-file count measured is 7. Bounds row volume. Does **not** bound scan time. |
| `maxEvidenceChars` | `200` | median line is 27, p99 is 377 — keeps the common case whole and truncates the outlier visibly |
| `maxInventoryEntries` | `200` | largest real inventory is 83, `anthropics-skills skills/canvas-design/` |

## Reference C — `src/analyze/lines.ts`

The whole specification, from `04-RESEARCH.md` §Q6, none of it inherited from
existing code because none exists:

- `body.split('\n')`, **never** `'\r\n'`. A trailing `\r` is invisible and
  consumes no line, so an LF file and a CRLF file count identically — provided
  the split is on `\n` and the `\r` is stripped from each line before matching,
  so a pattern anchored at end-of-line still fires.
- 1-indexed, and **no frontmatter offset**. The stored `body` is
  `source.slice(0, MAX_BODY)` over the unmodified raw file (`skill.ts:124`),
  fence included, so body line N is file line N on GitHub. Any offset added here
  breaks every permalink in the phase.
- Each line is sliced to `ANALYZE_CAPS.maxLineChars` **before** any pattern runs,
  following `frontmatter.ts:48-51`'s cap-before-parse posture. A truncated line
  increments a returned `skippedLines` count; it is never silently dropped.
- A leading `U+FEFF` is left in place. It is zero-width, consumes no line, and
  belongs to the raw bytes PRV-07 preserves. `fixtures/adversarial/bom.md` is the
  case that proves numbering is unaffected.

`scanLines` yields `{ lineNumber, text }` and hands each line to a callback;
`lineAt(body, n)` is its inverse and exists so the test can assert the
round trip rather than trusting the scanner to check itself.

## Reference D — `src/analyze/install.ts`

The pattern, verbatim from the measured pilot (`04-RESEARCH.md` §Q5, 78 hits, 20
hand-checked, 1 false positive):

```
\b(npm install|npm i\b|npx|pip install|pip3 install|uvx|brew install|uv add|uv pip install|bunx)\b
```

A fixed alternation with no nested quantifier and nothing to backtrack over —
the same shape as `frontmatter.ts:19`'s `FENCE` and
`check-boundaries.mjs:209`'s `HOST_PATTERN`, both already reviewed and shipped.
It runs per line, against a line already sliced to the cap.

The one measured false positive is hit #5 of the pilot — *"`-y` skips the npx
install confirmation"*, prose about the tool's own behaviour. **It is not patched
around.** Adding a lookahead for English function words to remove one hit in 78
buys a 1.3-point improvement on an already-passing rate and costs a pattern
nobody can reason about; CAP-14 favours fewer, simpler patterns and the recorded
5% is the honest number. The pilot's own recommendation says the same.

No fence awareness. A `pip install` inside a fenced block is still an install
directive the reader is meant to run — pilot hits #16–20 are exactly that shape,
CI-workflow YAML, and all five are true positives. Fence awareness in this phase
belongs to the HTML-comment class alone, for the reason CONTEXT.md Measurement 4
gives.

Summary text is observation, not judgment: `references an install directive:
npx`. Evidence is the matched line, trimmed and capped.

## Reference E — `src/analyze/run.ts`

Copies both properties of `src/detect/run.ts:11-31` for the reasons that file
already records, and one more that is new to this phase.

```ts
export type AnalyzePass = {
  findings: Finding[];
  /** analyzer id -> message. Never the body, never a matched line. */
  errors: Record<string, string>;
  durationMs: number;
};

/**
 * Takes the analyzer list as a parameter rather than importing a registry,
 * which is what lets the CAP-13 measurement run a candidate pattern over the
 * corpora without touching the shipped set — the same property detect/run.ts
 * has, for the same reason.
 *
 * An analyzer that throws is recorded and loses only its own findings. This
 * matters more here than in Phase 3: the findings it produces are inserted
 * inside persistScan's transaction, so an unguarded throw would roll back the
 * package_version insert, the package upsert and the job's terminal state.
 */
export function analyzeArtifact(analyzers: Analyzer[], input: AnalyzeInput): AnalyzePass;
```

The error string is `${(error as Error).message}` and nothing else. The input's
`body` never reaches it, and the test asserts that a thrown error whose message
embeds body text is not what gets recorded — the recorded value is keyed and
truncated, and a distinctive marker planted in the body must not appear in it.

`maxFindingsPerDetector` is applied per analyzer, and the overflow is reported
as a count on the pass rather than dropped, so the panel can say "and N more".

`src/analyze/index.ts` is the registry, and it is the same eight-line shape as
`src/detect/index.ts` — one import and one array element per analyzer, with a
comment saying the whole extension point is this file. It holds one element in
this plan and grows to its final set in 04-02 and 04-03. It exists now rather
than later so the pipeline imports a registry from the start and no plan has to
change the pipeline's call shape twice.

## Reference F — `src/analyze/files.ts`

The strongest exact-match analog in the phase: `hook.ts:44-48`'s filter+map over
`TreeEntry[]`, and `plugin.ts:75`'s stated idiom — *"One linear pass over blob
paths, no regex."* This is literally the same operation over the same array with
a different predicate.

The artifact's prefix is its manifest's directory. `nesting.ts`'s containment
logic is the precedent for prefix comparison; the inventory is
`tree.filter(e => e.type === 'blob' && e.path.startsWith(prefix))`, sliced to
`maxInventoryEntries`, mapped to `FileEntry`.

`executable` is `entry.mode === '100755'` and nothing looser. `120000` is a
symlink, not an executable file, and is recorded as `kind: 'symlink'` — the two
symlinks in the corpora are the negative case that proves the rule does not
collapse them.

`isBundledScript` is a tiny named predicate over the extension only, following
`hook.ts:19-27`'s predicate-as-named-function idiom, with a comment naming the
248 script files `04-RESEARCH.md` §Q12 measured across the four corpora. **No
script content is ever read.** The label is the fixed string `not analyzed`,
never `safe` and never `clean`, even for a zero-byte file.

## Reference G — the schema, the migration, and the one thing not to do

`capability_finding` follows `repoSeed` (`schema.ts:188-207`) exactly:
`agentdock.table(...)` never `pgTable`, `bigserial({mode:'number'})` PK, `text`
with a comment instead of an enum, `jsonb().$type<T>().notNull().default(sql\`'{}'::jsonb\`)`,
`withTimezone: true`, constraints as an array from the second argument, and a
cascade FK to `package_version` the way `packageVersion.packageId` cascades from
`package`.

Columns: `packageVersionId`, `detectorId`, `detectorVersion`, `category`,
`signal`, `summary`, `sourcePath`, `startLine`, `endLine`, `commitSha`,
`evidenceText`, `metadata`, `createdAt`.

`commitSha` is denormalized from the row's own `package_version` and buys no
query. It is kept because the maintainer's field set names it and because a
finding row is read outside its join during a CAP-13 audit. The cost of a
denormalized column is drift, so a persistence test asserts every finding's
`commitSha` equals its version's.

Unique constraint on
`(packageVersionId, detectorId, category, sourcePath, startLine, summary)`.
Following `persist.ts:136-138`'s stated convention, any `onConflict` target must
name the same columns in the same order as the constraint.

Two additive columns alongside:

```ts
// package_version — the "we looked" marker. Null and empty are different facts
// and CAP-11 is the requirement that they must not read the same: every row
// created in Phases 1-3 has no findings because nothing analyzed it, and
// rendering that as "not detected" is the assurance this product does not give.
analyzedAt: timestamp('analyzed_at', { withTimezone: true }),

// package — the file inventory, refreshed by the upsert that already runs on
// every scan. Deliberately NOT on package_version: a version is minted by
// contentHash over the manifest's own bytes, so adding a script beside an
// unchanged SKILL.md mints nothing and a version-scoped inventory would be
// permanently stale about exactly what CAP-03 discloses. Capped at
// ANALYZE_CAPS.maxInventoryEntries; largest real inventory measured is 83.
files: jsonb('files').$type<FileEntry[]>().notNull().default(sql`'[]'::jsonb`),
```

**`scripts/migrate.mjs` must not change in this plan.** `03-PATTERNS.md`'s Trap 1
fires only on a hand-added `INSERT`, and this migration is pure DDL with no
reference data and no new `artifact_type` row. If the executor finds itself
editing that file, a dimension table has crept in — remove it, per CONTEXT.md
binding decision 5.

Generate with `bun run db:generate`, read every emitted line, delete any
`CREATE SCHEMA` drizzle-kit emits, then `bun run db:migrate`, then
`bun run db:test:setup`. Never `drizzle-kit push`/`pull`/`migrate`.

## Reference H — the persist gate

`persist.ts:154-172` is the exact insertion point, and `inserted[0].id` is
available **only** there — a conflicted insert returns no row, so this is the
sole moment a new `package_version.id` exists.

```ts
      newVersions += inserted.length;

      // Analysis findings exist for exactly one reason: a new version row was
      // created. On the conflict branch there is no id to key them on, and the
      // findings for that content are already stored from when it was new —
      // which is how Phase 2's (package_id, content_hash) unique constraint
      // makes CAP-13's idempotency free rather than a code path that can race.
      if (inserted.length > 0) {
        await tx.update(packageVersion)
          .set({ analyzedAt: sql`now()` })
          .where(eq(packageVersion.id, inserted[0].id));
        if (found.findings.length > 0) {
          await tx.insert(capabilityFinding).values(/* one row per finding */);
        }
      }
```

Setting `analyzedAt` and inserting the rows in the same transaction is what makes
"analyzed with nothing found" a storable state rather than an inference.

## Reference I — the query module and the `#L` helper

`src/db/queries/capabilities.ts` copies `packages.ts`'s conventions: `@/` alias,
an exported `type CapabilityFindingView` beside its query, `cache(async ...)` so
the page and `generateMetadata` make one query, explicit `.select({...})`
projection, and a `.limit()` justified from a constant rather than invented —
here `ANALYZE_CAPS.maxFindingsPerDetector` times the analyzer count, which is
bounded by construction the way `packages.ts:123-129` already reasons.

The `#L` suffix lives beside `permalink()` in `packages.ts`, following the
`detailHref`/`sourcePathFromUrl` precedent at `packages.ts:92` — *"The inverse.
Kept beside its counterpart so the two cannot drift apart."*

```ts
/** permalink() plus GitHub's line fragment. Omits the fragment when the finding
 *  is a structured declaration with no line, rather than emitting #Lnull. */
export function permalinkAtLine(
  fullName: string, commitSha: string, sourcePath: string, line: number | null,
): string;
```

## Reference J — the tracer's page section

The minimum that proves the path, in the register `page.tsx:115-131` already
uses. Two facts and nothing more: the observation, and the line it is on.

- A heading, a short muted sentence, and a `<ul className="notes muted">`.
- Each item is a JSX text node — React escapes it, and nothing is parsed as
  markup. `JobPanel.tsx:83` is the precedent: `attempt.errorDetail` is
  untrusted-adjacent text rendered as a bare child, with no sanitizer, because
  there is nothing to sanitize.
- Each item's link is `permalinkAtLine(...)` and its text is the path and line.
- When `detail.analyzedAt` is null the section reads `not analyzed`; when it is
  set and there are no findings it reads `not detected`. Both strings, one
  branch. `page.tsx:78-86`'s `?? 'not declared'` is the existing precedent for
  the shape.
- **No count of total findings anywhere.** Per-category counts arrive in 04-04;
  a total is a score with one term.

`getPackageDetail` gains `analyzedAt` and `files` to its projection.

</reference>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: The executable bit, off a response already in hand</name>
  <files>src/github/types.ts, src/github/tree.ts, src/github/tree.test.ts, src/detect/types.ts</files>
  <behavior>
    - fetchRepoTree maps mode onto every entry, and an entry whose mode field is absent or non-string yields undefined rather than a coerced string.
    - Parsing the captured anthropics-skills tree.json yields exactly 26 entries with mode 100755, and the captured addyosmani tree yields exactly 1 entry with mode 120000.
    - A tree entry typed as the detect TreeEntry carries mode, so a value produced by the github layer keeps the field when it crosses into detection.
    - Every other field the mapper already produced is unchanged, and the existing scan suite still passes.
  </behavior>
  <action>
    Apply Reference A. Edit both TreeEntry declarations in the same commit-sized
    unit of work — src/github/types.ts and src/detect/types.ts. The detect one
    declares type as a wide string, so a one-sided edit compiles cleanly and
    silently drops the field; there is no compiler error to catch it and the only
    thing that will is this task doing both.

    Add src/github/tree.test.ts if it does not exist. Assert against the real
    captured fixtures, not hand-built entries — the 50 executable blobs and 2
    symlinks live in fixtures/*/tree.json and a hand-built array proves the
    mapper compiles rather than that it reads real GitHub output. Read the
    fixture, run it through the same mapping shape the fetcher uses, and count.

    Do not derive an executable boolean here. The github layer reports what the
    API said; deriving meaning from a mode string is the analyze layer's job and
    putting it here would spread the 100755 literal across two directories.

    Do not touch anything else. This task's diff should read as one optional
    field appearing in three files.
  </action>
  <verify>
    <automated>bun run test src/github &amp;&amp; bun run typecheck</automated>
  </verify>
  <done>Both TreeEntry declarations carry mode, the mapper reads it defensively, and the counts asserted against the frozen trees are the real ones: 26 executable entries in anthropics-skills and 1 symlink in addyosmani-agent-skills. No GitHub request was added.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Tracer — one install directive from the tree to a rendered #L permalink</name>
  <files>src/analyze/types.ts, src/analyze/lines.ts, src/analyze/lines.test.ts, src/analyze/install.ts, src/analyze/install.test.ts, src/analyze/run.ts, src/analyze/run.test.ts, src/db/schema.ts, drizzle/0005_*.sql, src/db/queries/capabilities.ts, src/db/queries/packages.ts, src/ingest/types.ts, src/ingest/pipeline.ts, src/ingest/pipeline.test.ts, src/ingest/persist.ts, src/ingest/persist.test.ts, src/app/r/[owner]/[repo]/[...path]/page.tsx</files>
  <behavior>
    - scanLines over a body with LF endings, the same body with CRLF endings, and the same body with a leading BOM all report the identical 1-indexed line number for the same content.
    - lineAt(body, n) returns the line a finding at n names, and the text the finding matched is a substring of it.
    - A line longer than maxLineChars is scanned only up to the cap, and the pass reports a non-zero skipped count rather than dropping it silently.
    - A body over maxBodyChars is rejected by the analyzer's own guard, naming the actual size.
    - The install analyzer finds npx, npm install, pip install, uvx, brew install and bunx shapes, and reports the line each is on.
    - The install analyzer over all four frozen corpora produces the measured 78 hits, so a pattern change is a visible diff against a recorded number.
    - The install analyzer produces at most maxFindingsPerDetector findings for one artifact, and reports the overflow as a count.
    - An analyzer that throws yields no findings of its own, one recorded error keyed by its id, and every other analyzer's findings unchanged.
    - A thrown analyzer error whose message embeds a distinctive marker planted in the body does not put that marker into the recorded error string.
    - Persisting a scan whose package carries findings writes one capability_finding row per finding and sets package_version.analyzed_at, both inside the artifacts' own transaction.
    - Every stored finding's commit_sha equals its package_version's commit_sha.
    - Persisting the same scan twice creates no second version row and no second set of findings.
    - A scan whose package carries zero findings still sets analyzed_at, so "analyzed, nothing found" is a stored state.
    - bun run check:boundaries passes on the generated migration.
  </behavior>
  <action>
    Apply References B, C, D, E, G, H, I and J, in that order. Write the lines
    test before the lines module: crlf.md and bom.md already exist in
    fixtures/adversarial/ and are the two cases that make this module either
    right or quietly wrong everywhere.

    Split on the newline character alone and strip a trailing carriage return
    from each line before matching. Splitting on the two-character sequence would
    give an LF file and a CRLF file different counts, and a pattern anchored at
    end-of-line would never fire on the CRLF one. Add no frontmatter offset: the
    stored body is the whole raw file including the fence, so body line N is file
    line N and any offset here breaks every permalink this phase emits.

    Cap each line before running a pattern over it, not after, following the
    posture frontmatter.ts already sets when it checks bytes before handing
    anything to a parser. Count the skips onto the pass. A silent truncation is
    the one outcome json.ts's own error strings exist to prevent.

    Give every ANALYZE_CAPS number the two sentences the doctrine requires: the
    measurement it came from, and what it does not protect against. The numbers
    and their measurements are in Reference B's table; they are not invented and
    the comment must say where each came from.

    Take the analyzer list as a parameter in run.ts. That is what makes the
    CAP-13 measurement in 04-02 able to run a candidate pattern over the corpora
    without editing the shipped set, and it is the same property detect/run.ts
    already has for the same reason.

    Compute findings in the pipeline loop that already holds the body and the
    tree, alongside contentHash, and carry them on ScannedPackage. Insert them in
    persistScan gated on inserted.length > 0. Do not compute inside the
    transaction: it is pure work that would hold a connection open across up to
    400 artifacts for nothing. Do not insert outside it: a later transaction
    leaves a window in which a version row exists with no findings and the page
    reads not-detected, which is a false negative while it lasts.

    Generate the migration, read every emitted line, delete any CREATE SCHEMA
    statement, then migrate, then run db:test:setup so agentdock_test has the new
    table before the persistence tests run. Do not edit scripts/migrate.mjs —
    this migration carries no reference data, and needing to edit it means a
    dimension table crept in.

    Render the tracer section per Reference J and nothing more. No per-category
    counts, no totals, no icons. The section exists to prove that a stored line
    number becomes a resolvable GitHub URL, and one observation proves that.

    Verify against a fresh ingest, not a re-ingest. Phase 2's idempotency means
    re-ingesting a repository already in the database creates no new version row
    and therefore no findings — run bun run db:reset first, then ingest one
    repository, then open the detail page. Record in the summary which repository
    and which line, and hand-check that one permalink in a browser once. Record
    that it resolved to the line the finding named.
  </action>
  <verify>
    <automated>bun run check:boundaries &amp;&amp; bun run test src/analyze src/ingest src/db &amp;&amp; bun run typecheck</automated>
  </verify>
  <done>A line number computed from package_version.body indexes back to the line holding the matched text, identically for LF, CRLF and BOM bodies. One install directive found in a real corpus body is stored against the immutable version, rendered on the detail page as an observation, and links to a permalink ending in the line fragment that a hand-check confirmed resolves. An analyzer that throws costs only its own findings and leaks none of the body into its error. Re-persisting unchanged content adds no rows.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: The file inventory, and bundled scripts labelled not analyzed</name>
  <files>src/analyze/files.ts, src/analyze/files.test.ts, src/analyze/types.ts, src/db/schema.ts, drizzle/0005_*.sql, src/ingest/types.ts, src/ingest/pipeline.ts, src/ingest/persist.ts, src/ingest/persist.test.ts, src/db/queries/packages.ts, src/app/r/[owner]/[repo]/[...path]/page.tsx</files>
  <behavior>
    - The inventory for an artifact is every blob under its manifest's directory prefix, and nothing outside it.
    - Across the four frozen trees the inventory sizes are the measured ones: 244 artifacts, median 2 entries, largest 83 at anthropics-skills skills/canvas-design.
    - An entry whose mode is 100755 reads as executable; an entry whose mode is 120000 reads as a symlink and NOT as executable.
    - An inventory longer than maxInventoryEntries is truncated to the cap and the truncation is recorded, not silent.
    - A .py, .sh, .js, .ts, .rb, .ps1 or .mjs entry is identified as a bundled script; a .md or .json entry is not.
    - No test and no source path in files.ts reads a bundled script's content.
    - The inventory is written by the package upsert, so a second scan at a moved commit whose manifest bytes are unchanged refreshes the file list.
    - The detail page renders a table of path, size, type and executable bit, and labels each bundled script as not analyzed.
    - An artifact whose directory holds only its own manifest renders one row, not an empty state.
  </behavior>
  <action>
    Apply Reference F, and the package.files half of Reference G.

    Filter and map in one linear pass over blob paths, with no regex, the way
    plugin.ts's own comment states and hook.ts's match() demonstrates. This is
    the same operation over the same array with a different predicate; do not
    invent a new traversal for it.

    Derive executable from the exact string 100755. A symlink's mode is 120000,
    so an inequality or a prefix test would fold the two symlinks in the corpora
    into the executable count. Assert both directions.

    Write the inventory through the package upsert's existing values and set
    lists, not through a new statement. That upsert already runs on every scan,
    which is precisely why the inventory lives there: a version is minted by the
    manifest's own bytes, so a script appearing beside an unchanged SKILL.md
    mints no version and a version-scoped inventory would be stale about exactly
    the thing CAP-03 exists to disclose. Put that sentence in the column comment.

    Label a bundled script with the fixed string "not analyzed" and no other
    word, for a zero-byte file as much as for a 40 KB one. The absence of
    analysis is the fact; anything warmer is the verdict CAP-10 forbids.

    Do not read, fetch, hash or inspect any bundled file's bytes anywhere in this
    task. The inventory is derived entirely from the tree AgentDock already
    fetched, which is why it costs no GitHub request.

    Render the table in the same visual register as the existing dl.facts block.
    No icons, no colour, no badge. Path, size, type, executable, and the
    not-analyzed label for scripts.
  </action>
  <verify>
    <automated>bun run test src/analyze src/ingest &amp;&amp; bun run typecheck &amp;&amp; bun run check:boundaries</automated>
  </verify>
  <done>A detail page lists the artifact's files with path, size, type and executable bit, sourced from a tree AgentDock had already fetched, with the two corpus symlinks correctly excluded from the executable count and every bundled script labelled not analyzed. The inventory refreshes on a scan where the tree moved and the manifest did not.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| `package_version.body` → the analyzers | Up to 32 KB of bytes chosen by whoever wrote the repository, scanned line by line |
| an analyzer's code → `persistScan`'s transaction | An exception here does not lose a finding; it rolls back the package version, the package upsert and the job's terminal state |
| a finding's `evidence_text` → the rendered page | Attacker-chosen text on its way to a browser |
| a finding's `line_number` → a `github.com` URL | A number AgentDock computed becomes a link a user clicks |
| an analyzer's error message → the ingest log line | The one place scanned bytes could leak into an operational record |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-04-01 | Denial of Service | `src/analyze/*` line scanning | high | mitigate | `maxLineChars` applied before any pattern runs, fixed-alternation non-backtracking patterns, `maxFindingsPerDetector`, and a `maxBodyChars` guard as defence in depth. Locked by a test in 04-02, not asserted in prose. |
| T-04-02 | Denial of Service | an analyzer throwing inside `persistScan` | high | mitigate | `analyzeArtifact` guards every call and computation happens before the transaction opens, so a throw costs one analyzer's findings rather than the version, the repository and the job's terminal state. |
| T-04-03 | Information Disclosure | an analyzer's error string in the ingest log | high | mitigate | Only the analyzer id and the exception message are recorded. A test plants a distinctive marker in the body and asserts it does not appear in the recorded error. Aggregate counts only, per CONTEXT.md decision 12. |
| T-04-04 | Tampering / XSS | `evidence_text` and `summary` on the detail page | high | mitigate | Rendered as JSX text nodes, which React escapes; no Markdown parsing and no raw-HTML plugin anywhere in the new path. `check-boundaries.mjs`'s existing `no-raw-html` rule fails CI if that changes. |
| T-04-05 | Spoofing | a wrong `#L` line number pointing a user at innocuous code | medium | mitigate | GitHub returns 200 for an unresolvable fragment, so the test asserts against the body instead: the named line, read back out of `package_version.body`, must contain the matched text — in LF, CRLF and BOM variants. |
| T-04-06 | Elevation of Privilege | the `0005` migration | high | mitigate | Generated, then hand-reviewed line by line; additive only, `agentdock`-qualified, no `DROP`, no reference data, `scripts/migrate.mjs` untouched. `check:boundaries` runs in the task's own verify command. |
| T-04-07 | Repudiation | findings stored against a commit they were not read at | medium | mitigate | `commit_sha` is denormalized onto the finding for the audit trail, and a persistence test asserts it equals its `package_version`'s. |
| T-04-08 | Information Disclosure | a bundled script's contents | low | accept | Never read. The inventory is derived entirely from the tree AgentDock already fetched; the permanent posture is that a bundled script is named and never opened, and the UI says exactly that. |
| T-04-09 | Tampering | a hostile `mode` value in a Trees response | low | mitigate | Coerced defensively (`typeof e.mode === 'string' ? e.mode : undefined`) and compared against the exact literal `100755`, so an unexpected value yields non-executable rather than a thrown parse. |
</threat_model>

<verification>
1. Both `TreeEntry` declarations carry `mode`, and the counts asserted against the frozen trees are the real ones.
2. A line number computed on `body` indexes back to the line holding the matched text — identically for LF, CRLF and a leading BOM.
3. A line over `maxLineChars` is scanned to the cap and the skip is counted.
4. The install analyzer reproduces the measured 78 hits across the four corpora.
5. An analyzer that throws loses only its own findings, and its recorded error carries none of the body.
6. Findings are written inside the artifacts' transaction, only when a new `package_version` row was created.
7. Re-persisting unchanged content creates no second version row and no second set of findings.
8. `analyzed_at` is set even when nothing was found, so "analyzed, nothing found" is a stored state.
9. Every finding's `commit_sha` equals its version's.
10. The detail page renders one observation with a resolvable `#L` permalink, and renders `not analyzed` rather than `not detected` when `analyzed_at` is null.
11. The file inventory shows the executable bit, excludes the two corpus symlinks from it, and labels bundled scripts `not analyzed`.
12. `scripts/migrate.mjs` is unmodified.
13. `bun run ci` passes.
</verification>

<success_criteria>
- **CAP-01** — a detail page lists path, size, type and executable bit, from a tree already fetched, at zero new GitHub cost.
- **CAP-03** — bundled scripts are inventoried from the tree and labelled `not analyzed`; no script's bytes are read anywhere.
- **CAP-05** (install half) — install directives are surfaced as observed facts with the measured 5% false-positive rate behind them.
- **CAP-08** — every finding carries a path, a line and a permalink at the pinned commit, proven against the body rather than against GitHub's tolerance for a bad fragment.
- **CAP-11** — absence renders as `not detected`, and never-looked renders as `not analyzed`; the column that makes the two distinguishable ships with the first finding.
- **CAP-14** — `ANALYZE_CAPS` exists with every number carrying its measurement and its stated non-coverage; the test that locks it lands in 04-02.
- **QUA-03** — every analyzer has direct unit tests that run with no database, no network and no token.
- ROADMAP criteria 1 and 4 — the file inventory with the executable bit, and a source line for every finding.
</success_criteria>

<output>
Create `.planning/phases/AGD-04-capability-disclosure/04-01-SUMMARY.md` when done.
Record: the executable and symlink counts the `mode` test asserted per corpus; the
install-hit count observed across the four corpora and whether it matched 78; the exact
`0005` migration filename drizzle-kit generated; which repository was freshly ingested for
the tracer, which finding was rendered, and the result of the one hand-checked
`#L` permalink; and the largest file inventory the run produced. Record no credential and
no connection string, and no line of any scanned body.

**Do not `git add`, do not `git commit`, do not `git push`.** End with a recommended commit
message and leave the working tree for the maintainer.
</output>
