import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { RepoScan, ScannedPackage } from './types';

// Database-backed tests write to the test schema — see persist.test.ts's own
// comment for why this assignment must run before any import of the schema
// module.
process.env.DATABASE_SCHEMA = 'agentdock_test';

const DB_URL = process.env.DATABASE_URL;
const NODE_ID = 'TEST_NODE_ID_reanalyze_spec';
const FULL_NAME = 'test-owner/reanalyze-spec';
const COMMIT = 'f17010c9bb483898c1d9c9f42dde2b3a98889434';

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
    findings: [],
    files: [],
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

describe.skipIf(!DB_URL)('analyzePackageVersion / unanalyzedVersionIds', () => {
  let persistScan: typeof import('./persist').persistScan;
  let analyzePackageVersion: typeof import('./reanalyze').analyzePackageVersion;
  let unanalyzedVersionIds: typeof import('./reanalyze').unanalyzedVersionIds;
  let sql: typeof import('@/db/client').sql;

  beforeAll(async () => {
    ({ persistScan } = await import('./persist'));
    ({ analyzePackageVersion, unanalyzedVersionIds } = await import('./reanalyze'));
    ({ sql } = await import('@/db/client'));
  });

  afterAll(async () => {
    await sql`DELETE FROM repository WHERE github_node_id = ${NODE_ID}`;
    await sql.end();
  });

  beforeEach(async () => {
    await sql`DELETE FROM repository WHERE github_node_id = ${NODE_ID}`;
  });

  async function versionIdOf(packageId: number): Promise<number> {
    const [row] = await sql<{ id: number }[]>`
      SELECT id FROM package_version WHERE package_id = ${packageId}
      ORDER BY ingested_at DESC LIMIT 1
    `;
    // The raw sql tag hands bigint columns back as strings; unanalyzedVersionIds
    // reads the same column through drizzle's bigserial({mode:'number'})
    // mapping, so this must coerce to compare equal against that.
    return Number(row.id);
  }

  async function findingRows(packageVersionId: number) {
    return sql<{ signal: string; category: string; commit_sha: string }[]>`
      SELECT signal, category, commit_sha FROM capability_finding
      WHERE package_version_id = ${packageVersionId}
    `;
  }

  async function analyzedAtOf(packageVersionId: number): Promise<Date | null> {
    const [row] = await sql<{ analyzed_at: Date | null }[]>`
      SELECT analyzed_at FROM package_version WHERE id = ${packageVersionId}
    `;
    return row.analyzed_at;
  }

  it('reads stored body and frontmatter and reproduces the real analyzer output, issuing no network request', async () => {
    const result = await persistScan(
      scan({ packages: [pkg({ body: 'run `npx cowsay hi`', findings: [] })] }),
    );
    const versionId = await versionIdOf(result.packageIds[0]);

    const count = await analyzePackageVersion(versionId);
    expect(count).toBe(1);
    const rows = await findingRows(versionId);
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe('package_install');
    expect(rows[0].commit_sha).toBe(COMMIT);
  });

  it('a single pass matching the same finding tuple twice on one line does not violate capability_finding_identity', async () => {
    // skills/docx/SKILL.md:21's real-corpus case (04-01's SUMMARY, "A
    // discovered consequence of the schema as specified"): one line naming
    // the same install directive twice produces two structurally identical
    // Finding objects from one analyzeArtifact pass. persist.ts's insert
    // already tolerates this via onConflictDoNothing; this function must
    // too, since it deletes and rewrites in the same shape.
    const result = await persistScan(
      scan({ packages: [pkg({ body: 'npm install and again npm install', findings: [] })] }),
    );
    const versionId = await versionIdOf(result.packageIds[0]);

    const count = await analyzePackageVersion(versionId);
    expect(count).toBe(1); // collapsed to one row by capability_finding_identity
    expect(await findingRows(versionId)).toHaveLength(1);
  });

  it('replaces rather than appends: a stale finding from a previous rule version does not survive', async () => {
    const stale = {
      detectorId: 'install',
      detectorVersion: '0',
      category: 'package_install' as const,
      signal: 'a-rule-that-no-longer-exists',
      summary: 'a stale finding from a previous detector version',
      sourcePath: 'skills/canvas-design/SKILL.md',
      startLine: 1,
      endLine: 1,
      evidenceText: 'stale',
      metadata: {},
    };
    const result = await persistScan(
      scan({ packages: [pkg({ body: 'run `npx cowsay hi`', findings: [stale] })] }),
    );
    const versionId = await versionIdOf(result.packageIds[0]);
    expect(await findingRows(versionId)).toHaveLength(1);
    expect((await findingRows(versionId))[0].signal).toBe('a-rule-that-no-longer-exists');

    await analyzePackageVersion(versionId);

    const rows = await findingRows(versionId);
    expect(rows).toHaveLength(1);
    expect(rows[0].signal).not.toBe('a-rule-that-no-longer-exists');
    expect(rows[0].signal).toBe('npx');
  });

  it('running it twice in a row leaves the same finding count as running it once', async () => {
    const result = await persistScan(
      scan({ packages: [pkg({ body: 'run `npx cowsay hi`\nnpm install foo', findings: [] })] }),
    );
    const versionId = await versionIdOf(result.packageIds[0]);

    const first = await analyzePackageVersion(versionId);
    const rowsFirst = await findingRows(versionId);
    const second = await analyzePackageVersion(versionId);
    const rowsSecond = await findingRows(versionId);

    expect(second).toBe(first);
    expect(rowsSecond).toHaveLength(rowsFirst.length);
  });

  it('sets analyzed_at even when it produces no findings', async () => {
    const result = await persistScan(
      scan({ packages: [pkg({ body: 'nothing interesting here', findings: [] })] }),
    );
    const versionId = await versionIdOf(result.packageIds[0]);
    // Simulate a pre-Phase-4 row: analyzed_at null, as every row ingested
    // before this phase actually reads.
    await sql`UPDATE package_version SET analyzed_at = NULL WHERE id = ${versionId}`;
    expect(await analyzedAtOf(versionId)).toBeNull();

    const count = await analyzePackageVersion(versionId);
    expect(count).toBe(0);
    expect(await findingRows(versionId)).toHaveLength(0);
    expect(await analyzedAtOf(versionId)).not.toBeNull();
  });

  it('completes and produces no findings when body is null', async () => {
    const result = await persistScan(scan({ packages: [pkg({ body: null, findings: [] })] }));
    const versionId = await versionIdOf(result.packageIds[0]);

    const count = await analyzePackageVersion(versionId);
    expect(count).toBe(0);
    expect(await findingRows(versionId)).toHaveLength(0);
    expect(await analyzedAtOf(versionId)).not.toBeNull();
  });

  it('unanalyzedVersionIds returns only versions whose analyzed_at is null, bounded by its limit', async () => {
    const first = await persistScan(
      scan({ packages: [pkg({ contentHash: 'hash-a', sourcePath: 'skills/a/SKILL.md' })] }),
    );
    const second = await persistScan(
      scan({ packages: [pkg({ contentHash: 'hash-b', sourcePath: 'skills/b/SKILL.md' })] }),
    );
    const versionA = await versionIdOf(first.packageIds[0]);
    const versionB = await versionIdOf(second.packageIds[0]);

    // Both were freshly ingested, so both already have analyzed_at set — the
    // fact this whole plan exists to work around for the pre-existing
    // corpus. Null one out to simulate that corpus.
    await sql`UPDATE package_version SET analyzed_at = NULL WHERE id = ${versionA}`;

    const ids = await unanalyzedVersionIds(1000);
    expect(ids).toContain(versionA);
    expect(ids).not.toContain(versionB);

    const bounded = await unanalyzedVersionIds(0);
    expect(bounded).toEqual([]);
  });
});

/**
 * The purity proof this plan adds: no file under src/analyze/ imports the
 * database client — the same discipline CONTEXT.md Binding decision 1 states
 * for arity, extended here to imports, because a single db-touching file in
 * that directory breaks the structural proof for every file beside it.
 */
describe('src/analyze/ purity', () => {
  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        out.push(...walk(full));
        continue;
      }
      if (/\.(ts|tsx)$/.test(name)) out.push(full);
    }
    return out;
  }

  it('no file under src/analyze imports @/db or a postgres client', () => {
    const files = walk(join('src', 'analyze'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/@\/db\b/);
      expect(text, file).not.toMatch(/from ['"]postgres['"]/);
    }
  });
});
