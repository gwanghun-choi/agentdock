import { and, eq, inArray, isNull, not, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  capabilityFinding,
  ingestAttempt,
  ingestJob,
  packageTable,
  packageVersion,
  repoSeed,
  repository,
  repositoryDenylist,
} from '@/db/schema';
import type { RepoMetadata } from '@/github/types';
import type { RepoScan } from './types';

/** What one run did to a repository's listing, in one pass over what it wrote. */
export type DiffCounters = {
  discovered: number;
  new: number;
  updated: number;
  unchanged: number;
  removed: number;
  parseFailed: number;
};

/** Everything the transaction needs to terminate the job it is running under. */
export type JobContext = {
  id: number;
  attemptNo: number;
  startedAt: Date;
  rateRemaining: number | null;
};

export type PersistResult = {
  repositoryId: number;
  packageIds: number[];
  newVersions: number;
  delisted: number;
  counters: DiffCounters;
};

/**
 * One transaction, three upserts, one delisting.
 *
 * Idempotency is not implemented here — it is delegated to three unique
 * constraints. An application-level "select then insert" races with itself the
 * moment two ingests overlap; ON CONFLICT cannot.
 *
 * `job` is optional because the existing suite persists scans with no queue
 * involved, and so will any caller that is not the worker. When it is present
 * the job's terminal state commits with the artifacts rather than after them.
 */
