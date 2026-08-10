---
phase: AGD-00-database-isolation-bootstrap
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - scripts/sql/bootstrap-agentdock.sql
  - scripts/sql/rollback-agentdock.sql
  - scripts/sql/verify-isolation.sql
autonomous: false
requirements: [FND-01, FND-08]
user_setup:
  - service: shared-postgresql-instance
    why: >-
      Creating a login role and two schemas in `mcpdb`, a database that a second
      running application (schema `didim_mcp`, 10 tables, Alembic-managed) shares.
      The role's password must never pass through an agent transcript, a shell
      process list, or a file, so the one statement that sets it is run by the
      maintainer in an interactive psql session.
    env_vars:
      - name: AGENTDOCK_DATABASE_URL
        source: >-
          Composed by the maintainer after `\password agentdock_app`; written to
          `.env` only. Never echoed, never committed.
      - name: AGENTDOCK_TEST_DATABASE_URL
        source: >-
          Same role and password, used by the test schema. Written to `.env` only.
    dashboard_config:
      - task: >-
          Run `scripts/sql/bootstrap-agentdock.sql`, then `\password agentdock_app`,
          in one interactive psql session, then write `.env`.
        location: "docker exec -it didim-mcp-service-backend-db-1 psql -U mcp -d mcpdb"

estimate:
  tokens: 28000
  raw_tokens: 28000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "A role named agentdock_app exists that is not a superuser and cannot create databases, roles, replication slots, or schemas"
    - "Schemas agentdock and agentdock_test exist and are both owned by agentdock_app"
    - "agentdock_app holds no SELECT/INSERT/UPDATE/DELETE/TRUNCATE privilege on any table that existed before this plan ran"
    - "agentdock_app has no USAGE on any schema it does not own, other than the built-in public schema where it still cannot create anything"
    - "An attempt by agentdock_app to create an object outside its own schemas fails with a permission error rather than succeeding"
    - "The co-tenant schema's owner, the public schema's owner, and the cluster's default ACLs are all unchanged from their pre-plan values"
    - "The role's password exists in exactly one place on this machine: the maintainer's .env file"
  artifacts:
    - path: "scripts/sql/bootstrap-agentdock.sql"
      provides: "The complete, additive-only bootstrap: CREATE ROLE, two CREATE SCHEMA, one ALTER ROLE on the newly created role"
      contains: "CREATE SCHEMA agentdock AUTHORIZATION agentdock_app"
      min_lines: 30
    - path: "scripts/sql/rollback-agentdock.sql"
      provides: "Reversal of every object this plan creates, in dependency order"
      contains: "DROP ROLE IF EXISTS agentdock_app"
      min_lines: 15
    - path: "scripts/sql/verify-isolation.sql"
      provides: "Seven assertions proving the boundary holds; exits non-zero on any failure"
      contains: "SET LOCAL ROLE agentdock_app"
      min_lines: 90
  key_links:
    - from: "scripts/sql/bootstrap-agentdock.sql"
      to: "scripts/sql/verify-isolation.sql"
      via: "every attribute and grant the bootstrap sets or withholds has a matching assertion in the verifier"
      pattern: "agentdock_app"
    - from: "scripts/sql/verify-isolation.sql"
      to: "PostgreSQL privilege system"
      via: "SET LOCAL ROLE probes inside a transaction that is always rolled back, with a positive control"
      pattern: "insufficient_privilege"
---

<objective>
Create the PostgreSQL role and schemas that make it impossible for AgentDock to
read or write anything belonging to the application already running in this
database — and prove it, with live probes rather than a claim.

Purpose: this is the only layer of the four in ARCHITECTURE.md "Schema Isolation
Mechanics" that a code bug cannot defeat. Every other guard in this phase is
defense in depth stacked on top of it. It also cannot be safely retrofitted:
once migrations have run under the superuser, every object is owned by the wrong
role and the co-tenant's data has already been reachable for a milestone.

Output: three SQL files (bootstrap, rollback, verification) and a database whose
catalog proves the boundary holds.

Implements CONTEXT.md confirmed decisions 1 (dedicated non-superuser role),
2 (`agentdock_app` / `agentdock`), 3 (one role, not four), and 5 (credentials in
environment variables only).
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
@.planning/phases/AGD-00-database-isolation-bootstrap/CONTEXT.md
</context>

