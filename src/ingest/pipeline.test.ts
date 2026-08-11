import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
      expect(contacted.filter((h) => h === 'raw.githubusercontent.com')).toHaveLength(18);
    });

    it('takes the full path for a repository AgentDock has never seen', async () => {
      // Nothing stored, so there is no sha to compare and the short circuit
      // cannot fire.
      stubGitHub();
      const first = await ingestRepository(FULL_NAME);

      expect(first).toMatchObject({ ok: true, outcome: 'ok' });
      expect(contacted.filter((h) => h === 'raw.githubusercontent.com')).toHaveLength(18);
    });
  });

  it('spends exactly two API-host requests and takes every body from the raw host', async () => {
    stubGitHub();

    await ingestRepository(FULL_NAME);

    expect(contacted.filter((h) => h === 'api.github.com')).toHaveLength(2);
    expect(contacted.filter((h) => h === 'raw.githubusercontent.com')).toHaveLength(18);
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
      message: expect.stringContaining('no SKILL.md files'),
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
});
