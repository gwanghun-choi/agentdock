# Deploying AgentDock on Vercel + Neon + GitHub Actions

The serverless alternative to [DEPLOY.md](DEPLOY.md)'s single Docker server,
sized for free plans and a personal, non-commercial project. Same code, same
invariants, same lifecycles — only who runs each piece changes.

```
Vercel (Hobby)          the web: SSR, browse, search      — reads, never ingests
GitHub Actions          .github/workflows/ci.yml          — every push and pull request
GitHub Actions          .github/workflows/deploy.yml      — after CI on develop: migrate, then deploy
GitHub Actions          .github/workflows/sync.yml        — `bun run sync`, twice a day
Neon (Free)             PostgreSQL; AgentDock owns one schema in it
```

The central fact of DEPLOY.md still holds: **a deploy, a cold start, a rollback
and a redeploy issue zero GitHub requests.** There is no cron route and no API
route — ingestion has no HTTP entry point on Vercel either.

Like DEPLOY.md, this document names no host, endpoint, database password or
project id. Every `<…>` is yours to fill in, and none of it belongs in a tracked
file.

## Why this shape

| Piece | Why not on Vercel |
|---|---|
| sync | A Hobby function stops at 300 s and a Hobby cron fires at most once a day (±59 min). One sync's topic sweep alone is up to 60 search requests at 6.5 s spacing, then up to 25 repositories at up to 120 s of reads each. And a cron needs a route — a public URL that starts ingestion. |
| migrate | Never a boot step (DEPLOY.md step 6). It is a step of `deploy.yml` that runs before Vercel builds the commit, so no build that needs a migration goes live before that migration is applied. |
| corpus reset | Never on Vercel at all. `AGENTDOCK_ALLOW_CORPUS_RESET` is not set there. |

## Free-plan limits that matter

Checked 2026-10-19 against each provider's own pricing and limits pages.
Re-check before relying on them; they change.

| Plan | Limit | What it means here |
|---|---|---|
| Vercel Hobby | non-commercial personal use only | The project must stay personal |
| | 300 s max function duration | Pages are fine; sync could never fit |
| | 1 cron/day, ±59 min | Why the schedule is in GitHub Actions |
| | 1M invocations, 4 active-CPU hours, 100 GB transfer / month | Exceeding them pauses the feature for 30 days rather than billing |
| | 1 hour of runtime logs | Smoke-check logs right after a deploy |
| Neon Free | 1 GB storage per project | Writes block above it |
| | 100 CU-hours / month; compute suspends after 5 idle minutes | 0.25 CU running all month is ~182 CU-hours. Suspend is what makes the plan fit, and an idle open connection prevents it. That is why `src/db/client.ts` sets `idle_timeout` |
| GitHub Actions | free standard runners on a public repository | Schedules are disabled after 60 days with no commit; re-enable from the Actions tab |

Expected cost at personal-project traffic: **$0/month**. The first paid step on
the database side is Neon's usage-based Launch plan, with no monthly minimum.

## Step 1 — create the Neon project

Pick a region and remember it: step 5 puts the Vercel functions in the same one.
Each page runs several queries in turn, so the function-to-database round trip
counts for more than the distance to the reader.

Neon gives every endpoint two connection strings. Both are needed:

| | Host contains | Used by |
|---|---|---|
| **pooled** | `-pooler` | the Vercel web tier |
| **direct** | no `-pooler` | psql bootstrap, `bun run db:migrate`, the sync workflow |

## Step 2 — bootstrap the role and schemas

Same file as on a shared server, run once with the project's owner role over
the **direct** string. Read it first; it is short.

```bash
# from the repository root
read -rs NEON_OWNER_URL && export NEON_OWNER_URL     # paste; not echoed, not in history
psql "$NEON_OWNER_URL" -v ON_ERROR_STOP=1 -f scripts/sql/bootstrap-agentdock.sql
psql "$NEON_OWNER_URL" -c '\password agentdock_app'
```

**PENDING — not yet run against Neon.** Neon's owner role is not a superuser.
If `CREATE SCHEMA … AUTHORIZATION agentdock_app` fails with
`must be able to SET ROLE "agentdock_app"`, make the owner a member of the app
role and re-run the file. The `CREATE ROLE` that already succeeded will then
fail with "already exists", so run only the remaining statements:

```sql
GRANT agentdock_app TO <owner role>;   -- the owner joins agentdock_app; agentdock_app gains nothing
CREATE SCHEMA agentdock      AUTHORIZATION agentdock_app;
CREATE SCHEMA agentdock_test AUTHORIZATION agentdock_app;
ALTER ROLE agentdock_app SET search_path = agentdock;
```