<decisions_made_while_planning>

Three points where this plan deviates from, or resolves an open question in, the
source documents. Each is deliberate and evidenced.

**1. The `PASSWORD` clause is removed from `CREATE ROLE`, and the password is set
with psql's `\password` instead.**

CONTEXT.md sketches `CREATE ROLE agentdock_app LOGIN PASSWORD :'pw' ...`. Every
way of supplying `:'pw'` puts the plaintext somewhere the phase constraints
forbid: `-v pw=...` puts it in the command line and therefore in the process
list, `\prompt` echoes it to the terminal, and a heredoc puts it in the agent's
transcript. `\password agentdock_app` prompts without echo and sends an
`ALTER ROLE ... PASSWORD 'SCRAM-SHA-256$...'` verifier — the plaintext never
crosses the wire, never reaches the server log, and never appears on screen.
Verified on the target instance: `password_encryption = scram-sha-256`.

The intermediate state is safe. A role created `LOGIN` with a NULL password
cannot authenticate at all under `scram-sha-256`, so a bootstrap abandoned
between the two steps leaves nothing usable.

`ALTER ROLE agentdock_app ...` is not a violation of "never ALTER anything that
exists today" — `agentdock_app` did not exist until three lines earlier. The rule
protects pre-existing objects.

**2. No `REVOKE` appears anywhere in the bootstrap.**

Confirmed by direct query on this instance, not assumed:
`nspacl` for the co-tenant schema is NULL (default: owner only, nothing for
`PUBLIC`), `nspacl` for `public` is `pg_database_owner=UC/...,=U/...` (`PUBLIC`
has USAGE, not CREATE), and `pg_default_acl` is empty. A newly created role
inherits only `PUBLIC`'s privileges, so it is already unable to see the
co-tenant schema or create anything in `public` the moment it exists. The
`REVOKE` statements proposed in STACK.md and ARCHITECTURE.md would remove
nothing that is held, and revoking from `PUBLIC` would strip privileges from the
co-tenant application.

**3. `agentdock_test` is created in the same session, not later.**

`mcpdb`'s `datacl` is NULL, which means the default database ACL applies:
`PUBLIC` gets CONNECT and TEMPORARY, and **not** CREATE. Therefore
`agentdock_app` cannot create a schema for itself, ever. The test-database
strategy for this project (see plan 00-04) is a second schema owned by the same
role — so it has to be created by a superuser, and the superuser session is
happening exactly once, right now. Creating it later means a second request to
the maintainer for a second interactive session against a shared production
database. One `CREATE SCHEMA` line now is strictly smaller than that.

This also answers the CONTEXT.md open question — **migration and runtime use the
same role**. A separate migration role would have to own the schema (or migrations
could not create tables in it), which means the runtime role would need grants on
every object the migration role creates, plus `ALTER DEFAULT PRIVILEGES`
maintenance forever. It would buy protection against "the app issues DDL at
runtime" — a risk already removed by `drizzle-kit generate` being offline-only
and `push`/`pull` being unreachable (plan 00-03). Two roles, two passwords, one
extra failure mode, no new guarantee.

**4. One thing this boundary does not defend against, stated plainly.**

The container's `pg_hba.conf` contains `local all all trust`. Anyone who can run
`docker exec` on this machine already has superuser access to `mcpdb` without a
password. Phase 0 must not change `pg_hba.conf` — the co-tenant application
depends on it. The `agentdock_app` boundary is a defense against *AgentDock's own
tooling* reaching the co-tenant's data, which is the threat CONTEXT.md describes.
It is not, and is not claimed to be, a defense against local machine access.
Recorded as an accepted threat below rather than silently omitted.

</decisions_made_while_planning>

<reference>

## Reference A — `scripts/sql/bootstrap-agentdock.sql`

Write this file byte-for-byte. It is additive only: three `CREATE` statements and
one `ALTER` against the role it just created.

