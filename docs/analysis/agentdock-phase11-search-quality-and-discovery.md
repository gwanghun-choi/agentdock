# AgentDock Phase 11 — 검색 품질 및 Artifact Discovery

작성일 2026-10-22 · 기준 HEAD `7a7178b` · 미커밋 · 모든 측정은 로컬에서 실행: PostgreSQL 17(pg_trgm 설치) Docker `agentdock-testdb`, loopback 55432, DB `agentdock_test`. Production DB, Neon, Vercel, GitHub Actions는 건드리지 않았다.

표기 규칙: **실측**은 이 문서 작성 중에 실행한 명령의 출력이다. **추정**이라고 적은 항목은 측정하지 않았다.

## 1. Executive Summary

- 외부 서비스, LLM, 벡터 DB, 새 인덱스, migration 없이 PostgreSQL FTS와 pg_trgm 구조를 그대로 두고 다음을 고쳤다.
- **평가셋을 21개에서 50개 질의로 늘렸다(정답 있는 질의 45개).** 같은 평가셋으로 변경 전후를 측정했다(실측).

| 지표 | Before | After |
|---|---|---|
| MRR | 0.913 | **0.924** |
| NDCG@10 | 0.894 | **0.903** |
| Top-1 | 0.889 | **0.911** |

- **랭킹 신호를 하나 추가했다.** 이름에 검색어 단어가 있으면 가산점(`nameWordBonus` 0.5)을 준다.
- **불용어만 있는 질의의 trigram fallback을 막았다.** `the`의 결과가 50행에서 0행으로 줄었고, 16,400행 규모에서 걸리던 423 ms도 사라졌다.
- **새 기능 3가지**
  - 정렬: 관련도, 최근 색인, 이름
  - 일치 이유: 행마다 "Matched in name, path, description"
  - 검색어 강조: `ts_headline`과 제어문자 구분자, React `<mark>` 노드
- **Playwright E2E 15개를 CI의 `e2e` job으로 편입했다.** 로컬에서 3회 연속 15/15 통과했다. GitHub Actions에서 실제로 돌린 적은 없다(NOT RUN).
- **판정: CONDITIONAL.** 로컬 기준으로는 READY다. 운영 데이터 분포에서의 품질과 실제 CI 실행은 확인하지 못했다.

## 2. 현재 Search Architecture

GET form과 링크만 쓰는 Server Component 구조이며, 검색 경로에 client component는 없다.

검색 요청 1건은 statement 2–3개다.
1. `searchMode`: 여러 단어 질의만 실행한다. `EXISTS LIMIT 1`.
2. `searchPackages`: 결과가 0행이고 첫 페이지일 때만 이어서 `fuzzySearch`를 실행한다.
3. `countSearchResults`

2와 3은 병렬로 실행한다. Phase 11에서 statement 수는 바뀌지 않았다.

## 3. Search Source Map

```
#q (GET form, src/app/artifacts/page.tsx)  ─ 칩, 정렬, 페이지는 <Link>
  ↓ ?q, type, cap, sort, page             searchHref (src/components/searchState.ts): 한 상태에 URL 하나
  ↓ ArtifactsPage                         normalizeQuery, parseTypeFilter, parseCapabilityFilter, parseSort, pageParam(zod)
  ↓ searchMode                            plainWords → 'all' 결과가 없으면 'any'
  ↓ searchPackages / countSearchResults   searchWhere(q, filters, mode): 두 쿼리가 같은 WHERE를 쓴다
      ├ search_vector @@ tsQuery          generated tsvector (A name, B summary, C path, D type), GIN package_search_vector_idx
      ├ OR repository.full_name ILIKE     3글자 이상일 때만
      ├ NOT_LISTED_BECAUSE is null        fork / unparsed / duplicate (packages.ts)
      ├ type IN (...)                     ARTIFACT_TYPE_IDS 닫힌 집합
      └ CAPABILITY_PREDICATES             no_network / no_shell / no_scripts
  ↓ rankExpr                              exact 2.0 + prefix 1.0 + nameWord 0.5 (신규) + ts_rank + repo 0.1 + path 1.0('/' 질의만)
  ↓ orderFor(sort)                        모든 정렬의 마지막 키가 id(PK)
  ↓ 0행이고 첫 페이지일 때 fuzzySearch     public.word_similarity / <%, package_fuzzy_trgm_idx
  ↓ PackageRows                           Marked(name, summary, path), MatchWhy
```

