# AgentDock

An open index of AI agent artifacts. You give it a public GitHub repository; it
reads the skill, plugin, catalog, MCP server, command and hook files inside,
records what they declare, and links back to the exact file at the exact
commit it read.

**AgentDock reads files and reports what it read. It does not run them, and it
cannot say whether an artifact is safe.** There is no risk score, no grade, and
no safety badge anywhere in the interface, by design.

AgentDock detects all six artifact types — Agent Skills, plugins, plugin
marketplaces, MCP servers, commands and hooks. Capability disclosure — what an
artifact can reach, not just what it declares — comes later.

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

Open the home page and paste `anthropics/skills`. Submitting no longer waits for
GitHub: it writes one row to `ingest_job` and hands back a job page at
`/jobs/{id}`, which re-renders itself until the job reaches a terminal status. To
get realistic rows without touching the network at all, run `bun run db:seed`
instead — see **Fixtures** below.

### The background worker

Ingestion runs in a poll loop started from `src/instrumentation.ts` when the
server boots — there is no second command and no service beyond PostgreSQL.
Durability lives in the job row rather than in the process: a job whose worker
died is returned to the queue by an age sweep, and two workers claiming at once
are arbitrated by PostgreSQL rather than by application code.

```
INGEST_WORKER=0 bun run dev     # start the server with the loop turned off
bun run verify:worker           # prove the loop starts at boot, spending no GitHub quota
```

`INGEST_WORKER` is optional and defaults to on. It is not a secret; it is the
escape hatch for the day an ingest measurably delays a page render. Turning it
off costs nothing that is not recoverable: submissions still write their job
rows, they simply wait, and whichever process next runs with the loop on picks
them up in the order they were requested.

Submitting a repository returns as soon as its row is written, and the job page
at `/jobs/{id}` shows what happened to it. Submitting one that is already queued
or already being read sends you to that same job rather than starting a second.

### What happens when a run fails

A repository is read **at most three times** before AgentDock stops trying, and
two of the failures never get a second attempt at all: GitHub returns a
byte-identical response for a repository that does not exist and one that is
private, and a repository past the size cap will be past it again — so retrying
either spends the shared budget to learn the same thing twice. Only an
unreachable GitHub and a storage failure are retried, on a widening delay of one,
two and four minutes.

Running out of GitHub budget is **not** a failure. The job is scheduled for when
the budget returns and keeps the attempt it would otherwise have spent, because
waiting for a clock is not a failed attempt. That schedule is clamped to an hour,
since the reset time arrives in a response header. When fewer than two requests
remain the loop stops claiming altogether, so an empty budget produces one
deferral rather than one failed job per repository waiting.

A job that has exhausted its attempts shows the reason it recorded and a control
that starts a new run. Nothing retry-specific happens behind that control: a
finished job has left the active-job index, so the ordinary submit mints a new
one.

## What is where

```
src/
  app/          pages, and actions.ts — the submit server function
    r/[owner]/[repo]/            a repository and what AgentDock lists for it
    r/[owner]/[repo]/[...path]/  one artifact: every field, and the permalink
  components/   the sanitizing Markdown renderer, the submit form, listing rows
  db/           schema, connection, and the read queries the pages use
  detect/       six detectors, tolerant frontmatter parsing, capped JSON parsing
  github/       the HTTP client, metadata, tree and raw reads
  ingest/       pipeline.ts (the whole path), persist.ts (the one transaction),
                errors.ts (the nine things a person can be told),
                retry.ts (the delay curve and the per-outcome disposition),
                worker.ts (the poll loop, the reaper, the budget gate)
  proxy.ts      the per-request nonce and the Content-Security-Policy
  env.ts        configuration parsing; log.ts  one line per ingest
fixtures/       frozen GitHub responses and hostile inputs
scripts/        migrate, boundary scan, fixture capture, seed
```

Every page is server-rendered and reads the database at request time. There is
one client component in the project — the submit form — and it holds no data,
only the pending flag.

## The GitHub budget

