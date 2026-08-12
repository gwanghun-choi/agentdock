---
phase: AGD-05-corpus-cold-start
plan: 02
subsystem: corpus acquisition
status: complete
tags: [seeds, links, catalog, fan-out, observability]
requirements: [COR-02, COR-03, COR-04]
tasks_complete: 3
tasks_total: 3
key-files:
  created:
    - config/seeds.json
    - src/corpus/seedList.ts
    - src/corpus/seedList.test.ts
    - src/corpus/links.ts
    - src/corpus/links.test.ts
    - fixtures/adversarial/awesome-list.md
  modified:
    - src/corpus/caps.ts
    - src/corpus/fanout.ts
    - src/corpus/fanout.test.ts
    - src/db/queries/seeds.ts
    - src/db/queries/seeds.test.ts
    - src/github/client.ts
    - src/github/client.test.ts
    - src/detect/types.ts
    - src/detect/catalog.ts
    - src/detect/catalog.test.ts
    - src/ingest/pipeline.ts
    - src/ingest/pipeline.test.ts
    - src/log.ts
    - src/log.test.ts
    - scripts/corpus-sync.mjs
    - fixtures/adversarial/README.md
migrations_added: 0
actuals:
  tasks: 3
  commits: 0
---

# Phase AGD-05 Plan 02: Seed List, Curated Links, Catalog Fan-out Summary

Fifteen live-verified repositories, two curated Markdown lists and one
`marketplace.json` all became `repo_seed` rows through one command, and 786
artifacts were ingested from three of them for six GitHub core requests. The
curated lists cost **zero** core requests, measured either side. `seedsSkipped`
now reaches the ingest log line and read **13** on a real repository.

Two defects were found by running the thing rather than by reading it, and both
are the same shape as the watermark defect wave 1 found: **a claim about ordering
or coverage that is true of an empty table and false of a full one.**

`bun run ci`: **49 test files, 822 tests, all passing** (wave 1: 47 / 756).

## Tasks

| Task | Status | Verification |
|---|---|---|
| 1 — the operator seed list, in density order | complete | `test src/corpus src/db` (50), `typecheck`, `lint`, plus the 6-core-request live run below |
| 2 — curated link lists at zero core cost | complete | `test src/corpus` , `check:boundaries`, `typecheck`, plus two live expansions with quota measured either side |
| 3 — catalog fan-out closed end to end | complete | `test src/detect src/ingest src/corpus src/log.test.ts`, `typecheck`, `bun run ci`, plus a live `seedsSkipped` reading |

---

## The defect the plan's own ordering claim did not survive

The plan's must-have truth was *"seeds are offered to fan-out in the order the
operator file lists them, so front-loading a dense repository actually
front-loads it"*, resting on `unenqueuedSeeds`' `(created_at, id)` pair. That
pair is correct and wave 1 already shipped it with a test. It is also not
sufficient, because **it orders the whole table, and the whole table is not one
source.**

Measured on the dev schema immediately after writing the seed rows:

| fact | value |
|---|---|
| registry seeds written in wave 1, all before the seed list existed | 7,971 |
| unenqueued seeds ahead of `davila7/claude-code-templates` | **7,971** |
| what `unenqueuedSeeds(5)` actually returned | `goji-agency/website`, `mindsightventures/lona`, `1325ai/1325ai`, `abmeter/abmeter`, `dealfluence/adeu` |
| capped invocations at `maxEnqueuePerSync=25` to reach the densest seed | 319 |
| core requests to get there at two per repository | ~15,900 |
| unauthenticated budget that represents | **11.1 days** |

So the density ordering was real inside the file and irrelevant outside it, and
05-CONTEXT's *"500 parsed artifacts is reachable in 6–14 core requests"* was
unreachable through the command the plan specifies. Nothing at runtime says so:
a fan-out that hands back 25 arbitrary registry seeds looks exactly like one that
hands back the right 25.

**Resolved (Rule 3 — blocking) by narrowing the offer to the names the source
just produced**, not by reordering anything:

```ts
unenqueuedSeeds(limit: number, only?: string[])
fanOutSeeds({ limit, only })
```

- Omit `only` and the behaviour is the global FIFO it has always been.
- An **empty** set selects nothing, not everything — a source that produced no
  seed must not silently fall back to the global queue. Asserted.
