---
phase: AGD-03-detector-pluralism
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/detect/types.ts
  - src/detect/run.ts
  - src/detect/run.test.ts
  - src/detect/json.ts
  - src/detect/json.test.ts
  - src/detect/catalog.ts
  - src/detect/catalog.test.ts
  - src/detect/index.ts
  - src/detect/skill.test.ts
  - src/ingest/pipeline.ts
  - src/ingest/pipeline.test.ts
  - src/ingest/types.ts
  - src/ingest/persist.ts
  - src/ingest/persist.test.ts
  - src/db/schema.ts
  - drizzle/0003_*.sql
  - scripts/migrate.mjs
  - fixtures/adversarial/marketplace-malformed.json
  - fixtures/adversarial/README.md
autonomous: true
requirements: [DET-07, DET-03, DET-09, DET-08, QUA-03, QUA-05]

estimate:
  tokens: 95000
  raw_tokens: 95000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "A detector whose match() throws loses only its own candidates; every other detector's artifacts are still stored"
    - "A detector whose parse() throws loses only that one candidate; the repository still ingests"
    - "match() runs once per detector per repository, not twice, and the one run is guarded"
    - "A marketplace.json produces repository seed rows and zero package rows"
    - "A marketplace.json entry that names npm, an archive, or a non-GitHub URL produces no seed, because there is no repository to seed"
    - "A marketplace.json entry naming a path inside its own repository produces no seed, because the plugin detector already found it"
    - "A malformed marketplace.json produces exactly one failed package row and zero seeds, and the repository still ingests"
    - "A seed naming a denylisted repository is never written"
    - "A repository whose only artifact is a catalog is not reported as containing no artifacts"
    - "Registering a seventh detector requires one new file and one array element"
  artifacts:
    - path: "src/detect/run.ts"
      provides: "One guarded match pass over the registry, the round-robin needs order, and the guarded parse wrapper — all pure, all taking the detector list as a parameter"
      exports: ["collectCandidates", "orderedNeeds", "safeParse", "DetectorPass"]
      min_lines: 70
    - path: "src/detect/json.ts"
      provides: "The shared untrusted-JSON manifest parser with an input byte cap, an array-length cap and a depth cap"
      exports: ["parseJsonManifest", "JSON_CAPS", "JsonResult"]
      min_lines: 60
    - path: "src/detect/catalog.ts"
      provides: "marketplace.json detection, the six source shapes, and the seedable/not-seedable rule"
      exports: ["catalog", "CATALOG_CAPS"]
      min_lines: 90
    - path: "src/db/schema.ts"
      provides: "The repo_seed table, additive, with no status column and no fan-out"
      exports: ["repoSeed"]
      min_lines: 280
  key_links:
    - from: "src/ingest/pipeline.ts"
      to: "src/detect/run.ts"
      via: "the needs callback and the candidate loop consume one guarded match pass instead of calling match() twice unguarded"
      pattern: "collectCandidates(DETECTORS"
    - from: "src/ingest/pipeline.ts"
      to: "src/ingest/persist.ts"
      via: "seeds ride on RepoScan into the transaction that already writes the artifacts"
      pattern: "scan.seeds"
    - from: "src/ingest/persist.ts"
      to: "src/db/schema.ts"
      via: "seed upsert keyed on full_name, filtered against the denylist, inside the existing transaction"
      pattern: "repoSeed"
    - from: "scripts/migrate.mjs"
      to: "drizzle/0003_*.sql"
      via: "the artifact_type seed list is re-asserted after every migrate, because the test schema never sees a hand-added INSERT"
      pattern: "artifact_type"
---

<objective>
Make isolation a property of the pipeline instead of a property of the one detector
that happens to catch internally, and prove the phase's new machinery end to end
with the one detector that exercises all of it.

Purpose: five new detectors land in the two plans after this one, several of them
doing JSON parsing and directory grouping — which is exactly the code that throws.
Today a throw from `match()` or `parse()` reaches the pipeline's single outer catch
and fails the whole repository. Shipping the detectors first and the guard last
would mean every bug found in 03-02 and 03-03 presents as "this repository has no
artifacts". So the guard ships first, alone, with a test that fails against the
current code.

The catalog is the tracer. It is the only detector in the phase that touches every
new mechanism: the widened `ParseResult`, the pipeline's one new branch, a new
table, and a write inside the existing transaction. Proving it end to end here
means 03-02 and 03-03 add detectors to machinery that is already known to work.

Output: `src/detect/run.ts` (guarded, pure, detector-list-as-parameter),
`src/detect/json.ts` (the shared cap doctrine for untrusted JSON), the widened
`ParseResult`, `agentdock.repo_seed`, and a working catalog detector.

