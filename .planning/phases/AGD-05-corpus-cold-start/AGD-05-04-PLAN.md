---
phase: AGD-05-corpus-cold-start
plan: 04
type: execute
wave: 4
depends_on: [05-01, 05-02, 05-03]
files_modified:
  - README.md
  - scripts/corpus-sync.mjs
  - src/db/queries/packages.ts
autonomous: false
requirements: [COR-06]

estimate:
  tokens: 70000
  raw_tokens: 70000
  tasks: 2
  confidence: low

must_haves:
  truths:
    - "At least 500 packages exist whose latest version parsed cleanly and which are therefore in AgentDock's listings"
    - "The number of parsed artifacts and the number of listed artifacts are the same number, because they are the same predicate"
    - "The whole cold start is reproducible from an empty schema by one documented sequence of commands"
    - "The cold-start proof runs against agentdock_test and leaves that schema in the state the test suite expects"
    - "The run's real cost in GitHub core requests is recorded, not estimated"
    - "A repository truncated by the file cap is visibly truncated on its own page, and the corpus total says how many artifacts that cost"
  artifacts:
    - path: "README.md"
      provides: "The cold-start runbook: empty schema to usable catalog, with the exact commands, the expected counts, and the cleanup step that keeps the test suite deterministic"
      min_lines: 40
  key_links:
    - from: "scripts/corpus-sync.mjs"
      to: "src/db/queries/packages.ts"
      via: "the acceptance count is countPackages itself, so 'parsed artifact' and 'listed artifact' cannot drift into two definitions"
      pattern: "countPackages"
---

<objective>
Fill the index for real, and prove the filling is reproducible from nothing.

Purpose: everything in this phase so far is machinery. COR-06 is the only
requirement that is a fact about the world — that a developer opening AgentDock
finds enough to be worth searching. It is also the requirement most easily
faked: a count taken against a dev schema holding four phases of leftover
ingests proves nothing about whether the path from empty works.

So this plan does two things and no more. It runs the acquisition to five
hundred and records what that actually cost. Then it does the whole thing again
from an empty schema, in `agentdock_test`, as a sequence a maintainer can rerun —
which is the only version of the claim that survives someone dropping the
database.

Output: a corpus of at least five hundred listed artifacts; a recorded cost in
core requests and wall clock; and a README runbook whose last step puts the test
schema back the way the suite needs it.

Honours 05-CONTEXT's finding that five hundred is reachable in six to fourteen
core requests provided the seed order is density-first, that "parsed artifact"
and "above the visibility floor" are the same predicate by construction, and that
`davila7/claude-code-templates` will never converge and must be reported that way
rather than quietly.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/phases/AGD-05-corpus-cold-start/05-CONTEXT.md
@.planning/phases/AGD-05-corpus-cold-start/05-01-SUMMARY.md
@.planning/phases/AGD-05-corpus-cold-start/05-02-SUMMARY.md
@.planning/phases/AGD-05-corpus-cold-start/05-03-SUMMARY.md
@scripts/migrate.mjs
@scripts/dev-reset.mjs
@src/db/queries/packages.ts
@src/github/scan.ts
@src/ingest/pipeline.ts
@README.md
</context>

<decisions_made_while_planning>

**1. The acceptance count is `countPackages()`, not a hand-written query.**

COR-06 says "at least 500 **parsed** artifacts". 05-03's visibility floor is
`parse_status = 'ok'` on the latest version. Those are the same predicate, so
counting with anything other than the shipped `countPackages()` would create a
second definition of "parsed artifact" that can drift from the one the home page
renders. The acceptance criterion is literally the number on the home page.

**2. The proof runs in `agentdock_test`, and putting it back is part of the task.**

`agentdock_test` already exists from Phase 0's bootstrap and is explicitly
disposable, so the cold-start proof never touches the schema holding real ingests
— and `dev-reset.sql:18-24`'s guard rails do not have to be trusted, because the
question is avoided.

