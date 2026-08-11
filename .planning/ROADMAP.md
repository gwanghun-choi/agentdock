# Roadmap: AgentDock

## Overview

AgentDock reaches v1 by proving one artifact type end to end before widening, then earning
its differentiator, then filling the index, then making it searchable. The order is driven
by two forces that pull against each other: the risk of over-generalizing across five
artifact types before one works, and the risk of an empty registry nobody returns to.
Sequencing resolves both — skills all the way through first, detector pluralism second,
the capability disclosure that justifies the product third, and only then bulk corpus and
search relevance, because relevance cannot be tuned against twenty rows.

A gated Phase 0 comes before all of it. AgentDock shares a PostgreSQL instance with a
running application, and the only login role is a superuser that owns that application's
schema. Until a dedicated least-privilege role exists, nothing at the database level
prevents a tooling bug from reaching another application's data — and that role cannot be
safely retrofitted once migrations have already run under the wrong owner.

The web UI is not a phase. It ships from Phase 1, because a vertical slice with no page to
look at is not a slice.

## Phases

- [x] **Phase 0: Database Isolation Bootstrap** — Make the database, not the code, enforce the schema boundary (COMPLETE — isolation verified 7/7)
- [x] **Phase 1: Walking Skeleton** — Submit a GitHub repo, see its skills on a detail page, safely (COMPLETE — live ingest verified)
- [x] **Phase 2: Durable Ingestion** — Make ingestion asynchronous, resumable, and idempotent (COMPLETE — verified live)
- [ ] **Phase 3: Detector Pluralism** — Plugins, MCP servers, commands, hooks, and catalogs
- [ ] **Phase 4: Capability Disclosure** — The reason the product exists
- [ ] **Phase 5: Corpus & Cold Start** — Fill the index without a crawler
- [ ] **Phase 6: Search & Browse** — Make the corpus findable
- [ ] **Phase 7: Derived Compatibility** — Compute what runtimes an artifact actually works with
- [ ] **Phase 8: Freshness** — Stop the index from quietly becoming a lie

## Phase Details

### Phase 0: Database Isolation Bootstrap
**Goal**: The database itself refuses AgentDock write access to any schema but `agentdock`.
**Depends on**: Nothing
**Requirements**: FND-01, FND-02, FND-03, FND-04, FND-05, FND-06, FND-07, FND-08, FND-09
**Success Criteria** (what must be TRUE):
  1. AgentDock connects as a role that is not a superuser and holds no table privileges in `public` or `didim_mcp`
  2. An attempt to create or drop an object outside `agentdock` fails with a permission error rather than succeeding
  3. The `agentdock` schema exists and is owned by that role
  4. The migration-history table resides in `agentdock`, not in `public` and not in a third schema
  5. `.env.example` exists with placeholders only and documents that `GITHUB_TOKEN` needs no scopes
**Plans**: 4 plans

> **Maintainer decision: RESOLVED — Branch A approved** (see `CONTEXT.md` in the phase
> directory). AgentDock uses a dedicated non-superuser role `agentdock_app` owning schema
> `agentdock`. The database enforces the boundary, so Drizzle is safe in
> `generate` → review → `migrate` mode.
>
> Two corrections to the earlier research, both verified by direct query against the live
> instance and recorded in `CONTEXT.md`:
>
> - **No `REVOKE` is needed or wanted.** `PUBLIC` already holds no `USAGE` on the
>   co-tenant schema and no `CREATE` on `public`, and `pg_default_acl` is empty — so a new
>   role is already fenced out the moment it exists. Revoking from `PUBLIC` would strip
>   privileges from the other application.
> - **`agentdock_app` cannot create schemas.** `mcpdb` has a NULL `datacl`, so `PUBLIC`
>   holds `CONNECT` and `TEMPORARY` but not `CREATE`. The test schema `agentdock_test` is
>   therefore created in the same one-time superuser session, and the dev-reset empties
>   the schema rather than dropping and recreating it.
>
> FND-06, FND-08, and FND-09 are pulled forward from Phase 1: the skeleton this phase
> builds is where the environment contract, the secret-handling rules, and the documented
> run command actually live. `REQUIREMENTS.md` already maps `FND-01 … FND-09` to both
> phases, so Phase 1 still exercises them.

