# AgentDock Phase 2 개선 기록

> 기준: `develop` @ `77e7184`(R1 1차 수정 포함) 위의 **미커밋 작업 트리** · 2026-10-20
> DB migration 없음 · 운영 DB, 운영 sync, GitHub Actions, Vercel에는 손대지 않았다 · commit/push 없음
> 과제 ID는 [고도화 로드맵](agentdock-enhancement-roadmap.md) §0 상태 표와 같다.

## 1. 작업 범위

| 영역 | 과제 | 결과 |
|---|---|---|
| 데이터 정합성 | R2, R3, R5, R6, R24 | DONE |
| 사용자 화면 | R4, R15(U1–U4), R16 | DONE |
| 수집량·discovery | R7, R8, R9 | DONE (R7은 운영 NOT VERIFIED) |
| 운영 안정성·관측성 | R10, R11, R12 | DONE |
| 검색 정확도 | R17 | PARTIALLY DONE (SG trigram 측정, R18 PENDING) |
| 결정 필요 | R1의 404/too_large/409 | Phase 3에서 처리(`checked_at` 0008, [Phase 3 기록](agentdock-phase3-operations-and-test-safety.md)) |

## 2. 변경된 로직 (변경 전 → 변경 후)

### 데이터 정합성

- **R2 file inventory** (`src/analyze/files.ts` `fileInventory`, `ownedBy`)
  - 변경 전: 모든 타입에서 `directoryOf(sourcePath)` 아래 blob을 inventory로 잡았다.
    - plugin은 `.claude-plugin/`만 잡혔다.
    - command는 형제 command 파일까지 잡혔다.
    - `.mcp.json`과 hook은 plugin 루트나 `.claude/`의 파일 전체가 잡혔다.
  - 변경 후: 타입별로 범위를 정한다.
    - plugin: `containerRoot` 아래 전체. 루트 plugin은 tree 전체(fixture 기준 180/184 blob)
    - skill: SKILL.md가 있는 디렉터리
    - command, hook, mcp_server: 파일 하나
  - 200개 cap에 걸리면 상세 화면에 "Only the first 200 files are listed"를 표시한다.
  - `no_scripts` 필터도 같은 데이터(`package.files`)를 읽으므로 함께 정확해진다.
  - 기존 행은 다음 scan(sha가 바뀌거나 R6로 다시 읽을 때)에 갱신된다.
- **R3 absence 필터** (`src/db/queries/search.ts` `capabilityAbsence`)
  - 변경 전: 분석하지 않은 version과 body가 `''`인 JSON 타입(plugin/hook/mcp)도 "No network request observed"와 "No Bash grant declared"를 통과했다.
  - 변경 후: 두 필터는 다음 두 조건을 모두 만족할 때만 통과한다.
    - 최신 version의 `analyzed_at IS NOT NULL`
    - 타입이 skill 또는 command
  - analyzer 하나라도 예외를 내면 `analyzed_at`을 null로 둔다(`persist.ts`, `reanalyze.ts`, `ScannedPackage.analysisIncomplete`). finding은 보존하고, `reanalyze`가 null 행을 다시 시도한다.
  - 필터 안내 문구와 README에 적용 범위를 적었다.
- **R5 detector 예외** (`pipeline.ts`, `persist.ts`)
  - 변경 전: `match()`가 throw하면 그 타입의 artifact가 모두 delist되었다.
  - 변경 후: `RepoScan.undetectedTypes`에 들어간 타입은 delist 대상에서 제외한다.
- **R6 부분 읽기 고착** (`src/github/scan.ts`, `persist.ts` `lastIngestedState`)
  - 변경 전: 같은 sha이면 무조건 short-circuit했다. 그래서 일시적인 raw 실패로 생긴 부분 목록이 다음 upstream commit까지 남았다.
  - 변경 후: 아래 조건을 모두 만족하면 다시 읽는다.
    - 저장 상태가 부분 읽기(`tree_truncated`)다.
    - GitHub tree가 truncated가 아니다.
    - 원하는 경로 수가 `maxFiles` 이하다.
  - 결정적으로 잘리는 저장소(예: davila7, 896 경로)는 계속 short-circuit한다.