The grant runs one way only: the owner becomes a member of `agentdock_app`.
`agentdock_app` itself joins no role, so `verify-isolation.sql`'s "no inherited
role memberships" check is unaffected.

The `ALTER ROLE … SET search_path` line matters more here than on a server.
Neon's pooler drops session `SET`s between transactions, and its documentation
names the role-level default as the fix.

Then prove the boundary:

```bash
psql "$NEON_OWNER_URL" -v ON_ERROR_STOP=1 -f scripts/sql/verify-isolation.sql
```

**PENDING.** The file was written for a self-managed server. If it fails on a
property Neon sets itself — for example who owns `public` — that is Neon's
default and not an AgentDock change. Read the failing check before acting on
it.

## Step 3 — pg_trgm

Search's typo tolerance needs it. AgentDock's migrations never create it, and
migration 0007 fails loudly without it.

```bash
psql "$NEON_OWNER_URL" -c 'CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA public;'
```

## Step 4 — apply migrations, from your machine

Over the **direct** string, as `agentdock_app`. A variable you export takes
precedence over a local `.env`, so this cannot land on your development database
by accident.

```bash
# from the repository root
read -rs DATABASE_URL && export DATABASE_URL         # the agentdock_app DIRECT string
DATABASE_SCHEMA=agentdock bun run db:migrate
unset DATABASE_URL NEON_OWNER_URL
```

The order rule from DEPLOY.md is unchanged: **migrations first, then the deploy
that reads them.**

## Step 5 — create the Vercel project

