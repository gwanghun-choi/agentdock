---
phase: AGD-05-corpus-cold-start
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - scripts/check-boundaries.mjs
  - scripts/check-boundaries.test.ts
  - src/github/client.ts
  - src/registry/types.ts
  - src/registry/client.ts
  - src/registry/client.test.ts
  - src/registry/sync.ts
  - src/registry/sync.test.ts
  - src/corpus/caps.ts
  - src/corpus/fanout.ts
  - src/corpus/fanout.test.ts
  - src/db/queries/seeds.ts
  - src/db/queries/seeds.test.ts
  - src/db/queries/jobs.ts
  - src/db/queries/jobs.test.ts
  - src/db/schema.ts
  - scripts/corpus-sync.mjs
  - package.json
  - fixtures/mcp-registry/list-normal.json
  - fixtures/mcp-registry/list-empty.json
  - fixtures/mcp-registry/list-malformed.json
  - fixtures/mcp-registry/list-control-byte.json
autonomous: true
requirements: [COR-01, COR-03]

estimate:
  tokens: 115000
  raw_tokens: 115000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "A file naming registry.modelcontextprotocol.io outside src/registry/ fails bun run check:boundaries, and the same file inside it passes"
    - "A host added to either client's ALLOWED_HOSTS without a matching HOST_RULES entry fails CI on the commit that adds it"
    - "enqueueJob('Owner/Repo') and enqueueJob('owner/repo') produce exactly one active ingest_job row"
    - "One page of live MCP registry servers becomes repo_seed rows, and no api.github.com request is made while it happens"
    - "A registry row whose repository field is an empty object is skipped and counted, and the sync continues"
    - "A registry page carrying a raw control byte inside a description is recovered, counted as sanitized, and its cursor is still read"
    - "Fan-out routes every seed through enqueueJob, so the denylist and MAX_QUEUED still hold for a seed nobody typed"
    - "A seed that has any ingest_job row, in any status, is never offered to fan-out again"
    - "A denylisted seed is never re-offered, so no seed sits pending for a reason the run cannot name"
    - "Every corpus:sync run prints enqueued, denylisted, flooded, capped and still-pending counts, so a bounded run never reads as a complete one"
    - "A second corpus:sync over the same registry window enqueues nothing new"
  artifacts:
    - path: "src/registry/client.ts"
      provides: "The only file in the project that may name the MCP registry host: hardcoded allowlist, https-only, manually re-validated redirects, byte-capped read, its own failure union"
      exports: ["registryFetch", "readCapped", "RegistryError", "ALLOWED_HOSTS"]
      min_lines: 90
    - path: "src/registry/sync.ts"
      provides: "Cursor pagination, per-row zod validation, control-byte recovery, and the derived updated_since watermark — returning counters, never throwing on one bad row"
      exports: ["syncRegistry", "RegistrySyncResult"]
      min_lines: 110
    - path: "src/corpus/caps.ts"
      provides: "CORPUS_CAPS, every number carrying the arithmetic it came from and what it does not bound"
      exports: ["CORPUS_CAPS"]
      min_lines: 40
    - path: "src/corpus/fanout.ts"
      provides: "repo_seed to enqueueJob, one seed at a time through the one function that enforces the denylist and the flood ceiling, with per-outcome counters"
      exports: ["fanOutSeeds", "FanOutResult"]
      min_lines: 60
    - path: "src/db/queries/seeds.ts"
      provides: "Every repo_seed read and write the corpus sources share: the upsert, the never-enqueued anti-join, the pending count, and the registry watermark"
      exports: ["upsertSeeds", "unenqueuedSeeds", "countUnenqueuedSeeds", "newestRegistryUpdatedAt", "SeedRow"]
      min_lines: 80
    - path: "scripts/corpus-sync.mjs"
      provides: "The operator entry point: acquire from one source, fan out under a cap, optionally drain, print every drop"
      min_lines: 90
  key_links:
    - from: "src/registry/client.ts"
      to: "scripts/check-boundaries.mjs"
      via: "the new host is registered as a HOST_RULES pair, so rule 5 polices it instead of ignoring it"
      pattern: "HOST_RULES"
    - from: "src/registry/sync.ts"
      to: "src/github/client.ts"
      via: "githubRepoFromUrl is the only URL parser used, so no github.com literal enters src/registry/"
      pattern: "githubRepoFromUrl"
    - from: "src/corpus/fanout.ts"
      to: "src/db/queries/jobs.ts"
      via: "every seed goes through enqueueJob, never a direct ingest_job insert, so denylist and MAX_QUEUED are inherited rather than reimplemented"
      pattern: "enqueueJob"
    - from: "src/db/queries/seeds.ts"
      to: "src/db/queries/jobs.ts"
      via: "the anti-join is only correct because enqueueJob lowercases target, making repo_seed.full_name and ingest_job.target the same representation"
      pattern: "toLowerCase"
---

<objective>
Prove the whole acquisition path on one signal, end to end, before three more
sources are built on machinery nobody has run: a public registry page becomes
seed rows, becomes a queued job, becomes an ingested repository, becomes a
visible artifact.

Purpose: `repo_seed` has held zero rows since it shipped and has no consumer.
Every remaining plan in this phase writes into it and depends on something
reading it back out. Three facts on that path are unproven and two of them are
already known to be wrong: the boundary scanner does not police the new host and
passes silently (05-CONTEXT C1), and `enqueueJob` is internally inconsistent
about case in a way seed fan-out turns from theoretical into routine
(05-CONTEXT D-01). Building three acquisition sources first and discovering
either afterwards means rewriting three.

