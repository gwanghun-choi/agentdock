---
phase: AGD-06-search-browse
plan: 02
type: execute
wave: 2
depends_on: [06-01]
files_modified:
  - src/db/queries/search.ts
  - src/db/queries/search.test.ts
  - src/app/artifacts/page.tsx
  - src/app/skills/page.tsx
  - src/app/layout.tsx
  - src/app/page.tsx
  - next.config.ts
  - src/app/globals.css
autonomous: true
requirements: [DIS-03, DIS-10]

estimate:
  tokens: 110000
  raw_tokens: 110000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "An exact artifact-name query ranks that artifact first, above every artifact that merely mentions the word in its description"
    - "A name-prefix match ranks above a description-only match, and a description match ranks above a repository-name-only match — D-12's stated order, asserted as three separate comparisons"
    - "Repeating the same query twice returns the same rows in the same order, including for rows whose relevance score is equal"
    - "Across two adjacent pages of the same query no package id appears twice and no package id present in the unpaginated result is missing"
    - "An absent q parameter, an empty q, and a whitespace-only q all render the full browse listing ordered by updated_at DESC then id ASC, and the full-text predicate is never applied on that path"
    - "A single-character query and a q supplied twice as a repeated URL parameter each return HTTP 200 and a coherent page, never a 500 and never NaN in the paginator"
    - "The query length cap is applied to the JavaScript string length in UTF-16 code units after trim and whitespace collapse, and an over-length query is truncated to the cap rather than rejected"
    - "Queries of emoji, Korean text, a 5,000-character string, an unbalanced quote, an unclosed parenthesis, and a literal SQL-injection string each return HTTP 200 with no stack trace, no raw Postgres error text and no 500"
    - "mcp and MCP return identical result sets and identical ordering"
    - "The paginator's total and its rows come from two separate statements, so a concurrent ingest between them can make the total disagree with the rows; the page renders the existing 'There is no page N' branch in that case rather than a false 'Showing 26-25 of 18' range"
    - "GET /skills returns a redirect to /artifacts, and no route in the application links to /skills any more"
    - "The search input and every filter control is reachable and submittable by keyboard alone with no JavaScript, and each carries a programmatically associated label"
    - "package.json gains no dependency and no devDependency in this plan"
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
    - statement: "No /api/search route, and no REST layer for a hypothetical future consumer (D-43)"
      status: flagged
      verification: unverified
    - statement: "No synonym expansion, no query rewriting, no term fan-out; the FTS tokenizer's stemming is the only permitted linguistic widening (D-10, D-11)"
      status: flagged
      verification: unverified
  artifacts:
    - path: "src/db/queries/search.ts"
      provides: "The query pipeline: bounded normalization, the D-12 ranking order, the browse branch that never touches the full-text predicate, and offset pagination with a total order"
      exports: ["searchPackages", "countSearchResults", "normalizeQuery", "SEARCH_CAPS", "SearchResultItem"]
      min_lines: 120
    - path: "src/app/artifacts/page.tsx"
      provides: "The server-rendered search and browse surface: a GET form, bounded zod coercion for q and page, three distinct empty states, and a pager that carries query state"
      min_lines: 110
    - path: "next.config.ts"
      provides: "The /skills → /artifacts redirect, so no inbound link to the misnamed route breaks"
  key_links:
    - from: "src/app/artifacts/page.tsx"
      to: "src/db/queries/search.ts"
      via: "SEARCH_CAPS.pageSize is the single source of the page size for the route, the query and the paginator, so the three cannot disagree about where a page ends"
      pattern: "SEARCH_CAPS"
    - from: "src/app/artifacts/page.tsx"
      to: "the address bar"
      via: "q and page live only in searchParams; the pager's hrefs re-emit them, so refresh, back and a pasted link all restore the same page"
      pattern: "searchParams"
    - from: "next.config.ts"
      to: "src/app/artifacts/page.tsx"
      via: "the redirect keeps every published /skills link resolving after the rename"
      pattern: "/artifacts"
---

<objective>
Turn the tracer's one working path into a query pipeline that is bounded,
explainable and safe on input nobody sanitized.

Purpose: 06-01 proved a word can reach an artifact. This plan makes the ranking
match D-12's stated order rather than whatever `ts_rank` happens to produce,
makes browse mode work at all — an empty text-search query matches *nothing*,
proven live, so a route that applies the predicate unconditionally shows an
empty corpus — and makes the abnormal case bounded rather than merely
unmeasured. It also completes the rename D-19 asks for: `/skills` has listed six
artifact types since Phase 3 and the name has been a false statement ever since.

Output: `normalizeQuery` and a `SEARCH_CAPS` object following this project's
existing caps convention; a ranking expression whose terms a reader can put in
one-to-one correspondence with D-12's list; a browse branch that skips the
full-text predicate entirely; offset pagination with a total order; a
server-rendered GET form; three distinct empty states; and `/skills` redirecting
to `/artifacts` with no link left behind.

Honours D-09 (trim, collapse, case-insensitive, and nothing else), D-10/D-11 (no
synonyms, no rewriting, stemming only), D-12 (explainable signal order), D-13
(no quality or safety proxy in the ranking), D-14 (`partial` is not penalised),
D-15/D-16 (stable order, identical for list and pagination), D-17/D-18 (browse
ordering defined separately, empty query never errors and never scans blindly),
D-19 (rename with the inbound links preserved), D-35/D-36 (URL is the state, HTML
before JS), D-37 (offset, decided by measurement), D-40/D-41/D-42 (untrusted
input, bounded, and errors that do not leak), D-43 (no API route), D-50 (labelled
controls, keyboard submit, visible focus).
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/phases/AGD-06-search-browse/06-CONTEXT.md
@.planning/phases/AGD-06-search-browse/06-RESEARCH.md
@.planning/phases/AGD-06-search-browse/06-PATTERNS.md
@.planning/phases/AGD-06-search-browse/06-01-SUMMARY.md
@src/db/queries/search.ts
@src/db/queries/packages.ts
@src/app/artifacts/page.tsx
@src/app/skills/page.tsx
@src/app/layout.tsx
@src/app/page.tsx
@next.config.ts
@src/github/scan.ts
</context>

