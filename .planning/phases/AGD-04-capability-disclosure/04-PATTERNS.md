# Phase 4: Capability Disclosure - Pattern Map

**Mapped:** 2026-08-11
**Files analyzed:** 22 new/modified files
**Analogs found:** 18 / 22 (4 have no precedent in this codebase — see "No Analog Found")

Upstream input: `04-RESEARCH.md` only (no CONTEXT.md for this phase).

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/analyze/types.ts` (new) | types | — | `src/detect/types.ts` | exact |
| `src/analyze/declared.ts` (new) | analyzer | transform (structured → findings) | `src/detect/hook.ts` (meta extraction), `src/detect/skill.ts:31-35` `toolTokens()` | role-match |
| `src/analyze/shell.ts` (new) | analyzer | transform (text scan) | `src/detect/plugin.ts` / `hook.ts` — **partial only, see §Role Divergence** | partial |
| `src/analyze/install.ts` (new) | analyzer | transform (text scan) | same as above | partial |
| `src/analyze/network.ts` (new) | analyzer | transform (text scan) | same as above | partial |
| `src/analyze/hidden.ts` (new) | analyzer | transform (codepoint scan) | `src/detect/frontmatter.ts` (cap doctrine) | partial |
| `src/analyze/files.ts` (new) | analyzer | transform (tree slice → inventory) | `src/detect/plugin.ts` `match()` (path-only tree pass), `src/detect/nesting.ts` prefix logic | exact |
| `src/analyze/run.ts` (new) | orchestrator | batch | `src/detect/run.ts` | exact |
| `src/analyze/*.test.ts` (new) | test | — | `src/detect/skill.test.ts` + `src/detect/run.test.ts` | exact |
| `src/github/types.ts` (mod: `mode`) | types | — | itself (`TreeEntry`, additive field) | exact |
| `src/github/tree.ts` (mod: map `mode`) | service | request-response | itself, `tree.ts:43-50` mapper | exact |
| `src/detect/types.ts` (mod: `TreeEntry.mode`) | types | — | itself — **note it declares a SECOND `TreeEntry`**, see §Trap 2 | exact |
| `src/db/schema.ts` (mod: `capabilityFinding` table, `packageVersion.files`) | model | CRUD | `repoSeed` (`schema.ts:180-207`), `packageVersion` (`schema.ts:142-171`) | exact |
| `drizzle/0005_*.sql` (new) | migration | — | `drizzle/0003_flaky_selene.sql`, `drizzle/0004_complete_the_professor.sql` | exact |
| `src/db/queries/capabilities.ts` (new) | query module | CRUD (read) | `src/db/queries/packages.ts` | exact |
| `src/ingest/persist.ts` (mod) | service | CRUD (write, transactional) | itself, `persist.ts:152-172` | exact |
| `src/ingest/pipeline.ts` (mod, if analysis is pre-computed) | service | batch | itself, `pipeline.ts:281-297` | exact |
| `src/components/CapabilityPanel.tsx` (new) | component | request-response (SSR) | `src/components/JobPanel.tsx` | exact |
| `src/components/HiddenContentPanel.tsx` (new) | component | request-response (SSR) | `src/components/JobPanel.tsx` (**not** `SkillBody.tsx`) | exact |
| `src/app/r/[owner]/[repo]/[...path]/page.tsx` (mod) | page | request-response (SSR) | itself | exact |
| `scripts/check-boundaries.mjs` (mod: rule 6) | config/CI | batch | itself, `SOURCE_RULES` | exact |
| `fixtures/capability-precision.md` (new) | fixture record | — | `fixtures/adversarial/README.md` | exact |
| `fixtures/adversarial/*.md` (new hidden-content + redos) | fixture | — | `fixtures/adversarial/` flat dir | exact |
| `src/analyze/lines.ts` or inline line counting | utility | transform | **NONE** | no analog |

---

## Role Divergence: artifact detector vs. capability analyzer

The prompt asks this be reported honestly. It transfers partially.

**What transfers from `src/detect/*`:**

| Property | Where it is established | Applies to `src/analyze/*`? |
|---|---|---|
| Pure function, dependency passed as a parameter (never imported) | `detect/types.ts` `Detector.match` "PURE. Path-only. No network, no database, no filesystem."; `run.test.ts:224` asserts `d.match` has arity 1 *precisely so it cannot fetch* | **Yes, fully.** Analyzers take `(body: string)` and return `Finding[]`. The arity-as-proof trick is directly reusable: an analyzer taking exactly one string parameter structurally cannot reach a database. |
| Tolerant result: an unrecognized shape produces *nothing*, not a failure | `hook.ts:85-91` — no hooks key → `{status:'none'}`, not an error | **Yes.** A body with no matches returns `[]`, never throws, never a "failed" status. |
| Caps as an exported `*_CAPS` const with prose justifying each number | `HOOK_CAPS` (`hook.ts:4-13`), `JSON_CAPS` (`json.ts:1-25`), `FRONTMATTER_CAPS` (`frontmatter.ts:3-15`) | **Yes.** `ANALYZE_CAPS` with `maxLineChars`, `maxFindings`, and a defense-in-depth `MAX_BODY` assertion. |
| Verbatim storage, never interpretation | `hook.ts:112-116`: "Verbatim. Whether this reaches the network or installs a package is CAP-05, Phase 4. Stored, never interpreted: no splitting on shell metacharacters, no URL extraction, no flag." | **This is the explicit hand-off to this phase.** Phase 3 deliberately deferred exactly the work Phase 4 does. |
| No framework/registry/base class | Phase 3 CONTEXT anti-goal, restated in RESEARCH §Anti-Goals | **Yes.** One file per concern, one array of functions. |

**What does NOT transfer:**

| Divergence | Why it matters |
|---|---|
| A detector's `match()` answers *"what kind of file is this?"* from **paths only** and never sees content. A capability analyzer answers *"what signals are in this content?"* and sees nothing but content. | Every path-shaped idiom in `plugin.ts:75` ("One linear pass over blob paths, no regex") and `command.ts:41-44` ("Path segments, not a regex") is *about paths*. Analyzers cannot avoid regex the same way — free prose has no segment structure. The transferable part is the **motive** (no nested quantifiers, nothing to backtrack), not the **mechanism** (segment splitting). |
| A detector has a two-phase `match`/`parse` contract with a declared `needs` fetch set. | Analyzers have no I/O phase at all — no `needs`, no `read`, no candidate. The `Detector` interface should **not** be reused or extended for analyzers. A separate, smaller `Analyzer = (body: string) => Finding[]` type is the honest shape. |
| A detector produces at most one artifact per candidate. | An analyzer produces 0..N findings, which is why `maxFindings` is a new cap class with no precedent in `*_CAPS`. |
| Detector output is *structural* (a manifest exists in a known shape). Analyzer output is *probabilistic* (a pattern matched prose). | This is why CAP-13's precision record has no precedent in `src/detect/` and needs the new `fixtures/capability-precision.md`. `plugin.ts:27` already forward-references this: "Recorded as a false-positive rate against a labeled corpus in Phase 4 (CAP-13)." |

---

## Pattern Assignments

### `src/analyze/run.ts` (orchestrator, batch)

**Analog:** `src/detect/run.ts` — the single most directly transferable file in the codebase for this phase.

**Isolation + list-as-parameter pattern** (`src/detect/run.ts:11-31`):
```typescript
/**
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
```
Copy both properties: (a) an analyzer that throws loses only its own findings and records an error string — one analyzer's bug must not lose every other analyzer's findings; (b) `analyzeCapabilities(analyzers, body, ...)` takes the analyzer list as a parameter. Property (b) is what made DET-09 runtime-testable (`run.test.ts:215-218` registers a seventh detector and asserts the first N passes are unchanged), and the capability layer needs the identical property for CAP-13 (swapping in a candidate pattern for a precision run without touching the shipped registry).

**Guarded-call pattern** (`src/detect/run.ts:60-74`) — `safeParse` is the second half; the comment is worth copying verbatim in spirit:
```typescript
// "...isolation held only because skill.parse catches internally and returns
// {ok:false}. A detector that throws is a bug, and it is recorded as a failed
// candidate rather than allowed to become a failed repository."
```
For Phase 4: an analyzer that throws is recorded as a failed *analyzer*, never a failed *ingest*. This matters more here than in Phase 3 because analysis runs **inside the persist transaction** (§Q9) — an unguarded throw would roll back the `package_version` insert itself.

---

### `src/analyze/hidden.ts`, `install.ts`, `network.ts`, `shell.ts` (analyzers, transform)

**Cap doctrine analogs — the two files that establish it precisely:**

`src/detect/json.ts:1-25` — three caps, each with a distinct justification and an explicit note on what each does *not* cover:
```typescript
export const JSON_CAPS = {
  /** ...Applied before JSON.parse, so a hostile file is never parsed at all. */
  inputBytes: 256 * 1024,
  /**
   * The real control for JSON, and the one the frontmatter parser does not need.
   * ... What it does have is a hundred-thousand-entry plugins[] array that costs
   * a hundred thousand rows downstream. Applies to any array at any depth...
   */
  maxArrayLength: 1000,
  /**
   * Bounds this module's own validation walk, not JSON.parse. ...the walk itself
   * checks depth before it recurses, so this also bounds the walk's own stack usage.
   */
  maxDepth: 32,
} as const;
```

`src/detect/frontmatter.ts:3-15` + `:48-51` + `:72-81` — the **two-sided** cap: input cap *before* parse, serialized cap *after*, with an explicit statement that one does not imply the other:
```typescript
inputBytes: 64 * 1024,
serializedBytes: 256 * 1024,   // "Measured: 800 bytes in, 205 MB out."
// ...
const size = Buffer.byteLength(split.frontmatter, 'utf8');
if (size > FRONTMATTER_CAPS.inputBytes) {
  return { ok: false, errors: [`frontmatter is ${size} bytes, over the input cap`] };
}
// ...
// The input cap above does NOT protect this. Both caps are required.
if (Buffer.byteLength(serialized, 'utf8') > FRONTMATTER_CAPS.serializedBytes) { ... }
```

**Cap doctrine, restated as the four rules CAP-14 must apply to scanning rather than parsing:**
1. **Cap before the expensive operation, never after.** Both files check bytes before handing anything to a parser. For a scanner: slice the line to `maxLineChars` *before* `regex.exec`, not after.
2. **Each cap names what it does NOT cover.** `json.ts` says the input cap does not stop deep nesting; `frontmatter.ts` says the input cap does not stop alias expansion. A capability cap must say the same: `maxLineChars` bounds regex cost per line but does **not** bound total findings; `maxFindings` bounds row volume but does **not** bound scan time.
3. **Every cap number carries its measurement.** "Largest frontmatter block in the 100-file sample is about 1.2 KB." Every `ANALYZE_CAPS` number needs an equivalent sentence sourced from RESEARCH §Q5/§Q12's corpus counts.
4. **A cap breach is a reported, structured outcome — never a silent truncation.** `json.ts:74` returns the actual size in the error string. RESEARCH §Q8 already requires this ("the rest of that line is skipped and the skip is counted, never silently ignored") — the precedent supports it.

**Additional caps analog** — `HOOK_CAPS` (`hook.ts:4-13`) establishes the "tighter local cap beneath a shared global one" idiom, and `hook.ts:122-130` shows a *count* cap (`maxHandlers: 500`) enforced after the walk. `maxFindings` is the same shape.

**Bounded-pattern precedent** — `frontmatter.ts:19`:
```typescript
// Anchored at position zero and non-greedy, so a horizontal rule in the body
// cannot end the block early. Only the FIRST closing fence counts.
const FENCE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
```
This is the exact shape RESEARCH §Q7 proposes for `HTML_COMMENT` — non-greedy with a required fixed terminator. Cite it as the reviewed precedent rather than re-deriving the safety argument.

---

### `src/analyze/files.ts` (analyzer, transform — tree slice → inventory)

**Analog:** `src/detect/plugin.ts`'s `match()` and `src/detect/nesting.ts`'s prefix containment.

Path-only, no-regex idiom (`plugin.ts:75`): *"One linear pass over blob paths, no regex."* And the filter shape from `hook.ts:44-48`:
```typescript
match(tree: TreeEntry[]): Candidate[] {
  return tree
    .filter((e) => e.type === 'blob' && (isPluginHooksFile(e.path) || isSettingsJson(e.path)))
    .map((e) => ({ type: 'hook', sourcePath: e.path, needs: [e.path] }));
}
```
CAP-01/CAP-03's inventory is the same one-pass filter+map over `TreeEntry[]`, filtered by directory prefix. This is the **strongest exact-match analog in the phase** — it is literally the same operation over the same array with a different predicate.

**Predicate-as-named-function idiom** (`hook.ts:19-27`) — each path rule is a tiny named boolean function with a `/** */` comment showing the path shape it matches. Copy this for the bundled-script-extension predicate.

**Measured-threshold idiom** (`plugin.ts:15-27`) — `MIN_SHAPE_COMPONENTS = 2` is exported with a full paragraph of corpus measurement justifying the number. Any threshold `files.ts` introduces needs the same treatment; RESEARCH §Q12 has already done the measuring (248 script files across four corpora).

---

### `src/github/tree.ts` + `src/github/types.ts` (CAP-01 `mode`)

**Analog:** itself. The mapper (`tree.ts:43-50`) is the exact insertion point:
```typescript
const entries: TreeEntry[] = (Array.isArray(json.tree) ? json.tree : []).map(
  (e: Record<string, unknown>) => ({
    path: String(e.path),
    type: e.type as TreeEntry['type'],
    sha: String(e.sha),
    size: typeof e.size === 'number' ? e.size : undefined,
  }),
);
```
Note the defensive-coercion convention: `String(...)` for required strings, `typeof x === 'number' ? x : undefined` for optionals. `mode` follows the optional form: `mode: typeof e.mode === 'string' ? e.mode : undefined`.

**Trap 2 — there are TWO `TreeEntry` types and they are not the same type.**
- `src/github/types.ts:1-6` — `{ path; type: 'blob'|'tree'|'commit'; sha; size? }`
- `src/detect/types.ts:1` — `{ path: string; type: string; sha: string; size?: number }` (a *separate, structurally looser* declaration; `type` is `string`, not the union)

`src/detect/*` imports the detect one; `src/github/*` imports the github one. Adding `mode` to only one leaves the other blind, and because the detect one's `type` is a wide `string`, TypeScript will **not** error at the boundary — it will silently drop the field. Both declarations must be edited in the same task.

---

### `src/db/schema.ts` + `drizzle/0005_*.sql` (model + migration)

**Table-declaration analog:** `repoSeed` (`schema.ts:180-207`) — the most recent new table, and it demonstrates every convention this phase needs.
```typescript
export const repoSeed = agentdock.table(
  'repo_seed',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    fullName: text('full_name').notNull(),
    // github | url | git-subdir. Text with a comment, not an enum: widening a
    // constrained type on a populated table is a DROP, which this project's
    // boundary scanner treats as destructive. Same reason as artifact_type.
    sourceKind: text('source_kind').notNull(),
    /** The catalog entry verbatim: name, description, version, subdir, tags. */
    hint: jsonb('hint').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('repo_seed_full_name_key').on(t.fullName)],
);
```
Copy exactly: `agentdock.table(...)` never `pgTable` (enforced by `check-boundaries.mjs` rule 4), `bigserial({mode:'number'})` PK, `text` + comment instead of an enum for `category`/`detector`, `jsonb().$type<T>().notNull().default(sql\`'{}'::jsonb\`)` for `meta`, `withTimezone: true` timestamps, constraints as an array from the second arg.

**FK cascade analog:** `packageVersion.packageId` (`schema.ts:146-148`):
```typescript
packageId: bigint('package_id', { mode: 'number' })
  .notNull()
  .references(() => packageTable.id, { onDelete: 'cascade' }),
```

**Deliberate-omission comment idiom** (`schema.ts:183-188`, `:210-219`): every column the table *does not* have gets a paragraph explaining why and noting it is "a one-line additive migration" when needed. RESEARCH's Open Question 1 (`files` column vs. reused `meta`) should be resolved in exactly this voice.

**Migration analogs:**
- `drizzle/0003_flaky_selene.sql` — CREATE TABLE + `CREATE UNIQUE INDEX` with `--> statement-breakpoint` separators. Every identifier is `"agentdock"."name"`-qualified; `check-boundaries.mjs` rule 2 fails CI otherwise.
- `drizzle/0004_complete_the_professor.sql` — the entire file: `ALTER TABLE "agentdock"."package" ADD COLUMN "parent_path" text;`. This is the model for `packageVersion.files jsonb`.

**Trap 1 — the `scripts/migrate.mjs` companion-edit trap. Applies ONLY to hand-added INSERTs.**

`0003_flaky_selene.sql` hand-adds an `INSERT INTO "agentdock"."artifact_type"` after generation. `scripts/migrate.mjs:97-121` then **re-asserts the identical rows in application code**, because:
> "`db:test:setup` regenerates the test schema's DDL from scratch into a gitignored folder, so a hand-added INSERT in a drizzle/ migration can never reach `agentdock_test` — leaving package.type pointing at an empty dimension and every database-backed suite failing on package_type_artifact_type_id_fk. ... This list must carry every artifact_type row any migration ever hand-adds, row for row."

**Phase 4 assessment:** the `capability_finding` table is pure DDL with **no reference data and no new `artifact_type` rows**, so this trap should *not* fire. It fires only if a plan decides to seed a `capability_category` dimension table. **If any such table is introduced, the migration edit and the `migrate.mjs:111-121` block edit are one task, not two** — and the failure mode is invisible on `agentdock` and total on `agentdock_test`. RESEARCH's §Q9 recommendation (text-with-comment for `category`, no dimension table) avoids this entirely and should be preferred for that reason on top of the reason RESEARCH gives.

---

### `src/db/queries/capabilities.ts` (query module, read-for-a-page)

**Analog:** `src/db/queries/packages.ts`.

**Module conventions** (`packages.ts:1-4, 18-22`):
```typescript
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { cache } from 'react';
import { db } from '@/db/client';
import { packageTable, packageVersion, repository } from '@/db/schema';

/**
 * cache() dedupes within one render pass, so a page and its generateMetadata do
 * not hit the database twice for the same rows.
 */
export const listPackages = cache(async ({...}) => db.select({...})...);
```
Copy: `@/` path alias, an exported `type XView = {...}` shape declared beside its query, `cache(async ...)` wrapping, explicit `.select({ ... })` projection (never `select()`), `.limit()` always present with a comment justifying the bound.

**Bound-by-construction idiom** (`packages.ts:123-129`): *"The limit is the scan's own file cap: a repository cannot hold more indexed artifacts than one pass was allowed to read, so this is bounded by construction rather than by a page parameter."* The findings query has the same property — `maxFindings` per detector bounds the row count, so the query limit should be justified from that constant rather than invented.

**The permalink function CAP-08 extends** (`packages.ts:72-75`):
```typescript
/** github.com/{full_name}/blob/{commit sha}/{path} — never the tree sha. */
export function permalink(fullName: string, commitSha: string, sourcePath: string): string {
  return `https://github.com/${fullName}/blob/${commitSha}/${sourcePath}`;
}
```
CAP-08 appends `#L${n}`. Keep the `#L` suffix in this module beside `permalink`, following the `detailHref`/`sourcePathFromUrl` precedent (`packages.ts:92`: *"The inverse. Kept beside its counterpart so the two cannot drift apart."*).

