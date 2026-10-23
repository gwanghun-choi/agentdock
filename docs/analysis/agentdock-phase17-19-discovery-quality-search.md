# AgentDock Phase 17–19 — Discovery Coverage · Corpus Quality · Search

작성 2026-10-23 · 기준 commit `3129b5c`(develop = 로컬 HEAD). 운영 배포 commit은 `a3efd28`이다(3129b5c는 문서만 추가).
선행 문서: [Phase 13–16 배포 후 검증](agentdock-phase13-16-post-deployment-verification.md), [Phase 11 검색 품질](agentdock-phase11-search-quality-and-discovery.md).

번호: `docs/analysis`는 phase2–16을 사용하고, `.planning/ROADMAP.md`(GSD)는 별도로 Phase 0–8을 사용한다. 17–19는 두 체계 모두에서 비어 있다.
- Phase 17 = Discovery
- Phase 18 = Corpus
- Phase 19 = Search

## 1. 결론

| ID | 영역 | 문제 | 변경 | 결과 |
|---|---|---|---|---|
| D-1 | Discovery | backlog 슬롯 33개 중 생산적인 것이 1개(3%) | `unenqueuedSeeds` 정렬에 "sweep이 floor 이상으로 본 seed 먼저" 키 추가 | 로컬 PASS · 운영 효과 PENDING |
| C-1 | Corpus | 운영 hook 25개 표본 중 21개가 이름 `hooks`, 4개가 `settings` | hook 이름을 설정 대상 디렉터리 이름으로 변경(mcp.ts의 `dirOf`와 같은 규칙) | 로컬 PASS · 운영 반영은 다음 read부터 |
| S-1 | Search | `node.js`, `three.js`처럼 점이 든 단어가 `node & js`로 쪼개져 본문의 `node.js` lexeme과 맞지 않음 | 점이 든 단어를 `(node.js \| node <-> js)`로 검색 | 로컬 PASS · 평가셋 50건 결과 동일, 신규 2건 개선 |

- Schema 변경, migration, URL 계약 변경, API 반환 형식 변경은 없다.
- 운영 DB 접근, Sync 실행, 배포, commit은 하지 않았다.

NO CHANGE로 판정한 항목과 근거:
- refresh 정책: §3.4
- 처리 상한(PARTIAL_CAP): §3.5
- pagination·정렬·필터: §5.4
- 검색 UX: §5.5
- MCP 설명 부재: §4.3

## 2. Baseline

### 2.1 출처 구분

| 구분 | 출처 | 비고 |
|---|---|---|
| 운영 실측 (HTTP GET) | 운영 페이지 | 검색 42건, 목록 표본 12쪽, 홈 1건. 0.8초 간격 |
| 운영 로그 | GitHub Actions Sync job 로그 11개(2026-10-19 ~ 10-22) | 직전 검증에서 받은 파일 |
| 로컬 재현 | 127.0.0.1:55432 test DB | fixture corpus, 평가셋, 합성 데이터 EXPLAIN |
| 운영 DB | — | **NOT RUN**. 승인 전 접속 금지 |

### 2.2 직전 baseline 대비 현재 상태

| 항목 | 직전(a3efd28 검증) | 지금 |
|---|---|---|
| 운영 artifact | 7,273 | 7,273 (홈, `/artifacts?q=` 동일) |
| 유형별 | 4652/632/140/1003/109/737 | 동일 |
| 최신 Sync | 39853119505 PARTIAL_CAP | 동일. 새 예약 run은 이 시점까지 없음 |
| 테스트 (CI 모드) | 1466 passed / 3 skipped | 변경 후 1475 passed / 3 skipped (신규 9건) |
| E2E | 25/25 | 변경 후 25/25 (로컬) |

## 3. Discovery (Phase 17)

### 3.1 흐름 (코드 기준)

`scripts/corpus-sync.mjs`는 아래 순서로 stage를 실행한다.
1. registry: GitHub quota 0, 40쪽 상한
2. seeds: 운영자 목록 15개
3. links: curated 목록 2개, 목록당 1,000개 상한
4. search: topic sweep. search 요청 한도를 별도로 쓰고 stars ≥ 50인 결과만 받는다
5. fan-out: `fanOutBySource`가 enqueue 100개를 seeds → search → links → backlog 순으로 나눈다. backlog는 `unenqueuedSeeds`의 전역 FIFO다
6. refresh: 100개
7. drain: 200개, 35분 deadline

