import { and, asc, eq, or, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { enqueueJob } from '@/db/queries/jobs';
import { repository } from '@/db/schema';
import { CORPUS_CAPS } from './caps';

export type RefreshResult = {
  considered: number;
  /**
   * Repositories this run offered to the queue. Not the same as new rows:
   * enqueueJob's ON CONFLICT no-op returns the id of an ALREADY-active job, so
   * a repository still waiting from an earlier run is counted here too.
   * Distinguishing them would cost a second query per repository to report a
   * difference nothing acts on.
   */
  enqueued: number;
  denylisted: number;
  flooded: boolean;
  /**
   * Stale repositories this run did NOT reach, because the cap or the queue
   * ceiling stopped it. Zero means the whole corpus was offered. A cap that
   * prints nothing reads as "we covered everything".
   */
  notReached: number;
  /**
   * Stored repositories whose last check read nothing (404 or private, too
   * large, retries spent), across the corpus. Their artifacts stay listed; the
   * number is here so a growing one is visible in the summary.
   */
  failingChecks: number;
};

/**
 * Re-offers repositories AgentDock has already read, oldest read first.
 *
 * This is the half of the schedule fan-out cannot do. `unenqueuedSeeds` joins
 * against ANY ingest_job row, terminal ones included, on purpose — a seed whose
 * job failed permanently must not loop forever. The consequence is that once a
 * repository has been ingested it is never offered again, so without this
 * function a scheduled sync would only ever discover NEW repositories and every
 * upstream commit after the first read would be invisible.
 *
 * The change detection itself is not here and must not be: `ingestRepository`
 * already compares the fetched commit sha against `repository.last_ingested_sha`
 * and short-circuits to `unchanged` before reading a single file
 * (src/github/scan.ts). This function's whole job is deciding WHICH repositories
 * pay the two core requests that comparison costs — so the answer to "has it
 * changed" stays in one place and this one stays a scheduler.
 *
 * Forks and archived repositories are skipped rather than deleted. They are
 * already in the corpus and stay readable at their own URLs; an archived
 * repository by definition has no new commit, and a fork was not something
 * automatic discovery added. Spending two requests to confirm either is the
 * cheapest thing to stop doing.
 *
 * Stars are deliberately NOT consulted. A repository that fell below the floor
 * after being read keeps being re-read: the floor is an entry gate, and
 * src/corpus/policy.ts records why turning it into a maintenance rule would
 * make it a deletion policy nobody chose.
 */
export async function refreshStaleRepositories(options: {
  limit: number;
  staleAfterMs: number;
}): Promise<RefreshResult> {
  const cutoff = new Date(Date.now() - options.staleAfterMs);

  // When AgentDock last asked, read or not. scanned_at alone used to be the
  // key, and it only moves on a read — so a stored repository that turned 404
  // or too_large kept the oldest scanned_at in the corpus and took a slot at
  // the head of every refresh, forever (R1). checked_at moves on every check;
  // null on rows from before migration 0008, hence the fallback.
  const lastAsked = sql`coalesce(${repository.checkedAt}, ${repository.scannedAt})`;

  // Due when the last check is older than the window, doubled per consecutive
  // failed check (CORPUS_CAPS.maxCheckBackoffDoublings). A repository that
  // reads normally has check_failures = 0, so for it this is exactly the old
  // `scanned_at < cutoff`. ISO string and an explicit cast, because postgres.js
  // cannot infer a type for a Date inside a raw fragment.
  const due = sql`${lastAsked} < ${cutoff.toISOString()}::timestamptz - ${options.staleAfterMs}
    * (power(2, least(${repository.checkFailures}, ${CORPUS_CAPS.maxCheckBackoffDoublings})) - 1)
    * interval '1 millisecond'`;

  // NULLS FIRST is not decoration. A repository row never read and never
  // checked was written by a path that never completed a scan, so it is the
  // most stale thing there is; default DESC-style null ordering would park it
  // at the back forever.
  //
  // ponytail: a sequential scan over repository per sync, which at the corpus's
  // thousands of rows is milliseconds. The upgrade is one expression index on
  // coalesce(checked_at, scanned_at), additive, when the table reaches 10^5.
  const stale = and(
    eq(repository.isFork, false),
    eq(repository.isArchived, false),
    or(sql`${lastAsked} is null`, due),
  );

  const targets = await db
    .select({ fullName: repository.fullName })
    .from(repository)
    .where(stale)
    .orderBy(sql`${lastAsked} asc nulls first`, asc(repository.id))
    .limit(options.limit);

  let enqueued = 0;
  let denylisted = 0;
  let flooded = false;

  for (const target of targets) {
    // Through enqueueJob, never a direct insert: it is the only place the
    // denylist check and the MAX_QUEUED ceiling exist, and this is exactly the
    // traffic — repositories nobody typed — they were written for.
    const result = await enqueueJob(target.fullName);
    if (result.kind === 'denylisted') {
      denylisted += 1;
      continue;
    }
    if (result.kind === 'flooded') {
      // Stop on the first one. Continuing issues a count query per remaining
      // repository to learn the same fact.
      flooded = true;
      break;
    }
    enqueued += 1;
  }

  // Taken after the loop and over the same predicate, so "how many are stale"
  // and "how many did this run offer" are the same definition of stale. The
  // rows this run enqueued are still stale by it — scanned_at only moves when
  // the job actually runs — so they are subtracted rather than counted twice.
  const [row] = await db
    .select({
      n: sql<number>`count(*) filter (where ${stale})::int`,
      failing: sql<number>`count(*) filter (where ${repository.checkFailures} > 0)::int`,
    })
    .from(repository);

  return {
    considered: targets.length,
    enqueued,
    denylisted,
    flooded,
    notReached: Math.max(0, (row?.n ?? 0) - targets.length),
    failingChecks: row?.failing ?? 0,
  };
}