- The scope narrows the offer and bypasses neither anti-join: a scoped name that
  already has a job, or is denylisted, is still excluded. Asserted.
- `remaining` is still counted across the **whole** table even on a scoped run. A
  scoped run reporting only its own residual would read as "the corpus is
  drained" while 8,860 seeds sat waiting.

Verified to bite: making `nameScope` return `undefined` fails exactly the two
scope assertions in `seeds.test.ts` and nothing else.

### Why the scope is a name set and not a `discovered_from` value

The first version filtered on provenance. Running the link expansion killed it:

| source | seeds before links ran | after |
|---|---|---|
| `mcp-registry` | 7,971 | 7,718 |
| `operator-seed-list` | 15 | **11** |

`upsertSeeds`' conflict clause sets `discovered_from` from `excluded`, so
provenance is **last-writer-wins**. The curated lists re-tagged 253 registry
seeds and **4 of the 15 operator seeds** — including `anthropics/claude-code` and
`obra/superpowers` — which a provenance-scoped operator fan-out would then have
skipped. A source knows the names it just wrote; it cannot rely on the column
still agreeing.

**Left as a finding, not changed (Rule 4 — architectural).** The plan's truth
*"every seed the operator file names carries the provenance `operator-seed-list`"*
is currently **false for whichever source ran earliest**, and no single-valued
column can make it true when three sources legitimately name the same repository.
First-writer-wins would break it the other way (`cloudflare/mcp-server-cloudflare`
was a registry seed before the operator listed it). The maintainer should decide
between first-wins, last-wins, and a provenance set; the per-source counts below
are therefore *current claims*, not first discoveries.

---

## Task 1 — the operator seed list

`config/seeds.json` carries the fifteen repositories in Reference A's order —
which is measured artifact density order — the two curated lists, and the six
rejected candidates with the reason each was rejected. `src/corpus/seedList.ts`
validates it with `zod`, runs every `fullName` through `normalizeRepo`, and maps
entries to rows in file order.

The `rejected` key is stripped by the non-strict schema, so a rejected candidate
cannot become live input by sharing a document with live ones. Asserted directly,
and asserted against the committed file rather than a synthetic copy — a schema
test over a fixture would pass on the day someone commits a typo into the one
file where a hand-typed string becomes a URL AgentDock constructs.

`unenqueuedSeeds`' `id` tie-break was **already present** from wave 1, with its
test. Nothing was added there.

### The live bounded run — 6 core requests, exactly as budgeted

`bun run corpus:sync --source=seeds --enqueue=3 --drain=3`, core **54 → 48**:

| repository | found | stored | parse failures | `parse_status=ok` | truncated | duration |
|---|---|---|---|---|---|---|
| `cloudflare/mcp-server-cloudflare` | 1 | 1 | 0 | 1 | no | 0.6 s |
| `davila7/claude-code-templates` | 402 | 402 | 107 | 93 | **yes** | 55.4 s |
| `wshobson/agents` | 383 | 383 | 41 | 267 | no | 57.7 s |
| **total** | **786** | **786** | **148** | **361** | | |

`davila7/claude-code-templates` came back `truncated: true` at 402 of ~1,300
candidate paths, exactly as 05-CONTEXT predicted — permanently truncated,
delisting permanently suppressed. Recorded, not smoothed over.

`cloudflare/mcp-server-cloudflare` was offered first rather than thirteenth
because it was already a registry seed and kept its earlier `created_at`. Within
a source, insertion order holds; a row an earlier source already wrote keeps its
original queue position. That is honest — it was discovered earlier — and it is
worth knowing before reading the order as pure file order.

---

## Task 2 — curated link lists, at zero core cost

`src/corpus/links.ts` names no hostname. One fixed pattern
(`/https:\/\/[^\s<>()[\]"'`]{1,300}/g`) pulls generic tokens; each goes to
`githubRepoFromUrl`, which owns the host check. No alternation, no nested
quantifier, and the length ceiling is inside the character class, so an
unterminated run costs 300 steps and not the file. Trailing prose punctuation is
trimmed by a three-line loop rather than an anchored quantified pattern — the one
shape in the file that could have gone quadratic on a run of dots.

`fixtures/adversarial/awesome-list.md` is the committed regression and carries
every shape: one repository linked three ways, deep/tree/clone/query URLs, mixed
case, four site routes, a gist, the raw host, three other hosts, a lookalike
host, a userinfo prefix, plain HTTP, and four malformed tokens. Six `owner/repo`
strings come out; everything else yields nothing.

### A bug in the shared predicate, found by writing the fixture

`https://github.com/topics/claude-code` and
`https://github.com/orgs/anthropics/repositories` are **well-formed `owner/repo`
strings**, so `githubRepoFromUrl` accepted them and would have produced
`topics/claude-code` and `orgs/anthropics` as seeds — two core requests each,
spent learning they are 404s. Curated lists are full of exactly these URLs.