---

### `src/components/CapabilityPanel.tsx` and `HiddenContentPanel.tsx`

**Analog: `src/components/JobPanel.tsx` — NOT `SkillBody.tsx`.**

`JobPanel.tsx:27-41` establishes exactly the property both new panels need:
```typescript
/**
 * Pure: it takes two rows, holds nothing and reaches nothing — no database, no
 * router, no server function. That is what lets every state below, including the
 * two that are dishonest by default, be asserted in a suite that runs where
 * there is neither a database nor a browser.
 */
export function JobPanel({ job, retry }: { job: JobView; retry?: ReactNode }) {
```
And its rendering idiom — plain JSX text nodes, which React escapes by default, with zero Markdown involvement:
```typescript
{job.status === 'failed' && attempt?.errorDetail ? (
  <p className="error">{attempt.errorDetail}</p>
) : null}
```
`attempt.errorDetail` is untrusted-adjacent text rendered as a bare JSX child. This is the precedent for CAP-07's sentinel rendering: **no sanitizer needed because nothing is parsed as markup.**

Its test analog `JobPanel.test.tsx` (and `escaping.test.tsx`) already runs this component-without-a-database pattern; `SkillBody.test.tsx:20-22` shows the render harness:
```typescript
function render(markdown: string): string {
  return renderToStaticMarkup(<SkillBody markdown={markdown} />);
}
```
`renderToStaticMarkup` + string assertions, no testing-library, no jsdom.

