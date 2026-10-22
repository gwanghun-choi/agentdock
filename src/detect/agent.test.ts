import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { declaredCapabilities } from '@/analyze/declared';
import { agent } from './agent';
import { command } from './command';
import { DETECTORS } from './index';
import { assignParentPaths } from './nesting';
import { collectCandidates } from './run';
import type { Candidate, ParseResult, TreeEntry } from './types';

function corpusTree(slug: string): TreeEntry[] {
  return JSON.parse(readFileSync(join('fixtures', slug, 'tree.json'), 'utf8')).tree;
}

function isArtifact(
  result: ParseResult,
): result is Extract<ParseResult, { status: 'ok' | 'partial' }> {
  return result.ok && (result.status === 'ok' || result.status === 'partial');
}

async function parseAt(sourcePath: string, source: string) {
  const candidate: Candidate = { type: 'agent', sourcePath, needs: [sourcePath] };
  return agent.parse(candidate, async () => source);
}

const blob = (path: string): TreeEntry => ({ path, type: 'blob', sha: 'a' });

// Shaped on the example in code.claude.com/docs/en/sub-agents.
const REVIEWER = `---
name: code-reviewer
description: Reviews code for quality and best practices
tools: Read, Glob, Grep
model: sonnet
---

You are a code reviewer.
`;

describe('agent.match — measured counts on fixtures/', () => {
  // Counted 2026-10-21 against the frozen trees, the same way command.test.ts
  // pins its 117: every agents/*.md under .claude/ or a plugin root.
  const COUNTS: [string, number][] = [
    ['wshobson-agents', 204],
    ['disler-hooks-mastery', 19],
    ['anthropics-claude-code', 15],
    ['addyosmani-agent-skills', 4],
    ['anthropics-skills', 0],
    ['baoyu-skills', 0],
    ['obra-superpowers', 0],
  ];

  it.each(COUNTS)('finds %s: %i', (slug, expected) => {
    const candidates = agent.match(corpusTree(slug));
    expect(candidates).toHaveLength(expected);
    expect(candidates.every((c) => c.needs.length === 1)).toBe(true);
  });

  it('skips the three agents/*.md inside a skill directory in anthropics/skills', () => {
    const tree = corpusTree('anthropics-skills');
    expect(tree.filter((e) => e.path.includes('/agents/') && e.path.endsWith('.md'))).toHaveLength(
      3,
    );
    expect(agent.match(tree)).toEqual([]);
  });
});

describe('agent.match — roots', () => {
  it('reads .claude/agents recursively, at the root or nested in a monorepo', () => {
    const tree = [
      blob('.claude/agents/a.md'),
      blob('.claude/agents/team/b.md'),
      blob('packages/web/.claude/agents/c.md'),
    ];
    expect(agent.match(tree).map((c) => c.sourcePath)).toEqual(tree.map((e) => e.path));
  });

  it('reads a manifest plugin and a shape-only plugin, and nothing that is neither', () => {
    const tree = [
      blob('plugins/p/.claude-plugin/plugin.json'),
      blob('plugins/p/agents/x.md'),
      blob('plugins/q/agents/y.md'),
      blob('plugins/q/skills/s/SKILL.md'),
      blob('docs/agents/z.md'),
      blob('src/agents/runner.md'),
    ];
    expect(agent.match(tree).map((c) => c.sourcePath)).toEqual([
      'plugins/p/agents/x.md',
      'plugins/q/agents/y.md',
    ]);
  });

  it('excludes README and anything the command detector owns, so one file is never two rows', () => {
    const tree = [
      blob('.claude/agents/README.md'),
      blob('.claude/agents/commands/x.md'),
      blob('.claude/agents/notes.txt'),
    ];
    expect(agent.match(tree)).toEqual([]);
    const both = [blob('.claude/agents/commands/x.md')];
    expect(command.match(both)).toHaveLength(1);
  });

  it('links a plugin agent to its plugin through the generic nesting pass', () => {
    const tree = [blob('plugins/p/.claude-plugin/plugin.json'), blob('plugins/p/agents/x.md')];
    const candidates = collectCandidates(DETECTORS, tree).flatMap((p) => p.candidates);
    assignParentPaths(candidates);
    expect(candidates.find((c) => c.type === 'agent')?.parentPath).toBe('plugins/p');
  });
});

