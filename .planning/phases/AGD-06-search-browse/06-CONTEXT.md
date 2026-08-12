# Phase 6: Search & Browse - Context

**Gathered:** 2026-08-12
**Status:** Ready for planning
**Source:** Maintainer phase brief (58 sections), captured verbatim-in-substance as locked decisions. ROADMAP.md / REQUIREMENTS.md / STATE.md remain source of truth where they conflict — conflicts are recorded explicitly below under "Brief vs GSD conflicts".

<domain>
## Phase Boundary

Make the existing corpus discoverable. A developer must be able to
`discover → narrow → compare → open → inspect` the 921 listed packages
(1,137 held, 16 repositories, six artifact types).

**In scope:** search over existing rows, browse without a query, filters,
stable ordering, pagination, URL-addressable search state, a *generic*
artifact detail route covering all artifact types, query logging, corpus
coverage disclosure.

**Explicitly out of scope:** no new crawler, no new artifact detector, no
change to capability detectors, no ingestion-pipeline refactor, no
provenance schema change, no external search service. Phase 7 (Derived
Compatibility) is not started.

</domain>

<decisions>
## Implementation Decisions

### Search engine — PostgreSQL only
- **D-01:** PostgreSQL is the only search engine. No OpenSearch, Elasticsearch, Meilisearch, Typesense, Redis Search, or vector DB. (DIS-10, and the Phase 0 decision "PostgreSQL does storage, search, and the job queue".)
- **D-02:** Evaluation order for capability: PostgreSQL FTS → `pg_trgm` → GIN/GiST → plain B-tree. Add an index only when a measured query plan and benchmark justify it — never speculatively.
- **D-03:** `pg_trgm` decision is **LOCKED by the maintainer (2026-08-12)**: the maintainer installs the extension out of band as superuser with `CREATE EXTENSION pg_trgm SCHEMA agentdock;`. Measured preconditions: PostgreSQL 16.14, database `mcpdb`, role `agentdock_app`, `pg_trgm` 1.6 available and `trusted=true`, but `has_database_privilege('agentdock_app','mcpdb','CREATE') = false`, so AgentDock itself cannot create it.
- **D-04:** **AgentDock migrations must never execute `CREATE EXTENSION`.** Migrations may only create indexes that *use* `agentdock.gin_trgm_ops`. If the extension is absent at migrate time, fail loudly with an actionable message naming the exact superuser command — do not silently degrade and do not attempt the create.
- **D-05:** Rejected alternatives, recorded: (a) hand-rolled trigram `text[]` generated column + built-in GIN `array_ops` — rejected as ~30 lines of home-grown similarity code AgentDock would own and test forever, when one out-of-band grant removes it; (b) FTS-prefix-only with DIS-04 shipped PARTIAL — rejected because it fails ROADMAP criterion 2 for substitution and transposition typos.

### Search semantics
- **D-06:** Searchable fields, minimum: artifact/package name, description, repository owner/name, source path, artifact type, parsed metadata.
- **D-07:** Capability finding summary/category **may** be a filter (DIS-06 requires it) but **must not** be a strong ranking signal. Rationale: the Phase 4/5 detector ledger — `install` recall 0/6 on real `npm ci`, `network_request` 15% FP with zero new hits on a doubled corpus, `remote_execution` and `hidden_content` at zero live positives across seven corpora. Ranking on those signals would launder measurement gaps into apparent relevance.
- **D-08:** The search UI must not present capability findings as a complete capability inventory.

### Query normalization
- **D-09:** Normalize only: trim, whitespace collapse, case-insensitive matching. `mcp` and `MCP` are the same query.
- **D-10:** No synonym expansion, no AI query rewriting, no `database → postgres|mysql|sqlite` fan-out. Any semantic widening needs explicit evidence and is not in this phase.
- **D-11:** The FTS tokenizer may be used for stemming; that is the only permitted linguistic expansion.

### Ranking
- **D-12:** Ranking must be explainable. Candidate signal order: exact name match → prefix / name similarity → description/text relevance → repository name match → freshness.
- **D-13:** **Prohibited as ranking inputs:** stars, downloads, "official", "trusted", "security", or any quality/safety proxy. This continues Phase 5's decision not to attach a trust score to source provenance. Ranking must not imply safety or endorsement.
- **D-14:** `parse_status = 'partial'` must **not** carry a ranking penalty. Phase 5 established that most of the 353 `partial` rows are valid Claude Code metadata (e.g. `argument-hint`) the current parser spec does not know. `partial` is not failure and is not low quality.

### Stable ordering
- **D-15:** Repeating a query must not reshuffle results. Ties in relevance need a deterministic tie-break — e.g. `relevance DESC, updated_at DESC, package_id ASC`; the exact columns follow the real schema.
- **D-16:** Pagination ordering must be identical to list ordering, so no row is skipped or repeated across pages.