Output: `scripts/check-boundaries.mjs` policing a registered set of host pairs
instead of one hardcoded pattern; `src/registry/` as the one directory that may
name the MCP registry; `src/corpus/` with its caps and its fan-out;
`src/db/queries/seeds.ts`; `bun run corpus:sync`; and one artifact on a page that
arrived because a registry entry named its repository.

Honours 05-CONTEXT's binding decisions that this plan adds no migration (C2),
that `enqueueJob` normalizes at the boundary rather than the index (D-01), that
seed lifecycle is derived by join rather than stored in a column (D-02), that
the host registry is closed by a coverage test rather than by memory (D-04),
that `readCapped` is duplicated rather than shared (D-05), that a malformed row
is skipped and counted rather than thrown (D-06), that every cap prints what it
dropped (D-07), that acquisition is an explicit `bun run corpus:sync` and not a
cron or an in-app scheduler (D-08), that no test in CI ever contacts the live
registry or live GitHub (D-11), and that a provenance tag is never a hostname
(D-12).
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/phases/AGD-05-corpus-cold-start/05-CONTEXT.md
@.planning/phases/AGD-05-corpus-cold-start/05-RESEARCH.md
@.planning/phases/AGD-05-corpus-cold-start/05-PATTERNS.md
@scripts/check-boundaries.mjs
@scripts/check-boundaries.test.ts
@scripts/analyze-backfill.mjs
@src/github/client.ts
@src/github/scan.test.ts
@src/db/schema.ts
@src/db/queries/jobs.ts
@src/db/queries/jobs.test.ts
@src/ingest/persist.ts
@src/ingest/worker.ts
</context>

<decisions_made_while_planning>

**1. The host-rule fix ships alone, first, because its failure mode is silent.**

This is the same shape as 04-01's `mode` fix and it is here for the same reason.
`check-boundaries.mjs:211-212` hardcodes one pattern and one directory, and
`:252` fires only when that pattern matches. A registry client written anywhere
in `src/` passes CI today. There is no error to catch it, no test that fails, and
the rule's own stated purpose — that `git grep` answers "what can this reach"
completely (`:209-210`) — is destroyed on the commit that adds the host, quietly.
A task that adds the client and the rule together would be a task in which
nothing proves the rule was ever needed.

**2. The tracer stops short of nothing, including the two GitHub calls.**

The temptation is to end the tracer at "a `repo_seed` row exists", because core
quota was at zero when this plan was written (05-CONTEXT C6). That would prove
the cheap half and leave the expensive half — that a seed nobody typed survives
`enqueueJob`'s denylist and flood checks, reaches the pipeline, and renders —
unproven until 05-02. So the tracer runs the whole path. Everything before the
final hop is offline: the adapter, zod, the fixtures, the tests, the fan-out, the
`enqueueJob` fix, the script. Only the last verification step spends two core
requests, and by the time the executor reaches it the budget has reset.

**3. The registry watermark is derived from what was stored, not written to a column.**

`updated_since` needs a "last seen" timestamp, and there are three places to keep
it: a new column (a migration, refused by C2), a `schema_meta` row (whose own doc
says it holds *facts about this deployment of the schema*, `schema.ts:44-47` —
operational sync state is not that), or the registry's own `updatedAt` carried in
the `hint` jsonb the seed already stores. The third is chosen, for D-02's reason
exactly: it cannot drift, because it *is* the data.

Its one asymmetry is the right one. 41% of registry servers carry no GitHub
repository and so are never stored, and a sweep that stops early stores less. In
both cases the derived maximum lags the true one, so the next sync re-fetches a
window it has already seen — an over-fetch on a host that costs no GitHub quota,
never an under-fetch that silently skips a server forever. A written watermark
has the opposite failure: a sweep that dies after writing it skips its own
remainder permanently.

**4. `newestRegistryUpdatedAt` lives in `src/db/queries/seeds.ts`, not in `src/registry/`.**

One module holds every statement that touches `repo_seed`, so the anti-join, the
upsert, the pending count and the watermark can be read against each other. The
alternative scatters four `repo_seed` queries across three directories, and the
anti-join's correctness depends on the upsert's lowercasing — a coupling that
must be visible in one file.

**5. `persist.ts`'s inline `repo_seed` upsert is left exactly where it is.**

`persist.ts:277-297` already upserts seeds, inside the ingest transaction, after
a batched denylist pre-check. `upsertSeeds` in the new module is a second
implementation of the same conflict clause, and that duplication is deliberate:
extracting the shared one means editing the artifact transaction — the single
riskiest code path in the project — inside the plan that also changes
`enqueueJob`. A `ponytail:` comment on the new function names the other copy and
the condition under which they should merge.

**6. The one-shot drain reuses `runJob`, and is a flag rather than a script.**

`runWorker` (`worker.ts:114`) is an unbounded `while` loop; the tracer and
05-04's cold-start proof both need a bounded one. `claimJob` and `runJob` are
both already exported, so a bounded drain is a dozen lines calling two existing
functions — not a second worker, and not a copy of `runWorker`'s body. It lives
behind `--drain=N` on the sync script so one command does acquire, fan out and
drain, which is what the cold-start proof needs to be a single reproducible
invocation.

**7. No structured log line is added.** `src/log.ts:47` deliberately closes its
key set, and a corpus sync is an operator-invoked batch job whose output belongs
on stdout in `analyze-backfill.mjs:33-36`'s format, not in the ingest log stream.
The counters ride back as a returned object and the script prints them.

</decisions_made_while_planning>

<reference>

