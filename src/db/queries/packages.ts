import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { cache } from 'react';
import type { FileEntry } from '@/analyze/types';
import { sourcePathCandidates } from '@/components/hrefs';
import { db } from '@/db/client';
import { packageTable, packageVersion, repository } from '@/db/schema';
import { CAPS } from '@/github/scan';

/** Why an artifact is not in AgentDock's listings. Null means it is. */
export type NotListedReason = 'fork' | 'duplicate' | 'unparsed';

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
  /** Null when the artifact is in AgentDock's listings. Set by NOT_LISTED_BECAUSE. */
  notListedBecause: NotListedReason | null;
};

/**
 * The latest version of the row being tested. One subquery shape, written once.
 *
 * "Latest" is by ingested_at, matching getPackageDetail's own ordering — the
 * version on the artifact's page and the version the listing judges must be the
 * same row, or a reader sees a reason that does not match what they are looking
 * at.
 */
function latestVersion(column: 'parse_status' | 'content_hash', packageId = packageTable.id) {
  return sql`(
    select v.${sql.raw(column)} from ${packageVersion} v
    where v.package_id = ${packageId}
    order by v.ingested_at desc limit 1
  )`;
}

/**
 * Why an artifact is not in AgentDock's listings, or null when it is.
 *
 * Three requirements — fork suppression (DAT-07), cross-repository duplicate
 * suppression (DAT-07) and the visibility floor (COR-07) — are one question
 * asked of one row, so they are one CASE with one stated precedence rather than
 * three predicates whose interaction nobody decided.
 *
 * Ordered cheapest-first, which is also the precedence a reader sees. CASE stops
 * at its first true branch, so a fork never pays for the correlated duplicate
 * test at the bottom.
 *
 * NONE OF THIS IS A JUDGMENT ABOUT AN ARTIFACT, and the ordering of the reasons
 * is not a ranking of them. A fork is a fact GitHub reports about where a
 * repository is. A duplicate is byte-equality with a file AgentDock already
 * lists from somewhere else. An unparsed artifact is an outcome of AgentDock's
 * own reading, stated as a verb of observation. Stars and age were considered as
 * floor inputs and rejected (05-CONTEXT D-03): excluding an artifact from
 * listings because its repository is unpopular is a trust score wearing a
 * different hat.
 *
 * ---
 *
 * The floor is `= 'failed'`, NOT `<> 'ok'`, and the difference is 353 artifacts.
 *
 * The plan specified `<> 'ok'`. Measured against the live corpus on 2026-08-11,
 * that predicate excludes 502 of 971 artifacts and leaves 469 listed — below
 * COR-06's floor of 500 — because `partial` is not a parse failure. `partial` is
 * what a detector returns when it parsed the file completely and noticed
 * something (src/detect/skill.ts:118, command.ts:123, plugin.ts:278: `ok: true,
 * status: warnings.length > 0 ? 'partial' : 'ok'`). The single most common note
 * in the corpus, on 140 rows, is "keys outside the specification: argument-hint"
 * — a valid Claude Code command key this project's spec list does not know
 * about. Hiding those would tell a reader AgentDock could not parse a file it
 * parsed fine, and would make the floor a judgment about frontmatter
 * conventions, which is exactly what COR-07 must never be. `failed` is the
 * detector's own `ok: false`, and it is the same status the artifact page
 * already renders as "AgentDock could not read this file's frontmatter".
 *
 * ---
 *
 * The duplicate test carries three guards, each of which is a measured bug and
 * not a hypothetical:
 *
 * 1. **Shape-only plugins do not participate, on either side.** A plugin
 *    recognised by directory shape has no manifest to hash, so its version is
 *    minted over `components.join(',')` instead (src/detect/plugin.ts:204) — the
 *    literal string "agents,commands,skills". Measured: all three shape-only
 *    plugins in the corpus share one hash across two unrelated repositories, so
 *    without this guard two unrelated artifacts would be suppressed and the UI
 *    would call them byte-identical. They are not; they are two directories with
 *    the same subdirectory names.
 * 2. **The surviving copy must itself be listable.** Without `r2.is_fork = false`
 *    and the parse check on p2, a failed or forked copy could out-rank a
 *    parseable one and take the whole group out of the listings — every member
 *    suppressed as a duplicate of a row that is itself suppressed.
 * 3. **The rank is total.** Most stars, tie-broken by lowest package id. Both
 *    together are antisymmetric and total, so exactly one member of a group
 *    survives. Stars here rank COPIES OF ONE FILE against each other, which is a
 *    tie-break; they never rank one artifact above a different artifact.
 *
 * ---
 *
 * The EXISTS is driven by content_hash, not by a scan over candidate packages,
 * and that is a measurement rather than a preference.
 *
 * Written the obvious way — `from package p2` with a lateral latest-version
 * lookup per candidate — this costs 971 x 971 lateral sorts and the home listing
 * takes **1,152 ms** at 971 packages. The plan named one remedy in advance, an
 * additive `CREATE INDEX ON package_version (content_hash)`, and measured on
 * 2026-08-11 that remedy does almost nothing: 1,152 ms -> 1,101 ms, because an
 * index on content_hash cannot be a lookup key for a join the planner reaches
 * only after evaluating a lateral per candidate row.
 *
 * Starting from package_version instead — find the versions carrying my hash,
 * then keep the ones that are their package's latest — makes content_hash the
 * driving predicate. Same 971 rows classified identically (asserted: zero
 * disagreements against the other shape over the whole corpus), and the listing
 * takes **25.5 ms**. No migration, which is also what 05-CONTEXT C2 expects of
 * this phase.
 *
 * `CREATE INDEX ON package_version (content_hash)` took this from 25.5 ms to
 * 7.1 ms at 971 packages / 971 versions, and was deferred until a listing
 * crossed 100 ms. It did, on 2026-10-21's synthetic scale data: the listing
 * count is 111 ms at 1k packages / 2k versions and 11.1 s at 10k / 20k — a
 * sequential scan of package_version per candidate row. With the index
 * (drizzle/0010): 6.3 ms and 51 ms.
 */
