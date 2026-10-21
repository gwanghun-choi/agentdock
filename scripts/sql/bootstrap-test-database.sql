-- scripts/sql/bootstrap-test-database.sql
--
-- The disposable test database, local and CI alike (`bun run db:test:bootstrap`).
-- Run as the container's superuser against postgres:17 started with
-- POSTGRES_DB=agentdock_test and POSTGRES_HOST_AUTH_METHOD=trust on
-- 127.0.0.1:55432 — the only place src/db/testDatabase.ts lets a test connect.
--
-- Trust auth is what keeps a password out of this file, out of ci.yml and out
-- of every command line: the container is bound to loopback (or lives on an
-- ephemeral runner) and holds nothing but test rows.
--
-- The same bootstrap a real deployment runs, then the one statement a real
-- deployment's superuser runs out of band (AGENTS.md: CREATE EXTENSION never
-- appears in an AgentDock migration; 0007 fails loudly without it).

\set ON_ERROR_STOP on
\ir bootstrap-agentdock.sql
CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA public;
