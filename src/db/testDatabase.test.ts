import { describe, expect, it } from 'vitest';
import {
  assertTestDatabaseUrl,
  isolateTestEnvironment,
  testDatabaseRejection,
} from './testDatabase';

// Never a real credential and never a reachable host: nothing here connects.
const SECRET = 'sentinel-password-never-printed';
const LOCAL = `postgres://agentdock_app:${SECRET}@127.0.0.1:55432/agentdock_test`;

describe('testDatabaseRejection', () => {
  it('accepts the local test database on each loopback spelling', () => {
    expect(testDatabaseRejection(LOCAL)).toBeNull();
    expect(testDatabaseRejection(LOCAL.replace('127.0.0.1', 'localhost'))).toBeNull();
    expect(testDatabaseRejection(LOCAL.replace('127.0.0.1', '[::1]'))).toBeNull();
    expect(testDatabaseRejection(LOCAL.replace('postgres://', 'postgresql://'))).toBeNull();
  });

  it.each([
    ['no URL', undefined, /no test database URL/],
    ['an empty URL', '', /no test database URL/],
    ['not postgres', 'mysql://u:p@127.0.0.1:55432/agentdock_test', /postgres:\/\//],
    ['garbage', 'postgres://%zz@127.0.0.1:55432/agentdock_test', /parse/],
    [
      'a Neon pooled host',
      `postgres://u:${SECRET}@ep-cool-name-a1b2c3-pooler.ap-southeast-1.aws.neon.tech/agentdock_test`,
      /Neon/,
    ],
    [
      'a Neon host on the allowed port and name',
      `postgres://u:${SECRET}@ep-x.neon.tech:55432/agentdock_test`,
      /Neon/,
    ],
    ['an external host', `postgres://u:${SECRET}@db.example.com:55432/agentdock_test`, /host/],
    ['a private-network host', `postgres://u:${SECRET}@10.0.0.5:55432/agentdock_test`, /host/],
    ['the default port', LOCAL.replace(':55432', ':5432'), /port/],
    ['no port', LOCAL.replace(':55432', ''), /port/],
    ['another database', LOCAL.replace('/agentdock_test', '/mcpdb'), /database/],
    [
      'the production schema as a database',
      LOCAL.replace('/agentdock_test', '/agentdock'),
      /database/,
    ],
    ['a query string', `${LOCAL}?search_path=public`, /query/],
    ['a second host', LOCAL.replace(':55432', ':55432,ep-x.neon.tech:5432'), /Neon/],
    [
      'a second loopback host',
      LOCAL.replace(':55432', ':55432,10.0.0.5:5432'),
      /more than one host/,
    ],
    ['an encoded comma', `postgres://u:a%2Cb@127.0.0.1:55432/agentdock_test`, /more than one host/],
    ['a unix socket', 'postgres://u:p@%2Fvar%2Frun%2Fpostgresql/agentdock_test', /host|parse/],
  ])('rejects %s', (_name, url, reason) => {
    expect(testDatabaseRejection(url)).toMatch(reason);
  });

  it('never quotes the URL, the host or the password in its reason', () => {
    const urls = [
      `postgres://u:${SECRET}@ep-x.neon.tech/agentdock_test`,
      `postgres://u:${SECRET}@db.example.com:55432/agentdock_test`,
      `${LOCAL}?password=${SECRET}`,
    ];
    for (const url of urls) {
      const message = (() => {
        try {
          assertTestDatabaseUrl(url, 'TEST_DATABASE_URL');
          return '';
        } catch (error) {
          return (error as Error).message;
        }
      })();
      expect(message).toMatch(/TEST_DATABASE_URL/);
      expect(message).not.toContain(SECRET);
      expect(message).not.toContain('ep-x');
      expect(message).not.toContain('example.com');
    }
  });
});

describe('isolateTestEnvironment', () => {
  it('drops an inherited DATABASE_URL when no test URL is set', () => {
    const env: Record<string, string | undefined> = {
      DATABASE_URL: `postgres://u:${SECRET}@ep-x.neon.tech/neondb`,
    };
    isolateTestEnvironment(env);
    expect(env.DATABASE_URL).toBeUndefined();
  });

  it('takes DATABASE_URL from an allowed TEST_DATABASE_URL, never from DATABASE_URL', () => {
    const env: Record<string, string | undefined> = {
      DATABASE_URL: `postgres://u:${SECRET}@ep-x.neon.tech/neondb`,
      TEST_DATABASE_URL: LOCAL,
    };
    isolateTestEnvironment(env);
    expect(env.DATABASE_URL).toBe(LOCAL);
  });

  it('refuses to start on a disallowed TEST_DATABASE_URL', () => {
    const env = { TEST_DATABASE_URL: `postgres://u:${SECRET}@ep-x.neon.tech/agentdock_test` };
    expect(() => isolateTestEnvironment(env)).toThrow(/Refusing to use TEST_DATABASE_URL/);
  });

  it('fails instead of skipping when the database is required', () => {
    expect(() => isolateTestEnvironment({ REQUIRE_TEST_DATABASE: '1' })).toThrow(
      /REQUIRE_TEST_DATABASE/,
    );
  });

  // The config ran before this file loaded. Whatever this run was started with
  // — `bun run test`, a bare `bunx vitest run`, `bun test`, a .env full of
  // production values — the URL a suite can see is either absent or local.
  it('left this very run with no URL or the local one', () => {
    const url = process.env.DATABASE_URL;
    if (url !== undefined) expect(testDatabaseRejection(url)).toBeNull();
  });
});