## Reference A — `scripts/check-boundaries.mjs`, rule 5 as a registry

Replace the two constants at `:211-212` with a registered set. Keep the problem
id string `no-host-sprawl` verbatim — `check-boundaries.test.ts:143` and `:162`
match on it, and changing it would make two existing assertions pass on nothing.

```js
// ING-02, in auditable form: the hostnames AgentDock may contact appear in one
// directory each, so `git grep` answers "what can this reach" completely.
//
// A pair per host family, not one pattern: the third host arrived in Phase 5 and
// the single hardcoded pattern did not match it, so a registry client written
// anywhere would have passed this rule in silence. Adding a host means adding a
// pair here — and the allowlist-coverage test below fails the build if a client
// grows a host that no pair covers.
const HOST_RULES = [
  { pattern: /api\.github\.com|raw\.githubusercontent\.com/, dir: 'src/github/', label: 'a GitHub host' },
  { pattern: /registry\.modelcontextprotocol\.io/, dir: 'src/registry/', label: 'the MCP registry host' },
];
```

and the block at `:251-254` becomes a loop over `HOST_RULES`, pushing
`` `names ${label} outside ${dir} (no-host-sprawl)` ``. Export `HOST_RULES` so
the coverage test can read it.

Rule 5 inspects only files that exist (`sourceFiles`, `:219-236`), so registering
`src/registry/` before that directory exists is inert, not an error.

## Reference B — the coverage test, which is the part that closes the hole

Extending the pattern fixes today's host. It does not fix the next one: rule 5
polices *registered* hosts, so a fourth host stays unaudited until someone
remembers. Close it mechanically.

`src/github/client.ts:7` gains one word — `export const ALLOWED_HOSTS` — and
`src/registry/client.ts` exports its own. The new test in
`check-boundaries.test.ts` imports both and asserts that every member of every
allowlist is matched by some `HOST_RULES` pattern. A host added to a client
without a registered directory then fails CI on the commit that adds it.

Three assertions, in the file's existing `describe('checkSourceBoundaries')`
block and one new block:

1. The registry host named in a file outside `src/registry/` yields a
   `no-host-sprawl` problem.
2. The same text at a path under `src/registry/` yields none.
3. Every host in `githubAllowedHosts` and `registryAllowedHosts` is covered by
   some `HOST_RULES` entry.

The third is the one that matters; the first two only prove the loop was wired.

## Reference C — `src/registry/types.ts`

```ts
export type RegistrySeed = {
  /** The registry's own namespaced id, e.g. "ac.tandem/docs-mcp". Provenance. */
  registryName: string;
  /** Lowercased owner/repo, from githubRepoFromUrl. Null when the row names no
   *  GitHub repository — 41% of the registry, and not an error. */
  githubFullName: string | null;
  version: string;
  /** The registry's own updatedAt, not AgentDock's write time. The watermark
   *  is derived from this and would be wrong from the other. */
  updatedAt: string;
};

export type RegistryFailure = 'invalid_response' | 'unavailable' | 'too_large';
```

`REGISTRY_CAPS`, in the doctrine `scan.ts:11-29` and `ANALYZE_CAPS` already use —
one JSDoc block per number naming the measurement it came from **and what it does
not bound**:

| cap | value | the sentence it carries |
|---|---|---|
| `pageLimit` | `100` | the registry's own maximum page size; 3,000 rows were sampled at this value with no error |
| `maxPages` | `40` | 40 x 100 = 4,000 rows per invocation against a measured total of 21,055. Bounds one run's wall clock and memory. Does **not** bound total seeds — re-running walks further, and the run prints the cursor it stopped at. |
| `maxPageBytes` | `2 * 1024 * 1024` | largest observed page at `limit=100` is well under this. Bounds a hostile or misconfigured response; does **not** bound the number of pages. |
| `requestTimeoutMs` | `10_000` | identical to `client.ts:16`, for the same reason |
| `maxRedirects` | `2` | identical to `client.ts:17` |

## Reference D — `src/registry/client.ts`

Copy the shape of `src/github/client.ts`, not its text, for the pieces that
apply. Named decisions to carry over verbatim:

- `ALLOWED_HOSTS` as a hardcoded `Set` (`client.ts:7`) with its comment's own
  reasoning: not configurable, because a configurable allowlist is one an
  operator can widen by accident.
- `assertAllowedHost` (`client.ts:80-93`): parse, refuse non-`https:`, refuse any
  hostname not in the set.
- `registryFetch`: `redirect: 'manual'`, `cache: 'no-store'`,
  `AbortSignal.timeout(...)` per hop, and every `location` re-validated through
  `assertAllowedHost` before it is followed (`client.ts:126-176`). The registry
  is a friendlier host than GitHub and gets no discount for it.
- `readCapped`, duplicated (D-05). Fifteen lines, its own `RegistryError`, and a
  `ponytail:` comment naming a third host as the extraction trigger.
- No token header. This host needs none and must never be sent one.
- **No rate-limit state.** `client.ts:30-34`'s `lastRateLimit` exists because the
  home page renders GitHub's remaining budget. Do not invent headers this host
  may not send. Instead, record in the summary which `x-ratelimit-*` headers the
  live response actually carried — one observed fact, so the next phase does not
  have to guess either.

`fetchServerPage({ cursor, updatedSince })` returns
`{ rows: unknown[]; nextCursor: string | null; sanitized: boolean }` and does no
validation beyond JSON shape — `rows` is deliberately `unknown[]`, so nothing
downstream can read a field zod has not approved.

