import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

// The test schema, like every other DB-backed suite, so this connection passes
// through env.ts's local-test-database fence too.
process.env.DATABASE_SCHEMA = 'agentdock_test';

const DB_URL = process.env.DATABASE_URL;

describe.skipIf(!DB_URL)('assertSchemaIsolation', () => {
  it('accepts the real application connection', async () => {
    const { assertSchemaIsolation, sql } = await import('./client');
    await expect(assertSchemaIsolation(sql)).resolves.toBeUndefined();
    await sql.end();
  });

  it('refuses a search_path that reaches beyond an AgentDock schema', async () => {
    const { assertSchemaIsolation } = await import('./client');
    const loose = postgres(DB_URL as string, {
      max: 1,
      connection: { search_path: 'agentdock, public' },
    });
    try {
      await expect(assertSchemaIsolation(loose)).rejects.toThrow(/search_path/);
    } finally {
      await loose.end();
    }
  });

  // A property of the server's pg_hba, not of AgentDock. The disposable test
  // database authenticates by trust so no password exists anywhere
  // (scripts/sql/bootstrap-test-database.sql); against a password-checked
  // server — a URL that carries one — this still runs.
  it.skipIf(!DB_URL || !new URL(DB_URL).password)(
    'rejects a connection carrying the wrong password',
    async () => {
      const wrong = (DB_URL as string).replace(
        /:\/\/([^:/]+):[^@]*@/,
        '://$1:definitely-not-the-configured-password@',
      );
      const bad = postgres(wrong, { max: 1, connection: { search_path: 'agentdock' } });
      try {
        await expect(bad`SELECT 1`).rejects.toThrow();
      } finally {
        await bad.end();
      }
    },
  );
});
