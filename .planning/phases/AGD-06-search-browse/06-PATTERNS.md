# Phase 6: Search & Browse - Pattern Map

**Mapped:** 2026-08-12
**Files analyzed:** 7 (grouped from CONTEXT.md/RESEARCH.md's stated file list)
**Analogs found:** 6 / 7 (1 explicit NO ANALOG — client components)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/db/queries/search.ts` (new) | service (query module) | CRUD (read, ranked) | `src/db/queries/packages.ts` | exact |
| `src/db/queries/search.test.ts` (new) | test | request-response (DB-backed) | `src/db/queries/packages.test.ts` | exact |
| `src/app/artifacts/page.tsx` (new, replaces `skills/page.tsx`) | route (server component) | request-response | `src/app/skills/page.tsx` | exact |
| `src/app/r/[owner]/[repo]/[...path]/page.tsx` (modified) | route (server component) | request-response | itself (generalize in place) | exact — same file |
| `src/db/queries/packages.ts` (`sourcePathFromUrl`, `detailHref` modified) | service | CRUD | itself | exact — same file |
| `drizzle/000X_*.sql` + `src/db/schema.ts` (new migration + index decls) | migration/config | batch (DDL) | `drizzle/0005_rainy_saracen.sql` + `src/db/schema.ts` index blocks | exact |
| `src/log.ts` (`SearchLog` union member) | utility (structured log) | event-driven | `src/log.ts`'s existing `IngestLog`/`WorkerLog` | exact — same file |
| Client component(s) for search input/filters | component | request-response (progressive enhancement) | `src/components/SubmitForm.tsx` | role-match (only client component in repo) — see "No Analog Found" |

## Pattern Assignments

### `src/db/queries/search.ts` (service, CRUD)

**Analog:** `src/db/queries/packages.ts` (`listPackages`/`countPackages`, lines 1-238)

**Imports pattern** (`packages.ts:1-6`):
```typescript
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { cache } from 'react';
import type { FileEntry } from '@/analyze/types';
import { db } from '@/db/client';
import { packageTable, packageVersion, repository } from '@/db/schema';
import { CAPS } from '@/github/scan';
```
`search.ts` should mirror this: import `NOT_LISTED_BECAUSE`'s governing predicate (export it from
`packages.ts` or export a helper that returns the same `sql` fragment object) rather than
re-deriving fork/duplicate/unparsed logic — RESEARCH.md's Pattern 1 names this explicitly.

**`react.cache` wrapper pattern** (`packages.ts:164-177`):
```typescript
export const listPackages = cache(
  async ({ limit = 25, offset = 0, fullName, listingOnly = true }: {...} = {}): Promise<PackageListItem[]> =>
    db.select({...}).from(packageTable).innerJoin(repository, ...).where(...).orderBy(...).limit(limit).offset(offset),
);
```
Copy this shape for `searchPackages`/`countSearchResults`: one arrow function directly wrapped in
`cache()`, defaults on a single options object, no separate un-cached implementation.

**Reuse-not-restate discipline** (`packages.ts:203-208`, comment quoted in full because it is the
load-bearing rule):
```typescript
// The same fragment object as the projection above. Drizzle SQL values
// are immutable descriptors, so referencing one twice is safe — and
// asserted, because a fragment that consumed its bindings on first use
// would make the projection and the predicate disagree, which is the
// one bug here that produces a plausible-looking wrong answer.
listingOnly ? sql`${NOT_LISTED_BECAUSE} is null` : undefined,
```
`search.ts` MUST reference the identical `NOT_LISTED_BECAUSE` object in both `SELECT` and `WHERE`
(never a hand-copied second `CASE`) and must include it in `WHERE`, not only `SELECT` — RESEARCH.md
measured a 31x slowdown (1259ms vs 37ms) when this predicate is computed in `SELECT` only.

**Correlated-subquery-not-lateral-join pattern** (`packages.ts:188-194`, for "latest version"
lookups the capability filter needs):
```typescript
commitSha: sql<string | null>`(
  select pv.commit_sha from ${packageVersion} pv
  where pv.package_id = ${packageTable.id}
  order by pv.ingested_at desc limit 1
)`,
```
Use the same correlated-subquery idiom (not a lateral join) for the DIS-06 "latest version"
capability-finding exclusions.

**Error handling / query safety:** no analog exists in `packages.ts` because it never takes
user-controlled query text. RESEARCH.md's own Code Examples section supplies the load-bearing
`websearch_to_tsquery`/empty-query-branch pattern (already spike-verified) — follow that directly,
there is no closer in-repo analog for this part.

---

### `src/db/queries/search.test.ts` (test, DB-backed request-response)

**Analog:** `src/db/queries/packages.test.ts` (lines 1-50 read; full file establishes the suite)

**Skip-if-no-DB pattern** (`packages.test.ts:1-13`):
```typescript
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

process.env.DATABASE_SCHEMA = 'agentdock_test';
const DB_URL = process.env.DATABASE_URL;
const PREFIX = 'test-owner/listing-spec';

describe.skipIf(!DB_URL)('the listing queries', () => {
  ...
});
```
`search.test.ts` needs its **own distinct prefix** (not `test-owner/listing-spec` — the comment at
`packages.test.ts:10-13` explains vitest runs test files in parallel against one schema, so a
borrowed prefix collides). Use e.g. `test-owner/search-spec`.

**Fixture setup/teardown pattern** (`packages.test.ts:29-49`):
```typescript
async function clean() {
  await sql`DELETE FROM package_version WHERE package_id IN (
    SELECT p.id FROM package p JOIN repository r ON r.id = p.repository_id
    WHERE r.full_name LIKE ${`${PREFIX}%`}
  )`;
  await sql`DELETE FROM package WHERE repository_id IN (
    SELECT id FROM repository WHERE full_name LIKE ${`${PREFIX}%`}
  )`;
  await sql`DELETE FROM repository WHERE full_name LIKE ${`${PREFIX}%`}`;
}

beforeAll(async () => {
  packages = await import('./packages');
  ({ sql } = await import('@/db/client'));
  await clean();
});

afterAll(async () => {
  await clean();
  await sql.end();
});
```
Copy this exact clean-before/clean-after/close-connection shape. `search.test.ts` additionally
must NOT insert an `ingest_job` row — same warning as `packages.test.ts:21-23` (`claimJob` takes
the oldest claimable row schema-wide; a stray queued row makes `jobs.test.ts` flaky).

**Extend, don't duplicate:** RESEARCH.md's Wave-0 gap list also calls for extending
`packages.test.ts` itself with new cases for the fixed `sourcePathFromUrl`/`detailHref` (all six
types) — that is a modification to the existing file, following its existing `describe.skipIf`
block structure, not a new file.

---

### `src/app/artifacts/page.tsx` (route, request-response, SSR)

**Analog:** `src/app/skills/page.tsx` (full file, 79 lines)

**Bounded zod coercion pattern** (`skills/page.tsx:14-18`):
```typescript
/**
 * Coerced through a bounded schema with a fallback, never through Number().
 * A repeated query parameter arrives as an array, and Number(['1','2']) is NaN —
 * which reaches the query as an offset that silently returns nothing.
 */
const pageParam = z.coerce.number().int().min(1).max(10_000).catch(1);
```
Extend this same idiom for `q` (string, trimmed, length-capped) and `type` (enum-ish, `.catch()`
to a safe default) — do not invent a different validation approach for the two new params.

**Async searchParams + force-dynamic pattern** (`skills/page.tsx:1-27`):
```typescript
import Link from 'next/link';
import { z } from 'zod';
import { PackageRows } from '@/components/PackageRows';
import { countPackages, listPackages } from '@/db/queries/packages';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Skills — AgentDock' };
const PAGE_SIZE = 25;

export default async function SkillsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const page = pageParam.parse((await searchParams).page);
  const offset = (page - 1) * PAGE_SIZE;
  const [packages, total] = await Promise.all([
    listPackages({ limit: PAGE_SIZE, offset }),
    countPackages(),
  ]);
  ...
}
```
`artifacts/page.tsx` copies this shape verbatim, swapping `listPackages`/`countPackages` for the
new `searchPackages`/`countSearchResults` and adding `q`/`type` params to the `Promise.all` inputs.

**Zero-row and past-the-end-page branches** (`skills/page.tsx:37-60`) — copy both distinct empty
states (no packages at all vs. a page past the end) rather than collapsing them into one message;
D-38 needs a third distinct branch (zero *search* results, as opposed to zero corpus) added
alongside these two.

**Pager markup pattern** (`skills/page.tsx:69-75`):
```tsx
<p className="pager">
  {page > 1 ? <Link href={`/skills?page=${page - 1}`}>← Previous</Link> : null}
  {page < last ? <Link href={`/skills?page=${page + 1}`}>Next →</Link> : null}
  <span className="muted">Page {page} of {last}</span>
