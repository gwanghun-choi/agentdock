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
\echo == V1_countVisibleByType_as_is
explain (analyze, buffers) select "agentdock"."package"."type", (count(*) filter (where ("agentdock"."package"."summary" is null
    or "agentdock"."package"."summary" !~ '[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002fa1f\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]'
    or coalesce((
    select case
      when t.s is null or btrim(t.s) = '' then null
      when t.s !~ '[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002fa1f\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]' then
        case
          when t.s !~ '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]' then
            case when t.s ~ '[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]' then 'latin' else 'unknown' end
          when (length(t.s) - length(regexp_replace(t.s, '[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]+', '', 'g'))) >= (length(t.s) - length(regexp_replace(t.s, '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]+', '', 'g'))) then 'latin'
          else 'other'
        end
      else (
        select case
          when c.cjk * 10 < c.cjk + c.latin + c.other then
            case when c.latin >= c.other then 'latin' else 'other' end
          when t.s ~ '([A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f][A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f0-9''._/-]*[,;:!?"()]*\s+){5}[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]' then 'mixed'
          when c.hangul * 2 >= c.cjk then 'ko'
          when c.kana * 10 >= c.cjk then 'ja'
          when c.cjk < 4 then 'unknown'
          else 'zh'
        end
        from (
          select (length(t.s) - length(regexp_replace(t.s, '[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002fa1f\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]+', '', 'g'))) as cjk,
                 case when t.s ~ '[\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f]' then (length(t.s) - length(regexp_replace(t.s, '[\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f]+', '', 'g'))) else 0 end as kana,
                 case when t.s ~ '[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]' then (length(t.s) - length(regexp_replace(t.s, '[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]+', '', 'g'))) else 0 end as hangul,
                 (length(t.s) - length(regexp_replace(t.s, '[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]+', '', 'g'))) as latin,
                 case when t.s ~ '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]' then (length(t.s) - length(regexp_replace(t.s, '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]+', '', 'g'))) else 0 end as other
          offset 0
        ) c
      )
    end
    from (select "agentdock"."package"."summary"::text as s) t
  ), '') not in ('zh'))))::int, count(*)::int from "agentdock"."package" inner join "agentdock"."repository" on "agentdock"."package"."repository_id" = "agentdock"."repository"."id" where ("agentdock"."package"."delisted_at" is null and case
  when "agentdock"."repository"."is_fork" then 'fork'
  when (
    select v.parse_status from "agentdock"."package_version" v
    where v.package_id = "agentdock"."package"."id"
    order by v.ingested_at desc limit 1
  ) = 'failed' then 'unparsed'
  when "agentdock"."package"."meta"->>'detectionConfidence' is distinct from 'shape-only'
   and exists (
    select 1 from "agentdock"."package_version" v2
    join "agentdock"."package" p2 on p2.id = v2.package_id
    join "agentdock"."repository" r2 on r2.id = p2.repository_id
    where v2.content_hash = (
    select v.content_hash from "agentdock"."package_version" v
    where v.package_id = "agentdock"."package"."id"
    order by v.ingested_at desc limit 1
  )
      and v2.id = (
        select z.id from "agentdock"."package_version" z
        where z.package_id = p2.id order by z.ingested_at desc limit 1
      )
      and p2.id <> "agentdock"."package"."id"
      and p2.delisted_at is null
      and r2.is_fork = false
      and v2.parse_status <> 'failed'
      and p2.meta->>'detectionConfidence' is distinct from 'shape-only'
      and (r2.stars > "agentdock"."repository"."stars"
           or (r2.stars = "agentdock"."repository"."stars" and p2.id < "agentdock"."package"."id"))
  ) then 'duplicate'
  else null
end is null) group by "agentdock"."package"."type";
explain (analyze, buffers) select "agentdock"."package"."type", (count(*) filter (where ("agentdock"."package"."summary" is null
    or "agentdock"."package"."summary" !~ '[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002fa1f\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]'
    or coalesce((
    select case
      when t.s is null or btrim(t.s) = '' then null
      when t.s !~ '[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002fa1f\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]' then
        case
          when t.s !~ '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]' then
            case when t.s ~ '[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]' then 'latin' else 'unknown' end
          when (length(t.s) - length(regexp_replace(t.s, '[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]+', '', 'g'))) >= (length(t.s) - length(regexp_replace(t.s, '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]+', '', 'g'))) then 'latin'
          else 'other'
        end
      else (
        select case
          when c.cjk * 10 < c.cjk + c.latin + c.other then
            case when c.latin >= c.other then 'latin' else 'other' end
          when t.s ~ '([A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f][A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f0-9''._/-]*[,;:!?"()]*\s+){5}[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]' then 'mixed'
          when c.hangul * 2 >= c.cjk then 'ko'
          when c.kana * 10 >= c.cjk then 'ja'
          when c.cjk < 4 then 'unknown'
          else 'zh'
        end
        from (
          select (length(t.s) - length(regexp_replace(t.s, '[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002fa1f\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]+', '', 'g'))) as cjk,
                 case when t.s ~ '[\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f]' then (length(t.s) - length(regexp_replace(t.s, '[\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f]+', '', 'g'))) else 0 end as kana,
                 case when t.s ~ '[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]' then (length(t.s) - length(regexp_replace(t.s, '[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]+', '', 'g'))) else 0 end as hangul,
                 (length(t.s) - length(regexp_replace(t.s, '[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]+', '', 'g'))) as latin,
                 case when t.s ~ '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]' then (length(t.s) - length(regexp_replace(t.s, '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]+', '', 'g'))) else 0 end as other
          offset 0
        ) c
      )
    end
    from (select "agentdock"."package"."summary"::text as s) t
  ), '') not in ('zh'))))::int, count(*)::int from "agentdock"."package" inner join "agentdock"."repository" on "agentdock"."package"."repository_id" = "agentdock"."repository"."id" where ("agentdock"."package"."delisted_at" is null and case
  when "agentdock"."repository"."is_fork" then 'fork'
  when (
    select v.parse_status from "agentdock"."package_version" v
    where v.package_id = "agentdock"."package"."id"
    order by v.ingested_at desc limit 1
  ) = 'failed' then 'unparsed'
  when "agentdock"."package"."meta"->>'detectionConfidence' is distinct from 'shape-only'
   and exists (
    select 1 from "agentdock"."package_version" v2
    join "agentdock"."package" p2 on p2.id = v2.package_id
    join "agentdock"."repository" r2 on r2.id = p2.repository_id
    where v2.content_hash = (
    select v.content_hash from "agentdock"."package_version" v
    where v.package_id = "agentdock"."package"."id"
    order by v.ingested_at desc limit 1
  )
      and v2.id = (
        select z.id from "agentdock"."package_version" z
        where z.package_id = p2.id order by z.ingested_at desc limit 1
      )
      and p2.id <> "agentdock"."package"."id"
      and p2.delisted_at is null
      and r2.is_fork = false
      and v2.parse_status <> 'failed'
      and p2.meta->>'detectionConfidence' is distinct from 'shape-only'
      and (r2.stars > "agentdock"."repository"."stars"
           or (r2.stars = "agentdock"."repository"."stars" and p2.id < "agentdock"."package"."id"))
  ) then 'duplicate'
  else null
end is null) group by "agentdock"."package"."type";
explain (analyze, buffers) select "agentdock"."package"."type", (count(*) filter (where ("agentdock"."package"."summary" is null
    or "agentdock"."package"."summary" !~ '[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002fa1f\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]'
    or coalesce((
    select case
      when t.s is null or btrim(t.s) = '' then null
      when t.s !~ '[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002fa1f\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]' then
        case
          when t.s !~ '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]' then
            case when t.s ~ '[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]' then 'latin' else 'unknown' end
          when (length(t.s) - length(regexp_replace(t.s, '[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]+', '', 'g'))) >= (length(t.s) - length(regexp_replace(t.s, '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]+', '', 'g'))) then 'latin'
          else 'other'
        end
      else (
        select case
          when c.cjk * 10 < c.cjk + c.latin + c.other then
            case when c.latin >= c.other then 'latin' else 'other' end
          when t.s ~ '([A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f][A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f0-9''._/-]*[,;:!?"()]*\s+){5}[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]' then 'mixed'
          when c.hangul * 2 >= c.cjk then 'ko'
          when c.kana * 10 >= c.cjk then 'ja'
          when c.cjk < 4 then 'unknown'
          else 'zh'
        end
        from (
          select (length(t.s) - length(regexp_replace(t.s, '[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002fa1f\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]+', '', 'g'))) as cjk,
                 case when t.s ~ '[\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f]' then (length(t.s) - length(regexp_replace(t.s, '[\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f]+', '', 'g'))) else 0 end as kana,
                 case when t.s ~ '[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]' then (length(t.s) - length(regexp_replace(t.s, '[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]+', '', 'g'))) else 0 end as hangul,
                 (length(t.s) - length(regexp_replace(t.s, '[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]+', '', 'g'))) as latin,
                 case when t.s ~ '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]' then (length(t.s) - length(regexp_replace(t.s, '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]+', '', 'g'))) else 0 end as other
          offset 0
        ) c
      )
    end
    from (select "agentdock"."package"."summary"::text as s) t
  ), '') not in ('zh'))))::int, count(*)::int from "agentdock"."package" inner join "agentdock"."repository" on "agentdock"."package"."repository_id" = "agentdock"."repository"."id" where ("agentdock"."package"."delisted_at" is null and case
  when "agentdock"."repository"."is_fork" then 'fork'
  when (
    select v.parse_status from "agentdock"."package_version" v
    where v.package_id = "agentdock"."package"."id"
    order by v.ingested_at desc limit 1
  ) = 'failed' then 'unparsed'
  when "agentdock"."package"."meta"->>'detectionConfidence' is distinct from 'shape-only'
   and exists (
    select 1 from "agentdock"."package_version" v2
    join "agentdock"."package" p2 on p2.id = v2.package_id
    join "agentdock"."repository" r2 on r2.id = p2.repository_id
    where v2.content_hash = (
    select v.content_hash from "agentdock"."package_version" v
    where v.package_id = "agentdock"."package"."id"
    order by v.ingested_at desc limit 1
  )
      and v2.id = (
        select z.id from "agentdock"."package_version" z
        where z.package_id = p2.id order by z.ingested_at desc limit 1
      )
      and p2.id <> "agentdock"."package"."id"
      and p2.delisted_at is null
      and r2.is_fork = false
      and v2.parse_status <> 'failed'
      and p2.meta->>'detectionConfidence' is distinct from 'shape-only'
      and (r2.stars > "agentdock"."repository"."stars"
           or (r2.stars = "agentdock"."repository"."stars" and p2.id < "agentdock"."package"."id"))
  ) then 'duplicate'
  else null
end is null) group by "agentdock"."package"."type";
\echo == V2_count_without_language
explain (analyze, buffers) select "agentdock"."package"."type", count(*)::int from "agentdock"."package" inner join "agentdock"."repository" on "agentdock"."package"."repository_id" = "agentdock"."repository"."id" where ("agentdock"."package"."delisted_at" is null and case
  when "agentdock"."repository"."is_fork" then 'fork'
  when (
    select v.parse_status from "agentdock"."package_version" v
    where v.package_id = "agentdock"."package"."id"
    order by v.ingested_at desc limit 1
  ) = 'failed' then 'unparsed'
  when "agentdock"."package"."meta"->>'detectionConfidence' is distinct from 'shape-only'
   and exists (
    select 1 from "agentdock"."package_version" v2
    join "agentdock"."package" p2 on p2.id = v2.package_id
    join "agentdock"."repository" r2 on r2.id = p2.repository_id
    where v2.content_hash = (
    select v.content_hash from "agentdock"."package_version" v
    where v.package_id = "agentdock"."package"."id"
    order by v.ingested_at desc limit 1
  )
      and v2.id = (
        select z.id from "agentdock"."package_version" z
        where z.package_id = p2.id order by z.ingested_at desc limit 1
      )
      and p2.id <> "agentdock"."package"."id"
      and p2.delisted_at is null
      and r2.is_fork = false
      and v2.parse_status <> 'failed'
      and p2.meta->>'detectionConfidence' is distinct from 'shape-only'
      and (r2.stars > "agentdock"."repository"."stars"
           or (r2.stars = "agentdock"."repository"."stars" and p2.id < "agentdock"."package"."id"))
  ) then 'duplicate'
  else null
end is null) group by "agentdock"."package"."type";
explain (analyze, buffers) select "agentdock"."package"."type", count(*)::int from "agentdock"."package" inner join "agentdock"."repository" on "agentdock"."package"."repository_id" = "agentdock"."repository"."id" where ("agentdock"."package"."delisted_at" is null and case
  when "agentdock"."repository"."is_fork" then 'fork'
  when (
    select v.parse_status from "agentdock"."package_version" v
    where v.package_id = "agentdock"."package"."id"
    order by v.ingested_at desc limit 1
  ) = 'failed' then 'unparsed'
  when "agentdock"."package"."meta"->>'detectionConfidence' is distinct from 'shape-only'
   and exists (
    select 1 from "agentdock"."package_version" v2
    join "agentdock"."package" p2 on p2.id = v2.package_id
    join "agentdock"."repository" r2 on r2.id = p2.repository_id
    where v2.content_hash = (
    select v.content_hash from "agentdock"."package_version" v
    where v.package_id = "agentdock"."package"."id"
    order by v.ingested_at desc limit 1
  )
      and v2.id = (
        select z.id from "agentdock"."package_version" z
        where z.package_id = p2.id order by z.ingested_at desc limit 1
      )
      and p2.id <> "agentdock"."package"."id"
      and p2.delisted_at is null
      and r2.is_fork = false
      and v2.parse_status <> 'failed'
      and p2.meta->>'detectionConfidence' is distinct from 'shape-only'
      and (r2.stars > "agentdock"."repository"."stars"
           or (r2.stars = "agentdock"."repository"."stars" and p2.id < "agentdock"."package"."id"))
  ) then 'duplicate'
  else null
end is null) group by "agentdock"."package"."type";
explain (analyze, buffers) select "agentdock"."package"."type", count(*)::int from "agentdock"."package" inner join "agentdock"."repository" on "agentdock"."package"."repository_id" = "agentdock"."repository"."id" where ("agentdock"."package"."delisted_at" is null and case
  when "agentdock"."repository"."is_fork" then 'fork'
  when (
    select v.parse_status from "agentdock"."package_version" v
    where v.package_id = "agentdock"."package"."id"
    order by v.ingested_at desc limit 1
  ) = 'failed' then 'unparsed'
  when "agentdock"."package"."meta"->>'detectionConfidence' is distinct from 'shape-only'
   and exists (
    select 1 from "agentdock"."package_version" v2
    join "agentdock"."package" p2 on p2.id = v2.package_id
    join "agentdock"."repository" r2 on r2.id = p2.repository_id
    where v2.content_hash = (
    select v.content_hash from "agentdock"."package_version" v
    where v.package_id = "agentdock"."package"."id"
    order by v.ingested_at desc limit 1
  )
      and v2.id = (
        select z.id from "agentdock"."package_version" z
        where z.package_id = p2.id order by z.ingested_at desc limit 1
      )
      and p2.id <> "agentdock"."package"."id"
      and p2.delisted_at is null
      and r2.is_fork = false
      and v2.parse_status <> 'failed'
      and p2.meta->>'detectionConfidence' is distinct from 'shape-only'
      and (r2.stars > "agentdock"."repository"."stars"
           or (r2.stars = "agentdock"."repository"."stars" and p2.id < "agentdock"."package"."id"))
  ) then 'duplicate'
  else null
end is null) group by "agentdock"."package"."type";
\echo == V3_language_without_notlisted
explain (analyze, buffers) select "agentdock"."package"."type", (count(*) filter (where ("agentdock"."package"."summary" is null
    or "agentdock"."package"."summary" !~ '[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002fa1f\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]'
    or coalesce((
    select case
      when t.s is null or btrim(t.s) = '' then null
      when t.s !~ '[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002fa1f\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]' then
        case
          when t.s !~ '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]' then
            case when t.s ~ '[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]' then 'latin' else 'unknown' end
          when (length(t.s) - length(regexp_replace(t.s, '[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]+', '', 'g'))) >= (length(t.s) - length(regexp_replace(t.s, '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]+', '', 'g'))) then 'latin'
          else 'other'
        end
      else (
        select case
          when c.cjk * 10 < c.cjk + c.latin + c.other then
            case when c.latin >= c.other then 'latin' else 'other' end
          when t.s ~ '([A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f][A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f0-9''._/-]*[,;:!?"()]*\s+){5}[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]' then 'mixed'
          when c.hangul * 2 >= c.cjk then 'ko'
          when c.kana * 10 >= c.cjk then 'ja'
          when c.cjk < 4 then 'unknown'
          else 'zh'
        end
        from (
          select (length(t.s) - length(regexp_replace(t.s, '[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002fa1f\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]+', '', 'g'))) as cjk,
                 case when t.s ~ '[\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f]' then (length(t.s) - length(regexp_replace(t.s, '[\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f]+', '', 'g'))) else 0 end as kana,
                 case when t.s ~ '[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]' then (length(t.s) - length(regexp_replace(t.s, '[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]+', '', 'g'))) else 0 end as hangul,
                 (length(t.s) - length(regexp_replace(t.s, '[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]+', '', 'g'))) as latin,
                 case when t.s ~ '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]' then (length(t.s) - length(regexp_replace(t.s, '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]+', '', 'g'))) else 0 end as other
          offset 0
        ) c
      )
    end
    from (select "agentdock"."package"."summary"::text as s) t
  ), '') not in ('zh'))))::int, count(*)::int from "agentdock"."package" inner join "agentdock"."repository" on "agentdock"."package"."repository_id" = "agentdock"."repository"."id" where "agentdock"."package"."delisted_at" is null group by "agentdock"."package"."type";