**End of pagination is the absence of the `nextCursor` key.** Verified by
paginating the live registry to exhaustion (§Q1): the final page's `metadata` was
exactly `{"count": 55}`. Not `null`, not `""`. A truthiness check on
`metadata.nextCursor` happens to work today and would break on an empty-string
cursor; check for the key.

**Control-byte recovery** (D-06). `JSON.parse` on the raw text inside a `try`.
On failure, strip C0 control characters other than tab, LF and CR and parse once
more, setting `sanitized`. Those bytes are illegal inside a JSON string and can
appear legally nowhere else in the document, so removing them cannot change a
valid value — put that sentence in the code, because it is the whole
justification. If the second parse also fails, throw `RegistryError`
`invalid_response`; `sync.ts` turns that into a stop-with-cursor, never a crash.

## Reference E — `src/registry/sync.ts`

```ts
const registryRow = z.object({
  server: z.object({
    name: z.string().min(1),
    version: z.string().min(1),
    // partial() because {} is a real, observed shape — 2.8% of 3,000 sampled rows.
    repository: z.object({
      url: z.string().url().optional(),
      source: z.string().optional(),
    }).partial().optional(),
  }),
  _meta: z.object({
    'io.modelcontextprotocol.registry/official': z.object({
      updatedAt: z.string(),
    }).partial(),
  }).partial().optional(),
});
```

`source` is `z.string()`, not `z.enum(['github','gitlab'])`: an unknown source
value must skip the row, not fail the row's validation and be counted as
malformed. The two are different facts and the counters must not blend them.

`githubFullName` comes from `githubRepoFromUrl` (`src/github/client.ts:73`) and
from nothing else (05-CONTEXT C5). It already rejects any host that is not
`github.com`, which disposes of the 0.3% GitLab rows without a second branch, and
it reuses `normalizeRepo`'s length caps and character rules — so no owner/repo
string reaches a URL or a database without the validation every other path in
this project applies. **Do not write a `github.com` literal anywhere in
`src/registry/`**: rule 5 would fail the build, correctly.

`syncRegistry` returns counters and never throws for one bad row:

| counter | meaning |
|---|---|
| `pagesRead` | pages that parsed |
| `pagesSanitized` | pages that needed the control-byte retry |
| `rowsSeen` | rows in those pages |
| `rowsInvalid` | rows zod rejected — skipped and counted |
| `rowsNoGithubRepo` | valid rows naming no GitHub repository — the expected 41%, not an error |
| `seedsUpserted` | rows written to `repo_seed` |
| `stoppedBecause` | `'exhausted' | 'page_cap' | 'parse_failure'` |
| `stoppedAtCursor` | the cursor to resume from, printed when it is not `'exhausted'` |
| `updatedSinceUsed` | the derived watermark this run passed, or null on a first run |

Seed rows are written with `sourceKind: 'github'`, `discoveredFrom:
'mcp-registry'` (D-12 — a hostname as a data value is a hostname literal in the
file that writes it), `discoveredPath: <the registry name>`, and a `hint`
carrying only `{ registryName, version, description, registryUpdatedAt }` —
named fields, never the row verbatim, which is what bounds the jsonb.

## Reference F — `src/db/queries/seeds.ts`

The anti-join, and why it is correct only after Task 2's `enqueueJob` change:

```sql
select s.full_name
from repo_seed s
left join ingest_job j on j.target = s.full_name
left join repository_denylist d on d.full_name = s.full_name
where j.id is null and d.full_name is null
order by s.created_at, s.id
limit $1
```

The `id` tie-break is load-bearing, not decoration. A bulk insert stamps one
`created_at` across every row it writes, so ordering on that column alone makes
fan-out order nondeterministic between seeds written in the same statement — and
05-02's whole cold-start argument depends on a seed file's density ordering
surviving into fan-out order. `id` is a `bigserial` assigned in insert order, so
the pair reproduces it exactly.

`repo_seed.full_name` is lowercased at write (`schema.ts:284`, and
`catalog.ts:42,58` for the catalog path). `ingest_job.target` becomes lowercased
at write in Task 2. Only then is `j.target = s.full_name` an equality between two
identical representations rather than a case-sensitive near-miss — write that
sentence as the comment above the query, because it is the coupling that makes
the whole design work.

The join is on **any** job row, terminal ones included. A seed whose job failed
permanently must not be re-offered: retry belongs to `scheduleRetry`
(`jobs.ts:173-193`), and a fan-out that re-offered failed repositories would loop
on them forever at two core requests each.

The denylist anti-join is not optional. `enqueueJob` returns
`{kind:'denylisted'}` and writes no `ingest_job` row, so without it a denylisted
seed is re-offered on every run forever and the pending count never converges —
which is exactly the "seed sits forever in an unexplained pending state" the
phase brief forbids.

`ponytail:` comment beside it naming the upgrade: an additive
`CREATE INDEX ON ingest_job (target)` when `ingest_job` reaches tens of thousands
of rows. Not built — this is a manual operation over hundreds of rows today.

`newestRegistryUpdatedAt()` is `max(hint->>'registryUpdatedAt')` over rows whose
`discovered_from` is `'mcp-registry'`, with the over-fetch property from decision
3 in its comment.

## Reference G — `src/corpus/caps.ts`

