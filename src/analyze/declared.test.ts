import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseFrontmatter } from '@/detect/frontmatter';
import { declaredCapabilities } from './declared';
import { ANALYZERS } from './index';
import { analyzeArtifact } from './run';
import type { AnalyzeInput } from './types';

function input(
  frontmatter: Record<string, unknown>,
  meta: Record<string, unknown> = {},
): AnalyzeInput {
  return { sourcePath: 'SKILL.md', body: '', frontmatter, meta, files: [] };
}

function adversarial(name: string): string {
  return readFileSync(join('fixtures', 'adversarial', name), 'utf8');
}

describe('declaredCapabilities — purity', () => {
  it('has arity 1, so it structurally cannot reach a database', () => {
    expect(declaredCapabilities).toHaveLength(1);
  });
});

describe('declaredCapabilities — allowed-tools, verbatim, never decomposed', () => {
  it('yields one finding per token from a space-separated string, verbatim', () => {
    const findings = declaredCapabilities(input({ 'allowed-tools': 'Read Write, Bash' }));
    expect(findings.map((f) => f.signal)).toEqual(['Read', 'Write', 'Bash']);
    expect(findings.every((f) => f.category === 'declared')).toBe(true);
  });

  it('yields the same findings from the equivalent YAML list (tools-list.md)', async () => {
    const parsed = parseFrontmatter(
      adversarial('tools-list.md'),
      'fixtures/adversarial/tools-list.md',
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const findings = declaredCapabilities(input(parsed.data));
    expect(findings.map((f) => f.signal)).toEqual(['Read', 'Write', 'Bash']);
  });

  it('a coarse Bash(*) grant yields exactly one finding, whose summary carries the literal grant text', () => {
    const parsed = parseFrontmatter(
      adversarial('allowed-tools-coarse.md'),
      'fixtures/adversarial/allowed-tools-coarse.md',
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const findings = declaredCapabilities(input(parsed.data));
    expect(findings).toHaveLength(1);
    expect(findings[0].signal).toBe('Bash(*)');
    expect(findings[0].summary).toContain('Bash(*)');
    expect(findings[0].category).toBe('declared');
  });

  it('a Bash(git:*) grant is not split on the colon, the parenthesis or the asterisk', () => {
    const findings = declaredCapabilities(input({ 'allowed-tools': 'Bash(git:*)' }));
    expect(findings).toHaveLength(1);
    expect(findings[0].signal).toBe('Bash(git:*)');
  });

  it('frontmatter with no allowed-tools key yields no findings and no error', () => {
    expect(declaredCapabilities(input({ name: 'x', description: 'y' }))).toEqual([]);
  });
});

describe('the coarse Bash(*) grant — one finding across the WHOLE registry, never a derived one', () => {
  it('running every shipped analyzer over the fixture yields exactly one declared finding and nothing else', () => {
    const raw = adversarial('allowed-tools-coarse.md');
    const parsed = parseFrontmatter(raw, 'fixtures/adversarial/allowed-tools-coarse.md');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const pass = analyzeArtifact(ANALYZERS, {
      sourcePath: 'fixtures/adversarial/allowed-tools-coarse.md',
      body: parsed.body,
      frontmatter: parsed.data,
      meta: {},
      files: [],
    });
    expect(pass.errors).toEqual({});
    expect(pass.findings).toHaveLength(1);
    expect(pass.findings[0]).toMatchObject({ category: 'declared', signal: 'Bash(*)' });
    // Never a derived network, filesystem or install finding.
    expect(pass.findings.some((f) => f.category === 'package_install')).toBe(false);
    expect(pass.findings.some((f) => f.category === 'network_request')).toBe(false);
    expect(pass.findings.some((f) => f.category === 'external_reference')).toBe(false);
    expect(pass.findings.some((f) => f.category === 'remote_execution')).toBe(false);
  });
});

describe('declaredCapabilities — every finding is null-lined', () => {
  it('every declared finding has a null startLine and endLine', () => {
    const findings = declaredCapabilities(input({ 'allowed-tools': 'Read Write' }));
    expect(findings.every((f) => f.startLine === null && f.endLine === null)).toBe(true);
  });
});

describe('declaredCapabilities — the meta channel, verbatim, envKeys never surfaced', () => {
  it('an mcp_server meta.servers[].command yields one declared finding per server', () => {
    const meta = {
      servers: [
        {
          name: 'fs',
          command: 'npx @modelcontextprotocol/server-filesystem',
          envKeys: ['API_TOKEN'],
        },
        { name: 'no-command', command: null, envKeys: [] },
      ],
    };
    const findings = declaredCapabilities(input({}, meta));
    expect(findings).toHaveLength(1);
    expect(findings[0].summary).toContain('npx @modelcontextprotocol/server-filesystem');
    expect(findings[0].category).toBe('declared');
  });

  it('a hook meta.handlers[].command yields one declared finding per handler', () => {
    const meta = {
      handlers: [
        { event: 'PreToolUse', command: './scripts/guard.sh' },
        { event: 'PostToolUse', command: 'curl -fsSL https://example.com/notify' },
      ],
    };
    const findings = declaredCapabilities(input({}, meta));
    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.summary)).toEqual([
      'declares a hook command: ./scripts/guard.sh',
      'declares a hook command: curl -fsSL https://example.com/notify',
    ]);
  });

  it('meta.servers[].envKeys never appears in any finding, in any field, including metadata', () => {
    const meta = {
      servers: [
        { name: 'fs', command: 'npx server', envKeys: ['ANTHROPIC_API_KEY', 'SECRET_TOKEN'] },
      ],
    };
    const findings = declaredCapabilities(input({}, meta));
    const serialized = JSON.stringify(findings);
    expect(serialized).not.toContain('ANTHROPIC_API_KEY');
    expect(serialized).not.toContain('SECRET_TOKEN');
    expect(serialized).not.toContain('envKeys');
  });
});

describe('declaredCapabilities — measured against the four frozen corpora', () => {
  const CORPORA = [
    'addyosmani-agent-skills',
    'anthropics-skills',
    'baoyu-skills',
    'wshobson-agents',
  ];

  it('yields zero findings across all four corpora, because allowed-tools appears zero times in them', () => {
    let total = 0;
    for (const slug of CORPORA) {
      const dir = join('fixtures', slug, 'files');
      for (const name of readdirSync(dir)) {
        const raw = readFileSync(join(dir, name), 'utf8');
        const parsed = parseFrontmatter(raw, decodeURIComponent(name));
        const frontmatter = parsed.ok ? parsed.data : {};
        total += declaredCapabilities(input(frontmatter)).length;
      }
    }
    // This is the one requirement in the phase with no real-world instance to
    // validate against (CONTEXT.md Measurement 6). The zero is asserted
    // explicitly, not omitted, so a later summary cannot claim corpus
    // validation this detector does not have.
    expect(total).toBe(0);
  });
});