<decisions_made_while_planning>

**1. The ranking is four additive terms, one per D-12 signal, and each is
readable on its own line.**

D-12 names the order: exact name match → prefix / name similarity →
description/text relevance → repository name match → freshness. The simplest
expression that respects that order and stays explainable is a sum whose term
magnitudes are separated, not a weighted blend whose behaviour nobody can
predict: an exact lowercased name equality contributes 2.0, a lowercased name
prefix contributes 1.0, `ts_rank` over the weighted vector contributes its own
value, and a repository full-name containment contributes 0.1. `ts_rank`'s
practical ceiling for a single-term hit at weight A is about 0.6, so the two
constants above it are separations rather than nudges — an exact name match
cannot be outranked by any amount of description relevance, which is exactly
what D-12's ordering asserts. Freshness, D-12's last slot, is the `updated_at`
tie-break rather than a fifth term: adding a decaying score would make two
artifacts' relative order depend on when the query ran.

RESEARCH's own recommendation for the repository-name term is "a small ranking
bonus applied after the primary score, strictly lower-priority than
name/description matches" (Open Question 2). 0.1 is that, stated as a named
constant beside the expression rather than a magic number inside it.

**2. Repository name is matched with `ILIKE`, escaped, and only 16 rows deep.**

The generated column cannot carry it — PostgreSQL refuses a subquery in a
generation expression, confirmed live with `ERROR: cannot use subquery in column
generation expression`. Sixteen repositories is not a scan worth indexing, and
D-46 forbids indexing on intuition. The escape is not optional: `%` and `_` are
`LIKE` metacharacters, so an unescaped `%` in a query turns a containment test
into a match-everything test. `replace(replace(input,'%','\%'),'_','\_')` is the
form RESEARCH verified live.

**3. Browse mode branches before the predicate is built, not inside it.**

`to_tsvector('english','mcp server') @@ websearch_to_tsquery('english','')`
returns false — proven live. An empty query does not match everything; it
matches nothing. So a route that always applies `@@` renders an empty corpus for
every visitor who has not typed anything yet, and the failure looks exactly like
a correct zero-result page. The branch is in `searchPackages`, on the normalized
query being empty, and on that branch the function delegates its ordering to
`updated_at DESC, id ASC` — the same order `listPackages` already uses, so browse
and search do not disagree about what "recent" means. Never popularity (D-17).

**4. Over-length queries are truncated, not rejected.**

D-41 asks for the abnormal case to be bounded. A rejection needs an error state,
an error message and a decision about what the page shows instead; a truncation
needs one `slice`. RESEARCH measured a 5,000-character query as harmless to
`websearch_to_tsquery` — one word gets ignored — so the cap is a cost control,
not a crash prevention, and the cheapest bound that actually bounds is the right
one. The cap is measured in JavaScript string length, which is UTF-16 code
units: an emoji outside the BMP counts as two. That is stated in the constant's
comment because "length" has four plausible meanings here and picking one
silently is how a Korean query and an emoji query end up with different
effective limits than an ASCII one.

**5. Offset pagination, and the measurement that decided it is already taken.**

D-37 says pick the simpler one on the merits. RESEARCH measured the listing query
at 40.3 ms at offset 0 and **37.3 ms at offset 900** of 921 rows — no measurable
degradation. Keyset would buy nothing at this corpus size and would cost cursor
encoding plus threading a three-column tie-break through that cursor. This plan
re-measures a late page of the *search* query, because the search query is not
the listing query, and records the number rather than inheriting the conclusion.

**6. The total and the rows are two statements, and the page is honest about it.**

`searchPackages` and `countSearchResults` are separate queries, so an ingest
committing between them can make the count and the rows describe slightly
different sets. This is not new — `listPackages`/`countPackages` have always had
it — and it is not worth a transaction: the observable consequence is bounded by
the existing "There is no page N" branch, which `skills/page.tsx:50-60` already
ships precisely because a paginator that reports a range it cannot fill is "how a
paginator tells its first lie". The plan keeps that branch, states the property
in `must_haves`, and does not pretend a single-statement window function would be
free.

**7. The rename ships with the redirect in the same commit, and `/skills` is
deleted rather than left as a duplicate.**

Two routes rendering the same listing is two places for the next change to be
made in one of. `next.config.ts` already exports an `async headers()`; adding
`async redirects()` beside it is the same config API family and needs no
dependency. RESEARCH flags the exact shape as its one tertiary-confidence item
(A2) and names the fallback: a two-line `src/app/skills/page.tsx` that calls
`redirect('/artifacts')`. Try the config form, and if it does not behave, take
the fallback in the same task rather than leaving the rename half-done.

**8. No client component, and the convention is written down where the next
person will look.**

PATTERNS found no analog and recommended establishing one: a plain
`<form method="get" action="/artifacts">` with named inputs. The CSP already
allows it (`form-action 'self'`, `src/proxy.ts:49`), it works with JavaScript
disabled, and it puts the state in the URL where D-35 requires it. The project's
only client component (`SubmitForm.tsx`) holds a `pending` flag and nothing else,
and its doc comment says so; the new form needs even less. The convention goes in
a comment at the top of the form so the next control does not reach for
`'use client'` by default.