**The `SkillBody.tsx` question CAP-07 forces — answered: the new panel is purely ADDITIVE. Nothing in `SkillBody.tsx` or its test needs to change.**

What the current pipeline does, read directly (`SkillBody.tsx:22-31, 42-58`):
```typescript
const schema: Schema = {
  ...defaultSchema,
  tagNames: (defaultSchema.tagNames ?? []).filter(
    (t) => t !== 'img' && t !== 'source' && t !== 'picture',
  ),
  attributes: { ...defaultSchema.attributes, a: [...(defaultSchema.attributes?.a ?? []), 'rel', 'target'] },
};
// ...
<Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeSanitize, schema]]} ...>
```
With its own stated primary control (`SkillBody.tsx:36-40`): *"with no raw-HTML plugin, HTML in the source is never parsed into element nodes at all — a script tag in a body is a text node. The sanitizer is the second layer."*

Concretely, per class of hidden content:

| Class | Current `SkillBody` behavior | Asserted where | CAP-07 satisfied by |
|---|---|---|---|
| HTML comment | **Dropped entirely, text and all** | `SkillBody.test.tsx:52-56` — `not.toContain('<!--')` **and** `not.toContain('IGNORE PREVIOUS INSTRUCTIONS')` | New panel shows the comment's inner text as escaped plain text. `SkillBody` keeps dropping it. |
| Bidi override U+202E | **Survives into the DOM, invisible** | `SkillBody.test.tsx:92-95` — `toContain('‮')`, documented as deliberate | New panel names it with a sentinel. `SkillBody` unchanged. |
| Zero-width | Same — survives invisibly | (same block) | Same. |

