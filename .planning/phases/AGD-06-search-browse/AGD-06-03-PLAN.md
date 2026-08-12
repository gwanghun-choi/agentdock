---
phase: AGD-06-search-browse
plan: 03
type: execute
wave: 3
depends_on: [06-02]
files_modified:
  - src/db/queries/search.ts
  - src/db/queries/search.test.ts
  - src/log.ts
  - src/log.test.ts
  - src/app/artifacts/page.tsx
  - src/app/globals.css
autonomous: true
requirements: [DIS-05, DIS-06, DIS-07, DIS-08, DIS-10]

estimate:
  tokens: 115000
  raw_tokens: 115000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "Selecting an artifact type returns only artifacts of that type, and the exclusion happens in the SQL WHERE clause — the row count returned by the query equals the row count rendered, so nothing was discarded after the fetch"
    - "An unknown, empty or repeated type parameter falls back to no type filter and returns HTTP 200, never a 500 and never an empty result set caused by an unmatchable value"
    - "The 'no scripts, no network, no shell' composition returns only artifacts with no network_request finding on their latest version, no declared finding whose signal begins with Bash on their latest version, and no entry in package.files whose path ends in one of SCRIPT_EXTENSIONS"
    - "The three capability exclusions and the listing predicate are evaluated inside one SQL statement against one MVCC snapshot, so a concurrent ingest cannot produce a row that passes one exclusion and fails another within the same result page"
    - "Each capability filter can be applied alone and in any combination, and applying all three returns a subset of applying any two"
    - "The capability filter reads capability_finding through the latest package_version, the same latestVersion ordering listPackages already uses, so the filter and the artifact's own page judge the same version"
    - "No filter label, no filter heading and no result-row metadata contains any of the words check-boundaries.mjs rule six forbids, and the whole application passes that rule"
    - "An artifact of type catalog never appears in searchPackages output for any query, any filter combination, or the empty browse query"
    - "A zero-result search names the query, offers at least two next steps, and states the corpus scope; it never asserts that the artifact does not exist"
    - "The zero-result branch, the corpus-empty branch and the past-the-end branch render three distinguishable messages, and a browse with no query never reaches the zero-result branch"
    - "Every search and every browse request emits exactly one structured log line with event 'search', carrying query, the applied filters, resultCount and durationMs — including when resultCount is zero"
    - "The search log line's key set is closed: it is asserted against an exact sorted key list, exactly as the ingest log line already is, and no free-form payload key exists on it"
    - "No planted credential sentinel appears in any search log line"
    - "package.json gains no dependency and no devDependency in this plan"
    - statement: "The rendered browse → search → filter → open detail → back → paginate flow produces no browser console error at default and narrow viewport widths"
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
    - statement: "Capability findings are never a ranking signal and are never presented as a complete capability inventory (D-07, D-08)"
      status: flagged
      verification: unverified
    - statement: "The search log carries no free-form payload key, no header, no response body and no connection string (src/log.ts's closed-union rule)"
      status: flagged
      verification: unverified
  artifacts:
    - path: "src/db/queries/search.ts"
      provides: "Type and capability filtering, applied in SQL inside the same statement as the listing predicate, through the same shared WHERE builder both query functions call"
      exports: ["searchPackages", "countSearchResults", "SearchFilters", "CAPABILITY_FILTER_IDS", "ARTIFACT_TYPE_IDS"]
    - path: "src/log.ts"
      provides: "SearchLog as a third closed-union member of the one log() function, with resultCount emitted at zero rather than omitted"
      exports: ["log", "SearchLog"]
    - path: "src/app/artifacts/page.tsx"
      provides: "The facet controls, the three distinct empty states, the zero-result next steps, the corpus-scope disclosure, and the one log emission per request"
    - path: "src/log.test.ts"
      provides: "Extended: the search line's exact closed key set and its secret-absence proof, alongside the existing ingest and worker cases"
  key_links:
    - from: "src/app/artifacts/page.tsx"
      to: "src/log.ts"
      via: "one log() call per request carrying the query, the applied filters, the result count and the elapsed milliseconds — DIS-08's whole requirement, on the project's existing sink"
      pattern: "event: 'search'"
    - from: "src/db/queries/search.ts"
      to: "src/analyze/files.ts"
      via: "the no-scripts predicate reads SCRIPT_EXTENSIONS rather than restating the extension list, so the filter and the file inventory cannot disagree about what a script is"
      pattern: "SCRIPT_EXTENSIONS"
    - from: "src/db/queries/search.ts"
      to: "src/components/CapabilityPanel.tsx"
      via: "filter copy is drawn from the same Phase 4 category vocabulary the detail page renders, so one artifact is described the same way on both surfaces"
      pattern: "CATEGORY_LABELS"
---

<objective>
Let a developer narrow, and tell them the truth when nothing matches.

Purpose: `discover → narrow → compare → open → inspect` is the flow the phase
owes, and 06-01 and 06-02 delivered discover and open. Narrowing is the middle,
and it is the part with the most ways to be quietly wrong: a filter applied
after the fetch instead of in SQL silently breaks the paginator; a capability
filter worded as a verdict turns a measurement gap into an endorsement; a
zero-result page that says "there is no such artifact" makes a 16-repository
corpus speak for the whole ecosystem. And DIS-08's log is the only instrument
this project will have for deciding, in some later phase, whether semantic
search is worth building — so it starts collecting on the first search release,
not the second.

Output: an artifact-type filter and a declared-capability filter, both in SQL,
both in the same statement as the listing predicate; a zero-result state that
names the query, offers next steps and discloses corpus scope; and a `SearchLog`
member on the one `log()` function this project has.

