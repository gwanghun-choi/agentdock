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
        return new Response(repoJson, { status: 200, headers: rateHeaders() });
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

  it('changes nothing when the same repository is ingested again', async () => {
    stubGitHub();
    const first = await ingestRepository(FULL_NAME);
    const [before] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM package_version pv
      JOIN package p ON p.id = pv.package_id
      JOIN repository r ON r.id = p.repository_id WHERE r.github_node_id = ${NODE_ID}
    `;

    stubGitHub();
    const second = await ingestRepository(FULL_NAME);
    const [after] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM package_version pv
      JOIN package p ON p.id = pv.package_id
      JOIN repository r ON r.id = p.repository_id WHERE r.github_node_id = ${NODE_ID}
    `;

    expect(second).toEqual(first);
    expect(after.n).toBe(before.n);
    expect(after.n).toBe(18);
    expect(await storedPackages()).toHaveLength(18);
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
  });

  it('mints no version for a line-ending change and one for a content change', async () => {
    const original = readFileSync(`${DIR}/files/${encodeURIComponent(ONE)}`, 'utf8');

    stubGitHub();
    await ingestRepository(FULL_NAME);
    expect(await versionsOf(ONE)).toBe(1);

    // Only the line endings differ. A whitespace-only commit must not mint a
    // version for every artifact in the repository.
    stubGitHub({ files: { [ONE]: original.replace(/\n/g, '\r\n') } });
    await ingestRepository(FULL_NAME);
    expect(await versionsOf(ONE)).toBe(1);

    // A real change must.
    stubGitHub({ files: { [ONE]: `${original}\n\nOne more paragraph.\n` } });
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
      owner: 'anthropics',
      repo: 'skills',
      commitSha: COMMIT,
      outcome: 'ok',
      found: 18,
      stored: 18,
      failed: 0,
      rateRemaining: 55,
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
});
