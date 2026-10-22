import { defineConfig, devices } from '@playwright/test';
import { assertTestDatabaseUrl } from './src/db/testDatabase';

// The browser journeys (e2e/), against the production build and the
// disposable test database `bun run e2e:seed` fills. The server gets that
// database and nothing else: TEST_DATABASE_URL must pass the same allowlist
// every test suite does, or this file throws before a browser starts.
const PORT = 3970;

export default defineConfig({
  testDir: 'e2e',
  // One server, one seeded database, journeys that read it — no isolation to
  // gain from parallel workers, and a serial run is under a minute.
  workers: 1,
  // A journey that fails and then passes on its retry is reported "flaky", not
  // passed: the line between an unsteady runner (passes on retry) and a
  // regression (fails both times).
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 800 },
    baseURL: `http://127.0.0.1:${PORT}`,
    contextOptions: { reducedMotion: 'reduce' },
    trace: 'retain-on-failure',
  },
  webServer: {
    // The standalone server does not serve .next/static on its own; the
    // Dockerfile copies it beside server.js the same way.
    command: 'cp -r .next/static .next/standalone/.next/ && node .next/standalone/server.js',
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    env: {
      PORT: String(PORT),
      HOSTNAME: '127.0.0.1',
      DATABASE_URL: assertTestDatabaseUrl(process.env.TEST_DATABASE_URL, 'TEST_DATABASE_URL'),
      DATABASE_SCHEMA: 'agentdock',
    },
  },
});