export async function persistScan(scan: RepoScan, job?: JobContext): Promise<PersistResult> {
  return db.transaction(async (tx) => {
    const [repo] = await tx
      .insert(repository)
      .values({
        githubNodeId: scan.githubNodeId,
        fullName: scan.fullName,
        owner: scan.owner,
        defaultBranch: scan.defaultBranch,
        description: scan.description,
        homepage: scan.homepage,
        licenseSpdx: scan.licenseSpdx,
        stars: scan.stars,
        isFork: scan.isFork,
        isArchived: scan.isArchived,
        topics: scan.topics,
        pushedAt: scan.pushedAt,
        scannedAt: scan.scannedAt,
        etag: scan.etag,
        lastIngestedSha: scan.commitSha,
        treeTruncated: scan.treeTruncated,
      })
      // Keyed on the immutable node id, so a rename arrives as an UPDATE of
      // full_name rather than as a second repository.
      .onConflictDoUpdate({
        target: repository.githubNodeId,
        set: {
          fullName: scan.fullName,
          owner: scan.owner,
          defaultBranch: scan.defaultBranch,
          description: scan.description,
          homepage: scan.homepage,
          licenseSpdx: scan.licenseSpdx,
          stars: scan.stars,
          isFork: scan.isFork,
          isArchived: scan.isArchived,
          topics: scan.topics,
          pushedAt: scan.pushedAt,
          scannedAt: scan.scannedAt,
          etag: scan.etag,
          lastIngestedSha: scan.commitSha,
          treeTruncated: scan.treeTruncated,
          updatedAt: sql`now()`,
        },
      })
      .returning();

    // What the listing held before this run. One indexed read of a few dozen
    // rows, which is the whole cost of an honest counter breakdown. It must sit
    // after the repository upsert: the repository id does not exist before it,
    // and a snapshot keyed on anything else would be silently empty.
    const before = await tx
      .select({
        type: packageTable.type,
        sourcePath: packageTable.sourcePath,
        delistedAt: packageTable.delistedAt,
      })
      .from(packageTable)
      .where(eq(packageTable.repositoryId, repo.id));

    const key = (type: string, sourcePath: string) => `${type} ${sourcePath}`;
    const prior = new Map(before.map((r) => [key(r.type, r.sourcePath), r.delistedAt]));

    const packageIds: number[] = [];
    let newVersions = 0;
    let newCount = 0;
    let updatedCount = 0;
    let unchangedCount = 0;

    for (const found of scan.packages) {
      const [pkg] = await tx
        .insert(packageTable)
        .values({
          repositoryId: repo.id,
          type: found.type,
          sourcePath: found.sourcePath,
          name: found.name,
          slug: found.slug,
          summary: found.summary,
          licenseText: found.licenseText,
          meta: found.meta,
          parentPath: found.parentPath,
          files: found.files,
        })
        // The array must name the same three columns, in the same order, as the
        // unique('package_identity') constraint.
        .onConflictDoUpdate({
          target: [packageTable.repositoryId, packageTable.type, packageTable.sourcePath],
          set: {
            name: found.name,
            slug: found.slug,
            summary: found.summary,
            licenseText: found.licenseText,
            meta: found.meta,
            parentPath: found.parentPath,
            // Refreshed on every scan, unlike a version's own columns: the
            // inventory's lifetime is the scan, not the content hash. A commit
            // where the tree moved but the manifest did not still updates
            // this — see ScannedPackage.files's own doc.
            files: found.files,
            delistedAt: null,
            updatedAt: sql`now()`,
          },
        })
        .returning();

      packageIds.push(pkg.id);

      const inserted = await tx
        .insert(packageVersion)
        .values({
          packageId: pkg.id,
          commitSha: scan.commitSha,
          blobSha: found.blobSha,
          contentHash: found.contentHash,
          declaredVersion: found.declaredVersion,
          body: found.body,
          frontmatter: found.frontmatter,
          parseStatus: found.parseStatus,
          parseErrors: found.parseErrors,
        })
        .onConflictDoNothing({
          target: [packageVersion.packageId, packageVersion.contentHash],
        })
        .returning({ id: packageVersion.id });

      newVersions += inserted.length;

      // Analysis findings exist for exactly one reason: a new version row was
      // created. On the conflict branch there is no id to key them on, and the
      // findings for that content are already stored from when it was new —
      // which is how Phase 2's (package_id, content_hash) unique constraint
      // makes CAP-13's idempotency free rather than a code path that can race.
      if (inserted.length > 0) {
        await tx
          .update(packageVersion)
          .set({ analyzedAt: sql`now()` })
          .where(eq(packageVersion.id, inserted[0].id));

        if (found.findings.length > 0) {
          await tx
            .insert(capabilityFinding)
            .values(
              found.findings.map((f) => ({
                packageVersionId: inserted[0].id,
                detectorId: f.detectorId,
                detectorVersion: f.detectorVersion,
                category: f.category,
                signal: f.signal,
                summary: f.summary,
                sourcePath: f.sourcePath,
                startLine: f.startLine,
                endLine: f.endLine,
                commitSha: scan.commitSha,
                evidenceText: f.evidenceText,
                metadata: f.metadata,
              })),
            )
            // The array must name the same six columns, in the same order,
            // as capability_finding_identity.
            .onConflictDoNothing({
              target: [
                capabilityFinding.packageVersionId,
                capabilityFinding.detectorId,
                capabilityFinding.category,
                capabilityFinding.sourcePath,
                capabilityFinding.startLine,
                capabilityFinding.summary,
              ],
            });
        }
      }

      const k = key(found.type, found.sourcePath);
      const seenBefore = prior.has(k);
      // The upsert's conflict branch already cleared the tombstone, so this is
      // read from the snapshot taken before the loop, not from the row.
      const wasDelisted = seenBefore && prior.get(k) !== null;

      if (!seenBefore) newCount += 1;
      else if (inserted.length > 0 || wasDelisted) updatedCount += 1;
      else unchangedCount += 1;
    }

    // Same transaction as the upserts. Delisting first would leave a window in
    // which a live package reads as delisted; a separate transaction would leave
    // that window open permanently on a crash.
    //
    // A partial read is not evidence of absence. Delisting from an incomplete
    // scan removes artifacts because a cap fired, which is the one way a failed
    // ingest can destroy the previously visible index.
    const delisted = scan.treeTruncated
      ? []
      : await tx
          .update(packageTable)
          .set({ delistedAt: sql`now()`, updatedAt: sql`now()` })
          .where(
            and(
              eq(packageTable.repositoryId, repo.id),
              isNull(packageTable.delistedAt),
              packageIds.length > 0 ? not(inArray(packageTable.id, packageIds)) : sql`true`,
            ),
          )
          .returning({ id: packageTable.id });

    // A seed pointing at a denylisted repository is one bug away from
    // re-adding something the denylist exists to keep out (DAT-06). Filtered
    // here, where the transaction is already open, rather than trusted to
    // Phase 5. One indexed read of the denylist rows the seed set could
    // possibly match, then an in-memory filter — same transaction, same
    // guarantee as a `NOT EXISTS` on the insert.
    const seedNames = scan.seeds.map((s) => s.fullName);
    const blockedSeeds =
      seedNames.length > 0
        ? new Set(
            (
              await tx
                .select({ fullName: repositoryDenylist.fullName })
                .from(repositoryDenylist)
                .where(inArray(repositoryDenylist.fullName, seedNames))
            ).map((r) => r.fullName),
          )
        : new Set<string>();

    for (const seed of scan.seeds) {
      if (blockedSeeds.has(seed.fullName)) continue;
      await tx
        .insert(repoSeed)
        .values({
          fullName: seed.fullName,
          sourceKind: seed.sourceKind,
          discoveredFrom: seed.discoveredFrom,
          discoveredPath: seed.discoveredPath,
          hint: seed.hint,
        })
        .onConflictDoUpdate({
          target: repoSeed.fullName,
          set: {
            sourceKind: seed.sourceKind,
            discoveredFrom: seed.discoveredFrom,
            discoveredPath: seed.discoveredPath,
            hint: seed.hint,
            updatedAt: sql`now()`,
          },
        });
    }

    const counters: DiffCounters = {
      discovered: scan.packages.length,
      new: newCount,
      updated: updatedCount,
      unchanged: unchangedCount,
      removed: delisted.length,
      parseFailed: scan.packages.filter((p) => p.parseStatus === 'failed').length,
    };

    if (job) {
      await tx.insert(ingestAttempt).values({
        jobId: job.id,
        attemptNo: job.attemptNo,
        startedAt: job.startedAt,
        outcome: 'ok',
        errorDetail: null,
        commitSha: scan.commitSha,
        filesRead: scan.packages.length,
        artifactsFound: counters.discovered,
        artifactsNew: counters.new,
        artifactsUpdated: counters.updated,
        artifactsUnchanged: counters.unchanged,
        artifactsRemoved: counters.removed,
        parseFailed: counters.parseFailed,
        truncated: scan.treeTruncated,
        rateRemaining: job.rateRemaining,
        rateReset: null,
      });

      // The last statement, deliberately. There is now no window in which the
      // artifacts are committed and the job still reads as running — and if
      // anything above throws, the job stays running and the reaper reclaims it
      // rather than a half-written state being reported as finished.
      await tx
        .update(ingestJob)
        .set({ status: 'succeeded', finishedAt: sql`now()`, startedAt: null, workerId: null })
        .where(eq(ingestJob.id, job.id));
    }

    return {
      repositoryId: repo.id,
      packageIds,
      newVersions,
      delisted: delisted.length,
      counters,
    };
  });
}

