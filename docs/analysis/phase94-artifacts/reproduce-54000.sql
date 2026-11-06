-- The old constraint and one path of incompressible text: the failure 0011 removes. Rolled back.
\set ON_ERROR_STOP off
BEGIN;
ALTER TABLE agentdock.package ADD CONSTRAINT old_identity UNIQUE (repository_id, type, source_path);
INSERT INTO agentdock.package (repository_id, type, source_path, name, slug)
 SELECT (SELECT min(id) FROM agentdock.repository), 'skill',
        (SELECT string_agg(md5(g::text), '/') FROM generate_series(1,116) g), 'long', 'long';
ROLLBACK;
