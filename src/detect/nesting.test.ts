import { describe, expect, it } from 'vitest';
import { assignParentPaths } from './nesting';
import type { Candidate, Detector } from './types';

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return { type: 'skill', sourcePath: 'x', needs: [], ...overrides };
}

describe('assignParentPaths', () => {
  it('links a plugin-owned skill to its plugin, and leaves a top-level skill unparented', () => {
    const container = candidate({
      type: 'plugin',
      sourcePath: 'plugins/foo/.claude-plugin/plugin.json',
      needs: ['plugins/foo/.claude-plugin/plugin.json'],
      containerRoot: 'plugins/foo',
    });
    const nested = candidate({ sourcePath: 'plugins/foo/skills/bar/SKILL.md' });
    const topLevel = candidate({ sourcePath: 'skills/other/SKILL.md' });

    assignParentPaths([container, nested, topLevel]);

    expect(nested.parentPath).toBe('plugins/foo');
    expect(topLevel.parentPath).toBeUndefined();
  });

  it('links a candidate to the nearer of two nested containers', () => {
    const outer = candidate({
      type: 'plugin',
      sourcePath: 'plugins/outer',
      needs: [],
      containerRoot: 'plugins/outer',
    });
    const inner = candidate({
      type: 'plugin',
      sourcePath: 'plugins/outer/nested',
      needs: [],
      containerRoot: 'plugins/outer/nested',
    });
    const leaf = candidate({ sourcePath: 'plugins/outer/nested/skills/y/SKILL.md' });

    assignParentPaths([outer, inner, leaf]);

    expect(leaf.parentPath).toBe('plugins/outer/nested');
    // The inner container itself is parented to the outer one, not to itself.
    expect(inner.parentPath).toBe('plugins/outer');
    expect(outer.parentPath).toBeUndefined();
  });

  it('a container declaring the repository root records no parent on anything', () => {
    const root = candidate({
      type: 'plugin',
      sourcePath: '.claude-plugin/plugin.json',
      needs: ['.claude-plugin/plugin.json'],
      containerRoot: '',
    });
    const leaf = candidate({ sourcePath: 'skills/x/SKILL.md' });

    assignParentPaths([root, leaf]);

    expect(leaf.parentPath).toBeUndefined();
    expect(root.parentPath).toBeUndefined();
  });

  it('a container records no parent on itself', () => {
    const container = candidate({
      type: 'plugin',
      sourcePath: 'plugins/x',
      needs: [],
      containerRoot: 'plugins/x',
    });
    assignParentPaths([container]);
    expect(container.parentPath).toBeUndefined();
  });

  it('leaves every parentPath undefined when the candidate list holds no container', () => {
    const a = candidate({ sourcePath: 'skills/a/SKILL.md' });
    const b = candidate({ sourcePath: 'skills/b/SKILL.md' });
    assignParentPaths([a, b]);
    expect(a.parentPath).toBeUndefined();
    expect(b.parentPath).toBeUndefined();
  });

  it('names no artifact type — an invented container type still links its children', () => {
    // The DET-09 proof in miniature: a container detector of a type this
    // module has never heard of, defined only inside this test file.
    const invented: Detector = {
      type: 'time-capsule',
      match: () => [],
      parse: async () => {
        throw new Error('unreachable');
      },
    };

    const container = candidate({
      type: invented.type,
      sourcePath: 'capsules/2026',
      needs: [],
      containerRoot: 'capsules/2026',
    });
    const child = candidate({ type: 'skill', sourcePath: 'capsules/2026/skills/x/SKILL.md' });

    assignParentPaths([container, child]);

    expect(child.parentPath).toBe('capsules/2026');
  });
});
