---
phase: AGD-05-corpus-cold-start
plan: 02
type: execute
wave: 2
depends_on: [05-01]
files_modified:
  - config/seeds.json
  - src/corpus/seedList.ts
  - src/corpus/seedList.test.ts
  - src/corpus/links.ts
  - src/corpus/links.test.ts
  - src/corpus/caps.ts
  - src/db/queries/seeds.ts
  - src/db/queries/seeds.test.ts
  - scripts/corpus-sync.mjs
  - src/detect/types.ts
  - src/detect/catalog.ts
  - src/detect/catalog.test.ts
  - src/ingest/pipeline.ts
  - src/ingest/pipeline.test.ts
  - src/log.ts
  - src/log.test.ts
  - src/corpus/fanout.test.ts
  - fixtures/adversarial/awesome-list.md
autonomous: true
requirements: [COR-02, COR-03, COR-04]

estimate:
  tokens: 95000
  raw_tokens: 95000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "One command turns a committed operator file into repo_seed rows and then into queued jobs, with no argument beyond the source name"
    - "Seeds are offered to fan-out in the order the operator file lists them, so front-loading a dense repository actually front-loads it"
    - "Every seed the operator file names carries the provenance operator-seed-list, distinguishable from a registry seed and a catalog seed by a query"
    - "A curated link list becomes seeds without spending a single GitHub core request"
    - "A URL extracted from a link list is turned into an owner/repo and is never itself fetched"
    - "A link list of any size costs bounded time and bounded memory, and a list that exceeded the cap says so"
    - "A repository whose marketplace.json names other repositories produces seeds that reach ingest_job through the same fan-out the registry uses"
    - "A marketplace entry that names no reachable repository is counted, and that count now reaches a log line instead of being discarded"
    - "Re-running any source over an unchanged input writes no new seed and enqueues no new job"
  artifacts:
    - path: "config/seeds.json"
      provides: "The operator's own corpus roots: fifteen verified repositories ordered by measured artifact density, plus the curated link lists, plus the rejected candidates with the reason each was rejected"
      min_lines: 60
    - path: "src/corpus/seedList.ts"
      provides: "Reads and validates the operator file, maps it to seed rows with operator provenance, preserving file order"
      exports: ["loadSeedList", "seedListRows", "SeedListFile"]
      min_lines: 50
    - path: "src/corpus/links.ts"
      provides: "Bounded extraction of owner/repo from a curated Markdown list, read from the raw host at zero core cost, fetching nothing it extracts"
      exports: ["extractRepoLinks", "expandLinkLists"]
      min_lines: 70
  key_links:
    - from: "config/seeds.json"
      to: "src/db/queries/seeds.ts"
      via: "file order becomes insertion order becomes fan-out order, which is what makes density front-loading real"
      pattern: "seedListRows"
    - from: "src/corpus/links.ts"
      to: "src/github/client.ts"
      via: "githubRepoFromUrl is the only thing that reads an extracted URL, so no host literal and no fetch of an extracted address"
      pattern: "githubRepoFromUrl"
    - from: "src/detect/catalog.ts"
      to: "src/log.ts"
      via: "the not-seedable count finally reaches a log line instead of dying in a discarded warnings array"
      pattern: "seedsSkipped"
---

<objective>
Give the operator three more ways to fill the index, all of them routing into the
same `repo_seed` table and the same fan-out 05-01 proved: a committed list of
verified repositories, the catalogs those repositories already contain, and the
curated link lists the community already maintains.

Purpose: the registry supplies MCP servers and nothing else. Five of the six
artifact types AgentDock detects — skill, plugin, catalog, command, hook — have
no registry at all, and the only way to reach them without a crawler is a list a
human wrote and the lists other humans wrote. This plan writes the first one from
live-verified measurements rather than guesses, expands the second and third
mechanically, and closes the one drop this project already knows it is not
reporting.

Output: `config/seeds.json` carrying fifteen verified repositories in density
order plus the candidates that were checked and rejected; `--source=seeds` and
`--source=links` on the sync command; catalog fan-out proven from a
`marketplace.json` all the way to a queued job; and `seedsSkipped` on the ingest
log line.