Fixed at the root (Rule 1), in `src/github/client.ts`, because the catalog
detector shares the predicate and had the same latent hole: a
`RESERVED_OWNER_SEGMENTS` set of 26 GitHub site routes, checked before
`normalizeRepo`. The list errs toward being *incomplete* — a missing route costs
one wasted lookup, while a real account wrongly listed would drop a repository
forever. A 14-case rejection table and a 6-case acceptance table now cover the
predicate directly, where it lives.

Plain `http://github.com/owner/repo` is deliberately still accepted by the
predicate: it returns a **name**, which is then fetched over https by
`githubFetch`. `links.ts` narrows to `https:` at extraction instead, where an
http token in an untrusted document is not worth parsing.

### The cap I set from the research's prose, and what measuring it cost

`maxLinkListBytes` was first `1 MB`, justified in its own doc comment as
"roughly twenty times the largest observed". The first live run:

```
source=links lists=2 read=1 unreadable=1 extracted=133 written=133 core-cost=0
INCOMPLETE — 1 list(s) could not be read and contributed nothing.
```

Measured directly on the raw host, free: `hesreallyhim/awesome-claude-code` is
**138,758 bytes** and `punkpeye/awesome-mcp-servers` is **1,339,093** — the cap
silently cost the larger of the only two lists in the file. Raised to **4 MB**
from the measurement plus ~3x headroom, and the doc comment now carries both
numbers instead of a description. The loud INCOMPLETE line is the only reason
this was noticed at all.

### The live expansion — core 44 → 44

`bun run corpus:sync --source=links --no-enqueue`:

```
source=links lists=2 read=2 unreadable=0 extracted=1133 written=1132
  over-list-cap=2390 dropped-by-source-cap=0 core-cost=0 read-at=HEAD
INCOMPLETE — 2390 link(s) were past maxLinksPerList=1000 and were not extracted.
```

| list | bytes | seeds contributed | already known |
|---|---|---|---|
| `punkpeye/awesome-mcp-servers` | 1,339,093 | **1,000 (at the cap)** | 253 registry + 4 operator rows were re-tagged across both lists |
| `hesreallyhim/awesome-claude-code` | 138,758 | **132** | (same 257 total; 1 repository per list was already ingested) |

1,133 extracted → 1,132 written: one repository is named by both lists and
`upsertSeeds` collapsed it.

**GitHub core remaining before: 44. After: 44.** COR-04 costs nothing, proven
rather than argued. A second identical run wrote no new row and again moved
nothing.

`maxLinksPerList` **binds on real input** and its doc comment now says so with
the measurement, instead of the "the largest holds a few hundred" claim it
originally carried. The value stays at 1,000 deliberately: one third-party
document should not decide the shape of the index, and 1,000 repositories from
one list is already forty hours of unauthenticated ingest budget.

### Nothing extracted was fetched

Asserted from the recorded host list: across the link source's tests the captured
hostnames are `raw.githubusercontent.com` and nothing else. One list read
produces six repositories and one request. `check:boundaries` passes with
`links.ts` in `src/corpus/`, which it could not if the file named a policed host.

---

## Task 3 — catalog fan-out, and the drop it was hiding

The defect was sharper than STATE.md recorded it. `catalog.ts:119-124` computed
`notSeedable` and put it in a prose warning; `pipeline.ts`'s seeds branch
`continue`s **without ever reading `result.warnings`** — the artifact branch
writes warnings to `parse_errors`, the seeds branch does not. The count was not
merely unlogged, it was destroyed one function after it was computed.

Closed as a number, not a string: `skipped: number` on the `'seeds'`
`ParseResult` variant → summed in the pipeline → one new **required** field on
`IngestLog`. Required, so `bun run typecheck` failed until every construction
site supplied it; emitted on every path including `no_artifacts`, and zero rather
than absent, because an absent key is ambiguous between "no catalog" and "an
older build".