AgentDock runs **unauthenticated**: GitHub allows it **60 core requests an
hour**, and one repository costs **two** (metadata plus one recursive tree), so
roughly thirty repositories an hour. File bodies come from
`raw.githubusercontent.com`, which costs no quota at all.

`GITHUB_TOKEN` is optional and needs **no scopes**. Setting it raises the limit
and changes no code. Two things worth knowing before reaching for one:

- A `304` conditional response **does** consume quota when unauthenticated —
  GitHub's exemption applies only to authorized requests. So conditional
  requests save nothing here.
- GraphQL is unavailable unauthenticated (its limit is 0).

The home page shows what was left after AgentDock's most recent request.

## Fixtures

`fixtures/` holds frozen GitHub responses for four real repositories, pinned to
a commit SHA, plus hand-written hostile inputs (`adversarial/`, `xss/`). **No
test opens a socket** — the whole suite runs against these bytes.

```
bun run db:seed                    # ingest anthropics/skills from disk, no network
bun run db:seed baoyu-skills       # or any other fixture directory
bun run fixtures:capture           # re-capture from GitHub: 2 core requests per repo
```

`db:seed` runs the **real** pipeline with `fetch` replaced by a fixture reader,
so seeded rows are exactly what a live ingest would produce.

## Commands

| Command | What it does |
|---|---|
| `bun run dev` | Development server |
| `bun run build` | Production build. Needs no database — every page that reads one is request-time. |
| `bun run start` | Serve the build |
| `bun run test` | Vitest. Note the `run`: bare `bun test` invokes Bun's own runner, which hangs on these vitest-authored files. |
| `bun run lint` / `bun run format` | Biome, check and write |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run check:boundaries` | The migration and source boundary scan |
| `bun run ci` | Boundary scan, lint, type-check, tests — exactly what CI runs |
| `bun run db:generate` | Generate a migration from `src/db/schema.ts`. Offline; opens no connection. |
| `bun run db:migrate` | Apply the reviewed migrations in `drizzle/` |
| `bun run db:seed [fixture]` | Ingest a frozen fixture through the real pipeline |
| `bun run db:reset --confirm` | Empty the `agentdock` schema |
| `bun run db:test:setup` | Build the `agentdock_test` schema for database-backed tests |
| `bun run fixtures:capture` | Re-pin the fixture corpus from GitHub |
| `bun run verify:worker` | Start a built server, make no request, and assert a pre-seeded job still ran. Needs a database and a build; deliberately not part of `ci`. |

There is deliberately no `db:push` and no `db:pull`. Those are the only migration
commands that diff live database state, and this database holds another
application's data; `bun run check:boundaries` fails the build if such a script
ever appears.

**CI runs `bun run build` and then `bun run ci` — the same single command you
run**, so the two cannot drift. The build comes first because it regenerates a
type declaration the linter then reads; linting first can fail on a file the
build was about to fix.

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

## Source boundary rules

`bun run check:boundaries` also scans every non-test file under `src/` and fails
the build on four constructions. Each is a requirement that can be enforced
structurally, so it is enforced rather than remembered.

| Rule | Fails on | What it protects |
|---|---|---|
| `no-raw-html` | `rehype-raw`, `dangerouslySetInnerHTML`, `allowDangerousHtml` | Untrusted Markdown is never parsed into markup. HTML in a skill body is a text node. |
| `no-execution` | `child_process`, `execSync`, `spawnSync`, `node:vm` | Nothing from a scanned repository is ever run. |
| `no-disk-write` | `writeFileSync`, `createWriteStream`, `mkdirSync`, … | Repository content never reaches disk, which removes archive extraction and path traversal by construction. |
| `no-host-sprawl` | a GitHub hostname named outside `src/github/` | `git grep` answers "what can this reach" completely. Every URL is built from two validated parts. |

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

Vitest runs test **files in parallel** against that one schema. A database-backed
suite must therefore key its rows on a sentinel no other suite can produce — for
`repository` that means both `github_node_id` and `full_name`, which carry
separate unique indexes.
