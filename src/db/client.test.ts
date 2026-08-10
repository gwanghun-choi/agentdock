import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

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

  it('rejects a connection carrying the wrong password', async () => {
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
  });
});
