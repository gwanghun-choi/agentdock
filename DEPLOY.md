# Deploying AgentDock

One server, Docker Compose, and a PostgreSQL you already have. No Kubernetes, no
message broker, no cache, no second datastore.

```
your server
├── docker compose  →  agentdock      the web container: SSR, browse, search
│                   →  sync           one-shot, from cron, twice a day
│                   →  migrate        one-shot, when a migration ships
│                   →  corpus-reset   one-shot, gated, almost never
└── PostgreSQL                        may be shared; AgentDock owns one schema
```

The web container and the corpus have **separate lifecycles**, and that is the
central fact of this document. `docker compose up`, a restart, a crash recovery
and a rollback all issue **zero** GitHub requests and read **zero**
repositories. Ingestion happens only when cron runs `sync`.

## Sharing a PostgreSQL server

AgentDock is built to live in a database that belongs to something else.

| Layer | What holds it |
|---|---|
| Connection | `search_path` is pinned to one schema on every connection, and the process refuses to boot if it is not |
| ORM | every table hangs off `pgSchema()`, so every emitted statement is schema-qualified — `search_path` is a default, not a fence |
| Migrations | `bun run check:boundaries` rejects generated SQL naming any schema AgentDock does not own, or leaving a target unqualified |
| Database | the connecting role is not a superuser, cannot create databases, roles or schemas, and holds no privilege on any object outside its two schemas |

Only the last one is enforced by PostgreSQL. The first three are conventions a
bug can defeat; the fourth turns such a bug into a permission error.

Create the role and schema once, as a superuser, from
`scripts/sql/bootstrap-agentdock.sql`. Read it first — it is short, and it is
the only privileged thing this project ever asks you to run.
`scripts/sql/rollback-agentdock.sql` undoes it and
`scripts/sql/verify-isolation.sql` proves the boundary holds.

### One extension, which AgentDock will not install

Search's typo tolerance uses `pg_trgm`. AgentDock **never** creates it: the
migration that needs it opens with a guard that fails loudly, naming the exact
superuser command, if it is absent.

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA public;   -- superuser, once
```

`public` is where PostgreSQL puts trusted extensions and where a shared instance
most likely already has it. AgentDock references `public.gin_trgm_ops`,
`public.word_similarity` and `OPERATOR(public.<%)`, and creates nothing there.

## Step 1 — survey the host before changing anything

```bash
docker ps                 # note every container id, status and published port
docker network ls
docker volume ls
ss -lntp                  # which ports are taken
df -h; free -h
```

Keep the `docker ps` output. Step 9 compares against it.

## Step 2 — choose a free host port

`docker-compose.yml` requires `AGENTDOCK_PORT` and fails loudly if it is unset.
It has no default, deliberately, so it cannot silently grab a port another
service wants.

**`AGENTDOCK_PORT` must reach Compose itself, not just the container.** A
service's `env_file:` is injected into the running container; it is *not* read
when Compose interpolates `${AGENTDOCK_PORT}` in the `ports:` mapping. Only
Compose's own env file is, which by default is `.env` — a name this repository
gitignores and does not ship. So every Compose command below passes
`--env-file .env.production`, which makes that one file serve both jobs.
Omitting the flag fails with `AGENTDOCK_PORT ... required`, which is the
intended loud failure rather than a silent default.

```bash
ss -lntp | grep -w '<PORT>' || echo "<PORT> is free"
```

## Step 3 — place the source

```bash
sudo mkdir -p /path/to/agentdock          # any path; /opt/agentdock is a habit
ls -la /path/to/agentdock                 # if it exists, look before overwriting
```

Copy this repository there — clone, rsync or scp, whichever matches how the
other services on the host are managed.

## Step 4 — write `.env.production`

Create `.env.production` beside `docker-compose.yml`. It is gitignored
(`.env.*`) and is **never** baked into the image; compose injects it at run time
only.

```dotenv
DATABASE_URL=postgresql://agentdock_app:<PASSWORD>@host.docker.internal:5432/<DATABASE>
DATABASE_SCHEMA=agentdock
NODE_ENV=production