- **오류 처리**
  - 잘못된 질의는 오류가 아니라 0건으로 처리한다.
  - pg_trgm이 없을 때 나는 오류(42883)만 fuzzy 경로에서 잡는다.
  - 연결 오류는 `error.tsx` boundary가 처리한다.

## 4. 기존 Ranking 분석

- Phase 6의 D-12 신호에 pathBonus를 더한 합계다.
- stars, capability, parse_status는 순위 입력이 아니다(AGENTS.md).
- **`ts_rank`의 약점**
  - 정규화를 쓰지 않아 요약에 단어가 반복되면 점수가 올라간다.
  - 그래서 이름에 단어가 한 번 있는 행(A 가중치)이 요약에 같은 단어가 여러 번 있는 행(B 가중치)에 밀릴 수 있다.
  - 예: `image generation`에서 baoyu-danger-gemini-web가 0.993, baoyu-image-gen이 0.980이었다(실측).
- **`ts_rank_cd`는 대안이 아니다.** 같은 예에서 gemini-web 2.21, image-gen 0.77로 차이가 오히려 커졌다(실측).
- **`ts_rank` 정규화 옵션 1(로그 길이)도 순위를 뒤집지 못했다.** 0.169 대 0.159였다(실측).

## 5. Evaluation Dataset (`src/db/queries/search.eval.test.ts`)

- **Corpus 164행(실측)**
  - fixtures/의 실제 파일을 실제 detector로 파싱한 155행
  - 합성 행 9개: 기존 agent 6개, 신규 agent 2개(`.claude/agents/backend-reviewer.md`, `plugins/security/agents/auditor.md`), MCP 1개(`plugins/github/.mcp.json`, summary null)
- **질의 50개.** 기존 21개에 29개를 더했다. 추가한 유형:
  - agent 정확한 이름과 경로, plugin 안의 agent 경로, 디렉터리 경로
  - plugin 이름 2개, MCP 이름과 type
  - 대문자, 대소문자 혼합, `_`↔`-` 치환, `_`가 든 이름, 하이픈 대신 공백 3개
  - 자연어 2개, 여러 단어, 103자 질의, 특수문자, 마크업
  - 불용어, 결과 없음, 동명 artifact 2개, CJK 1개, 하이픈이 든 저장소 이름, type 필터와 결합한 설명 검색
- **정답 정의**
  - 2026-10-22에 이름과 요약만 보고 사람이 판정했다.
  - 현재 검색 결과를 정답으로 삼지 않았다.
  - `relevant`가 비어 있는 5개(`short`, `korean`, `markup`, `stopword-only`, `no-result`)는 음성 질의다. 이 질의들은 지표 평균에 넣지 않고, 결과가 나온 질의 목록을 따로 보고한다.
- **평가 데이터를 바꾼 곳 1건:** `mcp` 질의의 정답에 새 MCP 행을 넣었다. 이유는 corpus에 MCP server 행이 생겼고, `mcp`를 검색하는 독자가 가장 먼저 찾는 대상이 그 행이기 때문이다.
- **지표 정의.** 이진 관련도를 쓴다. Recall과 NDCG의 분모는 반환된 행이 아니라 corpus 전체의 정답 수다.
- **지표 계산 검증.** `caseMetrics` 단위 테스트가 확인한다.

## 6. Baseline (HEAD 코드, 같은 50개 질의, 실측)

| 지표 | 값 |
|---|---|
| P@5 / P@10 | 0.329 / 0.200 |
| Recall@10 | 0.883 |
| MRR | 0.913 |
| NDCG@10 | 0.894 |
| Top-1 | 0.889 (40/45) |
| Zero Result Rate (정답 있는 질의) | 0.044 (2/45: `typo-2`, `repo-topic`) |
| 결과가 나온 음성 질의 | short 7, markup 6, **stopword-only 50**, no-result 1 |
| latency p50 / p95 | 5.96–6.24 ms / 8.6–10.9 ms (질의 50개 × 20회 = 1,000회, 3회 반복) |

