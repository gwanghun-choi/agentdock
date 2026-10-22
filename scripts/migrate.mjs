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

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import postgres from 'postgres';
import { assertTestDatabaseUrl } from '../src/db/testDatabase.ts';
import {
  checkHistory,
  planMigrations,
  productionTargetRejection,
  targetFingerprint,
} from './migration-gate.mjs';

// Allowlisted, so the identifier interpolated below can only ever be one of two
// literals AgentDock owns.
const schema = process.env.DATABASE_SCHEMA ?? 'agentdock';
if (schema !== 'agentdock' && schema !== 'agentdock_test') {
  console.error(
    `Refusing to migrate "${schema}". AgentDock owns only agentdock and agentdock_test.`,
  );
  process.exit(1);
}

// The test schema is migrated only inside the disposable local database, and
// only from TEST_DATABASE_URL. Bun loads .env into this process before the first
// line runs, so `DATABASE_SCHEMA=agentdock_test bun scripts/migrate.mjs` used to
// migrate agentdock_test wherever .env's DATABASE_URL pointed — the deployment's
// database included. The message names the rule and never the URL.
// --test-database applies the reviewed drizzle/ migrations to `agentdock`
// inside that same local database (`bun run db:test:migrations`), so CI runs
// the files a deployment runs, not only DDL regenerated from schema.ts.
let url = process.env.DATABASE_URL;
if (schema === 'agentdock_test' || process.argv.includes('--test-database')) {
  try {
    url = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL, 'TEST_DATABASE_URL');
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
if (!url) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const folder = process.env.MIGRATIONS_OUT ?? './drizzle';
const migrations = readMigrationFiles({ migrationsFolder: folder });
const journal = join(folder, 'meta', '_journal.json');
const tags = new Map(
  existsSync(journal)
    ? JSON.parse(readFileSync(journal, 'utf8')).entries.map((e) => [e.when, e.tag])
    : [],
);

// `agentdock` is the schema a deployment serves from, so it is the one whose
// history is checked and whose pending files go through the risk rule
// (scripts/migration-gate.mjs). agentdock_test is regenerated from schema.ts
// under a fresh tag on every `db:test:setup`, so its history is disposable by
// design and checking it would only fail every second local setup.
const gated = schema === 'agentdock';
const planOnly = process.argv.includes('--plan');
const requireCurrent = process.argv.includes('--require-current');
const production = process.argv.includes('--production');
const approved = new Set(
  (process.env.AGENTDOCK_APPROVED_MIGRATIONS ?? '').split(/[\s,]+/).filter(Boolean),
);

// --production: the deploy workflow's target check, before any connection.
// The URL must be a hosted, direct (not pooled) endpoint whose fingerprint
// equals the pin the operator stored beside the secret. Nothing here prints
// the URL or its host — only the fingerprint, which is a hash.
if (production) {
  const reason = productionTargetRejection(url, process.env.AGENTDOCK_TARGET_FINGERPRINT);
  if (reason) {
    console.error(`Refusing the production target: ${reason}.`);
    process.exit(1);
  }
}
if (process.argv.includes('--fingerprint')) {
  console.log(`target fingerprint ${targetFingerprint(url)}`);
  process.exit(0);
}

// Waiting longer than this for a lock means something else holds the table —
// a sync's write transaction, or another migrator. Failing and leaving the
// deploy blocked is better than queueing an ACCESS EXCLUSIVE lock that every
// web query then waits behind. Covers the advisory lock below as well.
const LOCK_TIMEOUT = '15s';

const sql = postgres(url, { max: 1, connection: { search_path: schema }, onnotice: () => {} });

const historyTable = `"${schema}"."__drizzle_migrations"`;
const readHistory = async (q) =>
  q.unsafe(`select hash, created_at from ${historyTable} order by created_at`);

function printPlan(plan) {
  for (const problem of plan.problems) console.log(`  history: ${problem}`);
  for (const item of plan.items) {
    const state =
      item.blocked.length > 0
        ? 'BLOCKED'
        : item.approval.length === 0
          ? 'auto'
          : item.approved
            ? 'approved'
            : 'needs approval';
    console.log(`  pending: ${item.tag} — ${state}`);
    for (const reason of [...item.blocked, ...item.approval]) console.log(`      ${reason}`);
  }
}

try {
  if (planOnly) {
    // Read-only: no CREATE, no lock, no write. Safe against the deployment's
    // database from an operator's machine before the first automated deploy.
    const [{ exists }] = await sql.unsafe(`select to_regclass($1) is not null as exists`, [
      `${schema}.__drizzle_migrations`,
    ]);
    const applied = exists ? await readHistory(sql) : [];
    const plan = planMigrations({ applied, onDisk: migrations, tags, approved, production });
    if (production) console.log(`target fingerprint ${targetFingerprint(url)}`);
    console.log(
      `${schema}: ${applied.length} applied, ${plan.items.length} pending, ${migrations.length} on disk — ${plan.verdict}`,
    );
    printPlan(plan);
    if (plan.verdict === 'BLOCKED') process.exitCode = 1;
    else if (plan.verdict === 'NEEDS_APPROVAL') process.exitCode = 2;
    else if (requireCurrent && plan.verdict !== 'UP_TO_DATE') {
      console.error(`${schema} is behind this checkout; apply the pending migrations first.`);
      process.exitCode = 1;
    }
  } else {
    let applied = 0;
    await sql.begin(async (tx) => {
      await tx.unsafe(`set local lock_timeout = '${LOCK_TIMEOUT}'`);
      // Serialises migrators through the database itself, which every runner,
      // laptop and workflow reaches — GitHub's concurrency group only covers
      // runs of one workflow. Transaction-scoped: released on commit, on
      // rollback and when a killed runner's connection drops.
      await tx.unsafe(`select pg_advisory_xact_lock(hashtext($1))`, [
        `agentdock:migrate:${schema}`,
      ]);
      await tx.unsafe(`
        CREATE TABLE IF NOT EXISTS ${historyTable} (
          id SERIAL PRIMARY KEY,
          hash text NOT NULL,
          created_at bigint
        )
      `);

      // Read under the lock: a second migrator that read it before the first
      // committed would apply the same files again.
      const history = await readHistory(tx);
      if (gated) {
        const plan = planMigrations({
          applied: history,
          onDisk: migrations,
          tags,
          approved,
          production,
        });
        printPlan(plan);
        if (plan.verdict === 'BLOCKED' || plan.verdict === 'NEEDS_APPROVAL') {
          const error = new Error(
            plan.verdict === 'BLOCKED'
              ? `${schema}: refusing to migrate — see the lines above.`
              : `${schema}: pending migrations need approval. After a backup, set ` +
                  'AGENTDOCK_APPROVED_MIGRATIONS to the tags marked "needs approval".',
          );
          error.exitCode = plan.verdict === 'BLOCKED' ? 1 : 2;
          throw error;
        }
      }
      const lastApplied = history.length > 0 ? Number(history.at(-1).created_at) : null;

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
        await tx.unsafe(`insert into ${historyTable} ("hash", "created_at") values ($1, $2)`, [
          migration.hash,
          migration.folderMillis,
        ]);
        applied += 1;
      }

      // Verified before commit, so a mismatch rolls the whole run back.
      if (gated) {
        const after = checkHistory(await readHistory(tx), migrations);
        if (after.problems.length > 0 || after.pending.length > 0) {
          throw new Error(`${schema}: history does not match the checkout after applying.`);
        }
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
         ('hook', 'Hook Configuration'),
         ('agent', 'Subagent')
       on conflict do nothing`,
    );

    console.log(
      applied === 0
        ? `${schema}: already up to date (${migrations.length} migration(s) on disk).`
        : `${schema}: applied ${applied} of ${migrations.length} migration(s).`,
    );
  }
} catch (error) {
  // Named, never quoted: a driver error for an unreachable host carries the
  // address, and these lines land in a public repository's Actions log.
  // PostgreSQL's own messages (a failed statement, 55P03 lock_not_available,
  // 42501 insufficient_privilege) name SQL objects only.
  const server = typeof error?.severity === 'string';
  console.error(
    server
      ? `migrate failed: ${error.code} ${error.message}`
      : error?.exitCode
        ? error.message
        : `migrate failed: ${error?.code ?? error?.name ?? 'error'}${error?.code ? '' : ` — ${error?.message}`}`,
  );
  process.exitCode = error?.exitCode ?? 1;
} finally {
  await sql.end();
}
