import postgres from 'postgres';
import { describe, expect, it } from 'vitest';
import {
  OPS_APPLICATION_NAME,
  OPS_STATEMENT_TIMEOUT_MS,
  readOnlyChecks,
  readOnlyTarget,
} from './readOnly';

const DB_URL = process.env.DATABASE_URL;
const SCHEMA = 'agentdock_test';
const expected = {
  schema: SCHEMA,
  role: 'agentdock_app',
  statementTimeoutMs: OPS_STATEMENT_TIMEOUT_MS,
};

function urlOf(raw: string, timeoutMs?: number): string {
  const target = readOnlyTarget(raw, timeoutMs);
  if ('refused' in target) throw new Error(target.refused);
  return target.url;
}

const pool = (url: string, options: { idle_timeout?: number } = {}) =>
  postgres(url, { max: 4, connection: { search_path: SCHEMA }, onnotice: () => {}, ...options });

const failing = (checks: { check: string; ok: boolean }[]) =>
  checks.filter((c) => !c.ok).map((c) => c.check);

describe('readOnlyTarget', () => {
  it('adds the read-only, timeout and name settings and keeps the rest', () => {
    const url = new URL(
      urlOf(
        'postgresql://app:pw@db.example.com/agentdock?sslmode=require&default_transaction_read_only=off&statement_timeout=0',
      ),
    );
    expect(url.searchParams.get('options')).toBe(
      `-c default_transaction_read_only=on -c statement_timeout=${OPS_STATEMENT_TIMEOUT_MS}`,
    );
    // A separate startup parameter is applied after `options` and would win.
    expect(url.searchParams.has('default_transaction_read_only')).toBe(false);
    expect(url.searchParams.has('statement_timeout')).toBe(false);
    expect(url.searchParams.get('application_name')).toBe(OPS_APPLICATION_NAME);
    expect(url.searchParams.get('sslmode')).toBe('require');
  });

  it('appends to an options value the URL already carries, so its own -c cannot win', () => {
    const url = new URL(
      urlOf(
        'postgresql://app:pw@db.example.com/agentdock?options=-c%20default_transaction_read_only%3Doff',
      ),
    );
    expect(url.searchParams.get('options')).toBe(
      '-c default_transaction_read_only=off -c default_transaction_read_only=on ' +
        `-c statement_timeout=${OPS_STATEMENT_TIMEOUT_MS}`,
    );
  });

  // The mechanism the guarantee rests on: postgres.js turns a query parameter
  // it does not consume into a startup parameter on every connection, and the
  // settings ride in `options` — the one a proxy that drops the rest of the
  // startup packet still forwards (Phase 35: six scheduled runs saw the
  // separate parameters arrive nowhere). Constructing a client opens no
  // connection.
  it('reaches postgres.js as the options startup parameter', () => {
    const client = postgres(urlOf('postgresql://app:pw@db.example.com/agentdock'));
    expect(client.options.connection).toMatchObject({
      options: `-c default_transaction_read_only=on -c statement_timeout=${OPS_STATEMENT_TIMEOUT_MS}`,
      application_name: OPS_APPLICATION_NAME,
    });
    expect(client.options.connect_timeout).toBe(10);
  });

  it.each([
    [undefined, /missing/],
    ['', /missing/],
    ['mysql://app:pw@db.example.com/x', /missing or not a postgres/],
    ['postgresql://app:pw@[bad/x', /does not parse/],
    ['postgresql://app:pw@ep-cool-name-123-pooler.us-east-2.aws.neon.tech/db', /pooled/],
    ['postgres://app:pw@EP-X-POOLER.example.com/db', /pooled/],
  ])('refuses %s', (raw, reason) => {
    const target = readOnlyTarget(raw);
    expect('refused' in target && target.refused).toMatch(reason);
  });

  it('never repeats the URL, user, host or password in a refusal', () => {
    for (const raw of [
      'postgresql://secret_user:hunter2-pw@ep-secret-host-pooler.neon.tech/secret_db',
      'mysql://secret_user:hunter2-pw@secret-host/secret_db',
      'postgresql://secret_user:hunter2-pw@[secret-host/secret_db',
    ]) {
      const target = readOnlyTarget(raw);
      expect('refused' in target).toBe(true);
      expect(JSON.stringify(target)).not.toMatch(/secret|hunter2/);
    }
  });
});

