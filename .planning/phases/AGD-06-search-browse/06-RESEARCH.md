# Phase 6: Search & Browse - Research

**Researched:** 2026-08-12
**Domain:** PostgreSQL full-text search + trigram fallback, Next.js 16 App Router SSR, generic artifact detail routing
**Confidence:** HIGH — every claim below is either `[VERIFIED: file:line]` with a verbatim quote, `[VERIFIED: live SQL]` with the actual command and output, or explicitly `[ASSUMED]`/`[UNVERIFIED]`.

## Summary

The corpus is real and already measured: **1,137 packages, 921 listed, 16 repositories, six
artifact types** `[VERIFIED: live psql, 2026-08-12]`. No search code exists. The listing
predicate that must be reused (`NOT_LISTED_BECAUSE`) already lives in
`src/db/queries/packages.ts:127-149` and is proven correct and fast (~40ms at any offset,
verified fresh in this session). The riskiest item in the phase — the generic detail route —
turned out to have a precise, narrow fix: `sourcePathFromUrl` (`packages.ts:268-274`)
unconditionally appends `/SKILL.md` to whatever URL segments it receives, so every non-skill
detail link 404s today. Live data shows `source_path` is *already* the literal, disambiguating
value for every type (no `(repository_id, source_path)` collisions across types exist in the
corpus), so the fix is to stop reconstructing a path and instead try an exact match first, with
the `/SKILL.md` suffix only as a second, skill-only fallback for backward compatibility.

The FTS design has one load-bearing discovery that changes the generated-column expression:
**`to_tsvector` treats a whole slash-delimited path as a single lexeme** — `'servers/mcp/index.ts'`
never matches a search for `mcp` unless the path is pre-split on `/` and `.` before tokenizing
(`[VERIFIED: live SQL]` below). A second discovery changes the column design itself: **Postgres
generated columns cannot reference another table**, confirmed by a live `ERROR: cannot use
subquery in column generation expression` — so `repository.full_name` cannot be folded into a
`package`-scoped generated `tsvector` column; it must be matched separately at query time (cheap,
16 rows). The trigram index syntax that the maintainer's locked out-of-band `pg_trgm` install
requires (`agentdock.gin_trgm_ops`) was spike-tested against this exact project's pinned
`drizzle-kit@0.31.10` and confirmed to emit correct schema-qualified DDL.

Query safety has a clean, load-bearing answer from live testing: `to_tsquery` throws a syntax
error on hostile input (confirmed with 5 different adversarial strings); `plainto_tsquery`,
`phraseto_tsquery`, and `websearch_to_tsquery` never do, on any tested input including SQL
injection strings, unclosed parens, emoji, Korean text, and a 5,000-character string. Benchmarks
against the live corpus show the current listing query holds ~40ms at any page depth, so **offset
pagination needs no keyset alternative at this scale** — a direct, measured answer to D-37.

**Primary recommendation:** Build a `package`-scoped generated `tsvector` STORED column
(`setweight` A=name, B=summary, C=path-with-separators-replaced-by-spaces, D=type), GIN-indexed,
queried with `websearch_to_tsquery`; add a repository-name match as a separate, un-weighted OR
condition (16 rows, no index needed); fall back to `agentdock.gin_trgm_ops` similarity search only
when FTS returns zero rows; fix `sourcePathFromUrl`/`detailHref` to do a literal-first,
`/SKILL.md`-fallback-second lookup with no other type-specific reconstruction; keep offset
pagination; log structured JSON lines through the existing `log()` function in `src/log.ts`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Full-text search & ranking | Database (PostgreSQL FTS) | API/Backend (server component query fn) | `[VERIFIED]` D-01/D-10 lock PostgreSQL as the only search engine; no app-layer scoring |
| Trigram typo fallback | Database (`pg_trgm`) | API/Backend (fallback trigger logic) | Same locked constraint; fallback *decision* (when to invoke) is a backend concern, the *match* is DB-native |
| Query safety/parsing | API/Backend (server component, before DB call) | Database (`websearch_to_tsquery` itself never throws) | D-40 requires parameterized queries and no raw SQL; both layers cooperate |
| Filters (type, capability) | Database (SQL predicates) | Frontend Server (SSR renders selected state from URL) | D-30: all filtering in SQL, never client-side |
| URL state (`q`, `type`, `page`) | Frontend Server (SSR reads `searchParams`) | Browser (address bar, back/forward) | D-35/D-36: SSR reads URL, no client-only React state |
| Generic detail route resolution | API/Backend (`getPackageDetail` lookup logic) | — | D-20/D-21: identity resolution is a query-layer fix, not a rendering fix |
| Query/result-count logging | API/Backend (`log()` in `src/log.ts`) | — | D-44; reuses existing structured-log pattern, no DB table |
| Zero-result UX | Frontend Server (SSR renders next-step copy) | — | D-38/D-39: presentation concern once the DB returns 0 rows |

## Package Legitimacy Audit

**Not applicable — this phase installs no new npm package.** D-01 locks PostgreSQL as the only
search engine; D-04 forbids AgentDock from ever running `CREATE EXTENSION` itself. The only new
external dependency is the `pg_trgm` PostgreSQL extension, which is not an npm package and is
installed out-of-band by the maintainer as superuser (D-03, already applied per the task's
pre-measured facts — see `agentdock_app` cannot `CREATE`, confirmed again live below). No
`package.json` change is expected for this phase. `[VERIFIED: package.json read this session —
no search-related dependency present; dependencies are drizzle-orm, js-yaml, next, postgres,
react, react-dom, react-markdown, rehype-sanitize, remark-gfm, zod]`

## Existing Code Baseline (read in full this session)

### `src/db/queries/packages.ts`

- **`NOT_LISTED_BECAUSE`** (`packages.ts:127-149`) is one `CASE` expression computing fork /
  duplicate / unparsed exclusion, quoted in full below because every word of it is load-bearing
  for how the search predicate must be written:

  ```sql
  case
    when repository.is_fork then 'fork'
    when latestVersion(parse_status) = 'failed' then 'unparsed'
    when package.meta->>'detectionConfidence' is distinct from 'shape-only'
     and exists ( ... content_hash-driven duplicate check ... ) then 'duplicate'
    else null
  end
  ```
  `[VERIFIED: src/db/queries/packages.ts:127-149]`

