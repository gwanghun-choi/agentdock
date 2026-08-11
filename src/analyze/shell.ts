import { scanLines } from './lines';
import type { AnalyzeInput, Finding } from './types';
import { ANALYZE_CAPS } from './types';

/** Bumped when the rule changes, so a precision row names a specific version. */
export const SHELL_VERSION = '1';

/**
 * The narrow literal shape, and only it (Reference C): a download whose
 * output is piped or chained into an interpreter. The presence of the words
 * bash/shell/exec/command is deliberately NOT a finding — the maintainer's
 * own rule settles the scope, and the negative case below asserts it.
 *
 * Each pattern is bounded on both sides by a negated character class with a
 * single quantifier and a required fixed terminator — no nested quantifier,
 * no `.*` adjacent to another quantifier, nothing to backtrack over. The
 * negated class (`[^\n|]` / `[^\n&]`) also keeps the match from crossing a
 * second pipe/chain on the same line into an unrelated command.
 */
const REMOTE_EXECUTION_PATTERNS: { signal: string; pattern: RegExp }[] = [
  { signal: 'curl | sh', pattern: /\bcurl\b[^\n|]*\|\s*(?:sudo\s+)?(?:sh|bash)\b/g },
  { signal: 'wget && sh', pattern: /\bwget\b[^\n&]*&&\s*(?:sh|bash)\b/g },
  { signal: 'iwr | iex', pattern: /\b(?:iwr|Invoke-WebRequest)\b[^\n|]*\|\s*iex\b/gi },
];

/**
 * The remote-execution shape only — never the mere presence of a shell word
 * (Reference C). Zero hits across all 84 real bodies, matching
 * 04-RESEARCH.md's own prediction: rare-but-clean here, not validated here.
 * The precision row records "0 hits on real data; precision untested, not
 * proven clean" — an honest state, not a claim this detector cannot make.
 */
export function observedRemoteExecution(input: AnalyzeInput): Finding[] {
  const findings: Finding[] = [];
  scanLines(input.body, ({ lineNumber, text }) => {
    for (const { signal, pattern } of REMOTE_EXECUTION_PATTERNS) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null = pattern.exec(text);
      while (match !== null) {
        findings.push({
          detectorId: observedRemoteExecution.name,
          detectorVersion: SHELL_VERSION,
          category: 'remote_execution',
          signal,
          summary: `invokes a remote-execution directive: ${signal}`,
          sourcePath: input.sourcePath,
          startLine: lineNumber,
          endLine: lineNumber,
          evidenceText: text.trim().slice(0, ANALYZE_CAPS.maxEvidenceChars),
          metadata: {},
        });
        match = pattern.exec(text);
      }
    }
  });
  return findings;
}
