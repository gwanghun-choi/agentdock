-- SUPERSEDED: this reverses the generated-column 0011, which was never applied. Do not use it; see rollback-0012.sql.
-- Reverses drizzle/0011_path_digest_identity.sql, in one transaction. Not run in production.
-- Fails with 54000 and changes nothing if a path too long for the old constraint is stored.
-- The code must go back to before 0011 in the same change: this code's ON CONFLICT names the
-- digest. created_at is 0011's "when" in drizzle/meta/_journal.json.
BEGIN;
ALTER TABLE "agentdock"."package" ADD CONSTRAINT "package_identity" UNIQUE ("repository_id","type","source_path");
ALTER TABLE "agentdock"."capability_finding" ADD CONSTRAINT "capability_finding_identity" UNIQUE ("package_version_id","detector_id","category","source_path","start_line","summary");
ALTER TABLE "agentdock"."package" DROP COLUMN "source_path_digest";
ALTER TABLE "agentdock"."capability_finding" DROP COLUMN "source_path_digest";
DELETE FROM "agentdock"."__drizzle_migrations" WHERE created_at = 1793937622665;
COMMIT;
