import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DETECTORS } from './index';
import { skill } from './skill';
import type { Candidate, TreeEntry } from './types';

const ROOT = 'fixtures';

/**
 * Loads a frozen corpus: the captured tree and a map of the captured bodies.
 *
 * The reader is closed over that map and handed to parse() as a parameter, so no
 * mocking library is involved — the interface already takes its dependency as an
 * argument.
 */
function corpus(slug: string) {
  const dir = join(ROOT, slug);
  const tree = JSON.parse(readFileSync(join(dir, 'tree.json'), 'utf8'));
  const files = new Map<string, string>();
  for (const name of readdirSync(join(dir, 'files'))) {
    files.set(decodeURIComponent(name), readFileSync(join(dir, 'files', name), 'utf8'));
  }
  const entries: TreeEntry[] = tree.tree;
  const read = async (path: string) => {
    const body = files.get(path);
    if (body === undefined) throw new Error(`no captured body for ${path}`);
    return body;
  };
  return { entries, files, read };
}

function adversarial(name: string): string {
  return readFileSync(join(ROOT, 'adversarial', name), 'utf8');
}

/** Parses a hand-written fixture at a chosen source path. */
async function parseAt(sourcePath: string, source: string) {
  const candidate: Candidate = { type: 'skill', sourcePath, needs: [sourcePath] };
  return skill.parse(candidate, async () => source);
}

describe('skill.match — path only, measured counts', () => {
  const COUNTS: [string, number][] = [
    ['anthropics-skills', 18],
    ['addyosmani-agent-skills', 24],
    ['baoyu-skills', 22],
    ['wshobson-agents', 180],
  ];

  it.each(COUNTS)('finds %i skills in %s without opening a file', (slug, expected) => {
    const { entries } = corpus(slug);
    const candidates = skill.match(entries);
    expect(candidates).toHaveLength(expected);
    expect(candidates.every((c) => c.type === 'skill')).toBe(true);
    expect(candidates.every((c) => c.needs.length === 1)).toBe(true);
    // Path-only is structural, not a promise: match() has one parameter and it
    // is the tree. There is no reader to call.
    expect(skill.match).toHaveLength(1);
  });

  it('covers the root file, the conventional layout and the nested plugin layout', () => {
    const tree: TreeEntry[] = [
      { path: 'SKILL.md', type: 'blob', sha: 'a' },
      { path: 'skills/x/SKILL.md', type: 'blob', sha: 'b' },
      { path: 'plugins/p/skills/y/SKILL.md', type: 'blob', sha: 'c' },
    ];
    expect(skill.match(tree).map((c) => c.sourcePath)).toEqual(tree.map((e) => e.path));
  });

  it('matches nothing whose filename merely contains the manifest name', () => {
    const tree: TreeEntry[] = [
      { path: 'NOTSKILL.md', type: 'blob', sha: 'a' },
      { path: 'x/SKILL.md.bak', type: 'blob', sha: 'b' },
      { path: 'x/MY-SKILL.md', type: 'blob', sha: 'c' },
      { path: 'x/skill.md', type: 'blob', sha: 'd' },
      // A directory named SKILL.md is not a manifest.
      { path: 'x/SKILL.md', type: 'tree', sha: 'e' },
    ];
    expect(skill.match(tree)).toEqual([]);
  });

  it('costs zero file reads on a repository with no skills', () => {
    const tree: TreeEntry[] = [{ path: 'README.md', type: 'blob', sha: 'a' }];
    // No candidates means no `needs`, which means the caller fetches nothing.
    expect(skill.match(tree).flatMap((c) => c.needs)).toEqual([]);
  });
});