Honours the CONTEXT.md decisions that the `Detector` type does not change, that the
pipeline changes exactly once, that seeds persist inside the existing transaction,
that `repo_seed` holds only GitHub-reachable entries and carries no status column,
and that a malformed catalog is recorded as a failed package row.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/phases/AGD-03-detector-pluralism/CONTEXT.md
@src/detect/types.ts
@src/detect/index.ts
@src/detect/skill.ts
@src/detect/frontmatter.ts
@src/detect/skill.test.ts
@src/ingest/pipeline.ts
@src/ingest/persist.ts
@src/ingest/types.ts
@src/db/schema.ts
@src/github/scan.ts
@scripts/migrate.mjs
</context>

<decisions_made_while_planning>

**1. Isolation ships alone, first, with a test that fails against current code.**

Same reasoning as AGD-02-02's truncation guard. It is a small diff and the most
consequential one in the phase, and folding it into the type widening would bury
it in a diff about discriminated unions. The summary must record that the
regression reproduced before the change.

**2. `match()` is called once per repository, not twice.**

`pipeline.ts` calls `match()` at line 137 (inside the `selectPaths` callback, to
collect `needs`) and again at line 192 (to iterate candidates). Both take the same
bounded tree, so the second call recomputes the first. Guarding two call sites is
strictly worse than having one: the guards can diverge, and a detector that throws
non-deterministically could be counted in one pass and not the other. The callback
captures the pass and the loop reuses it.

The no-change short circuit in `scan.ts:67` returns before `selectPaths` runs, so
the captured pass stays empty on that path — which is correct, since the unchanged
path reads no files and iterates no candidates.

**3. The pure helpers live in `src/detect/run.ts`, not inline in the pipeline and
not in `index.ts`.**

Two mechanical reasons. `src/ingest/pipeline.test.ts` is `describe.skipIf(!DB_URL)`
for its entire length, so an isolation test written there does not run without a
database — and DET-07 is exactly the property that must be provable without one.
And taking `detectors` as a parameter is what makes DET-09 runtime-testable in
03-03, instead of a review checklist item. `index.ts` stays the eight-line registry
so its own comment — *"the entire extension point"* — stays literally true.

**4. `status` is the discriminant, so `skill.ts` and its thirty assertions are
untouched.**

Every existing arm already carries `status`. Adding `'seeds'` and `'none'` as
status values makes the pipeline's routing a single switch on a field it already
reads, with zero churn in the one detector that exists. The alternative — a
separate `kind` discriminant — would be a second field meaning what the first one
already means.

**5. A `catalog` artifact_type row is inserted even though the success path never
creates one.**

The failure path does, and `package.type` has a foreign key. Five rows go in
(`plugin`, `catalog`, `mcp_server`, `command`, `hook`) in this plan's migration, not
spread across three, so `scripts/migrate.mjs` is edited exactly once and the two
files cannot drift apart mid-phase.

**6. Seeds do not get their own function.**

`03-RESEARCH.md` proposes `persistSeeds()`. Rejected: a run that commits seeds and
then fails to commit packages leaves a seed pointing at a catalog nobody indexed,
and the transaction to avoid that is already open. It is five lines inside it.

**7. The `no_artifacts` early return must learn about seeds.**

`pipeline.ts:242` returns `no_artifacts` when `packages.length === 0`. A repository
whose only artifact is a `marketplace.json` produces zero packages and N seeds, and
would be reported as empty while silently discarding the seeds. This is the one
place where the seeds channel changes an existing user-visible outcome.

</decisions_made_while_planning>

<reference>

## Reference A — the widened result type

`src/detect/types.ts`. `Detector` itself does not change; only its return type
widens and `Candidate` gains one optional field it did not have.

```ts
/** A repository this scan learned about but did not visit. Never dereferenced. */
export type DetectedSeed = {
  /** Lowercased `owner/repo`. The only shape this project can act on. */
  fullName: string;
  /** github | url | git-subdir. Text, not a union in the database — see schema.ts. */
  sourceKind: string;
  /** Whatever the catalog entry said, verbatim. Data, never a fetch target. */
  hint: Record<string, unknown>;
};

export type ParseResult =
  | { ok: true; status: 'ok' | 'partial'; artifact: DetectedArtifact; warnings: string[] }
  | { ok: false; status: 'failed'; artifact?: Partial<DetectedArtifact>; errors: string[] }
  /**
   * This candidate is not an artifact and is not a package. A catalog names other
   * repositories; the pipeline routes these to repo_seed and writes no row here.
   */
  | { ok: true; status: 'seeds'; seeds: DetectedSeed[]; warnings: string[] }
  /**
   * This candidate is not an artifact at all — path-only match() could not know.
   * A .claude/settings.json with no hooks key is not a malformed hook, it is not
   * a hook. The pipeline drops it silently, the same way a repository with no
   * SKILL.md produces no skill rows.
   */
  | { ok: true; status: 'none'; reason: string };
```

