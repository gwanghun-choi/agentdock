---
phase: AGD-05-corpus-cold-start
plan: 03
type: execute
wave: 3
depends_on: [05-01, 05-02]
files_modified:
  - src/github/search.ts
  - src/github/search.test.ts
  - src/corpus/search.ts
  - src/corpus/search.test.ts
  - src/corpus/caps.ts
  - scripts/corpus-sync.mjs
  - src/db/queries/packages.ts
  - src/db/queries/packages.test.ts
  - src/app/r/[owner]/[repo]/page.tsx
  - src/components/escaping.test.tsx
autonomous: true
requirements: [COR-05, COR-07, DAT-07]

estimate:
  tokens: 100000
  raw_tokens: 100000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "A topic sweep subdivides a shard until it fits under the 1,000-result cap, and names every shard it could not subdivide together with that shard's measured size"
    - "A topic sweep spends zero GitHub core requests, proven by the remaining core budget being unchanged across it"
    - "Shard ranges are disjoint and leave no gap, proven by a pure test with no network"
    - "A forked repository's artifacts are absent from the home listing and from /skills, and present on the repository's own page"
    - "An artifact byte-identical to one already listed from a higher-starred repository is absent from listings, and exactly one of the group survives"
    - "An artifact whose latest version did not parse is absent from listings and reachable at its own URL"
    - "No stored row is written, updated or deleted by any of the three suppressions"
    - "countPackages and the rendered listing agree, including on the last page of the paginator"
    - "A repository page states, in words that pass the verdict lint, how many of its artifacts are not in AgentDock's listings and why"
    - "The repository page shows all 400 artifacts a capped scan can produce, not 250"
  artifacts:
    - path: "src/github/search.ts"
      provides: "The Search API adapter: a pure disjoint star ladder, adaptive subdivision, page walking, and an explicit list of shards the 1,000-result cap put out of reach"
      exports: ["shardLadder", "subdivide", "searchRepositories", "SEARCH_TOPICS", "SearchShardResult"]
      min_lines: 100
    - path: "src/corpus/search.ts"
      provides: "The sweep: walks the ladder from the dense end down under a request budget, writes seeds, returns counters including what it could not reach"
      exports: ["sweepTopics", "TopicSweepResult"]
      min_lines: 60
    - path: "src/db/queries/packages.test.ts"
      provides: "The first direct test of this project's listing queries: fork, duplicate and floor suppression, and the proof that suppression is read-only"
      min_lines: 120
  key_links:
    - from: "src/db/queries/packages.ts"
      to: "src/app/r/[owner]/[repo]/page.tsx"
      via: "notListedBecause travels to the detail page as the reason, so an excluded artifact is explained where it is still reachable"
      pattern: "notListedBecause"
    - from: "src/db/queries/packages.ts"
      to: "src/github/scan.ts"
      via: "the repository page's limit is CAPS.maxFiles rather than a literal, so a cap change cannot silently hide artifacts again"
      pattern: "CAPS.maxFiles"
    - from: "src/corpus/search.ts"
      to: "src/db/queries/seeds.ts"
      via: "search results become seeds through the same upsert every other source uses"
      pattern: "upsertSeeds"
---

<objective>
Reach the repositories a single search query hides, and stop the corpus that
every source in this phase is filling from flooding its own listings.

Purpose: the three read-time requirements here — fork suppression, duplicate
suppression, the visibility floor — are three answers to one question, and they
are all one `WHERE` clause away from being wrong in the same specific way. The
function that filters the home listing *is* the function that fills the
repository detail page (`packages.ts:160`), so an unconditional predicate
satisfies half of COR-07 by breaking the other half. And the sweep that feeds
them is sized by a research estimate that today's measurements contradict: a
star ladder cannot cover a topic, and covering one would be pointless
(05-CONTEXT C11).

Output: `src/github/search.ts` with an adaptive ladder that reports what it could
not reach; one `notListedBecause` expression answering the listing question once,
with a stated precedence; `countPackages` finally counting what the listing
shows; the repository page disclosing a fork and explaining an omission; and the
first direct test file this project's listing queries have ever had.

