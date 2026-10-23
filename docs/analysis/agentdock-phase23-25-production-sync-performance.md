# AgentDock Phase 23–25 — 운영 배포 검증, Sync 효율, 응답 성능

- 작성: 2026-10-23 (측정 06:44–07:12 UTC)
- 기준: 로컬 HEAD = origin/develop = 운영 배포본 = `bb7c2ed`
- 이전 보고서: [Phase 13–16](agentdock-phase13-16-post-deployment-verification.md) · [Phase 17–19](agentdock-phase17-19-discovery-quality-search.md) · [Phase 20–22](agentdock-phase20-22-operations-performance-experience.md)
- 운영 DB 접속, 운영 DB write, 수동 Sync, workflow_dispatch, migration, 배포, commit/push는 하지 않았다. 운영에는 읽기 전용 GET만 보냈다(약 110회).

## 1. 핵심 결론

| Phase | 판정 | 한 줄 |
|---|---|---|
| 23 배포·효과 검증 | **CONDITIONAL** | SHA 6곳 일치, 웹 변경(U-2a·U-2b·S-1)은 운영에서 PASS. Sync에 의존하는 O-3·O-2·D-1·C-1은 배포 후 예약 Sync가 0회라 PENDING |
| 24 Sync 효율 | **PENDING** | D-1 이후 실행 기록이 없어 상한은 NO CHANGE. registry 실패 경로의 진척 유실을 실측으로 확인하고 고쳤다(로컬 PASS) |
| 25 응답 성능 | **CONDITIONAL** | 운영 지연은 "RTT 약 0.215초 × 직렬 DB 왕복 수"로 설명된다. 코드가 왕복을 두 배로 쓰고 있었다(Drizzle 문장이 prepare되지 않음). 수정 후 로컬 동일 조건에서 DB 페이지 응답이 약 절반이 됐다. 운영 효과·Neon 리전은 PENDING |

응답 지연의 주원인은 두 가지가 곱해진 것이다.
1. **함수–DB 왕복이 길다(약 0.215초, 추정).** 함수는 iad1이고 Neon 리전은 확인하지 못했다. 같은 리전이라면 1–2ms여야 한다.
2. **코드가 문장마다 왕복을 2회 쓴다(실측).** Drizzle은 모든 문장을 `sql.unsafe()`로 보내고, postgres.js의 `unsafe()` 기본값은 `prepare:false`다. 그래서 파라미터가 있는 문장은 매번 Parse/Describe와 Bind/Execute로 왕복 2회가 들었다. `client.ts` 주석의 "Prepared statements stay on"은 tagged query에만 맞았다.

## 2. 기준 SHA 및 Git 상태

| 항목 | 값 |
|---|---|
| 로컬 HEAD | `bb7c2ede81e9704d089aa7ad894413d1acbed002` |
| origin/develop | 같음 |
| 작업 시작 시 working tree | clean |
| 마지막 성공 CI | 39911998457 (push, `bb7c2ed`, 06:31–06:32Z) |
| 마지막 성공 Deploy | 39912121591 (workflow_run, `bb7c2ed`, 06:32–06:34Z) |
| 운영 `X-AgentDock-Commit` | `bb7c2ed…` (`/`, `/artifacts`, `/r/anthropics/skills`, 06:44Z) |
| 마지막 Sync | 39853119505 (schedule, `3a8a3c3`, 2026-10-22 20:56Z) — 배포 이후 0회 |

## 3. Phase 23 — 배포 정합성

- 6개 SHA가 모두 `bb7c2ed`로 일치한다. **배포 성공: PASS**
- 운영 기능 정상 여부는 아래 §4에서 기능별로 따로 판정했다.
- 함수 리전은 응답 헤더 `x-vercel-id: icn1::iad1::…`로 iad1이다.

## 4. Phase 17–22 운영 효과

### 4.1 U-2a 정규 주소 — PASS (운영 실측, E-03)

| 요청 | 결과 |
|---|---|
| `/r/Anthropics/skills`, `/r/ANTHROPICS/SKILLS` | 308 → `/r/anthropics/skills` |
| `/r/anthropics/skills/skills/pdf/SKILL.md` | 308 → `…/skills/pdf` |
| `/r/Anthropics/skills/skills/pdf` | 308 → `…/skills/pdf` |
| `…/skills/pdf/` (끝 슬래시) | 308 (Next 기본 동작, 0.04초) |
| 정규 상세·저장소 주소 | 200 |
| `/r/nobody/nothing`, `…/skills/nonexistent` | 404 유지 |
| `-L --max-redirs 5`로 끝까지 따라감 | redirect 1회 후 200, loop 없음 |