Plans:
- [x] 00-01: Role and schema bootstrap SQL applied by the maintainer, with rollback alongside and a seven-assertion verifier that probes the boundary live
- [x] 00-02: Repository skeleton, blocking dependency-legitimacy gate, and the zod environment contract whose errors cannot echo a credential
- [x] 00-03: Migration boundary scanner, schema-confined dev reset, and CI running the same command a developer runs
- [x] 00-04: Tracer — one table from TypeScript through reviewed SQL to a rendered page, plus the boot-time isolation assertion

---

### Phase 1: Walking Skeleton
**Goal**: Paste a GitHub repository, and its Agent Skills appear on a listing and a detail page — with the security properties that are impossible to retrofit already in place.
**Depends on**: Phase 0
**Requirements**: FND-06, FND-08, FND-09, ING-01, ING-02, ING-03, ING-04, ING-05, ING-06, ING-07, ING-10, ING-11, DAT-01, DAT-02, DAT-03, DAT-04, DAT-05, DAT-06, DET-01, DET-08, DET-10, REN-01, REN-02, REN-03, REN-04, DIS-01, DIS-02, DIS-09, DIS-11, DIS-12, PRV-01, PRV-02, PRV-03, PRV-05, PRV-06, PRV-07, INS-01, INS-02, QUA-01, QUA-02, QUA-03, QUA-05, QUA-06, QUA-07, QUA-08
**Success Criteria** (what must be TRUE):
  1. Submitting a public repository that contains `SKILL.md` files results in those skills being listed
  2. A skill detail page shows its rendered body, source path, licence, freshness, and a permalink to the exact file at the exact indexed commit
  3. A repository containing many skills yields all of them
  4. A submitted value that is not `owner/repo` is rejected without any network request being made
  5. Repository content is never written to disk
  6. The XSS fixture suite and the SSRF bypass suite both pass
  7. A skill whose body contains script tags, raw HTML, or hostile metadata renders inert
  8. `bun install` plus one documented command brings the app up against the existing database
  9. Pages are server-rendered, work in light and dark mode, and remain usable at mobile width
**Plans**: 6 plans

> This phase touches every architectural boundary deliberately — schema isolation, the
> GitHub client, safe YAML, the identity key, sanitized rendering — so that a wrong
> assumption is discovered while the blast radius is one table and one detector. The
> security items here are not polish; they are the items that cannot be added later
> without re-running every analysis.

Plans: 6, in 4 waves. Wave 2 runs 01-02, 01-03 and 01-04 in parallel — they share no file.
- [x] AGD-01-01-PLAN.md — wave 1 — Tracer: schema, identity keys and all day-one columns (`commit_sha`, `scanned_at`, `etag`, `content_hash`, `license_spdx`, denylist, `artifact_type`), one real skill persisted from a pinned fixture and rendered with a permalink proven to resolve, plus the four source boundary rules the build enforces
- [x] AGD-01-02-PLAN.md — wave 2 — GitHub client: host allowlist, `owner/repo` only, manual redirects, two-call Trees enumeration, free raw file reads, streaming byte cap, resource caps, rate-limit accounting
- [x] AGD-01-03-PLAN.md — wave 2 — Skill detector and tolerant frontmatter parsing with both YAML size caps, against four frozen corpora and nineteen adversarial fixtures
- [x] AGD-01-04-PLAN.md — wave 2 — Sanitized rendering pipeline, nonce CSP via `src/proxy.ts`, metadata escaping, and the eleven-case XSS regression suite
- [x] AGD-01-05-PLAN.md — wave 3 — Ingestion pipeline: denylist, per-artifact parse isolation, one transaction, nine user-facing outcomes, one structured log line
- [x] AGD-01-06-PLAN.md — wave 4 — Submit flow, home, listing, repository and detail pages, README, and the CI gate (build, type-check, lint, tests, migration safety)

---

