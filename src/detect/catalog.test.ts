import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { catalog } from './catalog';
import { JSON_CAPS } from './json';
import type { Candidate, TreeEntry } from './types';

const ROOT = 'fixtures';

/** Loads a frozen corpus's tree only — catalog.parse() is tested with inline
 * strings (Idiom B), since none of the four corpora captured a marketplace.json
 * body (scripts/capture-fixtures.mjs is hard-coded to SKILL.md). */
function corpusTree(slug: string): TreeEntry[] {
  const dir = join(ROOT, slug);
  const tree = JSON.parse(readFileSync(join(dir, 'tree.json'), 'utf8'));
  return tree.tree;
}

function adversarial(name: string): string {
  return readFileSync(join(ROOT, 'adversarial', name), 'utf8');
}

/** Parses a hand-written fixture at a chosen source path. */
async function parseAt(sourcePath: string, source: string) {
  const candidate: Candidate = { type: 'catalog', sourcePath, needs: [sourcePath] };
  return catalog.parse(candidate, async () => source);
}

describe('catalog.match — path only, measured counts', () => {
  const CORPORA = [
    'anthropics-skills',
    'addyosmani-agent-skills',
    'baoyu-skills',
    'wshobson-agents',
  ];

  it.each(CORPORA)('finds exactly one marketplace.json in %s', (slug) => {
    const entries = corpusTree(slug);
    const candidates = catalog.match(entries);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].type).toBe('catalog');
    expect(candidates[0].needs).toEqual([candidates[0].sourcePath]);
  });

  it('covers the root file and a nested marketplace directory', () => {
    const tree: TreeEntry[] = [
      { path: '.claude-plugin/marketplace.json', type: 'blob', sha: 'a' },
      { path: 'vendor/some-marketplace/.claude-plugin/marketplace.json', type: 'blob', sha: 'b' },
    ];
    expect(catalog.match(tree).map((c) => c.sourcePath)).toEqual(tree.map((e) => e.path));
  });

  it('matches nothing whose filename merely contains marketplace.json', () => {
    const tree: TreeEntry[] = [
      { path: 'marketplace.json', type: 'blob', sha: 'a' },
      { path: '.claude-plugin/marketplace.json.bak', type: 'blob', sha: 'b' },
      { path: 'x/my-marketplace.json', type: 'blob', sha: 'c' },
      // A directory named marketplace.json is not a manifest.
      { path: '.claude-plugin/marketplace.json', type: 'tree', sha: 'd' },
    ];
    expect(catalog.match(tree)).toEqual([]);
  });

  it('costs zero file reads on a repository with no catalog', () => {
    const tree: TreeEntry[] = [{ path: 'README.md', type: 'blob', sha: 'a' }];
    expect(catalog.match(tree).flatMap((c) => c.needs)).toEqual([]);
  });
});