**The apparent conflict is not a conflict.** CAP-07 says hidden content must not be *silently* stripped — the raw bytes must be retained and the fact disclosed. The raw bytes *are* retained: `packageVersion.body` holds the unmodified source (`skill.ts:124`, `body: source.slice(0, MAX_BODY)`), and the comment is dropped only at the *render* sink, not at the *storage* sink. Detection reads storage, not render output. So the two paths are structurally independent and the panel is additive.

**The one existing test to check, not change:** the two assertions above become *load-bearing in a new way* — they now also prove the new panel is the only place a user can see this content. A plan that changes either assertion has, by definition, reopened Pitfall 3. Add a comment to that effect rather than an edit.

**Mechanically enforced:** `check-boundaries.mjs` `SOURCE_RULES` rule `no-raw-html` (`pattern: /rehype-raw|dangerouslySetInnerHTML|allowDangerousHtml/`) already fails CI if either new panel takes the shortcut. No new enforcement needed for Pitfall 1.

---

### `src/app/r/[owner]/[repo]/[...path]/page.tsx` (page, SSR)

**Analog:** itself. The conventions to extend, not reinvent:

**SSR data loading** (`page.tsx:1-13, 34-39`):
```typescript
// Read at request time. next build runs in CI, where there is no database.
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ owner: string; repo: string; path: string[] }> };

export default async function PackagePage({ params }: Props) {
  const { owner, repo, path } = await params;
  const detail = await getPackageDetail(owner, repo, path);
  if (!detail) notFound();
  const source = permalink(detail.fullName, detail.commitSha, detail.sourcePath);
```
A second `await getCapabilityFindings(detail.id)` call goes here; `cache()` in the query module handles the `generateMetadata` double-render.

