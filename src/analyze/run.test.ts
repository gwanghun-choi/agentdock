import { describe, expect, it } from 'vitest';
import { install } from './install';
import { analyzeArtifact } from './run';
import type { AnalyzeInput, Analyzer, Finding } from './types';
import { ANALYZE_CAPS } from './types';

function input(overrides: Partial<AnalyzeInput> = {}): AnalyzeInput {
  return { sourcePath: 'SKILL.md', body: '', frontmatter: {}, meta: {}, files: [], ...overrides };
}

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    detectorId: 'fine',
    detectorVersion: '1',
    category: 'package_install',
    signal: 'x',
    summary: 'observed x',
    sourcePath: 'SKILL.md',
    startLine: 1,
    endLine: 1,
    evidenceText: 'x',
    metadata: {},
    ...overrides,
  };
}

function fineAnalyzer(count = 1): Analyzer {
  return function fine() {
    return Array.from({ length: count }, (_, i) => finding({ startLine: i + 1 }));
  };
}

function throwingAnalyzer(message: string): Analyzer {
  return function broken(): Finding[] {
    throw new Error(message);
  };
}

describe('analyzeArtifact — isolation', () => {
  it('an analyzer that throws loses only its own findings; the others are unchanged', () => {
    const pass = analyzeArtifact(
      [fineAnalyzer(), throwingAnalyzer('boom'), fineAnalyzer()],
      input(),
    );
    expect(pass.findings).toHaveLength(2);
    expect(Object.keys(pass.errors)).toEqual(['broken']);
    expect(pass.errors.broken).toBe('boom');
  });

  it('a distinctive marker planted in the body never reaches the recorded error string', () => {
    const marker = 'XSS-MARKER-9f3a';
    const pass = analyzeArtifact(
      [throwingAnalyzer('a rule failed to compile')],
      input({ body: `prose containing ${marker} on purpose` }),
    );
    expect(pass.errors.broken).not.toContain(marker);
  });

  it('every analyzer in the list runs even when an earlier one throws', () => {
    let ran = false;
    const after: Analyzer = function after() {
      ran = true;
      return [];
    };
    analyzeArtifact([throwingAnalyzer('boom'), after], input());
    expect(ran).toBe(true);
  });
});

describe('analyzeArtifact — the body-size guard', () => {
  it('rejects a body over maxBodyChars, naming the actual size, and calls no analyzer', () => {
    let called = false;
    const spy: Analyzer = function spy() {
      called = true;
      return [];
    };
    const body = 'x'.repeat(ANALYZE_CAPS.maxBodyChars + 1);
    const pass = analyzeArtifact([spy], input({ body }));
    expect(pass.findings).toEqual([]);
    expect(pass.errors._input).toContain(String(body.length));
    expect(called).toBe(false);
  });

  it('does not fire at exactly the cap', () => {
    let called = false;
    const spy: Analyzer = function spy() {
      called = true;
      return [];
    };
    analyzeArtifact([spy], input({ body: 'x'.repeat(ANALYZE_CAPS.maxBodyChars) }));
    expect(called).toBe(true);
  });
});

describe('analyzeArtifact — the per-analyzer volume cap', () => {
  it('caps one analyzer at maxFindingsPerDetector, plus one finding admitting the cap fired', () => {
    const over = ANALYZE_CAPS.maxFindingsPerDetector + 7;
    const pass = analyzeArtifact([fineAnalyzer(over)], input());
    expect(pass.findings).toHaveLength(ANALYZE_CAPS.maxFindingsPerDetector + 1);
    expect(pass.overflow.fine).toBe(7);
  });

  it('reports no overflow when an analyzer stays under the cap', () => {
    const pass = analyzeArtifact([fineAnalyzer(3)], input());
    expect(pass.overflow).toEqual({});
    expect(pass.findings.some((f) => f.signal === 'cap')).toBe(false);
  });

  it("the overflow finding names the exact number withheld, in the analyzer's own category, with no line and no evidence", () => {
    const over = ANALYZE_CAPS.maxFindingsPerDetector + 7;
    const pass = analyzeArtifact([fineAnalyzer(over)], input());
    const capFinding = pass.findings.at(-1);
    expect(capFinding).toMatchObject({
      detectorId: 'fine',
      category: 'package_install', // the fineAnalyzer's own finding category
      signal: 'cap',
      startLine: null,
      endLine: null,
      evidenceText: null,
    });
    expect(capFinding?.summary).toContain('7');
    expect(capFinding?.summary).toContain(String(ANALYZE_CAPS.maxFindingsPerDetector));
  });

  it('a body producing exactly the cap has no overflow finding', () => {
    const pass = analyzeArtifact([fineAnalyzer(ANALYZE_CAPS.maxFindingsPerDetector)], input());
    expect(pass.findings).toHaveLength(ANALYZE_CAPS.maxFindingsPerDetector);
    expect(pass.overflow).toEqual({});
  });
});