내부 링크의 불필요한 redirect가 없다는 것은 Phase 22에서 로컬로 확인했다(217개). 이번에는 운영에서 재확인하지 않았다.

### 4.2 U-2b 메타데이터 — PASS (운영 실측, E-04)

| 페이지 | title / description / OG·Twitter |
|---|---|
| hook 상세(설명 없음) `…/explanatory-output-style/hooks/hooks.json` | `Hook Configuration at plugins/explanatory-output-style/hooks/hooks.json in anthropics/claude-code, as read at commit d014fc0.` |
| skill 상세(설명 있음) `…/skills/pdf` | 기존 설명을 그대로 쓴다(회귀 없음) |
| 저장소 `/r/anthropics/skills` | `anthropics/skills — AgentDock` / 저장소 설명 |
| 목록 `/artifacts` | `Artifacts — AgentDock` / 목록 설명 |

### 4.3 S-1 검색 — PASS (운영 실측, E-05)

| 질의 | 결과 수 | Phase 20 측정 |
|---|---|---|
| `node.js` | 20 | 20 |
| `three.js` | 1 | 1 |
| `three js` | 81 (1위 r3f-best-practices) | 81 |
| `p5.js` | 2 (algorithmic-art) | 2 |
| `next.js` | 26 | 26 |
| `review` | 828 | 828 |
| `pdf` | 59 | 59 |
| `playwright` | 35 | — |

결과 수가 바뀌지 않았으므로 회귀는 없다. 개선 자체는 Phase 20에서 이미 확인했다. 로컬 search:eval도 52개 케이스가 Phase 20과 줄 단위로 같다(E-14).

### 4.4 O-3 Registry Retry — PENDING

- 배포 코드에 포함돼 있다(`bb7c2ed`의 `src/registry/sync.ts`).
- 배포 후 예약 Sync가 0회라 `retried=` 출력도, 복구 사례도 없다.

### 4.5 O-2 Health Summary / Read-only Guard — PENDING

- `sync.yml`의 "Sync health summary"는 `continue-on-error: true`다. 따라서 step은 실패하고 workflow는 성공하는 경우가 생기고, 둘은 step outcome으로 구분된다.
- 운영 실행은 0회다. role(`connected as agentdock_app`)과 guard 결과는 다음 예약 Sync에서 확인한다(§5).

### 4.6 D-1 Discovery — PENDING

D-1 이후 Sync가 없다. 비교 기준선은 §7에 있다.

### 4.7 C-1 Corpus — PENDING (backfill 불필요)

- 운영 `/artifacts?type=hook` 1쪽 25개는 `hooks` 21개, `settings` 4개다. Phase 17 측정과 같다.
- 이것은 예상된 결과다. C-1은 수집할 때 이름을 만들고, 기존 행은 그 저장소를 새 commit으로 다시 읽을 때 upsert로 바뀐다. 배포 후 수집이 0회였다.
- **backfill은 필요 없다고 판단한다.**
  - refresh가 run당 100개씩 돌고 있다.
  - commit이 바뀌지 않은 저장소는 `hooks`로 남는다. 그래도 이것은 이름 표시 품질 문제이고 데이터 오류가 아니다.
  - 일괄 갱신은 운영 데이터 변경이다.
- 다음 Sync 이후 분포를 다시 본다.

운영 결과가 달라졌다는 사실과 변경이 원인이라는 판단은 구분했다. 이번에 "효과 있음"으로 판정한 항목은 결과가 변경 코드 경로에서만 나올 수 있는 것(308, fallback 문구)과 Phase 20에서 이미 확인한 S-1뿐이다.

## 5. Read-only Guard 실행 결과

**PENDING.** 운영 실행 기록이 없다.

- 로컬과 CI에서는 Phase 13–16 이후 `ci.yml`의 database job이 일회용 DB를 대상으로 preflight·status·quality를 계속 실행하고 있다(CI 39911998457 SUCCESS).
- 운영에서 확인할 것:
  1. "Sync health summary" step의 outcome
  2. summary에 보고서 또는 `**Not available**` 한 줄이 있는지
  3. step log에 `ops: FAIL`이 없는지

## 6. Registry 장애와 retry 결과

| run | 시작(UTC) | 실패 시각 | sweep 시작부터 | 오류 | retry | 결과 |
|---|---|---|---|---|---|---|
| 39408723010 | 10-20 10:34 | 10:35:11 | — | could not reach | 없음(구 코드) | FAILED |
| 39586894653 | 10-21 10:45:19 | 10:45:41 | 약 12.5초 | could not reach | 없음 | FAILED |
| 39765655496 | 10-22 10:47:03 | 10:47:21 | 18.4초(`stage registry 18s`) | HTTP 500 | 없음 | FAILED |
| 39674909791 / 39853119505 | 18:00 회차 | — | 40쪽, 22–33초 | — | — | 성공 |

