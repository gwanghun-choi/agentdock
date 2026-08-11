import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { command } from './command';
import type { Candidate, ParseResult, TreeEntry } from './types';

const ROOT = 'fixtures';

/**
 * command.parse() only ever returns the artifact-bearing arms ('ok'/'partial')
 * — it never routes a candidate to the seeds or none channels. Narrows the
 * type for the assertions below, mirroring skill.test.ts's isArtifact.
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

/** Parses a hand-written fixture at a chosen source path. */
async function parseAt(sourcePath: string, source: string) {
  const candidate: Candidate = { type: 'command', sourcePath, needs: [sourcePath] };
  return command.parse(candidate, async () => source);
}

const CORPORA = ['addyosmani-agent-skills', 'anthropics-skills', 'baoyu-skills', 'wshobson-agents'];

describe('command.match — path segments, measured counts', () => {
  const COUNTS: [string, number][] = [
    ['wshobson-agents', 109],
    ['addyosmani-agent-skills', 8],
    ['anthropics-skills', 0],
    ['baoyu-skills', 0],
  ];

  it.each(COUNTS)('finds %i commands in %s without opening a file', (slug, expected) => {
    const entries = corpusTree(slug);
    const candidates = command.match(entries);
    expect(candidates).toHaveLength(expected);
    expect(candidates.every((c) => c.type === 'command')).toBe(true);
    expect(candidates.every((c) => c.needs.length === 1)).toBe(true);
    // Path-only is structural, not a promise: match() has one parameter and
    // there is no reader to call.
    expect(command.match).toHaveLength(1);
  });

  it('costs zero file reads across every corpus with no commands directory', () => {
    for (const slug of ['anthropics-skills', 'baoyu-skills']) {
      expect(command.match(corpusTree(slug))).toEqual([]);
    }
  });

  it('sums to the 117 commands the four corpora hold', () => {
    const total = CORPORA.reduce((n, slug) => n + command.match(corpusTree(slug)).length, 0);
    expect(total).toBe(117);
  });

  it('covers .claude/commands/x.md, a plugin commands/x.md, and a nested commands/sub/x.md', () => {
    const tree: TreeEntry[] = [
      { path: '.claude/commands/deploy.md', type: 'blob', sha: 'a' },
      { path: 'plugins/p/commands/review.md', type: 'blob', sha: 'b' },
      { path: '.claude/commands/git/commit.md', type: 'blob', sha: 'c' },
    ];
    expect(command.match(tree).map((c) => c.sourcePath)).toEqual(tree.map((e) => e.path));
  });

  it('excludes a README inside a commands directory, case-insensitively', () => {
    const tree: TreeEntry[] = [
      { path: '.claude/commands/README.md', type: 'blob', sha: 'a' },
      { path: '.claude/commands/readme.md', type: 'blob', sha: 'b' },
      { path: '.claude/commands/deploy.md', type: 'blob', sha: 'c' },
    ];
    expect(command.match(tree).map((c) => c.sourcePath)).toEqual(['.claude/commands/deploy.md']);
  });

  it('excludes a .md file outside any commands directory and a non-.md file inside one', () => {
    const tree: TreeEntry[] = [
      { path: 'docs/deploy.md', type: 'blob', sha: 'a' },
      { path: '.claude/commands/deploy.json', type: 'blob', sha: 'b' },
      { path: '.claude/commands/deploy.md', type: 'blob', sha: 'c' },
    ];
    expect(command.match(tree).map((c) => c.sourcePath)).toEqual(['.claude/commands/deploy.md']);
  });

  it('excludes a tree entry of type tree even when its path looks like a command', () => {
    const tree: TreeEntry[] = [{ path: '.claude/commands/deploy.md', type: 'tree', sha: 'a' }];
    expect(command.match(tree)).toEqual([]);
  });

  it('costs zero file reads on a repository with no commands', () => {
    const tree: TreeEntry[] = [{ path: 'README.md', type: 'blob', sha: 'a' }];
    expect(command.match(tree).flatMap((c) => c.needs)).toEqual([]);
  });
});

