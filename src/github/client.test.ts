import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GitHubError,
  githubFetch,
  githubRepoFromUrl,
  MAX_REDIRECTS,
  normalizeRepo,
  rateLimitState,
  readCapped,
} from './client';

const API = 'https://api.github.com/repos/anthropics/skills';
const TOKEN_SENTINEL = 'ghp-sentinel-value-that-is-not-a-real-token';

/** A stub that fails the test if it is ever called. */
function neverCalled() {
  return vi.fn(() => {
    throw new Error('fetch was called, but the input should have been refused first');
  });
}

function res(status: number, headers: Record<string, string> = {}, body: BodyInit | null = null) {
  return new Response(body, { status, headers });
}

/** A body that streams `chunks` of `size` bytes, so the cap is met mid-stream. */
function streamOf(chunkCount: number, size: number) {
  let sent = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= chunkCount) {
        controller.close();
        return;
      }
      sent += 1;
      controller.enqueue(new Uint8Array(size).fill(97));
    },
    cancel() {
      cancelled = true;
    },
  });
  return { stream, sent: () => sent, cancelled: () => cancelled };
}

let fetchStub: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchStub = vi.fn();
  vi.stubGlobal('fetch', fetchStub);
  vi.stubEnv('GITHUB_TOKEN', '');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('normalizeRepo — the SSRF table', () => {
  // Every one of these must be refused BEFORE a socket opens. A validator that
  // rejects after the request has left has already failed.
  const REJECTED = [
    'https://github.com/anthropics/skills',
    'anthropics/skills/../../etc/passwd',
    'anthropics/skills?x=1',
    'anthropics/skills#frag',
    'anthropics/skills/tree/main',
    'http://169.254.169.254/latest/meta-data',
    'localhost:5432/x',
    'anthropics@evil.tld/skills',
    '../../anthropics/skills',
    `${'a'.repeat(500)}/b`,
    'anthropics/skills\n',
    '-leading-hyphen/skills',
    '',
    '   ',
  ];

  const ACCEPTED: [string, string, string][] = [
    ['anthropics/skills', 'anthropics', 'skills'],
    ['ANTHROPICS/Skills', 'ANTHROPICS', 'Skills'],
    ['  anthropics/skills  ', 'anthropics', 'skills'],
    ['anthropics/skills.git', 'anthropics', 'skills'],
    ['user/dot.name_x-1', 'user', 'dot.name_x-1'],
  ];

  it.each(REJECTED)('refuses %j with no socket opened', (input) => {
    const stub = neverCalled();
    vi.stubGlobal('fetch', stub);
    expect(normalizeRepo(input)).toBeNull();
    expect(stub).not.toHaveBeenCalled();
  });

  it.each(ACCEPTED)('accepts %j as %s/%s', (input, owner, repo) => {
    expect(normalizeRepo(input)).toEqual({ owner, repo });
  });

  it('refuses a bare .git repository name once the suffix is stripped', () => {
    expect(normalizeRepo('anthropics/.git')).toBeNull();
  });
});