Honours D-05/D-26 (type filter, labels decoupled from enum ids), D-06/D-27 (the
"no scripts, no network, no shell" composition), D-07/D-08 (capability as a
filter, never a ranking signal, never a complete inventory), D-28 (Phase 4
vocabulary, no verdict), D-29 (no large filter panel), D-30 (SQL only), D-34
(`catalog` needs no special-casing, locked with a regression test), D-38/D-39
(state the fact, offer a next step, disclose scope), D-44 (structured query
logging on the existing sink), D-47/D-48 (no N+1, verified at real corpus size),
D-52/D-53 (result-row content, and no overstated truncation).
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/phases/AGD-06-search-browse/06-CONTEXT.md
@.planning/phases/AGD-06-search-browse/06-RESEARCH.md
@.planning/phases/AGD-06-search-browse/06-PATTERNS.md
@.planning/phases/AGD-06-search-browse/06-02-SUMMARY.md
@src/db/queries/search.ts
@src/db/queries/packages.ts
@src/db/queries/capabilities.ts
@src/db/schema.ts
@src/log.ts
@src/log.test.ts
@src/analyze/files.ts
@src/components/CapabilityPanel.tsx
@src/app/artifacts/page.tsx
@scripts/check-boundaries.mjs
</context>

<research_drift>
**One correction to 06-RESEARCH.md and 06-VALIDATION.md, found by reading the
tree rather than the document.**

Both state that no test file exists for `src/log.ts` — RESEARCH's Wave-0 gap
list says *"no existing test file for `log.ts`; a small new one is
proportionate"*, and VALIDATION's Wave 0 Requirements repeats it. **`src/log.test.ts`
exists and is 163 lines.** It already tests the closed key set of the ingest
line against an exact sorted `KEYS` array, the worker line's key set, a planted
`ghp_`/`postgres://` sentinel-absence proof across every outcome, a
`seedsSkipped`-is-a-number-including-zero case, and a line-length bound.

Consequence for this plan: `SearchLog` is tested by **extending that file**,
reusing its `capture()` helper and its sentinel constants, not by creating a new
one. A second log test file would duplicate the sentinel discipline and let the
two copies drift. The existing suite is also the exact template for what the
search line's own assertions must look like, which removes the "no analog to
imitate" note PATTERNS carried.
</research_drift>

<decisions_made_while_planning>

**1. Filters go through the shared `WHERE` builder 06-02 introduced, not beside
it.**

`searchPackages` and `countSearchResults` already call one private predicate
helper. Adding the type and capability conjuncts there means the paginator's
total and its rows cannot disagree about what is filtered — which is the failure
mode that surfaces not as an off-by-a-few number but as a dead page, exactly as
Phase 5 recorded for `countPackages`' missing join.

**2. The capability filter is three independent absence tests, and it is the
absence that is filterable.**

DIS-06 names "no scripts, no network, no shell" — three negatives. Positives are
deliberately not offered: "has network access" as a filter reads as a warning
label, and D-07's ledger is why. `install` recall is 0 of 6 on real `npm ci`;
`network_request` is 15% false-positive with zero new hits on a doubled corpus;
`remote_execution` and `hidden_content` have zero live positives across seven
corpora. An absence filter over a detector with known misses is honest — it
narrows to artifacts where AgentDock *observed* nothing, which is a statement
about AgentDock. A presence filter over the same detector would be a statement
about the artifact, and the measurements do not support one.

**3. `no scripts` reads `package.files`, and needs no version join at all.**

`files` lives on `package`, not on `package_version`, and `schema.ts:136-147`
explains why: a version is minted over the manifest's own bytes, so adding a
script beside an unchanged manifest mints no version, and a version-scoped
inventory would be permanently stale about exactly what this filter asks. The
predicate is a `NOT EXISTS` over `jsonb_array_elements(package.files)` matching
the extension list — and the list comes from `SCRIPT_EXTENSIONS`
(`src/analyze/files.ts:14`) rather than being retyped, so the filter and the
detail page's "not analyzed" marker cannot disagree about what a script is.

**4. `no network` and `no shell` read the latest version, matching
`listPackages`' own definition of latest.**

`capability_finding` keys on `package_version_id` and has no FK to `package`
(`schema.ts:218-271`), so the filter has to pick a version. It picks the same one
`NOT_LISTED_BECAUSE` does — most recent `ingested_at` — because
`packages.ts:25-32`'s comment already states the rule: *"the version on the
artifact's page and the version the listing judges must be the same row, or a
reader sees a reason that does not match what they are looking at."* A filter
judging a different version is the same bug wearing a different hat.

**5. The concurrency answer is "one statement, one snapshot", and it is stated
rather than assumed.**

All three exclusions and the listing predicate are conjuncts of one `SELECT`, so
PostgreSQL's READ COMMITTED statement-level snapshot makes them consistent with
each other by construction: a concurrent ingest cannot commit between the
network test and the scripts test. The one place inconsistency *is* observable —
between the rows statement and the count statement — is 06-02's recorded property
and is bounded by the existing past-the-end branch. Both facts are in
`must_haves` rather than left to a reader's assumption about isolation levels.

**6. Filter labels are a table in the route, ids are a closed array in the query
module.**

D-26 requires the labels be decoupled from internal enum values, and the reason
is concrete: the type ids are `mcp_server` and `hook`, and the labels are
`MCP Server` and `Hook Configuration`. The ids live in `search.ts` as a closed
`as const` array so zod can validate against them and the query cannot receive an
unmatchable string; the labels live in the route beside the markup that renders
them. `catalog` is in neither list — it is excluded from listings by
construction (decision 7) and offering a filter that always returns nothing would
be a control that lies.

**7. `catalog` gets a regression test and no code.**

RESEARCH traced it: a successfully parsed catalog writes **zero** package rows —
`src/ingest/pipeline.ts:287-301`'s own comment says *"A catalog names other
repositories; route to the seed channel and write no package row for it."* — so
a `type = 'catalog'` row exists only when the catalog failed to parse, which
`NOT_LISTED_BECAUSE`'s `parse_status = 'failed'` branch already excludes. The
live corpus's single catalog row is exactly that. So D-34's answer is: no
special-casing, and one test asserting the invariant, so a future phase that
changes catalog handling fails loudly here instead of quietly leaking a
marketplace manifest into search results.

