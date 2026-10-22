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
  /**
   * Six detectors share this budget, not one. Measured on the largest frozen
   * corpus (wshobson-agents, 1,160 bounded blobs): 180 skills + 91 plugin
   * manifests + 109 commands + 2 hook configs + 1 MCP declaration + 1 catalog =
   * 384 wanted files, against the 180 a skills-only pipeline wanted.
   *
   * Raw reads cost no core quota — that is the whole reason they are on the raw
   * host, per the note above. The cost of this number is wall clock and
   * abuse-throttle exposure: 400 files at concurrency 2 inside wallClockMs
   * allows 600 ms per file, comfortably above a measured raw read. No core
   * request is added by this change.
   *
   * 400 -> 600 with the subagent detector (Phase 5, 2026-10-21). Measured on
   * the same corpus: wshobson-agents adds 204 agents/*.md, 384 -> 588 wanted.
   * At 400 the round robin would have cut every type in that repository,
   * skills included, to make room — a new type costing an old one coverage.
   * 600 at concurrency 2 inside wallClockMs is 400 ms per file, still above
   * the ~150 ms raw read the original budget assumed (AGD-01 RESEARCH A3, not
   * benchmarked at volume). A repository over it is still read partially and
   * says so (artifactsTruncated). Still no core request.
   */
  maxFiles: 600,
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
  selectPaths: (tree: RepoTree, metadata: RepoMetadata) => string[],
  knownSha?: string | null,
  /** The stored read of knownSha was partial (repository.tree_truncated). */
  knownPartial = false,
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
  //
  // Except a stored PARTIAL read of this same commit, when the tree shows no
  // reason it has to be partial again: GitHub did not truncate the tree and
  // the wanted paths fit under maxFiles. Then what cut the last read was a
  // raw read that failed or the wall clock, both transient, and short-
  // circuiting here kept that partial listing until the next upstream commit
  // (R6). A deterministic cut — a truncated tree, more wanted paths than
  // maxFiles — still short-circuits, or davila7/claude-code-templates (896
  // skill paths) would re-read 400 files on every refresh for nothing.
  // A wanted file over maxFileBytes is a deterministic cut too, and the tree
  // shows it: a blob entry's size is its byte length, the same bytes
  // readCapped counts. ponytail: a 404 on one raw path is not visible here, so
  // such a repository still re-reads its (at most maxFiles) files each refresh
  // until its next commit. Raw reads cost no core quota; store the skip reason
  // (additive column) if that shows up in run durations.
  let wanted: string[] | undefined;
  if (knownSha && bounded.commitSha === knownSha) {
    if (knownPartial && !tree.truncated) wanted = selectPaths(bounded, metadata);
    const oversized = new Set(
      bounded.entries.filter((e) => (e.size ?? 0) > CAPS.maxFileBytes).map((e) => e.path),
    );
    if (
      wanted === undefined ||
      wanted.length > CAPS.maxFiles ||
      wanted.some((path) => oversized.has(path))
    ) {
      return {
        metadata,
        tree: bounded,
        files: new Map(),
        skipped: [],
        artifactsTruncated: false,
        unchanged: true,
      };
    }
  }

  // The metadata is handed to the selector as well as the tree, because the
  // caller's decision about which paths are worth reading can depend on facts
  // about the repository rather than only on what is in it — AgentDock's
  // discovery gate returns no paths at all for a repository its policy declines
  // (src/ingest/pipeline.ts). Passing it here rather than adding a rejection
  // parameter keeps every policy out of this module: this function still knows
  // only "the caller asked for these paths", and an empty list costs zero raw
  // reads by construction rather than by a second branch.
  wanted ??= selectPaths(bounded, metadata);
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
