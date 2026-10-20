# AgentDock Implementation Map

> 기준: `develop` @ `28639ec` (2026-10-20). 다음 작업을 시작하는 사람(또는 AI agent)이 전체 소스를 처음부터 다시 읽지 않고 수정에 들어갈 수 있도록 만든 지도다.
> 라인 번호는 이 커밋 기준이다. 수정 전에 반드시 다시 확인한다.
> 작업 규칙은 `AGENTS.md`(invariant)와 `CLAUDE.md`(workflow, ponytail ladder, 검증 순서)를 따른다.

## 목차

0. [공통: 검증 명령과 테스트 격리](#0-공통-검증-명령과-테스트-격리)
1. [Sync 오케스트레이션](#1-sync-오케스트레이션)
2. [Discovery 소스](#2-discovery-소스)
3. [Job Queue](#3-job-queue)
4. [Ingest 파이프라인과 영속화](#4-ingest-파이프라인과-영속화)
5. [GitHub Client](#5-github-client)
6. [Detector](#6-detector)
7. [Analyzer와 File Inventory](#7-analyzer와-file-inventory)
8. [검색](#8-검색)
9. [목록·상세 질의와 노출 규칙](#9-목록상세-질의와-노출-규칙)
10. [페이지와 컴포넌트](#10-페이지와-컴포넌트)
11. [스키마와 Migration](#11-스키마와-migration)
12. [CI·배포](#12-ci배포)
13. [로드맵 과제 → 진입점 빠른 색인](#13-로드맵-과제--진입점-빠른-색인)

---

## 0. 공통: 검증 명령과 테스트 격리

```bash
# 실행 위치: 저장소 루트
bun run check:boundaries
bun run lint            # 수정은 bun run format
bun run typecheck
bun run test
bun run build           # 마지막. next-env.d.ts 를 다시 생성
```

**테스트 격리 주의** (`vitest.config.ts:13`): `CI` 가 없으면 `.env` 를 자동으로 읽는다. `.env` 의 `DATABASE_URL` 이 운영 Neon 이면 DB suite 가 운영 인스턴스의 `agentdock_test` 스키마에 쓴다.

| 목적 | 명령 |
|---|---|
| DB 없이(CI 와 동일) | `env -u DATABASE_URL CI=1 bun run test` |
| DB 포함(격리된 로컬 DB) | `DATABASE_URL=<로컬 테스트 DB> bun run test` (먼저 `bun run db:test:setup`) |
| build(DB 없이) | `DATABASE_URL=postgresql://build:build@127.0.0.1:9/build bun run build` |

Baseline(2026-10-20, `CI=1`): test 822 passed / 272 skipped, lint·typecheck·boundaries PASS.

---

## 1. Sync 오케스트레이션

| 항목 | 내용 |
|---|---|
| 시작 파일 | `scripts/corpus-sync.mjs` |
| 호출 순서 | 인자 파싱(:38-94) → `runRegistry`(:213) → `runSeedList`(:252) → `runLinkLists`(:275) → `runTopicSearch`(:308) → scope 처리(:375) → `fanOutSeeds`(:385) → `refreshStaleRepositories`(:394-415) → `reapAbandoned`(:429) → drain 루프(:436-451, `pauseUntilFor` → `claimJob` → `runJob`) → `countPackages`(:469) → `summarize`(:143) → exit(:477-484) |
| 데이터 | `repo_seed`, `ingest_job`, `ingest_attempt`, `repository`, `schema_meta` |
| 페이지 영향 | 없음(별도 프로세스) |
| Migration | 대부분 불필요. `last_sync` 는 `schema_meta` 키로 충분 |
| 관련 테스트 | **없음**(오케스트레이터 무테스트). 구성 요소별 테스트만 있음 |
| 추가할 테스트 | 판단 로직을 순수 함수로 분리해 테스트: `shouldContinueDrain(rate, elapsedMs)`, 요약 산술, 종료 코드 판정 |
| Baseline | Actions 최근 run 로그의 `drained N job(s) of at most 25`, `INCOMPLETE` 라인, 소요 시간 |
| 변경 후 검증 | `workflow_dispatch` 수동 실행 1회 후 요약 비교(운영자 승인 필요) |
| 배포 영향 | 다음 예약 sync 부터 적용. 웹 재배포 불필요 |
| Rollback | 코드 revert. 상태는 DB 에만 있고 additive |
| 로드맵 | R7, R9, R11, R12 |

주의: `--scheduled` 의 기본값은 `CORPUS_CAPS` 에서 읽는다. package.json 에 숫자를 복제하지 않는다(:62-70 주석).

---

## 2. Discovery 소스

| 소스 | 시작 파일 / 함수 | 상태 저장 | 관련 테스트 | 수정 포인트 |
|---|---|---|---|---|
| MCP Registry | `src/registry/sync.ts` `syncRegistry`(:162) | `schema_meta corpus_sweep:mcp-registry` | `registry/sync.test.ts`(DB), `client.test.ts` | `too_large` 처리(:196-202), `www.github.com` 허용(`github/client.ts:121` `githubRepoFromUrl`) |
| Seed list | `src/corpus/seedList.ts` `loadSeedList`(:57), `seedListRows`(:94), `config/seeds.json` | 없음 | `seedList.test.ts` | 항목 추가는 JSON 만 수정 |
| Link lists | `src/corpus/links.ts` `expandLinkLists`(:125), `extractRepoLinks`(:66) | 없음 | `links.test.ts` | cap `caps.ts:57`, 목록 `config/seeds.json:339-350` |
| Topic search | `src/corpus/search.ts` `sweepTopics`(:67) → `src/github/search.ts` `shardLadder`(:88) `subdivide`(:121) `shardQuery`(:142) `walkShard`(:246) | **없음**(R8 에서 추가) | `corpus/search.test.ts`(단일 topic), `github/search.test.ts` | topic 루프(:96-97), seed cap(:133-136), topic 목록(`github/search.ts:47-53`) |
| Policy | `src/corpus/policy.ts` `discoveryRejection`(:56), `MIN_REPOSITORY_STARS`(:38) | — | `policy.test.ts`(import 허용 목록 assert) | **새 모듈이 이 상수를 import 하면 `policy.test.ts` 목록도 갱신해야 함.** search/packages 질의 모듈에서는 import 금지 |
| Caps | `src/corpus/caps.ts` `CORPUS_CAPS` | — | 간접 | 새 상한은 반드시 여기에(CLAUDE.md "Find the seam") |

**R8 변경 지도**: `sweepTopics` 에 topic 별 `maxSeeds`/`maxRequests` 할당 → topic 별 cursor 를 `readSweepState('github-topic-search')`/`writeSweepState`(`src/db/queries/syncState.ts:44, 67`)로 저장 → `corpus-sync.mjs:308-361` 출력에 topic 별 결과 추가. 추가 테스트: 2개 이상 topic 에서 모든 topic 에 요청이 가는지, 재실행 시 cursor 에서 재개하는지.

---

## 3. Job Queue

| 항목 | 내용 |
|---|---|
| 시작 파일 | `src/db/queries/jobs.ts` |
| 함수 | `enqueueJob`(:46) · `claimJob`(:100) · `reapAbandoned`(:127) · `finishJob`(:168) · `scheduleRetry`(:187) · `getJobView`(:222) · `latestJobForTarget`(:235) |
| 정책 | `src/ingest/retry.ts` `dispositionFor`(:56), `backoffMs`(:18), `rateLimitedUntil`(:73), `pauseUntilFor`(:95), `MAX_ATTEMPTS`(:5) |
| 실행 | `src/ingest/worker.ts` `runJob`(:36), `REAP_AFTER_MS`(:16) |
| 데이터 | `ingest_job`(partial unique active, claim/running idx), `ingest_attempt` |
| 관련 테스트 | `jobs.test.ts`(DB), `retry.test.ts`, `worker.test.ts`(DB) |
| 추가할 테스트 | reap 후 attempts ≥ MAX 이면 failed(I12), 환불 후 `attempt_no` 중복(I13) |
| 주의 | `MAX_QUEUED` 와 `claimJob` 은 스키마 전역 count 라 DB suite 를 병렬로 돌리지 않는다(`vitest.config.ts` 의 `fileParallelism`) |
| 새 outcome 추가 | `src/ingest/errors.ts`(메시지) + `retry.ts` disposition 표(total record — 빠뜨리면 typecheck 실패) |

---

## 4. Ingest 파이프라인과 영속화

| 항목 | 내용 |
|---|---|
| 시작 파일 | `src/ingest/pipeline.ts` `ingestRepository`(:98) |
| 호출 순서 | `normalizeRepo` → denylist(:161-169, try 밖) → `lastIngestedSha`(:176) → `fetchRepoScanInputs`(:210, `scan.ts:51`) → 게이트(:213-215) → `collectCandidates`/`orderedNeeds` → `assignParentPaths` → candidate 루프(:302-394: `safeParse` → blobSha → `fileInventory`(:321) → `runAnalysis`(:84-96)) → no_artifacts 분기(:397-408) → `persistScan`(:423, `persist.ts:53`) → catch(:454-460) |
| 영속화 | `persist.ts` `persistScan`(:53-347): repo upsert(:55-98) → snapshot(:104-111) → package upsert(:122-157) → version insert(:161-177) → findings(:186-224) → delist(:244-256) → seeds(:264-298) → attempt+job(:309-337). `touchRepository`(:383) |
| 데이터 | repository, package, package_version, capability_finding, repo_seed, ingest_attempt |
| 페이지 영향 | 목록·검색·상세 전체(데이터 변경) |
| 관련 테스트 | `pipeline.test.ts`(DB, 4개 corpus E2E), `persist.test.ts`(DB) |
| 재분석 | `reanalyze.ts` `analyzePackageVersion`(:40), `unanalyzedVersionIds`(:144), `scripts/analyze-backfill.mjs` |

**R1 변경 지도 (가장 먼저 할 과제)**

```text
pipeline.ts:397  if (packages.length === 0 && seeds.length === 0)
                 └─ known !== null && !tree.truncated && !artifactsTruncated
                    → persistScan({ ...metadata, packages: [], seeds: [], treeTruncated: false, ... }, job)
                       (persist.ts:244 delist 경로가 packageIds=[] 를 이미 처리: `sql\`true\``)
                    → 반환 outcome 은 'no_artifacts' 유지(요약 집계 호환) — persist 가 job 종료를 쓰므로
                       worker.ts 의 finishJob 이중 종료가 없는지 확인 (worker.ts:48 `result.ok` 분기)
catch(:454)      unreadable/too_large + known → (결정 후) checked_at 갱신
refresh.ts:74    정렬 키 → coalesce(checked_at, scanned_at) (B안)
```

추가할 테스트(먼저 실패 확인):

1. `pipeline.test.ts`: artifact 2개로 ingest → tree 에서 둘 다 제거 → 재ingest → 둘 다 `delisted_at` NOT NULL, `last_ingested_sha` 갱신.
2. 같은 상황에서 tree 가 truncated 면 delist 하지 않음(기존 보호 유지).
3. `refresh.test.ts`: unreadable 로 끝난 known 저장소가 다음 refresh 의 첫 대상이 아님(B안).

**R5/R6 변경 지도**: `pipeline.ts:302-304` 에서 `pass.error` 가 있는 detector 타입을 수집 → `RepoScan` 에 `incompleteTypes` 전달 → `persist.ts:244-256` delist 조건에 `type NOT IN incompleteTypes`. R6 은 `lastIngestedSha` 가 `tree_truncated` 도 반환하도록 하고, true 면 `knownSha` 를 넘기지 않는다(`pipeline.ts:176, 210`).

**R10/R24 주의**: "최신 version" 판정은 `packages.ts:38, 139, 194` 와 `search.ts:135-139, 346, 438` 에 흩어져 있다. 바꿀 때는 모든 곳을 한 번에 바꾼다(CLAUDE.md "Grep every caller").

---

## 5. GitHub Client

| 항목 | 내용 |
|---|---|
| 시작 파일 | `src/github/client.ts` |
| 함수 | `githubFetch`(:175, host allowlist·수동 redirect 2회·10초 timeout) · `readRateLimit`(:145) · `rateLimitState`(:35) · `readCapped`(:236) · `normalizeRepo`(:46) · `githubRepoFromUrl`(:121) |
| 호출자 | `repo.ts` `fetchRepoMetadata`(:6), `tree.ts` `fetchRepoTree`(:24), `raw.ts` `fetchRawFile`(:8), `search.ts` `searchRepositories`(:174) |
| 상한 | `src/github/scan.ts` `CAPS`(:11-30: maxFiles 400, 512KB, 동시 2, 120s, depth 10, 100k entries) |
| 경계 | 모든 GitHub hostname 은 `src/github/` 안에만 둔다(boundary scanner rule 5) |
| 관련 테스트 | `client.test.ts`(SSRF/redirect 매트릭스), `scan.test.ts`, `tree.test.ts`, `search.test.ts`, `permalink.test.ts`(live, CI skip) |

**R10**: `readRateLimit`(:145-156) 에서 `x-ratelimit-resource` 가 있고 `core` 가 아니면 `lastRateLimit` 를 갱신하지 않는다. 테스트: `resource: search` 응답 뒤 `rateLimitState()` 가 바뀌지 않음, 헤더가 없으면 기존처럼 기록.

**R13**: `fetchRepoScanInputs`(:59-62) 의 `Promise.all` 을 순차 호출로 바꾸고, `selectPaths` 앞에 "게이트 거절 / pushed_at 동일" 조기 반환을 둔다. `pipeline.test.ts:447, 537`, `scan.test.ts:191` 의 "정확히 2요청" 단언은 **의도적으로** 바꿔야 한다. 변경 이유를 commit message 에 적는다.

---

## 6. Detector

| 항목 | 내용 |
|---|---|
| 시작 파일 | `src/detect/index.ts`(:13 `DETECTORS`), `types.ts`(`Detector`, `ParseResult`) |
| 실행 | `run.ts` `collectCandidates`(:23) · `orderedNeeds`(:42) · `safeParse`(:60), `nesting.ts` `assignParentPaths`(:21) |
| 파서 | `frontmatter.ts` `parseFrontmatter`(:44), `json.ts` `parseJsonManifest`(:70) |
| 타입별 | `skill.ts`, `plugin.ts`, `catalog.ts`, `mcp.ts`, `command.ts`, `hook.ts` |
| 관련 테스트 | 타입별 `*.test.ts`, `run.test.ts`(DET-09 7번째 detector, 전체 corpus), `skill.test.ts:353-361`(registry 순서 canary) |
| Fixture | `fixtures/<corpus>/{repo.json,tree.json,files/}`, `fixtures/adversarial/`(README 표 포함), `scripts/capture-fixtures.mjs` |

**새 artifact 타입 추가 체크리스트(R19 subagent 예)**

| # | 파일 | 작업 |
|---|---|---|
| 1 | `src/detect/agent.ts` | `command.ts` 패턴 재사용, `tools` → `meta.allowedTools` |
| 2 | `src/detect/index.ts:13` | 등록 |
| 3 | `src/detect/skill.test.ts:353-360` | canary 목록 |
| 4 | `drizzle/0008_*.sql` | `INSERT INTO "agentdock"."artifact_type" … ON CONFLICT DO NOTHING`(패턴: `0003_flaky_selene.sql:16-22`), `drizzle/meta` journal 갱신 |
| 5 | `scripts/migrate.mjs:111-121` | 재-seed 목록 |
| 6 | `src/db/queries/search.ts:76` | `ARTIFACT_TYPE_IDS` |
| 7 | `src/components/typeFilters.ts:29-35`, `ArtifactBadge.tsx:28-57`, `Icon.tsx`, `globals.css` `.badge-*` | UI |
| 8 | `src/app/r/[owner]/[repo]/[...path]/page.tsx` | Install/Frontmatter 행 |
| 9 | `src/github/scan.ts:12-24` | `maxFiles` 산술 재계산(wshobson 이 이미 384) |
| 10 | `src/analyze/declared.ts` | `tools` 를 declared 로 |
| 11 | fixtures + README 표(`README*.md:52-60`) | |

Baseline: `run.test.ts` 의 corpus 별 match 수. 변경 후 subagent 수가 기대치(wshobson 204 등)와 일치하는지, 기존 타입 수가 변하지 않는지 확인한다.

---

## 7. Analyzer와 File Inventory

| 항목 | 내용 |
|---|---|
| 시작 파일 | `src/analyze/index.ts`(:14-20 `ANALYZERS`), `run.ts` `analyzeArtifact`(:31), `types.ts`(`ANALYZE_CAPS`, `CAPABILITY_CATEGORIES`) |
| Analyzer | `install.ts`, `declared.ts`, `network.ts`, `shell.ts`, `hidden.ts`(+`markup.ts`, `lines.ts`) |
| Inventory | `files.ts` `fileInventory`(:52), `isBundledScript`(:70) — 호출은 `pipeline.ts:321` |
| 정밀도 | `fixtures/capability-precision.md`, `precision.test.ts`, `scripts/capability-precision.mjs`, `corpora.ts` |
| ReDoS | `redos.test.ts`(`SHIPPED` :40-45 — hidden 누락) |
| UI | `src/components/CapabilityPanel.tsx`, `src/db/queries/capabilities.ts` `getCapabilityFindings`(:29) |
| Migration | 새 analyzer/category 는 불필요(text 컬럼) |

**R2 변경 지도**: `fileInventory(tree, root)` 의 두 번째 인자를 "inventory root" 로 바꾸고, `pipeline.ts:321` 에서 `candidate.containerRoot ?? (shape-only ? candidate.sourcePath : directoryOf(sourcePath))` 를 넘긴다. command/hook 같은 단일 파일 타입은 파일 자체만 포함한다. 테스트: `files.test.ts` 에 plugin(manifest), shape-only plugin, command, `.claude/settings.json` hook 케이스. 기존 행은 다음 sha 변경 때 갱신된다(unchanged short-circuit 때문에). 즉시 반영하려면 별도 재스캔이 필요하다.

**새 analyzer 추가**: 파일 생성(arity 1, `*_VERSION`) → `index.ts` 등록 → 필요하면 `CAPABILITY_CATEGORIES` 와 `CapabilityPanel` 라벨 → precision 행 + `liveHits` → `redos.test.ts` `SHIPPED` → 기존 데이터에 반영하려면 `reanalyze.ts` 에 `detector_version` 기반 selector 추가.

---

## 8. 검색

| 항목 | 내용 |
|---|---|
| 시작 파일 | `src/db/queries/search.ts` |
| 함수 | `normalizeQuery`(:503) · `searchWhere`(:205-221) · `rankExpr`(:237-249) · `searchPackages`(:403) · `fuzzySearch`(:306-383) · `countSearchResults`(:478) · `capabilityAbsence`/`CAPABILITY_PREDICATES`(:145-179) · `escapeLikeOperand`(:120) |
| 호출자 | `src/app/artifacts/page.tsx:167-170` |
| 데이터 | `package.search_vector`(GIN), `package_fuzzy_trgm_idx`, `capability_finding`, `package.files` |
| 관련 테스트 | `search.test.ts`(DB, 52개; trigram 은 pg_trgm 이 있을 때만) |
| 규칙 | 검색 술어·가중치 변경은 **결정**이다 — 이유를 코드 옆에 적는다(CLAUDE.md). stars/`policy.ts` import 금지 |

| 과제 | 정확한 변경 위치 | 추가 테스트 |
|---|---|---|
| R16 fuzzy 페이지 | `search.ts:460` 조건에 `offset === 0` | 결과가 있는 q + 마지막 페이지 초과 → fuzzy 미호출 |
| R3 absence 필터 | `capabilityAbsence` 에 `exists(select 1 from package_version v where v.id = latest and v.analyzed_at is not null)` 추가, body 없는 타입 처리, `no_shell` 에 `hook.command`/`mcp_server.command` signal 반영 | 미분석 version, JSON artifact, hook `curl\|sh` |
| R17 recall | `searchWhere`(ILIKE 조건 SC, prefix SD, 경로 정규화 SE), `searchPackages`(OR 완화 SF), `fuzzySearch`(임계값 SG) | 질의 표(검색 문서 §4)의 각 행을 테스트로 |

Baseline 수집: 운영 로그의 `event:'search'` 줄(질의, 결과 수)에서 zero-result 비율을 구한다. Hobby 로그 보존이 1시간이므로 일정 기간 수집 방법을 먼저 정한다.

---

## 9. 목록·상세 질의와 노출 규칙

| 항목 | 내용 |
|---|---|
| 시작 파일 | `src/db/queries/packages.ts` |
| 함수 | `NOT_LISTED_BECAUSE`(:128-150, fork/unparsed/duplicate) · `listPackages`(:165) · `countPackages`(:227) · `getRepositoryPackages`(:284) · `getPackageDetail`(:335) |
| URL | `src/components/hrefs.ts`(`detailHref`, `sourcePathCandidates`, `permalink`) — 순수 함수, 테스트가 DB gate 안에 있음(T3) |
| 데이터 | package, repository, package_version |
| 성능 | `NOT_LISTED_BECAUSE` 는 행마다 평가. `ponytail:` marker(:123-126)가 content_hash 인덱스 재검토 조건(목록 100ms 초과)을 기록 |
| 노출 규칙 변경 | `NotListedReason` 어휘 변경은 결정 사항(R23 denylist) |

---

## 10. 페이지와 컴포넌트

| Route | 파일 | 질의 | 수정 포인트 |
|---|---|---|---|
| `/` | `src/app/page.tsx` | `listPackages(18)`, `countPackages` | "newest read"(:42) 정확성, `last_sync` 표시(R12) |
| `/artifacts` | `src/app/artifacts/page.tsx` | search + count | `hrefFor`(:108), type 단일값(:83-88), Clear filters(:270-279, R15), `SCOPE_SENTENCE`(:72-75) |
| 저장소 | `src/app/r/[owner]/[repo]/page.tsx` | `getRepositoryPackages` → `latestJobForTarget` | queued 문구(:116-121) |
| 상세 | `src/app/r/[owner]/[repo]/[...path]/page.tsx` | `getPackageDetail` → `getCapabilityFindings` | Install(:275-293, R21), Frontmatter 행(:90-93), 실패 배너(:191-214), Files(:217-246) |
| Job | `src/app/jobs/[id]/page.tsx` | `getJobView` | `done`(:31), PollUntilDone(R4) |
| 컴포넌트 | `SkillBody.tsx`(U1/U2), `CapabilityPanel.tsx`(U6, :54-55), `JobPanel.tsx`(:55), `PollUntilDone.tsx`(:18) | | |

제약: client component 를 늘리지 않는다(현재 3개). 전환 효과는 `--dur`/`--dur-fast`, keyframe 은 `prefers-reduced-motion: no-preference` 블록 안에만 둔다(`motion.test.ts`). UI 문구는 verdict 어휘 검사를 통과해야 한다.

**R15/U1 변경 지도**: `SkillBody` 에 넘기기 전에 맨 앞의 `^---\r?\n…\r?\n---` 를 렌더링에서만 제외한다. 저장된 body 는 바꾸지 않는다(finding 줄 번호가 원본 기준). `components` 로 h1 은 h3, h2 는 h4 로 강등한다. `SkillBody.test.tsx` 에 frontmatter 와 h1 케이스를 추가한다.

---

## 11. 스키마와 Migration

| 항목 | 내용 |
|---|---|
| 시작 파일 | `src/db/schema.ts` |
| 생성 | `bun run db:generate` → `drizzle/000N_*.sql` 검토 → 필요하면 손으로 수정 |
| 적용 | `bun run db:migrate`(`scripts/migrate.mjs`, 단일 transaction, `folderMillis` 비교) |
| 테스트 스키마 | `bun run db:test:setup`(`schema.ts` 에서 DDL 재생성 — 손으로 쓴 INSERT/guard 는 전달되지 않음) |
| 금지 | `db:push`/`db:pull`, `CREATE EXTENSION`, 다른 스키마 참조, marker 없는 DROP/TRUNCATE/GRANT 등(`check-boundaries.mjs`) |
| 안전 패턴 | additive `ADD COLUMN`(nullable 또는 default), `CREATE INDEX`(transaction 안이므로 CONCURRENTLY 불가 — 대형 테이블이면 별도 절차) |
| Rollback | additive 변경은 코드 revert 만으로 충분하다(컬럼은 남겨 둔다). `DROP` 은 검토 marker 와 별도 결정이 필요 |

로드맵에서 migration 이 필요한 과제: R1-B(`repository.checked_at`), R14/R25(`ingest_job(target)`, `package_version(content_hash)` 인덱스), R18(보조 tsvector), R19(artifact_type INSERT), R24(`last_seen_at`).

---

## 12. CI·배포

| 항목 | 파일 | 수정 포인트 |
|---|---|---|
| CI | `.github/workflows/ci.yml` | `permissions:`(H1), Postgres service(R26), build 의 placeholder `DATABASE_URL` 유지 |
| Sync | `.github/workflows/sync.yml` | `$GITHUB_STEP_SUMMARY`(R12), timeout(60분), actions SHA pin(H2) |
| Next 설정 | `next.config.ts` | `output: process.env.VERCEL ? undefined : 'standalone'`, `/skills` redirect |
| 헤더 | `src/proxy.ts` | nonce CSP |
| env | `src/env.ts`, `.env.example` | 새 env 는 zod 스키마 + 예시 + 문서 |
| DB 연결 | `src/db/client.ts` | `max`, `idle_timeout`, `assertSchemaIsolation` |
| 문서 | `DEPLOY.md`, `VERCEL_DEPLOY.md`, `README*.md` | 코드와 다르면 같은 변경에서 고친다(CLAUDE.md) |

배포 영향 구분:

- `src/app`, `src/components`, `src/db/queries`, `next.config.ts` 변경은 Vercel 재배포가 필요하다.
- `src/ingest`, `src/corpus`, `src/github`, `src/detect`, `src/analyze`, `scripts` 변경은 다음 Actions sync 부터 적용된다. 웹이 같은 모듈을 import 하면 둘 다 영향을 받는다. 예를 들어 `hrefs.ts`, `typeFilters.ts` 같은 공용 모듈.
- migration 은 운영자가 직접 `db:migrate` 를 실행해야 한다. 웹 배포보다 먼저(additive) 적용한다.

---

## 13. 로드맵 과제 → 진입점 빠른 색인

| ID | 시작 파일:라인 | 테스트 파일 | Migration |
|---|---|---|---|
| R1 | `src/ingest/pipeline.ts:397` | `pipeline.test.ts`, `refresh.test.ts` | B안만 |
| R2 | `src/analyze/files.ts:52`, `pipeline.ts:321` | `files.test.ts` | — |
| R3 | `src/db/queries/search.ts:145-179` | `search.test.ts` | — |
| R4 | `src/components/PollUntilDone.tsx:18`, `jobs/[id]/page.tsx:31` | 신규 컴포넌트 테스트 | — |
| R5 | `src/ingest/pipeline.ts:302-304`, `persist.ts:244` | `pipeline.test.ts` | — |
| R6 | `src/ingest/persist.ts:350`, `pipeline.ts:176` | `pipeline.test.ts` | — |
| R7 | `scripts/corpus-sync.mjs:436-451` | 신규 순수 함수 테스트 | — |
| R8 | `src/corpus/search.ts:96-136` | `corpus/search.test.ts` | — |
| R9 | `scripts/corpus-sync.mjs:375`, `fanout.ts:38` | `fanout.test.ts` | — |
| R10 | `src/github/client.ts:145-156` | `client.test.ts` | — |
| R11 | `scripts/corpus-sync.mjs:364-373` | 신규 | — |
| R12 | `scripts/corpus-sync.mjs:143-191, 484`, `sync.yml` | 신규 | — |
| R13 | `src/github/scan.ts:51-62` | `scan.test.ts`, `pipeline.test.ts` | — |
| R14 | `src/db/queries/seeds.ts:103-113` | `seeds.test.ts` | 인덱스 |
| R15 | `SkillBody.tsx`, `artifacts/page.tsx:270`, `JobPanel.tsx:55` | 컴포넌트 테스트 | — |
| R16 | `src/db/queries/search.ts:460` | `search.test.ts` | — |
| R17 | `search.ts:205-249, 403-470` | `search.test.ts` | 선택 |
| R19 | `src/detect/index.ts:13` 외 §6 체크리스트 | detector/run 테스트 | INSERT |
| R23 | `src/db/queries/packages.ts:128-150` | `packages.test.ts` | — |
| R24 | `persist.ts:161-177`, 최신 version 질의 전체 | `persist.test.ts` | 컬럼 |
| R26 | `.github/workflows/ci.yml` | CI | — |
| R27 | `vitest.config.ts:13` | — | — |
| R29 | `src/detect/mcp.ts:59-60, 143`, `catalog.ts:44, 60` | `mcp.test.ts`, `catalog.test.ts` | — |
