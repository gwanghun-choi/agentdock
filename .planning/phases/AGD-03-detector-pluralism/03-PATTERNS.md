# Phase 3: Detector Pluralism - Pattern Map

**Mapped:** 2026-08-11
**Files analyzed:** 16 (new + modified, extracted from 03-RESEARCH.md "Recommended project structure" and the Test Map)
**Analogs found:** 13 / 16 (3 have no precedent — see "No Analog Found")

This phase is mostly "write five more of a thing that already exists once." The
one-of-each already in the tree is `src/detect/skill.ts`. Everything below is
anchored to it and to the four other precedents actually verified in source this
session.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/detect/plugin.ts` | detector | transform (tree -> candidates -> artifact) | `src/detect/skill.ts` | role+flow, but see gap G1 (directory grouping is new) |
| `src/detect/catalog.ts` | detector | transform | `src/detect/skill.ts` | role-match only — **no non-package-producing detector exists** (gap G2) |
| `src/detect/mcp.ts` | detector | transform | `src/detect/skill.ts` | role+flow; JSON instead of YAML (gap G3) |
| `src/detect/command.ts` | detector | transform | `src/detect/skill.ts` | **exact** — same parser, same frontmatter, only the name-source rule differs |
| `src/detect/hook.ts` | detector | transform | `src/detect/skill.ts` | role-match; needs a "produce no row" outcome that `ParseResult` cannot express today (gap G2) |
| `src/detect/*.test.ts` (5 new) | test | file-I/O (fixture read) | `src/detect/skill.test.ts` | exact |
| `src/detect/types.ts` | type/config | — | itself (additive edit) | modify-in-place |
| `src/detect/index.ts` | registry/config | — | itself (append 5 elements) | modify-in-place |
| `src/ingest/pipeline.ts` | service | request-response orchestration | itself (`pipeline.ts:191-240` loop) | modify-in-place |
| `src/ingest/persist.ts` (`persistSeeds`) | service/repository | CRUD (upsert in tx) | `persistScan` at `src/ingest/persist.ts:44-175` | exact |
| `src/ingest/types.ts` (`RepoSeed`) | model/type | — | `ScannedPackage` at `src/ingest/types.ts:4-19` | exact |
| `src/db/schema.ts` (`repoSeed` table, `package.parentPath`) | model | — | `ingestJob`/`ingestAttempt` at `src/db/schema.ts:188-260` | exact |
| `drizzle/0003_*.sql` | migration | — | `drizzle/0002_flowery_captain_america.sql` + `0001`'s hand-added INSERT | exact |
| `scripts/migrate.mjs` (artifact_type seed list) | config/script | — | `scripts/migrate.mjs:96-115` | modify-in-place, **required** (gap G4) |
| `fixtures/**` (11 new dirs) | fixture | file-I/O | `fixtures/adversarial/*` (hand-written) vs `fixtures/<slug>/` (captured) | two distinct precedents, see "Fixture Handling" |
| `scripts/capture-fixtures.mjs` (optional new pin) | script | file-I/O | itself, `PINS` array at line 20 | modify-in-place; **hard-coded to `SKILL.md`** (gap G5) |
| `src/ingest/pipeline.test.ts` | test | integration | itself | extend |

## Pattern Assignments

### `src/detect/{plugin,catalog,mcp,command,hook}.ts` (detector, transform)

**Analog:** `src/detect/skill.ts` — the single canonical shape. Full extraction:

**Imports and module-level constants** (`skill.ts:1-35`):
```typescript
import { parseFrontmatter } from './frontmatter';
import type { Candidate, Detector, ParseResult, TreeEntry } from './types';

/** The complete specification field set. Anything else means runtime-locked. */
export const SPEC_KEYS = ['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools'] as const;

const NAME_RULE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_NAME = 64;
const MAX_DESCRIPTION = 1024;
/** Excerpt, not a mirror. The largest sampled file is 72 KB. */
const MAX_BODY = 32 * 1024;

