import { and, eq, inArray, isNull, not, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { packageTable, packageVersion, repository } from '@/db/schema';
import type { RepoScan } from './types';

export type PersistResult = {
  repositoryId: number;
  packageIds: number[];
  newVersions: number;
  delisted: number;
};

/**
 * One transaction, three upserts, one delisting.
 *
 * Idempotency is not implemented here — it is delegated to three unique
 * constraints. An application-level "select then insert" races with itself the
 * moment two ingests overlap; ON CONFLICT cannot.
 */
export async function persistScan(scan: RepoScan): Promise<PersistResult> {
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

    const packageIds: number[] = [];
    let newVersions = 0;

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
    }

    // Same transaction as the upserts. Delisting first would leave a window in
    // which a live package reads as delisted; a separate transaction would leave
    // that window open permanently on a crash.
    const delisted = await tx
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

    return {
      repositoryId: repo.id,
      packageIds,
      newVersions,
      delisted: delisted.length,
    };
  });
}