</decisions_made_while_planning>

<reference>

## Reference A — `SEARCH_CAPS` and `normalizeQuery`

`SEARCH_CAPS` follows the convention of `CAPS` (`src/github/scan.ts:11-26`) and
`ANALYZE_CAPS` (`src/analyze/types.ts`): one `as const` object, each number
carrying the reason it has that value.

| key | value | reason |
|---|---|---|
| `maxQueryLength` | 200 | Cost control, not crash prevention — RESEARCH measured a 5,000-character query as harmless. Measured in JavaScript string length, i.e. UTF-16 code units. |
| `pageSize` | 25 | The existing `PAGE_SIZE` in `skills/page.tsx:11`; moved here so the route, the query and the paginator read one number. |
| `maxPage` | 10_000 | The existing bound in `skills/page.tsx:18`'s `pageParam`, unchanged. |
| `repoNameBonus` | 0.1 | D-12's repository-name signal, kept strictly below `ts_rank`'s practical ceiling. |
| `exactNameBonus` | 2.0 | Above any achievable `ts_rank`, so D-12's first signal cannot be outranked. |
| `prefixNameBonus` | 1.0 | Between the two, so D-12's second signal cannot be outranked by its third. |

`normalizeQuery(raw: string | string[] | undefined): string` — takes the first
element when the parameter arrived repeated (Next.js gives an array), coerces
`undefined` to `''`, trims, collapses internal whitespace runs to one space, and
slices to `SEARCH_CAPS.maxQueryLength`. Case is *not* folded here: the FTS path
is case-insensitive through the tokenizer (D-09/D-11) and the `ILIKE` paths fold
their own operands, so lowercasing in the normalizer would only make the logged
query differ from what the user typed. Returns `''` for every input that
normalizes to nothing, and `''` is the browse signal.

## Reference B — the ranking expression and the browse branch

In `searchPackages`, when the normalized query is non-empty:

```
rank =
    CASE WHEN lower(package.name) = lower($q)              THEN 2.0 ELSE 0 END
  + CASE WHEN lower(package.name) LIKE lower($qEsc) || '%' THEN 1.0 ELSE 0 END
  + ts_rank(package.search_vector, websearch_to_tsquery('english', $q))
  + CASE WHEN repository.full_name ILIKE '%' || $qEsc || '%' THEN 0.1 ELSE 0 END
```

where `$qEsc` is `$q` with `%` and `_` backslash-escaped, and every constant is
`SEARCH_CAPS.*` rather than a literal.

`WHERE` gains one disjunction beside the existing conjuncts:

```
(package.search_vector @@ websearch_to_tsquery('english', $q)
 OR repository.full_name ILIKE '%' || $qEsc || '%')
```

so a query naming only a repository still returns that repository's artifacts —
the generated column cannot carry `full_name` (RESEARCH, live-confirmed), and
this is where it is carried instead.

`ORDER BY rank DESC, package.updated_at DESC, package.id ASC` — unchanged from
06-01, and the same three keys are what `countSearchResults` must *not* need,
since a count has no order.

When the normalized query is empty, the function builds neither the rank
expression nor the disjunction. `WHERE` is `isNull(delistedAt)` and the imported
`NOT_LISTED_BECAUSE is null`, and `ORDER BY` is `package.updated_at DESC,
package.id ASC` — matching `listPackages`'s own order (`packages.ts:211`) plus
the id tie-break D-15 requires. `rank` is projected as `0` so the return type
does not change shape between the two branches.

`countSearchResults` takes the same options object, applies the identical
`WHERE` — built by the same private helper function, called from both, never
written twice — and selects `count(*)::int`, following `countPackages`
(`packages.ts:226-238`) including its `innerJoin(repository)`.

## Reference C — `/artifacts` route

Extends the tracer route from 06-01 in place.

Params, all through the bounded-zod idiom at `skills/page.tsx:14-18`, never
`Number()`:
- `q` — `normalizeQuery` (Reference A) applied to `searchParams.q`.
- `page` — the existing `z.coerce.number().int().min(1).max(SEARCH_CAPS.maxPage).catch(1)`.

The form, placed above the results and rendered on both the search and the browse
path:

```tsx
<form method="get" action="/artifacts" className="search">
  <label htmlFor="q">Search artifacts</label>
  <input id="q" name="q" type="search" defaultValue={q}
         maxLength={SEARCH_CAPS.maxQueryLength} />
  <button type="submit">Search</button>
</form>
```

No `'use client'`. No `onChange`. `defaultValue`, not `value`, because a
controlled input without a client component is a read-only input. `maxLength` is
a courtesy, not the enforcement — the enforcement is `normalizeQuery` on the
server, because an attribute is advice to a browser.

Three empty states, all three distinct (D-38 needs the third; the first two
already exist at `skills/page.tsx:37-60` and must be carried over, not
collapsed):
1. corpus empty — "No artifacts indexed yet." + submit link. Unchanged.
2. page past the end — "There is no page N." + first-page link. Unchanged, and
   its first-page link must now carry `q` so a reader is not silently dropped out
   of their search.
3. zero search results — 06-03 owns the copy. This plan renders a placeholder
   branch that is structurally distinct from the other two and leaves a `TODO`
   naming `06-03`; do not write the final wording here and do not let branch 1's
   or branch 2's copy serve for it.

Pager, from `skills/page.tsx:69-75`, with every href rebuilt through one
`hrefFor(page)` helper that re-emits `q` — the helper exists so the previous
link, the next link and the empty-state links cannot each drop a different
parameter. 06-03 extends the same helper with the filter parameters.

