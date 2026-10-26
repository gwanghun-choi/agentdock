# AgentDock Phase 29–31 — 검색 최적화 운영 검증, Sync 효과, 응답 지연 최종 평가

- 작성: 2026-10-23 (운영 측정 09:13–09:31 UTC, 로컬 측정 09:17–09:24 UTC)
- 기준: 로컬 HEAD = origin/develop = 운영 배포본 = `0f2cb82`
- 이전 보고서: [Phase 17–19](agentdock-phase17-19-discovery-quality-search.md) · [Phase 20–22](agentdock-phase20-22-operations-performance-experience.md) · [Phase 23–25](agentdock-phase23-25-production-sync-performance.md) · [Phase 26–28](agentdock-phase26-28-production-stabilization.md)
- 하지 않은 것: 운영 DB 접속·SQL, 운영 EXPLAIN, `ALTER ROLE`·migration·DDL/DML, 수동 Sync, Vercel/Neon 설정·환경 변수 변경, 배포, commit/push.
- 운영에 보낸 요청: 읽기 전용 GET 약 155회(1초 이상 간격, 동시 요청 없음), Vercel 로그 조회 약 25회(개인 계정 CLI, 읽기 전용). Sync 로그는 `gh api`로 읽기만 했다. MCP registry에 외부 GET 1회.
- Sync 관찰: 예약 실행 39940525800 (2026-10-23 10:38–10:59Z, `0f2cb82`). 수동 실행 없음.
- 표기: **FACT**는 이번에 실측한 값, **INFERENCE**는 실측에서 끌어낸 해석, **PENDING**은 확인하지 못한 항목이다.

## 1. 핵심 결론

1. **검색 최적화는 운영에서 정상이다(FACT).**
   - SHA 5곳이 `0f2cb82`로 일치한다.
   - 검색 smoke 60회가 모두 200이었다. 반복 3회의 결과 수와 순서 hash가 모두 같았고, 결과 수는 Phase 26과 같다.
   - error·warning·fatal·5xx 로그는 0건이다.
   - 같은 문장을 5회 넘게 실행해 generic plan으로 바뀔 수 있는 구간에서도, `node.js` 검색 시간은 늘지 않았다(약 700ms, 연속 10회).
2. **generic plan 수정의 운영 효과는 측정 해상도 아래다(FACT + INFERENCE).**
   - 운영 검색 시간은 DB 왕복 1회(약 233ms)의 배수로만 나타난다. SQL 실행 시간은 이 단위에 묻힌다.
   - 7.3k 규모에서 수정 전 손실 추정치(문장당 5–15ms)는 이 해상도로는 보이지 않는다. 회귀가 없다는 것까지가 운영에서 확인한 범위다.
3. **남은 응답 지연은 DB 왕복 지연이다(FACT).**
   - 운영 서버 측 검색 시간은 약 240 / 470 / 700 / 930ms로 모인다. 왕복 하나가 약 233ms다.
   - 같은 빌드를 로컬 100ms 왕복 프록시 뒤에 두면 SQL을 포함해도 정확히 왕복 수 × 100ms다.
4. **새로 찾은 병목: 20초 이상 쉬고 들어온 첫 요청은 약 2초가 더 걸린다(FACT).**
   - DB 404 기준으로 쉰 시간이 10–15초면 0.56–0.88초, 25–40초면 2.53–2.79초였다.
   - 경계가 `src/db/client.ts`의 `idle_timeout: 20`과 일치한다. 연결이 닫힌 뒤 재연결과 statement 재준비 비용이다(약 8–9 왕복).
   - 트래픽이 드문 서비스이므로 실제 방문자 대부분이 이 경로를 탈 가능성이 높다(INFERENCE).
5. **리전 정렬이 두 병목을 함께 줄이는 단일 수단이다(INFERENCE).** 코드 변경은 하지 않았다.
   - 함수는 iad1이다(FACT).
   - DB 왕복 233ms는 같은 리전(수 ms)에서는 나올 수 없는 값이다. 그러므로 Neon이 us-east-1에 있지 않을 가능성이 높다.
   - 다만 Neon 리전 자체는 확인하지 못했다(PENDING). 콘솔 확인이 선행 조건이다.
6. **Sync 효과는 D-1·C-1이 확인됐고, run 자체는 FAILED다(FACT).**
   - 예약 Sync 39940525800이 exit 1로 끝났다. 원인은 MCP registry 단계 하나다. 1회 재시도 뒤 0페이지로 실패했고 나머지 단계는 모두 돌았다(O-3 동작 그대로).
   - registry는 11:01Z에 200(0.54s)으로 응답했다. 10:38–10:39Z의 외부 일시 장애로 본다(INFERENCE).
   - D-1: backlog에서 실제로 artifact를 얻은 job이 1/33 → 26/33이 됐다. 50 star 미만 탈락은 24 → 1이다.
   - C-1: `/artifacts?type=hook`에서 plugin 이름으로 보이는 hook이 0 → 19개가 됐다.
   - O-2: summary 단계는 "Not available"만 썼다. ops의 연결 검사가 role·read-only 등 6개 항목에서 FAIL했다. Actions의 `DATABASE_URL`이 `agentdock_app`이 아닌 role로 연결된다는 신호다(§10, 확인은 운영자 몫).

