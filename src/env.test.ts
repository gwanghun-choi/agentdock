import { describe, expect, it } from 'vitest';
import { parseEnv } from './env';

const SENTINEL = 'sentinel-value-that-is-not-a-real-password';

const valid = {
  DATABASE_URL: `postgres://agentdock_app:${SENTINEL}@localhost:5432/mcpdb`,
};

describe('parseEnv', () => {
  it('accepts a valid environment and defaults NODE_ENV', () => {
    const env = parseEnv(valid);
    expect(env.DATABASE_URL).toContain('postgres://');
    expect(env.NODE_ENV).toBe('development');
  });

  it('names the missing variable and points at .env.example', () => {
    expect(() => parseEnv({})).toThrowError(/DATABASE_URL/);
    expect(() => parseEnv({})).toThrowError(/\.env\.example/);
  });

  it('rejects a connection string that is not PostgreSQL', () => {
    expect(() => parseEnv({ DATABASE_URL: 'mysql://localhost:3306/mcpdb' })).toThrowError(
      /postgres:\/\//,
    );
  });

  it('never echoes a credential into the error message', () => {
    let message = '';
    try {
      parseEnv({ DATABASE_URL: `mysql://agentdock_app:${SENTINEL}@localhost:3306/mcpdb` });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toMatch(/DATABASE_URL/);
    expect(message).not.toContain(SENTINEL);
  });

  it('defaults DATABASE_SCHEMA to the owned schema', () => {
    expect(parseEnv(valid).DATABASE_SCHEMA).toBe('agentdock');
  });

  it('rejects a schema AgentDock does not own', () => {
    expect(() => parseEnv({ ...valid, DATABASE_SCHEMA: 'public' })).toThrowError(/DATABASE_SCHEMA/);
  });

  it('accepts the test schema', () => {
    expect(parseEnv({ ...valid, DATABASE_SCHEMA: 'agentdock_test' }).DATABASE_SCHEMA).toBe(
      'agentdock_test',
    );
  });
});