- 요청 URL 유형은 MCP registry 서버 목록 페이지(cursor 페이지네이션)다.
- 실패한 page 위치는 **로그로 알 수 없었다.** 실패 메시지에 읽은 쪽 수가 없었다. 성공 run의 속도(쪽당 0.55–0.8초)로 환산하면 15–30쪽째로 **추정**한다.
- 오류 유형:
  - 연결 실패 2회와 HTTP 500 1회는 외부 서비스 쪽 응답이다.
  - 같은 코드가 18:00 회차와 dispatch 8회에서는 성공했다.
  - 따라서 내부 오류로 볼 근거는 없다.
  - 시간대가 원인이라는 가설은 3회 표본뿐이라 확정하지 않는다.
- **이번에 찾은 결함(실측, 코드 확인):** 재시도까지 실패하면 `syncRegistry`가 cursor를 저장하지 않고 throw했다.
  - 그 run에서 이미 읽고 seed를 쓴 페이지들의 진척이 사라져서, 다음 run이 같은 페이지를 처음부터 다시 읽는다.
  - parse 실패 경로(`parse_failure`)는 cursor를 저장하는데, 이 경로만 저장하지 않았다.
  - 그 결과 "실패한 page 위치"가 로그에 남지 않았다.
- 수정 내용은 §12의 R-1이다. retry 효과 자체는 PENDING이다.

## 7. Sync 처리 효율 Baseline (D-1 이전, 운영 로그)

| run | Status | 처리 | 신규 ingest | unchanged | floor 거절 | 읽기 실패 | core 사용 | 시간 |
|---|---|---|---|---|---|---|---|---|
| 39716460966 (dispatch) | PARTIAL_CAP | 200 | 76 | 20 | 69 | 13 | 431 | 1273초 |
| 39765655496 (06시) | FAILED(registry) | 147 | 44 | 31 | 49 | 11 | — | 1049초 |
| 39853119505 (18시) | PARTIAL_CAP | 200 | 66 | 74 | 40 | 7 | 421/5000 | 1406초 |

슬롯별 생산성(job id 순서, 39853119505):

| 구간 | 결과 |
|---|---|
| search 0–34 | ok 27 |
| links 34–67 | ok 12, floor 16 |
| **backlog 67–100** | **ok 1**, floor 24, unreadable 7 |
| refresh 100–200 | unchanged 74, ok 26 |

refresh는 considered가 4 → 27 → 41 → 100으로 늘었고, 마지막 run에서 not-reached가 43이었다. D-1 이후 값은 PENDING이다.

## 8. enqueue/refresh 상한 판단 — NO CHANGE

| 질문 | 답 | 근거 |
|---|---|---|
| 1. enqueue 상한이 병목인가 | 그렇다. drain 200/200이 묶인다 | §7 |
| 2. known eligible seed가 먼저 소비되는가 | 코드상 그렇다(D-1). 운영 효과는 PENDING | D-1 이후 run 없음 |
| 3. registry seed가 유용한 seed를 늦추는가 | D-1 이전에는 그랬다(backlog 33슬롯 중 1개만 생산적) | §7 |
| 4. refresh가 계속 밀리는가 | 1회 관찰(not-reached 43). 추세는 미확인 | 표본 1 |
| 5. 시간·API 여유가 있는가 | 있다. core 8%, drain 957초 / deadline 2100초 | 39853119505 |
| 6. 상한을 올리면 신규 ingest가 느는가 | 알 수 없다. backlog 생산성이 D-1로 바뀌었는지 모른다 | PENDING |

- 지시대로, 운영 효과가 PENDING이므로 상한은 바꾸지 않았다.
- 재조정 근거가 될 값: D-1 이후 backlog 구간 ok 비율, refresh not-reached 추이.

## 9. 운영 응답 지연 Baseline (재측정, E-08)

2026-10-23 06:54Z에 측정했다. 페이지당 10회, 1초 간격, 순차 요청이다. 단위는 ms이고 p50/p95다.

