import { parseJsonManifest } from './json';
import type { Candidate, Detector, ParseResult, TreeEntry } from './types';

/** Directories whose presence beneath a root is evidence of a plugin. */
export const COMPONENT_DIRS = [
  'skills',
  'commands',
  'agents',
  'workflows',
  'output-styles',
] as const;
/** Files whose presence at a root is the same evidence. */
export const COMPONENT_FILES = ['.mcp.json', '.lsp.json'] as const;
/**
 * Two, not one.
 *
 * Measured against the four frozen corpora (3,831 blob entries): a threshold of
 * one classifies `.github/workflows` as a plugin in three of the four,
 * `.claude/skills` or `.claude/commands` in two, `anthropics-skills`'s own root,
 * and `baoyu-skills`'s `packages/baoyu-fetch/src/commands` — a source
 * directory. Two produces no false positive and no false negative across all
 * four. `workflows` is in Claude Code's own component vocabulary and
 * `.github/workflows/` is close to the most common directory path on GitHub,
 * which is what decides it.
 *
 * Recorded as a false-positive rate against a labeled corpus in Phase 4 (CAP-13).
 */
export const MIN_SHAPE_COMPONENTS = 2;

const MANIFEST_FILENAME = '.claude-plugin/plugin.json';

/** The complete plugin.json field set. Claude Code ignores anything else. */
const KNOWN_KEYS = [
  'name',
  'displayName',
  'version',
  'description',
  'author',
  'homepage',
  'repository',
  'license',
  'keywords',
  'metadata',
  'skills',
  'commands',
  'agents',
  'hooks',
  'mcpServers',
  'outputStyles',
  'lspServers',
  'experimental',
  'dependencies',
] as const;

/**
 * Fields whose value overrides a default component directory with a path (or
 * list of paths). Recorded as observed in meta.declaredComponents and never
 * followed — resolving them needs a second fetch round after the first parse,
 * which is exactly what the two-phase `needs` contract exists to prevent.
 * `mcpServers` is handled separately below because it can also be an inline
 * object, not only a path.
 */
const COMPONENT_OVERRIDE_KEYS = [
  'skills',
  'commands',
  'agents',
  'hooks',
  'outputStyles',
  'lspServers',
] as const;

/**
 * Every directory that has component shapes directly beneath it, and which.
 *
 * One linear pass over blob paths, no regex. A segment matching a
 * COMPONENT_DIR makes everything before it a candidate root; a basename
 * matching a COMPONENT_FILE makes its own directory one; `<root>/hooks/hooks.json`
 * makes `<root>` one with the component `hooks` — a hook has no independent
 * directory name of its own, so it is checked as the one specific file shape
 * that means it, rather than by adding `hooks` to COMPONENT_DIRS and matching
 * every file under a `hooks/` directory.
 */
export function componentIndex(tree: TreeEntry[]): Map<string, Set<string>> {
  const idx = new Map<string, Set<string>>();
  const record = (root: string, name: string) => {
    let set = idx.get(root);
    if (!set) {
      set = new Set();
      idx.set(root, set);
    }
    set.add(name);
  };

  for (const entry of tree) {
    if (entry.type !== 'blob') continue;
    const parts = entry.path.split('/');

    for (let i = 0; i < parts.length - 1; i += 1) {
      if ((COMPONENT_DIRS as readonly string[]).includes(parts[i])) {
        record(parts.slice(0, i).join('/'), parts[i]);
      }
    }

    const basename = parts[parts.length - 1];
    if ((COMPONENT_FILES as readonly string[]).includes(basename)) {
      record(parts.slice(0, -1).join('/'), basename);
    }
    if (basename === 'hooks.json' && parts[parts.length - 2] === 'hooks') {
      record(parts.slice(0, -2).join('/'), 'hooks');
    }
  }

  return idx;
}

function dirName(root: string): string {
  if (root === '') return '';
  const parts = root.split('/');
  return parts[parts.length - 1];
}

/**
 * A dot-prefixed directory is never a shape-only plugin root — `.github`,
 * `.gemini` and `.claude` all appear in the corpora with component directories
 * beneath them and none is a plugin; `.claude/` in particular is Claude Code's
 * own project-config directory. The repository root is never one either: it has
 * no directory path to use as an identity, and a parent_path of '' on every
 * artifact in the repository says nothing repository_id did not already say.
 *
 * A declared manifest overrides both exclusions (checked separately, in
 * match()). Nothing overrides them for shape-only.
 */
function isExcludedShapeOnlyRoot(root: string): boolean {
  if (root === '') return true;
  return root.split('/').some((segment) => segment.startsWith('.'));
}

function pluginRootOf(manifestPath: string): string {
  if (manifestPath === MANIFEST_FILENAME) return '';
  return manifestPath.slice(0, manifestPath.length - MANIFEST_FILENAME.length - 1);
}

