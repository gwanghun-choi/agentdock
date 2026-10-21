import { isolateTestEnvironment } from './testDatabase';

// Runs before each test file in the process that will import it: vitest's
// setupFiles (every worker) and bunfig.toml's [test] preload (`bun test`).
// Both are runtimes that may have read .env on their own. See
// isolateTestEnvironment.
isolateTestEnvironment(process.env);