# Host port published by compose. No default — see step 2.
AGENTDOCK_PORT=<PORT>

# Optional, needs no scopes. Absent means 60 requests/hour unauthenticated,
# which is a supported mode and what the caps are sized for, not a degraded one.
# GITHUB_TOKEN=

# Leave unset. Only `corpus-reset` reads it, and step 11 sets it inline.
# AGENTDOCK_ALLOW_CORPUS_RESET=
```

`<PASSWORD>` is what you set during the bootstrap. It belongs in this file and
nowhere else — not in this document, not in `.env.example`, not in any tracked
file, and not in a shell history you keep.

## Step 5 — verify `host.docker.internal` actually resolves

This is the one assumption that cannot be checked from off-host. Do it
**before** starting the real service.

```bash
docker run --rm --add-host=host.docker.internal:host-gateway \
  postgres:16-alpine \
  sh -c 'getent hosts host.docker.internal && nc -z -w3 host.docker.internal 5432 && echo TCP_OK'
```

Then the real SQL check. Export the password for this shell only, so it leaves
no trace in a file:

```bash
read -rs AGENTDOCK_DB_PASSWORD && export AGENTDOCK_DB_PASSWORD

docker run --rm --add-host=host.docker.internal:host-gateway \
  -e PGPASSWORD="$AGENTDOCK_DB_PASSWORD" postgres:16-alpine \
  psql -h host.docker.internal -p 5432 -U agentdock_app -d <DATABASE> \
       -c "SET search_path TO agentdock;" \
       -tAc "SELECT current_database()||' | '||current_user||' | '||current_schema();"
```

**If either fails**, PostgreSQL is probably bound to `127.0.0.1` or refused by
`pg_hba.conf` for the docker bridge subnet. Do not edit `postgresql.conf` or
`pg_hba.conf` without checking what else on the host depends on them. The
fallback is the host's LAN address in `DATABASE_URL` instead of
`host.docker.internal`.

## Step 6 — apply migrations

Before the web container, not from it. The runtime image carries neither bun nor
drizzle-kit on purpose: migrating on boot means racing yourself on every
restart.

```bash
cd /path/to/agentdock
docker compose --env-file .env.production --profile tools run --rm migrate
```

## Step 7 — build and start the web container only

```bash
docker compose --env-file .env.production build agentdock
docker compose --env-file .env.production up -d agentdock
```

**Never run** `docker compose down`, `docker system prune`,
`docker container prune` or `docker volume prune` on a shared host. Other
projects live there.

The build needs outbound HTTPS to the npm registry. It uses no `DATABASE_URL`
and no credential — every route is `force-dynamic`, so nothing connects at build
time.

## Step 8 — smoke the deployment

```bash
docker ps --filter name=agentdock
docker logs --tail 200 agentdock

curl -I http://127.0.0.1:<PORT>/
curl -I http://127.0.0.1:<PORT>/artifacts
curl -I http://127.0.0.1:<PORT>/skills          # expect 308 → /artifacts

for q in mcp playwright claude github playwrit postgress mcp-sever zzzznotathing; do
  printf '%-14s ' "$q"
  curl -s -o /dev/null -w '%{http_code} %{time_total}s\n' \
    "http://127.0.0.1:<PORT>/artifacts?q=$q"