**Absence-as-fact rendering — CAP-11's precedent already exists** (`page.tsx:78-86`):
```tsx
<dd>{detail.licenseText ?? 'not declared'}</dd>
{/* Null on the reference repository, so the honest-unknown path is the
    common path rather than the edge case. */}
<dd>{detail.licenseSpdx ?? 'not detected'}</dd>
<dd>{detail.declaredVersion ?? 'not declared'}</dd>
```
CAP-02's "not declared" (the common case per §Q2's zero hits) is this exact pattern, including the comment acknowledging the null path is the common one.

**"Not checked" copy precedent — CAP-09 is an expansion of a sentence already shipped** (`page.tsx:149-157`):
```tsx
<h2>File</h2>
<p className="muted">
  An excerpt of <a href={source} ...>{detail.sourcePath}</a> as published by {detail.fullName},
  at commit {detail.commitSha.slice(0, 7)}. AgentDock reads this file; it does not run it, and it
  cannot say whether it is safe.
</p>
```
Note the existing "excerpt" framing and the existing "cannot say whether it is safe" clause. CAP-09's block is the long form of this sentence plus §Q6's 32 KB bound and §Q10's re-analysis bound.

**Section structure** (`page.tsx:115-131`): `{cond ? (<><h2>...</h2><ul className="notes muted">...</ul></>) : null}`. The declared/observed two-section split (§Q2) uses two of these, never interleaved.

