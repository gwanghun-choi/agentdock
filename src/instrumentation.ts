/**
 * Next.js calls register() once when a server instance boots, so this is where a
 * misconfigured connection is caught and the process refuses to carry on.
 *
 * It starts NO ingest. That is the point of the function now, not an omission:
 * a web container's lifecycle and the corpus's lifecycle are separate, so a
 * deploy, a restart, a crash recovery or an autoscale event issues zero GitHub
 * requests and drains zero jobs. Ingestion happens on a schedule, from
 * `bun run sync`, which an operator runs from cron — see DEPLOY.md.
 *
 * The poll loop this used to start is gone rather than disabled. A flag would
 * have left the coupling one environment variable away from coming back, and
 * `src/instrumentation.test.ts` asserts the module reaches neither the worker
 * nor GitHub.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // Not awaited. Next.js holds every request until this resolves, so a new instance on a
  // sleeping database served no first byte for the whole wake: 6,199 ms against 409 ms
  // on an instance already up (Phase 93, 5,000 ms wake). A wrong connection still ends
  // the process, moments later rather than before the first page, and those pages read
  // through schema-qualified statements that cannot reach another schema.
  void checkConnection();
}

/**
 * Answered by a database, and the answer is that this configuration is wrong: password
 * (28), database or catalog (3D, 42). A restart is what an operator notices.
 */
const WRONG_CONFIGURATION = /^(28|3D|42)/;

/**
 * A database that does not answer stays a question: the check runs again, because the
 * process used to die here and be restarted into a second try, and pages are served in
 * the meantime. They say what they could not read themselves.
 * ponytail: gives up after five minutes with one line printed, and this instance then
 * serves on an unchecked connection; a database down that long fails every page it would
 * have checked. Retry for longer if instances ever outlive such an outage unattended.
 */
const ATTEMPTS = 10;
const RETRY_MS = 30_000;

async function checkConnection(): Promise<void> {
  try {
    const { assertSchemaIsolation, db, SchemaIsolationError } = await import('@/db/client');
    const { schemaMeta } = await import('@/db/schema');
    const { errorCode } = await import('@/ingest/errors');
    const { scheduler } = await import('node:timers/promises');

    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      try {
        await assertSchemaIsolation();

        const now = new Date();
        await db
          .insert(schemaMeta)
          .values({ key: 'last_boot', value: now.toISOString() })
          .onConflictDoUpdate({
            target: schemaMeta.key,
            set: { value: now.toISOString(), updatedAt: now },
          });
        return;
      } catch (error) {
        const code = errorCode(error);
        if (error instanceof SchemaIsolationError || WRONG_CONFIGURATION.test(code ?? ''))
          throw error;
        // The code only: a connection error's message can carry a hostname.
        console.error(`boot: no answer from the database (${code}), attempt ${attempt}`);
        if (attempt < ATTEMPTS) await scheduler.wait(RETRY_MS);
      }
    }
    console.error('boot: gave up checking this connection');
  } catch (error) {
    // Refusing to carry on: bad environment, the wrong role or schema, a bad password.
    // The module's own messages are written to be printed; a driver's is not.
    const code = (error as { code?: unknown }).code;
    console.error(code ? `boot: refused (${String(code)})` : (error as Error).message);
    process.exit(1);
  }
}