describe('githubRepoFromUrl — the one predicate every caller shares', () => {
  // Three callers now read it: the catalog detector over a marketplace.json
  // source, the registry adapter over a server's repository.url, and the
  // curated-link extractor over a README. None of them may name a host itself,
  // so every host and route decision has to be correct here.
  const NOTHING = [
    // Site routes, not accounts. Each is a well-formed owner/repo string that
    // normalizeRepo accepts happily, so without the reserved-segment guard a
    // curated list's topic and organisation links become seeds — and then two
    // core requests each, spent learning they are 404s.
    'https://github.com/topics/claude-code',
    'https://github.com/orgs/anthropics/repositories',
    'https://github.com/sponsors/anthropics',
    'https://github.com/users/anthropics/projects',
    'https://github.com/settings/tokens',
    'https://github.com/TOPICS/claude-code',
    // Not a repository path at all.
    'https://github.com/anthropics',
    'https://github.com/',
    // Not github.com. The last two are the lookalike shapes a link list carries.
    'https://gist.github.com/anthropics/aaaa',
    'https://raw.githubusercontent.com/anthropics/skills/main/README.md',
    'https://gitlab.com/anthropics/skills',
    'https://github.com.evil.example/anthropics/skills',
    'https://github.com@evil.example/anthropics/skills',
  ];

  const REPOSITORIES: [string, string, string][] = [
    ['https://github.com/anthropics/skills', 'anthropics', 'skills'],
    ['https://github.com/anthropics/skills.git', 'anthropics', 'skills'],
    ['https://github.com/anthropics/skills/blob/main/README.md', 'anthropics', 'skills'],
    ['https://github.com/anthropics/skills?tab=readme#install', 'anthropics', 'skills'],
    // "new" is reserved as an owner; as a repository name it is ordinary.
    ['https://github.com/anthropics/new', 'anthropics', 'new'],
    // Plain HTTP is deliberately still a repository here. This function returns
    // a NAME, not a fetch target: the owner/repo it yields is fetched over https
    // by githubFetch, which refuses any other scheme. Rejecting the scheme here
    // would drop real repositories linked over http in older READMEs and buy
    // nothing. src/corpus/links.ts narrows to https at extraction instead, where
    // an http token in an untrusted document is worth not even parsing.
    ['http://github.com/anthropics/skills', 'anthropics', 'skills'],
  ];

  it.each(NOTHING)('yields nothing for %j', (url) => {
    expect(githubRepoFromUrl(new URL(url))).toBeNull();
  });

  it.each(REPOSITORIES)('reads %j as %s/%s', (url, owner, repo) => {
    expect(githubRepoFromUrl(new URL(url))).toEqual({ owner, repo });
  });
});

describe('githubFetch — the redirect matrix', () => {
  it('refuses a location off the allowlist', async () => {
    fetchStub.mockResolvedValueOnce(res(301, { location: 'https://evil.tld/x' }));
    await expect(githubFetch(API)).rejects.toThrow(/Refusing to contact evil\.tld/);
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it('refuses a scheme downgrade even on an allowed host', async () => {
    fetchStub.mockResolvedValueOnce(res(301, { location: 'http://api.github.com/repos/a/b' }));
    await expect(githubFetch(API)).rejects.toThrow(/non-HTTPS/);
  });

  it('refuses a lookalike host suffix', async () => {
    fetchStub.mockResolvedValueOnce(res(301, { location: 'https://api.github.com.evil.tld/x' }));
    await expect(githubFetch(API)).rejects.toThrow(/api\.github\.com\.evil\.tld/);
  });

  it('follows the same-host rename hop', async () => {
    fetchStub
      .mockResolvedValueOnce(res(301, { location: 'https://api.github.com/repositories/123' }))
      .mockResolvedValueOnce(res(200, {}, '{"ok":true}'));

    const { response } = await githubFetch(API);
    expect(response.status).toBe(200);
    expect(fetchStub).toHaveBeenCalledTimes(2);
    expect(String(fetchStub.mock.calls[1][0])).toBe('https://api.github.com/repositories/123');
  });

  it('refuses the third consecutive hop', async () => {
    const hop = res(302, { location: 'https://api.github.com/repositories/123' });
    fetchStub.mockImplementation(async () => hop.clone());
    await expect(githubFetch(API)).rejects.toThrow(/redirected too many times/);
    expect(fetchStub).toHaveBeenCalledTimes(MAX_REDIRECTS + 1);
  });

  it('refuses a redirect that carries no location', async () => {
    fetchStub.mockResolvedValueOnce(res(302));
    await expect(githubFetch(API)).rejects.toThrow(/without a location/);
  });

  it('refuses a non-allowlisted URL before the first call', async () => {
    const stub = neverCalled();
    vi.stubGlobal('fetch', stub);
    await expect(githubFetch('https://evil.tld/x')).rejects.toThrow(GitHubError);
    expect(stub).not.toHaveBeenCalled();
  });

  it('replaces a transport failure with a message carrying nothing from the cause', async () => {
    vi.stubEnv('GITHUB_TOKEN', TOKEN_SENTINEL);
    fetchStub.mockRejectedValueOnce(new Error(`connect failed with ${TOKEN_SENTINEL}`));

    let message = '';
    try {
      await githubFetch(API);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe('AgentDock could not reach GitHub.');
    expect(message).not.toContain(TOKEN_SENTINEL);
  });
});

describe('githubFetch — the token', () => {
  it('sends no authorization header when the environment has no token', async () => {
    fetchStub.mockResolvedValueOnce(res(200, {}, '{}'));
    await githubFetch(API);
    const init = fetchStub.mock.calls[0][1] as RequestInit;
    expect((init.headers as Headers).has('authorization')).toBe(false);
    expect((init.headers as Headers).get('user-agent')).toBe('agentdock');
  });

  it('sends the token when one exists', async () => {
    vi.stubEnv('GITHUB_TOKEN', ` ${TOKEN_SENTINEL} `);
    fetchStub.mockResolvedValueOnce(res(200, {}, '{}'));
    await githubFetch(API);
    const init = fetchStub.mock.calls[0][1] as RequestInit;
    expect((init.headers as Headers).get('authorization')).toBe(`Bearer ${TOKEN_SENTINEL}`);
  });

  it('never puts the token into a rate-limit error', async () => {
    vi.stubEnv('GITHUB_TOKEN', TOKEN_SENTINEL);
    fetchStub.mockResolvedValueOnce(
      res(403, { 'x-ratelimit-limit': '60', 'x-ratelimit-remaining': '0' }),
    );
    await expect(githubFetch(API)).rejects.toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining(TOKEN_SENTINEL),
      }),
    );
  });
});