function directoryOf(sourcePath: string): string { /* split('/'), take [-2] */ }
/** Code points, not bytes: a byte cap is wrong for a CJK description. */
function length(value: string): number { return [...value].length; }
```
Note: relative imports (`./frontmatter`) inside `src/detect/`; `@/`-aliased
imports (`@/db/client`, `@/detect`) only when crossing a top-level directory
(see `pipeline.ts:1-17`). Every exported const carries a prose comment stating
*why the number is that number*. Copy that habit — it is the house style, not
decoration.

**`match()` — path-only, one filter+map** (`skill.ts:40-46`):
```typescript
  // Path-only, so a repository with no skills costs zero file reads. Covers the
  // root file, the conventional layout, and the nested plugin layout in one rule.
  match(tree: TreeEntry[]): Candidate[] {
    return tree
      .filter((e) => e.type === 'blob' && (e.path === 'SKILL.md' || e.path.endsWith('/SKILL.md')))
      .map((e) => ({ type: 'skill', sourcePath: e.path, needs: [e.path] }));
  },
```
Three load-bearing details to copy: (1) `e.type === 'blob'` is always checked —
a *directory* named `SKILL.md` must not match, and `skill.test.ts:78` is the
regression for it; (2) `needs` is always `[e.path]` and nothing more (Pitfall 3);
(3) `match` takes exactly one parameter, and `skill.test.ts:59` asserts
`skill.match).toHaveLength(1)` as the structural proof that it cannot fetch.
Keep the new arity at 1 or that assertion pattern breaks for the new detectors.

**`parse()` — the read callback and the failure envelope** (`skill.ts:48-61`):
```typescript
  async parse(c: Candidate, read: (path: string) => Promise<string>): Promise<ParseResult> {
    let source: string;
    try {
      source = await read(c.sourcePath);
    } catch (error) {
      return { ok: false, status: 'failed', errors: [`could not read: ${(error as Error).message}`] };
    }

    const parsed = parseFrontmatter(source, c.sourcePath);
    if (!parsed.ok) return { ok: false, status: 'failed', errors: parsed.errors };
```
`read` is a parameter, never an import — that is why the whole suite needs no
mocking library. The JSON detectors (plugin/catalog/mcp/hook) substitute
`JSON.parse` in a try/catch here and must add their own byte cap before parsing,
mirroring `FRONTMATTER_CAPS` (`src/detect/frontmatter.ts:3`, which caps both
input bytes at line 50 and post-parse serialized bytes at lines 77-80).

**The ok/partial/failed rule** (`skill.ts:69-107`) — this is the whole tolerance
doctrine, copy it literally:
```typescript
    // The only three ways to fail. All 100 sampled files clear this bar, so a
    // file that does not is anomalous rather than merely non-conforming.
    if (name.length === 0 || description.length === 0) {
      return {
        ok: false, status: 'failed',
        errors: ['frontmatter is missing a non-empty name or description'],
        artifact: { name: directoryOf(c.sourcePath) || 'unnamed' },   // <- fallback name on the failure path
      };
    }

    // Every rule below is a warning. None of them can drop a row: rejecting on
    // them would have discarded roughly a quarter of the measured corpus.
    const warnings: string[] = [];
    if (extraKeys.length > 0) warnings.push(`keys outside the specification: ${extraKeys.join(', ')}`);
```
- `failed` = the identity fields are absent/unusable. Still returns a partial
  `artifact` so the pipeline has a name for the row.
- `partial` = parsed fine, has warnings.
- `ok` = parsed fine, zero warnings.

Terminal status line (`skill.ts:109-133`):
```typescript
    return {
      ok: true,
      status: warnings.length > 0 ? 'partial' : 'ok',
      warnings,
      artifact: {
        name, slug: dir || name, summary: description,
        licenseText: ..., declaredVersion: ..., body: source.slice(0, MAX_BODY),
        frontmatter: fm,
        meta: { frontmatterKeys: keys, specPure: extraKeys.length === 0, allowedTools: tools },
      },
    };
```
`meta` is the per-type escape hatch (`schema.ts:118-120`). Research's proposed
`meta.detectionConfidence`, `meta.hookCount`, `meta.events` all land here — no
column needed. Note `status: warnings.length > 0 ? 'partial' : 'ok'` is the
exact expression to reuse for the shape-only-plugin case; research asks for
shape-only to be *forced* `partial`, which means pushing a warning rather than
special-casing the status expression.

**`command.ts` specifically** is the closest to a copy job in the phase: same
`parseFrontmatter` call at `skill.ts:60`, same warnings array, only
`directoryOf()` (`skill.ts:21-24`) is replaced by a filename-minus-`.md` rule.

---

### `src/detect/*.test.ts` (test, file-I/O)

**Analog:** `src/detect/skill.test.ts`. The suite uses **both** fixture idioms —
which one you pick per test is a real decision, not a coin flip.

**Idiom A — a frozen captured corpus on disk** (`skill.test.ts:8-31`):
```typescript
const ROOT = 'fixtures';

/**
 * Loads a frozen corpus: the captured tree and a map of the captured bodies.
 * The reader is closed over that map and handed to parse() as a parameter, so no
 * mocking library is involved — the interface already takes its dependency as an
 * argument.
 */
function corpus(slug: string) {
  const dir = join(ROOT, slug);
  const tree = JSON.parse(readFileSync(join(dir, 'tree.json'), 'utf8'));
  const files = new Map<string, string>();
  for (const name of readdirSync(join(dir, 'files'))) {
    files.set(decodeURIComponent(name), readFileSync(join(dir, 'files', name), 'utf8'));
  }
  const entries: TreeEntry[] = tree.tree;
  const read = async (path: string) => {
    const body = files.get(path);
    if (body === undefined) throw new Error(`no captured body for ${path}`);
    return body;
  };
  return { entries, files, read };
}
```

**Idiom B — an inline tree literal and an inline `read`** (`skill.test.ts:37-41`
and `62-69`):
```typescript
/** Parses a hand-written fixture at a chosen source path. */
async function parseAt(sourcePath: string, source: string) {
  const candidate: Candidate = { type: 'skill', sourcePath, needs: [sourcePath] };
  return skill.parse(candidate, async () => source);
}

// and for match():
const tree: TreeEntry[] = [
  { path: 'SKILL.md', type: 'blob', sha: 'a' },
  { path: 'skills/x/SKILL.md', type: 'blob', sha: 'b' },
  { path: 'plugins/p/skills/y/SKILL.md', type: 'blob', sha: 'c' },
];
expect(skill.match(tree).map((c) => c.sourcePath)).toEqual(tree.map((e) => e.path));
```

**When each is used, empirically:** `match()` tests over *real-world scale and
counts* use Idiom A with a hard-coded expected count
(`skill.test.ts:44-49`: `['anthropics-skills', 18]`). Every *rule* test —
negative matches, adversarial content, shape edge cases — uses Idiom B with an
inline tree or a single string. `fixtures/adversarial/*.md` is a third middle
ground: a hand-written file on disk read by `adversarial(name)`
(`skill.test.ts:33-35`) and driven through `it.each` (`skill.test.ts:229-239`).

**Recommendation for this phase:** the new detectors' plugin/catalog/mcp/hook
fixtures are all hand-written per the research Wave 0 list, so **Idiom B for
`match()` shape rules and `fixtures/adversarial/` + Idiom A for malformed
manifest content**. Only reach for a new `capture-fixtures.mjs` pin if a real
count-based scale assertion is wanted.

**The registry test must be updated** (`skill.test.ts:282-287`):
```typescript
describe('the registry', () => {
  it('is one array with one element in this phase', () => {
    expect(DETECTORS).toEqual([skill]);
    expect(DETECTORS.map((d) => d.type)).toEqual(['skill']);
  });
});
```
This test hard-asserts a one-element registry and **will fail the moment a
second detector is registered**. It is the DET-09 canary; rewrite it to assert
the six types, do not delete it.

---

### `src/db/schema.ts` (model) — `repo_seed` table + `package.parentPath`

**Analog:** `ingestJob` (`src/db/schema.ts:188-219`) — the most recent table
added, and the one whose comments state the project's DDL doctrine.

**Table declaration shape:**
```typescript
export const agentdock = pgSchema(AGENTDOCK_SCHEMA);   // schema.ts:41

export const ingestJob = agentdock.table(
  'ingest_job',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    target: text('target').notNull(),
    status: text('status').notNull().default('queued'),   // union enforced in TS, not a CHECK
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    workerId: text('worker_id'),
  },
  (t) => [
    uniqueIndex('ingest_job_active_key').on(t.target).where(sql`${t.status} in ('queued','running')`),
    index('ingest_job_claim_idx').on(t.nextAttemptAt).where(sql`${t.status} = 'queued'`),
  ],
);
```
Rules extracted, all of them enforced by `scripts/check-boundaries.mjs` rule 4
("every Drizzle table hangs off pgSchema()"):
- Every table is `agentdock.table(...)`, never bare `pgTable`.
- Indexes/constraints are the **third** argument, an array returned from `(t) => [...]`.
- **No enums, no CHECK constraints.** `schema.ts:183-187` states why verbatim:
  *"widening a constrained type on a populated table is a DROP, which this
  project's boundary scanner treats as destructive. The union is enforced in
  TypeScript."* `repo_seed`'s source-kind column must be `text` + a comment.
- jsonb columns use `.$type<...>().notNull().default(sql\`'{}'::jsonb\`)`
  (`schema.ts:120`) — `$type` is TS-only and emits no DDL, so `hint` jsonb on
  `repo_seed` follows this exactly.
- `package.parentPath` is `text('parent_path')` **nullable, no default** — the
  additive shape. Do not add it to `unique('package_identity')`
  (`schema.ts:128`); research §5 is correct that `(repository_id, type,
  source_path)` already disambiguates nesting.

**There is a second copy of the schema.** `.drizzle-test/` (gitignored) holds
DDL regenerated for `agentdock_test` via
`db:test:generate` (`package.json:21`). It is generated, not hand-edited — but
see gap G4: anything hand-added to a `drizzle/` migration never reaches it.

---

### `drizzle/0003_*.sql` (migration)

**Analog for generated DDL:** `drizzle/0002_flowery_captain_america.sql` — every
target fully schema-qualified, statements joined by `--> statement-breakpoint`:
```sql
CREATE TABLE "agentdock"."ingest_job" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"target" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ingest_job_claim_idx" ON "agentdock"."ingest_job" USING btree ("next_attempt_at") WHERE "agentdock"."ingest_job"."status" = 'queued';
```

**Analog for the hand-added `artifact_type` INSERT** — this is the one the phase
needs and it is precedented exactly once, at the tail of
`drizzle/0001_outstanding_the_santerians.sql:73-78`:
```sql
-- Hand-added after generation, which is what the generate-review-migrate
-- workflow exists for. The artifact-type dimension ships at exactly one value;
-- Phase 3 adds the rest with an INSERT rather than a migration against live
-- data. ON CONFLICT DO NOTHING so re-running this migration is safe.
-- The snapshot in drizzle/meta is unaffected, so later generates stay correct.
INSERT INTO "agentdock"."artifact_type" ("id", "label") VALUES ('skill', 'Agent Skill') ON CONFLICT DO NOTHING;
```
The migration for this phase writes the same statement with `plugin`, `catalog`,
`mcp_server`, `command`, `hook`. Constraints from
`scripts/check-boundaries.mjs:30-46`: no `DROP`/`TRUNCATE`/`GRANT`/`CREATE
SCHEMA` without the `agentdock:reviewed-destructive` marker in the same file,
and every `CREATE TABLE`/`ALTER TABLE`/`CREATE INDEX ... ON` target must be
schema-qualified. `ALTER TABLE "agentdock"."package" ADD COLUMN "parent_path"
text;` clears both rules with no marker needed.

---

### `src/ingest/persist.ts` — `persistSeeds()`

**Analog:** `persistScan` (`src/ingest/persist.ts:44-175`).

**Transaction + upsert idiom** (`persist.ts:44-93`, `114-140`):
```typescript
export async function persistScan(scan: RepoScan, job?: JobContext): Promise<PersistResult> {
  return db.transaction(async (tx) => {
    const [repo] = await tx.insert(repository).values({ /* ... */ })
      .onConflictDoUpdate({ target: repository.githubNodeId, set: { /* ... */ } })
      .returning();
