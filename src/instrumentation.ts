/**
 * Next.js calls register() once when a server instance boots. This is the last
 * moment a misconfigured connection can be caught before requests arrive, so it
 * is where the process refuses to start.
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

  const { assertSchemaIsolation, db } = await import('@/db/client');
  const { schemaMeta } = await import('@/db/schema');

  await assertSchemaIsolation();

  const now = new Date();
  await db
    .insert(schemaMeta)
    .values({ key: 'last_boot', value: now.toISOString() })
    .onConflictDoUpdate({
      target: schemaMeta.key,
      set: { value: now.toISOString(), updatedAt: now },
    });
}
