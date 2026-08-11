import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DETECTORS } from '@/detect';
import type { Detector } from '@/detect/types';
import { CAPS } from '@/github/scan';

// Database-backed tests write, so they write to the test schema. The schema
// module reads this at import time, hence the assignment before any import of
// it. Vitest isolates files into separate workers, so this cannot leak.
process.env.DATABASE_SCHEMA = 'agentdock_test';

const DB_URL = process.env.DATABASE_URL;

const DIR = 'fixtures/anthropics-skills';
const COMMIT = 'f17010c9bb483898c1d9c9f42dde2b3a98889434';
const NODE_ID = 'R_kgDOP0wfhg'; // the reference repository's own, from repo.json
const FULL_NAME = 'anthropics/skills';
const RESET = 1786337813; // 2026-08-10T04:56:53Z

const repoJson = readFileSync(`${DIR}/repo.json`, 'utf8');
const treeJson = readFileSync(`${DIR}/tree.json`, 'utf8');
const badYaml = readFileSync('fixtures/adversarial/bad-yaml.md', 'utf8');

const ONE = 'skills/canvas-design/SKILL.md';
// A sentinel, and always inserted `running`: the queue suite shares this schema
// and its claim takes the oldest claimable row anywhere in it.
const JOB_TARGET = 'test-owner/pipeline-spec-job';

// The frozen corpora all carry a .claude-plugin/marketplace.json in their tree
// (Measurement 1), but scripts/capture-fixtures.mjs never captured its body —
// it is hard-coded to SKILL.md. Every test in this file now registers the
// catalog detector alongside skill, so without a stub the marketplace.json
// candidate would be counted as "skipped" (no captured body on disk) and every
// existing assertion of `truncated: false` would break. An empty, well-formed
// marketplace answers the file read without adding a package, a seed, or a
// failure — the catalog-specific tests below override this with real content.
const MARKETPLACE_PATH = '.claude-plugin/marketplace.json';
const EMPTY_MARKETPLACE = JSON.stringify({
  name: 'empty-marketplace',
  owner: { name: 'Test' },
  plugins: [],
});

/** Every hostname the run was asked for. Two claims become assertions from this. */
let contacted: string[] = [];

function rateHeaders(remaining = '55'): Record<string, string> {
  return {
    'x-ratelimit-limit': '60',
    'x-ratelimit-remaining': remaining,
    'x-ratelimit-reset': String(RESET),
  };
}

type Stub = {
  /** Replaces a body, keyed by the path inside the repository. */
  files?: Record<string, string>;
  /** Replaces the whole tree response. */
  tree?: string;
  /** Replaces the whole repository-metadata response. */
  repo?: string;
  /** Answers both API calls as an exhausted budget. */
  exhausted?: boolean;
};

function stubGitHub(stub: Stub = {}) {
  contacted = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      contacted.push(url.hostname);

      if (url.hostname === 'api.github.com') {
        if (stub.exhausted) {
          return new Response('{}', { status: 403, headers: rateHeaders('0') });
        }
        if (url.pathname.includes('/git/trees/')) {
          return new Response(stub.tree ?? treeJson, { status: 200, headers: rateHeaders() });
        }
        return new Response(stub.repo ?? repoJson, { status: 200, headers: rateHeaders() });
      }

      if (url.hostname === 'raw.githubusercontent.com') {
        const path = decodeURIComponent(url.pathname.split('/').slice(4).join('/'));
        if (path === MARKETPLACE_PATH && stub.files?.[path] === undefined) {
          return new Response(EMPTY_MARKETPLACE, { status: 200 });
        }
        const body =
          stub.files?.[path] ?? readFileSync(`${DIR}/files/${encodeURIComponent(path)}`, 'utf8');
        return new Response(body, { status: 200 });
      }

      // Reaching here means something contacted a host outside the allowlist.
      throw new Error(`unexpected host ${url.hostname}`);
    }),
  );
}

/** The captured tree, re-stamped with a different commit. A push, in other words. */
function treeAt(sha: string): string {
  return JSON.stringify({ ...JSON.parse(treeJson), sha });
}

/** A tree with the same commit sha but a caller-chosen entry list. */
function treeWith(paths: string[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    sha: COMMIT,
    truncated: false,
    tree: paths.map((path) => ({ path, type: 'blob', sha: 'a'.repeat(40), size: 10 })),
    ...extra,
  });
}

