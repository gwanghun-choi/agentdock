import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RepoScan, ScannedPackage } from './types';

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

function scan(overrides: Partial<RepoScan> = {}): RepoScan {
  const pkg: ScannedPackage = {
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
  };
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
    commitSha: 'f17010c9bb483898c1d9c9f42dde2b3a98889434',
    treeTruncated: false,
    packages: [pkg],
    ...overrides,
  };
}

describe.skipIf(!DB_URL)('persistScan', () => {
  let persistScan: typeof import('./persist').persistScan;
  let sql: typeof import('@/db/client').sql;

  beforeAll(async () => {
    ({ persistScan } = await import('./persist'));
    ({ sql } = await import('@/db/client'));
    await sql`DELETE FROM repository WHERE github_node_id = ${NODE_ID}`;
  });

  afterAll(async () => {
    await sql`DELETE FROM repository WHERE github_node_id = ${NODE_ID}`;
    await sql.end();
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
});