### Browse mode (no query)
- **D-17:** The corpus must be browsable with no query. Browse ordering is defined separately from search ranking — recently indexed / recent upstream update / alphabetical are the candidates. **Never** popularity or star order.
- **D-18:** Empty query must not error and must not trigger an unbounded sequential scan.
- **D-19:** `/skills` is a false name — it already lists six artifact types. Phase 6 renames the browse route to a generic one (`/artifacts` or the project's route convention). Preserve inbound links with a redirect if the route convention supports it.

### Generic artifact detail route — carried Phase 4/5 item, must be resolved
- **D-20:** The detail route must resolve for **every** artifact type, not just `skill`. Today `sourcePathFromUrl` in `src/db/queries/packages.ts:268` hardcodes `SKILL.md`, so 387 commands, 113 plugins, 16 hooks and 15 MCP declarations have rows and findings but no reachable page. A search result the user cannot open does not complete the phase goal.
- **D-21:** Detail identity must be stable, artifact-type independent, safe with slashes in the path, not filesystem path traversal, and must preserve GitHub owner/repo/path normalization. Preserve the current `/r/{owner}/{repo}/{path}` route and existing links where possible; generalize rather than replace.
- **D-22:** Generic detail shows, where available: name, artifact type, description, repository, source path, commit SHA, parse status, updated/indexed timestamps, source permalink, capability disclosure, file inventory. Type-specific metadata goes in its own section. Do not force Skill-shaped UI onto other types.
- **D-23:** Phase 4's source permalinks (commit SHA + source path + line range → immutable GitHub URL) must keep working exactly. Route generalization must not break provenance.
- **D-24:** File inventory (with executable bit, stored in `package.files` since Phase 4) renders only where it is meaningful. Do not render an empty section to fill space.
- **D-25:** Remove Skill-only wording from every Search / Browse / Detail surface.

### Filters
- **D-26:** Artifact type filter is required (DIS-05). Minimum labels: All, Skills, Plugins, MCP Servers, Commands, Hooks. Filter labels are decoupled from internal enum values.
- **D-27:** Declared-capability filter is required (DIS-06), including the "no scripts, no network, no shell" composition.
- **D-28:** Capability filter wording follows the Phase 4 vocabulary invariant: `Observed: package installation`, `Observed: network request`. **Forbidden:** "Has dangerous network access", "Safe", "Risky", or any badge that reads as a verdict.
- **D-29:** Additional candidate filters (repository, parse status, freshness, source) only if research shows they earn their place. Avoid a large filter panel.
- **D-30:** All filtering happens in SQL. Never fetch 921 rows and filter client-side.

### Visibility, suppression, dedup — inherited invariants, do not reimplement
- **D-31:** COR-07 invariant holds for search: global listing suppresses some artifacts; repository detail still reaches them; stored data is never deleted. A suppressed artifact must not reappear in global search, and must stay reachable via direct/repository routes. Lock this with a test.
- **D-32:** Search queries read the existing listing-visible set as source of truth. Do not re-derive dedup in the search layer. Phase 5 settled dedup (27 duplicate groups, 28 suppressed rows) including the shape-only plugin hash-collision case where equal content hash did not mean equal artifact.
- **D-33:** Keep the two query paths distinct and obvious: global search applies listing rules; repository detail reads stored artifacts directly.

### Catalog
- **D-34:** `catalog` has had seed semantics, not package semantics, since Phase 3, and the corpus holds exactly 1. Verify what the schema and code actually do, then decide from ROADMAP/requirements whether it belongs in search results. Do not conflate `repo_seed` with the `catalog` artifact type.

### URL state and SSR
- **D-35:** Query, filters and page live in the URL — e.g. `/artifacts?q=mcp&type=plugin&page=2`. Direct links, refresh and back must all restore state. Search state must not be client-only React state.
- **D-36:** Search results are server-rendered. The results must exist in HTML before client JS runs — this is the Phase 0/1 SSR-for-organic-search decision. Only genuinely interactive controls are client components.

### Pagination
- **D-37:** Choose offset or keyset on the merits at 921 rows and stable ranking; pick the simpler one. No cursor framework. If offset is chosen, measure latency on a late page rather than assuming.

### Zero results and coverage disclosure
- **D-38:** A zero-result query states the fact (`No artifacts matched "..."`) and offers next steps — reset filters, browse all (DIS-07). It must never claim the artifact does not exist; the corpus is not the ecosystem.
- **D-39:** Where useful, disclose corpus scope, e.g. "AgentDock indexes a curated and registry-derived corpus. It is not a complete index of GitHub." Grounded in measured Phase 5 facts: 16 repositories, two of them 69% of artifacts, no GitHub-wide crawl, COR-05 has named unreachable shards.

### Query safety and caps
- **D-40:** User query is untrusted input: parameterized queries only, no raw SQL concatenation, wildcard escaping, FTS parse-error handling, and a length cap. Never pass raw user syntax into `to_tsquery` — use `plainto_tsquery`/`websearch_to_tsquery` or an explicit sanitizer.
- **D-41:** Bound the abnormal case: max query length, max filters, max page, page-size cap. Base the values on measurement or existing project convention.
- **D-42:** DB/search failures must not leak stack traces to the UI. Distinguish user-query errors from internal errors.

### API surface
- **D-43:** Do not add `/api/search` unless the UI actually needs it. Server components read the DB directly today; a REST layer for a hypothetical future CLI is speculative and is not built in this phase.

### Observability
- **D-44:** DIS-08 requires search queries and result counts to be logged from the first search release. Log structured `query`, `filters`, `result_count`, `duration_ms`. The brief raised a privacy concern about storing raw query text — resolve it in research, but DIS-08's "queries ... are logged" is the requirement and wins over the brief's "maybe only duration/count".

### Performance
- **D-45:** Benchmark against the real DB: empty browse, common keyword, rare keyword, exact name, type filter, page 1, a later page. Record the actual numbers. Follow ROADMAP/requirements latency targets if present; otherwise target "feels instant" at this corpus size and record measurements.
- **D-46:** Diagnose slow queries with `EXPLAIN (ANALYZE, BUFFERS)` before adding any index. Phase 5 precedent, remembered explicitly: 1152 ms → wrong index 1101 ms → query-shape fix 25.5 ms.
- **D-47:** No N+1. Attaching repository / type / counts to result rows must not issue a query per row; the detail page must not do it for capability findings or file inventory either. Count the queries.
- **D-48:** No large-scale simulation. Verify the plan has no obvious N+1 or per-row lateral explosion at real corpus size.

### Migrations
- **D-49:** `agentdock` schema only. Never touch `public` or `didim_mcp`. Additive first, no DROP, no REVOKE. Follow generate → review → migrate, and keep `scripts/check-boundaries.mjs` passing.

### Accessibility and responsive
- **D-50:** Minimum a11y: labelled search input, keyboard submit, labelled filter controls, pagination link semantics, visible focus, and real empty/error states. Not a design-system project.
- **D-51:** Stay consistent with current Home/Detail styling; verify search input, filter row and result metadata at narrow widths.

### Result row content
- **D-52:** A result row shows at minimum: artifact name, type, short description, repository, source path / package location, updated/freshness. Avoid heavy card UI. A capability-category count may appear as secondary info but must never read as a risk badge.
- **D-53:** If a result surfaces truncation status, do not overstate it — `artifactsTruncated` currently conflates the file cap, the wall-clock deadline, and a raw fetch that threw.

### Claude's Discretion
- Exact FTS weighting (`setweight` A/B/C/D assignment) and `ts_rank` variant
- Whether the search vector is a generated column or trigger-maintained
- Concrete pagination mechanism given D-37
- Route naming within the project's existing convention
- Filter control presentation (chips, selects, links)
- Log sink and format details within D-44

</decisions>

<specifics>
## Specific Ideas

- The user flow to satisfy end to end is `discover → narrow → compare → open → inspect`, not "a search box exists".
- Live smoke query set the maintainer named: `mcp`, `skill`, `claude`, `playwright`, `github`, plus one exact artifact name, one query with no results, a type filter, a combined filter, and page 2+.
- Typo examples that must work once `pg_trgm` is installed: `playwrit`, `postgress`, `mcp-sever`.
- Browser/headless verification of the real rendered flow (browse → search → filter → open detail → back → paginate) with no console errors. Reuse whatever tooling exists; do not introduce a new E2E framework.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and requirements
- `.planning/ROADMAP.md` § "Phase 6: Search & Browse" — goal, the six success criteria, the 3-plan shape
- `.planning/REQUIREMENTS.md` lines 109–116 — DIS-03, DIS-04, DIS-05, DIS-06, DIS-07, DIS-08, DIS-10
- `.planning/STATE.md` — accumulated decisions, constraints, and the "Carried into Phase 6" table

### Inherited invariants this phase must not break
- `.planning/phases/AGD-04-capability-disclosure/` — capability disclosure vocabulary, source permalink contract, `package.files` inventory
- `.planning/phases/AGD-05-corpus-cold-start/` — COR-07 listing suppression vs repository reachability, dedup semantics, parse-status semantics, corpus coverage measurements
- `.planning/research/ENVIRONMENT.md` — database environment findings, including the remote-instance note

### Existing code that defines the baseline
- `src/db/queries/packages.ts` — `listPackages`, `countPackages`, `getRepositoryPackages`, `getPackageDetail`, `permalink`, `permalinkAtLine`, `sourcePathFromUrl` (line 268, the `SKILL.md` hardcode), `detailHref`
- `src/db/queries/capabilities.ts` — capability finding reads
- `src/db/schema.ts` — `package`, `package_version`, `repository`, `artifact_type`, `capability_finding`, and the existing indexes (`package_live_idx` on `(type, updated_at DESC)`, `repository_full_name_key`, …)
- `src/app/skills/page.tsx` — the misnamed browse route
- `src/app/r/[owner]/[repo]/page.tsx`, `src/app/r/[owner]/[repo]/[...path]/page.tsx` — repository and detail routes
- `scripts/check-boundaries.mjs` — schema/host boundary enforcement that must keep passing

</canonical_refs>

<code_context>
## Existing Code Insights

### Measured baseline (2026-08-12, live DB)
- PostgreSQL **16.14**, database `mcpdb`, role `agentdock_app` (non-superuser, `rolsuper=false`, no database-level CREATE)
- Installed extensions: **`plpgsql` only**. `pg_trgm` 1.6, `unaccent` 1.1, `btree_gin` 1.3, `fuzzystrmatch` 1.2 are all *available* and *trusted*, none installed.
- `english` and `simple` text search configurations are present, so FTS needs no extension.
- Live row counts: `package` 1,137, `repository` 16, `capability_finding` 2,450.
- **No search code exists yet** — no tsvector column, no FTS query, no trigram index, no `/api/search`.

### Reusable Assets
- `listPackages` / `countPackages` in `src/db/queries/packages.ts` already encode listing visibility, suppression and dedup — the search query should extend this predicate set, not restate it.
- `permalink` / `permalinkAtLine` already produce immutable GitHub URLs from `(fullName, commitSha, sourcePath)`; the generic detail route reuses them unchanged.
- `react.cache`-wrapped query functions are the established pattern for server-component reads.
- `getRepositoryPackages` is the direct-access path COR-07 depends on; it must stay bypass-free.

### Established Patterns
- Server components read the DB directly; there is no API layer to imitate.
- Drizzle schema objects are declared via `agentdock.table(...)`, never bare `pgTable` — boundary scanner enforces it.
- Migrations run through `scripts/migrate.mjs`, not `drizzle-kit migrate` (Phase 0 finding).
- `bun run ci` is the gate: boundaries + biome + tsc + vitest.

### Integration Points
- `src/app/skills/page.tsx` → becomes the generic browse route
- `src/app/r/[owner]/[repo]/[...path]/page.tsx` → the detail route to generalize away from `SKILL.md`
- `src/db/queries/packages.ts` → new search query joins here, sharing the listing predicate
- `src/db/schema.ts` + `drizzle/` → any new index or generated column

</code_context>

<deferred>
## Deferred Ideas

Carried items the maintainer explicitly kept **out** of Phase 6 (do not expand into them):

- `artifactsTruncated` conflating file cap / wall clock / raw fetch failure — ingestion refactor, not this phase. Only avoid *amplifying* the wrong meaning if search surfaces truncation.
- `src/db/queries/jobs.test.ts` concurrency flake — only verify Phase 6 does not worsen it; no test-infrastructure refactor.
- `repo_seed.discovered_from` last-writer-wins provenance — if detail shows provenance, do not present one `discovered_from` value as a complete discovery history. No schema change.
- Shape-only plugin live zero-case — do not modify any detector to serve search.
- Semantic/vector search — still gated on logged query evidence, which DIS-08's log begins collecting this phase.
- Per-server (rather than per-file) MCP identity re-key — Phase 4 carried item, needs query-log evidence.
- Any move to the remote `didim_api` instance — open maintainer decision, unchanged by this phase.

</deferred>

<conflicts>
## Brief vs GSD conflicts — GSD documents win

The maintainer's instruction is explicit: "프롬프트 내용과 충돌하면 GSD 문서를 우선한다."

1. **Typo tolerance.** Brief §29 offers deferring fuzzy matching if exact/prefix/FTS suffices. **DIS-04 and ROADMAP criterion 2 require it.** → Trigram fallback ships this phase. Resolved by D-03.
2. **Capability filter.** Brief §6/§15 treats a capability filter as optional and cautions against capability signals. **DIS-06 requires filtering by declared capability including "no scripts, no network, no shell".** → The filter ships; the caution survives as D-07/D-08/D-28 (filter yes, ranking signal no, verdict wording never).
3. **Query logging.** Brief §54 suggests logging only duration and result count if raw queries are sensitive. **DIS-08 requires "search queries and result counts are logged from the first search release".** → Queries are logged; the privacy concern is handled inside D-44, not by dropping the field.

No other conflict found. Everywhere else the brief is stricter than the GSD documents, and the stricter reading is kept.

</conflicts>

---

*Phase: AGD-06-search-browse*
*Context gathered: 2026-08-12*
