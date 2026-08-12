import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { cache } from 'react';
import { db } from '@/db/client';
import { packageTable, packageVersion, repository } from '@/db/schema';
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
} as const;

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
 */
function searchWhere(q: string) {
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
 * Ranked full-text search over the listing-visible corpus, browsable with
 * no query at all (D-17/D-18). The generated `search_vector` column cannot
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
    limit = SEARCH_CAPS.pageSize,
    offset = 0,
  }: {
    q: string;
    limit?: number;
    offset?: number;
  }): Promise<SearchResultItem[]> => {
    // Drizzle does not emit a SQL-level `AS` alias for a computed sql<T>
    // projection field (confirmed against this pinned version's raw query
    // output), so ORDER BY cannot refer to a "rank" output-column name.
    // Reusing this one fragment object in both SELECT and ORDER BY keeps a
    // single rank definition instead of a second, hand-copied one.
    const rank = rankExpr(q);

    return (
      db
        .select({
          id: packageTable.id,
          name: packageTable.name,
          summary: packageTable.summary,
          type: packageTable.type,
          sourcePath: packageTable.sourcePath,
          fullName: repository.fullName,
          stars: repository.stars,
          scannedAt: repository.scannedAt,
          // Correlated subquery rather than a lateral join — one scalar per
          // row, no per-row query, the same idiom listPackages already uses.
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
        .where(searchWhere(q))
        // D-15/D-16's deterministic total order: rank, then recency, then id.
        // On the browse branch rank is a constant 0 for every row, so this
        // reduces to updated_at DESC, id ASC — matching listPackages' own
        // order (packages.ts:211) with the id tie-break D-15 adds.
        .orderBy(desc(rank), desc(packageTable.updatedAt), packageTable.id)
        .limit(limit)
        .offset(offset)
    );
  },
);

/**
 * How many rows searchPackages' WHERE matches for the same `q`, for the
 * paginator's total. Built from the identical searchWhere() helper — never
 * a second, hand-copied predicate — following countPackages' own shape
 * (packages.ts:226-238), including its innerJoin(repository).
 *
 * This is a second statement, not a second round trip folded into the
 * first: the count and the rows can disagree under a concurrent ingest
 * between the two SELECTs, and that is the paginator's existing "There is
 * no page N" branch's job to absorb, not this function's.
 */
export const countSearchResults = cache(async ({ q }: { q: string }): Promise<number> => {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(packageTable)
    .innerJoin(repository, eq(packageTable.repositoryId, repository.id))
    .where(searchWhere(q));
  return row?.n ?? 0;
});
