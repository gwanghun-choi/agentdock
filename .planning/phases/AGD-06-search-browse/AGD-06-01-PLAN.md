---
phase: AGD-06-search-browse
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/db/queries/packages.ts
  - src/db/queries/packages.test.ts
  - src/components/PackageRows.tsx
  - src/app/r/[owner]/[repo]/[...path]/page.tsx
  - src/db/schema.ts
  - drizzle/
  - src/db/queries/search.ts
  - src/db/queries/search.test.ts
  - src/app/artifacts/page.tsx
autonomous: true
requirements: [DIS-03, DIS-10]

estimate:
  tokens: 120000
  raw_tokens: 120000
  tasks: 4
  confidence: low

must_haves:
  truths:
    - "A detail URL resolves to a row for every one of the six artifact types, not only skill — command, plugin (manifest-backed), plugin (shape-only, a bare directory with no manifest file), hook, mcp_server and skill each open at their own URL"
    - "Every detail URL that resolved before this plan still resolves after it, with the same URL string, proven by a skill regression case that reconstructs the pre-change URL shape"
    - "When a repository holds both a literal path X and a skill at X/SKILL.md, the literal match wins deterministically and the choice is expressed in the query's ORDER BY, not left to row order"
    - "The generated column search_vector exists on agentdock.package as a STORED generated column and is populated for all existing rows without any application backfill"
    - "GET /artifacts?q=mcp returns HTTP 200 with at least one server-rendered result row present in the HTML before any client JavaScript runs"
    - "A result row rendered by /artifacts links to a detail URL that returns HTTP 200, for a non-skill artifact type"
    - "The search query reuses the exact NOT_LISTED_BECAUSE fragment object exported from packages.ts in both its SELECT projection and its WHERE clause, and contains no second hand-written fork/duplicate/unparsed CASE"
    - "The shipped search SQL, taken from Drizzle's own toSQL output, is one statement — a page of 25 rows issues no per-row query for commitSha, fullName or scannedAt"
    - "package.json gains no dependency and no devDependency in this plan"
    - "A source_path containing a URL-significant character such as '#' or '?' resolves via a percent-encoded detail URL rather than truncating at that character (probe edge DIS-03/encoding)"
    - statement: "The rendered /artifacts and detail pages produce no browser console error across browse → search → open detail → back"
      verification: backstop
  prohibitions:
    - statement: "No external search service, search cluster, vector database, or any new runtime dependency (D-01, DIS-10)"
      status: flagged
      verification: unverified
    - statement: "No CREATE EXTENSION statement in any migration this phase emits, with or without a review marker (D-04)"
      status: flagged
      verification: unverified
    - statement: "Stars, downloads, official, trusted and security are never ranking inputs (D-13)"
      status: flagged
      verification: unverified
    - statement: "parse_status = 'partial' carries no ranking penalty and no listing exclusion (D-14)"
      status: flagged
      verification: unverified
    - statement: "A suppressed artifact never reappears in global search (D-31)"
      status: flagged
      verification: unverified
    - statement: "No filtering of the result set happens on the client; every predicate is SQL (D-30)"
      status: flagged
      verification: unverified
    - statement: "No verdict-style capability wording — Safe, Risky, dangerous — on any search, browse or detail surface (D-28)"
      status: flagged
      verification: unverified
    - statement: "No raw user syntax reaches the operator-syntax text-search parser (D-40)"
      status: flagged
      verification: unverified
    - statement: "No stack trace or raw Postgres error text reaches the UI (D-42)"
      status: flagged
      verification: unverified
    - statement: "No migration touches the public or didim_mcp schema, and none contains DROP or REVOKE (D-49)"
      status: flagged
      verification: unverified
    - statement: "No new artifact detector, no new crawler, no modification to an existing detector, no ingestion-pipeline refactor, no provenance schema change (phase boundary)"
      status: flagged
      verification: unverified
  artifacts:
    - path: "src/db/queries/packages.ts"
      provides: "The artifact-primary detail identity: sourcePathCandidates replaces sourcePathFromUrl, detailHref becomes type-aware, NOT_LISTED_BECAUSE becomes exported so search can reuse it rather than restate it"
      exports: ["sourcePathCandidates", "detailHref", "NOT_LISTED_BECAUSE", "getPackageDetail", "listPackages", "countPackages", "permalink", "permalinkAtLine"]
    - path: "src/db/queries/search.ts"
      provides: "The full-text search query: a weighted tsvector match ranked by ts_rank, sharing the listing predicate with packages.ts"
      exports: ["searchPackages", "SearchResultItem"]
      min_lines: 60
    - path: "src/app/artifacts/page.tsx"
      provides: "The server-rendered search and browse route, replacing the misnamed /skills"
      min_lines: 60
    - path: "src/db/queries/search.test.ts"
      provides: "The first direct test of the search query, on its own test-owner/search-spec sentinel prefix"
      min_lines: 80
    - path: "src/db/schema.ts"
      provides: "The search_vector generated STORED column and its GIN index, declared in the same (t) => [...] shape as every other index in this file"
  key_links:
    - from: "src/db/queries/packages.ts"
      to: "src/db/queries/search.ts"
      via: "the exported NOT_LISTED_BECAUSE fragment object, referenced not copied, so listing visibility and search visibility cannot drift"
      pattern: "NOT_LISTED_BECAUSE"
    - from: "src/db/queries/packages.ts"
      to: "src/components/PackageRows.tsx"
      via: "detailHref takes the artifact's type, so a result row for a command links to the command's own path instead of a reconstructed skill path"
      pattern: "detailHref"
    - from: "src/db/schema.ts"
      to: "src/db/queries/search.ts"
      via: "packageTable.searchVector is the column the @@ predicate and ts_rank both read"
      pattern: "searchVector"
---

<objective>
Make one query find one artifact, and make that artifact open.

Purpose: this is the phase's tracer. Everything else in Phase 6 — ranking,
filters, typo tolerance, zero-result copy, logging — expands outward from a
single proven path: a developer types a word, sees a server-rendered row, clicks
it, and lands on the artifact's page. That path is broken today in a way no
amount of search quality would fix. `sourcePathFromUrl` (`packages.ts:268`)
unconditionally appends `/SKILL.md` to whatever URL segments it is handed, so
**531 of the 921 listed artifacts — 387 commands, 113 plugins, 16 hooks, 15 MCP
declarations — have rows, have findings, and 404**. A search result the user
cannot open does not complete the phase goal, so the detail route is a
prerequisite for the tracer, not a follow-up to it.

Output: an artifact-primary detail identity that resolves for all six types
while every existing skill URL keeps working; a `search_vector` generated STORED
column with its GIN index, applied to the live database; a `searchPackages`
query that reuses the listing predicate rather than restating it; and a
server-rendered `/artifacts` route that renders results for `?q=`.

Honours D-20/D-21 (generic detail route, stable identity, existing links
preserved), D-22/D-24/D-25 (per-type detail sections, no empty section to fill
space, no Skill-only wording), D-32 (do not re-derive dedup in the search
layer), D-36 (results exist in HTML before client JS), D-49 (agentdock schema
only, additive first).
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/phases/AGD-06-search-browse/06-CONTEXT.md
@.planning/phases/AGD-06-search-browse/06-RESEARCH.md
@.planning/phases/AGD-06-search-browse/06-PATTERNS.md
@.planning/phases/AGD-06-search-browse/06-VALIDATION.md
@src/db/queries/packages.ts
@src/db/queries/packages.test.ts
@src/db/schema.ts
@src/app/skills/page.tsx
@src/app/r/[owner]/[repo]/[...path]/page.tsx
@src/components/PackageRows.tsx
@scripts/check-boundaries.mjs
@scripts/migrate.mjs
</context>

