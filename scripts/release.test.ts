import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decideRelease, gate, smoke, TYPES } from './release.mjs';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

describe('decideRelease', () => {
  it.each([
    [{ sha: A, tip: A, ciSucceeded: false, productionSha: null }, 'BLOCKED_CI'],
    [{ sha: A, tip: B, ciSucceeded: true, productionSha: null }, 'SUPERSEDED'],
    // An older sha re-run after a newer one shipped, even though CI passed.
    [{ sha: A, tip: B, ciSucceeded: true, productionSha: B }, 'SUPERSEDED'],
    [{ sha: A, tip: A, ciSucceeded: true, productionSha: A }, 'ALREADY_DEPLOYED'],
    [{ sha: A, tip: A, ciSucceeded: true, productionSha: B }, 'DEPLOY'],
    [{ sha: A, tip: A, ciSucceeded: true, productionSha: null }, 'DEPLOY'],
  ])('%o → %s', (facts, decision) => {
    expect(decideRelease(facts)).toBe(decision);
  });
});

/** A fake production site: `routes` maps a path to [status, body]. */
function site(routes: Record<string, [number, string]>, commit: string | null) {
  const seen: string[] = [];
  const fetchImpl = async (input: URL | string, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname + url.search;
    seen.push(`${init?.method ?? 'GET'} ${path}`);
    const [status, body] = routes[path] ?? routes[url.pathname] ?? [404, ''];
    const headers = new Headers(commit ? { 'x-agentdock-commit': commit } : {});
    return new Response(init?.method === 'HEAD' ? null : body, { status, headers });
  };
  return { fetchImpl: fetchImpl as typeof fetch, seen };
}

const healthy: Record<string, [number, string]> = {
  '/': [200, '<h1>AgentDock</h1>'],
  '/artifacts': [200, '<h1>Artifacts</h1><ol><li>x</li></ol>'],
  '/skills': [308, ''],
  '/artifacts?type=hook': [200, 'No artifacts matched the applied filters'],
};
const fast = { attempts: 2, delayMs: 1 };

describe('smoke', () => {
  it('checks exactly the type filter’s ids', () => {
    const source = readFileSync('src/db/queries/search.ts', 'utf8');
    const block = source.match(/export const ARTIFACT_TYPE_IDS = \[([^\]]*)\]/)?.[1] ?? '';
    expect([...block.matchAll(/'(\w+)'/g)].map((m) => m[1])).toEqual(TYPES);
  });

  it('passes a healthy deployment serving the expected sha and names the empty types', async () => {
    const { fetchImpl } = site(healthy, A);
    const r = await smoke('https://example.test', A, { fetchImpl, ...fast });
    expect(r.ok).toBe(true);
    expect(r.lines).toContain('ok   identity aaaaaaa');
    expect(r.lines).toContain('note no rows of type: hook');
  });

  it('fails when the domain still serves another build', async () => {
    const { fetchImpl, seen } = site(healthy, B);
    const r = await smoke('https://example.test', A, { fetchImpl, ...fast });
    expect(r.ok).toBe(false);
    expect(r.lines[0]).toContain('production serves bbbbbbb, expected aaaaaaa');
    expect(seen.filter((s) => s === 'HEAD /')).toHaveLength(2);
  });

  it('fails on the error boundary, an empty corpus, a 5xx, or every type empty', async () => {
    const broken = site(
      {
        ...healthy,
        '/': [200, '<h1>Something went wrong</h1>'],
        '/artifacts': [200, 'No artifacts indexed yet.'],
        '/artifacts?q=mcp': [500, ''],
      },
      A,
    );
    const r = await smoke('https://example.test', undefined, {
      fetchImpl: broken.fetchImpl,
      ...fast,
    });
    expect(r.ok).toBe(false);
    const failures = r.lines.filter((l) => l.startsWith('FAIL'));
    expect(failures.map((l) => l.split(':')[0])).toEqual([
      'FAIL /',
      'FAIL /artifacts',
      'FAIL /artifacts?q=mcp',
    ]);

    const types = Object.fromEntries(
      TYPES.map((t) => [`/artifacts?type=${t}`, [200, 'No artifacts matched'] as [number, string]]),
    );
    const r2 = await smoke('https://example.test', undefined, {
      fetchImpl: site({ ...healthy, ...types }, A).fetchImpl,
      ...fast,
    });
    expect(r2.lines).toContain('FAIL every artifact type is empty');
  });

  it('reports a network failure without throwing', async () => {
    const fetchImpl = (async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    }) as unknown as typeof fetch;
    const r = await smoke('https://example.test', A, { fetchImpl, ...fast });
    expect(r.ok).toBe(false);
    expect(r.lines.some((l) => l.includes('ECONNREFUSED'))).toBe(true);
  });
});

describe('gate against a fake GitHub API', () => {
  function github(state: { ciRuns: number; tip: string; served: string | null; status?: number }) {
    const calls: string[] = [];
    const fetchImpl = (async (input: URL | string, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith('https://prod.test')) {
        return new Response(null, {
          headers: state.served ? { 'x-agentdock-commit': state.served } : {},
        });
      }
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer t0ken');
      if (state.status) return new Response('', { status: state.status });
      if (url.includes('/actions/workflows/ci.yml/runs')) {
        return Response.json({ total_count: state.ciRuns });
      }
      if (url.endsWith('/git/ref/heads/develop'))
        return Response.json({ object: { sha: state.tip } });
      return new Response('', { status: 404 });
    }) as typeof fetch;
    return { fetchImpl, calls };
  }
  const env = (out: string) => ({
    SHA: A,
    GITHUB_REPOSITORY: 'o/r',
    GITHUB_API_URL: 'https://api.test',
    GITHUB_TOKEN: 't0ken',
    PRODUCTION_URL: 'https://prod.test',
    GITHUB_OUTPUT: out,
  });

  it('asks for this sha’s successful push run on develop and writes the decision', async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'gate-')), 'out');
    const { fetchImpl, calls } = github({ ciRuns: 1, tip: A, served: B });
    expect(await gate(env(out), fetchImpl)).toBe('DEPLOY');
    expect(calls[0]).toBe(
      `https://api.test/repos/o/r/actions/workflows/ci.yml/runs?head_sha=${A}&event=push&branch=develop&status=success&per_page=1`,
    );
    expect(readFileSync(out, 'utf8')).toBe('decision=DEPLOY\n');
  });

  it('blocks without a successful CI run, and supersedes behind a newer tip', async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'gate-')), 'out');
    expect(await gate(env(out), github({ ciRuns: 0, tip: A, served: null }).fetchImpl)).toBe(
      'BLOCKED_CI',
    );
    expect(await gate(env(out), github({ ciRuns: 1, tip: B, served: null }).fetchImpl)).toBe(
      'SUPERSEDED',
    );
    expect(await gate(env(out), github({ ciRuns: 1, tip: A, served: A }).fetchImpl)).toBe(
      'ALREADY_DEPLOYED',
    );
  });

  it('fails closed on an API error and on missing inputs', async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'gate-')), 'out');
    await expect(
      gate(env(out), github({ ciRuns: 1, tip: A, served: null, status: 403 }).fetchImpl),
    ).rejects.toThrow('GitHub API 403');
    await expect(gate({ SHA: A }, fetch)).rejects.toThrow('gate needs');
  });
});