</p>
```
Reuse verbatim; the new route's links must additionally carry `q`/`type` through
(`/artifacts?q=...&type=...&page=${page+1}`) so pagination doesn't drop search state — this is
D-35/D-36's own requirement, not a stylistic choice.

**Rename mechanics:** RESEARCH.md's own recommendation for the `/skills` → `/artifacts` redirect
is Next.js `redirects()` in `next.config.ts` (same config-API family already used there for
`headers()`), with a thin `redirect('/artifacts')` page as fallback if that doesn't fit — no closer
in-repo analog exists for a route rename since this project has never renamed a route before.

---

### `src/app/r/[owner]/[repo]/[...path]/page.tsx` (route, generalize in place)

**Analog:** itself — this file's `getPackageDetail`/`sourcePathFromUrl` call chain is being fixed,
not replaced by a new file.

**What to imitate unchanged:**
- `permalink`/`permalinkAtLine` calls (lines 84, 214-216, 221-223) — pure, type-independent
  already, D-23 requires zero change here.
- The `CapabilityPanel`/`HiddenContentPanel` composition (lines 211-224) — type-independent
  already.
- The disclaimer/vocabulary constants (`FILE_DISCLAIMER`, `CAPABILITY_INTRO`,
  `CAPABILITY_NOT_CHECKED`, lines 27-55) — reuse verbatim; D-25 asks to *remove* Skill-only
  wording, not touch this vocabulary.

**What must change, with the exact current bug quoted:**
```typescript
const TYPE_LABELS: Record<string, string> = { skill: 'Agent Skill' };
```
(line 19) — needs the other five labels from `artifact_type.label` (D-22/D-25).

**Type-specific section gating (D-22, D-24):** the existing `detail.parseErrors.length > 0` /
`detail.files.length > 0` conditional-render pattern (lines 160-169, 183-209) is the analog to
copy for any new type-specific section — render nothing when the data is absent, never an empty
placeholder section. The "Install" section (lines 234-248) is explicitly skill-shaped
(`.claude/skills/${slug}/`) and must be gated to `detail.type === 'skill'` once other types render
through this route; there is no existing per-type conditional in this file today, so this is a new
pattern to introduce, modeled on the files/parseErrors gating already present.

**The actual fix location:** `src/db/queries/packages.ts:268-280` — `sourcePathFromUrl` and
`detailHref`, quoted in RESEARCH.md's Generic Detail Route section. Apply the literal-match-first,
`/SKILL.md`-fallback-second query and the type-aware `detailHref` exactly as RESEARCH.md specifies
(recommendation section, item 1-2); do not reintroduce type-specific suffix reconstruction.

---

### Migration: tsvector generated column + GIN indexes

**Analog:** `drizzle/0005_rainy_saracen.sql` (most recent migration, full file) + `src/db/schema.ts`
index declaration blocks (`repository`, `packageTable`, `capabilityFinding` table definitions)

**Migration file shape** (`0005_rainy_saracen.sql`, verbatim structure):
```sql
CREATE TABLE "agentdock"."capability_finding" (
	"id" bigserial PRIMARY KEY NOT NULL,
	...
	CONSTRAINT "capability_finding_identity" UNIQUE(...)
);
--> statement-breakpoint
ALTER TABLE "agentdock"."package" ADD COLUMN "files" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agentdock"."package_version" ADD COLUMN "analyzed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agentdock"."capability_finding" ADD CONSTRAINT "..._fk" FOREIGN KEY (...) REFERENCES ...;--> statement-breakpoint
CREATE INDEX "capability_finding_version_idx" ON "agentdock"."capability_finding" USING btree ("package_version_id");
```
Additive-only, schema-qualified `"agentdock"."table"` on every statement, `--> statement-breakpoint`
between each — copy this exactly. The new migration must be **generated** via `drizzle-kit
generate` from a schema.ts change (per D-49's "generate → review → migrate"), not hand-written from
scratch, but the reviewed output should match this file's conventions.

**Schema index declaration pattern** (`schema.ts:107-156`, table + index block shape):
```typescript
export const packageTable = agentdock.table(
  'package',
  { ... },
  (t) => [
    unique('package_identity').on(t.repositoryId, t.type, t.sourcePath),
    index('package_live_idx').on(t.type, t.updatedAt.desc()),
  ],
);
```
The new `search_vector` generated column and its GIN index follow this same `(t) => [...]` index
array shape. For the trigram index specifically, RESEARCH.md's own spike-verified syntax is the
concrete pattern to use (not found elsewhere in this repo since no trigram index exists yet):
```typescript
index('package_name_trgm_idx').using('gin', sql`${t.name} agentdock.gin_trgm_ops`)
```
And the pre-flight guard as the migration's first statement (RESEARCH.md, spike-verified, not
found in any existing migration since this is the first extension-dependent one):
```sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    RAISE EXCEPTION 'pg_trgm extension is not installed. Ask a superuser to run: CREATE EXTENSION pg_trgm SCHEMA agentdock;';
  END IF;