describe('skill.parse — the reference corpus', () => {
  it('parses all 18 files and drops none', async () => {
    const { entries, read } = corpus('anthropics-skills');
    const results = await Promise.all(skill.match(entries).map((c) => skill.parse(c, read)));

    expect(results).toHaveLength(18);
    expect(results.filter((r) => r.ok)).toHaveLength(18);
    expect(results.filter((r) => r.ok && r.status === 'partial')).toHaveLength(2);
  });

  it('records the declared name contradicting its directory as a warning, not a rejection', async () => {
    const { entries, read } = corpus('anthropics-skills');
    const candidate = skill.match(entries).find((c) => c.sourcePath === 'template/SKILL.md');
    const result = await skill.parse(candidate as Candidate, read);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe('partial');
    expect(result.warnings.join(' ')).toContain('"template-skill"');
    expect(result.warnings.join(' ')).toContain('"template"');
    // The row is still written, with the declared name intact.
    expect(result.artifact.name).toBe('template-skill');
    expect(result.artifact.slug).toBe('template');
  });

  it('records an over-length description as a warning naming the length', async () => {
    const { entries, read } = corpus('anthropics-skills');
    const candidate = skill
      .match(entries)
      .find((c) => c.sourcePath === 'skills/claude-api/SKILL.md');
    const result = await skill.parse(candidate as Candidate, read);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe('partial');
    expect(result.warnings.join(' ')).toMatch(/description is 1068 characters, over 1024/);
    expect(result.artifact.summary).toHaveLength(1068);
  });

  it('yields a null declared version when no version field exists', async () => {
    const { entries, read } = corpus('anthropics-skills');
    const results = await Promise.all(skill.match(entries).map((c) => skill.parse(c, read)));
    for (const r of results) {
      expect(r.ok && r.artifact.declaredVersion).toBeNull();
    }
  });
});

describe('skill.parse — the clean baseline produces no warnings at all', () => {
  it('parses all 24 files with zero warnings', async () => {
    const { entries, read } = corpus('addyosmani-agent-skills');
    const results = await Promise.all(skill.match(entries).map((c) => skill.parse(c, read)));

    expect(results).toHaveLength(24);
    const noisy = results.flatMap((r) => (r.ok && r.warnings.length > 0 ? r.warnings : []));
    // If this ever fires, the conformance checker has drifted strict — not the
    // corpus. Without it, every warning added later looks correct because
    // something always does.
    expect(noisy).toEqual([]);
    expect(results.every((r) => r.ok && r.status === 'ok')).toBe(true);
  });
});

describe('skill.parse — the non-specification version field', () => {
  it('reads the declared version from the field 21 of 22 files carry', async () => {
    const { entries, read } = corpus('baoyu-skills');
    const results = await Promise.all(skill.match(entries).map((c) => skill.parse(c, read)));

    const versioned = results.filter((r) => r.ok && r.artifact.declaredVersion !== null);
    expect(versioned).toHaveLength(21);
    expect(results.filter((r) => r.ok && r.status === 'partial')).toHaveLength(21);

    const warnings = results.flatMap((r) => (r.ok ? r.warnings : []));
    expect(warnings.every((w) => w.includes('keys outside the specification: version'))).toBe(true);
    // Never synthesized: the value is whatever the file said.
    expect(
      typeof (versioned[0] as { artifact: { declaredVersion: string } }).artifact.declaredVersion,
    ).toBe('string');
  });

  it('parses the sampled bodies of the 180-file scale corpus', async () => {
    const { entries, files, read } = corpus('wshobson-agents');
    const sampled = skill.match(entries).filter((c) => files.has(c.sourcePath));

    expect(sampled).toHaveLength(20);
    const results = await Promise.all(sampled.map((c) => skill.parse(c, read)));
    expect(results.filter((r) => r.ok)).toHaveLength(20);
  });
});