## Reference D — the rename

- `next.config.ts`: add `async redirects()` beside the existing `async headers()`,
  returning `[{ source: '/skills', destination: '/artifacts', permanent: true }]`.
  Permanent, because the old name was wrong and is not coming back.
- Delete `src/app/skills/page.tsx`.
- `src/app/layout.tsx:36`: `<Link href="/skills">Skills</Link>` becomes
  `<Link href="/artifacts">Artifacts</Link>`.
- `src/app/page.tsx:51`: the `Browse all {total} artifacts` link's href becomes
  `/artifacts`. The link text already says "artifacts" and needs no change.
- `src/app/page.tsx:29`'s sentence already enumerates all six types; leave it.
- `src/app/globals.css`: one `.search` rule for the form row. The global
  `:focus-visible` outline at `globals.css:55-58` already satisfies D-50's visible
  focus for the new controls, so add no focus rule.

RESEARCH's fallback if the config form does not behave (A2): a two-line
`src/app/skills/page.tsx` that calls `redirect('/artifacts')` from
`next/navigation`. Take it in this task rather than leaving two live listings.

## Reference E — the adversarial and edge query set

Every string below goes through the route and through `searchPackages`. The
assertion is uniform: HTTP 200, a rendered page, no thrown error, and no
substring of the response matching `/at .*\(.*:\d+:\d+\)|PostgresError|syntax error/`.

| # | input | why |
|---|---|---|
| 1 | `''` | browse path |
| 2 | `'   '` | whitespace-only → browse path |
| 3 | absent parameter | browse path |
| 4 | `['mcp','skill']` (repeated param) | Next.js delivers an array; `Number()` on one is NaN |
| 5 | `'m'` | single character |
| 6 | `'mcp & drop table'` | operator syntax as literal text |
| 7 | `"'; DROP TABLE package; --"` | SQL injection string |
| 8 | `'mcp:*'` | tsquery prefix operator as literal |
| 9 | `'a!b'` | tsquery negation as literal |
| 10 | `'mcp\|server'` | tsquery OR as literal |
| 11 | `'"unbalanced'` | unbalanced quote |
| 12 | `'(unclosed'` | unclosed parenthesis |
| 13 | `'x'.repeat(5000)` | length cap |
| 14 | `'🚀🎉'` | emoji, outside the BMP — two UTF-16 code units each |
| 15 | `'한국어 검색'` | Korean, non-ASCII word boundaries |
| 16 | `'100%'` | ILIKE wildcard in the repository-name path |
| 17 | `'a_b'` | ILIKE single-char wildcard |
| 18 | `'MCP'` vs `'mcp'` | case-insensitivity, asserted as set and order equality |

Inputs 16 and 17 are the ones that catch a missing `LIKE` escape: unescaped,
`'100%'` makes the repository containment test match every repository and the
result set silently becomes the whole corpus.

</reference>

<tasks>

