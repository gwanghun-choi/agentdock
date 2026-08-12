import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Bun loads .env only for processes running on the Bun runtime; vitest runs on
// Node, so it would otherwise see no DATABASE_URL and silently skip every
// database-backed test on a machine that has a database. Node 22's stdlib
// loader closes that gap with no dependency. CI has no .env, so the guarded
// suites still skip there — visibly, in the test output.
// CI is set by GitHub Actions, so `CI=1 bun run test` locally reproduces exactly
// what the runner does — which is how the "skips visibly without a database"
// claim stays checkable instead of assumed.
if (!process.env.CI && existsSync('.env')) process.loadEnvFile('.env');

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
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
});
