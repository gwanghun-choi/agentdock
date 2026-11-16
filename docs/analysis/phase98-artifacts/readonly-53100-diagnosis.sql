-- Phase 98 — 2026-11-15 Sync 53100 진단. 읽기 전용, SELECT만.
-- 실행(로컬 터미널, 사람이 실행):
--   1) DATABASE_URL=<Neon direct URL, -pooler 아님> AGENTDOCK_TARGET_FINGERPRINT=<pin> bun run ops:preflight --production   # 모두 PASS 확인
--   2) PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=30000' \
--      psql "<같은 direct URL>" -X -v ON_ERROR_STOP=1 -f docs/analysis/phase98-artifacts/readonly-53100-diagnosis.sql
-- 이 파일은 쓰기·VACUUM·REINDEX를 하지 않는다.

begin read only;
show default_transaction_read_only;              -- on 이어야 함

-- Q1. DB 전체 크기 vs 한도 (Neon은 project logical size로 판정)
select pg_size_pretty(pg_database_size(current_database())) as db_size;
-- 이 값은 현재 database 하나의 크기다. Neon project 한도(모든 database·branch 합계)와 비교하려면 콘솔 Usage를 본다.
-- neon.pg_cluster_size()는 여기서 실행하지 않는다: 함수가 없으면 ON_ERROR_STOP=1이 스크립트를 멈춘다.

-- Q2. agentdock 스키마 테이블별 heap / TOAST / index
select c.relname,
       pg_size_pretty(pg_relation_size(c.oid))                       as heap,
       pg_size_pretty(coalesce(pg_total_relation_size(c.reltoastrelid),0)) as toast,
       pg_size_pretty(pg_indexes_size(c.oid))                        as indexes,
       pg_size_pretty(pg_total_relation_size(c.oid))                 as total,
       c.reltuples::bigint                                           as est_rows
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'agentdock' and c.relkind = 'r'
order by pg_total_relation_size(c.oid) desc;

-- Q3. 인덱스별 크기 (GIN trgm / tsvector 비중)
select indexrelname, pg_size_pretty(pg_relation_size(indexrelid)) as size, idx_scan
from pg_stat_user_indexes where schemaname = 'agentdock'
order by pg_relation_size(indexrelid) desc;

-- Q4. 다른 스키마가 같은 Neon project 용량을 쓰는지 (공유 DB invariant)
select n.nspname, pg_size_pretty(sum(pg_total_relation_size(c.oid))) as total
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r','m') group by n.nspname order by sum(pg_total_relation_size(c.oid)) desc;

-- Q5. dead tuple (plain VACUUM으로 재사용 가능한 공간의 단서)
select relname, n_live_tup, n_dead_tup, last_autovacuum
from pg_stat_user_tables where schemaname = 'agentdock' order by n_dead_tup desc;

-- Q6. 실패 job 상태: 9992·9993은 queued, attempts=1, attempt 행 1건 / 9994는 running, attempts=1, attempt 행 0건 예상
--     (11-15 22:13Z 이후 Sync가 돌았다면 달라진다)
select j.id, j.target, j.status, j.attempts, j.next_attempt_at, j.started_at,
       (select count(*) from agentdock.ingest_attempt a where a.job_id = j.id) as attempt_rows
from agentdock.ingest_job j where j.id between 9990 and 9999 order by j.id;

-- Q7. 큐 상태
select status, count(*) from agentdock.ingest_job group by status;