Honours 05-CONTEXT's decisions that the floor is a package fact and is parse
status alone (C7, D-03), that a star floor in acquisition is a scheduling
decision and not the popularity judgment D-03 refuses (C11), that suppression can
never touch a stored row (DAT-07), and that this plan adds no migration unless a
measurement forces one and says so (C2).
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/phases/AGD-05-corpus-cold-start/05-CONTEXT.md
@.planning/phases/AGD-05-corpus-cold-start/05-RESEARCH.md
@.planning/phases/AGD-05-corpus-cold-start/05-01-SUMMARY.md
@.planning/phases/AGD-05-corpus-cold-start/05-02-SUMMARY.md
@src/db/queries/packages.ts
@src/db/schema.ts
@src/github/client.ts
@src/github/scan.ts
@src/app/page.tsx
@src/app/skills/page.tsx
@src/app/r/[owner]/[repo]/page.tsx
@scripts/check-boundaries.mjs
</context>

<decisions_made_while_planning>

**1. The sweep's headline output is what it could not reach.**

Measured today (05-CONTEXT C11, M3): `topic:claude-code` holds 57,970
repositories, and 36,487 of them — 63% — sit at zero or one star, two star
values that cannot be subdivided and each of which is roughly eighteen times the
1,000-result cap. Full topic coverage is not expensive; it is unreachable. And it
would buy nothing: 57,970 repositories at two core requests each is eighty days
of unauthenticated budget against a queue that holds 500.

So the ladder subdivides until a shard fits, walks from the dense end downward
under a request budget, and returns `unreachableShards` — each with its query and
its measured `total_count`. ROADMAP criterion 4 asks that the result cap "does
not silently truncate coverage". Silence is the failure; incompleteness is a fact
about the world, and the sweep reports it as one.

**2. The star floor is a scheduling decision, and the plan says so where it appears.**

D-03 refuses stars as a listing input because excluding an artifact AgentDock has
already read, on a popularity signal, is a trust judgment. A floor in the sweep
decides which repositories to spend a scarce budget on *first*, among work not
yet done — the same kind of decision the seed list makes ordering by density and
the registry makes sweeping by recency. Nothing is excluded; a zero-star
repository remains submittable, ingestible and listable. That sentence goes in
the code beside the constant, because without it the two decisions read as a
contradiction.

**3. One expression, three answers, in cheapest-first order.**

Fork, duplicate and floor could be three predicates. They are one `CASE`, for two
reasons. First, the interaction has to be stated: a forked repository holding an
unparseable duplicate has one reason shown to a reader, and which one is a
decision, not an accident. Second, `CASE` evaluates in order and stops at the
first true branch — so putting the fork test first (a joined boolean column, no
subquery), the floor second (one correlated subquery), and the duplicate test
last (the expensive one) means most excluded rows never pay for the expensive
test at all.

**4. `listingOnly` defaults to true, and `getRepositoryPackages` opts out.**

Following the optional-`fullName` convention already at `packages.ts:27-32`: same
function, same `cache()` wrapper, one more optional narrowing parameter. The
alternative — a `listPackagesForListing()` wrapper — leaves the default unsafe,
so a future caller that forgets the wrapper leaks forks into a listing. Defaulting
to the safe behaviour and opting out once, at the one call site that genuinely
wants everything, puts the burden on the exception.

**5. `countPackages` grows the join it never had.**

05-CONTEXT C9: `packages.ts:65-71` has no `innerJoin(repository)` at all, despite
`05-PATTERNS.md`'s claim that both queries do. Without it, the home page's
`Browse all {total} skills` (`page.tsx:51`) and `/skills`'s paginator
(`skills/page.tsx:33,35,48-58`) count rows the listing suppresses — and the
paginator has an existing branch that renders "there is no page N", so the
disagreement would surface as a user-visible dead page rather than as an
off-by-a-few number.

**6. The repository page's limit stops being a literal.**

05-CONTEXT C10: `packages.ts:143-146` justifies `limit: 250` by the scan's file
cap, and Phase 4 raised that cap to 400 (`scan.ts:24`) without updating it. The
seed list this phase ships front-loads a repository that will produce exactly
that many. Sourcing the limit from `CAPS.maxFiles` makes the justification true
again and makes the next cap change carry itself. This costs `packages.ts` an
import of `@/github/scan`; the app already pulls that module in (`page.tsx:5`
imports `rateLimitState`), so no new dependency enters the server bundle.

