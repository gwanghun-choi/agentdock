# AgentDock Phase 65: 중국어 기본 제외 SQL 성능 최적화

작성일 2026-10-27, 기준 commit `b6b31e7`(develop). 변경은 모두 미커밋 상태다.

표기:
- FACT: 이번 작업에서 실행·측정한 결과
- INFERENCE: 근거에서 추론한 판단
- PENDING: 운영 반영 뒤에야 확인할 수 있는 항목
- NOT RUN: 실행하지 않은 항목

---

## 1. 작업 목적

Phase 64(§27, `agentdock-phase60-63-visual-and-language.md`)에서 운영 `/artifacts` 기본 목록이 `lang=any`보다 p50 약 430ms 느리다는 것을 확인했다. 원인은 조회마다 반복되는 언어 분류 SQL이었다.

이번 Phase의 목표는 세 가지였다.
- DB migration, schema 변경, 새 인덱스 없이 이 비용을 소스 수준에서 줄인다.
- 언어 판정 결과는 행 단위로 그대로 유지한다.
- 실측으로 확인된 개선만 반영한다.

Phase 64 기준값(이번 측정과 섞지 않는다):

| 항목 | Phase 64 값 |
| --- | ---: |
| 운영 commit | `048023a` |
| 운영 `/artifacts` p50 | 1,628 ms |
| 운영 `lang=any` p50 | 1,204 ms |
| 같은 라운드 차이 | +430 ms (245회, 실패 0) |
| 로컬 기본 count / `lang=any` count | 148 / 92 ms |
| CJK 포함 행 / 중국어 숨김 대상 | 1,132 / 609 |

## 2. 기준 HEAD와 Git 상태 (FACT)

- branch `develop`, HEAD `b6b31e721ebc977d7bf967e30f2c739a0804894f`, worktree 1개, stash 0개.
- 작업 시작 시 미커밋 변경은 없었다.
- 작업 후 변경 파일은 `src/db/queries/language.ts`, `src/db/queries/language.test.ts`와 이 보고서다.

## 3. 현재 SQL 구조

### 3.1 Graphify로 추적한 경로

그래프(`~/.graphify/graphs/agentdock`, built_at_commit `b6b31e72` = HEAD, 판정 "일치")에서 `queries/language.ts`를 조회했다. 소스와 대조한 결과는 다음과 같다.

| 관계 | 그래프 | 소스 대조 |
| --- | --- | --- |
| `search.ts` → `language.ts` (`SUMMARY_LANGUAGE`, `visibleLanguage`) | EXTRACTED L8 | 일치 |
| `packages.ts` → `language.ts` | EXTRACTED L8 | 일치 |
| `artifacts/page.tsx`, `app/page.tsx` → `HIDDEN_UNLESS_ASKED` | EXTRACTED | 일치 |
| `summaryLanguage` ← `SUMMARY_LANGUAGE` 호출(L129) | 엣지 없음 | 누락(Graphify 적용 때 확인한 한계) |
| SQL 실행 구조 | 그래프 범위 밖 | 소스와 `EXPLAIN`으로 직접 확인 |

### 3.2 언어 조건이 붙는 위치 (소스)

| 경로 | 함수 | 언어 조건 |
| --- | --- | --- |
| `/artifacts` (기본, 단어 없음) | `searchWhere` | WHERE에 `visibleLanguage(['zh'])`. rows와 count가 같은 식을 쓴다. |
| `/artifacts?q=…` (기본) | `searchWhere` | `case when <match> then <visible> else false end`. 매치된 행만 분류한다. |
| `/artifacts?lang=zh` 등 | `searchWhere` | `SUMMARY_LANGUAGE in (…)` |
| `/artifacts?lang=any` | `searchWhere` | 조건 없음 |
| rows 결과 | `searchPackages` | `SUMMARY_LANGUAGE`를 projection한다(OFFSET 행까지 계산). |
| 홈 feed | `listPackages` | WHERE `visibleLanguage` + projection |
| 홈 유형별 count | `countVisibleByType` | `count(*) filter (where visibleLanguage)` |

`visibleLanguage`는 `summary is null or summary !~ [CJK] or coalesce(SUMMARY_LANGUAGE, '') not in ('zh')`다. CJK가 없는 행(94%)은 앞의 regex에서 끝나고, CJK가 있는 1,132행만 분류 subquery를 실행한다.

## 4. 병목의 정확한 원인 (FACT)

### 4.1 구성요소별 비용

