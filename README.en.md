# AgentDock

[한국어](./README.md) | English

An open index of AI agent artifacts — skills, plugins, marketplaces, MCP
servers, slash commands, hooks and subagents — discovered from established public GitHub
repositories, parsed, and linked back to the exact file at the exact commit
AgentDock read.

![The whole AgentDock home page, top to bottom: a search field with a row of per-type chips and counts, a list of the ten most recently read artifacts, a card per artifact type saying what it is, and a horizontal pipeline from repository to artifact index above the discovery gate that decides which repositories get read](docs/images/agentdock-home.png)

That image is the whole page, not a crop of it. The home page is in four parts.

- **Search.** The search field is the control the page opens with. Under it, a
  chip per artifact type goes straight to that type's listing and says how many
  it lists.
- **Recently indexed.** The ten most recently read artifacts, as a list, on the
  first screen.
- **Browse by type.** A card per type saying what that kind of artifact is.
- **How a repository gets indexed.** Four stages running left to right — a
  repository, the files that declare an artifact, AgentDock reading them, and
  the result filed against the commit it read — then the four discovery
  conditions and what they decide.

The chip and card counts come from one grouped query, the same totals the
listing shows on arrival. The home page makes three queries.

**AgentDock reads files and reports what it read. It does not run them, and it
cannot say whether an artifact is safe.** There is no risk score, no grade and
no safety badge anywhere in the interface, by design.

## What is AgentDock?

A small, self-hostable index. It watches a set of public repositories, notices
the artifact files inside them, records what those files declare, and makes the
result searchable. That is the whole product.

It is **not** a marketplace, an installer, a package manager, or a complete
index of GitHub. Nothing is executed, nothing is mirrored, and nothing is
recommended.

Two things follow from that, and they are the reason for most of the design
decisions below:

- **The corpus is not the ecosystem.** Every result page says so. An artifact
  AgentDock has not indexed is not an artifact that does not exist.
- **Popularity is a scheduling signal, not a safety guarantee.** The star floor
  below decides which unread repositories a small request budget is spent on
  first. It says nothing about any artifact.

## Supported Artifacts

Seven types, one detector each in `src/detect/`:

| Type | Recognised by |
|---|---|
| **Agent Skill** | `SKILL.md` with YAML frontmatter |
| **Claude Code Plugin** | `.claude-plugin/plugin.json`, or a directory shaped like one |
| **Plugin Marketplace** | `.claude-plugin/marketplace.json` — a catalog, which contributes repositories rather than artifacts |
| **MCP Server** | `.mcp.json`, and the MCP registry's own entries |
| **Slash Command** | a Markdown file under `.claude/commands/` |
| **Hook Configuration** | a `hooks` block in `.claude/settings.json` |
| **Subagent** | a Markdown file under `.claude/agents/` or a plugin's `agents/`, subfolders included; one under `.claude/agents/` needs frontmatter |

Detection is by file shape, never by repository name or topic. A repository with
none of these costs zero file reads: the tree is inspected for paths first, and
only matching paths are fetched.

## Repository Discovery Policy

A repository is added by automatic discovery when **all** of these hold:

- public
- at least **50 GitHub stars**
- not a fork
- not archived
- and it actually contains a supported artifact file

There is **no submission form**. AgentDock has no accounts, no sign-in and no
operator review, so an endpoint that let an anonymous visitor name a repository
would be an unauthenticated way to spend a shared request budget and to put
anything at all into a public index, with nobody to hold responsible for it.
Discovery is entirely automatic, from a public registry, a curated seed list,
curated link lists and GitHub's own topic search.

The star floor lives in exactly one place, `src/corpus/policy.ts`, and everything
else — the topic sweep's own floor, the messages, the UI copy — reads it from
there.

**It is an entry gate, not a deletion rule.** A repository whose stars later fall
below the floor keeps every artifact it contributed and keeps being re-read on
the ordinary schedule. Removing artifacts because a repository became less
popular would be a trust score wearing a different hat, and
`src/db/queries/search.ts` consults the floor for nothing — a test asserts the
complete list of modules allowed to import it.

**The floor is not a quality score and not a ranking input.** It answers one
question only: given a budget of 60 GitHub requests an hour, which of the
repositories nobody has looked at yet should be read first? Search results are
never ordered by stars, and no artifact is ranked above another because its
repository is popular.

