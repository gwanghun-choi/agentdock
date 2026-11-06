import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The web container serves pages. It does not ingest.
 *
 * Before this, `register()` started an endless poll loop at boot, so a deploy, a
 * restart, a crash recovery and an autoscale event were each an ingest trigger —
 * a container that restarted three times in a minute spent the hour's GitHub
 * budget three times over, and a rollback re-read the corpus. Ingestion is now
 * `bun run sync`, which cron starts and which exits.
 *
 * Two assertions, because they fail differently. The first is that no GitHub
 * request is issued while booting, which is the behaviour. The second is that
 * the module does not so much as name the worker, which is what stops the
 * behaviour being restored by a one-line import in a hurry.
 */
describe('register() — the web boot', () => {
  it('issues no GitHub request and touches no queue', async () => {
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    // Not the nodejs runtime, so register() returns before it imports the
    // database client — which is what lets this assertion run in CI, where
    // there is no database. The guard being first is itself the thing under
    // test: anything added ABOVE it would run on every runtime including edge.
    vi.stubEnv('NEXT_RUNTIME', 'edge');

    const { register } = await import('./instrumentation');
    await expect(register()).resolves.toBeUndefined();

    expect(fetchSpy).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  describe('on the nodejs runtime', () => {
    const boot = async (query: () => Promise<unknown>) => {
      vi.resetModules();
      vi.stubEnv('NEXT_RUNTIME', 'nodejs');
      class SchemaIsolationError extends Error {}
      const write = vi.fn();
      vi.doMock('@/db/client', () => ({
        SchemaIsolationError,
        assertSchemaIsolation: query,
        db: {
          insert: () => ({
            values: () => ({
              onConflictDoUpdate: async () => write(),
            }),
          }),
        },
      }));
      vi.doMock('@/db/schema', () => ({ schemaMeta: { key: 'key' } }));
      const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
      const printed = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { register } = await import('./instrumentation');
      return { register, write, exit, printed, SchemaIsolationError };
    };
    const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

    afterEach(() => {
      vi.doUnmock('@/db/client');
      vi.doUnmock('@/db/schema');
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
    });

    it('does not hold requests for a sleeping database', async () => {
      let wake = () => {};
      const { register, write } = await boot(
        () =>
          new Promise<void>((resolve) => {
            wake = resolve;
          }),
      );
      await register();
      await settle();
      expect(write).not.toHaveBeenCalled();
      wake();
      await settle();
      expect(write).toHaveBeenCalledTimes(1);
    });

    it('ends the process on the wrong connection', async () => {
      let refuse = () => {};
      const made = await boot(
        () =>
          new Promise((_, reject) => {
            refuse = () => reject(new made.SchemaIsolationError('Refusing to start: role'));
          }),
      );
      await made.register();
      await settle();
      refuse();
      await settle();
      expect(made.exit).toHaveBeenCalledWith(1);
    });

    it('stays up when the database does not answer, and prints no connection detail', async () => {
      const made = await boot(async () => {
        throw Object.assign(new Error('connect ECONNREFUSED secret-host:5432'), {
          code: 'ECONNREFUSED',
        });
      });
      await made.register();
      await settle();
      expect(made.exit).not.toHaveBeenCalled();
      expect(made.write).not.toHaveBeenCalled();
      const printed = made.printed.mock.calls.flat().join(' ');
      expect(printed).toContain('ECONNREFUSED');
      expect(printed).not.toContain('secret-host');
    });

    it.each(['28P01', '3D000', '42P01', '42501'])(
      'ends the process when the database answers that the configuration is wrong: %s',
      async (code) => {
        const made = await boot(async () => {
          throw Object.assign(new Error('password for secret-role'), { code });
        });
        await made.register();
        await settle();
        expect(made.exit).toHaveBeenCalledWith(1);
        expect(made.printed.mock.calls.flat().join(' ')).not.toContain('secret-role');
      },
    );

    it('ends the process on an environment it refuses, rather than an unhandled rejection', async () => {
      vi.resetModules();
      vi.stubEnv('NEXT_RUNTIME', 'nodejs');
      vi.doMock('@/db/client', () => {
        throw new Error('Invalid environment configuration');
      });
      const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const { register } = await import('./instrumentation');
      await register();
      await settle();
      expect(exit).toHaveBeenCalledWith(1);
    });
  });

  it('does not reference the worker, the queue or a poll loop', () => {
    const source = readFileSync('src/instrumentation.ts', 'utf8');
    // Comments explain why the loop is gone, so the check is against code:
    // an import specifier and a call, not the words.
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

    expect(code).not.toMatch(/ingest\/worker/);
    expect(code).not.toMatch(/runWorker|claimJob|runJob|reapAbandoned/);
    expect(code).not.toMatch(/INGEST_WORKER/);
    expect(code).not.toMatch(/setInterval|setTimeout/);
  });

  it('leaves INGEST_WORKER out of the parsed environment entirely', async () => {
    const { parseEnv } = await import('./env');
    const parsed = parseEnv({
      DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
      // Supplied and ignored: the variable no longer exists, so a stale value
      // in a deployment's .env cannot switch anything back on.
      INGEST_WORKER: '1',
    });
    expect(parsed).not.toHaveProperty('INGEST_WORKER');
  });
});
