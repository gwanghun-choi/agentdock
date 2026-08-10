/**
 * Next.js calls register() once when a server instance boots. This is the last
 * moment a misconfigured connection can be caught before requests arrive, so it
 * is where the process refuses to start.
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
