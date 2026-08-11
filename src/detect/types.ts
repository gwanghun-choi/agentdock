export type TreeEntry = { path: string; type: string; sha: string; size?: number };

export type Candidate = {
  type: string;
  /** The manifest file, or a bare directory for a shape-only plugin. Becomes part
   * of the package identity key. */
  sourcePath: string;
  /**
   * Filled by the pipeline's assignParentPaths pass (src/detect/nesting.ts),
   * after every detector's match() has run and before parse(). Never set by a
   * detector — a detector that set its own parentPath would be answering a
   * question only the pipeline, seeing every candidate at once, can answer.
   */
  parentPath?: string;
  /**
   * Set by a detector that IS a container (only plugin.ts this phase) to the
   * directory it roots. Read by assignParentPaths, which links any OTHER
   * candidate whose sourcePath sits under this root to it — the pass itself
   * never reads `type`, so a seventh container type needs no pipeline edit.
   */
  containerRoot?: string;
  /**
   * Detector-private payload for a shape-only plugin candidate: the sorted
   * component names match() recognised it by. parse() has no access to the tree
   * a second time, so the candidate carries what it needs to describe itself.
   * Set only by plugin.ts's match(); read only by plugin.ts's parse().
   */
  shapeComponents?: string[];
  /** Every path parse() will read, declared up front so the fetch set is cappable. */
  needs: string[];
};

export type DetectedArtifact = {
  name: string;
  slug: string;
  summary: string | null;
  licenseText: string | null;
  declaredVersion: string | null;
  body: string;
  frontmatter: Record<string, unknown>;
  meta: Record<string, unknown>;
  /**
   * The bytes this artifact's version identity is computed from, when the
   * artifact is not one file. A manifest-less plugin has no manifest to hash;
   * its identity is the component set it was recognised by, so a component
   * appearing or disappearing mints a version and nothing else does. Written
   * by plugin.ts's shape-only path; every other detector leaves it unset and
   * the pipeline hashes the raw file body instead.
   */
  contentBasis?: string;
};

/** A repository this scan learned about but did not visit. Never dereferenced. */
export type DetectedSeed = {
  /** Lowercased `owner/repo`. The only shape this project can act on. */
  fullName: string;
  /** github | url | git-subdir. Text, not a union in the database — see schema.ts. */
  sourceKind: string;
  /** Whatever the catalog entry said, verbatim. Data, never a fetch target. */
  hint: Record<string, unknown>;
};

export type ParseResult =
  | { ok: true; status: 'ok' | 'partial'; artifact: DetectedArtifact; warnings: string[] }
  | { ok: false; status: 'failed'; artifact?: Partial<DetectedArtifact>; errors: string[] }
  /**
   * This candidate is not an artifact and is not a package. A catalog names other
   * repositories; the pipeline routes these to repo_seed and writes no row here.
   */
  | { ok: true; status: 'seeds'; seeds: DetectedSeed[]; warnings: string[] }
  /**
   * This candidate is not an artifact at all — path-only match() could not know.
   * A .claude/settings.json with no hooks key is not a malformed hook, it is not
   * a hook. The pipeline drops it silently, the same way a repository with no
   * SKILL.md produces no skill rows.
   */
  | { ok: true; status: 'none'; reason: string };

export type Detector = {
  type: string;
  /** PURE. Path-only. No network, no database, no filesystem. Runs over every tree. */
  match(tree: TreeEntry[]): Candidate[];
  /** Reads only the paths declared in candidate.needs. */
  parse(c: Candidate, read: (path: string) => Promise<string>): Promise<ParseResult>;
};