describe.skipIf(!DB_URL)('readOnlyChecks against the test database', () => {
  const url = () => urlOf(DB_URL as string);

  it('passes, on every connection of a filled pool, and the server refuses writes', async () => {
    const sql = pool(url());
    try {
      const checks = await readOnlyChecks(sql, expected);
      expect(failing(checks)).toEqual([]);
      expect(checks.map((c) => c.check)).toContain('4 of 4 pool connections opened and checked');
      await expect(
        sql`INSERT INTO schema_meta (key, value) VALUES ('ro-spec', '1')`,
      ).rejects.toMatchObject({
        code: '25006',
      });
      await expect(sql`CREATE TEMP TABLE ro_spec (x int)`).rejects.toMatchObject({ code: '25006' });
      await expect(
        sql.begin((tx) => tx`UPDATE schema_meta SET value = value`),
      ).rejects.toMatchObject({
        code: '25006',
      });
    } finally {
      await sql.end({ timeout: 1 });
    }
  });

  it('holds on connections the pool opens later, after idle ones closed', async () => {
    const sql = pool(url(), { idle_timeout: 0.2 });
    try {
      const before = await sql<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      await new Promise((r) => setTimeout(r, 600));
      const checks = await readOnlyChecks(sql, expected);
      expect(failing(checks)).toEqual([]);
      const after = await sql<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      expect(after[0].pid).not.toBe(before[0].pid);
    } finally {
      await sql.end({ timeout: 1 });
    }
  });

  // Fail closed: the same checks on a connection that is NOT read-only. The
  // probe's write is accepted and rolled back, and nothing is left behind.
  it('fails when the connection is writable', async () => {
    const writable = new URL(url());
    writable.searchParams.set('default_transaction_read_only', 'off');
    const sql = pool(writable.href);
    try {
      expect(failing(await readOnlyChecks(sql, expected))).toEqual([
        'default_transaction_read_only = on on every connection',
        'transaction_read_only = on on every connection',
        'a write is refused by the server (expected 25006, got accepted, rolled back)',
      ]);
    } finally {
      await sql.end({ timeout: 1 });
    }
  });

  it('fails on another schema, another role or another timeout', async () => {
    const sql = pool(url());
    try {
      expect(
        failing(
          await readOnlyChecks(sql, {
            schema: 'agentdock',
            role: 'someone_else',
            statementTimeoutMs: 1000,
          }),
        ),
      ).toEqual([
        'statement_timeout = 1000 ms on every connection',
        'connected as someone_else',
        'search_path is exactly agentdock',
      ]);
    } finally {
      await sql.end({ timeout: 1 });
    }
  });

  it('fails a pool it could not fill rather than passing on the connections it saw', async () => {
    const sql = pool(url());
    try {
      // One connection held for the whole check: the pool can open only 3 of 4.
      const held = sql.reserve();
      const reserved = await held;
      const pending = readOnlyChecks(sql, expected);
      await new Promise((r) => setTimeout(r, 200));
      reserved.release();
      const checks = await pending;
      expect(failing(checks)).toContain('4 of 4 pool connections opened and checked');
    } finally {
      await sql.end({ timeout: 1 });
    }
  });

  it('applies the statement timeout at the server', async () => {
    const sql = pool(urlOf(DB_URL as string, 100));
    try {
      expect(failing(await readOnlyChecks(sql, { ...expected, statementTimeoutMs: 100 }))).toEqual(
        [],
      );
      await expect(sql`SELECT pg_sleep(1)`).rejects.toMatchObject({ code: '57014' });
    } finally {
      await sql.end({ timeout: 1 });
    }
  });

  it('rejects, never passes, when the database cannot be reached', async () => {
    const unreachable = new URL(url());
    unreachable.port = '1';
    const sql = pool(unreachable.href);
    try {
      await expect(readOnlyChecks(sql, expected)).rejects.toMatchObject({ code: 'ECONNREFUSED' });
    } finally {
      await sql.end({ timeout: 1 });
    }
  });

  it('leaves no session open after end()', async () => {
    const sql = pool(url());
    const observer = postgres(DB_URL as string, { max: 1, onnotice: () => {} });
    try {
      await readOnlyChecks(sql, expected);
      const open = () =>
        observer<{ n: number }[]>`
          SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name = ${OPS_APPLICATION_NAME}
            AND backend_start > now() - interval '1 minute' AND pid <> pg_backend_pid()`;
      expect((await open())[0].n).toBeGreaterThanOrEqual(4);
      await sql.end({ timeout: 1 });
      let n = -1;
      for (let i = 0; i < 20 && n !== 0; i++) {
        await new Promise((r) => setTimeout(r, 100));
        [{ n }] = await open();
      }
      expect(n).toBe(0);
    } finally {
      await observer.end();
    }
  });
});
