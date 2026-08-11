import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { RepoMetadata } from '@/github/types';
import type { RepoScan, ScannedPackage, ScannedSeed } from './types';

// Database-backed tests write, so they write to the test schema. The schema
// module reads this at import time, hence the assignment before any import of
// it. Vitest isolates files into separate workers, so this cannot leak.
process.env.DATABASE_SCHEMA = 'agentdock_test';

const DB_URL = process.env.DATABASE_URL;
const NODE_ID = 'TEST_NODE_ID_persist_spec';
// Sentinel too, and for the same reason the node id is one. `repository` carries
// a unique index on lower(full_name), and vitest runs test FILES in parallel
// against the one test schema — so a synthetic suite that borrows a real
// repository's name collides with any suite that ingests that repository for
// real. The identity under test here is the node id; the name is scenery.
const FULL_NAME = 'test-owner/persist-spec';
const COMMIT = 'f17010c9bb483898c1d9c9f42dde2b3a98889434';
// Sentinel for the same reason, and always inserted `running`: the queue suite
// shares this schema and its claim takes the oldest claimable row anywhere in
// it, so a `queued` row left here would be a row that suite claims by mistake.
const JOB_TARGET = 'test-owner/persist-spec-job';

function pkg(overrides: Partial<ScannedPackage> = {}): ScannedPackage {
  return {
    type: 'skill',
    sourcePath: 'skills/canvas-design/SKILL.md',
    name: 'canvas-design',
    slug: 'canvas-design',
    summary: 'a summary',
    licenseText: null,
    meta: {},
    blobSha: null,
    contentHash: 'hash-a',
    declaredVersion: null,
    body: 'body',
    frontmatter: { name: 'canvas-design' },
    parseStatus: 'ok',
    parseErrors: [],
    parentPath: null,
    ...overrides,
  };
}

/** Three distinct artifacts, so "a subset was read" is expressible. */
function three(): ScannedPackage[] {
  return ['a', 'b', 'c'].map((n) =>
    pkg({ sourcePath: `skills/${n}/SKILL.md`, name: n, slug: n, contentHash: `hash-${n}` }),
  );
}

// Sentinel, for the same reason FULL_NAME is one: repo_seed carries a unique
// index on full_name, and vitest runs test files in parallel against the one
// test schema.
const SEED_NAME = 'persist-spec-seed-owner/persist-spec-seed-repo';

function seed(overrides: Partial<ScannedSeed> = {}): ScannedSeed {
  return {
    fullName: SEED_NAME,
    sourceKind: 'github',
    discoveredFrom: FULL_NAME,
    discoveredPath: '.claude-plugin/marketplace.json',
    hint: { name: 'seed-repo' },
    ...overrides,
  };
}

function scan(overrides: Partial<RepoScan> = {}): RepoScan {
  return {
    githubNodeId: NODE_ID,
    fullName: FULL_NAME,
    owner: 'test-owner',
    defaultBranch: 'main',
    description: null,
    homepage: null,
    licenseSpdx: null,
    stars: 1,
    isFork: false,
    isArchived: false,
    topics: [],
    pushedAt: null,
    scannedAt: new Date(),
    etag: null,
    commitSha: COMMIT,
    treeTruncated: false,
    packages: [pkg()],
    seeds: [],
    ...overrides,
  };
}

/** The metadata half of the same repository, as the no-change path receives it. */
function metadata(overrides: Partial<RepoMetadata> = {}): RepoMetadata {
  return {
    githubNodeId: NODE_ID,
    fullName: FULL_NAME,
    owner: 'test-owner',
    defaultBranch: 'main',
    description: null,
    homepage: null,
    licenseSpdx: null,
    stars: 1,
    isFork: false,
    isArchived: false,
    topics: [],
    pushedAt: null,
    etag: null,
    ...overrides,
  };
}