END $$;
```

**Comment-as-decision-record pattern** (`schema.ts:159-160`, load-bearing precedent this migration
directly reverses): a comment there currently states *"No search_tsv column and no pg_trgm index
in this phase..."* — this exact comment must be removed/updated when the column ships, since
leaving it in place would contradict the new schema.

---

### `src/log.ts` — `SearchLog` union member (utility, event-driven)

**Analog:** same file's `IngestLog`/`WorkerLog` (lines 3-56) and the `log()` function itself
(lines 58-67)

**Closed-union-type pattern** (`log.ts:58-67`, comment quoted in full — it is the governing rule):
```typescript
/**
 * One line, one shape. The field set is closed on purpose: a free-form payload
 * parameter is how a response body, a header, or a connection string ends up in
 * a log file six months from now. Every field here is a number, a boolean, a
 * nullable string with a documented provenance, or a closed union — there is no
 * key an arbitrary object could be assigned to.
 */
export function log(entry: IngestLog | WorkerLog): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...entry }));
}
```
Add `SearchLog` as a third closed-union member (`type SearchLog = { event: 'search'; query: string;
filters: {...}; resultCount: number; durationMs: number }`) and widen the `log()` signature to
`IngestLog | WorkerLog | SearchLog` — do not add a new logging function or file. Follow
`IngestLog`'s "emit zero explicitly, not an optional field" discipline (`log.ts:31-37`'s
`seedsSkipped` comment) for `resultCount` when it is legitimately zero, so the log line can't be
misread as "field not yet implemented."

**No existing test file for `log.ts`.** RESEARCH.md's Wave-0 gap list calls this out explicitly —
a new small `src/log.test.ts` is proportionate; there is no analog test to imitate, write the
simplest shape-assertion test (call `log()`, capture `console.log`, assert the JSON keys match the
closed union).

---

### Interactive client components (search input / filters)

**NO ANALOG — explicit finding for the planner.**

`src/components/SubmitForm.tsx` is the only client component in the entire project. Its own doc
comment says so verbatim (`SubmitForm.tsx:9-12`):
```tsx
'use client';
...
/**
 * The only client component in the project, and it holds no data — only the
 * pending flag. Without JavaScript the form still submits and the server still
 * re-renders with the result.
 */
