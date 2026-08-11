import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { cache } from 'react';
import { db } from '@/db/client';
import { packageTable, packageVersion, repository } from '@/db/schema';

export type PackageListItem = {
  id: number;
  name: string;
  summary: string | null;
  type: string;
  sourcePath: string;
  fullName: string;
  stars: number;
  commitSha: string | null;
  scannedAt: Date | null;
};

/**
 * cache() dedupes within one render pass, so a page and its generateMetadata do
 * not hit the database twice for the same rows.
 */
export const listPackages = cache(
  async ({
    limit = 25,
    offset = 0,
    fullName,
  }: {
    limit?: number;
    offset?: number;
    /** Restricts the listing to one repository, matched case-insensitively. */
    fullName?: string;
  } = {}): Promise<PackageListItem[]> =>
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
        // Correlated subquery rather than a lateral join: the listing needs one
        // scalar per row, and PRV-01 needs it to be the commit sha.
        commitSha: sql<string | null>`(
          select pv.commit_sha from ${packageVersion} pv
          where pv.package_id = ${packageTable.id}
          order by pv.ingested_at desc limit 1
        )`,
      })
      .from(packageTable)
      .innerJoin(repository, eq(packageTable.repositoryId, repository.id))
      .where(
        and(
          isNull(packageTable.delistedAt),
          fullName ? sql`lower(${repository.fullName}) = ${fullName.toLowerCase()}` : undefined,
        ),
      )
      .orderBy(desc(packageTable.updatedAt))
      .limit(limit)
      .offset(offset),
);

export const countPackages = cache(async (): Promise<number> => {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(packageTable)
    .where(isNull(packageTable.delistedAt));
  return row?.n ?? 0;
});

/** github.com/{full_name}/blob/{commit sha}/{path} — never the tree sha. */
export function permalink(fullName: string, commitSha: string, sourcePath: string): string {
  return `https://github.com/${fullName}/blob/${commitSha}/${sourcePath}`;
}

/**
 * The URL carries the artifact's directory; the identity key carries its manifest
 * path. One type, one manifest filename, so the mapping is a suffix.
 *
 * ponytail: suffix mapping while there is one artifact type; Phase 3 resolves the
 * manifest filename from the detector registry instead.
 */
export function sourcePathFromUrl(segments: string[]): string {
  const joined = segments.join('/');
  // A manifest at the repository root has no directory, so the URL carries the
  // filename itself and there is nothing to append.
  if (joined === 'SKILL.md') return joined;
  return joined.length > 0 ? `${joined}/SKILL.md` : 'SKILL.md';
}

/** The inverse. Kept beside its counterpart so the two cannot drift apart. */
export function detailHref(fullName: string, sourcePath: string): string {
  const dir = sourcePath.replace(/(^|\/)SKILL\.md$/, '');
  return `/r/${fullName}/${dir === '' ? 'SKILL.md' : dir}`;
}

export type RepositorySummary = {
  fullName: string;
  description: string | null;
  stars: number;
  isArchived: boolean;
  licenseSpdx: string | null;
  pushedAt: Date | null;
  scannedAt: Date | null;
  /** The commit the listing below was read at. Null until AgentDock has looked. */
  lastIngestedSha: string | null;
  treeTruncated: boolean;
};

const repositorySummary = {
  fullName: repository.fullName,
  description: repository.description,
  stars: repository.stars,
  isArchived: repository.isArchived,
  licenseSpdx: repository.licenseSpdx,
  pushedAt: repository.pushedAt,
  scannedAt: repository.scannedAt,
  lastIngestedSha: repository.lastIngestedSha,
  treeTruncated: repository.treeTruncated,
};

/**
 * A repository and everything AgentDock currently lists for it.
 *
 * The limit is the scan's own file cap: a repository cannot hold more indexed
 * artifacts than one pass was allowed to read, so this is bounded by
 * construction rather than by a page parameter.
 */
export const getRepositoryPackages = cache(
  async (
    owner: string,
    repo: string,
  ): Promise<{ repository: RepositorySummary; packages: PackageListItem[] } | null> => {
    const fullName = `${owner}/${repo}`;
    // Matched on the lowercased full name, which has a unique expression index.
    const [row] = await db
      .select(repositorySummary)
      .from(repository)
      .where(sql`lower(${repository.fullName}) = ${fullName.toLowerCase()}`)
      .limit(1);
    if (!row) return null;
    return { repository: row, packages: await listPackages({ fullName, limit: 250 }) };
  },
);

export type PackageDetail = {
  id: number;
  name: string;
  summary: string | null;
  type: string;
  slug: string;
  sourcePath: string;
  licenseText: string | null;
  meta: Record<string, unknown>;
  fullName: string;
  repoDescription: string | null;
  licenseSpdx: string | null;
  stars: number;
  isArchived: boolean;
  pushedAt: Date | null;
  scannedAt: Date | null;
  treeTruncated: boolean;
  commitSha: string;
  declaredVersion: string | null;
  body: string | null;
  parseStatus: string;
  parseErrors: string[];
  ingestedAt: Date;
};

export const getPackageDetail = cache(
  async (owner: string, repo: string, segments: string[]): Promise<PackageDetail | null> => {
    const [row] = await db
      .select({
        id: packageTable.id,
        name: packageTable.name,
        summary: packageTable.summary,
        type: packageTable.type,
        slug: packageTable.slug,
        sourcePath: packageTable.sourcePath,
        licenseText: packageTable.licenseText,
        meta: packageTable.meta,
        fullName: repository.fullName,
        repoDescription: repository.description,
        licenseSpdx: repository.licenseSpdx,
        stars: repository.stars,
        isArchived: repository.isArchived,
        pushedAt: repository.pushedAt,
        scannedAt: repository.scannedAt,
        treeTruncated: repository.treeTruncated,
        commitSha: packageVersion.commitSha,
        declaredVersion: packageVersion.declaredVersion,
        body: packageVersion.body,
        parseStatus: packageVersion.parseStatus,
        parseErrors: packageVersion.parseErrors,
        ingestedAt: packageVersion.ingestedAt,
      })
      .from(packageTable)
      .innerJoin(repository, eq(packageTable.repositoryId, repository.id))
      .innerJoin(packageVersion, eq(packageVersion.packageId, packageTable.id))
      .where(
        and(
          isNull(packageTable.delistedAt),
          sql`lower(${repository.fullName}) = ${`${owner}/${repo}`.toLowerCase()}`,
          eq(packageTable.sourcePath, sourcePathFromUrl(segments)),
        ),
      )
      // The latest version of that artifact, which is the one on the page.
      .orderBy(desc(packageVersion.ingestedAt))
      .limit(1);
    return row ?? null;
  },
);
