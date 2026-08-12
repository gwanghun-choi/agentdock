import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { cache } from 'react';
import type { FileEntry } from '@/analyze/types';
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
 * ponytail: `CREATE INDEX ON package_version (content_hash)` takes this from
 * 25.5 ms to 7.1 ms, both measured at 971 packages / 971 versions. Not built —
 * the gate is 100 ms and the rewrite clears it by a factor of four without
 * spending a migration. Build it when a measured listing crosses 100 ms again.
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

/** github.com/{full_name}/blob/{commit sha}/{path} — never the tree sha. */
export function permalink(fullName: string, commitSha: string, sourcePath: string): string {
  return `https://github.com/${fullName}/blob/${commitSha}/${sourcePath}`;
}

/**
 * permalink() plus GitHub's line fragment. Omits the fragment when the
 * finding is a structured declaration with no line, rather than emitting
 * #Lnull. Kept beside permalink() so the two conventions — the URL shape and
 * its line-anchored extension — cannot drift apart.
 */
export function permalinkAtLine(
  fullName: string,
  commitSha: string,
  sourcePath: string,
  line: number | null,
): string {
  const base = permalink(fullName, commitSha, sourcePath);
  return line === null ? base : `${base}#L${line}`;
}

/**
 * The literal candidates for a URL's stored source_path, in resolution order.
 *
 * source_path IS the URL for every non-skill artifact today — a shape-only
 * plugin has no manifest file at all, so "append this type's manifest
 * filename" has no value to append for that case. The literal join is tried
 * first; the historical `/SKILL.md` reconstruction is tried second, purely so
 * an existing skill permalink keeps resolving. getPackageDetail's ORDER BY
 * states which one wins when a repository holds both.
 *
 * Replaces sourcePathFromUrl, which unconditionally appended `/SKILL.md` and
 * so 404'd every command, plugin, hook and mcp_server detail link.
 */
export function sourcePathCandidates(segments: string[]): string[] {
  const joined = segments.join('/');
  // A manifest at the repository root has no directory, so the URL carries
  // the filename itself and there is nothing to reconstruct.
  if (joined === '' || joined === 'SKILL.md') return ['SKILL.md'];
  return [joined, `${joined}/SKILL.md`];
}

/**
 * The inverse, for rendering a link. Kept beside its counterpart so the two
 * cannot drift apart.
 *
 * `skill` keeps its existing prettier directory URL — the strip-`SKILL.md`
 * behaviour is byte-identical to what shipped before this change, so no
 * published skill link breaks. Every other type's URL tail is its literal
 * source_path, unmodified: there is no per-type suffix to add or strip.
 *
 * Each path segment is percent-encoded individually and rejoined, never the
 * whole tail at once — encoding the whole string would encode the `/`
 * separators too and truncate/break every link at once on a hostile
 * character such as `#` or `?`.
 */
export function detailHref(fullName: string, sourcePath: string, type: string): string {
  const tail =
    type === 'skill'
      ? (() => {
          const dir = sourcePath.replace(/(^|\/)SKILL\.md$/, '');
          return dir === '' ? 'SKILL.md' : dir;
        })()
      : sourcePath;
  const encoded = tail
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `/r/${fullName}/${encoded}`;
}

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
        packageVersionId: packageVersion.id,
        commitSha: packageVersion.commitSha,
        declaredVersion: packageVersion.declaredVersion,
        body: packageVersion.body,
        parseStatus: packageVersion.parseStatus,
        parseErrors: packageVersion.parseErrors,
        ingestedAt: packageVersion.ingestedAt,
        analyzedAt: packageVersion.analyzedAt,
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