P@5가 낮은 것은 정답이 1개인 질의가 대부분이기 때문이다. 이런 질의는 P@5의 최대값이 0.2다. 이 지표는 비교용으로만 본다.

## 7. 발견한 품질 문제

| # | 질의 | 문제 | 원인 | 조치 |
|---|---|---|---|---|
| Q1 | `image generation` | 정답이 2위 | 요약의 단어 반복이 이름 일치를 이김(§4) | nameWordBonus |
| Q2 | `the`, `and the` | "close matches" 50행 | 불용어만 있으면 tsquery가 비어 FTS가 0행 → trigram 실행 | `numnode(tsquery) > 0` guard |
| Q3 | `hooks mastery`, `sdlc` | 12위 / 0건 | 저장소 description과 topic은 검색 대상이 아님 | **보류**(§22) |
| Q4 | `微信` | 2위 | `english` parser가 CJK를 한 토큰(`微信公众号`)으로 묶어 FTS가 0건, trigram 순위 | 보류. PostgreSQL에 CJK parser 없음 |
| Q5 | `brainstroming` | 0건 | 전치 오타의 word_similarity가 0.556으로 기준 0.6 미만 | 보류. 근거는 Phase 6 그대로 |
| Q6 | `git commit push` | NDCG 0.469 | 모든 단어 일치(`all`)가 1행이면 완화하지 않음 | 보류. 완화 규칙을 바꾸면 count 의미가 바뀜 |
| Q7 | 검색어 없는 browse, 16,400행 | 89 ms + 85 ms | `NOT_LISTED_BECAUSE`의 duplicate 판정을 행마다 실행 | Phase 11 범위 밖. 기록만 |

구분자 정규화(`frontend design`과 `frontend-design`을 같은 이름으로 보는 처리)도 검토했다. 평가셋 질의 3개 모두 이미 1위여서 효과가 없었기 때문에 넣지 않았다.

## 8. Ranking 개선 설계

- **`nameWordBonus = 0.5`**
  - 조건: `ts_filter(search_vector, '{a}') @@ matchQuery`. 이름 가중치(A) 자리에 검색어 단어 하나가 lexeme(또는 마지막 단어의 prefix)으로 있으면 적용한다.
  - 위치: prefixNameBonus(1.0)와 pathBonus(1.0)보다 낮다. 두 행이 모두 일치할 때의 ts_rank 차이(0.99 대 0.98)보다는 크다.
- **가중치 sweep (50개 질의, 실측)**

| 가중치 | MRR | NDCG@10 | 비고 |
|---|---|---|---|
| 0.2 / 0.3 / 0.5 | 0.924 | 0.903 | 같음 |
| 0.8 / 0.99 | 0.913 | 0.898 | `.claude/commands` 질의에서 "Command Development" skill이 경로 일치 행들을 앞지름 |

## 9. Query 및 SQL 변경 (`src/db/queries/search.ts`)

- **신규 함수**
  - `matchQuery`: 설명과 강조에 쓰는 질의. 모든 단어를 OR로 묶는다. websearch 문법은 입력한 그대로 둔다.
  - `nameWordHit`: 랭킹과 일치 이유가 함께 쓰는 하나의 조건식
  - `matchedIn`
  - `marked`
  - `orderFor`
- **`fuzzySearch`**
  - `numnode(tsQuery(q,'all')) > 0` 조건을 넣었다.
  - 정렬 인자를 받는다.
- **WHERE(`searchWhere`)와 count는 바꾸지 않았다.** 그래서 공개 정책(`NOT_LISTED_BECAUSE`)과 Count/List 정합성이 그대로다.

## 10. Sort 설계

