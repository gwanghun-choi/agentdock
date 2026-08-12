#!/usr/bin/env node
// scripts/migrate.mjs
//
// Applies the reviewed migrations in drizzle/ as agentdock_app.
//
//   bun run db:migrate
//
// Why this exists instead of `drizzle-kit migrate`:
//
// Both drizzle-kit and drizzle-orm's own migrator unconditionally issue
// `CREATE SCHEMA IF NOT EXISTS "<migrations schema>"` before touching the
// history table. PostgreSQL checks CREATE on the *database* before it checks
// whether the schema already exists, so that statement fails with 42501 for
// agentdock_app — which is NOCREATEDB and holds no CREATE on the database — even
// though the schema is right there and the role owns it.
//
// The fix is not to grant that privilege. In a database shared with another
// application, CREATE on the database is exactly the privilege Phase 0 exists
// to withhold. So this reuses drizzle's own migration reader and history-table
// format — same files, same hashes, same `__drizzle_migrations` columns — and
// simply omits the one statement the role cannot run. Switching back to
// drizzle's migrator later requires no data change.
//
// `drizzle-kit generate` is untouched: it is offline and opens no connection.

import { readMigrationFiles } from 'drizzle-orm/migrator';
import postgres from 'postgres';

// Allowlisted, so the identifier interpolated below can only ever be one of two
// literals AgentDock owns.
const schema = process.env.DATABASE_SCHEMA ?? 'agentdock';
if (schema !== 'agentdock' && schema !== 'agentdock_test') {
  console.error(
    `Refusing to migrate "${schema}". AgentDock owns only agentdock and agentdock_test.`,
  );
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const folder = process.env.MIGRATIONS_OUT ?? './drizzle';
const migrations = readMigrationFiles({ migrationsFolder: folder });

const sql = postgres(url, { max: 1, connection: { search_path: schema }, onnotice: () => {} });

try {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS "${schema}"."__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);

  const [latest] = await sql.unsafe(
    `select created_at from "${schema}"."__drizzle_migrations" order by created_at desc limit 1`,
  );
  const lastApplied = latest ? Number(latest.created_at) : null;

  let applied = 0;
  await sql.begin(async (tx) => {
    for (const migration of migrations) {
      if (lastApplied !== null && lastApplied >= migration.folderMillis) continue;
      for (const statement of migration.sql) {
        const createsSchema = statement.match(
          /^\s*CREATE\s+SCHEMA\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([\w$]+)"?/i,
        );
        if (createsSchema) {
          // drizzle-kit emits this for every pgSchema() in a first migration.
          // The schema already exists — a superuser made it during the
          // bootstrap — and agentdock_app cannot create one. Skipping it is
          // safe only for a schema AgentDock owns; anything else is a boundary
          // escape and stops the migration.
          if (createsSchema[1] !== schema) {
            throw new Error(
              `Refusing to apply: migration creates schema "${createsSchema[1]}", ` +
                `but this run targets "${schema}".`,
            );
          }
          console.log(`  skipped: CREATE SCHEMA "${schema}" (created once by the bootstrap)`);
          continue;
        }
        await tx.unsafe(statement);
      }
      await tx.unsafe(
        `insert into "${schema}"."__drizzle_migrations" ("hash", "created_at") values ($1, $2)`,
        [migration.hash, migration.folderMillis],
      );
      applied += 1;
    }
  });

  // Reference data the foreign keys require, reasserted after every migrate.
  //
  // The reviewed migrations in drizzle/ seed artifact_type for `agentdock`, and
  // that is where each row belongs historically. But `db:test:setup` regenerates
  // the test schema's DDL from scratch into a gitignored folder, so a hand-added
  // INSERT in a drizzle/ migration can never reach `agentdock_test` — leaving
  // package.type pointing at an empty dimension and every database-backed suite
  // failing on package_type_artifact_type_id_fk. Seeding here fixes it once, for
  // both schemas and for every suite, instead of once per test file.
  //
  // ON CONFLICT DO NOTHING, so this is a no-op on a schema the migrations
  // already seeded. This list must carry every artifact_type row any migration
  // ever hand-adds, row for row — not just enough for the FKs to resolve at
  // all, because agentdock_test never sees the migrations' own INSERTs.
  await sql.unsafe(
    `insert into "${schema}"."artifact_type" ("id", "label")
     values
       ('skill', 'Agent Skill'),
       ('plugin', 'Claude Code Plugin'),
       ('catalog', 'Plugin Marketplace'),
       ('mcp_server', 'MCP Server'),
       ('command', 'Slash Command'),
       ('hook', 'Hook Configuration')
     on conflict do nothing`,
  );

  console.log(
    applied === 0
      ? `${schema}: already up to date (${migrations.length} migration(s) on disk).`
      : `${schema}: applied ${applied} of ${migrations.length} migration(s).`,
  );
} finally {
  await sql.end();
}