**8. The zero-result copy states three things and claims none.**

D-38: name the query, offer next steps, never claim non-existence. D-39: disclose
scope with the measured facts — 16 repositories, no GitHub-wide crawl, named
unreachable shards. The copy therefore says what did not match, offers "clear
filters" and "browse all" as links, and carries one scope sentence. It must pass
`check-boundaries.mjs` rule six, which excises only the four `SANCTIONED`
substrings; any new sentence containing `safe`, `clean`, `verified`, `trusted`,
`approved`, `malicious`, `grade` or `risk score` fails the build. Write the copy,
then run the rule, before considering it finished.

**9. The log line carries the raw query, and the privacy question is answered by
the sink rather than by dropping the field.**

D-44 records the tension and resolves it: DIS-08's *"search queries and result
counts are logged"* wins over the brief's "maybe only duration and count". The
line is one JSON object on stdout — the project's only sink, with no account, no
session, no cookie and no IP anywhere near it, because v1 has no authentication
(STATE.md constraint). The query is the one genuinely free-form field on the
whole union, it is bounded at `SEARCH_CAPS.maxQueryLength` before it gets there,
and the tests assert the key set is exactly closed and that no planted credential
sentinel survives — the same two proofs the ingest line already carries.

**10. The route emits exactly one log line per request, from the route, not from
the query module.**

`searchPackages` is wrapped in `react.cache`, so a second call in the same render
pass is deduped and would emit either zero or two lines depending on cache
behaviour. The route is the one place that knows the request happened exactly
once, knows the filters as the user expressed them, and can measure the elapsed
time around both queries. `durationMs` therefore covers the rows query and the
count query together, and the field's comment says so — a number whose meaning is
undocumented is a number nobody can act on later.

</decisions_made_while_planning>

<reference>

## Reference A — filter ids, labels and predicates

`ARTIFACT_TYPE_IDS` in `src/db/queries/search.ts`, an `as const` array of the
five listable ids — `skill`, `plugin`, `mcp_server`, `command`, `hook`.
`catalog` is deliberately absent (decision 7).

`CAPABILITY_FILTER_IDS` — `no_network`, `no_shell`, `no_scripts`.

`SearchFilters` = `{ types: string[]; capabilities: string[] }`, both bounded:
at most `ARTIFACT_TYPE_IDS.length` and `CAPABILITY_FILTER_IDS.length` entries
after validation, which is D-41's "max filters" satisfied by the closed sets
themselves rather than by a separate counter.

Labels, in `src/app/artifacts/page.tsx`, decoupled per D-26. Type labels are the
seeded `artifact_type.label` values, matching the detail page's `TYPE_LABELS`
that 06-01 filled in:

| id | filter label |
|---|---|
| — | All types |
| `skill` | Agent Skills |
| `plugin` | Claude Code Plugins |
| `mcp_server` | MCP Servers |
| `command` | Slash Commands |
| `hook` | Hook Configurations |

Capability labels, in the register `CapabilityPanel.tsx:10-16` established and
D-28 requires — observation vocabulary, never a verdict:

| id | filter label |
|---|---|
| `no_network` | No network request observed |
| `no_shell` | No Bash grant declared |
| `no_scripts` | No bundled script files |

Predicates, from 06-RESEARCH.md § "DIS-06 Capability Filter", verified live at
97 ms with 708 of 921 listed artifacts passing all three:

- `no_network` — `NOT EXISTS (SELECT 1 FROM capability_finding cf WHERE
  cf.package_version_id = <latest version of this package> AND cf.category =
  'network_request')`
- `no_shell` — the same shape with `cf.category = 'declared' AND cf.signal ILIKE
  'Bash%'`
- `no_scripts` — `NOT EXISTS (SELECT 1 FROM jsonb_array_elements(package.files) f
  WHERE (f->>'path') ~ <regex built from SCRIPT_EXTENSIONS>)`

`<latest version of this package>` is the correlated
`(SELECT z.id FROM package_version z WHERE z.package_id = package.id ORDER BY
z.ingested_at DESC LIMIT 1)` shape `packages.ts:33-39` and `:188-194` already
use twice. Use that idiom, not a lateral join — RESEARCH measured the lateral
form of a comparable subquery at 1,152 ms against 25.5 ms for the correlated
one.

The `no_scripts` regex is built from `SCRIPT_EXTENSIONS`
(`src/analyze/files.ts:14` — `.py .sh .js .ts .rb .ps1 .mjs`) by stripping the
leading dot from each and joining with `|`, producing `\.(py|sh|js|ts|rb|ps1|mjs)$`.
Build it from the imported constant; do not retype the list. No user input
reaches this regex — it matches only stored `files[].path` values, already capped
by `ANALYZE_CAPS.maxInventoryEntries`.

The type predicate is `packageTable.type` `IN` the validated id array, applied
only when the array is non-empty.

## Reference B — `SearchLog`

Added to `src/log.ts` as a third member of the closed union, and `log()`'s
parameter widened to `IngestLog | WorkerLog | SearchLog`. No second function, no
new file, no logging library.

| field | type | note |
|---|---|---|
| `event` | `'search'` | the discriminant |
| `query` | `string` | the normalized query, already bounded at `SEARCH_CAPS.maxQueryLength`. The one free-form field on the whole union; DIS-08 requires it and D-44 resolves the privacy question in its favour. Emitted as `''` for a browse request, never omitted. |
| `types` | `string[]` | the applied type ids, drawn from the closed `ARTIFACT_TYPE_IDS` set after validation. Emitted as `[]`, never omitted. |
| `capabilities` | `string[]` | the applied capability ids, drawn from the closed `CAPABILITY_FILTER_IDS` set. Emitted as `[]`, never omitted. |
| `page` | `number` | the bounded page number actually served |
| `resultCount` | `number` | rows on this page. Emitted as `0` explicitly — `IngestLog.seedsSkipped`'s comment (`log.ts:23-37`) is the precedent and the reason: a field that appears only when non-zero makes its absence ambiguous between "no results" and "an older build". |
| `totalCount` | `number` | the total the paginator reported, so a later reader can tell "one page of many" from "one result" |
| `durationMs` | `number` | wall clock around **both** the rows query and the count query, stated in the field's comment |