### Phase 2: Durable Ingestion
**Goal**: Ingestion survives crashes, does not block the request, and never does the same work twice.
**Depends on**: Phase 1
**Requirements**: ING-08, ING-09, ING-12, ING-13, JOB-01, JOB-02, JOB-03, JOB-04, JOB-05, JOB-06, QUA-04
**Success Criteria** (what must be TRUE):
  1. Submitting a repository returns immediately and the user can watch the job progress
  2. Killing the process mid-ingest leaves no half-written package state
  3. A job abandoned by a dead worker is picked up again automatically
  4. Re-submitting an unchanged repository completes without re-reading its files
  5. A failed job shows a readable reason and can be retried
  6. Approaching the GitHub rate limit causes backoff rather than a wall of errors
  7. No token or response body appears in any log line
**Plans**: 5 plans

> **Two corrections made during planning, both recorded in `CONTEXT.md`.**
>
> - **The ETag line in the old plan 02-02 is struck.** Phase 1 measured a `304`
>   consuming quota and found the reason in GitHub's own wording: the exemption
>   applies only to a request made *while correctly authorized*, and AgentDock is
>   unauthenticated. The `etag` column keeps being written (DAT-04 asks for it);
>   nothing is built on top of it until a token exists.
> - **The commit-SHA short circuit saves no GitHub quota**, and no plan may claim
>   it does. Both core calls are issued concurrently before the sha is known.
>   What it saves is up to 200 raw fetches and up to 120 s of wall clock, which
>   is exactly what criterion 4 asks for.
>
> Planning also found the failure criterion 2 exists to prevent already live in
> the code: `persist.ts` delists packages it merely failed to read, so a
> repository over `CAPS.maxFiles` loses the artifacts a cap skipped. Plan 02-02
> fixes it first, alone, with its own regression test.

Plans: 5, in 4 waves. Wave 3 runs 02-03 and 02-04 in parallel — they share no file.
- [x] AGD-02-01-PLAN.md — wave 1 — Tracer: `ingest_job` and `ingest_attempt`, one-statement `FOR UPDATE SKIP LOCKED` claiming, the `started_at` reaper, the in-process loop started from `instrumentation.ts`, an asynchronous submit, and a runnable answer to whether `register()` fires at `next start` without a first request
- [x] AGD-02-02-PLAN.md — wave 2 — The truncation guard that stops a partial read deleting real artifacts, the discovered/new/updated/unchanged/removed breakdown, and the attempt row plus the job's terminal state inside the artifact transaction
- [x] AGD-02-03-PLAN.md — wave 3 — Commit-SHA short circuit with a narrow repository-only write, and a log line whose outcome field is a union rather than a string
- [x] AGD-02-04-PLAN.md — wave 3 — Submit result, job status page with the honest counter breakdown, the found-nothing and partial-read sentences, and the repository page's freshness block
- [x] AGD-02-05-PLAN.md — wave 4 — Retry policy as pure functions, rate-limit exhaustion scheduled and clamped with its attempt refunded, and the preemptive gate that stops claiming before the budget is gone

---

### Phase 3: Detector Pluralism
**Goal**: All five artifact types are discovered, and adding a sixth is a one-file change.
**Depends on**: Phase 2
**Requirements**: DET-02, DET-03, DET-04, DET-05, DET-06, DET-07, DET-09, QUA-03, QUA-05
**Success Criteria** (what must be TRUE):
  1. Plugins are detected even when their manifest is absent, via directory shape
  2. A catalog file produces repository seeds rather than being stored as a package
  3. MCP server declarations, commands, and hooks are each detected and parsed
  4. A malformed artifact is recorded with an explicit parse status and does not fail the rest of the repository
  5. Adding a hypothetical new type requires one detector file and one registration
  6. Every detector runs against frozen fixtures with no network access and no token
**Plans**: 3 plans