```sql
-- scripts/sql/bootstrap-agentdock.sql
--
-- AgentDock database bootstrap. Run ONCE, by the maintainer, as a superuser.
-- Additive only: this file creates one role and two schemas and touches nothing
-- that already exists. It contains no DROP, no REVOKE, and no statement that
-- names another application's objects.
--
-- HOW TO RUN (one interactive session, in this order):
--
--   docker exec -it didim-mcp-service-backend-db-1 psql -U mcp -d mcpdb
--   \i /dev/stdin        <-- or paste the statements below
--   \password agentdock_app
--   \q
--
-- Rollback is scripts/sql/rollback-agentdock.sql.
-- Verification is scripts/sql/verify-isolation.sql.

\set ON_ERROR_STOP on

-- The role. No PASSWORD clause: the secret is set afterwards with psql's
-- \password, which prompts without echo and transmits only a SCRAM verifier.
-- Until that runs, this role has a NULL password and cannot authenticate,
-- because the server uses scram-sha-256.
--
-- NOSUPERUSER    -- privilege checks apply to it at all
-- NOCREATEDB     -- cannot create a database on a shared cluster
-- NOCREATEROLE   -- cannot grant itself out of this box
-- NOBYPASSRLS    -- cannot read past row-level security
-- NOREPLICATION  -- cannot stream the whole cluster (default, made explicit)
CREATE ROLE agentdock_app
  LOGIN
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOBYPASSRLS
  NOREPLICATION;

-- The two schemas AgentDock will ever own. agentdock_app cannot create schemas
-- itself: mcpdb has no explicit ACL, so PUBLIC holds CONNECT and TEMPORARY but
-- not CREATE on the database. Both are therefore created here, in the only
-- superuser session this project gets.
CREATE SCHEMA agentdock      AUTHORIZATION agentdock_app;
CREATE SCHEMA agentdock_test AUTHORIZATION agentdock_app;

-- A role-level default search_path, so an operator connecting with a bare
-- connection string still lands inside agentdock. A connection-level search_path
-- (set by src/db/client.ts) overrides this when the test schema is in use.
-- This ALTER targets the role created three statements ago, not a pre-existing
-- object.
ALTER ROLE agentdock_app SET search_path = agentdock;

-- Deliberately absent:
--   * no GRANT CONNECT       -- PUBLIC already has CONNECT on this database
--   * no REVOKE of any kind  -- nothing to revoke, and revoking from PUBLIC
--                               would strip the co-tenant application too
--   * no CREATE EXTENSION    -- pg_trgm needs a superuser and is a shared-database
--                               change; it belongs to the search phase, not here
```

## Reference B — `scripts/sql/rollback-agentdock.sql`

```sql
-- scripts/sql/rollback-agentdock.sql
--
-- Reverses scripts/sql/bootstrap-agentdock.sql. Run as a superuser.
--
--   docker exec -i didim-mcp-service-backend-db-1 \
--     psql -U mcp -d mcpdb -v ON_ERROR_STOP=1 -f - < scripts/sql/rollback-agentdock.sql
--
-- SAFE only while AgentDock holds no data worth keeping. CASCADE here is bounded
-- to objects inside the two named schemas: AgentDock never creates a reference
-- that crosses a schema boundary, and the co-tenant application does not know
-- these schemas exist, so the dependency set is closed inside them.
--
-- Before running, see what would be destroyed:
--   SELECT n.nspname, c.relname, c.relkind
--     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE n.nspname IN ('agentdock','agentdock_test');

\set ON_ERROR_STOP on

DROP SCHEMA IF EXISTS agentdock_test CASCADE;
DROP SCHEMA IF EXISTS agentdock      CASCADE;

-- Clears any residual grant or ownership the role still holds, so DROP ROLE
-- cannot fail with a dependency error.
DROP OWNED BY agentdock_app;

DROP ROLE IF EXISTS agentdock_app;
```

## Reference C — `scripts/sql/verify-isolation.sql`

Every assertion raises and aborts on failure, so with `ON_ERROR_STOP=1` the
process exit status is the whole result. The final section runs real statements
under `SET LOCAL ROLE` inside a transaction that always rolls back, and includes a
positive control so a broken session cannot produce seven false passes.