**Note:** `page.tsx:15` still has `const TYPE_LABELS: Record<string, string> = { skill: 'Agent Skill' };` — single-entry, Phase-3 stale. Not this phase's job, but any plan touching this file will see it.

---

### `scripts/check-boundaries.mjs` (CI-enforced repo rule — CAP-10/CAP-12)

**Analog:** the file's own `SOURCE_RULES` (rule 5). Structure to copy exactly:

```javascript
const SOURCE_RULES = [
  {
    id: 'no-raw-html',
    // REN-01. Without a raw-HTML plugin, markup in a body is never parsed into
    // element nodes at all — HTML is text, not markup.
    pattern: /rehype-raw|dangerouslySetInnerHTML|allowDangerousHtml/,
    message: 'reintroduces raw HTML into the render path',
  },
  ...
];
```
Each rule is `{ id, pattern, message }` with a comment naming the requirement ID it enforces. The vocabulary rule adds `{ id: 'no-verdict-vocabulary', ... }` citing CAP-10/CAP-12.

**Comment stripping before matching** (`check-boundaries.mjs:57-70`) — mandatory, and its own docstring names the exact trap a naive version hits:
```javascript
/**
 * The `//` match deliberately refuses to fire after a `:`. A naive line-comment
 * strip eats the `//` in `https://api.github.com/...` and everything after it,
 * which would silently reduce the host rule below to matching nothing at all —
 * exactly the case it exists to catch.
 */
export function stripJsComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}
```

**File-selection + test-file exemption** (`check-boundaries.mjs`, `sourceFiles`):
```javascript
/**
 * The files rule 5 inspects. Exported so the test-file exemption is checkable:
 * it is the one part of this rule whose failure would be silent.
 */
