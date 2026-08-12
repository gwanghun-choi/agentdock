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
--   4. the session flag and the connection's current_schema are both asserted
--      first
--
-- The schema itself is deliberately not dropped: agentdock_app has no CREATE
-- privilege on the database and could not recreate it without another
-- superuser session.

DO $$
DECLARE stmt text;
BEGIN
  -- The SCHEMA, not the database name. AgentDock is meant to be self-hosted, so
  -- the database it lives in differs per deployment and a literal name here
  -- would be one deployment's name pretending to be a safety property — it would
  -- also refuse to run for everyone else. The schema is the boundary AgentDock
  -- actually owns, and it is what the loop below deletes from.
  IF current_schema() <> 'agentdock' THEN
    RAISE EXCEPTION
      'Refusing to reset: current_schema() is %, expected agentdock. The connection is not confined to the schema this file empties.',
      current_schema();
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
