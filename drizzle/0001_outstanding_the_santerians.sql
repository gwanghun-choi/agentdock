CREATE TABLE "agentdock"."artifact_type" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agentdock"."package" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"repository_id" bigint NOT NULL,
	"type" text NOT NULL,
	"source_path" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"summary" text,
	"license_text" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"delisted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "package_identity" UNIQUE("repository_id","type","source_path")
);
--> statement-breakpoint
CREATE TABLE "agentdock"."package_version" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"package_id" bigint NOT NULL,
	"commit_sha" text NOT NULL,
	"blob_sha" text,
	"content_hash" text NOT NULL,
	"declared_version" text,
	"body" text,
	"frontmatter" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"parse_status" text DEFAULT 'ok' NOT NULL,
	"parse_errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "package_version_content_key" UNIQUE("package_id","content_hash")
);
--> statement-breakpoint
CREATE TABLE "agentdock"."repository" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"github_node_id" text NOT NULL,
	"full_name" text NOT NULL,
	"owner" text NOT NULL,
	"default_branch" text NOT NULL,
	"description" text,
	"homepage" text,
	"license_spdx" text,
	"stars" integer DEFAULT 0 NOT NULL,
	"is_fork" boolean DEFAULT false NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"topics" text[] DEFAULT '{}'::text[] NOT NULL,
	"pushed_at" timestamp with time zone,
	"scanned_at" timestamp with time zone,
	"etag" text,
	"last_ingested_sha" text,
	"tree_truncated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agentdock"."repository_denylist" (
	"full_name" text PRIMARY KEY NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agentdock"."package" ADD CONSTRAINT "package_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "agentdock"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agentdock"."package" ADD CONSTRAINT "package_type_artifact_type_id_fk" FOREIGN KEY ("type") REFERENCES "agentdock"."artifact_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agentdock"."package_version" ADD CONSTRAINT "package_version_package_id_package_id_fk" FOREIGN KEY ("package_id") REFERENCES "agentdock"."package"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "package_live_idx" ON "agentdock"."package" USING btree ("type","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "package_version_recent_idx" ON "agentdock"."package_version" USING btree ("package_id","ingested_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "repository_node_id_key" ON "agentdock"."repository" USING btree ("github_node_id");--> statement-breakpoint
CREATE UNIQUE INDEX "repository_full_name_key" ON "agentdock"."repository" USING btree (lower("full_name"));--> statement-breakpoint
CREATE INDEX "repository_stars_idx" ON "agentdock"."repository" USING btree ("stars" DESC NULLS LAST);--> statement-breakpoint
-- Hand-added after generation, which is what the generate-review-migrate
-- workflow exists for. The artifact-type dimension ships at exactly one value;
-- Phase 3 adds the rest with an INSERT rather than a migration against live
-- data. ON CONFLICT DO NOTHING so re-running this migration is safe.
-- The snapshot in drizzle/meta is unaffected, so later generates stay correct.
INSERT INTO "agentdock"."artifact_type" ("id", "label") VALUES ('skill', 'Agent Skill') ON CONFLICT DO NOTHING;