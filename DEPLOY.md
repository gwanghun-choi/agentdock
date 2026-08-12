# AgentDock — NCP single-server Docker deployment

Docker Compose on one server. No Kubernetes. The database is the **existing**
PostgreSQL on the NCP host, shared with other applications and isolated by schema.

```
NCP server
├── existing services            ← never stopped, restarted or modified
├── PostgreSQL :5432
│     └── didim_api
│           ├── bidpilot, didim_mcp, didim_rag, didim_vault, public, report
│           │                       ← never modified
│           └── agentdock          ← AgentDock only
└── /opt/agentdock  →  docker compose  →  agentdock container
```

## What is already done

The database half was completed from a workstation over the network on
2026-08-12. **Do not repeat it.**

| Done | Evidence |
|---|---|
| Role `agentdock_app` created | `rolsuper=f rolcreatedb=f rolcreaterole=f rolinherit=f rolcanlogin=t` |
| Schema `agentdock` created, owned by `agentdock_app` | `pg_namespace.nspowner = agentdock_app` |
| All 8 migrations applied | `agentdock: applied 8 of 8 migration(s).` |
| 11 tables, all in `agentdock` | 0 objects owned by `agentdock_app` outside the schema |
| Corpus cold-started | 937 held / 782 listed across 8 repositories |
| `package_fuzzy_trgm_idx` created and used | `Bitmap Index Scan on package_fuzzy_trgm_idx`, 0.54 ms |
| Existing schemas unchanged | 47 tables / 182 indexes byte-identical before and after |

`pg_trgm` 1.6 was **already installed** in `didim_api`, in schema `public`. It was
not moved and not reinstalled. AgentDock references `public.gin_trgm_ops`,
`public.word_similarity` and `OPERATOR(public.<%)`; it creates nothing there.

## Step 1 — survey the host before changing anything

```bash
docker ps                 # note every container id, status and published port
docker network ls
docker volume ls
ss -lntp                  # which ports are taken
df -h; free -h
```

Keep the `docker ps` output. Step 8 compares against it.

## Step 2 — choose a free host port

`docker-compose.yml` requires `AGENTDOCK_PORT` and fails loudly if unset — it has
no default, deliberately, so it cannot silently grab a port another service wants.

**`AGENTDOCK_PORT` must reach Compose itself, not just the container.** A service's
`env_file:` is injected into the running container; it is *not* read when Compose
interpolates `${AGENTDOCK_PORT}` in the `ports:` mapping. Only Compose's own env
file is, which by default is `.env` — a name this repository gitignores and does
not ship. So every Compose command below passes `--env-file .env.production`,
which makes that one file serve both jobs. Omitting the flag fails with
`AGENTDOCK_PORT ... required`, which is the intended loud failure rather than a
silent default. (Found while deploying: the earlier revision of this document
described `env_file:` alone as sufficient, and it is not.)

Pick a port that appears in neither `ss -lntp` nor `docker ps`. Verify:

```bash
ss -lntp | grep -w '<PORT>' || echo "<PORT> is free"
```

## Step 3 — place the source

```bash
sudo mkdir -p /opt/agentdock
# If /opt/agentdock already exists, inspect it first and do not overwrite.
ls -la /opt/agentdock
```

Copy this repository there (git clone, rsync, or scp — whatever matches how the
other services on this host are managed).

## Step 4 — write `.env.production`

Create `/opt/agentdock/.env.production`. It is gitignored (`.env.*`) and is
**never** baked into the image — compose injects it at run time only.

```dotenv
DATABASE_URL=postgresql://agentdock_app:<PASSWORD>@host.docker.internal:5432/didim_api
DATABASE_SCHEMA=agentdock
NODE_ENV=production

# Host port published by compose. No default — see step 2.
AGENTDOCK_PORT=<PORT>

# 1 = drain the ingest queue in-process. 7 jobs are currently queued from the
# cold start, so the first boot will finish them (2 GitHub requests per
# repository, 60/hour unauthenticated). Set 0 to leave the queue untouched.
INGEST_WORKER=1

# Optional. Absent means 60 requests/hour unauthenticated, which is a supported
# mode, not a degraded one. Must be dedicated and scopeless if set.
# GITHUB_TOKEN=
```