| 페이지 | 직렬 DB 왕복(로컬 실측) | TTFB | 전체 | 첫 요청 |
|---|---|---|---|---|
| 없는 경로(정적 404, 함수 없음) | 0 | 136/210 | 136/210 | 1056 |
| `/r/nobody/nothing` (문장 1) | 2.1 | 778/1018 | 779/1019 | 5800 |
| `/artifacts` (스트리밍) | 0 / 본문 2.6 | 348/373 | 1249/1296 | 370 |
| `/` | 2.6 | 876/898 | 1067/1087 | 2559 |
| `/r/anthropics/skills` (job 있음) | 10.6 | 2756/2842 | 2937/3028 | 2552 |
| `…/skills/pdf` 상세 | 4.3 | 1258/1295 | 1448/1486 | 3180 |
| `/artifacts?q=node.js` | 0 / 본문 | 327/337 | 1656/1712 | 313 |

모델 적합 결과:
- 함수 shell은 약 0.33초다(`/artifacts` TTFB).
- 문장 1개 404는 0.78 − 0.33 = 0.45초가 왕복 2.1회이므로, **RTT ≈ 0.215초**다.
- 이 RTT로 예측한 값과 실측이 맞는다.
  - 홈: 0.33 + 2.6 × 0.215 = 0.89초, 실측 0.876초
  - 상세: 0.33 + 4.3 × 0.215 = 1.25초, 실측 1.258초
  - 저장소: 0.33 + 10.6 × 0.215 = 2.61초, 실측 2.756초. 나머지는 큰 저장소의 목록 쿼리 실행 시간이다.
- 첫 요청 2.5–5.8초는 연결 수립(TCP, TLS, 인증)과 cold start다. 로컬 프록시로는 TLS를 재현하지 않아 이 비용은 분리하지 못했다.

## 10. Vercel/Neon 리전 확인 결과

| 항목 | 결과 |
|---|---|
| Vercel Function Region | **iad1** (헤더 실측). `vercel.json`에 regions 설정 없음, 대시보드 기본값 |
| Neon 리전 | **미확인.** DB host는 secret이고 `.env`·운영 DB에 접근하지 않았다. vercel/neonctl CLI도 없다 |
| 웹 연결 방식 | pooled(`-pooler`, PgBouncer). README·VERCEL_DEPLOY.md 기준이며 운영 값은 확인하지 않았다 |
| 측정으로 추정한 RTT | 약 0.215초. 같은 리전이면 1–2ms다. 리전 이름은 추정하지 않는다 |

**변경 계획(승인 필요, 실행하지 않음)**

1. 운영자가 Neon 콘솔 → Project settings에서 리전을 확인한다.
2. iad1(us-east-1)과 다르면 Vercel → Settings → Functions → Function Region을 Neon과 같은 리전으로 바꾸고 재배포한다.
3. 확인: `x-vercel-id`의 두 번째 값이 바뀌고, `/r/nobody/nothing` TTFB가 0.78초에서 약 0.35초로 내려가야 한다.
4. Rollback: Function Region을 iad1로 되돌리고 재배포한다. 데이터 이동은 없다.
5. GitHub Actions Sync는 Vercel과 무관하다. 대신 sync도 같은 RTT를 쓰므로 Neon 리전 확인은 sync 시간 해석에도 필요하다.

## 11. 병목 원인 분석 (로컬, E-09–E-12)

### 11.1 측정 방법

- 로컬 PostgreSQL 앞에 지연 TCP 프록시를 둔다. 방향마다 50ms이므로 RTT는 100ms다.
- 프록시는 연결 수와 ReadyForQuery(`Z`) 수를 센다.
- 같은 빌드를 프록시 경유(3971)와 직접 연결(3972)로 동시에 띄운다.
- 페이지마다 warm-up 2회 뒤 15회씩 측정하고, Δp50을 100ms로 나눈 값을 직렬 왕복 수로 본다.

| 비용 | 분리 결과 |
|---|---|
| 1. cold start | 운영 첫 요청에서만 보인다(1–5초). 로컬로 분리하지 않았다(NOT RUN) |
| 2. DB 연결 | cold 조건(21.5초 idle 뒤 1회 요청)에서 상세 953ms, warm에서 443ms → 연결 수립이 약 5 RTT다. 변경 전후 같다 |
| 3. 쿼리 실행 | 직접 연결 p50 8–15ms(e2e 데이터), 합성 7.3k에서 browse 45ms |
| 4. 네트워크 RTT | 직렬 왕복 수 × RTT. **지배 요인** |
| 5. SSR/렌더링 | 정적 404 4ms, shell 6–10ms로 무시할 수 있다 |
| 6. 캐시 | `force-dynamic`이고 `x-vercel-cache: MISS`다. 캐시 영향은 없다 |

### 11.2 직렬 왕복 수 (RTT 100ms, warm, p50)

