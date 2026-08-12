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
//     DROP EXTENSION. Only DELETE, only from tables this file names literally.
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
 * Delete order, parent last.
 *
 * Every one of these relationships is ON DELETE CASCADE, so `DELETE FROM
 * repository` alone would take package, package_version and capability_finding
 * with it. They are named anyway: a cascade is a property of the schema that a
 * future migration can change without touching this file, and a reset that
 * silently stopped deleting findings would be discovered as a corpus that never
 * quite empties. Naming them makes the intent explicit and costs one statement
 * each against tables that are already empty by the time they run.
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

  // One transaction. A reset that failed halfway would leave package rows whose
  // repository is gone — which the foreign keys forbid, so it would fail
  // anyway, but as a confusing error rather than as a clean rollback.
  const deleted = await sql.begin(async (tx) => {
    const counts = [];
    for (const table of TABLES) {
      // Schema-qualified with the validated literal, table name from the frozen
      // list above. Nothing here comes from an argument.
      const rows = await tx.unsafe(`delete from "${schema}"."${table}" returning 1`);
      counts.push([table, rows.length]);
    }
    // The corpus sweep cursors: where each acquisition source stopped. They
    // describe a corpus that no longer exists, so leaving them would make the
    // next registry sync resume past everything this reset just removed.
    // `last_boot` is a deployment fact, not corpus state, and stays.
    const cursors = await tx.unsafe(
      `delete from "${schema}"."schema_meta" where key like 'corpus_sweep:%' returning 1`,
    );
    counts.push(['schema_meta (corpus_sweep cursors)', cursors.length]);
    return counts;
  });

  for (const [table, n] of deleted) {
    console.log(`corpus-reset:   ${String(n).padStart(7)} row(s) from ${table}`);
  }
  console.log(
    `corpus-reset: ${schema} corpus emptied. artifact_type, repository_denylist and ` +
      '__drizzle_migrations were not touched, and no object was dropped.',
  );
  console.log('corpus-reset: run `bun run sync` to rebuild it under the current policy.');
} finally {
  await sql.end();
}