```
```typescript
      const [pkg] = await tx.insert(packageTable).values({ /* ... */ })
        // The array must name the same three columns, in the same order, as the
        // unique('package_identity') constraint.
        .onConflictDoUpdate({
          target: [packageTable.repositoryId, packageTable.type, packageTable.sourcePath],
          set: { name: found.name, /* ... */ delistedAt: null, updatedAt: sql`now()` },
        })
        .returning();
```
Doctrine, verbatim from `persist.ts:33-38`: *"Idempotency is not implemented
here — it is delegated to three unique constraints. An application-level 'select
then insert' races with itself the moment two ingests overlap; ON CONFLICT
cannot."* `persistSeeds` gets `ON CONFLICT (full_name) DO UPDATE` and nothing
resembling a read-then-write.

---

### `src/db/queries/*` — if a seed query module is added

**Analog:** `src/db/queries/jobs.ts`.
```typescript
import { and, desc, eq, lte, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { ingestAttempt, ingestJob, repositoryDenylist } from '@/db/schema';

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';   // the union lives here, not in the DB

export async function enqueueJob(fullName: string): Promise<EnqueueResult> {
  const [blocked] = await db
    .select({ fullName: repositoryDenylist.fullName })   // narrow projection, never select()
    .from(repositoryDenylist)
    .where(eq(repositoryDenylist.fullName, fullName.toLowerCase()))
    .limit(1);
```
Extracted rules: `db` imported from `@/db/client`; operators imported by name
from `drizzle-orm`; every function returns a **narrow explicitly-declared
type**, either a projection object or a discriminated union
(`EnqueueResult` at `jobs.ts:15-18`); `[row] = await ...` destructuring with
`.limit(1)`; status unions declared in TS because the column is plain `text`.

---

### `src/ingest/pipeline.ts` — the integration point

**Detector loop as it stands today** (`pipeline.ts:191-240`):
```typescript
    for (const detector of DETECTORS) {
      for (const candidate of detector.match(inputs.tree.entries)) {     // <- line 192, UNGUARDED
        const raw = inputs.files.get(candidate.sourcePath);
        if (raw === undefined) continue; // a cap was reached; already counted as skipped

        // Per candidate, never per repository. One bad file must not lose the
        // other seventeen.
        const result = await detector.parse(candidate, read);
        const blobSha = inputs.tree.entries.find((e) => e.path === candidate.sourcePath)?.sha ?? null;

        if (!result.ok) {
          failed += 1;
          packages.push({ type: detector.type, /* ... */ parseStatus: 'failed', parseErrors: result.errors });
          continue;
        }
        packages.push({ type: detector.type, /* ... */ parseStatus: result.status, parseErrors: result.warnings });
      }
    }