| 페이지 | 문장/요청 | 변경 전 왕복 | 변경 후 왕복 |
|---|---|---|---|
| 저장소 404 | 1 | 2.1 | 1.1 |
| 상세 404 | 2 | 2.1 | 1.1 |
| 홈 | 3 | 2.6 | 1.2 |
| 저장소(job 없음) | 3 | 6.2 | 3.1 |
| 저장소(job 있음) | 5 → 3 | 10.6 | 3.2 |
| 상세 | 5 | 4.3 | 2.1 |

### 11.3 원인 1: Drizzle 문장이 prepare되지 않음 (P-2)

- `node_modules/postgres/src/index.js:119`의 `unsafe()`는 `{ prepare: false, ...options }`다.
- `connection.js:238`에 따르면 파라미터가 있고 prepare되지 않은 문장은 `describeFirst`다. Parse+Describe를 보내고 응답을 기다린 다음 Bind+Execute를 보내므로 왕복이 2회다.
- Drizzle `postgres-js/session.js`는 모든 실행을 `client.unsafe(query, params)`로 보내고 options를 넘기지 않는다.
- Phase 20에서 "같은 문장 반복은 1 RTT"라고 기록한 것은 tagged query 실험이었다. 웹의 Drizzle 경로에는 해당하지 않았다. 이번에 바로잡는다.

### 11.4 원인 2: 저장소 페이지의 불필요한 직렬 문장 2개 (P-3)

- `latestJobForTarget`는 job id를 찾은 다음 `getJobView`로 job 행과 최근 attempt를 다시 읽었다.
- 그런데 페이지가 쓰는 값은 `id`와 `status`뿐이다. job이 있는 저장소에서는 직렬 문장이 2개 더 붙었다.
- 운영 `/r/anthropics/skills`가 모델보다 1초 더 느린 이유가 이것이다.

## 12. 변경한 파일과 이유

| ID | 파일 | 변경 | 근거 |
|---|---|---|---|
| P-2 | `src/db/client.ts` | Drizzle에 넘기는 client를 Proxy로 감싸 `unsafe()`에 `prepare: true`를 기본으로 준다. 측정값과 generic plan 상한을 담은 `ponytail:` 주석 | §11.3 |
| P-2 | `src/db/client.test.ts` | Drizzle 문장이 `prepare: true`로 나가는지 확인하는 테스트 | 변경 전 실패 확인 |
| P-2b | `scripts/sql/bootstrap-agentdock.sql` | `ALTER ROLE agentdock_app SET plan_cache_mode = force_custom_plan` | §13.3 generic plan 반증 |
| P-3 | `src/db/queries/jobs.ts` | `latestJobForTarget`가 `{id, status}`를 문장 1개로 반환한다 | §11.4 |
| P-3 | `src/db/queries/jobs.test.ts` | 문장 1개, 대소문자 무관, 없으면 null | 변경 전 실패 확인 |
| R-1 | `src/registry/sync.ts` | 재시도 후에도 실패하면 cursor를 저장하고, 메시지에 읽은 쪽 수를 적는다 | §6 |
| R-1 | `src/registry/sync.test.ts` | 기존 두 번째 실패 테스트에 메시지 문구와 cursor 저장 단언 추가 | 변경 전 실패 확인 |

하지 않은 것과 이유:
- 저장소 페이지 쿼리를 `Promise.all`로 병렬화하지 않았다. 병렬 문장은 pool에서 새 연결을 열 수 있고, 운영의 연결 수립은 약 5 RTT라 더 느려질 수 있다.
- `plan_cache_mode`를 startup parameter로 보내지 않았다. pooler가 모르는 startup parameter를 거부하면 모든 페이지가 실패한다. 그래서 role 기본값으로 둔다.
- Function Region, 환경 변수, Neon 설정은 바꾸지 않았다(승인 필요).

## 13. 변경 전후 정량 비교

### 13.1 응답 시간 (로컬, RTT 100ms 프록시, warm, 15회, ms p50/p95, E-10)

base는 HEAD와 DB 코드가 같은 빌드다. `src/db`는 `05f5e57`부터 `bb7c2ed`까지 변경이 없다.

| 페이지 | base 전체 | new 전체 |
|---|---|---|
| `/r/nobody/nothing` | 216/221 | 114/117 |
| `/` | 267/277 | 131/270 |
| `/artifacts` | 270/277 | 132/138 |
| `/artifacts?q=review` | 268/278 | 131/138 |
| `/artifacts?type=hook` | 223/226 | 120/123 |
| `/r/fixture/ui-edge-cases` | 629/636 | 322/325 |
| `…/skills/pdf` | 443/480 | 236/337 |
| `/r/anthropics/skills` (job 있음, 9회) | 1065 | 518(P-2만) → **319**(P-2+P-3) |

