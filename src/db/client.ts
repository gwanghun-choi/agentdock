import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { parseEnv } from '@/env';
import * as schema from './schema';
import { AGENTDOCK_SCHEMA } from './schema';

const env = parseEnv();

export const sql = postgres(env.DATABASE_URL, {
  // Per process. Reviewed for Vercel: a Fluid compute instance serves concurrent
  // requests from one pool, and Neon's pooled endpoint accepts up to 10,000
  // client connections (its connection-pooling docs), so this is not the
  // ceiling that binds there.
  max: 10,
  // Seconds before an unused connection closes. postgres.js defaults to never,
  // and an open connection is activity to a scale-to-zero database: Neon
  // suspends compute only after five idle minutes, and a held socket on a
  // direct connection keeps it billed for the 100 CU-hours a month the free
  // plan has. On a long-lived Docker server the cost is one reconnect after a
  // quiet spell. Prepared statements stay on — Neon's PgBouncer supports
  // protocol-level ones (max_prepared_statements=1000); a pooler that does not,
  // such as Supabase's transaction mode, would need `prepare: false` here.
  idle_timeout: 20,
  // Redundant with the schema qualification Drizzle emits, and with the
  // role-level default set during bootstrap. Redundancy is the point: a raw
  // query written in a hurry still lands in the right schema. Sent as a startup
  // parameter, not a SET — Neon's pooler drops session SETs between
  // transactions. Whether its PgBouncer accepts this parameter is unverified;
  // if it does not, the web points DATABASE_URL at the direct endpoint (see
  // VERCEL_DEPLOY.md), and assertSchemaIsolation checks the result either way.
  connection: { search_path: AGENTDOCK_SCHEMA },
  // Server notices echo statement text, which can carry values.
  onnotice: () => {},
});

// Drizzle sends every statement through sql.unsafe(), and postgres.js gives
// unsafe() prepare:false — so the "prepared statements stay on" above held only
// for tagged queries, and every Drizzle statement with a parameter cost two
// round trips (Parse/Describe, then Bind/Execute), on every request. Measured
// 2026-10-23 through a 100 ms-RTT proxy: the repository page's three serial
// statements took 6.2 round trips. Prepared, a statement this connection has
// run before takes one. Transactions (sql.begin) get their own client and keep
// postgres.js's unsafe() default.
// ponytail: a prepared statement goes to a generic plan after five runs on a
// connection, where a function of a parameter is no longer folded at plan
// time. The search's tsquery is a scalar subquery for that reason (search.ts,
// tsQuery); with it, the 10 page query sets measured 2026-10-23 at 7.3k–50k
// rows ran within noise of prepare:false under the default plan_cache_mode.
// Revisit if a new statement puts a parameter-dependent call in a per-row
// position — EXPLAIN (GENERIC_PLAN) shows it in a Filter.
export const db = drizzle(
  new Proxy(sql, {
    get: (target, key) =>
      key === 'unsafe'
        ? (query: string, args?: never[], options?: object) =>
            target.unsafe(query, args, { prepare: true, ...options })
        : Reflect.get(target, key),
  }),
  { schema },
);

/**
 * Refuses to let the process continue against a connection that is not confined
 * to a schema AgentDock owns. A mistyped connection string is otherwise silent
 * until something writes to the wrong place.
 */
export async function assertSchemaIsolation(client = sql): Promise<void> {
  const [row] = await client<{ user: string; path: string }[]>`
    SELECT current_user AS "user", current_setting('search_path') AS "path"
  `;

  if (row.user !== 'agentdock_app') {
    throw new Error(
      `Refusing to start: connected as "${row.user}", expected "agentdock_app". ` +
        'Check DATABASE_URL in .env.',
    );
  }

  const path = row.path.trim();
  if (!/^agentdock(_test)?$/.test(path)) {
    throw new Error(
      `Refusing to start: search_path is "${path}", expected exactly one AgentDock schema. ` +
        'Any other entry means an unqualified statement could reach another application.',
    );
  }
}