star floor는 `pipeline.ts`의 path selector 안에서 검사한다. 이 시점에는 metadata와 tree 요청 2개를 이미 쓴 뒤다.

### 3.2 측정: 슬롯별 생산성 (job id 순서 = enqueue 순서)

| run | search 0–34 | links 34–67 | backlog 67–100 | refresh 100–200 |
|---|---|---|---|---|
| 39716460966 | ok 22, none 7, floor 5 | ok 4, floor 22, unreadable 5 | ok 5, unchanged 16, floor 11 | ok 45, floor 31 … |
| 39765655496 | ok 20, none 8, floor 4, unreadable 2 | ok 14, floor 17 | **floor 24, unreadable 7, none 2, ok 0** | unchanged 31 … |
| 39853119505 | **ok 27, none 6, floor 0** | ok 12, floor 16 | **ok 1, floor 24, unreadable 7, archived 1** | unchanged 74, ok 26 |

- 표의 "floor"는 `below_star_floor` 결과다.
- 39716460966의 refresh 구간에 floor가 31건 있는 것은 이전 run에서 남은 queue가 섞였기 때문으로 보인다.

해석:
- search seed는 sweep 결과의 stars(≥ 50)를 `hint.stars`로 가진다. 그래서 거절이 거의 없다.
- backlog는 생성 순서(created_at)대로 내보낸다. 맨 앞에는 2026-10-19에 들어온 registry seed가 수천 개 있고, 이들은 stars 정보가 없다. 그래서 최근 run에서 slot 33개 중 32개가 정책 거절 또는 읽기 실패였다.
- 그 사이 이전 sweep이 찾은 ≥ 50-star seed는 backlog 뒤쪽에 쌓인다.
- 거절 1건의 비용: core 요청 2개, 작업 간 간격으로 측정한 wall time 중앙값 2.7초, drain slot 1개.

| run | `below_star_floor` | wall time 합 |
|---|---|---|
| 39716460966 | 69 | 154초 |
| 39765655496 | 49 | 125초 |
| 39853119505 | 40 | 101초 |

### 3.3 D-1 변경

- **문제:** backlog가 "아직 모르는" seed를 "floor 이상으로 확인된" seed보다 먼저 내보낸다.
- **근거:** §3.2. 최신 run에서 backlog 생산성 3%(1/33), search 79%(27/34).
- **변경 파일**
  - `src/db/queries/seeds.ts`: `KNOWN_ELIGIBLE` 정렬 키, `unenqueuedSeeds` ORDER BY의 첫 키
  - `src/db/queries/seeds.test.ts`: 회귀 테스트 1건
- **로직**
  - ORDER BY: `KNOWN_ELIGIBLE`, `created_at`, `id`
  - `hint.stars`가 JSON number이고 `CORPUS_CAPS.searchMinStars`(= `MIN_REPOSITORY_STARS`) 이상이면 0, 아니면 1
  - CASE가 JSON 타입을 먼저 검사하므로, 손으로 쓴 hint가 statement를 실패시키지 않는다
  - 거르지 않고 순서만 바꾼다. 모르는 seed도 나중에 제공된다
  - `fanOutBySource`의 그룹 배분은 바꾸지 않았다. seeds 그룹은 hint에 stars가 없어 기존 file 순서를 유지하고, search 그룹은 전부 0이라 기존 순서를 유지한다
- **정책 영향**
  - "Popularity schedules work; it never ranks artifacts"(AGENTS.md)의 범위 안이다. 수집 순서만 바꾸고 listing과 ranking은 건드리지 않는다
  - `MIN_REPOSITORY_STARS`를 import하는 모듈은 늘지 않았다(`policy.test.ts` allow-list 그대로)
- **변경 후 (로컬)**
  - 도착 순서 A(registry), B(stars 49), C(50), D(`"many"`), E(950)일 때 제공 순서는 C, E, A, B, D다
  - scope를 준 제공 `[A, E]`는 E, A 순서다
  - 기존 코드에서는 이 테스트가 실패한다(A, B, C, D, E 순서)