cold(21.5초 idle 뒤 1회, 4회 p50)는 변경 전후 같다. 상세 953→894, 저장소 856→825, `/artifacts` 467→481. 첫 실행 문장은 여전히 2 RTT이므로 예상과 맞는다.

### 13.2 운영 예상치 (추정, RTT 0.215초, warm 연결 기준)

| 페이지 | 현재 실측 TTFB | 예상 |
|---|---|---|
| 문장 1개 404 | 0.78초 | 약 0.57초 |
| 홈 | 0.88초 | 약 0.59초 |
| 상세 | 1.26초 | 약 0.78초 |
| 저장소(job 있음) | 2.76초 | 약 1.4초 |

- 연결이 새로 열린 요청은 이득이 없다. Fluid 인스턴스의 pool에서 같은 문장을 이미 실행한 연결만 이득을 본다(`idle_timeout` 20초).
- 실제 적중률은 운영에서 봐야 한다(PENDING).

### 13.3 generic plan 반증과 대응 (합성 corpus, E-12)

- named prepared statement는 같은 연결에서 6번째 실행부터 PostgreSQL이 generic plan을 고를 수 있다.
- 기존 합성 데이터셋(`perf/gen.sql`, Phase 20과 같은 생성기)으로 쿼리 함수를 20회씩 측정했다. 단위는 ms p50이다.

| 케이스 | 7.3k old | 7.3k prepared | 7.3k prepared + force_custom_plan | 50k old | 50k prepared |
|---|---|---|---|---|---|
| q=node.js | 11.0 | 26.6 | 9.3 | 31.6 | 95.5 |
| q=review | 14.2 | 16.6 | 10.1 | 47.7 | 79.7 |
| q=code review | 9.3 | 16.4 | 9.1 | 34.1 | 85.1 |
| q=kubernetes wechat | 20.1 | 33.8 | 19.9 | 89.1 | 176.9 |
| browse recent | 44.8 | 43.8 | 44.4 | 276.3 | 294.4 |
| home listPackages(18) | 43.3 | 40.6 | 61.1 | 287.6 | 273.6 |
| detail getPackageDetail | 0.8 | 0.3 | 0.6 | 0.8 | 0.2 |
| repo getRepositoryPackages | 1.5 | 1.4 | 1.3 | 1.6 | 1.3 |

판단:
- **prepared만 적용해도 운영에서는 이득이다.** 검색 문장이 7.3k에서 5–15ms, 50k에서 50–90ms 늘지만 문장마다 왕복 1회(약 215ms)가 준다.
- **role 기본값 `force_custom_plan`을 함께 적용하면 이 비용도 사라진다.** 로컬에서 확인했고, 설정은 측정 후 원복했다.
  - 운영 role 변경은 superuser 문장 1개이며 승인이 필요하다(§15).
  - 신규 설치에는 bootstrap SQL로 반영된다.
- 리전을 맞춰 RTT가 수 ms가 되면, role 설정 없이는 prepared가 손해로 바뀐다. 이 조건을 `client.ts`의 `ponytail:` 주석에 trigger로 적었다.
- 결과 행 수(`total`)는 모든 케이스에서 같다. 의미 변화는 없다.

### 13.4 Pooler 호환성 (로컬 PgBouncer, E-11)

- 구성: PgBouncer 1.25.2, `pool_mode=transaction`, `max_prepared_statements=1000`, 서버 연결 2개, `track_extra_parameters=search_path`
- 결과:
  - 10개 URL을 20회씩, 동시 8개로 요청한 200건이 모두 기대 코드(200 180건, 404 20건)였다.
  - 10개 URL 모두 직접 연결 서버와 `<title>`·`<h1>`이 같았다.
  - `SHOW SERVERS`에서 `prepared_statements = 17`(서버 연결 2개 모두)을 확인해, named statement가 pooler를 통과한 것을 확인했다.
- 한계: Neon의 PgBouncer 버전과 설정은 확인하지 못했다. 운영 배포 직후 확인이 필요하다(§16).

### 13.5 R-1

- 테스트로 확인했다. 두 번째 실패 시 메시지가 `"… Retried once after 0 s; 1 page(s) were read this run, and the next run resumes after them."`이고, sweep 상태의 cursor가 `c1`이다.
- 변경 전에는 메시지가 `"… Retried once after 0 s."`이고 cursor가 저장되지 않았다.

