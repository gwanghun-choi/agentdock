import { and, inArray, isNull, sql } from 'drizzle-orm';
import { cache } from 'react';
import { z } from 'zod';
import { db } from '@/db/client';
import { packageTable, schemaMeta } from '@/db/schema';
import { log } from '@/log';
import { HIDDEN_UNLESS_ASKED } from './language';
import { countVisibleByType, listPackages, type PackageListItem } from './packages';
import { LAST_SUCCESS_KEY } from './syncState';

/** The ten rows the board has always listed. */
export const HOME_ROWS = 10;

export const SNAPSHOT_KEY = 'home:snapshot';

/**
 * Two scheduled runs a day: four in a row have gone without a usable result. A run
 * that failed can still have stored repositories, so past this the figures have
 * drifted by an unknown amount from the pages they link to, and the home page pays
 * for the live queries rather than keep printing them.
 */
export const SNAPSHOT_MAX_AGE_MS = 48 * 60 * 60 * 1000;

export type HomeData = {
  recent: PackageListItem[];
  /** Listed rows per type in the languages /artifacts shows by default. */
  visible: Record<string, number>;
  /** Listed rows in HIDDEN_UNLESS_ASKED. */
  hidden: number;
  lastSync: Date | null;
};

const snapshotSchema = z.object({
  version: z.literal(1),
  generatedAt: z.coerce.date(),
  // Strict, and the publisher checks its own output with this: a column added to
  // PackageListItem and not here would otherwise vanish from the feed on this path
  // only. It fails the run that publishes it instead.
  recent: z.array(
    z
      .object({
        id: z.number(),
        name: z.string(),
        summary: z.string().nullable(),
        type: z.string(),
        sourcePath: z.string(),
        fullName: z.string(),
        stars: z.number(),
        commitSha: z.string().nullable(),
        scannedAt: z.coerce.date().nullable(),
        notListedBecause: z.enum(['fork', 'duplicate', 'unparsed']).nullable(),
        summaryLanguage: z.string().nullable().optional(),
      })
      .strict(),
  ),
  visible: z.record(z.string(), z.number()),
  hidden: z.number(),
});

/**
 * The queries that used to run on every home request, in one read-only snapshot so
 * the feed and the counts describe one state of the corpus, then one upsert: a
 * reader sees the whole of the previous snapshot or the whole of this one. The rows
 * come from listPackages and countVisibleByType, so the home page and a live read
 * cannot apply different listing rules.
 *
 * The upsert is outside the transaction. Inside, a concurrent publisher's commit
 * fails it with 40001 under repeatable read. The `where` drops a write older than
 * what is stored: two overlapping runs end on the newer read, in either order.
 */
export async function publishHomeSnapshot(): Promise<{
  listed: number;
  hidden: number;
  written: boolean;
}> {
  const snapshot = await db.transaction(
    async (tx) => {
      const [{ now }] = (await tx.execute(sql`select now() as now`)) as unknown as [
        { now: string },
      ];
      const recent = await listPackages({
        limit: HOME_ROWS,
        hiddenLanguages: HIDDEN_UNLESS_ASKED,
        reader: tx,
      });
      const counts = await countVisibleByType(HIDDEN_UNLESS_ASKED, tx);
      return { version: 1, generatedAt: new Date(now).toISOString(), recent, ...counts };
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );

  snapshotSchema.parse(snapshot);
  const generatedAt = new Date(snapshot.generatedAt);
  const written = await db
    .insert(schemaMeta)
    .values({ key: SNAPSHOT_KEY, value: JSON.stringify(snapshot), updatedAt: generatedAt })
    .onConflictDoUpdate({
      target: schemaMeta.key,
      set: {
        value: sql`excluded.value`,
        updatedAt: sql`excluded.updated_at`,
      },
      where: sql`${schemaMeta.updatedAt} < excluded.updated_at`,
    })
    .returning({ key: schemaMeta.key });

  return {
    listed: Object.values(snapshot.visible).reduce((sum, n) => sum + n, 0),
    hidden: snapshot.hidden,
    written: written.length > 0,
  };
}

/** The stored snapshot if it can be used, otherwise why not. */
function usable(value: string | undefined, now: number) {
  if (value === undefined) return { reason: 'missing' as const };
  let parsed: z.infer<typeof snapshotSchema>;
  try {
    parsed = snapshotSchema.parse(JSON.parse(value));
  } catch {
    return { reason: 'unreadable' as const };
  }
  return now - parsed.generatedAt.getTime() > SNAPSHOT_MAX_AGE_MS
    ? { reason: 'stale' as const }
    : { snapshot: parsed };
}

/**
 * Two statements for everything on the home page, whatever the corpus size. The
 * first request after a deploy that adds this has no snapshot yet, and neither does
 * a database no sync has finished on: both read live, as every request did before,
 * so the page needs no migration step and no run in any order.
 */
export const readHomeData = cache(async (): Promise<HomeData> => {
  const rows = await db
    .select({ key: schemaMeta.key, value: schemaMeta.value })
    .from(schemaMeta)
    .where(inArray(schemaMeta.key, [SNAPSHOT_KEY, LAST_SUCCESS_KEY]));
  const value = (key: string) => rows.find((row) => row.key === key)?.value;

  const stored = value(LAST_SUCCESS_KEY);
  const at = stored ? new Date(stored) : null;
  const lastSync = at && !Number.isNaN(at.getTime()) ? at : null;

  const { snapshot, reason } = usable(value(SNAPSHOT_KEY), Date.now());
  if (snapshot) {
    // A row a later run delisted is a 404 now, and a run that lost a stage leaves
    // this snapshot in place for up to SNAPSHOT_MAX_AGE_MS. A primary-key lookup of ten
    // ids, whatever the corpus size. The feed can then be short; the counts are as
    // of the snapshot, like the rest of it.
    const present = await db
      .select({ id: packageTable.id })
      .from(packageTable)
      .where(
        and(
          inArray(
            packageTable.id,
            snapshot.recent.map((row) => row.id),
          ),
          isNull(packageTable.delistedAt),
        ),
      );
    const ids = new Set(present.map((row) => row.id));
    return {
      recent: (snapshot.recent as PackageListItem[]).filter((row) => ids.has(row.id)),
      visible: snapshot.visible,
      hidden: snapshot.hidden,
      lastSync,
    };
  }

  log({ event: 'home_snapshot', fallback: reason ?? 'missing' });
  const [recent, counts] = await Promise.all([
    listPackages({ limit: HOME_ROWS, hiddenLanguages: HIDDEN_UNLESS_ASKED }),
    countVisibleByType(HIDDEN_UNLESS_ASKED),
  ]);
  return { recent, ...counts, lastSync };
});