**Observed live** on `anthropics/claude-code`:

```json
{"event":"ingest","owner":"anthropics","repo":"claude-code","outcome":"ok",
 "found":46,"stored":46,"failed":0,"seedsSkipped":13,"truncated":false, ...}
```

Thirteen marketplace entries named no GitHub-reachable repository. That number
existed on every ingest since Phase 3 and had never left the function that
computed it.

### The last hop, proven against the database

`fanout.test.ts` gains a `describe.skipIf(!DB_URL)` block that rebinds the file's
existing doubles to the real `unenqueuedSeeds`, `countUnenqueuedSeeds` and
`enqueueJob`, persists a scan carrying seeds with `persist.test.ts`'s shape, and
asserts the `ingest_job` rows. **Wave 1 could not write this test** — an unscoped
fan-out inside a suite enqueues a sibling suite's seed and leaves a claimable row
behind. The `only` parameter added for the ordering defect is what makes it
writable, and the narrowing is the same narrowing production uses.

Verified to bite: replacing the `enqueueJob(target)` call with a fabricated
`queued` result fails 6 of the 13 tests in the file, three of them in this block.

**One deviation from Reference E.** The plan asks that a denylisted seed be
"reported in the counters rather than silently absent". It cannot be, and that is
correct: `unenqueuedSeeds`' denylist anti-join removes it **before** `enqueueJob`
sees it, so it never reaches the `denylisted` counter. That anti-join is D-02's
own requirement — without it a denylisted seed is re-offered forever. The test
asserts the honest version instead: no job is created, and the seed is not left
pending either, because `countUnenqueuedSeeds` applies the same anti-join. The
counter path is still covered in the mocked block, where `enqueueJob` is what
refuses.

### Catalog-discovered seeds on live data: not zero

The plan hedged that a zero here would be a real finding. It is not zero —
`wshobson/agents`' marketplace named four third-party repositories, all
`git-subdir`, all reached through the same fan-out the registry uses:

| discovered_from | full_name | source_kind |
|---|---|---|
| `wshobson/agents` | `anasss/qa-orchestra` | git-subdir |
| `wshobson/agents` | `major7apps/pensyve` | git-subdir |
| `wshobson/agents` | `martinforreal/storymap-skill` | git-subdir |
| `wshobson/agents` | `suniel12/ciagent` | git-subdir |

COR-03 is closed on live data, not only in a test.

---

## Final live state

| discovered_from | seeds |
|---|---|
| `mcp-registry` | 7,718 |
| `punkpeye/awesome-mcp-servers` | 999 |
| `hesreallyhim/awesome-claude-code` | 129 |
| `operator-seed-list` | 15 |
| `wshobson/agents` | 4 |
| **total `repo_seed`** | **8,865** |

(These are current provenance claims. The counts shift between runs because
provenance is last-writer-wins — see the finding above.)

`ingest_job`: 5 rows, all `succeeded`. Core budget: **54 at the start, 41 at the
end**. Six of those thirteen were the Task 1 drain, two were the Task 3 drain;
**four requests between the two drains are unaccounted for** and I did not
isolate them — reported rather than rounded away.

## Deviations from plan

1. **[Rule 3 — blocking] `unenqueuedSeeds`/`fanOutSeeds` gained an `only` name
   scope.** Without it the plan's Task 1 `done` criterion is unreachable: the
   command would have ingested three arbitrary registry seeds. Measurement and
   reasoning above. Default behaviour unchanged.
2. **[Rule 1 — bug] `githubRepoFromUrl` rejects reserved GitHub site routes.**
   Root-cause fix in the shared predicate, since the catalog detector had the
   same hole. `src/github/client.ts` was not in the plan's `files_modified`.
3. **[Rule 1 — my own bad number] `maxLinkListBytes` raised 1 MB → 4 MB.** Set
   from the research's prose, then measured; the original value silently cost one
   of two curated lists.
4. **`maxLinksPerList`' doc comment corrected.** The value the plan specified is
   kept; the claim that it exceeds every observed list was false and is replaced
   by the measurement showing it binds.
5. **Reference E's denylist-counter assertion replaced with the true one.** The
   anti-join removes the seed upstream of the counter. Explained above.
