CREATE TABLE "agentdock"."ingest_attempt" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"job_id" bigint NOT NULL,
	"attempt_no" smallint NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone DEFAULT now() NOT NULL,
	"outcome" text NOT NULL,
	"error_detail" text,
	"commit_sha" text,
	"files_read" integer DEFAULT 0 NOT NULL,
	"artifacts_found" integer DEFAULT 0 NOT NULL,
	"artifacts_new" integer DEFAULT 0 NOT NULL,
	"artifacts_updated" integer DEFAULT 0 NOT NULL,
	"artifacts_unchanged" integer DEFAULT 0 NOT NULL,
	"artifacts_removed" integer DEFAULT 0 NOT NULL,
	"parse_failed" integer DEFAULT 0 NOT NULL,
	"truncated" boolean DEFAULT false NOT NULL,
	"rate_remaining" integer,
	"rate_reset" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agentdock"."ingest_job" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"target" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"worker_id" text
);
--> statement-breakpoint
ALTER TABLE "agentdock"."ingest_attempt" ADD CONSTRAINT "ingest_attempt_job_id_ingest_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "agentdock"."ingest_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ingest_attempt_job_idx" ON "agentdock"."ingest_attempt" USING btree ("job_id","attempt_no" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "ingest_job_active_key" ON "agentdock"."ingest_job" USING btree ("target") WHERE "agentdock"."ingest_job"."status" in ('queued','running');--> statement-breakpoint
CREATE INDEX "ingest_job_claim_idx" ON "agentdock"."ingest_job" USING btree ("next_attempt_at") WHERE "agentdock"."ingest_job"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "ingest_job_running_idx" ON "agentdock"."ingest_job" USING btree ("started_at") WHERE "agentdock"."ingest_job"."status" = 'running';