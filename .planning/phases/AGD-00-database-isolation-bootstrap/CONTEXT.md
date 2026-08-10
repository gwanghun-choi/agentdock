# Phase 0 Context — Database Isolation Bootstrap

Confirmed decisions and directly observed facts. This is the source of truth for planning
Phase 0. **Option A is approved by the maintainer.**

## Confirmed decisions

1. **Option A adopted.** AgentDock uses a dedicated non-superuser PostgreSQL role. The
   existing `mcp` superuser is never used as the AgentDock application or migration
   account.
2. **Role name:** `agentdock_app`. **Schema name:** `agentdock`.
3. **Single role.** Do not split into `agentdock_owner` / `agentdock_migrator` /
   `agentdock_runtime` / `agentdock_readonly`. One non-superuser role is sufficient for a
   personal MVP. Additional roles only if a concrete benefit is demonstrated.
4. **Defense in depth is mandatory:** both DB-level privileges *and* application-level
   schema qualification. Every table declares its schema explicitly; do not rely on
   `search_path` alone.
5. **Credentials:** environment variables only. No password in source, in GSD documents,
   in Git, or in terminal output. `.env.example` carries placeholders only.
6. **Scope boundary:** Phase 0 is isolation + foundation only. No crawler, no GitHub
   ingestion, no security detectors, no search, no MCP registry sync, no package detail UI.

## Required isolation properties for `agentdock_app`

- NOT a superuser
- NOCREATEDB
- NOCREATEROLE
- Does not own any pre-existing schema
- Cannot modify any pre-existing table
- Performs all AgentDock migration/application operations inside `agentdock` only
- Drizzle migrations are structurally prevented from touching another schema

## Directly observed DB state (read-only, 2026-08-10)

| Item | Observed value |
|---|---|
| PostgreSQL version | 16.14 (x86_64-pc-linux-musl, Alpine) |
| Database | `mcpdb` (UTF8, `en_US.utf8`, no explicit ACL) |
| Current login role | `mcp` — `rolsuper=t`, `rolcreatedb=t`, `rolcreaterole=t` |
| Login roles in cluster | exactly one: `mcp` |
| Current `search_path` | `"$user", public` |
| Schemas | `public` (owner `pg_database_owner`), `didim_mcp` (owner `mcp`) |
| `agentdock` schema exists | **No** — name is free |
| Existing tables | 10, all in `didim_mcp`, all owned by `mcp` |
| Installed extensions | `plpgsql` only (`pg_trgm` NOT installed) |
| Default ACLs (`pg_default_acl`) | **none** |

### The decisive privilege findings

```
has_schema_privilege('public', 'didim_mcp', 'USAGE')  ->  false
has_schema_privilege('public', 'public',    'CREATE')  ->  false
has_schema_privilege('public', 'public',    'USAGE')   ->  true
```

Read as: the `PUBLIC` pseudo-role has **no USAGE on `didim_mcp`** and **no CREATE on
`public`**.

**Consequence — the bootstrap SQL is far smaller than research assumed.** A newly created
role inherits only `PUBLIC`'s privileges, so `agentdock_app` will be unable to see
`didim_mcp` or create objects in `public` *the moment it is created*, with no `REVOKE`
required. The `REVOKE ... ON SCHEMA public/didim_mcp` statements proposed in `STACK.md`
and `ARCHITECTURE.md` are **unnecessary here** — and revoking from `PUBLIC` would be
actively harmful, because it would strip privileges from the other application too.

The bootstrap therefore reduces to two statements plus verification:

```sql
CREATE ROLE agentdock_app LOGIN PASSWORD :'pw' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE SCHEMA agentdock AUTHORIZATION agentdock_app;
```

`pg_default_acl` being empty also means no future object in `public` or `didim_mcp` will
be auto-granted to anyone — so this property is stable, not a snapshot.

## Safety rules for this phase

- Any change to `mcpdb` must be additive only: `CREATE ROLE`, `CREATE SCHEMA`.
- Never `DROP`, `ALTER`, or `REVOKE` anything that exists today.
- Never revoke from `PUBLIC` — the other application depends on those defaults.
- Privilege verification must not attempt destructive operations against real
  `didim_mcp` tables. Prove negative privilege with `has_table_privilege` /
  `has_schema_privilege` queries, or inside a transaction that is rolled back.
- Rollback SQL must be written before the change is applied.
- `pg_trgm` is not installed and is **not** needed in Phase 0. Installing an extension
  requires superuser and is a shared-database change — defer it to the phase that
  actually needs it (Phase 6, search).

## Open question the plan must answer

**Should migration and runtime use the same role?** Default position: yes, one
`agentdock_app` role. A separate migration role only earns its place if it provides a
concrete guarantee that schema-qualification plus `NOCREATEROLE`/`NOCREATEDB` does not
already provide. Record the reasoning either way.

## Stack (already decided — do not re-litigate)

TypeScript 5.9.3 · Next.js 16 App Router · React 19 · Node runtime with Bun as
installer/script-runner · Drizzle ORM with `drizzle-kit generate` → review → `migrate`
(**`push` and `pull` must be unreachable from `package.json`**) · Biome · Vitest · zod for
environment validation · pino for structured logging.

If something here proves genuinely unimplementable, say so with evidence rather than
silently substituting.
