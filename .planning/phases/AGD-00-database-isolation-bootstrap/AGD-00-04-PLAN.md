---
phase: AGD-00-database-isolation-bootstrap
plan: 04
type: execute
wave: 3
depends_on: ["00-01", "00-02", "00-03"]
files_modified:
  - drizzle.config.ts
  - src/db/schema.ts
  - src/db/client.ts
  - src/db/client.test.ts
  - src/instrumentation.ts
  - src/app/layout.tsx
  - src/app/page.tsx
  - drizzle/
  - README.md
autonomous: true
requirements: [FND-01, FND-02, FND-08, FND-09]

estimate:
  tokens: 52000
  raw_tokens: 52000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "A table defined in TypeScript becomes a table in the agentdock schema, through a migration a human read before it was applied"
    - "The migration-history table lives in agentdock, not in public and not in a third schema"
    - "No object owned by agentdock_app exists outside agentdock and agentdock_test"
    - "Visiting the running application shows the identity and search_path it is actually connected with"
    - "The server refuses to start when connected as the wrong role or with a search_path that reaches beyond an AgentDock schema"
    - "A connection carrying the wrong password is rejected, so the credential is load-bearing rather than decorative"
    - "`bun install` plus one documented command brings the application up against the existing PostgreSQL instance"
    - "The same schema definitions can be applied to agentdock_test without touching agentdock"
  artifacts:
    - path: "drizzle.config.ts"
      provides: "schemaFilter and a migration-history table pinned inside the owned schema"
      contains: "schemaFilter"
      min_lines: 15
    - path: "src/db/schema.ts"
      provides: "pgSchema() root object and the schema_meta table; the single source of truth for DDL and types"
      exports: ["agentdock", "schemaMeta", "AGENTDOCK_SCHEMA"]
      min_lines: 20
    - path: "src/db/client.ts"
      provides: "postgres.js pool with a pinned search_path, the Drizzle client, and assertSchemaIsolation()"
      exports: ["sql", "db", "assertSchemaIsolation"]
      min_lines: 35
    - path: "src/instrumentation.ts"
      provides: "Boot-time isolation assertion and one real write through the ORM"
      exports: ["register"]
      min_lines: 15
    - path: "src/app/page.tsx"
      provides: "Server-rendered status page reading the live connection identity and schema_meta"
      min_lines: 20
    - path: "README.md"
      provides: "The one-time bootstrap and the single documented run command"
      contains: "bun run db:migrate"
      min_lines: 40
  key_links:
    - from: "src/db/schema.ts"
      to: "drizzle/"
      via: "drizzle-kit generate turns the pgSchema() definitions into schema-qualified SQL, offline"
      pattern: "agentdock"
    - from: "src/instrumentation.ts"
      to: "src/db/client.ts"
      via: "calls assertSchemaIsolation() before the server accepts a request"
      pattern: "assertSchemaIsolation"
    - from: "src/app/page.tsx"
      to: "src/db/schema.ts"
      via: "db.select().from(schemaMeta) — a schema-qualified read of the row instrumentation wrote"
      pattern: "schemaMeta"
---

<objective>
Take one path all the way through: a table declared in TypeScript, generated into
reviewed SQL, refused or accepted by the boundary scanner, applied by the
non-superuser role, written to at boot, and rendered by a server-rendered page —
and prove at every step that nothing landed outside the `agentdock` schema.

Purpose: plans 00-01 through 00-03 each assert one property in isolation. This
one wires them into a single working path, which is the only way to discover that
two correct-looking pieces disagree. It is also the smallest thing that makes the
project real: after it, `bun install` plus one command produces a running
application, and every later phase adds tables to a pipeline that is already
proven rather than to one that is hoped for.

Output: a running Next.js application whose status page shows the role and
`search_path` it is genuinely connected with, backed by one migration in the
`agentdock` schema.

Implements CONTEXT.md confirmed decision 4 (defense in depth: every table
schema-qualified, never `search_path` alone) and closes the migration-history
half of FND-01.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
@.planning/phases/AGD-00-database-isolation-bootstrap/CONTEXT.md
@.planning/phases/AGD-00-database-isolation-bootstrap/AGD-00-03-PLAN.md
@src/env.ts
@README.md
</context>

<decisions_made_while_planning>

**1. The test-database question, decided.**

Tests get a database from a second schema, `agentdock_test`, owned by the same
role and created in the same one-time bootstrap. The alternatives were all worse
here:

- *A separate database.* `agentdock_app` is `NOCREATEDB`, and `mcpdb` has a NULL
  `datacl` so the role holds no `CREATE` on the database either. It physically
  cannot provision one, and granting it that privilege would mean modifying the
  ACL of a database another application owns.
- *A throwaway Docker PostgreSQL for tests.* A second instance to start, keep at
  the same version, and reason about when it disagrees with the real one — for a
  project whose entire premise is that the database already exists.
- *Transactions rolled back against `agentdock` itself.* Simple, but it runs test
  statements against the schema holding development data, and it cannot test a
  migration at all, because the interesting question is what happens to an empty
  schema.
- *Deferring the decision.* The schema has to be created by a superuser, and the
  superuser session happens exactly once, in plan 00-01. Deferring means asking
  the maintainer for a second interactive session against a shared production
  database later.

What this plan builds is the path, not a harness: `bun run db:test:setup` applies
the same schema definitions to `agentdock_test`, and the run is verified once
here. Phase 0 has no test that writes to a database, so there is no harness to
build yet — but the first one in Phase 1 inherits a route that is known to work.

The schema name is parameterised through `AGENTDOCK_SCHEMA` in exactly two
places, and the boundary scanner from plan 00-03 asserts that the *committed*
migrations name `agentdock` and nothing else, so a generate run with the wrong
value cannot reach `drizzle/` unnoticed.

**2. `dynamic = 'force-dynamic'` on the status page is not decoration.**

Next 16 executes dynamic code at request time unless told otherwise, but a page
whose only data access is a database call has no dynamic API in it and can still
be picked up for static generation. That would make `next build` require a
database — which CI does not have, and should not need. One line removes the
whole failure class.

**3. The page's identity query is raw SQL and unqualified; the data read is not.**

`current_user` and `current_setting('search_path')` are session facts, not table
reads, so there is nothing to qualify. The `schema_meta` read goes through
Drizzle, which emits a schema-qualified statement. The boundary scanner governs
DDL — the schema module and the generated migrations — because that is where an
escape becomes permanent; a read landing in the wrong schema is caught first by
`assertSchemaIsolation` refusing to let the process start.

**4. The wrong-password test earns its place.**

The container's `pg_hba.conf` grants `trust` on the local socket and on
`127.0.0.1`. Connections from this host reach the container through Docker's
userland proxy and therefore present the bridge gateway address, so the final
`scram-sha-256` rule should apply — but "should" is doing a lot of work in a
sentence about authentication. One test asserts that a connection with a
deliberately wrong password is rejected. If it ever passes, the password in
`.env` is decorative and the maintainer needs to know.

</decisions_made_while_planning>

<reference>

## Reference A — `drizzle.config.ts`

```ts
import type { Config } from 'drizzle-kit';

// Parameterised so the identical schema definitions can be applied to
// `agentdock` and to `agentdock_test`, without a second config file that would
// quietly drift from this one.
const schemaName = process.env.AGENTDOCK_SCHEMA ?? 'agentdock';

export default {
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: process.env.AGENTDOCK_MIGRATIONS_OUT ?? './drizzle',

  // Without this, drizzle-kit treats every schema in the database as its own to
  // manage, and generates statements for another application's objects.
  schemaFilter: [schemaName],

  // The default puts the migration-history table in a `drizzle` schema — a third
  // schema, in a database AgentDock does not own. Pin it inside ours.
  migrations: { schema: schemaName, table: '__drizzle_migrations' },

  // Read by `migrate` only. `generate` never opens a connection, which is what
  // makes it structurally incapable of noticing another schema exists.
  dbCredentials: { url: process.env.AGENTDOCK_DATABASE_URL ?? '' },
} satisfies Config;
```

## Reference B — `src/db/schema.ts`

```ts
import { pgSchema, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * The schema AgentDock owns. Parameterised only so the same definitions can be
 * applied to `agentdock_test`; scripts/check-boundaries.mjs asserts that the
 * committed migrations name `agentdock` and nothing else.
 */
export const AGENTDOCK_SCHEMA = process.env.AGENTDOCK_SCHEMA ?? 'agentdock';

/**
 * Every table in this project hangs off this object, so every statement Drizzle
 * emits — DDL and queries alike — is schema-qualified. `search_path` is a
 * default, not a fence, and nothing here relies on it.
 */
export const agentdock = pgSchema(AGENTDOCK_SCHEMA);

/**
 * Key/value facts about this deployment of the schema. Written at boot, read by
 * the status page.
 */
export const schemaMeta = agentdock.table('schema_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

## Reference C — `src/db/client.ts`

```ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { parseEnv } from '@/env';
import * as schema from './schema';
import { AGENTDOCK_SCHEMA } from './schema';

