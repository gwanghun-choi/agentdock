import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileInventory, isBundledScript, SCRIPT_EXTENSIONS } from './files';
import { ANALYZE_CAPS } from './types';

const skill = (sourcePath: string) => ({ type: 'skill', sourcePath });

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
    const inv = fileInventory(tree, skill('skills/a/SKILL.md'));
    expect(inv.map((f) => f.path)).toEqual(['skills/a/SKILL.md', 'skills/a/scripts/run.py']);
  });

  it('renders one row, not an empty state, for a manifest that holds nothing else', () => {
    const tree = [{ path: 'skills/solo/SKILL.md', type: 'blob', sha: '1', mode: '100644' }];
    const inv = fileInventory(tree, skill('skills/solo/SKILL.md'));
    expect(inv).toHaveLength(1);
    expect(inv[0].path).toBe('skills/solo/SKILL.md');
  });

  it('excludes trees, only blobs count', () => {
    const tree = [
      { path: 'skills/a/SKILL.md', type: 'blob', sha: '1', mode: '100644' },
      { path: 'skills/a/scripts', type: 'tree', sha: '2' },
    ];
    expect(fileInventory(tree, skill('skills/a/SKILL.md')).map((f) => f.path)).toEqual([
      'skills/a/SKILL.md',
    ]);
  });

  it('marks 100755 executable and 120000 a symlink, never both', () => {
    const tree = [
      { path: 'skills/a/SKILL.md', type: 'blob', sha: '1', mode: '100644' },
      { path: 'skills/a/scripts/run.sh', type: 'blob', sha: '2', mode: '100755' },
      { path: 'skills/a/link', type: 'blob', sha: '3', mode: '120000' },
    ];
    const inv = fileInventory(tree, skill('skills/a/SKILL.md'));
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
    const inv = fileInventory(tree, skill('skills/a/SKILL.md'));
    expect(inv).toHaveLength(ANALYZE_CAPS.maxInventoryEntries);
  });

  it('never reads content — TreeEntry carries no body field for it to read', () => {
    const tree = [{ path: 'skills/a/SKILL.md', type: 'blob', sha: '1', mode: '100644' }];
    const inv = fileInventory(tree, skill('skills/a/SKILL.md'));
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
        const inv = fileInventory(tree, skill(manifest.path));
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
    const inv = fileInventory(tree, skill('skills/docx/SKILL.md'));
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
        symlinksInAnyInventory += fileInventory(tree, skill(manifest.path)).filter(
          (f) => f.kind === 'symlink',
        ).length;
      }
    }
    expect(symlinksInAnyInventory).toBe(0);
  });
});

describe('fileInventory — what each artifact type owns', () => {
  const blob = (path: string) => ({ path, type: 'blob', sha: path, mode: '100644' });
  const paths = (inv: { path: string }[]) => inv.map((f) => f.path);
  // One plugin with every component type inside it, a sibling plugin, and a
  // top-level skill — the shape of anthropics-claude-code's plugins/ tree.
  const tree = [
    blob('README.md'),
    blob('plugins/a/.claude-plugin/plugin.json'),
    blob('plugins/a/.mcp.json'),
    blob('plugins/a/README.md'),
    blob('plugins/a/commands/one.md'),
    blob('plugins/a/commands/two.md'),
    blob('plugins/a/hooks/hooks.json'),
    blob('plugins/a/hooks/guard.py'),
    blob('plugins/a/skills/s/SKILL.md'),
    blob('plugins/b/.claude-plugin/plugin.json'),
    blob('plugins/b/scripts/run.sh'),
    blob('.claude/settings.json'),
    blob('.claude/commands/deploy.md'),
    blob('.claude/hooks/check.sh'),
  ];

  it('a declared plugin owns its root, not only .claude-plugin/', () => {
    const inv = fileInventory(tree, {
      type: 'plugin',
      sourcePath: 'plugins/a/.claude-plugin/plugin.json',
      containerRoot: 'plugins/a',
    });
    expect(paths(inv)).toEqual(tree.map((e) => e.path).filter((p) => p.startsWith('plugins/a/')));
  });

  it('a shape-only plugin owns the directory it was recognised by', () => {
    const inv = fileInventory(tree, {
      type: 'plugin',
      sourcePath: 'plugins/b',
      containerRoot: 'plugins/b',
    });
    expect(paths(inv)).toEqual([
      'plugins/b/.claude-plugin/plugin.json',
      'plugins/b/scripts/run.sh',
    ]);
  });

  it('a plugin at the repository root owns the whole tree', () => {
    const inv = fileInventory(tree, {
      type: 'plugin',
      sourcePath: '.claude-plugin/plugin.json',
      containerRoot: '',
    });
    expect(inv).toHaveLength(tree.length);
  });

  it('a command is its own file, never its sibling commands', () => {
    expect(
      paths(fileInventory(tree, { type: 'command', sourcePath: 'plugins/a/commands/one.md' })),
    ).toEqual(['plugins/a/commands/one.md']);
  });

  it('a project hook is .claude/settings.json alone, not the rest of .claude/', () => {
    expect(
      paths(fileInventory(tree, { type: 'hook', sourcePath: '.claude/settings.json' })),
    ).toEqual(['.claude/settings.json']);
  });

  it('a plugin hook file does not take the scripts beside it as its own', () => {
    expect(
      paths(fileInventory(tree, { type: 'hook', sourcePath: 'plugins/a/hooks/hooks.json' })),
    ).toEqual(['plugins/a/hooks/hooks.json']);
  });

  it("an .mcp.json at a plugin root is one file, not the plugin's listing", () => {
    expect(
      paths(fileInventory(tree, { type: 'mcp_server', sourcePath: 'plugins/a/.mcp.json' })),
    ).toEqual(['plugins/a/.mcp.json']);
  });

  it('a skill inside a plugin still owns its own directory and nothing above it', () => {
    expect(paths(fileInventory(tree, skill('plugins/a/skills/s/SKILL.md')))).toEqual([
      'plugins/a/skills/s/SKILL.md',
    ]);
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
