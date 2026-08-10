import yaml from 'js-yaml';

export const FRONTMATTER_CAPS = {
  /** Largest frontmatter block in the 100-file sample is about 1.2 KB. */
  inputBytes: 64 * 1024,
  /**
   * The alias-bomb defence, and the one that is easy to leave out.
   *
   * Aliases are stored as shared references, so an 800-byte document parses in
   * about two milliseconds — an input cap never fires. The expansion happens when
   * something walks the graph, and the very next thing this pipeline does is
   * serialize the result into a jsonb column. Measured: 800 bytes in, 205 MB out.
   */
  serializedBytes: 256 * 1024,
} as const;

// Anchored at position zero and non-greedy, so a horizontal rule in the body
// cannot end the block early. Only the FIRST closing fence counts.
const FENCE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

export function splitFrontmatter(source: string): { frontmatter: string; body: string } | null {
  // A byte order mark before the opening fence stops the anchor matching.
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const m = FENCE.exec(text);
  if (!m) return null;
  return { frontmatter: m[1], body: text.slice(m[0].length) };
}

export type FrontmatterResult =
  | { ok: true; data: Record<string, unknown>; body: string }
  | { ok: false; errors: string[] };

/**
 * Parses the frontmatter block of an untrusted file.
 *
 * The loader runs under the core schema rather than the default one. That is not
 * about code execution — neither schema can construct a function, and the tag
 * that could lives in a separate package that is not installed. It is because the
 * core schema returns plain JSON-serializable values: the default schema turns a
 * timestamp into a Date and a binary tag into a buffer, neither of which
 * round-trips through a jsonb column the way the caller expects. It also excludes
 * the merge key, which removes an alias-amplification vector for nothing.
 */
export function parseFrontmatter(source: string, sourcePath: string): FrontmatterResult {
  const split = splitFrontmatter(source);
  if (!split) return { ok: false, errors: ['no frontmatter fence at the start of the file'] };

  const size = Buffer.byteLength(split.frontmatter, 'utf8');
  if (size > FRONTMATTER_CAPS.inputBytes) {
    return { ok: false, errors: [`frontmatter is ${size} bytes, over the input cap`] };
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(split.frontmatter, {
      schema: yaml.CORE_SCHEMA,
      // Duplicate keys throw. Two values for one key means the file has no single
      // meaning, and silently choosing one is worse than reporting it.
      json: false,
      // Appears in the exception message. A repository path, never a secret.
      filename: sourcePath,
    });
  } catch (error) {
    return { ok: false, errors: [`frontmatter is not valid YAML: ${(error as Error).message}`] };
  }

  if (parsed === null || parsed === undefined) return { ok: true, data: {}, body: split.body };
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, errors: ['frontmatter is not a mapping'] };
  }

  // The input cap above does NOT protect this. Both caps are required.
  let serialized: string;
  try {
    serialized = JSON.stringify(parsed);
  } catch {
    return { ok: false, errors: ['frontmatter expands beyond the serialized size cap'] };
  }
  if (Buffer.byteLength(serialized, 'utf8') > FRONTMATTER_CAPS.serializedBytes) {
    return { ok: false, errors: ['frontmatter expands beyond the serialized size cap'] };
  }

  return { ok: true, data: parsed as Record<string, unknown>, body: split.body };
}
