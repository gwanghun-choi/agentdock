type IngestLog = {
  event: 'ingest';
  owner: string;
  repo: string;
  commitSha: string | null;
  outcome: string;
  found: number;
  stored: number;
  failed: number;
  durationMs: number;
  rateRemaining: number | null;
};

/**
 * One line, one shape. The field set is closed on purpose: a free-form payload
 * parameter is how a response body, a header, or a connection string ends up in
 * a log file six months from now.
 */
export function log(entry: IngestLog): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...entry }));
}