The hazard that comes with it is real and must be handled, not noted. Six vitest
suites share `agentdock_test`, and `claimJob` takes the oldest claimable row in
**the whole schema** (`jobs.test.ts:24-27`). A cold-start run leaves real
repository names in `ingest_job`, and any `queued` row left behind makes another
suite's claim assertions nondeterministic. So the runbook's last step is
`db:test:setup`, and the task is not done until `bun run ci` passes **after** the
proof, not before it.

**3. The run is bounded and re-runnable, not one long unattended drain.**

`CORPUS_CAPS.maxEnqueuePerSync` is 25 and the unauthenticated budget is 60 core
requests an hour. The run is therefore several bounded invocations, each printing
what it enqueued and what it left — which is what 05-01's cap discipline was
built for. Recording the actual number of invocations and the actual elapsed time
is more useful than any estimate in this plan, and is the point of doing it.

**4. Truncation is reported as a number, not as a caveat.**

`davila7/claude-code-templates` holds roughly 1,300 candidate artifact paths and
`CAPS.maxFiles` is 400 (`scan.ts:24`), so about 900 are never read, and since
Phase 2 a truncated scan suppresses delisting (`pipeline.ts:362`) — that
repository reads as permanently partial. The page already says so
(`r/[owner]/[repo]/page.tsx:39-45`). What is missing is the corpus-level number:
how many artifacts across the whole corpus were left unread by a cap. That is one
query over `repository.tree_truncated` and it belongs in the summary, because a
five-hundred-artifact corpus that silently left nine hundred behind is a
different fact than one that did not.

**5. No new script and no new flag.**

Everything this plan needs — acquire, fan out, drain, count — already exists on
`scripts/corpus-sync.mjs` from 05-01 and 05-02. If the executor finds itself
adding a flag here, the runbook is describing something the tool cannot do, and
the right fix is almost always the runbook. The one exception this plan permits
is a printed final count sourced from `countPackages()`, per decision 1, which is
a read the script does not yet do.

</decisions_made_while_planning>

<reference>

## Reference A — the run, in order

Density-first, because that is the entire reason five hundred is minutes rather
than hours (05-CONTEXT, "Is COR-06 reachable"). `config/seeds.json`'s order
already encodes this and `unenqueuedSeeds`' `(created_at, id)` ordering already
reproduces it, so the run does not re-decide it — it just does not override it.

1. Confirm the core budget. `GET /rate_limit` costs nothing and tells the
   executor how many invocations this hour holds.
2. `bun run corpus:sync --source=seeds --no-enqueue` — write the operator seeds.
3. `bun run corpus:sync --source=none --enqueue=25 --drain=25`, repeated. Each
   invocation costs up to 50 core requests and prints what it left.
4. After each drain, take `countPackages()` and record it. The curve matters:
   two repositories should account for most of it, and if they do not, the
   density measurements in `config/seeds.json` were wrong and that is worth
   knowing.
5. Stop at 500 or when the seed list is exhausted, whichever comes first. If the
   seed list is exhausted below 500, **do not pad it with unverified
   repositories** — record the shortfall and the number reached. A padded list is
   how a corpus becomes a set of dead links.

The registry and search sources are not part of the count. They produced
thousands of seeds in earlier plans and the queue holds 500; spending this run's
core budget on MCP servers rather than on the artifact-dense repositories would
make the number harder to reach for no gain. Say that in the summary rather than
leaving the omission to be read as an oversight.

## Reference B — the acceptance query

```
bun run corpus:sync --source=none --no-enqueue --count
```

or, if a flag is more than this needs, a three-line node one-liner importing
`countPackages` from `../src/db/queries/packages.ts` in the same style
`analyze-backfill.mjs` imports its modules. Either way the number comes from the
shipped function (decision 1).

Record alongside it, from plain SQL:
- total packages, and how many carry each `notListedBecause` value;
- how many repositories have `tree_truncated` true, and the total candidate paths
  those repositories held versus the 400 each was allowed to read;
- the highest and lowest artifact count contributed by a single repository.

## Reference C — the cold-start proof