<task type="auto">
  <name>Task 1: Bounded, case-folded, and safe on input nobody sanitized</name>
  <files>src/db/queries/search.ts, src/db/queries/search.test.ts</files>
  <read_first>
    - src/db/queries/search.ts (the tracer version from 06-01 — the projection, the imported NOT_LISTED_BECAUSE, the existing ORDER BY)
    - src/app/skills/page.tsx:13-18 (the bounded-zod coercion idiom and the comment explaining why Number() is wrong)
    - src/github/scan.ts:6-30 (the CAPS-object convention: one `as const`, each number carrying its reason)
    - .planning/phases/AGD-06-search-browse/06-RESEARCH.md § "`websearch_to_tsquery` vs alternatives — proven live against adversarial input" and § "Query Safety and Caps"
    - .planning/phases/AGD-06-search-browse/06-CONTEXT.md D-09, D-10, D-11, D-40, D-41, D-42
  </read_first>
  <precondition>06-01's migration is applied to agentdock_test — `packageTable.searchVector` type-checks whether or not the column exists, so a green typecheck does not prove the suite can run.</precondition>
  <behavior>
    - normalizeQuery trims, collapses internal whitespace runs to a single space, and returns '' for input that is empty, whitespace-only or undefined.
    - normalizeQuery takes the first element of a repeated parameter delivered as an array.
    - normalizeQuery truncates at exactly SEARCH_CAPS.maxQueryLength JavaScript string units, asserted with an ASCII string, an emoji string and a Korean string so the unit is pinned rather than assumed.
    - normalizeQuery does not lowercase, so the string handed to the logger is what the user typed.
    - Every one of Reference E's 18 inputs reaches searchPackages without throwing.
    - 'MCP' and 'mcp' return identical rows in identical order.
    - '100%' does not return the whole corpus — the LIKE escape holds.
    - 'a_b' does not match 'axb' — the underscore escape holds.
  </behavior>
  <action>
    Apply Reference A and Reference E.

    Put `SEARCH_CAPS` in `search.ts` beside its only consumer rather than in a new
    module. `CAPS` lives in `src/github/scan.ts` and `ANALYZE_CAPS` in
    `src/analyze/types.ts` for the same reason — the caps sit with the code they
    bound, not in a shared bag.

    Write the unit for `maxQueryLength` into the constant's comment. Bytes, code
    points, grapheme clusters and UTF-16 code units are four different answers
    here, and the tests assert the one that is actually implemented rather than
    the one the reader assumed.

    Do not lowercase in the normalizer. The full-text path is already
    case-insensitive through the tokenizer, the `ILIKE` and `lower()` operands
    fold themselves, and lowercasing centrally would make DIS-08's logged query
    differ from what the user typed for no behavioural gain.

    Escape `%` and `_` before either `LIKE` operand, using the
    `replace(replace(input,'%','\%'),'_','\_')` form RESEARCH verified. Two of
    Reference E's inputs exist only to catch this, and the failure mode is not an
    error — it is a silently correct-looking result set that is the entire corpus.

    Keep the safe parser and let it do the work. It never threw on any of
    thirteen adversarial inputs in RESEARCH's live run, so no hand-rolled
    tokenizer, no regex pre-filter and no try/catch around parsing is warranted.
    A parser written here would have to reproduce that safety property and prove
    it the same way.

    Add the user-error / internal-error distinction D-42 asks for as a comment
    naming which is which, not as machinery: a malformed query is not an error at
    all on this path — it is a zero-result search — and the only internal errors
    are connection-level ones the server component boundary already handles for
    every other database-backed page.
  </action>
  <verify>
    <automated>bun run test -- src/db/queries/search.test.ts &amp;&amp; bun run typecheck &amp;&amp; bun run lint</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c 'export const SEARCH_CAPS' src/db/queries/search.ts` is 1 and the object contains `maxQueryLength`, `pageSize`, `maxPage`, `repoNameBonus`, `exactNameBonus` and `prefixNameBonus`.
    - `grep -c 'UTF-16' src/db/queries/search.ts` is at least 1 — the length unit is stated at the constant.
    - `grep -v '^\s*[/*]' src/db/queries/search.ts | grep -oE '[a-zA-Z_]*to_tsquery' | sort -u` outputs exactly `websearch_to_tsquery`.
    - `grep -c "'%'" src/db/queries/search.ts` is at least 1 and `grep -c "'_'" src/db/queries/search.ts` is at least 1 — both LIKE metacharacters are escaped.
    - A table-driven test covers all 18 rows of Reference E; `bun run test -- src/db/queries/search.test.ts` passes and the case count for that table is 18.
    - `bun run test -- src/db/queries/search.test.ts` passes the `'100%'` case with a result count strictly less than the full listed corpus count, and that count is recorded in the SUMMARY.
    - No new import appears in `package.json`.
  </acceptance_criteria>
  <done>Every one of eighteen inputs — empty, repeated, single-character, emoji, Korean, five thousand characters, an injection string, an unbalanced quote and two LIKE wildcards — reaches the database and comes back with a result set, and the two wildcards do not quietly return the whole corpus.</done>
</task>

<task type="auto">
  <name>Task 2: An order a reader can explain, a browse path that does not go through the query, and a page 40 that is as fast as page 1</name>
  <files>src/db/queries/search.ts, src/db/queries/search.test.ts</files>
  <read_first>
    - src/db/queries/packages.ts:164-238 (listPackages' ORDER BY and countPackages' innerJoin — the two shapes the browse branch and the count must match)
    - src/db/queries/search.ts (Task 1's normalizer and caps, and the tracer's existing rank/ORDER BY)
    - .planning/phases/AGD-06-search-browse/06-RESEARCH.md § "Empty-query trap (D-18) — proven live", § "Query Performance Benchmarks", § "Load-bearing discovery 1", and Open Question 2
    - .planning/phases/AGD-06-search-browse/06-CONTEXT.md D-12, D-13, D-14, D-15, D-16, D-17, D-18, D-37, D-45, D-46, D-47
  </read_first>
  <behavior>
    - An artifact whose name equals the query exactly ranks above an artifact that only mentions the word in its summary, asserted with fixtures that make the summary match strong.
    - An artifact whose name starts with the query ranks above an artifact matching only in the summary.
    - An artifact matching only in the summary ranks above one matching only through its repository's full name.
    - Two artifacts with identical relevance are returned in updated_at-descending order, and two with identical updated_at in id-ascending order.
    - Running the identical query twice returns identical id sequences.
    - The union of page 1 and page 2 of a query contains no duplicate id and covers exactly the first two page-sizes of the unpaginated ordering.
    - An empty normalized query returns rows ordered by updated_at descending then id ascending, and returns a non-zero count against the live corpus.
    - An empty normalized query returns the same row count as countPackages with the default listingOnly.
    - A query naming only a repository's full name returns that repository's artifacts.
    - Two artifacts identical in every ranking input except that one is parse_status 'partial' and the other 'ok' are returned in the tie-break order, with no penalty applied to 'partial'.
    - countSearchResults and searchPackages agree on the same options for a query, a browse and a filter-free late page.
  </behavior>
  <action>
    Apply Reference B.

    Branch on the empty query before building any predicate, not inside one. An
    empty text-search query matches nothing rather than everything — proven live
    — so an unconditional predicate renders an empty corpus to every visitor who
    has not typed anything, and that failure looks exactly like a correct
    zero-result page. This is the single highest-value branch in the plan and it
    is two lines.

    Write the rank as four separate summed terms on four lines, each with the
    D-12 signal it implements named in a comment. A blended weight is unreadable
    and D-12's requirement is that the ranking be explainable; four terms with
    separated magnitudes are checkable by eye and by three ordering assertions.

    Put nothing in the rank that D-13 forbids. Stars are on the joined
    `repository` row and are therefore one keystroke away; they are not a ranking
    input, and neither is any capability finding (D-07) or parse status (D-14).
    The absence is asserted, not assumed: the `partial`-versus-`ok` case exists
    for exactly that.

    Build the `WHERE` once in a private helper and call it from both
    `searchPackages` and `countSearchResults`. Two hand-written copies of the same
    predicate is the bug shape `packages.ts:203-208` already warns about, one
    level up — and here the visible symptom would be a paginator whose last page
    does not exist.

    Keep `NOT_LISTED_BECAUSE` in the `WHERE` on both branches. Computing it in
    `SELECT` only is a measured 31× slowdown that appears at a late offset and
    not on page one.

    Measure a late page of the *search* query, not of the listing query.
    RESEARCH's 37.3 ms at offset 900 describes the listing; this query adds a GIN
    predicate, a rank expression and a repository `ILIKE`. Record
    `EXPLAIN (ANALYZE, BUFFERS)` from Drizzle's own `.toSQL()` output for page 1
    and for the last full page of a common query, with the corpus row count. If a
    late page exceeds 200 ms, stop and record the plan rather than adding an index
    on intuition — the remedy is a query-shape fix first, exactly as Phase 5
    measured (1,152 ms → wrong index 1,101 ms → query-shape fix 25.5 ms).

    Count the queries. One page of results is one statement plus one count
    statement; the correlated `commitSha` subquery is per-row inside that one
    statement, not a second round trip. Take the count from the `.toSQL()` output
    and record it.
  </action>
  <verify>
    <automated>bun run test -- src/db/queries/search.test.ts src/db/queries/packages.test.ts &amp;&amp; bun run typecheck &amp;&amp; bun run lint</automated>
  </verify>
  <acceptance_criteria>
    - `bun run test -- src/db/queries/search.test.ts` passes all eleven behaviours above.
    - `grep -v '^\s*[/*]' src/db/queries/search.ts | grep -c 'repository.stars\|repositoryStars\|\.stars'` is 0 — no popularity term reached the ranking.
    - `grep -v '^\s*[/*]' src/db/queries/search.ts | grep -c "parse_status\|parseStatus"` is 0 — no parse-status term reached the ranking.
    - `grep -c 'SEARCH_CAPS.exactNameBonus' src/db/queries/search.ts`, `... prefixNameBonus` and `... repoNameBonus` are each 1 — the three constants are referenced, not inlined as literals.
    - The `WHERE` builder appears once: `grep -c 'function ' src/db/queries/search.ts` includes a single shared predicate helper, and `grep -c 'NOT_LISTED_BECAUSE' src/db/queries/search.ts` counts references only, with no `case`/`when … then` text in the file.
    - `EXPLAIN (ANALYZE, BUFFERS)` outputs for page 1 and for the last full page of a common query are recorded in the SUMMARY with execution times and the corpus row count; the late page is under 200 ms or the gate was honoured and recorded.
    - The statement count for one rendered page, taken from `.toSQL()`, is recorded and is 2.
  </acceptance_criteria>
  <done>Ranking puts an exact name above a prefix above a description above a repository name, ties break the same way every time, page 2 neither repeats nor skips a row from page 1, an empty query browses the whole corpus without ever touching the text-search predicate, and a late page's cost is a recorded EXPLAIN rather than an assumption.</done>
</task>

<task type="auto">
  <name>Task 3: A search box that needs no JavaScript, and a route whose name is finally true</name>
  <files>src/app/artifacts/page.tsx, src/app/skills/page.tsx, src/app/layout.tsx, src/app/page.tsx, next.config.ts, src/app/globals.css</files>
  <read_first>
    - src/app/skills/page.tsx (the whole file — the two empty-state branches and the pager markup being carried over, and the comment at 48-49 explaining why the past-the-end branch exists)
    - src/app/artifacts/page.tsx (06-01's tracer version, extended in place)
    - src/app/layout.tsx:30-40 (the nav link) and src/app/page.tsx:45-55 (the browse-all link)
    - next.config.ts (the existing `async headers()` — the redirect goes beside it, same API family)
    - src/proxy.ts:20-56 (the CSP; `form-action 'self'` is what makes a GET form legal here)
    - src/app/globals.css:1-60 and :184-235 (the design tokens, the global `:focus-visible`, and `.submit`'s form styling as the register to match)
    - src/components/SubmitForm.tsx:1-20 (the project's only client component, and its doc comment explaining why it holds no data)
  </read_first>
  <reversibility rating="costly">`/skills` is a published, search-engine-indexed URL. The 308 redirect preserves every inbound link, but reverting the rename would need a second permanent redirect in the opposite direction and would spend the same link equity twice.</reversibility>
  <behavior>
    - GET /artifacts renders a labelled search input and a submit button in the HTML with no client JavaScript.
    - Submitting the form with the keyboard alone navigates to /artifacts?q=... and renders matching rows.
    - GET /artifacts?q=mcp&page=2 renders page 2 and its Previous link carries q.
    - GET /artifacts?page=99999 renders the past-the-end branch, and its first-page link carries q when a query was present.
    - GET /skills returns a 3xx redirect whose Location is /artifacts.
    - GET /skills?page=2 still reaches the application rather than 404ing.
    - No page in the application contains an href of /skills.
    - The search input, the page and the results all survive a repeated q parameter without a 500 or a NaN.
    - The zero-search-result branch is structurally distinct from the corpus-empty branch and from the past-the-end branch.
  </behavior>
  <action>
    Apply References C and D.

    Use a plain GET form and no client component. The CSP already permits it, it
    works with JavaScript disabled, and it puts `q` in the URL where D-35 requires
    it. Put the convention in a comment above the form — default to a server-
    rendered GET form and native controls, reach for `'use client'` only when a
    control needs interaction a GET form cannot express — because this is the
    first of several controls and 06-03 adds the rest.

    Use `defaultValue`, not `value`. A controlled input with no client component
    is an input the user cannot type in.

    Build every href through one `hrefFor` helper. Previous, Next, the
    past-the-end first-page link and 06-03's filter links all need the same
    parameter set, and four hand-built template strings is four chances to drop a
    different one.

    Keep all three empty states distinct. The corpus-empty and past-the-end
    branches already exist and carry comments explaining why they are separate;
    carry them across unchanged except for the first-page link now carrying `q`.
    Leave the zero-result branch as a structurally distinct placeholder with a
    `TODO` naming 06-03 — writing the final copy here and rewriting it there is
    how one of the two versions survives.

    Ship the redirect and the deletion in the same commit. Two routes rendering
    the same listing is one route too many for the next change to land in only
    half of. If `redirects()` does not behave — RESEARCH's one tertiary-confidence
    item — take the named fallback immediately: a two-line `skills/page.tsx` that
    calls `redirect('/artifacts')`. Do not leave the old page rendering.

    Add one `.search` rule and no focus rule. `globals.css:55-58` already gives
    every focusable element a visible outline, which is D-50's requirement met by
    something already shipped.

    Check the narrow width before calling it done. `globals.css` sets
    `overflow-wrap: anywhere` and `* { min-width: 0 }` for a measured
    1,077-character description; the new form row is the first flex row added
    since, and D-51 asks for the search input, the filter row and the result
    metadata to be checked at narrow widths.
  </action>
  <verify>
    <automated>bun run test &amp;&amp; bun run typecheck &amp;&amp; bun run lint &amp;&amp; bun run check:boundaries</automated>
  </verify>
  <acceptance_criteria>
    - Comment-filtered — `grep -rhv '^\s*[/*]' --include='*.tsx' --include='*.ts' src/app src/components | grep -cE 'href=.\{?.?/skills'` is 0: no executable line builds a link to the old route. <!-- planner-discipline-allow: /skills -->
    - `grep -rc 'PackageRows\|hrefFor' src/app/artifacts/page.tsx` is at least 2 — the route still renders through the shared component and the shared URL builder.
    - `test ! -f src/app/skills/page.tsx` succeeds, OR the file exists and contains exactly a `redirect('/artifacts')` call and no listing query — the RESEARCH-named fallback, recorded as taken.
    - `curl -sI http://localhost:3000/skills` returns a 3xx status with `location: /artifacts`.
    - `curl -s http://localhost:3000/artifacts` returns 200 and its body contains `<label` associated with the search input by `for="q"` and an `<input` with `name="q"`.
    - Comment-filtered — `grep -v '^\s*[/*]' src/app/artifacts/page.tsx | grep -cE "^\s*'use client'"` is 0: the directive is absent as a directive, and a comment naming the convention does not trip it. <!-- planner-discipline-allow: 'use client' -->
    - `grep -c 'defaultValue' src/app/artifacts/page.tsx` is at least 1, and comment-filtered `grep -v '^\s*[/*]' src/app/artifacts/page.tsx | grep -c 'onChange\|useState'` is 0.
    - `curl -s 'http://localhost:3000/artifacts?q=mcp&page=2'` returns 200 and its body contains an href matching `q=mcp` on the Previous link.
    - `curl -s 'http://localhost:3000/artifacts?q=mcp&q=skill&page=abc'` returns 200 and its body contains neither `NaN` nor the substring `Showing 0`.
    - `grep -c 'hrefFor' src/app/artifacts/page.tsx` is at least 4 — the helper is used for previous, next and both empty-state links rather than hand-built strings.
    - `bun run check:boundaries` exits 0.
    - A narrow-viewport render of `/artifacts` is captured with the gstack `browse` skill and its result recorded in the SUMMARY.
  </acceptance_criteria>
  <done>A visitor with JavaScript disabled can type a word, press Enter, get server-rendered results, walk to page 2 and back without losing their query — and every link that used to say `/skills` now says `/artifacts`, with the old URL redirecting rather than dying.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| `?q=` and `?page=` → the query layer | Untrusted free text and an untrusted integer become a text-search operand, two `LIKE` operands and an `OFFSET` |
