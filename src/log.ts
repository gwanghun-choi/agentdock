import type { AttemptOutcome } from '@/ingest/errors';

type IngestLog = {
  event: 'ingest';
  jobId: number | null;
  attempt: number | null;
  owner: string;
  repo: string;
  commitSha: string | null;
  // Was a bare string. Narrowing it to the union is the whole guarantee: a
  // caller can no longer pass a stringified exception where an outcome belongs,
  // and the type check that already runs in the build is what stops them. A
  // redaction filter would have to anticipate every shape a secret can take;
  // this is a wall the compiler enforces instead.
  outcome: AttemptOutcome;
  found: number;
  stored: number;
  failed: number;
  new: number;
  updated: number;
  unchanged: number;
  removed: number;
  /**
   * marketplace.json entries that named no GitHub-reachable repository — an npm
   * source, an archive URL, or a relative path pointing inside the catalog's own
   * repository. Counted by src/detect/catalog.ts since Phase 3 and, until Phase
   * 5, discarded by the pipeline's seeds branch before it reached anything: that
   * branch continues without ever reading result.warnings, so the count died one
   * function after it was computed.
   *
   * A number, not a message: this type's key set is closed on purpose, and an
   * integer with a documented provenance is what that decision permits. Emitted
   * on every ingest line including as zero, because a field that appears only
   * when non-zero makes its absence ambiguous between "no catalog" and "an older
   * build".
   */
  seedsSkipped: number;
  truncated: boolean;
  durationMs: number;
  rateRemaining: number | null;
  /** UTC epoch seconds, as GitHub reports it. */
  rateReset: number | null;
  /**
   * Present only when a registered detector's match() threw. Absent (not an
   * empty array) on a clean run, so JSON.stringify drops the key entirely and
   * every line without a detector failure keeps the same closed key set.
   */
  detectorErrors?: string[];
};

/** The loop's own lifecycle. No message field, so there is nothing to interpolate into. */
type WorkerLog = {
  event: 'worker';
  state: 'started' | 'error';
  jobId: number | null;
};

/**
 * One line, one shape. The field set is closed on purpose: a free-form payload
 * parameter is how a response body, a header, or a connection string ends up in
 * a log file six months from now. Every field here is a number, a boolean, a
 * nullable string with a documented provenance, or a closed union — there is no
 * key an arbitrary object could be assigned to.
 */
export function log(entry: IngestLog | WorkerLog): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...entry }));
}