로컬 PG 17.11에서 측정했다. 운영 설명 19,113건을 `agentdock_test`에 적재했고, psql에서 쿼리마다 warm-up 2회 후 15회를 돌려 p50을 쟀다.

| 쿼리 | p50 | 의미 |
| --- | ---: | --- |
| `count(*)` 전체 | 0.7 ms | seq scan 바닥 |
| `summary !~ [CJK]` (사전 필터) | 14.4 | 19,113행 regex 1회 |
| CJK 행만 `count(*)` | 13.6 | 사전 필터와 같은 비용 |
| CJK 행 + 분류 | 56.6 | 분류 1,132행 = **+43 ms (0.037 ms/행)** |
| `visibleLanguage` 술어 전체 | 56.3 | 사전 필터 14 + 분류 42 |

CJK 1,132행에서 연산 하나씩만 따로 쟀다(기준 15.6ms 대비 증가분).

| 연산 | 증가분 |
| --- | ---: |
| CJK 개수(`regexp_replace` 1회) | +4.9 ms |
| Latin 개수 | +7.1 |
| Other / Kana `~` 검사 | ≈0 |
| 6단어 Latin 문장 regex | +0.6 |

연산을 한 번씩만 실행하면 합이 약 13~17ms다. 그런데 실제 분류 비용은 42ms로, 그 두세 배다.

### 4.2 원인: 내부 subquery 평탄화로 같은 개수를 반복 계산 (A, C, D, H)

`EXPLAIN (ANALYZE, VERBOSE)`에서 원인을 확인했다.

- 분류식의 내부 subquery `c`(`select <cjk 개수> as cjk, … as other`)에는 FROM이 없다. 그래서 PostgreSQL planner가 이 subquery를 바깥 CASE에 평탄화(pull-up)한다.
- 그러면 `c.cjk`를 참조하는 모든 위치에 `length(t.s) - length(regexp_replace(t.s, '[CJK]+', '', 'g'))` 식이 그대로 복사된다.
- 실행계획의 `InitPlan 1` Output에 같은 `regexp_replace`가 여러 번 나온다.

zh 행이 지나는 CASE 경로는 다음과 같다.
1. `c.cjk * 10 < c.cjk + c.latin + c.other`: cjk 2회, latin 1회, other 1회
2. `t.s ~ LATIN_SENTENCE`
3. `c.hangul * 2 >= c.cjk`: cjk 1회, hangul 1회
4. `c.kana * 10 >= c.cjk`: cjk 1회, kana 1회
5. `c.cjk < 4`: cjk 1회

**결과적으로 zh 행 하나가 CJK 개수를 5번 센다.** 기본 목록 비용의 대부분은 regex 자체보다 이 중복에서 나온다.

### 4.3 나머지 항목

| 항목 | 판단 (근거) |
| --- | --- |
| B. CJK regex 비용 | 사전 필터 regex는 19,113행에 0.7µs/행, 약 14ms다. 바닥 비용이고, 대안은 §5 참조 |
| E. 필터 적용 시점 | (FACT) 단어가 없으면 술어가 `package` Seq Scan의 Filter에서, NOT_LISTED subplan보다 먼저 적용된다. 단어가 있으면 CASE로 매치된 행만 분류한다(Phase 60–63 결정 유지). |
| F. count/list 공통 연산 | (FACT) 두 문장이 같은 술어를 각각 계산한다. 서로 다른 statement라 공유할 방법이 없다. 병렬로 실행되므로 페이지 시간은 둘 중 느린 쪽이다. |
| G. 불필요한 문자열 변환 | `summary::text`는 이미 text라 no-op이다. TOAST 압축 행은 CJK 행 중 13개뿐이라 detoast 반복 비용은 작다(FACT, `pg_column_size < octet_length`). |
| I. 검색어 유무 | (FACT) 검색어가 있으면 매치된 행만 분류하므로 비용이 작다(`q=review` count 32ms). 개선 폭도 2~3ms다. |
| J. prepared statement | (FACT) `db`는 `prepare: true`다. `plan_cache_mode=auto`라 5회 뒤 generic plan이 된다. `EXPLAIN (GENERIC_PLAN)`에서 변경 전에는 `Subquery Scan on c`가 없고, 변경 후에는 유지된다. `offset 0`은 literal이라 파라미터 수(16)와 바인딩이 변하지 않는다. |
| JIT | (FACT) `jit=on`이지만 쿼리 cost(약 6,300~11,000)가 `jit_above_cost`(100,000) 아래라 JIT가 동작하지 않는다. |

