-- scripts/sql/corpus-fingerprint.sql
--
-- One row per table corpus-reset empties: its row count and an md5 over its
-- rows' identity columns in id order. Read-only. .github/workflows/corpus-reset.yml
-- runs it against the database and against a restore of the backup taken from
-- it, and refuses to reset unless the two outputs are byte-identical — the
-- backup is proved restorable before anything is emptied.
select * from (
select 'capability_finding' as t, count(*) as n,
       md5(coalesce(string_agg(id::text || ':' || package_version_id::text, ',' order by id), '')) as h
  from agentdock.capability_finding
union all
select 'package_version', count(*),
       md5(coalesce(string_agg(id::text || ':' || content_hash || ':' || commit_sha, ',' order by id), ''))
  from agentdock.package_version
union all
select 'package', count(*),
       md5(coalesce(string_agg(id::text || ':' || type || ':' || source_path || ':' || name, ',' order by id), ''))
  from agentdock.package
union all
select 'repository', count(*),
       md5(coalesce(string_agg(id::text || ':' || full_name || ':' || stars::text, ',' order by id), ''))
  from agentdock.repository
union all
select 'ingest_attempt', count(*),
       md5(coalesce(string_agg(id::text || ':' || job_id::text || ':' || outcome, ',' order by id), ''))
  from agentdock.ingest_attempt
union all
select 'ingest_job', count(*),
       md5(coalesce(string_agg(id::text || ':' || target || ':' || status, ',' order by id), ''))
  from agentdock.ingest_job
union all
select 'repo_seed', count(*),
       md5(coalesce(string_agg(id::text || ':' || full_name, ',' order by id), ''))
  from agentdock.repo_seed
union all
select 'schema_meta', count(*),
       md5(coalesce(string_agg(key || ':' || md5(value::text), ',' order by key collate "C"), ''))
  from agentdock.schema_meta
) u
-- "C": the hosted database and the scratch image may sort punctuation differently.
order by t collate "C";