<source_audit>
## Multi-Source Coverage Audit — whole phase, all four sources

**GOAL** (ROADMAP Phase 6 goal + six success criteria)

| Item | Plan | Status |
|---|---|---|
| Goal: a developer describing what they need finds the right artifact | 06-01 (tracer), 06-02, 06-03, 06-04 | COVERED |
| C1 plain-language query returns relevance-ranked results | 06-01 (tracer rank), 06-02 (full D-12 order) | COVERED |
| C2 a misspelled query still finds the right artifact | 06-04 | COVERED |
| C3 filter by artifact type and by declared capability incl. "no scripts, no network, no shell" | 06-03 | COVERED |
| C4 a zero-result query offers a useful next step | 06-03 | COVERED |
| C5 every query and its result count is logged | 06-03 | COVERED |
| C6 search runs entirely on PostgreSQL with no external service | 06-01 … 06-04 (prohibition in all four) | COVERED |

**REQ** (REQUIREMENTS.md, phase_req_ids)

| ID | Plan | Status |
|---|---|---|
| DIS-03 | 06-01, 06-02 | COVERED |
| DIS-04 | 06-04 | COVERED |
| DIS-05 | 06-03 | COVERED |
| DIS-06 | 06-03 | COVERED |
| DIS-07 | 06-03 | COVERED |
| DIS-08 | 06-03 | COVERED |
| DIS-10 | 06-01, 06-02, 06-03, 06-04 | COVERED |

**RESEARCH** (06-RESEARCH.md features, constraints and measured findings)

| Item | Plan | Status |
|---|---|---|
| Generated STORED tsvector, weights A=name B=summary C=path-split D=type | 06-01 T3 | COVERED |
| `to_tsvector` keeps a slash-delimited path whole — separators must be replaced | 06-01 Reference A | COVERED |
| Generated columns cannot reference another table — repository name matched separately | 06-02 T2 | COVERED |
| `websearch_to_tsquery`, never the operator-syntax parser | 06-02 T1 | COVERED |
| Empty tsquery matches nothing — browse must branch before the predicate | 06-02 T2 | COVERED |
| Literal-first / `/SKILL.md`-second detail lookup | 06-01 T2 | COVERED |
| `catalog` is already excluded by the listing predicate; lock it with a regression test | 06-03 T1 | COVERED |
| Offset pagination, measured flat at 37–40 ms at any offset | 06-02 T2 | COVERED |
| `NOT_LISTED_BECAUSE` in WHERE as well as SELECT (31× slowdown otherwise) | 06-01 T4, 06-02 | COVERED |
| DIS-06 triple-exclusion predicate, measured 97 ms, 708/921 pass | 06-03 T1 | COVERED |
| `SearchLog` as a third closed-union member of `src/log.ts` | 06-03 T2 | COVERED |
| Trigram index with `agentdock.gin_trgm_ops`, drizzle-kit spike-verified syntax | 06-04 T3 | COVERED |
| `DO $$ … RAISE EXCEPTION` pg_trgm guard as the migration's first statement | 06-04 T3 | COVERED |
| `SEARCH_CAPS` bounded coercion following the existing `pageParam` idiom | 06-02 T1 | COVERED |
| Next.js `redirects()` for `/skills` → `/artifacts` | 06-02 T3 | COVERED |
| gstack `browse` for the rendered pass, no new E2E framework | 06-03 T3 | COVERED |
| `TYPE_LABELS` needs the other five labels | 06-01 T2 | COVERED |
| A1 — 42883 catch at query time is ASSUMED, not live-tested | 06-04 (backstop truth) | COVERED |
| A2 — `redirects()` API shape not executed live | 06-02 T3 (fallback named) | COVERED |
| A3 — `maxQueryLength` value is discretion, 200 recommended | 06-02 T1 | COVERED |

**CONTEXT** (06-CONTEXT.md, D-01 … D-53)

| Decisions | Plan |
|---|---|
| D-01, D-02, D-10, D-43 | prohibitions in all four plans; D-43 stated in 06-02 |
| D-03, D-04, D-05 | 06-04 |
| D-06, D-11, D-12, D-15, D-16, D-37, D-45, D-46, D-47, D-48 | 06-01 T3/T4, 06-02 T2 |
| D-07, D-08, D-26, D-27, D-28, D-29, D-30 | 06-03 T1/T3 |
| D-09, D-40, D-41, D-42 | 06-02 T1 |
| D-13, D-14 | prohibitions in all four |
| D-17, D-18, D-19, D-35, D-36, D-50, D-51 | 06-02 T2/T3, 06-03 T3 |
| D-20, D-21, D-22, D-23, D-24, D-25, D-52 | 06-01 T2 |
| D-31, D-32, D-33 | 06-01 T1/T4, 06-03 T1 |
| D-34 | 06-03 T1 (regression test, no special-casing) |
| D-38, D-39, D-44, D-53 | 06-03 T2/T3 |
| D-49 | 06-01 T3, 06-04 T3 |

**Excluded, not gaps:** every entry in 06-CONTEXT.md § Deferred Ideas —
`artifactsTruncated` classification, the `jobs.test.ts` concurrency flake,
`repo_seed.discovered_from` provenance, the shape-only plugin live zero-case,
semantic/vector search, per-server MCP re-key, any move to the remote
`didim_api` instance.

**No item is MISSING.** The phase is planned in four plans rather than the
ROADMAP's three — the deviation, and why, is recorded under
`<roadmap_deviation>` below.
</source_audit>

<roadmap_deviation>
ROADMAP names three plans. This phase ships four, and the split is not a
re-decomposition of the work — it is one addition and one extraction.

**Added: the generic artifact detail route, folded into 06-01 with the search
vector.** It is a Phase 4/5 carried item the maintainer pulled into this phase,
it appears in no ROADMAP plan title, and the ROADMAP goal is unreachable without
it: today a search result for a `command`, `plugin`, `hook` or `mcp_server`
404s. RESEARCH proved the fix is narrow (`packages.ts:268-280`) and proved the
data supports it (zero `(repository_id, source_path)` collisions across types in
1,137 rows). Because the tracer must be end-to-end, and end-to-end includes
opening the result, the detail route lands in the same plan as the search vector
rather than after it.

**Extracted: the trigram fallback, from ROADMAP's 06-02 into its own 06-04.** It
is the only work in this phase that depends on an out-of-band superuser action
(`CREATE EXTENSION pg_trgm SCHEMA agentdock;`, D-03) and it carries its own
migration with its own hard failure mode (D-04). Leaving it inside the query
pipeline plan would make ranking, browse ordering and pagination — none of which
need the extension — blocked on an action AgentDock cannot perform. Split out,
the phase still delivers criteria 1, 3, 4, 5 and 6 if the extension install is
delayed, and criterion 2 lands the moment it is not.

