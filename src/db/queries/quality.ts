import { type SQL, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { countPackages, countPackagesByType, NOT_LISTED_BECAUSE } from '@/db/queries/packages';
import { countSearchResults } from '@/db/queries/search';
import {
  capabilityFinding,
  ingestAttempt,
  ingestJob,
  packageTable,
  packageVersion,
  repository,
} from '@/db/schema';
import { MAX_ATTEMPTS } from '@/ingest/retry';

/**
 * `bun run quality:check`: what the stored corpus says about itself. Read-only
 * and deterministic — every sample is ordered, every count is counted, and
 * nothing is repaired, re-queued or deleted. A finding is something for an
 * operator to look at, with the rule that produced it.
 *
 * Two kinds of check, and the difference is the exit code:
 *
 * - `violation`: a state the code is meant to make impossible — an artifact
 *   with no version (its page 404s), a parent plugin that is not there, a
 *   listing count two pages disagree on. Expected to be 0; any is exit 1.
 * - `observation`: a fact about the corpus that is allowed and worth seeing —
 *   rows the listing leaves out and why, the same file in two repositories,
 *   repositories not read for a while, jobs that ended failed.
 *
 * Constraint-backed facts are not re-checked here, because PostgreSQL already
 * refuses the rows: one package per (repository, type, path)
 * (package_identity), one version per content hash per package
 * (package_version_content_key), one active job per repository
 * (ingest_job_active_key), and every type existing (artifact_type FK).
 *
 * Content hash equality across repositories is NOT a violation. Two
 * repositories may publish the same skill; NOT_LISTED_BECAUSE lists one copy
 * and keeps the other at its own URL, and that is the identity policy.
 */

export type QualityCheck = {
  id: string;
  kind: 'violation' | 'observation';
  about: string;
  /** Rows the rule matched (a breakdown: the sum of its groups). */
  count: number;
  /** Up to sampleSize matches or groups, ordered, so two runs print the same lines. */
  samples: { label: string; n: number }[];
};

type Rule = {
  id: string;
  kind: QualityCheck['kind'];
  about: string;
  /** Selects `label` and `n`; `breakdown` rules group, the others list one row each. */
  query: SQL;
  breakdown?: boolean;
};

/** A LIKE prefix: an operator's `owner/repo` or `owner/`, never a pattern. */
function prefixPattern(repo: string): string {
  return `${repo.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export async function runQualityChecks({
  repo,
  staleDays,
  sampleSize = 5,
  now = new Date(),
}: {
  /** Restrict every repository-scoped rule to names starting with this. */
  repo?: string;
  staleDays: number;
  sampleSize?: number;
  now?: Date;
}): Promise<QualityCheck[]> {
  const nowIso = now.toISOString();
  const inScope = repo ? sql`lower(${repository.fullName}) like ${prefixPattern(repo)}` : sql`true`;
  const jobScope = repo ? sql`${ingestJob.target} like ${prefixPattern(repo)}` : sql`true`;
  const live = sql`${packageTable.delistedAt} is null`;
  const latest = (column: SQL) => sql`(
    select ${column} from ${packageVersion} v
    where v.package_id = ${packageTable.id} order by v.ingested_at desc limit 1
  )`;
  const where = (...parts: SQL[]) => sql.join(parts, sql` and `);
  const artifactLabel = sql`${repository.fullName} || ' ' || ${packageTable.sourcePath}`;
  const fromPackages = sql`from ${packageTable}
    join ${repository} on ${repository.id} = ${packageTable.repositoryId}`;

  const rules: Rule[] = [
    {
      id: 'package-without-version',
      kind: 'violation',
      about: 'listed artifact with no stored version — its page returns 404',
      query: sql`select ${artifactLabel} as label, 1 as n ${fromPackages}
        where ${where(
          live,
          inScope,
          sql`not exists (
          select 1 from ${packageVersion} v where v.package_id = ${packageTable.id})`,
        )}`,
    },
    // Split on tree_truncated, measured on the e2e corpus 2026-10-22: all 20
    // rows were wshobson/agents skills whose plugin.json the read never
    // fetched. The nesting pass links by directory over the whole tree, and a
    // capped read can store a plugin's skills without its manifest — so on a
    // partial read this is expected, and anywhere else it is unexplained.
    ...([false, true] as const).map(
      (partial): Rule => ({
        id: partial ? 'parent-plugin-not-read' : 'parent-plugin-missing',
        kind: partial ? 'observation' : 'violation',
        about: partial
          ? "parent_path names a plugin the repository's partial read did not store (manifest not among the files read)"
          : 'parent_path names a plugin directory with no live plugin row, in a repository read in full',
        query: sql`select ${artifactLabel} || ' (parent ' || ${packageTable.parentPath} || ')' as label,
            1 as n ${fromPackages}
          where ${where(
            live,
            inScope,
            partial ? sql`${repository.treeTruncated}` : sql`not ${repository.treeTruncated}`,
            sql`${packageTable.parentPath} is not null`,
            sql`not exists (
              select 1 from ${packageTable} parent
              where parent.repository_id = ${packageTable.repositoryId}
                and parent.type = 'plugin' and parent.delisted_at is null
                and parent.source_path in (${packageTable.parentPath},
                  ${packageTable.parentPath} || '/.claude-plugin/plugin.json'))`,
          )}`,
      }),
    ),
    {
      id: 'source-path-shape',
      kind: 'violation',
      about:
        'source_path that is empty, absolute, has an empty, "." or ".." segment, a backslash or a control character',
      query: sql`select ${artifactLabel} as label, 1 as n ${fromPackages}
        where ${where(
          live,
          inScope,
          sql`(${packageTable.sourcePath} = '' or ${packageTable.sourcePath} ~ ${'(^/|//|(^|/)\\.\\.?(/|$)|/$)'}
            or ${packageTable.sourcePath} ~ ${'[\\x01-\\x1f\\x7f\\\\]'})`,
        )}`,
    },
    {
      id: 'blank-name',
      kind: 'violation',
      about: 'artifact whose name or slug is blank — nothing to link or search by',
      query: sql`select ${artifactLabel} as label, 1 as n ${fromPackages}
        where ${where(live, inScope, sql`(btrim(${packageTable.name}) = '' or btrim(${packageTable.slug}) = '')`)}`,
    },
    {
      id: 'finding-commit-mismatch',
      kind: 'violation',
      about: "capability finding whose commit_sha is not its version's",
      query: sql`select ${artifactLabel} || ' finding ' || f.id as label, 1 as n
        from ${capabilityFinding} f
        join ${packageVersion} v on v.id = f.package_version_id
        join ${packageTable} on ${packageTable.id} = v.package_id
        join ${repository} on ${repository.id} = ${packageTable.repositoryId}
        where ${where(inScope, sql`f.commit_sha <> v.commit_sha`)}`,
    },
    {
      id: 'artifacts-without-read-date',
      kind: 'violation',
      about: 'repository holding live artifacts with no scanned_at or no last_ingested_sha',
      query: sql`select ${repository.fullName} as label, 1 as n from ${repository}
        where ${where(
          inScope,
          sql`(${repository.scannedAt} is null or ${repository.lastIngestedSha} is null)`,
          sql`exists (select 1 from ${packageTable} p
            where p.repository_id = ${repository.id} and p.delisted_at is null)`,
        )}`,
    },
    {
      id: 'not-listed',
      kind: 'observation',
      about: "held but left out of listings, by NOT_LISTED_BECAUSE's reason (still at its own URL)",
      breakdown: true,
      query: sql`select reason as label, count(*)::int as n from (
          select ${NOT_LISTED_BECAUSE} as reason ${fromPackages} where ${where(live, inScope)}
        ) t where reason is not null group by reason`,
    },
    {
      id: 'same-content-other-repositories',
      kind: 'observation',
      about:
        'artifacts whose latest content hash appears in two or more repositories (duplicate suppression input, not an error)',
      breakdown: true,
      query: sql`select left(h, 12) || ' in ' || count(distinct repo) || ' repositories' as label,
          count(*)::int as n from (
          select ${latest(sql`v.content_hash`)} as h, ${packageTable.repositoryId} as repo
          ${fromPackages}
          where ${where(live, inScope, sql`${packageTable.meta}->>'detectionConfidence' is distinct from 'shape-only'`)}
        ) t group by h having count(distinct repo) > 1`,
    },
    {
      id: 'same-name-other-repositories',
      kind: 'observation',
      about:
        'artifacts whose type and name appear in two or more repositories (allowed; not merged)',
      breakdown: true,
      query: sql`select ${packageTable.type} || ':' || lower(${packageTable.name}) || ' in '
          || count(distinct ${packageTable.repositoryId}) || ' repositories' as label,
          count(*)::int as n ${fromPackages}
        where ${where(live, inScope)}
        group by ${packageTable.type}, lower(${packageTable.name})
        having count(distinct ${packageTable.repositoryId}) > 1`,
    },
    {
      id: 'read-age',
      kind: 'observation',
      about: 'stored repositories by how long ago AgentDock last read them (scanned_at)',
      breakdown: true,
      query: sql`select case
          when ${repository.scannedAt} is null then '5 never read'
          when ${repository.scannedAt} >= ${nowIso}::timestamptz - interval '1 day' then '1 within 1 day'
          when ${repository.scannedAt} >= ${nowIso}::timestamptz - interval '7 days' then '2 within 7 days'
          when ${repository.scannedAt} >= ${nowIso}::timestamptz - interval '30 days' then '3 within 30 days'
          else '4 over 30 days' end as label, count(*)::int as n
        from ${repository} where ${inScope} group by 1`,
    },
    {
      id: 'not-read-recently',
      kind: 'observation',
      about: `repositories not read in ${staleDays} days, oldest first (refresh order is coalesce(checked_at, scanned_at))`,
      query: sql`select ${repository.fullName} || ' read ' || to_char(${repository.scannedAt} at time zone 'UTC', 'YYYY-MM-DD')
          || coalesce(', checked ' || to_char(${repository.checkedAt} at time zone 'UTC', 'YYYY-MM-DD'), '') as label,
          1 as n from ${repository}
        where ${where(
          inScope,
          sql`${repository.scannedAt} < ${nowIso}::timestamptz - make_interval(days => ${staleDays})`,
        )}`,
    },
    {
      id: 'checks-failing',
      kind: 'observation',
      about:
        'stored repositories whose last check read nothing (check_failures > 0); their artifacts stay listed',
      query: sql`select ${repository.fullName} || ' (' || ${repository.checkFailures} || ' in a row)' as label,
          1 as n from ${repository}
        where ${where(inScope, sql`${repository.checkFailures} > 0`)}`,
    },
    {
      id: 'partial-reads',
      kind: 'observation',
      about: 'repositories whose last read hit the tree or file-read cap (tree_truncated)',
      query: sql`select ${repository.fullName} as label, 1 as n from ${repository}
        where ${where(inScope, sql`${repository.treeTruncated}`)}`,
    },
    {
      id: 'delisted',
      kind: 'observation',
      about: 'artifacts delisted because a later read no longer found them',
      query: sql`select ${artifactLabel} as label, 1 as n ${fromPackages}
        where ${where(inScope, sql`${packageTable.delistedAt} is not null`)}`,
    },
    {
      id: 'latest-parse-status',
      kind: 'observation',
      about:
        "live artifacts by their latest version's parse_status (failed is left out of listings)",
      breakdown: true,
      query: sql`select status as label, count(*)::int as n from (
          select ${latest(sql`v.parse_status`)} as status ${fromPackages} where ${where(live, inScope)}
        ) t group by status`,
    },
    {
      id: 'latest-not-analyzed',
      kind: 'observation',
      about: 'live artifacts whose latest version was stored without analysis (analyzed_at null)',
      query: sql`select ${artifactLabel} as label, 1 as n ${fromPackages}
        where ${where(live, inScope, sql`${latest(sql`v.analyzed_at`)} is null`)}`,
    },
    {
      id: 'failed-jobs',
      kind: 'observation',
      about: 'ingest jobs that ended failed, by the outcome of their last attempt',
      breakdown: true,
      query: sql`select coalesce((
          select a.outcome from ${ingestAttempt} a where a.job_id = ${ingestJob.id}
          order by a.attempt_no desc limit 1), 'no attempt recorded') as label,
          count(*)::int as n from ${ingestJob}
        where ${where(jobScope, sql`${ingestJob.status} = 'failed'`)} group by 1`,
    },
    {
      id: 'retries-exhausted',
      kind: 'observation',
      about: `failed jobs that used all ${MAX_ATTEMPTS} attempts`,
      query: sql`select ${ingestJob.target} as label, 1 as n from ${ingestJob}
        where ${where(
          jobScope,
          sql`${ingestJob.status} = 'failed'`,
          sql`${ingestJob.attempts} >= ${MAX_ATTEMPTS}`,
        )}`,
    },
  ];

  const checks = await Promise.all(
    rules.map(async (rule): Promise<QualityCheck> => {
      const rows = (await db.execute(
        sql`select label, n::int as n, (${rule.breakdown ? sql`sum(n) over ()` : sql`count(*) over ()`})::int as total
          from (${rule.query}) matched order by label collate "C" limit ${sampleSize}`,
      )) as unknown as { label: string; n: number; total: number }[];
      // The window runs before LIMIT, so `total` covers every match, not the
      // sample. Byte order (collate "C"), so the sample is the same on every
      // server rather than following each database's locale.
      return {
        id: rule.id,
        kind: rule.kind,
        about: rule.about,
        count: rows[0]?.total ?? 0,
        samples: rows.map((r) => ({ label: r.label, n: r.n })),
      };
    }),
  );

  // The listing predicate, read through the three surfaces a visitor sees it
  // by: the home page's total, the search route with no query, and the type
  // cards. They share NOT_LISTED_BECAUSE by construction; this is the check
  // that they still do on this data. Corpus-wide only.
  if (!repo) {
    const [listed, browse, byType] = await Promise.all([
      countPackages(),
      countSearchResults({ q: '' }),
      countPackagesByType(),
    ]);
    const typed = Object.values(byType).reduce((n, v) => n + v, 0);
    const agree = listed === browse && listed === typed;
    checks.push({
      id: 'listing-counts-agree',
      kind: 'violation',
      about: 'home total, unfiltered search total and per-type total must be one number',
      count: agree ? 0 : 1,
      samples: [{ label: `home ${listed}, search ${browse}, by type ${typed}`, n: agree ? 0 : 1 }],
    });
  }
  return checks;
}