**7. Suppression is proven read-only by a before-and-after row snapshot.**

DAT-07's clause is *"can never corrupt stored data"*. A `SELECT`-only predicate
satisfies it by construction, and "by construction" is exactly the kind of claim
this project has twice found untrue. The test takes a snapshot of the relevant
rows, runs every listing query in both modes, and asserts the snapshot is
byte-identical afterward. It costs four lines and it is the only assertion that
actually checks the requirement rather than the design.

**8. A performance number, not a performance opinion.**

The duplicate test is a correlated `EXISTS` over `package` with a nested
latest-version subquery on both sides, and there is no index on
`package_version.content_hash`. At the corpus size 05-02 produced that is a
few milliseconds; at a hundred thousand packages it is not. The task records
`EXPLAIN ANALYZE` for the real home-page query at the real corpus size, and
carries an explicit gate: over 100 ms, stop and record rather than ship. That is
the one condition under which this phase adds a migration, and the escape hatch
is named in advance so it is a decision rather than an improvisation.

</decisions_made_while_planning>

<reference>

## Reference A — `src/github/search.ts`

Lives inside `src/github/` because it names `api.github.com`, and rule 5's
GitHub pair already covers that directory — no boundary-scanner change here.

`SEARCH_TOPICS`, each carrying the count measured on 2026-08-11 so a future
reader can see how stale the sizing is:

| topic | repositories at measurement |
|---|---|
| `claude-code` | 57,970 |
| `mcp-server` | 23,281 |
| `agent-skills` | 14,524 |
| `claude-skills` | 6,712 |
| `claude-plugin` | 1,688 |

`shardLadder(minStars)` is pure: a descending list of star ranges from
open-ended-high down to `minStars`, disjoint and gapless. `subdivide(range)` is
pure: splits a range into two, returning null when the range is a single star
value and therefore indivisible. Both are tested with no network — the
disjointness and gap-freedom assertions are the whole reason they are separate
from the fetch.

`searchRepositories(query, page)` calls `githubFetch` (`client.ts:126`) so the
allowlist, the manual redirect re-validation, the timeout and the rate-limit
branch are all inherited rather than rewritten. It returns
`{ totalCount, items: { fullName, stars }[] }`, with `fullName` lowercased.

Two properties the sweep depends on:
- **Pagination stops at page 10 or short page**, because 100 x 10 is the
  1,000-result ceiling and asking for page 11 is an error, not more data.
- **A shard whose `totalCount` exceeds 1,000 is subdivided, and one that cannot
  be subdivided is returned as unreachable with its count.** Never truncated,
  never silently paged to 1,000 and left.

**One hazard, recorded rather than engineered around.** `githubFetch` writes
`lastRateLimit` (`client.ts:96-107`) from whatever `x-ratelimit-*` headers came
back, and a search response carries the *search* bucket's numbers. The home page
renders `rateLimitState()` beside copy that describes the 60-per-hour core budget
(`page.tsx:36-42`). This never happens in practice because the sweep runs only
from `scripts/corpus-sync.mjs`, a separate Bun process whose module state the
Next server never sees. Put that sentence at the top of `search.ts` as the reason
this module must not be imported from `src/app/` or `src/components/`, and carry
it out of the phase as a known ceiling.

## Reference B — `src/corpus/search.ts`

`sweepTopics({ minStars, maxRequests })`:
- Walks `SEARCH_TOPICS` and, within each, the ladder from the dense end down.
- Sleeps between requests to respect 10 per minute unauthenticated — a plain
  `await sleep(...)`, no library, no token bucket.
- Stops at `maxRequests` and reports it.
- Writes seeds through `upsertSeeds` with `sourceKind: 'github'`,
  `discoveredFrom: 'github-topic-search'`, `discoveredPath: <the exact query>` —
  so a maintainer can see which query produced a seed — and a `hint` of
  `{ topic, stars }`.
- Returns `{ requestsSpent, shardsCompleted, unreachableShards, seedsUpserted, stoppedBecause }`.

New caps in `src/corpus/caps.ts`, each carrying its arithmetic:

| cap | value | the sentence it carries |
|---|---|---|
| `maxSearchRequests` | `60` | six minutes at the unauthenticated 10-per-minute search rate. Bounds one sweep's wall clock. Does **not** bound coverage — nothing does; see `minStars`. |
| `searchMinStars` | `10` | `stars:0..1` alone is 36,487 repositories in one topic and cannot be subdivided (C11); at this floor the sweep still names more repositories than the ingest budget can consume for months. The floor's job is to make the first few hundred the densest, not to make the set finite. A scheduling decision about unfetched work, not a judgment about an artifact — see 05-CONTEXT C11. |
| `searchRequestSpacingMs` | `6_500` | 10 requests per minute with margin. |

## Reference C — the listing expression

One fragment, built once in `packages.ts` and used in three places: the
projection, `listPackages`'s `where`, and `countPackages`'s `where`. Drizzle `SQL`
objects are immutable descriptors and are safe to reference more than once;
confirm that in the first test rather than assuming it.

```ts
/**
 * Why an artifact is not in AgentDock's listings, or null when it is.
 *
 * Three requirements, one question, one precedence order. Ordered
 * cheapest-first: CASE stops at its first true branch, so a fork never pays for
 * the duplicate test below it.
 *
 * None of this is a judgment about an artifact. A fork is a fact GitHub reports;
 * a duplicate is byte-equality with something already listed; an unparsed file is
 * an outcome of AgentDock's own reading. Stars and age were considered as floor
 * inputs and rejected: excluding an artifact from listings because its
 * repository is unpopular is a trust score wearing a different hat.
 */
const NOT_LISTED_BECAUSE = sql<'fork' | 'duplicate' | 'unparsed' | null>`case
  when ${repository.isFork} then 'fork'
  when (
    select pv.parse_status from ${packageVersion} pv
    where pv.package_id = ${packageTable.id}
    order by pv.ingested_at desc limit 1
  ) <> 'ok' then 'unparsed'
  when exists (
    select 1 from ${packageTable} p2
    join ${repository} r2 on r2.id = p2.repository_id
    where p2.id <> ${packageTable.id}
      and p2.delisted_at is null
      and (select x.content_hash from ${packageVersion} x
           where x.package_id = p2.id order by x.ingested_at desc limit 1)
        = (select y.content_hash from ${packageVersion} y
           where y.package_id = ${packageTable.id} order by y.ingested_at desc limit 1)
      and (r2.stars > ${repository.stars}
           or (r2.stars = ${repository.stars} and p2.id < ${packageTable.id}))
  ) then 'duplicate'
  else null
end`;
```

The canonical row in a duplicate group is the one whose repository has the most
stars, tie-broken by the lowest `package.id`. That is total and antisymmetric, so
exactly one member of every group survives — assert that with a three-way
duplicate in the test, not just a pair. Stars here rank *copies of one thing*
against each other, which is a tie-break; they never rank one artifact above a
different artifact, which would be the judgment D-03 refuses.

`ponytail:` comment naming the upgrade: an additive
`CREATE INDEX ON package_version (content_hash)` when the measurement in Task 3
says it is needed. Not built until then.

## Reference D — the signature changes

```ts
export type PackageListItem = {
  // ...existing fields...
  /** Null when the artifact is in AgentDock's listings. Set by NOT_LISTED_BECAUSE. */
  notListedBecause: 'fork' | 'duplicate' | 'unparsed' | null;
};

listPackages({ limit, offset, fullName, listingOnly = true })
countPackages({ listingOnly = true } = {})
```

`getRepositoryPackages` (`packages.ts:147-162`) passes
`{ fullName, limit: CAPS.maxFiles, listingOnly: false }`.

`RepositorySummary` and the `repositorySummary` projection (`packages.ts:115-138`)
gain `isFork`, which is already joined and simply never selected.

## Reference E — the repository page

Two additions, both in the register the page already uses, both plain JSX text
nodes that React escapes.

1. A fork disclosure in the existing `row-meta` line, beside `Archived on GitHub`
   (`r/[owner]/[repo]/page.tsx:52`), rendered only when true: `A fork on GitHub`.