- **값.** `SEARCH_SORTS = ['relevance','recent','name']`
  - `recent`는 `package.updated_at desc, id`다. 기존 browse 순서와 같다. 스캔이 새 commit에서 그 행을 쓴 시각이다.
  - `name`은 `lower(name), id`다.
  - stars 정렬은 넣지 않았다(AGENTS.md).
- **기본값**
  - 검색어가 있으면 `relevance`, 없으면 `recent`다.
  - 검색어 없이 `relevance`를 요청하면 기본값으로 바꾼다. 모든 행이 같은 점수라 `recent`와 같은 결과가 되기 때문이다. 이때 UI에도 relevance 링크를 보이지 않는다.
- **URL**
  - 파라미터 순서는 `q, type, cap, sort, page`로 고정한다.
  - 기본 정렬은 URL에서 생략한다. 그래서 정렬 기능이 생기기 전의 URL도 같은 상태를 가리킨다.
  - 정렬을 바꾸면 1페이지로 돌아간다. 필터 칩, pager, 적용 필터 해제, 새 검색어 제출(hidden input) 모두 정렬을 유지한다.
  - 잘못된 값(`sort=stars`)은 기본값으로 바꾼다.
  - 정렬 파라미터가 있으면 noindex다.
- **Stable ordering.** 모든 정렬이 PK로 끝난다. 30행을 두 페이지로 나눴을 때 세 정렬 모두 빠지거나 중복된 행이 없었다(DB 테스트).

## 11. Match Reason

- **표시하는 필드와 판정 조건**

| 표시 | 조건 |
|---|---|
| name | 이름 가중치(A)에 일치하거나 이름 prefix LIKE |
| path | 경로 가중치(C)에 일치하거나, `/` 질의에서 경로 substring LIKE |
| description | 요약 가중치(B)에 일치 |
| type | type 가중치(D)에 일치 |
| repository | 3글자 이상일 때 `full_name ILIKE`. WHERE가 이 조건을 검사할 때만 표시한다 |

- **표시 순서:** name → path → description → type → repository
- **판정 근거.** 모든 조건을 PostgreSQL이 그 행에서 참으로 평가한 결과다. 페이지가 텍스트를 보고 다시 추측하는 것이 아니다.
- **표시하지 않는 경우:** 검색어 없는 browse, trigram fallback 행. fallback은 결과 표시줄에 "Close matches"라고 이미 나온다.
- **비용**
  - `ts_filter`는 저장된 tsvector에 대한 연산이다(procost 1).
  - 실행 계획상 Sort 뒤 Result 노드에서 페이지의 25행에만 계산된다.

## 12. Highlight

- **비교한 방법**
  - 앱에서 substring을 찾는 방식은 stemming과 맞지 않는다. 예: `debuging` 질의와 "Debugging", `image` 질의와 "images".
  - `ts_headline`을 쓰면 검색과 같은 parser와 stemmer를 쓴다.
- **채택한 방식**
  - `ts_headline('english', translate(col, E'\x02\x03', ''), matchQuery, 'StartSel=\x02, StopSel=\x03, HighlightAll=true')`
  - 원문에 있던 구분자 문자를 먼저 지운다. 그래서 출력에 있는 구분자는 모두 ts_headline이 넣은 것이다.
  - `markedSegments`가 결과를 텍스트와 `<mark>` React 노드로 나눈다.
  - 여닫음이 짝이 맞지 않으면 구분자를 지운 평문을 그대로 보여준다.
  - `dangerouslySetInnerHTML`도, 마크업 문자열 생성도 없다.
- **검증**
  - HighlightAll은 탭, 줄바꿈, 이중 공백을 보존하고 `<b>`를 문자 그대로 돌려줬다(실측).
  - 단위 테스트: `<b>x</b> & "q" <script>`가 이스케이프되어 렌더된다.
  - DB 테스트: 원문에 위조 구분자를 넣어도 표시가 생기지 않는다.
  - E2E: `<script>` 질의에서 dialog가 0건이다.
