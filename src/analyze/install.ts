import { scanLines } from './lines';
import type { AnalyzeInput, Finding } from './types';
import { ANALYZE_CAPS } from './types';

/** Bumped when the rule changes, so a precision row names a specific version. */
const DETECTOR_VERSION = '1';

/**
 * Fixed alternation, no nested quantifier, nothing to backtrack over — the
 * same shape as frontmatter.ts's FENCE and check-boundaries.mjs's
 * HOST_PATTERN, both already reviewed and shipped.
 *
 * Measured 78 hits across the four frozen corpora (19,909 lines), 20
 * hand-checked, 1 false positive — hit #5, "-y skips the npx install
 * confirmation", prose about the tool's own behaviour (04-RESEARCH.md §Q5).
 * The honest 5% rate is recorded, not patched around: a lookahead to exclude
 * that one hit would buy a 1.3-point improvement and cost a pattern nobody
 * can reason about.
 *
 * No fence awareness. A `pip install` inside a fenced code block is still an
 * install directive the reader is meant to run — pilot hits #16-20 are
 * exactly that shape (CI-workflow YAML) and all five are true positives.
 * Fence awareness in this phase belongs to the HTML-comment class alone.
 *
 * `g` because a real line can carry more than one directive — e.g. "prefer
 * `bun`; else `npx -y bun`; else suggest `brew install oven-sh/bun/bun`" is
 * two matches on one line, and both are real. Matching only the first would
 * undercount the measured 78 by the number of such lines.
 */
const INSTALL_PATTERN =
  /\b(npm install|npm i\b|npx|pip install|pip3 install|uvx|brew install|uv add|uv pip install|bunx)\b/g;

/** The install-directive detector — the tracer's one signal (CAP-05, install half). */
export function install(input: AnalyzeInput): Finding[] {
  const findings: Finding[] = [];
  scanLines(input.body, ({ lineNumber, text }) => {
    INSTALL_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null = INSTALL_PATTERN.exec(text);
    while (match !== null) {
      findings.push({
        detectorId: install.name,
        detectorVersion: DETECTOR_VERSION,
        category: 'package_install',
        signal: match[1],
        // Observation, never judgment.
        summary: `references an install directive: ${match[1]}`,
        sourcePath: input.sourcePath,
        startLine: lineNumber,
        endLine: lineNumber,
        evidenceText: text.trim().slice(0, ANALYZE_CAPS.maxEvidenceChars),
        metadata: {},
      });
      match = INSTALL_PATTERN.exec(text);
    }
  });
  return findings;
}