export const NOT_LISTED_BECAUSE = sql<NotListedReason | null>`case
  when ${repository.isFork} then 'fork'
  when ${latestVersion('parse_status')} = 'failed' then 'unparsed'
  when ${packageTable.meta}->>'detectionConfidence' is distinct from 'shape-only'
   and exists (
    select 1 from ${packageVersion} v2
    join ${packageTable} p2 on p2.id = v2.package_id
    join ${repository} r2 on r2.id = p2.repository_id
    where v2.content_hash = ${latestVersion('content_hash')}
      and v2.id = (
        select z.id from ${packageVersion} z
        where z.package_id = p2.id order by z.ingested_at desc limit 1
      )
      and p2.id <> ${packageTable.id}
      and p2.delisted_at is null
      and r2.is_fork = false
      and v2.parse_status <> 'failed'
      and p2.meta->>'detectionConfidence' is distinct from 'shape-only'
      and (r2.stars > ${repository.stars}
           or (r2.stars = ${repository.stars} and p2.id < ${packageTable.id}))
  ) then 'duplicate'
  else null
end`;

/**
 * cache() dedupes within one render pass, so a page and its generateMetadata do
 * not hit the database twice for the same rows.
 *
 * `listingOnly` defaults to TRUE, and getRepositoryPackages is the one caller
 * that opts out. That direction is deliberate: this one function is both the
 * home listing's data source and the repository detail page's
 * (05-CONTEXT D-03), so an unconditional predicate would satisfy half of COR-07
 * by breaking the other half — hiding a suppressed artifact from its own direct
 * link. A listPackagesForListing() wrapper would leave the default unsafe, so a
 * future caller that forgot it would leak forks into a listing. Defaulting to
 * the safe behaviour puts the burden on the exception.
 */
export const listPackages = cache(
  async ({
    limit = 25,
    offset = 0,
    fullName,
    listingOnly = true,
  }: {
    limit?: number;
    offset?: number;
    /** Restricts the listing to one repository, matched case-insensitively. */
    fullName?: string;
    /** False returns suppressed rows too, each carrying its own reason. */
    listingOnly?: boolean;
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
        notListedBecause: NOT_LISTED_BECAUSE,
      })
      .from(packageTable)
      .innerJoin(repository, eq(packageTable.repositoryId, repository.id))
      .where(
        and(
          isNull(packageTable.delistedAt),
          fullName ? sql`lower(${repository.fullName}) = ${fullName.toLowerCase()}` : undefined,
          // The same fragment object as the projection above. Drizzle SQL values
          // are immutable descriptors, so referencing one twice is safe — and
          // asserted, because a fragment that consumed its bindings on first use
          // would make the projection and the predicate disagree, which is the
          // one bug here that produces a plausible-looking wrong answer.
          listingOnly ? sql`${NOT_LISTED_BECAUSE} is null` : undefined,
        ),
      )
      .orderBy(desc(packageTable.updatedAt))
      .limit(limit)
      .offset(offset),
);

