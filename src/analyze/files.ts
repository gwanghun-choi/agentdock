import type { TreeEntry } from '@/detect/types';
import type { FileEntry } from './types';
import { ANALYZE_CAPS } from './types';

/**
 * Measured across the four frozen corpora, scoped to `skills/<name>/scripts/`
 * paths specifically (04-RESEARCH.md §Q12): 248 real bundled script files —
 * 1 addyosmani-agent-skills, 64 anthropics-skills, 177 baoyu-skills, 6
 * wshobson-agents. This predicate is broader (any of these extensions
 * anywhere under an artifact's directory, not only inside a `scripts/`
 * subdirectory), because a bundled script is not always in a directory named
 * `scripts`.
 */
export const SCRIPT_EXTENSIONS = ['.py', '.sh', '.js', '.ts', '.rb', '.ps1', '.mjs'] as const;

/**
 * A blob is under `prefix` when it sits at or below that directory — the same
 * strict-prefix containment nesting.ts's assignParentPaths uses, so
 * `skills/canvas-design` never matches a sibling `skills/canvas-design-2`.
 *
 * An empty prefix means the artifact's manifest sits at the repository root.
 * No real corpus entry does (measured: zero of 244), so this branch is
 * defence-in-depth rather than a covered case — it deliberately does NOT fall
 * back to "every blob in the tree", which is what a bare `startsWith(prefix)`
 * would do for an empty string.
 */
function underPrefix(path: string, prefix: string): boolean {
  return prefix === '' ? !path.includes('/') : path.startsWith(`${prefix}/`);
}

/** Everything up to (not including) the last path segment. '' at the repository root. */
function directoryOf(sourcePath: string): string {
  const idx = sourcePath.lastIndexOf('/');
  return idx === -1 ? '' : sourcePath.slice(0, idx);
}

/** What an artifact's inventory is taken from — the fields every Candidate carries. */
export type InventoryOwner = { type: string; sourcePath: string; containerRoot?: string };

/**
 * Which blobs belong to one artifact. Three shapes, because the artifact types
 * own their files three ways:
 *
 * - A container (a plugin — the only detector that sets containerRoot) owns
 *   everything under the root it declares, not under its manifest's directory:
 *   `.claude-plugin/plugin.json`'s directory is `.claude-plugin/`, which holds
 *   the manifest and nothing else. A root of '' is a plugin that IS the
 *   repository (addyosmani-agent-skills, obra-superpowers in fixtures/), so it
 *   owns the whole tree, still sliced to maxInventoryEntries.
 * - A skill owns its SKILL.md's directory — scripts/, references/, assets/.
 * - Every other type is one file: a command is one .md among its siblings, a
 *   hooks.json or settings.json sits in a directory it does not own, and an
 *   .mcp.json / server.json names a server that lives elsewhere. Taking their
 *   directory listed the sibling commands and a plugin root's every file, and
 *   fed those into the no_scripts filter as this artifact's own.
 */
function ownedBy(owner: InventoryOwner): (path: string) => boolean {
  const root = owner.containerRoot;
  if (root !== undefined) return root === '' ? () => true : (path) => path.startsWith(`${root}/`);
  if (owner.type === 'skill') {
    const prefix = directoryOf(owner.sourcePath);
    return (path) => underPrefix(path, prefix);
  }
  return (path) => path === owner.sourcePath;
}

/**
 * The file inventory: every blob one artifact owns (see ownedBy), from the
 * tree AgentDock already fetched — path-only, no regex, the same filter+map
 * shape as hook.ts's match() and plugin.ts's own stated idiom ("One linear
 * pass over blob paths, no regex.").
 *
 * Sliced to ANALYZE_CAPS.maxInventoryEntries — the largest skill inventory
 * measured is 83 entries; a root plugin owns its whole tree (180 and 184
 * blobs in the two fixtures that have one), so the page says when the cap
 * was reached.
 *
 * Executable is the exact string '100755' and nothing looser: a symlink's
 * mode is '120000', so an inequality or a prefix test would fold the two
 * real symlinks in the corpora into the executable count.
 */
export function fileInventory(tree: TreeEntry[], owner: InventoryOwner): FileEntry[] {
  const owns = ownedBy(owner);
  return tree
    .filter((e) => e.type === 'blob' && owns(e.path))
    .slice(0, ANALYZE_CAPS.maxInventoryEntries)
    .map((e) => ({
      path: e.path,
      size: typeof e.size === 'number' ? e.size : null,
      kind: e.mode === '120000' ? 'symlink' : 'file',
      executable: e.mode === '100755',
    }));
}

/**
 * An extension-only predicate over a path — never a content read. Following
 * hook.ts's predicate-as-named-function idiom: a tiny named boolean with a
 * comment showing what it recognises.
 */
export function isBundledScript(path: string): boolean {
  return SCRIPT_EXTENSIONS.some((ext) => path.endsWith(ext));
}
