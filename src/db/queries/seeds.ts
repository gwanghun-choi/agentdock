import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { ingestJob, repoSeed, repositoryDenylist } from '@/db/schema';

export type SeedRow = {
  /** Lowercased owner/repo. The upsert below refuses to be the place that forgets. */
  fullName: string;
  sourceKind: string;
  discoveredFrom: string;
  discoveredPath: string;
  hint: Record<string, unknown>;
};

/**
 * Writes seeds a corpus source produced, refreshing the ones already known.
 *
 * ponytail: src/ingest/persist.ts:277-297 holds a second copy of this conflict
 * clause, inside the ingest transaction, where it belongs — extracting a shared
 * one means editing the artifact transaction, the single riskiest path in the
 * project. Merge them when a third caller appears, or when that transaction is
 * being changed for another reason anyway.
 *
 * Rows are deduplicated by full_name first, because the registry lists one
 * server once per published version and they frequently name one repository.
 * Postgres refuses to let ON CONFLICT DO UPDATE touch the same row twice in one
 * statement, so without this a normal page is a runtime error rather than an
 * upsert.
 */
export async function upsertSeeds(seeds: SeedRow[]): Promise<number> {
  const byName = new Map<string, SeedRow>();
  for (const seed of seeds) byName.set(seed.fullName.toLowerCase(), { ...seed });
  const rows = [...byName.values()].map((seed) => ({
    ...seed,
    fullName: seed.fullName.toLowerCase(),
  }));
  if (rows.length === 0) return 0;

  await db
    .insert(repoSeed)
    .values(rows)
    .onConflictDoUpdate({
      target: repoSeed.fullName,
      set: {
        sourceKind: sql`excluded.source_kind`,
        discoveredFrom: sql`excluded.discovered_from`,
        discoveredPath: sql`excluded.discovered_path`,
        hint: sql`excluded.hint`,
        updatedAt: sql`now()`,
      },
    });

  return rows.length;
}

/**
 * Seeds no ingest job has ever been created for, and that the denylist does not
 * cover.
 *
 * `j.target = s.full_name` is a plain equality rather than a lower() join for
 * one reason: repo_seed.full_name is lowercased at write (schema.ts:284) and
 * enqueueJob lowercases ingest_job.target at write (jobs.ts). Both sides are
 * therefore the same representation of one identity. Reverting either makes this
 * join silently under-match — it will not error, it will just re-offer every
 * mixed-case repository forever.
 *
 * The join is on ANY job row, terminal ones included. A seed whose job failed
 * permanently must not be re-offered: retry belongs to scheduleRetry, and a
 * fan-out that re-offered failures would loop on them at two core requests each.
 *
 * The denylist anti-join is not optional. enqueueJob writes no ingest_job row
 * for a denylisted repository, so without it a denylisted seed is re-offered on
 * every run forever and the pending count never converges.
 *
 * The (created_at, id) order pair is load-bearing, not decoration: a bulk insert
 * stamps one created_at across every row it writes, so created_at alone leaves
 * fan-out order undefined within a batch. id is a bigserial assigned in insert
 * order, so the pair reproduces the source's own ordering exactly.
 *
 * `only` narrows the offer to a caller-supplied set of full names, and it is not
 * a convenience. The order above is global ARRIVAL order, so a source that wrote
 * in bulk first sits permanently ahead of every source that writes later.
 * Measured on the dev schema on 2026-08-11: 7,971 registry seeds preceded all
 * fifteen operator seed rows, putting the densest repository in the seed list 319
 * capped invocations and ~15,900 core requests — eleven days of unauthenticated
 * budget — behind the front of the queue. Ordering WITHIN a set is what the seed
 * list's measured density order buys; ordering across the whole table is arrival
 * order and nothing else. Omit the argument and this is the global FIFO it has
 * always been.
 *
 * Deliberately a set of names rather than a discovered_from value. Provenance is
 * single-valued and last-writer-wins, so a repository named by two sources
 * carries only the later one: measured in the same run, expanding the curated
 * link lists re-tagged 253 registry seeds and 4 of the 15 operator seeds, which
 * would have dropped those four out of a provenance-scoped operator fan-out. A
 * source knows which names it just produced; it cannot rely on the column still
 * agreeing.
 *
 * ponytail: unindexed on ingest_job.target — a sequential scan at tens of
 * thousands of job rows. The upgrade is one additive
 * CREATE INDEX ON ingest_job (target). Not built: this is a manual operation
 * over hundreds of rows today.
 */
export async function unenqueuedSeeds(limit: number, only?: string[]): Promise<string[]> {
  const rows = await db
    .select({ fullName: repoSeed.fullName })
    .from(repoSeed)
    .leftJoin(ingestJob, eq(ingestJob.target, repoSeed.fullName))
    .leftJoin(repositoryDenylist, eq(repositoryDenylist.fullName, repoSeed.fullName))
    .where(and(isNull(ingestJob.id), isNull(repositoryDenylist.fullName), nameScope(only)))
    .orderBy(asc(repoSeed.createdAt), asc(repoSeed.id))
    .limit(limit);
  return rows.map((r) => r.fullName);
}

/** An empty set is not "every seed" — it is "no seed", and must select nothing
 * rather than silently widening to the whole table. */
function nameScope(only: string[] | undefined) {
  if (only === undefined) return undefined;
  if (only.length === 0) return sql`false`;
  return inArray(repoSeed.fullName, only);
}

/** The residual every run prints, so a cap that stopped early is a number a
 * maintainer reads rather than a silence they have to notice. */
export async function countUnenqueuedSeeds(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(repoSeed)
    .leftJoin(ingestJob, eq(ingestJob.target, repoSeed.fullName))
    .leftJoin(repositoryDenylist, eq(repositoryDenylist.fullName, repoSeed.fullName))
    .where(and(isNull(ingestJob.id), isNull(repositoryDenylist.fullName)));
  return row?.n ?? 0;
}

/**
 * The newest registry timestamp AgentDock has STORED for a source.
 *
 * This is a read model — how fresh the stored rows are — and it is deliberately
 * NOT what the registry sweep filters by. Using it as the incremental watermark
 * was the plan's original design and it is unsafe: the registry orders by server
 * name and treats `updated_since` as a filter over the whole name space, so a
 * page-capped sweep stores a prefix of the names, and a watermark taken from that
 * prefix hides every later name whose last update predates it, permanently. The
 * sweep's own watermark lives in src/db/queries/syncState.ts and advances only
 * when a pass reaches the end of the names.
 *
 * Cast to timestamptz rather than compared as text: sub-second precision varies
 * between rows, and ".8Z" sorts after ".85Z" lexicographically. Every stored
 * value is a normalized ISO string, so the cast cannot fail.
 */
export async function newestRegistryUpdatedAt(
  discoveredFrom = 'mcp-registry',
): Promise<string | null> {
  const [row] = await db
    .select({
      newest: sql<Date | null>`max((${repoSeed.hint}->>'registryUpdatedAt')::timestamptz)`,
    })
    .from(repoSeed)
    .where(eq(repoSeed.discoveredFrom, discoveredFrom));
  return row?.newest ? new Date(row.newest).toISOString() : null;
}
