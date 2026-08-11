import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { componentIndex, MIN_SHAPE_COMPONENTS, plugin } from './plugin';
import type { Candidate, ParseResult, TreeEntry } from './types';

const ROOT = 'fixtures';

/**
 * plugin.parse() only ever returns the artifact-bearing arms of the widened
 * ParseResult ('ok'/'partial') — it never routes a candidate to the seeds or
 * none channels. Narrows the type for the assertions below, mirroring
 * skill.test.ts's isArtifact.
 */
function isArtifact(
  result: ParseResult,
): result is Extract<ParseResult, { status: 'ok' | 'partial' }> {
  return result.ok && (result.status === 'ok' || result.status === 'partial');
}

function corpusTree(slug: string): TreeEntry[] {
  const dir = join(ROOT, slug);
  const tree = JSON.parse(readFileSync(join(dir, 'tree.json'), 'utf8'));
  return tree.tree;
}

function adversarial(name: string): string {
  return readFileSync(join(ROOT, 'adversarial', name), 'utf8');
}

const MANIFEST_SUFFIX = '/.claude-plugin/plugin.json';

/** Parses a hand-written manifest fixture at a chosen source path. */
async function parseManifestAt(sourcePath: string, source: string) {
  const root =
    sourcePath === '.claude-plugin/plugin.json' ? '' : sourcePath.slice(0, -MANIFEST_SUFFIX.length);
  const candidate: Candidate = {
    type: 'plugin',
    sourcePath,
    needs: [sourcePath],
    containerRoot: root,
  };
  return plugin.parse(candidate, async () => source);
}

const CORPORA = ['addyosmani-agent-skills', 'anthropics-skills', 'baoyu-skills', 'wshobson-agents'];

describe('componentIndex — the assertion the table in Reference A makes', () => {
  it('matches the measured shape of every frozen corpus', () => {
    const measured: Record<string, { ge2: number; eq1: number }> = {
      // Repo root (4 components: agents, commands, hooks, skills) plus three
      // dot-directories with exactly one each (.claude, .gemini, .github).
      // .opencode/skills is a symlink (git mode 120000) stored as a blob, not
      // a directory of skill files, so it is correctly not a component.
      'addyosmani-agent-skills': { ge2: 1, eq1: 3 },
      // Root (skills) and skills/skill-creator (agents): one component each.
      'anthropics-skills': { ge2: 0, eq1: 2 },
      // Every root in it has exactly one component.
      'baoyu-skills': { ge2: 0, eq1: 7 },
      // 70 of the 91 plugins/* roots carry >= 2 components; 21 carry exactly
      // one, plus .github/workflows — 22 total roots at exactly one component.
      'wshobson-agents': { ge2: 70, eq1: 22 },
    };

    for (const slug of CORPORA) {
      const idx = componentIndex(corpusTree(slug));
      const sizes = [...idx.values()].map((s) => s.size);
      expect({
        ge2: sizes.filter((n) => n >= MIN_SHAPE_COMPONENTS).length,
        eq1: sizes.filter((n) => n === 1).length,
      }).toEqual(measured[slug]);
    }
  });

  it('finds the source-directory false positive in baoyu-skills, unresolved by path alone', () => {
    const idx = componentIndex(corpusTree('baoyu-skills'));
    expect(idx.get('packages/baoyu-fetch/src')).toEqual(new Set(['commands']));
  });

  it('groups a hooks/hooks.json file under the component name "hooks", not the filename', () => {
    const tree: TreeEntry[] = [
      { path: 'plugins/x/agents/a.md', type: 'blob', sha: 'a' },
      { path: 'plugins/x/hooks/hooks.json', type: 'blob', sha: 'b' },
    ];
    expect(componentIndex(tree).get('plugins/x')).toEqual(new Set(['agents', 'hooks']));
  });
});

