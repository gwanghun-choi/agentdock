/**
 * The shipped taxonomy, all seven rows of CONTEXT.md's Binding decision 6
 * table. Six are findings; the seventh, `file_inventory`, is a label for the
 * file inventory disclosure (src/analyze/files.ts) — it is never a value an
 * analyzer assigns to Finding.category, because the inventory is not a
 * finding (Binding decision 3: it lives on `package`, findings live on
 * `package_version`). Kept in one array so the whole taxonomy is named once,
 * not scattered across a panel and a query module that could drift apart.
 */
export const CAPABILITY_CATEGORIES = [
  'declared',
  'remote_execution',
  'package_install',
  'network_request',
  'external_reference',
  'hidden_content',
  'file_inventory',
] as const;

/**
 * Following JSON_CAPS/FRONTMATTER_CAPS/HOOK_CAPS: one JSDoc block per number,
 * each naming its measurement and what it does NOT cover.
 */
export const ANALYZE_CAPS = {
  /**
   * Equals the pipeline's MAX_BODY (src/ingest/pipeline.ts). Asserted here as
   * defence-in-depth against a future uncapped caller, not as the primary
   * control — the pipeline already slices every body to this size before an
   * analyzer ever sees it.
   */
  maxBodyChars: 32 * 1024,
  /**
   * Longest real line across the 84 captured bodies (19,909 lines) is 1,352
   * chars; zero exceed this cap. Bounds per-line regex cost. Does NOT bound
   * the total number of findings a body can produce.
   */
  maxLineChars: 2000,
  /**
   * The largest single-detector-in-one-file count measured across the four
   * frozen corpora is 7. Bounds row volume for one analyzer over one
   * artifact. Does NOT bound scan time — a hostile body can still cost a
   * full pass over every line.
   */
  maxFindingsPerDetector: 50,
  /**
   * Median matched line is 27 chars, p99 is 377 — 200 keeps the common case
   * whole and truncates the outlier visibly rather than silently.
   */
  maxEvidenceChars: 200,
  /**
   * Largest real file inventory measured is 83 entries
   * (anthropics-skills skills/canvas-design/). 200 is 2.4x that.
   */
  maxInventoryEntries: 200,
} as const;

/** A blob under one artifact's directory prefix. Paths and modes, never bytes. */
export type FileEntry = {
  path: string;
  size: number | null;
  kind: 'file' | 'symlink';
  executable: boolean;
};

/**
 * What one analyzer observed. Never a whole document: summary and evidence are
 * both capped, and every render sink escapes them as a JSX text node.
 */
export type Finding = {
  detectorId: string;
  /** Bumped when the rule changes, so a precision row names a specific version. */
  detectorVersion: string;
  category: (typeof CAPABILITY_CATEGORIES)[number];
  /** Which rule inside the detector fired: 'npx', 'pip install', 'U+202E'. */
  signal: string;
  /** Observation, never judgment. Verbs: declares, references, invokes, contains. */
  summary: string;
  /** The file the observation is in. Not always the artifact's own manifest. */
  sourcePath: string;
  /** 1-indexed against package_version.body. Null for a structured declaration. */
  startLine: number | null;
  endLine: number | null;
  /** Capped at ANALYZE_CAPS.maxEvidenceChars, single line, escaped at render. */
  evidenceText: string | null;
  /**
   * 0-indexed character offset within startLine's own text. Optional: most
   * analyzers report a whole line as the unit of observation and have no
   * single column to name (install, network, shell all leave this unset).
   * hidden.ts's codepoint classes are the one detector precise enough for a
   * column to mean anything — a single invisible character at a known offset
   * on its line, not a whole matched phrase.
   */
  column?: number | null;
  metadata: Record<string, unknown>;
};

/**
 * One artifact's whole analysable surface. One parameter, so an analyzer
 * structurally cannot reach a database — the same proof detect/run.test.ts:224
 * makes for detectors by asserting match() has arity 1.
 */
export type AnalyzeInput = {
  sourcePath: string;
  body: string;
  frontmatter: Record<string, unknown>;
  meta: Record<string, unknown>;
  /** Blobs under this artifact's directory prefix. Paths and modes, never bytes. */
  files: FileEntry[];
};

export type Analyzer = (input: AnalyzeInput) => Finding[];