> **Two corrections made during planning, both recorded in `CONTEXT.md`.**
>
> - **`RESEARCH.md` is wrong that `parse()` is already isolated.** `pipeline.ts`
>   has exactly one `try`/`catch`, at lines 125 and 287, and it spans the whole
>   repository body. `match()` is unguarded at *two* call sites and `parse()` is
>   unguarded at one; a throw from any of them fails the entire repository.
>   Isolation today is a property of the one detector that catches internally,
>   not of the pipeline. DET-07 therefore ships **first**, alone, with a
>   regression that fails against the current code — not last, after five new
>   JSON-parsing detectors have already landed.
> - **Assumption A3's "≥2 component shapes" threshold was measured, at zero
>   GitHub cost**, against the 3,831 blob entries already frozen in `fixtures/`.
>   A ≥1 rule false-positives on `.github/workflows` in three of the four corpora,
>   on `.claude/` in two, and on a `packages/*/src/commands` source directory. ≥2
>   produces no false positive and no false negative across all four. No live
>   sampling task is spent; calibration belongs to Phase 4's CAP-13, which already
>   mandates a hand-checked false-positive rate against a labeled corpus.
>
> The same measurement found that six detectors want **384 files** from the
> largest frozen corpus against a `CAPS.maxFiles` of 200 — so the largest real
> repository would be permanently truncated, and since Phase 2 a truncated scan
> suppresses delisting and never converges. Plan 03-02 raises the cap to 400 and
> states the cost: raw fetches only, zero GitHub core quota.
>
> `RESEARCH.md`'s eleven hand-written fixture directories are not built. The four
> corpora already on disk carry a `marketplace.json` each, 92 plugin manifests,
> 117 commands, 3 hook configs, an `.mcp.json`, and a real
> `plugins/*/skills/*/SKILL.md` monorepo.

Plans: 3, in 3 waves. Sequential — every plan appends to `src/detect/index.ts`,
and each wave's tests need the detectors the previous wave registered.
- [x] AGD-03-01-PLAN.md — wave 1 — Isolation at all three unguarded call sites with one guarded `match()` pass, the widened `ParseResult` with its seeds and no-row channels, `repo_seed` and the five artifact types, and the catalog as the tracer that exercises every new mechanism end to end
- [x] AGD-03-02-PLAN.md — wave 2 — Plugin detection with and without a manifest behind a measured threshold and two exclusions, both MCP declaration shapes with no environment value ever stored, the containment pass that names no artifact type, and the file cap raised to what six detectors actually ask for
- [x] AGD-03-03-PLAN.md — wave 3 — Command detection reusing the existing frontmatter parser unmodified, hook detection with a `settings.json`-without-hooks producing no row at all, and DET-09 turned from a review note into a runtime assertion by a seventh detector defined inside a test

---

### Phase 4: Capability Disclosure
**Goal**: A detail page tells a developer what an artifact will do to their machine, with a source line for every claim — and never tells them it is safe.
**Depends on**: Phase 3
**Requirements**: CAP-01 … CAP-14, QUA-03, QUA-05
**Success Criteria** (what must be TRUE):
  1. A detail page lists the artifact's files with size, type, and executable bit
  2. Declared capabilities, bundled scripts, outbound URLs, and install/remote-execution directives are each surfaced as observed facts
  3. A skill containing invisible Unicode is flagged, and that content is rendered with visible sentinels rather than stripped
  4. Every finding links to the exact file and line at the pinned commit
  5. A permanently visible section states what AgentDock does not check
  6. No page displays a risk score, grade, or the words *safe*, *clean*, *verified*, *trusted*, or *approved* as a verdict
  7. An artifact with no findings reads as "not detected", not as an assurance
  8. Each shipped detector has a recorded, hand-checked false-positive rate against a labeled corpus
  9. A hostile input cannot cause analyzer runtime to blow up
**Plans**: 4 plans

> Needs its own research spike during planning. The hard question is classification, not
> extraction: what counts as "network access" inside a shell-tool grant, and what
> false-positive rate injection-shaped detection produces on real artifacts. Any detector
> exceeding a 20% false-positive rate on twenty hand-checked hits is deleted rather than
> tuned — a noisy detector trains users to dismiss the entire panel.

Plans:
- [ ] 04-01: Labeled fixture corpus and the file inventory
- [ ] 04-02: The six MVP detectors with bounded patterns and input caps
- [ ] 04-03: Hidden-content detection with visible sentinels and raw-byte retention
- [ ] 04-04: Disclosure panel UI, source-line permalinks, the "not checked" block, and the vocabulary lint that fails CI on judgment words

---