And on `DetectedArtifact`, one added optional field:

```ts
  /**
   * The bytes this artifact's version identity is computed from, when the
   * artifact is not one file. A manifest-less plugin has no manifest to hash;
   * its identity is the component set it was recognised by, so a component
   * appearing or disappearing mints a version and nothing else does. Unused in
   * this plan; 03-02's plugin detector is the first writer.
   */
  contentBasis?: string;
```

## Reference B — `src/detect/run.ts`, the whole file's shape

```ts
import type { Candidate, Detector, ParseResult, TreeEntry } from './types';

/** One detector's candidates, kept grouped so the fetch cap can cut fairly. */
export type DetectorPass = {
  detector: Detector;
  candidates: Candidate[];
  /** Set when this detector's match() threw. Its candidates are then empty. */
  error: string | null;
};

/**
 * One guarded match pass over the registry.
 *
 * match() is documented as pure and the skill detector's is a filter+map that
 * cannot throw on any input. The detectors this phase adds group directories and
 * parse JSON, and they can. A detector that throws here loses its own candidates
 * and nothing else — one detector's bug must not lose every other detector's
 * findings for the repository.
 *
 * Takes the detector list as a parameter rather than importing DETECTORS, which
 * is what lets a test register a seventh detector without touching the registry.
 */
export function collectCandidates(detectors: Detector[], tree: TreeEntry[]): DetectorPass[] {
  return detectors.map((detector) => {
    try {
      return { detector, candidates: detector.match(tree), error: null };
    } catch (error) {
      return { detector, candidates: [], error: `${detector.type}: ${(error as Error).message}` };
    }
  });
}

/**
 * Every path the pass wants read, interleaved round robin across detectors.
 *
 * The caller truncates this at CAPS.maxFiles. Concatenating detector by detector
 * would make the cut depend on position in the DETECTORS array: on a large
 * repository the last detector would silently receive nothing, which no test
 * that uses a small tree can see. Round robin makes the cut proportional across
 * types instead.
 */
export function orderedNeeds(passes: DetectorPass[]): string[] {
  const queues = passes.map((p) => p.candidates.flatMap((c) => c.needs));
  const out: string[] = [];
  for (let i = 0; queues.some((q) => i < q.length); i += 1) {
    for (const q of queues) if (i < q.length) out.push(q[i]);
  }
  return out;
}

/**
 * parse(), guarded.
 *
 * The comment at pipeline.ts:196 says "per candidate, never per repository" and
 * has always been an intention rather than a mechanism: isolation held only
 * because skill.parse catches internally and returns {ok:false}. A detector that
 * throws is a bug, and it is recorded as a failed candidate rather than allowed
 * to become a failed repository.
 */
export async function safeParse(
  detector: Detector,
  candidate: Candidate,
  read: (path: string) => Promise<string>,
): Promise<ParseResult> {
  try {
    return await detector.parse(candidate, read);
  } catch (error) {
    return {
      ok: false,
      status: 'failed',
      errors: [`${detector.type} detector threw: ${(error as Error).message}`],
    };
  }
}
```

## Reference C — the pipeline's four changes

The needs callback captures the pass instead of recomputing it:

```ts
    let passes: DetectorPass[] = [];

    const inputs = await fetchRepoScanInputs(
      owner,
      repo,
      (tree) => {
        // One match pass per repository. The candidate loop below reuses this
        // instead of calling match() a second time.
        passes = collectCandidates(DETECTORS, tree.entries);
        return orderedNeeds(passes);
      },
      known,
    );
```

The loop, with the body keyed on `needs` and one switch on `status`:

```ts
    const packages: ScannedPackage[] = [];
    const seeds: DetectedSeed[] = [];
    let failed = 0;

    for (const pass of passes) {
      // A detector that threw during match contributes nothing and costs the
      // repository nothing else.
      if (pass.error) detectorErrors.push(pass.error);

      for (const candidate of pass.candidates) {
        // A candidate with no needs is not a file — 03-02's manifest-less plugin
        // is recognised by a directory's shape. Only a candidate that asked for a
        // file and did not get one was cut by a cap.
        const raw = candidate.needs.length > 0 ? inputs.files.get(candidate.needs[0]) : '';
        if (raw === undefined) continue;

        const result = await safeParse(pass.detector, candidate, read);
        const blobSha =
          inputs.tree.entries.find((e) => e.path === candidate.sourcePath)?.sha ?? null;

        if (result.status === 'none') continue;

        if (result.status === 'seeds') {
          seeds.push(...result.seeds);
          continue;
        }

        if (!result.ok) {
          failed += 1;
          packages.push({ /* unchanged failed-row shape */ });
          continue;
        }

        packages.push({
          /* unchanged shape, except: */
          contentHash: contentHash(result.artifact.contentBasis ?? raw),
        });
      }
    }
```

