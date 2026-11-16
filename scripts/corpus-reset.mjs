#!/usr/bin/env node
// scripts/corpus-reset.mjs
//
// Empties AgentDock's CORPUS — every repository, artifact, version, finding,
// seed and job — and leaves the schema itself exactly as it was.
//
//   AGENTDOCK_ALLOW_CORPUS_RESET=1 bun run corpus:reset --confirm
//
// This exists because a policy change (a star floor, a different detector) makes
// the stored corpus a mixture of two policies, and the honest fix is to rebuild
// it rather than to reason about which rows came from which. It is a maintenance
// command, not a migration: `bun run db:migrate` never deletes a row and this
// never changes a definition.
//
// WHAT IT DOES NOT DO, structurally:
//
//   * No DROP of anything. No DROP SCHEMA, DROP TABLE, DROP INDEX, DROP TYPE,
//     DROP EXTENSION. One TRUNCATE of the tables this file names literally, no
//     CASCADE, and a DELETE of named schema_meta keys.
//   * No table outside `agentdock`. Every name below is schema-qualified with a
//     literal; this script takes no schema argument and interpolates nothing.
//   * No reference or configuration data. artifact_type is the dimension the
//     foreign keys point at, repository_denylist is the record of what must
//     never come back, and __drizzle_migrations is the migration history. All
//     three survive.
//   * Nothing outside AgentDock can be reached even if the above were wrong:
//     agentdock_app owns no object in any other schema and holds no privilege
//     on one, so a statement that escaped this file fails with a permission
//     error rather than succeeding.
//
// Four gates, and all four must pass:
//   1. AGENTDOCK_ALLOW_CORPUS_RESET=1 in the environment
//   2. --confirm on the command line
//   3. DATABASE_SCHEMA is one of the two schemas AgentDock owns
//   4. the connected role reports that schema as its current_schema
//
// The database NAME is deliberately not asserted. AgentDock is meant to be
// self-hosted, so the database it lives in differs per deployment and a literal
// here would be one deployment's name pretending to be a safety property. The
// schema is the boundary, and it is the thing checked.

import postgres from 'postgres';

const schema = process.env.DATABASE_SCHEMA ?? 'agentdock';
if (schema !== 'agentdock' && schema !== 'agentdock_test') {
  console.error(`Refusing to reset "${schema}". AgentDock owns only agentdock and agentdock_test.`);
  process.exit(1);
}

if (process.env.AGENTDOCK_ALLOW_CORPUS_RESET !== '1') {
  console.error('Refusing to reset the corpus.');
  console.error('');
  console.error('This deletes every repository, artifact, version, capability finding,');
  console.error(`seed and ingest job in the "${schema}" schema. Rebuilding it costs two`);
  console.error('GitHub core requests per repository, out of sixty an hour unauthenticated.');
  console.error('');
  console.error('Re-run as:');
  console.error(`  AGENTDOCK_ALLOW_CORPUS_RESET=1 bun run corpus:reset --confirm`);
  process.exit(1);
}