2. One muted line, only when at least one artifact on the page is not in
   listings, naming the counts by reason. Something in this shape, with the
   numbers computed from `notListedBecause`:

   > Three of these are on this page and not in AgentDock's listings: one is in a
   > fork, one is byte-identical to an artifact AgentDock lists from another
   > repository, and one has a file AgentDock could not parse.

Check every word against rule 6's list before writing it: `safe`, `clean`,
`verified`, `trusted`, `approved`, `malicious`, `grade`, `risk score`. None of the
copy above uses any of them, and none of it implies an excluded artifact is worse
than an included one — it says where the artifact is, not what it is worth.
`bun run check:boundaries` is the mechanical check and it runs in this task's own
verify command.

No change to `PackageRows`. It is shared with the home and `/skills` listings
where every row is, by definition, listed, and giving it a reason column would
put a permanently-empty column on two pages to serve a third.

## Reference F — `src/db/queries/packages.test.ts`

This project's listing queries have never had a direct test; `packages.ts` is
exercised only through pages. The file follows `jobs.test.ts:1-44` exactly:
`process.env.DATABASE_SCHEMA = 'agentdock_test'` before any import,
`describe.skipIf(!DB_URL)`, dynamic imports inside `beforeAll`,
`beforeEach(clean)`, and a sentinel prefix distinct from every existing one —
`test-owner/listing-spec-*`.

`clean()` deletes by that prefix across `package_version`, `package` and
`repository`, in dependency order. Nothing here inserts an `ingest_job` row, so
this suite cannot destabilise `jobs.test.ts`'s claim assertions — say so in a
comment, because the next person to add a job row here needs to know why they
should not.

The fixtures the suite builds, all under the sentinel prefix:
- a normal repository with two parseable artifacts;
- a fork with one parseable artifact;
- two repositories at different star counts holding byte-identical artifacts,
  plus a third at the same star count as one of them, to prove the tie-break;
- a repository whose artifact's latest version has `parse_status` of `failed`;
- an artifact with two versions, the older `failed` and the newer `ok`, to prove
  the floor reads the latest version and not any version.

## Reference G — the measurement gate

After Task 2, against the real corpus 05-02 produced:

1. `EXPLAIN ANALYZE` the exact query `listPackages({ limit: 10 })` emits — take
   the SQL from Drizzle's `.toSQL()` rather than retyping it, so the measured
   query is the shipped one.
2. Record total packages, total versions, and the measured execution time in the
   summary.
3. **Gate: over 100 ms, stop.** Do not ship a slow listing and do not improvise a
   fix. The named remedy is one additive
   `CREATE INDEX ON package_version (content_hash)` generated the normal way
   (`db:generate`, read every emitted line, delete any `CREATE SCHEMA`,
   `db:migrate`, `db:test:setup`), and it is the only circumstance in this phase
   under which a migration is correct. Record the before and after timings if it
   comes to that.

</reference>

<tasks>