explain (analyze, buffers) select "agentdock"."package"."type", (count(*) filter (where ("agentdock"."package"."summary" is null
    or "agentdock"."package"."summary" !~ '[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002fa1f\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]'
    or coalesce((
    select case
      when t.s is null or btrim(t.s) = '' then null
      when t.s !~ '[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002fa1f\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]' then
        case
          when t.s !~ '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]' then
            case when t.s ~ '[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]' then 'latin' else 'unknown' end
          when (length(t.s) - length(regexp_replace(t.s, '[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]+', '', 'g'))) >= (length(t.s) - length(regexp_replace(t.s, '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]+', '', 'g'))) then 'latin'
          else 'other'
        end
      else (
        select case
          when c.cjk * 10 < c.cjk + c.latin + c.other then
            case when c.latin >= c.other then 'latin' else 'other' end
          when t.s ~ '([A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f][A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f0-9''._/-]*[,;:!?"()]*\s+){5}[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]' then 'mixed'
          when c.hangul * 2 >= c.cjk then 'ko'
          when c.kana * 10 >= c.cjk then 'ja'
          when c.cjk < 4 then 'unknown'
          else 'zh'
        end
        from (
          select (length(t.s) - length(regexp_replace(t.s, '[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002fa1f\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]+', '', 'g'))) as cjk,
                 case when t.s ~ '[\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f]' then (length(t.s) - length(regexp_replace(t.s, '[\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f]+', '', 'g'))) else 0 end as kana,
                 case when t.s ~ '[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]' then (length(t.s) - length(regexp_replace(t.s, '[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]+', '', 'g'))) else 0 end as hangul,
                 (length(t.s) - length(regexp_replace(t.s, '[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]+', '', 'g'))) as latin,
                 case when t.s ~ '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]' then (length(t.s) - length(regexp_replace(t.s, '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]+', '', 'g'))) else 0 end as other
          offset 0
        ) c
      )
    end
    from (select "agentdock"."package"."summary"::text as s) t
  ), '') not in ('zh'))))::int, count(*)::int from "agentdock"."package" inner join "agentdock"."repository" on "agentdock"."package"."repository_id" = "agentdock"."repository"."id" where "agentdock"."package"."delisted_at" is null group by "agentdock"."package"."type";