```sql
-- scripts/sql/verify-isolation.sql
--
-- Proves the AgentDock isolation boundary holds. Run as a SUPERUSER:
--
--   docker exec -i didim-mcp-service-backend-db-1 \
--     psql -U mcp -d mcpdb -v ON_ERROR_STOP=1 -f - < scripts/sql/verify-isolation.sql
--
-- Read-only, except for section 7, which runs three probe statements under
-- SET LOCAL ROLE inside a transaction that is unconditionally rolled back.
-- No statement in this file modifies any pre-existing object.
-- Exit status 0 means every property below holds.

\set ON_ERROR_STOP on
BEGIN;

-- 1. Role attributes.
DO $$
DECLARE r pg_roles%ROWTYPE;
BEGIN
  SELECT * INTO r FROM pg_roles WHERE rolname = 'agentdock_app';
  IF NOT FOUND         THEN RAISE EXCEPTION 'FAIL 1: role agentdock_app does not exist'; END IF;
  IF r.rolsuper        THEN RAISE EXCEPTION 'FAIL 1: agentdock_app is a superuser'; END IF;
  IF r.rolcreatedb     THEN RAISE EXCEPTION 'FAIL 1: agentdock_app holds CREATEDB'; END IF;
  IF r.rolcreaterole   THEN RAISE EXCEPTION 'FAIL 1: agentdock_app holds CREATEROLE'; END IF;
  IF r.rolbypassrls    THEN RAISE EXCEPTION 'FAIL 1: agentdock_app holds BYPASSRLS'; END IF;
  IF r.rolreplication  THEN RAISE EXCEPTION 'FAIL 1: agentdock_app holds REPLICATION'; END IF;
  IF NOT r.rolcanlogin THEN RAISE EXCEPTION 'FAIL 1: agentdock_app cannot log in'; END IF;
  RAISE NOTICE 'PASS 1/7  role attributes';
END $$;

-- 2. No role memberships: nothing can be inherited into this role.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
    FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member
   WHERE r.rolname = 'agentdock_app';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 2: agentdock_app is a member of % role(s)', n; END IF;
  RAISE NOTICE 'PASS 2/7  no inherited role memberships';
END $$;

-- 3. Schema ownership, including the ownership this plan must NOT have changed.
DO $$
BEGIN
  IF (SELECT nspowner::regrole::text FROM pg_namespace WHERE nspname = 'agentdock')
       IS DISTINCT FROM 'agentdock_app'
    THEN RAISE EXCEPTION 'FAIL 3: schema agentdock is not owned by agentdock_app'; END IF;
  IF (SELECT nspowner::regrole::text FROM pg_namespace WHERE nspname = 'agentdock_test')
       IS DISTINCT FROM 'agentdock_app'
    THEN RAISE EXCEPTION 'FAIL 3: schema agentdock_test is not owned by agentdock_app'; END IF;
  IF (SELECT nspowner::regrole::text FROM pg_namespace WHERE nspname = 'public')
       IS DISTINCT FROM 'pg_database_owner'
    THEN RAISE EXCEPTION 'FAIL 3: ownership of schema public changed'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_namespace
     WHERE nspname NOT IN ('agentdock','agentdock_test','public','information_schema')
       AND nspname NOT LIKE 'pg\_%'
       AND nspowner::regrole::text = 'agentdock_app')
    THEN RAISE EXCEPTION 'FAIL 3: agentdock_app owns a schema it should not'; END IF;
  RAISE NOTICE 'PASS 3/7  schema ownership';
END $$;

-- 4. Schema and database privileges, positive and negative.
DO $$
DECLARE s record;
BEGIN
  FOR s IN
    SELECT nspname FROM pg_namespace
     WHERE nspname NOT IN ('agentdock','agentdock_test','public','information_schema')
       AND nspname NOT LIKE 'pg\_%'
  LOOP
    IF has_schema_privilege('agentdock_app', s.nspname, 'USAGE') THEN
      RAISE EXCEPTION 'FAIL 4: agentdock_app has USAGE on foreign schema %', s.nspname;
    END IF;
  END LOOP;

  IF has_schema_privilege('agentdock_app', 'public', 'CREATE')
    THEN RAISE EXCEPTION 'FAIL 4: agentdock_app can create objects in schema public'; END IF;
  IF has_database_privilege('agentdock_app', current_database(), 'CREATE')
    THEN RAISE EXCEPTION 'FAIL 4: agentdock_app can create new schemas in this database'; END IF;
  IF NOT has_schema_privilege('agentdock_app', 'agentdock', 'CREATE')
    THEN RAISE EXCEPTION 'FAIL 4: agentdock_app cannot create in its OWN schema'; END IF;

  RAISE NOTICE 'PASS 4/7  schema and database privileges';
END $$;

-- 5. Zero table privileges on anything outside AgentDock's own schemas.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
    FROM pg_tables t
   WHERE t.schemaname NOT IN ('agentdock','agentdock_test','pg_catalog','information_schema')
     AND (   has_table_privilege('agentdock_app', format('%I.%I', t.schemaname, t.tablename), 'SELECT')
          OR has_table_privilege('agentdock_app', format('%I.%I', t.schemaname, t.tablename), 'INSERT')
          OR has_table_privilege('agentdock_app', format('%I.%I', t.schemaname, t.tablename), 'UPDATE')
          OR has_table_privilege('agentdock_app', format('%I.%I', t.schemaname, t.tablename), 'DELETE')
          OR has_table_privilege('agentdock_app', format('%I.%I', t.schemaname, t.tablename), 'TRUNCATE'));
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL 5: agentdock_app holds privileges on % foreign table(s)', n;
  END IF;
  RAISE NOTICE 'PASS 5/7  no privileges on any pre-existing table';
END $$;

-- 6. No AgentDock-owned object outside its schemas, no third schema, and the
--    cluster's default ACLs still empty (so this stays true for future objects).
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
    FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE c.relowner = 'agentdock_app'::regrole
     AND ns.nspname NOT IN ('agentdock','agentdock_test');
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL 6: % object(s) owned by agentdock_app outside its schemas', n;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'drizzle') THEN
    RAISE EXCEPTION 'FAIL 6: a drizzle schema exists — migration history escaped agentdock';
  END IF;

  SELECT count(*) INTO n FROM pg_default_acl;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL 6: % default ACL entr(ies) exist; new objects may be auto-granted', n;
  END IF;

  RAISE NOTICE 'PASS 6/7  no AgentDock object outside its schemas';
END $$;

-- 7. Live probes. Everything below runs AS agentdock_app and is rolled back.
--    The positive control fails the run if the negative probes could be false
--    passes (e.g. a session that cannot do anything at all).
SET LOCAL ROLE agentdock_app;

DO $$
DECLARE victim text;
BEGIN
  BEGIN
    EXECUTE 'CREATE TABLE public.agentdock_boundary_probe (id int)';
    RAISE EXCEPTION 'FAIL 7: agentdock_app created a table in schema public';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    EXECUTE 'CREATE SCHEMA agentdock_boundary_probe';
    RAISE EXCEPTION 'FAIL 7: agentdock_app created a new schema';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  SELECT format('%I.%I', schemaname, tablename) INTO victim
    FROM pg_tables
   WHERE schemaname NOT IN ('agentdock','agentdock_test','pg_catalog','information_schema')
   LIMIT 1;
  IF victim IS NOT NULL THEN
    BEGIN
      EXECUTE format('SELECT 1 FROM %s LIMIT 1', victim);
      RAISE EXCEPTION 'FAIL 7: agentdock_app read from foreign table %', victim;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END IF;

  -- Positive control.
  BEGIN
    EXECUTE 'CREATE TABLE agentdock.agentdock_positive_control (id int)';
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION
      'FAIL 7: agentdock_app cannot create a table in its OWN schema (%). '
      'The three probes above are therefore not trustworthy.', SQLERRM;
  END;

  RAISE NOTICE 'PASS 7/7  live probes denied, positive control succeeded';
END $$;

RESET ROLE;
ROLLBACK;

\echo '=========================================='
\echo ' ISOLATION VERIFIED — 7/7 assertions passed'
\echo '=========================================='
```