ROADMAP's own 06-01 (`Generated search vector with weighted fields and GIN
index`) is entirely inside this plan's Task 3; its 06-02 minus trigram is
AGD-06-02; its 06-03 is AGD-06-03.
</roadmap_deviation>

<assumption_delta_decision>
**Noun that is now primary: `artifact`, not `skill`.**

Until this plan, detail identity was singular. `sourcePathFromUrl`
(`packages.ts:268-274`) assumes every detail URL resolves to a `SKILL.md`, and
`detailHref` (`packages.ts:277-280`) assumes every stored `source_path` ends in
one. The function's own comment names the assumption verbatim — *"One type, one
manifest filename, so the mapping is a suffix"* — and its own `ponytail:` note
records the intended exit: *"suffix mapping while there is one artifact type"*.
There are now six.

**Decision: `promote`.**

The general representation — the artifact's literal stored `source_path` — becomes
the primary identity, and `skill` becomes one variant handled by a
backward-compatibility branch. Concretely, `sourcePathFromUrl(segments) ->
string` is replaced by `sourcePathCandidates(segments) -> string[]` whose
**first** element is the literal join of the URL segments and whose second is the
`/SKILL.md` reconstruction, matched in that order with an explicit `ORDER BY`
that states the precedence. `detailHref` gains the artifact's `type` and returns
the literal `source_path` for every type except `skill`, which keeps its existing
prettier directory URL so no published link breaks.

Rationale: the alternative — keeping the skill path primary and bolting five
per-type suffix rules alongside it — is impossible, not merely undesirable, and
the live corpus proves it. A shape-only plugin's `source_path` is
`cli-tool/components`: a bare directory with **no manifest file at all**. There
is no filename to append, so "append this type's manifest filename" has no value
for that case and the add-alongside shape is unbuildable. RESEARCH's
spike-verified fix is exactly the promote shape and this plan adopts it
unchanged.

**Companion invariant test (adopted).** `src/db/queries/packages.test.ts` gains a
case that inserts one artifact of every one of the six types — including a
shape-only plugin with a bare directory `source_path` — and asserts each
round-trips `detailHref` → URL segments → `sourcePathCandidates` →
`getPackageDetail` back to the same row. It goes red the moment a future phase
reintroduces the skill-singular assumption in either direction.
</assumption_delta_decision>

<decisions_made_while_planning>

**1. The tracer is the whole slice, and the detail route is inside it.**

TRACER_MODE asks for the thinnest path that touches every layer, wired end to
end, verified before anything expands. For this phase that path is: schema →
query module → SSR route → detail route. Cutting the detail route out would give
a tracer that renders rows nobody can open, which is precisely the failure the
phase goal names. So Task 2 (detail route) and Task 3 (schema + migration) are
prerequisites inside the tracer plan, and Task 4 is the `type="tracer"` task that
wires them into one verifiable path.

**2. `sourcePathCandidates` returns two candidates and one ORDER BY decides.**

RESEARCH verified zero `(repository_id, source_path)` collisions *across types*
in the live corpus. It did not — and could not — rule out the different
collision this change creates: a repository holding both a literal `X` and a
skill at `X/SKILL.md`. Those are two distinct `source_path` values, so the
`package_identity` unique constraint permits both. One `inArray` with an
`ORDER BY case when source_path = <literal> then 0 else 1 end` makes the
precedence a stated decision in the query rather than a property of whichever row
the planner returned first. It costs two lines and removes a whole class of
"works today, flips after a VACUUM" bug.

**3. `detailHref` percent-encodes each path segment.**

Not decoration. `source_path` comes from a GitHub tree and today reaches the
`href` raw; a `#` or a `?` anywhere in a path silently truncates the URL. Every
existing skill directory in the corpus is `[A-Za-z0-9._-]/`-shaped, so encoding
each segment individually and rejoining with `/` leaves every current URL
byte-identical while removing the bug class. Segment-wise, not whole-string —
`encodeURIComponent` on the whole path would encode the separators and break
every link at once.

**4. The `type` weight replaces underscores before tokenizing.**

RESEARCH's verified expression weights `coalesce(type,'')` at D directly. Two of
the six type ids are `mcp_server` and — via the same parser — underscore-joined,
and RESEARCH verified separator behaviour only for `/` and `.`. Applying the same
`replace` to `_` is a one-token delta from the verified expression that makes a
search for `mcp server` reach `type = 'mcp_server'`. It is flagged as a delta,
and the task verifies the emitted lexemes live rather than assuming them.

**5. `NOT_LISTED_BECAUSE` is exported rather than re-derived, and that is a
one-word change.**

D-32 and RESEARCH Pattern 1 both require it; the fragment's own comment
(`packages.ts:203-208`) already explains why referencing one immutable descriptor
twice is the safe move and copying it is the unsafe one. Exporting it costs the
word `export`. The measured alternative — a second CASE, or the same CASE in
`SELECT` only — is a 31× slowdown at a late page offset (1,259 ms vs 37 ms) that
does not appear on page one, which is where casual testing looks.

**6. The Files section is gated on non-empty, and Install is gated to `skill`.**

D-24 says the file inventory renders only where it is meaningful, and D-22 says
not to force Skill-shaped UI onto other types. The Install block's copy is
literally `.claude/skills/${slug}/` — correct for a skill, wrong for a hook, and
INS-01 is not in this phase's requirements, so the honest move is to render
nothing rather than invent an install path. The existing "No files recorded yet."
placeholder goes with it; a hook whose artifact is one `settings.json` file has
no inventory to show and an empty table is the space-filling section D-24 names.

**7. This plan adds no search input, no filters and no pager.**

They are 06-02 and 06-03. The tracer's route reads `?q=`, renders rows, and stops.
Anything more is expansion, and expansion before the slice is proven is how a
phase discovers its architecture is wrong on its tenth commit instead of its
first.

</decisions_made_while_planning>

<reference>

## Reference A — the generated column and its index

Target DDL, quoted from 06-RESEARCH.md § Code Examples where it was executed live
against PostgreSQL 16.14 and rolled back, with the one delta named in decision 4:

```sql
ALTER TABLE "agentdock"."package" ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("name", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("summary", '')), 'B') ||
    setweight(to_tsvector('english',
      replace(replace(coalesce("source_path", ''), '/', ' '), '.', ' ')), 'C') ||
    setweight(to_tsvector('english', replace(coalesce("type", ''), '_', ' ')), 'D')
  ) STORED;
--> statement-breakpoint
CREATE INDEX "package_search_vector_idx" ON "agentdock"."package" USING gin ("search_vector");
```

The explicit `'english'` regconfig is load-bearing: `to_tsvector(text)` with no
regconfig is STABLE, not IMMUTABLE, and PostgreSQL refuses it in a generated
column. The two-argument form is IMMUTABLE and is what the live spike used.

Drizzle declaration in `src/db/schema.ts`, following the existing
`(t) => [ ... ]` index-array shape at `schema.ts:152-157`:

```ts
import { customType } from 'drizzle-orm/pg-core';

const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => 'tsvector',
});
```

The column is declared inside `packageTable`'s column object as
`searchVector: tsvector('search_vector').generatedAlwaysAs(sql\`...\`)` with the
expression above written as a `sql` template using bare, unqualified column
names (`name`, `summary`, `source_path`, `type`) — a generated expression is
resolved in its own table's scope, so no `t.` reference is available or needed.
The index joins the existing array:
`index('package_search_vector_idx').using('gin', t.searchVector)`.

The comment at `schema.ts:159-160` — *"No search_tsv column and no pg_trgm index
in this phase: pg_trgm is not installed in this instance and must not be
installed here."* — is a decision record this plan directly reverses for the
first half and leaves standing for the second. Rewrite it to say that the search
vector ships here and that `pg_trgm` is still installed out of band only, never
by a migration.

## Reference B — `sourcePathCandidates`, `detailHref`, `getPackageDetail`

Replaces `packages.ts:268-280` and adjusts `packages.ts:409-418`.

`sourcePathCandidates(segments: string[]): string[]` — joins the segments with
`/`; returns `['SKILL.md']` when the join is empty or is already exactly
`SKILL.md` (the root-manifest case the current function already handles);
otherwise returns `[joined, joined + '/SKILL.md']`, literal first.