| `?q=` → the rendered `<input defaultValue>` | Untrusted text echoed back into the page |
| `/skills` → `/artifacts` | A framework-level redirect on a public route |
| the query layer → the log line | Untrusted text about to be persisted to stdout (06-03 completes this) |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-06-09 | Tampering | unescaped `LIKE` metacharacters in the repository-name and name-prefix operands | high | mitigate | `%` and `_` are backslash-escaped with the form RESEARCH verified live, before either `LIKE` operand is built. Reference E inputs 16 and 17 assert it: unescaped, `'100%'` silently returns the entire corpus, and the acceptance criterion asserts the returned count is strictly below the full listed count. |
| T-06-10 | Denial of Service | an unbounded `?q=` or `?page=` doing pointless work | medium | mitigate | Closes T-06-06 from 06-01. `SEARCH_CAPS.maxQueryLength` truncates at 200 UTF-16 code units; `page` goes through the existing bounded `z.coerce.number().int().min(1).max(10_000).catch(1)` so a repeated or non-numeric parameter cannot become a NaN offset. Both asserted with live requests. |
| T-06-11 | Tampering / XSS | `?q=` echoed into `<input defaultValue>` and into the empty-state copy | medium | mitigate | Both are plain React text/attribute bindings, which React escapes; there is no `dangerouslySetInnerHTML` on this route and `check-boundaries.mjs` rule 5's `no-raw-html` runs in this task's verify command. |
| T-06-12 | Information Disclosure | a raw Postgres error reaching the page | medium | mitigate | Closes T-06-07 from 06-01. A malformed query is not an error on this path — the safe parser never throws, proven live on thirteen inputs — so the only reachable failures are connection-level, handled by the same server-component boundary every other database-backed page already uses. The distinction is documented at the call site per D-42. |
| T-06-13 | Spoofing | an open redirect through the new `redirects()` entry | low | accept | The redirect is a single literal source-to-destination pair with no parameter interpolation and no wildcard, so there is no user-controlled component to redirect to. Accepted with the rationale that a static pair cannot be an open redirect; asserted by the `curl -sI` criterion showing a fixed `location: /artifacts`. |
| T-06-14 | Denial of Service | ReDoS in the whitespace-collapse regex in `normalizeQuery` | low | mitigate | The collapse is a single non-backtracking `\s+` alternation with no nested quantifier, applied to a string already bounded at 200 units by the same function. Reference E's 5,000-character input runs through it. |
| T-06-15 | Repudiation | the paginator reporting a range it cannot fill | low | mitigate | The count and the rows come from two statements and can disagree under a concurrent ingest; the existing past-the-end branch renders "There is no page N" rather than a fabricated range, and the property is stated in `must_haves` rather than papered over. |
| T-06-SC | Tampering | npm/pip/cargo installs | high | mitigate | Not applicable and asserted: this plan installs no package. `package.json` is unchanged, asserted by Task 1's acceptance criteria. |
</threat_model>

