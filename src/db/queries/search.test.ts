import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// Database-backed tests write, so they write to the test schema. The schema
// module reads this at import time, hence the assignment before any import of
// it. Vitest isolates files into separate workers, so this cannot leak.
process.env.DATABASE_SCHEMA = 'agentdock_test';

const DB_URL = process.env.DATABASE_URL;

// Sentinel prefix, distinct from listing-spec, queue-spec, persist and
// corpus-spec. vitest runs test FILES in parallel against the one test
// schema, so a suite that borrowed another file's prefix would collide.
const PREFIX = 'test-owner/search-spec';

/**
 * The first direct test of searchPackages. It inserts NO job queue row:
 * claimJob takes the oldest claimable row in the whole schema, and a stray
 * queued row here would make jobs.test.ts flaky in a way that looks like a
 * bug in the queue — the same warning packages.test.ts already carries.
 */
describe.skipIf(!DB_URL)('the search query', () => {
  let search: typeof import('./search');
  let packages: typeof import('./packages');
  let sql: typeof import('@/db/client').sql;

  async function clean() {
    await sql`DELETE FROM package_version WHERE package_id IN (
      SELECT p.id FROM package p JOIN repository r ON r.id = p.repository_id
      WHERE r.full_name LIKE ${`${PREFIX}%`}
    )`;
    await sql`DELETE FROM package WHERE repository_id IN (
      SELECT id FROM repository WHERE full_name LIKE ${`${PREFIX}%`}
    )`;
    await sql`DELETE FROM repository WHERE full_name LIKE ${`${PREFIX}%`}`;
  }

  beforeAll(async () => {
    search = await import('./search');
    packages = await import('./packages');
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
    { stars = 0, isFork = false }: { stars?: number; isFork?: boolean } = {},
  ): Promise<number> {
    seq += 1;
    const fullName = `${PREFIX}-${name}`;
    const [row] = await sql<{ id: number }[]>`
      INSERT INTO repository (github_node_id, full_name, owner, default_branch, stars, is_fork)
      VALUES (${`node-${PREFIX}-${name}-${seq}`}, ${fullName}, 'test-owner', 'main',
              ${stars}, ${isFork})
      RETURNING id`;
    return Number(row.id);
  }

  async function artifact(
    repositoryId: number,
    sourcePath: string,
    versions: { hash: string; status?: string }[],
    {
      type = 'skill',
      name = sourcePath,
      summary = null,
      meta = '{}',
    }: { type?: string; name?: string; summary?: string | null; meta?: string } = {},
  ): Promise<number> {
    const [row] = await sql<{ id: number }[]>`
      INSERT INTO package (repository_id, type, source_path, name, slug, summary, meta)
      VALUES (${repositoryId}, ${type}, ${sourcePath}, ${name}, ${sourcePath}, ${summary},
              ${meta}::jsonb)
      RETURNING id`;
    const id = Number(row.id);
    let tick = 0;
    for (const version of versions) {
      tick += 1;
      await sql`
        INSERT INTO package_version (package_id, commit_sha, content_hash, parse_status, ingested_at)
        VALUES (${id}, ${'c'.repeat(40)}, ${version.hash}, ${version.status ?? 'ok'},
                now() - make_interval(secs => ${100 - tick}))`;
    }
    return id;
  }

  /** Every row this suite owns, in a form two snapshots can be compared byte
   * for byte. Ordered, because a set comparison would hide a reordering write. */
  async function snapshot(): Promise<string> {
    const rows = await sql`
      SELECT r.full_name, r.stars, r.is_fork, p.id AS pid, p.source_path, p.delisted_at,
             p.meta, v.content_hash, v.parse_status, v.ingested_at
      FROM repository r
      JOIN package p ON p.repository_id = r.id
      JOIN package_version v ON v.package_id = p.id
      WHERE r.full_name LIKE ${`${PREFIX}%`}
      ORDER BY r.full_name, p.id, v.id`;
    return JSON.stringify(rows);
  }

  it('returns a row whose name matches the query word', async () => {
    const r = await repo('name-match');
    await artifact(r, 'a/SKILL.md', [{ hash: 'nm1' }], { name: 'zephyrion widget' });

    const results = await search.searchPackages({ q: 'zephyrion' });
    expect(results.map((x) => x.sourcePath)).toContain('a/SKILL.md');
  });

  it('returns a row whose summary — not name — contains the query word', async () => {
    const r = await repo('summary-match');
    await artifact(r, 'b/SKILL.md', [{ hash: 'sm1' }], {
      name: 'ordinary-name',
      summary: 'discusses quixotical migration patterns',
    });

    const results = await search.searchPackages({ q: 'quixotical' });
    expect(results.map((x) => x.sourcePath)).toContain('b/SKILL.md');
  });

  it('returns a row whose source_path segment matches the query word, proving the C-weight path split works', async () => {
    const r = await repo('path-match');
    await artifact(r, 'servers/whirligig/index.ts', [{ hash: 'pm1' }], {
      name: 'unrelated title',
      summary: 'unrelated summary text',
    });

    const results = await search.searchPackages({ q: 'whirligig' });
    expect(results.map((x) => x.sourcePath)).toContain('servers/whirligig/index.ts');
  });

  it('returns an empty array, not a throw, for a query matching nothing', async () => {
    const results = await search.searchPackages({ q: 'zzznonexistenttokenzzz' });
    expect(results).toEqual([]);
  });

  describe('COR-07 in search', () => {
    it('excludes a fork, an unparsed artifact and the losing duplicate from search, each present at its own repository route', async () => {
      const fork = await repo('cor-fork', { isFork: true });
      await artifact(fork, 'fork-item/SKILL.md', [{ hash: 'cf1' }], {
        name: 'forkwordtoken example',
      });

      const failed = await repo('cor-failed');
      await artifact(failed, 'bad/SKILL.md', [{ hash: 'cb1', status: 'failed' }], {
        name: 'failwordtoken example',
      });

      const dupLow = await repo('cor-dup-low', { stars: 1 });
      const dupHigh = await repo('cor-dup-high', { stars: 900 });
      await artifact(dupLow, 'lo/SKILL.md', [{ hash: 'dup-shared' }], {
        name: 'dupwordtoken example',
      });
      await artifact(dupHigh, 'hi/SKILL.md', [{ hash: 'dup-shared' }], {
        name: 'dupwordtoken example',
      });

      expect(await search.searchPackages({ q: 'forkwordtoken' })).toEqual([]);
      expect(await search.searchPackages({ q: 'failwordtoken' })).toEqual([]);
      const dupResults = await search.searchPackages({ q: 'dupwordtoken' });
      expect(dupResults.map((x) => x.sourcePath)).toEqual(['hi/SKILL.md']);

      const forkPage = await packages.getRepositoryPackages('test-owner', 'search-spec-cor-fork');
      expect(forkPage?.packages.map((p) => p.sourcePath)).toContain('fork-item/SKILL.md');
      const failPage = await packages.getRepositoryPackages('test-owner', 'search-spec-cor-failed');
      expect(failPage?.packages.map((p) => p.sourcePath)).toContain('bad/SKILL.md');
      const dupLowPage = await packages.getRepositoryPackages(
        'test-owner',
        'search-spec-cor-dup-low',
      );
      expect(dupLowPage?.packages.map((p) => p.sourcePath)).toContain('lo/SKILL.md');
    });

    it('leaves every stored row byte-identical after a search query — a SELECT-only predicate satisfies DAT-07 by construction, asserted rather than assumed', async () => {
      const r = await repo('snap');
      await artifact(r, 'a/SKILL.md', [{ hash: 'snap1' }], { name: 'snapwordtoken example' });

      const before = await snapshot();
      await search.searchPackages({ q: 'snapwordtoken' });
      await search.searchPackages({ q: 'nomatchatalltoken' });
      expect(await snapshot()).toBe(before);
    });
  });

  it("does not rank parse_status = 'partial' below an otherwise equal 'ok' row", async () => {
    const r = await repo('partial-rank');
    await artifact(r, 'ok/SKILL.md', [{ hash: 'pr-ok' }], { name: 'partialrankword item' });
    await artifact(r, 'partial/SKILL.md', [{ hash: 'pr-partial', status: 'partial' }], {
      name: 'partialrankword item',
    });

    const results = await search.searchPackages({ q: 'partialrankword' });
    const byPath = new Map(results.map((x) => [x.sourcePath, x]));
    expect(byPath.has('ok/SKILL.md')).toBe(true);
    expect(byPath.has('partial/SKILL.md')).toBe(true);
    // Identical name text on both rows produces an identical rank — a
    // partial parse must not be scored any lower for that reason alone.
    expect(byPath.get('partial/SKILL.md')?.rank).toBe(byPath.get('ok/SKILL.md')?.rank);
  });

  it("returns identical rows in identical order for 'MCP' and 'mcp'", async () => {
    const r = await repo('case-fold');
    await artifact(r, 'x/SKILL.md', [{ hash: 'cf1' }], { name: 'MCPWidget example' });

    const upper = await search.searchPackages({ q: search.normalizeQuery('MCPWidget') });
    const lower = await search.searchPackages({ q: search.normalizeQuery('mcpwidget') });
    expect(upper.map((x) => x.sourcePath)).toEqual(lower.map((x) => x.sourcePath));
    expect(upper.map((x) => x.sourcePath)).toContain('x/SKILL.md');
  });

  it("escapes '%' before the repository-name ILIKE operand, so '100%' does not silently match the whole corpus (Reference E #16)", async () => {
    // All three repository names contain the digits "100" (though none
    // contains the literal three-character sequence "100%"), which is
    // exactly the shape that turns a missing LIKE escape into a
    // match-everything bug: an unescaped '%' in the query "100%" collapses
    // the trailing wildcard into a bare "contains '100'" test, which would
    // match all three. Package name/summary/sourcePath are deliberately
    // unrelated words, so the FTS predicate cannot also match "100" and
    // muddy which predicate the assertion is about.
    const r1 = await repo('match-100-a');
    const r2 = await repo('match-100-b');
    const r3 = await repo('match-100-c');
    await artifact(r1, 'x/SKILL.md', [{ hash: 'esc1' }], { name: 'unrelated-alpha' });
    await artifact(r2, 'y/SKILL.md', [{ hash: 'esc2' }], { name: 'unrelated-beta' });
    await artifact(r3, 'z/SKILL.md', [{ hash: 'esc3' }], { name: 'unrelated-gamma' });

    const total = 3;
    const results = await search.searchPackages({ q: search.normalizeQuery('100%') });
    expect(results.length).toBeLessThan(total);
    expect(results.length).toBe(0);
  });

  it("escapes '_' before the repository-name ILIKE operand, so 'a_b' does not match a repository whose name contains 'axb' (Reference E #17)", async () => {
    const r = await repo('axb-repo');
    await artifact(r, 'x/SKILL.md', [{ hash: 'us1' }], { name: 'unrelated-name' });

    const results = await search.searchPackages({ q: search.normalizeQuery('a_b') });
    expect(results.map((x) => x.sourcePath)).not.toContain('x/SKILL.md');
  });

  describe('normalizeQuery', () => {
    it('trims and collapses internal whitespace runs to one space', () => {
      expect(search.normalizeQuery('  mcp   server  ')).toBe('mcp server');
    });

    it("returns '' for empty, whitespace-only and undefined input", () => {
      expect(search.normalizeQuery('')).toBe('');
      expect(search.normalizeQuery('   ')).toBe('');
      expect(search.normalizeQuery(undefined)).toBe('');
    });

    it('takes the first element of a repeated parameter delivered as an array', () => {
      expect(search.normalizeQuery(['mcp', 'skill'])).toBe('mcp');
    });

    it('truncates ASCII input at exactly SEARCH_CAPS.maxQueryLength UTF-16 code units', () => {
      const input = 'a'.repeat(search.SEARCH_CAPS.maxQueryLength + 50);
      const result = search.normalizeQuery(input);
      expect(result.length).toBe(search.SEARCH_CAPS.maxQueryLength);
      expect(result).toBe('a'.repeat(search.SEARCH_CAPS.maxQueryLength));
    });

    it('truncates emoji input — outside the BMP, two UTF-16 units each — at the same unit count', () => {
      const input = '🚀'.repeat(search.SEARCH_CAPS.maxQueryLength); // 2x maxQueryLength UTF-16 units
      const result = search.normalizeQuery(input);
      expect(result.length).toBe(search.SEARCH_CAPS.maxQueryLength);
    });

    it('truncates Korean input at the same UTF-16 unit count', () => {
      const input = '한'.repeat(search.SEARCH_CAPS.maxQueryLength + 50);
      const result = search.normalizeQuery(input);
      expect(result.length).toBe(search.SEARCH_CAPS.maxQueryLength);
    });

    it('does not lowercase — the logged query must match what the user typed', () => {
      expect(search.normalizeQuery('MCP Server')).toBe('MCP Server');
    });
  });

  describe('Reference E — the adversarial and edge query set (18 inputs)', () => {
    const cases: { label: string; raw: string | string[] | undefined }[] = [
      { label: "1 — ''", raw: '' },
      { label: "2 — '   '", raw: '   ' },
      { label: '3 — absent parameter', raw: undefined },
      { label: "4 — ['mcp','skill'] (repeated param)", raw: ['mcp', 'skill'] },
      { label: "5 — 'm'", raw: 'm' },
      { label: "6 — 'mcp & drop table'", raw: 'mcp & drop table' },
      { label: '7 — SQL injection string', raw: "'; DROP TABLE package; --" },
      { label: "8 — 'mcp:*'", raw: 'mcp:*' },
      { label: "9 — 'a!b'", raw: 'a!b' },
      { label: "10 — 'mcp|server'", raw: 'mcp|server' },
      { label: '11 — unbalanced quote', raw: '"unbalanced' },
      { label: '12 — unclosed parenthesis', raw: '(unclosed' },
      { label: '13 — 5000-character string', raw: 'x'.repeat(5000) },
      { label: '14 — emoji', raw: '🚀🎉' },
      { label: '15 — Korean', raw: '한국어 검색' },
      { label: "16 — '100%'", raw: '100%' },
      { label: "17 — 'a_b'", raw: 'a_b' },
      { label: "18 — 'MCP' (case)", raw: 'MCP' },
    ];

    it('has exactly 18 cases', () => {
      expect(cases.length).toBe(18);
    });

    it.each(cases)('reaches searchPackages without throwing: $label', async ({ raw }) => {
      const q = search.normalizeQuery(raw);
      await expect(search.searchPackages({ q })).resolves.toBeInstanceOf(Array);
    });
  });
});