explain (analyze, buffers) select "agentdock"."package"."type", (count(*) filter (where ("agentdock"."package"."summary" is null
    or "agentdock"."package"."summary" !~ '[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002fa1f\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]'
    or coalesce((
    select case
      when t.s is null or btrim(t.s) = '' then null
      when t.s !~ '[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002fa1f\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]' then
        case
          when t.s !~ '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]' then
            case when t.s ~ '[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]' then 'latin' else 'unknown' end
          when (length(t.s) - length(regexp_replace(t.s, '[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]+', '', 'g'))) >= (length(t.s) - length(regexp_replace(t.s, '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]+', '', 'g'))) then 'latin'
          else 'other'
        end
      else (
        select case
          when c.cjk * 10 < c.cjk + c.latin + c.other then
            case when c.latin >= c.other then 'latin' else 'other' end
          when t.s ~ '([A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f][A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f0-9''._/-]*[,;:!?"()]*\s+){5}[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]' then 'mixed'
          when c.hangul * 2 >= c.cjk then 'ko'
          when c.kana * 10 >= c.cjk then 'ja'
          when c.cjk < 4 then 'unknown'
          else 'zh'
        end
        from (
          select (length(t.s) - length(regexp_replace(t.s, '[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002fa1f\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]+', '', 'g'))) as cjk,
                 case when t.s ~ '[\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f]' then (length(t.s) - length(regexp_replace(t.s, '[\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f]+', '', 'g'))) else 0 end as kana,
                 case when t.s ~ '[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]' then (length(t.s) - length(regexp_replace(t.s, '[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]+', '', 'g'))) else 0 end as hangul,
                 (length(t.s) - length(regexp_replace(t.s, '[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]+', '', 'g'))) as latin,
                 case when t.s ~ '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]' then (length(t.s) - length(regexp_replace(t.s, '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]+', '', 'g'))) else 0 end as other
          offset 0
        ) c
      )
    end
    from (select "agentdock"."package"."summary"::text as s) t
  ), '') not in ('zh'))))::int, count(*)::int from "agentdock"."package" inner join "agentdock"."repository" on "agentdock"."package"."repository_id" = "agentdock"."repository"."id" where "agentdock"."package"."delisted_at" is null group by "agentdock"."package"."type";
\echo == V4_plain_count
explain (analyze, buffers) select "agentdock"."package"."type", count(*)::int from "agentdock"."package" inner join "agentdock"."repository" on "agentdock"."package"."repository_id" = "agentdock"."repository"."id" where "agentdock"."package"."delisted_at" is null group by "agentdock"."package"."type";
explain (analyze, buffers) select "agentdock"."package"."type", count(*)::int from "agentdock"."package" inner join "agentdock"."repository" on "agentdock"."package"."repository_id" = "agentdock"."repository"."id" where "agentdock"."package"."delisted_at" is null group by "agentdock"."package"."type";
explain (analyze, buffers) select "agentdock"."package"."type", count(*)::int from "agentdock"."package" inner join "agentdock"."repository" on "agentdock"."package"."repository_id" = "agentdock"."repository"."id" where "agentdock"."package"."delisted_at" is null group by "agentdock"."package"."type";
\echo == V5_listPackages_limit10
explain (analyze, buffers) select "agentdock"."package"."id", "agentdock"."package"."name", "agentdock"."package"."summary", "agentdock"."package"."type", "agentdock"."repository"."full_name", "agentdock"."repository"."stars", (select pv.commit_sha from "agentdock"."package_version" pv where pv.package_id = "agentdock"."package"."id" order by pv.ingested_at desc limit 1), case
  when "agentdock"."repository"."is_fork" then 'fork'
  when (
    select v.parse_status from "agentdock"."package_version" v
    where v.package_id = "agentdock"."package"."id"
    order by v.ingested_at desc limit 1
  ) = 'failed' then 'unparsed'
  when "agentdock"."package"."meta"->>'detectionConfidence' is distinct from 'shape-only'
   and exists (
    select 1 from "agentdock"."package_version" v2
    join "agentdock"."package" p2 on p2.id = v2.package_id
    join "agentdock"."repository" r2 on r2.id = p2.repository_id
    where v2.content_hash = (
    select v.content_hash from "agentdock"."package_version" v
    where v.package_id = "agentdock"."package"."id"
    order by v.ingested_at desc limit 1
  )
      and v2.id = (
        select z.id from "agentdock"."package_version" z
        where z.package_id = p2.id order by z.ingested_at desc limit 1
      )
      and p2.id <> "agentdock"."package"."id"
      and p2.delisted_at is null
      and r2.is_fork = false
      and v2.parse_status <> 'failed'
      and p2.meta->>'detectionConfidence' is distinct from 'shape-only'
      and (r2.stars > "agentdock"."repository"."stars"
           or (r2.stars = "agentdock"."repository"."stars" and p2.id < "agentdock"."package"."id"))
  ) then 'duplicate'
  else null