describe('skill.parse — conformance is recorded, never enforced', () => {
  it('records nested structures under the flat-documented field as partial, not failed', async () => {
    const result = await parseAt('skills/other/SKILL.md', adversarial('nested-metadata.md'));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe('partial');
    // Stored as it arrived, not coerced to the documented shape.
    expect(result.artifact.frontmatter.metadata).toMatchObject({ tags: ['a', 'b'] });
  });

  it('normalizes allowed-tools from a list, a string and a comma list alike', async () => {
    const fromList = await parseAt('skills/tools-list/SKILL.md', adversarial('tools-list.md'));
    expect(fromList.ok && fromList.artifact.meta.allowedTools).toEqual(['Read', 'Write', 'Bash']);

    const fromString = await parseAt(
      'skills/t/SKILL.md',
      '---\nname: t\ndescription: d\nallowed-tools: Read Write, Bash\n---\n\nBody.\n',
    );
    expect(fromString.ok && fromString.artifact.meta.allowedTools).toEqual([
      'Read',
      'Write',
      'Bash',
    ]);

    const wrongShape = await parseAt(
      'skills/t/SKILL.md',
      '---\nname: t\ndescription: d\nallowed-tools: 7\n---\n\nBody.\n',
    );
    expect(wrongShape.ok && wrongShape.warnings.join(' ')).toContain(
      'allowed-tools is neither a string nor a list',
    );
  });

  it('records the key set and the specification-purity flag on every artifact', async () => {
    const { entries, read } = corpus('baoyu-skills');
    const results = await Promise.all(skill.match(entries).map((c) => skill.parse(c, read)));

    for (const r of results) {
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect(Array.isArray(r.artifact.meta.frontmatterKeys)).toBe(true);
      expect(typeof r.artifact.meta.specPure).toBe('boolean');
    }
    expect(results.filter((r) => r.ok && r.artifact.meta.specPure === false)).toHaveLength(21);
  });
});

describe('skill.parse — the three ways to fail', () => {
  it.each([
    ['missing-name.md', /missing a non-empty name or description/],
    ['empty-description.md', /missing a non-empty name or description/],
    ['no-fence.md', /no frontmatter fence/],
    ['bad-yaml.md', /not valid YAML/],
    ['alias-bomb.md', /serialized size cap/],
  ])('%s produces a failed result rather than an exception', async (name, why) => {
    const result = await parseAt(`skills/x/SKILL.md`, adversarial(name));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors.join(' ')).toMatch(why);
  });

  it('reports an unreadable file without losing the other artifacts', async () => {
    const candidate: Candidate = {
      type: 'skill',
      sourcePath: 'skills/x/SKILL.md',
      needs: ['skills/x/SKILL.md'],
    };
    const result = await skill.parse(candidate, async () => {
      throw new Error('raw 500');
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors[0]).toContain('could not read: raw 500');
  });

  it('names the directory when a failed file has no usable name', async () => {
    const result = await parseAt('skills/fallback-dir/SKILL.md', adversarial('missing-name.md'));
    expect(result.ok === false && result.artifact?.name).toBe('fallback-dir');
  });
});

describe('skill.parse — storage shape', () => {
  it('stores the body as a capped excerpt', async () => {
    const big = `---\nname: big\ndescription: d\n---\n\n${'b'.repeat(200_000)}\n`;
    const result = await parseAt('skills/big/SKILL.md', big);
    expect(result.ok && result.artifact.body.length).toBe(32 * 1024);
  });

  it('keeps frontmatter licence prose in its own field, never SPDX-shaped', async () => {
    const result = await parseAt(
      'skills/l/SKILL.md',
      '---\nname: l\ndescription: d\nlicense: Complete terms in LICENSE.txt\n---\n\nBody.\n',
    );
    expect(result.ok && result.artifact.licenseText).toBe('Complete terms in LICENSE.txt');
    expect(result.ok && result.artifact).not.toHaveProperty('licenseSpdx');
  });

  it('keeps a right-to-left override in the stored summary', async () => {
    const result = await parseAt('skills/bidi/SKILL.md', adversarial('bidi.md'));
    expect(result.ok && result.artifact.summary).toContain('‮');
  });
});

describe('the registry', () => {
  it('is one array with one element in this phase', () => {
    expect(DETECTORS).toEqual([skill]);
    expect(DETECTORS.map((d) => d.type)).toEqual(['skill']);
  });
});