```ts
export const CORPUS_CAPS = {
  /**
   * Repositories one corpus:sync may enqueue. 25 x 2 core requests = 50 of the
   * unauthenticated 60 an hour (src/ingest/retry.ts:5), leaving 10 for the
   * in-process worker's own retries and for a human submitting a repository
   * while the sync runs. Bounds one invocation; does NOT bound total queue
   * depth — MAX_QUEUED (src/db/queries/jobs.ts:11) still does that, and a run
   * that hits it stops and says so.
   */
  maxEnqueuePerSync: 25,
  /**
   * Seeds one source may write in one invocation. Bounds the write volume and
   * the memory a single sweep holds; does NOT bound how many seeds exist —
   * re-running continues from where the source left off.
   */
  maxSeedsPerSource: 2000,
} as const;
```

One module, because 05-02 and 05-03 each add a number to it and neither should
have to edit `fanout.ts` to do it.

## Reference H — `src/corpus/fanout.ts`

`fanOutSeeds({ limit })` reads `unenqueuedSeeds(limit)`, calls `enqueueJob` per
row, and accumulates `{ considered, enqueued, denylisted, flooded, remaining }`.

Three properties, each with a stated reason:

- **Every seed goes through `enqueueJob`.** It is the only place the denylist
  check and the `MAX_QUEUED` ceiling exist (`jobs.ts:34-46`), and a direct
  `ingest_job` insert reopens both. This is the single most important line in
  the plan.
- **`{kind:'flooded'}` stops the loop.** Continuing would issue one count query
  per remaining seed to learn the same fact, and the run's job is to report that
  the queue is full, not to confirm it repeatedly.
- **`remaining` is `countUnenqueuedSeeds()` taken after the loop**, so the caller
  can print how many seeds still hold no job. A cap that prints nothing reads as
  "we covered everything" (D-07).

No transaction wraps the pair. There is nothing to wrap: fan-out writes no
`repo_seed` state (D-02), and `enqueueJob`'s own `ON CONFLICT` no-op
(`jobs.ts:51-58`) makes a re-run over the same rows idempotent by construction.

## Reference I — `scripts/corpus-sync.mjs`

`scripts/analyze-backfill.mjs` is the exact template, whole file. Conventions
that are not negotiable because every existing script shares them:

- `.mjs`, `#!/usr/bin/env node`, then `// scripts/corpus-sync.mjs`, then a prose
  block saying why the script exists and what it deliberately does not do.
- `await import('../src/....ts')` — relative path, explicit `.ts`, never a `@/`
  alias in the script's own imports.
- The shared handle: `const { sql } = await import('../src/db/client.ts')`, and
  `await sql.end()` on **every** exit path.
- Arguments parsed by hand off `process.argv`, validated inline, `throw` on bad
  input. No CLI library, ever.
- One `console.log` summary line per phase of the run.
- `process.exit(1)` after `sql.end()` when the run failed —
  `seed-fixture.mjs:41`'s convention, and a registry sync can genuinely fail.

Arguments: `--source=registry|all` (this plan ships `registry`; 05-02 and 05-03
add their own values), `--enqueue=<n>` defaulting to
`CORPUS_CAPS.maxEnqueuePerSync`, `--no-enqueue` to acquire without fanning out,
and `--drain=<n>`.

`--drain=<n>` claims and runs up to n jobs by calling the two already-exported
functions, `claimJob(workerId)` (`jobs.ts:86`) and `runJob(job)`
(`worker.ts:50`), stopping early when `claimJob` returns null. It is not a second
worker and must not grow a sleep, a reap or a signal — those belong to
`runWorker` (`worker.ts:114-148`), which is the always-on process. The drain
exists so the tracer and 05-04's cold-start proof are one reproducible command.

`package.json` gains `"corpus:sync": "bun scripts/corpus-sync.mjs"`.
`check-boundaries.mjs:149-162` bans only `db:push`/`db:pull` names and
`drizzle-kit push|pull` bodies, so this name is clear — and
`check-boundaries.test.ts:71-73` asserts the committed `package.json` passes,
which will re-run over the new entry for free.

## Reference J — the fixtures

`fixtures/mcp-registry/` gets four files, mirroring
`fixtures/adversarial/*-malformed.json`'s precedent for committed hostile shapes:

| file | shape |
|---|---|
| `list-normal.json` | a real captured page, trimmed to ~5 servers, including at least one with `repository: {}` and one with no `repository` key |
| `list-empty.json` | `{"servers": [], "metadata": {"count": 0}}` — and **no** `nextCursor` key, which is the real end-of-pagination shape |
| `list-malformed.json` | a `servers` array whose rows are missing required fields and carry wrong types |
| `list-control-byte.json` | a page with a raw `0x01` byte inside a `description` — the shape observed live on page 11 of the real pagination |

Test structure copies `src/github/scan.test.ts:32-40`: a stubbed `fetch`, a
`hosts: string[]` capture array asserted afterward, and the case built inline
when it is local to one test. The capture array is what proves the two claims
that matter: the adapter contacted `registry.modelcontextprotocol.io` and it
contacted **nothing else** — no `api.github.com`, so COR-01's "without consuming
GitHub quota" is a test assertion rather than a design intention.

</reference>

<tasks>