- **비용:** 합성 seed 20,000건과 job 7,000건에서 EXPLAIN ANALYZE 결과, plan은 같고(top-N heapsort) 8.8 ms → 10.7 ms였다.
- **예상 효과:** 추정치이며 운영에서는 미검증(PENDING)이다.
  - backlog 33 slot이 search 그룹 수준(79%)이 되면 run당 ingest는 약 +25건이다(66 → 약 91)
  - floor 거절과 unreadable은 run당 약 31건 줄어든다
  - 확인 방법: 배포 후 첫 예약 Sync에서 jobId 67–100 구간의 outcome
- **남은 제약**
  - backlog에 남아 있는 known seed 수를 운영 DB 없이 모른다. 33개보다 적으면 남은 slot은 기존 도착 순서로 돌아가며, 손해는 없다
  - 모르는 seed(registry 대부분)는 known seed가 남아 있는 동안 대기한다. 코드에 `ponytail:` marker로 남겼다. registry의 적격 이름이 몇 주씩 늦게 들어오면 registry 전용 fan-out 그룹을 둔다
  - links seed의 hint는 링크 stage가 매번 `{}`로 덮어쓴다(stage 순서상 search가 마지막이라 같은 run에 sweep이 다시 찾은 이름만 stars가 남는다). 그래서 links 그룹은 일부만 개선된다

### 3.4 Refresh: NO CHANGE

| 지표 | 값 |
|---|---|
| considered 추이 | 4 → 27 → 41 → 100 (not-reached 43) |
| `failing-checks` | 0 |
| 최신 refresh 100건 결과 | unchanged 74(중앙값 3.4초, core 2) / ok 26 |

- 미처리 43건은 corpus 증가에 따른 rotation이다. 순서가 `coalesce(checked_at, scanned_at)`이라 다음 run에 맨 앞이 된다.
- backoff 대상이 0이므로, 실패한 요청이 정상 refresh를 밀어내는 현상은 관찰되지 않았다.
- D-1로 신규 ingest가 늘면 refresh 수요도 같이 는다. 이는 §8의 상한 재조정 권고로 넘긴다.

### 3.5 PARTIAL_CAP: NO CHANGE (상한 유지)

| 자원 | 사용량 (39853119505) | 판정 |
|---|---|---|
| core 요청 | 421 / 5000 (8%) | 여유 |
| drain wall time | 957초 (전체 1406초 중, deadline 2100초) | 여유 |
| enqueue 100 + refresh 100 = drain 200 | 200 / 200 | 묶이는 제약 |

- 현재 묶이는 제약은 설정된 enqueue 상한뿐이다. 지시대로 상한은 올리지 않았다.
- 먼저 같은 예산 안에서 효율을 높였다(D-1).
- D-1의 운영 효과를 본 뒤, 남는 시간 여유(약 1100초)를 근거로 상한을 다시 정하라고 권고한다.

## 4. Corpus Quality (Phase 18)

### 4.1 Identity와 provenance (코드 확인)

- **Identity:** `(repository_id, type, source_path)` unique이고, repository는 GitHub node id로 고정된다. 이름(name, slug)은 identity 밖에 있으므로 C-1은 identity에 영향이 없다.
- **Version:** 내용 hash가 다를 때만 새 version이 생긴다(`package_version_content_key`).
- **Permalink:** `/blob/<commit sha>/<path>` 형식이다.
  - 표본 250개 행(유형별 2쪽)에서 모두 `/blob/<40자 sha>/` 형식이었다
  - blob 내용 일치는 직전 검증에서 확인했다(PASS)
- **중복처럼 보이는 결과:** 예를 들어 `context7` plugin 4개는 경로가 서로 다른 별개 파일이다. 같은 저장소 안의 미러 사본이며 identity 결함이 아니다.

### 4.2 C-1 hook 이름

- **문제:** hook 이름이 파일 basename(`hooks`, `settings`)이다.
  - 운영 표본: `/artifacts?type=hook` 1쪽과 7쪽의 25개 중 `hooks` 21개, `settings` 4개, 설명 0개
  - 목록에서 같은 단어가 반복되고, plugin 이름이 A-weight(name)에 들어가지 않는다