- **R24 revert(A→B→A)** (`persist.ts`)
  - 변경 전: A가 다시 나오면 `(package_id, content_hash)` 충돌로 version이 생기지 않았다. 그래서 최신 version이 B로 남아 지금 저장소에 없는 body와 finding을 보여 줬다.
  - 변경 후: 기존 A version의 `ingested_at`을 now()로 옮기고 counters에 updated로 기록한다.
    - `ingested_at`은 화면에 표시되지 않고 "최신" 정렬에만 쓰인다.
    - A가 이미 최신이면 아무것도 바뀌지 않는 UPDATE 1회만 실행된다.

### 사용자 화면

- **R4 polling** (`PollUntilDone.tsx` `startPolling`)
  - 변경 전: 1.5초 간격으로 계속 polling했다. queued 상태로 12시간이면 28,800회다.
  - 변경 후:
    - queued는 60초 간격(12시간이면 720회), running은 2초 간격, 종료 상태는 polling하지 않는다.
    - 탭이 숨겨지면 멈추고, 다시 보이면 1회 즉시 갱신한다.
    - JS 없이도 동작하는 "Check now" 링크를 추가했다.
- **R15 U1–U4** (`SkillBody.tsx`, `artifacts/page.tsx`, `JobPanel.tsx`, `r/[owner]/[repo]/page.tsx`)
  - U1: frontmatter를 fenced yaml 블록으로 렌더한다. 저장된 body는 바꾸지 않아 finding 줄 번호가 유지된다.
  - U2: 본문 h1–h5를 h3–h6로 강등한다. 결과적으로 페이지에 h1이 하나만 남는다.
  - U3: 필터가 있을 때만 Clear filters를 표시한다.
  - U4: queued 문구를 "The next scheduled sync reads it…"과 "Queued for the next scheduled sync"로 바꿨다.
- **R16** fuzzy fallback은 `offset === 0`일 때만 실행한다. 변경 전에는 마지막 페이지를 넘기면 trigram 행이 full-text total 아래에 "Showing 26–30"처럼 표시되었다.

### 수집량·Discovery (R7–R9)

- **R7** (`src/corpus/budget.ts` 신규, `caps.ts`, `corpus-sync.mjs`)
  - 토큰이 없으면 기존과 같다(25/25/25, search 60요청/6.5초 간격).
  - 토큰이 있으면 enqueue 100, refresh 100, drain 200, search 150요청/2.5초 간격이다.
    - core 사용량은 400/5,000(8%)이다.
    - search는 분당 24회로, 인증 한도인 분당 30회보다 낮다.
  - drain은 core가 2 미만으로 남거나 sync 시작 후 35분이 지나면 claim을 멈춘다(`drainStop`).
    - 35분은 Actions timeout 60분 안에서 scan 1건의 최악 시간(120초 + API timeout 20초)을 남긴 값이다.
- **R8** (`src/corpus/search.ts` `sweepTopics`)
  - 변경 전: seed cap 2,000과 요청 cap 60이 sweep 전체에 걸려 있었다. 그래서 claude-code topic 하나가 둘 다 소진하면 나머지 4개 topic은 탐색되지 않았다.
  - 변경 후:
    - topic별 몫 = ceil(남은 예산 / 남은 topic 수)로 나눈다. 쓰지 않은 몫은 다음 topic으로 넘어간다.
    - 오류는 topic 단위로 격리한다(`failed`). rate limit이 걸리면 이후 topic은 `not_reached`로 표시한다.
    - topic별 shard stack을 `schema_meta`(`corpus_sweep:topic-search`)에 저장해 다음 실행에서 이어 간다. 저장된 stack은 floor와 형식을 검증한 뒤에만 사용한다.
- **R9** (`src/corpus/fanout.ts` `fanOutBySource`)
  - 변경 전: `--source=all`이면 전역 FIFO로 fan-out해서 registry의 대량 seed가 모든 자리를 차지했다.
  - 변경 후: seeds → search → links → backlog 순으로 몫을 나누고, 쓰지 않은 몫은 다음 순서로 넘긴다. 단일 소스로 실행할 때의 동작은 그대로다.

### 운영 안정성·관측성 (R10–R12)

- **R10** (`src/github/client.ts`)
  - core 슬롯은 `x-ratelimit-resource`가 `core`이거나 헤더가 없을 때만 갱신한다.
  - secondary limit은 `retry-after` 초만큼 대기한다. 변경 전에는 primary reset(최대 1시간)까지 기다렸다.
  - `fetchCoreRateLimit()`은 `/rate_limit`을 조회하며, 이 호출은 quota를 쓰지 않는다.
