---
phase: AGD-06-search-browse
plan: 04
type: execute
wave: 4
depends_on: [06-03]
files_modified:
  - src/db/schema.ts
  - drizzle/
  - src/db/queries/search.ts
  - src/db/queries/search.test.ts
  - src/app/artifacts/page.tsx
autonomous: false
requirements: [DIS-04, DIS-10]

user_setup:
  - service: postgresql
    why: "pg_trgm supplies the trigram operator class the typo-tolerance index and the fuzzy fallback both require. agentdock_app is a non-superuser with has_database_privilege('agentdock_app','mcpdb','CREATE') = false, so AgentDock cannot install it and D-04 forbids it from trying."
    dashboard_config:
      - task: "Connect to mcpdb as a superuser and run: CREATE EXTENSION pg_trgm SCHEMA agentdock;"
        location: "The PostgreSQL 16.14 instance behind DATABASE_URL — verified reachable as `docker exec didim-mcp-service-backend-db-1 psql -U mcp -d mcpdb`"
      - task: "Repeat for the test schema's database if agentdock_test lives in a different database; if it is the same database, the one extension serves both."
        location: "Same instance"

estimate:
  tokens: 95000
  raw_tokens: 95000
  tasks: 4
  confidence: low

must_haves:
  truths:
    - "Each of the three maintainer-named typo queries — playwrit, postgress, mcp-sever — returns the artifact it was aiming at, and the row it returned plus its measured similarity value is recorded"
    - "The fuzzy path runs only when the full-text query returned zero rows; a query that returns full-text results issues no trigram query at all, proven by counting statements rather than by reading the code"
    - "Fuzzy results obey the same listing predicate as full-text results, so a fork, an unparsed artifact and the losing member of a duplicate pair are absent from a typo query as well"
    - "Fuzzy results obey the same deterministic tie-break, so repeating a typo query returns the same rows in the same order"
    - "Fuzzy matching covers both name and summary, because the corpus rows that answer 'playwrit' carry the word only in their summary — a name-only fallback would return nothing for one of the three named examples"
    - "The migration fails loudly, with a message naming the exact superuser command, when pg_trgm is absent, and it leaves no partial state behind because scripts/migrate.mjs applies every statement of a run in one transaction"
    - "No migration in this phase contains a CREATE EXTENSION statement, with or without a review marker"
    - "The trigram test block skips visibly rather than failing when pg_trgm is absent from the test database, mirroring the existing DATABASE_URL-absent skip"
    - "The fuzzy fallback contributes nothing to the ranking of full-text results — it is a separate query on a separate branch, never a term blended into ts_rank"
    - "package.json gains no dependency and no devDependency in this plan"
    - statement: "With pg_trgm absent at query time, the fallback degrades to no fuzzy results and a logged marker rather than a 500 or a leaked Postgres error"
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
    - statement: "No hand-rolled edit-distance, Levenshtein or trigram array implementation in application code (D-05a)"
      status: flagged
      verification: unverified
    - statement: "Trigram similarity is never blended into the full-text relevance score; it is a fallback chain, not a combined ranking (D-02, D-12)"
      status: flagged
      verification: unverified
  artifacts:
    - path: "src/db/queries/search.ts"
      provides: "The zero-result trigram fallback: one query on one branch, sharing the listing predicate and the tie-break with the full-text path"
      exports: ["searchPackages", "SEARCH_CAPS"]
    - path: "src/db/schema.ts"
      provides: "The trigram index declaration using the schema-qualified agentdock.gin_trgm_ops operator class"
    - path: "drizzle/"
      provides: "The migration carrying the pg_trgm presence guard as its first statement and the trigram index as its second"
  key_links:
    - from: "drizzle/ (the trigram migration)"
      to: "the maintainer's out-of-band CREATE EXTENSION"
      via: "a DO block that raises an exception naming the exact superuser command, so a missing extension is a loud migrate-time stop rather than a silent runtime degradation"
      pattern: "pg_trgm extension is not installed"
    - from: "src/db/queries/search.ts"
      to: "src/db/queries/packages.ts"
      via: "the fuzzy branch reuses the same imported NOT_LISTED_BECAUSE fragment, so a typo query cannot surface an artifact an exact query would suppress"
      pattern: "NOT_LISTED_BECAUSE"
---

<objective>
Make a misspelling find the artifact anyway, without inventing a similarity
algorithm and without letting the fallback quietly become the ranking.

Purpose: ROADMAP criterion 2 and DIS-04 both require typo tolerance, and the
brief's own offer to defer it lost to them — 06-CONTEXT § "Brief vs GSD
conflicts" item 1 records the resolution. The maintainer then locked the
implementation path in D-03: `pg_trgm` is installed out of band by a superuser,
because `agentdock_app` has no `CREATE` on the database and D-04 forbids
AgentDock from attempting it. That makes this the one plan in the phase that
depends on an action AgentDock cannot perform, which is why it is its own plan
rather than half of the query pipeline — the rest of the phase ships whether or
not the extension install has happened yet.

Output: a `DO` block that turns a missing extension into a migrate-time
exception naming the exact remediation command; one trigram index using
`agentdock.gin_trgm_ops`; and a fallback branch that runs only when full-text
returned nothing, reusing the listing predicate and the tie-break so a typo
query cannot see anything an exact query would not.

