-- scripts/sql/verify-isolation.sql
--
-- Proves the AgentDock isolation boundary holds. Run as a SUPERUSER:
--
--   psql -U <superuser> -d <database> -v ON_ERROR_STOP=1 -f scripts/sql/verify-isolation.sql
--
-- Read-only, except for section 7, which runs probe statements under
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
  -- System namespaces are excluded because PostgreSQL puts the TOAST companion
  -- of every table with a varlena column in pg_toast, owned by the table's
  -- owner. Those are not objects AgentDock created or can address, and they
  -- appeared the moment the first migration ran. The property that matters is
  -- that agentdock_app owns no object in any *user* schema, and owns no schema
  -- besides its two — both asserted here.
  SELECT count(*) INTO n
    FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE c.relowner = 'agentdock_app'::regrole
     AND ns.nspname NOT IN ('agentdock','agentdock_test')
     AND ns.nspname NOT LIKE 'pg\_%'
     AND ns.nspname <> 'information_schema';
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL 6: % object(s) owned by agentdock_app outside its schemas', n;
  END IF;

  SELECT count(*) INTO n
    FROM pg_namespace
   WHERE nspowner = 'agentdock_app'::regrole
     AND nspname NOT IN ('agentdock','agentdock_test');
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL 6: agentdock_app owns % schema(s) it should not', n;
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
