import { fetchRawFile } from './raw';
import { fetchRepoMetadata } from './repo';
import { fetchRepoTree } from './tree';
import type { RepoMetadata, RepoTree } from './types';

/**
 * Every number here is grounded in the measured corpus, not invented. The
 * largest sampled repository holds 180 skill files and 1,992 tree entries; the
 * largest sampled skill file is 72 KB.
 */
export const CAPS = {
  maxFiles: 200,
  maxFileBytes: 512 * 1024,
  maxTreeEntries: 100_000,
  maxDepth: 10,
  wallClockMs: 120_000,
  concurrency: 2,
} as const;

export type ScanInputs = {
  metadata: RepoMetadata;
  tree: RepoTree;
  files: Map<string, string>;
  /** Paths that matched but were not read, because a cap was reached. */
  skipped: string[];
  artifactsTruncated: boolean;
  /** The commit has not moved since the last ingest, so nothing was read. */
  unchanged: boolean;
};

/**
 * The two rate-limited calls, then the free ones.
 *
 * Concurrency is two on purpose. Raw reads cost no quota, which makes firing all
 * 180 of them at once feel free; it is instead how undocumented abuse throttling
 * gets discovered in production. Whatever is read within the budget is kept, and
 * the remainder is reported rather than dropped.
 */
export async function fetchRepoScanInputs(
  owner: string,
  repo: string,
  selectPaths: (tree: RepoTree) => string[],
  knownSha?: string | null,
): Promise<ScanInputs> {
  const deadline = Date.now() + CAPS.wallClockMs;

  const [metadata, tree] = await Promise.all([
    fetchRepoMetadata(owner, repo),
    fetchRepoTree(owner, repo),
  ]);

  const bounded: RepoTree = {
    ...tree,
    entries: tree.entries
      .slice(0, CAPS.maxTreeEntries)
      .filter((e) => e.path.split('/').length <= CAPS.maxDepth),
  };

  // Both core calls are already spent — the sha arrives inside the tree
  // response, which is why this saves no GitHub quota at all. What it saves is
  // up to CAPS.maxFiles raw fetches and up to CAPS.wallClockMs of wall clock,
  // plus the raw-host abuse-throttle exposure this file's header warns about.
  //
  // Placed after the tree is bounded and before any path is selected, so the
  // tree handed back is the same shape the full path would have produced and no
  // caller has to know which branch ran.
  if (knownSha && bounded.commitSha === knownSha) {
    return {
      metadata,
      tree: bounded,
      files: new Map(),
      skipped: [],
      artifactsTruncated: false,
      unchanged: true,
    };
  }

  const wanted = selectPaths(bounded);
  const taken = wanted.slice(0, CAPS.maxFiles);
  const skipped = wanted.slice(CAPS.maxFiles);

  const files = new Map<string, string>();
  const queue = [...taken];

  async function worker() {
    for (;;) {
      const path = queue.shift();
      if (path === undefined) return;
      if (Date.now() > deadline) {
        skipped.push(path);
        continue;
      }
      try {
        files.set(path, await fetchRawFile(owner, repo, tree.commitSha, path, CAPS.maxFileBytes));
      } catch {
        // One unreadable file must not lose the other 179. It is recorded as
        // skipped and the repository is reported as incomplete.
        skipped.push(path);
      }
    }
  }

  await Promise.all(Array.from({ length: CAPS.concurrency }, worker));

  return {
    metadata,
    tree: bounded,
    files,
    skipped,
    artifactsTruncated: skipped.length > 0,
    unchanged: false,
  };
}