Honours D-02 (FTS first, then `pg_trgm`, as a literal fallback chain), D-03/D-04
(out-of-band install, never `CREATE EXTENSION` in a migration, fail loudly with
the exact command), D-05 (no hand-rolled similarity), D-12 (name similarity is
its own slot, not a blended score), D-31/D-32 (suppression holds on this path
too), D-42 (a missing extension at query time is not a stack trace), D-46 (the
index is measured, not intuited), D-49 (additive, `agentdock` only).
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/phases/AGD-06-search-browse/06-CONTEXT.md
@.planning/phases/AGD-06-search-browse/06-RESEARCH.md
@.planning/phases/AGD-06-search-browse/06-PATTERNS.md
@.planning/phases/AGD-06-search-browse/06-03-SUMMARY.md
@.planning/research/ENVIRONMENT.md
@src/db/queries/search.ts
@src/db/queries/search.test.ts
@src/db/schema.ts
@src/db/client.ts
@scripts/migrate.mjs
@scripts/check-boundaries.mjs
@drizzle/0003_flaky_selene.sql
</context>

<decisions_made_while_planning>

**1. The fallback matches name **and** summary, and that is forced by the data,
not by generosity.**

RESEARCH located real corpus rows for each of the maintainer's three typo
examples, and one of them settles the design: `playwrit` is aiming at
`webapp-testing` and `e2e-testing-patterns`, whose **names contain no form of
"playwright" at all** — the word is in their summaries. A name-only trigram
fallback returns zero rows for one of the three examples the phase is measured
against. So the matched text is `name || ' ' || coalesce(summary, '')`, and the
index is an expression index over exactly that expression, so the predicate and
the index agree by construction.

**2. `word_similarity`, not `similarity`, and the difference is the whole
feature.**

`similarity(a, b)` compares two strings whole, so an eight-character query
against a two-hundred-character concatenation of name and summary scores near
zero no matter how exactly the word appears inside it — the operator would
silently never fire on the case decision 1 just described. `word_similarity(query,
haystack)` scores the best matching word extent inside the haystack, which is
the question actually being asked, and it is index-accelerated by the same
`gin_trgm_ops` class. This is the single most likely place for this plan to be
quietly wrong, so Task 4 measures the three named examples' actual values rather
than assuming the default threshold clears them.

**3. The threshold is measured, and both branches of the measurement are named
in advance.**

`<%` uses the session GUC `pg_trgm.word_similarity_threshold`, default 0.6, and
is the index-usable form. An explicit `word_similarity(...) >= x` predicate is
tunable but not index-usable. Task 4 measures the three examples first: if all
three clear 0.6, ship `<%` and keep the index working. If any falls below, ship
the explicit-threshold form at the measured value, record that the index is
therefore not used by this predicate, and record the un-indexed execution time.
Naming both branches in advance is what makes this a decision rather than an
improvisation at 2 a.m., and it is the same discipline Phase 5 applied to its own
100 ms index gate.

**4. Fallback, not union, and the statement count proves it.**

D-02's evaluation order is FTS → `pg_trgm` → GIN/GiST → B-tree, read literally:
a chain, not a blend. Always-unioning would pay trigram cost on every query and
would risk a fuzzy match outranking an exact one without a score normalization
D-12 never asks for. The branch is `if the full-text query returned zero rows,
run the trigram query instead`, and the assertion is a statement count — a query
with results must issue exactly the two statements 06-02 established, and a query
without them exactly one more.

**5. The index ships, and the reason is D-04 rather than a plan node.**

Hard constraint 8 says every index must be justified by a query plan. The honest
justification here is not "the planner will choose it at 1,137 rows" — it may
well not, and Task 3 records whether it did. The justification is that D-04
requires a missing `pg_trgm` to be a **loud migrate-time failure**, and the only
thing that makes a migration depend on the extension is an object that uses its
operator class. Without the index there is no migration, without a migration
there is no guard, and without a guard a missing extension becomes exactly the
silent runtime degradation D-04 exists to forbid. The `EXPLAIN (ANALYZE,
BUFFERS)` runs either way and the result is recorded either way, including the
uncomfortable case where the planner declines it.

**6. The install is a blocking human checkpoint, not an auth gate and not a
retry.**

`CREATE EXTENSION` has a CLI — `psql` — but not one AgentDock's role can use:
`has_database_privilege('agentdock_app','mcpdb','CREATE')` is false, re-confirmed
live during research with no drift from the pre-measured facts. This is the rare
genuine `checkpoint:human-action`: a superuser action with no path through the
application's own credentials. It sits before the migration, because a migration
that hard-fails is a worse way to discover the extension is missing than being
asked first.

**7. `agentdock.gin_trgm_ops` is written schema-qualified even though it would
resolve unqualified.**

D-03's install command puts the extension in the `agentdock` schema, and
`client.ts:26-45` pins `search_path` to exactly that schema — so a bare
`gin_trgm_ops` would in fact resolve. D-04 requires the qualification anyway, and
it matches this project's everywhere-qualified convention. It also survives a
future `search_path` change that would otherwise turn a working index into an
error at the worst possible moment.