<task type="auto">
  <name>Task 1: A topic sweep that reports what the result cap hid from it</name>
  <files>src/github/search.ts, src/github/search.test.ts, src/corpus/search.ts, src/corpus/search.test.ts, src/corpus/caps.ts, scripts/corpus-sync.mjs</files>
  <behavior>
    - shardLadder returns ranges that are disjoint, gapless, and descending, for several floors including the default.
    - subdivide halves a multi-value range and returns null for a single-star-value range.
    - A shard whose reported total is under the cap is walked to completion and produces every result it holds.
    - A shard whose reported total exceeds the cap is subdivided rather than paged to the cap and abandoned.
    - A shard that exceeds the cap and cannot be subdivided is returned in unreachableShards with its measured total.
    - Page walking stops at page ten and at the first short page, and never requests page eleven.
    - The sweep stops at maxSearchRequests and reports that as the reason.
    - Search results become repo_seed rows carrying the exact query in discoveredPath.
    - Across the sweep's tests the captured host list contains api.github.com and nothing else.
    - Re-running the sweep over the same stubbed responses writes no new seed.
  </behavior>
  <action>
    Apply References A and B.

    Keep the ladder and the subdivision pure and test them with no network. They
    are the part of COR-05 that can be wrong in a way no live run would reveal: a
    ladder with a one-star gap loses every repository at that value and nothing
    reports it.

    Call githubFetch rather than fetch. The allowlist, the manual redirect
    re-validation, the ten-second timeout and the rate-limit branch are all
    already written and reviewed there, and a second fetch path for the same host
    is a second place to get SSRF wrong.

    Put the rate-limit-state hazard at the top of search.ts as a comment: a search
    response's x-ratelimit headers describe the search bucket, githubFetch records
    them in the same module-level slot the home page reads, and the page's copy
    describes the core budget. It is harmless only because the sweep runs in the
    batch script's own process. That is why this module must never be imported
    from src/app or src/components.

    Subdivide, do not truncate. A shard paged to a thousand and left is exactly
    the silent truncation ROADMAP criterion 4 names, and it is indistinguishable
    from a complete shard in the output unless the code makes the distinction.

    Sleep between requests. Ten per minute is the unauthenticated ceiling and a
    burst gets a 403 with a retry-after header, which githubFetch turns into a
    thrown rate_limited error mid-sweep.

    Print, at the end of the sweep and in the returned counters: requests spent,
    shards completed, seeds written, and every unreachable shard by query and by
    measured size. That last list is the deliverable, not a footnote.

    Verify live once, and note that this costs zero core requests: run the sweep
    with a small request budget against the real API, and record the remaining
    core budget before and after to prove the two buckets are genuinely separate.
    Record how many seeds it produced and the unreachable shard list verbatim.
  </action>
  <verify>
    <automated>bun run test src/github/search.test.ts src/corpus &amp;&amp; bun run check:boundaries &amp;&amp; bun run typecheck</automated>
  </verify>
  <done>A topic sweep walks a disjoint star ladder from the dense end down, subdividing until a shard fits under the 1,000-result cap, and ends by naming every shard it could not reach with that shard's measured size — for zero GitHub core requests, proven by a core budget that did not move.</done>
</task>

<task type="auto">
  <name>Task 2: One expression, three suppressions, and the two counts that must agree</name>
  <files>src/db/queries/packages.ts, src/db/queries/packages.test.ts</files>
  <behavior>
    - A fork's artifact is absent from listPackages with the default, present with listingOnly false.
    - Of two repositories holding byte-identical artifacts, exactly the higher-starred one's is listed.
    - Of three repositories holding byte-identical artifacts, exactly one is listed, and adding a fourth at an equal star count does not change which.
    - An artifact whose latest version parse status is not ok is absent from listings.
    - An artifact whose older version failed and whose newest version is ok is present, so the floor reads the latest version and not any version.
    - A forked repository holding an unparseable artifact reports exactly one reason, and it is the fork.
    - getRepositoryPackages returns every artifact for its repository, each carrying its own reason or null.
    - countPackages with the default equals the number of rows listPackages returns across all its pages.
    - A row snapshot of package, package_version and repository taken before every listing query is byte-identical afterward.
    - getRepositoryPackages returns more than 250 rows for a repository holding more than 250 artifacts.
  </behavior>
  <action>
    Apply References C, D and F.

    Build the expression once and reference it from all three places. Drizzle's
    SQL objects are immutable descriptors, so this is safe — but confirm it with
    the first assertion rather than assuming, because a fragment that silently
    consumed its bindings on first use would make the projection and the
    predicate disagree, which is the one bug here that produces a plausible-looking
    wrong answer.

    Order the CASE cheapest-first and say why in the comment. CASE stops at its
    first true branch, so a fork never pays for the correlated duplicate test.
    The ordering is also the precedence a reader sees, so it is a product decision
    as much as a performance one.

    Add the innerJoin to countPackages. It has never had one — the claim that it
    does is wrong (05-CONTEXT C9) — and without it the home page's total and the
    paginator's last page describe a different set than the rows beside them, and
    the /skills paginator has an existing branch that turns that disagreement into
    a visible dead page.

    Source the repository page's limit from CAPS.maxFiles rather than the literal
    250. The comment above it already claims the limit is the scan's file cap;
    Phase 4 raised that cap to 400 and left the literal behind, and the seed list
    shipped in 05-02 deliberately front-loads a repository that produces exactly
    that many.

    Take the row snapshot before and after. DAT-07's clause is that suppression
    can never corrupt stored data, and a SELECT-only predicate satisfies it by
    construction — which is exactly the kind of claim this project has twice found
    untrue. Four lines, and it is the only assertion that tests the requirement
    rather than the design.

    Use the listing-spec sentinel prefix, distinct from queue-spec, persist and
    corpus-spec. Insert no ingest_job row anywhere in this suite, and leave a
    comment saying why: claimJob takes the oldest claimable row in the whole
    schema, so a queued row here would make another suite flaky.
  </action>
  <verify>
    <automated>bun run test src/db/queries &amp;&amp; bun run typecheck &amp;&amp; bun run lint</automated>
  </verify>
  <done>Forks, byte-identical duplicates and unparsed artifacts are absent from both listings and present on their own repository page, each carrying the single reason it was excluded; countPackages counts exactly what the listing shows; and a row snapshot proves not one stored byte moved.</done>