describe('analyzeArtifact — the summary cap', () => {
  const withSummary = (summary: string): Analyzer =>
    function long() {
      return [finding({ summary })];
    };

  it('cuts a hook command too long for the identity index, and says how long it was', () => {
    const command = `declares a hook commands: ${'word '.repeat(1000)}`;
    const [{ summary }] = analyzeArtifact([withSummary(command)], input()).findings;
    expect(summary.length).toBeLessThan(ANALYZE_CAPS.maxSummaryChars + 40);
    expect(summary).toMatch(/word … \(5026 characters, [0-9a-f]{8}\)$/);
  });

  it('blanks a token that straddles the cut', () => {
    const token = `ghp_${'a'.repeat(40)}`;
    // No space to back off to, or the cut would remove the token by itself.
    const padding = ','.repeat(ANALYZE_CAPS.maxSummaryChars - 20);
    const [{ summary }] = analyzeArtifact([withSummary(`${padding}${token}`)], input()).findings;
    expect(summary).not.toContain('ghp_');
  });

  it('blanks a credential whose closing quote falls past the cut', () => {
    const padding = 'x '.repeat((ANALYZE_CAPS.maxSummaryChars - 30) / 2);
    const command = `${padding}PASSWORD="first-half second-half ${'y '.repeat(200)}"`;
    const [{ summary }] = analyzeArtifact([withSummary(command)], input()).findings;
    expect(summary).not.toContain('first-half');
  });

  it('keeps two long commands apart when only their tails differ, and is stable', () => {
    const shared = 'word '.repeat(200);
    const run = (summary: string) =>
      analyzeArtifact([withSummary(summary)], input()).findings[0].summary;
    expect(run(`${shared}tail-a`)).not.toBe(run(`${shared}tail-b`));
    expect(run(`${shared}tail-a`)).toBe(run(`${shared}tail-a`));
  });

  it('digests the blanked text, so no hash of a credential reaches a page', () => {
    const run = (token: string) =>
      analyzeArtifact([withSummary(`${'word '.repeat(200)}ghp_${token.repeat(40)}`)], input())
        .findings[0].summary;
    expect(run('a')).toBe(run('b'));
  });

  it('leaves a summary at the cap exactly as written', () => {
    const summary = 'x'.repeat(ANALYZE_CAPS.maxSummaryChars);
    expect(analyzeArtifact([withSummary(summary)], input()).findings[0].summary).toBe(summary);
  });
});

describe('analyzeArtifact — takes the analyzer list as a parameter', () => {
  it('runs a candidate analyzer that is not in any shipped registry', () => {
    const candidate: Analyzer = function candidate() {
      return [finding({ detectorId: 'candidate' })];
    };
    const pass = analyzeArtifact([candidate], input());
    expect(pass.findings).toHaveLength(1);
    expect(pass.findings[0].detectorId).toBe('candidate');
  });
});

describe('analyzeArtifact — end to end with the real install analyzer', () => {
  it('finds a real install directive and reports its line, with no errors', () => {
    const pass = analyzeArtifact([install], input({ body: 'intro\nrun `npx cowsay hi`\noutro' }));
    expect(pass.errors).toEqual({});
    expect(pass.findings).toHaveLength(1);
    expect(pass.findings[0].startLine).toBe(2);
  });
});