describe('plugin.match — the manifest path, measured counts', () => {
  const COUNTS: [string, number][] = [
    ['wshobson-agents', 91],
    ['addyosmani-agent-skills', 1],
    ['anthropics-skills', 0],
    ['baoyu-skills', 0],
  ];

  it.each(COUNTS)('finds %i declared manifests in %s', (slug, expected) => {
    const entries = corpusTree(slug);
    const declared = plugin.match(entries).filter((c) => c.needs.length > 0);
    expect(declared).toHaveLength(expected);
    expect(declared.every((c) => c.type === 'plugin')).toBe(true);
    expect(declared.every((c) => c.needs.length === 1)).toBe(true);
  });

  it('anthropics-skills yields zero plugin candidates at all, declared or shape-only', () => {
    expect(plugin.match(corpusTree('anthropics-skills'))).toEqual([]);
  });

  it('baoyu-skills yields zero plugin candidates at all, including the source-directory near-miss', () => {
    expect(plugin.match(corpusTree('baoyu-skills'))).toEqual([]);
  });

  it('no corpus produces a shape-only candidate at a dot directory or the repository root', () => {
    for (const slug of CORPORA) {
      const shapeOnly = plugin.match(corpusTree(slug)).filter((c) => c.needs.length === 0);
      for (const c of shapeOnly) {
        expect(c.sourcePath).not.toBe('');
        expect(c.sourcePath.split('/').some((seg) => seg.startsWith('.'))).toBe(false);
      }
    }
  });

  it('does not shape-only-candidate a wshobson-agents plugins/* root that already has a manifest', () => {
    // All 91 plugins/* roots have a manifest; none of the 70 with >= 2
    // components should ALSO surface as a shape-only candidate.
    const shapeOnly = plugin
      .match(corpusTree('wshobson-agents'))
      .filter((c) => c.needs.length === 0);
    expect(shapeOnly).toEqual([]);
  });

  it('a synthetic manifest-less root with two component shapes yields one shape-only candidate', () => {
    const tree: TreeEntry[] = [
      { path: 'plugins/x/skills/a/SKILL.md', type: 'blob', sha: 'a' },
      { path: 'plugins/x/agents/b.md', type: 'blob', sha: 'b' },
    ];
    const candidates = plugin.match(tree);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      type: 'plugin',
      sourcePath: 'plugins/x',
      needs: [],
      containerRoot: 'plugins/x',
    });
  });

  it('the same tree with only one component shape yields nothing', () => {
    const tree: TreeEntry[] = [{ path: 'plugins/x/skills/a/SKILL.md', type: 'blob', sha: 'a' }];
    expect(plugin.match(tree)).toEqual([]);
  });

  it('two manifest-less plugins in one repository yield two candidates with distinct source paths', () => {
    const tree: TreeEntry[] = [
      { path: 'plugins/x/skills/a/SKILL.md', type: 'blob', sha: 'a' },
      { path: 'plugins/x/agents/b.md', type: 'blob', sha: 'b' },
      { path: 'plugins/y/commands/c.md', type: 'blob', sha: 'c' },
      { path: 'plugins/y/agents/d.md', type: 'blob', sha: 'd' },
    ];
    const candidates = plugin.match(tree).filter((c) => c.needs.length === 0);
    expect(candidates.map((c) => c.sourcePath).sort()).toEqual(['plugins/x', 'plugins/y']);
  });

  it('a synthetic dot-prefixed root with two component shapes still yields nothing', () => {
    const tree: TreeEntry[] = [
      { path: '.github/commands/a.md', type: 'blob', sha: 'a' },
      { path: '.github/agents/b.md', type: 'blob', sha: 'b' },
    ];
    expect(plugin.match(tree)).toEqual([]);
  });

  it('a manifest overrides both exclusions: a dot directory and the repository root', () => {
    const tree: TreeEntry[] = [
      { path: '.claude-plugin/plugin.json', type: 'blob', sha: 'a' },
      { path: '.claude/.claude-plugin/plugin.json', type: 'blob', sha: 'b' },
    ];
    const candidates = plugin.match(tree);
    expect(candidates.map((c) => c.sourcePath).sort()).toEqual([
      '.claude-plugin/plugin.json',
      '.claude/.claude-plugin/plugin.json',
    ]);
    expect(candidates.map((c) => c.containerRoot).sort()).toEqual(['', '.claude']);
  });

  it('costs zero file reads for a repository with no plugin evidence at all', () => {
    const tree: TreeEntry[] = [{ path: 'README.md', type: 'blob', sha: 'a' }];
    expect(plugin.match(tree).flatMap((c) => c.needs)).toEqual([]);
  });
});

describe('plugin.parse — shape-only', () => {
  it('parses to status partial with meta.detectionConfidence shape-only and a warning naming the components', async () => {
    const tree: TreeEntry[] = [
      { path: 'plugins/x/skills/a/SKILL.md', type: 'blob', sha: 'a' },
      { path: 'plugins/x/agents/b.md', type: 'blob', sha: 'b' },
    ];
    const [candidate] = plugin.match(tree);
    const result = await plugin.parse(candidate, async () => {
      throw new Error('unreachable: shape-only has no manifest to read');
    });

    expect(result.ok).toBe(true);
    if (!isArtifact(result)) throw new Error('expected a partial result');
    expect(result.artifact.meta.detectionConfidence).toBe('shape-only');
    expect(result.artifact.meta.components).toEqual(['agents', 'skills']);
    expect(result.artifact.name).toBe('x');
    expect(result.artifact.slug).toBe('x');
    expect(result.warnings.join(' ')).toContain('agents');
    expect(result.warnings.join(' ')).toContain('skills');
    expect(result.warnings.join(' ')).toContain('no plugin.json');
  });

  it('mints a distinct contentBasis when the component set differs, and identical when it does not', async () => {
    const a = plugin.match([
      { path: 'plugins/x/skills/a/SKILL.md', type: 'blob', sha: 's1' },
      { path: 'plugins/x/agents/b.md', type: 'blob', sha: 's2' },
    ])[0];
    const b = plugin.match([
      { path: 'plugins/x/skills/a/SKILL.md', type: 'blob', sha: 's3' },
      { path: 'plugins/x/commands/c.md', type: 'blob', sha: 's4' },
    ])[0];

    const read = async () => {
      throw new Error('unreachable');
    };
    const resultA = await plugin.parse(a, read);
    const resultB = await plugin.parse(b, read);
    if (!isArtifact(resultA)) throw new Error('expected partial');
    if (!isArtifact(resultB)) throw new Error('expected partial');
    expect(resultA.artifact.contentBasis).not.toBe(resultB.artifact.contentBasis);
  });
});

