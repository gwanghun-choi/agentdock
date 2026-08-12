import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { cache } from 'react';
import { SCRIPT_EXTENSIONS } from '@/analyze/files';
import { db } from '@/db/client';
import { capabilityFinding, packageTable, packageVersion, repository } from '@/db/schema';
import { NOT_LISTED_BECAUSE, type PackageListItem } from './packages';

export type SearchResultItem = PackageListItem & { rank: number };

/**
 * Every number here carries the reason it has that value, following the
 * `CAPS` (src/github/scan.ts) / `ANALYZE_CAPS` (src/analyze/types.ts)
 * convention: the caps sit beside the code they bound, not in a shared bag.
 */
export const SEARCH_CAPS = {
  /**
   * Cost control, not crash prevention: RESEARCH measured a 5,000-character
   * query as harmless to `websearch_to_tsquery` (one word gets ignored).
   * Measured in JavaScript string length, i.e. UTF-16 code units — an emoji
   * outside the Basic Multilingual Plane counts as two.
   */
  maxQueryLength: 200,
  /** The existing PAGE_SIZE in skills/page.tsx, moved here so the route, the
   * query and the paginator read one number. */
  pageSize: 25,
  /** The existing bound in skills/page.tsx's pageParam, unchanged. */
  maxPage: 10_000,
  /** D-12's fourth signal, repository name match, kept strictly below
   * `ts_rank`'s practical ceiling (~0.6 for a single-term hit) so it can
   * never outrank a real text match. */
  repoNameBonus: 0.1,
  /** D-12's first signal, exact name match. Above any achievable `ts_rank`,
   * so it cannot be outranked by any amount of description relevance. */
  exactNameBonus: 2.0,
  /** D-12's second signal, name prefix. Between the two above, so it cannot
   * be outranked by the third (description relevance). */
  prefixNameBonus: 1.0,
  /**
   * D-02/D-03 decision 3's threshold branch (06-04 plan): ship the
   * index-usable `<%` operator, which reads the session GUC
   * `pg_trgm.word_similarity_threshold` (default 0.6) rather than this
   * constant, UNLESS measuring the three maintainer-named examples
   * (`playwrit`, `postgress`, `mcp-sever`) shows one below it — in which
   * case an explicit `word_similarity(...) >= fuzzyThreshold` predicate
   * ships instead and the index is not used by it.
   *
   * BLOCKED — not measured: `pg_trgm` is not installed in this environment
   * (`select extname from pg_extension` returns `plpgsql` only, re-verified
   * live during this plan — see 06-04-SUMMARY.md), so
   * `word_similarity('playwrit', ...)`, `word_similarity('postgress', ...)`
   * and `word_similarity('mcp-sever', ...)` could not be run against the
   * live corpus. This constant carries pg_trgm's own unmeasured default
   * rather than a guessed number, and the code ships the `<%` operator
   * unchanged because that is the decision's default branch — not because
   * the three examples were confirmed to clear it. Re-run this measurement
   * once the extension is installed (Task 2's checkpoint) and replace this
   * comment with the three real values before treating DIS-04 as verified.
   */
  fuzzyThreshold: 0.6,
} as const;

/**
 * The five listable artifact type ids, closed so a route can validate a
 * `?type=` value against it (D-26) rather than passing an unmatchable string
 * into `IN (...)`, which returns an empty page indistinguishable from a real
 * zero-result search.
 *
 * `catalog` is deliberately absent: RESEARCH traced the pipeline and found a
 * successfully parsed catalog writes zero package rows (it routes to the seed
 * channel instead), so a `type = 'catalog'` row exists only when the catalog
 * failed to parse — and NOT_LISTED_BECAUSE's `parse_status = 'failed'` branch
 * already excludes that row from every listing, with no code in this file.
 * Offering a filter that always returns nothing would be a control that
 * lies, so the id is not in this array (decision 6/7, 06-03 plan).
 */
export const ARTIFACT_TYPE_IDS = ['skill', 'plugin', 'mcp_server', 'command', 'hook'] as const;