export function SubmitForm() {
  const [state, action, pending] = useActionState(submitRepo, initial);
  return (
    <form action={action} className="submit">
      ...
    </form>
  );
}
```
Its pattern — a form whose real state lives server-side (URL params for search, not a server
action) and whose client half holds only ephemeral UI state (`pending`) — is the right shape to
imitate structurally, but D-35/D-36 make the actual mechanism different: search state must live in
the URL, not in `useActionState`. A search box should be a plain `<form method="get">` posting to
the same route (no JS required, matches SubmitForm's progressive-enhancement principle) with `q`
as a named input; type/capability filter controls can likewise be plain links or a native
`<select>` inside a GET form, needing no client component at all per D-35/D-36 ("only genuinely
interactive controls are client components"). **Establish this convention:** default to
server-rendered `<form method="get">` + native controls; reach for `'use client'` only if a control
needs interaction a GET form cannot express (e.g., debounced live-filtering), which no D-item in
CONTEXT.md currently requires.

## Shared Patterns

### Listing-predicate reuse (D-32)
**Source:** `src/db/queries/packages.ts:127-149` (`NOT_LISTED_BECAUSE`), `164-214` (`listPackages`)
**Apply to:** `search.ts`'s new query function — same `sql` fragment object in both `SELECT` and
`WHERE`, never restated.

### `react.cache` wrapper
**Source:** `src/db/queries/packages.ts:164,226`
**Apply to:** every new exported query function in `search.ts`.

### Bounded zod coercion for URL params
**Source:** `src/app/skills/page.tsx:18`
**Apply to:** `q`, `type`, `page` in `artifacts/page.tsx`.

### `force-dynamic` + async `searchParams`/`params`
**Source:** `src/app/skills/page.tsx:7,25`; `src/app/r/[owner]/[repo]/[...path]/page.tsx:13,17`
**Apply to:** `artifacts/page.tsx` (new) and the existing detail route (unchanged, already present).

### Closed-union structured logging
**Source:** `src/log.ts:58-67`
**Apply to:** the new `SearchLog` member for DIS-08.

### Schema-qualified `agentdock.table(...)` + `(t) => [index(...), unique(...)]`
**Source:** `src/db/schema.ts:107-156`
**Apply to:** the new `search_vector` column and its GIN/trigram indexes.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| Client component for search input/filters | component | request-response | Only one client component exists in the whole project (`SubmitForm.tsx`), and its mechanism (server action + `useActionState`) does not fit URL-is-state search per D-35/D-36. Recommend establishing a new, simpler convention: plain `<form method="get">` + native controls, no `'use client'`, unless a specific control genuinely needs it (none currently required). |
| `websearch_to_tsquery` query-safety wrapper in `search.ts` | service (validation) | request-response | No prior code in this repo touches user-controlled full-text search input at all; RESEARCH.md's own spike-verified SQL (Code Examples section) is the closest thing to an analog and should be followed directly. |

## Metadata

**Analog search scope:** `src/db/queries/`, `src/app/`, `src/components/`, `src/db/schema.ts`,
`drizzle/`, `src/log.ts`
**Files read in full or targeted ranges:** `packages.ts`, `packages.test.ts` (partial),
`skills/page.tsx`, `r/[owner]/[repo]/[...path]/page.tsx`, `SubmitForm.tsx`, `log.ts`,
`schema.ts` (grep for index/unique/table), `drizzle/0005_rainy_saracen.sql`
**Pattern extraction date:** 2026-08-12