The whole sequence, against `agentdock_test`, from research §Q10 with the
cleanup step made mandatory rather than optional:

1. `DATABASE_SCHEMA=agentdock_test bun run db:test:setup` — regenerates the test
   schema's DDL from `schema.ts`. This is the empty starting state, reached
   without `dev-reset.mjs` ever pointing at the real schema.
2. `DATABASE_SCHEMA=agentdock_test bun run corpus:sync --source=seeds --no-enqueue`
   — seeds written, no GitHub cost.
3. `DATABASE_SCHEMA=agentdock_test bun run corpus:sync --source=none --enqueue=3 --drain=3`
   — three repositories, six core requests. Deliberately a slice, not the whole
   list: this proves the path, and the real corpus already exists in `agentdock`.
4. Assert: `countPackages()` against the test schema is greater than zero and
   `listPackages({limit: 10})` returns rows without error. "Usable catalog" is
   defined as the query the home page runs, executed against the test schema —
   not as a number invented for this step.
5. **`DATABASE_SCHEMA=agentdock_test bun run db:test:setup` again.** This is not
   optional and it is not cleanup etiquette: without it, a real repository name
   sits `queued` in the shared test schema and `jobs.test.ts`'s claim assertions
   become nondeterministic (decision 2).
6. `bun run ci`, after step 5, to prove the schema is back.

## Reference D — the README section

A new section, in the register the README already uses. It carries the six steps
above verbatim, the expected shape of each command's output, the two numbers a
maintainer should see, and — stated as prominently as the commands themselves —
that step 5 is required.

It also states the one thing a runbook is for: the cost. Two core requests per
repository, sixty per hour unauthenticated, `CAPS.wallClockMs` of 120 seconds per
repository at `CAPS.concurrency` of 2, so a bounded drain of 25 repositories is
under an hour of wall clock and exactly at the hourly request ceiling.

