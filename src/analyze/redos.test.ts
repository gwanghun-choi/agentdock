import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { declaredCapabilities } from './declared';
import { install } from './install';
import { scanLines } from './lines';
import { observedNetwork } from './network';
import { analyzeArtifact } from './run';
import { observedRemoteExecution } from './shell';
import type { AnalyzeInput, Analyzer } from './types';
import { ANALYZE_CAPS } from './types';

/**
 * CAP-14's lock: a test, not a paragraph.
 *
 * fixtures/adversarial/redos-line.md is one line, hand-built at (just under)
 * ANALYZE_CAPS.maxBodyChars: an unterminated https:// run, an install-pattern
 * near-miss run ("npm inst" repeated, never completing to a real directive),
 * a long uniform character run, and a curl-shaped near-miss that never
 * reaches "| sh". The long runs are generated once into the committed file,
 * not in this test — the committed hostile input is the regression, this
 * file is only the assertion (fixtures/adversarial/README.md's own rule).
 */
const BODY = readFileSync(join('fixtures', 'adversarial', 'redos-line.md'), 'utf8');

function input(overrides: Partial<AnalyzeInput> = {}): AnalyzeInput {
  return {
    sourcePath: 'redos-line.md',
    body: BODY,
    frontmatter: {},
    meta: {},
    files: [],
    ...overrides,
  };
}

// Every shipped analyzer. declaredCapabilities is arity-1 over frontmatter
// and meta, not the body, so it is exercised here too — the body-size guard
// and the fixture's shape are the point, not any one analyzer's pattern.
const SHIPPED: Analyzer[] = [
  install,
  declaredCapabilities,
  observedNetwork,
  observedRemoteExecution,
];

/**
 * A bounded per-line scan over one line at the body cap finishes in
 * single-digit milliseconds. This bound is set generously — a smoke alarm
 * for a super-linear regression, not a performance budget — because a tight
 * bound turns a correctness gate into a flake on a loaded CI runner.
 */
const WALL_CLOCK_BOUND_MS = 500;

describe('CAP-14 — the ReDoS lock', () => {
  it('every shipped analyzer completes over the fixture inside the wall-clock bound', () => {
    const pass = analyzeArtifact(SHIPPED, input());
    expect(pass.errors).toEqual({});
    expect(pass.durationMs).toBeLessThan(WALL_CLOCK_BOUND_MS);
  });

  it('the per-line cap fires: scanning the fixture reports a non-zero skipped-line count', () => {
    const skipped = scanLines(BODY, () => {});
    // The fixture is one line at ~31,000 chars, ANALYZE_CAPS.maxLineChars is
    // 2,000 — the single line must be truncated and counted, not silently
    // dropped.
    expect(skipped).toBeGreaterThan(0);
  });

  it('no analyzer returns more findings than maxFindingsPerDetector for the fixture', () => {
    for (const analyzer of SHIPPED) {
      const findings = analyzer(input());
      expect(findings.length).toBeLessThanOrEqual(ANALYZE_CAPS.maxFindingsPerDetector);
    }
  });

  it('each shipped analyzer individually completes well inside the bound', () => {
    for (const analyzer of SHIPPED) {
      const start = performance.now();
      analyzer(input());
      expect(performance.now() - start).toBeLessThan(WALL_CLOCK_BOUND_MS);
    }
  });
});