## 2. Phase별 최종 판정

| Phase | 판정 | 근거 |
|---|---|---|
| 29 검색 최적화 운영 검증 | **PASS** | SHA 일치, smoke 60/60, 결과 수·순서 동일, 로그 오류 0, 반복 실행 악화 없음, search:eval 54/54 |
| 30 Sync 효과 | **CONDITIONAL** | D-1·C-1 PASS, O-3 설계대로 동작. run은 registry 외부 장애로 FAILED, O-2는 FAIL(연결 role 문제, §10) |
| 31 응답 성능·리전 | **CONDITIONAL** | 병목을 재현하고 원인을 분리했다(FACT). Neon 리전은 PENDING이라 개선안을 승인 대상으로 남긴다 |

## 3. Git/Deploy SHA (FACT, E-01)

| 항목 | 값 |
|---|---|
| 로컬 HEAD | `0f2cb82df76870913999539447505a38c1e27653` |
| origin/develop | 같음 |
| 작업 시작 시 working tree | clean |
| 마지막 성공 CI | 39924247597 (push, `0f2cb82`, 08:23–08:24Z) |
| 마지막 성공 Deploy | 39924404035 (workflow_run, `0f2cb82`, 08:24–08:26Z) |
| 운영 `X-AgentDock-Commit` | `0f2cb82…` (09:13Z, 09:24Z) |
| 운영 deployment | `dpl_GbQeewehTtZqiyiMQEKoydzG9mnr` (로그의 deploymentId) |
| 함수 리전 | `x-vercel-id: icn1::iad1::…` (edge icn1, function iad1) |

`0f2cb82`는 Phase 26–28 작업 트리 변경 4개 파일과 보고서를 담은 사용자 commit이다. 커밋 이후 working tree는 clean이다.

## 4. 검색 Smoke Test (FACT, E-02)

URL 20개를 각 3회 요청했다. 요청 간격은 1초다. 응답 HTML에서 다음을 뽑았다.
- 결과 수(`result-count`)
- 표시 구간(`Showing a–b`)
- 행 링크 목록의 SHA-1 앞 8자리(순서까지 포함)
- 완화(`any`)·근사 일치(`close`)·페이지 없음 문구

| 요청 | 3회 상태 | 결과 수 | 표시 | 순서 hash 3회 | 비고 |
|---|---|---|---|---|---|
| `q=node.js` | 200×3 | 20 | 1–20 | 동일 | P26과 같은 20 |
| `q=three js` | 200×3 | 81 | 1–25 | 동일 | `any` 완화 문구. P26과 같은 81 |
| `q=xqzvqqkw` (결과 없음) | 200×3 | 0 | – | – | "No artifacts matched" 화면 |
| `q=xqzv-nonexistent-term` | 200×3 | 105 | 1–25 | 동일 | `term`이 단어로 남아 `any`로 일치한다. 기존 의미 그대로 |
| `q=pdf` | 200×3 | 59 | 1–25 | 동일 | P26과 같은 59 |
| `q=code review` | 200×3 | 268 | 1–25 | 동일 | |
| `q=playwright` | 200×3 | 35 | 1–25 | 동일 | P26과 같은 35 |
| `q=review` | 200×3 | 828 | 1–25 | 동일 | P26과 같은 828 |
| `q=superpowers` | 200×3 | 17 | 1–17 | 동일 | 1위 `obra/superpowers` plugin |
| `q=debuging` (오타) | 200×3 | 187 | 1–25 | 동일 | 1위가 `debugging-*` |
| `q=mcp` | 200×3 | 1,337 | 1–25 | 동일 | |
| `q=hookify` | 200×3 | 12 | 1–12 | 동일 | 1위 `plugins/hookify/commands/hookify.md` |
| `q=微信` | 200×3 | – | 5행 | 동일 | 근사 일치 화면, 총계 없음(설계대로) |
| `q=node.js&page=2` | 200×3 | – | – | – | "There is no page 2" |
| `q=review&page=2` | 200×3 | 828 | 26–50 | 동일 | |
| `q=review&page=34` | 200×3 | 828 | 826–828 | 동일 | 마지막 페이지 3행 |
| `q=node.js&sort=name` | 200×3 | 20 | 1–20 | 동일 | 순서가 relevance와 다름 |
| `q=node.js&sort=recent` | 200×3 | 20 | 1–20 | 동일 | 순서가 relevance와 다름 |
| `type=hook` | 200×3 | 109 | 1–25 | 동일 | P26과 같은 109 |

- 응답 본문에 `Application error`, `Internal Server Error`, `prepared statement`, `26000`이 없었다.
- Vercel 로그의 `event:"search"` 56건(E-03)은 결과 수가 HTML과 모두 같다.
  - 예: `q=微信`은 `totalCount 0`, `resultCount 5`(근사 일치)다.
  - `node.js&page=2`는 `totalCount 20`, `resultCount 0`이다.

