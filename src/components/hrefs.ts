/**
 * The URL shapes every listing and detail page links through, in a module
 * that does not touch the database.
 *
 * These lived in `@/db/queries/packages`, which imports `@/db/client` at module
 * scope — a module that parses the environment as it loads. So a component that
 * needed nothing but a string builder (PackageRows, ArtifactRail,
 * FeaturedArtifact) pulled the connection into its module graph, and its pure
 * render test failed with `DATABASE_URL: expected string` on any machine
 * without one — which is CI. Same reason `typeFilters.ts` exists. Pure string
 * functions only: no predicate, no query.
 */

/**
 * A repository path as URL segments, each percent-encoded and rejoined. A
 * file named `c#-review.md` is a legal path and an `#` in a raw URL ends it:
 * unencoded, the permalink pointed at `c`.
 */
const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');

/** github.com/{full_name}/blob/{commit sha}/{path} — never the tree sha. */
export function permalink(fullName: string, commitSha: string, sourcePath: string): string {
  return `https://github.com/${fullName}/blob/${commitSha}/${encodePath(sourcePath)}`;
}

/** A directory at the commit read; '' is the repository root. */
export function treeHref(fullName: string, commitSha: string, dir: string): string {
  return `https://github.com/${fullName}/tree/${commitSha}${dir ? `/${encodePath(dir)}` : ''}`;
}

/**
 * GitHub's commit list for one path, starting at the commit read. Every commit
 * that touched the file up to that one, which AgentDock's own history is not:
 * that keeps one row per distinct content (getVersionHistory).
 */
export function historyHref(fullName: string, commitSha: string, sourcePath: string): string {
  return `https://github.com/${fullName}/commits/${commitSha}/${encodePath(sourcePath)}`;
}

/**
 * permalink() plus GitHub's line fragment. Omits the fragment when the
 * finding is a structured declaration with no line, rather than emitting
 * #Lnull. Kept beside permalink() so the two conventions — the URL shape and
 * its line-anchored extension — cannot drift apart.
 */
export function permalinkAtLine(
  fullName: string,
  commitSha: string,
  sourcePath: string,
  line: number | null,
): string {
  const base = permalink(fullName, commitSha, sourcePath);
  return line === null ? base : `${base}#L${line}`;
}

/**
 * The literal candidates for a URL's stored source_path, in resolution order.
 *
 * source_path IS the URL for every non-skill artifact today — a shape-only
 * plugin has no manifest file at all, so "append this type's manifest
 * filename" has no value to append for that case. The literal join is tried
 * first; the historical `/SKILL.md` reconstruction is tried second, purely so
 * an existing skill permalink keeps resolving. getPackageDetail's ORDER BY
 * states which one wins when a repository holds both.
 *
 * Replaces sourcePathFromUrl, which unconditionally appended `/SKILL.md` and
 * so 404'd every command, plugin, hook and mcp_server detail link.
 */
export function sourcePathCandidates(segments: string[]): string[] {
  // The route hands catch-all segments over still percent-encoded, as
  // detailHref wrote them: `c%23-review.md` 404'd against the stored
  // `c#-review.md` (measured on the ui-edge-cases fixture, 2026-10-22). A
  // malformed escape is kept as typed, and simply matches nothing.
  const joined = segments
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join('/');
  // A manifest at the repository root has no directory, so the URL carries
  // the filename itself and there is nothing to reconstruct.
  if (joined === '' || joined === 'SKILL.md') return ['SKILL.md'];
  return [joined, `${joined}/SKILL.md`];
}

/**
 * The inverse, for rendering a link. Kept beside its counterpart so the two
 * cannot drift apart.
 *
 * `skill` keeps its existing prettier directory URL — the strip-`SKILL.md`
 * behaviour is byte-identical to what shipped before this change, so no
 * published skill link breaks. Every other type's URL tail is its literal
 * source_path, unmodified: there is no per-type suffix to add or strip.
 *
 * Each path segment is percent-encoded individually and rejoined, never the
 * whole tail at once — encoding the whole string would encode the `/`
 * separators too and truncate/break every link at once on a hostile
 * character such as `#` or `?`.
 */
export function detailHref(fullName: string, sourcePath: string, type: string): string {
  return `/r/${fullName}/${encodePath(detailTail(sourcePath, type))}`;
}

/** detailHref's tail before encoding — what sourcePathCandidates(…)[0] reads back. */
export function detailTail(sourcePath: string, type: string): string {
  if (type !== 'skill') return sourcePath;
  const dir = sourcePath.replace(/(^|\/)SKILL\.md$/, '');
  return dir === '' ? 'SKILL.md' : dir;
}