</task>

<task type="auto">
  <name>Task 3: Say it on the page, and measure what it costs</name>
  <files>src/app/r/[owner]/[repo]/page.tsx, src/components/escaping.test.tsx, src/db/queries/packages.ts</files>
  <behavior>
    - A repository page for a fork shows a fork disclosure beside the existing archived disclosure.
    - A repository page holding excluded artifacts shows one muted line naming how many and why, broken down by reason.
    - A repository page holding no excluded artifacts shows no such line at all, rather than a zero.
    - Every string added in this task passes the verdict-vocabulary rule.
    - The home listing and /skills render only artifacts whose reason is null.
    - EXPLAIN ANALYZE of the shipped home-listing query at the real corpus size is recorded with its execution time.
  </behavior>
  <action>
    Apply References E and G.

    Write the disclosure in the register the page already uses: a span in the
    existing row-meta line for the fork, one muted paragraph for the exclusions.
    No icon, no colour, no badge. The page's existing truncation notice at lines
    39-45 is the tone to match — a visible state, never a silent claim.

    Say where the artifact is, never what it is worth. An artifact excluded as a
    duplicate is byte-identical to one AgentDock lists elsewhere; an artifact
    excluded by the floor has a file AgentDock could not parse. Neither sentence
    ranks it. Run check:boundaries before considering the copy finished — rule 6
    is the mechanical check and this is the first new UI copy since it shipped.

    Render nothing when the count is zero. A line reading "0 of these are not in
    AgentDock's listings" is noise on every well-formed repository, which is most
    of them.

    Take the EXPLAIN ANALYZE from Drizzle's own toSQL output, not from a retyped
    query, so the number describes what actually ships. Record the corpus size
    beside it — a timing without a row count is not a measurement.

    Honour the gate: over 100 milliseconds, stop and record rather than ship. The
    named remedy is a single additive index on package_version content_hash,
    generated the normal way and reviewed line by line, and it is the only
    circumstance in this phase where a migration is correct. Do not invent a
    different fix, and do not ship a slow listing while deciding.
  </action>
  <verify>
    <automated>bun run check:boundaries &amp;&amp; bun run test src/components src/db/queries &amp;&amp; bun run typecheck &amp;&amp; bun run ci</automated>
  </verify>
  <done>A repository page discloses that it is a fork and explains, in words the verdict lint accepts, how many of its artifacts are not in AgentDock's listings and why — and the cost of computing that answer is a recorded EXPLAIN ANALYZE at a known corpus size rather than an assumption.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| a search query string → an `api.github.com` URL | Built from a fixed topic list and numeric ranges, but still interpolated into a URL |