</reference>

<tasks>

<task type="auto">
  <name>Task 1: Write the bootstrap, rollback, and verification SQL</name>
  <files>scripts/sql/bootstrap-agentdock.sql, scripts/sql/rollback-agentdock.sql, scripts/sql/verify-isolation.sql</files>
  <action>
    Create the three files with exactly the content given in Reference A, B, and C
    above. Do not paraphrase the SQL and do not add statements that are not there:
    the absence of REVOKE, of GRANT, and of CREATE EXTENSION is load-bearing and
    justified in `<decisions_made_while_planning>`.

    Do not connect to any database in this task. Do not invent, generate, or write
    a password anywhere — the bootstrap deliberately has no PASSWORD clause.
  </action>
  <verify>
    <automated>test -f scripts/sql/bootstrap-agentdock.sql &amp;&amp; test -f scripts/sql/rollback-agentdock.sql &amp;&amp; test -f scripts/sql/verify-isolation.sql &amp;&amp; ! grep -riE 'password[[:space:]]*=|PASSWORD .[^;]' scripts/sql/bootstrap-agentdock.sql</automated>
  </verify>
  <done>Three SQL files exist. The bootstrap contains no literal password and no REVOKE. Nothing has been executed against any database yet.</done>
</task>

<task type="checkpoint:human-action" gate="blocking-human">
  <name>Task 2: Maintainer applies the bootstrap and sets the password</name>
  <reversibility rating="costly">Undoing this requires a second superuser session against a database a second application runs on; `scripts/sql/rollback-agentdock.sql` makes it mechanical but not unilateral.</reversibility>
  <action>Run the bootstrap SQL against the shared instance, set the role's password with psql's `\password`, and write `.env`.</action>
  <instructions>
    I have written and reviewed the SQL. I am deliberately not running it, for one
    reason: the role's password must not pass through my transcript, a shell
    process list, or a file, and psql's `\password` is the only mechanism that
    keeps it off all three. Splitting this into "I run the CREATE statements, you
    run `\password`" would buy nothing and would leave a LOGIN role on a shared
    instance in a half-configured state between the two sessions.

    1. Read `scripts/sql/bootstrap-agentdock.sql` and
       `scripts/sql/rollback-agentdock.sql`. Four statements total, all additive.

    2. Apply the bootstrap:

           docker exec -i didim-mcp-service-backend-db-1 \
             psql -U mcp -d mcpdb -v ON_ERROR_STOP=1 -f - \
             &lt; scripts/sql/bootstrap-agentdock.sql

       Expect `CREATE ROLE`, `CREATE SCHEMA`, `CREATE SCHEMA`, `ALTER ROLE`. Any
       error means nothing was applied — `ON_ERROR_STOP` aborts the whole file.

    3. Set the password interactively. `\password` prompts twice without echo and
       sends only a SCRAM verifier, so the plaintext never reaches the wire, the
       server log, or the screen:

           docker exec -it didim-mcp-service-backend-db-1 psql -U mcp -d mcpdb
           \password agentdock_app
           \q

       Until this runs the role has a NULL password and cannot authenticate at
       all, so step 2 on its own leaves nothing usable.

    4. Create `.env` in the repository root with the password you chose. `.env` is
       already git-ignored. Do not paste it back into this session.

           AGENTDOCK_DATABASE_URL=postgres://agentdock_app:YOUR_PASSWORD@localhost:5432/mcpdb
           AGENTDOCK_TEST_DATABASE_URL=postgres://agentdock_app:YOUR_PASSWORD@localhost:5432/mcpdb

       Both point at the same role and database; the schema each connection acts
       on is chosen by the connection, not by the URL. Plan 00-02 ships
       `.env.example` documenting these and `GITHUB_TOKEN`.

    If any step fails, run `scripts/sql/rollback-agentdock.sql` and tell me what
    happened rather than improvising against a shared database.
  </instructions>
  <verification>Task 3 runs `scripts/sql/verify-isolation.sql` as the superuser — no password needed — and reports seven assertions covering role attributes, schema ownership, negative privileges, and live denied probes.</verification>
  <resume-signal>Type "applied" when the bootstrap has run, the password is set, and .env exists — or describe what failed.</resume-signal>