end, (
    select case
      when t.s is null or btrim(t.s) = '' then null
      when t.s !~ '[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002fa1f\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]' then
        case
          when t.s !~ '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]' then
            case when t.s ~ '[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]' then 'latin' else 'unknown' end
          when (length(t.s) - length(regexp_replace(t.s, '[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]+', '', 'g'))) >= (length(t.s) - length(regexp_replace(t.s, '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]+', '', 'g'))) then 'latin'
          else 'other'
        end
      else (
        select case
          when c.cjk * 10 < c.cjk + c.latin + c.other then
            case when c.latin >= c.other then 'latin' else 'other' end
          when t.s ~ '([A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f][A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f0-9''._/-]*[,;:!?"()]*\s+){5}[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]' then 'mixed'
          when c.hangul * 2 >= c.cjk then 'ko'
          when c.kana * 10 >= c.cjk then 'ja'
          when c.cjk < 4 then 'unknown'
          else 'zh'
        end
        from (
          select (length(t.s) - length(regexp_replace(t.s, '[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002fa1f\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]+', '', 'g'))) as cjk,
                 case when t.s ~ '[\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f]' then (length(t.s) - length(regexp_replace(t.s, '[\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f]+', '', 'g'))) else 0 end as kana,
                 case when t.s ~ '[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]' then (length(t.s) - length(regexp_replace(t.s, '[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]+', '', 'g'))) else 0 end as hangul,
                 (length(t.s) - length(regexp_replace(t.s, '[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]+', '', 'g'))) as latin,
                 case when t.s ~ '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]' then (length(t.s) - length(regexp_replace(t.s, '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]+', '', 'g'))) else 0 end as other
          offset 0
        ) c
      )
    end
    from (select "agentdock"."package"."summary"::text as s) t
  ) from "agentdock"."package" inner join "agentdock"."repository" on "agentdock"."package"."repository_id" = "agentdock"."repository"."id" where ("agentdock"."package"."delisted_at" is null and case
  when "agentdock"."repository"."is_fork" then 'fork'
  when (
    select v.parse_status from "agentdock"."package_version" v
    where v.package_id = "agentdock"."package"."id"
    order by v.ingested_at desc limit 1
  ) = 'failed' then 'unparsed'
  when "agentdock"."package"."meta"->>'detectionConfidence' is distinct from 'shape-only'
   and exists (
    select 1 from "agentdock"."package_version" v2
    join "agentdock"."package" p2 on p2.id = v2.package_id
    join "agentdock"."repository" r2 on r2.id = p2.repository_id
    where v2.content_hash = (
    select v.content_hash from "agentdock"."package_version" v
    where v.package_id = "agentdock"."package"."id"
    order by v.ingested_at desc limit 1
  )
      and v2.id = (
        select z.id from "agentdock"."package_version" z
        where z.package_id = p2.id order by z.ingested_at desc limit 1
      )
      and p2.id <> "agentdock"."package"."id"
      and p2.delisted_at is null
      and r2.is_fork = false
      and v2.parse_status <> 'failed'
      and p2.meta->>'detectionConfidence' is distinct from 'shape-only'
      and (r2.stars > "agentdock"."repository"."stars"
           or (r2.stars = "agentdock"."repository"."stars" and p2.id < "agentdock"."package"."id"))
  ) then 'duplicate'
  else null
end is null and ("agentdock"."package"."summary" is null
    or "agentdock"."package"."summary" !~ '[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002fa1f\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]'
    or coalesce((
    select case
      when t.s is null or btrim(t.s) = '' then null
      when t.s !~ '[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002fa1f\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]' then
        case
          when t.s !~ '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]' then
            case when t.s ~ '[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]' then 'latin' else 'unknown' end
          when (length(t.s) - length(regexp_replace(t.s, '[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]+', '', 'g'))) >= (length(t.s) - length(regexp_replace(t.s, '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]+', '', 'g'))) then 'latin'
          else 'other'
        end
      else (
        select case
          when c.cjk * 10 < c.cjk + c.latin + c.other then
            case when c.latin >= c.other then 'latin' else 'other' end
          when t.s ~ '([A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f][A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f0-9''._/-]*[,;:!?"()]*\s+){5}[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]' then 'mixed'
          when c.hangul * 2 >= c.cjk then 'ko'
          when c.kana * 10 >= c.cjk then 'ja'
          when c.cjk < 4 then 'unknown'
          else 'zh'
        end
        from (
          select (length(t.s) - length(regexp_replace(t.s, '[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002fa1f\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]+', '', 'g'))) as cjk,
                 case when t.s ~ '[\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f]' then (length(t.s) - length(regexp_replace(t.s, '[\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f]+', '', 'g'))) else 0 end as kana,
                 case when t.s ~ '[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]' then (length(t.s) - length(regexp_replace(t.s, '[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]+', '', 'g'))) else 0 end as hangul,
                 (length(t.s) - length(regexp_replace(t.s, '[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]+', '', 'g'))) as latin,
                 case when t.s ~ '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]' then (length(t.s) - length(regexp_replace(t.s, '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]+', '', 'g'))) else 0 end as other
          offset 0
        ) c
      )
    end
    from (select "agentdock"."package"."summary"::text as s) t
  ), '') not in ('zh'))) order by "agentdock"."package"."updated_at" desc limit 10;
explain (analyze, buffers) select "agentdock"."package"."id", "agentdock"."package"."name", "agentdock"."package"."summary", "agentdock"."package"."type", "agentdock"."repository"."full_name", "agentdock"."repository"."stars", (select pv.commit_sha from "agentdock"."package_version" pv where pv.package_id = "agentdock"."package"."id" order by pv.ingested_at desc limit 1), case
  when "agentdock"."repository"."is_fork" then 'fork'
  when (
    select v.parse_status from "agentdock"."package_version" v
    where v.package_id = "agentdock"."package"."id"
    order by v.ingested_at desc limit 1
  ) = 'failed' then 'unparsed'
  when "agentdock"."package"."meta"->>'detectionConfidence' is distinct from 'shape-only'
   and exists (
    select 1 from "agentdock"."package_version" v2
    join "agentdock"."package" p2 on p2.id = v2.package_id
    join "agentdock"."repository" r2 on r2.id = p2.repository_id
    where v2.content_hash = (
    select v.content_hash from "agentdock"."package_version" v
    where v.package_id = "agentdock"."package"."id"
    order by v.ingested_at desc limit 1
  )
      and v2.id = (
        select z.id from "agentdock"."package_version" z
        where z.package_id = p2.id order by z.ingested_at desc limit 1
      )
      and p2.id <> "agentdock"."package"."id"
      and p2.delisted_at is null
      and r2.is_fork = false
      and v2.parse_status <> 'failed'
      and p2.meta->>'detectionConfidence' is distinct from 'shape-only'
      and (r2.stars > "agentdock"."repository"."stars"
           or (r2.stars = "agentdock"."repository"."stars" and p2.id < "agentdock"."package"."id"))
  ) then 'duplicate'
  else null
end, (
    select case
      when t.s is null or btrim(t.s) = '' then null
      when t.s !~ '[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002fa1f\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]' then
        case
          when t.s !~ '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]' then
            case when t.s ~ '[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]' then 'latin' else 'unknown' end
          when (length(t.s) - length(regexp_replace(t.s, '[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]+', '', 'g'))) >= (length(t.s) - length(regexp_replace(t.s, '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]+', '', 'g'))) then 'latin'
          else 'other'
        end
      else (
        select case
          when c.cjk * 10 < c.cjk + c.latin + c.other then
            case when c.latin >= c.other then 'latin' else 'other' end
          when t.s ~ '([A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f][A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f0-9''._/-]*[,;:!?"()]*\s+){5}[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]' then 'mixed'
          when c.hangul * 2 >= c.cjk then 'ko'
          when c.kana * 10 >= c.cjk then 'ja'
          when c.cjk < 4 then 'unknown'
          else 'zh'
        end
        from (
          select (length(t.s) - length(regexp_replace(t.s, '[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002fa1f\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]+', '', 'g'))) as cjk,
                 case when t.s ~ '[\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f]' then (length(t.s) - length(regexp_replace(t.s, '[\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f]+', '', 'g'))) else 0 end as kana,
                 case when t.s ~ '[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]' then (length(t.s) - length(regexp_replace(t.s, '[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]+', '', 'g'))) else 0 end as hangul,
                 (length(t.s) - length(regexp_replace(t.s, '[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]+', '', 'g'))) as latin,
                 case when t.s ~ '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]' then (length(t.s) - length(regexp_replace(t.s, '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]+', '', 'g'))) else 0 end as other
          offset 0
        ) c
      )
    end
    from (select "agentdock"."package"."summary"::text as s) t
  ) from "agentdock"."package" inner join "agentdock"."repository" on "agentdock"."package"."repository_id" = "agentdock"."repository"."id" where ("agentdock"."package"."delisted_at" is null and case
  when "agentdock"."repository"."is_fork" then 'fork'
  when (
    select v.parse_status from "agentdock"."package_version" v
    where v.package_id = "agentdock"."package"."id"
    order by v.ingested_at desc limit 1
  ) = 'failed' then 'unparsed'
  when "agentdock"."package"."meta"->>'detectionConfidence' is distinct from 'shape-only'
   and exists (
    select 1 from "agentdock"."package_version" v2
    join "agentdock"."package" p2 on p2.id = v2.package_id
    join "agentdock"."repository" r2 on r2.id = p2.repository_id
    where v2.content_hash = (
    select v.content_hash from "agentdock"."package_version" v
    where v.package_id = "agentdock"."package"."id"
    order by v.ingested_at desc limit 1
  )
      and v2.id = (
        select z.id from "agentdock"."package_version" z
        where z.package_id = p2.id order by z.ingested_at desc limit 1
      )
      and p2.id <> "agentdock"."package"."id"
      and p2.delisted_at is null
      and r2.is_fork = false
      and v2.parse_status <> 'failed'
      and p2.meta->>'detectionConfidence' is distinct from 'shape-only'
      and (r2.stars > "agentdock"."repository"."stars"
           or (r2.stars = "agentdock"."repository"."stars" and p2.id < "agentdock"."package"."id"))
  ) then 'duplicate'
  else null
end is null and ("agentdock"."package"."summary" is null
    or "agentdock"."package"."summary" !~ '[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002fa1f\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]'
    or coalesce((
    select case
      when t.s is null or btrim(t.s) = '' then null
      when t.s !~ '[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002fa1f\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]' then
        case
          when t.s !~ '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]' then
            case when t.s ~ '[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]' then 'latin' else 'unknown' end
          when (length(t.s) - length(regexp_replace(t.s, '[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]+', '', 'g'))) >= (length(t.s) - length(regexp_replace(t.s, '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]+', '', 'g'))) then 'latin'
          else 'other'
        end
      else (
        select case
          when c.cjk * 10 < c.cjk + c.latin + c.other then
            case when c.latin >= c.other then 'latin' else 'other' end
          when t.s ~ '([A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f][A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f0-9''._/-]*[,;:!?"()]*\s+){5}[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]' then 'mixed'
          when c.hangul * 2 >= c.cjk then 'ko'
          when c.kana * 10 >= c.cjk then 'ja'
          when c.cjk < 4 then 'unknown'
          else 'zh'
        end
        from (
          select (length(t.s) - length(regexp_replace(t.s, '[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002fa1f\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]+', '', 'g'))) as cjk,
                 case when t.s ~ '[\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f]' then (length(t.s) - length(regexp_replace(t.s, '[\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f]+', '', 'g'))) else 0 end as kana,
                 case when t.s ~ '[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]' then (length(t.s) - length(regexp_replace(t.s, '[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]+', '', 'g'))) else 0 end as hangul,
                 (length(t.s) - length(regexp_replace(t.s, '[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]+', '', 'g'))) as latin,
                 case when t.s ~ '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]' then (length(t.s) - length(regexp_replace(t.s, '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]+', '', 'g'))) else 0 end as other
          offset 0
        ) c
      )
    end
    from (select "agentdock"."package"."summary"::text as s) t
  ), '') not in ('zh'))) order by "agentdock"."package"."updated_at" desc limit 10;
