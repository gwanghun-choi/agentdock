import { GitHubError, githubFetch, readCapped } from './client';
import type { RepoTree, TreeEntry } from './types';

// GitHub's own documented ceiling for a recursive tree is 7 MB.
const MAX_TREE_BYTES = 8 * 1024 * 1024;
const SHA40 = /^[0-9a-f]{40}$/;

/**
 * One recursive call, using HEAD so it does not have to wait for the metadata
 * call to learn the default branch.
 *
 * The `sha` in the response is the COMMIT sha when a ref name is passed —
 * verified on two repositories — which is the value every permalink needs. The
 * adjacent `commit.tree.sha` is a valid-looking 40-hex string that returns 404
 * from every blob URL, and the raw host accepts both, so the assertion below is
 * the only cheap guard against silently picking the wrong one.
 *
 * ponytail: no subtree-walk fallback for a truncated tree. The documented
 * ceiling is around 25,000 entries and the largest real skills repository
 * sampled holds 1,992, so truncation is surfaced rather than worked around.
 * Build the walk when a repository AgentDock actually wants to index reports
 * truncated: true.
 */
export async function fetchRepoTree(owner: string, repo: string): Promise<RepoTree> {
  const url =
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}` +
    '/git/trees/HEAD?recursive=1';
  const { response } = await githubFetch(url, {
    headers: { accept: 'application/vnd.github+json' },
  });

  if (response.status === 404) {
    throw new GitHubError('unreadable', `AgentDock could not read ${owner}/${repo}.`);
  }
  if (!response.ok) throw new GitHubError('unavailable', `GitHub returned ${response.status}.`);

  const json = JSON.parse(await readCapped(response, MAX_TREE_BYTES));
  const commitSha = String(json.sha ?? '');
  if (!SHA40.test(commitSha)) {
    throw new GitHubError('unavailable', 'GitHub returned a tree without a usable commit SHA.');
  }

  const entries: TreeEntry[] = (Array.isArray(json.tree) ? json.tree : []).map(
    (e: Record<string, unknown>) => ({
      path: String(e.path),
      type: e.type as TreeEntry['type'],
      sha: String(e.sha),
      size: typeof e.size === 'number' ? e.size : undefined,
    }),
  );

  return { commitSha, entries, truncated: json.truncated === true };
}