<task type="auto">
  <name>Task 1: The boundary scanner learns a second host, and learns to notice a third</name>
  <files>scripts/check-boundaries.mjs, scripts/check-boundaries.test.ts, src/github/client.ts</files>
  <behavior>
    - A source file at a path outside src/registry/ whose text names the MCP registry host yields one no-host-sprawl problem.
    - The identical text at a path under src/registry/ yields no problem.
    - A source file outside src/github/ naming api.github.com still yields no-host-sprawl, with the same problem id the two existing assertions match on.
    - Every host in src/github/client.ts's exported ALLOWED_HOSTS is matched by some HOST_RULES pattern.
    - The repository as committed still passes checkSourceBoundaries and checkPackageScripts.
  </behavior>
  <action>
    Apply References A and B, minus the registry half of the coverage test, which
    lands in Task 2 with the file it covers.

    Replace the two constants with the HOST_RULES array and turn the single
    conditional at :251-254 into a loop over it. Export HOST_RULES. Keep the
    literal problem id unchanged: two assertions in the existing test file match
    on it, and renaming it would leave both passing against nothing.

    Add the one word that makes src/github/client.ts's host set readable from a
    test, and nothing else in that file. It is the SSRF-hardened path and this
    task has no other business there.

    Write the coverage assertion now, over the one allowlist that exists. It is
    the assertion that does the real work: extending the pattern fixes today's
    host, and only the coverage test fixes the next one. Task 2 adds the second
    allowlist to the same assertion.

    Register src/registry/ as a directory before it exists. sourceFiles walks
    only what is on disk, so an unpopulated pair is inert rather than an error,
    and registering it first means the client cannot land unpoliced even for one
    commit.
  </action>
  <verify>
    <automated>bun run test scripts/check-boundaries.test.ts &amp;&amp; bun run check:boundaries &amp;&amp; bun run typecheck</automated>
  </verify>
  <done>A file naming the MCP registry host outside src/registry/ fails the boundary scanner and the same file inside it passes; the GitHub rule is unchanged and its two existing assertions still hold; and a host added to a client's allowlist without a registered directory now fails a test rather than nothing.</done>
</task>

<task type="tracer">
  <name>Task 2: Tracer — one registry entry becomes one visible artifact</name>
  <files>src/registry/types.ts, src/registry/client.ts, src/registry/client.test.ts, src/registry/sync.ts, src/registry/sync.test.ts, src/corpus/caps.ts, src/corpus/fanout.ts, src/corpus/fanout.test.ts, src/db/queries/seeds.ts, src/db/queries/seeds.test.ts, src/db/queries/jobs.ts, src/db/queries/jobs.test.ts, src/db/schema.ts, scripts/corpus-sync.mjs, scripts/check-boundaries.test.ts, package.json, fixtures/mcp-registry/list-normal.json, fixtures/mcp-registry/list-empty.json, fixtures/mcp-registry/list-malformed.json, fixtures/mcp-registry/list-control-byte.json</files>
  <behavior>
    - enqueueJob called with a mixed-case owner/repo and then with its lowercase form leaves exactly one row in ingest_job, and that row's target is the lowercase form.
    - enqueueJob against a denylisted repository still returns denylisted when the caller passes mixed case.
    - The registry client refuses a non-https target and refuses a redirect whose location leaves the allowlist, without following it.
    - Parsing the normal fixture yields one RegistrySeed per server, with githubFullName lowercased for github-source rows and null for rows with no repository key and for rows whose repository is an empty object.
    - Parsing the empty fixture yields zero seeds, reports the sweep as exhausted, and does not treat the absent nextCursor key as an error.
    - Parsing the malformed fixture skips every invalid row, counts them in rowsInvalid, and still returns the valid rows from the same page.
    - Parsing the control-byte fixture succeeds on the retry, sets pagesSanitized to one, and still reads that page's cursor.
    - Across every registry test the captured host list contains registry.modelcontextprotocol.io and no other host.
    - upsertSeeds run twice over the same rows leaves the same number of repo_seed rows and refreshes updated_at.
    - unenqueuedSeeds omits a seed that has any ingest_job row in any status, including succeeded and failed.
    - unenqueuedSeeds omits a seed whose full name is in repository_denylist.
    - fanOutSeeds stops at the requested limit and reports how many seeds still hold no job.
    - fanOutSeeds stops on the first flooded result rather than calling enqueueJob for every remaining seed.
    - newestRegistryUpdatedAt returns null when no registry-sourced seed exists and the maximum registry updatedAt when they do.
  </behavior>
  <action>
    Apply References C through J in that order, plus the registry half of
    Reference B's coverage assertion.

    Start with the enqueueJob change and its test, before any registry code. It
    is three lines and it is the fact the anti-join in seeds.ts depends on: until
    target is lowercased at write, repo_seed.full_name and ingest_job.target are
    two representations of one identity and the join silently under-matches.
    Lowercase once at the top of enqueueJob and use that value for the denylist
    check, the insert and the conflict clause alike — the function currently
    lowercases for the check at :38 and not for the insert at :50, so the fix is
    as much about making its own two halves agree as about seeds.

    Do not change the index. Do not generate a migration. The reasoning is
    05-CONTEXT D-01 and it is settled; if the executor finds itself running
    db:generate in this plan, something has drifted.

    Count the legacy rows before finishing the task: select how many ingest_job
    rows have a target that differs from its own lowercase form. If any exist,
    update them in one statement as an explicit operator step and record the
    count in the summary. Do not put that statement in a drizzle file — a data
    statement there applies to agentdock and never reaches agentdock_test, which
    is the trap migrate.mjs:97-121 documents.

    Write the registry client with no token header and no rate-limit state.
    Duplicate readCapped rather than importing it: the import would pass rule 5,
    so the real argument is that the shared one throws a GitHubError and a
    registry adapter reporting a registry failure as a GitHub failure has lied to
    messageFor. Say that in the ponytail comment, not the boundary argument.

    Derive owner/repo only through githubRepoFromUrl. Write no github.com literal
    anywhere under src/registry/ — Task 1's rule now fails the build on one, which
    is the point.

    Check for the nextCursor key, not for its truthiness. The live end-of-list
    page carries no such key at all, and a truthiness check happens to work today
    while breaking on an empty-string cursor.

    Recover a control-byte page with exactly one retry, and count it. Stop
    pagination and report the cursor if the retry also fails: continuing past a
    page whose cursor could not be read skips everything after it silently, which
    is the failure this whole phase's cap discipline exists to prevent.

    Give the anti-join in seeds.ts the comment that explains why it is an
    equality join rather than a lower() join, naming the enqueueJob change. A
    future reader who reverts that change must be able to see from this query
    that they have broken it.

    Route every seed through enqueueJob in fanout.ts. Never insert into
    ingest_job. It is the only place the denylist and MAX_QUEUED live, and a
    direct insert reopens both for exactly the traffic — seeds nobody typed —
    that they were written for.

    Use the test-owner/corpus-spec-* sentinel prefix in every new DB-backed
    suite, distinct from queue-spec and persist, and delete every row the suite
    created in its clean() — including repo_seed rows, which no existing suite
    cleans. A queued ingest_job row left behind makes jobs.test.ts's claim
    assertions nondeterministic, which this codebase has already fought once.

    Update the repo_seed.discoveredFrom column comment in schema.ts to say that
    it now also carries a source name for operator-driven acquisition, not only a
    catalog's owner/repo. It is a comment change, generates no DDL, and stops a
    correct comment from quietly becoming a wrong one.

    Verify live, in this order, and record each result in the summary:
    first, with core quota still at zero, run corpus:sync against the registry
    with --no-enqueue and confirm repo_seed rows appear and no api.github.com
    request was made; then, once core has reset, re-run with --enqueue=1
    --drain=1 and open the resulting repository page. Record which registry
    entry, which repository, which artifact, and the remaining core quota
    afterward. Two core requests is the whole cost and the summary should say so.
  </action>
  <verify>
    <automated>bun run check:boundaries &amp;&amp; bun run test src/registry src/corpus src/db scripts/check-boundaries.test.ts &amp;&amp; bun run typecheck &amp;&amp; bun run lint</automated>
  </verify>
  <done>A server named in the public MCP registry became a repo_seed row, then a queued job, then an ingested repository, then an artifact rendered on a page — with the registry half proven to have touched no GitHub host, the enqueue half proven case-insensitive by a test that fails without the fix, and the whole path re-runnable as one command that enqueues nothing new the second time.</done>