</task>

<task type="auto">
  <name>Task 3: Prove the isolation boundary holds</name>
  <precondition>Role `agentdock_app` exists — `docker exec didim-mcp-service-backend-db-1 psql -U mcp -d mcpdb -tAc "SELECT 1 FROM pg_roles WHERE rolname='agentdock_app'"` returns 1.</precondition>
  <files>scripts/sql/verify-isolation.sql</files>
  <action>
    Run the verification script as the superuser through the container. It needs
    no password and no `.env`: the container's local socket is configured
    `trust`, and the script connects as `mcp`.

    Read the seven PASS notices in the output. If any assertion raises, do not
    modify the verification script to make it pass — report the failing assertion
    number and its message, because a failure here means the boundary is not what
    this phase claims.

    Record in the summary the exact PASS lines emitted, so a later phase can
    diff against them.
  </action>
  <verify>
    <automated>docker exec -i didim-mcp-service-backend-db-1 psql -U mcp -d mcpdb -v ON_ERROR_STOP=1 -f - &lt; scripts/sql/verify-isolation.sql 2&gt;&amp;1 | grep -c 'PASS [1-7]/7' | grep -qx 7</automated>
  </verify>
  <done>All seven assertions pass. The role is a non-superuser owning exactly two schemas, holds no privilege on any pre-existing table, cannot create an object outside its schemas, and can create one inside them. The co-tenant schema's owner and the cluster's default ACLs are unchanged.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| AgentDock tooling → shared `mcpdb` | Every statement AgentDock will ever issue crosses here into a database a second application owns. This plan is the fence at that crossing. |