Do not document a `GITHUB_TOKEN` as a requirement. It is not one: the whole phase
is designed for the unauthenticated baseline (`src/env.ts`'s own comment), and a
token merely makes it faster. Say that, with the 5,000-per-hour figure, so a
maintainer in a hurry knows the lever exists.

</reference>

<tasks>

<task type="auto">
  <name>Task 1: Fill the index to five hundred, and record what it actually cost</name>
  <files>scripts/corpus-sync.mjs, src/db/queries/packages.ts</files>
  <precondition>GitHub core quota is available — `curl -s https://api.github.com/rate_limit` reports a non-zero `resources.core.remaining`. The run needs roughly 30 requests and degrades to waiting, not failing, without them.</precondition>
  <behavior>
    - countPackages() with the shipped default returns at least 500.
    - The count printed by the sync command equals the number the home page renders.
    - Two repositories account for the majority of the corpus, matching the density measurements the seed list was ordered by.
    - Every repository the run ingested reached a terminal job status; none is left queued or running.
    - The corpus-level truncation figure is recorded: how many repositories were capped and how many candidate paths went unread.
  </behavior>
  <action>
    Apply References A and B.

    Take the count from countPackages() and from nothing else. COR-06's "parsed
    artifact" and 05-03's visibility floor are the same predicate, so a
    hand-written count would create a second definition that can drift from the
    one the home page renders. If the script needs a read to do this, add exactly
    that read and no other flag.

    Run in bounded invocations and record the curve, not just the endpoint. Take
    the count after each drain. The seed list is ordered by measured artifact
    density and two repositories should account for most of the total; if they do
    not, the measurements in config/seeds.json were wrong, and finding that out is
    worth more than the round number.

    Do not spend this run's core budget on registry or search seeds. They exist in
    the thousands and the queue holds five hundred; the artifact-dense operator
    repositories are what reaches the number. Say so in the summary so the
    omission reads as a decision.

    Do not pad the seed list. If it is exhausted below five hundred, record the
    shortfall and the number reached. Adding unverified repositories to close a
    gap is how a corpus becomes a set of dead links, and this phase spent real
    budget verifying the fifteen that are in the file.

    Record the truncation cost as a number. One repository will be capped at 400
    of roughly 1,300 candidate paths and will read as permanently partial, because
    a truncated scan suppresses delisting. The page already discloses that per
    repository; the corpus-level figure — how many artifacts a cap left unread
    across the whole run — appears nowhere yet and belongs in the summary.

    Record the real cost: core requests consumed, invocations run, wall clock
    elapsed. Every number in this phase's planning about that cost was a
    projection, and this is the one chance to replace them with a measurement.
  </action>
  <verify>
    <automated>bun run test src/db/queries &amp;&amp; bun run typecheck &amp;&amp; bun run ci</automated>
  </verify>
  <done>At least five hundred artifacts are in AgentDock's listings, counted by the same function the home page calls, with the per-drain curve, the real core-request cost, the wall clock, and the number of artifacts a file cap left unread all recorded rather than estimated.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>
    A corpus of at least five hundred listed artifacts, acquired from the operator
    seed list, plus a reproduction of the whole cold start from an empty
    `agentdock_test` schema and a README runbook for it.
  </what-built>
  <how-to-verify>
    1. Start the app and open the home page. It should say `Browse all N skills`
       with N at or above 500, and the recently-indexed list should render.
    2. Open `/skills` and page to the last page. The paginator's range should
       agree with the total and there should be no "there is no page N" dead page
       at the end — that branch existing and not firing is the check that
       `countPackages` and the listing agree.
    3. Open the repository page for `davila7/claude-code-templates`. It should
       show the partial-read notice, and its artifact count should be at or near
       400 rather than 250.
    4. Open a repository the corpus contains a fork or a duplicate of, if the run
       produced one, and confirm the muted line naming what is not in the
       listings reads as a statement of fact, not as a quality judgment. If the
       run produced none, say so — that is a real outcome, not a skipped step.
    5. Read the new README section and run its six steps yourself against
       `agentdock_test`. Step 5 puts the schema back; step 6 is `bun run ci` and
       must pass.
  </how-to-verify>
  <resume-signal>Type "approved", or name what you saw that the plan did not predict.</resume-signal>
</task>

<task type="auto">
  <name>Task 2: The same thing again, from empty, written down</name>
  <files>README.md</files>
  <precondition>`agentdock_test` exists and is owned by `agentdock_app` — created in Phase 0's one-time superuser bootstrap and confirmed in STATE.md's isolation verification. It cannot be created by the application role.</precondition>
  <behavior>
    - A freshly regenerated agentdock_test schema holds zero packages before the run and more than zero after it.
    - listPackages against the test schema returns rows without error, so "usable catalog" is the query the home page runs rather than a number invented for the proof.
    - After the final db:test:setup, agentdock_test holds no ingest_job row for any real repository.
    - bun run ci passes after the proof, not only before it.
    - The README section names step five as required, not as cleanup.
  </behavior>
  <action>
    Apply References C and D.

    Run the whole sequence against agentdock_test and never against agentdock.
    The test schema exists for exactly this and is disposable; the dev schema
    holds four phases of real ingests and the run has no reason to be near it.

    Use three repositories, not the whole list. Six core requests proves the path
    from empty; the real corpus already exists in the other schema and re-running
    it here would spend an hour to learn nothing new.

    Define "usable catalog" as listPackages and countPackages returning rows and a
    non-zero number against the test schema. Those are the queries the home page
    makes. A bespoke assertion here would be a second definition of the same thing
    and would pass while the page failed.

    Treat the final db:test:setup as part of the proof, not as tidying. Six vitest
    suites share this schema and claimJob takes the oldest claimable row in the
    whole schema, so one real repository left queued makes another suite flaky in
    a way that will be blamed on that suite. Run bun run ci after the reset and
    only call the task done when it passes.

    Write the README section so a maintainer who has never read this plan can
    execute it. State the cost in the same sentence as the commands: two core
    requests per repository, sixty an hour unauthenticated, two minutes of wall
    clock per repository at the shipped caps.

    Do not document GITHUB_TOKEN as a requirement. It is not one, and saying so is
    part of the point — the phase was designed for the unauthenticated baseline.
    Mention it once, with the five-thousand-per-hour figure, as a lever for
    someone in a hurry.
  </action>
  <verify>
    <automated>DATABASE_SCHEMA=agentdock_test bun run db:test:setup &amp;&amp; bun run ci</automated>
  </verify>
  <done>The path from an empty schema to a usable catalog has been executed end to end against agentdock_test, defined by the same queries the home page runs, documented as six commands a maintainer can repeat, and finished with the schema back in the state the test suite requires and the full suite green.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| the operator seed list → 30 GitHub requests | A committed file deciding how a scarce shared budget is spent |
| the cold-start run → `agentdock_test` | A schema six test suites share and depend on the state of |
| the corpus count → a product claim | The number that decides whether browse is "ready" |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-05-25 | Denial of Service | the fill run exhausting core quota mid-drain | medium | mitigate | Bounded invocations under `CORPUS_CAPS.maxEnqueuePerSync`; a rate-limited attempt is refunded and rescheduled by `scheduleRetry` (`jobs.ts:186-189`) rather than failed; the executor checks `/rate_limit` first, which costs nothing. |
| T-05-26 | Tampering | the cold-start run destabilising the shared test schema | high | mitigate | The mandatory final `db:test:setup` and a `bun run ci` after it, both inside the task's own verify command — not left to discipline. |
| T-05-27 | Repudiation | a corpus count that does not mean what it says | high | mitigate | The count is `countPackages()` itself, so "parsed artifact", "listed artifact" and the number on the home page are one predicate by construction (decision 1). |
| T-05-28 | Repudiation | a truncated corpus presented as complete | medium | mitigate | The per-repository notice already ships; this plan adds the corpus-level figure — repositories capped, candidate paths unread — to the recorded result. |
| T-05-29 | Information Disclosure | the runbook leaking an environment value | medium | mitigate | The README documents variable *names* and a schema name, never a value; `DATABASE_URL` is referenced by name only, and `GITHUB_TOKEN` is documented as optional and scopeless, as Phase 0 already established. |
</threat_model>

<verification>
1. `countPackages()` returns at least 500, and that number is the one the home page renders.
2. The per-drain count curve is recorded, and two repositories account for the majority.
3. No job is left queued or running in `agentdock` after the run.
4. The corpus-level truncation figure is recorded.
5. The real core-request cost, invocation count and wall clock are recorded, replacing this phase's projections.
6. The cold start reproduces from an empty `agentdock_test`: zero packages before, non-zero after, `listPackages` returning rows.
7. `agentdock_test` holds no real-repository `ingest_job` row after the final reset.
8. `bun run ci` passes **after** the proof.
9. The README section exists, names step 5 as required, and states the cost.
10. No migration was added. `scripts/migrate.mjs` is unmodified.
</verification>

<success_criteria>
- **COR-06** — at least 500 parsed artifacts exist, counted by the shipped listing predicate so the number cannot drift from what a user sees.
- ROADMAP criterion 5.
- The cold start is reproducible from empty by a documented sequence, which is the only form of the claim that survives the database being dropped.
- Every cost figure this phase projected during planning is replaced by a measured one.
</success_criteria>

<output>
Create `.planning/phases/AGD-05-corpus-cold-start/05-04-SUMMARY.md` when done.
Record: the final `countPackages()` value and the count after each drain; how many artifacts
each ingested repository contributed, highest to lowest; the breakdown of the corpus by
`notListedBecause`; how many repositories were truncated and how many candidate paths went
unread; core requests consumed, invocations run and wall clock elapsed, against this phase's
projection of six to fourteen requests; whether the seed list was exhausted before 500 and
by how much if so; and the before-and-after package counts from the `agentdock_test`
cold-start proof. Record no credential and no connection string.

**Do not `git add`, do not `git commit`, do not `git push`.** End with a recommended commit
message and leave the working tree for the maintainer. The branch stays `develop`.
</output>