<artifacts_this_phase_produces>
Symbols this plan creates:

**Functions and types**
- `normalizeQuery(raw: string | string[] | undefined): string` — `src/db/queries/search.ts`
- `SEARCH_CAPS` — `src/db/queries/search.ts` (`maxQueryLength`, `pageSize`, `maxPage`, `repoNameBonus`, `exactNameBonus`, `prefixNameBonus`)
- `countSearchResults(options)` — `src/db/queries/search.ts`
- a private shared `WHERE`-builder helper in `src/db/queries/search.ts`, called by both query functions
- `hrefFor(page)` — `src/app/artifacts/page.tsx` (module-local URL builder)
- `redirects()` — `next.config.ts` (new exported config member)

**New file paths:** none. `src/app/skills/page.tsx` is **deleted**.

**New route segments:** none new; `/skills` becomes a 308 redirect to the
`/artifacts` segment created in 06-01.

**New SQL identifiers:** none. This plan adds no column, no index and no
migration.

**New CSS classes**
- `.search` — `src/app/globals.css`

**New CLI or package scripts:** none.
</artifacts_this_phase_produces>

<verification>
1. `normalizeQuery` trims, collapses, truncates at 200 UTF-16 code units, and returns `''` for empty, whitespace-only and absent input — asserted with ASCII, emoji and Korean strings.
2. All 18 of Reference E's inputs return HTTP 200 with no stack trace and no raw Postgres error text.
3. `'100%'` and `'a_b'` do not behave as wildcards.
4. `'MCP'` and `'mcp'` return identical rows in identical order.
5. Exact name outranks prefix outranks description outranks repository name, asserted as three separate comparisons.
6. Ties break by `updated_at DESC` then `id ASC`, and repeating a query returns an identical id sequence.
7. Page 1 and page 2 of one query neither repeat nor skip an id.
8. An empty query browses the whole listed corpus, ordered by recency, without applying the full-text predicate.
9. No popularity term, no capability term and no parse-status term appears in the ranking, asserted by grep and by the `partial`-versus-`ok` ordering case.
10. `countSearchResults` and `searchPackages` build their `WHERE` from one shared helper.
11. `EXPLAIN (ANALYZE, BUFFERS)` for page 1 and a late page is recorded with the corpus row count; the late page is under 200 ms or the gate was honoured.
12. One rendered page issues exactly 2 statements.
13. `/skills` redirects to `/artifacts`, no href to `/skills` remains, and `src/app/skills/page.tsx` is gone or is a two-line redirect.
14. The search form renders and submits with no client JavaScript and no `'use client'`.
15. `bun run ci` passes.
</verification>