## 5. 후보별 실험 (FACT)

모두 같은 19,113행 데이터에서 측정했다. 판정 동일성은 19,113행 전체에서 `is distinct from`으로 비교했다.

| # | 후보 | 측정(p50) | 판정 동일 | 결정 |
| --- | --- | --- | --- | --- |
| C1 | **내부 subquery `c`에 `offset 0` 펜스** (각 개수를 한 번만 계산) | CJK 분류 56.0 → 36.3 ms, `visibleLanguage` 58.2 → 36.7, 전 행 분류 81.0 → 61.0 | 0/19,113 차이 | **채택** |
| C2 | C1 + 상한 단축: `cjk*10 >= length(s)`이면 Latin/Other 개수를 세지 않는다 | 36.7 → 33.7 ms | 0/19,113 | 폐기. 이득 3ms(잡음 수준)인데 subquery 단계가 하나 늘어난다. |
| C2' | (상한 확인용) Latin 개수를 아예 빼면 | 36.0 → 28.1 ms | 판정이 바뀜 | 실험용. 남은 비용의 상한이 8ms라는 근거 |
| C3 | 사전 필터 앞에 ASCII 검사(`octet_length = length`) | 14.7 → 11.8 ms | 동일 | 폐기. 3ms이고 Phase 64에서도 55 → 54ms로 효과가 없었다. |
| C4 | 사전 필터를 단순 상위 범위 regex(`[ᄀ-\U0010ffff]`, `[^\x01-ჿ]`)로 | 16.9 / 16.0 ms | 동일 | 폐기. 오히려 느리다. |
| C5 | 분류 안의 중복 `!~ [CJK]` 제거(visible 경로 전용 분류식) | 1,132행 × 0.7µs ≈ 1ms 추정 | — | 시도하지 않음. 이득이 측정 잡음보다 작고 분류식이 둘로 갈린다. |

C1 하나가 분류 비용(42ms)의 약 절반을 없앤다. 나머지 후보는 각각 3ms 이하라 반영하지 않았다.

## 6. 적용한 최적화

`src/db/queries/language.ts`의 `summaryLanguage()`에서 내부 subquery 끝에 `offset 0` 한 줄을 추가했다.

```sql
        from (
          select <cjk> as cjk, <kana> as kana, <hangul> as hangul,
                 <latin> as latin, <other> as other
          offset 0          -- 추가
        ) c
```

- `OFFSET`이 있는 subquery는 planner가 평탄화하지 않는다. 그래서 `c`는 `Subquery Scan`으로 한 번 계산되고, 바깥 CASE는 그 결과 컬럼을 읽는다.
- 실행 시에는 `OFFSET 0`이 Limit node 없이 제거된다(계획에 Limit가 없다).
- 계산하는 식, 범위, 순서, 반환값은 바뀌지 않는다. 바뀌는 것은 평가 횟수뿐이다.
- 이 식 하나를 projection, `lang=…` 필터, `visibleLanguage`, 홈 count가 모두 공유한다. 그래서 한 줄로 모든 경로에 적용된다.
- 설명은 SQL 문자열이 아니라 JSDoc에 두었다. SQL 주석은 매 요청 쿼리 텍스트에 실려 전송되기 때문이다.

회귀 테스트(`language.test.ts`):
- 분류 사례 5개를 추가했다. 한국어+한자, 한자 위주 일본어 → `zh`(현재 정책 상한 고정), emoji+영어, emoji만, 긴 중국어(1,200자)다.
- 리뷰 후 경계값 쌍 10개를 더 추가했다(§11).
- 실행계획 테스트 1개를 추가했다. `EXPLAIN (VERBOSE)`에 `Subquery Scan on c`가 있어야 통과한다.
  - (FACT) 펜스를 임시로 빼고 돌리면 이 테스트만 실패한다(1 failed / 29 passed).
  - 펜스를 넣으면 30/30 통과한다.

## 7. 변경 전후 실행계획 (FACT)

앱이 보내는 실제 문장을 그대로 `EXPLAIN (ANALYZE, BUFFERS)`로 비교했다. 파라미터는 바인딩된 그대로다. A는 펜스 없음(HEAD), B는 펜스 적용이다.