explain (analyze, buffers) select "agentdock"."package"."id", "agentdock"."package"."name", "agentdock"."package"."summary", "agentdock"."package"."type", "agentdock"."repository"."full_name", "agentdock"."repository"."stars", (select pv.commit_sha from "agentdock"."package_version" pv where pv.package_id = "agentdock"."package"."id" order by pv.ingested_at desc limit 1), case
  when "agentdock"."repository"."is_fork" then 'fork'
  when (
    select v.parse_status from "agentdock"."package_version" v
    where v.package_id = "agentdock"."package"."id"
    order by v.ingested_at desc limit 1
  ) = 'failed' then 'unparsed'
  when "agentdock"."package"."meta"->>'detectionConfidence' is distinct from 'shape-only'
   and exists (
    select 1 from "agentdock"."package_version" v2
    join "agentdock"."package" p2 on p2.id = v2.package_id
    join "agentdock"."repository" r2 on r2.id = p2.repository_id
    where v2.content_hash = (
    select v.content_hash from "agentdock"."package_version" v
    where v.package_id = "agentdock"."package"."id"
    order by v.ingested_at desc limit 1
  )
      and v2.id = (
        select z.id from "agentdock"."package_version" z
        where z.package_id = p2.id order by z.ingested_at desc limit 1
      )
      and p2.id <> "agentdock"."package"."id"
      and p2.delisted_at is null
      and r2.is_fork = false
      and v2.parse_status <> 'failed'
      and p2.meta->>'detectionConfidence' is distinct from 'shape-only'
      and (r2.stars > "agentdock"."repository"."stars"
           or (r2.stars = "agentdock"."repository"."stars" and p2.id < "agentdock"."package"."id"))
  ) then 'duplicate'
  else null
end, (
    select case
      when t.s is null or btrim(t.s) = '' then null
      when t.s !~ '[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002fa1f\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]' then
        case
          when t.s !~ '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]' then
            case when t.s ~ '[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]' then 'latin' else 'unknown' end
          when (length(t.s) - length(regexp_replace(t.s, '[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]+', '', 'g'))) >= (length(t.s) - length(regexp_replace(t.s, '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]+', '', 'g'))) then 'latin'
          else 'other'
        end
      else (
        select case
          when c.cjk * 10 < c.cjk + c.latin + c.other then
            case when c.latin >= c.other then 'latin' else 'other' end
          when t.s ~ '([A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f][A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f0-9''._/-]*[,;:!?"()]*\s+){5}[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]' then 'mixed'
          when c.hangul * 2 >= c.cjk then 'ko'
          when c.kana * 10 >= c.cjk then 'ja'
          when c.cjk < 4 then 'unknown'
          else 'zh'
        end
        from (
          select (length(t.s) - length(regexp_replace(t.s, '[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002fa1f\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]+', '', 'g'))) as cjk,
                 case when t.s ~ '[\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f]' then (length(t.s) - length(regexp_replace(t.s, '[\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f]+', '', 'g'))) else 0 end as kana,
                 case when t.s ~ '[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]' then (length(t.s) - length(regexp_replace(t.s, '[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]+', '', 'g'))) else 0 end as hangul,
                 (length(t.s) - length(regexp_replace(t.s, '[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]+', '', 'g'))) as latin,
                 case when t.s ~ '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]' then (length(t.s) - length(regexp_replace(t.s, '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]+', '', 'g'))) else 0 end as other
          offset 0
        ) c
      )
    end
    from (select "agentdock"."package"."summary"::text as s) t
  ) from "agentdock"."package" inner join "agentdock"."repository" on "agentdock"."package"."repository_id" = "agentdock"."repository"."id" where ("agentdock"."package"."delisted_at" is null and case
  when "agentdock"."repository"."is_fork" then 'fork'
  when (
    select v.parse_status from "agentdock"."package_version" v
    where v.package_id = "agentdock"."package"."id"
    order by v.ingested_at desc limit 1
  ) = 'failed' then 'unparsed'
  when "agentdock"."package"."meta"->>'detectionConfidence' is distinct from 'shape-only'
   and exists (
    select 1 from "agentdock"."package_version" v2
    join "agentdock"."package" p2 on p2.id = v2.package_id
    join "agentdock"."repository" r2 on r2.id = p2.repository_id
    where v2.content_hash = (
    select v.content_hash from "agentdock"."package_version" v
    where v.package_id = "agentdock"."package"."id"
    order by v.ingested_at desc limit 1
  )
      and v2.id = (
        select z.id from "agentdock"."package_version" z
        where z.package_id = p2.id order by z.ingested_at desc limit 1
      )
      and p2.id <> "agentdock"."package"."id"
      and p2.delisted_at is null
      and r2.is_fork = false
      and v2.parse_status <> 'failed'
      and p2.meta->>'detectionConfidence' is distinct from 'shape-only'
      and (r2.stars > "agentdock"."repository"."stars"
           or (r2.stars = "agentdock"."repository"."stars" and p2.id < "agentdock"."package"."id"))
  ) then 'duplicate'
  else null
end is null and ("agentdock"."package"."summary" is null
    or "agentdock"."package"."summary" !~ '[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002fa1f\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]'
    or coalesce((
    select case
      when t.s is null or btrim(t.s) = '' then null
      when t.s !~ '[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002fa1f\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]' then
        case
          when t.s !~ '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]' then
            case when t.s ~ '[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]' then 'latin' else 'unknown' end
          when (length(t.s) - length(regexp_replace(t.s, '[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]+', '', 'g'))) >= (length(t.s) - length(regexp_replace(t.s, '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]+', '', 'g'))) then 'latin'
          else 'other'
        end
      else (
        select case
          when c.cjk * 10 < c.cjk + c.latin + c.other then
            case when c.latin >= c.other then 'latin' else 'other' end
          when t.s ~ '([A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f][A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f0-9''._/-]*[,;:!?"()]*\s+){5}[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]' then 'mixed'
          when c.hangul * 2 >= c.cjk then 'ko'
          when c.kana * 10 >= c.cjk then 'ja'
          when c.cjk < 4 then 'unknown'
          else 'zh'
        end
        from (
          select (length(t.s) - length(regexp_replace(t.s, '[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002fa1f\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]+', '', 'g'))) as cjk,
                 case when t.s ~ '[\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f]' then (length(t.s) - length(regexp_replace(t.s, '[\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f]+', '', 'g'))) else 0 end as kana,
                 case when t.s ~ '[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]' then (length(t.s) - length(regexp_replace(t.s, '[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]+', '', 'g'))) else 0 end as hangul,
                 (length(t.s) - length(regexp_replace(t.s, '[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]+', '', 'g'))) as latin,
                 case when t.s ~ '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]' then (length(t.s) - length(regexp_replace(t.s, '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]+', '', 'g'))) else 0 end as other
          offset 0
        ) c
      )
    end
    from (select "agentdock"."package"."summary"::text as s) t
  ), '') not in ('zh'))) order by "agentdock"."package"."updated_at" desc limit 10;
\echo == V6_language_column_stored
alter table agentdock.package add column lang_syn text;
update agentdock.package p set lang_syn = sub.l from (select id, (
    select case
      when t.s is null or btrim(t.s) = '' then null
      when t.s !~ '[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002fa1f\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]' then
        case
          when t.s !~ '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]' then
            case when t.s ~ '[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]' then 'latin' else 'unknown' end
          when (length(t.s) - length(regexp_replace(t.s, '[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]+', '', 'g'))) >= (length(t.s) - length(regexp_replace(t.s, '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]+', '', 'g'))) then 'latin'
          else 'other'
        end
      else (
        select case
          when c.cjk * 10 < c.cjk + c.latin + c.other then
            case when c.latin >= c.other then 'latin' else 'other' end
          when t.s ~ '([A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f][A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f0-9''._/-]*[,;:!?"()]*\s+){5}[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]' then 'mixed'
          when c.hangul * 2 >= c.cjk then 'ko'
          when c.kana * 10 >= c.cjk then 'ja'
          when c.cjk < 4 then 'unknown'
          else 'zh'
        end
        from (
          select (length(t.s) - length(regexp_replace(t.s, '[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002fa1f\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]+', '', 'g'))) as cjk,
                 case when t.s ~ '[\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f]' then (length(t.s) - length(regexp_replace(t.s, '[\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f]+', '', 'g'))) else 0 end as kana,
                 case when t.s ~ '[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]' then (length(t.s) - length(regexp_replace(t.s, '[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]+', '', 'g'))) else 0 end as hangul,
                 (length(t.s) - length(regexp_replace(t.s, '[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]+', '', 'g'))) as latin,
                 case when t.s ~ '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]' then (length(t.s) - length(regexp_replace(t.s, '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]+', '', 'g'))) else 0 end as other
          offset 0
        ) c
      )
    end
    from (select "agentdock"."summary"::text as s) t
  ) l from agentdock.package) sub where sub.id=p.id;