/**
 * How many artifacts the listing shows.
 *
 * The innerJoin is new, and it is not decoration: this query had no join to
 * repository at all (05-CONTEXT C9 corrects 05-PATTERNS' claim that it did), so
 * without it the home page's "Browse all N artifacts" and /skills's paginator would
 * count rows the listing suppresses. That disagreement does not surface as an
 * off-by-a-few number — skills/page.tsx has an existing branch that renders
 * "There is no page N", so it surfaces as a user-visible dead page.
 */
export const countPackages = cache(async ({ listingOnly = true } = {}): Promise<number> => {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(packageTable)
    .innerJoin(repository, eq(packageTable.repositoryId, repository.id))
    .where(
      and(
        isNull(packageTable.delistedAt),
        listingOnly ? sql`${NOT_LISTED_BECAUSE} is null` : undefined,
      ),
    );
  return row?.n ?? 0;
});

/**
 * countPackages, per type: the home page's "browse by type" figures. The same
 * join and the same listing predicate, grouped — so the figures add up to the
 * listing total and each equals what `/artifacts?type=…` reports on arrival
 * (the type filter is a plain `type = …` inside that predicate). One query for
 * all seven types; a type with no listed row is absent from the map, not 0.
 */
export const countPackagesByType = cache(async (): Promise<Record<string, number>> => {
  const rows = await db
    .select({ type: packageTable.type, n: sql<number>`count(*)::int` })
    .from(packageTable)
    .innerJoin(repository, eq(packageTable.repositoryId, repository.id))
    .where(and(isNull(packageTable.delistedAt), sql`${NOT_LISTED_BECAUSE} is null`))
    .groupBy(packageTable.type);
  return Object.fromEntries(rows.map((r) => [r.type, r.n]));
});

export type RepositorySummary = {
  fullName: string;
  description: string | null;
  stars: number;
  isArchived: boolean;
  /** Already fetched and stored since Phase 1 (repo.ts:35, schema.ts:83) and
   * never once read. DAT-07's disclosure costs no new GitHub request. */
  isFork: boolean;
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
  isFork: repository.isFork,
  licenseSpdx: repository.licenseSpdx,
  pushedAt: repository.pushedAt,
  scannedAt: repository.scannedAt,
  lastIngestedSha: repository.lastIngestedSha,
  treeTruncated: repository.treeTruncated,
};

/**
 * A repository and every artifact AgentDock holds for it, listed or not.
 *
 * The limit is the scan's own file cap, taken from CAPS.maxFiles rather than
 * written as a literal: a repository cannot hold more indexed artifacts than one
 * pass was allowed to read, so this is bounded by construction. The literal it
 * replaces said 250, which was true when the cap was 200 and stopped being true
 * when Phase 4 raised it to 400 — a repository yielding 400 artifacts showed 250
 * of them on its own page, silently. Sourcing it here makes the next cap change
 * carry itself.
 *
 * listingOnly is false, and that is COR-07's other half: a suppressed artifact
 * stays reachable at its own URL, carrying the reason it is not in the listings.
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
    return {
      repository: row,
      packages: await listPackages({ fullName, limit: CAPS.maxFiles, listingOnly: false }),
    };
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
  /** package_version.id — the row capability_finding is keyed on, never packageTable.id. */
  packageVersionId: number;
  commitSha: string;
  declaredVersion: string | null;
  body: string | null;
  parseStatus: string;
  parseErrors: string[];
  ingestedAt: Date;
  /** Null means never analyzed (CAP-11) — distinct from analyzed-and-empty. */
  analyzedAt: Date | null;
  /** The file inventory, from src/analyze/files.ts. Empty until 04-01's Task 3 wires it. */
  files: FileEntry[];
  repositoryId: number;
  /** The containing plugin's root directory, from the nesting pass. Null when none. */
  parentPath: string | null;
  /** A command's `argument-hint` frontmatter value, as YAML parsed it. */
  argumentHint: unknown;
};

