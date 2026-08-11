import { parseFrontmatter } from './frontmatter';
import type { Candidate, Detector, ParseResult, TreeEntry } from './types';

/**
 * The complete specification field set, mirroring skill.ts's SPEC_KEYS
 * verbatim: code.claude.com/docs/en/skills documents commands as sharing the
 * exact same frontmatter schema as skills. Duplicated rather than imported —
 * skill.ts is untouched this phase, in every plan, and does not export this
 * under a name meant for reuse outside itself.
 */
const SPEC_KEYS = [
  'name',
  'description',
  'license',
  'compatibility',
  'metadata',
  'allowed-tools',
] as const;

const NAME_RULE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_NAME = 64;
const MAX_DESCRIPTION = 1024;
const MAX_COMPATIBILITY = 500;
/** The largest sampled command file is well under this; same excerpt rule as skills. */
const MAX_BODY = 32 * 1024;

/** Code points, not bytes: a byte cap is wrong for a CJK description. */
function length(value: string): number {
  return [...value].length;
}

function toolTokens(value: unknown): string[] | null {
  if (typeof value === 'string') return value.split(/[\s,]+/).filter(Boolean);
  if (Array.isArray(value)) return value.map(String);
  return null;
}

export const command: Detector = {
  type: 'command',

  // Path segments, not a regex — no nested quantifiers, nothing to backtrack.
  // Covers .claude/commands/x.md, a plugin's commands/x.md, and a nested
  // commands/sub/x.md in one rule. A README inside a commands directory is not
  // a command; without that exclusion every such README becomes a failed row
  // for a file that was never an artifact.
  match(tree: TreeEntry[]): Candidate[] {
    return tree
      .filter((e) => {
        if (e.type !== 'blob' || !e.path.endsWith('.md')) return false;
        const segments = e.path.split('/');
        if (segments[segments.length - 1].toUpperCase() === 'README.MD') return false;
        return segments.slice(0, -1).includes('commands');
      })
      .map((e) => ({ type: 'command', sourcePath: e.path, needs: [e.path] }));
  },

  async parse(c: Candidate, read: (path: string) => Promise<string>): Promise<ParseResult> {
    let source: string;
    try {
      source = await read(c.sourcePath);
    } catch (error) {
      return {
        ok: false,
        status: 'failed',
        errors: [`could not read: ${(error as Error).message}`],
      };
    }

    // Same parseFrontmatter call skill.ts makes, unmodified — this is the
    // concrete proof that the seventh flat-frontmatter format costs a match()
    // and a naming rule, nothing in the parser itself.
    const parsed = parseFrontmatter(source, c.sourcePath);
    if (!parsed.ok) return { ok: false, status: 'failed', errors: parsed.errors };

    const fm = parsed.data;
    // The naming rule, verbatim from code.claude.com/docs/en/skills: "File
    // under .claude/commands/ -> File name without extension -> .claude/
    // commands/deploy.md -> /deploy". skill.ts derives its name from the
    // parent directory; this is the whole structural difference between the
    // two formats. A command has no directory to mismatch, so that warning is
    // gone, and the filename is authoritative, so unlike a skill a missing
    // name or description can never fail this detector — only an unparsable
    // frontmatter block can, and that is handled above, through the shared
    // parser's own three ways to fail.
    const segments = c.sourcePath.split('/');
    const name = segments[segments.length - 1].replace(/\.md$/, '');
    const declaredName = typeof fm.name === 'string' ? fm.name.trim() : '';
    const description = typeof fm.description === 'string' ? fm.description.trim() : '';

    const warnings: string[] = [];
    const keys = Object.keys(fm);
    const extraKeys = keys.filter((k) => !SPEC_KEYS.includes(k as (typeof SPEC_KEYS)[number]));

    if (length(name) > MAX_NAME) warnings.push(`name is ${length(name)} characters, over 64`);
    if (!NAME_RULE.test(name)) {
      warnings.push('name is not lowercase alphanumeric with single hyphens');
    }
    if (declaredName && declaredName !== name) {
      warnings.push(`frontmatter name "${declaredName}" does not match filename "${name}"`);
    }
    if (description.length === 0) {
      warnings.push('description is missing or empty');
    } else if (length(description) > MAX_DESCRIPTION) {
      warnings.push(`description is ${length(description)} characters, over 1024`);
    }
    if (typeof fm.compatibility === 'string' && length(fm.compatibility) > MAX_COMPATIBILITY) {
      warnings.push('compatibility is over 500 characters');
    }
    if (fm.metadata !== undefined && typeof fm.metadata !== 'object') {
      warnings.push('metadata is not a mapping');
    }
    if (extraKeys.length > 0) {
      warnings.push(`keys outside the specification: ${extraKeys.join(', ')}`);
    }

    const tools = toolTokens(fm['allowed-tools']);
    if (fm['allowed-tools'] !== undefined && tools === null) {
      warnings.push('allowed-tools is neither a string nor a list');
    }

    return {
      ok: true,
      status: warnings.length > 0 ? 'partial' : 'ok',
      warnings,
      artifact: {
        name,
        slug: name,
        summary: description.length > 0 ? description : null,
        licenseText: typeof fm.license === 'string' ? fm.license : null,
        declaredVersion: typeof fm.version === 'string' ? fm.version : null,
        body: source.slice(0, MAX_BODY),
        frontmatter: fm,
        meta: {
          frontmatterKeys: keys,
          specPure: extraKeys.length === 0,
          allowedTools: tools,
        },
      },
    };
  },
};