### Phase 5: Corpus & Cold Start
**Goal**: The index holds enough real artifacts to be worth searching, acquired without a crawler.
**Depends on**: Phase 4
**Requirements**: COR-01 … COR-07, DAT-07
**Success Criteria** (what must be TRUE):
  1. The public MCP registry is synced without consuming any GitHub quota
  2. An operator seed list bulk-populates the index unattended
  3. Catalog files fan out into further repository seeds
  4. Topic-based repository search is sharded so the result cap does not silently truncate coverage
  5. At least 500 parsed artifacts exist
  6. Forks and duplicates do not flood listings, and suppression happens at read time without altering stored data
  7. A submitted repository below the visibility floor is reachable by direct link but absent from listings
**Plans**: 3 plans

Plans:
- [ ] 05-01: MCP registry sync with incremental updates
- [ ] 05-02: Seed list, catalog fan-out, and curated-link expansion
- [ ] 05-03: Sharded topic search, fork filtering, content-hash dedup, and the visibility gate

---

### Phase 6: Search & Browse
**Goal**: A developer describing what they need finds the right artifact.
**Depends on**: Phase 5
**Requirements**: DIS-03, DIS-04, DIS-05, DIS-06, DIS-07, DIS-08, DIS-10
**Success Criteria** (what must be TRUE):
  1. A plain-language query returns relevance-ranked results
  2. A misspelled query still finds the right artifact
  3. Results filter by artifact type and by declared capability, including "no scripts, no network, no shell"
  4. A zero-result query offers a useful next step
  5. Every query and its result count is logged
  6. Search runs entirely on PostgreSQL with no external service
**Plans**: 3 plans

Plans:
- [ ] 06-01: Generated search vector with weighted fields and GIN index
- [ ] 06-02: Query pipeline with safe query parsing, ranking, and trigram fallback
- [ ] 06-03: Facets, zero-result experience, and query logging

---

### Phase 7: Derived Compatibility
**Goal**: Compatibility is computed from the artifact's own files, not taken from the author's word.
**Depends on**: Phase 6
**Requirements**: CMP-01, CMP-02, CMP-03, CMP-04, CMP-05
**Success Criteria** (what must be TRUE):
  1. Spec conformance is computed from the frontmatter field set
  2. An artifact using runtime-specific fields is shown as locked to that runtime, with the field named
  3. Runtime support comes from a versioned data table that can be updated without code changes
  4. Compatibility renders as derived / declared / unknown, with unknown shown rather than hidden
  5. The author's free-text compatibility claim appears separately, labeled as an author claim, and drives no filter
  6. Compatibility is never implied across artifact types
**Plans**: 2 plans

Plans:
- [ ] 07-01: Versioned runtime capability data table, sourced from current vendor docs
- [ ] 07-02: Conformance computation and compatibility presentation

---

### Phase 8: Freshness
**Goal**: The index reports how current it is, and stops presenting stale analysis as fact.
**Depends on**: Phase 7
**Requirements**: PRV-04
**Success Criteria** (what must be TRUE):
  1. Repository metadata refreshes in batches without exhausting the rate limit
  2. Unchanged repositories cost nothing to re-check
  3. A page shows when AgentDock last looked, and visibly degrades that claim as it ages
  4. Repositories that disappear or are archived upstream are flagged rather than silently retained
  5. A denylisted repository is not re-added by a subsequent crawl
**Plans**: 2 plans

Plans:
- [ ] 08-01: Batched metadata refresh with conditional requests and scheduled re-ingest
- [ ] 08-02: Staleness surfacing, archived/removed handling, and denylist enforcement at crawl time

---

## Requirement Coverage

All 103 v1 requirements map to a phase. See the traceability table in `REQUIREMENTS.md`.

| Phase | Requirement groups |
|-------|--------------------|
| 0 | FND (isolation subset) |
| 1 | FND, ING, DAT, DET (skills), REN, DIS (browse), PRV, INS, QUA |
| 2 | JOB, ING (resilience), QUA |
| 3 | DET (pluralism) |
| 4 | CAP |
| 5 | COR, DAT-07 |
| 6 | DIS (search) |
| 7 | CMP |
| 8 | PRV-04 |

## Deferred to v2

Freshness automation with capability diffing, public read API, read-only CLI, collections,
accounts, watch/notify, publisher claiming, and semantic search. Each is recorded in
`REQUIREMENTS.md` with the trigger that would justify building it.

---
*Roadmap created: 2026-08-10*
*Derived from: `.planning/research/SUMMARY.md`*
