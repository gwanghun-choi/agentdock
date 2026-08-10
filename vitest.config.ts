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
    // .tsx is here because the injection suite renders components. Without it
    // the whole suite would pass by never running.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.ts'],
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
});
