import { db, sql } from '@/db/client';
import { schemaMeta } from '@/db/schema';

// Read at request time. Nothing here may be prerendered: `next build` runs in
// CI, where there is no database.
export const dynamic = 'force-dynamic';

export default async function StatusPage() {
  const [identity] = await sql<{ user: string; path: string }[]>`
    SELECT current_user AS "user", current_setting('search_path') AS "path"
  `;
  const meta = await db.select().from(schemaMeta).orderBy(schemaMeta.key);

  return (
    <main>
      <h1>AgentDock</h1>
      <p>
        connected as <strong>{identity.user}</strong> — search_path <code>{identity.path}</code>
      </p>
      <h2>schema_meta</h2>
      <ul>
        {meta.map((row) => (
          <li key={row.key}>
            <code>{row.key}</code>: {row.value}
          </li>
        ))}
      </ul>
    </main>
  );
}