## 5. Generic Plan 운영 효과 (E-03, E-04)

운영 EXPLAIN은 실행하지 않았다. 판단 근거는 Vercel 로그의 서버 측 `durationMs`와 TTFB다.

### 5.1 반복 실행 (FACT)

| 측정 | `node.js` durationMs (ms) |
|---|---|
| smoke, 09:14–09:15Z | 931, 703 / 916, 703, 699 / 917, 697, 700 |
| TTFB 측정, 09:22Z, 1초 간격 10회 | 1111, 1145, 1149, 681, 708, 708, 673, 696, 705, 679 |
| Phase 26 (수정 전 배포, warm) | 약 686 |

- 처음 몇 번은 약 1,130ms였다. 이후 약 690ms로 내려가 10회째까지 유지됐다.
  - 같은 문장을 한 연결에서 5회 넘게 실행하면 generic plan 후보가 된다. 그 이후에도 시간이 늘지 않았다.
- 첫 요청이 느린 이유는 연결마다 처음 실행하는 statement의 Parse/Describe 왕복이다(Phase 26 E-04와 같은 양상).
- 요청 사이에 다른 검색이 끼면, 같은 `node.js`도 다시 첫 실행 비용을 낼 수 있다(smoke의 931 → 703 패턴).

### 5.2 판정

- **FACT:** 반복 호출 시 악화가 없다. error/5xx도 0이다.
- **INFERENCE:** 수정 효과 자체는 운영에서 분리되지 않는다.
  - 7.3k에서 수정 전 손실 추정치는 문장당 5–15ms다(Phase 26 §14).
  - 운영의 측정 단위는 DB 왕복 하나(약 233ms)다.
  - 수정의 근거는 로컬 50k EXPLAIN(102 → 26ms)과 회귀 테스트이며, 운영 규모가 커질수록 의미가 생긴다.

### 5.3 운영 TTFB p50/p95

TTFB 측정은 §13에 있다. 검색 페이지는 셸을 먼저 스트리밍하므로, TTFB(335ms)에는 검색 시간이 들어가지 않는다. 검색 시간은 total(1,231ms)과 `durationMs`로 본다.

## 6. 검색 정확도 회귀 (FACT, E-05)

- 로컬 `search:eval`: 54/54 passed.
  - 케이스별 출력이 Phase 26(`p26/eval.txt`)과 글자 단위로 같다.
  - 요약값: queries 52, judged 47, MRR 0.927, nDCG@10 0.907, top1 0.915, recall@10 0.888, zeroResult 0.043.
- 운영 고정 검색어 결과 수: Phase 26과 모두 같다. 대상은 node.js 20, three js 81, pdf 59, playwright 35, review 828, hook 109다.
- 운영 순위: 3회 반복의 순서 hash가 모두 같다.
  - Phase 26에는 순서 hash를 남기지 않았으므로 이전 배포와의 순위 비교는 NOT RUN이다.
  - 다만 tsquery를 서브쿼리로 감싼 변경은 값이 아니라 평가 시점만 바꾼다. search:eval 순위가 같은 것이 그 근거다.

## 7. Sync 실행 기록 (FACT, E-10)

Baseline은 Phase 23–25 코드로 돈 마지막 예약 실행 39853119505(`3a8a3c3`, 2026-10-22 20:56Z)다. 이번 실행은 `da0ddfb`·`bb7c2ed`·`24097f4`·`0f2cb82`가 모두 들어간 첫 예약 실행이다. 두 실행 사이에 다른 Sync는 없다.

| 항목 | Baseline 39853119505 | 이번 39940525800 |
|---|---|---|
| 시작–종료 | 20:56–21:20Z | 10:38–10:59Z |
| Workflow 결론 | success | **failure** (`bun run sync` exit 1) |
| Status | PARTIAL_CAP | **FAILED** (`failed-stages=registry`) |
| processed / ingested | 200 / 66 | 200 / 84 |
| unchanged / no artifacts | 74 / 9 | 67 / 17 |
| 50 star 미만 탈락 | 40 | 26 |
| 실행 시간 | 1406s | 1222s (−13%) |
| stage registry / search / fan-out / refresh / drain | 33 / 161 / 123 / 120 / 965s | 33 / 152 / 52 / 50 / 932s |
| drain 처리량 | 13.6 jobs/min | 13.4 jobs/min |
| core spent / left | 421 / 4571 | 410 / 4577 |
| fan-out still-pending | 12549 | 12488 |
| refresh not-reached (cap 100) | 43 | **158** |
| drain 뒤 queue | 1 | 3 (due 3) |
| listed / held | 7273 / 8846 | 9781 / 11431 |