/** The commit sha of the last ingest of this repository, matched the way the pages match. */
export async function lastIngestedSha(fullName: string): Promise<string | null> {
  const [row] = await db
    .select({ sha: repository.lastIngestedSha })
    .from(repository)
    .where(sql`lower(${repository.fullName}) = ${fullName.toLowerCase()}`)
    .limit(1);
  return row?.sha ?? null;
}

export type TouchResult = {
  repositoryId: number;
  liveCount: number;
  treeTruncated: boolean;
};

/**
 * The no-change path's only write.
 *
 * Repository metadata moves independently of the commit sha, and all of it was
 * just fetched, so it is refreshed. Nothing below the repository is touched: no
 * package upsert, no version insert, and above all no delisting and no package
 * timestamp bump — the listing is ordered by that timestamp, so bumping it here
 * would float every unchanged repository to the top of the recent list forever.
 *
 * That is also why this is a separate function rather than a flag on the
 * transaction above: a code path that cannot reach the package upsert is a
 * stronger guarantee than one that is remembered not to.
 *
 * The truncation flag is deliberately not written. The commit has not moved, so
 * whatever was partial about the previous read of it is still partial, and
 * overwriting the flag would quietly upgrade a partial listing to a
 * complete-looking one.
 */
export async function touchRepository(
  metadata: RepoMetadata,
  commitSha: string,
  scannedAt: Date,
  job?: JobContext,
): Promise<TouchResult> {
  return db.transaction(async (tx) => {
    const [repo] = await tx
      .insert(repository)
      .values({
        githubNodeId: metadata.githubNodeId,
        fullName: metadata.fullName,
        owner: metadata.owner,
        defaultBranch: metadata.defaultBranch,
        description: metadata.description,
        homepage: metadata.homepage,
        licenseSpdx: metadata.licenseSpdx,
        stars: metadata.stars,
        isFork: metadata.isFork,
        isArchived: metadata.isArchived,
        topics: metadata.topics,
        pushedAt: metadata.pushedAt,
        scannedAt,
        etag: metadata.etag,
        lastIngestedSha: commitSha,
      })
      .onConflictDoUpdate({
        target: repository.githubNodeId,
        set: {
          fullName: metadata.fullName,
          owner: metadata.owner,
          defaultBranch: metadata.defaultBranch,
          description: metadata.description,
          homepage: metadata.homepage,
          licenseSpdx: metadata.licenseSpdx,
          stars: metadata.stars,
          isFork: metadata.isFork,
          isArchived: metadata.isArchived,
          topics: metadata.topics,
          pushedAt: metadata.pushedAt,
          scannedAt,
          etag: metadata.etag,
          lastIngestedSha: commitSha,
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: repository.id, treeTruncated: repository.treeTruncated });

    const [live] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(packageTable)
      .where(and(eq(packageTable.repositoryId, repo.id), isNull(packageTable.delistedAt)));

    if (job) {
      await tx.insert(ingestAttempt).values({
        jobId: job.id,
        attemptNo: job.attemptNo,
        startedAt: job.startedAt,
        outcome: 'unchanged',
        errorDetail: null,
        commitSha,
        filesRead: 0,
        artifactsFound: live.n,
        artifactsNew: 0,
        artifactsUpdated: 0,
        artifactsUnchanged: live.n,
        artifactsRemoved: 0,
        parseFailed: 0,
        truncated: repo.treeTruncated,
        rateRemaining: job.rateRemaining,
        rateReset: null,
      });
      // Same commit as the repository write, for the same reason the full path
      // terminates inside its own transaction: a result that reports success has
      // already terminated its job, whichever write path produced it.
      await tx
        .update(ingestJob)
        .set({ status: 'succeeded', finishedAt: sql`now()`, startedAt: null, workerId: null })
        .where(eq(ingestJob.id, job.id));
    }

    return { repositoryId: repo.id, liveCount: live.n, treeTruncated: repo.treeTruncated };
  });
}
