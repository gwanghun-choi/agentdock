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
  /** D-12's repository-name signal, kept strictly below `ts_rank`'s practical
   * ceiling so it can never outrank a text match. */
  repoNameBonus: 0.1,
  /** Above any achievable `ts_rank`, so D-12's first signal (exact name
   * match) cannot be outranked by any amount of description relevance. */
  exactNameBonus: 2.0,
  /** Between the two, so D-12's second signal (name prefix) cannot be
   * outranked by its third (description relevance). */
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
 * Ranked full-text search over the listing-visible corpus, extended with a
 * repository-name match: the generated `search_vector` column cannot carry
 * `repository.full_name` (Postgres refuses a subquery in a column
 * generation expression, RESEARCH verified live), so a query naming only a
 * repository is matched here instead, via an escaped `ILIKE` — sixteen
 * repositories, no index needed.
 *
 * A malformed query is not an error on this path — `websearch_to_tsquery`
 * never threw on any of RESEARCH's thirteen adversarial inputs, so it is a
 * zero-result search, not a failure (D-42). The only internal errors
 * reachable from this function are connection-level ones, already handled
 * by the server component boundary every other database-backed page uses.
 *
 * Shares NOT_LISTED_BECAUSE with packages.ts's listPackages — the identical
 * fragment object, referenced in both SELECT and WHERE, never restated.
 * Computing it in SELECT only measured a 31x slowdown at a late page offset
 * (1,259ms vs 37ms); see packages.ts:203-208's own warning.
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
    const qEsc = escapeLikeOperand(q);

    // Drizzle does not emit a SQL-level `AS` alias for a computed sql<T>
    // projection field (confirmed against this pinned version's raw query
    // output), so ORDER BY cannot refer to a "rank" output-column name.
    // Reusing this one fragment object in both SELECT and ORDER BY keeps a
    // single ts_rank() definition instead of a second, hand-copied one.
    const rank = sql<number>`ts_rank(${packageTable.searchVector}, websearch_to_tsquery('english', ${q}))`;

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
        .where(
          and(
            isNull(packageTable.delistedAt),
            sql`(${packageTable.searchVector} @@ websearch_to_tsquery('english', ${q})
               OR ${repository.fullName} ilike ${`%${qEsc}%`})`,
            // The same fragment object as the projection above — see
            // packages.ts:203-208 for why referencing it twice is safe and
            // computing it in SELECT only is a measured performance trap.
            sql`${NOT_LISTED_BECAUSE} is null`,
          ),
        )
        // D-15's deterministic tie-break: rank, then recency, then id. Without
        // a total order, repeating the query reshuffles equal-ranked rows.
        .orderBy(desc(rank), desc(packageTable.updatedAt), packageTable.id)
        .limit(limit)
        .offset(offset)
    );
  },
);