`detailHref(fullName: string, sourcePath: string, type: string): string` — for
`type !== 'skill'`, the URL tail is the `source_path` verbatim; for
`type === 'skill'`, the existing `/(^|\/)SKILL\.md$/` strip and the empty-string
→ `SKILL.md` fallback are kept unchanged so every published skill URL is
byte-identical to what it is today. In both branches the tail is split on `/`,
each segment passed through `encodeURIComponent`, and rejoined with `/`
(decision 3).

`getPackageDetail` — the `eq(packageTable.sourcePath, sourcePathFromUrl(segments))`
predicate at `packages.ts:413` becomes `inArray(packageTable.sourcePath,
candidates)`, and the existing `.orderBy(desc(packageVersion.ingestedAt))` gains
a first key expressing the precedence: `sql\`case when
${packageTable.sourcePath} = ${candidates[0]} then 0 else 1 end\``. Everything
else about the function — the `isNull(delistedAt)` filter, the lowercased
`full_name` match, the `innerJoin`s, the `limit(1)` — is unchanged. It already
carries no `type` predicate and still needs none.

`NOT_LISTED_BECAUSE` at `packages.ts:127` gains the `export` keyword. Nothing
about its body changes.

## Reference C — `src/db/queries/search.ts` (tracer scope only)

Mirrors `packages.ts`'s import block and its `cache()`-wrapped arrow shape
(`packages.ts:164-177`). Imports `NOT_LISTED_BECAUSE` from `./packages`.

`SearchResultItem` = `PackageListItem` plus `rank: number`.

`searchPackages({ q, limit = 25, offset = 0 })` selects the same projection
`listPackages` does — including the correlated `commitSha` subquery at
`packages.ts:190-194`, copied idiom-for-idiom so a page of 25 rows is still one
statement — plus
`rank: sql<number>\`ts_rank(${packageTable.searchVector}, websearch_to_tsquery('english', ${q}))\``
and `notListedBecause: NOT_LISTED_BECAUSE`.

`.from(packageTable).innerJoin(repository, eq(packageTable.repositoryId,
repository.id))`, and a `WHERE` of exactly three conjuncts:
`isNull(packageTable.delistedAt)`,
`sql\`${packageTable.searchVector} @@ websearch_to_tsquery('english', ${q})\``,
and `sql\`${NOT_LISTED_BECAUSE} is null\`` — **the same imported fragment object,
in `WHERE` as well as `SELECT`**.

