-- scripts/sql/dev-reset.sql
--
-- Empties the `agentdock` schema. Run through `bun run db:reset --confirm`,
-- which connects as agentdock_app and sets the session flag this file requires.
--
-- Four independent things stop this from reaching another schema:
--   1. the schema name is a literal here; this file takes no parameter, so
--      there is no substitution that could point it elsewhere
--   2. every statement executed is generated from a catalog query filtered to
--      that same literal
--   3. the connecting role owns nothing outside agentdock and agentdock_test,
--      so a statement that escaped 1 and 2 still fails with a permission error
--   4. the session flag and the database name are both asserted first
--
-- The schema itself is deliberately not dropped: agentdock_app has no CREATE
-- privilege on the database and could not recreate it without another
-- superuser session.

DO $$
DECLARE stmt text;
BEGIN
  IF current_database() <> 'mcpdb' THEN
    RAISE EXCEPTION 'Refusing to reset: current_database() is %, expected mcpdb', current_database();
  END IF;

  IF current_setting('agentdock.allow_reset', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to reset: this session did not set agentdock.allow_reset';
  END IF;

  FOR stmt IN
      SELECT format('DROP TABLE IF EXISTS agentdock.%I CASCADE', tablename)
        FROM pg_tables  WHERE schemaname = 'agentdock'
    UNION ALL
      SELECT format('DROP VIEW IF EXISTS agentdock.%I CASCADE', viewname)
        FROM pg_views   WHERE schemaname = 'agentdock'
    UNION ALL
      SELECT format('DROP TYPE IF EXISTS agentdock.%I CASCADE', t.typname)
        FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
       WHERE n.nspname = 'agentdock' AND t.typtype = 'e'
  LOOP
    RAISE NOTICE '%', stmt;
    EXECUTE stmt;
  END LOOP;
END $$;