- **R11** (`corpus-sync.mjs` `stage`)
  - discovery 소스마다 try/catch를 둔다. 하나가 실패해도 나머지 소스, fan-out, refresh, drain은 계속 실행한다.
  - 실패한 단계가 있으면 종료 코드는 1이다.
- **R12**
  - 요약에 다음 항목을 추가했다.
    - 소스별 discovery와 enqueue 수
    - 실제 사용한 core 수(drain 전후의 `/rate_limit` 차이)
    - 인증 여부
    - drain 후 queue 잔량
  - Actions에서는 `::notice::`, `::warning::`(drain 조기 중단, 진척 없음), `::error::`(단계 실패)를 출력한다.
  - 모든 단계가 성공한 scheduled 실행만 `schema_meta.sync:last_success`를 기록하고, 홈 화면에 "last complete sync"로 표시한다.
  - `$GITHUB_STEP_SUMMARY`는 파일 쓰기가 필요해서 쓰지 않았다(AGENTS.md: 수집 프로세스의 디스크 쓰기는 0).

### 검색 (R17)

`src/db/queries/search.ts`의 `plainWords`, `tsQuery`, `searchMode`를 바꿨다.

- 일반 단어로만 된 질의는 `to_tsquery('english', 'w1 & w2 & wN:*')`로 변환한다.
  - 마지막 단어는 3자 이상일 때만 prefix로 처리한다.
  - 문자와 숫자만 추출하므로 tsquery 연산자를 주입할 수 없다.
- 경로(`skills/x/SKILL.md`)는 C 가중치 경로 lexeme과 같은 단어로 분해된다.
- websearch 문법(따옴표, `-`, `or`)을 쓴 질의는 기존 `websearch_to_tsquery`를 그대로 쓴다.
- 여러 단어가 모두 매칭되는 결과가 0건이면 `any`(`|`) 모드로 완화한다.
  - rows, count, 화면 문구가 하나의 cached `searchMode`를 함께 읽는다.
  - 화면에 "No artifact matched every word; these match at least one."을 표시한다.
- 3자 미만 질의에는 repository-name ILIKE를 적용하지 않는다(범람 방지).

## 3. 검색 baseline과 비교 (격리 DB, 고정 fixture 13개 시나리오)

| 시나리오 | 변경 전 | 변경 후 |
|---|---|---|
| 정확한 이름 1위 | PASS | PASS |
| 접두어(`xqplay`) 결과와 count 일치 | **FAIL** (0건) | PASS (2건) |
| 여러 단어 AND | PASS | PASS |
| 한 단어가 없는 다단어 → any 모드 | **FAIL** (fuzzy로 이동) | PASS |
| 파일 경로 | **FAIL** | PASS |
| repository 이름 | PASS | PASS |
| 2자 질의 범람(`xq`) | **FAIL** (37건) | PASS (1건) |
| 오타 → close match | PASS | PASS |
| 결과 없음 | PASS | PASS |
| 마지막 페이지 이후(R16) | **FAIL** (fuzzy 행 노출) | PASS (빈 페이지) |
| 페이지 안정성과 count 합계 | PASS | PASS |
| type+capability와 prefix 결합 | **FAIL** | PASS |
| tsquery 문법·SQL 문자열 입력 | PASS | PASS |

성능(로컬 PG17, 450행): 변경 전과 후의 실행 계획은 같다(`package`와 `repository` seq scan, repo ILIKE OR 때문). 실행 시간은 0.72ms → 0.45ms다. prefix tsquery만 단독으로 실행하면 `package_search_vector_idx` Bitmap Index Scan을 사용한다.

## 4. 테스트 결과

| 항목 | 변경 전 baseline | 변경 후 |
|---|---|---|
| `check:boundaries` | OK | OK |
| `lint` | 189 files, 0 | 192 files, 0 |
| `typecheck` | exit 0 | exit 0 |
| `test` (격리 PostgreSQL 17, DB suite 포함) | 1094 passed / 2 skipped | **1159 passed / 2 skipped** |
| `test` (CI 동일: `CI=1`, DB 없음) | — | 866 passed / 295 skipped |
| `build` (standalone) | 성공 | 성공, `next-env.d.ts` md5 동일 |
| `build` (`VERCEL=1`) | — | 성공 |
| `docker build` | — | 성공(확인 후 이미지 삭제) |

