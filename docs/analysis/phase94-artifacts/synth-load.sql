\set ON_ERROR_STOP on
\timing off
BEGIN;
insert into agentdock.repository (github_node_id, full_name, owner, default_branch, description, stars, is_fork, scanned_at)
 select 'SYN'||g, 'syn'||(g%3000)||'/repo'||g, 'syn'||(g%3000), 'main', 'synthetic', (g*7)%5000, (g%40=0), now() from generate_series(1,8800) g;
create temp table rid as select id, row_number() over () rn from agentdock.repository where github_node_id like 'SYN%';
create temp table src as select row_number() over () rn, type, name, summary, source_path, meta from agentdock.package;
insert into agentdock.package (repository_id,type,source_path,name,slug,summary,meta,updated_at)
 select r.id, s.type, s.source_path||'/'||g, s.name||g, 'syn'||g, s.summary, s.meta, now()-(g||' minutes')::interval
 from generate_series(1,45000) g join src s on s.rn = 1+(g%(select count(*) from src)) join rid r on r.rn = 1+(g%8800);
insert into agentdock.package_version (package_id, commit_sha, content_hash, parse_status, ingested_at)
 select p.id, md5(p.id::text||'c'), case when p.id%5=0 then md5((p.id%2000)::text) else md5(p.id::text) end, case when p.id%200=0 then 'failed' else 'ok' end, now()-'1 day'::interval
 from agentdock.package p where p.slug like 'syn%';
insert into agentdock.package_version (package_id, commit_sha, content_hash, parse_status, ingested_at)
 select p.id, md5(p.id::text||'d'), md5(p.id::text||'v2'), 'ok', now()
 from agentdock.package p where p.slug like 'syn%' and p.id%3=0;
analyze agentdock.repository; analyze agentdock.package; analyze agentdock.package_version;
select 'scale', (select count(*) from agentdock.repository), (select count(*) from agentdock.package), (select count(*) from agentdock.package_version), (select avg(length(summary))::int from agentdock.package);
COMMIT;