And the emptiness test learns about seeds:

```ts
    // A repository whose only artifact is a catalog found something. Reporting
    // it as empty would also discard the seeds it found.
    if (packages.length === 0 && seeds.length === 0) {
      emit({ outcome: 'no_artifacts', commitSha: inputs.tree.commitSha });
      return { ok: false, outcome: 'no_artifacts', message: messageFor('no_artifacts') };
    }
```

`RepoScan` gains `seeds: DetectedSeed[]`; `IngestResult`'s success arm gains
`seeds: number`; the log line gains `seeds` and `seedsSkipped` so the
non-seedable entry count from CONTEXT.md decision 4 has somewhere to live.

## Reference D — `src/detect/json.ts`

```ts
export const JSON_CAPS = {
  /**
   * The largest documented marketplace shape is a few hundred entries; 256 KB
   * holds roughly fifteen hundred typical ones. Applied before JSON.parse, so a
   * hostile file is never parsed at all.
   */
  inputBytes: 256 * 1024,
  /**
   * The real control for JSON, and the one the frontmatter parser does not need.
   * JSON has no alias mechanism, so there is no billion-laughs amplification to
   * defend against and the post-parse serialization cap buys nothing. What it
   * does have is a hundred-thousand-entry plugins[] array that costs a hundred
   * thousand rows downstream.
   */
  maxArrayLength: 1000,
  /**
   * Bounds this module's own validation walk, not JSON.parse. A recursive walk
   * over attacker-shaped nesting is the stack overflow the input cap does not
   * stop, because deep nesting is cheap in bytes.
   */
  maxDepth: 32,
} as const;

export type JsonResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; errors: string[] };

/**
 * Parses an untrusted JSON manifest from a scanned repository.
 *
 * JSON.parse has no code-execution path and no tag mechanism, which is why it
 * needs no schema argument the way js-yaml does (DET-08). Everything below is
 * about volume, not about execution.
 */
export function parseJsonManifest(source: string, sourcePath: string): JsonResult;
```

The walk is iterative or explicitly depth-limited, returns
`over the array-length cap` / `nested deeper than the depth cap` as errors, and
rejects a top-level array or scalar with `manifest is not a JSON object` — the
same posture as `parseFrontmatter`'s "frontmatter is not a mapping".

## Reference E — `src/detect/catalog.ts`, the source-shape rule

The six shapes are verbatim from `code.claude.com/docs/en/plugin-marketplaces`
(quoted in full at `03-RESEARCH.md` Code Example 2). The seedable rule:

```ts
/**
 * Which marketplace source shapes name a repository this project could ingest.
 *
 * A relative source points inside the marketplace's OWN repository, which the
 * plugin detector already walked in this same scan — seeding it would enqueue
 * the repository that is being ingested right now. npm and archive sources name
 * no repository at all, and an archive URL is precisely the arbitrary-URL fetch
 * ING-02 forbids, so it is recorded in the log line and stored nowhere.
 */
function seedFor(entry: unknown, path: string): DetectedSeed | null;
```

`url` and `git-subdir` are seedable only when the URL's host is `github.com` and
its path yields `owner/repo`; the normalization reuses nothing from
`src/github/client.ts`, because `check:boundaries` rule 5 forbids naming a GitHub
host outside `src/github/`. Match on `new URL(...).hostname` supplied by the
caller's own constant, not by a literal in this file — if that proves awkward,
the honest alternative is to export a tiny predicate from `src/github/` and call
it, which keeps the hostname in the one directory `git grep` is supposed to
answer for.

`needs` is `[c.sourcePath]` and nothing else. Every field a seed needs —
`name`, `description`, `version`, `author`, `category`, `tags` — is already
inline in `marketplace.json`; fetching each listed plugin's own `plugin.json` to
enrich a seed is Pitfall 3 and would turn one file read into fifty.

## Reference F — the seed table