describe.skipIf(!DB_URL)('ingestRepository', () => {
  let ingestRepository: typeof import('./pipeline').ingestRepository;
  let sql: typeof import('@/db/client').sql;
  let logSpy: ReturnType<typeof vi.spyOn>;

  async function clean() {
    await sql`DELETE FROM repository WHERE github_node_id = ${NODE_ID}`;
    await sql`DELETE FROM repository_denylist WHERE full_name = ${FULL_NAME}`;
    await sql`DELETE FROM ingest_job WHERE target = ${JOB_TARGET}`;
    await sql`DELETE FROM repo_seed WHERE discovered_from = ${FULL_NAME}`;
  }

  async function storedPackages(): Promise<{ source_path: string; parse_status: string }[]> {
    return sql`
      SELECT p.source_path, (
        SELECT pv.parse_status FROM package_version pv
        WHERE pv.package_id = p.id ORDER BY pv.ingested_at DESC LIMIT 1
      ) AS parse_status
      FROM package p
      JOIN repository r ON r.id = p.repository_id
      WHERE r.github_node_id = ${NODE_ID}
      ORDER BY p.source_path
    `;
  }

  async function versionsOf(sourcePath: string): Promise<number> {
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM package_version pv
      JOIN package p ON p.id = pv.package_id
      JOIN repository r ON r.id = p.repository_id
      WHERE r.github_node_id = ${NODE_ID} AND p.source_path = ${sourcePath}
    `;
    return row.n;
  }

  /** Every finding stored for the latest version of one artifact, by source_path. */
  async function findingsFor(
    sourcePath: string,
  ): Promise<{ category: string; signal: string; start_line: number | null }[]> {
    return sql`
      SELECT cf.category, cf.signal, cf.start_line
      FROM capability_finding cf
      JOIN package_version pv ON pv.id = cf.package_version_id
      JOIN package p ON p.id = pv.package_id
      JOIN repository r ON r.id = p.repository_id
      WHERE r.github_node_id = ${NODE_ID} AND p.source_path = ${sourcePath}
      ORDER BY cf.start_line
    `;
  }

  async function filesInventoryFor(sourcePath: string): Promise<unknown[]> {
    const [row] = await sql<{ files: unknown[] }[]>`
      SELECT p.files
      FROM package p
      JOIN repository r ON r.id = p.repository_id
      WHERE r.github_node_id = ${NODE_ID} AND p.source_path = ${sourcePath}
    `;
    return row?.files ?? [];
  }

  async function analyzedAtFor(sourcePath: string): Promise<Date | null> {
    const [row] = await sql<{ analyzed_at: Date | null }[]>`
      SELECT pv.analyzed_at
      FROM package_version pv
      JOIN package p ON p.id = pv.package_id
      JOIN repository r ON r.id = p.repository_id
      WHERE r.github_node_id = ${NODE_ID} AND p.source_path = ${sourcePath}
      ORDER BY pv.ingested_at DESC LIMIT 1
    `;
    return row.analyzed_at;
  }

  beforeAll(async () => {
    ({ ingestRepository } = await import('./pipeline'));
    ({ sql } = await import('@/db/client'));
    await clean();
  });

  afterAll(async () => {
    await clean();
    await sql.end();
  });

  beforeEach(async () => {
    // Every test starts from an empty repository, so none of them depends on the
    // order the others ran in.
    await clean();
    vi.stubEnv('GITHUB_TOKEN', '');
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('stores every skill the reference repository holds', async () => {
    stubGitHub();

    const result = await ingestRepository(FULL_NAME);

    expect(result).toMatchObject({
      ok: true,
      owner: 'anthropics',
      repo: 'skills',
      fullName: FULL_NAME,
      commitSha: COMMIT,
      found: 18,
      stored: 18,
      failed: 0,
      truncated: false,
    });

    const rows = await storedPackages();
    expect(rows).toHaveLength(18);
    // The two specification violations the corpus really contains are stored as
    // partial, not dropped.
    expect(rows.filter((r) => r.parse_status === 'partial')).toHaveLength(2);
    expect(rows.filter((r) => r.parse_status === 'failed')).toHaveLength(0);
  });

  describe('capability findings (the CAP-05 install tracer)', () => {
    it('stores the measured install findings for the reference repository, with analyzed_at set for every version', async () => {
      stubGitHub();
      await ingestRepository(FULL_NAME);

      // skills/docx/SKILL.md:21 says "npm install" twice on the same line.
      // Both produce an identical Finding tuple (same detector, category,
      // source path, line and summary), so capability_finding_identity's
      // unique constraint — (package_version_id, detector_id, category,
      // source_path, start_line, summary), per CONTEXT.md Reference G —
      // collapses them to the one row a reader would otherwise see twice.
      const docx = await findingsFor('skills/docx/SKILL.md');
      expect(docx).toEqual([
        { category: 'package_install', signal: 'npm install', start_line: 21 },
      ]);

      // A skill with no install directive is still analyzed — zero findings,
      // never zero rows because nothing looked.
      const canvas = await findingsFor('skills/canvas-design/SKILL.md');
      expect(canvas).toEqual([]);
      expect(await analyzedAtFor('skills/canvas-design/SKILL.md')).not.toBeNull();
      expect(await analyzedAtFor('skills/docx/SKILL.md')).not.toBeNull();
    });

    it('mints no new findings on a second ingest of unchanged content', async () => {
      stubGitHub();
      await ingestRepository(FULL_NAME);
      const before = await findingsFor('skills/docx/SKILL.md');

      // Same commit: fetchRepoScanInputs short-circuits to the unchanged path,
      // and no file is even re-read.
      stubGitHub();
      await ingestRepository(FULL_NAME);
      const after = await findingsFor('skills/docx/SKILL.md');

      expect(after).toEqual(before);
    });
  });

  describe('the file inventory (CAP-01 / CAP-03)', () => {
    it('lists path, size, executable bit, from the tree already fetched — no new GitHub request', async () => {
      stubGitHub();
      await ingestRepository(FULL_NAME);

      const docx = await filesInventoryFor('skills/docx/SKILL.md');
      // Real corpus fact (04-RESEARCH.md §Q12): docx bundles 100755 scripts.
      expect(docx.length).toBeGreaterThan(1);
      expect(docx).toContainEqual(
        expect.objectContaining({
          path: 'skills/docx/scripts/accept_changes.py',
          executable: true,
        }),
      );
      // Every host contacted is still exactly the allowlisted two.
      expect(new Set(contacted)).toEqual(new Set(['api.github.com', 'raw.githubusercontent.com']));
    });

    it('refreshes on a scan where the tree moved but the manifest did not', async () => {
      stubGitHub();
      await ingestRepository(FULL_NAME);
      const before = await filesInventoryFor('skills/docx/SKILL.md');
      expect(before.map((f: unknown) => (f as { path: string }).path)).not.toContain(
        'skills/docx/scripts/new-script.py',
      );

      // A new commit adds a script beside docx's unchanged SKILL.md. The
      // manifest's own bytes never move, so no version is minted — but the
      // tree did move, and the inventory is derived from the tree, not from
      // content_hash.
      const withNewScript = {
        ...JSON.parse(treeJson),
        sha: 'd'.repeat(40),
        tree: [
          ...JSON.parse(treeJson).tree,
          {
            path: 'skills/docx/scripts/new-script.py',
            type: 'blob',
            sha: 'e'.repeat(40),
            mode: '100755',
          },
        ],
      };
      stubGitHub({ tree: JSON.stringify(withNewScript) });
      await ingestRepository(FULL_NAME);

      expect(await versionsOf('skills/docx/SKILL.md')).toBe(1); // unchanged manifest: no new version
      const after = await filesInventoryFor('skills/docx/SKILL.md');
      expect(after.map((f: unknown) => (f as { path: string }).path)).toContain(
        'skills/docx/scripts/new-script.py',
      );
    });
  });

  describe('a second ingest at the same commit', () => {
    async function versionCount(): Promise<number> {
      const [row] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM package_version pv
        JOIN package p ON p.id = pv.package_id
        JOIN repository r ON r.id = p.repository_id WHERE r.github_node_id = ${NODE_ID}
      `;
      return row.n;
    }

    async function repoRow() {
      const [row] = await sql<
        { scanned_at: string | Date; stars: number; last_ingested_sha: string }[]
      >`SELECT scanned_at, stars, last_ingested_sha FROM repository
          WHERE github_node_id = ${NODE_ID}`;
      return row;
    }

    it('reads none of its files, and still spends exactly two API-host requests', async () => {
      stubGitHub();
      await ingestRepository(FULL_NAME);

      stubGitHub();
      const second = await ingestRepository(FULL_NAME);

      expect(contacted.filter((h) => h === 'raw.githubusercontent.com')).toHaveLength(0);
      // Both core calls are issued concurrently, before the sha inside the tree
      // response is known, and the metadata is wanted regardless. So the saving
      // is file reads and wall clock — never GitHub quota. This number is what
      // stops a later edit describing it as one.
      expect(contacted.filter((h) => h === 'api.github.com')).toHaveLength(2);
      expect(second).toMatchObject({ ok: true, outcome: 'unchanged', commitSha: COMMIT });
    });

    it('reports the live artifact count as discovered and unchanged, and nothing else', async () => {
      stubGitHub();
      await ingestRepository(FULL_NAME);

      stubGitHub();
      const second = await ingestRepository(FULL_NAME);

      // Nothing was read, so a literal count of what THIS run discovered is
      // zero — and printing zero beside a page showing eighteen skills is a
      // worse lie than the count it replaces.
      expect(second).toMatchObject({
        ok: true,
        found: 18,
        stored: 18,
        failed: 0,
        truncated: false,
        counters: { discovered: 18, new: 0, updated: 0, unchanged: 18, removed: 0, parseFailed: 0 },
      });
    });

    it('mints no version row and creates no package row', async () => {
      stubGitHub();
      await ingestRepository(FULL_NAME);
      const before = await versionCount();

      stubGitHub();
      await ingestRepository(FULL_NAME);

      expect(await versionCount()).toBe(before);
      expect(await versionCount()).toBe(18);
      expect(await storedPackages()).toHaveLength(18);
    });

    it('still moves the last-looked timestamp and refreshes the metadata', async () => {
      stubGitHub();
      await ingestRepository(FULL_NAME);
      const before = await repoRow();
      expect(before.last_ingested_sha).toBe(COMMIT);

      // Stars move independently of the commit, so they are still refreshed.
      stubGitHub({ repo: JSON.stringify({ ...JSON.parse(repoJson), stargazers_count: 4242 }) });
      await ingestRepository(FULL_NAME);

      const after = await repoRow();
      expect(after.stars).toBe(4242);
      expect(new Date(after.scanned_at).getTime()).toBeGreaterThanOrEqual(
        new Date(before.scanned_at).getTime(),
      );
    });

    it('takes the full path again once the commit has moved', async () => {
      stubGitHub();
      await ingestRepository(FULL_NAME);

      stubGitHub({ tree: treeAt('b'.repeat(40)) });
      const second = await ingestRepository(FULL_NAME);

      expect(second).toMatchObject({ ok: true, outcome: 'ok', commitSha: 'b'.repeat(40) });
      // 18 skills plus the one .claude-plugin/marketplace.json the catalog
      // detector now also reads (Measurement 1 — every frozen corpus carries one).
      expect(contacted.filter((h) => h === 'raw.githubusercontent.com')).toHaveLength(19);
    });

    it('takes the full path for a repository AgentDock has never seen', async () => {
      // Nothing stored, so there is no sha to compare and the short circuit
      // cannot fire.
      stubGitHub();
      const first = await ingestRepository(FULL_NAME);

      expect(first).toMatchObject({ ok: true, outcome: 'ok' });
      expect(contacted.filter((h) => h === 'raw.githubusercontent.com')).toHaveLength(19);
    });
  });

  it('spends exactly two API-host requests and takes every body from the raw host', async () => {
    stubGitHub();

    await ingestRepository(FULL_NAME);

    expect(contacted.filter((h) => h === 'api.github.com')).toHaveLength(2);
    // 18 skills plus the catalog detector's one marketplace.json read.
    expect(contacted.filter((h) => h === 'raw.githubusercontent.com')).toHaveLength(19);
    expect(new Set(contacted)).toEqual(new Set(['api.github.com', 'raw.githubusercontent.com']));
  });

  it('never resolves a URL written inside repository content', async () => {
    const planted = [
      '---',
      'name: canvas-design',
      'description: a body full of links',
      '---',
      '',
      'See https://evil.example.test/payload and <https://tracker.example.test/pixel>.',
      '',
      '[link](https://another.example.test/x)',
      '',
    ].join('\n');

    stubGitHub({ files: { [ONE]: planted } });

    const result = await ingestRepository(FULL_NAME);
    expect(result.ok).toBe(true);

    // Asserted from the recorded list, not by reading the code. The allowlist
    // makes this structurally impossible; this is what proves the structure held.
    expect(new Set(contacted)).toEqual(new Set(['api.github.com', 'raw.githubusercontent.com']));
    for (const host of contacted) {
      expect(host).not.toMatch(/example\.test$/);
    }

    // Stored as text, which is the other half of the claim.
    const [row] = await sql<{ body: string }[]>`
      SELECT pv.body FROM package_version pv
      JOIN package p ON p.id = pv.package_id
      JOIN repository r ON r.id = p.repository_id
      WHERE r.github_node_id = ${NODE_ID} AND p.source_path = ${ONE}
    `;
    expect(row.body).toContain('https://evil.example.test/payload');
  });

  it('stores one failed artifact and the other seventeen normally', async () => {
    stubGitHub({ files: { 'template/SKILL.md': badYaml } });

    const result = await ingestRepository(FULL_NAME);

    // The run still succeeds. One bad file must not lose the other seventeen.
    expect(result).toMatchObject({ ok: true, found: 18, stored: 18, failed: 1 });

    const rows = await storedPackages();
    expect(rows).toHaveLength(18);
    expect(rows.filter((r) => r.parse_status === 'failed').map((r) => r.source_path)).toEqual([
      'template/SKILL.md',
    ]);
    expect(rows.filter((r) => r.parse_status !== 'failed')).toHaveLength(17);

    // A visible broken entry, with its reasons, rather than a silent absence.
    const [failedRow] = await sql<{ parse_errors: string[] }[]>`
      SELECT pv.parse_errors FROM package_version pv
      JOIN package p ON p.id = pv.package_id
      JOIN repository r ON r.id = p.repository_id
      WHERE r.github_node_id = ${NODE_ID} AND p.source_path = 'template/SKILL.md'
    `;
    expect(failedRow.parse_errors.length).toBeGreaterThan(0);
  });

  it('records incompleteness when the tree itself was cut short', async () => {
    stubGitHub({ tree: treeWith([ONE], { truncated: true }) });

    const result = await ingestRepository(FULL_NAME);

    expect(result).toMatchObject({ ok: true, found: 1, stored: 1, truncated: true });
    const [repo] = await sql<{ tree_truncated: boolean }[]>`
      SELECT tree_truncated FROM repository WHERE github_node_id = ${NODE_ID}
    `;
    expect(repo.tree_truncated).toBe(true);
  });

  it('records incompleteness when a body could not be read', async () => {
    // The second path is not in the frozen capture, so the stub throws on it —
    // a different cause, and the same fact for whoever reads the page.
    stubGitHub({ tree: treeWith([ONE, 'skills/not-captured/SKILL.md']) });

    const result = await ingestRepository(FULL_NAME);

    expect(result).toMatchObject({ ok: true, found: 1, stored: 1, truncated: true });
    const [repo] = await sql<{ tree_truncated: boolean }[]>`
      SELECT tree_truncated FROM repository WHERE github_node_id = ${NODE_ID}
    `;
    expect(repo.tree_truncated).toBe(true);
  });

  it('writes nothing when the tree holds no skill files', async () => {
    stubGitHub({ tree: treeWith(['README.md', 'src/index.ts']) });

    const result = await ingestRepository(FULL_NAME);

    expect(result).toEqual({
      ok: false,
      outcome: 'no_artifacts',
      message: expect.stringContaining('no agent artifacts'),
    });
    // Path-only detection, so a repository with no artifacts costs zero body reads.
    expect(contacted.filter((h) => h === 'raw.githubusercontent.com')).toHaveLength(0);
    const [repo] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM repository WHERE github_node_id = ${NODE_ID}
    `;
    expect(repo.n).toBe(0);
  });

  it('refuses a denylisted repository before any request is made', async () => {
    await sql`INSERT INTO repository_denylist (full_name, reason) VALUES (${FULL_NAME}, 'test')`;
    stubGitHub();

    const result = await ingestRepository('Anthropics/Skills');

    expect(result).toEqual({
      ok: false,
      outcome: 'denylisted',
      message: expect.stringContaining('removed from AgentDock'),
    });
    // A removal that only takes effect after the fetch is not a removal.
    expect(contacted).toEqual([]);
  });

  it('refuses a value that is not owner/repo before a socket opens', async () => {
    stubGitHub();

    const result = await ingestRepository('https://github.com/anthropics/skills');

    expect(result).toEqual({
      ok: false,
      outcome: 'invalid_input',
      message: expect.stringContaining('does not accept full URLs'),
    });
    expect(contacted).toEqual([]);
  });

  it('reports an exhausted budget with the time it resets', async () => {
    stubGitHub({ exhausted: true });

    const result = await ingestRepository(FULL_NAME);

    expect(result).toMatchObject({ ok: false, outcome: 'rate_limited' });
    if (result.ok) throw new Error('unreachable');
    expect(result.message).toMatch(/The budget resets at 04:56 UTC\.$/);
    expect(result.message).not.toMatch(/GitHubError|at .*:\d+:\d+/);
    // Carried out on the result so the worker schedules from the value the
    // catch block already read, rather than deriving the same fact a second way.
    expect(result.resetAt).toBe(RESET);
  });

  it('mints no version for a line-ending change and one for a content change', async () => {
    const original = readFileSync(`${DIR}/files/${encodeURIComponent(ONE)}`, 'utf8');

    stubGitHub();
    await ingestRepository(FULL_NAME);
    expect(await versionsOf(ONE)).toBe(1);

    // Each run carries a moved commit, because that is the only way a content
    // change reaches AgentDock at all — an unmoved commit short-circuits before
    // a single body is read, which is the point of the run above.
    //
    // Only the line endings differ here. A whitespace-only commit must not mint
    // a version for every artifact in the repository.
    stubGitHub({ tree: treeAt('b'.repeat(40)), files: { [ONE]: original.replace(/\n/g, '\r\n') } });
    await ingestRepository(FULL_NAME);
    expect(await versionsOf(ONE)).toBe(1);

    // A real change must.
    stubGitHub({
      tree: treeAt('c'.repeat(40)),
      files: { [ONE]: `${original}\n\nOne more paragraph.\n` },
    });
    await ingestRepository(FULL_NAME);
    expect(await versionsOf(ONE)).toBe(2);
  });

  it('emits exactly one structured log line per ingest, carrying no body', async () => {
    stubGitHub();

    await ingestRepository(FULL_NAME);

    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = logSpy.mock.calls[0][0] as string;
    const entry = JSON.parse(line);

    expect(entry).toMatchObject({
      event: 'ingest',
      jobId: null,
      attempt: null,
      owner: 'anthropics',
      repo: 'skills',
      commitSha: COMMIT,
      outcome: 'ok',
      found: 18,
      stored: 18,
      failed: 0,
      new: 18,
      updated: 0,
      unchanged: 0,
      removed: 0,
      truncated: false,
      rateRemaining: 55,
      rateReset: RESET,
    });
    expect(typeof entry.durationMs).toBe('number');

    // No body text, no credential, no header, no query.
    expect(line).not.toMatch(/Bearer|authorization|token|password/i);
    expect(line).not.toMatch(/^---|frontmatter|Claude|description/);
    expect(line.length).toBeLessThan(400);
  });

  it('emits its one line on the failure paths too', async () => {
    stubGitHub({ exhausted: true });
    await ingestRepository(FULL_NAME);
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(logSpy.mock.calls[0][0] as string).outcome).toBe('rate_limited');
  });

  it('run under a job writes one attempt row and one terminal transition, not two', async () => {
    stubGitHub();
    const [job] = await sql<{ id: number }[]>`
      INSERT INTO ingest_job (target, status, attempts, started_at, worker_id)
      VALUES (${JOB_TARGET}, 'running', 1, now(), 'pipeline-spec')
      RETURNING id
    `;

    const result = await ingestRepository(FULL_NAME, {
      id: job.id,
      attemptNo: 1,
      startedAt: new Date(),
    });

    expect(result).toMatchObject({ ok: true, found: 18 });
    if (!result.ok) throw new Error('unreachable');
    expect(result.counters).toMatchObject({ discovered: 18, new: 18, updated: 0, unchanged: 0 });

    const attempts = await sql<
      { outcome: string; artifacts_new: number; commit_sha: string }[]
    >`SELECT outcome, artifacts_new, commit_sha FROM ingest_attempt WHERE job_id = ${job.id}`;
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ outcome: 'ok', artifacts_new: 18, commit_sha: COMMIT });

    const [row] = await sql<{ status: string; finished_at: Date | null }[]>`
      SELECT status, finished_at FROM ingest_job WHERE id = ${job.id}
    `;
    expect(row.status).toBe('succeeded');
    expect(row.finished_at).not.toBeNull();
  });

  describe('detector isolation (DET-07)', () => {
    // DETECTORS is a plain exported array — mutating its contents (not
    // reassigning the binding) is enough to plant a throwing detector for one
    // test and remove it after, with no module mocking involved.
    function withExtraDetector(extra: Detector, run: () => Promise<void>) {
      DETECTORS.push(extra);
      return run().finally(() => {
        const i = DETECTORS.indexOf(extra);
        if (i >= 0) DETECTORS.splice(i, 1);
      });
    }

    it('stores every skill the reference corpus holds even when a registered detector throws from match()', async () => {
      const boom: Detector = {
        type: 'boom',
        match() {
          throw new Error('boom detector always throws');
        },
        async parse() {
          throw new Error('unreachable: match already threw');
        },
      };

      await withExtraDetector(boom, async () => {
        stubGitHub();
        const result = await ingestRepository(FULL_NAME);

        // Before the isolation guard, a throw from match() propagates to the
        // pipeline's single outer catch and the whole repository fails with
        // outcome: 'storage_failed' instead of ingesting normally — that is
        // the regression this test is written to catch.
        expect(result).toMatchObject({ ok: true, found: 18, stored: 18, failed: 0 });

        const rows = await storedPackages();
        expect(rows).toHaveLength(18);
      });
    });

    // A pipeline-level parse()-throw regression would need the fake detector's
    // `type` to reference a real artifact_type row (the FK the failed-row insert
    // depends on), which turns "a detector that throws" into "a detector that
    // impersonates skill" — a worse test than the one above. safeParse's
    // guarantee that a thrown parse() becomes a failed ParseResult rather than an
    // exception, provable without a database, is `run.test.ts`'s job (see
    // `safeParse` describe block there); per <verification> item 1 both
    // properties — match() and parse() isolation — are "provable without a
    // database."
  });

  describe('catalog (DET-03)', () => {
    const wellFormedMarketplace = JSON.stringify({
      name: 'agentdock-test-marketplace',
      owner: { name: 'Test Owner' },
      plugins: [
        { name: 'a', source: { source: 'github', repo: 'seed-owner-a/seed-repo-a' } },
        {
          name: 'b',
          source: { source: 'url', url: 'https://github.com/seed-owner-b/seed-repo-b' },
        },
        // Relative: inside this same repository, the plugin detector's own job.
        { name: 'c', source: './plugins/c' },
      ],
    });
    const malformedMarketplace = readFileSync(
      'fixtures/adversarial/marketplace-malformed.json',
      'utf8',
    );

    async function catalogPackages() {
      return sql<{ source_path: string; delisted_at: Date | null; parse_status: string }[]>`
        SELECT p.source_path, p.delisted_at, (
          SELECT pv.parse_status FROM package_version pv
          WHERE pv.package_id = p.id ORDER BY pv.ingested_at DESC LIMIT 1
        ) AS parse_status
        FROM package p
        JOIN repository r ON r.id = p.repository_id
        WHERE r.github_node_id = ${NODE_ID} AND p.type = 'catalog'
      `;
    }

    it('ingests a repository whose only artifact is a marketplace.json, rather than reporting no_artifacts', async () => {
      stubGitHub({
        tree: treeWith([MARKETPLACE_PATH]),
        files: { [MARKETPLACE_PATH]: wellFormedMarketplace },
      });

      const result = await ingestRepository(FULL_NAME);

      expect(result).toMatchObject({ ok: true, found: 0, stored: 0, seeds: 2 });
    });

    it('never resolves a URL read from a marketplace.json seed', async () => {
      stubGitHub({
        tree: treeWith([MARKETPLACE_PATH]),
        files: { [MARKETPLACE_PATH]: wellFormedMarketplace },
      });

      const result = await ingestRepository(FULL_NAME);

      expect(result.ok).toBe(true);
      // Asserted from the recorded list, the same way pipeline.test.ts already
      // proves it for a URL planted in a skill body: the allowlist makes
      // following the seed's own github.com URL structurally impossible.
      expect(new Set(contacted)).toEqual(new Set(['api.github.com', 'raw.githubusercontent.com']));
    });

    it('records a malformed marketplace as one failed catalog package row, and zero seeds', async () => {
      stubGitHub({ files: { [MARKETPLACE_PATH]: malformedMarketplace } });

      const result = await ingestRepository(FULL_NAME);

      // 18 skills plus the one failed catalog row.
      expect(result).toMatchObject({ ok: true, found: 19, stored: 19, failed: 1, seeds: 0 });

      const rows = await catalogPackages();
      expect(rows).toMatchObject([{ source_path: MARKETPLACE_PATH, parse_status: 'failed' }]);
    });

    it('a well-formed marketplace produces zero catalog package rows and one seed row per GitHub-reachable entry', async () => {
      stubGitHub({ files: { [MARKETPLACE_PATH]: wellFormedMarketplace } });

      const result = await ingestRepository(FULL_NAME);

      expect(result).toMatchObject({ ok: true, found: 18, stored: 18, failed: 0, seeds: 2 });
      expect(await catalogPackages()).toEqual([]);

      const seedRows = await sql<{ full_name: string }[]>`
        SELECT full_name FROM repo_seed WHERE discovered_from = ${FULL_NAME} ORDER BY full_name
      `;
      expect(seedRows.map((r) => r.full_name)).toEqual([
        'seed-owner-a/seed-repo-a',
        'seed-owner-b/seed-repo-b',
      ]);
    });

    it('delists the failed catalog row once the marketplace is fixed, because a parsed catalog contributes no package id', async () => {
      stubGitHub({ files: { [MARKETPLACE_PATH]: malformedMarketplace } });
      await ingestRepository(FULL_NAME);

      const before = await catalogPackages();
      expect(before).toHaveLength(1);
      expect(before[0].delisted_at).toBeNull();

      stubGitHub({
        tree: treeAt('c'.repeat(40)),
        files: { [MARKETPLACE_PATH]: wellFormedMarketplace },
      });
      await ingestRepository(FULL_NAME);

      const after = await catalogPackages();
      expect(after).toHaveLength(1);
      expect(after[0].delisted_at).not.toBeNull();
    });
  });

  describe('the file budget (DET-06 / the CAPS.maxFiles raise)', () => {
    const WSHOBSON_DIR = 'fixtures/wshobson-agents';
    const WSHOBSON_NODE_ID = 'R_kgDOPSVUiA'; // from fixtures/wshobson-agents/repo.json
    const WSHOBSON_FULL_NAME = 'wshobson/agents';
    const wshobsonRepoJson = readFileSync(`${WSHOBSON_DIR}/repo.json`, 'utf8');
    const wshobsonTreeJson = readFileSync(`${WSHOBSON_DIR}/tree.json`, 'utf8');

    /**
     * Every requested path answered with a minimal, valid, type-appropriate
     * body — the assertion under test is the count and the truncation flag,
     * not the content. Real bodies were never captured for all 384 wanted
     * files (Measurement 1); only 20 skill bodies were ever sampled to disk.
     */
    function bodyFor(path: string): string {
      if (path === MARKETPLACE_PATH || path.endsWith(`/${MARKETPLACE_PATH}`)) {
        return EMPTY_MARKETPLACE;
      }
      if (path.endsWith('.claude-plugin/plugin.json')) {
        return JSON.stringify({ name: 'stub-plugin' });
      }
      if (path.endsWith('.mcp.json')) {
        return JSON.stringify({ mcpServers: { stub: { command: 'stub-server' } } });
      }
      // SKILL.md, root or nested — the only other type this corpus's four
      // registered detectors can want.
      return '---\nname: stub-skill\ndescription: a stub body for the file-budget test\n---\n\nBody.\n';
    }

    function stubWshobson() {
      contacted = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string | URL) => {
          const url = new URL(String(input));
          contacted.push(url.hostname);

          if (url.hostname === 'api.github.com') {
            if (url.pathname.includes('/git/trees/')) {
              return new Response(wshobsonTreeJson, { status: 200, headers: rateHeaders() });
            }
            return new Response(wshobsonRepoJson, { status: 200, headers: rateHeaders() });
          }
          if (url.hostname === 'raw.githubusercontent.com') {
            const path = decodeURIComponent(url.pathname.split('/').slice(4).join('/'));
            return new Response(bodyFor(path), { status: 200 });
          }
          throw new Error(`unexpected host ${url.hostname}`);
        }),
      );
    }

    async function packageCounts(): Promise<Record<string, number>> {
      const rows = await sql<{ type: string; n: number }[]>`
        SELECT p.type, count(*)::int AS n FROM package p
        JOIN repository r ON r.id = p.repository_id
        WHERE r.github_node_id = ${WSHOBSON_NODE_ID}
        GROUP BY p.type
      `;
      return Object.fromEntries(rows.map((r) => [r.type, r.n]));
    }

    beforeEach(async () => {
      await sql`DELETE FROM repository WHERE github_node_id = ${WSHOBSON_NODE_ID}`;
    });

    afterEach(async () => {
      await sql`DELETE FROM repository WHERE github_node_id = ${WSHOBSON_NODE_ID}`;
    });

    it('ingests all 91 plugins and all 180 skills at the raised cap, and reports itself not truncated', async () => {
      stubWshobson();

      const result = await ingestRepository(WSHOBSON_FULL_NAME);

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('unreachable');
      expect(result.truncated).toBe(false);

      const counts = await packageCounts();
      expect(counts.plugin).toBe(91);
      expect(counts.skill).toBe(180);
    });

    it('reports itself truncated at the old cap of 200 — the cap raise is what changed it', async () => {
      const original = CAPS.maxFiles;
      (CAPS as { maxFiles: number }).maxFiles = 200;
      try {
        stubWshobson();
        const result = await ingestRepository(WSHOBSON_FULL_NAME);

        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error('unreachable');
        expect(result.truncated).toBe(true);
      } finally {
        (CAPS as { maxFiles: number }).maxFiles = original;
      }
    });
  });

  describe('the phase gate: all six detectors over all four corpora (DET-05 / DET-09 / DET-10)', () => {
    const CORPORA: { slug: string; fullName: string; nodeId: string; dir: string }[] = [
      { slug: 'anthropics-skills', fullName: FULL_NAME, nodeId: NODE_ID, dir: DIR },
      {
        slug: 'addyosmani-agent-skills',
        fullName: 'addyosmani/agent-skills',
        nodeId: 'R_kgDORRCyRw',
        dir: 'fixtures/addyosmani-agent-skills',
      },
      {
        slug: 'baoyu-skills',
        fullName: 'JimLiu/baoyu-skills',
        nodeId: 'R_kgDOQ4teag',
        dir: 'fixtures/baoyu-skills',
      },
      {
        slug: 'wshobson-agents',
        fullName: 'wshobson/agents',
        nodeId: 'R_kgDOPSVUiA',
        dir: 'fixtures/wshobson-agents',
      },
    ];

    // The per-type counts the four trees hold, matching CONTEXT.md's own
    // Measurement 1 table exactly. catalog never produces a package row (it
    // routes to repo_seed instead), so it is absent from every entry here.
    const EXPECTED: Record<string, Record<string, number>> = {
      'anthropics-skills': { skill: 18 },
      'addyosmani-agent-skills': { skill: 24, plugin: 1, command: 8, hook: 1 },
      'baoyu-skills': { skill: 22 },
      'wshobson-agents': { skill: 180, plugin: 91, mcp_server: 1, command: 109, hook: 2 },
    };

    /**
     * Every requested path answered with a minimal, valid, type-appropriate
     * body — the assertion under test is the per-type count, not the content.
     * Real bodies were never captured for anything but SKILL.md
     * (capture-fixtures.mjs is hard-coded to it); same reasoning as the file-
     * budget block above, generalized to all six detectors.
     */
    function bodyForAnyType(path: string): string {
      if (path === MARKETPLACE_PATH || path.endsWith(`/${MARKETPLACE_PATH}`))
        return EMPTY_MARKETPLACE;
      if (path.endsWith('.claude-plugin/plugin.json'))
        return JSON.stringify({ name: 'stub-plugin' });
      if (path.endsWith('.mcp.json')) {
        return JSON.stringify({ mcpServers: { stub: { command: 'stub-server' } } });
      }
      if (path.endsWith('server.json')) {
        return JSON.stringify({ name: 'stub-server', description: 'a stub MCP server' });
      }
      const segments = path.split('/');
      if (
        path.endsWith('.md') &&
        segments[segments.length - 1].toUpperCase() !== 'README.MD' &&
        segments.slice(0, -1).includes('commands')
      ) {
        return '---\nname: stub-command\ndescription: a stub command body\n---\n\nBody.\n';
      }
      if (
        segments[segments.length - 1] === 'hooks.json' &&
        segments[segments.length - 2] === 'hooks'
      ) {
        return JSON.stringify({
          hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'stub' }] }] },
        });
      }
      if (path === '.claude/settings.json' || path.endsWith('/.claude/settings.json')) {
        return JSON.stringify({ enabledPlugins: {} });
      }
      // SKILL.md, root or nested — the only shape left.
      return '---\nname: stub-skill\ndescription: a stub skill body\n---\n\nBody.\n';
    }

    function stubGeneric(repoBody: string, treeBody: string) {
      contacted = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string | URL) => {
          const url = new URL(String(input));
          contacted.push(url.hostname);

          if (url.hostname === 'api.github.com') {
            if (url.pathname.includes('/git/trees/')) {
              return new Response(treeBody, { status: 200, headers: rateHeaders() });
            }
            return new Response(repoBody, { status: 200, headers: rateHeaders() });
          }
          if (url.hostname === 'raw.githubusercontent.com') {
            const path = decodeURIComponent(url.pathname.split('/').slice(4).join('/'));
            return new Response(bodyForAnyType(path), { status: 200 });
          }
          throw new Error(`unexpected host ${url.hostname}`);
        }),
      );
    }

    async function packageTypeCounts(nodeId: string): Promise<Record<string, number>> {
      const rows = await sql<{ type: string; n: number }[]>`
        SELECT p.type, count(*)::int AS n FROM package p
        JOIN repository r ON r.id = p.repository_id
        WHERE r.github_node_id = ${nodeId}
        GROUP BY p.type
      `;
      return Object.fromEntries(rows.map((r) => [r.type, r.n]));
    }

    for (const corpusCase of CORPORA) {
      const { slug, fullName, nodeId, dir } = corpusCase;

      it(`ingests ${slug} end to end with the per-type counts its tree holds, contacting only the allowlisted hosts`, async () => {
        await sql`DELETE FROM repository WHERE github_node_id = ${nodeId}`;
        try {
          const repoBody = readFileSync(`${dir}/repo.json`, 'utf8');
          const treeBody = readFileSync(`${dir}/tree.json`, 'utf8');
          stubGeneric(repoBody, treeBody);

          const result = await ingestRepository(fullName);

          expect(result.ok).toBe(true);
          if (!result.ok) throw new Error('unreachable');
          expect(result.truncated).toBe(false);
          // The allowlist made structurally impossible, not merely asserted:
          // stubGeneric throws on any hostname that is neither of these two.
          for (const host of contacted) {
            expect(['api.github.com', 'raw.githubusercontent.com']).toContain(host);
          }

          const counts = await packageTypeCounts(nodeId);
          expect(counts).toEqual(EXPECTED[slug]);
        } finally {
          await sql`DELETE FROM repository WHERE github_node_id = ${nodeId}`;
        }
      });
    }
  });
});