</task>

<task type="auto">
  <name>Task 3: Incremental sweeps, bounded and loud about what they dropped</name>
  <files>src/registry/sync.ts, src/registry/sync.test.ts, src/corpus/caps.ts, src/corpus/fanout.ts, scripts/corpus-sync.mjs, src/db/queries/seeds.ts, src/db/queries/seeds.test.ts</files>
  <behavior>
    - A sweep with no prior registry-sourced seed passes no updated_since and walks from the start.
    - A sweep after a prior one passes the maximum registry updatedAt already stored, and the value it passes appears in the run's own counters.
    - A sweep stops at maxPages and reports stoppedBecause as page_cap together with the cursor to resume from.
    - Resuming from that cursor reaches rows the capped sweep did not.
    - A sweep whose second page fails both parse attempts stops, reports parse_failure, and keeps every seed the earlier pages produced.
    - A source that produces more than maxSeedsPerSource rows writes the cap and reports the overflow rather than truncating silently.
    - The summary line names, separately and by number: pages read, pages sanitized, rows invalid, rows with no GitHub repository, seeds written, jobs enqueued, denylisted, flooded, and seeds still holding no job.
    - Running the whole command twice in a row enqueues nothing the second time.
  </behavior>
  <action>
    Extend the tracer's single-page sync into a bounded cursor sweep. Every number
    it stops at is in CORPUS_CAPS with its arithmetic, following the doctrine
    scan.ts:11-29 already sets: each cap's comment names the measurement it came
    from and what it does not bound.

    Derive updated_since rather than storing it, per decision 3. The maximum
    already-stored registry updatedAt lags the true one whenever a row was skipped
    or a sweep stopped early, so the next run re-fetches a window it has seen.
    That is over-fetching on a host that costs no GitHub quota, and it is the safe
    direction; a stored watermark fails the other way and skips its own remainder
    forever. Put that trade in the function's comment.

    Print every drop. A run that stopped at its page cap prints the cursor. A
    source that hit its seed cap prints how many it left. Fan-out prints how many
    seeds still hold no job. A cap that prints nothing reads as "we covered
    everything", and this project has already paid for one silent drop.

    Add nothing to src/log.ts. Its key set is deliberately closed and a batch
    script's output belongs on stdout in analyze-backfill.mjs's format.

    Prove re-runnability as a test, not as a claim: run the sweep twice against
    the same fixture pages and assert the second run writes no new seed and
    enqueues no new job. Idempotency here is inherited from two existing
    constraints — repo_seed's unique full_name and ingest_job's partial active
    index — and the test's job is to prove that inheritance actually holds
    through two new layers.

    Do not add a second dedup layer on top of either constraint.
  </action>
  <verify>
    <automated>bun run test src/registry src/corpus src/db &amp;&amp; bun run typecheck &amp;&amp; bun run ci</automated>
  </verify>
  <done>One corpus:sync invocation is bounded, resumable from the cursor it prints, incremental against a watermark it derives rather than stores, and ends in a summary line that names every category of thing it dropped — so a partial sweep can never be mistaken for a complete one.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| `registry.modelcontextprotocol.io` response → the sync loop | Publisher-supplied text with no server-side sanitization, confirmed live by a raw control byte in a `description` |