6. **The pathological-extraction input is generated in the test, not committed.**
   `redos-line.md`'s rule exists for a hand-tuned byte sequence; this input is one
   repeated token, and a megabyte of it in the repository would say nothing that
   `.repeat()` does not.
7. **`fixtures/adversarial/README.md` gained a row** for the new fixture, per that
   directory's own convention. Not in `files_modified`.
8. **`src/github/client.test.ts` gained a table** for the predicate fix. Not in
   `files_modified`.

## Verification checklist (the plan's own list)

| # | Item | Result |
|---|---|---|
| 1 | `config/seeds.json` parses; every entry survives `normalizeRepo`; `rejected` produces no seed | pass |
| 2 | Seeds offered in file order, proven by a bulk-insert test | pass (wave 1's test; the cross-source caveat is the finding above) |
| 3 | `discoveredFrom` distinguishes operator, registry and catalog seeds by query | pass, with the last-writer-wins caveat recorded |
| 4 | Parenthesised, angle-bracketed and bare links identical; non-repository `github.com` paths refused | pass |
| 5 | An oversized list is capped and the overflow reported as a number | pass — 2,390 reported live |
| 6 | A pathological extraction input completes well under a second | pass — under a 500 ms bound |
| 7 | Host list names `raw.githubusercontent.com` only; core quota did not move | pass — 44 → 44 |
| 8 | `seedsSkipped` a number on every ingest line, zero included | pass — 13 observed live |
| 9 | A persisted scan's seeds reach `ingest_job`; the denylisted one does not; a re-run adds nothing | pass (item 3 of Reference E adjusted — see deviation 5) |
| 10 | Three repositories ingested live for six core requests, recorded | pass — 54 → 48, 786 artifacts |
| 11 | No `drizzle/*.sql` added or changed; `scripts/migrate.mjs` unmodified | pass — `git status drizzle/ scripts/migrate.mjs` clean, 6 files as before |
| 12 | `bun run ci` passes | pass — **49 files, 822 tests** |

## Known ceilings carried forward

- **Fan-out across sources is arrival order, and only the caller's name set
  overrides it.** An operator who runs `--source=all` gets the global FIFO and
  therefore the registry backlog first. Deliberate — `all` singles out no source
  — but it means COR-06's fast path is `--source=seeds` specifically.
- **`discovered_from` is last-writer-wins.** Needs a maintainer decision before
  the per-source counts can be read as discovery history.
- **`punkpeye/awesome-mcp-servers` is permanently truncated at 1,000 links**, with
  2,390 further occurrences unreached and unnamed. Reported every run.
- **`davila7/claude-code-templates` never converges** — 402 of ~1,300 paths,
  `tree_truncated` forever, as 05-CONTEXT accepted.
- **Four core requests during this plan are unaccounted for.**
- The anti-join is still unindexed on `ingest_job.target`; it now runs over 8,865
  seed rows against 5 job rows. Still a `ponytail:` note, not built.

## Nothing was committed

Working tree left for the maintainer, branch `develop`. `.planning/STATE.md` and
`ROADMAP.md` were **not** advanced — left to the orchestrator, as in wave 1.

Recommended commit message:

```
feat(05-02): seed list, curated-link expansion, and catalog fan-out closed

- config/seeds.json: 15 live-verified repositories in measured artifact density
  order, the two curated lists, and the 6 candidates checked and rejected;
  src/corpus/seedList.ts validates it and preserves file order
- src/corpus/links.ts: bounded, alternation-free extraction of owner/repo from a
  curated Markdown list, read at HEAD from the raw host for zero core requests,
  fetching nothing it extracts and naming no hostname of its own
- fan-out gains an `only` name scope: the offer is ordered by global arrival, so
  7,971 wave-1 registry seeds sat ahead of every operator seed — 319 capped
  invocations and 11 days of quota before the densest repository. Scoped by the
  names a source just wrote, not by discovered_from, which is last-writer-wins
  and was re-tagged by the link expansion
- githubRepoFromUrl refuses reserved GitHub site routes: topics/ and orgs/ are
  well-formed owner/repo strings and were becoming seeds, two core requests each
- seedsSkipped travels as a number from catalog.ts through the pipeline onto the
  ingest log line; the seeds branch never read warnings, so the count was being
  destroyed one function after it was computed. 13 observed live
- fanout.test.ts proves the last hop against the database: a persisted scan's
  seeds become ingest_job rows, idempotently
- no migration
```
