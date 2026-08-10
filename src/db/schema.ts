import { pgSchema, text, timestamp } from 'drizzle-orm/pg-core';

const requested = process.env.DATABASE_SCHEMA ?? 'agentdock';

// drizzle-kit loads this module standalone, without parseEnv, so the guard is
// repeated here. This is the file every CREATE TABLE is generated from: a wrong
// value would emit DDL aimed at a schema AgentDock does not own.
if (requested !== 'agentdock' && requested !== 'agentdock_test') {
  throw new Error(
    `Refusing to build a schema module for "${requested}". ` +
      'AgentDock owns only "agentdock" and "agentdock_test".',
  );
}

/**
 * The schema AgentDock owns. Parameterised only so the same definitions can be
 * applied to `agentdock_test`; scripts/check-boundaries.mjs asserts that the
 * committed migrations name `agentdock` and nothing else.
 */
export const AGENTDOCK_SCHEMA = requested;

/**
 * Every table in this project hangs off this object, so every statement Drizzle
 * emits — DDL and queries alike — is schema-qualified. `search_path` is a
 * default, not a fence, and nothing here relies on it.
 */
export const agentdock = pgSchema(AGENTDOCK_SCHEMA);

/**
 * Key/value facts about this deployment of the schema. Written at boot, read by
 * the status page.
 */
export const schemaMeta = agentdock.table('schema_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
