import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { cache } from 'react';
import { db } from '@/db/client';
import { packageTable, packageVersion, repository } from '@/db/schema';
import { NOT_LISTED_BECAUSE, type PackageListItem } from './packages';

export type SearchResultItem = PackageListItem & { rank: number };

/**
 * Ranked full-text search over the listing-visible corpus.
 *
 * The tracer's scope only: `q` is passed straight into `websearch_to_tsquery`,
 * which RESEARCH proved never throws on any of thirteen adversarial inputs,
 * so this is safe by construction even before 06-02 adds SEARCH_CAPS. No
 * empty-query branch here — the caller (artifacts/page.tsx) skips this
 * function entirely and calls listPackages() instead when `q` is empty,
 * because an empty tsquery matches nothing via `@@` (verified live).
 *
 * Shares NOT_LISTED_BECAUSE with packages.ts's listPackages — the identical
 * fragment object, referenced in both SELECT and WHERE, never restated.
 * Computing it in SELECT only measured a 31x slowdown at a late page offset
 * (1,259ms vs 37ms); see packages.ts:203-208's own warning.
 */
export const searchPackages = cache(
  async ({
    q,
    limit = 25,
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
            sql`${packageTable.searchVector} @@ websearch_to_tsquery('english', ${q})`,
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