Both array fields hold members of closed sets, so neither can carry an arbitrary
string — which is what keeps the union's own rule (`log.ts:58-64`) true: *"there
is no key an arbitrary object could be assigned to."*

## Reference C — the three empty states and the disclosure

Branch 1 and branch 2 are carried from `skills/page.tsx` unchanged (06-02
already moved them). Branch 3 is new and replaces 06-02's placeholder.

Branch 3 renders, in this order:
1. `No artifacts matched "{q}".` — with the filters named when any are applied,
   so a reader can tell a bad query from an over-narrow filter.
2. At least two next steps as real links, built through 06-02's `hrefFor`
   helper: **Clear filters** (same `q`, no `type`, no `cap`) shown only when a
   filter is applied, and **Browse all artifacts** (`/artifacts` with no
   parameters), always shown.
3. The scope sentence: AgentDock indexes a curated and registry-derived corpus
   and is not a complete index of GitHub. Grounded in Phase 5's measured facts —
   16 repositories, no GitHub-wide crawl, COR-05's named unreachable shards. The
   corpus is not the ecosystem, so this page has no standing to make a claim
   about what the ecosystem contains.

**The three non-existence phrasings the rendered-body grep asserts absent** —
`does not exist`, `no such artifact`, `not available anywhere`. Grep the `curl`
output, never the source: the check is about what a reader is told, and a source
comment is told to nobody. If a fourth phrasing is written, add it to this list
and to the grep in the same commit.

The scope sentence renders as a muted line under the results on **every** search
result page too, not only the zero-result one — a reader who got three results
needs the same context as a reader who got none. It renders once per page, not
per row.

D-53: if any result-row or page copy surfaces truncation status, it must not
overstate it. `artifactsTruncated` currently conflates the file cap, the
wall-clock deadline and a raw fetch that threw, and that is a Deferred Idea this
phase must not amplify. The simplest compliance is to surface no truncation
status on this route at all; take that unless a specific need appears.

## Reference D — the facet controls

Inside the same `<form method="get" action="/artifacts">` 06-02 created, so one
submit carries the query and both facet sets and no client JavaScript is needed
anywhere:

- Type: a native `<select name="type">` with a labelled `All types` default
  option and one option per `ARTIFACT_TYPE_IDS` entry. A `<select>` rather than
  chips or links keeps D-29's "avoid a large filter panel" and needs no styling
  beyond the browser's.
- Capability: three `<input type="checkbox" name="cap" value="...">`, each with
  its own `<label htmlFor>`. Repeated `cap` parameters arrive as an array, which
  is why `SearchFilters.capabilities` is validated against the closed id set
  rather than coerced.
- One muted sentence beneath them, satisfying D-08 without a verdict word:
  these filters describe what AgentDock observed while reading the files, not
  everything an artifact can do.

Applying a filter must reset `page` to 1 — a reader on page 4 who narrows to two
results and lands on the past-the-end branch has been told, correctly but
uselessly, that there is no page 4. The form omits `page` entirely, which
achieves this by construction rather than by a reset rule.

`hrefFor` (06-02) grows the two filter parameters, so Previous, Next and both
empty-state links carry the whole state. This is the reason 06-02 built the
helper rather than four template strings.

</reference>

<tasks>