describe('githubFetch — rate limiting is read from headers', () => {
  it('classifies a 403 with zero remaining as exhaustion', async () => {
    fetchStub.mockResolvedValueOnce(
      res(403, {
        'x-ratelimit-limit': '60',
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': '1786351066',
      }),
    );
    const error = await githubFetch(API).catch((e: GitHubError) => e);
    expect(error).toBeInstanceOf(GitHubError);
    expect((error as GitHubError).failure).toBe('rate_limited');
    expect((error as GitHubError).rateLimit).toEqual({
      limit: 60,
      remaining: 0,
      reset: 1786351066,
    });
  });

  it('classifies a 429 carrying retry-after as exhaustion', async () => {
    fetchStub.mockResolvedValueOnce(res(429, { 'retry-after': '60' }));
    const error = await githubFetch(API).catch((e: GitHubError) => e);
    expect((error as GitHubError).failure).toBe('rate_limited');
  });

  it('does NOT classify a 403 with quota remaining as exhaustion', async () => {
    fetchStub.mockResolvedValueOnce(
      res(403, { 'x-ratelimit-limit': '60', 'x-ratelimit-remaining': '42' }),
    );
    const { response } = await githubFetch(API);
    expect(response.status).toBe(403);
  });

  it('records the most recent rate-limit state for the interface to surface', async () => {
    fetchStub.mockResolvedValueOnce(
      res(200, {
        'x-ratelimit-limit': '60',
        'x-ratelimit-remaining': '37',
        'x-ratelimit-reset': '1786351066',
      }),
    );
    await githubFetch(API);
    expect(rateLimitState()).toEqual({ limit: 60, remaining: 37, reset: 1786351066 });
  });
});

describe('readCapped', () => {
  it('returns a body under the cap', async () => {
    expect(await readCapped(res(200, {}, 'hello'), 1024)).toBe('hello');
  });

  it('aborts an oversize body mid-stream and cancels rather than draining', async () => {
    const source = streamOf(1000, 1024);
    const response = new Response(source.stream);

    await expect(readCapped(response, 4096)).rejects.toThrow(/exceeds the 4096-byte cap/);
    // Five 1 KB chunks is the first read past a 4 KB cap. Anything near 1000
    // would mean the stream was drained instead of cut.
    expect(source.sent()).toBeLessThan(10);
    expect(source.cancelled()).toBe(true);
  });

  it('ignores a lying Content-Length and counts what arrives', async () => {
    const source = streamOf(1000, 1024);
    const response = new Response(source.stream, { headers: { 'content-length': '1' } });
    await expect(readCapped(response, 2048)).rejects.toThrow(GitHubError);
  });
});