## How a Repository Gets Indexed

```
      registry            seed list         curated lists       topic search
   (MCP registry)      (config/seeds)     (awesome-*.md)     (GitHub search API)
          │                   │                  │                   │
          └───────────────────┴────────┬─────────┴───────────────────┘
                                       ▼
                                   repo_seed                 no GitHub core cost
                                       │
                                       ▼
                                  ingest_job                 the queue
                                       │
                                       ▼
                          ┌───────────────────────┐
                          │  metadata + tree      │          2 core requests
                          ├───────────────────────┤
                          │  discovery gate       │  ──────► declined: stop here
                          ├───────────────────────┤
                          │  commit sha unchanged?│  ──────► unchanged: stop here
                          ├───────────────────────┤
                          │  detect → fetch files │          raw host, no quota
                          │  → parse → analyze    │
                          └───────────┬───────────┘
                                      ▼
                          package / package_version /
                          capability_finding  ──────────────► search, browse
```

Both gates sit above the expensive part. A declined repository and an unchanged
one each cost two core requests and **zero** file reads, against the up-to-600
raw fetches and two minutes of wall clock a full read can take.

## Scheduled Synchronization

**The web server does not ingest.** `docker compose up`, a restart, a crash
recovery and a rollback all issue zero GitHub requests. There is no in-process
worker and no `INGEST_WORKER` flag — the poll loop that used to start at boot was
deleted rather than defaulted off, because a flag would leave the coupling one
environment variable away from returning.

Ingestion is one command, which cron runs **twice a day** and which exits:

```bash
bun run sync
```

It discovers from every source, re-checks stored repositories whose last read is
older than twelve hours (least-recently-read first, so the corpus rotates rather
than starving its tail), drains the queue, and prints a summary:

```
AgentDock scheduled sync

  Repositories processed        12
    ingested (new or changed)   11
    unchanged, no files read     0
    no artifacts found           0

  Declined by discovery policy   0
    below 50 stars               0
    archived on GitHub           0
    a fork                       0

  Could not be read              0
  Rate limited, deferred         1
  Other failures                 0

  GitHub core requests left      0 of 60
  GitHub core requests spent    24
  Budget                        unauthenticated
  Duration                      94s

  Discovered this run
    registry                    40 seed(s) written
    seeds                       15 seed(s) written
    links                       0 seed(s) written
    search                      12 seed(s) written
  Enqueued this run             25
    new from seeds              0
    new from search             7
    new from links              0
    new from backlog            8
    re-checks of stored repos   10
```

Every cap prints what it dropped. A run that stops on an exhausted budget says
how much of the cap it left unspent; a refresh pass that could not reach every
stale repository says how many it left behind. A cap that prints nothing reads
as "we covered everything".

**Between runs, `bun run ops:status`** reads what the runs left behind — the last
run (`schema_meta`'s `sync:last_attempt` and `sync:last_success`), every
`ingest_job` by its current status, the attempts that finished in the last 24 h
(`--hours=`) by outcome and by the worker's own retry disposition, with p50/p95
per attempt, and the corpus counts. It judges one thing, the sync: `OK`,
`PARTIAL` (the last run stopped at a limit), `DEGRADED` (the last run failed, or
no clean run in 36 h, `--stale-hours=`) or `UNKNOWN` (nothing recorded yet) —
never the site, since a stale index is still a working one. The sync workflow
appends it to each run's summary page as a table (`--markdown`); it holds counts
and statuses only, because a public repository's run summary is public.

**`bun run quality:check`** runs the corpus's integrity rules — an artifact with
no stored version (its page would 404), a parent plugin that is not there in a
repository read in full, a malformed source path, a blank name, a finding whose
commit is not its version's, a repository with artifacts but no read date, and
the home, search and per-type totals disagreeing — and exits 1 if any holds a
row. Beside them it prints observations that are allowed and worth seeing: what
the listing leaves out and why, the same file or the same name in several
repositories, read age, failing checks, partial reads, delistings, parse status,
and failed jobs by their last outcome. `--repo=owner/` narrows it, `--json`
prints it whole. It repairs nothing.

Both send `default_transaction_read_only=on` and `statement_timeout=30s` as
startup parameters, and before reading anything they open all ten pool
connections and confirm the server's settings on each (read-only, timeout, role
`agentdock_app`, search_path), then check that a `CREATE TEMP TABLE` inside an
always-rolled-back transaction is refused with SQLSTATE 25006
(`src/db/readOnly.ts`). Any mismatch reads nothing and exits 2. A pooled
endpoint (`-pooler`) is refused before connecting, since PgBouncer may drop a
startup parameter. Errors print their code, never their message.