- **근거:** `src/detect/mcp.ts`는 `.mcp.json`에 이미 디렉터리 이름(`dirOf`)을 쓴다. 같은 종류의 사실(파일이 놓인 위치)이다.
- **변경 파일**
  - `src/detect/hook.ts`: `hookName`
  - `src/detect/hook.test.ts`: 기존 기대값 1건 변경, 경로 5종 추가
- **규칙:** 경로 segment가 3개 이상이면 끝에서 세 번째 segment를 이름으로 쓴다.

  | 경로 | 이름 |
  |---|---|
  | `plugins/p/hooks/hooks.json` | `p` |
  | `apps/web/.claude/settings.json` | `web` |
  | 저장소 루트의 `hooks/hooks.json` | `hooks` (그대로) |
  | `.claude/settings.json` | `settings` (그대로) |

- **기존 결정 변경:** 기존 주석은 "basename이 유일하게 정직한 identity"라고 적었다. 하지만 identity는 원래 `source_path`이고, 이름은 표시와 검색용이다. 디렉터리 이름도 파일 위치에서 나온 관찰 사실이므로 정직성 기준을 그대로 만족한다. 주석을 측정값과 함께 다시 썼다.
- **변경 후 (로컬 e2e 시드):** hook 8개가 `settings`, `explanatory-output-style`, `hookify`, `learning-output-style`, `ralph-wiggum`, `security-guidance` …로 표시된다.
- **검색 회귀**
  - 평가셋 `plugin-name`(`hookify`)에서 hookify의 hooks.json이 2위로 올라와 NDCG가 1.000에서 0.920으로 떨어졌다
  - 이 파일은 hookify plugin의 구성 요소다. 이미 relevant인 command(`commands/hookify.md`)와 같은 지위이므로 relevant로 재판정했다. 근거는 평가셋 주석에 적었다
  - 재판정 후 0.600 / 1.000이고, 나머지 51건은 변화가 없다
- **운영 데이터 영향**
  - migration이나 backfill은 없다
  - 기존 행은 그 저장소를 새 commit으로 다시 읽을 때 upsert(`name = excluded.name`)로 바뀐다
  - commit이 움직이지 않은 저장소는 sha short-circuit 때문에 `hooks`로 남는다
  - 즉시 일괄 반영은 하지 않았다(운영 데이터 변경 금지)

### 4.3 NO CHANGE 항목

| 항목 | 판정 근거 |
|---|---|
| MCP 설명 부재 (14/25) | `.mcp.json`에는 산문이 없다. null을 "설명 없음"으로 정직하게 표시하고 있다. server.json 항목은 설명이 있다 |
| 품질 규칙 20개 | 위반 7 + 관찰 13이 identity, provenance, read date, partial, 분석 미실행을 다룬다. 이번에 발견한 C-1은 규칙 위반이 아니라 이름 품질 문제라 규칙을 추가하지 않았다. 운영 결과는 **NOT RUN** |
| NOT_ANALYZED / ABSENT 구분 | 바꾸지 않았다. capability 필터는 계속 `analyzed_at is not null`을 요구한다(`search.ts`의 `capabilityAbsence`) |

## 5. Search (Phase 19)

### 5.1 고정 검색어 (운영, 변경 전)

검색어 34개와 파라미터 사례 8개를 고정했다. 원본 JSON은 세션 scratchpad에만 있다(`search-baseline-prod.json`).

| 검색어 | 결과 수 | 비고 |
|---|---|---|
| playwright | 35 | 1위 `playwright` command, 2위 plugin |
| claude code | 725 | |
| mcp server | 292 | |
| security | 469 | |
| browser automation | 35 | |
| code review / Code Review / code_review | 268 | 대소문자와 구분자가 달라도 같은 결과 |
| code-review | 268 | 순서만 다름. exact name 우선 |
| observability | 108 | |
| postgres | 46 | |
| frontend-design | 59 | |
| systematic-debugging | 14 | |
| pdf | 59 | |
| context7 | 24 | |
| github | 162 | |
| debug | 188 | |
| brainstorm | 40 | |
| slack | 17 | |
| kubernetes | 64 | |
| terraform | 14 | |
| superpowers | 17 | |
| git commit message | 5 | |
| react component testing | 8 | |
| database migration | 28 | |
| docker compose | 8 | |
| jira | 11 | |
| `@playwright/mcp` | 5 | |
| `c++` | 58 | `c`로 축약됨. index 한계 |
| **node.js** | **2** | 둘 다 Node.js와 무관한 행 |
| `번역` / `코드 리뷰` / nonexistent | 0 | 빈 결과 안내와 필터 해제 링크가 표시됨 |
| `type=foo` / `cap=bar` / `page=-1` / `sort=zzz` | 7,273 | 무시하고 기본값 사용 |