- held 증가분 2,585는 이번 run의 신규 artifact 2,586(search 1,291 + links 102 + backlog 1,187 + refresh 6)에서 delisted 1을 뺀 값과 같다. 두 run 사이에 다른 쓰기가 없었다는 뜻이다.
- **prepare 경로(`24097f4`)를 쓰는 첫 Sync다.** DB 관련 오류는 `storage_failed` 2건뿐이다. 그중 job 771(`elementalsouls/claude-bughunter`)은 baseline(prepare:false)에서도 같은 결과(attempt 1, 10.7s)였고 이번이 재시도(attempt 2, 11.1s)다. 따라서 prepare 경로가 만든 오류로 보지 않는다(INFERENCE). 원인은 로그에 남지 않는다(`toIngestOutcome`이 GitHub 외 예외를 모두 `storage_failed`로 바꾼다).
- fan-out 123→52s, refresh 120→50s는 `24097f4`의 왕복 축소와 방향이 같다(INFERENCE, 단일 표본).
- Sync 동안과 이후(10:35Z~) Vercel 운영 로그에 error·warning·fatal·5xx는 0건이다(E-11).

## 8. D-1 효과 (FACT, E-10)

`seeds.ts`의 `KNOWN_ELIGIBLE` 정렬로, 기록된 star가 50 이상인 seed가 backlog에서 먼저 나온다.

| 출처 (jobs) | Baseline productive | 이번 productive | 50 star 미만 탈락 |
|---|---|---|---|
| search (34) | 27 | 21 | 0 → 0 |
| links (33) | 12 | 4 | 16 → 25 |
| **backlog (33)** | **1** | **26** | **24 → 1** |
| refresh (100) | 26 ok / 74 unchanged | 33 ok / 67 unchanged | – |

- **D-1은 PASS다.** backlog에서 얻은 신규 artifact가 1,187개로 이번 run 신규분의 46%다.
- links가 12 → 4로 줄었다. D-1은 backlog 순서만 바꾸므로 원인이 아니다. links 목록 앞쪽의 50 star 이상 repo가 이전 run들에서 소진된 결과로 본다(INFERENCE, 단일 표본).
- search 27 → 21은 no_artifacts 10, too_large 1, archived 1, storage_failed 1의 합이다. 정렬과 무관하다.

## 9. C-1 효과 (FACT, E-12)

`/artifacts?type=hook` 전 페이지를 1초 간격으로 읽었다(`p29/hooks.py`).

| 항목 | 변경 전 (`hooks-before.json`) | 이번 (`hooks-after.json`) |
|---|---|---|
| hook 행 | 109 | 125 |
| `hooks` / `settings` 이름 | 86 / 23 | 82 / 24 |
| plugin·디렉터리 이름 | **0** | **19** |

- 같은 경로에서 이름이 바뀐 행이 9개다. 예: `trailofbits/skills/plugins/fp-check/hooks/hooks.json` `hooks` → `fp-check`.
- 새로 생긴 경로 21개 중 plugin 하위는 plugin 이름(`agent-tunnel`, `safety-hooks` 등)으로, 저장소 루트의 `hooks/hooks.json`은 `hooks`로 나온다. 부모 segment가 없는 경우로 의도대로다.
- 남은 `hooks` 82개는 대부분 이번 run에서 재수집되지 않은(unchanged) repo다. 다음 refresh에서 내용이 바뀌는 repo만 고쳐진다.
- **C-1은 PASS다.**

## 10. O-2 결과 (FACT + PENDING, E-10)

| 항목 | 결과 |
|---|---|
| step conclusion | success (`continue-on-error`) |
| `ops:status` exit | **2** — 연결 검사 실패, 아무것도 읽지 않음 |
| Summary 내용 | "**Not available** — the report could not be read (exit 2)" 한 줄(설계된 실패 문구). 공개 run 페이지 렌더링은 확인하지 않았다(PENDING) |

ops가 stderr에 남긴 FAIL 항목은 6개다. `10 of 10 pool connections` 검사는 출력되지 않았으므로 통과했다.

- `default_transaction_read_only = on` / `transaction_read_only = on` / `statement_timeout = 30000 ms` — FAIL
- **`connected as agentdock_app` — FAIL**
- `search_path is exactly agentdock` — FAIL
- `a write is refused (expected 25006, got accepted, rolled back)` — FAIL. temp table 생성이 transaction 안에서 수락된 뒤 rollback됐다. 남은 것은 없다.

판정과 해석:

- **O-2는 FAIL이다.** summary 단계가 있어도 운영 health는 보이지 않는다.
- 10개 연결 모두에서 `current_user`가 `agentdock_app`이 아니었다(FACT). Actions secret `DATABASE_URL`이 다른 role(예: Neon 소유자 role)로 연결된다는 뜻이다(INFERENCE). Sync 단계(`corpus-sync`)는 `assertSchemaIsolation`을 호출하지 않으므로 이 상태로 계속 돌았다.
- read-only 등 startup parameter도 적용되지 않았다. 이것이 role 차이 때문인지, 그 endpoint가 startup parameter를 버리기 때문인지는 구분하지 못했다(PENDING).
- secret 값은 열람하지 않았다(금지). 운영자가 Neon 콘솔이나 로컬 `bun run ops:preflight`로 그 연결의 role을 확인해야 한다.
- AGENTS.md "The database is shared"의 전제(AgentDock은 `agentdock_app`으로만 접속)가 Sync 경로에서 확인되지 않은 상태다. 웹은 `instrumentation.ts`의 `assertSchemaIsolation`으로 매 부팅 확인한다.