```ts
/**
 * Repositories a catalog named, stored and never visited.
 *
 * No status column and no enqueued_at. Phase 5 (COR-03) owns fan-out and needs
 * to decide how seed volume interacts with MAX_QUEUED before any of it exists; a
 * nullable timestamp is a one-line additive migration when it does. This is the
 * same reasoning ingest_job records for its absent kind and priority columns.
 */
export const repoSeed = agentdock.table(
  'repo_seed',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    /** Lowercased owner/repo. Only GitHub-reachable entries are stored at all. */
    fullName: text('full_name').notNull(),
    // github | url | git-subdir. Text with a comment, not an enum: widening a
    // constrained type on a populated table is a DROP, which this project's
    // boundary scanner treats as destructive. Same reason as artifact_type.
    sourceKind: text('source_kind').notNull(),
    /** The catalog's own repository, as owner/repo. Provenance, not a join. */
    discoveredFrom: text('discovered_from').notNull(),
    discoveredPath: text('discovered_path').notNull(),
    /** The catalog entry verbatim: name, description, version, subdir, tags. */
    hint: jsonb('hint').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('repo_seed_full_name_key').on(t.fullName)],
);
```

The upsert, inside the transaction `persistScan` already opens, after the
delisting step:

```ts
    // A seed pointing at a denylisted repository is one bug away from re-adding
    // something the denylist exists to keep out (DAT-06). Filtered here, where
    // the transaction is already open, rather than trusted to Phase 5.
    for (const seed of scan.seeds) {
      await tx
        .insert(repoSeed)
        .values({ ... })
        .onConflictDoUpdate({ target: repoSeed.fullName, set: { ..., updatedAt: sql`now()` } })
        .where(sql`not exists (select 1 from ${repositoryDenylist}
                   where ${repositoryDenylist.fullName} = ${seed.fullName})`);
    }
```

If drizzle-orm 0.45.2 will not attach a `where` to that insert shape, the
fallback is one `select` of the denylist rows matching the seed set before the
loop and an in-memory filter — one indexed read, same transaction, same
guarantee. Decide by running it, not by reading the types.

## Reference G — the migration and its companion edit

`drizzle/0003_*.sql`, generated with `bun run db:generate`, reviewed, then
hand-extended at the tail exactly as `0001` was:

```sql
-- Hand-added after generation, which is what the generate-review-migrate
-- workflow exists for. ON CONFLICT DO NOTHING so re-running is safe, and the
-- snapshot in drizzle/meta is unaffected so later generates stay correct.
INSERT INTO "agentdock"."artifact_type" ("id", "label") VALUES
  ('plugin',     'Claude Code Plugin'),
  ('catalog',    'Plugin Marketplace'),
  ('mcp_server', 'MCP Server'),
  ('command',    'Slash Command'),
  ('hook',       'Hook Configuration')
ON CONFLICT DO NOTHING;
```

`scripts/migrate.mjs:110-114` must grow the same five rows. Its own comment at
lines 99-105 explains why: `db:test:setup` regenerates the test schema's DDL from
scratch into a gitignored folder, so a hand-added INSERT can never reach
`agentdock_test`. **Skipping this edit fails every database-backed suite on
`package_type_artifact_type_id_fk` the moment 03-02 stores its first plugin.**

## Reference H — the registry test, rewritten not deleted

`skill.test.ts:282-287` hard-asserts a one-element registry and is the DET-09
canary. It becomes an assertion about the registry's shape rather than its
length, so it keeps failing when someone forgets to register:

```ts
describe('the registry', () => {
  it('holds one element per artifact type, each a distinct type string', () => {
    expect(DETECTORS.map((d) => d.type)).toEqual(['skill', 'catalog']);
    expect(new Set(DETECTORS.map((d) => d.type)).size).toBe(DETECTORS.length);
  });
});
```

03-02 and 03-03 each extend that array literal by the types they add. The final
expected list is `['skill', 'catalog', 'plugin', 'mcp_server', 'command', 'hook']`.

