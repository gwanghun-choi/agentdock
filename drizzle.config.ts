import type { Config } from 'drizzle-kit';

// Parameterised so the identical schema definitions can be applied to
// `agentdock` and to `agentdock_test`, without a second config file that would
// quietly drift from this one.
const schemaName = process.env.DATABASE_SCHEMA ?? 'agentdock';

export default {
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: process.env.MIGRATIONS_OUT ?? './drizzle',

  // Without this, drizzle-kit treats every schema in the database as its own to
  // manage, and generates statements for another application's objects.
  schemaFilter: [schemaName],

  // The default puts the migration-history table in a `drizzle` schema — a third
  // schema, in a database AgentDock does not own. Pin it inside ours.
  migrations: { schema: schemaName, table: '__drizzle_migrations' },

  // Read by `migrate` only. `generate` never opens a connection, which is what
  // makes it structurally incapable of noticing another schema exists.
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
} satisfies Config;
