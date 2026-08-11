import { ANALYZE_CAPS } from './types';

/** One 1-indexed line, capped to ANALYZE_CAPS.maxLineChars before a pattern runs. */
export type LineScan = { lineNumber: number; text: string };

/**
 * The project's first line-number computation. This codebase has never
 * computed one — zero hits for split('\n'), lineNumber or #L anywhere in
 * src/ or scripts/ (04-PATTERNS.md). Every rule below is load-bearing and
 * unprecedented:
 *
 * - Splits on '\n', never '\r\n', and strips a trailing '\r' from each line
 *   before it reaches onLine. A CRLF file and an LF file must report the
 *   same line number for the same content, and a pattern anchored at
 *   end-of-line must still fire on the CRLF one — fixtures/adversarial/crlf.md
 *   is the case that proves it.
 * - 1-indexed, and NO frontmatter offset. package_version.body is
 *   source.slice(0, MAX_BODY) over the unmodified raw file, fence included
 *   (src/detect/skill.ts), so body line N is file line N on GitHub. Any
 *   offset added here would break every permalink this phase emits.
 * - A leading U+FEFF byte order mark is left exactly where it is. It is
 *   zero-width and consumes no line, so numbering is unaffected —
 *   fixtures/adversarial/bom.md is the negative case that proves it.
 * - Each line is sliced to ANALYZE_CAPS.maxLineChars BEFORE onLine runs a
 *   pattern over it, following frontmatter.ts's cap-before-parse posture.
 *   A truncated line is counted in the returned total, never silently
 *   dropped.
 */
export function scanLines(body: string, onLine: (line: LineScan) => void): number {
  let skippedLines = 0;
  const rawLines = body.split('\n');
  for (let i = 0; i < rawLines.length; i += 1) {
    const raw = rawLines[i].endsWith('\r') ? rawLines[i].slice(0, -1) : rawLines[i];
    const truncated = raw.length > ANALYZE_CAPS.maxLineChars;
    if (truncated) skippedLines += 1;
    onLine({ lineNumber: i + 1, text: truncated ? raw.slice(0, ANALYZE_CAPS.maxLineChars) : raw });
  }
  return skippedLines;
}

/**
 * The inverse of scanLines: the line a finding at `n` names, uncapped and
 * CRLF-stripped. Exists so a test can assert the round trip — the line named
 * by a finding, read back out of the body, contains the text the finding
 * matched — rather than trusting the scanner to check itself.
 */
export function lineAt(body: string, n: number): string | null {
  const raw = body.split('\n')[n - 1];
  if (raw === undefined) return null;
  return raw.endsWith('\r') ? raw.slice(0, -1) : raw;
}