describe('command.parse — the filename is authoritative', () => {
  it('names a command by its filename even when frontmatter declares a different name', async () => {
    const result = await parseAt(
      '.claude/commands/deploy.md',
      '---\nname: ship-it\ndescription: deploys the thing\n---\n\nBody.\n',
    );
    expect(result.ok).toBe(true);
    if (!isArtifact(result)) return;
    expect(result.status).toBe('partial');
    expect(result.artifact.name).toBe('deploy');
    expect(result.artifact.slug).toBe('deploy');
    expect(result.warnings.join(' ')).toContain('"ship-it"');
    expect(result.warnings.join(' ')).toContain('"deploy"');
  });

  it('a command with frontmatter but no name field takes the filename as its name and does not fail', async () => {
    const result = await parseAt(
      '.claude/commands/deploy.md',
      '---\ndescription: deploys the thing\n---\n\nBody.\n',
    );
    expect(result.ok).toBe(true);
    if (!isArtifact(result)) return;
    expect(result.artifact.name).toBe('deploy');
    expect(result.status).toBe('ok');
  });

  it('a command with no description is partial, not failed', async () => {
    const result = await parseAt('.claude/commands/deploy.md', '---\nname: deploy\n---\n\nBody.\n');
    expect(result.ok).toBe(true);
    if (!isArtifact(result)) return;
    expect(result.status).toBe('partial');
    expect(result.warnings.join(' ')).toContain('description is missing or empty');
    expect(result.artifact.summary).toBeNull();
  });

  it('a nested command takes the filename, not the containing directory, as its name', async () => {
    const result = await parseAt(
      '.claude/commands/git/commit.md',
      '---\nname: commit\ndescription: commits\n---\n\nBody.\n',
    );
    expect(result.ok).toBe(true);
    if (!isArtifact(result)) return;
    expect(result.artifact.name).toBe('commit');
    expect(result.status).toBe('ok');
  });
});

describe('command.parse — the same parser as skill.ts, unmodified', () => {
  it.each([
    ['no-fence.md', /no frontmatter fence/],
    ['bad-yaml.md', /not valid YAML/],
    ['alias-bomb.md', /serialized size cap/],
  ] as const)(
    '%s fails a command exactly as it fails a skill, through the shared parser',
    async (name, why) => {
      const result = await parseAt('.claude/commands/x.md', adversarial(name));
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.errors.join(' ')).toMatch(why);
    },
  );

  it('bom.md parses ok through the same byte-order-mark handling a skill gets', async () => {
    const result = await parseAt('.claude/commands/x.md', adversarial('bom.md'));
    expect(result.ok).toBe(true);
  });

  it('reports an unreadable file without losing the other candidates', async () => {
    const candidate: Candidate = {
      type: 'command',
      sourcePath: '.claude/commands/x.md',
      needs: ['.claude/commands/x.md'],
    };
    const result = await command.parse(candidate, async () => {
      throw new Error('raw 500');
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors[0]).toContain('could not read: raw 500');
  });
});

describe('command.parse — tolerant validation, identical to skills', () => {
  it('normalizes allowed-tools from a list, a string and a comma list alike', async () => {
    const fromList = await parseAt(
      '.claude/commands/x.md',
      '---\nname: x\ndescription: d\nallowed-tools:\n  - Read\n  - Write\n  - Bash\n---\n\nBody.\n',
    );
    expect(isArtifact(fromList) && fromList.artifact.meta.allowedTools).toEqual([
      'Read',
      'Write',
      'Bash',
    ]);

    const fromString = await parseAt(
      '.claude/commands/x.md',
      '---\nname: x\ndescription: d\nallowed-tools: Read Write, Bash\n---\n\nBody.\n',
    );
    expect(isArtifact(fromString) && fromString.artifact.meta.allowedTools).toEqual([
      'Read',
      'Write',
      'Bash',
    ]);

    const wrongShape = await parseAt(
      '.claude/commands/x.md',
      '---\nname: x\ndescription: d\nallowed-tools: 7\n---\n\nBody.\n',
    );
    expect(isArtifact(wrongShape) && wrongShape.warnings.join(' ')).toContain(
      'allowed-tools is neither a string nor a list',
    );
  });

  it('unknown top-level fields are a warning, never a rejection', async () => {
    const result = await parseAt(
      '.claude/commands/x.md',
      '---\nname: x\ndescription: d\ntotallyUnknownField: true\n---\n\nBody.\n',
    );
    expect(result.ok).toBe(true);
    if (!isArtifact(result)) return;
    expect(result.status).toBe('partial');
    expect(result.warnings.join(' ')).toContain('totallyUnknownField');
  });

  it('stores the body as a capped excerpt, same 32 KB rule as skills', async () => {
    const big = `---\nname: big\ndescription: d\n---\n\n${'b'.repeat(200_000)}\n`;
    const result = await parseAt('.claude/commands/big.md', big);
    expect(isArtifact(result) && result.artifact.body.length).toBe(32 * 1024);
  });
});