- **경로 강조.** `/` 질의에서만, SQL LIKE와 같은 의미의 대소문자 무시 substring으로 표시한다.
  - 소문자로 바꾸면 길이가 달라지는 문자열(예: `İ`)은 표시하지 않는다.
  - FTS로만 일치한 경로(가중치 C)는 강조하지 않는다. 원래 경로 문자열과 tsvector 토큰 위치가 맞지 않기 때문이다. 이 경우에는 "Matched in path" 문장만 나온다.
- **성능.** ts_headline(procost 100)은 Postgres가 Sort/Limit 뒤로 미룬다.
  - 16,400행, `code review`에서 Sort가 끝나는 18.714 ms부터 Result가 끝나는 19.044 ms까지, 25행 투영에 0.33 ms가 걸렸다(실측 plan).

## 13. UI 변경

- **결과 표시줄 아래 `nav.facet.sort`**
  - Phase 10 칩 스타일을 재사용했다. 링크이며 `aria-current`로 현재 정렬을 표시한다.
  - 모바일에서는 줄이 바뀌어도 가로로 넘치지 않는다.
- **행 표시**
  - `<mark>`: `--accent-soft` 배경, 굵기 600, `--fg-strong`. 색만으로 구분하지 않는다.
  - 메타 줄 앞에 `.row-why`를 넣었다.
- **결과 0건 화면.** 필터가 있고 검색어도 있으면 "Clear search"(필터는 유지)를 보여준다.
- **client component.** 새로 만든 것이 없다(`Marked`는 server component). 4개 그대로다.

## 14. PostgreSQL Query Plan (16,400행 복제 corpus, `EXPLAIN (ANALYZE, BUFFERS)`, 실측)

복제 corpus는 eval corpus를 100배로 늘린 것이다. 저장소 700개이고, 행마다 content_hash가 달라 duplicate로 판정되지 않는다.

| 질의 | rows Before | rows After | count Before | count After |
|---|---|---|---|---|
| pdf | 11.6 ms | 13.7 ms | 11.1 | 12.1 |
| code review | 18.2 | 18.8 | 15.9 | 17.3 |
| skills/pdf | 12.3 | 14.7 | 11.5 | 13.4 |
| debuging | 19.4 | 21.2 | 16.5 | 20.6 |
| hooks mastery (any) | 18.4 | 20.8 | 16.2 | 18.0 |
| (browse) | 89.1 | 93.7 | 85.2 | 88.6 |
| the: FTS / fuzzy | 8.8 / **422.8** | 15.0 / **0.05** | 8.8 | 9.9 |

- **계획 구조는 변경 전과 같다.**
  - `Seq Scan on package` → Hash Join → Join Filter에서 `search_vector @@ … OR full_name ILIKE …` → top-N heapsort → Limit → Result
  - FTS와 저장소 이름을 OR로 묶은 조건이 서로 다른 테이블에 걸쳐 있어 GIN 인덱스를 쓰지 않는다. 이것은 기존 동작이다.
- **count 열도 같이 늘었다(+1–4 ms).** count에는 새 식이 없다. 따라서 두 측정 사이의 시간 차이는 측정 잡음과 같은 크기로 본다(추정).
- **Before와 After는 별도 세션에서 측정했다.**

## 15. Index 영향

- 새 인덱스와 migration은 0건이다. Write overhead 변화도 없다.
- 로컬 `agentdock` schema(175행) 기준 크기: `package_search_vector_idx` 288 kB, `package_fuzzy_trgm_idx` 1,424 kB, `package` 536 kB.
- GIN을 쓰도록 쿼리를 바꾸는 것(OR 분리, UNION)은 16k행에서 20 ms 수준이라 하지 않았다. 다시 볼 조건은 §22에 있다.

## 16. Precision / MRR / NDCG 비교 (50개 질의, 실측)

| 지표 | Before | After |
|---|---|---|
| P@5 | 0.329 | 0.329 |
| P@10 | 0.200 | 0.200 |
| Recall@10 | 0.883 | 0.883 |
| MRR | 0.913 | **0.924** |
| NDCG@10 | 0.894 | **0.903** |
| Top-1 | 0.889 | **0.911** |
| Zero Result Rate | 0.044 | 0.044 |
| 결과가 나온 음성 질의 | short, markup, stopword-only(50), no-result | short, markup, no-result |

