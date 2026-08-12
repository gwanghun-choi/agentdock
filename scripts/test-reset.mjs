#!/usr/bin/env node
// scripts/test-reset.mjs
//
// Empties every data table in `agentdock_test`, leaving the DDL in place.
//
//   bun run db:test:reset
//
// Why this exists, since `db:test:setup` looks like it already does it:
//
// It does not. `db:test:setup` is `drizzle-kit generate` followed by
// scripts/migrate.mjs, and both are no-ops once the schema matches schema.ts —
// measured on 2026-08-11 by inserting a row into agentdock_test.ingest_job,
// running `bun run db:test:setup`, and finding the row still there. So a
// cold-start run that used `db:test:setup` as its "empty the schema" step would
// start from whatever was already there, and — worse — would use it as its
// "put the schema back" step and leave a real repository name sitting `queued`.
//
// That last part is not tidiness. Six vitest suites share this schema, claimJob
// takes the oldest claimable row in the WHOLE schema, and jobs.test.ts's own
// cleanup only deletes its `test-owner/queue-spec%` sentinels. One real
// repository left `queued` makes another suite's claim assertions
// nondeterministic, and the failure gets blamed on that suite.
//
// Two things keep this inside AgentDock's boundary, both of them structural:
//   1. the schema name is a literal here — this script takes no argument and
//      reads no environment variable naming a schema, so there is no value an
//      operator could supply that points it elsewhere
//   2. the table list is a catalog query filtered to that same literal, and
//      agentdock_app owns nothing outside agentdock and agentdock_test, so a
//      statement that somehow escaped 1 would still fail on permissions
//
// TRUNCATE rather than DROP: the DDL is what `db:test:setup` builds and what
// every suite expects, and rebuilding it would make this script depend on a
// migration run. artifact_type is kept because it is a reference dimension the
// foreign keys need, seeded by migrate.mjs and never written by a test.

import postgres from 'postgres';

const SCHEMA = 'agentdock_test';
const KEEP = ['artifact_type', '__drizzle_migrations'];

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const sql = postgres(url, { max: 1, connection: { search_path: SCHEMA }, onnotice: () => {} });

try {
  // The SCHEMA, not the database name. AgentDock is self-hostable, so the
  // database differs per deployment and a literal name here would refuse to run
  // for everyone but its author while asserting nothing AgentDock owns. The
  // schema is the boundary, and SCHEMA is a literal in this file.
  const [{ schema }] = await sql`select current_schema() as schema`;
  if (schema !== SCHEMA) {
    throw new Error(
      `Refusing to reset: current_schema() is ${schema}, expected ${SCHEMA}. ` +
        'The connection is not confined to the schema this script empties.',
    );
  }

  const tables = await sql`
    select tablename from pg_tables
     where schemaname = ${SCHEMA} and tablename <> all(${KEEP})
     order by tablename`;

  if (tables.length === 0) {
    console.log(`${SCHEMA}: no data tables — run \`bun run db:test:setup\` first.`);
  } else {
    const list = tables.map((t) => `"${SCHEMA}"."${t.tablename}"`).join(', ');
    await sql.unsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
    console.log(`${SCHEMA}: emptied ${tables.length} table(s); ${KEEP.join(', ')} kept.`);
  }
} finally {
  await sql.end();
}
