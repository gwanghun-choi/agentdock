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
 * DIS-08's line: one per search or browse request, from the route, not from
 * the (react.cache-wrapped) query module — a call inside a cached function
 * would emit either zero or two lines depending on cache behaviour, and the
 * route is the one place that knows the request happened exactly once.
 *
 * `query` is the single deliberate exception to this union's closed-field
 * rule (log.ts's own doc below): the one genuinely free-form field on the
 * whole union. DIS-08 requires it and D-44 resolves the privacy question in
 * its favour — the line is one JSON object on stdout, the project's only
 * sink, with no account, no session, no cookie and no IP anywhere near it
 * (v1 has no authentication). It is bounded at SEARCH_CAPS.maxQueryLength
 * before it ever reaches here.
 */
export type SearchLog = {
  event: 'search';
  /** The normalized query. '' for a browse request — emitted, never omitted. */
  query: string;
  /** The applied type ids, drawn from search.ts's closed ARTIFACT_TYPE_IDS
   * set after validation — not imported as a type here, so this file never
   * pulls in @/db/client at module load (log.test.ts stays DB-free). []
   * when no type filter is applied — emitted, never omitted. */
  types: string[];
  /** The applied capability ids, drawn from search.ts's closed
   * CAPABILITY_FILTER_IDS set, same reasoning as types above. [] when no
   * capability filter is applied — emitted, never omitted. */
  capabilities: string[];
  /** The bounded page number actually served. */
  page: number;
  /** Rows on this page. Emitted as 0 explicitly, following IngestLog's
   * seedsSkipped precedent: a field that appears only when non-zero makes
   * its absence ambiguous between "no results" and "an older build". */
  resultCount: number;
  /** The total the paginator reported, so a later reader can tell "one page
   * of many" from "one result". */
  totalCount: number;
  /** Wall clock around BOTH the rows query (searchPackages) and the count
   * query (countSearchResults), measured together in the route — stated
   * here because a duration whose boundaries are undocumented is a number
   * nobody can act on when this log is read for the semantic-search
   * decision it exists to inform. */
  durationMs: number;
};

/**
 * One line, one shape. The field set is closed on purpose: a free-form payload
 * parameter is how a response body, a header, or a connection string ends up in
 * a log file six months from now. Every field here is a number, a boolean, a
 * nullable string with a documented provenance, or a closed union — there is no
 * key an arbitrary object could be assigned to.
 */
export function log(entry: IngestLog | WorkerLog | SearchLog): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...entry }));
}
