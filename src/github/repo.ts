import { GitHubError, githubFetch, readCapped } from './client';
import type { RepoMetadata } from './types';

const MAX_METADATA_BYTES = 1024 * 1024;

export async function fetchRepoMetadata(owner: string, repo: string): Promise<RepoMetadata> {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const { response } = await githubFetch(url, {
    headers: { accept: 'application/vnd.github+json' },
  });

  if (response.status === 404) {
    // GitHub returns a byte-identical 404 for a repository that does not exist
    // and one that is private — verified. There is no way to tell them apart
    // unauthenticated, so this failure must never be reported as "not found".
    throw new GitHubError('unreadable', `AgentDock could not read ${owner}/${repo}.`);
  }
  if (!response.ok) {
    throw new GitHubError('unavailable', `GitHub returned ${response.status}.`);
  }

  const json = JSON.parse(await readCapped(response, MAX_METADATA_BYTES));
  return {
    githubNodeId: String(json.node_id),
    fullName: String(json.full_name),
    owner: String(json.owner?.login ?? owner),
    defaultBranch: String(json.default_branch ?? 'main'),
    description: json.description ?? null,
    // The API returns an empty string, not null, for an unset homepage.
    homepage: json.homepage ? String(json.homepage) : null,
    // The only SPDX-shaped source there is, and it is null on a 167k-star
    // repository — so "unknown" is the common path, not the edge case.
    licenseSpdx: json.license?.spdx_id ?? null,
    stars: Number(json.stargazers_count ?? 0),
    isFork: Boolean(json.fork),
    isArchived: Boolean(json.archived),
    topics: Array.isArray(json.topics) ? json.topics.map(String) : [],
    // pushed_at is when the repository last changed. updated_at moves on
    // metadata edits like a star-count refresh and is not that.
    pushedAt: json.pushed_at ? new Date(json.pushed_at) : null,
    etag: response.headers.get('etag'),
  };
}
