/**
 * The one database a test may touch: a disposable PostgreSQL on this machine
 * (or on the CI runner), on a port nothing else uses, under a database name
 * nothing else uses.
 *
 * Why an allowlist and not "skip when DATABASE_URL is unset": on 2026-10-21 a
 * review agent ran `bunx vitest run` with no DATABASE_URL in its shell, the old
 * vitest.config.ts loaded .env on its own, and a DB-backed suite connected to
 * the deployment's database — it failed only because agentdock_test held no
 * tables there. Every guard keyed on "is a URL set" passes in that situation.
 * This one asks where the URL points.
 *
 * Exact, not a pattern: loopback only, port 55432 (not 5432, where a shared
 * development instance with another application's data lives — .env.example's
 * default), database `agentdock_test`, no query string (postgres.js forwards
 * unknown query parameters as startup parameters, so `?search_path=public`
 * would override the client's own) and one host (postgres.js accepts
 * `h1,h2` and falls back to PGHOST when the URL names none).
 */
export const TEST_DATABASE = {
  hosts: ['127.0.0.1', 'localhost', '[::1]'],
  port: '55432',
  database: 'agentdock_test',
} as const;

/**
 * Why `url` is not an allowed test database, or null when it is.
 *
 * The reason never quotes the URL or any part of it: the string holds a
 * password, and these messages land in terminals and CI logs. A Neon host gets
 * its own sentence because that is the mistake this module exists for.
 */
export function testDatabaseRejection(url: string | undefined): string | null {
  if (!url) return 'no test database URL is set';
  if (!/^postgres(ql)?:\/\//.test(url)) return 'it is not a postgres:// connection string';

  // The authority exactly as postgres.js reads it (src/index.js parseUrl):
  // after the scheme, before the first / or ?, after the last credential @.
  const authority = url.slice(url.indexOf('://') + 3).split(/[?/]/)[0];
  const hostPart = authority.slice(authority.lastIndexOf('@') + 1).toLowerCase();
  if (/neon\.tech|neon\.build|\.neon\./.test(hostPart)) {
    return 'it points at a Neon host — tests never run against a hosted database';
  }
  // Decoded, as postgres.js decodes before it splits on commas: an encoded
  // comma in the password would otherwise reach its multi-host split.
  let decoded: string;
  try {
    decoded = decodeURIComponent(authority);
  } catch {
    return 'it does not parse as a URL';
  }
  if (decoded.includes(',')) return 'it names more than one host';

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'it does not parse as a URL';
  }
  if (!(TEST_DATABASE.hosts as readonly string[]).includes(parsed.hostname)) {
    return `its host is not one of ${TEST_DATABASE.hosts.join(', ')}`;
  }
  if (parsed.port !== TEST_DATABASE.port) return `its port is not ${TEST_DATABASE.port}`;
  if (parsed.pathname !== `/${TEST_DATABASE.database}`) {
    return `its database is not ${TEST_DATABASE.database}`;
  }
  if (parsed.search !== '') return 'it carries query parameters';
  return null;
}

/** Throws a message that names the rule and never the value. */
export function assertTestDatabaseUrl(url: string | undefined, variable: string): string {
  const reason = testDatabaseRejection(url);
  if (reason !== null) {
    throw new Error(
      `Refusing to use ${variable}: ${reason}. A test database is a local PostgreSQL at ` +
        `postgres://agentdock_app:…@127.0.0.1:${TEST_DATABASE.port}/${TEST_DATABASE.database} ` +
        '(docs/analysis/agentdock-phase3-operations-and-test-safety.md).',
    );
  }
  return url as string;
}

/**
 * What every test runner does before the first suite loads: drop whatever
 * DATABASE_URL arrived (the shell's, or one Bun read from .env), and take one
 * only from TEST_DATABASE_URL, which must pass the allowlist above. Called from
 * vitest.config.ts and, for Bun's own `bun test` (which also runs these suites
 * and loads .env on its own), from bunfig.toml's test preload.
 *
 * REQUIRE_TEST_DATABASE=1 turns "no URL, the database suites skip" into a
 * failure, for the CI job whose whole purpose is running them.
 */
export function isolateTestEnvironment(env: Record<string, string | undefined>): void {
  delete env.DATABASE_URL;
  if (env.TEST_DATABASE_URL) {
    env.DATABASE_URL = assertTestDatabaseUrl(env.TEST_DATABASE_URL, 'TEST_DATABASE_URL');
  } else if (env.REQUIRE_TEST_DATABASE) {
    throw new Error('REQUIRE_TEST_DATABASE is set but TEST_DATABASE_URL is not.');
  }
}
