ALTER TABLE "agentdock"."package" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
          setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
          setweight(to_tsvector('english',
            replace(replace(coalesce(source_path, ''), '/', ' '), '.', ' ')), 'C') ||
          setweight(to_tsvector('english', replace(coalesce(type, ''), '_', ' ')), 'D')) STORED;--> statement-breakpoint
CREATE INDEX "package_search_vector_idx" ON "agentdock"."package" USING gin ("search_vector");