| 문장 | A: Seq Scan on package | B | A: 분류 subplan/행 | B | A: Execution | B | Buffers |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `/artifacts` rows | 62.8 ms | 39.4 | 0.040 ms | 0.020 | 168.0 ms | 138.2 | 동일(224,696) |
| `/artifacts` count | 60.3 | 40.1 | 0.038 | 0.020 | 154.0 | 134.8 | 동일(224,270) |
| 홈 `listPackages` | 60.8 | 40.6 | 0.038 | 0.020 | 159.7 | 146.4 | 동일(224,420) |
| 홈 `countVisibleByType` | (FILTER 집계) | | 0.037 | 0.019 | 164.3 | 137.6 | 동일(231,578) |

- **계획 모양:** A의 분류는 `Result → InitPlan Result`(평탄화된 식)다. B는 `Result → InitPlan Subquery Scan on c → Result`다.
- **I/O:** loops(1,132), 걸러진 행(609), Buffers가 모두 같다. 줄어든 것은 CPU의 반복 계산뿐이다.
- **남는 비용:** 행 수에 비례하는 `NOT_LISTED_BECAUSE` subplan(약 85ms)은 그대로다. 이 비용은 Phase 60–63 이전부터 있었다.

## 8. 성능 비교 (FACT)

### 8.1 방법

- **환경:** 로컬 PG 17.11(Docker `agentdock-testdb`, loopback)과 Bun 1.4.2, postgres.js(`prepare: true`, 운영과 같은 client 설정)다.
- **데이터:** 운영 등재 설명 19,113건(Phase 41 수집본)을 `agentdock_test`에 넣고 측정한 뒤 삭제했다(잔여 0).
- **문장 수집:** 각 경로가 보내는 문장을 앱의 실제 쿼리 함수(`searchMode`, `searchPackages`, `countSearchResults`, `listPackages`, `countVisibleByType`)에서 가로채 모았다.
- **A/B 교차:** 같은 문장의 A와 B를 라운드마다 순서를 바꿔 번갈아 실행했다. warm-up은 3라운드, 측정은 61라운드다.
- **페이지 시간:** 앱과 같은 형태로 쟀다. `searchMode`가 문장을 보낸 경우(다단어 검색)는 먼저 실행하고, 나머지(rows∥count)는 병렬로 실행했다.
- **부하:** 측정 중 load average는 3.6이었다(20코어).
- 스크립트와 원자료는 scratchpad `p65/`의 `ab.ts`와 `ab-final.out`이다.

### 8.2 경로별 결과 (ms, N=61)

| 경로 | DB 문장 수 | A p50 | A p95 | B p50 | B p95 | B 최소/최대 | p50 차이 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `/artifacts` 기본 (페이지) | 2 | 148.5 | 165.7 | **127.8** | 138.7 | 123.6 / 168.4 | −20.7 |
| ┗ rows | | 145.8 | 153.0 | 124.5 | 132.2 | 122.6 / 178.6 | −21.3 |
| ┗ count | | 140.3 | 150.7 | 120.5 | 125.7 | 118.3 / 127.7 | −19.8 |
| `lang=any` (페이지) | 2 | 93.8 | 103.9 | 93.5 | 104.0 | 91.0 / 127.1 | −0.3 |
| `lang=zh` (페이지) | 2 | 87.7 | 98.3 | **65.9** | 78.0 | 62.7 / 84.8 | −21.8 |
| `q=review` (페이지) | 2 | 36.5 | 43.5 | 33.8 | 41.6 | 32.2 / 47.2 | −2.7 |
| `q=review&lang=any` (페이지) | 2 | 27.7 | 32.5 | 28.0 | 36.0 | 26.4 / 49.3 | +0.3 |
| `q=code review` (searchMode 포함) | 3 | 26.4 | 34.3 | 24.9 | 33.8 | 23.6 / 36.1 | −1.5 |
| `page=2` | 2 | 148.6 | 162.3 | 127.5 | 141.9 | 123.2 / 194.6 | −21.1 |
| `page=361` (offset 9,000) | 2 | 239.6 | 251.8 | 213.9 | 226.6 | 209.9 / 230.5 | −25.7 |
| `sort=name` | 2 | 151.0 | 165.1 | 131.2 | 140.2 | 126.7 / 141.7 | −19.8 |
| 홈 최근 Artifact(`listPackages`) | 1 | 144.9 | 150.7 | **124.1** | 128.9 | 122.3 / 133.6 | −20.8 |
| 홈 유형별 count | 1 | 145.0 | 155.1 | **124.5** | 133.1 | 122.9 / 155.4 | −20.4 |

### 8.3 정리