export const plugin: Detector = {
  type: 'plugin',

  // Path-only, two rules. A declared manifest is a plugin wherever it is. A
  // directory with no manifest is a plugin only on the conservative ≥2 rule,
  // and only outside the two excluded locations.
  match(tree: TreeEntry[]): Candidate[] {
    const manifestRoots = new Set<string>();
    const declared: Candidate[] = [];

    for (const entry of tree) {
      if (entry.type !== 'blob') continue;
      if (entry.path !== MANIFEST_FILENAME && !entry.path.endsWith(`/${MANIFEST_FILENAME}`)) {
        continue;
      }
      const root = pluginRootOf(entry.path);
      manifestRoots.add(root);
      declared.push({
        type: 'plugin',
        sourcePath: entry.path,
        needs: [entry.path],
        containerRoot: root,
      });
    }

    const shapeOnly: Candidate[] = [];
    for (const [root, components] of componentIndex(tree)) {
      if (components.size < MIN_SHAPE_COMPONENTS) continue;
      if (manifestRoots.has(root)) continue;
      if (isExcludedShapeOnlyRoot(root)) continue;
      shapeOnly.push({
        type: 'plugin',
        sourcePath: root,
        needs: [],
        containerRoot: root,
        shapeComponents: [...components].sort(),
      });
    }

    return [...declared, ...shapeOnly];
  },

  async parse(c: Candidate, read: (path: string) => Promise<string>): Promise<ParseResult> {
    // Shape-only: a directory, not a file. There is no manifest to read, and
    // the component set match() already recognised it by is the whole identity.
    if (c.needs.length === 0) {
      const components = c.shapeComponents ?? [];
      const name = dirName(c.sourcePath) || 'plugin';
      return {
        ok: true,
        status: 'partial',
        warnings: [`recognised by directory shape (${components.join(', ')}); no plugin.json`],
        artifact: {
          name,
          slug: name,
          summary: null,
          licenseText: null,
          declaredVersion: null,
          body: '',
          frontmatter: {},
          // A component appearing or disappearing mints a version; nothing else does.
          contentBasis: components.join(','),
          meta: {
            detectionConfidence: 'shape-only',
            components,
          },
        },
      };
    }

    const root = c.containerRoot ?? pluginRootOf(c.sourcePath);
    const fallbackName = dirName(root) || 'plugin';

    let source: string;
    try {
      source = await read(c.sourcePath);
    } catch (error) {
      return {
        ok: false,
        status: 'failed',
        errors: [`could not read: ${(error as Error).message}`],
        artifact: { name: fallbackName },
      };
    }

    const parsed = parseJsonManifest(source, c.sourcePath);
    if (!parsed.ok) {
      return {
        ok: false,
        status: 'failed',
        errors: parsed.errors,
        artifact: { name: fallbackName },
      };
    }

    const data = parsed.data;
    const name =
      typeof data.name === 'string' && data.name.trim() ? data.name.trim() : fallbackName;

    const warnings: string[] = [];
    const keys = Object.keys(data);
    const extraKeys = keys.filter((k) => !(KNOWN_KEYS as readonly string[]).includes(k));
    if (extraKeys.length > 0) {
      warnings.push(`keys outside the specification: ${extraKeys.join(', ')}`);
    }

    // Inline MCP servers: an object, not a path. Names only, never a value —
    // this is structural data an MCP declaration by another name, and the same
    // rule that governs .mcp.json (src/detect/mcp.ts) applies here.
    const mcpServers: string[] = [];
    if (
      data.mcpServers !== undefined &&
      typeof data.mcpServers === 'object' &&
      data.mcpServers !== null &&
      !Array.isArray(data.mcpServers)
    ) {
      mcpServers.push(...Object.keys(data.mcpServers as Record<string, unknown>));
    }

    // Path-valued component overrides, recorded as observed and never followed.
    const declaredComponents: Record<string, unknown> = {};
    for (const key of COMPONENT_OVERRIDE_KEYS) {
      if (data[key] !== undefined) declaredComponents[key] = data[key];
    }
    if (typeof data.mcpServers === 'string' || Array.isArray(data.mcpServers)) {
      declaredComponents.mcpServers = data.mcpServers;
    }

    // frontmatter mirrors the manifest for inspection, minus mcpServers: an
    // inline mcpServers object can carry env values, and this project never
    // stores an MCP declaration's env values anywhere — see mcp.ts.
    const { mcpServers: _mcpServersRaw, ...frontmatterSafe } = data;

    return {
      ok: true,
      status: warnings.length > 0 ? 'partial' : 'ok',
      warnings,
      artifact: {
        name,
        slug: dirName(root) || name,
        summary: typeof data.description === 'string' ? data.description : null,
        licenseText: typeof data.license === 'string' ? data.license : null,
        declaredVersion: typeof data.version === 'string' ? data.version : null,
        body: '',
        frontmatter: frontmatterSafe,
        meta: {
          detectionConfidence: 'manifest',
          mcpServers,
          declaredComponents,
        },
      },
    };
  },
};