- **결과가 바뀐 질의는 2개다.**
  - `description-phrase`: 2위 → 1위
  - `stopword-only`: 50행 → 0행
- **나머지 48개는 출력이 같다.**
- **회귀 방지**
  - 테스트가 질의별 첫 정답 순위와 total 상한(2배)을 고정했다.
  - 평균 MRR ≥ 0.924, NDCG@10 ≥ 0.902도 고정했다.
  - HEAD 코드에서 이 테스트를 돌리면 3건이 실패한다(Q1, Q2, 평균 하한).

## 17. Latency 비교 (164행 eval corpus, 질의 50개 × 20회, 실측)

| | 1회 | 2회 | 3회 |
|---|---|---|---|
| Before p50 / p95 (ms) | 6.24 / 10.13 | 6.05 / 10.93 | 5.96 / 8.65 |
| After p50 / p95 (ms) | 6.52 / 11.28 | 6.08 / 9.11 | 6.18 / 10.40 |

- **측정 방법**
  - HEAD 사본(`git archive`)과 작업 트리를 같은 DB에서 번갈아 실행했다.
  - 실행 전에 VACUUM ANALYZE를 했다.
- **결과.** p50이 +0.03–0.28 ms다. p95는 범위가 겹친다.
- **측정 오류 1건.** 처음 측정한 7.8 ms는 16,400행을 지운 직후의 dead tuple 때문이었다. VACUUM 뒤 다시 쟀다.
- **query 수.** 요청당 2–3개로 같다. `the`에서는 fuzzy statement가 즉시 끝난다.

## 18. E2E CI

- **구성**
  - `@playwright/test` 1.64.1 (devDependency 1개, `--exact`)
  - `playwright.config.ts`: workers 1, CI retries 1. 재시도에서 통과하면 flaky로 표시해 환경 불안정과 실제 회귀를 구분한다. trace는 실패한 경우만 남긴다.
  - 서버: `webServer`가 standalone build를 띄운다. `TEST_DATABASE_URL`이 허용 목록을 통과하지 못하면 설정 파일 단계에서 throw한다.
  - `e2e/seed.mjs`: fixture 7개와 `e2e/fixtures/ui-edge-cases`(agent 3, MCP, plugin+agent+skill, 87자 이름)를 실제 pipeline으로 offline seed한다. Neon 주소는 거부한다(실측).
  - `e2e/journeys.spec.ts`의 15개 여정: 검색, type, capability, 정렬, pagination, 강조와 이유, 마크업 질의, 빈 결과, 상세와 Back과 공유 URL, subagent와 plugin 관계, 키보드, 잘못된 파라미터와 noindex, 모바일 2개
- **CI**
  - `.github/workflows/ci.yml`에 `e2e` job을 추가했다.
  - Postgres service, migrations, seed, build, 브라우저 cache(`bun.lock` 해시 키), `install --with-deps --only-shell chromium`, test 순서로 돈다. 실패하면 trace를 7일 동안 보관한다.
  - deploy.yml은 CI 전체가 성공한 경우에만 시작하므로, E2E 실패가 배포를 막는다.
- **비용 (로컬 실측)**

| 항목 | 값 |
|---|---|
| 브라우저 | 273 MB, 다운로드 6.4 s |
| build | 6.6 s |
| seed | < 2 s |
| E2E 15개 | 6.8 / 7.0 / 7.5 s (3회 연속 15/15) |