```
Research Pitfall 2 is **confirmed against source**: `parse()` sits inside the
per-candidate loop but there is no `try` around it either — the isolation
comment at lines 196-197 describes intent, and isolation is achieved because
`skill.parse` returns `{ok:false}` rather than throwing. A detector that
*throws* from `parse()` today would also abort the repository. Both `match()`
(line 192) and `parse()` (line 198) need the try/catch this phase adds; do not
plan for only the `match()` half.

**The `needs` collection point** (`pipeline.ts:134-139`) — the second call site
of `match()`, and it is also unguarded:
```typescript
    // One place decides which paths are worth reading, and it reads paths only —
    // so a repository with no artifacts costs zero file fetches.
    const inputs = await fetchRepoScanInputs(
      owner, repo,
      (tree) => DETECTORS.flatMap((d) => d.match(tree.entries)).flatMap((c) => c.needs),
      known,
    );
```
`fetchRepoScanInputs` signature (`src/github/scan.ts:39-44`):
```typescript
export async function fetchRepoScanInputs(
  owner: string, repo: string,
  selectPaths: (tree: RepoTree) => string[],
  knownSha?: string | null,
): Promise<ScanInputs>
```
`match()` therefore runs **twice per repository per detector** — once for
`needs`, once for candidates. A guard added in only one place leaves the other
crash path open, and `selectPaths` results are truncated at `CAPS.maxFiles = 200`
(`scan.ts:11-18`, `79-80`), which is why line 194's `if (raw === undefined)
continue` exists. Six detectors' `needs` share that one 200-file budget.

---

## Shared Patterns

### Detector registration (DET-09's whole surface)
**Source:** `src/detect/index.ts` — the file is 8 lines, entire:
```typescript
import { skill } from './skill';
import type { Detector } from './types';