`ORDER BY rank DESC, ${packageTable.updatedAt} DESC, ${packageTable.id} ASC`
(D-15's deterministic tie-break), then `.limit(limit).offset(offset)`.

Query normalization, the empty-query browse branch, `SEARCH_CAPS`,
`countSearchResults`, the repository-name signal and the exact-name bonus are
**not** in this plan. 06-02 owns them. The tracer passes `q` straight into
`websearch_to_tsquery`, which RESEARCH proved never throws on any of thirteen
adversarial inputs — so the tracer is safe by construction even before 06-02
adds the caps.

## Reference D — `/artifacts` (tracer scope only)

`src/app/artifacts/page.tsx`, copying `src/app/skills/page.tsx`'s shape:
`export const dynamic = 'force-dynamic'`, `export const metadata = { title:
'Artifacts — AgentDock' }`, `const PAGE_SIZE = 25`, and the async
`searchParams: Promise<Record<string, string | string[] | undefined>>` signature
written by hand rather than taken from the generated route helper.

Tracer behaviour, and nothing more: read `q` from `searchParams`; when it is a
non-empty string, call `searchPackages({ q, limit: PAGE_SIZE })` and render
`<PackageRows items={...} />`; when it is absent or empty, call the existing
`listPackages({ limit: PAGE_SIZE })` and render the same component. One `<h1>`,
one count line, the rows. No form, no filters, no pager, no zero-result copy —
06-02 and 06-03 add those in place.

`src/app/skills/page.tsx` stays exactly as it is in this plan. The rename, the
redirect and the nav update are 06-02 Task 3, because deleting the only browse
route before the new one has a pager would leave the app less usable between two
commits.

## Reference E — the detail page's six labels and two gates

`src/app/r/[owner]/[repo]/[...path]/page.tsx:19`'s
`TYPE_LABELS: Record<string, string> = { skill: 'Agent Skill' }` gains the other
five, verbatim from the seeded `artifact_type.label` values in
`drizzle/0001_outstanding_the_santerians.sql:78` and
`drizzle/0003_flaky_selene.sql:16-22`:

| id | label |
|---|---|
| `skill` | Agent Skill |
| `plugin` | Claude Code Plugin |
| `catalog` | Plugin Marketplace |
| `mcp_server` | MCP Server |
| `command` | Slash Command |
| `hook` | Hook Configuration |

Two gates (decision 6): the whole `<h2>Install>` block — heading, copy and
`<dl>` — renders only when `detail.type === 'skill'`; the whole `<h2>Files</h2>`
block renders only when `detail.files.length > 0`, replacing the current
`No files recorded yet.` else-branch. Check `src/components/escaping.test.tsx`
and the panel tests before removing the placeholder — if one asserts on that
string, update the assertion in the same commit rather than leaving a
half-applied gate.

Everything else on this page is unchanged and must stay unchanged: `permalink`
and `permalinkAtLine` (D-23), `CapabilityPanel` / `HiddenContentPanel`, and the
`FILE_DISCLAIMER` / `CAPABILITY_INTRO` / `CAPABILITY_NOT_CHECKED` constants,
which are on `check-boundaries.mjs`'s `SANCTIONED` ledger by exact substring and
will fail rule 6 if a single character moves.

## Reference F — the search test suite's sentinel and hygiene

`src/db/queries/search.test.ts` follows `packages.test.ts:1-49` exactly:
`process.env.DATABASE_SCHEMA = 'agentdock_test'` before any import of the schema
module, `const DB_URL = process.env.DATABASE_URL`,
`describe.skipIf(!DB_URL)`, dynamic `await import()` inside `beforeAll`, and the
three-statement `clean()` that deletes `package_version` → `package` →
`repository` by `full_name LIKE '<prefix>%'`, called in `beforeAll`,
`beforeEach` and `afterAll`, with `sql.end()` in `afterAll`.

Its prefix is **`test-owner/search-spec`** — distinct from `listing-spec`,
`queue-spec`, `persist` and `corpus-spec`, because vitest runs test files in
parallel against the single test schema.

It inserts **no `ingest_job` row**, and says so in a comment: `claimJob` takes
the oldest claimable row schema-wide, and a stray queued row here is how
`jobs.test.ts`'s already-intermittent concurrency tests get blamed for a bug in
the queue.

</reference>

<tasks>

<task type="auto">
  <name>Task 1: The failing tests — six artifact types that do not open, and a search query that does not exist</name>
  <files>src/db/queries/packages.test.ts, src/db/queries/search.test.ts</files>
  <read_first>
    - src/db/queries/packages.test.ts (the whole file — its sentinel prefix, its clean()/beforeAll/afterAll shape, its existing COR-07 cases, and the comment explaining why it inserts no ingest_job row)
    - src/db/queries/packages.ts (sourcePathFromUrl:268-274, detailHref:277-280, getPackageDetail:376-421 — the three functions these tests pin)
    - src/db/schema.ts:107-201 (packageTable and packageVersion columns the fixtures must populate, including the package_identity unique constraint)
    - .planning/phases/AGD-06-search-browse/06-PATTERNS.md § `src/db/queries/search.test.ts` (the analog and the distinct-prefix requirement)
    - .planning/phases/AGD-06-search-browse/06-VALIDATION.md § Wave 0 Requirements
  </read_first>
  <precondition>DATABASE_URL is set and reaches a database whose agentdock_test schema is migrated; without it both suites skip visibly rather than fail, and this task's RED state cannot be observed.</precondition>
  <behavior>
    - packages.test.ts: a command at source_path `.claude/commands/build.md` opens — detailHref → URL segments → getPackageDetail returns that exact row.
    - packages.test.ts: a manifest-backed plugin at `.claude-plugin/plugin.json` opens.
    - packages.test.ts: a shape-only plugin at the bare directory `cli-tool/components`, with no manifest file in its path, opens.
    - packages.test.ts: a hook at `.claude/settings.json` opens.
    - packages.test.ts: an mcp_server at `.mcp.json` opens.
    - packages.test.ts: a skill at `skills/canvas-design/SKILL.md` opens, and its detailHref is byte-identical to the URL the current code produces — the regression case that proves no published link broke.
    - packages.test.ts: the round-trip invariant — for each of the six types, detailHref → split on '/' → sourcePathCandidates → getPackageDetail returns the same package id it started from.
    - packages.test.ts: when one repository holds both a command at `docs/guide` and a skill at `docs/guide/SKILL.md`, the URL `/r/{full}/docs/guide` resolves to the command, deterministically, across repeated calls.
    - search.test.ts: searchPackages returns a row whose name matches the query word.
    - search.test.ts: searchPackages returns a row whose summary — not name — contains the query word.
    - search.test.ts: searchPackages returns a row whose source_path segment matches the query word, proving the C-weight path split works.
    - search.test.ts: a query matching nothing returns an empty array, not a throw.
    - search.test.ts (COR-07): an artifact in a forked repository, an artifact whose latest version parse_status is 'failed', and the losing member of a byte-identical duplicate pair are each absent from searchPackages and each present in getRepositoryPackages for their own repository.
    - search.test.ts (COR-07): a row snapshot of package, package_version and repository taken before every search query is byte-identical afterward.
    - search.test.ts: parse_status = 'partial' is present in results and is not ordered below an otherwise equal 'ok' row.
  </behavior>
  <action>
    Apply Reference F for the new suite's skeleton, and extend the existing suite
    in place for the detail-route cases — `packages.test.ts` already owns the
    listing queries and already has the fixtures helpers; a second file for the
    same functions would need its own sentinel prefix for no gain.

    Write these RED, before Tasks 2 and 4 exist. `sourcePathCandidates` and
    `searchPackages` are not yet exported, so the suites will fail to import —
    that is the correct RED state and it is what makes Tasks 2 and 4 verifiable
    rather than self-reported. Import them by name anyway.

    Give the shape-only plugin fixture a bare directory `source_path` with no
    filename component and set `meta` to carry `detectionConfidence:
    'shape-only'`, matching what the live corpus holds — it is the case that
    proves an append-the-manifest-filename strategy is unbuildable, and it is
    also the case `NOT_LISTED_BECAUSE`'s duplicate branch deliberately excludes,
    so both properties are exercised by one fixture.

    For the byte-identical duplicate pair, give the two repositories different
    star counts so the tie-break is total and the assertion names which member
    survives rather than asserting "one of them".

    Take the row snapshot as a plain SELECT of the sentinel-prefixed rows into an
    array before and after, and compare the serialized forms. DAT-07's clause is
    that suppression can never corrupt stored data; a SELECT-only predicate
    satisfies that by construction, and "by construction" is the kind of claim
    this project has twice found untrue.

    Use the search-spec prefix everywhere in the new file and insert no
    ingest_job row anywhere in either suite.
  </action>
  <verify>
    <automated>bun run test -- src/db/queries/packages.test.ts src/db/queries/search.test.ts 2>&amp;1 | tail -30</automated>
  </verify>
  <acceptance_criteria>
    - `src/db/queries/search.test.ts` exists and `grep -c "test-owner/search-spec" src/db/queries/search.test.ts` is at least 1.
    - `grep -c "test-owner/listing-spec" src/db/queries/search.test.ts` is 0 — the new suite does not borrow the existing prefix.
    - `grep -c "ingest_job" src/db/queries/search.test.ts` is 0.
    - `grep -c "describe.skipIf" src/db/queries/search.test.ts` is at least 1.
    - `bun run test -- src/db/queries/packages.test.ts src/db/queries/search.test.ts` FAILS with unresolved imports for `sourcePathCandidates` and `searchPackages`, and the run output is recorded in the SUMMARY as the RED baseline.
    - The six-type round-trip case names all six ids — `grep -o "'skill'\|'plugin'\|'catalog'\|'mcp_server'\|'command'\|'hook'" src/db/queries/packages.test.ts | sort -u | wc -l` is 6.
  </acceptance_criteria>
  <done>Two suites assert, in runnable form, that all six artifact types open at their own URL and that a search query respects COR-07 — and both fail, because neither the fixed identity function nor the search query exists yet.</done>
</task>

<task type="auto">
  <name>Task 2: Promote the artifact, demote the skill — one detail route for six types</name>
  <files>src/db/queries/packages.ts, src/components/PackageRows.tsx, src/app/r/[owner]/[repo]/[...path]/page.tsx</files>
  <read_first>
    - src/db/queries/packages.ts:261-280 (sourcePathFromUrl and detailHref, and the ponytail comment naming this exact exit) and :376-421 (getPackageDetail's WHERE and ORDER BY)
    - src/db/queries/packages.ts:11-23 (PackageListItem — `type` is already on it, so no query changes)
    - src/components/PackageRows.tsx:18-38 (the single detailHref call site)
    - src/app/r/[owner]/[repo]/[...path]/page.tsx:19-55 (TYPE_LABELS and the three SANCTIONED constants that must not move) and :178-248 (the Files and Install blocks being gated)
    - scripts/check-boundaries.mjs:285-347 (VERDICT_WORDS, the SANCTIONED exact-substring ledger, and how rule six scans JSX text runs)
    - drizzle/0001_outstanding_the_santerians.sql:78 and drizzle/0003_flaky_selene.sql:12-22 (the six seeded artifact_type labels, verbatim)
    - .planning/phases/AGD-06-search-browse/06-RESEARCH.md § "Generic Artifact Detail Route (D-20 / D-21)"
  </read_first>
  <reversibility rating="reversible">Non-skill detail URLs did not exist before this change (they 404), and every skill URL is preserved byte-for-byte, so reverting restores exactly today's behaviour with no published link orphaned.</reversibility>
  <behavior>
    - detailHref for a non-skill artifact returns `/r/{fullName}/{sourcePath}` with each path segment percent-encoded and the separators intact.
    - detailHref for a skill returns exactly the string the pre-change function returned, for every skill source_path shape in the corpus.
    - sourcePathCandidates(['SKILL.md']) and sourcePathCandidates([]) both return ['SKILL.md'].
    - sourcePathCandidates(['.claude','commands','build.md']) returns the literal join first and the SKILL.md reconstruction second.
    - getPackageDetail resolves a literal match in preference to a SKILL.md reconstruction when a repository holds both.
    - The detail page shows a human label for all six types, not the raw id.
    - The Install block is absent from the rendered HTML for a non-skill artifact.
    - The Files block is absent entirely when the inventory is empty, rather than rendering a placeholder sentence.
  </behavior>
  <action>
    Apply Reference B and Reference E.

    Rename the function rather than adding a second one beside it. `packages.ts`'s
    own comment says the mapping is a suffix "while there is one artifact type",
    and there are six; leaving `sourcePathFromUrl` exported alongside the new
    function preserves the broken path for a future caller to find and reuse. The
    rename is caught by the type checker at every call site, which is exactly one
    (`packages.ts:413`).

    Match literally first and reconstruct second, and state the precedence in the
    ORDER BY. Do not add a `type` predicate to `getPackageDetail` — it has never
    had one, resolution has always been on `(repository, source_path)`, and adding
    one would make the function need information the URL does not carry.

    Encode each path segment separately, never the whole tail. Encoding the whole
    string encodes the separators and breaks every link at once.

    Thread `p.type` through `PackageRows.tsx`'s single call site. The field is
    already on `PackageListItem`, so this is a plumbing change and no query
    changes.

    Copy the five new labels from the seeded rows character for character. They
    are the product's own vocabulary and inventing a synonym here would put two
    different names for one type on two different pages.

    Gate Install to skill and Files to non-empty. Do not invent install paths for
    the other five types — INS-01 is not in this phase and a fabricated path is
    worse than an absent section. Before deleting the "No files recorded yet."
    branch, grep the component and page tests for that exact sentence and update
    any assertion in the same commit.

    Run check:boundaries before considering the page finished. Rule six excises
    the three SANCTIONED constants by exact substring; a reflowed line or a
    changed character in any of them turns a passing scan into a failing one for
    reasons that read as unrelated.
  </action>
  <verify>
    <automated>bun run test -- src/db/queries/packages.test.ts &amp;&amp; bun run check:boundaries &amp;&amp; bun run typecheck &amp;&amp; bun run lint</automated>
  </verify>
  <acceptance_criteria>
    - `bun run test -- src/db/queries/packages.test.ts` passes, including all six round-trip cases and the skill regression case, where it failed in Task 1.
    - Comment-filtered — `grep -rhv '^\s*[/*]' --include='*.ts' --include='*.tsx' src/ | grep -c 'sourcePathFromUrl'` is 0 — the old name survives in no executable line anywhere in `src/`. <!-- planner-discipline-allow: sourcePathFromUrl -->
    - `grep -rc 'sourcePathFromUrl' src/db/queries/packages.ts` counts at most one occurrence, and if one exists it is inside a comment recording the rename.
    - `grep -c 'export function sourcePathCandidates' src/db/queries/packages.ts` is 1.
    - `grep -c 'detailHref(p.fullName, p.sourcePath, p.type)' src/components/PackageRows.tsx` is 1.
    - `grep -oE "'(skill|plugin|catalog|mcp_server|command|hook)':" 'src/app/r/[owner]/[repo]/[...path]/page.tsx' | sort -u | wc -l` is 6.
    - `bun run check:boundaries` exits 0, proving the three SANCTIONED substrings are intact and no verdict word entered the new labels.
    - A live curl against `bun run dev` returns HTTP 200 for one real detail URL of each of the six types taken from the live corpus, and the six URLs and their status codes are recorded in the SUMMARY.
  </acceptance_criteria>
  <done>Every artifact type opens at its own URL, every skill URL that worked yesterday works today with the same string, and a repository holding both a literal path and a skill beneath it resolves to the literal one by a rule stated in the query.</done>
</task>

<task type="auto">
  <name>Task 3: [BLOCKING] The search vector column, generated, indexed and applied to the live database</name>
  <files>src/db/schema.ts, drizzle/</files>
  <read_first>
    - src/db/schema.ts:107-160 (packageTable's columns, its `(t) => [...]` index array, and the comment at 159-160 this task reverses)
    - drizzle/0005_rainy_saracen.sql (the most recent migration — statement-breakpoint convention, schema-qualified targets, additive-only shape)
    - drizzle/0003_flaky_selene.sql:12-22 (the sanctioned hand-edit-after-generate precedent, and the comment explaining why the meta snapshot stays correct)
    - scripts/migrate.mjs:65-95 (one transaction per run, so a failing statement rolls the whole batch back)
    - scripts/check-boundaries.mjs:26-49 (DESTRUCTIVE, ALLOWED_SCHEMAS, and the qualified-target rules the new SQL must satisfy)
    - .planning/phases/AGD-06-search-browse/06-RESEARCH.md § "Generated column, confirmed working live" and § Code Examples
  </read_first>
  <precondition>DATABASE_URL points at the live agentdock schema owned by agentdock_app, and `bun run db:migrate` is the project's migrator — `drizzle-kit migrate` and `drizzle-kit push` are both unusable here (Phase 0: the emitted CREATE SCHEMA fails 42501 for this correctly-confined role).</precondition>
  <reversibility rating="costly">A generated STORED column can only be removed by DROP COLUMN, which this project's boundary scanner classes destructive and which needs an explicit review marker; reversal is possible through the sanctioned path but is not free.</reversibility>
  <action>
    Apply Reference A.

    Declare the column and the index in `src/db/schema.ts` first, then generate,
    then review, then apply — the order D-49 names. Use `bun run db:generate`;
    `bun run db:migrate` is the only apply command in this project, and neither
    `drizzle-kit migrate` nor `drizzle-kit push` may be used for the reason
    recorded in Phase 0 and enforced by `check-boundaries.mjs` rule four.

    Read the emitted SQL line by line against Reference A's target DDL before
    applying anything. drizzle-kit's handling of a generated column over a
    `customType` is not spike-verified in this project, unlike the trigram index
    syntax, so treat a mismatch as expected rather than surprising. If the emitted
    statement differs in a way that changes meaning — a missing `STORED`, a
    dropped `setweight`, an unqualified target, a wrong regconfig — hand-correct
    the generated `.sql` file to match Reference A exactly and record what drizzle
    emitted and what you changed. `drizzle/0003_flaky_selene.sql:12-14` is the
    project's own precedent for exactly this, and it also records why the
    `drizzle/meta` snapshot stays correct afterward.

    Verify the emitted lexemes live before trusting the weights. Query
    `to_tsvector` over one real `source_path` and one real `type` value from the
    corpus and confirm the C-weight path is split into separate lexemes and the
    D-weight type is too — the underscore replacement in the type weight is this
    plan's one delta from the verified expression (decision 4) and it is either
    true or it is not.

    Apply to both databases: `bun run db:migrate` for `agentdock`, then
    `bun run db:test:generate && bun run db:test:migrate` for `agentdock_test`,
    or the test suites in Task 4 will fail against a schema that lacks the column
    while `bun run typecheck` passes — Drizzle's types come from the schema file,
    not from the live database, so a build and a type check both stay green
    without the migration. That false-positive is the whole reason this task is
    blocking.

    Record `EXPLAIN (ANALYZE, BUFFERS)` for a `search_vector @@
    websearch_to_tsquery('english','mcp')` query against the live corpus, with
    the row count it ran against, and state whether the plan used
    `package_search_vector_idx` or a sequential scan. RESEARCH measured ad-hoc
    FTS at 32.3 ms with no column and no index at this corpus size; a planner
    that declines the GIN index at 1,137 rows is a fact about corpus size, and
    recording it is what makes the index a measurement rather than an intuition.

    Rewrite the decision-record comment at `schema.ts:159-160`. Leaving it in
    place would have the schema file contradict itself: the search vector now
    ships, and `pg_trgm` is still installed out of band only and never by a
    migration.
  </action>
  <verify>
    <automated>bun run db:generate &amp;&amp; bun run check:boundaries &amp;&amp; bun run db:migrate &amp;&amp; bun run db:test:generate &amp;&amp; bun run db:test:migrate &amp;&amp; bun run typecheck</automated>
  </verify>
  <acceptance_criteria>
    - A new file exists under `drizzle/` whose text contains `GENERATED ALWAYS AS`, `STORED`, all four `setweight` calls with weights A, B, C and D, and `USING gin`.
    - `grep -ciE '\b(DROP|TRUNCATE|GRANT|REVOKE|CREATE\s+EXTENSION|CREATE\s+SCHEMA|CREATE\s+DATABASE)\b' drizzle/000*_*.sql` counts zero new occurrences relative to the pre-task baseline, and `bun run check:boundaries` exits 0.
    - `grep -c 'didim_mcp\|"public"\.' drizzle/` over the new migration is 0 — every target is `"agentdock"."package"`.
    - Live query `select count(*) from agentdock.package where search_vector is not null` returns the full package count with no application backfill having run, and the number is recorded in the SUMMARY.
    - Live query `select indexname from pg_indexes where schemaname='agentdock' and indexname='package_search_vector_idx'` returns one row.
    - Live query over one real corpus `source_path` shows the `/` and `.` separated components as distinct lexemes, and over `'mcp_server'` shows `mcp` and `server` as distinct lexemes; both outputs are recorded verbatim in the SUMMARY.
    - The `EXPLAIN (ANALYZE, BUFFERS)` output for the FTS predicate is recorded in the SUMMARY with its execution time, the corpus row count, and whether the GIN index was chosen.
    - `agentdock_test` has the same column and index, proven by the same two queries run against that schema.
  </acceptance_criteria>
  <done>`agentdock.package` carries a STORED, weighted `search_vector` maintained by PostgreSQL with no application code, indexed by `package_search_vector_idx`, applied to both the live and the test schema through this project's own migrator — and the cost of querying it is a recorded EXPLAIN rather than an assumption.</done>
</task>

<task type="tracer">
  <name>Task 4: End-to-end — one word finds one artifact and the artifact opens</name>
  <files>src/db/queries/search.ts, src/app/artifacts/page.tsx, src/db/queries/packages.ts</files>
  <read_first>
    - src/db/queries/packages.ts:127-238 (NOT_LISTED_BECAUSE, listPackages and countPackages — the projection to copy, the fragment to import, and the comment at 203-208 explaining why one object is referenced twice)
    - src/app/skills/page.tsx (the whole file — force-dynamic, the hand-written searchParams type, PAGE_SIZE, and the two existing empty-state branches)
    - src/components/PackageRows.tsx (the component the route renders, now type-aware)
    - src/db/queries/search.test.ts (the assertions written in Task 1 that this task must turn green)
    - .planning/phases/AGD-06-search-browse/06-RESEARCH.md § "Pattern 1: Reuse-not-restate the listing predicate" and § "Anti-Patterns to Avoid"
  </read_first>
  <precondition>Task 3's migration is applied to both agentdock and agentdock_test — `packageTable.searchVector` type-checks without it, so a green typecheck is not evidence the column exists.</precondition>
  <action>
    Apply References C and D. Wire ONE path through every layer this phase
    touches — schema column, query module, server component, detail route — and
    no other call site.

    Import `NOT_LISTED_BECAUSE` from `./packages` and reference that one object in
    both the projection and the `WHERE`. Do not copy the CASE, do not write a
    second fork/duplicate/unparsed test, and do not compute it in `SELECT` only:
    the measured cost of that last mistake is 1,259 ms against 37 ms at a late
    page offset, and it does not show up on page one.

    Copy the correlated `commitSha` subquery idiom from `packages.ts:190-194`
    rather than joining `package_version` and grouping. One scalar per row, one
    statement, no per-row query — D-47 asks for the query count and this is how
    it stays at one.

    Order by rank, then `updated_at` descending, then id ascending. The tie-break
    is not decoration: without a total order, repeating the same query
    reshuffles equal-ranked rows and a paginator built on it skips and repeats
    rows across pages (D-15, D-16).

    Keep the route to the tracer's scope. No search input, no filters, no pager,
    no zero-result copy, no logging — those are 06-02 and 06-03, and adding them
    here is the horizontal expansion this task exists to precede. Leave
    `src/app/skills/page.tsx` untouched; 06-02 owns the rename and the redirect.

    Take the shipped SQL from Drizzle's own `.toSQL()` output, not from a retyped
    query, and record `EXPLAIN (ANALYZE, BUFFERS)` for it at the real corpus size
    with the row count beside it. A timing without a row count is not a
    measurement.

    Prove the slice end to end in a real browser process, not only in tests: start
    the dev server, request `/artifacts?q=mcp`, confirm result rows are present in
    the raw HTML body before any JavaScript executes, take one non-skill result's
    href straight out of that HTML, request it, and confirm 200. That single
    round trip — query to rendered row to opened artifact — is the tracer, and it
    is what every later plan expands from.
  </action>
  <verify>
    <automated>bun run test -- src/db/queries/search.test.ts src/db/queries/packages.test.ts &amp;&amp; bun run typecheck &amp;&amp; bun run lint &amp;&amp; bun run check:boundaries</automated>
  </verify>
  <acceptance_criteria>
    - `bun run test -- src/db/queries/search.test.ts` passes every case written in Task 1, including the three COR-07 suppression cases, the row-snapshot case and the `partial`-is-not-penalised case.
    - `grep -c "from './packages'" src/db/queries/search.ts` is at least 1 and the import list contains `NOT_LISTED_BECAUSE`.
    - `grep -v '^\s*[/*]' src/db/queries/search.ts | grep -c 'case$\|when .* then' ` is 0 — the listing CASE appears nowhere in this file, only the imported reference to it.
    - `grep -v '^\s*[/*]' src/db/queries/search.ts | grep -c 'NOT_LISTED_BECAUSE'` is at least 2 — projection and predicate both.
    - `grep -v '^\s*[/*]' src/db/queries/search.ts | grep -oE '[a-zA-Z_]*to_tsquery' | sort -u` outputs exactly `websearch_to_tsquery` and nothing else.
    - `curl -s 'http://localhost:3000/artifacts?q=mcp'` returns HTTP 200 and its raw body contains at least one `<li>` from `PackageRows` with an `/r/` href; the count of result rows in the raw HTML is recorded in the SUMMARY.
    - A non-skill href extracted verbatim from that HTML returns HTTP 200 when requested, and the URL, the artifact type and the status code are recorded in the SUMMARY.
    - `EXPLAIN (ANALYZE, BUFFERS)` of the shipped search SQL from `.toSQL()` is recorded with its execution time and the corpus row count.
    - `git diff --stat` shows no change to `package.json` — no dependency was added.
  </acceptance_criteria>
  <done>A request for `/artifacts?q=mcp` returns server-rendered result rows in the HTML, one of them is a non-skill artifact, and following its link opens that artifact's page — the whole phase's path, proven on one word, with the listing predicate shared rather than copied and the cost recorded.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| URL path segments → `getPackageDetail`'s `source_path` predicate | Untrusted, arbitrary-depth catch-all segments become a SQL equality operand |
| `?q=` → the full-text predicate | Untrusted free text reaches a PostgreSQL text-search function |
| stored `source_path` / `name` / `summary` → rendered HTML | Third-party repository content rendered on a page |
| the listing predicate → stored rows | COR-07 and DAT-07 both require suppression to be read-only |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-06-01 | Tampering | `?q=` reaching the text-search parser | high | mitigate | `websearch_to_tsquery` only, passed as a bound Drizzle parameter, never string-concatenated. RESEARCH proved live that the operator-syntax parser raises `syntax error in tsquery` on 5 of 13 adversarial inputs and that `websearch_to_tsquery` raises on none of them, including `'; DROP TABLE package; --`, which produces only lexemes. An allowlist grep in Task 4's acceptance criteria asserts no other parser name appears in `search.ts`. |
| T-06-02 | Tampering | catch-all URL segments → `source_path` | high | mitigate | `source_path` reaches no filesystem API anywhere in this codebase — it is only ever a SQL equality operand and a GitHub URL component. `inArray` binds both candidates as parameters. Next.js decodes and arrays the segments before the handler runs, so no traversal string survives as a path. Task 1's round-trip case pins the behaviour for all six types. |
| T-06-03 | Tampering | the listing predicate writing to a stored row | high | mitigate | `SELECT`-only by construction, proven by Task 1's before-and-after row snapshot rather than by the construction argument — the same discipline Phase 5 applied to `listPackages`. |
| T-06-04 | Information Disclosure | a suppressed artifact reappearing in global search | high | mitigate | `search.ts` imports and references the one `NOT_LISTED_BECAUSE` object in both projection and predicate; three COR-07 cases in `search.test.ts` assert fork, unparsed and duplicate rows are absent from search and present at their repository route. |
| T-06-05 | Tampering / XSS | repository-controlled `name`, `summary` and `source_path` in result rows and labels | medium | mitigate | Rendered as plain JSX text nodes, which React escapes; `PackageRows` is unchanged except for one added argument; `check-boundaries.mjs` rule 5 (`no-raw-html`) and rule 6 (`no-verdict-vocabulary`) both run in Tasks 2 and 4's verify commands. |
| T-06-06 | Denial of Service | an unbounded `?q=` doing pointless work | medium | accept | Accepted for this plan only. RESEARCH measured a 5,000-character query as harmless (`websearch_to_tsquery` degrades gracefully, one word ignored), and 06-02 Task 1 adds `SEARCH_CAPS.maxQueryLength` as the cost control. Recorded here so the gap is a decision with a closing plan rather than an omission. |
| T-06-07 | Information Disclosure | a raw Postgres error reaching the page on a search failure | medium | mitigate | No new failure mode is introduced: the tracer's only new DB call sits behind the same server-component boundary every other DB-backed page already uses, and `websearch_to_tsquery` was proven not to throw. 06-02 Task 1 adds the explicit user-error/internal-error split D-42 asks for. |
| T-06-08 | Tampering | a migration reaching outside the owned schema | high | mitigate | Every target in the generated SQL is `"agentdock"."package"`; `check-boundaries.mjs` rules 1–3 run in Task 3's verify command and the acceptance criteria grep the new migration for destructive verbs and for `public`/`didim_mcp` by name. |
| T-06-SC | Tampering | npm/pip/cargo installs | high | mitigate | Not applicable and asserted, not assumed: this plan installs no package. RESEARCH's Package Legitimacy Audit records that the phase adds no npm dependency, and Task 4's acceptance criteria assert `git diff --stat` shows no `package.json` change. |
</threat_model>

<artifacts_this_phase_produces>
Symbols this plan creates — new, not pre-existing, and therefore excluded from
drift verification against the prior codebase:

**Functions and types**
- `sourcePathCandidates(segments: string[]): string[]` — `src/db/queries/packages.ts` (replaces `sourcePathFromUrl`)
- `detailHref(fullName: string, sourcePath: string, type: string): string` — `src/db/queries/packages.ts` (signature change: third parameter added)
- `NOT_LISTED_BECAUSE` — `src/db/queries/packages.ts` (newly exported; body unchanged)
- `searchPackages({ q, limit, offset })` — `src/db/queries/search.ts`
- `SearchResultItem` — `src/db/queries/search.ts`
- `tsvector` — `src/db/schema.ts` (module-local `customType` helper)

**New file paths**
- `src/db/queries/search.ts`
- `src/db/queries/search.test.ts`
- `src/app/artifacts/page.tsx`
- `drizzle/0006_*.sql` (name assigned by `drizzle-kit generate`)

**New route segments**
- `/artifacts` (search + browse, server component)

**New SQL identifiers**
- column `agentdock.package.search_vector` (tsvector, GENERATED ALWAYS AS … STORED)
- index `package_search_vector_idx` (GIN on `search_vector`)

**New Drizzle schema members**
- `packageTable.searchVector`

**New CLI or package scripts:** none.
</artifacts_this_phase_produces>

<verification>
1. All six artifact types open at their own detail URL, proven by a round-trip test and by six live HTTP 200s against the real corpus.
2. Every skill detail URL is byte-identical before and after, proven by a regression case.
3. A repository holding both a literal path and a skill beneath it resolves to the literal one, deterministically, by a stated `ORDER BY`.
4. `sourcePathFromUrl` exists nowhere in `src/`.
5. `agentdock.package.search_vector` is a populated STORED generated column on both the live and the test schema, with `package_search_vector_idx` present on both.
6. The generated migration contains no destructive verb, names no schema but `agentdock`, and `bun run check:boundaries` exits 0.
7. `search.ts` contains no second listing CASE and references the imported `NOT_LISTED_BECAUSE` in both projection and predicate.
8. The only text-search parser name in `search.ts` is `websearch_to_tsquery`.
9. `/artifacts?q=mcp` returns 200 with result rows present in the raw HTML before client JavaScript runs.
10. A non-skill href taken from that HTML returns 200.
11. A row snapshot before and after every search query is byte-identical.
12. `EXPLAIN (ANALYZE, BUFFERS)` is recorded for both the FTS predicate and the shipped search SQL, each with the corpus row count.
13. `package.json` is unchanged.
14. `bun run ci` passes.
</verification>

<success_criteria>
- **DIS-03** — a full-text query returns ranked results from a weighted, indexed `tsvector`, ordered deterministically.
- **DIS-10** — search runs on PostgreSQL alone; no dependency, no service, no `/api/search`.
- **D-20 / D-21 / D-22 / D-24 / D-25** — one detail route resolves for all six artifact types, identity is artifact-primary and stable, existing links are preserved, and no Skill-shaped section is forced onto another type.
- **D-23** — `permalink` and `permalinkAtLine` are untouched, so Phase 4's provenance contract survives the route generalization.
- **D-31 / D-32 / D-33** — suppression holds in search, dedup is not re-derived, and the repository route stays bypass-free.
- **D-49** — the migration is additive, schema-qualified, boundary-clean, and applied through `scripts/migrate.mjs`.
- ROADMAP criteria 1 and 6, and the phase goal's `discover → open` leg.
</success_criteria>

<output>
Create `.planning/phases/AGD-06-search-browse/06-01-SUMMARY.md` when done.

Record: the RED baseline output from Task 1 verbatim; the six live detail URLs
(one per artifact type) with their HTTP status codes; what `drizzle-kit
generate` emitted for the generated column and what, if anything, was
hand-corrected; the live `to_tsvector` lexeme output for one real `source_path`
and for `'mcp_server'`; the populated `search_vector` row count; both
`EXPLAIN (ANALYZE, BUFFERS)` outputs with their corpus row counts and whether
the GIN index was chosen; the number of result rows found in the raw
`/artifacts?q=mcp` HTML; and the non-skill href that was followed to 200.
Record no credential and no connection string.

Commits follow GSD's atomic-commit protocol on `develop`. **Do not `git push`,
do not change `main`, and make no remote change of any kind.**
</output>
</content>
</invoke>
