-- scripts/sql/bootstrap-agentdock.sql
--
-- AgentDock database bootstrap. Run ONCE, by the maintainer, as a superuser.
-- Additive only: this file creates one role and two schemas and touches nothing
-- that already exists. It contains no DROP, no REVOKE, and no statement that
-- names another application's objects.
--
-- HOW TO RUN:
--
--   docker exec -i didim-mcp-service-backend-db-1 \
--     psql -U mcp -d mcpdb -v ON_ERROR_STOP=1 -f - < scripts/sql/bootstrap-agentdock.sql
--
-- Then set the password separately (it is NOT in this file, by design):
--
--   docker exec -it didim-mcp-service-backend-db-1 psql -U mcp -d mcpdb
--   \password agentdock_app
--   \q
--
-- Rollback is scripts/sql/rollback-agentdock.sql.
-- Verification is scripts/sql/verify-isolation.sql.

\set ON_ERROR_STOP on

-- The role. No PASSWORD clause: the secret is set afterwards, so it never
-- appears in this file, in Git, or in a process listing. Until it is set, this
-- role has a NULL password and cannot authenticate, because the server uses
-- scram-sha-256.
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
-- overrides this when the test schema is in use. This ALTER targets the role
-- created three statements ago, not a pre-existing object.
ALTER ROLE agentdock_app SET search_path = agentdock;

-- Deliberately absent:
--   * no GRANT CONNECT       -- PUBLIC already has CONNECT on this database
--   * no REVOKE of any kind  -- nothing to revoke, and revoking from PUBLIC
--                               would strip the co-tenant application too
--   * no CREATE EXTENSION    -- pg_trgm needs a superuser and is a shared-database
--                               change; it belongs to the search phase, not here