</reference>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: A throwing detector stops taking the repository with it</name>
  <files>src/detect/run.ts, src/detect/run.test.ts, src/ingest/pipeline.ts</files>
  <behavior>
    - A detector whose match() throws yields zero candidates and one recorded error, and every other detector in the same pass yields its candidates unchanged.
    - A detector whose parse() throws yields a failed ParseResult naming the detector, not an exception.
    - collectCandidates called with a list containing only throwing detectors returns one pass per detector, all empty, and does not throw.
    - orderedNeeds interleaves: given two detectors wanting [a1,a2,a3] and [b1], the order is a1,b1,a2,a3 — so a cap applied to the head cannot starve the second detector.
    - orderedNeeds over an empty pass list is empty, so a repository with no artifacts still costs zero file reads.
    - Running the full pipeline against a tree where one registered detector throws still stores every skill the reference corpus holds.
  </behavior>
  <action>
    Write the failing test first. The cleanest reproduction is at the
    `collectCandidates` level with two hand-written detectors, one of which throws
    from `match()` — but do the pipeline-level one too, because the property that
    matters is "the repository still ingests", and that is only visible end to end.
    The pipeline-level test lives in `pipeline.test.ts` and is database-gated;
    the unit-level tests live in `run.test.ts` and are not, which is the point of
    the file existing.

    Then apply References B and the first two changes of Reference C.

    Guard the single match pass, not two. `pipeline.ts:137` and `pipeline.ts:192`
    call `match()` over the same bounded tree, so the second recomputes the first.
    Capture the pass in the `selectPaths` callback and iterate it in the loop.
    Two guards for one logical operation can diverge, and a detector that throws
    only sometimes would be counted in one pass and not the other.

    Do not change what a candidate produces in this task. The body keying, the
    status switch, and the seeds channel are Task 2 — this task's diff should read
    as "the same loop, guarded, running match once".

    Record the detector errors somewhere a person will see them. The structured
    log line already exists and already carries per-run facts; a
    `detectorErrors: string[]` field on it costs nothing and is the difference
    between a silent partial scan and a diagnosable one. Do not invent a new
    table for it.

    Watch the first test fail against the current code and record the shape of
    that failure in the summary — a thrown exception surfacing as an
    `IngestOutcome` for the whole repository is the bug this task closes.
  </action>
  <verify>
    <automated>bun run test src/detect/run.test.ts &amp;&amp; bun run typecheck</automated>
  </verify>
  <done>A detector that throws from match() or parse() costs only its own candidates; every other detector's findings are stored and the repository ingests. match() runs once per repository. The regression failed before the change and passes after it.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: A second output channel — the widened result, the seed table, and the one switch</name>
  <files>src/detect/types.ts, src/detect/json.ts, src/detect/json.test.ts, src/db/schema.ts, drizzle/0003_*.sql, scripts/migrate.mjs, src/ingest/types.ts, src/ingest/persist.ts, src/ingest/persist.test.ts, src/ingest/pipeline.ts</files>
  <behavior>
    - A JSON manifest over the input byte cap fails before JSON.parse runs, naming the cap.
    - A manifest carrying an array longer than the array-length cap fails naming the array length, not the byte size.
    - A manifest nested deeper than the depth cap fails without a stack overflow.
    - A top-level JSON array or scalar fails with "not a JSON object", the same posture as frontmatter that is not a mapping.
    - Valid JSON with unknown top-level fields parses successfully — unknown fields are never an error.
    - A ParseResult with status 'none' produces no package row and no seed row.
    - A ParseResult with status 'seeds' produces seed rows and no package row.
    - Persisting a scan carrying seeds writes one repo_seed row per seed, keyed on full_name, inside the same transaction as the artifacts.
    - Re-persisting the same seed updates rather than duplicating.
    - A seed whose full_name is in repository_denylist is not written.
    - A transaction that fails after the seed upsert leaves no seed rows, because they are in the same commit as everything else.
    - bun run check:boundaries passes on the generated migration.
  </behavior>
  <action>
    Apply References A, D, F and G, and the remaining two changes of Reference C
    (the body keyed on `needs`, and the switch on `result.status`).

    Generate the migration with `bun run db:generate`, read every line of the
    output before applying it, delete any `CREATE SCHEMA` statement drizzle-kit
    emits, hand-add the artifact_type INSERT at the tail, then
    `bun run db:migrate`. Never `drizzle-kit push` or `pull`.

    Edit `scripts/migrate.mjs` in the same task, not later. Its comment already
    says why, and the failure it prevents is remote from its cause: the test
    schema regenerates from scratch, so a hand-added INSERT never reaches it, and
    the symptom is every database-backed suite failing a foreign key in 03-02.

    Run `bun run db:test:setup` after the migration so `agentdock_test` has the
    new table before the persistence tests run.

    In `json.ts`, size-cap before parsing and bound your own walk. JSON has no
    alias mechanism, so the post-parse serialization cap `frontmatter.ts` needs is
    not the control here — the array-length cap is, and it must apply to any array
    at any depth rather than to a named `plugins[]` field, because `server.json`'s
    `packages[]` needs the same protection and a seventh format will need it
    again. Keep the walk iterative or explicitly depth-limited: a recursive walk
    over attacker-shaped nesting is the overflow the byte cap does not stop.

    Do not add a `parse_status` or `status` column to `repo_seed`, and do not add
    `enqueued_at`. Phase 5 owns fan-out; a column nothing writes is a column that
    will be wrong when something finally does.

    Do not touch `src/detect/skill.ts`. If the widened union forces a change
    there, the union is wrong — `status` is already on every arm and the two
    existing arms are unchanged.
  </action>
  <verify>
    <automated>bun run check:boundaries &amp;&amp; bun run test src/detect/json.test.ts src/ingest/persist.test.ts &amp;&amp; bun run typecheck</automated>
  </verify>
  <done>Untrusted JSON is capped three ways before anything downstream sees it; repo_seed exists, is additive, and passes the boundary scanner; seeds persist inside the artifacts' own transaction and are filtered against the denylist; the pipeline routes on one switch; skill.ts is untouched.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: The tracer — a marketplace becomes seeds, and a broken one becomes one honest row</name>
  <files>src/detect/catalog.ts, src/detect/catalog.test.ts, src/detect/index.ts, src/detect/skill.test.ts, src/ingest/pipeline.ts, src/ingest/pipeline.test.ts, fixtures/adversarial/marketplace-malformed.json, fixtures/adversarial/README.md</files>
  <behavior>
    - catalog.match finds exactly one candidate in each of the four frozen corpora, and its needs is one path.
    - catalog.match returns nothing for a path that merely contains the filename — marketplace.json.bak, my-marketplace.json, a tree entry of type tree.
    - A marketplace with one entry of each of the six source shapes yields seeds for github, github-hosted url, and github-hosted git-subdir, and no seed for relative, npm, archive, or a non-github url.
    - A git-subdir seed carries its subdirectory path in hint, and no seed carries a fetchable URL anywhere the pipeline would follow.
    - Seed full_names are lowercased, so the same repository named two ways in two catalogs is one row.
    - A marketplace whose plugins array is missing or not an array parses as failed with a readable error, not an exception.
    - A malformed marketplace produces exactly one package row of type catalog with parse_status failed, and zero seeds.
    - A well-formed marketplace produces zero package rows and N seed rows.
    - A repository whose only artifact is a marketplace.json is not reported as no_artifacts.
    - A subsequent ingest in which the marketplace has been fixed delists the failed catalog row, because a parsed catalog contributes no package id.
    - The registry test asserts two types and fails if a detector is added without being listed.
  </behavior>
  <action>
    Apply Reference E, register the detector in `src/detect/index.ts` as one import
    and one array element, and rewrite the registry test per Reference H — rewrite
    it, do not delete it. It is the canary that fails when someone writes a
    detector file and forgets the array.

    Test `match()` against the real corpora. All four carry a `marketplace.json`
    and their `tree.json` files are complete, so the counts are real rather than
    hand-authored. Test `parse()` with inline strings, following
    `skill.test.ts`'s Idiom B — the captured `files/` directories hold only
    `SKILL.md` bodies, and hand-writing a fake corpus directory to hold one JSON
    string is ceremony.

    Write the six-source-shape fixture inline, one entry per shape, in one string.
    That single fixture is the whole seedability rule and reads as a table.

    `fixtures/adversarial/marketplace-malformed.json` is the one file that goes to
    disk, because it is hand-authored hostile content and belongs beside the
    nineteen adversarial fixtures that already exist. Add its line to the
    directory's README. Generate the oversized case in the test with `repeat` —
    do not commit a five-megabyte file to prove an array cap.

    Never dereference a URL read from a manifest. The seeds carry URLs as data;
    assert in the test that the run contacted only the two allowlisted hosts, the
    way `pipeline.test.ts` already asserts it for URLs planted in a skill body.

    Wire the `no_artifacts` change from Reference C and prove it: a tree
    containing only `.claude-plugin/marketplace.json` must ingest, not report
    itself empty. `treeWith()` at `pipeline.test.ts:85` builds that tree in one
    line.

    Run the whole suite at the end of this task, not just the files it touched.
    `ParseResult`, `RepoScan` and `IngestResult` all changed shape, and the Phase 1
    and Phase 2 suites are what prove nothing else moved with them.
  </action>
  <verify>
    <automated>bun run test &amp;&amp; bun run typecheck &amp;&amp; bun run check:boundaries</automated>
  </verify>
  <done>A marketplace.json produces seeds and no package row; a malformed one produces one failed catalog row and no seeds; the three non-repository source shapes and the self-referential relative shape produce nothing; a catalog-only repository ingests; the whole existing suite still passes.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| a scanned repository's JSON → `JSON.parse` and the validation walk | Untrusted bytes chosen by whoever wrote the repository, sized and shaped by them |