describe('plugin.parse — manifest, name and directory fallback', () => {
  it('a manifest with a name parses to that name', async () => {
    const result = await parseManifestAt(
      'plugins/x/.claude-plugin/plugin.json',
      JSON.stringify({ name: 'declared-name', description: 'd' }),
    );
    expect(result.ok).toBe(true);
    if (!isArtifact(result)) return;
    expect(result.artifact.name).toBe('declared-name');
  });

  it('a manifest without a name parses to its directory name (Claude Code auto-discovery)', async () => {
    const result = await parseManifestAt(
      'plugins/my-plugin/.claude-plugin/plugin.json',
      JSON.stringify({ description: 'no name field here' }),
    );
    expect(result.ok).toBe(true);
    if (!isArtifact(result)) return;
    expect(result.artifact.name).toBe('my-plugin');
  });

  it('only name is required — a minimal manifest is ok, not partial', async () => {
    const result = await parseManifestAt(
      'plugins/x/.claude-plugin/plugin.json',
      JSON.stringify({ name: 'x' }),
    );
    expect(result.ok).toBe(true);
    if (!isArtifact(result)) return;
    expect(result.status).toBe('ok');
  });
});

describe('plugin.parse — malformed manifests', () => {
  it('a manifest that is not valid JSON fails with a readable error and a fallback name, not an exception', async () => {
    const result = await parseManifestAt(
      'plugins/broken/.claude-plugin/plugin.json',
      '{not valid json',
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.artifact?.name).toBe('broken');
    expect(result.ok === false && result.errors.length).toBeGreaterThan(0);
  });

  it('a manifest that is a JSON array fails with a readable error and a fallback name', async () => {
    const result = await parseManifestAt(
      'plugins/broken/.claude-plugin/plugin.json',
      adversarial('plugin-malformed.json'),
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.artifact?.name).toBe('broken');
  });

  it('reports an unreadable file without throwing', async () => {
    const candidate: Candidate = {
      type: 'plugin',
      sourcePath: 'plugins/x/.claude-plugin/plugin.json',
      needs: ['plugins/x/.claude-plugin/plugin.json'],
      containerRoot: 'plugins/x',
    };
    const result = await plugin.parse(candidate, async () => {
      throw new Error('raw 500');
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors[0]).toContain('could not read: raw 500');
  });
});

describe('plugin.parse — tolerant validation', () => {
  it('unknown top-level fields are a warning, never a rejection', async () => {
    const result = await parseManifestAt(
      'plugins/x/.claude-plugin/plugin.json',
      JSON.stringify({ name: 'x', totallyUnknownField: true }),
    );
    expect(result.ok).toBe(true);
    if (!isArtifact(result)) return;
    expect(result.status).toBe('partial');
    expect(result.warnings.join(' ')).toContain('totallyUnknownField');
  });

  it("an inline mcpServers object's names land in meta.mcpServers, never its values", async () => {
    const result = await parseManifestAt(
      'plugins/x/.claude-plugin/plugin.json',
      JSON.stringify({
        name: 'x',
        mcpServers: {
          db: { command: 'db-server', env: { DB_PASSWORD: 'super-secret-value' } },
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (!isArtifact(result)) return;
    expect(result.artifact.meta.mcpServers).toEqual(['db']);
    // Serialize the whole artifact: the planted secret must appear nowhere.
    expect(JSON.stringify(result.artifact)).not.toContain('super-secret-value');
  });

  it('a path-valued mcpServers override lands in meta.declaredComponents, and is not fetched', async () => {
    const result = await parseManifestAt(
      'plugins/x/.claude-plugin/plugin.json',
      JSON.stringify({ name: 'x', mcpServers: './mcp-config.json' }),
    );
    expect(result.ok).toBe(true);
    if (!isArtifact(result)) return;
    expect(result.artifact.meta.mcpServers).toEqual([]);
    expect(result.artifact.meta.declaredComponents).toMatchObject({
      mcpServers: './mcp-config.json',
    });
  });

  it('path-valued component overrides land in meta.declaredComponents and are not fetched', async () => {
    const result = await parseManifestAt(
      'plugins/x/.claude-plugin/plugin.json',
      JSON.stringify({
        name: 'x',
        skills: './custom/skills/',
        commands: ['./custom/commands/special.md'],
      }),
    );
    expect(result.ok).toBe(true);
    if (!isArtifact(result)) return;
    expect(result.artifact.meta.declaredComponents).toMatchObject({
      skills: './custom/skills/',
      commands: ['./custom/commands/special.md'],
    });
  });
});