/**
 * The entire extension point. Phase 3 adds plugin, catalog, mcp, command and
 * hook by writing one file each and appending one element here.
 */
export const DETECTORS: Detector[] = [skill];
```
**Apply to:** all five new detectors. One import line + one array element each.

### Tolerant validation (never a rejection)
**Source:** `src/detect/skill.ts:81-107`.
**Apply to:** every new `parse()`. Warnings array, `failed` reserved for missing
identity, unknown keys are a warning not an error. Do not introduce `zod` —
`grep` confirms it appears only in `src/env.ts` among application source.

### Size caps before and after parse
**Source:** `src/detect/frontmatter.ts:3` (`FRONTMATTER_CAPS`), enforced at
lines 48-50 (input bytes) and 74-80 (post-parse serialized bytes).
**Apply to:** every new JSON manifest parser, plus an array-length cap on
`plugins[]`/`packages[]` per the research security table.

### `meta` jsonb as the per-type escape hatch
**Source:** `src/db/schema.ts:117-120` and `skill.ts:126-132`.
**Apply to:** `detectionConfidence`, `hookCount`, `events`, MCP transport shape.
No new columns for any of these.

### Non-destructive DDL
**Source:** `src/db/schema.ts:53-65` (`artifact_type`'s existence rationale) and
`scripts/check-boundaries.mjs:30-46`.
**Apply to:** the migration. Additive only; new artifact types are INSERTs.

## Fixture Handling — precisely how it works today

Two storage shapes, both under `fixtures/`, both read with plain `node:fs`, no
loader library:

1. **Captured corpus** — `fixtures/<slug>/{repo.json, tree.json, files/}`.
   Written by `scripts/capture-fixtures.mjs` (a **manual** tool: header at line
   4 says *"Not part of `bun run ci`, never invoked by a test"*; script alias
   `fixtures:capture`, `package.json:15`). Bodies are stored one file per blob,
   filename `encodeURIComponent(entry.path)` (`capture-fixtures.mjs:94`) and
   decoded back with `decodeURIComponent` on read (`skill.test.ts:22`). Pins
   carry an explicit commit `sha` and a `bodies: 'all' | <n>` selector
   (`capture-fixtures.mjs:20-52`). Four slugs exist today: `anthropics-skills`,
   `addyosmani-agent-skills`, `baoyu-skills`, `wshobson-agents`.
2. **Hand-written adversarial files** — `fixtures/adversarial/*.md` (21 files)
   and `fixtures/xss/*.md` (11 files), flat single files with a `README.md`
   alongside, read directly by name. This is the precedent for every QUA-05
   fixture in this phase.

`fixtures/*` is also consumed by `src/ingest/pipeline.test.ts:10-19`, which
reads `repo.json`/`tree.json` as raw strings and serves them from a stubbed
`fetch` (`pipeline.test.ts:47-77`), synthesizing trees inline via `treeWith()`
(`pipeline.test.ts:84-90`) for shape cases. That `treeWith` helper is the exact
tool for the DET-06 monorepo integration test.

## No Analog Found

| File / Concept | Role | Data Flow | Reason — state this in the plan, do not invent precedent |
|------|------|-----------|--------|
| G2: `catalog.ts` + `hook.ts` "produces no package" | detector | transform | **There is no detector today that produces anything other than a package, and `ParseResult` (`src/detect/types.ts:24-26`) cannot express "no row."** Its two arms are `{ok:true, artifact}` and `{ok:false, status:'failed'}` — and the pipeline writes a `parseStatus:'failed'` row for the second (`pipeline.ts:202-220`). Both the catalog's seeds-not-packages path and the hook's `settings.json`-with-no-hooks silent-drop path require a genuinely new third outcome in the type and a new branch in the pipeline. This is the phase's only real design work; RESEARCH §8's `producesPackages?`/`seeds?()` proposal is a proposal, not a pattern that exists. |
| G1: directory-shape grouping | utility | transform | No helper groups tree entries by parent directory anywhere in `src/`. `skill.ts:21-24`'s `directoryOf()` is the only path-decomposition function and it returns a single segment name. The `Map<string, TreeEntry[]>` the research recommends has no precedent to copy. |
| G3: JSON manifest parsing | utility | transform | `src/detect/frontmatter.ts` is YAML-only. No `JSON.parse` of untrusted repository content exists in `src/detect/`. The *cap doctrine* transfers; the code does not. |
| G4: `scripts/migrate.mjs` artifact_type seed | script | — | Not a missing analog but a **required companion edit that is easy to miss.** `scripts/migrate.mjs:96-115` re-asserts `insert ... values ('skill', 'Agent Skill') on conflict do nothing` after every migrate, and its own comment (lines 99-105) explains why: hand-added INSERTs in `drizzle/` never reach `agentdock_test`, because `db:test:generate` regenerates that DDL from scratch. **Adding the four new artifact types to the migration alone will leave every database-backed test failing on `package_type_artifact_type_id_fk`.** Both files must change. |
| G5: `capture-fixtures.mjs` for non-skill types | script | file-I/O | The script is hard-coded to skills: `capture-fixtures.mjs:78-79` filters `e.path.endsWith('SKILL.md')` and **throws** `no SKILL.md in the tree` when zero match. Adding a plugin/marketplace pin requires generalizing that filter, not just appending to `PINS`. Research lists this as "recommended but not blocking" — the blocking-ness is this line. |

## Metadata

**Analog search scope:** `src/detect/`, `src/ingest/`, `src/db/`, `src/github/`,
`scripts/`, `drizzle/`, `.drizzle-test/`, `fixtures/`
**Files read this session:** 15
**Pattern extraction date:** 2026-08-11