## 11. O-3 결과 (FACT, E-10)

```
10:39:11Z corpus-sync: stage=registry FAILED — AgentDock could not reach the MCP registry.
          Retried once after 10 s; 0 page(s) were read this run, and the next run resumes after them.
          The other stages still ran.
```

- 재시도 1회, 실패 후 cursor 유지, 다른 단계 계속 실행. 모두 설계대로다. 소요는 33s다.
- 같은 registry가 11:01Z에는 200(0.54s)으로 응답했다. 외부 일시 장애로 본다(INFERENCE).
- 그러나 registry 실패가 stage 실패이므로 run 전체가 FAILED·exit 1이 됐다(`sync-status-semantics` 결정 그대로). 나머지 단계는 정상이었는데 workflow는 빨간색이다.
- **O-3 동작은 PASS, run 결과는 FAILED다.** 외부 단계 하나의 일시 장애가 workflow를 실패로 만드는 것을 허용할지는 정책 결정이다. 실측 1회로는 바꿀 근거가 부족하다.

## 12. Sync 처리량 및 병목 (FACT + INFERENCE)

- drain이 실행 시간의 76%(932/1222s)다. 처리량 13.4 jobs/min과 per-job p50 2.3s / p95 11.6s / max 55.2s(`affaan-m/ecc`, 608 artifact, truncated)는 baseline과 같은 수준이다. drain cap 200에서 멈췄다.
- **refresh not-reached가 43 → 158로 늘었다(FACT).** 12h stale 기준에 refresh cap 100, 하루 2회 실행이면 하루 재확인 상한은 200 repo다. 저장 repo가 늘수록 미도달분이 쌓인다(INFERENCE). 순서가 least-recently-read라 굶는 repo는 없고, 재확인 주기가 길어질 뿐이다.
- GitHub core는 410/5000만 썼다. 병목은 quota가 아니라 drain 시간(per-job 지연)과 cap이다.
- cap 상향은 하지 않는다. 표본이 1회이고, 상향 근거(실행 시간 여유·Actions 한도)를 측정하지 않았다.

## 13. 운영 응답 성능 (FACT, E-06–E-09)

### 13.1 동일 조건 재측정

조건은 Phase 26과 같다. 경로마다 10회, 1초 간격, 순차 요청이며 측정 위치는 한국(edge icn1)이다.

| 경로 | P26 TTFB p50 | 이번 p50 / p95 | 이번 total p50 | 첫 요청 |
|---|---|---|---|---|
| 정적 404 | 125 | **127** / 141 | 127 | 365 |
| DB 404 `/r/nobody/nothing` | 556 | **558** / 747 | 559 | 2,695 |
| `/artifacts` | 340 | **332** / 355 | 1,134 | 332 |
| 홈 | 704 | **807** / 865 | 1,027 | 2,574 |
| 저장소 | 1,207 | **1,234** / 1,247 | 1,414 | 1,914 |
| 상세 | 1,026 | **1,050** / 1,393 | 1,235 | 1,393 |
| 검색 `node.js` | 325 (total 1,221) | **335** / 380 (total 1,231) | 1,231 | 324 |

- 홈을 뺀 모든 경로가 Phase 26과 ±30ms 안이다.
- 홈은 +103ms다. 원인은 분리하지 않았다(1회 10샘플).
- "첫 요청" 열은 직전 경로 측정 뒤 20초 넘게 쉰 경우가 섞여 있어 §13.3의 재연결 비용이 들어간다.

### 13.2 서버 측 검색 시간의 구조 (FACT, E-03·E-07)

운영 `durationMs`는 계단처럼 나뉜다. warm 상태 값이다.

| 운영 durationMs | 왕복 수(÷233ms) | 해당 요청 |
|---|---|---|
| 240–242 | 1 | superpowers(17행), hookify(12행) |
| 310–315 | 1 | review page 34(3행) |
| 461–505 | 2 | pdf·playwright·review·debuging·mcp(25행), `type=hook`(25행), 결과 없음(`xqzvqqkw`), node.js page 2(0행) |
| 673–709 | 3 | node.js(20행), code review(25행) |
| 930–1,007 | 4 | three js, xqzv-nonexistent-term (`any` 완화, 25행) |

같은 빌드(`0f2cb82` 소스로 만든 `.next/standalone`)를 로컬 test DB 앞의 100ms 왕복 프록시 뒤에 두고 쟀다. 경로마다 warm-up 8회 뒤 10회를 쟀다.

| 검색 형태 | 로컬 durationMs | 왕복 | ReadyForQuery/요청 |
|---|---|---|---|
| 한 단어 (pdf, superpowers, hookify, review, debuging) | 102–106 | 1 | 2 |
| 여러 단어 (node.js, three js, code review) | 203–208 | 2 | 3 |
| 결과 없음 → 근사 검색 (xqzvqqkw) | 203–205 | 2 | 3 |