## 14. 테스트 및 E2E 결과 (이번 실행, E-13–E-15)

| 항목 | 결과 |
|---|---|
| `bun run check:boundaries` | OK |
| `bun run lint` | 소스 PASS(추적 파일 229개, 수정 없음). 단 전체 실행은 **E2E 후 남는 git-ignored `test-results/.last-run.json`의 끝 줄바꿈 1건으로 exit 1**. 제품 코드 결함이 아니고, CI는 E2E 전에 lint를 돌리므로 영향이 없다 |
| `bun run typecheck` | OK |
| `CI=1 bun run test` | **79 files passed + 1 skipped, 1,485 passed / 3 skipped** (기존 1,483 + 신규 2. registry 테스트 1건은 수정) |
| `bun run build` (placeholder DATABASE_URL) | OK |
| `bun run test:e2e` (`CI=1`, e2e 재시드 후) | **27/27** |
| `bun run search:eval` | 54/54. 요약 지표와 52개 케이스 줄이 Phase 20과 같다 |
| 신규 회귀 테스트의 변경 전 실패 | 3건 모두 확인 (client prepare, latestJobForTarget, registry cursor) |
| 비CI 모드 테스트 | NOT RUN |
| 운영 E2E | NOT RUN (운영에는 curl GET만 보냄) |
| GitHub API rate limit 관련 실패 | 없음 |

## 15. 운영 영향과 rollback

| 변경 | 적용 시점 | 영향 | 위험 | rollback |
|---|---|---|---|---|
| P-2 prepare | 웹 배포 즉시 | warm 연결의 문장마다 왕복 1회 감소 | Neon pooler가 named prepared statement를 거부하면 DB 페이지가 오류를 낸다(로컬 PgBouncer에서는 정상). 검색 문장 generic plan이 +5–15ms(7.3k) | `git revert`, 재배포 |
| P-2b role 설정 | 운영자가 실행할 때만 | generic plan 비용 제거 | 거의 없음. role 기본값이며 새 세션부터 적용 | `ALTER ROLE agentdock_app RESET plan_cache_mode;` |
| P-3 job 상태 | 웹 배포 즉시 | job 있는 저장소 페이지에서 직렬 문장 2개 감소 | 없음(표시 값 동일, E2E·단위 테스트) | revert |
| R-1 registry | 다음 예약 Sync | 실패 시 진척 보존, 로그에 쪽 수 | 실패 run이 cursor를 앞으로 옮긴다. parse 실패와 같은 의미 | revert |

- migration은 없다. schema, URL, API 계약도 바뀌지 않는다.
- 운영 role 설정 문장(승인 후 운영자가 superuser로 1회 실행):

  ```sql
  ALTER ROLE agentdock_app SET plan_cache_mode = force_custom_plan;
  ```

- 배포 직후 smoke(읽기 전용):
  1. 상세·저장소·검색 페이지를 각각 3회 이상 연속 열어 모두 200인지 본다. 같은 연결에서 두 번째 실행부터 prepared 경로를 탄다.
  2. Vercel 함수 로그에 `prepared statement` 또는 SQLSTATE `26000`/`42P05`가 없는지 본다.
  3. `/r/nobody/nothing` warm TTFB를 10회 측정한다. 0.78초에서 0.6초 안팎으로 내려가야 한다.

## 16. PENDING / NOT RUN

| 항목 | 상태 | 해소 조건 |
|---|---|---|
| O-3 retry 효과, `retried=` 값 | PENDING | 다음 06:00 회차(최근 사흘 실제 시작 10:32–10:47 UTC) |
| O-2 summary, guard 결과, role | PENDING | 다음 예약 Sync |
| D-1 backlog 67–100 구간 ok 비율 | PENDING | 다음 예약 Sync |
| C-1 hook 이름 분포 | PENDING | 다음 Sync 이후 저장소 재수집 |
| refresh not-reached 추이 | PENDING | Sync 2–3회 |
| Neon 리전 | PENDING | 운영자 콘솔 확인 |
| P-2 운영 효과·pooler 호환 | PENDING | 이 변경 배포 후 §15 smoke |
| P-2b 운영 role 설정 | PENDING(승인 필요) | 운영자 실행 |
| cold start 분리 측정 | NOT RUN | — |
| 운영 E2E, 비CI 모드 테스트 | NOT RUN | — |

## 17. 후속 작업 우선순위

