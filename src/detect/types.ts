export type TreeEntry = { path: string; type: string; sha: string; size?: number };

export type Candidate = {
  type: string;
  /** The manifest file. Becomes part of the package identity key. */
  sourcePath: string;
  /** Containing plugin or catalog directory. Unused in this phase; Phase 3 fills it. */
  parentPath?: string;
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
};

export type ParseResult =
  | { ok: true; status: 'ok' | 'partial'; artifact: DetectedArtifact; warnings: string[] }
  | { ok: false; status: 'failed'; artifact?: Partial<DetectedArtifact>; errors: string[] };

export type Detector = {
  type: string;
  /** PURE. Path-only. No network, no database, no filesystem. Runs over every tree. */
  match(tree: TreeEntry[]): Candidate[];
  /** Reads only the paths declared in candidate.needs. */
  parse(c: Candidate, read: (path: string) => Promise<string>): Promise<ParseResult>;
};