**8. The query-time absence handler is a backstop, and it is labelled one.**

RESEARCH's assumption A1 — that Postgres error class `42883` is what a missing
operator raises at query time — could not be executed live, because doing so
needs the extension to be absent at query time inside a running application
process with its connection pool up. The handler is written, the degradation
path is defined (no fuzzy results, one logged marker, never a 500 and never raw
error text), and the truth is recorded as `verification: backstop` rather than
claimed as proven. If the code number is wrong the catch simply does not fire and
the error surfaces to the same server-component boundary every other database
page already relies on.

</decisions_made_while_planning>

<reference>

## Reference A — the migration

Two statements, in this order, in one generated migration file.

First, the guard — verified live in RESEARCH, wrapped in `BEGIN`/`ROLLBACK`,
raising with exactly the message D-04 asks for:

```sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    RAISE EXCEPTION 'pg_trgm extension is not installed. Ask a superuser to run: CREATE EXTENSION pg_trgm SCHEMA agentdock;';
  END IF;
END $$;
```

This block contains none of `check-boundaries.mjs`'s `DESTRUCTIVE` keywords —
the string `CREATE EXTENSION` appears only inside a quoted message, and rule
three strips SQL comments but not string literals, so **confirm the scan passes
before assuming it does**; if the literal trips the rule, the message must be
assembled so the two words are not adjacent in the source while still printing
adjacent, and the workaround recorded. It is not eligible for a review marker:
D-04 is stricter than the scanner, and no marker makes an actual `CREATE
EXTENSION` statement acceptable in an AgentDock migration.

`scripts/migrate.mjs:65-95` applies every statement of a run inside one
`sql.begin(...)`, so this raising rolls the whole batch back with no partial
state — which is the "fail loudly, no partial state" behaviour D-04 wants, and
it is a property of the existing migrator rather than something this plan builds.

Second, the index. Drizzle declaration, the exact syntax RESEARCH spike-tested
against this project's own pinned `drizzle-kit@0.31.10`:

```ts
index('package_fuzzy_trgm_idx').using(
  'gin',
  sql`(${t.name} || ' ' || coalesce(${t.summary}, '')) agentdock.gin_trgm_ops`,
)
```

Target DDL:

```sql
CREATE INDEX "package_fuzzy_trgm_idx" ON "agentdock"."package"
  USING gin (("name" || ' ' || coalesce("summary", '')) agentdock.gin_trgm_ops);
```

The spike verified the single-column form (`${t.name} agentdock.gin_trgm_ops`)
emits correctly; the parenthesized expression form is a step beyond what was
spiked. Generate, read the emitted SQL against the target above, and hand-correct
the `.sql` file if drizzle mangles the parentheses or drops the qualification —
`drizzle/0003_flaky_selene.sql:12-14` is this project's own sanctioned precedent
for a reviewed hand-edit after generation, and its comment explains why the
`drizzle/meta` snapshot stays correct.

Guard first, index second, and hand-order them if generation puts them the other
way round: an index creation that fails on a missing operator class produces
`ERROR: operator class "agentdock.gin_trgm_ops" does not exist for access method
"gin"` — verified live, and not the actionable message D-04 asks for.

## Reference B — the fallback query

A new private function in `src/db/queries/search.ts`, called from
`searchPackages` **only** when the full-text branch returned zero rows and the
normalized query is non-empty.

Matched expression, identical to the index expression character for character:
`package.name || ' ' || coalesce(package.summary, '')`.

Predicate, preferred form (index-usable): `$q <% (<matched expression>)`.
Fallback form if the measurement in Task 4 shows a named example below the 0.6
default: `word_similarity($q, <matched expression>) >= SEARCH_CAPS.fuzzyThreshold`.

Everything else is shared with the full-text path and must be reached by calling
the same code, not by copying it:
- `isNull(packageTable.delistedAt)` and the imported `NOT_LISTED_BECAUSE is null`
  — via 06-02's shared `WHERE` builder, so suppression, type filters and
  capability filters all apply on this branch too.
- `ORDER BY word_similarity(...) DESC, package.updated_at DESC, package.id ASC`
  — the same two tie-break keys, so a repeated typo query does not reshuffle.
- The same projection and the same correlated `commitSha` subquery, so a fuzzy
  result row is indistinguishable in shape from an exact one.

`rank` on this branch is the `word_similarity` value. It is **not** added to,
averaged with, or normalized against `ts_rank` — the two never appear in one
query, which is what makes D-02's chain a chain.

Runtime absence handling: wrap only the fallback call in a `try`/`catch` that
inspects the Postgres error code for `42883` (undefined function/operator),
returns an empty array, and emits one `log()` marker. Do not wrap the full-text
call — it has no such dependency, and a broad catch there would swallow the
connection errors D-42 wants distinguished from user-query errors.

`SEARCH_CAPS` gains `fuzzyThreshold`, carrying the measured values for the three
named examples in its comment so a future reader can see what the number was
chosen against rather than guessing.

## Reference C — the extension-aware test skip

`search.test.ts` gains a nested block whose skip condition is the extension's
presence, mirroring the file's existing `describe.skipIf(!DB_URL)`:

