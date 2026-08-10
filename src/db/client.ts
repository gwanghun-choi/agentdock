import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { parseEnv } from '@/env';
import * as schema from './schema';
import { AGENTDOCK_SCHEMA } from './schema';

const env = parseEnv();

export const sql = postgres(env.DATABASE_URL, {
  max: 10,
  // Redundant with the schema qualification Drizzle emits, and with the
  // role-level default set during bootstrap. Redundancy is the point: a raw
  // query written in a hurry still lands in the right schema.
  connection: { search_path: AGENTDOCK_SCHEMA },
  // Server notices echo statement text, which can carry values.
  onnotice: () => {},
});

export const db = drizzle(sql, { schema });

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