<task type="auto">
  <name>Task 1: Narrowing that happens in SQL, on the version the artifact's own page shows</name>
  <files>src/db/queries/search.ts, src/db/queries/search.test.ts</files>
  <read_first>
    - src/db/queries/search.ts (06-02's shared WHERE builder, the two query functions and SEARCH_CAPS)
    - src/db/queries/packages.ts:25-39 (latestVersion, and the comment stating why the filter and the page must judge the same version) and :127-149 (NOT_LISTED_BECAUSE, including the parse_status = 'failed' branch that already excludes catalog) and :188-194 (the correlated-subquery idiom)
    - src/db/schema.ts:136-148 (why `files` is on package, not package_version) and :218-271 (capability_finding's columns, its category comment, and the capability_finding_identity unique index the EXPLAIN plan uses)
    - src/analyze/files.ts:1-30 (SCRIPT_EXTENSIONS and the measurement behind it)
    - src/db/queries/capabilities.ts:1-47 (how findings are read today, keyed on packageVersionId)
    - src/ingest/pipeline.ts:287-318 (the catalog seeds branch — the pipeline fact decision 7 rests on)
    - .planning/phases/AGD-06-search-browse/06-RESEARCH.md § "DIS-06 Capability Filter" and § "`catalog` semantics (D-34)"
  </read_first>
  <precondition>06-01's search_vector column and 06-02's shared WHERE builder are both present in agentdock_test; the capability fixtures this task writes need capability_finding rows joined through package_version, which the test schema has had since Phase 4.</precondition>
  <behavior>
    - A type filter for 'command' returns only command rows, and the returned count equals countSearchResults for the same filters.
    - A type value that is not in the closed id set is dropped, and the query returns the unfiltered result set rather than nothing.
    - A repeated type parameter is handled without a throw.
    - no_network excludes an artifact whose latest version has a network_request finding and keeps one whose only network_request finding is on an older version.
    - no_shell excludes an artifact with a declared finding whose signal is 'Bash' and one whose signal is 'Bash(git:*)', and keeps one whose declared signal is 'Read'.
    - no_scripts excludes an artifact whose files contain a path ending in each of the seven SCRIPT_EXTENSIONS, tested once per extension, and keeps one whose files contain only .md and .json.
    - The three filters applied together return a subset of any two of them applied together.
    - Filters compose with a text query and with the empty browse query, and countSearchResults agrees with searchPackages in all four combinations.
    - A type='catalog' row is absent from searchPackages for a text query, for the browse query, and for every filter combination — the D-34 regression.
    - Filter application does not change the relative order of two rows that both survive it.
    - A row snapshot of the sentinel-prefixed rows before and after every filtered query is byte-identical.
  </behavior>
  <action>
    Apply Reference A.

    Put the type and capability conjuncts inside 06-02's shared `WHERE` builder,
    not beside it. The rows and the count must be filtered by the same
    expression, and the visible symptom of them disagreeing is a paginator whose
    last page does not exist — Phase 5 already paid for that lesson once with
    `countPackages`' missing join.

    Use the correlated latest-version subquery idiom `packages.ts` already uses
    twice, not a lateral join. RESEARCH measured 1,152 ms against 25.5 ms for the
    two shapes of a comparable query in this schema.

    Import `SCRIPT_EXTENSIONS` and build the regex from it. Retyping the seven
    extensions here would let the search filter and the detail page's "not
    analyzed" marker drift into disagreeing about what a script is, and that
    disagreement would be invisible until someone compared two pages.

    Offer only absence filters. `install` recall is 0 of 6 on real `npm ci` and
    `network_request` runs 15% false-positive with zero new hits on a doubled
    corpus; a presence filter over those detectors would present a measurement
    gap as a property of the artifact. An absence filter says what AgentDock
    observed, which is a claim AgentDock can support.

    Validate the incoming ids against the closed arrays and drop anything else.
    An unmatchable type string reaching `IN (...)` returns an empty page that
    looks exactly like a legitimate zero-result search, which is the worst
    available failure mode because nobody reports it.

    Write the catalog regression test even though it needs no code. It asserts a
    property of the ingestion pipeline that this phase depends on and does not
    own, and a future phase that starts writing listable catalog rows should fail
    here rather than quietly put a marketplace manifest in someone's search
    results.

    Record `EXPLAIN (ANALYZE, BUFFERS)` for the full triple-exclusion filter plus
    the listing predicate at real corpus size. RESEARCH measured 97 ms and found
    the existing `capability_finding_identity` index already serving the
    `(package_version_id, category)` lookup. Confirm that is still the plan, and
    if the number has moved above 200 ms, record the plan and stop rather than
    adding an index on intuition (D-46).
  </action>
  <verify>
    <automated>bun run test -- src/db/queries/search.test.ts &amp;&amp; bun run typecheck &amp;&amp; bun run lint</automated>
  </verify>
  <acceptance_criteria>
    - `bun run test -- src/db/queries/search.test.ts` passes all eleven behaviours, including one case per entry in SCRIPT_EXTENSIONS.
    - `grep -c "from '@/analyze/files'" src/db/queries/search.ts` is 1 and `grep -c 'SCRIPT_EXTENSIONS' src/db/queries/search.ts` is at least 1.
    - `grep -vE "^\s*[/*]" src/db/queries/search.ts | grep -c "'\.py'\|'\.sh'\|'\.mjs'"` is 0 — the extension list is imported, never retyped.
    - `grep -c "export const ARTIFACT_TYPE_IDS" src/db/queries/search.ts` is 1, and comment-filtered `grep -v '^\s*[/*]' src/db/queries/search.ts | grep -c "'catalog'"` is 0 — the id is in no executable line, and the comment explaining why it is absent does not trip the check. <!-- planner-discipline-allow: 'catalog' -->
    - Comment-filtered `grep -v '^\s*[/*]' src/db/queries/search.ts | grep -ci 'lateral'` is 0.
    - Live query `select count(*) from agentdock.package p join agentdock.repository r on r.id = p.repository_id where <listing predicate and all three exclusions>` is run against the real corpus and its number recorded beside the total listed count; RESEARCH measured 708 of 921 and a materially different number is a signal to investigate before proceeding.
    - `EXPLAIN (ANALYZE, BUFFERS)` for the triple-exclusion filter is recorded in the SUMMARY with execution time, corpus row count, and whether `capability_finding_identity` was used.
    - `git diff --stat` shows no change to `package.json`.
  </acceptance_criteria>
  <done>A reader can ask for slash commands with no observed network request, no declared Bash grant and no bundled script, get an answer computed entirely in one SQL statement against one snapshot, and get the same total from the paginator as from the rows — and a plugin marketplace manifest cannot appear in that answer, asserted rather than assumed.</done>
</task>

<task type="auto">
  <name>Task 2: One more line shape on the one log function, and the key set stays closed</name>
  <files>src/log.ts, src/log.test.ts</files>
  <read_first>
    - src/log.ts (the whole file — IngestLog's field discipline, the seedsSkipped comment at 23-37 explaining why a zero is emitted explicitly, WorkerLog's minimalism, and the closed-union rule at 58-64)
    - src/log.test.ts (the whole file — the capture() helper, the exact sorted KEYS assertion, the TOKEN/DSN sentinel constants, the line-length bound, and the @ts-expect-error union case; this file EXISTS despite what RESEARCH and VALIDATION say, see this plan's `<research_drift>` section)
    - src/db/queries/search.ts (SEARCH_CAPS.maxQueryLength, ARTIFACT_TYPE_IDS, CAPABILITY_FILTER_IDS — the bounds and closed sets the log fields rely on)
    - .planning/phases/AGD-06-search-browse/06-CONTEXT.md D-44 and § "Brief vs GSD conflicts" item 3
  </read_first>
  <behavior>
    - A fully populated search entry serializes to exactly the declared sorted key set, asserted the same way the ingest line already is.
    - resultCount is present as the number 0 when a search matched nothing, not omitted.
    - types and capabilities are present as empty arrays when no filter is applied, not omitted.
    - query is present as the empty string for a browse request, not omitted.
    - The serialized search line contains neither planted sentinel, no `ghp_`, no `postgres://` and nothing matching Bearer/authorization/password.
    - A search line built with the longest query SEARCH_CAPS permits stays under a stated length bound.
    - log() still accepts an ingest entry and a worker entry unchanged — the existing cases keep passing.
    - A value outside the event union is rejected at type-check time, following the existing @ts-expect-error case.
  </behavior>
  <action>
    Apply Reference B.

    Extend `src/log.test.ts`; do not create a second log test file. It already
    exists — this plan's `<research_drift>` section records that RESEARCH and
    VALIDATION both say otherwise — and it already carries the sentinel
    constants, the `capture()` helper and the exact-key-set discipline the search
    line needs. Two files would mean two copies of the secret-absence proof, and
    the copies would drift.

    Add one union member and widen one signature. No second logging function, no
    new module, no DB table. DIS-08 asks for queries and result counts to be
    logged, and `console.log(JSON.stringify(...))` on stdout is what this project
    logs with.

    Emit zero and empty explicitly. `IngestLog.seedsSkipped`'s comment already
    states the rule and the reason — a field that appears only when non-zero
    makes its absence ambiguous between "no results" and "an older build" — and
    the search line's `resultCount`, `types` and `capabilities` all have that
    property.

    Keep both array fields typed against the closed id sets, not as bare
    `string[]` at the call site. The union's own rule is that no key can hold an
    arbitrary object; `query` is the single deliberate exception and it is
    bounded before it arrives, which is the whole of the privacy answer D-44
    asks for.

    Document `durationMs`'s span in its comment. It covers the rows query and the
    count query together, and a duration whose boundaries are undocumented is a
    number nobody can act on when this log is read for the semantic-search
    decision it exists to inform.
  </action>
  <verify>
    <automated>bun run test -- src/log.test.ts &amp;&amp; bun run typecheck &amp;&amp; bun run lint</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "event: 'search'" src/log.ts` is at least 1 and `grep -c 'SearchLog' src/log.ts` is at least 2 (the type and the widened signature).
    - `ls src/log*.test.ts | wc -l` is 1 — no second log test file was created.
    - `bun run test -- src/log.test.ts` passes, including every pre-existing ingest and worker case.
    - The search-line test asserts `Object.keys(parsed).sort()` against an explicit literal array containing exactly: `capabilities, durationMs, event, page, query, resultCount, totalCount, ts, types`.
    - A test asserts `parsed.resultCount === 0` and `typeof parsed.resultCount === 'number'` for a zero-result entry, and `parsed.types` and `parsed.capabilities` are both `[]` for an unfiltered entry.
    - The sentinel-absence assertions from the existing suite are applied to the search line, including a case where the sentinel token is planted **inside the query field** and the assertion is that the line contains it — proving the query field is genuinely free-form and that the risk is documented rather than silently absent. Record this case and its rationale in the SUMMARY.
    - `git diff --stat` shows no change to `package.json`.
  </acceptance_criteria>
  <done>The one log function this project has gained a third line shape whose key set is asserted closed, whose zeroes and empty arrays are emitted rather than omitted, and whose single free-form field is bounded, documented and knowingly the one exception to the union's own rule.</done>
</task>

<task type="auto">
  <name>Task 3: Facets that need no JavaScript, and a zero-result page that does not speak for GitHub</name>
  <files>src/app/artifacts/page.tsx, src/app/globals.css</files>
  <read_first>
    - src/app/artifacts/page.tsx (06-02's form, hrefFor helper, three empty-state branches and the zero-result placeholder this task replaces)
    - src/db/queries/search.ts (ARTIFACT_TYPE_IDS, CAPABILITY_FILTER_IDS, SearchFilters, SEARCH_CAPS — the closed sets the route validates against)
    - src/components/CapabilityPanel.tsx:1-30 (CATEGORY_LABELS and the countsByCategory doc — the observation register D-28 requires, and the comment explaining why a summed total is a score with one term)
    - scripts/check-boundaries.mjs:285-347 (VERDICT_WORDS, the SANCTIONED ledger, and the JSX/string spans rule six scans — every new sentence in this task is scanned by it)
    - src/log.ts (the widened log() signature from Task 2)
    - src/app/globals.css:150-180 and :237-340 (.muted, .rows, .pager — the register the facet row and the zero-result copy must match)
    - .planning/phases/AGD-06-search-browse/06-CONTEXT.md D-08, D-26, D-27, D-28, D-29, D-38, D-39, D-50, D-51, D-52, D-53
  </read_first>
  <behavior>
    - The facet controls render in the HTML with no client JavaScript, inside the same GET form as the search input.
    - Selecting a type and submitting with the keyboard alone narrows the results and puts the selection in the URL.
    - The selected type and the checked capability boxes are re-rendered as selected/checked from the URL after navigation, refresh and back.
    - Applying a filter returns to page 1 rather than preserving a page number that may no longer exist.
    - A zero-result search renders the query, at least two next-step links, and the corpus-scope sentence.
    - The zero-result branch never renders for a browse request with no query and no filters.
    - The three empty states render three distinguishable messages.
    - The corpus-scope sentence also renders on a non-empty result page, once per page.
    - Exactly one search log line is emitted per request, for both search and browse.
    - Every new string passes check-boundaries rule six.
  </behavior>
  <action>
    Apply References C and D.

    Put the facets inside the existing form. One submit carries the query and
    both facet sets, no control needs `'use client'`, and the whole surface keeps
    working with JavaScript disabled — which is the convention 06-02 wrote down
    and this is its first test.

    Omit `page` from the form. That resets to page 1 on every filter change by
    construction, and a construction is one fewer rule to remember than a reset
    branch.

    Re-render the selection from the URL, not from state. `defaultValue` on the
    select and `defaultChecked` on the checkboxes, both derived from the
    validated `searchParams` — D-35's requirement is that a pasted link restores
    the whole page, and controls that render unselected after a direct navigation
    are the visible half of failing it.

    Say what did not match; never say it does not exist. Sixteen repositories,
    two of them 69% of the corpus, and no GitHub-wide crawl — this index does not
    have standing to make a claim about the ecosystem, and D-38 is the sentence
    that keeps it from making one anyway.

    Show the scope line on result pages too. A reader who got three results is
    forming a picture of the ecosystem from a curated corpus just as much as a
    reader who got none, and the line costs one muted paragraph.

    Write the capability filter copy in the observation register and then run the
    rule. `CapabilityPanel.tsx:10-16` is the vocabulary — "install directives",
    "network requests", "declared grants" — and rule six's word list is the
    mechanical check. New copy is the most common way that rule goes from passing
    to failing, and it fails the whole build, not just this page.

    Surface no truncation status. `artifactsTruncated` conflates the file cap,
    the wall-clock deadline and a raw fetch that threw; it is an explicit
    Deferred Idea for this phase and the only way to not overstate it here is to
    not state it.

    Emit the log line from the route, once, around both queries. The query module
    is `react.cache`-wrapped, so a call from inside it emits either zero lines or
    two depending on cache behaviour, and neither is the one line DIS-08 asks
    for.

    Finish with the rendered pass. Use the gstack `browse` skill — no new E2E
    framework, per D-51 and the phase brief — over browse → search `mcp` → apply
    a type filter → apply a capability filter → open a result detail → back →
    page 2, at a default and a narrow viewport, and record the console output.
  </action>
  <verify>
    <automated>bun run check:boundaries &amp;&amp; bun run test &amp;&amp; bun run typecheck &amp;&amp; bun run lint</automated>
  </verify>
  <acceptance_criteria>
    - Comment-filtered — `grep -v '^\s*[/*]' src/app/artifacts/page.tsx | grep -cE "^\s*'use client'"` is 0. <!-- planner-discipline-allow: 'use client' -->
    - `curl -s http://localhost:3000/artifacts` returns 200 and its body contains `name="type"`, three `name="cap"` inputs, and a `<label` for each.
    - `curl -s 'http://localhost:3000/artifacts?type=command&cap=no_network&cap=no_scripts'` returns 200, its body shows the select rendered with `command` selected and both checkboxes checked, and the rendered row count is less than the unfiltered count on the same page.
    - `curl -s 'http://localhost:3000/artifacts?q=zzzzqqqqnotathing'` returns 200 and its body contains the query string, at least two `<a`/`<Link` next-step hrefs, and the corpus-scope sentence.
    - The **rendered HTML body** of the zero-result page contains none of the non-existence phrasings — asserted by grepping the `curl` output, not the source, so a comment cannot satisfy or break it. The three phrasings to grep for are listed in Reference C's branch-3 note. <!-- planner-discipline-allow: does not exist -->
    - `bun run check:boundaries` exits 0 with the new filter labels, the D-08 sentence, the zero-result copy and the scope sentence all in place.
    - Server stdout during one `/artifacts?q=mcp&type=command` request contains exactly one line matching `"event":"search"`, and exactly one during one `/artifacts` browse request; both lines are recorded in the SUMMARY.
    - A gstack `browse` pass over the full flow at default and narrow viewport widths is recorded with its console output; any console error is recorded rather than omitted.
    - `git diff --stat` shows no change to `package.json`.
  </acceptance_criteria>
  <done>A reader narrows by type and by observed capability using native controls that work with JavaScript off, gets a page whose whole state survives a paste and a refresh, and when nothing matches is told what did not match, what to try next, and that this index is a curated corpus rather than GitHub — and the server wrote exactly one structured line about it.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| `?type=` and `?cap=` → SQL predicates | Untrusted, possibly repeated parameters become `IN` and `NOT EXISTS` conjuncts |
| stored `files[].path` → a regex | Third-party path strings matched against a pattern |
| `?q=` and the applied filters → stdout | Untrusted text persisted to the project's log sink |
| capability findings → filter copy | A measurement with known misses turned into user-facing words |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-06-16 | Tampering | `?type=` / `?cap=` reaching a SQL predicate | high | mitigate | Both are validated against closed `as const` id arrays and anything unmatched is dropped, so the value that reaches `IN`/`NOT EXISTS` is always one of a fixed set of literals bound as a Drizzle parameter. The failure mode of skipping this — an unmatchable string returning an empty page indistinguishable from a real zero-result search — is asserted against directly. |
| T-06-17 | Denial of Service | ReDoS in the `no_scripts` path regex | medium | mitigate | `\.(py\|sh\|js\|ts\|rb\|ps1\|mjs)$` is a fixed non-backtracking alternation over literal extensions with no nested quantifier, built from the imported `SCRIPT_EXTENSIONS` constant. No user input reaches it — it matches only stored `files[].path` values, already bounded by `ANALYZE_CAPS.maxInventoryEntries`. |
| T-06-18 | Information Disclosure | the search log line carrying a credential or a response body | high | mitigate | `SearchLog` is a closed union member with no free-form payload key; `types` and `capabilities` hold members of closed sets; `query` is the single deliberate exception, bounded at `SEARCH_CAPS.maxQueryLength`. The test asserts the exact sorted key set and re-applies the existing suite's planted-sentinel proof, and additionally documents the `query` field's free-form nature with a case rather than leaving it implicit. |
| T-06-19 | Repudiation | a capability filter read as a safety guarantee | high | mitigate | Absence filters only, worded in Phase 4's observation register (`No network request observed`, not `Safe`), with one muted D-08 sentence stating these describe what AgentDock observed and not everything an artifact can do. `check-boundaries.mjs` rule six is the mechanical gate and runs in Task 3's verify command. D-07 keeps capability out of ranking entirely. |
| T-06-20 | Tampering / XSS | filter values and the query echoed into the facet controls and the zero-result copy | medium | mitigate | `defaultValue`, `defaultChecked` and text nodes are all React-escaped bindings; no `dangerouslySetInnerHTML` on this route; rule 5's `no-raw-html` runs in the same verify command. |
| T-06-21 | Information Disclosure | a suppressed artifact surfacing through a filter path that bypasses the listing predicate | high | mitigate | Filters are conjuncts inside the one shared `WHERE` builder that already carries `NOT_LISTED_BECAUSE is null`; there is no filter-only query path. The COR-07 cases from 06-01 run against every filter combination in Task 1's suite. |
| T-06-22 | Denial of Service | an unbounded number of repeated `cap` parameters | low | mitigate | Validation intersects against a three-member closed set, so the predicate count is bounded at three regardless of how many parameters arrive — D-41's "max filters" satisfied by the set rather than by a counter. |
| T-06-23 | Repudiation | overstating truncation status to a reader | medium | mitigate | No truncation status is surfaced on this route at all. `artifactsTruncated` conflates three unrelated causes and is an explicit Deferred Idea; not stating it is the only way to not overstate it (D-53). |
| T-06-SC | Tampering | npm/pip/cargo installs | high | mitigate | Not applicable and asserted: this plan installs no package, and all three tasks assert `package.json` is unchanged. |
</threat_model>

<artifacts_this_phase_produces>
Symbols this plan creates:

**Functions and types**
- `SearchFilters` — `src/db/queries/search.ts`
- `ARTIFACT_TYPE_IDS` — `src/db/queries/search.ts` (`as const`, five listable ids)
- `CAPABILITY_FILTER_IDS` — `src/db/queries/search.ts` (`no_network`, `no_shell`, `no_scripts`)
- `SearchLog` — `src/log.ts` (new closed-union member; `log()`'s signature widened)
- `TYPE_FILTER_LABELS` and `CAPABILITY_FILTER_LABELS` — `src/app/artifacts/page.tsx` (module-local label tables, decoupled from the ids per D-26)

**New file paths:** none. `src/log.test.ts` and `src/db/queries/search.test.ts`
are both extended in place.

**New route segments:** none. `/artifacts` gains the `type` and `cap` query
parameters.

**New SQL identifiers:** none. This plan adds no column, no index and no
migration.

**New CSS classes**
- `.facets` — `src/app/globals.css` (the filter row inside the existing search form)

**New CLI or package scripts:** none.
</artifacts_this_phase_produces>

<verification>
1. A type filter and each capability filter narrow the result set in SQL, and `countSearchResults` agrees with `searchPackages` for every combination.
2. An unknown or repeated `type`/`cap` value is dropped rather than producing an empty page.
3. `no_scripts` is asserted once per entry in `SCRIPT_EXTENSIONS`, and the list is imported rather than retyped.
4. `no_network` and `no_shell` read the latest `package_version`, proven by a fixture whose older version carries the finding.
5. All three exclusions and the listing predicate live in one statement, and a before-and-after row snapshot is byte-identical.
6. A `type = 'catalog'` row never appears in search output, for any query or filter combination.
7. The triple-exclusion `EXPLAIN (ANALYZE, BUFFERS)` is recorded with the corpus row count and the index used; the live pass count is recorded beside 921.
8. The search log line's key set is asserted against an exact sorted literal, zeroes and empty arrays included, and the planted sentinels are re-proved.
9. Exactly one `"event":"search"` line is emitted per request, for search and for browse.
10. Facet controls render, submit and re-render their selection from the URL with no client JavaScript.
11. A filter change resets to page 1.
12. Three empty states are distinguishable; the zero-result branch names the query, offers two next steps, and carries the scope sentence.
13. The zero-result copy contains none of the non-existence phrasings.
14. `bun run check:boundaries` exits 0 with all new copy in place.
15. A gstack `browse` pass over the whole flow at two viewport widths is recorded with its console output.
16. `bun run ci` passes.
</verification>

<success_criteria>
- **DIS-05** — results filter by artifact type, in SQL.
- **DIS-06** — results filter by declared capability, including the "no scripts, no network, no shell" composition, in SQL, on the latest version.
- **DIS-07** — a zero-result search states the fact, offers next steps, and discloses corpus scope.
- **DIS-08** — every query and its result count is logged, structured, from the first search release.
- **DIS-10** — no dependency, no service, no API route.
- **D-07 / D-08 / D-28** — capability is a filter, never a ranking signal, never a complete inventory, never a verdict.
- **D-26 / D-29 / D-30** — labels decoupled from ids, a small filter set, and no client-side filtering.
- **D-34** — `catalog` needs no special-casing, and the invariant it rests on is locked with a test.
- **D-38 / D-39** — the corpus is not the ecosystem, said on the page.
- **D-44** — structured logging on the project's existing sink, with the privacy question answered rather than avoided.
- ROADMAP criteria 3, 4, 5 and 6.
</success_criteria>

<output>
Create `.planning/phases/AGD-06-search-browse/06-03-SUMMARY.md` when done.

Record: the live count of artifacts passing all three capability exclusions,
beside the total listed count, and how it compares to RESEARCH's measured
708/921; the triple-exclusion `EXPLAIN (ANALYZE, BUFFERS)` with execution time,
corpus row count and index used; the exact sorted key list asserted for the
search log line; the two captured `"event":"search"` log lines, one search and
one browse, verbatim; the exact new UI strings — filter labels, the D-08
sentence, the zero-result copy and the scope sentence — so a reviewer can read
them against rule six's word list without opening the diff; and the gstack
`browse` console output for both viewport widths. Record no credential and no
connection string.

Commits follow GSD's atomic-commit protocol on `develop`. **Do not `git push`,
do not change `main`, and make no remote change of any kind.**
</output>
</content>