Honours 05-CONTEXT's decisions that no host literal becomes a data value (D-12),
that every cap prints what it dropped (D-07), that an extracted URL is stored and
never fetched (Anti-goals), and that this plan adds no migration (C2).
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/phases/AGD-05-corpus-cold-start/05-CONTEXT.md
@.planning/phases/AGD-05-corpus-cold-start/05-RESEARCH.md
@.planning/phases/AGD-05-corpus-cold-start/05-01-SUMMARY.md
@src/detect/catalog.ts
@src/detect/types.ts
@src/ingest/pipeline.ts
@src/log.ts
@src/github/client.ts
@src/github/raw.ts
@scripts/analyze-backfill.mjs
</context>

<decisions_made_while_planning>

**1. One operator file, two keys, because both keys produce seeds.**

`config/seeds.json` holds `seeds` (COR-02's direct repositories) and `linkLists`
(COR-04's curated lists). A second file would mean a second loader, a second
validation schema and a second place to forget. The name is honest: a curated
list is a source of seeds, not a different kind of thing.

Research §Q5 argues JSON over a `.txt` list because the phase needs a source
label per entry and a bare list cannot carry one without inventing a comment
convention this project has nowhere else. Adopted. The file also carries the
*rejected* candidates with the reason each was rejected — the two 404s, the three
zero-marker repositories, the one that is not a Claude-ecosystem project — because
a list that silently omits what was checked invites the next maintainer to check
them again.

**2. File order is fan-out order, and that requires a tie-break the anti-join must carry.**

§Q4's whole cold-start argument rests on ordering by artifact density rather than
repository count: two repositories carry more artifacts than the other thirteen
combined. That ordering only survives if the loader preserves file order **and**
the anti-join reproduces it. A bulk insert gives every row the same
`created_at`, so ordering by that column alone is nondeterministic between rows
written in one statement. `unenqueuedSeeds` orders by `(created_at, id)`, and
`id` is a `bigserial` assigned in insert order — that pair is what makes the
front-loading real rather than aspirational.

**3. Curated lists are read at `HEAD` from the raw host, and that is deliberate.**

`fetchRawFile` (`src/github/raw.ts:7`) takes a ref, not necessarily a commit sha,
and `raw.githubusercontent.com` costs no core quota — verified repeatedly and
stated in that file's own doc comment. Pinning a list to a commit would cost a
core request per list to learn the sha, for content that is never stored: the
output of reading a link list is a set of `owner/repo` strings, not an artifact
with provenance obligations. PRV-01's pinning requirement is about what AgentDock
*shows*, and no byte of a link list is ever shown.

The consequence worth stating: **COR-04 is executable with core quota at zero**,
like COR-01 and unlike COR-02. `discoveredPath` records `README.md@HEAD` so the
unpinned read is visible in the data rather than implied.

**4. Nothing extracted from a link list is fetched, and the code cannot express fetching it.**

Extraction produces `owner/repo` strings through `githubRepoFromUrl`, and those
strings enter `repo_seed` and then the ordinary ingest path — the same two hosts,
the same `normalizeRepo` validation, the same denylist. The extracted URL itself
is never passed to `fetch`. This is `catalog.ts:19-28`'s existing posture applied
to a second source, not a new rule, and it is why `ING-11` is untouched.

**5. `github.com` is not a policed host, and the extractor still must not name it.**

Rule 5's GitHub pattern is `api\.github\.com|raw\.githubusercontent\.com`. The
plain web host `github.com` is deliberately outside it — `packages.ts:75` builds
permalinks to it from outside `src/github/` and CI passes, because it is a
rendering target, not a fetch target. So a literal in `src/corpus/links.ts` would
*not* fail the build. It is still not written: the extractor pulls generic URL
tokens with a bounded pattern and hands each to `githubRepoFromUrl`, which owns
the host check. One host predicate, one place, already tested.

**6. The `seedsSkipped` gap is closed here, in the plan that exercises catalogs.**

STATE.md carries it as an observability debt from Phase 4. Reading the code makes
it sharper than recorded: `catalog.ts:120-124` computes the count and puts it in a
prose warning, and `pipeline.ts:283-293`'s seeds branch `continue`s **without
reading `result.warnings` at all** — the artifact branch writes warnings to
`parse_errors` at `:335`, the seeds branch discards them. So the count is not
merely unlogged; it is destroyed one function later.

The fix is a number, not a string: `skipped` on the `'seeds'` `ParseResult`
variant, summed in the pipeline, emitted as one more closed field on the ingest
log line. `src/log.ts:47`'s doc says its key set is closed on purpose — a
`number` field with a documented provenance is exactly what that doc permits, and
a free-form payload is what it forbids.

**7. Catalog fan-out is proven against the database, not against the network.**

The write half (`catalog.ts` → `pipeline.ts` → `persist.ts:277-297`) has shipped
since Phase 3 and its unit tests pass. What has never been exercised is the
chain: a persisted scan carrying seeds, then `fanOutSeeds`, then an `ingest_job`
row. That is a DB-backed integration assertion in `agentdock_test` using
`persist.test.ts`'s existing scan-fixture shape — no GitHub, no fixtures to
capture, and it fails today for the honest reason that nothing read `repo_seed`
until 05-01.

</decisions_made_while_planning>

<reference>

## Reference A — `config/seeds.json`

Every entry below was verified live on 2026-08-11 (§Q5): a metadata call proving
existence, and for most, a recursive tree fetch counting artifact-shaped paths.
The order is the file's order and therefore the fan-out order (decision 2).

```jsonc
{
  "seeds": [
    { "fullName": "davila7/claude-code-templates", "note": "11,499 tree entries; 896 skill-shaped and 393 command-shaped paths. Largest single contributor and the reason this list is ordered by density. Will hit CAPS.maxFiles=400 and stay permanently truncated." },
    { "fullName": "wshobson/agents",              "note": "All six detector types in one repository: 180 skills, 91 plugin manifests, 3 marketplaces, ~109 commands, 2 hook configs, 1 .mcp.json." },
    { "fullName": "anthropics/claude-code",        "note": "10 skill, 12 plugin, 1 catalog, 18 command, 5 hook — the reference implementation's own content." },
    { "fullName": "addyosmani/agent-skills",       "note": "Five of six types; the specification-conformant baseline." },
    { "fullName": "anthropics/skills",             "note": "Canonical skill corpus, 18 SKILL.md." },
    { "fullName": "JimLiu/baoyu-skills",           "note": "21 SKILL.md; non-ASCII names and nested metadata edge cases." },
    { "fullName": "obra/superpowers",              "note": "14 SKILL.md, 1 plugin, 1 catalog, 1 hook. Independent author, not Anthropic-adjacent." },
    { "fullName": "anthropics/claude-cookbooks",   "note": "4 skill, 11 command, 1 hook." },
    { "fullName": "upstash/context7",              "note": "9 skill, 1 plugin, 1 catalog, 4 mcp, 2 command. Renamed from upstash/context7-mcp — a live instance of the rename the github_node_id identity key exists to survive." },
    { "fullName": "disler/claude-code-hooks-mastery", "note": "21 command, 1 hook. Hook-focused independent author." },
    { "fullName": "centminmod/my-claude-code-setup",  "note": "7 skill, 20 command, 1 hook." },
    { "fullName": "anthropics/claude-agent-sdk-python", "note": "1 skill, 1 plugin, 4 command, 1 hook — small, touches four types." },
    { "fullName": "cloudflare/mcp-server-cloudflare", "note": "1 mcp marker, matched by path pattern only (research assumption A2), not by reading the file." },
    { "fullName": "github/github-mcp-server",      "note": "1 mcp marker, path pattern only (A2)." },
    { "fullName": "modelcontextprotocol/servers",  "note": "1 mcp marker, path pattern only (A2). Included for completeness, not yield: most servers there are source code, not declarations." }
  ],
  "linkLists": [
    { "fullName": "hesreallyhim/awesome-claude-code", "path": "README.md", "note": "Zero artifact markers of its own; pure link list." },
    { "fullName": "punkpeye/awesome-mcp-servers",     "path": "README.md", "note": "Pure link list. wong2/awesome-mcp-servers is redundant with it and is not included." }
  ],
  "rejected": [
    { "fullName": "affaan-m/claude-code-plugins-hub", "reason": "404 on 2026-08-11" },
    { "fullName": "ericbuess/claude-code-tools",      "reason": "404 on 2026-08-11" },
    { "fullName": "simonw/llm",                        "reason": "0 artifact markers; not a Claude-ecosystem repository" },
    { "fullName": "steipete/agent-rules",              "reason": "0 artifact markers; predates the current directory conventions" },
    { "fullName": "qdrant/mcp-server-qdrant",          "reason": "0 artifact markers; near-zero yield" },
    { "fullName": "modelcontextprotocol/inspector",    "reason": "1,266 entries, 2 markers; density too low to spend two core requests on" }
  ]
}
```

Committed as strict JSON — no comments in the real file, since the loader uses
`JSON.parse`. The `rejected` key is read by nothing and exists so a future
maintainer does not re-verify what was already checked; the loader ignores it and
a test asserts that it does, so the key cannot quietly become live input.

**Do not add a repository this plan has no budget to verify.** If the list needs
to be longer, the honest move is to verify more and record the result, not to
guess. Fifteen verified entries carrying well over 1,500 candidate artifact paths
is the deliverable; a padded twenty is not.

## Reference B — `src/corpus/seedList.ts`

A `zod` schema over the file, matching `src/env.ts`'s discipline: parse at the
edge, fail loudly with a message naming the offending entry, never read an
unvalidated field. `fullName` goes through `normalizeRepo` (`client.ts:43`) —
the operator file is trusted-ish, not trusted, and it is the one place a typo
becomes a URL.

`seedListRows(file)` maps entries in order to seed rows:
`sourceKind: 'github'`, `discoveredFrom: 'operator-seed-list'`,
`discoveredPath: 'config/seeds.json'`, and a `hint` of `{ note }`.

The provenance tag is a plain name, not a hostname (D-12).

## Reference C — `src/corpus/links.ts`

Two functions, one bounded regex, no Markdown parser.

`extractRepoLinks(markdown)`:
- One pass, one fixed pattern, no nested quantifier and no alternation:
  a `https:` prefix followed by a bounded run of non-delimiter characters,
  length-capped in the character class itself. This is the shape
  `install.ts:30` and `check-boundaries.mjs`'s own patterns already use, and it
  is why there is nothing here to backtrack over.
- Trailing Markdown punctuation is trimmed before parsing, because a link inside
  `[text](url).` and one inside `<url>` are both real shapes in these files.
- Each token is passed to `new URL()` inside a `try`, then to
  `githubRepoFromUrl`. Anything that is not a `github.com` repository URL yields
  nothing, with no second branch and no host literal in this file (decision 5).
- Results are lowercased, de-duplicated, and truncated at
  `CORPUS_CAPS.maxLinksPerList` with the overflow **returned as a count**, never
  dropped silently.

`expandLinkLists(lists)`:
- Reads each list with `fetchRawFile(owner, repo, 'HEAD', path,
  CORPUS_CAPS.maxLinkListBytes)`. Zero core requests (decision 3).
- Skips a list that cannot be read, counts it, continues to the next — the
  per-candidate posture `pipeline.ts` already applies to detectors.
- Writes seed rows with `sourceKind: 'github'`,
  `discoveredFrom: <the list's own owner/repo>` — the column's original meaning,
  used literally — and `discoveredPath: '<path>@HEAD'`, so the unpinned read is a
  fact in the row rather than a footnote in a plan.

New caps in `src/corpus/caps.ts`, each carrying its arithmetic and its
non-coverage in the doctrine `scan.ts:11-29` sets:

| cap | value | the sentence it carries |
|---|---|---|
| `maxLinkListBytes` | `1 * 1024 * 1024` | an awesome-list README is tens of kilobytes; this bounds a hostile or runaway file. Does **not** bound how many links are inside it. |
| `maxLinksPerList` | `1000` | bounds seed volume from one list and the memory one pass holds. Does **not** bound total seeds — `maxSeedsPerSource` does. |

## Reference D — the `seedsSkipped` chain

Four small edits, in this order, and the middle one is the whole point:

1. `src/detect/types.ts:83` — the `'seeds'` variant gains `skipped: number`.
   A number, not another warning string: `pipeline.ts:293` proves a string on
   this branch goes nowhere.
2. `src/detect/catalog.ts:126-129` — return `skipped: notSeedable` alongside the
   existing warning. The warning stays for the artifact-branch convention; the
   number is what travels.
3. `src/ingest/pipeline.ts:283-293` — accumulate `seedsSkipped += result.skipped`
   in the seeds branch, and carry it onto the scan the way `seeds.length` is
   already carried at `:395`.
4. `src/log.ts` — one more field on `IngestLog`:

```ts
  /**
   * marketplace.json entries that named no GitHub-reachable repository — an npm
   * source, an archive URL, or a relative path pointing inside the catalog's own
   * repository. Counted by catalog.ts since Phase 3 and, until Phase 5,
   * discarded by the pipeline's seeds branch before it reached anything. A
   * number, not a message: this type's key set is closed on purpose.
   */
  seedsSkipped: number;
```

`src/log.test.ts` gains one assertion that the field is present on an ingest line
and is a number. `src/ingest/pipeline.test.ts` gains one that a scan over a
catalog with a mix of reachable and unreachable entries reports the right count.

## Reference E — the catalog fan-out integration proof

In `src/corpus/fanout.test.ts`, against `agentdock_test`, with the
`test-owner/corpus-spec-*` sentinel prefix 05-01 established:

1. Persist a scan carrying two seeds, using `persist.test.ts`'s existing scan
   shape — one seed whose full name is denylisted, one that is not.
2. Run `fanOutSeeds`.
3. Assert exactly one `ingest_job` row exists, for the seed that is not
   denylisted, and that the denylisted one is reported in the counters rather
   than silently absent.
4. Run `fanOutSeeds` again and assert nothing changed.

This is the assertion that COR-03 is actually closed. Everything before it —
`catalog.ts`'s `seedFor`, the `repo_seed` upsert — has been shipped and tested
since Phase 3; what has never existed is the last hop, and a unit test of
`seedFor` cannot see it.

Clean up every row the suite created, `repo_seed` rows included. A `queued`
`ingest_job` row left behind makes `jobs.test.ts`'s claim assertions
nondeterministic (`jobs.test.ts:24-27`), which is a race this codebase has
already fought once.

## Reference F — the sync command's new sources

`scripts/corpus-sync.mjs` gains `seeds` and `links` to its `--source` values and
nothing else changes in its shape. Same manual argv parsing, same shared `sql`
handle, same `sql.end()` on every path, same one-line summary per phase.

`--source=all` runs registry, seeds and links in that order — registry first
because it costs no GitHub quota and can therefore never be the thing that
starves the others.

</reference>

<tasks>

<task type="auto">
  <name>Task 1: The operator seed list, in density order, with its rejections recorded</name>
  <files>config/seeds.json, src/corpus/seedList.ts, src/corpus/seedList.test.ts, src/db/queries/seeds.ts, src/db/queries/seeds.test.ts, scripts/corpus-sync.mjs</files>
  <behavior>
    - The committed config/seeds.json parses against the loader's schema with no error.
    - Every fullName in the file survives normalizeRepo unchanged apart from case.
    - seedListRows preserves the file's order.
    - unenqueuedSeeds returns seeds in insertion order when many rows share one created_at, because it orders by id as well.
    - Every row written from the file carries discoveredFrom operator-seed-list, distinguishable by query from a registry row.
    - The rejected key is ignored: a repository listed only under rejected produces no seed row.
    - Running the seeds source twice writes the same number of repo_seed rows.
    - A file entry that is not a valid owner/repo fails the load with a message naming that entry, and writes nothing.
  </behavior>
  <action>
    Apply References A and B.

    Write config/seeds.json as strict JSON — the notes in Reference A are the
    real note values, and the jsonc comments there are the plan's, not the
    file's. Keep the order exactly as given: it is density order, verified from
    live tree scans, and it is the entire reason COR-06 is reachable in minutes
    rather than hours.

    Keep the rejected key and assert in a test that the loader ignores it. A
    rejected candidate that quietly became live input would spend two core
    requests on a repository already known to hold nothing.

    Add id as the tie-break in unenqueuedSeeds' ordering. A bulk insert stamps
    one created_at across every row, so ordering on that column alone makes
    fan-out order nondeterministic and the density front-loading imaginary. Prove
    it with a test that writes many rows in one statement and asserts the order
    that comes back.

    Run normalizeRepo over every entry at load. The operator file is committed by
    a human and is the one place a typo becomes a URL AgentDock constructs.

    Verify live once, bounded: with core quota available, run the seeds source
    with an enqueue limit of three and a drain of three. That is six core
    requests. Record which three repositories were ingested, how many artifacts
    each produced, and the remaining quota. The full run to five hundred belongs
    to 05-04 and must not be attempted here.
  </action>
  <verify>
    <automated>bun run test src/corpus src/db &amp;&amp; bun run typecheck &amp;&amp; bun run lint</automated>
  </verify>
  <done>A committed file of fifteen live-verified repositories, ordered by measured artifact density and carrying the six candidates that were checked and rejected, becomes repo_seed rows in that same order through one command — and three of them were ingested live for six core requests, with the counts recorded.</done>
</task>

<task type="auto">
  <name>Task 2: Curated link lists, expanded at zero GitHub core cost</name>
  <files>src/corpus/links.ts, src/corpus/links.test.ts, src/corpus/caps.ts, scripts/corpus-sync.mjs, fixtures/adversarial/awesome-list.md</files>
  <behavior>
    - Extraction over a realistic awesome-list fixture returns the repository links it contains, lowercased and de-duplicated.
    - A link inside parentheses, a link inside angle brackets, and a bare link all yield the same owner/repo.
    - A URL on a host that is not github.com yields nothing.
    - A github.com URL that is not a repository path — a user page, a gist, a topic page — yields nothing.
    - A list containing more links than the cap returns the cap's worth and reports the overflow as a number.
    - A file larger than maxLinkListBytes is refused by the capped reader rather than read whole.
    - A pathological input of many thousands of near-URL tokens completes in well under a second.
    - No test and no source path in links.ts calls fetch on an extracted URL.
    - Across the link source's tests the captured host list contains raw.githubusercontent.com and nothing else.
  </behavior>
  <action>
    Apply Reference C.

    Use one fixed, bounded pattern with no alternation and no nested quantifier,
    and put the sentence explaining why in the comment above it — that is this
    codebase's stated convention for every regex that runs over untrusted text,
    and links.ts runs over the largest untrusted text in the project.

    Do not name a host in this file. Extract generic URL tokens and hand each to
    githubRepoFromUrl, which already owns the host check and already reuses
    normalizeRepo's length caps and character rules. Note in a comment that the
    plain web host is not policed by check:boundaries and that this file avoids
    the literal anyway, so a reader does not conclude the omission was accidental.

    Read each list at HEAD from the raw host. A commit-pinned read would cost one
    core request per list to learn the sha, and the output is a set of owner/repo
    strings, not stored content — nothing from a link list is ever shown to a
    user. Record the unpinned read in the data by writing the path with an HEAD
    suffix in discoveredPath, so the fact is queryable rather than tribal.

    Fetch nothing that was extracted. An extracted address becomes an owner/repo
    and then travels the ordinary ingest path through the two hosts that path
    already uses. This is catalog.ts's existing posture applied to a second
    source, not a new rule.

    Write the pathological-input assertion as a real timing bound, following
    src/analyze/redos.test.ts's existing shape rather than inventing a second
    convention for the same claim.

    Verify live once with core quota untouched: expand both link lists and record
    how many unique repositories each produced, how many were already known, and
    that GitHub core remaining did not move. That last number is the proof COR-04
    costs nothing, and it is free to take.
  </action>
  <verify>
    <automated>bun run test src/corpus &amp;&amp; bun run check:boundaries &amp;&amp; bun run typecheck</automated>
  </verify>
  <done>Two curated Markdown lists became hundreds of seed rows for zero GitHub core requests, with every extracted address turned into an owner/repo and none of them fetched, and with the overflow of any oversized list reported as a number rather than truncated in silence.</done>
</task>

<task type="auto">
  <name>Task 3: Catalog fan-out closed end to end, and the drop it was hiding</name>
  <files>src/detect/types.ts, src/detect/catalog.ts, src/detect/catalog.test.ts, src/ingest/pipeline.ts, src/ingest/pipeline.test.ts, src/log.ts, src/log.test.ts, src/corpus/fanout.test.ts</files>
  <behavior>
    - A marketplace.json with two github-source entries and three unreachable ones yields two seeds and a skipped count of three.
    - The skipped count reaches the ingest log line as a number, on every ingest, including zero on a repository with no catalog.
    - A persisted scan carrying seeds, followed by fan-out, produces one ingest_job row per seed that is not denylisted.
    - A seed whose full name is denylisted produces no job and is reported in the fan-out counters.
    - Running fan-out a second time over the same seeds produces no additional job.
    - The existing catalog, pipeline and persist suites still pass unchanged apart from the new field.
  </behavior>
  <action>
    Apply References D and E.

    Carry the count as a number on the seeds ParseResult, not as another warning
    string. The seeds branch at pipeline.ts:283-293 continues without ever
    reading result.warnings — the artifact branch writes warnings to parse_errors
    at :335 and the seeds branch discards them — so a string here is destroyed one
    function after it is written. That is the actual defect, and it is sharper
    than the observability gap STATE.md records.

    Add exactly one field to IngestLog and give it the doc comment that says what
    it counts and why it is a number. That type's key set is closed deliberately
    so that no response body, header or connection string can ever be assigned
    into it; a documented integer is what the doc permits and a payload object is
    what it forbids.

    Emit the field on every ingest line, including as zero. A field that appears
    only when non-zero makes its absence ambiguous between "no catalog" and "an
    older build", which is the same ambiguity analyzed_at exists to prevent
    elsewhere in this schema.

    Write the fan-out integration test against the database, not the network.
    Persist a scan carrying seeds using persist.test.ts's existing scan shape,
    then run fanOutSeeds, then assert the jobs. Everything upstream of that last
    hop has been tested since Phase 3; the hop itself has never existed.

    Clean up every row the suite created, repo_seed rows included, and use the
    corpus-spec sentinel prefix. A queued ingest_job row left behind makes
    jobs.test.ts's claim assertions nondeterministic.

    Confirm on live data during the run: after the seed-list ingests from Task 1,
    query repo_seed grouped by discovered_from and record how many rows each
    source produced. If catalog-discovered rows number zero, say so and say why —
    the frozen corpora's marketplaces point inside their own repositories, which
    seedFor correctly refuses, and a zero there is a real finding rather than a
    failure.
  </action>
  <verify>
    <automated>bun run test src/detect src/ingest src/corpus src/log.test.ts &amp;&amp; bun run typecheck &amp;&amp; bun run ci</automated>
  </verify>
  <done>A marketplace.json's unreachable entries are counted and that count now reaches the ingest log line instead of dying in a discarded warnings array, and a catalog-discovered seed has been carried from a persisted scan through fan-out into a queued job by a test that fails without 05-01's consumer.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| `config/seeds.json` → a URL AgentDock constructs | Human-committed text; a typo becomes a host |
| an awesome-list README → the extraction regex | The largest untrusted text this project processes, from an arbitrary third party |
| an extracted URL → anything | The point at which arbitrary-URL fetch would be introduced if it were introduced anywhere |
| a `marketplace.json` entry → `repo_seed` → GitHub requests | Third-party JSON deciding what AgentDock spends its budget on |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-05-11 | Denial of Service | link extraction over a hostile README | high | mitigate | One fixed, bounded, alternation-free pattern with the length cap inside the character class; `maxLinkListBytes` enforced by the capped reader before a byte is scanned; a timing assertion following `redos.test.ts`'s existing shape. |
| T-05-12 | Spoofing / SSRF | an extracted URL | high | mitigate | Extracted addresses are never fetched. They become `owner/repo` through `githubRepoFromUrl`, which rejects every host but `github.com`, and travel the ordinary ingest path through the two hosts it already uses. |
| T-05-13 | Tampering | a hostile `marketplace.json` naming thousands of repositories | medium | mitigate | `CATALOG_CAPS.maxPlugins` already bounds the array at the JSON layer; `CORPUS_CAPS.maxSeedsPerSource` and `maxEnqueuePerSync` bound what reaches the queue; every seed still passes the denylist inside `enqueueJob`. |
| T-05-14 | Tampering | a typo or hostile value in the committed seed file | medium | mitigate | `zod` at load plus `normalizeRepo` per entry, so a value that is not an anchored, length-bounded `owner/repo` fails the load loudly and writes nothing. |
| T-05-15 | Repudiation | a link list read at an unpinned ref | low | accept | Recorded in `discoveredPath` as an explicit `@HEAD` suffix, so the unpinned read is queryable. Accepted because nothing from a link list is ever stored or shown — only `owner/repo` strings, which the ordinary ingest path re-verifies. |
| T-05-16 | Information Disclosure | the new `seedsSkipped` log field | low | mitigate | An integer on a closed key set, with a doc comment stating why it is a number. No entry text, no path, no body reaches the log line. |
</threat_model>

<verification>
1. `config/seeds.json` parses, every entry survives `normalizeRepo`, and the `rejected` key produces no seed.
2. Seeds are offered to fan-out in file order, proven by a test that writes many rows in one statement.
3. `discoveredFrom` distinguishes operator, registry and catalog seeds by query.
4. Link extraction handles parenthesised, angle-bracketed and bare links identically, and refuses non-repository `github.com` paths.
5. An oversized list is capped and the overflow is reported as a number.
6. A pathological extraction input completes well under a second.
7. The link source's captured host list names `raw.githubusercontent.com` and nothing else, and core quota did not move.
8. `seedsSkipped` appears as a number on every ingest log line, zero included.
9. A persisted scan's seeds reach `ingest_job` through fan-out, the denylisted one does not, and a re-run adds nothing.
10. Three repositories from the seed list were ingested live for six core requests, recorded.
11. No `drizzle/*.sql` file was added or changed. `scripts/migrate.mjs` is unmodified.
12. `bun run ci` passes.

</verification>

<success_criteria>
- **COR-02** — an operator seed list bulk-populates the index from one command, ordered by measured artifact density rather than by repository count.
- **COR-03** — catalog files fan out into repository seeds, and a test now carries one from a persisted scan to a queued job.
- **COR-04** — curated link lists expand into seeds, for zero GitHub core requests, with nothing extracted ever fetched.
- ROADMAP criteria 2 and 3 — the seed list populates unattended; catalogs fan out.
- The `seedsSkipped` item carried into Phase 5 from Phase 4 is closed, with the defect recorded more precisely than it was carried.
</success_criteria>

<output>
Create `.planning/phases/AGD-05-corpus-cold-start/05-02-SUMMARY.md` when done.
Record: how many seed rows each source produced, broken down by `discovered_from`; how many
unique repositories each curated list yielded and how many were already known; the GitHub
core remaining before and after the link expansion, proving it cost nothing; which three
repositories the bounded live seed run ingested and how many artifacts each produced; the
`seedsSkipped` value observed on a real ingest; and whether any catalog-discovered seed rows
appeared at all, with the reason if none did. Record no credential, no connection string,
and no line of any fetched README.

**Do not `git add`, do not `git commit`, do not `git push`.** End with a recommended commit
message and leave the working tree for the maintainer. The branch stays `develop`.
</output>
