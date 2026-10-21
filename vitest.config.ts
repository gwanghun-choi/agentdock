import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { isolateTestEnvironment } from './src/db/testDatabase.ts';

// The suites never read a connection string from .env, from the shell's
// DATABASE_URL, or from anything Bun loaded on the way here. This file used to
// load .env itself (process.loadEnvFile) so a developer's machine would run the
// database suites; on 2026-10-21 that is how a review agent's plain
// `bunx vitest run` connected a suite to the deployment's database.
//
// Now DATABASE_URL is cleared and taken only from TEST_DATABASE_URL, which must
// name the disposable local PostgreSQL or this throws before a single test file
// loads (src/db/testDatabase.ts). Here it runs in vitest's main process, so a
// bad TEST_DATABASE_URL stops the run before any worker starts.
//
// And again in every worker, via setupFiles, before its test file is imported:
// under `bunx --bun vitest` each worker is a Bun process, and Bun loads .env on
// startup — measured 2026-10-21, a worker saw .env's DATABASE_URL although the
// main process had deleted it, and one suite reached that host.
isolateTestEnvironment(process.env);

export default defineConfig({
  test: {
    environment: 'node',
    // Database-backed suites share one schema, and some of the facts they assert
    // are global by nature: MAX_QUEUED is a count over the whole ingest_job
    // table, so while jobs.test.ts's flood case holds 500 rows every other
    // suite's enqueueJob correctly returns `flooded`; claimJob takes the oldest
    // claimable row in the schema, whoever wrote it; and countUnenqueuedSeeds
    // counts every seed. Sentinel prefixes keep the ROWS apart and cannot keep
    // these COUNTS apart, so those files cannot safely run beside each other.
    //
    // Conditional, because the cost and the risk live in different places. With
    // no DATABASE_URL every one of those suites skips and no race is possible,
    // which is exactly the CI run — 4 s parallel against 21 s serialized, on
    // every push. With a database the same run is 19 s parallel and 52 s
    // serialized, and 33 s is worth a suite that is not intermittently red.
    fileParallelism: !process.env.DATABASE_URL,
    // .tsx is here because the injection suite renders components. Without it
    // the whole suite would pass by never running.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.ts'],
    setupFiles: ['./src/db/testPreload.ts'],
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
});