/**
 * The three "no X" capability filters DIS-06 names. Absence tests only —
 * "has network access" is deliberately not offered as a filter, because the
 * detectors behind it have known misses (install recall 0/6 on real `npm
 * ci`, network_request 15% FP with zero new hits on a doubled corpus): a
 * presence filter over that would present a measurement gap as a property of
 * the artifact, and an absence filter only ever claims what AgentDock itself
 * observed (decision 2, 06-03 plan).
 */
export const CAPABILITY_FILTER_IDS = ['no_network', 'no_shell', 'no_scripts'] as const;

export type SearchFilters = {
  types: string[];
  capabilities: string[];
};

const NO_FILTERS: SearchFilters = { types: [], capabilities: [] };

/**
 * Drops anything outside the closed id set rather than letting it reach a SQL
 * `IN (...)`/`NOT EXISTS`. An unmatchable value silently returning an empty
 * page is a worse failure than being ignored, because it looks exactly like
 * a real zero-result search and nobody reports it.
 */
function validTypes(types: string[]): (typeof ARTIFACT_TYPE_IDS)[number][] {
  const allowed = new Set<string>(ARTIFACT_TYPE_IDS);
  return types.filter((t): t is (typeof ARTIFACT_TYPE_IDS)[number] => allowed.has(t));
}

function validCapabilities(capabilities: string[]): (typeof CAPABILITY_FILTER_IDS)[number][] {
  const allowed = new Set<string>(CAPABILITY_FILTER_IDS);
  return capabilities.filter((c): c is (typeof CAPABILITY_FILTER_IDS)[number] => allowed.has(c));
}

/**
 * Escapes the two LIKE/ILIKE metacharacters before either LIKE operand is
 * built: `replace(replace(input,'%','\%'),'_','\_')`, the form RESEARCH
 * verified live. Not optional — an unescaped `%` or `_` in a query turns a
 * containment test into a match-everything (or match-almost-everything)
 * test. The failure mode of skipping this is not an error; it is a silently
 * correct-looking result set that is far larger than it should be.
 */
function escapeLikeOperand(input: string): string {
  return input.split('%').join('\\%').split('_').join('\\_');
}

/**
 * The most recent package_version id for one package row, correlated on
 * packageTable.id from the enclosing query — the same idiom packages.ts uses
 * twice for its own "latest version" scalar lookups (packages.ts:33-39,
 * 188-194), not a joined-per-row alternative: RESEARCH measured 1,152 ms for
 * a comparable per-candidate joined shape against 25.5 ms for this one.
 *
 * "Latest" is by ingested_at, matching listPackages' own definition, so the
 * capability filter and the artifact's own detail page always judge the same
 * version (decision 4, 06-03 plan).
 */
const LATEST_PACKAGE_VERSION_ID = sql`(
  select z.id from ${packageVersion} z
  where z.package_id = ${packageTable.id}
  order by z.ingested_at desc limit 1
)`;

/**
 * One `capability_finding` absence test on the latest version, shared by
 * `no_network` and `no_shell` — the only difference between the two is which
 * category (and, for `no_shell`, which signal prefix) is being asked about.
 */
function capabilityAbsence(category: string, signalPrefix?: string) {
  return sql`not exists (
    select 1 from ${capabilityFinding} cf
    where cf.package_version_id = ${LATEST_PACKAGE_VERSION_ID}
      and cf.category = ${category}
      ${signalPrefix ? sql`and cf.signal ilike ${`${signalPrefix}%`}` : sql``}
  )`;
}

/**
 * Built from SCRIPT_EXTENSIONS (src/analyze/files.ts), never retyped —
 * retyping the seven extensions here would let this filter and the detail
 * page's own "not analyzed" marker drift into disagreeing about what a
 * script is, invisibly, until someone compared two pages.
 */
const SCRIPT_PATH_PATTERN = `\\.(${SCRIPT_EXTENSIONS.map((ext) => ext.slice(1)).join('|')})$`;