`<PASSWORD>` is the credential the maintainer set for `agentdock_app` when the role
was created; it is deliberately not written down here, in `.env.example`, or in any
other tracked file. Rotate it before this is anything but a test deployment, with
`ALTER ROLE agentdock_app PASSWORD '…';` as a superuser.

Step 5's check reads it from your shell, so export it for that session only and let
it leave no trace in the file:

```bash
read -rs AGENTDOCK_DB_PASSWORD && export AGENTDOCK_DB_PASSWORD
```

## Step 5 — verify `host.docker.internal` actually resolves

This is the one assumption that cannot be checked from off-host. Do it **before**
starting the real service.

```bash
docker run --rm --add-host=host.docker.internal:host-gateway \
  postgres:16-alpine \
  sh -c 'getent hosts host.docker.internal && nc -z -w3 host.docker.internal 5432 && echo TCP_OK'
```

Then the real SQL check — this must print `didim_api | agentdock_app | agentdock`:

```bash
docker run --rm --add-host=host.docker.internal:host-gateway \
  -e PGPASSWORD="$AGENTDOCK_DB_PASSWORD" postgres:16-alpine \
  psql -h host.docker.internal -p 5432 -U agentdock_app -d didim_api \
       -c "SET search_path TO agentdock;" \
       -tAc "SELECT current_database()||' | '||current_user||' | '||current_schema();"
```

**If either fails**, PostgreSQL is probably bound to `127.0.0.1` or refused by
`pg_hba.conf` for the docker bridge subnet. Do not edit `postgresql.conf` or
`pg_hba.conf` without checking what the other services depend on — report instead.
The fallback is to use the host's LAN address (`192.168.0.12`) in `DATABASE_URL`
rather than `host.docker.internal`.

## Step 6 — build and start AgentDock only

```bash
cd /opt/agentdock
docker compose --env-file .env.production build agentdock
docker compose --env-file .env.production up -d agentdock
```

**Never run** `docker compose down`, `docker system prune`, `docker container prune`
or `docker volume prune` on this host. Other projects live here.

The build needs outbound HTTPS to the npm registry. It uses no `DATABASE_URL` and
no credential — every route is `force-dynamic`, so nothing connects at build time.

## Step 7 — smoke the deployment

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

curl -s -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:<PORT>/artifacts?q=claude&type=command"
curl -s -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:<PORT>/artifacts?page=2"
```

`playwrit`, `postgress` and `mcp-sever` should render a "close matches" section —
that is the DIS-04 trigram fallback. `zzzznotathing` should render the zero-result
page, not an error.

Detail routes, one per artifact type:

```bash
R=http://127.0.0.1:<PORT>/r/davila7/claude-code-templates
curl -s -o /dev/null -w 'skill      %{http_code}\n' "$R/.claude-plugin/skills/owasp-security/SKILL.md"
curl -s -o /dev/null -w 'command    %{http_code}\n' "$R/.claude/commands/cleanup-cache.md"
curl -s -o /dev/null -w 'plugin     %{http_code}\n' "$R/cli-tool/components"
curl -s -o /dev/null -w 'hook       %{http_code}\n' "$R/cli-tool/templates/javascript-typescript/.claude/settings.json"
curl -s -o /dev/null -w 'mcp_server %{http_code}\n' "$R/.mcp.json"
```

All five must be 200. Every one of these was verified 200 against this exact
database from a container built from this Dockerfile.

## Step 8 — confirm nothing else moved

```bash
docker ps        # compare to the step 1 snapshot
```

Container ids, statuses and published ports of every non-AgentDock container must
be unchanged. AgentDock creates a network named `agentdock` and declares no volume.

## Step 9 — external access

Only after localhost smoke passes. Check whether the chosen port is reachable from
outside; if it is not, that is an NCP ACG / firewall / reverse-proxy matter.
**Do not modify existing firewall rules, nginx config or another service's proxy.**
Report what change would be needed instead.

## Later: applying a new migration

The runtime image carries neither bun nor drizzle-kit, on purpose. Migrations are
an operator action, never a boot step — a container that migrated on start would
race itself on restart.

```bash
cd /opt/agentdock
docker compose --env-file .env.production --profile tools run --rm migrate
```

## Restart behaviour

`restart: unless-stopped` covers reboot and crash. There is no healthcheck and no
orchestration beyond that — deliberately. If PostgreSQL is briefly unavailable,
AgentDock's pages error and recover when it returns; it touches no other service.
