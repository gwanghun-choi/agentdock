import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FETCH_VERBS, observedNetwork } from './network';
import type { AnalyzeInput } from './types';

function input(body: string, sourcePath = 'SKILL.md'): AnalyzeInput {
  return { sourcePath, body, frontmatter: {}, meta: {}, files: [] };
}

describe('observedNetwork — purity', () => {
  it('has arity 1, so it structurally cannot reach a database', () => {
    expect(observedNetwork).toHaveLength(1);
  });
});

describe('observedNetwork — request versus reference', () => {
  it('a fetch verb on the line yields one network_request finding', () => {
    const findings = observedNetwork(input('Use WebFetch to load https://example.com/x'));
    expect(findings).toHaveLength(1);
    expect(findings[0].category).toBe('network_request');
    expect(findings[0].signal).toBe('WebFetch');
  });

  it('no fetch verb on the line yields one external_reference finding', () => {
    const findings = observedNetwork(input('Source: https://example.com/x'));
    expect(findings).toHaveLength(1);
    expect(findings[0].category).toBe('external_reference');
  });

  it('every FETCH_VERBS entry classifies as network_request', () => {
    for (const verb of FETCH_VERBS) {
      const findings = observedNetwork(input(`${verb} https://example.com/y`));
      expect(findings.every((f) => f.category === 'network_request')).toBe(true);
    }
  });
});

describe('observedNetwork — the xmlns exclusion, both directions', () => {
  it('an xmlns namespace URI yields no finding at all', () => {
    const findings = observedNetwork(
      input('Include xmlns="http://www.w3.org/2000/svg" on the root.'),
    );
    expect(findings).toEqual([]);
  });

  it('a genuine w3.org documentation link with no xmlns still yields an external_reference finding', () => {
    const findings = observedNetwork(input('See https://www.w3.org/TR/SVG2/ for the spec.'));
    expect(findings).toHaveLength(1);
    expect(findings[0].category).toBe('external_reference');
  });
});

describe('observedNetwork — a Markdown link terminator is not swallowed', () => {
  it('a closing parenthesis, bracket and backtick each stop the URL', () => {
    const line =
      'See [text](https://example.com/a) or `https://example.com/b` or [https://example.com/c].';
    const findings = observedNetwork(input(line));
    expect(findings.map((f) => f.summary)).toEqual([
      expect.stringContaining('https://example.com/a'),
      expect.stringContaining('https://example.com/b'),
      expect.stringContaining('https://example.com/c'),
    ]);
    // None of the three carries the terminator that follows it in the source line.
    for (const f of findings) {
      expect(f.summary).not.toMatch(/[)\]`]$/);
    }
  });
});

describe('observedNetwork — measured against the four frozen corpora', () => {
  const CORPORA = [
    'addyosmani-agent-skills',
    'anthropics-skills',
    'baoyu-skills',
    'wshobson-agents',
  ];

  function scan() {
    let total = 0;
    let networkRequest = 0;
    let externalReference = 0;
    for (const slug of CORPORA) {
      const dir = join('fixtures', slug, 'files');
      for (const name of readdirSync(dir)) {
        const body = readFileSync(join(dir, name), 'utf8');
        const findings = observedNetwork(input(body, decodeURIComponent(name)));
        total += findings.length;
        networkRequest += findings.filter((f) => f.category === 'network_request').length;
        externalReference += findings.filter((f) => f.category === 'external_reference').length;
      }
    }
    return { total, networkRequest, externalReference };
  }

  it('reproduces the measured counts, so a pattern change is a visible diff', () => {
    // 65 bare-URL matches across the four corpora, 1 excluded (the xmlns
    // case), 64 findings remaining: 13 classify as network_request under the
    // same-line-verb rule, 51 as external_reference. Recorded in
    // fixtures/capability-precision.md, hand-checked there.
    const result = scan();
    expect(result.total).toBe(64);
    expect(result.networkRequest).toBe(13);
    expect(result.externalReference).toBe(51);
  });
});