| a detector's code → the repository's ingestion | An exception from any detector currently decides whether every other detector's findings are stored |
| a manifest's `url` / `archive` field → the fetch layer | A value read from repository content is one careless `fetch()` from being an SSRF target |
| `repo_seed` → Phase 5's future fan-out | Anything written here becomes a repository Phase 5 may visit unattended |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-03-01 | Denial of Service | `detector.match()` at both call sites, `detector.parse()` | high | mitigate | One guarded match pass and a guarded parse in `src/detect/run.ts`; a unit regression that runs without a database drives a throwing detector and asserts the others' candidates survive. |
| T-03-02 | Denial of Service | `parseJsonManifest` array length | high | mitigate | `JSON_CAPS.maxArrayLength` applies to any array at any depth, not to a named field, so `plugins[]` and `packages[]` and the seventh format's array are all covered. Test generates the oversized case rather than committing it. |
| T-03-03 | Denial of Service | `parseJsonManifest` nesting depth | medium | mitigate | `JSON_CAPS.maxDepth` bounds this module's own walk, which the byte cap cannot — deep nesting is cheap in bytes and expensive on the stack. Walk is iterative or explicitly depth-limited. |
| T-03-04 | Tampering / SSRF | `marketplace.json` `source.url` and `archive.url` | high | mitigate | Stored as `hint` data, never dereferenced; `archive` and non-GitHub `url` sources produce no seed at all. The pipeline test asserts the run contacted only the two allowlisted hosts. |
| T-03-05 | Tampering | a seed naming a denylisted repository | medium | mitigate | Filtered against `repository_denylist` at insert, inside the transaction that is already open, rather than trusted to Phase 5's fan-out. |
| T-03-06 | Denial of Service | a hundred-plugin marketplace flooding `ingest_job` | high | mitigate | Structural: this phase writes `repo_seed` and never calls `enqueueJob`. Fan-out is Phase 5's, and `MAX_QUEUED = 500` is a shared ceiling this phase does not touch. |
| T-03-07 | Denial of Service | ReDoS on an adversarial tree path | medium | mitigate | `catalog.match` uses `endsWith` and segment comparison, no regex with nested quantifiers. Combined with T-03-01, a pathological path costs one detector rather than one repository. |
| T-03-08 | Elevation of Privilege | the `0003` migration | high | mitigate | Generated, then hand-reviewed line by line before `db:migrate`; additive only, `agentdock`-qualified, no `DROP`; `check:boundaries` runs in the task's own verify command. `drizzle-kit push`/`pull` are unreachable from `package.json` and the scanner enforces it. |
| T-03-09 | Information Disclosure | `repo_seed.hint` rendered later | low | accept | The column holds catalog-entry fields that are already public in the source repository, and nothing in this phase renders it. Phase 4 owns the rendering path and REN-01/REN-03 already govern it. |
</threat_model>

