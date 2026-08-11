import { scanLines } from './lines';
import { isInCode, markupRegions } from './markup';
import type { AnalyzeInput, Finding } from './types';
import { ANALYZE_CAPS } from './types';

/** Bumped when a rule changes, so a precision row names a specific version. */
export const HIDDEN_VERSION = '1';

/**
 * The codepoint classes CAP-06 survived measurement with (04-CONTEXT.md
 * Measurement 5 / 7): zero-width joiners and the non-leading byte order
 * mark, bidi direction-override and isolate controls, the Unicode Tag block,
 * and the soft hyphen. Character-class checks and a codepoint range
 * comparison — arithmetic, not parsing, per 04-RESEARCH.md's Don't-Hand-Roll
 * table: a Unicode security library buys nothing over eight range
 * comparisons and costs supply-chain surface for a solved, bounded problem.
 *
 * Deliberately fence-blind (04-CONTEXT.md decision 4): a zero-width
 * character inside a fenced code block is still invisible to a reader, so
 * these classes never consult markup.ts. Fence-awareness in this file
 * belongs to the HTML-comment rule alone.
 */
export type HiddenClass = {
  id: 'zero_width' | 'bidi_control' | 'unicode_tag' | 'soft_hyphen';
  /** The words summary() below fills in: "contains a Unicode ${phrase} (U+XXXX)". */
  phrase: string;
  test: (codePoint: number) => boolean;
};

export const HIDDEN_CLASSES: HiddenClass[] = [
  {
    id: 'zero_width',
    phrase: 'zero-width character',
    // U+200B ZWSP, U+200C ZWNJ, U+200D ZWJ, and U+FEFF (the non-leading
    // case only — offset 0 of the body is handled separately below, because
    // there it is a byte order mark, not concealment).
    test: (cp) => cp === 0x200b || cp === 0x200c || cp === 0x200d || cp === 0xfeff,
  },
  {
    id: 'bidi_control',
    phrase: 'bidirectional control character',
    // U+202A-U+202E: the embedding/override block. U+2066-U+2069: the
    // isolate block. Both ranges reorder or hide the text that follows them.
    test: (cp) => (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069),
  },
  {
    id: 'unicode_tag',
    phrase: 'tag character',
    // The whole Unicode Tag block. Mirrors ASCII 0x00-0x7F at a plane-14
    // offset, invisible in every renderer that does not specifically shape
    // it — used to smuggle text a human cannot see inside text a human can.
    test: (cp) => cp >= 0xe0000 && cp <= 0xe007f,
  },
  {
    id: 'soft_hyphen',
    phrase: 'soft hyphen',
    test: (cp) => cp === 0x00ad,
  },
];

function classify(codePoint: number): HiddenClass | undefined {
  return HIDDEN_CLASSES.find((c) => c.test(codePoint));
}