- **기본 목록의 언어 필터 추가 비용(기본 − `lang=any`, 페이지 p50):** 54.7ms에서 **34.3ms**로 줄었다(−37%).
  - 20ms 희망 목표는 **달성하지 못했다.**
  - 남은 34ms는 사전 필터 regex 약 14ms(19,113행 전체)와, 한 번씩만 세도 남는 분류 비용 약 20ms다.
  - 남은 후보들은 각각 3ms 이하였다(§5).
- **개선 폭:** 기본 목록, `lang=zh`, page 2·361, 정렬 변경, 홈 feed·count 모두 p50이 19~26ms 줄었다.
  - 61라운드 교차 측정에서 B의 p95가 A의 p50보다 낮은 경로가 대부분이라, 잡음보다 확실히 크다.
- **회귀 없음:** `lang=any`(−0.3)와 단어 검색(±3ms)은 변화가 없다. 언어 식을 쓰지 않거나 매치된 소수 행만 분류하는 경로다.
- **DB 문장 수:** 모든 경로에서 같다(1~3개). 문장 텍스트에 literal `offset 0`만 추가됐다.
- **반환 결과:** 모든 경로, 모든 문장에서 A와 B의 결과가 같았다. 행, ID, 정렬 순서, count, 유형별 수가 일치한다(JSON 비교).

### 8.4 운영 영향 (INFERENCE)

- Phase 64에서는 운영 DB 실행이 로컬보다 약 8배 느리다고 추정했다. 이 배율은 PENDING이었다.
- 같은 배율이면 운영 기본 목록에서 p50 약 150~170ms(20.7ms × 8)가 줄어든다. Phase 64의 +430ms가 약 +270ms가 된다는 뜻이다.
- 운영 DB 실행계획을 보지 않은 추정이다. 배포 후 Phase 64와 같은 245회 교차 측정으로 확인해야 한다(PENDING).

## 9. 언어 판정 동일성 검증 (FACT)

- **전 행 비교:** 운영 설명 19,113행에서 변경 전 식과 변경 후 식(소스에서 렌더링한 SQL)을 같은 행에 함께 계산했다.
  - 분류가 다른 행: **0**
  - `visibleLanguage(['zh'])` 결과가 다른 행: **0**
- **분포:** 변경 후 latin 17,082, NULL 1,105(설명 없음 1,085 + 공백 20), zh 609, ja 169, mixed 59, other 51, ko 37, unknown 1이다.
  - zh 609, ja 169, ko 37, mixed 59는 Phase 60–63에서 운영 기준으로 기록한 값과 같다.
- **단위 사례:** 처음 추가한 시점의 `language.test.ts` 29개 사례가 변경 전과 후 모두 통과했다. 리뷰 후 추가한 경계값 10개도 변경 전후 판정이 같다(`q_bound.sql`). 최종 파일은 사례 39개와 실행계획 테스트 1개다.
  - 사례 목록: 중국어 간체·번체, 일본어, 한국어, 영어+중국어, 코드 블록이 섞인 중국어·영어, 특수문자, NULL, 공백, Cyrillic, Tamil, Georgian, 한국어+한자, 한자 위주 일본어, emoji, 긴 설명, ASCII만 있는 설명.
  - 변경 전 결과는 펜스를 임시로 빼고 실행해서 확인했다.
- **정책 변경 없음:** 한자 위주 일본어(`業務設計書作成支援、要件定義書自動生成機能の提供`, kana 1자)는 이전처럼 `zh`로 분류되어 기본 목록에서 숨는다. 재분류는 별도 Phase의 일이다.
- **앱 문장 비교:** 11개 경로의 모든 문장에서 A와 B의 반환 행이 같다(§8.3).

## 10. 검색 회귀 검증 (FACT)

아래는 리뷰 반영 후 최종 실행 결과다(로그는 scratchpad `p65/final/`).