- **구조(FACT, 코드):**
  - 한 단어 검색은 rows와 count를 두 연결에서 병렬로 실행한다. 그래서 1왕복이다.
  - 여러 단어 검색은 `searchMode`의 EXISTS를 먼저 실행한다. 그래서 +1왕복이다.
  - 결과가 0행이면 `fuzzySearch`가 뒤따른다. 그래서 +1왕복이다.
- **운영의 추가 1–2왕복(INFERENCE):** 운영은 로컬 구조보다 행이 많을 때만 1–2왕복이 더 걸린다.
  - review는 page 1(25행) 480ms, page 34(3행) 313ms였다. 같은 문장과 같은 count에서 행 수만 다르다.
  - node.js는 page 1(20행) 700ms, page 2(0행) 480ms였다.
  - 로컬에서 rows 응답은 22행에 15.3KB, 16행에 8.6KB였다. TCP 초기 혼잡 창(약 14.6KB)을 넘는 응답은 고지연 구간에서 왕복이 하나 더 든다는 해석과 맞는다.
  - `type=hook`의 세 번째 요청은 239ms로 1왕복이었다. 직전에 쓰인 연결은 창이 이미 열려 있다는 해석과도 맞는다.
  - 로컬 프록시는 TCP 창을 흉내 내지 않으므로 이 부분은 재현하지 않았다.
- **SQL 실행 시간(FACT, 로컬):** search:eval 520회 p50 0.85ms, p95 2.6ms다. 50k 최악 경로도 26ms다(Phase 26). 운영 왕복 단위보다 두 자릿수 작다.

### 13.3 유휴 후 재연결 (FACT, E-08)

`/r/nobody/nothing`(warm에서 DB 2왕복)을 쉬는 시간을 바꿔 가며 요청했다.

| 직전 유휴 | TTFB (s) |
|---|---|
| 10초 | 0.56 |
| 15초 ×3 | 0.88, 0.79, 0.56 |
| 25초 ×3 | 2.79, 2.63, 2.53 |
| 30초 ×4 (직후 warm 요청과 짝) | 2.51 / 0.55, 2.56 / 0.54, 2.54 / 0.55, 2.51 / 0.55 |
| 40초 | 2.62 |

- 15초 이하와 25초 이상 사이에 약 2.0초 계단이 있다. 경계가 `idle_timeout: 20`(초)과 일치한다.
- **INFERENCE:** 추가 2.0초(약 8.5왕복)는 다음 비용의 합으로 본다.
  - 새 연결: TCP 1, TLS 1–2, startup·SCRAM 인증 약 3왕복
  - 새 연결에서 statement 첫 실행: +1왕복씩
  - Phase 23의 로컬 측정(21.5초 유휴 뒤 상세 +5왕복)과 같은 방향이다.
  - Fluid 인스턴스 교체와는 분리하지 않았다. 다만 15초와 25초 사이라는 좁은 경계는 Vercel 인스턴스 수명보다 이 설정으로 설명된다.

### 13.4 병목 분해

| 비용 | 크기 | 근거 |
|---|---|---|
| 1. Cold start | 첫 요청 2.5–5.7초 TTFB, 그때 검색 `durationMs` 최대 4.6초 | FACT. 단발이라 함수 기동, DB 연결, Neon compute 재개로 더 나누지 않았다 |
| 2. DB 연결 생성 | 20초 이상 유휴 뒤 +약 2.0초 | FACT(§13.3). 구성 비율은 INFERENCE |
| 3. Prepared Statement 최초 실행 | statement당 +1왕복(약 233ms) | FACT(§5.1의 1,130 → 690) |
| 4. SQL 실행 | 1ms 안팎(7.3k), 최악 26ms(50k) | FACT(로컬) |
| 5. DB 왕복 지연 | 1왕복 약 233ms, 페이지당 1–5왕복 | FACT(§13.2) |
| 6. 렌더링 | 정적 404 127ms가 상한이고, 이 중 상당 부분은 한국↔iad1 구간이다 | FACT(정적 404), 로컬 직접 연결 TTFB 5–13ms(Phase 23) |

웹 응답 시간의 대부분은 5번과 2번이다. 둘 다 DB 왕복 시간에 비례한다.

## 14. DB 리전 확인

| 항목 | 상태 |
|---|---|
| Vercel Function Region | **iad1** (FACT, `x-vercel-id` 헤더 4회) |
| Neon Region | **PENDING.** Neon CLI 없음, 연결 문자열 열람 금지, 저장소·문서·Actions 로그에 기록 없음 |
| DB 왕복 | 약 233ms (FACT, §13.2 계단 간격) |

- **INFERENCE:** 같은 AWS 리전 안의 왕복은 1–2ms이고, us-east-1↔us-east-2도 20ms 안팎이다. 233ms는 iad1과 Neon이 대륙 단위로 떨어져 있을 때 나오는 값이다. 특정 리전을 지목하지는 않는다.
- VERCEL_DEPLOY.md는 Function Region을 Neon과 같게 맞추라고 안내한다(139–140행). 운영은 기본값 iad1이다.

