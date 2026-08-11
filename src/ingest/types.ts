import type { FileEntry, Finding } from '@/analyze/types';

/** Result of parsing one artifact. `failed` still produces a row. */
export type ParseStatus = 'ok' | 'partial' | 'failed';

export type ScannedPackage = {
  type: string; // an artifact_type id; 'skill' in this phase
  sourcePath: string; // 'skills/canvas-design/SKILL.md'
  name: string;
  slug: string;
  summary: string | null;
  licenseText: string | null;
  meta: Record<string, unknown>;
  blobSha: string | null;
  contentHash: string;
  declaredVersion: string | null;
  body: string | null;
  frontmatter: Record<string, unknown>;
  parseStatus: ParseStatus;
  parseErrors: string[];
  /**
   * The nearest container's directory (e.g. a plugin root), filled by
   * src/detect/nesting.ts's assignParentPaths pass over the candidate set —
   * never computed here. null when this artifact sits at the top level or its
   * container declared the repository root.
   */
  parentPath: string | null;
  /**
   * Computed in the pipeline loop that already holds the body, alongside
   * contentHash — pure work, so it must not run inside persistScan's
   * transaction. Persisted only when a new package_version row is created
   * (src/ingest/persist.ts), gated the same way findings are the only thing
   * that is.
   */
  findings: Finding[];
  /**
   * Every blob under this artifact's directory prefix, from the tree already
   * in memory (src/analyze/files.ts). Written by the package upsert, which
   * already runs on every scan (src/ingest/persist.ts) — NOT gated on a new
   * version, unlike findings: a version is minted by the manifest's own
   * bytes, so a script appearing beside an unchanged SKILL.md mints no
   * version, and this is exactly the fact CAP-03 needs to stay current about.
   */
  files: FileEntry[];
};

/**
 * A repo_seed row, ready to persist. `DetectedSeed` (src/detect/types.ts) is
 * what a detector returns; this adds the provenance a detector cannot know —
 * which repository was being scanned, and which file named this seed — the
 * same way `ScannedPackage` adds pipeline-known fields to `DetectedArtifact`.
 */
export type ScannedSeed = {
  fullName: string;
  sourceKind: string;
  discoveredFrom: string;
  discoveredPath: string;
  hint: Record<string, unknown>;
};

/**
 * Everything one pass over one repository learned. The pipeline produces it, the
 * transaction consumes it. Nothing in between touches the database, and nothing
 * here touches the network — which is what makes persistence testable from a
 * frozen fixture.
 */
export type RepoScan = {
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
  scannedAt: Date;
  etag: string | null;
  commitSha: string;
  treeTruncated: boolean;
  packages: ScannedPackage[];
  seeds: ScannedSeed[];
};
