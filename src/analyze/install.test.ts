import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { install } from './install';
import type { AnalyzeInput } from './types';

function input(body: string, sourcePath = 'SKILL.md'): AnalyzeInput {
  return { sourcePath, body, frontmatter: {}, meta: {}, files: [] };
}

describe('install — purity', () => {
  it('has arity 1, so it structurally cannot reach a database', () => {
    expect(install).toHaveLength(1);
  });
});

describe('install — each shape, and the line it is on', () => {
  const shapes: [string, string][] = [
    ['npx', 'Run `npx cowsay hello` to try it.'],
    ['npm install', 'First, npm install the dependency.'],
    ['pip install', 'Then pip install the package.'],
    ['uvx', 'uvx run the tool directly.'],
    ['brew install', 'brew install oven-sh/bun/bun'],
    ['bunx', 'bunx --bun the-thing'],
  ];

  it.each(shapes)('finds the %s shape and reports its line', (signal, line) => {
    const body = `intro\n${line}\noutro`;
    const findings = install(input(body));
    expect(findings).toHaveLength(1);
    expect(findings[0].signal).toBe(signal);
    expect(findings[0].startLine).toBe(2);
    expect(findings[0].endLine).toBe(2);
    expect(findings[0].category).toBe('package_install');
    expect(findings[0].sourcePath).toBe('SKILL.md');
    expect(findings[0].evidenceText).toContain(signal);
  });

  it('finds two directives on the same line as two findings', () => {
    const body = 'prefer `bun`; else `npx -y bun`; else suggest `brew install oven-sh/bun/bun`.';
    const findings = install(input(body));
    expect(findings.map((f) => f.signal)).toEqual(['npx', 'brew install']);
    expect(findings.every((f) => f.startLine === 1)).toBe(true);
  });

  it('finds nothing in a body with no install directive', () => {
    expect(install(input('just some prose about a skill'))).toEqual([]);
  });
});

describe('install — measured against the four frozen corpora', () => {
  const CORPORA = [
    'addyosmani-agent-skills',
    'anthropics-skills',
    'baoyu-skills',
    'wshobson-agents',
  ];

  function corpusHits(slug: string): number {
    const dir = join('fixtures', slug, 'files');
    let total = 0;
    for (const name of readdirSync(dir)) {
      const body = readFileSync(join(dir, name), 'utf8');
      total += install(input(body, decodeURIComponent(name))).length;
    }
    return total;
  }

  it('reproduces the measured 78 hits across the four corpora, so a pattern change is a visible diff', () => {
    const total = CORPORA.reduce((sum, slug) => sum + corpusHits(slug), 0);
    expect(total).toBe(78);
  });

  it('never exceeds the measured single-file maximum of 7', () => {
    let max = 0;
    for (const slug of CORPORA) {
      const dir = join('fixtures', slug, 'files');
      for (const name of readdirSync(dir)) {
        const body = readFileSync(join(dir, name), 'utf8');
        max = Math.max(max, install(input(body)).length);
      }
    }
    expect(max).toBe(7);
  });
});
