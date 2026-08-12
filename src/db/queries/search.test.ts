import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SCRIPT_EXTENSIONS } from '@/analyze/files';

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
      files = '[]',
    }: {
      type?: string;
      name?: string;
      summary?: string | null;
      meta?: string;
      files?: string;
    } = {},
  ): Promise<number> {
    const [row] = await sql<{ id: number }[]>`
      INSERT INTO package (repository_id, type, source_path, name, slug, summary, meta, files)
      VALUES (${repositoryId}, ${type}, ${sourcePath}, ${name}, ${sourcePath}, ${summary},
              ${meta}::jsonb, ${files}::jsonb)
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

  /** package_version ids for one package, oldest first — the last element is
   * the artifact's latest version, matching artifact()'s own tick ordering. */
  async function versionIds(packageId: number): Promise<number[]> {
    const rows = await sql<{ id: number }[]>`
      SELECT id FROM package_version WHERE package_id = ${packageId} ORDER BY ingested_at ASC`;
    return rows.map((r) => Number(r.id));
  }

  /** A capability_finding row on one package_version, following
   * persist.ts's own column set (commit_sha denormalized, metadata default). */
  async function finding(
    packageVersionId: number,
    category: string,
    signal: string,
    { sourcePath = 'x', summary = 'test finding' }: { sourcePath?: string; summary?: string } = {},
  ): Promise<void> {
    await sql`
      INSERT INTO capability_finding
        (package_version_id, detector_id, detector_version, category, signal, summary, source_path, commit_sha)
      VALUES (${packageVersionId}, 'test-detector', '1', ${category}, ${signal}, ${summary},
              ${sourcePath}, ${'c'.repeat(40)})`;
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

  describe('D-12 ranking order, browse branch and pagination (06-02 Task 2)', () => {
    it('ranks an exact name match above a match that only appears in the summary', async () => {
      const r = await repo('rank-exact');
      const exactId = await artifact(r, 'a/SKILL.md', [{ hash: 'rx1' }], {
        name: 'zephyrantha',
        summary: 'an ordinary summary with no relevant word at all',
      });
      const summaryId = await artifact(r, 'b/SKILL.md', [{ hash: 'rx2' }], {
        name: 'wholly unrelated title',
        // Repeated so ts_rank's weighted score on this row is as strong as a
        // single description hit can be, making this a fair comparison —
        // even the strongest possible summary-only match must not outrank
        // an exact name match.
        summary: 'zephyrantha zephyrantha zephyrantha zephyrantha zephyrantha',
      });

      const results = await search.searchPackages({ q: 'zephyrantha' });
      const ids = results.map((x) => x.id);
      expect(ids.indexOf(exactId)).toBeLessThan(ids.indexOf(summaryId));
    });

    it('ranks a name-prefix match above a match that only appears in the summary', async () => {
      const r = await repo('rank-prefix');
      const prefixId = await artifact(r, 'a/SKILL.md', [{ hash: 'rp1' }], {
        name: 'quixotropic widget',
        summary: 'an ordinary summary with no relevant word at all',
      });
      const summaryId = await artifact(r, 'b/SKILL.md', [{ hash: 'rp2' }], {
        name: 'wholly unrelated title',
        summary: 'quixotropic quixotropic quixotropic quixotropic quixotropic',
      });

      const results = await search.searchPackages({ q: 'quixotropic' });
      const ids = results.map((x) => x.id);
      expect(ids.indexOf(prefixId)).toBeLessThan(ids.indexOf(summaryId));
    });

    it('ranks a summary-only match above a match that only appears in the repository name', async () => {
      const summaryRepo = await repo('rank-desc-summary');
      const repoNameRepo = await repo('flumadiddle-repo-only');
      const summaryId = await artifact(summaryRepo, 'a/SKILL.md', [{ hash: 'rd1' }], {
        name: 'wholly unrelated title',
        summary: 'discusses flumadiddle at length',
      });
      const repoNameId = await artifact(repoNameRepo, 'b/SKILL.md', [{ hash: 'rd2' }], {
        name: 'another unrelated title',
        summary: 'and another summary mentioning nothing relevant',
      });

      const results = await search.searchPackages({ q: 'flumadiddle' });
      const ids = results.map((x) => x.id);
      expect(ids).toContain(repoNameId);
      expect(ids.indexOf(summaryId)).toBeLessThan(ids.indexOf(repoNameId));
    });

    it('breaks a relevance tie by updated_at DESC', async () => {
      const r = await repo('tie-break-updated-at');
      const olderId = await artifact(r, 'a/SKILL.md', [{ hash: 'tb1' }], {
        name: 'tiebreakword item',
      });
      const newerId = await artifact(r, 'b/SKILL.md', [{ hash: 'tb2' }], {
        name: 'tiebreakword item',
      });
      await sql`UPDATE package SET updated_at = now() - interval '2 days' WHERE id = ${olderId}`;
      await sql`UPDATE package SET updated_at = now() - interval '1 day' WHERE id = ${newerId}`;

      const results = await search.searchPackages({ q: 'tiebreakword' });
      const ids = results.map((x) => x.id);
      expect(ids.indexOf(newerId)).toBeLessThan(ids.indexOf(olderId));
    });

    it('breaks a further tie (same updated_at) by id ASC', async () => {
      const r = await repo('tie-break-id');
      const idA = await artifact(r, 'a/SKILL.md', [{ hash: 'idtb1' }], {
        name: 'idtiebreakword item',
      });
      const idB = await artifact(r, 'b/SKILL.md', [{ hash: 'idtb2' }], {
        name: 'idtiebreakword item',
      });
      // now() rather than a JS Date value: both rows get the identical
      // server-evaluated timestamp in one statement, and postgres.js binds
      // a raw JS Date awkwardly inside an IN(...) tuple.
      await sql`UPDATE package SET updated_at = now() WHERE id IN (${idA}, ${idB})`;

      const results = await search.searchPackages({ q: 'idtiebreakword' });
      const ids = results.map((x) => x.id).filter((id) => id === idA || id === idB);
      expect(ids).toEqual([Math.min(idA, idB), Math.max(idA, idB)]);
    });

    it('returns an identical id sequence when the same query runs twice', async () => {
      const r = await repo('repeat-query');
      await artifact(r, 'a/SKILL.md', [{ hash: 'rq1' }], { name: 'repeatqueryword alpha' });
      await artifact(r, 'b/SKILL.md', [{ hash: 'rq2' }], { name: 'repeatqueryword beta' });

      const first = await search.searchPackages({ q: 'repeatqueryword' });
      const second = await search.searchPackages({ q: 'repeatqueryword' });
      expect(second.map((x) => x.id)).toEqual(first.map((x) => x.id));
    });

    it('page 1 and page 2 together cover the unpaginated ordering, with no duplicate and no gap', async () => {
      const r = await repo('paginate');
      const names = [
        'paginateword one',
        'paginateword two',
        'paginateword three',
        'paginateword four',
        'paginateword five',
      ];
      for (const [i, name] of names.entries()) {
        await artifact(r, `${i}/SKILL.md`, [{ hash: `pg${i}` }], { name });
      }

      const pageSize = 2;
      const unpaginated = await search.searchPackages({ q: 'paginateword', limit: 100 });
      const page1 = await search.searchPackages({ q: 'paginateword', limit: pageSize, offset: 0 });
      const page2 = await search.searchPackages({
        q: 'paginateword',
        limit: pageSize,
        offset: pageSize,
      });

      const combinedIds = [...page1, ...page2].map((x) => x.id);
      expect(new Set(combinedIds).size).toBe(combinedIds.length);
      expect(combinedIds).toEqual(unpaginated.slice(0, pageSize * 2).map((x) => x.id));
    });

    it('an empty normalized query returns the same ordering and count as listPackages/countPackages (browse mode)', async () => {
      // agentdock_test starts empty (the real 921-row corpus lives only in
      // the live `agentdock` schema), so this suite provides its own known
      // rows rather than assuming a pre-populated corpus.
      const r = await repo('browse-empty');
      await artifact(r, 'a/SKILL.md', [{ hash: 'be1' }], { name: 'browseemptyword one' });
      await artifact(r, 'b/SKILL.md', [{ hash: 'be2' }], { name: 'browseemptyword two' });
      await artifact(r, 'c/SKILL.md', [{ hash: 'be3' }], { name: 'browseemptyword three' });

      const [emptyResults, browseResults, total] = await Promise.all([
        search.searchPackages({ q: '', limit: 1000 }),
        packages.listPackages({ limit: 1000 }),
        packages.countPackages(),
      ]);
      expect(total).toBeGreaterThan(0);
      expect(emptyResults.length).toBe(total);
      expect(emptyResults.map((x) => x.id)).toEqual(browseResults.map((x) => x.id));
      // rank is projected as a literal 0 on the browse branch — the return
      // type does not change shape between the two branches.
      expect(emptyResults.every((x) => x.rank === 0)).toBe(true);
    });

    it('an empty normalized query matches countSearchResults against the same options', async () => {
      const [emptyCount, listingCount] = await Promise.all([
        search.countSearchResults({ q: '' }),
        packages.countPackages(),
      ]);
      expect(emptyCount).toBe(listingCount);
    });

    it('countSearchResults and searchPackages agree on a non-empty query', async () => {
      const r = await repo('count-agree');
      await artifact(r, 'a/SKILL.md', [{ hash: 'ca1' }], { name: 'countagreeword item' });
      await artifact(r, 'b/SKILL.md', [{ hash: 'ca2' }], { name: 'countagreeword other' });

      const [results, count] = await Promise.all([
        search.searchPackages({ q: 'countagreeword', limit: 100 }),
        search.countSearchResults({ q: 'countagreeword' }),
      ]);
      expect(count).toBe(results.length);
    });

    it("a query naming only a repository full name returns that repository's artifacts", async () => {
      const r = await repo('flangeworth-only-repo-name');
      const id = await artifact(r, 'a/SKILL.md', [{ hash: 'rn1' }], {
        name: 'unrelated name',
        summary: 'unrelated summary',
      });

      const results = await search.searchPackages({ q: 'flangeworth' });
      expect(results.map((x) => x.id)).toContain(id);
    });

    it("does not rank parse_status = 'partial' below an otherwise equal 'ok' row (no ranking penalty)", async () => {
      const r = await repo('rank-partial');
      await artifact(r, 'ok/SKILL.md', [{ hash: 'rankp-ok' }], { name: 'rankpartialword item' });
      await artifact(r, 'partial/SKILL.md', [{ hash: 'rankp-partial', status: 'partial' }], {
        name: 'rankpartialword item',
      });

      const results = await search.searchPackages({ q: 'rankpartialword' });
      const byPath = new Map(results.map((x) => [x.sourcePath, x]));
      expect(byPath.get('partial/SKILL.md')?.rank).toBe(byPath.get('ok/SKILL.md')?.rank);
    });

    it('no popularity, capability or parse-status term reaches the ranking (grepped in Task 2 acceptance, asserted here by behaviour)', async () => {
      const r = await repo('no-popularity', { stars: 1 });
      const highStars = await repo('no-popularity-high', { stars: 9999 });
      await artifact(r, 'a/SKILL.md', [{ hash: 'np1' }], { name: 'nopopularityword item' });
      await artifact(highStars, 'b/SKILL.md', [{ hash: 'np2' }], { name: 'nopopularityword item' });

      const results = await search.searchPackages({ q: 'nopopularityword' });
      const ranks = results.map((x) => x.rank);
      // Identical name text, wildly different star counts — equal rank
      // proves stars never entered the expression.
      expect(new Set(ranks).size).toBe(1);
    });
  });

  describe('06-03 type and capability filters (DIS-05/DIS-06)', () => {
    it('returns only rows of the requested type, and searchPackages/countSearchResults agree', async () => {
      const r = await repo('type-filter');
      await artifact(r, 'a/SKILL.md', [{ hash: 'tf1' }], {
        type: 'skill',
        name: 'typefilterword skill-item',
      });
      await artifact(r, 'b.md', [{ hash: 'tf2' }], {
        type: 'command',
        name: 'typefilterword command-item',
      });

      const filters = { types: ['command'], capabilities: [] };
      const [results, count] = await Promise.all([
        search.searchPackages({ q: 'typefilterword', filters }),
        search.countSearchResults({ q: 'typefilterword', filters }),
      ]);
      expect(results.every((x) => x.type === 'command')).toBe(true);
      expect(results.map((x) => x.sourcePath)).toContain('b.md');
      expect(results.map((x) => x.sourcePath)).not.toContain('a/SKILL.md');
      expect(count).toBe(results.length);
    });

    it('drops an unmatched type value and returns the unfiltered result set — never an empty page for an unmatchable id', async () => {
      const r = await repo('type-invalid');
      await artifact(r, 'a/SKILL.md', [{ hash: 'ti1' }], { name: 'typeinvalidword item' });

      const unfiltered = await search.searchPackages({ q: 'typeinvalidword' });
      const withBogusType = await search.searchPackages({
        q: 'typeinvalidword',
        filters: { types: ['not-a-real-type'], capabilities: [] },
      });
      expect(withBogusType.map((x) => x.id)).toEqual(unfiltered.map((x) => x.id));
      expect(unfiltered.length).toBeGreaterThan(0);
    });

    it('accepts a repeated type value without throwing', async () => {
      const r = await repo('type-repeated');
      await artifact(r, 'a.md', [{ hash: 'trp1' }], {
        type: 'command',
        name: 'typerepeatedword item',
      });

      await expect(
        search.searchPackages({
          q: 'typerepeatedword',
          filters: { types: ['command', 'command'], capabilities: [] },
        }),
      ).resolves.toBeInstanceOf(Array);
    });

    describe('capability filters read the latest version, matching listPackages’ own definition', () => {
      it('no_network excludes an artifact whose latest version has a network_request finding, and keeps one whose only network_request finding is on an older version', async () => {
        const rOld = await repo('no-network-old-finding');
        const oldId = await artifact(rOld, 'a/SKILL.md', [{ hash: 'nno1' }, { hash: 'nno2' }], {
          name: 'nonetworkoldword item',
        });
        const [olderVersionId] = await versionIds(oldId);
        await finding(olderVersionId, 'network_request', 'requests');

        const rNew = await repo('no-network-new-finding');
        const newId = await artifact(rNew, 'b/SKILL.md', [{ hash: 'nnn1' }, { hash: 'nnn2' }], {
          name: 'nonetworknewword item',
        });
        const versions = await versionIds(newId);
        const latestVersionId = versions[versions.length - 1];
        await finding(latestVersionId, 'network_request', 'requests');

        const filters = { types: [], capabilities: ['no_network'] };
        const oldResults = await search.searchPackages({ q: 'nonetworkoldword', filters });
        expect(oldResults.map((x) => x.id)).toContain(oldId);

        const newResults = await search.searchPackages({ q: 'nonetworknewword', filters });
        expect(newResults.map((x) => x.id)).not.toContain(newId);
      });

      it('no_shell excludes a Bash declared grant and a Bash(git:*) declared grant on the latest version, and keeps a Read declared grant', async () => {
        const rBash = await repo('no-shell-bash');
        const bashId = await artifact(rBash, 'a/SKILL.md', [{ hash: 'nsb1' }], {
          name: 'noshellbashword item',
        });
        const [bashVersionId] = await versionIds(bashId);
        await finding(bashVersionId, 'declared', 'Bash');

        const rBashScoped = await repo('no-shell-bash-scoped');
        const bashScopedId = await artifact(rBashScoped, 'b/SKILL.md', [{ hash: 'nsbs1' }], {
          name: 'noshellbashscopedword item',
        });
        const [bashScopedVersionId] = await versionIds(bashScopedId);
        await finding(bashScopedVersionId, 'declared', 'Bash(git:*)');

        const rRead = await repo('no-shell-read');
        const readId = await artifact(rRead, 'c/SKILL.md', [{ hash: 'nsr1' }], {
          name: 'noshellreadword item',
        });
        const [readVersionId] = await versionIds(readId);
        await finding(readVersionId, 'declared', 'Read');

        const filters = { types: [], capabilities: ['no_shell'] };
        expect(
          (await search.searchPackages({ q: 'noshellbashword', filters })).map((x) => x.id),
        ).not.toContain(bashId);
        expect(
          (await search.searchPackages({ q: 'noshellbashscopedword', filters })).map((x) => x.id),
        ).not.toContain(bashScopedId);
        expect(
          (await search.searchPackages({ q: 'noshellreadword', filters })).map((x) => x.id),
        ).toContain(readId);
      });

      describe.each(SCRIPT_EXTENSIONS)('no_scripts excludes a bundled %s file', (ext) => {
        it('excludes the artifact', async () => {
          const label = ext.slice(1);
          const r = await repo(`no-scripts-${label}`);
          const files = JSON.stringify([
            { path: `scripts/run${ext}`, size: 10, kind: 'file', executable: false },
          ]);
          const id = await artifact(r, 'a/SKILL.md', [{ hash: `nsx-${label}` }], {
            name: `noscripts${label}word item`,
            files,
          });

          const results = await search.searchPackages({
            q: `noscripts${label}word`,
            filters: { types: [], capabilities: ['no_scripts'] },
          });
          expect(results.map((x) => x.id)).not.toContain(id);
        });
      });

      it('keeps an artifact whose files contain only .md and .json paths', async () => {
        const r = await repo('no-scripts-keep');
        const files = JSON.stringify([
          { path: 'SKILL.md', size: 10, kind: 'file', executable: false },
          { path: 'meta.json', size: 5, kind: 'file', executable: false },
        ]);
        const id = await artifact(r, 'a/SKILL.md', [{ hash: 'nsk1' }], {
          name: 'noscriptskeepword item',
          files,
        });

        const results = await search.searchPackages({
          q: 'noscriptskeepword',
          filters: { types: [], capabilities: ['no_scripts'] },
        });
        expect(results.map((x) => x.id)).toContain(id);
      });
    });

    it('applying all three capability filters returns a subset of applying any two', async () => {
      const cleanRepo = await repo('triple-clean');
      const cleanId = await artifact(cleanRepo, 'a/SKILL.md', [{ hash: 'trc1' }], {
        name: 'tripleword clean',
      });

      const shellRepo = await repo('triple-shell');
      const shelledId = await artifact(shellRepo, 'b/SKILL.md', [{ hash: 'trc2' }], {
        name: 'tripleword shell',
      });
      const [shelledVersionId] = await versionIds(shelledId);
      await finding(shelledVersionId, 'declared', 'Bash');

      const networkRepo = await repo('triple-network');
      const networkedId = await artifact(networkRepo, 'c/SKILL.md', [{ hash: 'trc3' }], {
        name: 'tripleword network',
      });
      const [networkedVersionId] = await versionIds(networkedId);
      await finding(networkedVersionId, 'network_request', 'requests');

      const all = await search.searchPackages({
        q: 'tripleword',
        filters: { types: [], capabilities: ['no_network', 'no_shell', 'no_scripts'] },
      });
      const anyTwo = await search.searchPackages({
        q: 'tripleword',
        filters: { types: [], capabilities: ['no_network', 'no_shell'] },
      });
      const allIds = new Set(all.map((x) => x.id));
      const twoIds = new Set(anyTwo.map((x) => x.id));
      expect([...allIds].every((id) => twoIds.has(id))).toBe(true);
      expect(allIds.size).toBeLessThanOrEqual(twoIds.size);
      expect(allIds.has(cleanId)).toBe(true);
      expect(allIds.has(shelledId)).toBe(false);
      expect(twoIds.has(networkedId)).toBe(false);
    });

    it('filters compose with a text query and with the browse query, and countSearchResults agrees with searchPackages in all four combinations', async () => {
      const r = await repo('compose-filters');
      await artifact(r, 'a.md', [{ hash: 'cf1' }], {
        type: 'command',
        name: 'composefilterword item',
      });
      await artifact(r, 'b/SKILL.md', [{ hash: 'cf2' }], {
        type: 'skill',
        name: 'composefilterword other',
      });

      const cases: { q: string; filters: { types: string[]; capabilities: string[] } }[] = [
        { q: 'composefilterword', filters: { types: [], capabilities: [] } },
        { q: 'composefilterword', filters: { types: ['command'], capabilities: [] } },
        { q: '', filters: { types: [], capabilities: [] } },
        { q: '', filters: { types: ['command'], capabilities: [] } },
      ];

      for (const { q, filters } of cases) {
        const [results, count] = await Promise.all([
          search.searchPackages({ q, filters, limit: 1000 }),
          search.countSearchResults({ q, filters }),
        ]);
        expect(count).toBe(results.length);
      }
    });

    it('does not change the relative order of two rows that both survive a filter', async () => {
      const r = await repo('order-preserve');
      const higherRankId = await artifact(r, 'a/SKILL.md', [{ hash: 'op1' }], {
        name: 'orderpreserveword',
      });
      const lowerRankId = await artifact(r, 'b/SKILL.md', [{ hash: 'op2' }], {
        name: 'wholly unrelated title',
        summary: 'orderpreserveword orderpreserveword orderpreserveword',
      });

      const unfiltered = await search.searchPackages({ q: 'orderpreserveword' });
      const filtered = await search.searchPackages({
        q: 'orderpreserveword',
        filters: { types: [], capabilities: ['no_network'] },
      });

      const unfilteredIds = unfiltered
        .map((x) => x.id)
        .filter((id) => id === higherRankId || id === lowerRankId);
      const filteredIds = filtered
        .map((x) => x.id)
        .filter((id) => id === higherRankId || id === lowerRankId);
      expect(unfilteredIds).toEqual([higherRankId, lowerRankId]);
      expect(filteredIds).toEqual(unfilteredIds);
    });

    it('leaves every stored row byte-identical after every filtered query (DAT-07 holds under filters too)', async () => {
      const r = await repo('filter-snapshot');
      const id = await artifact(r, 'a/SKILL.md', [{ hash: 'fs1' }], {
        name: 'filtersnapshotword item',
      });
      const [versionId] = await versionIds(id);
      await finding(versionId, 'network_request', 'requests');

      const before = await snapshot();
      await search.searchPackages({
        q: 'filtersnapshotword',
        filters: { types: [], capabilities: ['no_network'] },
      });
      await search.searchPackages({
        q: 'filtersnapshotword',
        filters: { types: ['skill'], capabilities: [] },
      });
      await search.searchPackages({
        q: '',
        filters: { types: [], capabilities: ['no_network', 'no_shell', 'no_scripts'] },
      });
      expect(await snapshot()).toBe(before);
    });

    describe('catalog exclusion (D-34 regression)', () => {
      it('a type=catalog row (parse_status=failed, matching the real pipeline) never appears in search output for a text query, the browse query, or any filter combination', async () => {
        const r = await repo('catalog-regression');
        await artifact(r, 'marketplace.json', [{ hash: 'cat1', status: 'failed' }], {
          type: 'catalog',
          name: 'catalogregressionword item',
        });

        const combos: { q: string; filters: { types: string[]; capabilities: string[] } }[] = [
          { q: 'catalogregressionword', filters: { types: [], capabilities: [] } },
          { q: '', filters: { types: [], capabilities: [] } },
          {
            q: 'catalogregressionword',
            filters: { types: [...search.ARTIFACT_TYPE_IDS], capabilities: [] },
          },
          {
            q: 'catalogregressionword',
            filters: { types: [], capabilities: [...search.CAPABILITY_FILTER_IDS] },
          },
        ];

        for (const { q, filters } of combos) {
          const results = await search.searchPackages({ q, filters, limit: 1000 });
          expect(results.map((x) => x.type)).not.toContain('catalog');
        }
      });
    });
  });
});
