import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

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
