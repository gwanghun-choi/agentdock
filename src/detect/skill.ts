import { parseFrontmatter } from './frontmatter';
import type { Candidate, Detector, ParseResult, TreeEntry } from './types';

/** The complete specification field set. Anything else means runtime-locked. */
export const SPEC_KEYS = [
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
/** Excerpt, not a mirror. The largest sampled file is 72 KB. */
const MAX_BODY = 32 * 1024;

function directoryOf(sourcePath: string): string {
  const parts = sourcePath.split('/');
  return parts.length > 1 ? parts[parts.length - 2] : '';
}

/** Code points, not bytes: a byte cap is wrong for a CJK description. */
function length(value: string): number {
  return [...value].length;
}

function toolTokens(value: unknown): string[] | null {
  if (typeof value === 'string') return value.split(/[\s,]+/).filter(Boolean);
  if (Array.isArray(value)) return value.map(String);
  return null;
}

export const skill: Detector = {
  type: 'skill',

  // Path-only, so a repository with no skills costs zero file reads. Covers the
  // root file, the conventional layout, and the nested plugin layout in one rule.
  match(tree: TreeEntry[]): Candidate[] {
    return tree
      .filter((e) => e.type === 'blob' && (e.path === 'SKILL.md' || e.path.endsWith('/SKILL.md')))
      .map((e) => ({ type: 'skill', sourcePath: e.path, needs: [e.path] }));
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

    const parsed = parseFrontmatter(source, c.sourcePath);
    if (!parsed.ok) return { ok: false, status: 'failed', errors: parsed.errors };

    const fm = parsed.data;
    const name = typeof fm.name === 'string' ? fm.name.trim() : '';
    const description = typeof fm.description === 'string' ? fm.description.trim() : '';

    // The only three ways to fail. All 100 sampled files clear this bar, so a
    // file that does not is anomalous rather than merely non-conforming.
    if (name.length === 0 || description.length === 0) {
      return {
        ok: false,
        status: 'failed',
        errors: ['frontmatter is missing a non-empty name or description'],
        artifact: { name: directoryOf(c.sourcePath) || 'unnamed' },
      };
    }

    // Every rule below is a warning. None of them can drop a row: rejecting on
    // them would have discarded roughly a quarter of the measured corpus,
    // including files from the reference repository.
    const warnings: string[] = [];
    const keys = Object.keys(fm);
    const extraKeys = keys.filter((k) => !SPEC_KEYS.includes(k as (typeof SPEC_KEYS)[number]));

    if (length(name) > MAX_NAME) warnings.push(`name is ${length(name)} characters, over 64`);
    if (!NAME_RULE.test(name)) {
      warnings.push('name is not lowercase alphanumeric with single hyphens');
    }
    const dir = directoryOf(c.sourcePath);
    if (dir && name !== dir) warnings.push(`name "${name}" does not match directory "${dir}"`);
    if (length(description) > MAX_DESCRIPTION) {
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
        slug: dir || name,
        summary: description,
        // The specification's own field, stored as written. The sampled corpus
        // puts free prose here ("Complete terms in LICENSE.txt"), so it is never
        // an SPDX identifier and never feeds the repository licence column.
        licenseText: typeof fm.license === 'string' ? fm.license : null,
        // Defined in neither document; observed in a quarter of the corpus. The
        // only honest source for a declared version, and never synthesized.
        declaredVersion: typeof fm.version === 'string' ? fm.version : null,
        body: source.slice(0, MAX_BODY),
        frontmatter: fm,
        meta: {
          // Computed free here so a later phase can answer "is this uploadable
          // as written" without re-reading a single file.
          frontmatterKeys: keys,
          specPure: extraKeys.length === 0,
          allowedTools: tools,
        },
      },
    };
  },
};