<verification>
1. A detector whose `match()` throws loses its own candidates and nothing else; a detector whose `parse()` throws loses one candidate and nothing else. Both provable without a database.
2. `match()` runs once per detector per repository.
3. `orderedNeeds` interleaves, so truncation cannot starve the last detector in the registry.
4. A JSON manifest is rejected over the byte cap, over the array-length cap, and over the depth cap, each with a distinct readable error.
5. `marketplace.json` is found in all four frozen corpora by path alone, at one `needs` each.
6. Exactly the three GitHub-reachable source shapes produce seeds; relative, npm, archive and non-GitHub url produce none.
7. A well-formed catalog produces zero package rows; a malformed one produces exactly one, of type `catalog`, `parse_status='failed'`.
8. A catalog-only repository ingests rather than reporting `no_artifacts`.
9. Seeds land in the artifacts' own transaction, dedupe on `full_name`, and skip denylisted repositories.
10. `scripts/migrate.mjs` and `drizzle/0003_*.sql` carry the same five artifact types.
11. `src/detect/skill.ts` is unmodified.
12. `bun run ci` passes.
</verification>

<success_criteria>
- **DET-07** — per-candidate and per-detector isolation is a property of the pipeline, proven by a regression that fails against the pre-change code, not a property of one detector's internal catch.
- **DET-03** — `marketplace.json` emits repository seeds and is never stored as a package on the success path.
- **DET-09** — the pipeline's one-time change is complete and named; `Detector` is unchanged; the registry canary is rewritten rather than deleted.
- **DET-08** — every new parse path is `JSON.parse` under three caps, with no code-execution mechanism anywhere near it.
- **QUA-03 / QUA-05** — the detector, the JSON caps and the isolation guard all have unit tests that run with no network and no token; the malformed marketplace joins the permanent adversarial suite.
- ROADMAP criterion 2 — a catalog file produces repository seeds rather than being stored as a package.
</success_criteria>

<output>
Create `.planning/phases/AGD-03-detector-pluralism/03-01-SUMMARY.md` when done.
Record: the shape of the isolation failure observed against the pre-change code;
the `marketplace.json` count found in each of the four corpora by `match()`;
which of the six source shapes produced seeds and which did not; the row counts
observed for the malformed-catalog case; and the exact `0003` migration filename
drizzle-kit generated. Record no credential and no connection string.

**Do not `git commit` and do not `git push`.** End with a recommended commit
message and leave the working tree for the maintainer.
</output>
