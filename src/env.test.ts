import { describe, expect, it } from 'vitest';
import { normalizeGithubToken, parseEnv } from './env';

const SENTINEL = 'sentinel-value-that-is-not-a-real-password';

const valid = {
  DATABASE_URL: `postgres://agentdock_app:${SENTINEL}@localhost:5432/agentdock`,
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
    expect(() => parseEnv({ DATABASE_URL: 'mysql://localhost:3306/agentdock' })).toThrowError(
      /postgres:\/\//,
    );
  });

  it('never echoes a credential into the error message', () => {
    let message = '';
    try {
      parseEnv({ DATABASE_URL: `mysql://agentdock_app:${SENTINEL}@localhost:3306/agentdock` });
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

  it('reads a whitespace-only GITHUB_TOKEN as absent', () => {
    expect(parseEnv({ ...valid, GITHUB_TOKEN: '   ' }).GITHUB_TOKEN).toBeUndefined();
    expect(parseEnv({ ...valid, GITHUB_TOKEN: '' }).GITHUB_TOKEN).toBeUndefined();
    expect(parseEnv(valid).GITHUB_TOKEN).toBeUndefined();
  });

  it('trims a real GITHUB_TOKEN and keeps it', () => {
    expect(parseEnv({ ...valid, GITHUB_TOKEN: `  ${SENTINEL}  ` }).GITHUB_TOKEN).toBe(SENTINEL);
  });

  it('never echoes a GITHUB_TOKEN into the error message', () => {
    let message = '';
    try {
      // DATABASE_SCHEMA is invalid, so the whole parse fails while a token is
      // present. If the formatter ever started echoing values, this is where it
      // would surface.
      parseEnv({ ...valid, DATABASE_SCHEMA: 'public', GITHUB_TOKEN: SENTINEL });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toMatch(/DATABASE_SCHEMA/);
    expect(message).not.toContain(SENTINEL);
  });
});

describe('normalizeGithubToken', () => {
  it('treats empty, whitespace and absent alike', () => {
    expect(normalizeGithubToken(undefined)).toBeUndefined();
    expect(normalizeGithubToken('')).toBeUndefined();
    expect(normalizeGithubToken('\t\n ')).toBeUndefined();
  });

  it('trims a present token', () => {
    expect(normalizeGithubToken(` ${SENTINEL}\n`)).toBe(SENTINEL);
  });
});