| a registry `repository.url` → a URL AgentDock constructs | An attacker-influenced string on its way to becoming a host |
| `repo_seed` rows → `enqueueJob` → GitHub requests | Rows nobody typed spending a shared 60-per-hour budget |
| `scripts/corpus-sync.mjs` argv → caps | An operator argument that could widen a bound |
| a redirect `location` header → the next fetch | The classic allowlist-bypass hop |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-05-01 | Elevation of Privilege | a third host reaching `src/` unaudited | high | mitigate | `HOST_RULES` registry plus the allowlist-coverage test (Reference B), so a host added to any client without a registered directory fails CI on that commit. |
| T-05-02 | Spoofing / SSRF | `registryFetch` redirect handling | high | mitigate | `redirect: 'manual'`, every hop re-validated by `assertAllowedHost`, https-only, `MAX_REDIRECTS = 2` — the same discipline `client.ts:126-176` already ships, copied rather than relaxed for a friendlier host. |
| T-05-03 | Tampering | malformed or hostile registry JSON | high | mitigate | Per-row `zod safeParse`, skip-and-count; per-page `JSON.parse` in a `try` with one control-byte retry; a second failure stops the sweep with its cursor rather than crashing or silently skipping the remainder. |
| T-05-04 | Denial of Service | an endless or oversized registry response | medium | mitigate | Duplicated `readCapped` cancels the stream past `maxPageBytes` and never consults `Content-Length`; `AbortSignal.timeout` per hop; `maxPages` per invocation. |
| T-05-05 | Denial of Service | quota exhaustion through duplicate jobs for one repository | high | mitigate | D-01's boundary lowercase, with a regression test that fails without it. Two active jobs for one repository cost double out of sixty an hour. |
| T-05-06 | Denial of Service | seed fan-out flooding the queue | high | mitigate | Every seed routed through `enqueueJob`, inheriting `MAX_QUEUED`; plus `CORPUS_CAPS.maxEnqueuePerSync` sized against the hourly budget; the run stops on the first flooded result. |
| T-05-07 | Information Disclosure | a token or a body reaching a log line | high | mitigate | No token header is sent to the registry at all. Counters only in the summary; `src/log.ts` untouched; no response body is ever printed. |
| T-05-08 | Repudiation | a partial sweep read as a complete one | medium | mitigate | `stoppedBecause` plus the resume cursor plus the still-pending seed count, printed on every run (D-07). |
| T-05-09 | Tampering | a registry `repository.url` naming a non-GitHub host | medium | mitigate | Parsed only by `githubRepoFromUrl`, which rejects any hostname but `github.com` and reuses `normalizeRepo`'s anchored, length-bounded validation. |
| T-05-10 | Tampering | a `source.url` or `archive.url` in a hint | low | accept | Stored as data and never fetched, unchanged from `catalog.ts:19-28`'s existing posture. The `hint` carries named fields only, never the row verbatim. |
</threat_model>

<verification>
1. The registry host named outside `src/registry/` fails `check:boundaries`; inside it, passes.
2. Every host in every client's `ALLOWED_HOSTS` is covered by a `HOST_RULES` entry, asserted by a test.
3. `enqueueJob('Owner/Repo')` then `enqueueJob('owner/repo')` yields one active row, stored lowercase.
4. Legacy mixed-case `ingest_job` rows were counted and, if any existed, normalized as a recorded operator step — not through a migration file.
5. All four registry fixtures parse to the expected counters, and the captured host list names the registry and nothing else.
6. A control-byte page recovers on one retry, is counted, and its cursor is still read.
7. `unenqueuedSeeds` excludes seeds with any job row and seeds on the denylist.
8. Fan-out reaches `enqueueJob` for every seed and stops on the first flooded result.
9. A capped sweep prints its resume cursor, and resuming from it reaches new rows.
10. Two consecutive full runs enqueue nothing the second time.
11. A registry entry produced a repository page carrying an artifact, at a cost of two core requests, recorded.
12. No `drizzle/*.sql` file was added or changed. `scripts/migrate.mjs` is unmodified.
13. `bun run ci` passes.
</verification>

<success_criteria>
- **COR-01** — the public MCP registry is synced, incrementally, and a test asserts the sync contacted no GitHub host, so "without consuming GitHub quota" is proven rather than intended.
- **COR-03** (the consumer half) — `repo_seed` finally has a reader: rows fan out into `ingest_job` through the one function that enforces the denylist and the flood ceiling.
- ROADMAP criterion 1 — the registry is synced without consuming any GitHub quota.
- 05-CONTEXT D-01 — `enqueueJob` normalizes at the boundary, with a regression test that fails without it.
- 05-CONTEXT D-04 — the boundary scanner polices the new host and can no longer be blindsided by the next one.
- 05-CONTEXT C2 — the plan adds no migration, and the executor never runs `db:generate`.
</success_criteria>

<output>
Create `.planning/phases/AGD-05-corpus-cold-start/05-01-SUMMARY.md` when done.
Record: the exact `x-ratelimit-*` headers the live registry response carried, or that it
carried none; how many legacy mixed-case `ingest_job` rows existed before the fix; the
counters from the first live `corpus:sync` run (pages, sanitized pages, invalid rows, rows
with no GitHub repository, seeds written); which registry entry and which repository the
tracer carried end to end and which artifact rendered; the core quota remaining after the
tracer's two requests; and the cursor a capped sweep printed. Record no credential, no
connection string, and no registry response body.

**Do not `git add`, do not `git commit`, do not `git push`.** End with a recommended commit
message and leave the working tree for the maintainer. The branch stays `develop`.
</output>