| 검증 | 결과 |
| --- | --- |
| `bun run check:boundaries` | OK (exit 0) |
| `bun run lint` | exit 0. 리뷰 전 첫 실행에서는 새 테스트 한 줄의 포맷 때문에 실패했고, `biome format --write`로 고쳤다 |
| `bun run typecheck` | exit 0 |
| `bun run test` (loopback 테스트 DB) | 80 files, **1,556 passed / 2 skipped**. skip은 기존 의도적 skip 2건이다(pg_trgm 미설치 경로, 잘못된 비밀번호 접속). 이전 1,540에 이번 Phase 16건(사례 15, 실행계획 1)이 더해졌다 |
| `bun run build` | exit 0 |
| `bun run e2e:seed` + `bun run test:e2e` | **42 passed**. 언어 필터, 중국어 기본 제외·안내, 홈 유형별 count 여정을 포함한다. 서버 로그의 "destination stream closed early"는 Phase 60 기준선 로그에도 있던 기존 현상이다 |
| `bun run search:eval` | **54/54**. 요약 지표(MRR 0.927, nDCG@10 0.907, top1 0.915 등)와 케이스별 순위 출력이 Phase 60 기준선과 같다(md5 일치) |
| `bun run search:eval:multilingual` | **15/15**. 요약 지표와 순위 원자료가 Phase 60 기준선과 같다(md5 일치) |

요청된 회귀 항목과 근거:

| 항목 | 근거 |
| --- | --- |
| 기본 검색에서 중국어 제외 | E2E 여정 5, 전 행 `visibleLanguage` 동일성 |
| `lang=any`에서 전체 언어 | 앱 문장 비교(`lang=any`), E2E |
| `lang=zh`에서 중국어만 | 앱 문장 비교(`lang=zh`), E2E 여정 4 |
| 결과 개수 정합성 | count 문장과 rows 문장이 같은 식을 쓴다. A와 B의 count가 같다 |
| 페이지 이동 | page 2와 361의 rows가 같다. E2E |
| 정렬 변경 | `sort=name`의 rows와 순서가 같다 |
| 검색어 변경, 빈 결과 | `q=review`, `q=code review`(searchMode) 비교, E2E, search:eval의 no-result 케이스 |
| 추천·유사 결과 | `getRelatedPackages`는 언어 식을 쓰지 않는다(소스). E2E 상세 페이지 여정이 통과한다 |
| 홈 유형별 count | 앱 문장 비교(`countVisibleByType`), E2E 여정 6 |
| 저장소·상세 페이지 | 언어 식을 projection만 하므로 같은 식의 평가 횟수만 바뀐다. E2E가 통과한다 |
| 기존 검색 순위 | search:eval과 multilingual의 순위 원자료 md5가 같다 |

## 11. PR Review Toolkit 결과

공식 PR Review Toolkit 리뷰어 4개를 실제로 호출했다. 모두 읽기 전용으로 실행했고, loopback 테스트 DB에서 SELECT와 EXPLAIN만 썼다.

| 리뷰어 | CRITICAL | IMPORTANT | 리뷰어가 직접 검증한 것 |
| --- | ---: | ---: | --- |
| code-reviewer | 0 | 1 | 합성 40,000건 A/B 분류 차이 0. `force_generic_plan`에서 PREPARE/EXECUTE로 펜스 유지와 14개 사례 판정 확인. 파라미터 바인딩 확인 |
| pr-test-analyzer | 0 | 2 | EXPLAIN 테스트가 변경 전 코드에서 실패하는 것 확인(regexp_replace 13회 → 7회). 경계 입력 13개 전후 동일. CI `database` job은 DB가 없으면 skip하지 않고 실패한다 |
| comment-analyzer | 0 | 3 | "zh 행 CJK 5회 계산"을 CASE 경로로 직접 셈. 한 행 VALUES가 상수로 접히는 것 확인 |
| silent-failure-hunter | 0 | 1 | 23,289개 입력(확장 B 한자, NULL 포함) 분류·숨김 차이 0. 40만 자 입력 오류 없음. 한 문장 안 파라미터 `$1..$30` 순서 정상 |

IMPORTANT 처리:

| 지적 | 처리 | 재검증 |
| --- | --- | --- |
| 주석이 인용한 보고서가 없음(3개 리뷰어 공통) | 이 보고서를 같은 변경에 추가했다 | — |
| 주석 수치 0.043 → 0.023이 최종 측정 파일에 없음(run3 값) | 최종 실행(`ab-final.out`) 값 0.038 → 0.020 ms/행, browse 148.5 → 127.8 ms로 바꿨다 | — |
| 19,113행 동일성 결과가 파일로 남지 않음 | `identity.out`(`19113|0|0`)으로 저장했다 | 재실행 |
| `visibleLanguage` ponytail 블록이 날짜 없이 이전 수치를 인용 | 2026-10-27 펜스 이후 수치(browse count 87 → 121 ms, 홈 feed 124, 유형 count 125)와 이전 값, 두 보고서를 함께 적었다. 재검토 시점 추정은 28k → 32k행(200 ms ÷ 120.5 ms × 19,113) | lint, unit |
| zh 숨김 범위를 정하는 경계값 쌍이 테스트에 없음(기존 공백) | 경계 5종을 양쪽 값으로 10개 추가했다(kana 1/10, hangul 1/2, Han 4자, CJK 1/10, Latin 6단어). 변경 전후 판정을 DB에서 먼저 확인했다(`q_bound.sql`, 10/10 동일) | language.test 40/40 |
| trigram fallback 언어 필터 테스트가 빈 결과에서도 통과(기존, `search.test.ts`) | `every`를 `toEqual([ids.zh])`로 바꾸고, 기본 숨김 fuzzy 결과에 `length > 0`을 추가했다 | search.test 통과(빈 결과가 아님을 확인) |