done
```

`playwrit`, `postgress` and `mcp-sever` should render a "close matches"
section — that is the trigram fallback. `zzzznotathing` should render the
zero-result page, not an error.

**The startup check that matters most.** The web container must have made no
GitHub request and read nothing:

```bash
docker logs agentdock | grep -c '"event":"ingest"'    # expect 0
```

An `ingest` line in a web container's log means something reintroduced the
coupling this deployment shape exists to remove.

## Step 9 — confirm nothing else moved

```bash
docker ps        # compare to the step 1 snapshot
```

Container ids, statuses and published ports of every non-AgentDock container
must be unchanged. AgentDock creates a network named `agentdock` and declares no
volume.

## Step 10 — external access

Only after localhost smoke passes. If the port is not reachable from outside,
that is a firewall, security-group or reverse-proxy matter on your side. Do not
modify existing firewall rules or another service's proxy config as part of
deploying this — work out what change is needed and make it deliberately.

If you put TLS in front, terminate it in your proxy and forward
`X-Forwarded-Proto`. AgentDock reads that header and emits
`upgrade-insecure-requests` only when the request actually arrived over HTTPS,
so a plain-HTTP deployment does not rewrite its own internal links to a scheme
nothing is listening on.

---

## Step 11 — the one-time corpus reset

**Skip this unless the discovery policy changed.** It is here because it is part
of *this* release: repositories stored before the star floor existed were
admitted under a different rule, so the corpus is a mixture of two policies and
rebuilding is more honest than reasoning about which rows came from which.

Record what you are about to delete:

```bash
docker compose --env-file .env.production --profile tools run --rm migrate \
  bun -e "const {sql}=await import('./src/db/client.ts');
  for (const t of ['repository','package','package_version','capability_finding'])
    console.log(t, (await sql.unsafe(\`select count(*)::int n from agentdock.\${t}\`))[0].n);
  await sql.end();"
```

Then reset. Two gates, and it refuses if either is missing:

```bash
docker compose --env-file .env.production --profile tools \
  run --rm -e AGENTDOCK_ALLOW_CORPUS_RESET=1 corpus-reset \
  bun run corpus:reset --confirm
```

It deletes rows from seven tables in `agentdock` and nothing else. It issues no
`DROP` of any kind, and it leaves `artifact_type`, `repository_denylist` and
`__drizzle_migrations` untouched — so the denylist survives a reset, which is
the point of a denylist.

## Step 12 — the first sync

```bash
docker compose --env-file .env.production --profile tools run --rm sync
```

Read the summary it prints. Unauthenticated, one run reads about 25
repositories and then stops with `fewer than two GitHub core requests remain`,
which is correct and not an error — whatever is still queued is read by the next
run. Rebuilding a corpus of *n* repositories therefore takes roughly *n*/25
runs, or *n*/30 hours.

Run it a second time and check that repositories read by the first run are **not
re-read**: the refresh pass only offers repositories whose last read is older
than twelve hours, and the ones it does offer come back `unchanged` at two
requests and zero file reads if their commit has not moved.

## Step 13 — register cron

Twice a day. `03:00` and `15:00` are twelve hours apart, which is what makes the
staleness cutoff and the schedule agree.

```cron
0 3,15 * * * cd /path/to/agentdock && docker compose --env-file .env.production --profile tools run --rm sync >> /var/log/agentdock-sync.log 2>&1
```

Replace `/path/to/agentdock` with wherever step 3 put it. The times are the
server's local timezone — check `timedatectl` if you care which that is.

Then verify:

```bash
crontab -l
systemctl status cron        # or crond, depending on the distribution
tail -f /var/log/agentdock-sync.log
```

Do not add a `--restart` policy or a systemd timer *as well*. Two schedulers
running the same one-shot is how a 60-requests-an-hour budget gets spent twice.

## Later: applying a new migration

```bash
cd /path/to/agentdock
git pull                                                    # or however you deploy
docker compose --env-file .env.production --profile tools run --rm migrate
docker compose --env-file .env.production build agentdock
docker compose --env-file .env.production up -d agentdock
```

Migrations first, then the image. A new column the old image does not read is
harmless; a new image reading a column that does not exist yet is a 500 on every
page.

## Restart behaviour

`restart: unless-stopped` on the web container covers reboot and crash. There is
no healthcheck and no orchestration beyond that — deliberately. If PostgreSQL is
briefly unavailable, AgentDock's pages error and recover when it returns; it
touches no other service, and it starts no ingestion on the way back up.

The `sync`, `migrate` and `corpus-reset` services carry no restart policy at
all. A one-shot that restarts on exit is a daemon.