| Maintainer's terminal → agent transcript | The role password exists on one side and must never cross to the other. |
| Container local socket → PostgreSQL | `pg_hba.conf` grants `trust` here. Outside AgentDock's control and outside this phase's scope. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-00-01 | Elevation of Privilege | `CREATE ROLE agentdock_app` | critical | mitigate | Five attributes denied explicitly (`NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION`); verification section 1 asserts each is false and section 2 asserts zero role memberships, so nothing can be inherited in later. |
| T-00-02 | Information Disclosure | role password | critical | mitigate | `CREATE ROLE` carries no `PASSWORD` clause; the secret is set only via psql `\password`, which prompts without echo and transmits a SCRAM verifier. No agent-executed command in this plan carries or prints the value. |
| T-00-03 | Tampering | co-tenant schema and its 10 tables | critical | mitigate | Bootstrap contains only `CREATE ROLE`, two `CREATE SCHEMA`, and one `ALTER ROLE` against the new role — no `DROP`, no `ALTER` of a pre-existing object, no `REVOKE`. Verification section 3 asserts the co-tenant and `public` schema owners are unchanged; section 6 asserts `pg_default_acl` is still empty. |
| T-00-04 | Repudiation | the isolation claim itself | medium | mitigate | Section 7 runs three real denied statements under `SET LOCAL ROLE` plus a positive control that fails the run if the probes could be passing for the wrong reason; the whole section is inside a transaction that always rolls back. |
| T-00-05 | Elevation of Privilege | `pg_hba.conf` `local all all trust` | high | accept | Changing `pg_hba.conf` is a shared-instance change the co-tenant application depends on and is prohibited by this phase's constraints. Anyone with `docker exec` on this host already has superuser access. The `agentdock_app` boundary defends against AgentDock's own tooling, which is the threat in scope; it is documented as not defending against local container access. |
| T-00-06 | Denial of Service | `rollback-agentdock.sql` `CASCADE` | medium | mitigate | `CASCADE` is bounded to two hardcoded schema names; AgentDock creates no cross-schema reference and the co-tenant does not reference these schemas, so the dependency set is closed. The file header requires listing the objects that would be destroyed before running. |
</threat_model>

<verification>
1. `scripts/sql/bootstrap-agentdock.sql` contains no `REVOKE`, no `DROP`, and no literal password.
2. `scripts/sql/rollback-agentdock.sql` reverses every object the bootstrap creates, in dependency order.
3. `verify-isolation.sql` run as superuser emits exactly seven `PASS n/7` lines and exits 0.
4. No password appears in any tracked file, in this plan, or in any command output produced by the agent.
5. The co-tenant application is still running and its schema is untouched: `SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('agentdock','agentdock_test','pg_catalog','information_schema')` still returns 10.
</verification>

<success_criteria>
- **FND-01 (partial)** — `agentdock` exists, is owned by `agentdock_app`, and the catalog check for AgentDock-owned objects outside it returns zero. The migration-history half of FND-01 lands in plan 00-04.
- **FND-08 (partial)** — the role's password exists only in the maintainer's `.env`; no agent-visible command, file, or planning document contains it.
- Roadmap Phase 0 success criteria 1, 2, and 3 are proven by `verify-isolation.sql` sections 1, 4–5, 7, and 3 respectively.
</success_criteria>

<output>
Create `.planning/phases/AGD-00-database-isolation-bootstrap/00-01-SUMMARY.md` when done.
Record the seven PASS lines verbatim. Do not record any credential.
</output>
