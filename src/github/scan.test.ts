import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitHubError } from './client';
import { CAPS, fetchRepoScanInputs } from './scan';
import type { RepoTree } from './types';

const COMMIT = 'f17010c9bb483898c1d9c9f42dde2b3a98889434';

const REPO_JSON = {
  node_id: 'R_kgDONs',
  full_name: 'anthropics/skills',
  owner: { login: 'anthropics' },
  default_branch: 'main',
  description: 'skills',
  // The API returns an empty string, not null, for an unset homepage.
  homepage: '',
  license: { spdx_id: 'MIT' },
  stargazers_count: 42,
  fork: false,
  archived: false,
  topics: ['skills'],
  pushed_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-04T00:00:00Z',
};

function treeJson(paths: string[], extra: Record<string, unknown> = {}) {
  return {
    sha: COMMIT,
    truncated: false,
    tree: paths.map((path) => ({ path, type: 'blob', sha: 'a'.repeat(40), size: 10 })),
    ...extra,
  };
}

/** Every call the stub saw, so the two-call and zero-quota claims are asserted. */
let hosts: string[] = [];
let urls: string[] = [];

type Stubs = {
  repo?: () => Response;
  tree?: () => Response;
  raw?: (path: string) => Response;
};

function stubGitHub(stubs: Stubs) {
  hosts = [];
  urls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL | string) => {
      const url = new URL(String(input));
      hosts.push(url.hostname);
      urls.push(url.toString());
      if (url.hostname === 'raw.githubusercontent.com') {
        const path = url.pathname.split('/').slice(4).join('/');
        return (stubs.raw ?? (() => new Response('body')))(decodeURIComponent(path));
      }
      if (url.pathname.includes('/git/trees/')) {
        return (stubs.tree ?? (() => Response.json(treeJson([]))))();
      }
      return (stubs.repo ?? (() => Response.json(REPO_JSON)))();
    }),
  );
}

const selectSkills = (t: RepoTree) =>
  t.entries.filter((e) => e.path.endsWith('SKILL.md')).map((e) => e.path);

beforeEach(() => {
  vi.stubEnv('GITHUB_TOKEN', '');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('fetchRepoScanInputs', () => {
  it('spends exactly two API-host requests and takes every body from the raw host', async () => {
    stubGitHub({ tree: () => Response.json(treeJson(['a/SKILL.md', 'b/SKILL.md', 'README.md'])) });

    const scan = await fetchRepoScanInputs('anthropics', 'skills', selectSkills);

    expect(hosts.filter((h) => h === 'api.github.com')).toHaveLength(2);
    expect(hosts.filter((h) => h === 'raw.githubusercontent.com')).toHaveLength(2);
    expect([...scan.files.keys()]).toEqual(['a/SKILL.md', 'b/SKILL.md']);
    expect(scan.skipped).toEqual([]);
    expect(scan.artifactsTruncated).toBe(false);
    expect(scan.tree.commitSha).toBe(COMMIT);
  });

  it('normalizes an empty homepage to null and reads the push timestamp, not the update one', async () => {
    stubGitHub({});
    const { metadata } = await fetchRepoScanInputs('anthropics', 'skills', selectSkills);
    expect(metadata.homepage).toBeNull();
    expect(metadata.pushedAt?.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(metadata.licenseSpdx).toBe('MIT');
  });

  it('refuses a tree whose sha is not forty lowercase hex characters', async () => {
    stubGitHub({
      tree: () => Response.json(treeJson([], { sha: 'ABCDEF0123456789' })),
    });
    await expect(fetchRepoScanInputs('a', 'b', selectSkills)).rejects.toThrow(
      /without a usable commit SHA/,
    );
  });

  it('refuses a tree whose sha is the uppercase form of a valid length', async () => {
    stubGitHub({ tree: () => Response.json(treeJson([], { sha: COMMIT.toUpperCase() })) });
    await expect(fetchRepoScanInputs('a', 'b', selectSkills)).rejects.toThrow(GitHubError);
  });

  it('surfaces truncation as state the caller must handle', async () => {
    stubGitHub({
      tree: () => Response.json(treeJson(['a/SKILL.md'], { truncated: true })),
    });
    const scan = await fetchRepoScanInputs('a', 'b', selectSkills);
    expect(scan.tree.truncated).toBe(true);
    // The entry list is NOT presented as complete just because it is shorter.
    expect(scan.tree.entries).toHaveLength(1);
  });

  it('reads exactly the file cap and reports the remainder as skipped', async () => {
    const paths = Array.from({ length: CAPS.maxFiles + 5 }, (_, i) => `s${i}/SKILL.md`);
    stubGitHub({ tree: () => Response.json(treeJson(paths)) });

    const scan = await fetchRepoScanInputs('a', 'b', selectSkills);

    expect(scan.files.size).toBe(CAPS.maxFiles);
    expect(scan.skipped).toHaveLength(5);
    expect(scan.artifactsTruncated).toBe(true);
    expect(hosts.filter((h) => h === 'raw.githubusercontent.com')).toHaveLength(CAPS.maxFiles);
  });

  it('does not select an entry nested deeper than the depth cap', async () => {
    const deep = `${Array.from({ length: CAPS.maxDepth }, (_, i) => `d${i}`).join('/')}/SKILL.md`;
    const shallow = 'skills/x/SKILL.md';
    stubGitHub({ tree: () => Response.json(treeJson([deep, shallow])) });

    const scan = await fetchRepoScanInputs('a', 'b', selectSkills);

    expect(deep.split('/')).toHaveLength(CAPS.maxDepth + 1);
    expect([...scan.files.keys()]).toEqual([shallow]);
    expect(scan.tree.entries.map((e) => e.path)).toEqual([shallow]);
  });

  it('keeps the other files when one body fails to read', async () => {
    stubGitHub({
      tree: () => Response.json(treeJson(['good/SKILL.md', 'bad/SKILL.md'])),
      raw: (path) =>
        path.startsWith('bad/') ? new Response('nope', { status: 500 }) : new Response('body'),
    });

    const scan = await fetchRepoScanInputs('a', 'b', selectSkills);

    expect([...scan.files.keys()]).toEqual(['good/SKILL.md']);
    expect(scan.skipped).toEqual(['bad/SKILL.md']);
    expect(scan.artifactsTruncated).toBe(true);
  });

  it('pins every raw body to the commit sha', async () => {
    stubGitHub({ tree: () => Response.json(treeJson(['a/SKILL.md'])) });

    await fetchRepoScanInputs('anthropics', 'skills', selectSkills);

    expect(urls).toContain(
      `https://raw.githubusercontent.com/anthropics/skills/${COMMIT}/a/SKILL.md`,
    );
    // HEAD, not a branch name: the tree call must not wait on the metadata call.
    expect(urls).toContain(
      'https://api.github.com/repos/anthropics/skills/git/trees/HEAD?recursive=1',
    );
  });

  it.each([
    ['metadata', 'repo'],
    ['tree', 'tree'],
  ] as const)(
    'reports a 404 from the %s call as unreadable, never as non-existent',
    async (_l, which) => {
      stubGitHub({
        [which]: () => new Response('{}', { status: 404 }),
      } as Stubs);

      const error = await fetchRepoScanInputs('a', 'b', selectSkills).catch((e: GitHubError) => e);

      expect(error).toBeInstanceOf(GitHubError);
      expect((error as GitHubError).failure).toBe('unreadable');
      expect((error as GitHubError).message).toBe('AgentDock could not read a/b.');
      expect((error as GitHubError).message).not.toMatch(/not found|does not exist|no such/i);
    },
  );
});
