export type TreeEntry = {
  path: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
  size?: number;
};

export type RepoMetadata = {
  githubNodeId: string;
  fullName: string;
  owner: string;
  defaultBranch: string;
  description: string | null;
  homepage: string | null;
  licenseSpdx: string | null;
  stars: number;
  isFork: boolean;
  isArchived: boolean;
  topics: string[];
  pushedAt: Date | null;
  etag: string | null;
};

export type RepoTree = {
  /** The COMMIT sha. Asserted 40-hex. Permalinks 404 on a tree sha. */
  commitSha: string;
  entries: TreeEntry[];
  truncated: boolean;
};

export type RateLimit = {
  limit: number;
  remaining: number;
  /** UTC epoch seconds. */
  reset: number;
};

/** Why a GitHub interaction failed, in terms the UI can act on. */
export type GitHubFailure =
  | 'invalid_repo'
  | 'unreadable'
  | 'rate_limited'
  | 'too_large'
  | 'unavailable';