### 14.1 리전이 다를 경우의 계획 (승인 필요, 실행하지 않음)

| 항목 | 내용 |
|---|---|
| 변경 대상 | Vercel Project → Settings → Functions → Function Region을 Neon 리전과 같은(또는 가장 가까운) 리전으로 바꾼다. Neon은 바꾸지 않는다(리전 이전은 새 프로젝트와 데이터 이전이 필요하다) |
| 기대 효과 | 계산: DB 왕복 233ms → 수 ms. DB 404 약 0.56s → 0.15s 안팎, 상세 약 1.05s → 0.2s 안팎, 검색 `durationMs` 0.24–0.93s → 수십 ms. 유휴 후 재연결 +2.0s도 수십 ms로 줄어든다. 한국 사용자↔함수 구간은 리전에 따라 달라지므로 정적 404(127ms)는 따로 다시 잰다 |
| 비용 | Vercel Hobby는 리전 1개를 무료로 고를 수 있다(VERCEL_DEPLOY.md 기준, 요금표 재확인 필요). Neon 비용은 바뀌지 않는다 |
| 부작용 | 함수가 GitHub API에서 멀어질 수 있지만 웹은 GitHub를 호출하지 않는다(AGENTS.md "The web server does not ingest"). Sync는 GitHub Actions에서 돌므로 영향이 없다 |
| Rollback | Function Region을 iad1로 되돌리고 재배포한다. 데이터 변경이 없다 |
| 검증 | `x-vercel-id`의 두 번째 값이 새 리전인지 본다. `p26/prod-lat.py`, `p29/smoke29.py`, 유휴 프로브(§13.3)를 다시 돌린다. 검색 `durationMs`가 233ms 계단에서 벗어나는지와 error·5xx 0건을 확인한다 |

## 15. 추가 개선 필요성

사용자 조건 5개로 각 후보를 판정했다. 조건은 재현 가능, 원인 명확, 효과 근거, 회귀 검증 가능, 운영 위험 수용 가능이다.

| 후보 | 재현 | 원인 | 효과 근거 | 회귀 검증 | 운영 위험 | 결론 |
|---|---|---|---|---|---|---|
| R-1 Function Region 정렬 | ✔ | ✔(왕복 233ms) | ✔(왕복 수 × 233ms) | ✔ | Neon 리전 미확인 | **승인 대기**. 가장 큰 개선 |
| R-2 `idle_timeout` 20초 → 상향 | ✔(§13.3) | ✔(경계 일치) | ✔(유휴 뒤 첫 요청 −2.0s) | ✔ | **Neon compute 시간 증가량 미측정** | 코드 변경 보류. R-1이 되면 이득이 수십 ms로 줄어든다 |
| R-3 검색 응답 크기 축소 | 부분(운영 관찰만) | 추정(TCP 창) | 추정(검색당 −1왕복) | ✔ | 낮음 | 보류. 원인을 로컬에서 재현하지 못했다 |
| R-4 `searchMode` EXISTS 생략 | ✔(로컬 2왕복) | ✔ | ✔(여러 단어 검색 −1왕복) | ✔ | 의미 변경(`any` 판정) | 보류. 검색 의미 결정이 필요하다 |

- **코드 변경은 하지 않았다.**
- R-2는 `src/db/client.ts`의 기존 결정(Neon scale-to-zero 비용)과 직접 충돌한다. 비용 증가분을 Neon 콘솔에서 확인하기 전에는 운영 위험 조건을 만족하지 못한다.
- R-1이 적용되면 R-2·R-3·R-4의 이득이 모두 왕복 수 × 수 ms로 줄어든다. 순서는 R-1이 먼저다.

## 16. 코드 변경 및 테스트

- 코드 변경: 없음. 신규 파일은 이 보고서 하나다.
- 그래서 전체 CI 명령(check:boundaries, lint, typecheck, test, build, E2E)은 다시 돌리지 않았다(NOT RUN, 변경 없음).
  - `0f2cb82`의 내용은 Phase 26–28에서 같은 작업 트리로 검증했다: CI 1,489 passed, E2E 27/27.
  - GitHub CI 39924247597도 success다.
- 실행한 것: `search:eval` 54/54 (E-05).

## 17. 운영 승인 필요 항목

| 항목 | 선행 조건 | 상태 |
|---|---|---|
| Neon 리전 확인 | 운영자가 Neon 콘솔에서 확인 | 대기 |
| Vercel Function Region 변경(R-1) | Neon 리전이 iad1과 다를 때 | 대기, 계획은 §14.1 |
| `idle_timeout` 상향(R-2, 코드) | R-1을 못 할 때만. Neon 사용량(CU-hours) 확인 후 | 대기 |
| `ALTER ROLE` | – | 불필요(Phase 28에서 철회) |
| **Actions secret `DATABASE_URL`의 role 확인(§10)** | 운영자가 값 출력 없이 확인(Neon 콘솔, 또는 로컬 `bun run ops:preflight`) | **최우선 대기** |
| Actions secret 교체 또는 health용 읽기 전용 secret 추가 | 위 확인 결과가 `agentdock_app`이 아닐 때 | 대기 |
| registry 일시 장애 시 run을 FAILED로 둘지 정책 결정(§11) | 다음 몇 회의 registry 결과 | 관찰 |

