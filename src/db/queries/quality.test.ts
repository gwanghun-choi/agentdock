import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// Writes, so it writes to the test schema — set before any import of it.
process.env.DATABASE_SCHEMA = 'agentdock_test';

const DB_URL = process.env.DATABASE_URL;

// Sentinel prefix. Every repository-scoped rule is run with `repo: PREFIX`, so
// rows other suites leave behind cannot move these numbers; the corpus-wide
// figures (the ops report, the listing agreement) are asserted as deltas.
const PREFIX = 'test-owner/quality-spec';

/**
 * The read-only operator reports (scripts/ops.mjs) against hand-built rows:
 * one of each thing a rule must catch, and the look-alikes it must not —
 * the same file in two repositories, the same name in two repositories, a path
 * with `#` and a space in it. The rules exist to be trusted at a glance, so a
 * false violation on ordinary data is as much a failure as a missed one.
 *
 * Its ingest_job rows are terminal (`failed`, `succeeded`) and never queued,
 * so claimJob in jobs.test.ts cannot pick one up.
 */
describe.skipIf(!DB_URL)('the operator reports', () => {
  let quality: typeof import('./quality');
  let ops: typeof import('./opsReport');
  let sql: typeof import('@/db/client').sql;

  async function clean() {
    await sql`DELETE FROM ingest_job WHERE target LIKE ${`${PREFIX}%`}`;
    await sql`DELETE FROM package WHERE repository_id IN (
      SELECT id FROM repository WHERE full_name LIKE ${`${PREFIX}%`})`;
    await sql`DELETE FROM repository WHERE full_name LIKE ${`${PREFIX}%`}`;
  }

  beforeAll(async () => {
    quality = await import('./quality');
    ops = await import('./opsReport');
    ({ sql } = await import('@/db/client'));
    await clean();
  });
  afterAll(async () => {
    await clean();
    await sql.end();
  });
  beforeEach(clean);

  let seq = 0;
  async function repo(
    name: string,
    { truncated = false, scannedDaysAgo = 0 as number | null, failures = 0 } = {},
  ): Promise<number> {
    seq += 1;
    const [row] = await sql<{ id: number }[]>`
      INSERT INTO repository (github_node_id, full_name, owner, default_branch, tree_truncated,
                              scanned_at, last_ingested_sha, check_failures)
      VALUES (${`node-${PREFIX}-${name}-${seq}`}, ${`${PREFIX}-${name}`}, 'test-owner', 'main',
              ${truncated},
              ${scannedDaysAgo === null ? null : sql`now() - make_interval(days => ${scannedDaysAgo})`},
              ${scannedDaysAgo === null ? null : 'c'.repeat(40)}, ${failures})
      RETURNING id`;
    return Number(row.id);
  }

  async function artifact(
    repositoryId: number,
    sourcePath: string,
    {
      type = 'skill',
      name = sourcePath,
      hashes = [`h-${repositoryId}-${sourcePath}`],
      status = 'ok',
      parentPath = null as string | null,
      delisted = false,
    } = {},
  ): Promise<number> {
    const [row] = await sql<{ id: number }[]>`
      INSERT INTO package (repository_id, type, source_path, name, slug, parent_path, delisted_at)
      VALUES (${repositoryId}, ${type}, ${sourcePath}, ${name}, ${name}, ${parentPath},
              ${delisted ? sql`now()` : null})
      RETURNING id`;
    const id = Number(row.id);
    for (const [i, hash] of hashes.entries()) {
      await sql`
        INSERT INTO package_version (package_id, commit_sha, content_hash, parse_status,
                                     analyzed_at, ingested_at)
        VALUES (${id}, ${'c'.repeat(40)}, ${hash}, ${status}, now(),
                now() - make_interval(hours => ${hashes.length - i}))`;
    }
    return id;
  }

  const run = (staleDays = 14) =>
    quality.runQualityChecks({ repo: PREFIX, staleDays, sampleSize: 50 });
  const byId = async (staleDays?: number) =>
    Object.fromEntries((await run(staleDays)).map((c) => [c.id, c]));

  it('ordinary data — including look-alikes — violates nothing', async () => {
    const a = await repo('a');
    const b = await repo('b');
    // The same file published by two repositories, and the same name in two.
    await artifact(a, 'skills/x/SKILL.md', { name: 'copy-a', hashes: ['shared'] });
    await artifact(b, 'skills/x/SKILL.md', { name: 'copy-b', hashes: ['shared'] });
    await artifact(a, 'skills/y/SKILL.md', { name: 'helper' });
    await artifact(b, 'other/SKILL.md', { name: 'helper' });
    // Characters a URL has to encode are not a malformed path.
    await artifact(a, '.claude/commands/c#-review.md', { type: 'command' });
    await artifact(a, 'skills/with space/SKILL.md');
    // A plugin and its component, linked as the nesting pass writes it.
    await artifact(a, 'plugins/p/.claude-plugin/plugin.json', { type: 'plugin' });
    await artifact(a, 'plugins/p/skills/s/SKILL.md', { parentPath: 'plugins/p' });

    const checks = await run();
    expect(checks.filter((c) => c.kind === 'violation' && c.count > 0)).toEqual([]);

    const c = Object.fromEntries(checks.map((x) => [x.id, x]));
    expect(c['same-content-other-repositories'].count).toBe(2);
    expect(c['same-content-other-repositories'].kind).toBe('observation');
    expect(c['same-name-other-repositories'].samples).toEqual([
      { label: 'skill:helper in 2 repositories', n: 2 },
    ]);
    // Two copies of one file: one is listed, the other is the duplicate.
    expect(c['not-listed'].samples).toEqual([{ label: 'duplicate', n: 1 }]);
  });

  it('catches each integrity violation, naming the row', async () => {
    const r = await repo('broken');
    const [orphan] = await sql<{ id: number }[]>`
      INSERT INTO package (repository_id, type, source_path, name, slug)
      VALUES (${r}, 'skill', 'orphan/SKILL.md', 'orphan', 'orphan') RETURNING id`;
    expect(orphan).toBeDefined();
    await artifact(r, 'plugins/gone/skills/s/SKILL.md', { parentPath: 'plugins/gone' });
    await artifact(r, '../escape/SKILL.md');
    await artifact(r, 'ctl\u0007/SKILL.md');
    await artifact(r, 'blank/SKILL.md', { name: '  ' });
    const v = await artifact(r, 'finding/SKILL.md');
    await sql`
      INSERT INTO capability_finding (package_version_id, detector_id, detector_version, category,
                                      signal, summary, source_path, commit_sha)
      SELECT id, 'd', '1', 'network_request', 's', 'references x', 'finding/SKILL.md', ${'d'.repeat(40)}
      FROM package_version WHERE package_id = ${v}`;
    const unread = await repo('unread', { scannedDaysAgo: null });
    await artifact(unread, 'a/SKILL.md');

    const c = await byId();
    const label = `${PREFIX}-broken`;
    expect(c['package-without-version'].samples).toEqual([
      { label: `${label} orphan/SKILL.md`, n: 1 },
    ]);
    expect(c['parent-plugin-missing'].samples[0].label).toBe(
      `${label} plugins/gone/skills/s/SKILL.md (parent plugins/gone)`,
    );
    expect(c['source-path-shape'].samples.map((s) => s.label)).toEqual([
      `${label} ../escape/SKILL.md`,
      `${label} ctl\u0007/SKILL.md`,
    ]);
    expect(c['blank-name'].count).toBe(1);
    expect(c['finding-commit-mismatch'].count).toBe(1);
    expect(c['artifacts-without-read-date'].samples).toEqual([{ label: `${PREFIX}-unread`, n: 1 }]);
  });

  it('a missing parent on a partial read is an observation, not a violation', async () => {
    const r = await repo('partial', { truncated: true });
    await artifact(r, 'plugins/p/skills/s/SKILL.md', { parentPath: 'plugins/p' });
    const c = await byId();
    expect(c['parent-plugin-missing'].count).toBe(0);
    expect(c['parent-plugin-not-read'].count).toBe(1);
    expect(c['partial-reads'].samples).toEqual([{ label: `${PREFIX}-partial`, n: 1 }]);
  });

  it('freshness: read age, stale reads and failing checks, from scanned_at and check_failures', async () => {
    await repo('fresh');
    await repo('week', { scannedDaysAgo: 3 });
    await repo('stale', { scannedDaysAgo: 40, failures: 2 });
    await repo('never', { scannedDaysAgo: null });

    const c = await byId(14);
    expect(c['read-age'].samples).toEqual([
      { label: '1 within 1 day', n: 1 },
      { label: '2 within 7 days', n: 1 },
      { label: '4 over 30 days', n: 1 },
      { label: '5 never read', n: 1 },
    ]);
    expect(c['not-read-recently'].count).toBe(1);
    expect(c['not-read-recently'].samples[0].label).toMatch(
      new RegExp(`^${PREFIX}-stale read \\d{4}-\\d{2}-\\d{2}$`),
    );
    expect(c['checks-failing'].samples).toEqual([{ label: `${PREFIX}-stale (2 in a row)`, n: 1 }]);
    // The window is the operator's: 60 days makes the same row recent enough.
    expect((await byId(60))['not-read-recently'].count).toBe(0);
  });

  it('parse status, delisting and failed jobs are reported as they are stored', async () => {
    const r = await repo('ingest');
    await artifact(r, 'ok/SKILL.md');
    await artifact(r, 'bad/SKILL.md', { status: 'failed' });
    await artifact(r, 'gone/SKILL.md', { delisted: true });
    const [job] = await sql<{ id: number }[]>`
      INSERT INTO ingest_job (target, status, attempts, finished_at)
      VALUES (${`${PREFIX}-gone-repo`}, 'failed', 3, now()) RETURNING id`;
    for (const [no, outcome] of [
      [1, 'unavailable'],
      [2, 'unavailable'],
      [3, 'unreadable'],
    ] as const) {
      await sql`INSERT INTO ingest_attempt (job_id, attempt_no, started_at, outcome)
                VALUES (${job.id}, ${no}, now(), ${outcome})`;
    }

    const c = await byId();
    expect(c['latest-parse-status'].samples).toEqual([
      { label: 'failed', n: 1 },
      { label: 'ok', n: 1 },
    ]);
    expect(c['not-listed'].samples).toEqual([{ label: 'unparsed', n: 1 }]);
    expect(c.delisted.samples).toEqual([{ label: `${PREFIX}-ingest gone/SKILL.md`, n: 1 }]);
    // By the LAST attempt's outcome, not the first.
    expect(c['failed-jobs'].samples).toEqual([{ label: 'unreadable', n: 1 }]);
    expect(c['retries-exhausted'].samples).toEqual([{ label: `${PREFIX}-gone-repo`, n: 1 }]);
  });

  it('a scope that matches nothing reports zeros, and a LIKE wildcard in it is literal', async () => {
    const r = await repo('scoped');
    await artifact(r, 'a/SKILL.md');
    const checks = await quality.runQualityChecks({ repo: `${PREFIX}%`, staleDays: 14 });
    expect(checks.every((c) => c.count === 0)).toBe(true);
  });

  it('corpus-wide, the three listing totals agree', async () => {
    const all = await quality.runQualityChecks({ staleDays: 14 });
    expect(all.find((c) => c.id === 'listing-counts-agree')?.count).toBe(0);
  });

  it('the ops report counts jobs by current status and attempts inside the window', async () => {
    const read = () => ops.readSyncReport({ windowHours: 24, reapAfterMs: 60 * 60_000 });
    const before = await read();

    const r = await repo('ops');
    await artifact(r, 'new/SKILL.md');
    await artifact(r, 'changed/SKILL.md', { hashes: ['v1', 'v2'] });
    // An old artifact whose only version is old is neither added nor changed.
    const old = await artifact(r, 'old/SKILL.md');
    await sql`UPDATE package SET created_at = now() - interval '3 days' WHERE id = ${old}`;
    await sql`UPDATE package_version SET ingested_at = now() - interval '3 days' WHERE package_id = ${old}`;
    await sql`UPDATE package SET created_at = now() - interval '2 days'
              WHERE repository_id = ${r} AND source_path = 'changed/SKILL.md'`;

    const jobs = await sql<{ id: number }[]>`
      INSERT INTO ingest_job (target, status, attempts, started_at) VALUES
        (${`${PREFIX}-ops-1`}, 'succeeded', 1, null),
        (${`${PREFIX}-ops-2`}, 'failed', 1, null),
        (${`${PREFIX}-ops-3`}, 'running', 1, now() - interval '2 hours')
      RETURNING id`;
    await sql`INSERT INTO ingest_attempt (job_id, attempt_no, started_at, finished_at, outcome,
                                         artifacts_new, truncated) VALUES
      (${jobs[0].id}, 1, now() - interval '10 seconds', now(), 'ok', 2, true),
      (${jobs[1].id}, 1, now() - interval '2 seconds', now(), 'unreadable', 0, false),
      (${jobs[1].id}, 2, now() - interval '30 hours', now() - interval '30 hours', 'ok', 5, false)`;

    const after = await read();
    expect(after.queue.succeeded - before.queue.succeeded).toBe(1);
    expect(after.queue.failed - before.queue.failed).toBe(1);
    expect(after.queue.running - before.queue.running).toBe(1);
    // Two hours running against a one-hour reaper cutoff.
    expect(after.queue.runningAbandoned - before.queue.runningAbandoned).toBe(1);
    // The 30-hour-old attempt is outside the window and counts nowhere.
    expect(after.attempts.total - before.attempts.total).toBe(2);
    expect(
      (after.attempts.byOutcome.unreadable ?? 0) - (before.attempts.byOutcome.unreadable ?? 0),
    ).toBe(1);
    expect(after.attempts.artifactsNew - before.attempts.artifactsNew).toBe(2);
    expect(after.attempts.truncated - before.attempts.truncated).toBe(1);
    expect(after.artifacts.addedInWindow - before.artifacts.addedInWindow).toBe(1);
    expect(after.artifacts.changedInWindow - before.artifacts.changedInWindow).toBe(1);
    expect(after.artifacts.held - before.artifacts.held).toBe(3);
  });
});