export function sourceFiles(dir) { ... if (/\.test\.(ts|tsx)$/.test(name)) continue; ... }
```
RESEARCH §Q13 wants the vocabulary rule scoped to `src/app/**` + `src/components/**` only — that is a **narrower** scope than `sourceFiles('src')`. Follow this precedent: make the scope filter a named exported function so its narrowing is testable, because a silently-over-narrow scope is a lint that passes by inspecting nothing.

**The directory-scoped-rule precedent already exists** — `HOST_PATTERN` + `HOST_DIR = 'src/github/'` is a rule that applies everywhere *except* one directory. The vocabulary rule is its mirror (applies *only* in two directories). Same mechanism, inverted predicate.

**Zero-work-is-visible reporting** (`main()`):
```javascript
// Say what was inspected, so "0 problems" over 0 files is visible rather than
// mistaken for a pass.
console.log(`check-boundaries: ${migrationsChecked} migration file(s), package.json, ` + ...);
```
The vocabulary rule must add its own count to this line.

**Wiring:** already done. `package.json:17` — `"ci": "bun run check:boundaries && bun run lint && bun run typecheck && bun run test"`, with `check:boundaries` first. Adding a rule to `SOURCE_RULES` requires **no `package.json` change**.

**Test analog:** `scripts/check-boundaries.test.ts:1-10` imports named exports directly from the `.mjs` module and asserts on returned problem arrays:
```typescript
import { checkMigrationSql, checkPackageScripts, checkSchemaModule, checkSourceBoundaries, sourceFiles } from './check-boundaries.mjs';
// ...
expect(checkMigrationSql(GOOD)).toEqual([]);
expect(problems.join(' ')).toMatch(/does not own/);
```
Both the true-positive and the two false-positive-avoidance cases §Q13 names go here.

---

### Fixture idioms — two distinct conventions, and which fits

**Idiom A — captured corpora** at `fixtures/<slug>/{repo.json,tree.json,files/}`. Real upstream repositories frozen by `scripts/capture-fixtures.mjs`; filenames are URL-encoded paths.

Loaded by (`src/detect/skill.test.ts:23-43`):
```typescript
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
  const read = async (path: string) => { ... };
  return { entries, files, read };
}
```
Paired with **measured-count assertions** (`skill.test.ts:55-60`) — `const COUNTS: [string, number][] = [['anthropics-skills', 18], ...]` — a table of exact numbers per corpus, so a detector change that shifts a count is a visible diff.

**Idiom B — hand-written hostile inputs**, flat, in `fixtures/adversarial/` and `fixtures/xss/`. Loaded with a two-line reader:
```typescript
const DIR = 'fixtures/adversarial';                    // frontmatter.test.ts:6
function adversarial(name: string): string {           // skill.test.ts:45-47
  return readFileSync(join(ROOT, 'adversarial', name), 'utf8');
}
```
Governed by `fixtures/adversarial/README.md`, whose table is `| File | Content | Expected |` and whose rule is stated in the directory itself: *"A fixture with no assertion is storage, not a regression."*

**Which fits what in Phase 4:**

| Phase 4 need | Idiom | Why |
|---|---|---|
| CAP-13 labeled capability corpus / precision measurement | **A, reused as-is** — the four existing corpora ARE the labeled sample (§Q5 ran the pilot over them). Do not capture new corpora (RESEARCH anti-goal: "No corpus acquisition"). | The precision run is a scan over `fixtures/*/files/*`; the `corpus()` loader above already produces exactly the `Map<path, body>` a body-scanning analyzer needs. |
| CAP-13 recorded precision record (`fixtures/capability-precision.md`) | **B's README convention** | `fixtures/adversarial/README.md`'s `\| File \| Content \| Expected \|` table is the precedent; the capability version is `\| Detector \| Pattern version \| Hits \| FP \| Rate \|`, one row per detector, so a pattern change is a visible diff against a recorded number. |
| Hidden-content fixtures (CAP-06/07, QUA-05) | **B, extending the existing flat dir** | `fixtures/adversarial/bidi.md` and `unicode.md` already exist and already have README rows. Add siblings, add README rows. |
| ReDoS fixture (CAP-14) | **B, new** | Genuinely new — §Q8 confirms none of the existing 26 adversarial fixtures target analyzer ReDoS. |

**Measured-count assertion caution:** adding files to `fixtures/adversarial/` is safe (nothing iterates that directory). Adding files under `fixtures/<slug>/files/` would break `skill.test.ts`'s `COUNTS` table — so do not put capability fixtures inside a captured corpus.

---

### `src/ingest/persist.ts` (the `inserted.length > 0` gate)

**Analog:** itself. The exact lines RESEARCH §Q9 depends on (`persist.ts:152-172`):
```typescript
const inserted = await tx
  .insert(packageVersion)
  .values({ packageId: pkg.id, commitSha: scan.commitSha, /* ... */ })
  .onConflictDoNothing({ target: [packageVersion.packageId, packageVersion.contentHash] })
  .returning({ id: packageVersion.id });