Import the GitHub repository. Leave the defaults: Vercel detects Next.js, and
`bun.lock` makes it install with bun. The committed `vercel.json` holds a single
setting: it turns off Vercel's own Git deployments of `develop` and `main`, so
`deploy.yml` is the only path to production ([Automated deploys](#automated-deploys)).

- **Settings → Functions → Function Region:** the region nearest your Neon
  region (Vercel's default is `iad1`, Washington, D.C.).
- `output: 'standalone'` in `next.config.ts` is the Docker path, and it is off
  when `VERCEL` is set. With it on, the first production build failed after
  `Running onBuildComplete from Vercel` with `ENOENT … next-server.js.nft.json`:
  an adapter build on Next 16.3 emits no server trace, and the standalone step
  needs one. `next.config.ts` has the detail.

### Environment variables

| Variable | Production | Preview | Value |
|---|---|---|---|
| `DATABASE_URL` | yes | see below | the agentdock_app **pooled** string |
| `DATABASE_SCHEMA` | yes | yes | `agentdock` |

The build reads `DATABASE_URL` but never connects with it. `next build`
evaluates every route module to read its segment config, and `src/db/client.ts`
validates the variable as it loads. So the variable must exist for the build
too — Vercel exposes project variables to builds by default.

Not set on Vercel, deliberately:

- `GITHUB_TOKEN` — the web tier makes no GitHub request.
- `NODE_ENV` — Vercel sets it.
- `AGENTDOCK_PORT` — Docker only.
- `AGENTDOCK_ALLOW_CORPUS_RESET` — never.

**PENDING — the pooled connection.** `src/db/client.ts` sends `search_path` as a
startup parameter, and Neon's documentation does not say whether its PgBouncer
accepts one. If the first request fails with `unsupported startup parameter`,
set `DATABASE_URL` to the **direct** string instead. That changes no code and no
isolation property. `idle_timeout` keeps idle connections from holding the
compute awake, and a personal project's concurrency is well inside a small
compute's direct-connection limit. Either way, `register()` runs
`assertSchemaIsolation()` on every cold start: a connection that is not
`agentdock_app` confined to `agentdock` refuses to serve.

### Preview deployments

Every push to a non-production branch builds a Preview, and a Preview with
production's `DATABASE_URL` is production's database behind an unlisted URL.
Choose one policy:

1. **Recommended: a Neon branch.** Create a branch (a copy-on-write snapshot,
   role and schemas included), and set its pooled string as `DATABASE_URL` for
   the **Preview** environment only.
2. **No previews.** Leave `DATABASE_URL` unset for Preview. Preview builds then
   fail at the env check, loudly, and nothing reaches the database. Or turn
   previews off under Settings → Git.

Never point Preview at `DATABASE_SCHEMA=agentdock_test`. That schema belongs to
the test suites, which reset it.

## Step 6 — GitHub Actions secrets

Repository → Settings → Secrets and variables → Actions:

| Secret | Value |
|---|---|
| `DATABASE_URL` | the agentdock_app **direct** string |
| `AGENTDOCK_GITHUB_TOKEN` | a token with **no scopes**: fine-grained, public repositories read-only. Optional, but set it — without one the sync's 60-an-hour unauthenticated budget belongs to the runner's shared IP address. Never your `gh auth token` (`.env.example` says why). |

The workflow passes only these two secrets, grants the job `contents: read`, and
checks out without persisting credentials.

`deploy.yml` needs one more secret and four variables, all in the `production`
environment. [Automated deploys](#automated-deploys), step A, lists them.

Public repository logs are public. A sync prints repository names and counts,
never a credential: secrets are masked, and `corpus-sync.mjs` prints error
messages without their causes.

**A Docker deployment must not also run this workflow.** Disable it there:
`gh workflow disable sync.yml`. Two schedulers running the same one-shot spend
the budget twice.

## Step 7 — the first sync

Schedules and manual runs both use the workflow file on the default branch, so
`sync.yml` must be merged there first.

```bash
gh workflow run sync.yml
gh run watch
```

Read the summary at the end of the log, exactly as DEPLOY.md step 12 describes.
A run that stops with `fewer than two GitHub core requests remain` is correct,
not a failure. From then on, the schedule runs at 06:00 and 18:00 UTC (15:00
and 03:00 KST).

The run's summary page also carries an "AgentDock sync health" table: the
step after the sync runs `bun run ops:status --markdown` over a read-only
connection (README, Scheduled Synchronization). Counts and statuses only. The
report first confirms the connection is read-only on every pooled connection;
if it cannot, the step prints `ops: FAIL …` to its log, adds no table, and the
sync stays green (`continue-on-error`). The secret must be the direct endpoint:
a `-pooler` URL is refused.

## Step 8 — smoke the deployment

```bash
BASE=https://<your-project>.vercel.app
curl -sI "$BASE/" | head -1
curl -sI "$BASE/artifacts" | head -1
curl -sI "$BASE/skills" | grep -i -E '^(HTTP|location)'     # expect 308 → /artifacts
curl -sI "$BASE/" | grep -i content-security-policy          # expect a nonce and upgrade-insecure-requests

for q in mcp playwright claude github playwrit postgress mcp-sever zzzznotathing; do
  printf '%-14s ' "$q"
  curl -s -o /dev/null -w '%{http_code} %{time_total}s\n' "$BASE/artifacts?q=$q"
done
```

`playwrit`, `postgress` and `mcp-sever` render "close matches", the trigram
fallback. `zzzznotathing` renders the zero-result page, not an error.

Then open the project's **Logs** within the hour Hobby keeps them:

- no line containing `"event":"ingest"` — the web tier ingests nothing.
- no `Refusing to start` — the connection is confined.

## Rollback

| What | How |
|---|---|
| A bad web deploy | Vercel → Deployments → the previous production deployment → **Instant Rollback**. Hobby can roll back to the immediately previous one; anything older is a redeploy of that commit. Either costs zero GitHub requests, like every web lifecycle event. |
| Stop ingestion | `gh workflow disable sync.yml`. Re-enable with `enable`. A run killed part-way leaves a claimed job, which the next run's `reapAbandoned` returns to the queue. |
| A bad migration | Migrations that run unattended are additive and are applied before the code that reads them, so rolling back the web is normally enough. For data, use Neon's instant restore. Free keeps 6 hours of history, up to 1 GB-month (checked 2026-10-22). [Emergency recovery](#emergency-recovery) has the order. |
| Stop automated deploys | `gh workflow disable deploy.yml`. Production keeps serving what it serves. |
| Back to Docker | DEPLOY.md is unchanged and still works. Disable `sync.yml` **before** the host cron starts. |
| Remove AgentDock entirely | `scripts/sql/rollback-agentdock.sql`. **Destructive** — it drops both schemas with everything in them. Read its header and run the listing query it gives first. |

## Automated deploys

```
push to develop ─▶ CI (check, database, e2e) ─success─▶ deploy.yml
                                                         gate      this sha's own push CI passed; sha is develop's tip;
                                                                   production does not already serve it
                                                         plan      target pin, history vs drizzle/, risk rule   (read-only)
                                                         migrate   same checks under an advisory lock, apply, verify, commit
                                                         verify    nothing pending                               (read-only)
                                                         vercel    vercel deploy --prod: Vercel builds; the domain moves when ready
                                                         smoke     pages render from the database; X-AgentDock-Commit = sha
```

**The invariant: production never serves a build whose migrations have not
been applied.** Two things keep it true:

- `vercel.json` turns off Vercel's Git deployments of `develop` and `main`, so a
  push activates nothing by itself.
- `deploy.yml` reaches `vercel deploy` only after `migrate` and `verify` have
  succeeded for that same sha, in that same job.

Running the migration first in some other workflow would not be enough while
Vercel's Git deployment of the same push races it.

| Outcome | Production | What to do |
|---|---|---|
| `SUCCESS` | the new sha | nothing |
| `SKIPPED (SUPERSEDED)` | unchanged; a newer commit is on develop and has its own run | nothing |
| `SKIPPED (ALREADY_DEPLOYED)` | already serves this sha (a duplicate push event or a re-run) | nothing |
| `BLOCKED (migration plan)` | unchanged | read the plan step. `needs approval` → [a migration the rule held back](#a-migration-the-rule-held-back). `history:` → stop and investigate; do not edit the history table to make it pass |
| `FAILED (migration)` | unchanged code; the transaction rolled back. `55P03 … lock timeout` means a sync or another migrator held a lock for 15 s | re-run the workflow |
| `FAILED (Vercel deploy)` | the previous deployment; migrations of this sha are applied (additive, so the old build runs against them) | fix the build, push |
| `DEGRADED (smoke)` | the new build, or the old one if the domain did not move | read the smoke lines; [Emergency recovery](#emergency-recovery) |

Each pending migration is classified by `scripts/migration-gate.mjs`. Only an
allowlist of additive shapes applies unattended:

- a new table, index, type or sequence
- a nullable column, or a column with a literal default
- a foreign key on a table created in the same file
- the `artifact_type` seed

Everything else needs a person, whatever it looks like: DROP, DELETE, UPDATE,
ALTER COLUMN, RENAME, a DO block, a volatile or generated default, a
constraint on an existing table. So does anything the rule cannot read.

The principle is expand → migrate → contract. A contraction, such as dropping
a column the previous build still reads, ships in a later push. That push
comes once no deployed build reads the column.

### Activation — once, in this order

Nothing here has been run. Each step names what you should see before you go
on.

**A. GitHub (before any push).**

1. Repository → Settings → Environments → **New environment** → name
   `production`.
2. **Deployment branches and tags** → *Selected branches and tags* → add the
   rule `develop`.
3. **Environment secrets** → add `VERCEL_TOKEN`.
   - Create it at vercel.com → Account Settings → Tokens → **Create Token**.
   - Scope: your Hobby account. Choose an expiration and note it; Hobby has no
     per-project tokens, so this token can deploy every project in the account.
4. **Environment variables** (not secrets — none is a credential) → add these
   four:

| Variable | Value |
|---|---|
| `VERCEL_PROJECT_ID` | Vercel → the project → Settings → General → *Project ID* |
| `VERCEL_ORG_ID` | Vercel → Account Settings → General → *Vercel ID* (the account's id) |
| `PRODUCTION_URL` | the production domain, `https://<project>.vercel.app` |
| `AGENTDOCK_TARGET_FINGERPRINT` | the output of step B |

The repository secret `DATABASE_URL` (the direct string, step 6) is reused. No
Neon API key is needed: nothing calls Neon's API.

**B. Read-only check of production, from your machine.** This opens one
connection and reads `__drizzle_migrations`; it writes nothing.

```bash
# from the repository root
read -rs DATABASE_URL && export DATABASE_URL            # the agentdock_app DIRECT string
bun --no-env-file scripts/migrate.mjs --fingerprint     # → target fingerprint <16 hex>; store it (step A.4)
AGENTDOCK_TARGET_FINGERPRINT=<16 hex> bun --no-env-file scripts/migrate.mjs --plan --production
unset DATABASE_URL
```

Expect `agentdock: 11 applied, 0 pending, 11 on disk — UP_TO_DATE`.

- `history: … edited after it was applied` means a file in `drizzle/` differs
  from what production recorded. Stop here and find out why. Every automated
  deploy would block on it.
- Any `pending:` line means production is behind `develop` today. Apply it the
  way step 4 does before going on.

**C. Vercel.** Settings → Environments → Production → *Branch Tracking*
should name `develop`. Change nothing else. `vercel.json` does the switching,
and it travels with the commit.

**D. Push the activation commit.** It carries `vercel.json`, `deploy.yml` and no
migration. That is why the switch-over cannot violate the invariant. If
Vercel's Git deployment of this one commit did happen, it would serve code that
needs no migration.

Expect:

- one CI run
- a `Deploy` run whose summary reads `SUCCESS`
- `curl -sI "$PRODUCTION_URL" | grep -i x-agentdock-commit` printing the pushed
  sha

If `Deploy` fails, production still serves the previous Git deployment. Fix the
named step, then run `gh workflow run deploy.yml --ref develop`.

**E. Confirm Git deployments are off.** Push a second commit with no migration
(any small change). In Vercel → Deployments, its only new deployment must be
the one `deploy.yml` made. If a Git-triggered deployment appears, do not push a
migration. Disconnect the repository instead (Settings → Git → **Disconnect**);
`vercel deploy` from the workflow does not need the connection. Then repeat E. **Only after E passes may a commit carry a migration.**

### Every day

Push to `develop`. Read the `Deploy` summary. A sync never waits for a deploy:
`sync.yml` and `deploy.yml` have separate concurrency groups. The two meet only
in PostgreSQL:

- **The migrator's locks.** It waits at most 15 s for any lock and then fails
  cleanly; re-run it.
- **The sync's first step.** The sync refuses to run while `agentdock` is behind
  the checked-out code (`migrate.mjs --plan --require-current`). New sync code
  therefore never writes to a schema it does not match. While a migration waits
  for approval, every scheduled sync fails loudly for this reason.

### A migration the rule held back

1. Read the plan step: it names each file and the shape that was not additive.
2. Back up. Use Neon Console → Branches → **Create branch**, from `production`,
   at *Current point in time*, named `pre-<tag>`. Free allows 10 branches.
   Instant restore also covers the last 6 hours.
3. `gh workflow run deploy.yml --ref develop -f approve_migrations=<tag>[,<tag>]`.
   - An approval names exact tags.
   - It must name only pending files. A stale or misspelled tag blocks the run.
4. Delete the `pre-<tag>` branch once you no longer need it.

### Emergency recovery

The app and the database are recovered separately. Neither is ever rolled back
automatically.

1. **Stop the next deploy**: `gh workflow disable deploy.yml`.
2. **App**: Vercel → project → Production Deployment → **Instant Rollback**.
   Hobby can roll back to the immediately previous production deployment only.
   - After a rollback, Vercel stops assigning the domain to new deployments, so
     every later `deploy.yml` reports `DEGRADED` at the identity check.
   - **Undo Rollback** on the same tile (or `vercel promote <url>`) restores
     normal behaviour.
3. **Database**: a migration that ran unattended was additive, so the previous
   build runs against it. Leave the schema alone.
   - Do not "revert" a migration by deleting its file. The history check then
     blocks every deploy, because the database records a migration the checkout
     does not have. Revert the code that uses it instead.
4. **Data loss from an approved migration**:
   - Neon Console → Branches → the `pre-<tag>` branch from the approval steps,
     or *Restore* within the 6-hour window.
   - Restoring `production` in place discards everything written since that
     point, sync results included. Restore to a new branch first and inspect it.
5. Re-enable: `gh workflow enable deploy.yml`.

## What differs from the Docker deployment

| | Docker (DEPLOY.md) | This document |
|---|---|---|
| Web | `node server.js` from the standalone image | Vercel Functions, Fluid compute |
| Schedule | host crontab, server-local time | `sync.yml`, UTC |
| Migrate | `docker compose … run --rm migrate` | `deploy.yml`, before the build goes live |
| TLS | your proxy, forwarding `X-Forwarded-Proto` | Vercel. The CSP adds `upgrade-insecure-requests` on its own |
| DB connection | one long-lived pool | pooled string for the web, direct for batch work; `idle_timeout` closes what sits unused |
| Logs | `docker logs` | Vercel Logs (Hobby: 1 hour); Actions run logs |

## PENDING until the first real deployment

Nothing above has been run against Neon or Vercel yet. Each item below is
checked by doing the step that names it:

1. Bootstrap as Neon's owner role (step 2) — whether the `GRANT` fallback is needed.
2. `verify-isolation.sql` on Neon (step 2).
3. The pooled string accepting the `search_path` startup parameter (step 5).
4. Prepared statements through the pooler. Neon's docs say PgBouncer supports
   protocol-level ones; confirm with any page load.
5. A Vercel build of this repository: bun install from `bun.lock`, with
   `output` unset because `VERCEL` is (step 5).
6. Real CU-hour use after a week, against the 100-hour allowance.
7. Automated deploys, activation steps A–E: `deploy.yml` has run only against
   mocks and a local PostgreSQL (docs/analysis/agentdock-phase9-cicd-migration-automation.md).
   That `vercel.json`'s `git.deploymentEnabled` stops Git deployments of
   `develop` is Vercel's documented behaviour, confirmed for this project only
   by step E.