describe.skipIf(!DB_URL)('persistScan', () => {
  let persistScan: typeof import('./persist').persistScan;
  let sql: typeof import('@/db/client').sql;

  /** Live packages this suite's repository currently lists, by path. */
  async function livePaths(): Promise<string[]> {
    const rows = await sql<{ source_path: string }[]>`
      SELECT p.source_path FROM package p
      JOIN repository r ON r.id = p.repository_id
      WHERE r.github_node_id = ${NODE_ID} AND p.delisted_at IS NULL
      ORDER BY p.source_path
    `;
    return rows.map((r) => r.source_path);
  }

  beforeAll(async () => {
    ({ persistScan } = await import('./persist'));
    ({ sql } = await import('@/db/client'));
  });

  /** A job already claimed by a worker that is still alive. */
  async function runningJob(): Promise<number> {
    const [row] = await sql<{ id: number }[]>`
      INSERT INTO ingest_job (target, status, attempts, started_at, worker_id)
      VALUES (${JOB_TARGET}, 'running', 1, now(), 'persist-spec')
      RETURNING id
    `;
    return row.id;
  }

  afterAll(async () => {
    await sql`DELETE FROM repository WHERE github_node_id = ${NODE_ID}`;
    await sql`DELETE FROM ingest_job WHERE target = ${JOB_TARGET}`;
    await sql`DELETE FROM repo_seed WHERE full_name = ${SEED_NAME}`;
    await sql`DELETE FROM repository_denylist WHERE full_name = ${SEED_NAME}`;
    await sql.end();
  });

  // Every test starts from an empty repository, so none of them depends on the
  // order the others ran in.
  beforeEach(async () => {
    await sql`DELETE FROM repository WHERE github_node_id = ${NODE_ID}`;
    await sql`DELETE FROM ingest_job WHERE target = ${JOB_TARGET}`;
    await sql`DELETE FROM repo_seed WHERE full_name = ${SEED_NAME}`;
    await sql`DELETE FROM repository_denylist WHERE full_name = ${SEED_NAME}`;
  });

  it('writes a repository, a package and a version', async () => {
    const result = await persistScan(scan());
    expect(result.packageIds).toHaveLength(1);
    expect(result.newVersions).toBe(1);
  });

  it('is a no-op when the same scan runs again', async () => {
    const before = await persistScan(scan());
    const after = await persistScan(scan());
    expect(after.repositoryId).toBe(before.repositoryId);
    expect(after.packageIds).toEqual(before.packageIds);
    expect(after.newVersions).toBe(0);
  });

  it('keeps repository identity across a rename', async () => {
    const first = await persistScan(scan());
    const renamed = await persistScan(scan({ fullName: `${FULL_NAME}-renamed` }));
    expect(renamed.repositoryId).toBe(first.repositoryId);
  });

  it('mints a new version when content changes and reuses the package row', async () => {
    const first = await persistScan(scan());
    const changed = scan();
    changed.packages[0].contentHash = 'hash-b';
    const second = await persistScan(changed);
    expect(second.packageIds).toEqual(first.packageIds);
    expect(second.newVersions).toBe(1);
  });

  it('round-trips parent_path through both the insert and the conflict path', async () => {
    const first = await persistScan(scan({ packages: [pkg({ parentPath: 'plugins/foo' })] }));
    const [inserted] = await sql<{ parent_path: string | null }[]>`
      SELECT parent_path FROM package WHERE id = ${first.packageIds[0]}
    `;
    expect(inserted.parent_path).toBe('plugins/foo');

    await persistScan(
      scan({ packages: [pkg({ parentPath: 'plugins/bar', contentHash: 'hash-b' })] }),
    );
    const [updated] = await sql<{ parent_path: string | null }[]>`
      SELECT parent_path FROM package WHERE id = ${first.packageIds[0]}
    `;
    expect(updated.parent_path).toBe('plugins/bar');
  });

  it('delists a package that vanished, in the same transaction', async () => {
    await persistScan(scan());
    const emptied = await persistScan(scan({ packages: [] }));
    expect(emptied.delisted).toBe(1);

    const relisted = await persistScan(scan());
    const [row] = await sql<{ delisted_at: Date | null }[]>`
      SELECT delisted_at FROM package WHERE id = ${relisted.packageIds[0]}
    `;
    expect(row.delisted_at).toBeNull();
  });

  describe('an incomplete scan', () => {
    const all = three();

    it('leaves every existing package live and reports no removals', async () => {
      await persistScan(scan({ packages: all }));
      expect(await livePaths()).toHaveLength(3);

      // A cap fired, so only one of the three was read. The two it never looked
      // at are not evidence of deletion.
      const partial = await persistScan(scan({ packages: [all[0]], treeTruncated: true }));

      expect(partial.delisted).toBe(0);
      expect(await livePaths()).toEqual([
        'skills/a/SKILL.md',
        'skills/b/SKILL.md',
        'skills/c/SKILL.md',
      ]);
    });

    it('still removes the missing ones when the same scan is complete', async () => {
      await persistScan(scan({ packages: all }));

      const complete = await persistScan(scan({ packages: [all[0]], treeTruncated: false }));

      // The guard skips delisting on an incomplete scan; it does not disable it.
      expect(complete.delisted).toBe(2);
      expect(await livePaths()).toEqual(['skills/a/SKILL.md']);
    });

    it('still upserts what it did read, and still mints a version for changed content', async () => {
      await persistScan(scan({ packages: all }));

      const changed = { ...all[0], contentHash: 'hash-a-changed', summary: 'a newer summary' };
      const partial = await persistScan(scan({ packages: [changed], treeTruncated: true }));

      expect(partial.newVersions).toBe(1);
      const [row] = await sql<{ summary: string }[]>`
        SELECT p.summary FROM package p
        JOIN repository r ON r.id = p.repository_id
        WHERE r.github_node_id = ${NODE_ID} AND p.source_path = ${all[0].sourcePath}
      `;
      expect(row.summary).toBe('a newer summary');
    });
  });

  describe('the diff counters', () => {
    const all = three();

    /** A property of the classification, so it is asserted on every case. */
    function expectSum(counters: import('./persist').DiffCounters) {
      expect(counters.new + counters.updated + counters.unchanged).toBe(counters.discovered);
    }

    it('reports a first run as all new', async () => {
      const { counters } = await persistScan(scan({ packages: all }));
      expect(counters).toMatchObject({ discovered: 3, new: 3, updated: 0, unchanged: 0 });
      expectSum(counters);
    });

    it('reports an identical second run as all unchanged', async () => {
      await persistScan(scan({ packages: all }));
      const { counters } = await persistScan(scan({ packages: all }));
      expect(counters).toMatchObject({
        discovered: 3,
        new: 0,
        updated: 0,
        unchanged: 3,
        removed: 0,
      });
      expectSum(counters);
    });

    it('reports one updated and two unchanged when one artifact changed', async () => {
      await persistScan(scan({ packages: all }));
      const changed = [{ ...all[0], contentHash: 'hash-a-2' }, all[1], all[2]];

      const { counters } = await persistScan(scan({ packages: changed }));
      expect(counters).toMatchObject({ discovered: 3, new: 0, updated: 1, unchanged: 2 });
      expectSum(counters);
    });

    it('reports one new and three unchanged when an artifact is added', async () => {
      await persistScan(scan({ packages: all }));
      const added = pkg({
        sourcePath: 'skills/d/SKILL.md',
        name: 'd',
        slug: 'd',
        contentHash: 'hash-d',
      });

      const { counters } = await persistScan(scan({ packages: [...all, added] }));
      expect(counters).toMatchObject({ discovered: 4, new: 1, updated: 0, unchanged: 3 });
      expectSum(counters);
    });

    it('reports one removed when an artifact vanishes from a complete scan', async () => {
      await persistScan(scan({ packages: all }));

      const { counters } = await persistScan(scan({ packages: [all[0], all[1]] }));
      expect(counters).toMatchObject({
        discovered: 2,
        new: 0,
        updated: 0,
        unchanged: 2,
        removed: 1,
      });
      expectSum(counters);
    });

    it('reports a reappearing artifact as updated, on its original row', async () => {
      const first = await persistScan(scan({ packages: all }));
      const originalId = first.packageIds[2];

      await persistScan(scan({ packages: [all[0], all[1]] }));
      const [gone] = await sql<{ delisted_at: Date | null }[]>`
        SELECT delisted_at FROM package WHERE id = ${originalId}
      `;
      expect(gone.delisted_at).not.toBeNull();

      const back = await persistScan(scan({ packages: all }));
      // Not new: the row, its id, its permalink and its version history all
      // survived the removal.
      expect(back.counters).toMatchObject({ discovered: 3, new: 0, updated: 1, unchanged: 2 });
      expectSum(back.counters);
      expect(back.packageIds).toContain(originalId);

      const [revived] = await sql<{ delisted_at: Date | null }[]>`
        SELECT delisted_at FROM package WHERE id = ${originalId}
      `;
      expect(revived.delisted_at).toBeNull();
    });

    it('counts the artifacts whose parse failed', async () => {
      const withFailure = [
        all[0],
        { ...all[1], parseStatus: 'failed' as const, parseErrors: ['no frontmatter'] },
        all[2],
      ];

      const { counters } = await persistScan(scan({ packages: withFailure }));
      expect(counters.parseFailed).toBe(1);
      expectSum(counters);
    });
  });

  describe('under a job', () => {
    const all = three();

    async function attemptsOf(jobId: number) {
      return sql<Record<string, unknown>[]>`
        SELECT * FROM ingest_attempt WHERE job_id = ${jobId} ORDER BY attempt_no
      `;
    }

    async function jobRow(jobId: number) {
      const [row] = await sql<
        { status: string; started_at: Date | null; worker_id: string | null }[]
      >`SELECT status, started_at, worker_id FROM ingest_job WHERE id = ${jobId}`;
      return row;
    }

    it('writes one attempt row and leaves the job succeeded', async () => {
      const jobId = await runningJob();
      const startedAt = new Date();

      await persistScan(scan({ packages: all }), {
        id: jobId,
        attemptNo: 1,
        startedAt,
        rateRemaining: 55,
      });

      const attempts = await attemptsOf(jobId);
      expect(attempts).toHaveLength(1);
      expect(attempts[0]).toMatchObject({
        outcome: 'ok',
        error_detail: null,
        commit_sha: COMMIT,
        artifacts_found: 3,
        artifacts_new: 3,
        artifacts_updated: 0,
        artifacts_unchanged: 0,
        artifacts_removed: 0,
        parse_failed: 0,
        truncated: false,
        rate_remaining: 55,
      });

      expect(await jobRow(jobId)).toMatchObject({
        status: 'succeeded',
        started_at: null,
        worker_id: null,
      });
    });

    it('leaves no attempt row, a job still running, and the prior listing untouched when the transaction fails', async () => {
      await persistScan(scan({ packages: all }));
      const before = await livePaths();

      const jobId = await runningJob();
      // A real database failure, not a mock: `type` references artifact_type, so
      // this violates a foreign key and aborts the transaction — which is the
      // shape a storage failure has in production.
      const doomed = scan({
        packages: [pkg({ type: 'not-an-artifact-type', sourcePath: 'skills/x/SKILL.md' })],
      });

      await expect(
        persistScan(doomed, {
          id: jobId,
          attemptNo: 1,
          startedAt: new Date(),
          rateRemaining: null,
        }),
      ).rejects.toThrow();

      expect(await attemptsOf(jobId)).toHaveLength(0);
      expect(await jobRow(jobId)).toMatchObject({ status: 'running', worker_id: 'persist-spec' });
      expect(await livePaths()).toEqual(before);
    });

    it('leaves that job reclaimable by the reaper', async () => {
      const jobId = await runningJob();
      await sql`UPDATE ingest_job SET started_at = now() - interval '20 minutes' WHERE id = ${jobId}`;

      // The reaper's own predicate, scoped to this one row. reapAbandoned()
      // itself sweeps the whole schema, and the queue suite runs in parallel
      // against it — calling it here would make both suites race.
      const [row] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM ingest_job
        WHERE id = ${jobId} AND status = 'running'
          AND started_at < now() - interval '15 minutes'
      `;
      expect(row.n).toBe(1);
    });

    it('writes no attempt row when there is no job', async () => {
      const jobId = await runningJob();
      await persistScan(scan({ packages: all }));

      expect(await attemptsOf(jobId)).toHaveLength(0);
      expect(await jobRow(jobId)).toMatchObject({ status: 'running' });
    });
  });

  describe('seeds', () => {
    async function seedRow(fullName: string) {
      const [row] = await sql<
        {
          full_name: string;
          source_kind: string;
          discovered_from: string;
          discovered_path: string;
          hint: Record<string, unknown>;
        }[]
      >`SELECT full_name, source_kind, discovered_from, discovered_path, hint
          FROM repo_seed WHERE full_name = ${fullName}`;
      return row;
    }

    it('writes one repo_seed row per seed, keyed on full_name, inside the same transaction as the artifacts', async () => {
      await persistScan(scan({ seeds: [seed()] }));

      const row = await seedRow(SEED_NAME);
      expect(row).toMatchObject({
        full_name: SEED_NAME,
        source_kind: 'github',
        discovered_from: FULL_NAME,
        discovered_path: '.claude-plugin/marketplace.json',
      });
      expect(row.hint).toMatchObject({ name: 'seed-repo' });
    });

    it('updates rather than duplicates when the same seed is persisted again', async () => {
      await persistScan(scan({ seeds: [seed()] }));
      await persistScan(scan({ seeds: [seed({ hint: { name: 'renamed' } })] }));

      const [{ n }] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM repo_seed WHERE full_name = ${SEED_NAME}
      `;
      expect(n).toBe(1);
      const row = await seedRow(SEED_NAME);
      expect(row.hint).toMatchObject({ name: 'renamed' });
    });

    it('does not write a seed whose full_name is in repository_denylist', async () => {
      await sql`INSERT INTO repository_denylist (full_name, reason) VALUES (${SEED_NAME}, 'test')`;

      await persistScan(scan({ seeds: [seed()] }));

      expect(await seedRow(SEED_NAME)).toBeUndefined();
    });

    it('leaves no seed row when the transaction fails after the seed upsert', async () => {
      // The seed upsert runs before the job's ingest_attempt insert; a job id
      // with no matching ingest_job row fails that insert's foreign key and
      // aborts the whole transaction, including the seed that already ran.
      await expect(
        persistScan(scan({ seeds: [seed()] }), {
          id: 2 ** 31 - 1,
          attemptNo: 1,
          startedAt: new Date(),
          rateRemaining: null,
        }),
      ).rejects.toThrow();

      expect(await seedRow(SEED_NAME)).toBeUndefined();
    });
  });

  describe('the no-change write', () => {
    const all = three();

    let touchRepository: typeof import('./persist').touchRepository;
    let lastIngestedSha: typeof import('./persist').lastIngestedSha;

    beforeAll(async () => {
      ({ touchRepository, lastIngestedSha } = await import('./persist'));
    });

    // The driver hands timestamps back as strings on this raw path, so every
    // comparison below goes through Date rather than assuming either shape.
    const at = (value: string | Date | null): string | null =>
      value === null ? null : new Date(value).toISOString();

    /** Every package's update timestamp, keyed by path. Compared, never eyeballed. */
    async function packageStamps(): Promise<Record<string, string | null>> {
      const rows = await sql<{ source_path: string; updated_at: string | Date }[]>`
        SELECT p.source_path, p.updated_at FROM package p
        JOIN repository r ON r.id = p.repository_id
        WHERE r.github_node_id = ${NODE_ID}
        ORDER BY p.source_path
      `;
      return Object.fromEntries(rows.map((r) => [r.source_path, at(r.updated_at)]));
    }

    async function repoRow() {
      const [row] = await sql<
        {
          stars: number;
          description: string | null;
          license_spdx: string | null;
          pushed_at: string | Date | null;
          scanned_at: string | Date | null;
          last_ingested_sha: string | null;
          tree_truncated: boolean;
        }[]
      >`SELECT stars, description, license_spdx, pushed_at, scanned_at,
               last_ingested_sha, tree_truncated
          FROM repository WHERE github_node_id = ${NODE_ID}`;
      return row;
    }

    it('refreshes the metadata that moves independently of the commit', async () => {
      await persistScan(scan({ packages: all }));
      const scannedAt = new Date('2026-08-09T12:00:00.000Z');

      await touchRepository(
        metadata({
          stars: 999,
          description: 'a fresher description',
          licenseSpdx: 'Apache-2.0',
          pushedAt: new Date('2026-08-08T00:00:00.000Z'),
        }),
        COMMIT,
        scannedAt,
      );

      const row = await repoRow();
      expect(row.stars).toBe(999);
      expect(row.description).toBe('a fresher description');
      expect(row.license_spdx).toBe('Apache-2.0');
      expect(at(row.pushed_at)).toBe('2026-08-08T00:00:00.000Z');
      expect(at(row.scanned_at)).toBe(scannedAt.toISOString());
      expect(row.last_ingested_sha).toBe(COMMIT);
    });

    it('leaves every package timestamp exactly as it was', async () => {
      await persistScan(scan({ packages: all }));
      const before = await packageStamps();

      await touchRepository(metadata({ stars: 7 }), COMMIT, new Date());

      // Compared value for value, not merely checked for being recent. Recent is
      // what the bug looks like: the listing is ordered by this column, so a bump
      // here floats every unchanged repository to the top of the recent list.
      expect(await packageStamps()).toEqual(before);
    });

    it('leaves the stored truncation flag exactly as it was', async () => {
      await persistScan(scan({ packages: all, treeTruncated: true }));

      const touched = await touchRepository(metadata(), COMMIT, new Date());

      // The commit has not moved, so whatever was partial about the previous
      // read of it is still partial.
      expect((await repoRow()).tree_truncated).toBe(true);
      expect(touched.treeTruncated).toBe(true);
    });

    it('reports the artifacts the repository currently lists, ignoring delisted ones', async () => {
      await persistScan(scan({ packages: all }));
      await persistScan(scan({ packages: [all[0], all[1]] }));

      const touched = await touchRepository(metadata(), COMMIT, new Date());

      expect(touched.liveCount).toBe(2);
      expect(await livePaths()).toHaveLength(2);
    });

    it('writes one attempt row recording nothing read and leaves the job succeeded', async () => {
      await persistScan(scan({ packages: all }));
      const jobId = await runningJob();
      const startedAt = new Date();

      await touchRepository(metadata(), COMMIT, new Date(), {
        id: jobId,
        attemptNo: 2,
        startedAt,
        rateRemaining: 41,
      });

      const attempts = await sql<Record<string, unknown>[]>`
        SELECT * FROM ingest_attempt WHERE job_id = ${jobId}
      `;
      expect(attempts).toHaveLength(1);
      expect(attempts[0]).toMatchObject({
        outcome: 'unchanged',
        error_detail: null,
        commit_sha: COMMIT,
        files_read: 0,
        artifacts_found: 3,
        artifacts_new: 0,
        artifacts_updated: 0,
        artifacts_unchanged: 3,
        artifacts_removed: 0,
        parse_failed: 0,
        truncated: false,
        rate_remaining: 41,
      });

      const [row] = await sql<{ status: string; worker_id: string | null }[]>`
        SELECT status, worker_id FROM ingest_job WHERE id = ${jobId}
      `;
      expect(row).toMatchObject({ status: 'succeeded', worker_id: null });
    });

    it('mints no version row and no package row', async () => {
      await persistScan(scan({ packages: all }));
      const [before] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM package_version pv
        JOIN package p ON p.id = pv.package_id
        JOIN repository r ON r.id = p.repository_id WHERE r.github_node_id = ${NODE_ID}
      `;

      await touchRepository(metadata(), COMMIT, new Date());

      const [after] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM package_version pv
        JOIN package p ON p.id = pv.package_id
        JOIN repository r ON r.id = p.repository_id WHERE r.github_node_id = ${NODE_ID}
      `;
      expect(after.n).toBe(before.n);
      expect(await livePaths()).toHaveLength(3);
    });

    describe('lastIngestedSha', () => {
      it('reads the stored commit back, matched the way the pages match', async () => {
        await persistScan(scan({ packages: all }));

        expect(await lastIngestedSha(FULL_NAME)).toBe(COMMIT);
        expect(await lastIngestedSha(FULL_NAME.toUpperCase())).toBe(COMMIT);
      });

      it('is null for a repository AgentDock has never seen', async () => {
        expect(await lastIngestedSha('test-owner/never-seen-by-agentdock')).toBeNull();
      });
    });
  });
});
