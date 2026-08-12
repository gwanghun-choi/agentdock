-- scripts/sql/rollback-agentdock.sql
--
-- Reverses scripts/sql/bootstrap-agentdock.sql. Run as a superuser.
--
--   psql -U <superuser> -d <database> -v ON_ERROR_STOP=1 -f scripts/sql/rollback-agentdock.sql
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
