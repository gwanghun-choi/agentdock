import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileInventory, isBundledScript, SCRIPT_EXTENSIONS } from './files';
import { ANALYZE_CAPS } from './types';

const CORPORA = ['addyosmani-agent-skills', 'anthropics-skills', 'baoyu-skills', 'wshobson-agents'];

function corpusTree(slug: string) {
  const raw = JSON.parse(readFileSync(join('fixtures', slug, 'tree.json'), 'utf8'));
  return raw.tree as { path: string; type: string; sha: string; size?: number; mode?: string }[];
}

describe('fileInventory — scoped to one artifact', () => {
  it('is everything under the prefix, and nothing outside it', () => {
    const tree = [
      { path: 'skills/a/SKILL.md', type: 'blob', sha: '1', mode: '100644' },
      { path: 'skills/a/scripts/run.py', type: 'blob', sha: '2', mode: '100644' },
      { path: 'skills/a-other/README.md', type: 'blob', sha: '3', mode: '100644' },
      { path: 'skills/b/SKILL.md', type: 'blob', sha: '4', mode: '100644' },
    ];
    const inv = fileInventory(tree, 'skills/a/SKILL.md');
    expect(inv.map((f) => f.path)).toEqual(['skills/a/SKILL.md', 'skills/a/scripts/run.py']);
  });

  it('renders one row, not an empty state, for a manifest that holds nothing else', () => {
    const tree = [{ path: 'skills/solo/SKILL.md', type: 'blob', sha: '1', mode: '100644' }];
    const inv = fileInventory(tree, 'skills/solo/SKILL.md');
    expect(inv).toHaveLength(1);
    expect(inv[0].path).toBe('skills/solo/SKILL.md');
  });

  it('excludes trees, only blobs count', () => {
    const tree = [
      { path: 'skills/a/SKILL.md', type: 'blob', sha: '1', mode: '100644' },
      { path: 'skills/a/scripts', type: 'tree', sha: '2' },
    ];
    expect(fileInventory(tree, 'skills/a/SKILL.md').map((f) => f.path)).toEqual([
      'skills/a/SKILL.md',
    ]);
  });

  it('marks 100755 executable and 120000 a symlink, never both', () => {
    const tree = [
      { path: 'skills/a/SKILL.md', type: 'blob', sha: '1', mode: '100644' },
      { path: 'skills/a/scripts/run.sh', type: 'blob', sha: '2', mode: '100755' },
      { path: 'skills/a/link', type: 'blob', sha: '3', mode: '120000' },
    ];
    const inv = fileInventory(tree, 'skills/a/SKILL.md');
    const script = inv.find((f) => f.path === 'skills/a/scripts/run.sh');
    const link = inv.find((f) => f.path === 'skills/a/link');
    expect(script).toMatchObject({ executable: true, kind: 'file' });
    expect(link).toMatchObject({ executable: false, kind: 'symlink' });
  });

  it('truncates to maxInventoryEntries and does so silently only in the sense that the caller must check length', () => {
    const tree = [
      { path: 'skills/a/SKILL.md', type: 'blob', sha: '0', mode: '100644' },
      ...Array.from({ length: ANALYZE_CAPS.maxInventoryEntries + 10 }, (_, i) => ({
        path: `skills/a/f${i}.txt`,
        type: 'blob',
        sha: String(i),
        mode: '100644',
      })),
    ];
    const inv = fileInventory(tree, 'skills/a/SKILL.md');
    expect(inv).toHaveLength(ANALYZE_CAPS.maxInventoryEntries);
  });

  it('never reads content — TreeEntry carries no body field for it to read', () => {
    const tree = [{ path: 'skills/a/SKILL.md', type: 'blob', sha: '1', mode: '100644' }];
    const inv = fileInventory(tree, 'skills/a/SKILL.md');
    expect(Object.keys(inv[0])).toEqual(['path', 'size', 'kind', 'executable']);
  });
});

describe('fileInventory — measured against the four frozen corpora', () => {
  function directoryOf(sourcePath: string): string {
    const idx = sourcePath.lastIndexOf('/');
    return idx === -1 ? '' : sourcePath.slice(0, idx);
  }

  it('reproduces the measured 244 artifacts, median 2, p90 9, max 83 at anthropics-skills canvas-design', () => {
    const sizes: number[] = [];
    let maxEntry: { slug: string; path: string; size: number } | null = null;

    for (const slug of CORPORA) {
      const tree = corpusTree(slug);
      const manifests = tree.filter(
        (e) => e.type === 'blob' && (e.path === 'SKILL.md' || e.path.endsWith('/SKILL.md')),
      );
      for (const manifest of manifests) {
        const inv = fileInventory(tree, manifest.path);
        sizes.push(inv.length);
        if (!maxEntry || inv.length > maxEntry.size) {
          maxEntry = { slug, path: manifest.path, size: inv.length };
        }
      }
    }
    sizes.sort((a, b) => a - b);

    expect(sizes).toHaveLength(244);
    expect(sizes[Math.floor(sizes.length / 2)]).toBe(2);
    expect(sizes[Math.floor(sizes.length * 0.9)]).toBe(9);
    expect(maxEntry).toMatchObject({
      slug: 'anthropics-skills',
      path: 'skills/canvas-design/SKILL.md',
      size: 83,
    });
    // directoryOf is exercised here only to keep this test's own prefix
    // derivation identical to the module's, in case that ever diverges.
    expect(directoryOf('skills/canvas-design/SKILL.md')).toBe('skills/canvas-design');
  });

  it('marks a real 100755 entry executable inside a real inventory', () => {
    // anthropics-skills/skills/docx bundles several of the corpus's 26
    // executable entries (Measurement 1), e.g. scripts/accept_changes.py.
    const tree = corpusTree('anthropics-skills');
    const inv = fileInventory(tree, 'skills/docx/SKILL.md');
    expect(inv.some((f) => f.executable)).toBe(true);
  });

  it("the corpus's two real symlinks sit outside every skill's own directory", () => {
    // Task 1 locks these two entries (mode 120000) at the tree level. Neither
    // happens to fall under a skill's directory prefix in this corpus — one is
    // addyosmani-agent-skills' .opencode/skills, the other is
    // wshobson-agents' root CLAUDE.md — so a hand-built fixture
    // (fileInventory — scoped to one artifact, above) is what proves the
    // symlink-not-executable rule; this just states why no real inventory
    // shows it.
    let symlinksInAnyInventory = 0;
    for (const slug of CORPORA) {
      const tree = corpusTree(slug);
      const manifests = tree.filter(
        (e) => e.type === 'blob' && (e.path === 'SKILL.md' || e.path.endsWith('/SKILL.md')),
      );
      for (const manifest of manifests) {
        symlinksInAnyInventory += fileInventory(tree, manifest.path).filter(
          (f) => f.kind === 'symlink',
        ).length;
      }
    }
    expect(symlinksInAnyInventory).toBe(0);
  });
});

describe('isBundledScript', () => {
  it.each(SCRIPT_EXTENSIONS)('recognises a %s file', (ext) => {
    expect(isBundledScript(`skills/a/scripts/run${ext}`)).toBe(true);
  });

  it('does not recognise a .md or .json entry', () => {
    expect(isBundledScript('skills/a/README.md')).toBe(false);
    expect(isBundledScript('skills/a/config.json')).toBe(false);
  });
});