MINOR(반영하지 않음, 기록):
- EXPLAIN 테스트는 노드 라벨 `Subquery Scan on c`에 묶여 있다. PG 메이저 업그레이드 때 깨질 수 있지만, 조용히 통과하는 쪽이 아니라 실패하는 쪽이다.
- 파일 상단 ponytail(2026-10-26 수치), `artifacts/page.tsx:268`의 "+81 ms", `search.ts` searchWhere의 23 → 31/75 ms는 날짜가 붙은 과거 기록이다. 비교 결론이 펜스로 바뀌지 않아 그대로 두었다.
- (기존 동작, 범위 밖) 탭이나 줄바꿈만 있는 설명은 `btrim`이 공백만 지우므로 `null`이 아니라 `unknown`이다. 전각 Latin(`ＡＢＣ`)은 LATIN 범위 밖이다. zh 숨김에는 영향이 없다. 분류 알고리즘 개선 Phase에서 다룬다.

## 12. 남은 위험

- **(INFERENCE) 향후 PostgreSQL 동작 변화.** `OFFSET 0` 펜스는 오래된 관용구다. 그래도 미래 버전 planner가 이를 무시하고 평탄화하면 성능만 이전 수준으로 돌아간다. 판정 결과는 바뀌지 않는다. 실행계획 테스트가 이 경우 실패하므로 조용히 회귀하지는 않는다.
- **(FACT) 남은 비용은 행 수에 비례한다.** 사전 필터는 행마다 regex를 실행하고, CJK 행은 행마다 분류한다. 19k 기준 34ms이므로 약 38k행이면 Phase 64 수준(55ms)으로 돌아간다(INFERENCE, 선형 가정).
- **(PENDING) 운영 효과.** 운영과 로컬의 배율은 아직 측정되지 않았다(§8.4).
- **목록 술어 바닥 비용.** `NOT_LISTED_BECAUSE` subplan 약 85ms는 이번 범위가 아니다. 이 비용이 기본 목록의 대부분이다.

## 13. Migration 필요성 최종 판단

- **지금은 필요 없다.** 펜스 한 줄로 기본 목록의 언어 비용이 37% 줄었고, migration 없이 얻을 수 있는 큰 개선은 이것이 전부였다(§5).
- **STORED generated column의 근거.** 남은 34ms(사전 필터 14 + 분류 20)를 없애려면 판정 결과를 저장해야 한다.
  - 저장하면 술어가 컬럼 비교 하나가 되고, 하한은 `lang=any`와 같은 수준이다.
  - 근거: `lang=any` 페이지 93.5ms 대 기본 127.8ms.
- **Migration을 할 때 고려할 점(Phase 64 §27.5 유지).**
  - 현재 식은 subquery를 쓰므로 generated column에 바로 넣을 수 없다.
  - `agentdock` schema의 IMMUTABLE SQL 함수가 필요하다. 함수 안에서도 같은 평탄화 문제가 생기지 않게 이번 펜스를 유지해야 한다.
  - `ADD COLUMN … STORED`는 테이블을 다시 쓰며 ACCESS EXCLUSIVE lock을 잡는다(19k행이라 짧지만 그동안 읽기가 막힌다).
  - rollback은 `DROP COLUMN`과 `DROP FUNCTION`이다(boundary scanner의 파괴적 동사 검토 대상, 파생값이라 데이터 손실 없음).
  - migration 전에 19,113행 전체에서 함수 결과와 현재 식이 같은지 검증해야 한다(이번 §9 방식).
- **언제 다시 판단하나.** 기본 browse count가 200ms(기존 ponytail 트리거)를 넘을 때다. 또는 운영 재측정에서 기본과 `lang=any`의 차이가 여전히 사용자가 정한 기준을 넘을 때다. Migration은 제안만 하고 실행하지 않았다.