추가 측정: `next.js` 202건, `three.js` 81건, `socket.io` 40건. 이 결과들은 `next`·`three`·`socket`과 `js`·`io`가 따로 나타나는 행이다.

### 5.2 S-1 점이 든 단어

- **원인 (로컬 PostgreSQL 17에서 확인)**
  - `to_tsvector('english','Use Node.js')` → `'node.js'`. parser는 이를 `host` token 1개로 만든다
  - `plainWords`는 질의를 글자와 숫자 덩어리로 쪼개 `node & js`를 만든다. 이 질의는 `'node.js'` lexeme과 맞지 않는다
  - path column(C)은 '.'을 공백으로 바꿔 저장하므로 `SKILL.md`는 `skill`, `md` 두 lexeme으로 남는다
- **변경 파일**
  - `src/db/queries/search.ts`: `tsQuery`
  - `search.test.ts`: 1건
  - `search.eval.test.ts`: 사례 2건, BASELINE, PINNED
- **로직**
  - 점으로 이어진 덩어리는 `(node.js | node <-> js)`로 만든다
  - 앞쪽은 본문과 이름의 host lexeme에 맞고, `<->`는 path의 인접한 조각에 맞는다
  - 마지막 덩어리에는 prefix를 적용한다(`next.j` → `next.j:*`)
  - websearch 문법이 든 질의는 기존 경로를 그대로 탄다
  - to_tsquery에 들어가는 입력은 글자와 숫자, 그 사이의 점, 이 함수가 쓴 연산자뿐이다
- **변경 후 (로컬)**

  | 질의 | 변경 전 | 변경 후 |
  |---|---|---|
  | 합성 `xqnode.js` | `xqgraph`(무관한 행) | `xqserver`. 기존 코드에서 실패 확인 |
  | fixture `node.js` | `baoyu-electron-extract`(무관) | `release-skills`("Supports Node.js") |
  | fixture `p5.js` | 2건 | `algorithmic-art` 1건 |

- **회귀 검사**
  - 기존 평가셋 50건은 변경 전후 사례별 출력(total, 첫 relevant 순위, top3)이 byte 단위로 같다
  - 52건 기준 평균

    | 코드 | MRR | NDCG@10 |
    |---|---|---|
    | 변경 전 | 0.906 | 0.885 |
    | 변경 후 | 0.927 | 0.907 |

  - PINNED는 0.927 / 0.906으로 올렸다
  - 로컬 latency p50: 3.7 ms(변경 전) → 2.5–3.0 ms(변경 후). 측정 잡음 범위이며 악화는 없다
- **남은 제약**
  - `c++`, `c#`은 parser가 `c`로 줄여 index에 넣으므로 질의만으로는 구분할 수 없다
  - `nextjs`처럼 점 없이 쓴 표기는 별개 lexeme이라 맞지 않는다
  - 두 경우 모두 index 표현을 바꿔야 하므로(generated column 변경, migration 필요) 범위에서 제외했다

### 5.3 저장소 설명과 topic 검색: NO CHANGE

- 평가셋의 `repo-description`(rr 0.083)과 `repo-topic`(0건)은 알려진 miss다.
- search_vector는 `package` 테이블의 generated column이라 `repository` 열을 참조할 수 없다.
- 해결하려면 schema를 바꿔야 하므로 "불필요한 schema 변경 금지" 조건에 따라 보류했다.

### 5.4 Pagination, 정렬, 필터: NO CHANGE

| 근거 | 내용 |
|---|---|
| 직전 운영 검증 | 정렬 4종 모두 1–2쪽 겹침 0. 291쪽이고 마지막 쪽 23건. 잘못된 파라미터는 기본값으로 대체 |
| 기존 테스트 | 페이지 합 = count, 정렬마다 빠짐과 중복 없음, 필터 조합의 count와 행 일치, 분석 안 된 행을 absence 필터에서 제외 |
| 결과 | 변경 후 같은 테스트 전부 통과 |