analyze agentdock.package;
explain (analyze, buffers) select "agentdock"."package"."type", count(*) filter (where lang_syn is distinct from 'zh'), count(*)::int from "agentdock"."package" inner join "agentdock"."repository" on "agentdock"."package"."repository_id" = "agentdock"."repository"."id" where ("agentdock"."package"."delisted_at" is null and case
  when "agentdock"."repository"."is_fork" then 'fork'
  when (
    select v.parse_status from "agentdock"."package_version" v
    where v.package_id = "agentdock"."package"."id"
    order by v.ingested_at desc limit 1
  ) = 'failed' then 'unparsed'
  when "agentdock"."package"."meta"->>'detectionConfidence' is distinct from 'shape-only'
   and exists (
    select 1 from "agentdock"."package_version" v2
    join "agentdock"."package" p2 on p2.id = v2.package_id
    join "agentdock"."repository" r2 on r2.id = p2.repository_id
    where v2.content_hash = (
    select v.content_hash from "agentdock"."package_version" v
    where v.package_id = "agentdock"."package"."id"
    order by v.ingested_at desc limit 1
  )
      and v2.id = (
        select z.id from "agentdock"."package_version" z
        where z.package_id = p2.id order by z.ingested_at desc limit 1
      )
      and p2.id <> "agentdock"."package"."id"
      and p2.delisted_at is null
      and r2.is_fork = false
      and v2.parse_status <> 'failed'
      and p2.meta->>'detectionConfidence' is distinct from 'shape-only'
      and (r2.stars > "agentdock"."repository"."stars"
           or (r2.stars = "agentdock"."repository"."stars" and p2.id < "agentdock"."package"."id"))
  ) then 'duplicate'
  else null
end is null) group by "agentdock"."package"."type";
explain (analyze, buffers) select "agentdock"."package"."type", count(*) filter (where lang_syn is distinct from 'zh'), count(*)::int from "agentdock"."package" inner join "agentdock"."repository" on "agentdock"."package"."repository_id" = "agentdock"."repository"."id" where ("agentdock"."package"."delisted_at" is null and case
  when "agentdock"."repository"."is_fork" then 'fork'
  when (
    select v.parse_status from "agentdock"."package_version" v
    where v.package_id = "agentdock"."package"."id"
    order by v.ingested_at desc limit 1
  ) = 'failed' then 'unparsed'
  when "agentdock"."package"."meta"->>'detectionConfidence' is distinct from 'shape-only'
   and exists (
    select 1 from "agentdock"."package_version" v2
    join "agentdock"."package" p2 on p2.id = v2.package_id
    join "agentdock"."repository" r2 on r2.id = p2.repository_id
    where v2.content_hash = (
    select v.content_hash from "agentdock"."package_version" v
    where v.package_id = "agentdock"."package"."id"
    order by v.ingested_at desc limit 1
  )
      and v2.id = (
        select z.id from "agentdock"."package_version" z
        where z.package_id = p2.id order by z.ingested_at desc limit 1
      )
      and p2.id <> "agentdock"."package"."id"
      and p2.delisted_at is null
      and r2.is_fork = false
      and v2.parse_status <> 'failed'
      and p2.meta->>'detectionConfidence' is distinct from 'shape-only'
      and (r2.stars > "agentdock"."repository"."stars"
           or (r2.stars = "agentdock"."repository"."stars" and p2.id < "agentdock"."package"."id"))
  ) then 'duplicate'
  else null
end is null) group by "agentdock"."package"."type";
explain (analyze, buffers) select "agentdock"."package"."type", count(*) filter (where lang_syn is distinct from 'zh'), count(*)::int from "agentdock"."package" inner join "agentdock"."repository" on "agentdock"."package"."repository_id" = "agentdock"."repository"."id" where ("agentdock"."package"."delisted_at" is null and case
  when "agentdock"."repository"."is_fork" then 'fork'
  when (
    select v.parse_status from "agentdock"."package_version" v
    where v.package_id = "agentdock"."package"."id"
    order by v.ingested_at desc limit 1
  ) = 'failed' then 'unparsed'
  when "agentdock"."package"."meta"->>'detectionConfidence' is distinct from 'shape-only'
   and exists (
    select 1 from "agentdock"."package_version" v2
    join "agentdock"."package" p2 on p2.id = v2.package_id
    join "agentdock"."repository" r2 on r2.id = p2.repository_id
    where v2.content_hash = (
    select v.content_hash from "agentdock"."package_version" v
    where v.package_id = "agentdock"."package"."id"
    order by v.ingested_at desc limit 1
  )
      and v2.id = (
        select z.id from "agentdock"."package_version" z
        where z.package_id = p2.id order by z.ingested_at desc limit 1
      )
      and p2.id <> "agentdock"."package"."id"
      and p2.delisted_at is null
      and r2.is_fork = false
      and v2.parse_status <> 'failed'
      and p2.meta->>'detectionConfidence' is distinct from 'shape-only'
      and (r2.stars > "agentdock"."repository"."stars"
           or (r2.stars = "agentdock"."repository"."stars" and p2.id < "agentdock"."package"."id"))
  ) then 'duplicate'
  else null
end is null) group by "agentdock"."package"."type";
\echo == V7_listPackages_with_partial_updated_at_index
create index syn_upd on agentdock.package (updated_at desc) where delisted_at is null;
analyze agentdock.package;
explain (analyze, buffers) select "agentdock"."package"."id", "agentdock"."package"."name", "agentdock"."package"."summary", "agentdock"."package"."type", "agentdock"."repository"."full_name", "agentdock"."repository"."stars", (select pv.commit_sha from "agentdock"."package_version" pv where pv.package_id = "agentdock"."package"."id" order by pv.ingested_at desc limit 1), case
  when "agentdock"."repository"."is_fork" then 'fork'
  when (
    select v.parse_status from "agentdock"."package_version" v
    where v.package_id = "agentdock"."package"."id"
    order by v.ingested_at desc limit 1
  ) = 'failed' then 'unparsed'
  when "agentdock"."package"."meta"->>'detectionConfidence' is distinct from 'shape-only'
   and exists (
    select 1 from "agentdock"."package_version" v2
    join "agentdock"."package" p2 on p2.id = v2.package_id
    join "agentdock"."repository" r2 on r2.id = p2.repository_id
    where v2.content_hash = (
    select v.content_hash from "agentdock"."package_version" v
    where v.package_id = "agentdock"."package"."id"
    order by v.ingested_at desc limit 1
  )
      and v2.id = (
        select z.id from "agentdock"."package_version" z
        where z.package_id = p2.id order by z.ingested_at desc limit 1
      )
      and p2.id <> "agentdock"."package"."id"
      and p2.delisted_at is null
      and r2.is_fork = false
      and v2.parse_status <> 'failed'
      and p2.meta->>'detectionConfidence' is distinct from 'shape-only'
      and (r2.stars > "agentdock"."repository"."stars"
           or (r2.stars = "agentdock"."repository"."stars" and p2.id < "agentdock"."package"."id"))
  ) then 'duplicate'
  else null