export const getPackageDetail = cache(
  async (owner: string, repo: string, segments: string[]): Promise<PackageDetail | null> => {
    const candidates = sourcePathCandidates(segments);
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
        files: packageTable.files,
        repositoryId: packageTable.repositoryId,
        parentPath: packageTable.parentPath,
        packageVersionId: packageVersion.id,
        commitSha: packageVersion.commitSha,
        declaredVersion: packageVersion.declaredVersion,
        body: packageVersion.body,
        parseStatus: packageVersion.parseStatus,
        parseErrors: packageVersion.parseErrors,
        ingestedAt: packageVersion.ingestedAt,
        analyzedAt: packageVersion.analyzedAt,
        // One key, not the frontmatter column: that is the whole parsed header.
        argumentHint: sql<unknown>`${packageVersion.frontmatter}->'argument-hint'`,
      })
      .from(packageTable)
      .innerJoin(repository, eq(packageTable.repositoryId, repository.id))
      .innerJoin(packageVersion, eq(packageVersion.packageId, packageTable.id))
      .where(
        and(
          isNull(packageTable.delistedAt),
          sql`lower(${repository.fullName}) = ${`${owner}/${repo}`.toLowerCase()}`,
          inArray(packageTable.sourcePath, candidates),
        ),
      )
      .orderBy(
        // A repository can hold both a literal path X and a skill at
        // X/SKILL.md — two distinct source_path values, both permitted by
        // package_identity. The literal match wins, stated here rather than
        // left to row order (decision 2, 06-01 plan).
        sql`case when ${packageTable.sourcePath} = ${candidates[0]} then 0 else 1 end`,
        // The latest version of that artifact, which is the one on the page.
        desc(packageVersion.ingestedAt),
      )
      .limit(1);
    return row ?? null;
  },
);

const MANIFEST_SUFFIX = '/.claude-plugin/plugin.json';

/**
 * The directory a plugin row roots, recovered from its own row: a declared
 * plugin's source_path is its manifest, a shape-only one's is the directory.
 * The inverse of what plugin.ts set as containerRoot. '' for a plugin that IS
 * the repository, which the nesting pass deliberately links nothing to.
 */
export function pluginRoot(sourcePath: string, meta: Record<string, unknown>): string {
  if (meta.detectionConfidence === 'shape-only') return sourcePath;
  if (sourcePath === '.claude-plugin/plugin.json') return '';
  return sourcePath.endsWith(MANIFEST_SUFFIX)
    ? sourcePath.slice(0, -MANIFEST_SUFFIX.length)
    : sourcePath;
}

export type RelatedPackage = {
  name: string;
  type: string;
  sourcePath: string;
};

/** How many of the rest of a repository the Related section names before linking to it. */
export const RELATED_LIMIT = 12;

export type RelatedPackages = {
  container: RelatedPackage | null;
  components: RelatedPackage[];
  /** Listed artifacts under the same plugin root as this one, this one excluded. */
  siblings: RelatedPackage[];
  /** Every other listed artifact in the repository, not in the three groups above. */
  elsewhere: RelatedPackage[];
  /** Totals before RELATED_LIMIT, so a cut list says what it left out. */
  siblingTotal: number;
  elsewhereTotal: number;
};

/**
 * The relations the ingest already recorded, and nothing inferred past them.
 *
 * package.parent_path is written by the nesting pass (src/detect/nesting.ts):
 * an artifact whose path sits under a plugin's root directory. That is a
 * directory fact, not a manifest declaration — a plugin.json that points its
 * `agents` or `skills` elsewhere is recorded as observed and never followed
 * (plugin.ts), so such a component is not linked here and the page says so.
 *
 * The rest of the repository is the one other fact every row carries:
 * repository_id. No similarity score, no ranking signal — siblings under the
 * same plugin root first, then by type and name, and the listing predicate
 * applies, so a fork or a suppressed duplicate is not offered as a next step
 * (it stays on the repository page with its reason). Three statements, in
 * parallel, each on the repository's own rows: the container, the components
 * (bounded by the scan cap), and the rest (bounded by RELATED_LIMIT, totals by
 * window function rather than a second count).
 */