### 5.5 UX: NO CHANGE (S-1과 C-1로 개선된 부분 제외)

운영 HTML에서 다음을 확인했다.
- 검색어 유지(`value=`)
- 활성 chip(`aria-current`)
- 필터를 바꾸면 page 파라미터 초기화
- 결과 수와 "Showing x–y"
- 빈 결과에서 필터별 해제와 Clear all
- capability 필터의 관찰 범위 안내
- 행마다 "source on GitHub" permalink
- 320px E2E 4건 통과

취향 수준의 변경은 하지 않았다. hook 목록의 이름 반복은 C-1로 해소된다.

## 6. 검증 (실제 출력)

| 명령 | 결과 |
|---|---|
| `bun run check:boundaries` | OK (migration 11개, source 100개, UI 32개) |
| `bun run lint` | 230 files, No fixes applied |
| `bun run typecheck` | 오류 0 |
| `CI=1 bun --no-env-file run test` (TEST_DATABASE_URL=로컬) | **79 files passed, 1 skipped · 1475 passed / 3 skipped** |
| `bun --no-env-file run test` (CI 미설정) | 1475 passed, **1 failed**: `src/github/permalink.test.ts` live test가 미인증 rate limit(0/60)으로 실패. CI에서는 skip되는 테스트이고 이번 변경과 무관 |
| `bun run search:eval` | 54/54, MRR 0.927, NDCG@10 0.907 |
| `bun run build` (placeholder DATABASE_URL) | 성공 |
| `bun run e2e:seed` + `bun run test:e2e` | **25 passed** |
| migration | 추가 없음. 로컬 이력 11건 그대로 |

- 서버 로그의 "destination stream closed early"는 a3efd28 CI 로그에도 13회 있었다. 기존 현상이다.
- 운영 대상 검증은 하지 않았다(NOT RUN): 운영 DB의 preflight/status/quality, 운영 Sync, 운영 EXPLAIN.

## 7. 영향 범위와 배포

| 대상 | 영향 |
|---|---|
| DB schema / migration | 없음 |
| Search API, URL | 계약은 그대로. 점이 든 질의의 결과 집합만 달라진다(S-1) |
| Web (Vercel) | `search.ts` 변경이 배포 즉시 적용된다 |
| Sync (Actions) | `seeds.ts`, `hook.ts` 변경은 push 후 첫 예약 Sync부터 적용된다. workflow 변경 없음 |
| 기존 데이터 | hook 이름은 저장소를 새 commit으로 다시 읽을 때 바뀐다. 다른 열은 변경 없음 |
| Permalink | 변경 없음 |

- **배포 순서:** 특별한 순서는 없다. develop에 push하면 CI → Deploy 경로를 탄다. migration이 없으므로 gate는 UP_TO_DATE로 끝날 것이 예상된다(미실행).
- **Rollback:** commit을 revert하면 된다.
  - 새 이름이 붙은 hook 행은 구버전 코드가 다음에 다시 읽을 때 `hooks`로 돌아간다
  - seed 순서와 검색은 상태를 남기지 않는다
- **배포 후 확인 (PENDING)**
  - 첫 예약 Sync의 jobId 67–100 구간 outcome (D-1)
  - `/artifacts?q=node.js` 결과 (S-1)
  - `/artifacts?type=hook` 이름 분포 (C-1)

## 8. 권고 (미구현)

1. D-1을 운영에서 확인한 뒤 enqueue와 refresh 상한을 다시 정한다. 근거는 §3.5의 시간 여유 약 1100초와 core 8%다.
2. registry seed가 계속 대기하면 registry 전용 fan-out 그룹을 둔다(D-1의 `ponytail:` trigger).
3. 운영 quality:check와 ops:status는 승인 후 실행한다. 절차는 직전 문서 §16에 있다.
4. 같은 이름의 미러 사본(예: `plugins/claude/…`, `plugins/codex/…`)을 묶어 보여줄지는 UX 결정 사항이다. 지금은 identity가 정확하므로 그대로 둔다.
