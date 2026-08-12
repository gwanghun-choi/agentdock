/**
 * Which frozen corpora a precision measurement was taken against.
 *
 * Declared once because it was declared twice: scripts/capability-precision.mjs
 * and src/analyze/precision.test.ts each carried their own four-element array,
 * and a one-sided edit would have made the script print a sample over one set
 * while the test recomputed hit counts over another — surfacing as
 * "drifted from its recorded hit count", which accuses the detector of changing
 * when the fault is a missed edit in a constant (05-CONTEXT C4).
 *
 * Scope, stated because it is narrower than the file name suggests: this is the
 * corpus list for the CAP-13 *precision measurement* — the sampling script and
 * the record's test. Roughly a dozen other suites (install.test.ts,
 * network.test.ts, detect/command.test.ts, ...) also carry a four-slug array,
 * each paired with its own hardcoded assertion about those four corpora. Those
 * are per-suite expectations, not this measurement, and re-pointing them at a
 * larger corpus would invalidate their numbers for no gain. They are
 * deliberately left alone.
 *
 * V1 is frozen. It is what every Phase 4 row in fixtures/capability-precision.md
 * was measured against, and re-pointing those rows at a larger corpus would make
 * six recorded numbers wrong at once and destroy the historical rows that file
 * exists to preserve (`html_comment_naive`, `hidden_style`).
 */
export const CORPORA_V1 = [
  'addyosmani-agent-skills',
  'anthropics-skills',
  'baoyu-skills',
  'wshobson-agents',
] as const;

/**
 * V1 plus three repositories chosen for the shapes V1 lacks, not for size:
 * `anthropics-claude-code` (18 commands, 13 plugin manifests — commands are
 * where `allowed-tools` lives), `disler-hooks-mastery` (21 commands and a hook
 * config from an independent author), and `obra-superpowers` (14 skills, a
 * plugin, a catalog and a hook from an author with no Anthropic adjacency —
 * three of V1's four repositories share a house style).
 */
export const CORPORA_V2 = [
  ...CORPORA_V1,
  'anthropics-claude-code',
  'disler-hooks-mastery',
  'obra-superpowers',
] as const;

export const CORPUS_SETS: Record<string, readonly string[]> = {
  v1: CORPORA_V1,
  v2: CORPORA_V2,
};

export const NEWEST_CORPUS_SET = 'v2';