describe('catalog.parse — the six source shapes', () => {
  const SIX_SHAPES = JSON.stringify({
    name: 'six-shapes',
    owner: { name: 'Test' },
    plugins: [
      { name: 'relative-one', source: './plugins/relative-one', description: 'inside this repo' },
      { name: 'github-one', source: { source: 'github', repo: 'Some-Owner/Some-Repo' } },
      {
        name: 'url-one',
        source: { source: 'url', url: 'https://github.com/other-owner/url-repo' },
      },
      {
        name: 'subdir-one',
        source: {
          source: 'git-subdir',
          url: 'https://github.com/subdir-owner/subdir-repo',
          path: 'packages/plugin-a',
        },
      },
      { name: 'npm-one', source: { source: 'npm', package: '@scope/npm-one' } },
      {
        name: 'archive-one',
        source: { source: 'archive', url: 'https://example.com/archive-one.tar.gz' },
      },
      // A non-github url source: has no owner/repo to normalize either.
      {
        name: 'non-github-url',
        source: { source: 'url', url: 'https://gitlab.com/some-owner/some-repo' },
      },
    ],
  });

  it('yields seeds only for github, github-hosted url, and github-hosted git-subdir', async () => {
    const result = await parseAt('.claude-plugin/marketplace.json', SIX_SHAPES);

    expect(result.ok).toBe(true);
    expect(result.ok && result.status).toBe('seeds');
    if (!result.ok || result.status !== 'seeds') return;

    expect(result.seeds.map((s) => s.fullName).sort()).toEqual(
      ['other-owner/url-repo', 'some-owner/some-repo', 'subdir-owner/subdir-repo'].sort(),
    );
    expect(new Set(result.seeds.map((s) => s.sourceKind))).toEqual(
      new Set(['github', 'url', 'git-subdir']),
    );
  });

  it('produces no package row for a well-formed marketplace, and no seed for the four non-repository shapes', async () => {
    const result = await parseAt('.claude-plugin/marketplace.json', SIX_SHAPES);
    expect(result.ok).toBe(true);
    if (!result.ok || result.status !== 'seeds') return;
    // relative, npm, archive, and the non-github url — four of the seven
    // entries produce no seed.
    expect(result.seeds).toHaveLength(3);
    expect(result.warnings.join(' ')).toContain('4 of 7 entries');
  });

  it('carries the git-subdir path in hint, never a fetchable URL the pipeline would follow', async () => {
    const result = await parseAt('.claude-plugin/marketplace.json', SIX_SHAPES);
    if (!result.ok || result.status !== 'seeds') throw new Error('expected seeds');

    const subdirSeed = result.seeds.find((s) => s.sourceKind === 'git-subdir');
    expect(subdirSeed?.hint).toMatchObject({
      source: { path: 'packages/plugin-a' },
    });
    // The hint carries the URL as data. Nothing in this detector or the pipeline
    // ever calls fetch/URL construction on it after this point — proven at the
    // pipeline level in pipeline.test.ts, where the run's contacted hosts are
    // asserted directly.
  });

  it('lowercases seed full_names, so the same repository named two ways is one row', async () => {
    const result = await parseAt('.claude-plugin/marketplace.json', SIX_SHAPES);
    if (!result.ok || result.status !== 'seeds') throw new Error('expected seeds');

    const githubSeed = result.seeds.find((s) => s.sourceKind === 'github');
    expect(githubSeed?.fullName).toBe('some-owner/some-repo');
  });
});

describe('catalog.parse — malformed manifests', () => {
  it('fails with a readable error when plugins is missing', async () => {
    const result = await parseAt(
      '.claude-plugin/marketplace.json',
      JSON.stringify({ name: 'x', owner: { name: 'y' } }),
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors.join(' ')).toMatch(/no plugins array/);
  });

  it('fails with a readable error when plugins is not an array', async () => {
    const result = await parseAt(
      '.claude-plugin/marketplace.json',
      JSON.stringify({ name: 'x', owner: { name: 'y' }, plugins: 'not-an-array' }),
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors.join(' ')).toMatch(/no plugins array/);
  });

  it('fails on invalid JSON rather than throwing', async () => {
    const result = await parseAt('.claude-plugin/marketplace.json', '{not valid json');
    expect(result.ok).toBe(false);
  });

  it('rejects a manifest over the JSON array-length cap, generated rather than committed to disk', async () => {
    const oversized = JSON.stringify({
      name: 'x',
      owner: { name: 'y' },
      plugins: Array(JSON_CAPS.maxArrayLength + 1).fill({
        name: 'p',
        source: './plugins/p',
      }),
    });
    const result = await parseAt('.claude-plugin/marketplace.json', oversized);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors.join(' ')).toMatch(/array-length cap/);
  });

  it('reports an unreadable file without throwing', async () => {
    const candidate: Candidate = {
      type: 'catalog',
      sourcePath: '.claude-plugin/marketplace.json',
      needs: ['.claude-plugin/marketplace.json'],
    };
    const result = await catalog.parse(candidate, async () => {
      throw new Error('raw 500');
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors[0]).toContain('could not read: raw 500');
  });

  it('the permanent adversarial fixture: a marketplace with a non-array plugins field fails cleanly', async () => {
    const result = await parseAt(
      '.claude-plugin/marketplace.json',
      adversarial('marketplace-malformed.json'),
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors.length).toBeGreaterThan(0);
  });
});
