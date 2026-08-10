-- drizzle-kit emitted `CREATE SCHEMA "agentdock";` here. It was removed by hand
-- before this migration was ever applied: agentdock_app is NOCREATEDB with no
-- CREATE on the database, so it cannot create a schema, and creating one is not
-- AgentDock's job. The schema is created once by a superuser during the
-- bootstrap (scripts/sql/bootstrap-agentdock.sql). The snapshot in drizzle/meta
-- is unaffected, so later generates stay correct.
CREATE TABLE "agentdock"."schema_meta" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