const env = parseEnv();

export const sql = postgres(env.AGENTDOCK_DATABASE_URL, {
  max: 10,
  // Redundant with the schema qualification Drizzle emits, and with the
  // role-level default set during bootstrap. Redundancy is the point: a raw
  // query written in a hurry still lands in the right schema.
  connection: { search_path: AGENTDOCK_SCHEMA },
  // Server notices echo statement text, which can carry values.
  onnotice: () => {},
});

export const db = drizzle(sql, { schema });

/**
 * Refuses to let the process continue against a connection that is not confined
 * to a schema AgentDock owns. A mistyped connection string is otherwise silent
 * until something writes to the wrong place.
 */
export async function assertSchemaIsolation(client = sql): Promise<void> {
  const [row] = await client<{ user: string; path: string }[]>`
    SELECT current_user AS "user", current_setting('search_path') AS "path"
  `;

  if (row.user !== 'agentdock_app') {
    throw new Error(
      `Refusing to start: connected as "${row.user}", expected "agentdock_app". ` +
        'Check AGENTDOCK_DATABASE_URL in .env.',
    );
  }

  const path = row.path.trim();
  if (!/^agentdock(_test)?$/.test(path)) {
    throw new Error(
      `Refusing to start: search_path is "${path}", expected exactly one AgentDock schema. ` +
        'Any other entry means an unqualified statement could reach another application.',
    );
  }
}
```

## Reference D — `src/instrumentation.ts`

```ts
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
```

## Reference E — `src/app/layout.tsx`

```tsx
import type { ReactNode } from 'react';