if (!process.argv.includes('--confirm')) {
  console.error('AGENTDOCK_ALLOW_CORPUS_RESET is set, but --confirm is missing.');
  console.error('Two gates, deliberately: an exported variable outlives the command it was');
  console.error('exported for, so it cannot be the only thing standing between a shell and');
  console.error('an empty corpus.');
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

/**
 * Every corpus table, named. One TRUNCATE takes them together, and WITHOUT
 * CASCADE: a table outside this list that gained a foreign key into one of them
 * makes the statement fail and change nothing, rather than empty that table too.
 *
 * TRUNCATE, not DELETE, since 2026-11-16. The first reset of a hosted corpus
 * ran at its storage allowance (Neon project size limit, SQLSTATE 53100,
 * docs/analysis/agentdock-phase98-sync-53100.md). A DELETE leaves every file its
 * size, so the project stays at the limit and the next statement that grows a
 * file — an insert, or a migration's CREATE INDEX — fails exactly as before.
 * TRUNCATE gives each table a new empty file and frees the old one at commit.
 * It takes ACCESS EXCLUSIVE on all seven until then; lock_timeout bounds the
 * wait behind a reader to 5 s, after which it fails and changes nothing.
 */
const TABLES = [
  'capability_finding',
  'package_version',
  'package',
  'repository',
  'ingest_attempt',
  'ingest_job',
  'repo_seed',
];

const sql = postgres(url, { max: 1, connection: { search_path: schema }, onnotice: () => {} });

try {
  const [where] = await sql.unsafe(
    'select current_schema() as schema, current_user as role, current_database() as db',
  );
  if (where.schema !== schema) {
    throw new Error(
      `Refusing to reset: connected with current_schema() = "${where.schema}", expected "${schema}". ` +
        'The connection is not confined to the schema this run targets.',
    );
  }
  console.log(`corpus-reset: ${where.role}@${where.db}, schema ${where.schema}`);

  // Counted and emptied in one transaction, so the counts are what was emptied.
  const deleted = await sql.begin(async (tx) => {
    await tx.unsafe(`set local lock_timeout = '5s'`);
    // Locked before counting, so no row committed between the count and the
    // TRUNCATE goes uncounted.
    await tx.unsafe(
      `lock table ${TABLES.map((t) => `"${schema}"."${t}"`).join(', ')} in access exclusive mode`,
    );
    const counts = [];
    for (const table of TABLES) {
      // Schema-qualified with the validated literal, table name from the frozen
      // list above. Nothing here comes from an argument.
      const [row] = await tx.unsafe(`select count(*)::bigint as n from "${schema}"."${table}"`);
      counts.push([table, Number(row.n)]);
    }
    await tx.unsafe(`truncate ${TABLES.map((t) => `"${schema}"."${t}"`).join(', ')}`);
    return counts;
  });

  // A second transaction, after the first has freed the space: a DELETE is
  // refused while a hosted project is over its limit. If this one fails, the
  // corpus is already empty and running the reset again finishes it — the home
  // page meanwhile drops snapshot rows that no longer exist (homeSnapshot.ts).
  //
  // The corpus sweep cursors describe a corpus that no longer exists, so leaving
  // them would make the next registry sync resume past everything this reset
  // just removed. The home snapshot would link to artifacts that are gone. The
  // two sync:* keys describe runs over that corpus: the home page would say a
  // sync finished beside "Nothing indexed yet", and the next run would compare
  // its queue with the old one. `last_boot` is a deployment fact and stays.
  let cursors;
  try {
    cursors = await sql.unsafe(
      `delete from "${schema}"."schema_meta" where key like 'corpus_sweep:%' or key = 'home:snapshot' or key in ('sync:last_success', 'sync:last_attempt') returning 1`,
    );
  } catch (error) {
    // Said before failing: the tables ARE empty, and the cursors left behind
    // would make the next sync resume past everything that was just removed.
    for (const [table, n] of deleted) {
      console.error(`corpus-reset:   ${String(n).padStart(7)} row(s) from ${table} — TRUNCATED`);
    }
    console.error(
      `corpus-reset: the corpus tables were emptied, but the schema_meta keys were NOT cleared (${error?.code ?? 'no code'}). Run corpus:reset again before any sync.`,
    );
    process.exit(1);
  }
  deleted.push(['schema_meta (corpus_sweep cursors, home snapshot, sync state)', cursors.length]);

  for (const [table, n] of deleted) {
    console.log(`corpus-reset:   ${String(n).padStart(7)} row(s) from ${table}`);
  }
  console.log(
    `corpus-reset: ${schema} corpus emptied (counts are rows before the TRUNCATE). artifact_type, repository_denylist and ` +
      '__drizzle_migrations were not touched, and no object was dropped.',
  );
  console.log('corpus-reset: run `bun run sync` to rebuild it under the current policy.');
} finally {
  await sql.end();
}