```ts
// Resolved in beforeAll, before the block's own cases run.
const [{ present }] = await sql`
  select exists(select 1 from pg_extension where extname = 'pg_trgm') as present`;
```

Because `describe.skipIf` needs its condition at collection time and this one
needs a database round trip, resolve it once in the outer `beforeAll` and have
each fuzzy case call `it.skip`-equivalent guard, or gate the block behind a
module-level probe — take whichever vitest 4.1.10 supports cleanly, and leave a
comment saying which and why. The requirement is that the suite **skips
visibly** rather than fails when the extension is absent, because CI and most
local databases will not have it, matching the `DATABASE_URL`-absent behaviour
this file already has.

The fuzzy fixtures need their own rows under the `test-owner/search-spec`
prefix: one artifact whose **name** is close to a planted typo, and one whose
**name is unrelated** but whose **summary** contains the target word — the
second is the `playwrit` shape from decision 1 and it is the case a name-only
implementation fails.

</reference>

<tasks>

<task type="auto">
  <name>Task 1: Tests that skip when the extension is missing and fail when the fallback is</name>
  <files>src/db/queries/search.test.ts</files>
  <read_first>
    - src/db/queries/search.test.ts (the whole file — the search-spec prefix, the clean()/beforeAll/afterAll shape, and the adversarial and filter suites this extends)
    - src/db/queries/packages.test.ts:1-49 (the DATABASE_URL-absent skip this new skip must mirror)
    - vitest.config.ts (what the runner supports for conditional describe blocks at 4.1.10)
    - .planning/phases/AGD-06-search-browse/06-RESEARCH.md § "Fallback trigger design" (the three typo examples and the live rows that answer them)
    - .planning/phases/AGD-06-search-browse/06-VALIDATION.md § Wave 0 Requirements (the extension-absent skip is a named gap)
  </read_first>
  <precondition>DATABASE_URL is set and agentdock_test is migrated through 06-03; the extension may or may not be installed, and this task's whole point is that both states are handled without a red suite.</precondition>
  <behavior>
    - With pg_trgm absent, the fuzzy block skips visibly and the rest of the search suite still runs and passes.
    - With pg_trgm present, the fuzzy block runs.
    - A typo against a fixture whose NAME is close returns that fixture.
    - A typo against a fixture whose SUMMARY carries the target word, and whose name does not, returns that fixture — the playwrit shape.
    - A query that returns full-text results does not return any fuzzy-only row, proving the branch is a fallback and not a union.
    - A fuzzy query does not return a fixture in a forked repository, a fixture whose latest version parse_status is 'failed', or the losing member of a duplicate pair.
    - A fuzzy query repeated twice returns the same ids in the same order.
    - A fuzzy query with a type filter and a capability filter applies both.
    - A row snapshot before and after every fuzzy query is byte-identical.
  </behavior>
  <action>
    Apply Reference C.

    Write these before the fallback exists, so the suite is red on the fuzzy
    cases and green on everything else. That split — red where the feature is
    missing, green where it is not — is what makes Task 4's completion
    observable rather than self-reported.

    Plant two fixtures, not one. The name-close fixture is the obvious case; the
    summary-only fixture is the one that fails a name-only implementation, and it
    is the shape of the real corpus row that answers `playwrit`. A suite with
    only the first would pass against an implementation that cannot satisfy one
    of the three examples the phase is measured against.

    Mirror the existing skip's visibility. A suite that silently passes because
    it did not run is worse than one that fails: the reason the
    `DATABASE_URL`-absent skip is written the way it is, and CI will not have the
    extension.

    Reuse the search-spec prefix and the file's existing `clean()`. Do not add a
    second prefix and do not insert an `ingest_job` row.

    Assert the fallback-not-union property by observation, not by inspection: run
    a query that has full-text results and assert the fuzzy-only fixture is
    absent from them. Reading the code to confirm there is an `if` is not a test.
  </action>
  <verify>
    <automated>bun run test -- src/db/queries/search.test.ts 2>&amp;1 | tail -30</automated>
  </verify>
  <acceptance_criteria>
    - `bun run test -- src/db/queries/search.test.ts` runs to completion in both states; with the extension absent the run reports the fuzzy cases as skipped and reports zero failures for the rest of the file.
    - `grep -c "pg_extension" src/db/queries/search.test.ts` is at least 1 — the skip is driven by the actual extension state, not by an env var.
    - The suite contains a fixture whose summary carries the target word and whose name does not, identifiable by a comment naming the `playwrit` shape.
    - With the extension present, the fuzzy cases FAIL because the fallback does not exist yet, and that output is recorded in the SUMMARY as the RED baseline.
    - `grep -c "test-owner/search-spec" src/db/queries/search.test.ts` is at least 1 and no second sentinel prefix was introduced.
  </acceptance_criteria>
  <done>The search suite states, in runnable form, that a misspelling finds an artifact by name and by summary, that the fuzzy path is a fallback rather than a union, and that suppression holds on it — and it skips visibly on a database without the extension instead of turning CI red.</done>
</task>