Against the deployment's database, run **`bun run ops:preflight`** first: the
same checks, one PASS/FAIL line each. `--production` (any mode) adds the deploy
workflow's target check before connecting — no loopback, no pooler, fingerprint
equal to `AGENTDOCK_TARGET_FINGERPRINT`. Bun reads `.env` by itself, so a run
aimed at a hosted database is `bun --no-env-file scripts/ops.mjs …`:

```zsh
# From the repository root. The URL is typed without echo, never an argument.
read -rs "DATABASE_URL?direct URL: "; echo; export DATABASE_URL DATABASE_SCHEMA=agentdock
export AGENTDOCK_TARGET_FINGERPRINT=<the 16 hex the deploy workflow pins>
bun --no-env-file scripts/ops.mjs preflight --production   # exit 0 before going on
bun --no-env-file scripts/ops.mjs status --production
bun --no-env-file scripts/ops.mjs quality --production
unset DATABASE_URL
```

Exit codes, every mode: 0 read and reported (preflight: every check passed); 1
`quality:check` found a rule violated; 2 nothing reported — the target was
refused, a connection check failed, or the database could not be read.

### Incremental refresh, by commit SHA

A repository whose default branch has not moved since the last read
short-circuits **before a single file is fetched**: the commit SHA that arrives
with the tree response is compared against the stored `last_ingested_sha`, and a
match ends the run at two core requests and zero raw fetches.

Running the sync twice in a row therefore reads almost nothing the second time —
which is the property the twice-daily schedule depends on.

Re-checking is scheduled on `scanned_at`, oldest first, so a corpus larger than
one run's cap rotates through itself rather than starving its tail. Forks and
archived repositories are skipped by the refresh pass — an archive has no next
commit — but nothing is deleted, and **stars are not consulted at all**.

## Search / Browse