## 14. 변경 파일

| 파일 | 변경 |
| --- | --- |
| `src/db/queries/language.ts` | 내부 subquery `c`에 `offset 0`(+1줄), JSDoc에 측정 근거, `visibleLanguage` ponytail 수치 갱신 |
| `src/db/queries/language.test.ts` | 분류 사례 15개(edge 5, 경계값 쌍 10), 평탄화 방지 실행계획 테스트 1개 |
| `src/db/queries/search.test.ts` | trigram fallback 언어 필터 테스트 2곳의 단언 강화(빈 결과에서 통과하지 않게) |
| `docs/analysis/agentdock-phase65-language-sql-optimization.md` | 이 보고서(신규) |

DB schema, migration, Sync, ranking, 공개 URL, API 계약은 바꾸지 않았다. 운영 DB에는 접속하지 않았다.

## 15. Commit/Push 가능 여부

- 로컬 검증(§10)은 모두 통과했다. Commit과 push는 하지 않았다. 사용자가 직접 수행한다.
- 운영 효과 확인은 배포 후 측정이 필요하다(PENDING).

권장 commit:

```bash
git add src/db/queries/language.ts src/db/queries/language.test.ts src/db/queries/search.test.ts docs/analysis/agentdock-phase65-language-sql-optimization.md
git commit -m "perf(search): count each script once in the language classifier

PostgreSQL flattened the counts subquery into the CASE, so a zh row
counted its CJK characters five times. An OFFSET 0 fence keeps each
count to one evaluation. With production's 19,113 descriptions loaded
locally the default browse page went 148.5 -> 127.8 ms p50, the home
feed and type counts about 21 ms each, lang=zh 87.7 -> 65.9 ms;
lang=any and word searches are unchanged. The class is identical on
all 19,113 rows, and search eval (54/54, 15/15) ranks are byte-equal.
Tests pin each classification threshold from both sides and the fence
itself; the trigram-fallback language tests no longer pass on an empty
result.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## 16. Evidence

| ID | 내용 | 위치(scratchpad `p65/`) |
| --- | --- | --- |
| E65-01 | 구성요소·후보별 psql 마이크로벤치 | `bench.py`, `q_*.sql`, `c_*.sql`, `p_*.sql`, `b_nolat.sql`, `q_classcjk_v2.sql` |
| E65-02 | 19,113행 판정 동일성, 경계값 | `q_identity.sql`과 `identity.out`(`19113|0|0`과 분포), `q_eq.sql`, `q_eq2.sql`, `q_bound.sql` |
| E65-03 | 앱 문장 교차 A/B, 실행계획, generic plan | `ab.ts`, `ab-final.out` (`ab-run1~3.out`은 하네스 결함이 있던 중간 실행이다. §17 참조) |
| E65-04 | 검증 로그(최종) | `final/` 아래 `check:boundaries.log`, `lint.log`, `typecheck.log`, `test.log`, `build.log`, `e2e-seed.log`, `e2e.log`, `search:eval.log`, `search:eval:multilingual.log`. 리뷰 전 실행 로그는 `p65/` 바로 아래, skip 식별은 `test-verbose.log` |

## 17. 측정 과정에서 바로잡은 오류 (FACT)

1. **첫 A/B(run1)는 rows와 count를 직렬로 실행했다.** 그래서 페이지 시간이 실제의 약 2배로 나왔다. 단어 하나짜리 검색과 browse에서는 `searchMode`가 문장을 보내지 않는데, 첫 문장을 `searchMode`로 오인했기 때문이다.
2. **run2는 rows 문장에서 펜스를 일부만 적용했다.** rows 문장에는 언어 식이 두 번(projection과 WHERE) 들어가는데, 치환 regex에 `g` 플래그가 없어 첫 번째만 바뀌었다. 그래서 "rows는 개선 없음"으로 보였다.
3. **run4(소스 반영 직후)에서는 A와 B가 같은 문장이었다.** 소스에 넣은 SQL 주석이 `as other`와 `offset 0` 사이에 끼어 펜스 제거 regex가 맞지 않았다.
   - 이때 SQL 주석을 JSDoc으로 옮겼다.
   - 하네스에는 "언어 식이 있는 모든 문장은 A ≠ B이고 펜스 수 = 식 수"라는 검사를 넣었다.

이 문서의 수치는 모두 위 오류를 고친 최종 실행(`ab-final.out`)에서 나왔다.