end, (
    select case
      when t.s is null or btrim(t.s) = '' then null
      when t.s !~ '[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002fa1f\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]' then
        case
          when t.s !~ '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]' then
            case when t.s ~ '[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]' then 'latin' else 'unknown' end
          when (length(t.s) - length(regexp_replace(t.s, '[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]+', '', 'g'))) >= (length(t.s) - length(regexp_replace(t.s, '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]+', '', 'g'))) then 'latin'
          else 'other'
        end
      else (
        select case
          when c.cjk * 10 < c.cjk + c.latin + c.other then
            case when c.latin >= c.other then 'latin' else 'other' end
          when t.s ~ '([A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f][A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f0-9''._/-]*[,;:!?"()]*\s+){5}[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]' then 'mixed'
          when c.hangul * 2 >= c.cjk then 'ko'
          when c.kana * 10 >= c.cjk then 'ja'
          when c.cjk < 4 then 'unknown'
          else 'zh'
        end
        from (
          select (length(t.s) - length(regexp_replace(t.s, '[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002fa1f\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]+', '', 'g'))) as cjk,
                 case when t.s ~ '[\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f]' then (length(t.s) - length(regexp_replace(t.s, '[\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f]+', '', 'g'))) else 0 end as kana,
                 case when t.s ~ '[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]' then (length(t.s) - length(regexp_replace(t.s, '[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]+', '', 'g'))) else 0 end as hangul,
                 (length(t.s) - length(regexp_replace(t.s, '[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]+', '', 'g'))) as latin,
                 case when t.s ~ '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]' then (length(t.s) - length(regexp_replace(t.s, '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]+', '', 'g'))) else 0 end as other
          offset 0
        ) c
      )
    end
    from (select "agentdock"."package"."summary"::text as s) t
  ) from "agentdock"."package" inner join "agentdock"."repository" on "agentdock"."package"."repository_id" = "agentdock"."repository"."id" where ("agentdock"."package"."delisted_at" is null and case
  when "agentdock"."repository"."is_fork" then 'fork'
  when (
    select v.parse_status from "agentdock"."package_version" v
    where v.package_id = "agentdock"."package"."id"
    order by v.ingested_at desc limit 1
  ) = 'failed' then 'unparsed'
  when "agentdock"."package"."meta"->>'detectionConfidence' is distinct from 'shape-only'
   and exists (
    select 1 from "agentdock"."package_version" v2
    join "agentdock"."package" p2 on p2.id = v2.package_id
    join "agentdock"."repository" r2 on r2.id = p2.repository_id
    where v2.content_hash = (
    select v.content_hash from "agentdock"."package_version" v
    where v.package_id = "agentdock"."package"."id"
    order by v.ingested_at desc limit 1
  )
      and v2.id = (
        select z.id from "agentdock"."package_version" z
        where z.package_id = p2.id order by z.ingested_at desc limit 1
      )
      and p2.id <> "agentdock"."package"."id"
      and p2.delisted_at is null
      and r2.is_fork = false
      and v2.parse_status <> 'failed'
      and p2.meta->>'detectionConfidence' is distinct from 'shape-only'
      and (r2.stars > "agentdock"."repository"."stars"
           or (r2.stars = "agentdock"."repository"."stars" and p2.id < "agentdock"."package"."id"))
  ) then 'duplicate'
  else null
end is null and ("agentdock"."package"."summary" is null
    or "agentdock"."package"."summary" !~ '[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002fa1f\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]'
    or coalesce((
    select case
      when t.s is null or btrim(t.s) = '' then null
      when t.s !~ '[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002fa1f\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]' then
        case
          when t.s !~ '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]' then
            case when t.s ~ '[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]' then 'latin' else 'unknown' end
          when (length(t.s) - length(regexp_replace(t.s, '[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]+', '', 'g'))) >= (length(t.s) - length(regexp_replace(t.s, '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]+', '', 'g'))) then 'latin'
          else 'other'
        end
      else (
        select case
          when c.cjk * 10 < c.cjk + c.latin + c.other then
            case when c.latin >= c.other then 'latin' else 'other' end
          when t.s ~ '([A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f][A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f0-9''._/-]*[,;:!?"()]*\s+){5}[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]' then 'mixed'
          when c.hangul * 2 >= c.cjk then 'ko'
          when c.kana * 10 >= c.cjk then 'ja'
          when c.cjk < 4 then 'unknown'
          else 'zh'
        end
        from (
          select (length(t.s) - length(regexp_replace(t.s, '[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002fa1f\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]+', '', 'g'))) as cjk,
                 case when t.s ~ '[\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f]' then (length(t.s) - length(regexp_replace(t.s, '[\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f]+', '', 'g'))) else 0 end as kana,
                 case when t.s ~ '[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]' then (length(t.s) - length(regexp_replace(t.s, '[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]+', '', 'g'))) else 0 end as hangul,
                 (length(t.s) - length(regexp_replace(t.s, '[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]+', '', 'g'))) as latin,
                 case when t.s ~ '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]' then (length(t.s) - length(regexp_replace(t.s, '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]+', '', 'g'))) else 0 end as other
          offset 0
        ) c
      )
    end
    from (select "agentdock"."package"."summary"::text as s) t
  ), '') not in ('zh'))) order by "agentdock"."package"."updated_at" desc limit 10;
explain (analyze, buffers) select "agentdock"."package"."id", "agentdock"."package"."name", "agentdock"."package"."summary", "agentdock"."package"."type", "agentdock"."repository"."full_name", "agentdock"."repository"."stars", (select pv.commit_sha from "agentdock"."package_version" pv where pv.package_id = "agentdock"."package"."id" order by pv.ingested_at desc limit 1), case
  when "agentdock"."repository"."is_fork" then 'fork'
  when (
    select v.parse_status from "agentdock"."package_version" v
    where v.package_id = "agentdock"."package"."id"
    order by v.ingested_at desc limit 1
  ) = 'failed' then 'unparsed'
  when "agentdock"."package"."meta"->>'detectionConfidence' is distinct from 'shape-only'
   and exists (
    select 1 from "agentdock"."package_version" v2
    join "agentdock"."package" p2 on p2.id = v2.package_id
    join "agentdock"."repository" r2 on r2.id = p2.repository_id
    where v2.content_hash = (
    select v.content_hash from "agentdock"."package_version" v
    where v.package_id = "agentdock"."package"."id"
    order by v.ingested_at desc limit 1
  )
      and v2.id = (
        select z.id from "agentdock"."package_version" z
        where z.package_id = p2.id order by z.ingested_at desc limit 1
      )
      and p2.id <> "agentdock"."package"."id"
      and p2.delisted_at is null
      and r2.is_fork = false
      and v2.parse_status <> 'failed'
      and p2.meta->>'detectionConfidence' is distinct from 'shape-only'
      and (r2.stars > "agentdock"."repository"."stars"
           or (r2.stars = "agentdock"."repository"."stars" and p2.id < "agentdock"."package"."id"))
  ) then 'duplicate'
  else null
end, (
    select case
      when t.s is null or btrim(t.s) = '' then null
      when t.s !~ '[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002fa1f\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]' then
        case
          when t.s !~ '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]' then
            case when t.s ~ '[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]' then 'latin' else 'unknown' end
          when (length(t.s) - length(regexp_replace(t.s, '[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]+', '', 'g'))) >= (length(t.s) - length(regexp_replace(t.s, '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]+', '', 'g'))) then 'latin'
          else 'other'
        end
      else (
        select case
          when c.cjk * 10 < c.cjk + c.latin + c.other then
            case when c.latin >= c.other then 'latin' else 'other' end
          when t.s ~ '([A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f][A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f0-9''._/-]*[,;:!?"()]*\s+){5}[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]' then 'mixed'
          when c.hangul * 2 >= c.cjk then 'ko'
          when c.kana * 10 >= c.cjk then 'ja'
          when c.cjk < 4 then 'unknown'
          else 'zh'
        end
        from (
          select (length(t.s) - length(regexp_replace(t.s, '[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002fa1f\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]+', '', 'g'))) as cjk,
                 case when t.s ~ '[\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f]' then (length(t.s) - length(regexp_replace(t.s, '[\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f]+', '', 'g'))) else 0 end as kana,
                 case when t.s ~ '[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]' then (length(t.s) - length(regexp_replace(t.s, '[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]+', '', 'g'))) else 0 end as hangul,
                 (length(t.s) - length(regexp_replace(t.s, '[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]+', '', 'g'))) as latin,
                 case when t.s ~ '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]' then (length(t.s) - length(regexp_replace(t.s, '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]+', '', 'g'))) else 0 end as other
          offset 0
        ) c
      )
    end
    from (select "agentdock"."package"."summary"::text as s) t
  ) from "agentdock"."package" inner join "agentdock"."repository" on "agentdock"."package"."repository_id" = "agentdock"."repository"."id" where ("agentdock"."package"."delisted_at" is null and case
  when "agentdock"."repository"."is_fork" then 'fork'
  when (
    select v.parse_status from "agentdock"."package_version" v
    where v.package_id = "agentdock"."package"."id"
    order by v.ingested_at desc limit 1
  ) = 'failed' then 'unparsed'
  when "agentdock"."package"."meta"->>'detectionConfidence' is distinct from 'shape-only'
   and exists (
    select 1 from "agentdock"."package_version" v2
    join "agentdock"."package" p2 on p2.id = v2.package_id
    join "agentdock"."repository" r2 on r2.id = p2.repository_id
    where v2.content_hash = (
    select v.content_hash from "agentdock"."package_version" v
    where v.package_id = "agentdock"."package"."id"
    order by v.ingested_at desc limit 1
  )
      and v2.id = (
        select z.id from "agentdock"."package_version" z
        where z.package_id = p2.id order by z.ingested_at desc limit 1
      )
      and p2.id <> "agentdock"."package"."id"
      and p2.delisted_at is null
      and r2.is_fork = false
      and v2.parse_status <> 'failed'
      and p2.meta->>'detectionConfidence' is distinct from 'shape-only'
      and (r2.stars > "agentdock"."repository"."stars"
           or (r2.stars = "agentdock"."repository"."stars" and p2.id < "agentdock"."package"."id"))
  ) then 'duplicate'
  else null
end is null and ("agentdock"."package"."summary" is null
    or "agentdock"."package"."summary" !~ '[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002fa1f\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]'
    or coalesce((
    select case
      when t.s is null or btrim(t.s) = '' then null
      when t.s !~ '[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002fa1f\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]' then
        case
          when t.s !~ '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]' then
            case when t.s ~ '[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]' then 'latin' else 'unknown' end
          when (length(t.s) - length(regexp_replace(t.s, '[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]+', '', 'g'))) >= (length(t.s) - length(regexp_replace(t.s, '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]+', '', 'g'))) then 'latin'
          else 'other'
        end
      else (
        select case
          when c.cjk * 10 < c.cjk + c.latin + c.other then
            case when c.latin >= c.other then 'latin' else 'other' end
          when t.s ~ '([A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f][A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f0-9''._/-]*[,;:!?"()]*\s+){5}[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]' then 'mixed'
          when c.hangul * 2 >= c.cjk then 'ko'
          when c.kana * 10 >= c.cjk then 'ja'
          when c.cjk < 4 then 'unknown'
          else 'zh'
        end
        from (
          select (length(t.s) - length(regexp_replace(t.s, '[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002fa1f\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]+', '', 'g'))) as cjk,
                 case when t.s ~ '[\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f]' then (length(t.s) - length(regexp_replace(t.s, '[\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f]+', '', 'g'))) else 0 end as kana,
                 case when t.s ~ '[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]' then (length(t.s) - length(regexp_replace(t.s, '[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]+', '', 'g'))) else 0 end as hangul,
                 (length(t.s) - length(regexp_replace(t.s, '[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]+', '', 'g'))) as latin,
                 case when t.s ~ '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]' then (length(t.s) - length(regexp_replace(t.s, '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]+', '', 'g'))) else 0 end as other
          offset 0
        ) c
      )
    end
    from (select "agentdock"."package"."summary"::text as s) t
  ), '') not in ('zh'))) order by "agentdock"."package"."updated_at" desc limit 10;
