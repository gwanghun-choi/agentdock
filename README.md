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
| `bun run test` | Vitest. Note the `run`: bare `bun test` invokes Bun's own runner, which hangs on these vitest-authored files. |
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

## Why migrations are applied by `scripts/migrate.mjs`

`drizzle-kit migrate` and drizzle-orm's own migrator both begin with
`CREATE SCHEMA IF NOT EXISTS "<migrations schema>"`. PostgreSQL checks `CREATE`
on the *database* before it checks whether the schema already exists, so that
statement fails with `42501 permission denied for database mcpdb` for a role
that is `NOCREATEDB` and holds no `CREATE` on the database — which is exactly
what `agentdock_app` is, on purpose.

Granting that privilege would hand AgentDock the ability to create schemas in a
database it shares with another application, which is the one thing layer 4
exists to prevent. So `scripts/migrate.mjs` reuses drizzle's own migration
reader and history-table format — the same files, hashes, and
`__drizzle_migrations` columns — and omits the one statement the role cannot
run. Migration history stays in `agentdock.__drizzle_migrations`; no `drizzle`
schema is ever created. Switching back to drizzle's migrator later needs no data
change.

`drizzle-kit generate` is untouched.

## Environment

Bun loads `.env` only for processes running on the Bun runtime. Any script that
needs a credential is therefore launched with `bun`, never with `node`; the
vitest config loads `.env` itself through Node's `process.loadEnvFile`. On CI
there is no `.env`, so the database-backed suites skip visibly rather than
failing.

## Test database

Database-backed tests use the `agentdock_test` schema, so a test run can never
read or destroy development data. `agentdock_app` cannot create schemas, so
`agentdock_test` is created once during the bootstrap above; `bun run
db:test:setup` applies the current schema definitions to it, writing its
generated SQL into the git-ignored `.drizzle-test/` so it can never be confused
with the reviewed migrations in `drizzle/`.