function hex(codePoint: number): string {
  return codePoint.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Per-codepoint Unicode names, for the classes narrow enough to name exactly.
 * The Unicode Tag block (04-CONTEXT.md's Reference B sentinel example,
 * `[U+E0041 UNICODE TAG]`) is 128 codepoints and gets one shared name rather
 * than a 128-entry table.
 */
// Numeric object keys are normalized to decimal by JS itself (and by biome's
// formatter, which is why these are not written as 0x200b etc.) — the hex
// form each name corresponds to is named in its own comment instead.
const CODEPOINT_NAMES: Record<number, string> = {
  8203: 'ZERO WIDTH SPACE', // U+200B
  8204: 'ZERO WIDTH NON-JOINER', // U+200C
  8205: 'ZERO WIDTH JOINER', // U+200D
  65279: 'ZERO WIDTH NO-BREAK SPACE', // U+FEFF
  173: 'SOFT HYPHEN', // U+00AD
  8234: 'LEFT-TO-RIGHT EMBEDDING', // U+202A
  8235: 'RIGHT-TO-LEFT EMBEDDING', // U+202B
  8236: 'POP DIRECTIONAL FORMATTING', // U+202C
  8237: 'LEFT-TO-RIGHT OVERRIDE', // U+202D
  8238: 'RIGHT-TO-LEFT OVERRIDE', // U+202E
  8294: 'LEFT-TO-RIGHT ISOLATE', // U+2066
  8295: 'RIGHT-TO-LEFT ISOLATE', // U+2067
  8296: 'FIRST STRONG ISOLATE', // U+2068
  8297: 'POP DIRECTIONAL ISOLATE', // U+2069
};

function codepointName(codePoint: number): string {
  if (codePoint >= 0xe0000 && codePoint <= 0xe007f) return 'UNICODE TAG';
  return CODEPOINT_NAMES[codePoint] ?? 'HIDDEN CHARACTER';
}

/** `[U+202E RIGHT-TO-LEFT OVERRIDE]` — the visible stand-in for one hidden codepoint. */
function sentinelFor(codePoint: number): string {
  return `[U+${hex(codePoint)} ${codepointName(codePoint)}]`;
}

/**
 * Replaces every hidden codepoint in `text` with its sentinel, leaving
 * everything else untouched.
 *
 * Substitution happens here, in the analyzer, rather than at render — a
 * finding whose evidence still held the raw invisible character would make
 * the panel's own output invisible, and every future render sink (a future
 * API, a future export, a log line someone adds) would have to remember to
 * substitute independently. Making this a pure function here means the
 * panel can be a dumb text renderer and the substitution has exactly one
 * implementation and one unit test.
 *
 * Iterates by codepoint (`for...of` over a string, which is surrogate-pair
 * aware), not by UTF-16 code unit — the Unicode Tag block sits outside the
 * Basic Multilingual Plane and a code-unit walk would split its surrogate
 * pairs and sentinelize half of one.
 */
export function sentinelize(text: string): string {
  let out = '';
  for (const ch of text) {
    const codePoint = ch.codePointAt(0);
    if (codePoint === undefined) {
      out += ch;
      continue;
    }
    const cls = classify(codePoint);
    out += cls ? sentinelFor(codePoint) : ch;
  }
  return out;
}

// Non-greedy with a required fixed terminator — the reviewed shape
// frontmatter.ts:19's FENCE already ships, so the safety argument is cited
// rather than re-derived. Run once over the whole (already capped) body
// rather than per line: the pattern has no nested quantifier and nothing to
// backtrack over, so its cost is linear in body length regardless of how
// many '\n' characters sit inside a match — the same reasoning
// frontmatter.ts's own FENCE relies on when it scans up to 64 KB in one
// piece rather than one line at a time. This is also the one difference
// from every other analyzer in src/analyze/, which all use scanLines: an
// HTML comment can legitimately span more than one line (the real corpus
// has exactly one such case — see hidden.test.ts — and it happens to sit
// inside a fence, which the isInCode check below still catches correctly by
// its own start line).
const HTML_COMMENT_PATTERN = /<!--([\s\S]*?)-->/g;

/** The offset (into `body`) where each line starts, for mapping a regex match's index back to a line number. */
function computeLineStarts(body: string): number[] {
  const starts = [0];
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

/** Binary search: the 1-indexed line whose start offset is the largest one at or before `offset`. */
function lineNumberAt(lineStarts: number[], offset: number): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  let line = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lineStarts[mid] <= offset) {
      line = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return line + 1;
}

/**
 * Hidden content: the codepoint classes above, plus a fence-and-code-span
 * aware HTML-comment rule (04-CONTEXT.md Reference B / Measurement 4).
 *
 * The comment class replaces, and never resurrects, the naive
 * `<!--[\s\S]*?-->` pattern 04-RESEARCH.md §Q7 proposed and this phase's own
 * planning measured at 26/26 = 100% false positives against the real
 * SkillBody render — 25 of the 26 sat inside a fenced code block, the 26th
 * inside an inline code span. What ships here is a different claim: an HTML
 * comment the renderer will NOT show as literal text, which is exactly the
 * `isInCode` check below.
 */
export function observedHiddenContent(input: AnalyzeInput): Finding[] {
  const findings: Finding[] = [];

  // The codepoint classes: fence-blind, per line, via scanLines so every
  // other cap (maxLineChars, the truncation-is-counted-not-dropped rule)
  // applies here exactly the way it applies to every other analyzer.
  scanLines(input.body, ({ lineNumber, text }) => {
    let column = 0;
    for (const ch of text) {
      const codePoint = ch.codePointAt(0);
      if (codePoint !== undefined) {
        const cls = classify(codePoint);
        if (cls) {
          // At offset 0 of the whole body, U+FEFF is a byte order mark, not
          // concealment — frontmatter.ts strips it into a local variable
          // only (splitFrontmatter's own `charCodeAt(0) === 0xfeff` check),
          // so it survives into the stored body as line 1's first
          // character. Exempted by POSITION, not by codepoint: the same
          // character anywhere else is still reported.
          const isLeadingBom = codePoint === 0xfeff && lineNumber === 1 && column === 0;
          if (!isLeadingBom) {
            findings.push({
              detectorId: observedHiddenContent.name,
              detectorVersion: HIDDEN_VERSION,
              category: 'hidden_content',
              signal: `U+${hex(codePoint)}`,
              // Observation, never judgment. Names the construct and the
              // codepoint; never "malicious", "suspicious" or "attack" — an
              // author can leave one of these in a file by accident, and
              // this panel's job is to let the reader decide, not decide
              // for them.
              summary: `contains a Unicode ${cls.phrase} (U+${hex(codePoint)})`,
              sourcePath: input.sourcePath,
              startLine: lineNumber,
              endLine: lineNumber,
              column,
              evidenceText: sentinelize(text).slice(0, ANALYZE_CAPS.maxEvidenceChars),
              metadata: {},
            });
          }
        }
      }
      column += ch.length;
    }
  });

  // The HTML-comment rule: markupRegions computed once for the whole body
  // (bounded, linear — see markup.ts), then consulted once per match.
  const regions = markupRegions(input.body);
  const lineStarts = computeLineStarts(input.body);

  HTML_COMMENT_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null = HTML_COMMENT_PATTERN.exec(input.body);
  while (match !== null) {
    const startLine = lineNumberAt(lineStarts, match.index);
    const endLine = lineNumberAt(lineStarts, match.index + match[0].length - 1);
    const column = match.index - lineStarts[startLine - 1];

    if (!isInCode(regions, startLine, column)) {
      findings.push({
        detectorId: observedHiddenContent.name,
        detectorVersion: HIDDEN_VERSION,
        category: 'hidden_content',
        signal: 'html_comment',
        summary: 'contains an HTML comment the page does not display',
        sourcePath: input.sourcePath,
        startLine,
        endLine,
        column,
        evidenceText: sentinelize(match[1].trim()).slice(0, ANALYZE_CAPS.maxEvidenceChars),
        metadata: {},
      });
    }

    match = HTML_COMMENT_PATTERN.exec(input.body);
  }

  return findings;
}