<success_criteria>
- **DIS-03** — a plain-language query returns results ordered by an explainable, deterministic relevance rule.
- **DIS-10** — no dependency, no service, no API route.
- **D-09 / D-10 / D-11** — trim, collapse and case-insensitivity only; the tokenizer's stemming is the sole linguistic widening.
- **D-12 / D-13 / D-14** — four named signals in the stated order, with popularity, capability and parse status all absent and asserted absent.
- **D-15 / D-16 / D-37** — one total order shared by list and pagination, on measured offset pagination.
- **D-17 / D-18** — browse ordering is defined separately from search ranking, and an empty query never reaches the text-search predicate.
- **D-19** — the browse route is named for what it lists, with inbound links preserved.
- **D-35 / D-36 / D-50** — state lives in the URL, results exist in HTML before JavaScript, and every control is labelled and keyboard-submittable.
- **D-40 / D-41 / D-42** — bounded, parameterized, escaped, and non-leaking on failure.
- ROADMAP criteria 1 and 6.
</success_criteria>

<output>
Create `.planning/phases/AGD-06-search-browse/06-02-SUMMARY.md` when done.

Record: the chosen `SEARCH_CAPS` values with the reason for each; the result
count returned for `'100%'` beside the full listed corpus count; the three
ranking-order comparisons and the fixture names that made each of them
unambiguous; `EXPLAIN (ANALYZE, BUFFERS)` for page 1 and for a late page of a
common query, each with the corpus row count and execution time; the statement
count for one rendered page taken from `.toSQL()`; whether the `redirects()`
config form worked or the RESEARCH-named fallback was taken; and the
narrow-viewport browse result. Record no credential and no connection string.

Commits follow GSD's atomic-commit protocol on `develop`. **Do not `git push`,
do not change `main`, and make no remote change of any kind.**
</output>
</content>