- **공개 저장소라 Actions 표준 runner 사용량은 과금되지 않는다(추정, GitHub 정책 기준).**
- **회귀 감지 확인.** 같은 spec을 HEAD 빌드에 돌리면 7 PASS / 8 FAIL이다. 실패 8개는 모두 Phase 11 기능(정렬, 강조, 불용어, Clear search)이다.
- **NOT RUN**
  - GitHub Actions에서의 실행(push 금지 조건)
  - DB 장애 E2E(Phase 10 #15b). TCP proxy가 필요해 CI에 넣지 않았다.
  - 클립보드 E2E

## 19. 전체 회귀 테스트 (실측)

| 항목 | 결과 |
|---|---|
| check:boundaries | OK (94 source, 30 UI) |
| lint (217 files) | PASS |
| typecheck | PASS |
| `CI=1 bun run test` (TEST_DATABASE_URL) | **73 passed / 1 skipped files, 1390 passed / 3 skipped** (Phase 10: 1345, +45) |
| 같은 명령, DB 없이 | 1012 passed / 381 skipped |
| build / `VERCEL=1` build / docker build | PASS / PASS / PASS |
| E2E (Playwright, CSP 적용) | 15/15 × 3 |
| 측정 95회 (19개 화면 × 5 viewport) | overflow 0, axe 0, 터치 영역 24px 미만 3(기존 task checkbox, Before와 같음), CLS 최대 0.0331(같음), 첫 JS 136.4 KB(같음), 검색 문서 +2.2–2.7 KB |
| `next-env.d.ts` | 변화 없음 |

`skip 3`은 Phase 10과 같은 항목이다. pg_trgm이 없는 환경을 가정한 경로 등이다.

## 20. 남은 위험

1. **운영 데이터 분포에서의 품질은 측정하지 않았다.**
   - 평가 corpus는 164행이고 저장소 7개다.
   - 운영의 이름과 요약 분포에서 nameWordBonus가 일으킬 부작용은 알지 못한다. 예: 흔한 단어가 이름에 들어간 artifact가 위로 올라오는 경우.
2. **표시줄 문구가 실제 일치 방식보다 넓게 보일 수 있다.** `matchedIn`은 OR 질의 기준이라, `code review`처럼 모든 단어 일치(all 모드)로 찾은 행도 단어별로 필드를 표시한다. 문구는 "검색어 단어가 이 필드들에 있다"라는 사실이며 거짓은 아니다.
3. **E2E를 CI에서 실행한 적이 없다.** runner의 apt 의존성 설치 시간과 cache 동작을 확인하지 못했다.
4. **CI 시간이 늘어난다.** e2e job이 build를 한 번 더 한다. 병렬 job이라 전체 시간 증가는 추정 1–2분이다.
5. **CJK 검색, 저장소 description과 topic 검색, 전치 오타는 그대로다.**

## 21. 배포 및 Rollback

- **배포.** migration이 없어서 기존 Phase 9 경로(push → CI → deploy.yml)로 그대로 반영된다. 이번 변경으로 CI에 e2e job이 추가된다.
- **Rollback**
  - commit을 되돌리면 된다. DB 상태는 바뀌지 않는다.
  - 정렬 URL(`sort=`)은 되돌린 코드에서 무시된다. 알 수 없는 파라미터라 기본 순서로 나온다.

## 22. 후속 개선 제안

- **저장소 description과 topic 검색**
  - 저장소 단위로 일치하면 그 저장소의 artifact 전체가 결과에 들어간다.
  - 운영 description에는 "Claude Code", "skills" 같은 흔한 단어가 많아 결과 수가 크게 부풀 위험이 있다.
  - 운영 검색 로그(DIS-08)로 빈도를 본 뒤 결정한다.
- **완화 규칙 확장.** `all` 결과가 적을 때 `any` 결과를 뒤에 붙이는 방식이다. count의 의미와 안내 문구를 함께 바꿔야 한다.
- **GIN 활용.** browse·count가 100 ms를 넘거나 corpus가 5만 행을 넘으면, `search_vector @@`와 저장소 조건을 UNION으로 분리하는 방식을 측정한다.
- **E2E 확장.** 첫 CI 실행 시간을 보고 job 범위를 조정한다(path filter 등). DB 장애 시나리오도 추가한다.

## 23. 최종 판정

**CONDITIONAL.**

- 로컬 기준으로는 READY다. 위의 실측 검증을 모두 통과했다.
- 조건은 두 가지다.
  - 첫 CI에서 `e2e` job이 실제로 통과하는지 확인
  - 운영 반영 뒤 검색 로그로 nameWordBonus의 부작용 관찰
- Migration은 없다. Commit, Push, 배포는 하지 않았다.