export const metadata = {
  title: 'AgentDock',
  description: 'Discover and inspect AI agent skills, plugins, and MCP servers.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

## Reference F — `src/app/page.tsx`

```tsx
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
        connected as <strong>{identity.user}</strong> — search_path{' '}
        <code>{identity.path}</code>
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
```

## Reference G — `src/db/client.test.ts`

Guarded on the database URL so `bun run ci` passes in an environment without a
database. The skip is visible in the test output rather than silent.

```ts
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

const DB_URL = process.env.AGENTDOCK_DATABASE_URL;

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
```

## Reference H — `README.md`

~~~markdown
# AgentDock

Discover and inspect AI agent skills, plugins, and MCP servers in one open registry.

## Running it locally

AgentDock uses the PostgreSQL instance already running on this machine
(container `didim-mcp-service-backend-db-1`, database `mcpdb`). It connects as
`agentdock_app`, a non-superuser role that owns the `agentdock` and
`agentdock_test` schemas and holds no privilege on anything else in that
database — including the schema belonging to the other application that shares
it.

### One-time database bootstrap

Read `scripts/sql/bootstrap-agentdock.sql`, then run it as a superuser and set
the password interactively:

```
docker exec -i didim-mcp-service-backend-db-1 \
  psql -U mcp -d mcpdb -v ON_ERROR_STOP=1 -f - < scripts/sql/bootstrap-agentdock.sql

docker exec -it didim-mcp-service-backend-db-1 psql -U mcp -d mcpdb
\password agentdock_app
\q
```

`\password` prompts without echo and sends only a SCRAM verifier, so the
plaintext never reaches a file, a command line, a server log, or the terminal.

- Rollback: `scripts/sql/rollback-agentdock.sql`
- Proof the boundary holds: `scripts/sql/verify-isolation.sql`

### Every time

```
cp .env.example .env      # fill in the password you chose
bun install
bun run db:migrate
bun run dev               # http://localhost:3000
```

`bun run dev` refuses to start unless it is connected as `agentdock_app` with a
`search_path` confined to a schema AgentDock owns.

## Commands

| Command | What it does |
|---|---|
| `bun run dev` | Development server |
| `bun run ci` | Boundary scan, lint, type-check, tests — exactly what CI runs |
| `bun run db:generate` | Generate a migration from `src/db/schema.ts`. Offline; opens no connection. |
| `bun run db:migrate` | Apply the reviewed migrations in `drizzle/` |
| `bun run db:reset --confirm` | Empty the `agentdock` schema |
| `bun run db:test:setup` | Build the `agentdock_test` schema for database-backed tests |

There is deliberately no `db:push` and no `db:pull`. Those are the only migration
commands that diff live database state, and this database holds another
application's data; `bun run check:boundaries` fails the build if such a script
ever appears.

## How the schema boundary is enforced

Four layers, weakest to strongest. The first three are conventions a bug can
defeat; the fourth is enforced by PostgreSQL.

1. **Connection** — `search_path` is pinned to one schema on every connection.
2. **ORM** — every table hangs off `pgSchema()`, so every emitted statement is
   schema-qualified. `search_path` is a default, not a fence.
3. **Migrations** — `drizzle-kit generate` runs offline and cannot see another
   schema exists; `scripts/check-boundaries.mjs` then rejects any generated SQL
   that names a schema AgentDock does not own, leaves a target unqualified, or
   carries an unreviewed destructive verb.
4. **Database** — `agentdock_app` is not a superuser, cannot create databases,
   roles, or schemas, and holds no privilege on any object outside its two
   schemas. A statement that defeats layers 1–3 fails with a permission error
   instead of succeeding.

## Test database

Database-backed tests use the `agentdock_test` schema, so a test run can never
read or destroy development data. `agentdock_app` cannot create schemas, so
`agentdock_test` is created once during the bootstrap above; `bun run
db:test:setup` applies the current schema definitions to it.
~~~

</reference>

<tasks>

<task type="tracer">
  <name>Task 1: One table, end to end — TypeScript to a rendered page</name>
  <precondition>Role `agentdock_app` and schema `agentdock` exist, and `.env` supplies an `AGENTDOCK_DATABASE_URL` that authenticates (plan 00-01 task 2 complete).</precondition>
  <reversibility rating="costly">The schema name is baked into every migration from here on, so changing it later is a coordinated edit across the bootstrap SQL, both config knobs, the schema module, and every migration file. Rated costly rather than one-way because at this point the schema holds one empty table: there is no data migration and no published contract yet. It becomes one-way the moment Phase 1 stores real rows. Chosen in CONTEXT.md decision 2 — recorded, not re-opened.</reversibility>
  <files>drizzle.config.ts, src/db/schema.ts, src/db/client.ts, src/app/layout.tsx, src/app/page.tsx, drizzle/</files>
  <action>
    Wire one path through every layer this phase touches, in this order.

    Write `drizzle.config.ts`, `src/db/schema.ts`, `src/db/client.ts`,
    `src/app/layout.tsx`, and `src/app/page.tsx` exactly as References A, B, C,
    E, and F.

    Then run `bun run db:generate`. It opens no connection — that is what makes
    it incapable of noticing another schema exists — and writes a `.sql` file
    plus a snapshot into `drizzle/`.

    Then read the generated SQL yourself, before anything applies it. Confirm the
    `CREATE TABLE` target is qualified to the owned schema and that the file
    contains nothing you did not ask for. This step is the reason the workflow is
    generate-review-migrate rather than a live diff, and skipping it makes the
    other three layers ceremony.

    Expect one thing to need editing. drizzle-kit emits a `CREATE SCHEMA` line for
    a `pgSchema()` in the first migration it generates, and `agentdock_app` has no
    privilege to create a schema — the schema was created once by a superuser
    during the bootstrap, and creating it is not AgentDock's job. Delete that line
    and replace it with a comment saying so. Editing generated SQL before applying
    it is exactly what this workflow is for; the snapshot Drizzle writes alongside
    is unaffected, so later generates stay correct.

    Then run `bun run check:boundaries`. It must pass and must report one more
    migration file than it did in plan 00-03. The scanner rejects `CREATE SCHEMA`
    without a review marker, so if you skipped the edit above it stops you here
    rather than letting `db:migrate` fail with a confusing permission error. If it
    fails for any other reason, fix the schema module or the config — never the
    scanner.

    Then run `bun run db:migrate`, `bun run build`, and confirm the page renders
    the live connection identity.

    Do not create a second table, do not add anything from the `packages` or
    `repositories` domain, and do not import Tailwind or a component library. The
    point of this slice is that it is thin enough that a wrong assumption costs
    one commit.
  </action>
  <verify>
    <automated>bun run db:generate &amp;&amp; bun run check:boundaries &amp;&amp; bun run db:migrate &amp;&amp; bun run build &amp;&amp; sh -c 'PORT=3011 bun run start &amp; SRV=$!; for i in $(seq 1 40); do curl -sf http://localhost:3011/ &gt;/dev/null 2&gt;&amp;1 &amp;&amp; break; sleep 1; done; curl -s http://localhost:3011/ | grep -q agentdock_app; R=$?; kill $SRV 2&gt;/dev/null; exit $R'</automated>
  </verify>
  <done>A migration exists in `drizzle/`, was read before it was applied, passed the boundary scanner, and created `agentdock.schema_meta`. The built application starts and serves a page naming the role it is connected as.</done>
</task>

<task type="auto">
  <name>Task 2: Refuse to start on a connection that is not confined</name>
  <files>src/instrumentation.ts, src/db/client.test.ts</files>
  <action>
    Create `src/instrumentation.ts` exactly as Reference D and
    `src/db/client.test.ts` exactly as Reference G.

    `register()` runs once per server boot. It asserts the connection first and
    only then writes, so a misconfigured process fails before it can put a row
    anywhere. The dynamic imports are deliberate: they keep the database client
    out of the module graph on runtimes where `register()` returns early.

    The upsert is the first real write this project makes through the ORM. It is
    what the status page from task 1 reads back, which turns the page from a
    connection check into an end-to-end read-write proof.

    The third test asserts that a wrong password is rejected. If it fails, stop
    and report it rather than deleting it — a passing connection with a wrong
    password would mean this instance is not enforcing password authentication
    on the path the application uses, and the maintainer needs that finding.
  </action>
  <verify>
    <automated>bun run typecheck &amp;&amp; bun run test &amp;&amp; sh -c 'AGENTDOCK_DATABASE_URL="$(grep -m1 ^AGENTDOCK_DATABASE_URL .env | cut -d= -f2-)" PORT=3012 bun run start &gt; /tmp/agentdock-boot.log 2&gt;&amp;1 &amp; SRV=$!; for i in $(seq 1 40); do curl -sf http://localhost:3012/ &gt;/dev/null 2&gt;&amp;1 &amp;&amp; break; sleep 1; done; curl -s http://localhost:3012/ | grep -q last_boot; R=$?; kill $SRV 2&gt;/dev/null; exit $R'</automated>
  </verify>
  <done>All three isolation tests pass against the live database. A booted server writes a `last_boot` row and the status page renders it. `bun run test` still passes with no database URL present, skipping the guarded suite visibly.</done>
</task>

<task type="auto">
  <name>Task 3: Prove FND-01 in the catalog, prove the test-schema path, document the run</name>
  <files>README.md, drizzle.config.ts</files>
  <action>
    Write `README.md` exactly as Reference H, replacing the existing two-line
    file. It carries the one-time bootstrap, the four-command local run, the
    command table, the four boundary layers, and the test-database story — the
    documented path FND-09 asks for.

    Then exercise the test-schema path once with `bun run db:test:setup`. It
    applies the same schema definitions to `agentdock_test` using the
    `AGENTDOCK_SCHEMA` and `AGENTDOCK_MIGRATIONS_OUT` overrides already declared
    in `package.json`, writing its generated SQL into a git-ignored directory so
    it can never be confused with the reviewed migrations in `drizzle/`. Confirm
    `agentdock_test.schema_meta` exists afterwards and that `agentdock` is
    unchanged.

    Then run the catalog assertion that closes FND-01: no object owned by
    `agentdock_app` outside its two schemas, the migration-history table present
    inside `agentdock`, and no `drizzle` schema anywhere. Record the result in the
    summary.

    Finally re-run `scripts/sql/verify-isolation.sql` from plan 00-01. All seven
    assertions must still pass now that real objects exist — the first run proved
    the boundary on an empty schema, and this one proves a migration did not
    quietly widen it.
  </action>
  <verify>
    <automated>bun run db:test:setup &amp;&amp; docker exec -i didim-mcp-service-backend-db-1 psql -U mcp -d mcpdb -v ON_ERROR_STOP=1 -tAc "SELECT CASE WHEN (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relowner='agentdock_app'::regrole AND n.nspname NOT IN ('agentdock','agentdock_test'))=0 AND to_regclass('agentdock.__drizzle_migrations') IS NOT NULL AND to_regclass('agentdock.schema_meta') IS NOT NULL AND to_regclass('agentdock_test.schema_meta') IS NOT NULL AND (SELECT count(*) FROM pg_namespace WHERE nspname='drizzle')=0 THEN 'FND-01-OK' ELSE 'FND-01-FAIL' END" | grep -qx FND-01-OK &amp;&amp; docker exec -i didim-mcp-service-backend-db-1 psql -U mcp -d mcpdb -v ON_ERROR_STOP=1 -f - &lt; scripts/sql/verify-isolation.sql 2&gt;&amp;1 | grep -c 'PASS [1-7]/7' | grep -qx 7 &amp;&amp; bun run ci</automated>
  </verify>
  <done>`README.md` documents the bootstrap and the run. `agentdock_test.schema_meta` exists. The FND-01 catalog assertion returns OK. All seven isolation assertions still pass with real objects present. `bun run ci` passes.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| TypeScript schema module → emitted DDL | A table declared without `pgSchema()` resolves through `search_path` at apply time and can land anywhere the role can write. |
| Connection string → live session | A mistyped URL produces a working connection with the wrong identity, silently, until something writes. |
| HTTP request → database | The status page executes SQL on behalf of an anonymous visitor. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-00-20 | Tampering | `src/db/schema.ts` | critical | mitigate | Every table hangs off `pgSchema()`; the boundary scanner rejects a bare table builder; the catalog assertion in task 3 confirms zero `agentdock_app`-owned objects outside its two schemas after the migration ran. |
| T-00-21 | Tampering | migration-history table placement | high | mitigate | `migrations.schema` pinned in `drizzle.config.ts`; task 3 asserts `agentdock.__drizzle_migrations` exists and that no `drizzle` schema was created. |
| T-00-22 | Spoofing | connection identity and `search_path` | high | mitigate | `assertSchemaIsolation()` runs in `register()` before the server accepts a request and throws unless `current_user` is `agentdock_app` and `search_path` is exactly one AgentDock schema; a test drives it with a deliberately loose `search_path`. |
| T-00-23 | Elevation of Privilege | password authentication on the app's transport | high | mitigate | A test asserts a connection carrying a wrong password is rejected. The container's `pg_hba.conf` grants `trust` on the local socket, so this is verified rather than assumed. |
| T-00-24 | Information Disclosure | connection string in errors and notices | medium | mitigate | `onnotice` suppressed on the pool; assertion messages name the variable and the schema, never the URL; the `parseEnv` formatter from plan 00-02 covers the configuration path. |
| T-00-25 | Information Disclosure | the public status page | medium | accept | The page discloses the database role name and `search_path`. On a localhost-only development application with no authentication in v1 this is the point of the page. Phase 1 must move it behind a non-root path or remove it before anything is exposed beyond localhost — recorded here so it is not forgotten. |
| T-00-26 | Denial of Service | build-time database access | medium | mitigate | `dynamic = 'force-dynamic'` keeps the status page out of static generation, so `next build` needs no database and CI needs no credential. |
| T-00-27 | Tampering | test-schema migrations mistaken for reviewed ones | medium | mitigate | `bun run db:test:setup` writes into a git-ignored directory, and the boundary scanner asserts the committed `drizzle/` files name `agentdock` and nothing else. |
</threat_model>

<verification>
1. `drizzle/` contains exactly one migration; its `CREATE TABLE` target is qualified to `agentdock`.
2. `bun run check:boundaries` passes and reports one more migration file than at the end of plan 00-03.
3. `bun run build` succeeds with no database reachable.
4. A started server writes `last_boot` and the status page renders it along with the connected role name.
5. `assertSchemaIsolation` rejects a loose `search_path`; a wrong password is rejected by the server.
6. The FND-01 catalog assertion returns `FND-01-OK`.
7. `scripts/sql/verify-isolation.sql` still emits seven passes now that real objects exist.
8. `bun run ci` passes.
</verification>

<success_criteria>
- **FND-01** — all AgentDock tables and the migration-history table live in `agentdock`; proven by a catalog query that returns zero objects owned by `agentdock_app` anywhere else and confirms no third schema was created.
- **FND-02** — the application refuses to start when `current_user` or `search_path` is not what the boundary requires; proven by a test that drives the assertion with a loose `search_path`.
- **FND-08** — the runtime half: connection failures and server notices carry no credential, and the password is confirmed load-bearing rather than decorative.
- **FND-09** — `bun install` plus `bun run db:migrate` and `bun run dev` brings the application up against the existing instance, documented in `README.md` and exercised by this plan's verification.
- Roadmap Phase 0 success criterion 4 (migration history inside `agentdock`) is closed here.
</success_criteria>

<output>
Create `.planning/phases/AGD-00-database-isolation-bootstrap/00-04-SUMMARY.md` when done.
Record the generated migration filename, the `check-boundaries` inspection counts, and the FND-01 assertion result. Record no credential.
</output>