/**
 * The three filter predicates, each built once and referenced by id — never
 * a second, hand-copied `NOT EXISTS`. `no_scripts` reads `package.files`
 * directly and needs no version join at all: `files` lives on `package`, not
 * `package_version` (schema.ts:146-158's own comment), because a version is
 * minted over the manifest's own bytes, so adding a script beside an
 * unchanged manifest mints no version — a version-scoped inventory would be
 * permanently stale about exactly what this filter asks (decision 3, 06-03
 * plan).
 */
const CAPABILITY_PREDICATES = {
  no_network: capabilityAbsence('network_request'),
  no_shell: capabilityAbsence('declared', 'Bash'),
  no_scripts: sql`not exists (
    select 1 from jsonb_array_elements(${packageTable.files}) f
    where (f->>'path') ~ ${SCRIPT_PATH_PATTERN}
  )`,
} satisfies Record<(typeof CAPABILITY_FILTER_IDS)[number], ReturnType<typeof sql>>;

/**
 * The WHERE both query functions below share, built once and called from
 * both — never a second, hand-copied predicate. Two independent copies of
 * this predicate is the bug shape packages.ts:203-208 already warns about,
 * one level up: here the visible symptom would be a paginator whose last
 * page does not exist.
 *
 * On the normalized query being empty, this builds neither the full-text
 * predicate nor the repository-name disjunction — an empty tsquery matches
 * NOTHING via `@@` (verified live), so applying it unconditionally would
 * silently render an empty corpus to every visitor who has not typed
 * anything yet. Browsing the corpus needs no text predicate at all.
 *
 * The type and capability conjuncts land in this same builder, not beside
 * it (decision 1, 06-03 plan): the rows query and the count query must
 * filter by the identical expression, or the paginator's last page silently
 * stops existing — Phase 5 already paid for that lesson once with
 * countPackages' missing join. All three capability exclusions and the type
 * predicate are conjuncts of this one statement, so PostgreSQL's READ
 * COMMITTED statement-level snapshot makes them consistent with each other
 * by construction (decision 5, 06-03 plan): a concurrent ingest cannot
 * commit between the network test and the scripts test.
 */
function searchWhere(q: string, filters: SearchFilters = NO_FILTERS) {
  const types = validTypes(filters.types);
  const capabilities = validCapabilities(filters.capabilities);
  return and(
    isNull(packageTable.delistedAt),
    q === ''
      ? undefined
      : sql`(${packageTable.searchVector} @@ websearch_to_tsquery('english', ${q})
             OR ${repository.fullName} ilike ${`%${escapeLikeOperand(q)}%`})`,
    // The same fragment object as searchPackages' projection — see
    // packages.ts:203-208 for why referencing it twice is safe and
    // computing it in SELECT only is a measured performance trap.
    sql`${NOT_LISTED_BECAUSE} is null`,
    types.length > 0 ? inArray(packageTable.type, types) : undefined,
    ...capabilities.map((id) => CAPABILITY_PREDICATES[id]),
  );
}

/**
 * D-12's four ranking signals, each its own summed term so a reader can put
 * every line in one-to-one correspondence with D-12's stated order:
 *
 *   1. exact name match       — SEARCH_CAPS.exactNameBonus
 *   2. name prefix/similarity — SEARCH_CAPS.prefixNameBonus
 *   3. description/text relevance — ts_rank over the weighted search_vector
 *   4. repository name match  — SEARCH_CAPS.repoNameBonus
 *
 * Nothing here is a quality or safety proxy (D-13): stars, capability
 * findings and parse_status never appear. On the empty query this returns
 * the literal `0` — every row ties, so the browse branch's ORDER BY reduces
 * to its own recency/id tie-break with no separate ordering logic needed.
 */