- 새 회귀 테스트는 수정 전 코드에서 FAIL하는 것을 직접 확인했다.
  - 방법: HEAD 버전 파일로 잠시 교체해 실행한 뒤 복원했다.
  - FAIL 수: R2 7, R3 3(+persist/reanalyze 2), R5 1, R6 1, R8 5, R10 2, R17/R16 6, R24 1
- R4, R7, R9, R12는 새 함수에 대한 테스트다. 이전 코드에는 해당 함수가 없어서 같은 방식으로 비교할 수 없다.

**격리 E2E sync 3회** 결과다. 모든 외부 host를 preload 가짜 fetch로 대체했고 실제 외부 요청은 0건이다. 로컬 컨테이너의 `agentdock` schema에 커밋된 migration 8개를 적용한 뒤 실행했다.

| 실행 | 조건 | 결과 |
|---|---|---|
| 1 | 토큰 없음 | 기존 cap 25. topic 5개가 각각 3요청. fan-out seeds 7 / search 5 / links 2 / backlog 11. core 사용 50(측정값), exit 0 |
| 2 | 가짜 토큰, registry 503, mcp-server topic 502, `--stale-hours=0` | registry 단계만 실패(`::error::`). 나머지는 수행. 1회차 resume stack으로 4개 topic 완주. mcp-server는 `failed`로 stack 보존. refresh 25건 모두 unchanged. exit 1, `last_success` 기록 안 함 |
| 3 | 토큰 없음, core 20 남음 | 10건 drain 후 `core_budget`으로 중단, 15건 이월(`::warning::`), exit 0 |

로컬 `next start` HTTP smoke 결과다.

- prefix 검색이 동작한다.
- any 모드 문구가 표시된다.
- 필터가 없는 0건 결과에는 Clear filters가 없다.
- 마지막 페이지 이후에는 "There is no page 9"가 표시된다.
- skill 상세 화면에는 h1이 1개이고 frontmatter는 yaml 블록이다.
- queued job 화면에 새 문구와 "Check now" 링크가 표시된다.

## 5. 데이터 모델, migration, 운영 영향

- **migration: 필요 없음, 수행하지 않음.** 새로 쓰는 상태는 기존 `schema_meta`(key/value)의 key 두 개다.
  - `corpus_sweep:topic-search`
  - `sync:last_success`
- **데이터 의미 변화**
  - `package.files`: 범위가 바뀌어, 다음 scan 때부터 타입별 범위로 저장된다.
  - `package_version.ingested_at`: 의미가 "최초 수집"에서 "마지막으로 최신이 된 시각"으로 바뀌었다. revert 때만 변한다.
  - `analyzed_at`: analyzer가 예외를 내면 null로 남는다.
- **GitHub API**
  - 토큰이 없으면 변화가 없다.
  - 토큰이 있으면 core 사용량이 최대 약 400회/실행이다(기존 50).
  - search는 최대 150회/실행이다(기존 60). wall clock은 같다.
  - raw host 읽기는 drain 증가와 R6 재읽기만큼 늘어난다.
- **Neon**
  - 실행당 쓰기가 drain 수에 비례해 늘어난다(최대 200건).
  - 검색 요청마다 다단어 질의일 때만 EXISTS 1회가 추가된다.
  - polling 감소로 웹 쪽 compute는 크게 줄어든다.
- **Vercel**: job 페이지 호출이 queued 상태 기준 1/40로 줄어든다. 빌드 구성은 바뀌지 않았다.
- **GitHub Actions**: workflow 동작은 바뀌지 않았다(`sync.yml`의 timeout 주석만 35분 deadline 기준으로 고침). 실행 시간이 늘 수 있지만 상한 35분 + 마무리 단계로 timeout 60분 안에 끝난다. 단계 하나가 실패하면 job은 red가 된다(기존에는 run 전체가 중단).

## 6. 알려진 한계

- R7의 100/100/200은 운영 처리 시간으로 측정한 값이 아니다. 시간 상한(35분)이 실제 경계다. 운영 요약의 "unspent"를 보고 조정해야 한다.
- R6: tree의 blob size로 512KB 초과 파일을 미리 알 수 있어 재읽기 대상에서 뺀다. 개별 raw 경로의 404처럼 tree에 드러나지 않는 영구 원인은 여전히 refresh 때마다 다시 읽는다(`ponytail:` 표기). 줄이려면 skip 원인 컬럼이 필요하다.
- R8: shard를 중간까지 걷다 멈추면 그 shard 전체를 다시 읽는다(page cursor 없음). 매번 실패하는 shard가 있으면 그 topic은 진행하지 못하고, 실행은 매번 exit 1 + `::error::`로 드러난다.
- R17: 다단어 any 모드의 순위는 `ts_rank`에 의존한다. trigram 임계값(SG)은 측정하지 않았다. repository description과 topic은 검색되지 않는다(R18, migration 필요).
- R5: pipeline에서 detector를 실제로 throw시키는 통합 테스트는 없다. persist 규칙 테스트로 대신했다.