describe('agent.parse', () => {
  it('reads the documented fields and keeps the grant verbatim', async () => {
    const result = await parseAt('.claude/agents/code-reviewer.md', REVIEWER);
    expect(isArtifact(result)).toBe(true);
    if (!isArtifact(result)) return;
    expect(result.status).toBe('ok');
    expect(result.artifact.name).toBe('code-reviewer');
    expect(result.artifact.slug).toBe('code-reviewer');
    expect(result.artifact.summary).toBe('Reviews code for quality and best practices');
    expect(result.artifact.meta).toMatchObject({
      scope: 'project',
      declaredTools: ['Read', 'Glob', 'Grep'],
      model: 'sonnet',
      specPure: true,
    });
  });

  it('a project file with no frontmatter is not an agent, not a failure', async () => {
    const result = await parseAt('.claude/agents/notes.md', '# Notes\n\nnothing here\n');
    expect(result).toEqual({ ok: true, status: 'none', reason: 'no frontmatter block' });
  });

  it('a project file whose frontmatter does not parse is a failed row', async () => {
    const result = await parseAt('.claude/agents/bad.md', '---\nname: [unclosed\n---\nbody\n');
    expect(result.ok).toBe(false);
  });

  it('a plugin agent with no frontmatter still loads under its filename, as documented', async () => {
    const result = await parseAt('plugins/p/agents/helper.md', 'You help.\n');
    expect(isArtifact(result)).toBe(true);
    if (!isArtifact(result)) return;
    expect(result.status).toBe('partial');
    expect(result.artifact.name).toBe('helper');
    expect(result.artifact.meta.scope).toBe('plugin');
  });

  it('notes a missing description and a key outside the specification', async () => {
    const result = await parseAt('.claude/agents/x.md', '---\nname: x\nfoo: 1\n---\nbody\n');
    expect(isArtifact(result)).toBe(true);
    if (!isArtifact(result)) return;
    expect(result.status).toBe('partial');
    expect(result.warnings).toEqual([
      'description is missing or empty',
      'keys outside the specification: foo',
    ]);
  });

  it('stores mcpServers names only, never an inline definition or its env values', async () => {
    const source = `---
name: db
description: d
mcpServers:
  - github
  - postgres:
      command: pg-mcp
      env:
        PGPASSWORD: sentinel-never-stored
---
body
`;
    const result = await parseAt('.claude/agents/db.md', source);
    expect(isArtifact(result)).toBe(true);
    if (!isArtifact(result)) return;
    expect(result.artifact.meta.mcpServers).toEqual(['github', 'postgres']);
    expect(JSON.stringify(result.artifact.frontmatter)).not.toContain('sentinel-never-stored');
    expect(JSON.stringify(result.artifact.meta)).not.toContain('sentinel-never-stored');
  });

  it('an absent tools field is stored as null, never as an empty grant', async () => {
    const result = await parseAt('.claude/agents/x.md', '---\nname: x\ndescription: d\n---\n');
    expect(isArtifact(result)).toBe(true);
    if (!isArtifact(result)) return;
    expect(result.artifact.meta.declaredTools).toBeNull();
  });
});

describe('declaredCapabilities over an agent', () => {
  it('reports each declared tool once, and nothing when tools is absent', async () => {
    const result = await parseAt('.claude/agents/code-reviewer.md', REVIEWER);
    if (!isArtifact(result)) throw new Error('unreachable');
    const findings = declaredCapabilities({
      sourcePath: '.claude/agents/code-reviewer.md',
      body: result.artifact.body,
      frontmatter: result.artifact.frontmatter,
      meta: result.artifact.meta,
      files: [],
    });
    expect(findings.map((f) => f.summary)).toEqual([
      'declares tools: Read',
      'declares tools: Glob',
      'declares tools: Grep',
    ]);
    expect(
      declaredCapabilities({
        sourcePath: 'x',
        body: '',
        frontmatter: {},
        meta: { declaredTools: null },
        files: [],
      }),
    ).toEqual([]);
  });
});