| a search response → `repo_seed` → the core budget | Third-party results deciding what AgentDock spends its fetch budget on |
| `notListedBecause` → the repository page | An expression's output rendered as an explanation to a reader |
| the listing predicate → stored rows | The requirement says suppression can never corrupt stored data |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-05-17 | Spoofing / SSRF | the search adapter's URL construction | high | mitigate | `githubFetch` (`client.ts:126`) is the only fetch path — allowlist, https-only, manual redirect re-validation, per-hop timeout, all inherited. The query is built with `URLSearchParams` from a fixed topic list and numeric ranges; `fullName` from a result goes through `normalizeRepo` before it becomes a seed. |
| T-05-18 | Denial of Service | search rate-limit exhaustion mid-sweep | medium | mitigate | `searchRequestSpacingMs` paces to under 10 per minute; `maxSearchRequests` bounds one sweep; a thrown `rate_limited` ends the sweep with counters rather than a crash. |
| T-05-19 | Denial of Service | a hostile repository name in search results flooding the queue | medium | mitigate | Seeds still fan out through `enqueueJob`, inheriting the denylist and `MAX_QUEUED`; `maxSeedsPerSource` bounds the write volume. |
| T-05-20 | Tampering | the listing predicate writing to a stored row | high | mitigate | `SELECT`-only by construction, and proven by a before-and-after row snapshot rather than by the construction argument (decision 7). |
| T-05-21 | Denial of Service | the correlated duplicate `EXISTS` on an unindexed `content_hash` | medium | mitigate | Measured with `EXPLAIN ANALYZE` at the real corpus size with a 100 ms gate; the named remedy is one additive index, decided in advance rather than improvised. |
| T-05-22 | Information Disclosure | a wrong exclusion reason shown to a reader | low | mitigate | One `CASE` with one stated precedence, asserted for the overlapping case (a fork holding an unparseable artifact reports exactly one reason, and which one is a test). |
| T-05-23 | Tampering / XSS | the new repository-page copy | medium | mitigate | Plain JSX text nodes and integers, which React escapes; no interpolation of any repository-controlled string into the new sentence beyond what the page already renders; `no-raw-html` and `no-verdict-vocabulary` both run in this task's verify command. |
| T-05-24 | Repudiation | a partial sweep read as complete coverage | high | mitigate | `unreachableShards` with measured sizes is the sweep's headline output, and the request cap reports itself (decision 1). |
</threat_model>

<verification>
1. Shard ranges are disjoint, gapless and descending, proven with no network.
2. An over-cap shard is subdivided; an indivisible over-cap shard is reported as unreachable with its size.
3. Page walking never requests page eleven.
4. The sweep spends zero core requests, proven by an unchanged core budget across a live run.
5. A fork's artifacts are absent from listings and present on the repository page.
6. Exactly one member of a three-way byte-identical group is listed, and the tie-break is deterministic.
7. The floor reads the latest version, not any version.
8. A fork holding an unparseable artifact reports exactly one reason.
9. `countPackages` and the rendered listing agree across every page, last page included.
10. A row snapshot before and after every listing query is byte-identical.
11. `getRepositoryPackages` returns more than 250 rows when a repository holds more than 250 artifacts.
12. Every new UI string passes rule 6, and the zero case renders nothing.
13. `EXPLAIN ANALYZE` of the shipped listing query is recorded with the corpus size and is under 100 ms, or the gate was honoured and recorded.
14. `bun run ci` passes.
</verification>

<success_criteria>
- **COR-05** — topic search is sharded, subdivides adaptively, and names every shard the 1,000-result cap put out of reach rather than truncating in silence.
- **COR-07** — an artifact below the floor is absent from listings and reachable at its own URL, with the reason stated on the page that still shows it.
- **DAT-07** — forks are stored distinctly and suppressed at read time only, with a row snapshot proving no stored byte moved.
- ROADMAP criteria 4, 6 and 7.
- 05-CONTEXT C9 and C10 — `countPackages` finally counts what the listing shows, and the repository page's limit stops lying about its own justification.
</success_criteria>

<output>
Create `.planning/phases/AGD-05-corpus-cold-start/05-03-SUMMARY.md` when done.
Record: the unreachable shard list from the live sweep, verbatim, with each shard's measured
size; the core budget before and after the sweep; how many seeds the sweep produced; how
many packages the corpus holds and how many of them each exclusion reason accounts for; the
`EXPLAIN ANALYZE` execution time for the shipped home-listing query together with the total
package and version counts it ran against; whether the 100 ms gate was crossed and what was
done; and the exact new UI strings, so a reviewer can read them against rule 6's word list
without opening the diff. Record no credential and no connection string.

**Do not `git add`, do not `git commit`, do not `git push`.** End with a recommended commit
message and leave the working tree for the maintainer. The branch stays `develop`.
</output>