export const getRelatedPackages = cache(
  async (
    detail: Pick<
      PackageDetail,
      'id' | 'repositoryId' | 'type' | 'sourcePath' | 'meta' | 'parentPath'
    >,
  ): Promise<RelatedPackages> => {
    const columns = {
      name: packageTable.name,
      type: packageTable.type,
      sourcePath: packageTable.sourcePath,
    };
    const live = and(
      eq(packageTable.repositoryId, detail.repositoryId),
      isNull(packageTable.delistedAt),
    );
    const root = detail.type === 'plugin' ? pluginRoot(detail.sourcePath, detail.meta) : '';
    const containerPaths = detail.parentPath
      ? [detail.parentPath, `${detail.parentPath}${MANIFEST_SUFFIX}`]
      : [];
    // One expression whatever parentPath is: a literal `false` in ORDER BY is a
    // "non-integer constant" error, and `is not distinct from null` would make
    // every top-level row a sibling. coalesce, because a bare `=` is NULL on a
    // top-level row and DESC sorts NULL first — ahead of the siblings, which
    // RELATED_LIMIT could then cut.
    const sibling = sql<boolean>`coalesce(${packageTable.parentPath} = ${detail.parentPath ?? null}, false)`;

    const [containerRows, components, rest] = await Promise.all([
      containerPaths.length > 0
        ? db
            .select(columns)
            .from(packageTable)
            .where(
              and(
                live,
                eq(packageTable.type, 'plugin'),
                inArray(packageTable.sourcePath, containerPaths),
              ),
            )
            .limit(1)
        : [],
      root !== ''
        ? db
            .select(columns)
            .from(packageTable)
            .where(and(live, eq(packageTable.parentPath, root)))
            .orderBy(packageTable.type, packageTable.name, packageTable.sourcePath)
            .limit(CAPS.maxFiles)
        : [],
      db
        .select({
          ...columns,
          sibling,
          total: sql<number>`(count(*) over ())::int`,
          siblings: sql<number>`(count(*) filter (where ${sibling}) over ())::int`,
        })
        .from(packageTable)
        .innerJoin(repository, eq(packageTable.repositoryId, repository.id))
        .where(
          and(
            live,
            sql`${packageTable.id} <> ${detail.id}`,
            // Already listed above as this plugin's components, or as its container.
            root !== '' ? sql`${packageTable.parentPath} is distinct from ${root}` : undefined,
            containerPaths.length > 0
              ? sql`not (${packageTable.type} = 'plugin' and ${inArray(packageTable.sourcePath, containerPaths)})`
              : undefined,
            sql`${NOT_LISTED_BECAUSE} is null`,
          ),
        )
        .orderBy(
          desc(sibling),
          packageTable.type,
          sql`lower(${packageTable.name})`,
          packageTable.id,
        )
        .limit(RELATED_LIMIT),
    ]);

    const strip = ({ name, type, sourcePath }: RelatedPackage) => ({ name, type, sourcePath });
    const siblingTotal = rest[0]?.siblings ?? 0;
    return {
      container: containerRows[0] ?? null,
      components,
      siblings: rest.filter((r) => r.sibling).map(strip),
      elsewhere: rest.filter((r) => !r.sibling).map(strip),
      siblingTotal,
      elsewhereTotal: (rest[0]?.total ?? 0) - siblingTotal,
    };
  },
);

export type VersionHistoryItem = {
  id: number;
  commitSha: string;
  ingestedAt: Date;
  declaredVersion: string | null;
  parseStatus: string;
  analyzedAt: Date | null;
  /** What makes a row distinct: sha-256 of what was read (pipeline.ts, contentHash). */
  contentHash: string;
};

/** The history list's length. A package with more says how many it left out. */
export const VERSION_HISTORY_LIMIT = 20;

/**
 * Every distinct content AgentDock stored for one artifact, latest first.
 *
 * One row per content hash, not per commit: identical content re-read is ON
 * CONFLICT DO NOTHING (package_version_content_key), and content that returns
 * to an earlier hash moves that row back to the top (persist.ts) — so this is
 * "what the file has been", never "every commit that touched it". Uses
 * package_version_recent_idx (package_id, ingested_at desc).
 */
export const getVersionHistory = cache(
  async (packageId: number): Promise<{ versions: VersionHistoryItem[]; total: number }> => {
    const versions = await db
      .select({
        id: packageVersion.id,
        commitSha: packageVersion.commitSha,
        ingestedAt: packageVersion.ingestedAt,
        declaredVersion: packageVersion.declaredVersion,
        parseStatus: packageVersion.parseStatus,
        analyzedAt: packageVersion.analyzedAt,
        contentHash: packageVersion.contentHash,
      })
      .from(packageVersion)
      .where(eq(packageVersion.packageId, packageId))
      .orderBy(desc(packageVersion.ingestedAt))
      .limit(VERSION_HISTORY_LIMIT);
    const total =
      versions.length < VERSION_HISTORY_LIMIT
        ? versions.length
        : ((
            await db
              .select({ n: sql<number>`count(*)::int` })
              .from(packageVersion)
              .where(eq(packageVersion.packageId, packageId))
          )[0]?.n ?? versions.length);
    return { versions, total };
  },
);
