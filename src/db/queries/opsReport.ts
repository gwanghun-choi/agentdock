import { sql } from 'drizzle-orm';
import type { SyncReport } from '@/corpus/health';
import { db } from '@/db/client';
import { countPackages, countPackagesByType } from '@/db/queries/packages';
import { lastSyncAttempt, lastSyncSucceededAt } from '@/db/queries/syncState';
import { ingestAttempt, ingestJob, packageTable, packageVersion } from '@/db/schema';

/**
 * The numbers `bun run ops:status` prints, read only from what the sync
 * already stores: schema_meta's two sync rows, ingest_job, ingest_attempt and
 * the corpus tables. No migration and no new write anywhere — a figure the sync
 * never recorded (per-run discovery counts before sync:last_attempt existed,
 * say) is absent rather than reconstructed.
 *
 * Nine statements, in parallel. Each is one aggregate over an indexed or small table; the
 * listing counts reuse packages.ts's predicate rather than restating it.
 */
export async function readSyncReport({
  windowHours,
  reapAfterMs,
  now = new Date(),
}: {
  windowHours: number;
  /** worker.ts's REAP_AFTER_MS, passed in so this module does not load the pipeline. */
  reapAfterMs: number;
  now?: Date;
}): Promise<SyncReport> {
  // ISO strings, cast in SQL: drizzle's postgres-js driver passes timestamps
  // through as strings, so a Date bound into a raw fragment fails to serialize.
  const at = (d: Date) => sql`${d.toISOString()}::timestamptz`;
  const since = at(new Date(now.getTime() - windowHours * 3_600_000));

  const [lastAttempt, lastSuccessAt, queueRows, attemptRows, timing, listed, held, byType, corpus] =
    await Promise.all([
      lastSyncAttempt(),
      lastSyncSucceededAt(),
      db
        .select({
          queued: sql<number>`(count(*) filter (where ${ingestJob.status} = 'queued'))::int`,
          due: sql<number>`(count(*) filter (where ${ingestJob.status} = 'queued'
            and ${ingestJob.nextAttemptAt} <= ${at(now)}))::int`,
          running: sql<number>`(count(*) filter (where ${ingestJob.status} = 'running'))::int`,
          runningAbandoned: sql<number>`(count(*) filter (where ${ingestJob.status} = 'running'
            and ${ingestJob.startedAt} < ${at(new Date(now.getTime() - reapAfterMs))}))::int`,
          succeeded: sql<number>`(count(*) filter (where ${ingestJob.status} = 'succeeded'))::int`,
          failed: sql<number>`(count(*) filter (where ${ingestJob.status} = 'failed'))::int`,
        })
        .from(ingestJob),
      db
        .select({
          outcome: ingestAttempt.outcome,
          n: sql<number>`count(*)::int`,
          truncated: sql<number>`(count(*) filter (where ${ingestAttempt.truncated}))::int`,
          artifactsNew: sql<number>`sum(${ingestAttempt.artifactsNew})::int`,
          artifactsUpdated: sql<number>`sum(${ingestAttempt.artifactsUpdated})::int`,
          artifactsUnchanged: sql<number>`sum(${ingestAttempt.artifactsUnchanged})::int`,
          artifactsRemoved: sql<number>`sum(${ingestAttempt.artifactsRemoved})::int`,
        })
        .from(ingestAttempt)
        .where(sql`${ingestAttempt.finishedAt} >= ${since}`)
        .groupBy(ingestAttempt.outcome)
        .orderBy(ingestAttempt.outcome),
      // A separate statement: percentile_cont is an ordered-set aggregate,
      // which PostgreSQL does not run as a window over the grouped rows above.
      db
        .select({
          p50: sql<number | null>`percentile_cont(0.5) within group (order by
            extract(epoch from ${ingestAttempt.finishedAt} - ${ingestAttempt.startedAt}) * 1000)`,
          p95: sql<number | null>`percentile_cont(0.95) within group (order by
            extract(epoch from ${ingestAttempt.finishedAt} - ${ingestAttempt.startedAt}) * 1000)`,
        })
        .from(ingestAttempt)
        .where(sql`${ingestAttempt.finishedAt} >= ${since}`),
      countPackages(),
      countPackages({ listingOnly: false }),
      countPackagesByType(),
      db
        .select({
          added: sql<number>`(count(*) filter (where ${packageTable.delistedAt} is null
            and ${packageTable.createdAt} >= ${since}))::int`,
          changed: sql<number>`(count(*) filter (where ${packageTable.delistedAt} is null
            and exists (
              select 1 from ${packageVersion} v
              where v.package_id = ${packageTable}.id and v.ingested_at >= ${since}
                and exists (select 1 from ${packageVersion} w
                            where w.package_id = v.package_id and w.ingested_at < v.ingested_at))
          ))::int`,
        })
        // `${packageTable}.id`, not `${packageTable.id}`: in a one-table select
        // Drizzle prints a column unqualified, and inside the subquery a bare
        // "id" binds to v — caught by quality.test.ts, which counted 0.
        .from(packageTable),
    ]);

  const q = queueRows[0];
  const sum = (
    key:
      | 'truncated'
      | 'artifactsNew'
      | 'artifactsUpdated'
      | 'artifactsUnchanged'
      | 'artifactsRemoved',
  ) => attemptRows.reduce((n, r) => n + (r[key] ?? 0), 0);
  const ms = (v: number | null | undefined) => (v == null ? null : Math.round(Number(v)));

  return {
    generatedAt: now,
    windowHours,
    lastAttempt,
    lastSuccessAt,
    queue: {
      queued: q?.queued ?? 0,
      due: q?.due ?? 0,
      running: q?.running ?? 0,
      runningAbandoned: q?.runningAbandoned ?? 0,
      succeeded: q?.succeeded ?? 0,
      failed: q?.failed ?? 0,
    },
    attempts: {
      total: attemptRows.reduce((n, r) => n + r.n, 0),
      byOutcome: Object.fromEntries(attemptRows.map((r) => [r.outcome, r.n])),
      p50Ms: ms(timing[0]?.p50),
      p95Ms: ms(timing[0]?.p95),
      truncated: sum('truncated'),
      artifactsNew: sum('artifactsNew'),
      artifactsUpdated: sum('artifactsUpdated'),
      artifactsUnchanged: sum('artifactsUnchanged'),
      artifactsRemoved: sum('artifactsRemoved'),
    },
    artifacts: {
      held,
      listed,
      byType,
      addedInWindow: corpus[0]?.added ?? 0,
      changedInWindow: corpus[0]?.changed ?? 0,
    },
  };
}
