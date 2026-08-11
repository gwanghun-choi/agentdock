CREATE TABLE "agentdock"."repo_seed" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"source_kind" text NOT NULL,
	"discovered_from" text NOT NULL,
	"discovered_path" text NOT NULL,
	"hint" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "repo_seed_full_name_key" ON "agentdock"."repo_seed" USING btree ("full_name");--> statement-breakpoint
-- Hand-added after generation, which is what the generate-review-migrate
-- workflow exists for. ON CONFLICT DO NOTHING so re-running is safe, and the
-- snapshot in drizzle/meta is unaffected so later generates stay correct.
INSERT INTO "agentdock"."artifact_type" ("id", "label") VALUES
  ('plugin',     'Claude Code Plugin'),
  ('catalog',    'Plugin Marketplace'),
  ('mcp_server', 'MCP Server'),
  ('command',    'Slash Command'),
  ('hook',       'Hook Configuration')
ON CONFLICT DO NOTHING;