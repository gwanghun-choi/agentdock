import { scanLines } from './lines';
import type { AnalyzeInput, Finding } from './types';
import { ANALYZE_CAPS } from './types';

/** Bumped when the rule changes, so a precision row names a specific version. */
export const NETWORK_VERSION = '1';

/**
 * One character class, one quantifier, no nesting — the same shape as
 * frontmatter.ts's FENCE and check-boundaries.mjs's HOST_PATTERN, both
 * already reviewed and shipped. The terminator set is what stops a Markdown
 * link's closing bracket, a parenthesis or a backtick from being swallowed
 * into the URL, so this needs no lookahead.
 */
const URL_PATTERN = /https?:\/\/[^\s<>()[\]"'`]+/g;

/**
 * Measured against the four frozen corpora (04-02): the classification verb
 * present on the same line as a URL. WebFetch/WebSearch/Fetch — the tool
 * names this project's own instructions use; GET/POST/PUT/DELETE and
 * curl/wget/requests.get/axios — the shapes a shown command or an endpoint
 * spec uses; Navigate to/Open — the imperative shapes real corpus lines use
 * ("Navigate to http://localhost:3000/tasks", "Open ... https://claude.ai").
 * Widening this list later is a visible diff against the recorded rate.
 */
export const FETCH_VERBS = [
  'WebFetch',
  'WebSearch',
  'Fetch from',
  'GET',
  'POST',
  'PUT',
  'DELETE',
  'Navigate to',
  'Open',
  'curl',
  'wget',
  'requests.get',
  'axios',
] as const;

/**
 * Excluded by context, not by hostname allowlist: a match whose line
 * contains `xmlns` anywhere before the match position (case-insensitive) is
 * an XML namespace identifier, not a URL the artifact reaches. Measured:
 * exactly 1 of 65 bare-URL matches in the four corpora
 * (baoyu-diagram/SKILL.md:214). One bounded check that generalizes rather
 * than a W3C hostname list that would need extending every time a new
 * namespace appears.
 */
function isXmlnsNamespace(line: string, matchIndex: number): boolean {
  return /xmlns/i.test(line.slice(0, matchIndex));
}

/**
 * Outbound URL inventory, split by evidence rather than by shape (Reference
 * B). Both `network_request` and `external_reference` are one `outbound_url`
 * inventory for CAP-04's purposes; `category` carries the distinction into
 * the UI and, later, into DIS-06's filter.
 */
export function observedNetwork(input: AnalyzeInput): Finding[] {
  const findings: Finding[] = [];
  scanLines(input.body, ({ lineNumber, text }) => {
    URL_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null = URL_PATTERN.exec(text);
    while (match !== null) {
      const url = match[0];
      if (isXmlnsNamespace(text, match.index)) {
        match = URL_PATTERN.exec(text);
        continue;
      }
      const verb = FETCH_VERBS.find((v) => text.includes(v));
      findings.push({
        detectorId: observedNetwork.name,
        detectorVersion: NETWORK_VERSION,
        category: verb ? 'network_request' : 'external_reference',
        signal: verb ?? 'url',
        // Observation, never judgment.
        summary: verb
          ? `references a network request to ${url}`
          : `references an external URL: ${url}`,
        sourcePath: input.sourcePath,
        startLine: lineNumber,
        endLine: lineNumber,
        evidenceText: text.trim().slice(0, ANALYZE_CAPS.maxEvidenceChars),
        metadata: {},
      });
      match = URL_PATTERN.exec(text);
    }
  });
  return findings;
}