<task type="checkpoint:human-action" gate="blocking">
  <name>Task 2: Install pg_trgm — the one action AgentDock cannot take</name>
  <what-built>Nothing yet. The next task ships a migration that creates an index using `agentdock.gin_trgm_ops` and, by design, fails loudly if the extension is not installed.</what-built>
  <how-to-verify>
    This is the rare action with no path through the application's own
    credentials. `agentdock_app` is a non-superuser and
    `has_database_privilege('agentdock_app','mcpdb','CREATE')` is `false` —
    re-confirmed live during this phase's research with no drift. D-04 forbids
    AgentDock from attempting the install even if it could.

    1. Connect to the target database as a superuser. The route verified during
       research is:
       `docker exec -it didim-mcp-service-backend-db-1 psql -U mcp -d mcpdb`
    2. Run exactly:
       `CREATE EXTENSION pg_trgm SCHEMA agentdock;`
    3. Confirm:
       `select extname, extversion from pg_extension where extname = 'pg_trgm';`
       — expect one row, version `1.6`.
    4. If `agentdock_test` lives in a different database, repeat there. If it is
       the same database, the one extension serves both schemas.

    If you would rather not install it now, say so — the phase's other three
    plans are already shipped and DIS-04 is the only requirement waiting on
    this. Nothing else regresses.
  </how-to-verify>
  <resume-signal>Type "installed" once `select extname from pg_extension where extname='pg_trgm'` returns a row, or "skip" to leave DIS-04 unshipped and stop this plan here.</resume-signal>
</task>