- **`listPackages`** (`packages.ts:164-214`) applies this same SQL fragment object *twice* —
  once in the `SELECT` projection (as `notListedBecause`), once in the `WHERE` clause
  (`listingOnly ? sql\`${NOT_LISTED_BECAUSE} is null\` : undefined`) — deliberately the same
  Drizzle fragment reference so projection and predicate cannot silently disagree
  (`packages.ts:203-208`, comment: *"referencing one twice is safe... the one bug here that
  produces a plausible-looking wrong answer"*). **The search query must follow the identical
  discipline**: never write a second, hand-rolled copy of this predicate.

- **`countPackages`** (`packages.ts:226-238`) — same predicate, count-only. Search's `countXxx`
  equivalent must reuse it, not restate it (D-32).

- **`sourcePathFromUrl`** (`packages.ts:268-274`), quoted verbatim:
  ```ts
  export function sourcePathFromUrl(segments: string[]): string {
    const joined = segments.join('/');
    if (joined === 'SKILL.md') return joined;
    return joined.length > 0 ? `${joined}/SKILL.md` : 'SKILL.md';
  }
  ```
  `[VERIFIED: src/db/queries/packages.ts:268-274]` — this **unconditionally appends
  `/SKILL.md`** to any non-empty, non-`'SKILL.md'` segment join. See the "Generic Detail Route"
  section below for the exact live-data proof of what this breaks and the fix.

- **`detailHref`** (`packages.ts:277-280`), quoted verbatim:
  ```ts
  export function detailHref(fullName: string, sourcePath: string): string {
    const dir = sourcePath.replace(/(^|\/)SKILL\.md$/, '');
    return `/r/${fullName}/${dir === '' ? 'SKILL.md' : dir}`;
  }
  ```
  `[VERIFIED: src/db/queries/packages.ts:277-280]` — takes no `type` argument today; only
  strips a `SKILL.md` suffix (a no-op for every other type's `source_path`, since none of them
  end in that literal string).

- **`getPackageDetail`** (`packages.ts:376-421`) filters on
  `isNull(delistedAt), lower(fullName) = ..., eq(sourcePath, sourcePathFromUrl(segments))` —
  **no `type` predicate today** `[VERIFIED: packages.ts:409-415]`. This matters: the existing
  code already resolves purely on `(repository, sourcePath)`, so the generic-route fix does not
  need to introduce a `type` filter to stay correct — it needs to stop mis-reconstructing
  `sourcePath`.

- **`permalink`/`permalinkAtLine`** (`packages.ts:241-259`) build
  `https://github.com/{fullName}/blob/{commitSha}/{sourcePath}` — pure functions of already-typed
  data, type-independent already. No change needed; reuse unchanged (D-23).

- **`getRepositoryPackages`** (`packages.ts:325-343`) calls `listPackages({ fullName, limit:
  CAPS.maxFiles, listingOnly: false })` — the direct-access path COR-07 depends on. Confirmed
  bypass-free; do not route it through the new search predicate.

### `src/db/queries/capabilities.ts`

- `getCapabilityFindings` (`capabilities.ts:29-47`) selects by `packageVersionId`, ordered by
  `startLine`, capped at `ANALYZE_CAPS.maxFindingsPerDetector * ANALYZERS.length`.
  `[VERIFIED: capabilities.ts:29-47]` — the DIS-06 filter must key off the same
  `package_version_id` (the *latest* version, matching `listPackages`' own `latestVersion()`
  pattern), not `package_id` directly, since `capability_finding` has no FK to `package`.

### `src/db/schema.ts`

- `package` table: identity is `unique('package_identity').on(repositoryId, type, sourcePath)`
  and the only existing index is `index('package_live_idx').on(type, updatedAt.desc())`.
  `[VERIFIED: schema.ts:107-158]` A comment at line 159-160 states explicitly: *"No
  search_tsv column and no pg_trgm index in this phase: pg_trgm is not installed in this
  instance and must not be installed here."* — confirms no prior search scaffolding exists and
  the schema module itself already documents this phase's constraint.
- `package_version`: `parseStatus` comment says `// ok | partial | failed` (`schema.ts:181`);
  `analyzedAt` is the CAP-11 "we looked" marker (`schema.ts:184-193`); index
  `package_version_recent_idx` on `(packageId, ingestedAt.desc())` (`schema.ts:199`) — this is
  the index every "latest version" correlated subquery already uses (confirmed by `EXPLAIN`
  below: `Index Scan using package_version_recent_idx`).
- `capability_finding`: `category` column comment (`schema.ts:228-230`) quoted verbatim:
  *"declared | remote_execution | package_install | network_request | external_reference |
  hidden_content"* — six categories, text not enum (widening a CHECK on a populated table is a
  destructive DROP CONSTRAINT per this project's boundary scanner). `[VERIFIED: schema.ts:218-271]`
- `artifactType`: seeded with exactly six rows, confirmed live (see below).

### `src/log.ts` — the structured-logging precedent for DIS-08

`log()` (`log.ts:65-67`) is a closed-union `console.log(JSON.stringify({ ts, ...entry }))`
function. Comment quoted verbatim: *"The field set is closed on purpose: a free-form payload
parameter is how a response body, a header, or a connection string ends up in a log file six
months from now."* `[VERIFIED: src/log.ts:58-67]` DIS-08's query log should add a third closed
union member (`SearchLog`) to this same file, following `IngestLog`/`WorkerLog`'s exact shape —
not a new logging library, not a DB table.

### `src/app/skills/page.tsx`, `src/app/r/[owner]/[repo]/page.tsx`, `src/app/r/[owner]/[repo]/[...path]/page.tsx`

- All three use `export const dynamic = 'force-dynamic'` and
  `searchParams: Promise<Record<string, string | string[] | undefined>>` /
  `params: Promise<{...}>` — confirming Next.js 16.3.0's async `searchParams`/`params` API is
  already this codebase's established pattern `[VERIFIED: skills/page.tsx:7,25;
  r/[owner]/[repo]/[...path]/page.tsx:13,17,61-62,74-76]`. The new `/artifacts` route must follow
  the identical shape.
- `skills/page.tsx:18` already has the exact bounded-coercion pattern D-41 needs:
  ```ts
  const pageParam = z.coerce.number().int().min(1).max(10_000).catch(1);
  ```
  `[VERIFIED: src/app/skills/page.tsx:18]` — reuse this pattern for `q`, `type`, and `page`
  validation; do not invent a new validation idiom.
- `PackageRows.tsx` (`src/components/PackageRows.tsx:21`) calls
  `detailHref(p.fullName, p.sourcePath)` — **no `type` argument today**
  `[VERIFIED: src/components/PackageRows.tsx:1-21]`. If `detailHref` becomes type-aware (see
  below), this call site and its `PackageListItem` type need a `type` field threaded through —
  already present on `PackageListItem` (`packages.ts:11-23`), so no query change, only a
  plumbing change.

### `src/db/client.ts`

`assertSchemaIsolation` (`client.ts:26-45`) enforces `search_path` matches exactly
`^agentdock(_test)?$` and pins `connection: { search_path: AGENTDOCK_SCHEMA }`
`[VERIFIED: client.ts:9-45]`. Consequence for the trigram index: because D-03's exact install
command is `CREATE EXTENSION pg_trgm SCHEMA agentdock;`, the extension's operator classes live
*inside* the one schema already on `search_path` — an unqualified `gin_trgm_ops` would in fact
resolve. D-04 still requires explicit `agentdock.gin_trgm_ops` qualification in migrations as
defense in depth (matches this project's everywhere-schema-qualified convention).

### `scripts/check-boundaries.mjs`

The `DESTRUCTIVE` regex (`check-boundaries.mjs:36`), quoted:
```
/\b(DROP|TRUNCATE|GRANT|REVOKE|CREATE\s+ROLE|ALTER\s+ROLE|CREATE\s+SCHEMA|ALTER\s+SCHEMA|CREATE\s+EXTENSION|CREATE\s+DATABASE)\b/i
```
`[VERIFIED: scripts/check-boundaries.mjs:36]` — `CREATE EXTENSION` is one of six patterns this
rule flags, but only requires a `agentdock:reviewed-destructive` marker comment to pass; it does
**not** hard-forbid the statement. **D-04 is strictly stricter than the general boundary
scanner** — no marker makes `CREATE EXTENSION` acceptable in an AgentDock migration; the phase
must never emit that statement at all, marker or not.

### `scripts/migrate.mjs`

Applies every migration's statements inside one `sql.begin(async (tx) => {...})` transaction per
run (`migrate.mjs:65-95`) `[VERIFIED: scripts/migrate.mjs:65-95]`. Consequence: a migration
statement that fails (e.g., the trigram `CREATE INDEX` when the extension is missing) rolls back
the *entire* migration batch cleanly — exactly the "fail loudly, no partial state" behavior D-04
wants, provided the failure message is actionable (see the DO-block guard, verified below).

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| PostgreSQL FTS (`tsvector`/`tsquery`, built-in) | 16.14, already running | Ranked relevance search | D-01/D-10 lock this; zero new dependency, confirmed on the live instance |
| `pg_trgm` (PostgreSQL contrib extension) | 1.6, available, **not installed** | Typo-tolerant fallback | D-03/D-04 lock the install path; version and trust confirmed in ENVIRONMENT.md and re-confirmed live this session |
| `drizzle-orm` | 0.45.2 (pinned) | Schema + generated column + custom-opclass index builder | Already the project's only ORM; `.using('gin', sql\`...\`)` API confirmed to support schema-qualified custom operator classes (spike-tested, see below) |
| `drizzle-kit` | 0.31.10 (pinned) | Migration generation | Spike-tested this exact pinned version; emits correct DDL for the trigram index shape needed |
| `zod` | 4.4.3 (pinned) | Bounded query-param coercion | Already used for `pageParam` in `skills/page.tsx:18`; extend, don't replace |

### Supporting

None. No new runtime dependency is needed — FTS and trigram are PostgreSQL-native, logging reuses
`src/log.ts`, and the project has no API layer to imitate (D-43).

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Generated `tsvector` STORED column | Trigger-maintained `tsvector` | Rejected: no cross-table need once repo-name matching is split out (see FTS Design below); STORED column is simpler, always consistent, no trigger to maintain, matches Postgres's own recommended pattern for same-table search columns |
| `websearch_to_tsquery` | App-level query parser + `to_tsquery` | Rejected: reinvents exactly what `websearch_to_tsquery` already does safely (quotes, `OR`, `-exclude`), and `to_tsquery` throws on hostile input (verified below) — D-40 forbids that path outright |
| Hand-rolled trigram `text[]` + `array_ops` GIN | `pg_trgm` `gin_trgm_ops` | Already rejected by the maintainer (D-05a); confirmed correct by this session's DDL spike — the real extension needs no in-app code at all beyond one index |
| Keyset pagination | Offset (`LIMIT`/`OFFSET`) | Offset chosen: measured ~40ms at offset 900 of 921 rows (below), no measurable degradation at this corpus size: D-37 says pick the simpler one on the merits, and the merits are already decided by measurement |

**Installation:** none. `pg_trgm` is installed out-of-band by the maintainer; no `npm install`.

**Version verification:** `drizzle-orm@0.45.2` and `drizzle-kit@0.31.10` confirmed via
`package.json` read this session (not `npm view` — these are pinned exact versions already in
the lockfile, not a new install choice).

## Generic Artifact Detail Route (D-20 / D-21) — the highest-stakes item

### What breaks today, proven with live data

`source_path` for **every non-skill type is already the real, literal file (or directory) path**
— not a manifest-relative directory needing reconstruction:

```
type        source_path (samples)
----------  ----------------------------------------------------------
command     .claude/commands/build.md
plugin      .claude-plugin/plugin.json
plugin      cli-tool/components                    ← shape-only, no manifest file at all
hook        .claude/settings.json
mcp_server  .mcp.json
catalog     cli-tool/components/.claude-plugin/marketplace.json
```
`[VERIFIED: live psql, 2026-08-12 — `select type, source_path from agentdock.package where
type != 'skill' order by type, source_path limit 40`, plus per-type samples]`

Given `detailHref`'s current logic (only strips a `SKILL.md` suffix, a no-op for these types), a
command's URL becomes `/r/{fullName}/.claude/commands/build.md`. On the detail page,
`sourcePathFromUrl(['.claude','commands','build.md'])` joins to `.claude/commands/build.md`, which
is **not** `'SKILL.md'` and **is** non-empty, so the function unconditionally returns
`.claude/commands/build.md/SKILL.md` — a string that matches no row. **404, every time, for all
387 commands, 113 plugins, 16 hooks, 15 MCP declarations** `[VERIFIED: packages.ts:268-274 traced
against live source_path samples above]`.

The shape-only plugin case (`source_path = 'cli-tool/components'`, a bare directory with **no
manifest file at all**) breaks the same way and additionally proves that a per-type "append the
manifest filename" strategy cannot work uniformly — there is no manifest filename to append for a
shape-only plugin.

### Collision check — is `(repository, source_path)` alone unambiguous?

```sql
select repository_id, source_path, count(distinct type)
from agentdock.package group by 1,2 having count(distinct type) > 1;
-- 0 rows
```
`[VERIFIED: live psql, 2026-08-12]` Zero collisions across 1,137 rows. The table's own unique
constraint is `(repository_id, type, source_path)` — `type` is part of identity by design, but in
the entire live corpus no two different types ever share a path in the same repository. This is
an empirical fact about *today's* corpus, not a schema guarantee for all time.

### Recommended fix

1. **`sourcePathFromUrl` stops reconstructing a path.** Do a single query with an `OR`:
   `sourcePath = joined OR sourcePath = joined || '/SKILL.md'` (with the existing
   `joined === '' → 'SKILL.md'` edge case preserved). This resolves on the first branch for
   every non-skill type and shape-only plugins (their `source_path` *is* the URL, verbatim), and
   on the second branch for every existing skill permalink (preserving D-21's "existing links
   where possible"). One round trip, no ambiguity given the verified zero-collision fact above.
2. **`detailHref` stops assuming a skill-shaped URL for every type.** For `type === 'skill'`,
   keep the current strip-`SKILL.md`-for-a-prettier-URL behavior (unchanged links). For every
   other type, emit the literal `source_path` as the URL tail — no stripping, no appending.
   `PackageListItem.type` is already present in the type (`packages.ts:11-23`), so
   `PackageRows.tsx:21`'s call site only needs one added argument, not a new query.
3. **No filesystem path-traversal risk exists to defend against by construction**: `source_path`
   is never passed to a filesystem API anywhere in this codebase — it is only ever used as a SQL
   equality operand (`getPackageDetail`, `packages.ts:413`) and as a URL-building input for
   GitHub permalinks. Next.js's own catch-all route (`[...path]`) already decodes and arrays the
   segments before the handler runs. No new sanitization is warranted (ponytail: don't build a
   defense for an attack surface that doesn't exist here); the correctness risk is entirely about
   *lookup identity*, covered by item 1.
4. **`TYPE_LABELS`** in the detail page (`r/[owner]/[repo]/[...path]/page.tsx:19`) is currently
   `{ skill: 'Agent Skill' }` only — a one-line map, needs the other five labels (already defined
   verbatim in `artifact_type.label`, confirmed live below) to satisfy D-22/D-25.

## `catalog` semantics (D-34) — resolved by a verified pipeline fact

**Recommendation: `catalog` never needs special-casing in search. It is already excluded by the
existing listing predicate, and that exclusion is semantically correct, not coincidental.**

Live proof, traced through the code:

- `catalog.parse()` (`src/detect/catalog.ts:85-129`) returns `{ ok: true, status: 'seeds', ...}`
  when `marketplace.json` parses with a valid `plugins` array.
- The pipeline's own comment states the consequence verbatim: *"A catalog names other
  repositories; route to the seed channel and write no package row for it."*
  `[VERIFIED: src/ingest/pipeline.ts:287-301]` — **a successfully parsed catalog produces zero
  `package` rows**, only `repo_seed` rows.
- A `package` row of `type = 'catalog'` therefore only ever exists when the catalog **failed** to
  parse (fell through to the `!result.ok` branch, `pipeline.ts:303-318`, which always writes
  `parseStatus: 'failed'`).
- Confirmed against the live corpus's one catalog row:
  ```
  id=336 type=catalog source_path=cli-tool/components/.claude-plugin/marketplace.json
  parse_status=failed  parse_errors=["marketplace.json has no plugins array"]
  ```
  `[VERIFIED: live psql, 2026-08-12]`
- `NOT_LISTED_BECAUSE`'s second branch (`packages.ts:129`) is
  `when latestVersion('parse_status') = 'failed' then 'unparsed'` — so this row is **already**
  excluded from every listing today, with no catalog-specific code anywhere. This is why D-26's
  filter label list correctly omits "Catalog" — it never appears in results by construction, not
  by omission.

**Risk to flag for the planner**: this is a property of *today's* pipeline logic
(`status: 'seeds'` → no row), not a database constraint. If a future phase changes catalog
handling to also write a listable row, `NOT_LISTED_BECAUSE` would need a new explicit branch. Not
this phase's problem (out of scope per the phase boundary — "no ingestion-pipeline refactor"), but
worth one regression test asserting `type='catalog'` never appears in `listPackages()` output, so
a future change that breaks this invariant fails loudly rather than silently.

## FTS Design (D-06, Claude's Discretion: generated column vs trigger, weighting)

### Load-bearing discovery 1: generated columns cannot reference another table

```sql
CREATE TEMP TABLE t2 (id int, t1_id int, summary text,
  sv tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(summary,'') || ' ' ||
    coalesce((select name from t1 where t1.id = t1_id), ''))) STORED
);
-- ERROR:  cannot use subquery in column generation expression
```
`[VERIFIED: live psql against PostgreSQL 16.14 (this project's exact pinned version), rolled
back, 2026-08-12]`

**Consequence:** D-06's "repository owner/name" cannot be folded into a `package`-scoped
generated `tsvector` column. Since the corpus holds only **16 repositories**
`[VERIFIED: live count]`, matching `repository.full_name` at query time via a cheap `OR`
condition (`ILIKE` or its own small trigram check) is the correct design — D-12 already treats
"repository name match" as its own distinct ranking signal, separate from "description/text
relevance," so this split is not a compromise, it matches the requirement's own signal ordering.

### Load-bearing discovery 2: `to_tsvector` does not split slash-delimited paths

```sql
select to_tsvector('english', 'servers/mcp/index.ts');
-- 'servers/mcp/index.ts':1        (ONE lexeme, the whole path)

select to_tsvector('english', 'servers/mcp/index.ts') @@ plainto_tsquery('english','mcp');
-- f                                (does NOT match "mcp")

select to_tsvector('english', replace(replace('servers/mcp/index.ts','/',' '),'.',' '));
-- 'index':3 'mcp':2 'server':1 'ts':4   (fixed: 4 separate lexemes)

select to_tsvector('english', replace(replace('servers/mcp/index.ts','/',' '),'.',' '))
  @@ plainto_tsquery('english','mcp');
-- t                                (now matches)
```
`[VERIFIED: live psql, PostgreSQL 16.14, 2026-08-12]` — Postgres's default parser recognizes a
`/`-delimited string as a "file or path" token type and keeps it whole. **Any `source_path`
weight in the generated column must first run `replace(replace(source_path, '/', ' '), '.', ' ')`
or the C-weighted field is nearly dead weight for keyword search.**

### Generated column, confirmed working live (same-table only)

```sql
CREATE TEMP TABLE t1 (id int, name text, summary text, source_path text, type text,
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(name,'')), 'A') ||
    setweight(to_tsvector('english', coalesce(summary,'')), 'B') ||
    setweight(to_tsvector('english', replace(replace(coalesce(source_path,''),'/',' '),'.',' ')), 'C') ||
    setweight(to_tsvector('english', coalesce(type,'')), 'D')
  ) STORED
);
-- CREATE TABLE succeeds; INSERT + SELECT confirm correct weighted tokenization,
-- including stemming ('mcp-servers' -> 'mcp-server' token + 'mcp'/'server' sub-tokens)
-- and GIN index creation + query-plan usage against it, all live-tested successfully.
```
`[VERIFIED: live psql, PostgreSQL 16.14, rolled back, 2026-08-12 — full transcript: table
created, GIN index created (`USING gin(sv)`), 100 rows inserted, `EXPLAIN` on
`sv @@ plainto_tsquery(...)` returns matching rows]`

**Recommendation:** generated `STORED` column on `package`, not a trigger. No cross-table need
remains once repo-name is split out; a STORED column is always consistent by construction (no
trigger to keep in sync, no missed-update class of bug), and this is Postgres's own documented
idiom for single-table search columns. Weighting: **A = name, B = summary, C = path-with-
separators-replaced, D = type label** (D-06's minimum field list, in the order D-12's signal
priority implies — name match should outrank a path-fragment match).

### `websearch_to_tsquery` vs alternatives — proven live against adversarial input

All four functions tested against: `"mcp & drop table"`, `"playwright's"`,
`"'; DROP TABLE package; --"`, `"mcp:*"`, `"a!b"`, `"mcp|server"`, a 5,000-char string, emoji,
Korean text, empty string, whitespace-only, an unbalanced quote, an unclosed paren:

| Function | Throws on any adversarial input? | Notes |
|---|---|---|
| `to_tsquery` | **Yes — 5 of 13 inputs raised `ERROR: syntax error in tsquery`** | Forbidden by D-40 outright; confirmed live, not assumed |
| `plainto_tsquery` | No | Strips all operators; `mcp\|server` becomes `'mcp' & 'server'` (AND, not OR) |
| `phraseto_tsquery` | No | Joins terms with `<->` (strict adjacency) — more restrictive than typical multi-word search wants |
| `websearch_to_tsquery` | No | User-facing quote/`OR`/`-exclude` syntax, never throws, closest to what a search box user expects |

`[VERIFIED: live psql, PostgreSQL 16.14, all 13 × 4 = 52 combinations run, 2026-08-12]`

**Recommendation: `websearch_to_tsquery('english', normalizedQuery)`.** It satisfies D-40
directly (parameterized, no raw syntax reaches `to_tsquery`), and its quote/`OR`/`-exclude`
support is literal syntax control, not the semantic widening D-10 forbids (no synonym expansion
happens — a user typing `-shell` excludes a literal word, nothing is rewritten).

### Empty-query trap (D-18) — proven live

```sql
select to_tsvector('english','mcp server') @@ websearch_to_tsquery('english', '');
-- f   (an empty tsquery matches NOTHING)
```
`[VERIFIED: live psql, 2026-08-12]` **The app must branch on empty/whitespace-only query before
building the FTS predicate at all** — passing `''` through to `websearch_to_tsquery` and applying
`@@` unconditionally would silently return zero rows for browse mode, not "everything," directly
violating D-17/D-18. Browse mode must skip the FTS predicate entirely and use the browse ordering
instead (D-17: recency/alphabetical, never popularity).

## Trigram Fallback Design (D-02, D-03, D-04)

### Locked install state, re-confirmed live this session

```
rolname=agentdock_app  rolsuper=f  can_create(mcpdb)=f
extensions installed: plpgsql only
```
`[VERIFIED: live psql, 2026-08-12 — matches the task's pre-measured facts exactly, no drift]`

### Migration-time guard, proven live (both success and failure paths)

Bare index creation without the extension:
```sql
CREATE INDEX package_name_trgm_idx_spike ON agentdock.package USING gin (name agentdock.gin_trgm_ops);
-- ERROR:  operator class "agentdock.gin_trgm_ops" does not exist for access method "gin"
```
`[VERIFIED: live psql against the real `agentdock.package` table, wrapped in `BEGIN`/`ROLLBACK`,
no persisted change, 2026-08-12]` — this raw error is not actionable enough for D-04's
"actionable message naming the exact superuser command." The fix, proven live:

```sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    RAISE EXCEPTION 'pg_trgm extension is not installed. Ask a superuser to run: CREATE EXTENSION pg_trgm SCHEMA agentdock;';
  END IF;
END $$;
-- ERROR:  pg_trgm extension is not installed. Ask a superuser to run: CREATE EXTENSION pg_trgm SCHEMA agentdock;
-- CONTEXT:  PL/pgSQL function inline_code_block line 4 at RAISE
```
`[VERIFIED: live psql, wrapped in `BEGIN`/`ROLLBACK`, 2026-08-12]` Placed as the first statement
in the migration, before the `CREATE INDEX`, inside `scripts/migrate.mjs`'s single transaction
per run (`migrate.mjs:65-95`), this fails the whole migration loudly and cleanly with the exact
command D-04 asks for, and rolls back with no partial state. This `DO` block contains none of
`check-boundaries.mjs`'s `DESTRUCTIVE` keywords, so it needs no review marker.

### Drizzle syntax spike — confirmed against this project's exact pinned tool versions

```ts
index('package_name_trgm_idx').using('gin', sql`${t.name} agentdock.gin_trgm_ops`)
```
run through this project's pinned `drizzle-kit@0.31.10` `generate` command against a throwaway
schema file produces:
```sql
CREATE INDEX "package_spike_name_trgm_idx" ON "agentdock"."package_spike"
  USING gin ("name" agentdock.gin_trgm_ops);
```
`[VERIFIED: spike run in scratchpad, using `node .../drizzle-kit generate` from this project's
own `node_modules`, 2026-08-12 — full transcript above]` **This is the exact index-builder syntax
the planner should specify**; it is not a documentation claim, it was executed against the pinned
tool.

### Fallback trigger design

- **Recommendation: FTS first; trigram only when FTS returns zero rows.** Not always-union: the
  common-case query path stays on the GIN-indexed `tsvector` (cheap), and the trigram
  `similarity()`/`%` cost is paid only on the empty-result path — matching D-02's stated
  evaluation order (FTS → `pg_trgm` → ...) as a literal fallback chain, not a blended score. This
  also sidesteps the D-07 constraint (capability signals "must not be a strong ranking signal")
  by keeping trigram similarity purely a name-similarity signal (D-12's "prefix / name
  similarity" slot), never combined with capability data.
- **Candidates confirmed present in the live corpus for the maintainer's three typo examples**,
  so the planner has real rows to test against once the extension is installed:
  - `playwrit` → corpus has `webapp-testing`, `e2e-testing-patterns` (summary text contains
    "Playwright") `[VERIFIED: live psql `ilike '%playwright%'` on name/summary]`
  - `postgress` → corpus has `postgresql-table-design` (skill), `sql-migrations` (command)
    `[VERIFIED: live psql]`
  - `mcp-sever` → corpus has `mcp-servers`, `io.github.github/github-mcp-server`
    `[VERIFIED: live psql]`
- **Runtime absence handling**: trigram fallback code should catch Postgres error class `42883`
  (undefined function/operator) around the fallback call specifically, and degrade to "no
  fuzzy results" (log a warning) rather than a 500 — this is a *query-time* safety net distinct
  from D-04's *migration-time* hard fail, and satisfies D-42 ("distinguish user-query errors from
  internal errors"). `[ASSUMED — standard Postgres error-code handling pattern, not executed live
  in this session since executing it requires the extension to be absent at query time in a
  running app process, which this research could not simulate without the app's connection
  pool]`

## DIS-06 Capability Filter — "no scripts, no network, no shell"

### Vocabulary, confirmed live and from source

Six categories exist, confirmed against the live `capability_finding` table
(`[VERIFIED: live psql, 2026-08-12]`):

| category | live count | UI label (`[VERIFIED: src/components/CapabilityPanel.tsx:10-16]`) |
|---|---|---|
| `external_reference` | 1,073 | outbound reference / outbound references |
| `declared` | 769 | declared grant / declared grants |
| `package_install` | 495 | install directive / install directives |
| `network_request` | 84 | network request / network requests |
| `hidden_content` | 25 | (own panel, not in this list) |
| `remote_execution` | 4 | remote-execution pattern / remote-execution patterns |

`CATEGORY_LABELS` is quoted verbatim from source above (`CapabilityPanel.tsx:10-16`) — reuse
these exact strings' register (`"N install directives"`, never `"safe"`/`"risky"`) for filter
copy, per D-28.

### Predicate design — mapping "no scripts, no network, no shell" to real columns

- **"no network"** → `NOT EXISTS (capability_finding WHERE category = 'network_request')` on
  the artifact's **latest** `package_version` (mirroring `listPackages`'s own `latestVersion()`
  pattern, since `capability_finding` keys on `package_version_id`, confirmed
  `[VERIFIED: capabilities.ts:1-47, schema.ts:218-271]`).
- **"no shell"** → `NOT EXISTS (capability_finding WHERE category = 'declared' AND signal ILIKE
  'Bash%')` — all 30+ distinct `Bash`/`Bash(...)` signal values share this prefix
  `[VERIFIED: live psql category/signal breakdown, 2026-08-12]`.
- **"no scripts"** → `NOT EXISTS (jsonb_array_elements(package.files) f WHERE f->>'path' ~
  '\.(py|sh|js|ts|rb|ps1|mjs)$')`, reusing the exact extension list from
  `SCRIPT_EXTENSIONS = ['.py', '.sh', '.js', '.ts', '.rb', '.ps1', '.mjs']`
  `[VERIFIED: src/analyze/files.ts:14, isBundledScript at files.ts:70-72]` — `files` lives on
  `package`, not `package_version` (deliberate per `schema.ts:136-147`'s own comment), so this
  predicate needs no version join at all.

### Measured selectivity and performance

```sql
-- full listing predicate + all three "no X" exclusions, LIMIT 25
-- Execution Time: 97.014 ms   (EXPLAIN ANALYZE, BUFFERS)

-- unbounded count, same predicate:
passes_no_scripts_no_network_no_shell = 708   (of 921 listed)
```
`[VERIFIED: live psql, 2026-08-12, full query text in this session's transcript]` 97ms is
acceptable at this corpus size without a new index (D-46: measure before indexing); the `EXPLAIN`
plan shows `Index Only Scan using capability_finding_identity` already serving the
`(package_version_id, category)` lookup efficiently — the existing composite unique index
absorbs this filter for free.

## Query Performance Benchmarks (D-45, D-46) — measured against live corpus, 2026-08-12

All numbers are `EXPLAIN (ANALYZE, BUFFERS)` execution time, live corpus (1,137 packages, 921
listed, 16 repositories).

| Query shape | Execution time | Notes |
|---|---|---|
| Current `listPackages` query, listing predicate in `WHERE` (matches real code), page 1 (offset 0) | **40.3 ms** | `[VERIFIED]` |
| Same query, late page (offset 900, near the end of 921 rows) | **37.3 ms** | `[VERIFIED]` — **no measurable degradation with offset**, directly answers D-37 |
| Same query with `NOT_LISTED_BECAUSE` computed only in `SELECT`, not repeated in `WHERE` | **1,259 ms** at offset 900 | `[VERIFIED]` — a cautionary finding: this is what happens if a future edit stops reusing the same Drizzle fragment object in both places, exactly the bug class `packages.ts:203-208`'s own comment warns about |
| Naive `ILIKE '%mcp%'` across name/summary/repo/path + full listing predicate | **6.1 ms** | `[VERIFIED]` — fast because the `ILIKE` predicate filters the row set *before* the expensive dedup `EXISTS` subquery runs, confirmed by plan reordering |
| Ad-hoc `to_tsvector`/`ts_rank` with no generated column, no index, keyword "mcp server" | **32.3 ms** | `[VERIFIED]` — demonstrates FTS is fast enough even before the GIN index exists at this corpus size; the generated column + index is still correct to build (matches the phase's pre-declared plan shape 06-01) but is not rescuing a measured emergency |
| `ILIKE '%playwright%'` (rare keyword) | **3.5 ms** | `[VERIFIED]` |
| DIS-06 triple-exclusion filter + full listing predicate | **97.0 ms** | `[VERIFIED]`, see above |

**Recommendation for D-37: offset pagination, no keyset.** The measured 37-40ms at any offset
across the full 921-row set is well inside "feels instant," and keyset pagination would add
complexity (cursor encoding, stable-sort tie-break plumbing through a cursor rather than an
`OFFSET` integer) for a corpus this small. D-15's tie-break (`relevance DESC, updated_at DESC,
package_id ASC`) works identically under `OFFSET`.

## Query Safety and Caps (D-40, D-41)

- `q`, `type`, `page` should follow the exact `zod` coercion idiom already in
  `skills/page.tsx:18` (`z.coerce...().catch(fallback)`), not a new validation library.
- Recommended caps, following the `CAPS`/`ANALYZE_CAPS` naming convention already established
  (`src/github/scan.ts:11-26`, `src/analyze/types.ts:24-...`) — a `SEARCH_CAPS` const object:
  `maxQueryLength` (defense against pointless work on pathological input — `websearch_to_tsquery`
  itself degrades gracefully per the live test above, so this is a cost control, not a crash
  prevention), `pageSize` fixed at 25 (matches the existing `PAGE_SIZE` in `skills/page.tsx:11`),
  `maxPage` (reuse the existing `.max(10_000)` bound).
- Wildcard escaping is moot for the FTS path (`websearch_to_tsquery` never interprets `%`/`_` as
  SQL wildcards — those are `LIKE`/`ILIKE`-only metacharacters); if any `ILIKE` fallback path is
  built (e.g., the cheap repository-name match), escape `%` and `_` per the confirmed-working
  pattern: `replace(replace(input,'%','\%'),'_','\_')` `[VERIFIED: live psql — literal-match
  test above]`.

## Next.js App Router Mechanics (D-35, D-36)

- Confirmed Next.js **16.3.0**, React **19.2.8** `[VERIFIED: package.json]`.
- `searchParams` arrives as `Promise<Record<string, string | string[] | undefined>>` in every
  existing page component; `params` likewise `[VERIFIED: three call sites cited above]`. The new
  `/artifacts` route must `await searchParams` the same way — this is not new API surface to
  research, it is this codebase's own established idiom.
- `export const dynamic = 'force-dynamic'` is required on every DB-backed page today (comment:
  *"Read at request time. next build runs in CI, where there is no database."*)
  `[VERIFIED: skills/page.tsx:6-7` and both `r/[owner]/[repo]*` pages]` — the new route needs the
  same directive.
- `next.config.ts` already defines an `async headers()` function `[VERIFIED: next.config.ts]`;
  Next.js's `redirects()` config function (same file, same API family, framework-native, no new
  dependency) is the natural mechanism for D-19's `/skills` → `/artifacts` redirect —
  `[ASSUMED for the `redirects()` API shape specifically — not executed live this session, but
  it is the same well-documented Next.js config API family already in use in this exact file for
  `headers()`, and requires no new dependency]`.

## Route Naming and Existing Routes

Current top-level routes: `src/app/jobs`, `src/app/r`, `src/app/skills`
`[VERIFIED: directory listing]`. `/artifacts` (D-19's own suggestion) fits the existing flat,
single-word convention.

## Browser/Headless Verification Tooling (item 12)

No Playwright/Puppeteer/e2e dependency exists in `package.json`
`[VERIFIED: package.json, full dependency list read]`. The `.gstack/` directory contains
`browse-network.log`, `browse-console.log`, `browse-audit.jsonl`
`[VERIFIED: directory listing]`, and `STATE.md` records Phase 5 already used a "browser
checkpoint" for its own independent verification. **Recommendation: reuse the gstack `browse`
skill for the D-51/§46 browser verification (browse → search → filter → open detail → back →
paginate, no console errors) — do not add Playwright or any new E2E framework**, matching the
explicit instruction in CONTEXT.md's Specifics section.

## Architecture Patterns

### System Architecture Diagram

```
Browser (address bar / back-forward)
   │  GET /artifacts?q=mcp&type=plugin&page=2
   ▼
Next.js App Router — /artifacts (Server Component, force-dynamic)
   │  await searchParams  →  zod-coerced { q, type, page }
   ▼
┌─────────────────────────────────────────────────────────────┐
│ src/db/queries/search.ts  (new)                              │
│                                                                │
│  empty/whitespace q? ──yes──▶ browse ordering                 │
│         │no                    (recency/alpha, D-17)          │
│         ▼                                                     │
│  websearch_to_tsquery('english', normalizedQuery)              │
│         │                                                     │
│         ▼                                                     │
│  package.search_vector @@ tsquery                             │
│    (generated STORED tsvector, GIN-indexed)                   │
│    OR repository.full_name ILIKE (16-row table, cheap)         │
│         │                                                     │
│         ├─ 0 rows? ──yes──▶ agentdock.gin_trgm_ops similarity  │
│         │                    fallback on package.name          │
│         │                    (only if pg_trgm present;          │
│         │                     42883 caught → log + skip)       │
│         ▼                                                     │
│  AND (existing NOT_LISTED_BECAUSE IS NULL)  ◄── reused verbatim│
│       from src/db/queries/packages.ts, never restated          │
│         │                                                     │
│         ├─ type filter (WHERE type = ANY(...))                 │
│         ├─ capability filter (NOT EXISTS on capability_finding,│
│         │    NOT EXISTS on jsonb_array_elements(files))         │
│         ▼                                                     │
│  ORDER BY relevance DESC, updated_at DESC, id ASC (D-15)        │
│  LIMIT 25 OFFSET (page-1)*25                                   │
└─────────────────────────────────────────────────────────────┘
   │
   ▼
log() → src/log.ts → stdout JSON line { event:'search', query, filters, resultCount, durationMs }
   │
   ▼
Server-rendered HTML (D-36) — result rows, facets, pager, zero-result copy
   │
   ▼
Browser renders; only filter controls (if any client interactivity) are Client Components
```

### Recommended Project Structure

```
src/
├── app/
│   ├── artifacts/
│   │   └── page.tsx          # replaces src/app/skills/page.tsx; SSR search + browse
│   └── r/[owner]/[repo]/[...path]/page.tsx   # generalized detail lookup (existing file, fixed)
├── db/
│   ├── queries/
│   │   ├── search.ts         # new: search query, reuses NOT_LISTED_BECAUSE from packages.ts
│   │   └── packages.ts       # existing: sourcePathFromUrl/detailHref fixed, type-aware
│   └── schema.ts             # existing: + generated search_vector column, + GIN indexes
└── log.ts                    # existing: + SearchLog union member
```

### Pattern 1: Reuse-not-restate the listing predicate

**What:** Import `NOT_LISTED_BECAUSE`'s governing logic by calling into `packages.ts`'s exported
query shape (or exporting the SQL fragment itself), never re-deriving fork/duplicate/unparsed
exclusion in `search.ts`.
**When to use:** Every search/browse query.
**Why:** D-32 requires it; the fragment-reuse discipline in `packages.ts:203-208` is the concrete
precedent (a copy-pasted second CASE would be the exact bug class that comment warns about).

### Pattern 2: Fallback chain, not blended score

**What:** FTS first; trigram only on zero FTS results.
**When to use:** The search query path only (never browse, which has no query).
**Example:**
```sql
-- source: this session's live verification, PostgreSQL 16.14
WITH fts AS (
  SELECT ... FROM package p JOIN repository r ON ...
  WHERE p.search_vector @@ websearch_to_tsquery('english', $1)
    AND <listing predicate> ...
  ORDER BY ts_rank(p.search_vector, websearch_to_tsquery('english', $1)) DESC, ...
  LIMIT 25
)
-- app code: if fts returns 0 rows, run the trigram query instead
```

### Anti-Patterns to Avoid

- **Reconstructing `sourcePath` from URL segments with type-specific suffix logic:** proven to
  break 5 of 6 artifact types today; use literal-match-first instead.
- **Always-union FTS + trigram:** pays trigram cost on every query, not just the empty-result
  case; also risks the fuzzy match outranking an exact match without careful score normalization
  D-12 does not ask for.
- **Computing `NOT_LISTED_BECAUSE` only in `SELECT`, omitting it from `WHERE`:** measured 31×
  slowdown at a late offset (1,259ms vs 37ms) in this exact session — a correctness-shaped
  performance trap, not a style preference.
- **Applying `websearch_to_tsquery('')` unconditionally for browse mode:** returns zero rows
  always (verified), not "everything." Must branch before building the predicate.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Typo tolerance | Levenshtein/edit-distance in app code | `pg_trgm` `agentdock.gin_trgm_ops` + `similarity()`/`%` | D-05a already rejected the hand-rolled `text[]` + `array_ops` alternative; the real extension needs one index, zero app logic |
| Query parsing | Regex-based tokenizer for user search strings | `websearch_to_tsquery` | Proven live to never throw on 13 adversarial inputs including SQL injection strings; a hand-rolled parser would need to reproduce that safety property and prove it the same way |
| Search-result pagination cursor | Custom keyset/cursor encoding | `LIMIT`/`OFFSET` | Measured no benefit at 921 rows (37-40ms flat); D-37 explicitly asks to pick the simpler one on the merits |
| Structured query logging | New logging library or DB table | `src/log.ts`'s existing closed-union `log()` | Exact same shape already serves `IngestLog`/`WorkerLog`; DIS-08 needs no new infrastructure |

**Key insight:** Every "don't hand-roll" item in this phase already has a working precedent
elsewhere in this exact codebase (dedup/listing logic, bounded zod coercion, structured logging,
CAPS-object convention) or a PostgreSQL built-in the maintainer has already locked in. The phase
is small precisely because almost nothing here is new invention — it's extension of existing,
already-battle-tested code.

## Common Pitfalls

### Pitfall 1: Silent 404s for 5 of 6 artifact types
**What goes wrong:** Search returns a result row for a command/plugin/hook/mcp_server, the user
clicks it, gets a 404.
**Why it happens:** `sourcePathFromUrl`'s unconditional `/SKILL.md` append (see Generic Detail
Route section).
**How to avoid:** Literal-match-first lookup, verified above.
**Warning signs:** Any manual click-through test on a non-skill result row.

### Pitfall 2: Browse mode returns zero rows
**What goes wrong:** Loading `/artifacts` with no `q` param shows an empty page.
**Why it happens:** An empty `websearch_to_tsquery('')` never matches any row via `@@` (proven
live above); if the query-building code always applies the FTS predicate, browse mode silently
breaks.
**How to avoid:** Explicit branch: no query → skip the FTS predicate, use browse ordering.
**Warning signs:** `/artifacts` with no query params showing "No artifacts matched" — the exact
wrong-but-plausible failure D-38's copy is meant for a *real* zero-result search, not a bug.

### Pitfall 3: Computing the listing predicate in `SELECT` only
**What goes wrong:** A 31× slowdown (1,259ms) that only appears at a late page offset, not on
page 1 — easy to miss in casual testing that only checks page 1.
**Why it happens:** The query planner cannot push the exclusion filter into the scan without it
also appearing in `WHERE`.
**How to avoid:** Always mirror the predicate into `WHERE`, exactly as `listPackages` already does
(`packages.ts:203-208`).
**Warning signs:** Fast page 1, slow later pages — benchmark a late page every time, per D-45/D-46.

### Pitfall 4: `to_tsquery` reachable from any user-controlled path
**What goes wrong:** A user query containing an unclosed paren or a bare `!`/`&`/`|` throws a
raw Postgres syntax error, which either 500s the page or (worse) leaks a stack trace (violating
D-42).
**How to avoid:** Only `websearch_to_tsquery`/`plainto_tsquery`/`phraseto_tsquery` ever touch raw
user input; `to_tsquery` (the operator-syntax-sensitive function) must never receive
user-controlled text — proven live to throw on 5 of 13 adversarial test strings.
**Warning signs:** A search box that 500s on a search containing `(` or `"`.

## Code Examples

### Generated search vector column (verified live, see FTS Design section for full transcript)
```sql
-- Source: this session's live psql verification against PostgreSQL 16.14
ALTER TABLE agentdock.package ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(name,'')), 'A') ||
    setweight(to_tsvector('english', coalesce(summary,'')), 'B') ||
    setweight(to_tsvector('english',
      replace(replace(coalesce(source_path,''),'/',' '),'.',' ')), 'C') ||
    setweight(to_tsvector('english', coalesce(type,'')), 'D')
  ) STORED;

CREATE INDEX package_search_vector_idx ON agentdock.package USING gin (search_vector);
```

### Trigram index with the required schema qualification (verified via drizzle-kit spike)
```ts
// Source: this session's drizzle-kit@0.31.10 generate spike (transcript above)
index('package_name_trgm_idx').using('gin', sql`${t.name} agentdock.gin_trgm_ops`)
```

### pg_trgm presence guard (verified live, fails loudly with the exact D-04 message)
```sql
-- Source: this session's live psql verification, rolled back
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    RAISE EXCEPTION 'pg_trgm extension is not installed. Ask a superuser to run: CREATE EXTENSION pg_trgm SCHEMA agentdock;';
  END IF;
END $$;
```

### DIS-06 "no scripts, no network, no shell" predicate (verified live, 97ms, 708/921 pass)
```sql
-- Source: this session's live psql verification
AND NOT EXISTS (
  SELECT 1 FROM agentdock.package_version pv
  JOIN agentdock.capability_finding cf ON cf.package_version_id = pv.id
  WHERE pv.id = (SELECT z.id FROM agentdock.package_version z
                 WHERE z.package_id = p.id ORDER BY z.ingested_at DESC LIMIT 1)
    AND cf.category = 'network_request'
)
AND NOT EXISTS (
  SELECT 1 FROM agentdock.package_version pv
  JOIN agentdock.capability_finding cf ON cf.package_version_id = pv.id
  WHERE pv.id = (SELECT z.id FROM agentdock.package_version z
                 WHERE z.package_id = p.id ORDER BY z.ingested_at DESC LIMIT 1)
    AND cf.category = 'declared' AND cf.signal ILIKE 'Bash%'
)
AND NOT EXISTS (
  SELECT 1 FROM jsonb_array_elements(p.files) f
  WHERE (f->>'path') ~ '\.(py|sh|js|ts|rb|ps1|mjs)$'
)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No search (browse-only `/skills` listing) | FTS + trigram over PostgreSQL, no external service | This phase | First phase with real query volume to tune against |
| `sourcePathFromUrl`'s skill-only suffix logic | Literal-match-first, skill-only-fallback-second | This phase | Fixes 531 of 921 listed artifacts' unreachable detail pages (387 commands + 113 plugins + 16 hooks + 15 mcp_server = 531) |

**Deprecated/outdated:** none — this is the first search implementation, nothing is being
replaced except the skill-only assumption baked into `packages.ts:268-280`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Postgres error class `42883` (undefined function) is the correct one to catch around a runtime trigram-fallback call if `pg_trgm` is somehow absent at query time | Trigram Fallback Design | Low — this is standard, documented Postgres error-code behavior for a missing operator/function; if the code number were wrong, the catch simply wouldn't trigger and the error would surface as an unhandled exception, which D-42's generic error boundary should still turn into a non-leaking user message |
| A2 | Next.js `redirects()` in `next.config.ts` is the right mechanism for the `/skills` → `/artifacts` redirect | Next.js App Router Mechanics | Low — `redirects()` is a long-stable, well-documented Next.js config API in the same file already used for `headers()`; if unavailable for some reason, a thin `src/app/skills/page.tsx` that calls `redirect('/artifacts')` is an equally simple fallback |
| A3 | A `maxQueryLength` cap value (not yet chosen) is best set around 200 characters | Query Safety and Caps | Low — this is a Claude's Discretion item; the live test shows even a 5,000-char string doesn't crash anything (just gets one word ignored), so this cap is a cost-control nicety, not a correctness requirement; any reasonable value is safe |

**If this table is empty:** N/A — three low-risk items above; every load-bearing/high-stakes
claim in this document (the detail-route fix, the FTS tokenization behavior, the generated-column
constraint, the query-safety comparison, the DIS-06 predicate, the trigram DDL syntax, the offset
pagination measurement) was verified live against the running database or this project's own
pinned tool versions in this session.

## Open Questions

1. **Exact `maxQueryLength`/`pageSize`/`maxPage` numeric values**
   - What we know: the pattern to follow (`z.coerce...().catch(fallback)`, `CAPS`-object
     convention) and that no value in a reasonable range (50-500 chars) risks correctness.
   - What's unclear: the maintainer has no stated preference recorded in CONTEXT.md.
   - Recommendation: planner picks reasonable defaults (`pageSize: 25` matching the existing
     constant, `maxQueryLength: 200`, `maxPage: 10_000` matching the existing bound) and states
     them as a Claude's-Discretion choice, not a research gap requiring user confirmation.

2. **Whether the repository-name match contributes to `ts_rank` scoring or is purely a filter**
   - What we know: D-12 lists "repository name match" as a distinct ranking signal, after
     description/text relevance.
   - What's unclear: exact scoring formula weight isn't specified anywhere (Claude's Discretion
     per CONTEXT.md's "Exact FTS weighting... and `ts_rank` variant").
   - Recommendation: treat repo-name match as a small ranking bonus applied after the primary
     `ts_rank` score (e.g., `ts_rank(...) + CASE WHEN repo matched THEN 0.1 ELSE 0 END`), keeping
     it strictly lower-priority than name/description matches — this satisfies D-12's stated
     order without inventing an elaborate multi-factor formula (ponytail: simplest thing that
     respects the stated priority order).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| PostgreSQL FTS (`tsvector`/`to_tsvector`/GIN) | DIS-03 | ✓ | 16.14, built-in | — |
| `pg_trgm` extension | DIS-04 | ✗ (available, not installed; maintainer installs out-of-band per D-03) | 1.6 when installed | Migration fails loudly per D-04's guard; search still functions via FTS alone until installed |
| `psql` client on host | Manual verification | ✗ (not on host; `docker exec` used throughout this research) | — | `docker exec didim-mcp-service-backend-db-1 psql -U mcp -d mcpdb` |
| gstack `browse` skill | D-51 browser verification | ✓ (`.gstack/` directory present with prior session logs) | — | — |

**Missing dependencies with no fallback:** none — `pg_trgm`'s absence has an explicit, designed
fallback (FTS-only operation, loud migration failure with the exact remediation command).

**Missing dependencies with fallback:** `pg_trgm` (see above).

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.10 `[VERIFIED: package.json]` |
| Config file | `vitest.config.ts` — DB-backed suites `describe.skipIf(!DB_URL)`, sentinel prefix `test-owner/*`, visible skip with no `DATABASE_URL` `[VERIFIED: vitest.config.ts, src/db/queries/packages.test.ts:8,13,25]` |
| Quick run command | `bun run test -- src/db/queries/search.test.ts` (new file) |
| Full suite command | `bun run ci` (boundaries + biome + tsc + vitest) `[VERIFIED: package.json scripts.ci]` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DIS-03 | Plain-language query returns relevance-ranked results | integration (DB-backed) | `bun run test -- src/db/queries/search.test.ts` | ❌ Wave 0 |
| DIS-04 | Misspelled query still finds the right artifact | integration (DB-backed, requires `pg_trgm` installed) | same file, `describe.skipIf` on extension presence | ❌ Wave 0 |
| DIS-05 | Type filter | integration | same file | ❌ Wave 0 |
| DIS-06 | Capability filter incl. "no scripts, no network, no shell" | integration | same file | ❌ Wave 0 |
| DIS-07 | Zero-result next step | SSR render test or manual browser check | `bun run test` + gstack `browse` | ❌ Wave 0 |
| DIS-08 | Query + result count logged | unit (assert `log()` call shape) | `bun run test -- src/log.test.ts` (extend or new) | ❌ Wave 0 |
| DIS-10 | No external service | structural (no new dependency in `package.json`) | `bun run ci` (no new import to check) | ✅ n/a |
| D-20/D-21 (generic detail route) | Every artifact type's detail page resolves | integration (DB-backed) | `bun run test -- src/db/queries/packages.test.ts` (extend) | existing file, needs new cases |
| D-31/D-32 (COR-07 holds in search) | Suppressed artifact absent from search, present at direct link | integration | same `search.test.ts`, following `packages.test.ts`'s existing COR-07 test pattern | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `bun run test -- src/db/queries/search.test.ts src/db/queries/packages.test.ts`
- **Per wave merge:** `bun run ci`
- **Phase gate:** Full suite green before `/gsd-verify-work`, plus a gstack `browse` pass through
  the maintainer's named smoke-query set (`mcp`, `skill`, `claude`, `playwright`, `github`, one
  exact name, one zero-result query, a type filter, a combined filter, page 2+).

### Wave 0 Gaps

- [ ] `src/db/queries/search.test.ts` — covers DIS-03/04/05/06, COR-07-in-search, following the
  exact `describe.skipIf(!DB_URL)` / `test-owner/*` sentinel pattern in
  `src/db/queries/packages.test.ts`
- [ ] `src/db/queries/packages.test.ts` extension — new cases for the fixed
  `sourcePathFromUrl`/`detailHref` covering all six types (5 non-skill + 1 skill regression)
- [ ] A trigram-specific test file or `describe.skipIf` block that skips cleanly when `pg_trgm`
  is not installed in the test database (mirrors the existing `DATABASE_URL`-absent skip
  pattern) — needed because CI and most local dev will not have the extension installed
- [ ] Log-shape assertion for the new `SearchLog` union member in `src/log.ts` (no existing test
  file for `log.ts`; a small new one is proportionate)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth in v1 (STATE.md constraint) |
| V3 Session Management | no | Stateless, URL-is-state (D-35) |
| V4 Access Control | no | Everything read-only over public data |
| V5 Input Validation | yes | `zod` bounded coercion for `q`/`type`/`page` (existing `pageParam` pattern); `websearch_to_tsquery` for query text (never `to_tsquery`, proven to throw on hostile input) |
| V6 Cryptography | no | Not applicable to this phase |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection via search query | Tampering | Drizzle's parameterized `sql` template + `websearch_to_tsquery` (never string-concatenated `to_tsquery`) — verified live that a literal `'; DROP TABLE package; --'` string produces only lexemes (`'drop' & 'tabl' & 'packag'`), never executes as SQL, when passed as a bound parameter to any of the three safe functions |
| ReDoS via capability-filter regex on `files` path check | Denial of Service | The `\.(py|sh|js|ts|rb|ps1|mjs)$` pattern is a fixed, non-backtracking alternation over literal extensions — no user input reaches this regex, it only matches stored `source_path`/`files[].path` values already capped by `ANALYZE_CAPS.maxInventoryEntries` |
| Information leak via raw error message on `pg_trgm` absence at query time | Information Disclosure | Catch the specific error class at the query layer (A1 above) and render a generic "search is temporarily degraded" state, never the raw Postgres error text, matching D-42 |
| Stack trace leak on any DB/search failure | Information Disclosure | D-42 requires a generic error boundary; this phase adds no new failure mode the app doesn't already need to handle for every other DB-backed page |

## Sources

### Primary (HIGH confidence — live execution or direct source read this session)

- Live PostgreSQL 16.14 instance (`docker exec didim-mcp-service-backend-db-1 psql -U mcp -d
  mcpdb`) — every SQL query, `EXPLAIN`, and DDL spike quoted above, all destructive tests wrapped
  in `BEGIN`/`ROLLBACK` or run against `TEMP TABLE`s, nothing persisted to the shared schema
- `src/db/queries/packages.ts`, `src/db/queries/capabilities.ts`, `src/db/schema.ts`,
  `src/log.ts`, `src/db/client.ts`, `src/app/skills/page.tsx`, `src/app/r/[owner]/[repo]/page.tsx`,
  `src/app/r/[owner]/[repo]/[...path]/page.tsx`, `src/components/PackageRows.tsx`,
  `src/components/CapabilityPanel.tsx`, `src/analyze/files.ts`, `src/analyze/types.ts`,
  `src/detect/catalog.ts`, `src/ingest/pipeline.ts`, `scripts/check-boundaries.mjs`,
  `scripts/migrate.mjs`, `drizzle.config.ts`, `next.config.ts`, `package.json`,
  `vitest.config.ts`, `src/db/queries/packages.test.ts` — all read in full or in cited ranges
  this session
- `drizzle-kit@0.31.10` `generate` spike run against this project's own `node_modules`, output
  quoted verbatim

### Secondary (MEDIUM confidence)

- `.planning/phases/AGD-06-search-browse/06-CONTEXT.md`, `.planning/REQUIREMENTS.md`,
  `.planning/ROADMAP.md`, `.planning/STATE.md`, `.planning/research/ENVIRONMENT.md` — all locked
  decisions and prior-phase facts treated as constraints, cross-checked live where a live check
  was possible (e.g., extension state, role privileges) and found to match exactly, no drift

### Tertiary (LOW confidence)

- Next.js `redirects()` config API shape (A2 in Assumptions Log) — not executed live this session

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependency; every existing tool's exact pinned version confirmed
- Architecture (generic detail route, FTS column design): HIGH — the two riskiest architectural
  decisions in the phase were both spike-tested live against the actual corpus and actual pinned
  tooling, not reasoned from documentation
- Pitfalls: HIGH — all four pitfalls were reproduced live (404 trace, empty-tsquery trap, 31×
  slowdown, `to_tsquery` syntax errors), not hypothesized

**Research date:** 2026-08-12
**Valid until:** live-DB facts (row counts, extension state) should be re-checked if planning is
deferred more than a few days, since ingestion may add rows; the PostgreSQL-version-dependent
findings (tokenization behavior, generated-column restrictions, function volatility) are stable
across PostgreSQL 16.x and do not need re-verification within this major version.
