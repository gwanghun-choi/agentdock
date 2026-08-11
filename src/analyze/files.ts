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

/**
 * The file inventory: every blob under one artifact's directory prefix, from
 * the tree AgentDock already fetched — path-only, no regex, the same
 * filter+map shape as hook.ts's match() and plugin.ts's own stated idiom
 * ("One linear pass over blob paths, no regex.").
 *
 * `manifestSourcePath` is the artifact's own manifest path (e.g.
 * 'skills/canvas-design/SKILL.md'); its directory is the prefix. Sliced to
 * ANALYZE_CAPS.maxInventoryEntries — the largest real inventory measured is
 * 83 entries, so this is defence-in-depth, not a control real data ever hits.
 *
 * Executable is the exact string '100755' and nothing looser: a symlink's
 * mode is '120000', so an inequality or a prefix test would fold the two
 * real symlinks in the corpora into the executable count.
 */
export function fileInventory(tree: TreeEntry[], manifestSourcePath: string): FileEntry[] {
  const prefix = directoryOf(manifestSourcePath);
  return tree
    .filter((e) => e.type === 'blob' && underPrefix(e.path, prefix))
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
