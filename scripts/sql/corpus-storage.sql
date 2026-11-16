-- scripts/sql/corpus-storage.sql
--
-- Read-only. What .github/workflows/corpus-reset.yml prints before and after a
-- reset: the database's size and each agentdock table's, with its indexes. On
-- Neon the project limit counts every database and branch; pg_database_size is
-- this one database (docs/analysis/agentdock-phase98-sync-53100.md).
select pg_size_pretty(pg_database_size(current_database())) as database_size;
select c.relname,
       pg_size_pretty(pg_total_relation_size(c.oid)) as total,
       pg_size_pretty(pg_indexes_size(c.oid)) as indexes,
       c.reltuples::bigint as est_rows
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'agentdock' and c.relkind = 'r'
 order by pg_total_relation_size(c.oid) desc;