<task type="auto">
  <name>Task 3: [BLOCKING] A migration that either creates the index or says exactly what to run</name>
  <files>src/db/schema.ts, drizzle/</files>
  <read_first>
    - src/db/schema.ts:107-160 (packageTable's index array, and the comment 06-01 rewrote about pg_trgm still being installed out of band only)
    - drizzle/0003_flaky_selene.sql:12-22 (the sanctioned hand-edit-after-generate precedent and the comment explaining why the meta snapshot stays correct)
    - drizzle/0005_rainy_saracen.sql (statement-breakpoint convention and schema-qualified targets)
    - scripts/migrate.mjs:65-95 (one transaction per run — the reason a raising guard leaves no partial state)
    - scripts/check-boundaries.mjs:26-49 (DESTRUCTIVE, stripSqlComments, and the qualified-target rules the new SQL must satisfy — note that comment stripping does not strip string literals)
    - src/db/client.ts:9-45 (assertSchemaIsolation and the pinned search_path, and why the qualification is defence in depth rather than necessity)
    - .planning/phases/AGD-06-search-browse/06-RESEARCH.md § "Trigram Fallback Design" (the live-verified guard, the live-verified bare-index error, and the drizzle-kit spike)
  </read_first>
  <precondition>Task 2 is resolved with "installed" and `select extname from pg_extension where extname='pg_trgm'` returns a row against the database behind DATABASE_URL; if it returns nothing this migration is designed to fail, and failing it deliberately once to observe the message is part of this task.</precondition>
  <reversibility rating="one-way">Once this index ships, the schema depends on an extension AgentDock's role can neither install nor remove: dropping `pg_trgm` would break the index, and re-creating it needs a superuser. The dependency was locked by the maintainer in D-03 and is gated by Task 2's blocking human checkpoint immediately before this task, which is where the confirmation belongs.</reversibility>
  <action>
    Apply Reference A.

    Declare the index in `src/db/schema.ts`, then `bun run db:generate`, then
    read the emitted SQL, then `bun run db:migrate` — the generate → review →
    migrate order D-49 names. `drizzle-kit push` and `drizzle-kit migrate` are
    both unusable in this project and rule four of the boundary scanner enforces
    it.

    Hand-add the `DO` guard as the migration's **first** statement. Generation
    will not produce it, and a bare index creation on a missing extension raises
    `ERROR: operator class "agentdock.gin_trgm_ops" does not exist for access
    method "gin"` — verified live, and not an actionable message. The hand-edit
    is sanctioned by this project's own precedent and the precedent's comment
    explains why the snapshot stays correct.

    Check the guard against the boundary scanner before assuming it passes. Rule
    three strips SQL comments but not string literals, and the guard's message
    contains the two words the rule matches on. If the scan trips, assemble the
    message so those words are not adjacent in the source while still printing
    adjacent, and record the workaround — do not add a review marker, because
    D-04 is stricter than the scanner and no marker makes an actual extension
    creation acceptable here.

    Observe the failure path once, deliberately. Point the migrator at a database
    without the extension — or temporarily rename the check's target in a
    throwaway copy — and capture the exact stderr, so the SUMMARY records what a
    maintainer will actually see rather than what the plan hoped they would. Then
    apply for real.

    Apply to both databases: `bun run db:migrate`, then
    `bun run db:test:generate && bun run db:test:migrate`. Task 1's fuzzy block
    reads the extension state from the test database, so without the second the
    suite will keep skipping and the RED-to-GREEN transition Task 4 needs will
    never be observable.

    Record `EXPLAIN (ANALYZE, BUFFERS)` for the fallback predicate against the
    live corpus with the row count, and state plainly whether the planner chose
    `package_fuzzy_trgm_idx` or a sequential scan. At 1,137 rows a decline is a
    fact about corpus size, not a wrong decision — the index's justification is
    D-04's loud-failure requirement, and the measurement is recorded either way.
  </action>
  <verify>
    <automated>bun run db:generate &amp;&amp; bun run check:boundaries &amp;&amp; bun run db:migrate &amp;&amp; bun run db:test:generate &amp;&amp; bun run db:test:migrate &amp;&amp; bun run typecheck</automated>
  </verify>
  <acceptance_criteria>
    - The new file under `drizzle/` contains `RAISE EXCEPTION` as part of a `DO $$` block appearing before any `CREATE INDEX` in the same file, verified by comparing line numbers.
    - The guard's message, as raised, is byte-identical to: `pg_trgm extension is not installed. Ask a superuser to run: CREATE EXTENSION pg_trgm SCHEMA agentdock;`
    - `grep -cE '^\s*(CREATE\s+EXTENSION)' drizzle/*.sql` is 0 — no migration executes an extension creation at statement level.
    - `bun run check:boundaries` exits 0.
    - `grep -c 'didim_mcp\|"public"\.' ` over the new migration is 0, and every target is `"agentdock"."package"`.
    - Live query `select indexname, indexdef from pg_indexes where schemaname='agentdock' and indexname='package_fuzzy_trgm_idx'` returns one row whose definition contains `gin_trgm_ops`, and the same query against `agentdock_test` returns one row.
    - The captured stderr from a deliberate run against an extension-less database is recorded in the SUMMARY verbatim, showing the actionable message and no partial state.
    - `EXPLAIN (ANALYZE, BUFFERS)` for the fallback predicate is recorded with execution time, corpus row count, and whether the index was chosen.
  </acceptance_criteria>
  <done>A migration exists that creates the trigram index when the extension is there and stops the entire batch with the exact superuser command when it is not — applied to both schemas, boundary-clean, containing no extension creation of its own, and with both the failure message and the query plan recorded rather than described.</done>
</task>

<task type="auto">
  <name>Task 4: A misspelling reaches the artifact, and only when nothing else did</name>
  <files>src/db/queries/search.ts, src/db/queries/search.test.ts, src/app/artifacts/page.tsx</files>
  <read_first>
    - src/db/queries/search.ts (06-02's shared WHERE builder, the tie-break, SEARCH_CAPS, and 06-03's filter conjuncts the fuzzy branch must inherit)
    - src/db/queries/search.test.ts (Task 1's red fuzzy cases, and the fallback-not-union assertion)
    - src/db/queries/packages.ts:127-149 (NOT_LISTED_BECAUSE — imported, never restated, on this branch too)
    - src/log.ts (the widened log signature from 06-03, for the degradation marker)
    - src/app/artifacts/page.tsx (where the result count comes from, so a fuzzy page's copy is honest about what it did)
    - .planning/phases/AGD-06-search-browse/06-RESEARCH.md § "Fallback trigger design" and Assumptions Log A1
  </read_first>
  <precondition>Task 3's migration is applied to agentdock and agentdock_test, and `select extname from pg_extension where extname='pg_trgm'` returns a row against both; without it Task 1's fuzzy block skips and this task's completion cannot be observed.</precondition>
  <behavior>
    - Each of playwrit, postgress and mcp-sever returns at least one row against the LIVE corpus, and the row returned is the one RESEARCH named.
    - A query with full-text results issues exactly the two statements 06-02 established; a query without them issues exactly one more.
    - The fuzzy branch inherits the type filter, the capability filters and the listing predicate.
    - The fuzzy branch's ORDER BY has the same two tie-break keys, and repeating a fuzzy query returns identical ids in identical order.
    - No trigram value appears in any full-text result's rank.
    - A fuzzy result page states that it is showing close matches rather than exact ones, in wording that passes check-boundaries rule six.
    - With the extension absent at query time, the fallback returns an empty array and emits one log marker rather than throwing.
  </behavior>
  <action>
    Apply Reference B.

    Measure the three named examples before choosing the predicate form. Run
    `word_similarity` for each of `playwrit`, `postgress` and `mcp-sever` against
    the live corpus's concatenated name-and-summary expression, record the actual
    values, and then take the branch decision 3 named in advance: all three at or
    above 0.6 means the index-usable operator form ships unchanged; any one below
    means the explicit-threshold form ships at the measured value and the SUMMARY
    records that the index is not used by this predicate together with the
    un-indexed execution time. Do not tune the number until the three examples
    pass — pick it from the measurement and write the three values into the
    constant's comment.

    Use the word-extent similarity function, not the whole-string one. An
    eight-character query against a two-hundred-character concatenation scores
    near zero on whole-string similarity no matter how exactly the word appears
    inside it, and the case that exposes it is the summary-only fixture — the
    same shape as the real row that answers `playwrit`.

    Match the index expression character for character. A predicate that differs
    from the indexed expression by a space or a `coalesce` cannot use the index,
    and the symptom is a plan, not an error.

    Reach the shared predicate by calling it, not by copying it. The fuzzy branch
    must inherit suppression, type filters and capability filters, and the way it
    inherits them is 06-02's builder — a second hand-written `WHERE` here is how a
    typo query starts returning forks.

    Keep the two scores in two queries. Never add, average or normalize a
    similarity value against `ts_rank`; they do not appear in one statement, which
    is what makes D-02's evaluation order a chain rather than a blend that nobody
    can explain.

    Wrap only the fallback call. A broad catch around the full-text call would
    swallow the connection-level failures D-42 wants distinguished from
    user-query ones, and the full-text path has no extension dependency to guard
    against.

    Tell the reader what happened. A page whose rows came from the fuzzy branch
    says so — close matches, not exact ones — and that sentence goes through
    `check-boundaries` rule six like every other new string on this route.

    Prove the three examples in a browser, not only in a test. Request
    `/artifacts?q=playwrit`, `?q=postgress` and `?q=mcp-sever` against the live
    corpus and record the artifact names that came back, so the maintainer's own
    acceptance examples are answered with the product rather than with a fixture.
  </action>
  <verify>
    <automated>bun run test -- src/db/queries/search.test.ts &amp;&amp; bun run check:boundaries &amp;&amp; bun run typecheck &amp;&amp; bun run lint &amp;&amp; bun run ci</automated>
  </verify>
  <acceptance_criteria>
    - Task 1's fuzzy cases all pass where they failed in Task 1, and the transition is recorded in the SUMMARY.
    - `curl -s 'http://localhost:3000/artifacts?q=playwrit'`, `?q=postgress` and `?q=mcp-sever` each return 200 with at least one result row, and the artifact names returned are recorded in the SUMMARY beside the names RESEARCH predicted.
    - `grep -c 'word_similarity' src/db/queries/search.ts` is at least 1 and `grep -cE '\bsimilarity\s*\(' src/db/queries/search.ts` counts only `word_similarity` occurrences — the whole-string form is not used.
    - `grep -c 'fuzzyThreshold' src/db/queries/search.ts` is at least 1, and its comment contains the three measured values.
    - `grep -vE '^\s*[/*]' src/db/queries/search.ts | grep -c 'ts_rank.*word_similarity\|word_similarity.*ts_rank'` is 0 — the two scores never appear in one expression.
    - `grep -c '42883' src/db/queries/search.ts` is 1, and the try/catch it sits in wraps only the fallback call, verified by reading the enclosing block.
    - The statement count for a query with full-text results and for a query without them is taken from `.toSQL()`/instrumentation and recorded; the first is 2 and the second is 3.
    - `bun run check:boundaries` exits 0 with the close-matches copy in place.
    - `bun run ci` passes.
    - `git diff --stat` shows no change to `package.json`.
  </acceptance_criteria>
  <done>Typing `playwrit`, `postgress` or `mcp-sever` into the running application returns the artifact it was aiming at, the trigram query runs only when the exact one found nothing, suppression and filters hold on that path, and the two relevance scores never meet inside one statement.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| `?q=` → a trigram similarity operand | Untrusted free text becomes an operand of an extension-provided operator |
| a migration → an extension AgentDock's role cannot create | A schema object whose existence depends on an out-of-band superuser action |
| a missing operator at query time → the rendered page | A runtime failure with a raw Postgres error text one layer away from a reader |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-06-24 | Tampering | `?q=` reaching the trigram operand | high | mitigate | The query is a bound Drizzle parameter on both the operator and the ordering expression, never concatenated into SQL. It is already normalized and truncated at `SEARCH_CAPS.maxQueryLength` by 06-02 before it arrives, and it reaches no `LIKE` metacharacter interpretation on this path — trigram operators do not treat `%` or `_` specially. |
| T-06-25 | Denial of Service | a migration leaving partial state on a missing extension | high | mitigate | `scripts/migrate.mjs:65-95` applies each run's statements inside one `sql.begin(...)`, so the guard's `RAISE EXCEPTION` rolls the whole batch back. Asserted by a deliberate run against an extension-less database whose stderr is captured verbatim. |
| T-06-26 | Information Disclosure | a raw Postgres error surfacing when the operator is absent at query time | medium | mitigate | A `42883`-scoped catch around **only** the fallback call returns an empty array and emits one `log()` marker, so a reader sees a normal zero-result page. RESEARCH's assumption A1 could not be executed live, so the truth carries `verification: backstop`; if the code number is wrong the catch does not fire and the failure reaches the same server-component boundary every other database page already relies on, which is a degradation to today's behaviour rather than a new exposure. |
| T-06-27 | Information Disclosure | a suppressed artifact surfacing through the fuzzy branch | high | mitigate | The fuzzy branch calls 06-02's shared `WHERE` builder rather than writing its own, so `NOT_LISTED_BECAUSE is null` and every filter conjunct apply identically. Task 1 asserts a fork, an unparsed artifact and the losing duplicate are all absent from a fuzzy query. |
| T-06-28 | Denial of Service | trigram cost paid on every query | medium | mitigate | Fallback, not union: the trigram query runs only when the full-text query returned zero rows, asserted by a statement count of 2 for a query with results and 3 for one without, taken from instrumentation rather than from reading the code. |
| T-06-29 | Repudiation | a fuzzy match presented as an exact one | low | mitigate | A result page whose rows came from the fallback says it is showing close matches, and that string passes `check-boundaries.mjs` rule six like every other new string on the route. |
| T-06-30 | Tampering | a migration reaching outside the owned schema | high | mitigate | Every target is `"agentdock"."package"`; the operator class is written schema-qualified as `agentdock.gin_trgm_ops`; `check-boundaries.mjs` rules 1–3 run in Task 3's verify command and the acceptance criteria grep the new migration for `public`, `didim_mcp` and statement-level extension creation. |
| T-06-SC | Tampering | npm/pip/cargo installs | high | mitigate | Not applicable and asserted: this plan installs no npm, pip or cargo package. The one external dependency is a PostgreSQL contrib extension installed out of band by the maintainer under a blocking human checkpoint (Task 2), which is the human-verification gate the package-legitimacy protocol asks for applied to the only non-source dependency this phase acquires. `git diff --stat` showing no `package.json` change is asserted in Task 4. |
</threat_model>

<artifacts_this_phase_produces>
Symbols this plan creates:

**Functions and types**
- a private fuzzy-branch query function in `src/db/queries/search.ts`, called only from `searchPackages`'s zero-result branch
- `SEARCH_CAPS.fuzzyThreshold` — `src/db/queries/search.ts` (new member on the existing object, carrying the three measured similarity values in its comment)

**New file paths**
- `drizzle/0007_*.sql` (name assigned by `drizzle-kit generate`)

**New route segments:** none.

**New SQL identifiers**
- index `package_fuzzy_trgm_idx` — GIN over `(name || ' ' || coalesce(summary, ''))` with the `agentdock.gin_trgm_ops` operator class

**New Drizzle schema members**
- the `package_fuzzy_trgm_idx` entry in `packageTable`'s `(t) => [...]` index array

**New external (non-npm) dependency**
- the PostgreSQL `pg_trgm` extension, version 1.6, installed into the `agentdock` schema out of band by a superuser under Task 2's blocking checkpoint

**New CLI or package scripts:** none.
</artifacts_this_phase_produces>

<verification>
1. `playwrit`, `postgress` and `mcp-sever` each return the artifact RESEARCH named, against the live corpus, through the running application.
2. The summary-only fixture is found, proving the fallback matches summary as well as name.
3. A query with full-text results issues 2 statements; one without issues 3 — fallback, not union.
4. The fuzzy branch inherits suppression, the type filter and the capability filters from the shared predicate builder.
5. A repeated fuzzy query returns identical ids in identical order.
6. Trigram similarity and `ts_rank` never appear in one expression.
7. The migration's guard raises the exact D-04 message, before any index creation, and leaves no partial state — captured verbatim from a deliberate failure run.
8. No migration contains a statement-level extension creation, and `bun run check:boundaries` exits 0.
9. `package_fuzzy_trgm_idx` exists on both `agentdock` and `agentdock_test` with `gin_trgm_ops` in its definition.
10. `EXPLAIN (ANALYZE, BUFFERS)` for the fallback predicate is recorded with the corpus row count and whether the index was chosen.
11. The trigram test block skips visibly when the extension is absent, and the rest of the suite still passes.
12. The chosen `fuzzyThreshold` carries the three measured values in its comment.
13. `bun run ci` passes.

**Deferred to the phase's verification pass:** the query-time `42883` degradation
path, which could not be executed live (RESEARCH A1) and is carried as a
`verification: backstop` truth rather than claimed as proven.
</verification>

<success_criteria>
- **DIS-04** — search tolerates typos via a trigram fallback, demonstrated on the maintainer's own three examples against the live corpus.
- **DIS-10** — PostgreSQL only; the extension is contrib, not a service, and no npm package was installed.
- **D-02** — the evaluation order is a literal chain: full text first, trigram only on zero results.
- **D-03 / D-04** — the extension is installed out of band under a blocking checkpoint; the migration never creates it and fails loudly with the exact command when it is missing.
- **D-05** — no hand-rolled similarity, no edit distance, no trigram array; one index and no application algorithm.
- **D-12** — name similarity occupies its own slot and is never blended into the text-relevance score.
- **D-31 / D-32** — suppression and dedup hold on the fuzzy path, asserted with the same three fixtures.
- **D-42** — a missing operator at query time degrades to a zero-result page and a log marker, never a stack trace.
- **D-46 / D-49** — the index is measured with `EXPLAIN`, and the migration is additive, schema-qualified and boundary-clean.
- ROADMAP criteria 2 and 6.
</success_criteria>

<output>
Create `.planning/phases/AGD-06-search-browse/06-04-SUMMARY.md` when done.

Record: the RED baseline from Task 1; whether Task 2 resolved as installed or
skipped; the verbatim stderr from the deliberate extension-less migration run;
what `drizzle-kit generate` emitted for the expression index and what, if
anything, was hand-corrected; whether the boundary scanner tripped on the guard's
message string and what was done; the measured `word_similarity` values for
`playwrit`, `postgress` and `mcp-sever` and which predicate branch they selected;
the artifact names each of those three queries returned through the running
application, beside the names RESEARCH predicted; the `EXPLAIN (ANALYZE,
BUFFERS)` output with the corpus row count and whether `package_fuzzy_trgm_idx`
was chosen; and the statement counts for a query with and without full-text
results. Record no credential and no connection string.

Commits follow GSD's atomic-commit protocol on `develop`. **Do not `git push`,
do not change `main`, and make no remote change of any kind.**
</output>
</content>