1. **이 변경 배포 + §15 smoke.** pooler 호환을 가장 먼저 확인한다.
2. **Neon 리전 확인 → Vercel Function Region 정렬(승인).** RTT가 지배 요인이므로 효과가 가장 크다(예상 TTFB 0.3–0.4초).
3. **`plan_cache_mode` role 설정(승인).** 리전 정렬과 함께 하면 prepared가 모든 RTT에서 손해 없이 남는다.
4. 다음 예약 Sync 후 §16의 Sync 항목을 확인한다. 그 결과로 enqueue/refresh 상한을 재조정한다.
5. 목록 count가 100ms를 넘는 규모(약 20k)가 되면 listed 파생 저장을 검토한다(Phase 20 결론 유지).

## 18. Evidence

| ID | 내용 | 출처 |
|---|---|---|
| E-01 | Git SHA, working tree | `git rev-parse HEAD origin/develop`, `git status` |
| E-02 | CI/Deploy/Sync run 목록 | `gh run list --limit 30` (39911998457, 39912121591, 39853119505) |
| E-03 | 운영 redirect 9종, loop 확인 | curl `-w '%{http_code} %{redirect_url}'`, `-L --max-redirs 5` (06:45Z) |
| E-04 | 운영 메타데이터 4종 | curl + grep `<title>`/`<meta>` |
| E-05 | 운영 검색 8개 질의 | curl `/artifacts?q=…` |
| E-06 | 운영 hook 이름 분포 | `/artifacts?type=hook` 1쪽 25개 |
| E-07 | registry 실패 로그 | Sync 로그 39408723010, 39586894653, 39765655496, 39674909791, 39853119505 |
| E-08 | 운영 지연 재측정 | scratchpad `p23/prod-lat.py`, `prod-lat.txt` (06:54Z) |
| E-09 | 직렬 왕복 수 전후 | `p23/proxy.mjs`, `rtt-pages.py`, `rtt-warm.txt`, `rtt-warm-after.txt` |
| E-10 | base/new 전체 시간, cold | `p23/total.py`, `total-warm.txt`, `total-cold.txt` |
| E-11 | PgBouncer 호환 | `p23/pgb/pgbouncer.ini`, `SHOW SERVERS` |
| E-12 | 합성 7.3k/50k 벤치 | `perf/gen.sql`, `perf/p20-bench.mjs`, `p23/bench{7k,50k}-{old,new}.json`, `bench7k-new-custom.json` |
| E-13 | CI 모드 테스트 | `p23/ci-test2.log` |
| E-14 | search:eval | `p23/eval.txt` vs `p20-eval.txt` |
| E-15 | E2E | `p23/e2e.log` |
| E-16 | postgres.js/drizzle 동작 | `node_modules/postgres/src/index.js:119`, `connection.js:186-238`, `drizzle-orm/postgres-js/session.js:33,43` |

scratchpad 위치: `/tmp/claude-1000/-home-ChoiGwanghun-workspace-auto-agentdock/5f3bf29d-8c4e-417d-a177-083dcd61f8ca/scratchpad/`이며 저장소에는 넣지 않았다.

로컬 정리 상태:
- 서버, 프록시, PgBouncer 컨테이너를 종료했다.
- 로컬 role 설정을 원복했다(`{search_path=agentdock}`).
- 측정용 job 행을 삭제했다.
- e2e 데이터를 재시드했다(package 177).

## 19. 최종 Git Status

```
 M scripts/sql/bootstrap-agentdock.sql
 M src/db/client.test.ts
 M src/db/client.ts
 M src/db/queries/jobs.test.ts
 M src/db/queries/jobs.ts
 M src/registry/sync.test.ts
 M src/registry/sync.ts
?? docs/analysis/agentdock-phase23-25-production-sync-performance.md
```

## 20. 권장 Commit 메시지

```bash
git add scripts/sql/bootstrap-agentdock.sql src/db/client.ts src/db/client.test.ts src/db/queries/jobs.ts src/db/queries/jobs.test.ts src/registry/sync.ts src/registry/sync.test.ts docs/analysis/agentdock-phase23-25-production-sync-performance.md
git commit -m "perf(db): prepare Drizzle statements and read the job status in one statement" -m "Drizzle sends every statement through postgres.js unsafe(), whose default is prepare:false, so each statement with a parameter cost two round trips. Measured through a 100 ms-RTT proxy, the database pages took half the time once prepared (detail 443 -> 236 ms, repository with a job 1065 -> 319 ms with the job change). The repository page read the whole job view for an id and a status; it now reads them in one statement. A prepared search statement moves to a generic plan after five runs (+5-15 ms at 7.3k rows); the bootstrap sets plan_cache_mode = force_custom_plan for the role, which an existing deployment applies once. A registry sweep that still fails after its retry now keeps its cursor and says how many pages it read." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