## 18. PENDING / NOT RUN

| 항목 | 상태 | 이유 |
|---|---|---|
| Neon 리전 | PENDING | 확인 수단 없음 |
| 운영 EXPLAIN | NOT RUN | 금지 |
| 이전 배포와의 운영 순위 비교 | NOT RUN | Phase 26에 순서 hash 없음 |
| 운영 추가 왕복의 TCP 원인(§13.2) | INFERENCE | 로컬 프록시가 TCP 창을 흉내 내지 않음 |
| 재연결 비용의 세부 분해(§13.3) | INFERENCE | 운영 패킷 수준 관찰 불가 |
| Cold start 분해 | NOT RUN | 단발성 값 |
| 전체 CI·build·E2E | NOT RUN | 코드 변경 없음 |
| Actions secret 연결 role, startup parameter 무시 여부(§10) | PENDING | secret 열람 금지 |
| 공개 run 페이지의 Summary 렌더링(§10) | PENDING | 로그로는 문구 출력만 확인 |
| `storage_failed` 2건 원인(§7) | PENDING | 로그에 예외 정보 없음 |
| D-1·links 변화의 반복성 | PENDING | 표본 1회 |

## 19. Evidence

경로는 세션 scratchpad 기준이다(`…/scratchpad/`).

| ID | 내용 | 출처 |
|---|---|---|
| E-01 | SHA·Actions 목록, 운영 헤더 | 세션 출력 (`gh run list`, `curl -D -`) |
| E-02 | 검색 smoke 60회 | `p29/smoke29.py`, `p29/smoke29.jsonl` |
| E-03 | 서버 측 검색 시간 56건 + 10건 | `p29/w14.jsonl`, `w15.jsonl`, `w16.jsonl`, `l22.jsonl`, `search-ev.json` |
| E-04 | 오류·경고·fatal·5xx 로그 | 08:17Z 이후, 09:13Z 이후 각 0행 (세션 출력) |
| E-05 | search:eval | `p29/eval.txt` vs `p26/eval.txt` |
| E-06 | 운영 TTFB 10회×7경로 | `p26/prod-lat.py`, `p29/prod-lat.txt` · 비교 `p26/prod-lat.txt` |
| E-07 | 로컬 100ms 왕복 프록시 검색 측정, 응답 바이트 | `p29/proxy.mjs`, `p29/rtt-search.py`, `p29/rtt-search.txt`, `p29/srv-proxy.log` |
| E-08 | 유휴 후 재연결 | `p29/idle.txt`, `p29/idle2.txt` |
| E-10 | Sync 39940525800 job log, step 결론 | `p29/sync-39940525800.log` (`gh api …/jobs/120370544542/logs`), `p29/sync-an.py`, baseline `p29/sync-39853119505.log` |
| E-11 | Sync 이후 운영 로그 | 10:35Z 이후 error·warning·fatal·5xx 0행 (세션 출력) |
| E-12 | hook 이름 분포 | `p29/hooks.py`, `p29/hooks-before.json`, `p29/hooks-after.json` |
| E-09 | 코드 구조 | `src/db/queries/search.ts:295-297,698-714,757-787,842` · `src/app/artifacts/page.tsx:356-373` · `src/db/client.ts:15-23` |

## 20. Git Status

2026-10-23 11:10Z 기준:

```
$ git status --short
?? docs/analysis/agentdock-phase29-31-production-final-verification.md
$ git rev-parse --short HEAD; git rev-parse --short origin/develop
0f2cb82
0f2cb82
```

이 보고서 외에 변경한 파일은 없다.

## 21. 다음 작업 우선순위

1. **Actions secret `DATABASE_URL`의 role 확인(§10, 운영자).** `agentdock_app`이 아니면 secret을 교체한다. Sync가 schema 격리 밖의 권한으로 돌 수 있는 상태라 가장 먼저 한다.
2. **Neon 리전 확인 → R-1 Function Region 정렬(§14.1, 승인).** 웹 응답 지연의 최대 요인이다.
3. 다음 예약 Sync 1–2회 관찰. registry가 회복되는지, D-1 비율이 유지되는지, refresh not-reached 추이를 본다.
4. `storage_failed` 반복 repo(`elementalsouls/claude-bughunter`)를 로컬 test DB에서 재현해 원인을 본다.
5. O-2: 1번이 해결된 뒤 Summary가 실제로 렌더링되는지 공개 run 페이지에서 확인한다.
6. R-2(`idle_timeout`)는 R-1이 불가능할 때만, Neon CU 사용량 확인 후 검토한다.
