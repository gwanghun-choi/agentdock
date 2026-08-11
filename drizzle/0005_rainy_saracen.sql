CREATE TABLE "agentdock"."capability_finding" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"package_version_id" bigint NOT NULL,
	"detector_id" text NOT NULL,
	"detector_version" text NOT NULL,
	"category" text NOT NULL,
	"signal" text NOT NULL,
	"summary" text NOT NULL,
	"source_path" text NOT NULL,
	"start_line" integer,
	"end_line" integer,
	"commit_sha" text NOT NULL,
	"evidence_text" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "capability_finding_identity" UNIQUE("package_version_id","detector_id","category","source_path","start_line","summary")
);
--> statement-breakpoint
ALTER TABLE "agentdock"."package" ADD COLUMN "files" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agentdock"."package_version" ADD COLUMN "analyzed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agentdock"."capability_finding" ADD CONSTRAINT "capability_finding_package_version_id_package_version_id_fk" FOREIGN KEY ("package_version_id") REFERENCES "agentdock"."package_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "capability_finding_version_idx" ON "agentdock"."capability_finding" USING btree ("package_version_id");