newVersions += inserted.length;
```
`inserted[0].id` is available here and **only** here — a conflicted insert returns no row, so this is the sole point at which a new `package_version.id` exists. The capability insert goes immediately after, inside the same `for` loop and the same `tx`.

**Companion convention** (`persist.ts:136-138`): *"The array must name the same three columns, in the same order, as the unique('package_identity') constraint."* — the same discipline applies to any `onConflict` target for `capability_finding`.

**Transaction-boundary reasoning to preserve** (`persist.ts`, delist block): *"Same transaction as the upserts. Delisting first would leave a window in which a live package reads as delisted."* Capability findings inserted in a *later* transaction would produce a window where a version row exists with no findings and the UI would render "not detected" — a false negative that violates CAP-11's honesty. Same transaction, or the page lies.

---

## Shared Patterns

### Caps convention
**Source:** `src/detect/json.ts:1-25`, `src/detect/frontmatter.ts:3-15`, `src/detect/hook.ts:4-13`
**Apply to:** every file in `src/analyze/`
Exported `const X_CAPS = {...} as const`, one JSDoc block per number, each naming its measurement and what it does *not* protect against.

### Purity-provable-by-arity
**Source:** `src/detect/types.ts` (`Detector.match` doc), asserted at `src/detect/run.test.ts:224` — `for (const d of DETECTORS) expect(d.match).toHaveLength(1);`
**Apply to:** every analyzer function and its test file
A one-parameter pure function cannot reach a database or a network. Assert the arity; it is the cheapest structural proof in the codebase.

### Error isolation via try/catch returning a result, never throwing
**Source:** `src/detect/run.ts:23-31, 60-74`
**Apply to:** `src/analyze/run.ts` — more critical here than in Phase 3, because analysis runs inside the persist transaction.

### Comment-as-rationale
**Source:** universally — `plugin.ts:15-27` (threshold), `schema.ts:183-188` (absent column), `frontmatter.ts:72` ("The input cap above does NOT protect this"), `JobPanel.tsx:88-90` (absent UI element)
**Apply to:** every file
This codebase records *why a number is that number* and *why an absent thing is absent*. A plan producing code without these comments will read as foreign. Every RESEARCH measurement (5% FP, 248 scripts, 65 URLs, 0 `allowed-tools` hits) belongs in a code comment at the point it justifies.

### React escapes JSX text; no second sanitizer
**Source:** `src/components/JobPanel.tsx:83` (`<p className="error">{attempt.errorDetail}</p>`)
**Apply to:** both new panels. Mechanically guarded by `check-boundaries.mjs` `no-raw-html`.

### Absence renders as an honest negative string
**Source:** `src/app/r/[owner]/[repo]/[...path]/page.tsx:78-86` (`?? 'not declared'` / `?? 'not detected'`)
**Apply to:** CAP-02, CAP-11 everywhere.

### Query modules: `cache()` + explicit projection + `@/` alias
**Source:** `src/db/queries/packages.ts:18-22`
**Apply to:** `src/db/queries/capabilities.ts`

---

## No Analog Found

Reported honestly, per the prompt. The planner must use RESEARCH.md patterns for these — there is no precedent to copy.

| File / concern | Role | Data Flow | Reason |
|---|---|---|---|
| Line-offset / line-number computation | utility | transform | **This codebase has never computed a line number.** Grep over all of `src/` and `scripts/` for `split('\n')`, `lineNumber`, `#L` returns **zero** hits. Every "line" reference in the source is prose in a comment. `frontmatter.ts`'s `FENCE` regex is the only line-structure-aware code and it counts nothing. RESEARCH §Q6 is therefore the *entire* specification: `body.split('\n')` (never `\r\n`), 1-indexed, `body` is the whole file so no frontmatter offset arithmetic. The BOM/CRLF/truncation facts in §Q6 are freshly established there, not inherited. **The `MAX_BODY` / raw-byte concern the prompt flags is real and unprecedented:** `body` is `source.slice(0, MAX_BODY)` on UTF-16 code units (§Q6, A1), while GitHub's `#L<n>` refers to lines of the raw file — these agree for every line that survives the cut (truncation only removes trailing content) and there is *no existing code that reconciles them* because none has ever needed to. |
| Storing a finding (`capability_finding` rows) | model | CRUD | **No finding has ever been stored.** Every existing child row is either an artifact (`package_version`), a seed (`repo_seed`), or an operational record (`ingest_job`, `ingest_attempt`). The closest structural analog is `repoSeed` (a many-per-parent, jsonb-carrying, additive table) — copy its *shape*, but there is no precedent for a row that represents a probabilistic observation about content, and therefore no precedent for the `detector` audit-trail column or the `maxFindings` volume cap. |
| Rendering a source excerpt with a line anchor | component | request-response | **Never done.** `SkillBody` renders a whole body as Markdown; nothing renders a fragment, and nothing renders a line-anchored link. `permalink()` exists but has never had a fragment appended. `page.tsx:143` (`<code>{i.text}</code>`) is the only precedent for rendering a short literal string in a code element. |
| CAP-13 precision measurement as a process artifact | process/tooling | — | No committed measurement record exists. `fixtures/adversarial/README.md`'s table is the closest *format* precedent, and `plugin.ts:27` forward-references the practice ("Recorded as a false-positive rate against a labeled corpus in Phase 4 (CAP-13)"), but no such record has ever been written and there is no script that produces one. Whether the measurement is a committed script or a hand-run grep transcript is an open design decision with no precedent to lean on. |

---

## Metadata

**Analog search scope:** `src/detect/`, `src/db/`, `src/db/queries/`, `src/github/`, `src/ingest/`, `src/components/`, `src/app/r/`, `scripts/`, `drizzle/`, `fixtures/`
**Files read this session:** `src/detect/{run,hook,json,frontmatter,plugin,types}.ts`, `src/detect/{run,skill}.test.ts`, `src/db/schema.ts` (130-260), `src/db/queries/packages.ts`, `src/github/{tree,types}.ts`, `src/ingest/{persist,pipeline}.ts` (excerpts), `src/components/{SkillBody,JobPanel}.tsx`, `src/components/SkillBody.test.tsx`, `src/app/r/[owner]/[repo]/[...path]/page.tsx`, `scripts/{check-boundaries.mjs,check-boundaries.test.ts,migrate.mjs}`, `drizzle/000{3,4}_*.sql`, `fixtures/adversarial/README.md`, `package.json`
**Pattern extraction date:** 2026-08-11
