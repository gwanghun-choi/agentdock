/**
 * A bounded line-based tracker for the two Markdown constructs that make text
 * visible: the fenced code block and the inline code span.
 *
 * remark-parse would classify `html` versus `code` and `inlineCode` nodes
 * exactly, and is rejected twice over: it is a new declared runtime
 * dependency (already installed transitively through react-markdown, but not
 * declared, and declaring it for this one call site is the wrong trade), and
 * it is an unbounded AST parse over untrusted bytes inside the ingest path —
 * exactly the surface CAP-14 exists to bound. A line tracker is bounded by
 * the same maxLineChars every other analyzer already answers to, and one
 * linear pass over the body is the whole cost.
 *
 * The tracker is therefore an approximation of CommonMark, not a parser, and
 * its errors go one way on purpose: a construct it misreads as code produces
 * NO finding rather than a false one. That bias is deliberately chosen here
 * because the naive version of the HTML-comment rule this tracker exists to
 * correct measured 26 false positives out of 26 against the real render
 * (04-CONTEXT.md Measurement 4), and because the codepoint classes that catch
 * actual concealment (hidden.ts) never consult this module at all — under-
 * reporting here costs nothing on the class that matters most.
 *
 * Known ceilings, stated rather than discovered:
 *  - A fence opened with a longer backtick/tilde run than its closer is
 *    matched by the same three-character prefix, so a closing run shorter
 *    than the opener still closes it. This under-reports the CommonMark rule
 *    (which requires the closer to be at least as long) in the rare case a
 *    document intentionally relies on run-length matching to keep a fence
 *    open across a shorter run — treated as closed, so text after it is
 *    scanned as prose rather than code, the safe direction to be wrong in.
 *  - A code span containing an escaped backtick is not CommonMark-exact:
 *    this tracker treats every backtick character as a run boundary and does
 *    not honour a backslash escape, so an odd stray backtick can close a span
 *    early. The bias still under-reports rather than over-reports: closing a
 *    span early only ever moves LESS text into "is code", never more.
 */

/** One line's markup classification: inside a fence, or which offset ranges sit inside an inline code span. */
export type MarkupState = {
  /** True for every line of a fenced block, including both delimiter lines themselves. */
  inFence: boolean;
  /** Half-open [start, end) offset ranges, in this line's own characters, that sit inside a backtick-delimited code span. Empty whenever inFence is true — a fence already answers the whole line. */
  codeSpans: Array<[number, number]>;
};

// Anchored at position zero, 0-3 leading spaces tolerated (CommonMark's own
// allowance), then three or more backticks or tildes. No nested quantifier,
// nothing to backtrack over — the same shape as frontmatter.ts's FENCE.
const FENCE_LINE = /^ {0,3}(?:`{3,}|~{3,})/;

/**
 * One linear pass over the line's characters, tracking whether the current
 * offset sits between an odd and an even backtick run — no regex, no
 * lookahead, the same "one linear pass, no regex" posture plugin.ts:75
 * states for paths, applied here to characters instead of path segments.
 *
 * A run of backticks (one or more consecutive `` ` `` characters) toggles
 * between opening and closing a span; an unterminated trailing run (an odd
 * number of runs on the line) closes nothing and is not treated as code —
 * the under-reporting bias again.
 */
function codeSpansInLine(line: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let i = 0;
  let openStart: number | null = null;
  while (i < line.length) {
    if (line[i] !== '`') {
      i += 1;
      continue;
    }
    const runStart = i;
    while (i < line.length && line[i] === '`') i += 1;
    if (openStart === null) {
      openStart = runStart;
    } else {
      spans.push([openStart, i]);
      openStart = null;
    }
  }
  return spans;
}

/**
 * The whole tracker: one line-by-line pass over `body`, returning one
 * MarkupState per line (index 0 is line 1, matching lines.ts's own
 * 1-indexed convention less the offset — callers index with `line - 1`).
 *
 * Splits on '\n' only and strips a trailing '\r', the same rule lines.ts
 * uses, so a fence or code span computed here lines up with the line numbers
 * every finding in this phase is reported against.
 */
export function markupRegions(body: string): MarkupState[] {
  const regions: MarkupState[] = [];
  let inFence = false;
  const rawLines = body.split('\n');
  for (const raw of rawLines) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (FENCE_LINE.test(line)) {
      // The delimiter line itself counts as inside, whether it is opening or
      // closing the block — its own text is fence syntax, not prose or code
      // content, and the renderer never shows it as literal text either way.
      inFence = !inFence;
      regions.push({ inFence: true, codeSpans: [] });
      continue;
    }
    regions.push(
      inFence
        ? { inFence: true, codeSpans: [] }
        : { inFence: false, codeSpans: codeSpansInLine(line) },
    );
  }
  return regions;
}

/**
 * Whether the renderer will show this line-and-offset as literal text: true
 * when the line sits inside a fenced block, or when the offset falls inside
 * an inline code span computed for that line.
 *
 * `regions` is the whole body's precomputed MarkupState[] from
 * markupRegions — computed once per body, not once per offset, so a caller
 * checking many offsets (hidden.ts's comment rule, once per match) pays the
 * O(body length) cost once rather than per match.
 */
export function isInCode(regions: MarkupState[], lineNumber: number, offset: number): boolean {
  const region = regions[lineNumber - 1];
  if (!region) return false;
  if (region.inFence) return true;
  return region.codeSpans.some(([start, end]) => offset >= start && offset < end);
}
