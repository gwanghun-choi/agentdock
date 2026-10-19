# Deploying AgentDock on Vercel + Neon + GitHub Actions

The serverless alternative to [DEPLOY.md](DEPLOY.md)'s single Docker server,
sized for free plans and a personal, non-commercial project. Same code, same
invariants, same lifecycles — only who runs each piece changes.

```
Vercel (Hobby)          the web: SSR, browse, search      — reads, never ingests
GitHub Actions          .github/workflows/sync.yml        — `bun run sync`, twice a day
your machine            `bun run db:migrate`              — when a migration ships
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
| migrate | An operator action, never a boot step (DEPLOY.md step 6). |
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
`bun.lock` makes it install with bun. No `vercel.json` is needed, and none is
committed.

- **Settings → Functions → Function Region:** the region nearest your Neon
  region (Vercel's default is `iad1`, Washington, D.C.).
- `output: 'standalone'` in `next.config.ts` is the Docker path. Vercel builds
  its own output and does not run that image. **PENDING:** confirm on the first
  preview build.

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
| A bad migration | Migrations are additive and are applied before the code that reads them, so rolling back the web is normally enough. For data, use Neon's branch restore within your plan's history window. |
| Back to Docker | DEPLOY.md is unchanged and still works. Disable `sync.yml` **before** the host cron starts. |
| Remove AgentDock entirely | `scripts/sql/rollback-agentdock.sql`. **Destructive** — it drops both schemas with everything in them. Read its header and run the listing query it gives first. |

## What differs from the Docker deployment

| | Docker (DEPLOY.md) | This document |
|---|---|---|
| Web | `node server.js` from the standalone image | Vercel Functions, Fluid compute |
| Schedule | host crontab, server-local time | `sync.yml`, UTC |
| Migrate | `docker compose … run --rm migrate` | `bun run db:migrate` from your machine |
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
   `output: 'standalone'` present (step 5).
6. Real CU-hour use after a week, against the 100-hour allowance.