## 6-1. 최종 리뷰에서 고친 결함 (2026-10-21)

Phase 2 diff를 다시 리뷰하면서 이번 변경이 만든 결함 9건을 찾아 고쳤다. 각 수정에는 수정 전 코드에서 실패하는 회귀 테스트를 붙였다.

| 항목 | 결함 | 수정 |
|---|---|---|
| R2 → `no_scripts` | 파일 하나만 소유하는 hook·MCP·command가 "No bundled script files"로 통과했다. 같은 디렉터리의 `hooks/guard.py`가 inventory에 들어가지 않아서다. inventory가 200개 상한에서 잘려도 통과했다 | inventory가 디렉터리인 skill·plugin만 대상으로 하고, 파일 수가 상한 미만일 때만 통과 |
| R6 | 512KB를 넘는 파일 때문에 부분 읽기가 된 저장소를 refresh 때마다 다시 읽었다 | tree size가 maxFileBytes를 넘는 경로가 있으면 재읽기하지 않음 |
| R8 | 실패한 shard에서 이미 쓴 요청이 집계되지 않아, 다음 topic이 실제보다 큰 몫을 받았다 | 시도한 요청 수를 실패 시에도 더함 |
| R8 | `--search-min-stars=50` 수동 실행이 남긴 stack을 정기 실행(floor 10)이 받아들여, pass가 끝날 때까지 10–49 구간을 건너뛰었다 | 가장 낮은 shard가 현재 floor에서 시작하는 stack만 이어받음 |
| R8 | seed 상한을 넘긴 마지막 shard의 이름이 `slice`로 잘렸다. 그 shard는 이미 stack에서 빠졌으므로 다음 pass 전까지 돌아오지 않았다 | slice를 제거. 상한 초과는 shard 하나(≤1,000)까지 |
| R11 | 실패한 topic이 로그 한 줄에만 남고 exit code와 last_success에 반영되지 않았다 | topic 실패를 stage 실패로 처리(exit 1, `::error::`, last_success 미기록) |
| R12 | 홈 화면의 "last complete sync"는 상한에서 멈춘 실행도 complete라고 말했다 | "last sync without errors"로 바꿈 |
| R17 | `searchMode`의 react `cache`가 객체 인자를 identity로 비교해 한 요청에서 3번 실행됐다. 그 사이에 ingest가 끼면 rows와 count가 갈릴 수 있었다 | page가 한 번 계산해 rows·count에 넘김 |
| U1 | `---` 가로줄로 시작하는 본문을 frontmatter로 오인해 제목까지 yaml 블록으로 렌더했다 | 첫 줄이 `key:`일 때만 frontmatter로 봄 |

## 7. Rollback

- 코드만 되돌리면 된다. migration이 없고 스키마도 바뀌지 않았다.
- 남는 데이터는 `schema_meta`의 두 key다. 이전 코드는 이 key를 읽지 않으므로 무해하다. 필요하면 운영자가 `DELETE FROM agentdock.schema_meta WHERE key IN ('corpus_sweep:topic-search','sync:last_success')`를 실행한다.
- `package.files`와 `ingested_at` 값은 이전 코드로 돌아가도 그대로 유효하다. 다음 scan 때 이전 규칙으로 다시 쓰인다.

## 8. 남은 작업과 결정 필요 사항

1. **R1 잔여(BLOCKED)**: 404, 저장소 단위 too_large, 409를 처리하려면 `repository.checked_at` additive migration과 refresh 정렬 변경이 필요하다. 404를 delist할지도 정책으로 정해야 한다(권장: delist하지 않고 순서만 뒤로 보냄).
2. R18: description/topic 검색용 보조 tsvector(additive migration + GIN)
3. R26/R27: CI에서 PostgreSQL을 실행해 DB suite 돌리기, 로컬 `.env` 자동 로드 격리(이번에는 `CI=1` + 명시적 `DATABASE_URL`로 우회)
4. R13, R14, R19–R23, R25, R28–R30: 미착수
