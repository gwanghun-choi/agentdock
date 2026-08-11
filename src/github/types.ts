export type TreeEntry = {
  path: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
  size?: number;
  /**
   * The raw Git mode string, present on every entry of the Trees response and
   * discarded until now. 100644 regular, 100755 executable, 040000 tree,
   * 120000 symlink, 160000 submodule. Measured across the four frozen corpora:
   * 2,623 regular, 50 executable, 2 symlinks, 1,156 trees. Costs no request —
   * it rides the response fetchRepoTree already issues.
   */
  mode?: string;
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