explain (analyze, buffers) select "agentdock"."package"."id", "agentdock"."package"."name", "agentdock"."package"."summary", "agentdock"."package"."type", "agentdock"."repository"."full_name", "agentdock"."repository"."stars", (select pv.commit_sha from "agentdock"."package_version" pv where pv.package_id = "agentdock"."package"."id" order by pv.ingested_at desc limit 1), case
  when "agentdock"."repository"."is_fork" then 'fork'
  when (
    select v.parse_status from "agentdock"."package_version" v
    where v.package_id = "agentdock"."package"."id"
    order by v.ingested_at desc limit 1
  ) = 'failed' then 'unparsed'
  when "agentdock"."package"."meta"->>'detectionConfidence' is distinct from 'shape-only'
   and exists (
    select 1 from "agentdock"."package_version" v2
    join "agentdock"."package" p2 on p2.id = v2.package_id
    join "agentdock"."repository" r2 on r2.id = p2.repository_id
    where v2.content_hash = (
    select v.content_hash from "agentdock"."package_version" v
    where v.package_id = "agentdock"."package"."id"
    order by v.ingested_at desc limit 1
  )
      and v2.id = (
        select z.id from "agentdock"."package_version" z
        where z.package_id = p2.id order by z.ingested_at desc limit 1
      )
      and p2.id <> "agentdock"."package"."id"
      and p2.delisted_at is null
      and r2.is_fork = false
      and v2.parse_status <> 'failed'
      and p2.meta->>'detectionConfidence' is distinct from 'shape-only'
      and (r2.stars > "agentdock"."repository"."stars"
           or (r2.stars = "agentdock"."repository"."stars" and p2.id < "agentdock"."package"."id"))
  ) then 'duplicate'
  else null
end, (
    select case
      when t.s is null or btrim(t.s) = '' then null
      when t.s !~ '[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002fa1f\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]' then
        case
          when t.s !~ '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]' then
            case when t.s ~ '[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]' then 'latin' else 'unknown' end
          when (length(t.s) - length(regexp_replace(t.s, '[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]+', '', 'g'))) >= (length(t.s) - length(regexp_replace(t.s, '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]+', '', 'g'))) then 'latin'
          else 'other'
        end
      else (
        select case
          when c.cjk * 10 < c.cjk + c.latin + c.other then
            case when c.latin >= c.other then 'latin' else 'other' end
          when t.s ~ '([A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f][A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f0-9''._/-]*[,;:!?"()]*\s+){5}[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]' then 'mixed'
          when c.hangul * 2 >= c.cjk then 'ko'
          when c.kana * 10 >= c.cjk then 'ja'
          when c.cjk < 4 then 'unknown'
          else 'zh'
        end
        from (
          select (length(t.s) - length(regexp_replace(t.s, '[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002fa1f\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]+', '', 'g'))) as cjk,
                 case when t.s ~ '[\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f]' then (length(t.s) - length(regexp_replace(t.s, '[\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f]+', '', 'g'))) else 0 end as kana,
                 case when t.s ~ '[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]' then (length(t.s) - length(regexp_replace(t.s, '[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]+', '', 'g'))) else 0 end as hangul,
                 (length(t.s) - length(regexp_replace(t.s, '[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]+', '', 'g'))) as latin,
                 case when t.s ~ '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]' then (length(t.s) - length(regexp_replace(t.s, '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]+', '', 'g'))) else 0 end as other
          offset 0
        ) c
      )
    end
    from (select "agentdock"."package"."summary"::text as s) t
  ) from "agentdock"."package" inner join "agentdock"."repository" on "agentdock"."package"."repository_id" = "agentdock"."repository"."id" where ("agentdock"."package"."delisted_at" is null and case
  when "agentdock"."repository"."is_fork" then 'fork'
  when (
    select v.parse_status from "agentdock"."package_version" v
    where v.package_id = "agentdock"."package"."id"
    order by v.ingested_at desc limit 1
  ) = 'failed' then 'unparsed'
  when "agentdock"."package"."meta"->>'detectionConfidence' is distinct from 'shape-only'
   and exists (
    select 1 from "agentdock"."package_version" v2
    join "agentdock"."package" p2 on p2.id = v2.package_id
    join "agentdock"."repository" r2 on r2.id = p2.repository_id
    where v2.content_hash = (
    select v.content_hash from "agentdock"."package_version" v
    where v.package_id = "agentdock"."package"."id"
    order by v.ingested_at desc limit 1
  )
      and v2.id = (
        select z.id from "agentdock"."package_version" z
        where z.package_id = p2.id order by z.ingested_at desc limit 1
      )
      and p2.id <> "agentdock"."package"."id"
      and p2.delisted_at is null
      and r2.is_fork = false
      and v2.parse_status <> 'failed'
      and p2.meta->>'detectionConfidence' is distinct from 'shape-only'
      and (r2.stars > "agentdock"."repository"."stars"
           or (r2.stars = "agentdock"."repository"."stars" and p2.id < "agentdock"."package"."id"))
  ) then 'duplicate'
  else null
end is null and ("agentdock"."package"."summary" is null
    or "agentdock"."package"."summary" !~ '[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002fa1f\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]'
    or coalesce((
    select case
      when t.s is null or btrim(t.s) = '' then null
      when t.s !~ '[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002fa1f\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]' then
        case
          when t.s !~ '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]' then
            case when t.s ~ '[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]' then 'latin' else 'unknown' end
          when (length(t.s) - length(regexp_replace(t.s, '[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]+', '', 'g'))) >= (length(t.s) - length(regexp_replace(t.s, '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]+', '', 'g'))) then 'latin'
          else 'other'
        end
      else (
        select case
          when c.cjk * 10 < c.cjk + c.latin + c.other then
            case when c.latin >= c.other then 'latin' else 'other' end
          when t.s ~ '([A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f][A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f0-9''._/-]*[,;:!?"()]*\s+){5}[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]' then 'mixed'
          when c.hangul * 2 >= c.cjk then 'ko'
          when c.kana * 10 >= c.cjk then 'ja'
          when c.cjk < 4 then 'unknown'
          else 'zh'
        end
        from (
          select (length(t.s) - length(regexp_replace(t.s, '[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002fa1f\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]+', '', 'g'))) as cjk,
                 case when t.s ~ '[\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f]' then (length(t.s) - length(regexp_replace(t.s, '[\u3040-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f]+', '', 'g'))) else 0 end as kana,
                 case when t.s ~ '[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]' then (length(t.s) - length(regexp_replace(t.s, '[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]+', '', 'g'))) else 0 end as hangul,
                 (length(t.s) - length(regexp_replace(t.s, '[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f]+', '', 'g'))) as latin,
                 case when t.s ~ '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]' then (length(t.s) - length(regexp_replace(t.s, '[\u0370-\u10ff\u1200-\u139f\u1780-\u17ff]+', '', 'g'))) else 0 end as other
          offset 0
        ) c
      )
    end
    from (select "agentdock"."package"."summary"::text as s) t
  ), '') not in ('zh'))) order by "agentdock"."package"."updated_at" desc limit 10;
ROLLBACK;
