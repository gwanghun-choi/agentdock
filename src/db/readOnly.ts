import type { Sql } from 'postgres';

/**
 * The read-only connection scripts/ops.mjs reports through, and the checks it
 * runs on that connection before it reads anything. Both reports are pointed at
 * the deployment's database from an operator's terminal and from sync.yml, so
 * "read-only" is something PostgreSQL enforces and this module confirms on every
 * pooled connection — not something the report code promises by containing no
 * INSERT.
 *
 * Nothing here returns or prints the URL, its host, its user or its password.
 */

/**
 * Server-side ceiling on any one statement. Measured 2026-10-22 on 10k
 * synthetic artifacts: the whole of quality:check took 461 ms, ops:status 52 ms.
 */
export const OPS_STATEMENT_TIMEOUT_MS = 30_000;

/** Seconds postgres.js waits for a connection before it gives up. */
const CONNECT_TIMEOUT_S = 10;

/** In pg_stat_activity, so an operator can see (and a test can count) these sessions. */
export const OPS_APPLICATION_NAME = 'agentdock-ops';

/**
 * `raw` rewritten so every connection postgres.js opens from it is read-only
 * at the server, or why it is refused. postgres.js 3.4.9 (src/index.js, the
 * `connection` field) sends every URL query parameter it does not consume
 * itself as a startup parameter, so the setting rides on each new connection
 * rather than on a SET a pooler could drop.
 *
 * The settings ride inside `options` as `-c` flags, not as parameters of their
 * own. Measured 2026-10-23 to 2026-10-25: six scheduled runs' checks found
 * read-only, statement_timeout and search_path all at server defaults, and a
 * local proxy forwarding only user, database, options and application_name
 * (what neondatabase/neon#1287 says Neon's proxy forwards) reproduces exactly
 * that, while the same settings in `options` pass through it. The checks below
 * still confirm the result on every connection, so a path that drops `options`
 * too fails closed. A separate parameter is applied after `options`, so one
 * the URL already carries is removed rather than left to win.
 *
 * A pooled endpoint is refused outright: PgBouncer either rejects an unknown
 * startup parameter or, listed in ignore_startup_parameters, drops it silently —
 * and the second case would leave the session writable. Neon names its pooled
 * hosts `-pooler`, the same test scripts/migration-gate.mjs applies.
 */
export function readOnlyTarget(
  raw: string | undefined,
  statementTimeoutMs = OPS_STATEMENT_TIMEOUT_MS,
): { url: string } | { refused: string } {
  if (!raw || !/^postgres(ql)?:\/\//.test(raw)) {
    return { refused: 'DATABASE_URL is missing or not a postgres:// URL' };
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { refused: 'DATABASE_URL does not parse as a URL' };
  }
  if (url.hostname.toLowerCase().includes('-pooler')) {
    return { refused: 'DATABASE_URL is a pooled endpoint; use the direct one' };
  }
  const settings = `-c default_transaction_read_only=on -c statement_timeout=${statementTimeoutMs}`;
  const options = url.searchParams.get('options');
  url.searchParams.set('options', options ? `${options} ${settings}` : settings);
  url.searchParams.delete('default_transaction_read_only');
  url.searchParams.delete('statement_timeout');
  url.searchParams.set('application_name', OPS_APPLICATION_NAME);
  url.searchParams.set('connect_timeout', String(CONNECT_TIMEOUT_S));
  return { url: url.href };
}

export type ReadOnlyCheck = { check: string; ok: boolean };

/**
 * What the server says about the connection `sql` opens, one line per
 * property. Every connection the pool may open is held at once (pg_sleep keeps
 * each busy, so postgres.js opens a new one for the next query), and a pool that
 * could not be filled fails rather than passing on the ones it saw.
 *
 * The write probe is a temp table inside a transaction that is always rolled
 * back: refused with 25006 is the pass, any other outcome fails, and if it were
 * ever accepted nothing outlives the rollback. A connection error in the first
 * round is not caught — it rejects, and the caller treats that as "could not
 * read", never as a pass.
 */
export async function readOnlyChecks(
  sql: Sql,
  expect: { schema: string; role: string; statementTimeoutMs: number },
): Promise<ReadOnlyCheck[]> {
  const size = sql.options.max;
  const rows = (
    await Promise.all(
      Array.from(
        { length: size },
        () => sql<
          {
            pid: number;
            byDefault: string;
            now: string;
            timeout: boolean;
            role: boolean;
            path: boolean;
          }[]
        >`
          SELECT pg_backend_pid() AS pid,
                 current_setting('default_transaction_read_only') AS "byDefault",
                 current_setting('transaction_read_only') AS now,
                 current_setting('statement_timeout')::interval
                   = ${expect.statementTimeoutMs} * interval '1 millisecond' AS timeout,
                 current_user = ${expect.role} AS role,
                 current_setting('search_path') = ${expect.schema} AS path,
                 pg_sleep(0.05)::text AS slept
        `,
      ),
    )
  ).map(([row]) => row);
  const every = (ok: (r: (typeof rows)[number]) => boolean) => rows.every(ok);

  const rollback = new Error('rollback');
  const code = await sql
    .begin(async (tx) => {
      await tx`CREATE TEMP TABLE ops_read_only_probe (x int)`;
      throw rollback;
    })
    .then(
      () => 'no error',
      (error) => (error === rollback ? 'accepted, rolled back' : String(error?.code)),
    );

  return [
    {
      check: `${size} of ${size} pool connections opened and checked`,
      ok: new Set(rows.map((r) => r.pid)).size === size,
    },
    {
      check: 'default_transaction_read_only = on on every connection',
      ok: every((r) => r.byDefault === 'on'),
    },
    { check: 'transaction_read_only = on on every connection', ok: every((r) => r.now === 'on') },
    {
      check: `statement_timeout = ${expect.statementTimeoutMs} ms on every connection`,
      ok: every((r) => r.timeout),
    },
    { check: `connected as ${expect.role}`, ok: every((r) => r.role) },
    { check: `search_path is exactly ${expect.schema}`, ok: every((r) => r.path) },
    {
      check: `a write is refused by the server (expected 25006, got ${code})`,
      ok: code === '25006',
    },
  ];
}
