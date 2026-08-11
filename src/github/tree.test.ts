import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchRepoTree } from './tree';

const COMMIT = 'f17010c9bb483898c1d9c9f42dde2b3a98889434';

function stubTreeResponse(json: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(json)),
  );
}

/** The real captured Trees response for one corpus — see fixtures/<slug>/tree.json. */
function corpusTreeJson(slug: string): unknown {
  return JSON.parse(readFileSync(join('fixtures', slug, 'tree.json'), 'utf8'));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchRepoTree — mode', () => {
  it('maps mode onto every entry of the real anthropics-skills tree, 26 of them 100755', async () => {
    stubTreeResponse(corpusTreeJson('anthropics-skills'));

    const tree = await fetchRepoTree('anthropics', 'skills');

    expect(tree.entries).toHaveLength(501);
    expect(tree.entries.every((e) => typeof e.mode === 'string')).toBe(true);
    expect(tree.entries.filter((e) => e.mode === '100755')).toHaveLength(26);
    expect(tree.entries.filter((e) => e.mode === '120000')).toHaveLength(0);
  });

  it('maps mode onto every entry of the real addyosmani-agent-skills tree, 1 symlink', async () => {
    stubTreeResponse(corpusTreeJson('addyosmani-agent-skills'));

    const tree = await fetchRepoTree('addyosmani', 'agent-skills');

    expect(tree.entries.filter((e) => e.mode === '100755')).toHaveLength(7);
    expect(tree.entries.filter((e) => e.mode === '120000')).toHaveLength(1);
  });

  it('yields undefined mode for an entry whose mode field is absent or non-string, and leaves every other field unchanged', async () => {
    stubTreeResponse({
      sha: COMMIT,
      truncated: false,
      tree: [
        { path: 'no-mode.txt', type: 'blob', sha: 'a'.repeat(40), size: 3 },
        { path: 'hostile-mode.txt', type: 'blob', sha: 'b'.repeat(40), size: 3, mode: 100644 },
        { path: 'real-mode.txt', type: 'blob', sha: 'c'.repeat(40), size: 3, mode: '100644' },
      ],
    });

    const tree = await fetchRepoTree('a', 'b');

    expect(tree.entries).toEqual([
      { path: 'no-mode.txt', type: 'blob', sha: 'a'.repeat(40), size: 3, mode: undefined },
      { path: 'hostile-mode.txt', type: 'blob', sha: 'b'.repeat(40), size: 3, mode: undefined },
      { path: 'real-mode.txt', type: 'blob', sha: 'c'.repeat(40), size: 3, mode: '100644' },
    ]);
  });
});
