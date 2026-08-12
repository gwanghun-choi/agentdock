import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// Database-backed tests write, so they write to the test schema. The schema
// module reads this at import time, hence the assignment before any import of
// it. Vitest isolates files into separate workers, so this cannot leak.
process.env.DATABASE_SCHEMA = 'agentdock_test';

const DB_URL = process.env.DATABASE_URL;

// Sentinel prefix, distinct from queue-spec, persist and corpus-spec. vitest runs
// test FILES in parallel against the one test schema, so a suite that borrowed a
// real repository name would collide with any suite that ingests it for real.
const PREFIX = 'test-owner/listing-spec';

/**
 * The first direct test of this project's listing queries. Until now packages.ts
 * was exercised only through pages, which is why an unconditional listing
 * predicate could have hidden a suppressed artifact from its own detail page
 * without a single test failing.
 *
 * This suite inserts NO ingest_job row, and must not start: claimJob takes the
 * oldest claimable row in the whole schema, so a queued row left here would make
 * jobs.test.ts flaky in a way that looks like a bug in the queue.
 */
describe.skipIf(!DB_URL)('the listing queries', () => {
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

  /**
   * One artifact and its versions, oldest first. The listing judges the LAST
   * one, which is what several assertions below turn on.
   */
  async function artifact(
    repositoryId: number,
    sourcePath: string,
    versions: { hash: string; status?: string }[],
    { type = 'skill', meta = '{}' }: { type?: string; meta?: string } = {},
  ): Promise<number> {
    const [row] = await sql<{ id: number }[]>`
      INSERT INTO package (repository_id, type, source_path, name, slug, meta)
      VALUES (${repositoryId}, ${type}, ${sourcePath}, ${sourcePath}, ${sourcePath},
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

  /** Every row this suite owns, in a form two snapshots can be compared byte for
   * byte. Ordered, because a set comparison would hide a reordering write. */
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

  const listed = async (fullName: string) =>
    (await packages.listPackages({ fullName, limit: 500 })).map((r) => r.sourcePath);

  describe('fork suppression (DAT-07)', () => {
    it('keeps a fork out of the listings and on its own repository page', async () => {
      const fork = await repo('fork', { isFork: true });
      await artifact(fork, 'a/SKILL.md', [{ hash: 'h-fork' }]);

      expect(await listed(`${PREFIX}-fork`)).toEqual([]);

      const page = await packages.getRepositoryPackages('test-owner', 'listing-spec-fork');
      expect(page?.repository.isFork).toBe(true);
      expect(page?.packages).toHaveLength(1);
      expect(page?.packages[0].notListedBecause).toBe('fork');
    });

    it('does not suppress a repository that is not a fork', async () => {
      const plain = await repo('plain');
      await artifact(plain, 'a/SKILL.md', [{ hash: 'h-plain' }]);
      expect(await listed(`${PREFIX}-plain`)).toEqual(['a/SKILL.md']);
    });
  });

  describe('the visibility floor (COR-07)', () => {
    it('excludes an artifact whose latest version failed to parse', async () => {
      const r = await repo('failed');
      await artifact(r, 'bad/SKILL.md', [{ hash: 'h1', status: 'failed' }]);
      await artifact(r, 'good/SKILL.md', [{ hash: 'h2' }]);

      expect(await listed(`${PREFIX}-failed`)).toEqual(['good/SKILL.md']);
      const page = await packages.getRepositoryPackages('test-owner', 'listing-spec-failed');
      expect(page?.packages.find((p) => p.sourcePath === 'bad/SKILL.md')?.notListedBecause).toBe(
        'unparsed',
      );
    });

    it('lists an artifact whose newest version parses and whose older one did not', async () => {
      const r = await repo('recovered');
      // The floor reads the LATEST version, not any version.
      await artifact(r, 'x/SKILL.md', [{ hash: 'old', status: 'failed' }, { hash: 'new' }]);
      expect(await listed(`${PREFIX}-recovered`)).toEqual(['x/SKILL.md']);
    });

    it('excludes an artifact whose newest version failed after an older one parsed', async () => {
      const r = await repo('regressed');
      await artifact(r, 'x/SKILL.md', [{ hash: 'old' }, { hash: 'new', status: 'failed' }]);
      expect(await listed(`${PREFIX}-regressed`)).toEqual([]);
    });

    it('LISTS a partially parsed artifact, because partial is not a parse failure', async () => {
      // The plan specified a floor of parse_status <> 'ok'. Measured against the
      // live corpus that hides 353 of 971 artifacts and leaves 469 listed, below
      // COR-06's floor of 500 — because `partial` is what a detector returns when
      // it parsed the file completely and noticed something. The single most
      // common note in the corpus is "keys outside the specification:
      // argument-hint", a valid Claude Code key this project's spec list does not
      // know. Hiding those would tell a reader AgentDock could not parse a file it
      // parsed fine.
      const r = await repo('partial');
      await artifact(r, 'p/SKILL.md', [{ hash: 'hp', status: 'partial' }]);
      expect(await listed(`${PREFIX}-partial`)).toEqual(['p/SKILL.md']);
    });
  });

  describe('duplicate suppression (DAT-07)', () => {
    it('keeps the higher-starred copy of two byte-identical artifacts', async () => {
      const low = await repo('dup-low', { stars: 10 });
      const high = await repo('dup-high', { stars: 900 });
      await artifact(low, 'a/SKILL.md', [{ hash: 'same' }]);
      await artifact(high, 'b/SKILL.md', [{ hash: 'same' }]);

      expect(await listed(`${PREFIX}-dup-low`)).toEqual([]);
      expect(await listed(`${PREFIX}-dup-high`)).toEqual(['b/SKILL.md']);
    });

    it('leaves exactly one survivor in a three-way group, and a fourth does not move it', async () => {
      const a = await repo('tri-a', { stars: 500 });
      const b = await repo('tri-b', { stars: 300 });
      const c = await repo('tri-c', { stars: 100 });
      await artifact(a, 'a/SKILL.md', [{ hash: 'tri' }]);
      await artifact(b, 'b/SKILL.md', [{ hash: 'tri' }]);
      await artifact(c, 'c/SKILL.md', [{ hash: 'tri' }]);

      // Asked one repository at a time rather than by scanning the whole listing:
      // scoped by full_name this uses the unique expression index, and it cannot
      // be perturbed by a sibling test file writing to the same test schema.
      const survivors = async () => {
        const names = ['tri-a', 'tri-b', 'tri-c', 'tri-d'];
        const out: string[] = [];
        for (const name of names) {
          if ((await listed(`${PREFIX}-${name}`)).length > 0) out.push(`${PREFIX}-${name}`);
        }
        return out;
      };

      expect(await survivors()).toEqual([`${PREFIX}-tri-a`]);

      // A fourth at the same star count as the leader. The tie-break is the
      // lower package id, and the leader's row was inserted first.
      const d = await repo('tri-d', { stars: 500 });
      await artifact(d, 'd/SKILL.md', [{ hash: 'tri' }]);
      expect(await survivors()).toEqual([`${PREFIX}-tri-a`]);
    });

    it('collapses byte-identical copies inside one repository, keeping the lowest id', async () => {
      // 25 of the 27 duplicate groups in the live corpus are this shape: a
      // repository vendoring one file into two paths. Same repository means same
      // star count, so the survivor is decided by the package id alone — an
      // ARBITRARY choice among identical bytes, but a stable one, because the id
      // survives re-ingestion.
      const r = await repo('vendored', { stars: 5 });
      const first = await artifact(r, 'src/SKILL.md', [{ hash: 'vend' }]);
      const second = await artifact(r, 'dist/copy/SKILL.md', [{ hash: 'vend' }]);
      expect(second).toBeGreaterThan(first);

      expect(await listed(`${PREFIX}-vendored`)).toEqual(['src/SKILL.md']);
    });

    it('does not let an unlistable copy take the whole group out of the listings', async () => {
      // Without the guards on p2, a failed or forked copy could out-rank the
      // parseable one and suppress it as a duplicate of a row that is itself
      // suppressed — every member of the group gone.
      const failedHigh = await repo('shadow-failed', { stars: 9000 });
      const forkHigh = await repo('shadow-fork', { stars: 8000, isFork: true });
      const real = await repo('shadow-real', { stars: 10 });
      await artifact(failedHigh, 'a/SKILL.md', [{ hash: 'shadow', status: 'failed' }]);
      await artifact(forkHigh, 'b/SKILL.md', [{ hash: 'shadow' }]);
      await artifact(real, 'c/SKILL.md', [{ hash: 'shadow' }]);

      expect(await listed(`${PREFIX}-shadow-real`)).toEqual(['c/SKILL.md']);
    });

    it('does not collapse shape-only plugins, whose hash is not over file bytes', async () => {
      // A plugin recognised by directory shape has no manifest to hash, so its
      // version is minted over components.join(',') — the literal string
      // "agents,commands,skills". Measured: all three shape-only plugins in the
      // live corpus share one hash across two unrelated repositories.
      const one = await repo('shape-one', { stars: 900 });
      const two = await repo('shape-two', { stars: 10 });
      const shape = '{"detectionConfidence":"shape-only"}';
      await artifact(one, 'x', [{ hash: 'agents,commands,skills' }], {
        type: 'plugin',
        meta: shape,
      });
      await artifact(two, 'y', [{ hash: 'agents,commands,skills' }], {
        type: 'plugin',
        meta: shape,
      });

      expect(await listed(`${PREFIX}-shape-one`)).toEqual(['x']);
      expect(await listed(`${PREFIX}-shape-two`)).toEqual(['y']);
    });
  });

  describe('precedence', () => {
    it('reports exactly one reason for a fork holding an unparseable duplicate', async () => {
      const canonical = await repo('prec-canonical', { stars: 9000 });
      const fork = await repo('prec-fork', { stars: 5, isFork: true });
      await artifact(canonical, 'a/SKILL.md', [{ hash: 'prec' }]);
      await artifact(fork, 'b/SKILL.md', [{ hash: 'prec', status: 'failed' }]);

      const page = await packages.getRepositoryPackages('test-owner', 'listing-spec-prec-fork');
      // All three branches are true of this row. CASE stops at the first, which
      // is also the cheapest, and the reader sees one reason rather than three.
      expect(page?.packages.map((p) => p.notListedBecause)).toEqual(['fork']);
    });
  });

  describe('listingOnly', () => {
    it('returns suppressed rows with reasons when it is false, and only listed rows when true', async () => {
      const r = await repo('both', { stars: 1 });
      await artifact(r, 'ok/SKILL.md', [{ hash: 'b1' }]);
      await artifact(r, 'bad/SKILL.md', [{ hash: 'b2', status: 'failed' }]);

      const listing = await packages.listPackages({ fullName: `${PREFIX}-both`, limit: 500 });
      expect(listing.map((p) => p.sourcePath)).toEqual(['ok/SKILL.md']);
      expect(listing.every((p) => p.notListedBecause === null)).toBe(true);

      const everything = await packages.listPackages({
        fullName: `${PREFIX}-both`,
        limit: 500,
        listingOnly: false,
      });
      expect(everything).toHaveLength(2);
      expect(everything.find((p) => p.sourcePath === 'bad/SKILL.md')?.notListedBecause).toBe(
        'unparsed',
      );
    });

    it('uses one fragment in the projection and the predicate without them disagreeing', async () => {
      // Drizzle SQL objects are immutable descriptors, so referencing NOT_LISTED_BECAUSE
      // in three places is safe. Asserted rather than assumed: a fragment that
      // consumed its bindings on first use would make the projection and the
      // predicate disagree, which is the one bug here that produces a
      // plausible-looking wrong answer.
      const r = await repo('agree', { stars: 3 });
      await artifact(r, '1/SKILL.md', [{ hash: 'g1' }]);
      await artifact(r, '2/SKILL.md', [{ hash: 'g2', status: 'failed' }]);

      const everything = await packages.listPackages({
        fullName: `${PREFIX}-agree`,
        limit: 500,
        listingOnly: false,
      });
      const listing = await packages.listPackages({ fullName: `${PREFIX}-agree`, limit: 500 });

      // The rows the projection calls listed are exactly the rows the predicate keeps.
      expect(listing.map((p) => p.id).sort()).toEqual(
        everything
          .filter((p) => p.notListedBecause === null)
          .map((p) => p.id)
          .sort(),
      );
    });
  });

  describe('countPackages', () => {
    it('agrees with the listing across every page, last page included', async () => {
      const r = await repo('paged', { stars: 2 });
      for (let i = 0; i < 7; i += 1) {
        await artifact(r, `p${i}/SKILL.md`, [{ hash: `page-${i}` }]);
      }
      // Suppressed rows that would inflate a count with no join.
      const forked = await repo('paged-fork', { stars: 2, isFork: true });
      await artifact(forked, 'f/SKILL.md', [{ hash: 'pf' }]);
      await artifact(r, 'broken/SKILL.md', [{ hash: 'pb', status: 'failed' }]);

      const total = await packages.countPackages();

      // The exact shape the C9 defect takes. countPackages had no join to
      // repository at all, so it counted rows the listing suppresses; the last
      // page the paginator then computes lands past the end of the listing and
      // skills/page.tsx renders its existing "There is no page N" branch. If the
      // count and the listing describe the same set, the row at offset total-1
      // exists.
      expect(
        await packages.listPackages({ limit: 1, offset: Math.max(0, total - 1) }),
      ).toHaveLength(1);
      // And one past it does not, so the count is not an undercount either.
      expect(await packages.listPackages({ limit: 1, offset: total })).toEqual([]);

      // Every row a listing page hands back is a listed row. Asserted on a real
      // page rather than on the whole table, which a sibling test file writing to
      // the same schema could perturb.
      const page = await packages.listPackages({ limit: 25 });
      expect(page.every((p) => p.notListedBecause === null)).toBe(true);

      // The suppressed rows this test created are absent from the listing and
      // present on their own repository pages.
      expect(await listed(`${PREFIX}-paged-fork`)).toEqual([]);
      expect(await listed(`${PREFIX}-paged`)).toHaveLength(7);
    });

    it('counts suppressed rows too when asked', async () => {
      const before = await packages.countPackages({ listingOnly: false });
      const forked = await repo('count-fork', { isFork: true });
      await artifact(forked, 'f/SKILL.md', [{ hash: 'cf' }]);
      expect(await packages.countPackages({ listingOnly: false })).toBe(before + 1);
    });
  });

  describe('the repository page', () => {
    it('returns more than 250 artifacts, because the scan cap is 400', async () => {
      // packages.ts justified a literal 250 by the scan's file cap. Phase 4 raised
      // that cap to 400 and left the literal behind, so a repository yielding 400
      // artifacts showed 250 of them on its own page, silently.
      const { CAPS } = await import('@/github/scan');
      expect(CAPS.maxFiles).toBeGreaterThan(250);

      const r = await repo('big', { stars: 1 });
      await sql`INSERT INTO package (repository_id, type, source_path, name, slug)
                SELECT ${r}, 'skill', 'big/' || i || '/SKILL.md', 'n' || i, 's' || i
                FROM generate_series(1, 260) i`;
      await sql`INSERT INTO package_version (package_id, commit_sha, content_hash)
                SELECT p.id, ${'c'.repeat(40)}, 'big-' || p.id
                FROM package p WHERE p.repository_id = ${r}`;

      const page = await packages.getRepositoryPackages('test-owner', 'listing-spec-big');
      expect(page?.packages.length).toBe(260);
    });
  });

  describe('DAT-07: suppression can never corrupt stored data', () => {
    it('leaves every stored row byte-identical after every listing query', async () => {
      const plain = await repo('snap-plain', { stars: 400 });
      const fork = await repo('snap-fork', { stars: 5, isFork: true });
      const dup = await repo('snap-dup', { stars: 1 });
      await artifact(plain, 'a/SKILL.md', [{ hash: 'snap' }]);
      await artifact(plain, 'b/SKILL.md', [{ hash: 'snap-b', status: 'failed' }]);
      await artifact(fork, 'c/SKILL.md', [{ hash: 'snap-c' }]);
      await artifact(dup, 'd/SKILL.md', [{ hash: 'snap' }]);

      const before = await snapshot();

      await packages.listPackages({ limit: 500 });
      await packages.listPackages({ limit: 500, listingOnly: false });
      await packages.listPackages({ fullName: `${PREFIX}-snap-dup`, limit: 500 });
      await packages.countPackages();
      await packages.countPackages({ listingOnly: false });
      await packages.getRepositoryPackages('test-owner', 'listing-spec-snap-fork');

      // A SELECT-only predicate satisfies DAT-07 by construction, and "by
      // construction" is exactly the kind of claim this project has twice found
      // untrue. This is the only assertion here that tests the requirement rather
      // than the design.
      expect(await snapshot()).toBe(before);
    });
  });

  /**
   * D-20/D-21: the detail route must resolve for all six artifact types, not
   * only 'skill'. sourcePathFromUrl's unconditional /SKILL.md append breaks
   * every other type today (packages.ts:268-274) — these cases pin the fixed
   * behaviour: sourcePathCandidates and the type-aware detailHref.
   *
   * D-34: 'catalog' is excluded from this route by NOT_LISTED_BECAUSE's
   * 'unparsed' branch, not by a special case here — see 06-RESEARCH.md.
   */
  describe('generic detail route (D-20/D-21)', () => {
    function segmentsFromHref(href: string, fullName: string): string[] {
      const prefix = `/r/${fullName}/`;
      expect(href.startsWith(prefix)).toBe(true);
      return href
        .slice(prefix.length)
        .split('/')
        .map((s) => decodeURIComponent(s));
    }

    it('opens a command at .claude/commands/build.md', async () => {
      const r = await repo('cmd');
      await artifact(r, '.claude/commands/build.md', [{ hash: 'cmd1' }], { type: 'command' });
      const fullName = `${PREFIX}-cmd`;
      const href = packages.detailHref(fullName, '.claude/commands/build.md', 'command');
      const detail = await packages.getPackageDetail(
        'test-owner',
        'listing-spec-cmd',
        segmentsFromHref(href, fullName),
      );
      expect(detail?.sourcePath).toBe('.claude/commands/build.md');
    });

    it('opens a manifest-backed plugin at .claude-plugin/plugin.json', async () => {
      const r = await repo('plugin-manifest');
      await artifact(r, '.claude-plugin/plugin.json', [{ hash: 'pm1' }], { type: 'plugin' });
      const fullName = `${PREFIX}-plugin-manifest`;
      const href = packages.detailHref(fullName, '.claude-plugin/plugin.json', 'plugin');
      const detail = await packages.getPackageDetail(
        'test-owner',
        'listing-spec-plugin-manifest',
        segmentsFromHref(href, fullName),
      );
      expect(detail?.sourcePath).toBe('.claude-plugin/plugin.json');
    });

    it('opens a shape-only plugin at the bare directory cli-tool/components', async () => {
      const r = await repo('plugin-shape');
      await artifact(r, 'cli-tool/components', [{ hash: 'ps1' }], {
        type: 'plugin',
        meta: '{"detectionConfidence":"shape-only"}',
      });
      const fullName = `${PREFIX}-plugin-shape`;
      const href = packages.detailHref(fullName, 'cli-tool/components', 'plugin');
      const detail = await packages.getPackageDetail(
        'test-owner',
        'listing-spec-plugin-shape',
        segmentsFromHref(href, fullName),
      );
      expect(detail?.sourcePath).toBe('cli-tool/components');
    });

    it('opens a hook at .claude/settings.json', async () => {
      const r = await repo('hook');
      await artifact(r, '.claude/settings.json', [{ hash: 'hk1' }], { type: 'hook' });
      const fullName = `${PREFIX}-hook`;
      const href = packages.detailHref(fullName, '.claude/settings.json', 'hook');
      const detail = await packages.getPackageDetail(
        'test-owner',
        'listing-spec-hook',
        segmentsFromHref(href, fullName),
      );
      expect(detail?.sourcePath).toBe('.claude/settings.json');
    });

    it('opens an mcp_server at .mcp.json', async () => {
      const r = await repo('mcp');
      await artifact(r, '.mcp.json', [{ hash: 'mc1' }], { type: 'mcp_server' });
      const fullName = `${PREFIX}-mcp`;
      const href = packages.detailHref(fullName, '.mcp.json', 'mcp_server');
      const detail = await packages.getPackageDetail(
        'test-owner',
        'listing-spec-mcp',
        segmentsFromHref(href, fullName),
      );
      expect(detail?.sourcePath).toBe('.mcp.json');
    });

    it('opens a skill at skills/canvas-design/SKILL.md with a byte-identical href to before this change', async () => {
      const r = await repo('skill');
      await artifact(r, 'skills/canvas-design/SKILL.md', [{ hash: 'sk1' }]);
      const fullName = `${PREFIX}-skill`;
      const href = packages.detailHref(fullName, 'skills/canvas-design/SKILL.md', 'skill');
      // The pre-change function stripped the SKILL.md suffix and produced
      // exactly this string. This regression case is the proof no published
      // skill link broke.
      expect(href).toBe(`/r/${fullName}/skills/canvas-design`);
      const detail = await packages.getPackageDetail(
        'test-owner',
        'listing-spec-skill',
        segmentsFromHref(href, fullName),
      );
      expect(detail?.sourcePath).toBe('skills/canvas-design/SKILL.md');
    });

    it('round-trips detailHref -> segments -> sourcePathCandidates -> getPackageDetail for all six types', async () => {
      const cases: { type: string; sourcePath: string; meta?: string }[] = [
        { type: 'skill', sourcePath: 'skills/rt-skill/SKILL.md' },
        { type: 'plugin', sourcePath: '.claude-plugin/plugin.json' },
        {
          type: 'plugin',
          sourcePath: 'rt-shape/components',
          meta: '{"detectionConfidence":"shape-only"}',
        },
        { type: 'hook', sourcePath: '.claude/settings.json' },
        { type: 'mcp_server', sourcePath: '.mcp.json' },
        { type: 'command', sourcePath: '.claude/commands/rt.md' },
      ];
      for (const [i, c] of cases.entries()) {
        const r = await repo(`rt-${i}`);
        const id = await artifact(r, c.sourcePath, [{ hash: `rt-${i}` }], {
          type: c.type,
          meta: c.meta ?? '{}',
        });
        const fullName = `${PREFIX}-rt-${i}`;
        const href = packages.detailHref(fullName, c.sourcePath, c.type);
        const detail = await packages.getPackageDetail(
          'test-owner',
          `listing-spec-rt-${i}`,
          segmentsFromHref(href, fullName),
        );
        expect(detail?.id).toBe(id);
      }
    });

    it('resolves the literal path deterministically when a repository holds both a command at docs/guide and a skill at docs/guide/SKILL.md', async () => {
      const r = await repo('collision');
      await artifact(r, 'docs/guide', [{ hash: 'coll-cmd' }], { type: 'command' });
      await artifact(r, 'docs/guide/SKILL.md', [{ hash: 'coll-skill' }]);

      for (let i = 0; i < 3; i += 1) {
        const detail = await packages.getPackageDetail('test-owner', 'listing-spec-collision', [
          'docs',
          'guide',
        ]);
        expect(detail?.type).toBe('command');
        expect(detail?.sourcePath).toBe('docs/guide');
      }
    });

    it('sourcePathCandidates: an empty join and the literal SKILL.md both resolve to [SKILL.md]', () => {
      expect(packages.sourcePathCandidates(['SKILL.md'])).toEqual(['SKILL.md']);
      expect(packages.sourcePathCandidates([])).toEqual(['SKILL.md']);
    });

    it('sourcePathCandidates: the literal join comes first, the SKILL.md reconstruction second', () => {
      expect(packages.sourcePathCandidates(['.claude', 'commands', 'build.md'])).toEqual([
        '.claude/commands/build.md',
        '.claude/commands/build.md/SKILL.md',
      ]);
    });
  });
});