![The AgentDock artifact browser: a search field, filters for artifact type and capability, and a result list carrying each artifact's path, stars, read date and source link](docs/images/agentdock-artifacts.png)

- **Full text** over name, summary, path and type, weighted A→D, in a
  PostgreSQL generated `tsvector` column maintained by the database.
- **Typo tolerance** — when full text finds nothing, a trigram pass over name and
  summary offers close matches, labelled as close matches and never as exact
  ones.
- **Filters** by artifact type and by capability observation, applied in SQL
  inside the same predicate the count uses.
- **URL as state.** Query, filters and page are all in the address bar, the form
  is a plain GET with native controls, and the whole page works with JavaScript
  disabled.
- **Keyboard.** `/` and Ctrl/Cmd+K put the cursor in the search field. On a page
  that has the field they focus it and select the query, so the next keystroke
  replaces it; on a page that does not, a small launcher opens as a native
  `<dialog>` — Escape closes it, and a query submits straight to the search
  page. It is not a second search implementation: the launcher sends the same
  `q` to the same route with the same GET. The type chips inside the launcher
  are likewise plain `/artifacts?type=…` links — the same URL the search form
  produces. The key hints drawn inside the search field appear only while
  JavaScript is actually running, and name the modifier the reader has (`⌘K` or
  `Ctrl K`): every shortcut here is bound by that script, so nothing advertises
  a key that would do nothing.
- **Artifact type is carried on three channels** — a glyph, a word and a hue —
  so type is never signalled by colour alone and any one of the three is enough.
- **Permalinks.** Every artifact has a stable URL, and every "source on GitHub"
  link points at the commit SHA AgentDock actually read — never at a branch,
  which would drift.
- **Path queries.** A query containing `/` is read as a path, and artifacts whose
  source path contains it rank first. No other query's order changes.
- **Sort.** Relevance (beside a query), recently indexed, newly added, content
  changed, or name — links, in the URL as `sort=`, kept across filters and paging
  and reset to page 1 when changed. With no query the default is recently
  indexed, and relevance is not offered: every row would tie. The three date
  orders are three different clocks, and the page says which one it is using:
  *recently indexed* is when a read last stored the artifact, *newly added* when
  AgentDock first stored it, and *content changed* when AgentDock recorded a
  second or later version of its bytes — not when the change was committed.
  Artifacts with one recorded content follow, so the set never changes.
- **Why a row matched.** Each result says which fields held a query word — name,
  path, description, type, repository — read from the same stored search vector
  the query matched, so the sentence is a condition PostgreSQL evaluated, not a
  guess. Query words are marked in the name and description by `ts_headline`
  (same parser and stemmer as the search) and in a path for a `/` query; the
  marks are split into React text and `<mark>` nodes, never markup strings.
- **Search quality is measured.** `bun run search:eval` runs a fixed 50-query set
  and prints Precision@5/10, Recall@10, MRR, NDCG@10, Top-1, zero-result rate and
  latency; the test pins each query's first relevant rank and the mean MRR and
  NDCG, so a ranking change that worsens any of them fails CI.
- **Artifact pages.** An artifact under a plugin's directory names its plugin and
  the plugin's other components, and a plugin lists the components under its
  directory — by path; a plugin.json path override is not followed. Below that,
  up to twelve other listed artifacts from the same repository, by type and name,
  with the total and a link to the repository page, and a link that searches the
  artifact's own name within its type. No similarity score: every relation is a
  stored fact, and "similar" is left to the measured search ranking. The page also lists every stored version (one row per
  distinct content, each linked at its commit) and a usage note for the type:
  its documentation, where a copy goes, what to read first. The note describes
  the type, never the file.

Capability filters narrow results; they are never a ranking input. Neither are
stars, downloads, or anything else about a repository's popularity.

## Architecture

```
Next.js 16 (App Router, all routes force-dynamic, four client components)
        │
        └── PostgreSQL 16          the only datastore. No cache, no queue
             ├── search: tsvector + GIN, pg_trgm for typo tolerance
             └── the ingest queue: SELECT … FOR UPDATE SKIP LOCKED
```

There is no Redis, no OpenSearch, no vector database and no message broker. The
queue is a table, the scheduler is cron, and the lock manager is PostgreSQL.

The front end is the same shape. Every page is a Server Component rendering
plain CSS with custom properties — no UI kit, no CSS framework, no animation
library and no icon package. Four components carry `'use client'`, none of
them holds data or fetches anything: a polling effect on the job page, a
keyboard shortcut that puts the cursor in the search field (`/`, or Ctrl/Cmd+K),
a copy button for paths, links and setup text on the detail page, and the error boundary,
which the framework requires to be a client component. Search is a GET form;
the type and capability filters and the pager are plain links whose URLs carry
the whole search state, so all three work with JavaScript disabled and survive
Back, reload and a shared link.

So is the motion. The index-flow diagram's one reveal, the loading
placeholder's sweep, and every hover and focus response are CSS — the diagram is
HTML and CSS rather than an SVG asset, and there is no scroll observer anywhere.
Decorative motion that looped or replayed on every page (the background drift,
the connector pulse, block and row entrances) was removed in Phase 57. The
typeface is one latin variable file of Schibsted Grotesk (OFL-1.1), served from
the same origin by `next/font/local`; CJK text falls through to system fonts. Every keyframe animation is
declared inside one `prefers-reduced-motion: no-preference` block, so for a
reader who asked for less motion there is nothing left to switch off: it is
never declared.

```
src/
  app/          pages only — no server functions, deliberately
    artifacts/                   browse and search
    jobs/[id]/                   one ingest run, read-only
    r/[owner]/[repo]/            a repository and what AgentDock lists for it
    r/[owner]/[repo]/[...path]/  one artifact: every field, and the permalink
  components/   the sanitizing Markdown renderer, listing rows, inline icons
  corpus/       policy.ts (the discovery gate), caps.ts (every acquisition
                bound), refresh.ts (which stored repository to re-check),
                fanout.ts, seedList.ts, links.ts, search.ts
  db/           schema, connection, and the read queries the pages use
  detect/       six detectors, tolerant frontmatter parsing, capped JSON parsing
  analyze/      capability observation — what a file references, never a verdict
  github/       the HTTP client, metadata, tree and raw reads
  ingest/       pipeline.ts (the whole path), persist.ts (the one transaction),
                errors.ts (everything a person can be told), retry.ts (the delay
                curve and the per-outcome disposition), worker.ts (one job)
  proxy.ts      the per-request nonce and the Content-Security-Policy
scripts/        migrate, sync, corpus reset, boundary scan, fixture capture
fixtures/       frozen GitHub responses and hand-written hostile inputs
```

## Local Development

```bash
cp .env.example .env      # fill in the password you chose during bootstrap
bun install
bun run db:migrate
bun run dev               # http://localhost:3000
```

`bun run dev` refuses to start unless it is connected as a role whose
`search_path` is confined to a schema AgentDock owns.

Nothing is indexed yet, and the dev server will not index anything. To fill it:

```bash
# Frozen fixtures, no network at all. Four real repositories, pinned to a SHA.
bun run db:seed
bun run db:seed baoyu-skills

# Or the real thing, bounded. Unauthenticated: ~25 repositories and 50 of 60 core
# requests. With GITHUB_TOKEN: up to 100 new + 100 re-checks, stopped 35 minutes
# after the start (src/corpus/caps.ts, `authenticated` and `drainDeadlineMs`).
bun run sync
```

`db:seed` runs the **real** pipeline with `fetch` replaced by a fixture reader,
so seeded rows are exactly what a live ingest would produce.

## Database

AgentDock is built to share a PostgreSQL server with something else. It owns two
schemas — `agentdock` and `agentdock_test` — and holds no privilege on anything
outside them.

```bash
# Once, as a superuser. Read it first.
psql -U <superuser> -d <database> -v ON_ERROR_STOP=1 -f scripts/sql/bootstrap-agentdock.sql
psql -U <superuser> -d <database> -c '\password agentdock_app'
```

`\password` prompts without echo and sends only a SCRAM verifier, so the
plaintext never reaches a file, a command line or a server log.

- Rollback: `scripts/sql/rollback-agentdock.sql`
- Proof the boundary holds: `scripts/sql/verify-isolation.sql`

Search's typo tolerance needs `pg_trgm`. AgentDock never installs it — the
migration that uses it opens with a guard that fails loudly, naming the exact
command, if it is missing:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA public;   -- superuser, once
```

### Why `scripts/migrate.mjs` and not `drizzle-kit migrate`

Both drizzle-kit and drizzle-orm's own migrator begin with
`CREATE SCHEMA IF NOT EXISTS`. PostgreSQL checks `CREATE` on the *database*
before checking whether the schema already exists, so that statement fails with
`42501` for a role that is `NOCREATEDB` and holds no `CREATE` on the database —
which is exactly what AgentDock's role is, on purpose.

Granting that privilege would hand AgentDock the ability to create schemas in a
database it shares. So `scripts/migrate.mjs` reuses drizzle's own migration
reader and history-table format — same files, same hashes, same
`__drizzle_migrations` columns — and omits the one statement the role cannot
run. Switching back later needs no data change. `drizzle-kit generate` is
untouched; it is offline and opens no connection.

## Docker Deployment

Four Compose services. Only the first one runs continuously; the other three are
one-shots behind the `tools` profile, so `docker compose up` cannot start them.

| Service | Profile | What it is |
|---|---|---|
| `agentdock` | — | the web container: SSR, browse, search |
| `sync` | `tools` | the scheduled ingest, from cron |
| `migrate` | `tools` | apply migrations, before a new image |
| `corpus-reset` | `tools` | empty the corpus; gated, almost never |

```bash
cp .env.example .env.production      # add AGENTDOCK_PORT
docker compose --env-file .env.production --profile tools run --rm migrate
docker compose --env-file .env.production build agentdock
docker compose --env-file .env.production up -d agentdock
```

`--env-file` is not optional. A service's `env_file:` is injected into the
container but is *not* read when Compose interpolates `${AGENTDOCK_PORT}` in the
`ports:` mapping — only Compose's own env file is, and this repository ships no
`.env`. Omitting the flag fails loudly, which is the intended behaviour rather
than a silent default port.

`AGENTDOCK_PORT` has no default deliberately, so it cannot silently take a port
another service on the host wants.

See [DEPLOY.md](DEPLOY.md) for the full runbook, including the one-time corpus
reset and cron registration.

## Vercel Deployment

A second deployment path, for a personal project on free plans: Vercel Hobby
serves the web, Neon Free holds PostgreSQL, and GitHub Actions
(`.github/workflows/sync.yml`) runs `bun run sync` twice a day. Same code, same
invariants as the Docker path. The web still ingests nothing, and there is no
cron route and no API route.

Two reasons sync does not run on Vercel Cron. A Hobby cron fires at most once a
day (±59 min) and a function stops at 300 s, while one sync's topic sweep alone
takes up to about 6.5 minutes. And a cron needs a route — a public URL that
starts ingestion.

| Where | Variable | Value |
|---|---|---|
| Vercel | `DATABASE_URL` | the agentdock_app Neon **pooled** connection string |
| Vercel | `DATABASE_SCHEMA` | `agentdock` |
| GitHub Actions secret | `DATABASE_URL` | the agentdock_app Neon **direct** connection string |
| GitHub Actions secret | `AGENTDOCK_GITHUB_TOKEN` | a scopeless token; optional, recommended |
| GitHub Environment `production` secret | `VERCEL_TOKEN` | for `deploy.yml`'s `vercel deploy` |
| GitHub Environment `production` variable | `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `PRODUCTION_URL`, `AGENTDOCK_TARGET_FINGERPRINT` | identifiers, not credentials. The last one is the output of `migrate.mjs --fingerprint` |

`.github/workflows/deploy.yml` is the only path to production. After CI succeeds
on a push to develop, it runs these for the same sha, in order:

1. the migration plan
2. apply and verify the migrations
3. `vercel deploy --prod`
4. a smoke test

`vercel.json` turns off Vercel's own Git deployments, so new code never goes live
before its migrations are applied. A migration that is not plainly additive is
held back: an operator backs up first, then names its tag.

The full runbook — Neon bootstrap, `pg_trgm`, migrations, the Preview database
policy, the first sync, smoke test, rollback and free-plan limits — is
[VERCEL_DEPLOY.md](VERCEL_DEPLOY.md). Run **one** of the two paths: a host cron
and `sync.yml` together spend the GitHub budget twice.

## Cron Setup

Twice a day, twelve hours apart — which is what makes the schedule and the
twelve-hour staleness cutoff agree:

```cron
0 3,15 * * * cd /path/to/agentdock && docker compose --env-file .env.production --profile tools run --rm sync >> /var/log/agentdock-sync.log 2>&1
```

Replace `/path/to/agentdock` with wherever you deployed it, and note that the
times are the server's local timezone. Do not add a systemd timer as well: two
schedulers running the same one-shot is how a 60-requests-an-hour budget gets
spent twice.

## Testing

```bash
bun run ci     # boundary scan, lint, type-check, tests — exactly what CI runs
```

**No test opens a socket.** `fixtures/` holds frozen GitHub responses for four
real repositories pinned to a commit SHA, plus hand-written hostile inputs
(`adversarial/`, `xss/`), and the whole suite runs against those bytes.

Database-backed suites run **only against a disposable local PostgreSQL**. No
test reads a connection string from `.env` or from the shell's `DATABASE_URL`:
`vitest.config.ts`, every worker, and `bun test`'s preload clear `DATABASE_URL`
and take one only from `TEST_DATABASE_URL`, and only when it is exactly a
loopback host (`127.0.0.1`, `localhost`, `[::1]`), port `55432`, database
`agentdock_test`, no query string — otherwise nothing starts
(`src/db/testDatabase.ts`). A Neon host is refused by name, and no message
quotes the URL. Without `TEST_DATABASE_URL` the database suites skip visibly.

```bash
# The disposable test database (trust auth — no password anywhere, loopback only)
docker run -d --name agentdock-testdb -e POSTGRES_DB=agentdock_test \
  -e POSTGRES_HOST_AUTH_METHOD=trust -p 127.0.0.1:55432:5432 postgres:17
export TEST_DATABASE_URL=postgres://agentdock_app@127.0.0.1:55432/agentdock_test

bun run db:test:bootstrap   # role, both schemas, pg_trgm (a deployment's superuser step)
bun run db:test:setup       # build agentdock_test from schema.ts (DDL only — deletes nothing)
bun run db:test:migrations  # the reviewed drizzle/ files, into agentdock in the same database
bun run test                # with the DB suites; src/db/migrations.test.ts compares the two
bun run db:test:reset       # empty it (the schema name is a literal in the script)
```

`db:test:*` and `db:test:migrations` read `TEST_DATABASE_URL`, never
`DATABASE_URL`: Bun loads `.env` on its own, so they used to reach whatever
database `.env` named. CI's `database` job runs the same container and the same
commands (`.github/workflows/ci.yml`).

Vitest runs test **files in parallel** against that one schema, so a
database-backed suite keys its rows on a sentinel no other suite can produce.

**Browser journeys** (`e2e/journeys.spec.ts`, Playwright, Chromium) run against
the production build and the same disposable database, seeded offline from the
committed fixtures plus `e2e/fixtures/ui-edge-cases` (subagents, an MCP
declaration and a hook carrying invented credentials, a command whose file name
holds `#`, a very long name):

```bash
bun run db:test:migrations && bun run e2e:seed   # TEST_DATABASE_URL as above
bun run build                                    # placeholder DATABASE_URL is enough
bunx playwright install --only-shell chromium    # once
bun run test:e2e
```

`playwright.config.ts` starts the standalone server with `TEST_DATABASE_URL` and
refuses any URL the test allowlist refuses. CI's `e2e` job runs the same steps.

## Commands

| Command | What it does |
|---|---|
| `bun run dev` | Development server. Starts no ingestion. |
| `bun run build` / `bun run start` | Production build and serve. The build connects to no database, but needs a well-formed `DATABASE_URL` (a placeholder is enough). |
| `bun run sync` | **The scheduled job.** Discover, refresh, drain, summarize. |
| `bun run corpus:sync --source=…` | The same machinery with sources and caps exposed, for filling an index by hand |
| `bun run corpus:reset --confirm` | Empty the corpus. Refuses unless `AGENTDOCK_ALLOW_CORPUS_RESET=1` as well. Drops nothing. |
| `bun run ops:status [--hours=24] [--markdown \| --json]` | Sync health: last run, queue, attempts in a window, corpus counts. Read-only; exit 2 only if the database could not be read. |
| `bun run quality:check [--repo=owner/] [--json]` | Integrity rules and corpus observations. Read-only; exit 1 if a rule holds a row. |
| `bun run ops:preflight [--production]` | Only the connection checks both reports run before reading, one PASS/FAIL line each. Exit 2 on any FAIL. |
| `bun run ci` | Boundary scan, lint, type-check, tests |
| `bun run test` | Vitest. Note the `run`: bare `bun test` invokes Bun's own runner, which also executes these files and loads `.env`, so `bunfig.toml`'s preload applies the same test-database isolation. |
| `bun run lint` / `bun run format` | Biome, check and write |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run check:boundaries` | The migration and source boundary scan |
| `bun run db:generate` | Generate a migration from `src/db/schema.ts`. Offline. |
| `bun run db:migrate` | Apply the reviewed migrations in `drizzle/` |
| `bun run db:seed [fixture]` | Ingest a frozen fixture through the real pipeline |
| `bun run db:reset --confirm` | Drop every table in `agentdock` (development only) |
| `bun run db:test:bootstrap` | Role, schemas and pg_trgm in the disposable test database |
| `bun run db:test:setup` / `db:test:reset` | Build / empty the test schema (reads `TEST_DATABASE_URL` only) |
| `bun run db:test:migrations` | Apply the reviewed `drizzle/` migrations to the test database's `agentdock` |
| `bun run search:eval` | The fixed search evaluation set, with the quality and latency report (test database) |
| `bun run e2e:seed` / `bun run test:e2e` | Seed the test database for, and run, the browser journeys |
| `bun run fixtures:capture` | Re-pin the fixture corpus from GitHub |
| `bun run analyze:backfill [limit]` | Re-run the capability analyzers over stored bytes. Issues no GitHub request. |

There is deliberately no `db:push` and no `db:pull`. Those are the only migration
commands that diff live database state, and this database may hold another
application's data; `bun run check:boundaries` fails the build if such a script
ever appears.

CI runs `bun run build` and then `bun run ci` — the same commands you run, so the
two cannot drift — and, in a second job, the database suites against a
PostgreSQL 17 service container, and, in a third, the browser journeys. The build comes first because it regenerates a type
declaration the linter then reads.

## Security Considerations

**AgentDock does not tell you whether an artifact is safe.** It reads files and
reports what it read.

What it does say is what it *observed* while reading, in a vocabulary of
observation rather than judgement:

- *No network request observed*
- *No Bash grant declared*
- *No bundled script files*

Each of those describes what AgentDock looked at, not everything an artifact can
do. The network and Bash filters list only skills and commands whose latest
version was analyzed to the end — the other types carry no text those analyzers
read, and an unanalyzed version is not evidence of absence. The script filter lists only skills and plugins, whose file list is a directory, and only when that list was not cut at its 200-entry cap. The interface says so on every page that shows one. Null and empty are kept
distinct throughout: an artifact analysed and found to declare nothing reads
differently from one nothing has analysed.

Five structural rules are enforced by `bun run check:boundaries` on every
non-test file under `src/`, because each is a requirement that can be enforced
rather than remembered:

| Rule | Fails on | What it protects |
|---|---|---|
| `no-raw-html` | `rehype-raw`, `dangerouslySetInnerHTML`, `allowDangerousHtml` | Untrusted Markdown is never parsed into markup. HTML in a skill body is a text node. |
| `no-execution` | `child_process`, `execSync`, `spawnSync`, `node:vm` | Nothing from a scanned repository is ever run. |
| `no-disk-write` | `writeFileSync`, `createWriteStream`, `mkdirSync`, … | Repository content never reaches disk, which removes archive extraction and path traversal by construction. |
| `no-host-sprawl` | a GitHub hostname named outside `src/github/` | `git grep` answers "what can this reach" completely. Every URL is built from two validated parts. |
| `no-verdict-vocabulary` | *safe*, *clean*, *verified*, *trusted*, *approved*, *malicious*, *grade*, *risk score* in UI copy | No page ever renders a safety verdict. |

The 50-star floor is **not** part of this. It is a scheduling rule about a
request budget and buys no assurance about anything it admits.

Every artifact body is stored as a capped excerpt with attribution, never as a
mirror, and every rendered body goes through a sanitizing Markdown pipeline.

The detail page's **Setup** section shows what the file itself declares — an MCP
server's command, arguments and URL, a hook's event, matcher and command, a
command's slash name — as text with a copy button, never a run button. Values
that look like credentials (a value after a key-, token- or password-named flag
or parameter, a bearer header, a URL password, a well-known token prefix) are
shown as `<redacted>` there and in declared-capability lines; the permalink is
the unredacted original. It is a pattern match, so it can miss an unlabelled
secret. The rendered file excerpt below it is shown as published. No install
command is composed: a plugin's marketplace is not recorded, so none is shown.

## Limitations

- **The corpus is small and deliberately bounded.** Every acquisition source has
  a cap, and every cap prints what it dropped.
- **Unauthenticated GitHub is 60 requests an hour**, two per repository — about
  thirty repositories an hour, which is the real limit on how fast the index can
  grow. `GITHUB_TOKEN` raises it to 5,000 and needs no scopes.
- **A large repository is read partially.** 600 files per pass, 120 seconds of
  wall clock. A repository cut short says so on its own page, and nothing is
  delisted from an incomplete read — a partial read is not evidence of absence.
- **Capability observation is not analysis.** It reads a file's declared
  frontmatter and its text; it does not resolve imports, follow references or
  execute anything.
- **Search is PostgreSQL full text plus trigrams.** No embeddings, no semantic
  search, no ranking by anything but text relevance.
- **Ordering is by relevance, a date or name, never quality.** There is no "most
  starred" sort and no "popular" list: AGENTS.md keeps popularity out of
  ranking, and a list ordered by stars is a ranking.
- **"Content changed" is AgentDock's clock.** A change is dated when a sync
  recorded it — up to a scheduled run, or a refresh cycle, after the commit — and
  a repository read for the first time records nothing as changed.
- **Operator reports are not public.** There is no sign-in, so `ops:status` and
  `quality:check` run in a terminal or a workflow, never on a page.
- **Setup guidance is what the file says, not a tested install.** AgentDock does
  not run what it lists, so it cannot say whether a configuration works in a
  given client.

## Development Workflow

See [CLAUDE.md](CLAUDE.md) for the working agreement and [AGENTS.md](AGENTS.md)
for the invariants. In short: read the source before changing it, keep the diff
narrow, add a regression test for anything that was a bug, and run `bun run ci`
and `bun run build` before calling it done.