function rankExpr(q: string) {
  if (q === '') return sql<number>`0::real`;
  const qEsc = escapeLikeOperand(q);
  return sql<number>`
      case when lower(${packageTable.name}) = lower(${q})
        then ${SEARCH_CAPS.exactNameBonus}::real else 0::real end
    + case when lower(${packageTable.name}) like lower(${qEsc}) || '%'
        then ${SEARCH_CAPS.prefixNameBonus}::real else 0::real end
    + ts_rank(${packageTable.searchVector}, websearch_to_tsquery('english', ${q}))
    + case when ${repository.fullName} ilike '%' || ${qEsc} || '%'
        then ${SEARCH_CAPS.repoNameBonus}::real else 0::real end
  `;
}

/**
 * The trigram index's own expression, character for character:
 * `name || ' ' || coalesce(summary, '')`, matching
 * `package_fuzzy_trgm_idx`'s definition in schema.ts exactly. A predicate
 * that differs by a space or a `coalesce` cannot use that index, and the
 * symptom is a plan, not an error — so this fragment is the ONE place the
 * expression is written, referenced by both the predicate and the ORDER BY
 * below rather than retyped.
 */
function fuzzyMatchExpr() {
  return sql`(${packageTable.name} || ' ' || coalesce(${packageTable.summary}, ''))`;
}

/**
 * Postgres's standard undefined-function/undefined-operator SQLSTATE — what
 * `word_similarity(...)` and `<%` both raise when `pg_trgm` is absent.
 * Named once so the digits appear exactly one place in this file rather
 * than being retyped at each comparison; grep for this identifier, not the
 * literal code, to find every place the runtime absence handler checks it.
 * Genuinely exercised live in this environment (not simulated): with the
 * extension absent, both `select 'a' <% 'ab'` and
 * `select word_similarity(...)` raise this code against the real database
 * behind `DATABASE_URL` — RESEARCH's assumption A1, upgraded from
 * "backstop, not executed" to verified (06-04-SUMMARY.md).
 */
const PG_UNDEFINED_FUNCTION = '42883';

/**
 * D-02's fallback branch: `pg_trgm`, called from `searchPackages` below only
 * when the full-text branch already ran and returned zero rows for a
 * non-empty query — never unioned with the full-text results and never
 * blended into `ts_rank` (decision 4, 06-04 plan). This is a second,
 * separate statement, paid for only on the empty-result path (T-06-28).
 *
 * Reaches suppression, the type filter and the capability filters by
 * calling `searchWhere('', filters)` — the same shared builder the
 * full-text branch uses, with the text predicate omitted by passing `''`
 * (browse mode), so this branch inherits every conjunct except the text
 * predicate and adds its own trigram one instead. A second, hand-written
 * `WHERE` here is how a typo query starts returning forks (T-06-27).
 *
 * Uses `word_similarity`, not `similarity`: an eight-character query against
 * a two-hundred-character name+summary concatenation scores near zero on
 * whole-string `similarity` no matter how exactly the word appears inside
 * it — `word_similarity` scores the best matching word extent instead,
 * which is index-accelerated by the same `gin_trgm_ops` class
 * (decision 2, 06-04 plan).
 *
 * The `PG_UNDEFINED_FUNCTION` catch below is the query-time backstop for a
 * missing `pg_trgm` at runtime (see that constant's own doc for what was
 * verified live). It wraps ONLY this call — the full-text call in
 * `searchPackages` below has no such dependency, and a broad catch there
 * would swallow the connection-level failures D-42 wants kept distinct from
 * user-query ones.
 */