-- Q8. 성공 47건이 실제 저장됐는지: repository + 해당 commit의 package_version 존재
with ok(job_id, full_name, commit_sha) as (values (9940,'serhiikorniienko/bullshit-detector','d5f6156a8a5c72977bf2d4edae834dd22f7fa736'),(9941,'eli-labz/cognitive-core-skills','b1952dc07e97eff10bec7da27f60ddae61407a6b'),(9942,'snowbanksdk/foundationdb-dotnet-client','e8d2b6024a04246106b548c55f3d27dbd4de73ea'),(9943,'alpacahq/alpaca-skills','0e7c35163ae462730de1f4a0bfafceac82b7d59b'),(9944,'supercorp-ai/supercov','f977515e5401f784594d2aabedec71bf6c72120d'),(9945,'qinghonglin/data2story-skill','63a55c15f3fac13239263cfa1361fe2ef04d8df1'),(9946,'machina-exm/film-studio-skills','314517381b1be72c1404c068a9e37a064ec4215c'),(9947,'lovisdotio/motion2code','0f003288997604487df04c1b7a0586900d3e36bb'),(9948,'danyuchn/iso-24495-skill','113656b0a6a6cbeb3b3c2bb7cf3bc29349cb05cf'),(9950,'uzairansaruzi/p3-stack','09909ebb5c0125e27fad3e57d96b81e832696d69'),(9951,'agenticsworks/agentpeerchat','9edfadf1ba5ba4ed4268f453fefde9f9e49f11d6'),(9952,'thuroi0787/absent-author','190ab3316218b879d768ee5d4d9b8e020d36378b'),(9953,'jinzhezenggroup/computational-chemistry-agent-skills','8ab83a96292bb4d13ba7e4a2b015015f0332e8cc'),(9954,'skydashnet/material-design-3-ui-skill','82783f76de4a5b08a60421cae935cf8de7ca1ee8'),(9955,'ciao1019/petrichor','05c4c0dd9bceb08730b70556642044c7614c6bec'),(9956,'dceoy/speckit-agent-skills','2796458c18ca685aa592020bddb695c4c8954252'),(9957,'cometchat/cometchat-skills','1156a8e5fd6cad24c5875ddda73f7da57622d7b2'),(9958,'alisa0808/vibe-creating-skill','a599301980a66eb47ddac5c15e41081b74a2759d'),(9959,'unclecatvn/agent-skills','82ebbaed8988e9697687612575d437ca0eacec4e'),(9960,'aliyun/alibabacloud-ecs-troubleshoot-skills','788457cf09d15f3b997d232ab5fcf2309a68d3ba'),(9962,'gary149/h3-game-sprites','d1295576a3debe364d7d8a6023cfc7a9835e6522'),(9963,'kevmoo/dash_skills','9a07150e3aab55c1d213ecb809100e414dcbe3bc'),(9964,'gaoyuan-0423/biomedical-paper-reader','0f1bf69ff81a4feb675aa20886d4ec7e9809944d'),(9965,'raintree-technology/hig-doctor','a0f1e4ec3c5ada82e538710b54a344db63189d8b'),(9966,'ahpxex/open-dashboard','aa9815f426e9520841c4aa15a341bfd9f866091f'),(9967,'aaddrick/building-with-typesafe-jev','a46856c9fbc890653891e25f85ee2f16e1d9b513'),(9968,'dodo-reach/hermes-link-curator','5bd4d5a7584ae9b34e096fed3ee77c367ecbf225'),(9969,'narratorai-studio/narrator-ai-cli','2d8bb1463058fb36f267f205994dca38b32f037d'),(9970,'hermes-labs-ai/lintlang','5e5fefbce78337a3b38e5de9f7ecb403027e7d3f'),(9971,'gml-mmgroup/cliptalk','7471e7329453299cd4f30793fedfaf94cf3d9808'),(9972,'lucky-luor/bilibili-douyin-notes','59fadaae2eea040bfeb578c541e27782115cb1fb'),(9973,'tikalk/adlc-team-skills','273c0675e5c5a934b5f47a741c473c2ccd8e9b45'),(9974,'rengwu/wayfinder-maps','c252110ee01e36f4e17e4c9b0c6fc8cd1beb7aa0'),(9975,'magnus919/agent-skills','6e472b033750c23e3139fd83744e089a6ee66ad1'),(9976,'vinta/hal-9000','a74241cfba8d3cb0bf5843f52cb8b55938316529'),(9977,'aiko-it-systems/discatsharp','f61f95d647fce501eca19275d5879c8e01871b75'),(9978,'ltczding-gif/ref-downloader','1cc667351875410197acf4471e667ac272a0092e'),(9979,'wind-alice/alicemarket','ab8fa4cfc7904fa28d2a7297cd293d192eda3b5e'),(9980,'sequester-ag/bug-bounty-triage','9684e1bfc876e841f9c789f0b258902b43d461e4'),(9981,'itshen/source-reading-methodology','f45f57988f58d45a7eab9b5b736e3024f3c5efbb'),(9982,'yila-ai/awesome-research-skills','9457733ecf6dbef4cad8debf2e58cc3bbd378e79'),(9983,'karaage0703/ai-assistant-workspace','c689862f84b44b0a60dc13b7d13c4912f088ef50'),(9984,'k-telux/opticalmodeler','ffbdbff17176f69c28360be55bb0d4a84e5b536b'),(9986,'alint-dev/alint','337441c6225a3770e326ef3aeb01596e275798e9'),(9987,'lsaint/aikito','8630b80693218e96e2778be7f64c9e0b99b5db76'),(9988,'firecrawl/skills','1d4b0728d0f448cafef2eb8370c907fde7cb6f42'),(9990,'black-forest-labs/skills','8907d515b0ac270a988ec7a239add81ee13d6cba'))
select ok.job_id, ok.full_name,
       r.scanned_at is not null as repo_row,
       (select count(*) from agentdock.package p join agentdock.package_version v on v.package_id = p.id
         where p.repository_id = r.id and v.commit_sha = ok.commit_sha) as versions_at_commit,
       (select j.status from agentdock.ingest_job j where j.id = ok.job_id) as job_status
from ok left join agentdock.repository r on lower(r.full_name) = lower(ok.full_name)
order by ok.job_id;
-- 기대: 47행 모두 repo_row=t, versions_at_commit>0 (합계 910), job_status=succeeded

-- Q9. 증가 추세 (일별 신규 version 수)
select date_trunc('day', ingested_at) as day, count(*) from agentdock.package_version
where ingested_at > now() - interval '30 days' group by 1 order by 1;

rollback;
