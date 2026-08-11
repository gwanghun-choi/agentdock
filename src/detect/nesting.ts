import type { Candidate } from './types';

/**
 * One generic containment pass. A candidate sits inside a container when a
 * DIFFERENT candidate declared a containerRoot that is a strict directory
 * prefix of its source path; the longest such root wins, so an artifact inside
 * a plugin inside a plugin links to the nearer one.
 *
 * This function names no artifact type on purpose. Reading `c.type === 'plugin'`
 * here would mean a seventh container type needs a pipeline edit, and DET-09
 * would already be false — it reads only `containerRoot` and `sourcePath`,
 * fields every candidate carries regardless of what detector produced it.
 *
 * A containerRoot of '' links nothing: a container that IS the repository adds
 * nothing that repository_id does not already say, and writing an empty string
 * onto every row would make the column noise.
 *
 * Mutates candidates in place (`parentPath`) and returns nothing, matching the
 * pipeline's own house style for a pass over an already-built list.
 */
export function assignParentPaths(candidates: Candidate[]): void {
  // Longest (nearest) first, so the first strict-prefix match wins.
  const roots = [
    ...new Set(
      candidates
        .filter((c): c is Candidate & { containerRoot: string } => Boolean(c.containerRoot))
        .map((c) => c.containerRoot),
    ),
  ].sort((a, b) => b.length - a.length);

  for (const candidate of candidates) {
    for (const root of roots) {
      // A container never parents itself, or anything sharing its own root.
      if (candidate.containerRoot === root) continue;
      if (candidate.sourcePath.startsWith(`${root}/`)) {
        candidate.parentPath = root;
        break;
      }
    }
  }
}