async function fuzzySearch(
  q: string,
  filters: SearchFilters,
  limit: number,
  offset: number,
): Promise<SearchResultItem[]> {
  const matchExpr = fuzzyMatchExpr();
  // Reused in both SELECT and ORDER BY, same reason rankExpr's `rank` is
  // (Drizzle emits no SQL-level alias for a computed sql<T> projection).
  // Schema-qualified on purpose. src/db/client.ts pins search_path to the one
  // AgentDock schema and assertSchemaIsolation refuses to boot on anything
  // wider (client.test.ts rejects 'agentdock, public' explicitly), so an
  // unqualified pg_trgm function or operator resolves to nothing and raises
  // 42883 — which the catch below would swallow into a permanent, silent
  // "no fuzzy results". pg_trgm lives in `public` — where PostgreSQL puts a
  // trusted extension, and where it was verified to be on the deployment target
  // on 2026-08-12 — so both the function and the `<%` operator name it. A
  // deployment that installed it elsewhere changes these three references and
  // the index in schema.ts together, or none of them: a predicate that differs
  // from the index expression by a qualifier cannot use it, and the symptom is
  // a plan, not an error. The index in schema.ts uses public.gin_trgm_ops and
  // still accelerates OPERATOR(public.<%).
  const similarity = sql<number>`public.word_similarity(${q}, ${matchExpr})`;

  try {
    return await db
      .select({
        id: packageTable.id,
        name: packageTable.name,
        summary: packageTable.summary,
        type: packageTable.type,
        sourcePath: packageTable.sourcePath,
        fullName: repository.fullName,
        stars: repository.stars,
        scannedAt: repository.scannedAt,
        // Same correlated-subquery idiom as searchPackages' own projection —
        // one scalar per row, never a joined alternative.
        commitSha: sql<string | null>`(
          select pv.commit_sha from ${packageVersion} pv
          where pv.package_id = ${packageTable.id}
          order by pv.ingested_at desc limit 1
        )`,
        notListedBecause: NOT_LISTED_BECAUSE,
        rank: similarity,
      })
      .from(packageTable)
      .innerJoin(repository, eq(packageTable.repositoryId, repository.id))
      .where(and(searchWhere('', filters), sql`${q} OPERATOR(public.<%) ${matchExpr}`))
      // Same two tie-break keys as the full-text branch, so a repeated
      // fuzzy query returns identical ids in identical order (D-15/D-16).
      .orderBy(desc(similarity), desc(packageTable.updatedAt), packageTable.id)
      .limit(limit)
      .offset(offset);
  } catch (err) {
    // drizzle-orm wraps the raw postgres error in its own DrizzleQueryError,
    // with the real PostgresError (carrying `.code`) on `.cause` — verified
    // live in this environment (the one place `pg_trgm` is genuinely
    // absent), where the first shape of this catch missed it and let a
    // zero-result query throw. Checking both is what actually catches it.
    const code =
      (err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code;
    if (code === PG_UNDEFINED_FUNCTION) {
      // The same one-JSON-line-per-marker shape log.ts's own log() writes,
      // written directly rather than through log()'s closed SearchLog/
      // IngestLog/WorkerLog union — this event does not fit any of the
      // three existing shapes and this plan does not touch log.ts.
      console.log(
        JSON.stringify({
          ts: new Date().toISOString(),
          event: 'search-fuzzy-unavailable',
          code,
        }),
      );
      return [];
    }
    throw err;
  }
}

/**
 * Ranked full-text search over the listing-visible corpus, browsable with
 * no query at all (D-17/D-18), narrowable by artifact type and declared
 * capability (DIS-05/DIS-06). The generated `search_vector` column cannot
 * carry `repository.full_name` (Postgres refuses a subquery in a column
 * generation expression, RESEARCH verified live), so a query naming only a
 * repository is matched separately, via an escaped `ILIKE` — sixteen
 * repositories, no index needed.
 *
 * `q` is assumed already normalized (Reference A) — this function branches
 * on it being exactly `''`, the browse signal.
 *
 * A malformed query is not an error on this path — `websearch_to_tsquery`
 * never threw on any of RESEARCH's thirteen adversarial inputs, so it is a
 * zero-result search, not a failure (D-42). The only internal errors
 * reachable from this function are connection-level ones, already handled
 * by the server component boundary every other database-backed page uses.
 */
export const searchPackages = cache(
  async ({
    q,
    filters = NO_FILTERS,
    limit = SEARCH_CAPS.pageSize,
    offset = 0,
  }: {
    q: string;
    filters?: SearchFilters;
    limit?: number;
    offset?: number;
  }): Promise<SearchResultItem[]> => {
    // Drizzle does not emit a SQL-level `AS` alias for a computed sql<T>
    // projection field (confirmed against this pinned version's raw query
    // output), so ORDER BY cannot refer to a "rank" output-column name.
    // Reusing this one fragment object in both SELECT and ORDER BY keeps a
    // single rank definition instead of a second, hand-copied one.
    const rank = rankExpr(q);

    const results = await db
      .select({
        id: packageTable.id,
        name: packageTable.name,
        summary: packageTable.summary,
        type: packageTable.type,
        sourcePath: packageTable.sourcePath,
        fullName: repository.fullName,
        stars: repository.stars,
        scannedAt: repository.scannedAt,
        // Correlated subquery rather than a joined alternative — one
        // scalar per row, no per-row query, the same idiom listPackages
        // already uses.
        commitSha: sql<string | null>`(
          select pv.commit_sha from ${packageVersion} pv
          where pv.package_id = ${packageTable.id}
          order by pv.ingested_at desc limit 1
        )`,
        notListedBecause: NOT_LISTED_BECAUSE,
        rank,
      })
      .from(packageTable)
      .innerJoin(repository, eq(packageTable.repositoryId, repository.id))
      .where(searchWhere(q, filters))
      // D-15/D-16's deterministic total order: rank, then recency, then id.
      // On the browse branch rank is a constant 0 for every row, so this
      // reduces to updated_at DESC, id ASC — matching listPackages' own
      // order (packages.ts:211) with the id tie-break D-15 adds.
      .orderBy(desc(rank), desc(packageTable.updatedAt), packageTable.id)
      .limit(limit)
      .offset(offset);

    // D-02's fallback chain, literally: trigram runs only when full-text
    // already ran and found nothing, for a real (non-empty) query — never a
    // union, never on the browse branch. This is the one call site
    // fuzzySearch has (T-06-28's statement-count assertion is about this
    // branch: a query with full-text results returns here and never reaches
    // fuzzySearch at all).
    if (q !== '' && results.length === 0) {
      return fuzzySearch(q, filters, limit, offset);
    }
    return results;
  },
);

/**
 * How many rows searchPackages' WHERE matches for the same `q`/`filters`,
 * for the paginator's total. Built from the identical searchWhere() helper
 * — never a second, hand-copied predicate — following countPackages' own
 * shape (packages.ts:226-238), including its innerJoin(repository).
 *
 * This is a second statement, not a second round trip folded into the
 * first: the count and the rows can disagree under a concurrent ingest
 * between the two SELECTs, and that is the paginator's existing "There is
 * no page N" branch's job to absorb, not this function's.
 */
export const countSearchResults = cache(
  async ({ q, filters = NO_FILTERS }: { q: string; filters?: SearchFilters }): Promise<number> => {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(packageTable)
      .innerJoin(repository, eq(packageTable.repositoryId, repository.id))
      .where(searchWhere(q, filters));
    return row?.n ?? 0;
  },
);

/**
 * Bounded, case-preserving query normalization (D-09): trim, collapse
 * internal whitespace runs to one space, and truncate at
 * `SEARCH_CAPS.maxQueryLength` UTF-16 code units. Takes the first element
 * when Next.js delivers a repeated `?q=` parameter as an array. Returns ''
 * for undefined, empty or whitespace-only input — '' is the browse signal
 * `searchPackages` branches on.
 *
 * Does not lowercase. The full-text path is already case-insensitive
 * through the tokenizer (D-09/D-11), and every `ILIKE`/`lower()` operand in
 * this module folds its own operands — lowercasing centrally here would
 * only make DIS-08's logged query differ from what the user typed, for no
 * behavioural gain.
 */
export function normalizeQuery(raw: string | string[] | undefined): string {
  const first = Array.isArray(raw) ? raw[0] : raw;
  const collapsed = (first ?? '').trim().replace(/\s+/g, ' ');
  return collapsed.slice(0, SEARCH_CAPS.maxQueryLength);
}
