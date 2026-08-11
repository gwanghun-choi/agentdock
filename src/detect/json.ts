export const JSON_CAPS = {
  /**
   * The largest documented marketplace shape is a few hundred entries; 256 KB
   * holds roughly fifteen hundred typical ones. Applied before JSON.parse, so a
   * hostile file is never parsed at all.
   */
  inputBytes: 256 * 1024,
  /**
   * The real control for JSON, and the one the frontmatter parser does not need.
   * JSON has no alias mechanism, so there is no billion-laughs amplification to
   * defend against and the post-parse serialization cap buys nothing. What it
   * does have is a hundred-thousand-entry plugins[] array that costs a hundred
   * thousand rows downstream. Applies to any array at any depth, not to a named
   * field — server.json's packages[] needs the same protection this buys
   * marketplace.json's plugins[], and a seventh format will need it again.
   */
  maxArrayLength: 1000,
  /**
   * Bounds this module's own validation walk, not JSON.parse. A recursive walk
   * over attacker-shaped nesting is the stack overflow the input cap does not
   * stop, because deep nesting is cheap in bytes. The walk itself checks depth
   * before it recurses, so this also bounds the walk's own stack usage.
   */
  maxDepth: 32,
} as const;

export type JsonResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; errors: string[] };

/**
 * Bounds the shape of an already-parsed value: array length at any depth, and
 * nesting depth itself. Checked before recursing into children, so the walk's
 * own stack usage is bounded by JSON_CAPS.maxDepth regardless of input shape.
 */
function walk(value: unknown, depth: number): string | null {
  if (depth > JSON_CAPS.maxDepth) {
    return `manifest is nested deeper than the depth cap of ${JSON_CAPS.maxDepth}`;
  }
  if (Array.isArray(value)) {
    if (value.length > JSON_CAPS.maxArrayLength) {
      return (
        `manifest contains an array of ${value.length} entries, ` +
        `over the array-length cap of ${JSON_CAPS.maxArrayLength}`
      );
    }
    for (const item of value) {
      const error = walk(item, depth + 1);
      if (error) return error;
    }
    return null;
  }
  if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value)) {
      const error = walk(v, depth + 1);
      if (error) return error;
    }
    return null;
  }
  return null;
}

/**
 * Parses an untrusted JSON manifest from a scanned repository.
 *
 * JSON.parse has no code-execution path and no tag mechanism, which is why it
 * needs no schema argument the way js-yaml does (DET-08). Everything below is
 * about volume, not about execution.
 */
export function parseJsonManifest(source: string, sourcePath: string): JsonResult {
  const size = Buffer.byteLength(source, 'utf8');
  if (size > JSON_CAPS.inputBytes) {
    return {
      ok: false,
      errors: [`${sourcePath} is ${size} bytes, over the input cap of ${JSON_CAPS.inputBytes}`],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    return { ok: false, errors: [`${sourcePath} is not valid JSON: ${(error as Error).message}`] };
  }

  // Same posture as parseFrontmatter's "frontmatter is not a mapping": a
  // top-level array or scalar carries no named fields for a detector to read.
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, errors: [`${sourcePath}: manifest is not a JSON object`] };
  }

  const error = walk(parsed, 0);
  if (error) return { ok: false, errors: [`${sourcePath}: ${error}`] };

  return { ok: true, data: parsed as Record<string, unknown> };
}
