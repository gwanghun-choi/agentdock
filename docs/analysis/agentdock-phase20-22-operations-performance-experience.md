# AgentDock Phase 20–22 — 운영 관찰성 · 성능 · 공개 화면 품질 + Phase 17–19 운영 효과

작성 2026-10-23 · 기준 commit `05f5e57`(develop = origin/develop = 운영 배포본) · 변경은 working tree에만 있고 미커밋

이전: [Phase 17–19 — Discovery·Corpus·Search](agentdock-phase17-19-discovery-quality-search.md)

## 1. Executive Summary

실측으로 결함을 확인한 4건을 고쳤습니다. 모두 schema, migration, URL 계약(정규 주소), 검색 결과를 바꾸지 않습니다.

| ID | 영역 | 문제(실측) | 변경 | 결과 |
|---|---|---|---|---|
| O-3 | Sync | 최근 06:00 UTC 예약 회차 3회가 모두 registry 요청 **1건** 실패로 FAILED였다. sweep 도중 실패했고 재시도는 없었다 | registry page 1회 재시도(10초 뒤, 실행당 1회) | 로컬 PASS · 운영 효과 PENDING |
| O-2 | 관찰성 | `ops:status --markdown`이 실패하면 Actions summary에 **0 byte**를 남겼다. "step이 돌지 않음"과 구분되지 않았다 | 실패 시 summary에 원인 없는 한 줄 안내 | 로컬 PASS |
| U-2a | SEO | 상세·저장소 페이지가 대소문자 변형(`/r/composiohq/…`)과 `…/SKILL.md` 변형에서도 **200**을 냈고 canonical은 없었다 | 비정규 주소를 정규 주소로 **308** redirect | 로컬 PASS(E2E) |
| U-2b | SEO | 설명이 없는 artifact(hook 전체 등, e2e corpus 22/177)는 **meta description이 없었다**. 저장소·목록 페이지의 공유 카드는 사이트 기본값이었다 | 저장된 사실로 만든 fallback 설명, 페이지별 OG/Twitter 카드 | 로컬 PASS(E2E) |

변경하지 않은 영역(근거 포함):
- **Web 성능(P-1)**: 운영 지연의 대부분은 쿼리 실행이 아니라 함수와 DB 사이 네트워크입니다. 문장 1개에 약 0.44초가 들고, 같은 쿼리를 로컬에서 실행하면 7.3k 기준 수십 ms입니다. 고칠 곳은 코드가 아니라 Vercel 함수 리전 설정이고, 확인은 운영자 권한이 필요합니다(PENDING).
- **DB(P-2)·확장성(P-3)**: 50k에서 browse가 258ms로 Phase 4–7 측정(251ms)과 같습니다. 현재 7.3k에서는 34ms입니다. 구조 변경(listed 파생 저장)은 비용이 커서 보류합니다.
- **접근성(U-1)**: axe 80회 실행(로컬 72, 운영 8)에서 위반 0건. **UX(U-3)**: 기존 E2E가 상태별 화면을 덮고 있습니다.

**Phase 17–19 운영 효과(V-1)**: S-1은 운영에서 효과를 확인했습니다. D-1·C-1은 배포 후 예약 Sync가 아직 한 번도 돌지 않아 **PENDING**입니다.

## 2. 기준 Git SHA (E-01)

| 항목 | 값 |
|---|---|
| branch / HEAD / origin/develop | develop / `05f5e57` / `05f5e57` |
| 운영 배포 | `05f5e57` — Deploy run 39904387037 success(05:11Z), 응답 헤더 `x-agentdock-commit: 05f5e57…` |
| 최근 CI | 39904236363 success(05:09Z) |
| 최근 Sync | 39853119505(2026-10-22 20:56Z, `3a8a3c3`) success. **05f5e57 배포 후 Sync 없음**(조사 시점 05:54Z) |
| working tree(시작) | clean |

Phase 번호 20–22는 `docs/analysis`(2–19 사용)와 `.planning/ROADMAP.md`(0–8) 어디와도 겹치지 않습니다.

## 3. 작업 범위

O-1 운영 모니터링 · O-2 Read-only Guard · O-3 Registry/Sync 장애 · V-1 Phase 17–19 운영 효과 · P-1 Web 성능 · P-2 DB 성능 · P-3 확장성 · U-1 접근성 · U-2 SEO · U-3 UX.

운영 DB 접속, 운영 EXPLAIN, Sync 수동 실행, workflow_dispatch, 배포, commit은 하지 않았습니다. 운영에는 GET 요청만 보냈고 총 150회 미만입니다.

## 4. 기존 운영 Baseline

| 항목 | 과거 관찰값 | 이번 확인 |
|---|---|---|
| artifact | 7,273 | 7,273(운영 홈) |
| E2E | 25/25 | 25 + 신규 2 = 27/27 |
| 테스트 | 1,475 / 3 skipped | 1,483 / 3 skipped(신규 8) |
| Sync PARTIAL_CAP | 지속 | 마지막 run 39853119505 그대로 |
| 홈 cold 2.7–7.5초 | 관찰 | 이번 첫 요청: 상세 3.05초, 404(쿼리 1개) 2.6초. warm 홈 0.86초(§9) |
| registry 06:00 실패 | 가능성 | **3/3 확인**(§6) |

## 5. Phase 17–19 운영 효과 (V-1)

| ID | 배포 | 운영 실측 | 판정 |
|---|---|---|---|
| S-1 dotted 검색 | 05f5e57 웹 반영(헤더로 확인) | E-14 참조 | **효과 확인** |
| D-1 seed 순서 | 코드는 develop에 있음. 실행은 다음 예약 Sync부터 | 배포 후 Sync 0회 | **PENDING** |
| C-1 hook 이름 | 동일 | 운영 `/artifacts?type=hook` 첫 행들은 아직 `hooks`. 저장소를 다시 읽기 전이므로 예상대로다 | **PENDING** |

**E-14 — S-1 운영 검색(2026-10-23 05:50Z, 검색어마다 GET 1회)**

| 검색어 | Phase 17–19 이전 | 지금 | 상위 결과 |
|---|---|---|---|
| `node.js`, `Node.js` | 2건, 모두 무관 | 20건 | upgrade-runtime-stack, ai-model-web(Node.js) |
| `node js` | — | 2건 | 공백 입력은 S-1 대상이 아니다(기존 동작) |
| `three.js` | 81건, 관련 결과 5위 | 1건 | three-best-practices 1위 |
| `p5.js` | — | 2건 | algorithmic-art |
| `next.js` | — | 26건 | supabase, nextjs-developer |
| `review` / `pdf` | — | 828 / 59 | 회귀 없음 |

`three js`(공백)는 지금도 81건을 냅니다. 이전 `three.js` 결과와 같은 집합이며 vue-expert-js, near-api-js, supabase-js처럼 `three & js:*` 우연 일치가 대부분입니다. 빠진 80건 중 관련된 것은 r3f-best-practices(React Three Fiber) 하나입니다. 이 항목은 summary에 `three.js`가 없고 "Three Fiber"와 `js` 접두어로 걸렸던 것입니다.

**D-1·C-1 운영 확인 방법(다음 예약 Sync 후)**:
1. run 로그의 ingest 이벤트를 jobId 순으로 정렬해 backlog 구간(fan-out search·links 다음)의 outcome 분포를 Sync 39853119505(backlog 33 slot 중 ok 1, floor 24, unreadable 7)와 비교합니다.
2. `/artifacts?type=hook` 이름 분포를 봅니다(다시 읽힌 저장소만 바뀝니다).

## 6. Sync / Operations 분석 (O-1, O-3)

**E-02 — Sync 전체 이력(11회)**

| run | 시작(UTC) | 회차 | 결과 | 원인 |
|---|---|---|---|---|
| 39207068461 | 10-19 05:55 | dispatch | success | |
| 39245937874 | 10-19 11:37 | 06:00 | success | |
| 39330405747 | 10-19 21:48 | 18:00 | success | |
| 39408723010 | 10-20 10:32 | 06:00 | **failure** | registry unreachable(당시 코드는 stage 격리 전, 실행 전체 중단) |
| 39496498882 | 10-20 20:58 | 18:00 | success | |
| 39586894653 | 10-21 10:45 | 06:00 | **failure** | registry unreachable, 다른 stage는 진행 |
| 39674909791 | 10-21 20:58 | 18:00 | success | |
| 39706897344 | 10-22 01:38 | dispatch | success | |
| 39716460966 | 10-22 03:22 | dispatch | success | |
| 39765655496 | 10-22 10:46 | 06:00 | **failure** | registry 500. processed 147, ingested 44 |
| 39853119505 | 10-22 20:56 | 18:00 | success | PARTIAL_CAP |

- 06:00 UTC 회차는 GitHub 지연으로 실제로 10:30–10:47에 시작했고, 최근 3회 모두 실패했습니다. 다른 시각에 시작한 8회는 모두 성공했습니다.
- **시간대가 원인이라고 단정하지 않습니다.** 3건은 표본이 작고, registry 쪽 사정은 관찰할 수 없습니다.
- 확인한 사실은 이것입니다. 실패는 sweep 첫 요청이 아니라 **도중**에 났습니다. 성공 run은 40페이지를 22–33초에 읽는데, 실패는 시작 후 12.5초(39586894653)와 18.4초(39765655496)에 났습니다(**E-03**). registry는 몇 초 전까지 정상 응답하고 있었습니다.
- 실패 1건에 대해 `fetchServerPage`는 재시도하지 않았습니다. stage 실패는 `failed-stages=registry`가 되고 실행 전체가 FAILED(exit 1)가 됩니다. 그러면 `sync:last_success`가 기록되지 않아 홈의 "last sync without errors"가 다음 성공까지 밀립니다.
- 손실은 크지 않습니다. registry seed는 backlog에 이미 수천 건이 대기 중이라 한 회차를 놓쳐도 수집량은 거의 줄지 않습니다. 실제 피해는 **오경보**(FAILED, health DEGRADED)입니다.

**상태 의미(재확인, 코드 기준 `src/corpus/health.ts`, `corpus-sync.mjs`)**
- GitHub Actions success ≠ AgentDock COMPLETED입니다. PARTIAL_*과 NO_DRAIN은 exit 0이고, FAILED만 exit 1입니다.
- PARTIAL_CAP은 설계상 정상인 상한 도달입니다. 39853119505에서는 core 421/5000, drain 957초/deadline 2100초였고, 묶인 제약은 enqueue 상한뿐입니다(Phase 17–19 §4).

**O-1 그 밖의 모니터링**: backlog 추세(`previousQueued`), 단계별 시간, job p50/p95, retry 처분은 이미 출력됩니다. quality violation은 `quality:check`가 따로 있습니다. 여기에 더 추가할 근거는 찾지 못했습니다(NO CHANGE).

## 7. Read-only Guard 상태 (O-2)

| 검증 항목 | 결과 |
|---|---|
| "Sync health summary" step 운영 실행 | **PENDING** — 이 step을 넣은 da0ddfb 이후 Sync가 한 번도 실행되지 않았다 |
| guard 결과, role, direct endpoint, schema, exit code, continue-on-error | **PENDING**(위와 같음) |
| Deploy workflow에서의 실행 | 없음. deploy.yml에는 ops 단계가 없다(확인) |

로컬에서 확인한 결함(**E-13**): `ops:status --markdown >> $GITHUB_STEP_SUMMARY`가 실패하면 stdout이 비어 summary가 0 byte가 됩니다.

| 대상 | exit | summary(전) | summary(후) |
|---|---|---|---|
| pooled URL(`-pooler`, 거부) | 2 | 0 B | 128 B "Not available …" |
| 접속 거부(127.0.0.1:1) | 2 | 0 B | 128 B |
| 정상(로컬 test DB) | 0 | 1,001 B | 1,001 B(동일) |

안내 문장에는 대상 host, role, 오류 원문이 들어가지 않습니다. 원인은 기존처럼 stderr(step 로그)에만 남습니다. text·json 모드 출력은 바뀌지 않습니다(text 모드 실패 시 stdout 0 B 확인).

## 8. Monitoring 개선

- **O-3** `src/registry/types.ts`의 `REGISTRY_CAPS.retryDelayMs = 10_000`, `src/registry/sync.ts`: 응답하지 않은 page(`unavailable`: fetch 오류 또는 2xx 아님)를 같은 cursor로 10초 뒤 한 번 더 요청합니다.
  - 재시도는 실행당 1회입니다. registry가 다운되면 그 실행의 비용은 10초 한 번뿐이고, 40페이지 × 10초가 되지 않습니다.
  - 재시도는 page 상한을 소모하지 않습니다.
  - 두 번째도 실패하면 기존처럼 stage가 실패하고, 메시지 끝에 "Retried once after 10 s."가 붙습니다.
  - `parse_failure`와 `too_large`는 재시도하지 않습니다(기존 동작 유지).
  - 출력 줄에 `retried=0|1`을 추가했습니다(`scripts/corpus-sync.mjs`).
- **O-2** `scripts/ops.mjs`: `--markdown`으로 실행했다가 exit code가 0이 아니면 summary 안내 한 줄을 남깁니다.

## 9. Web Performance (P-1)

**E-04 — 운영 응답(05:32Z, 페이지당 4회 연속, 서울 → Vercel edge icn1 → 함수 iad1)**

| 페이지 | 첫 요청 TTFB | warm TTFB | warm 전체 | HTML |
|---|---|---|---|---|
| `/` | 0.85 s | 0.86–0.88 s | 0.86–1.08 s | 276 KB(gzip 23 KB) |
| `/artifacts` | 0.32 s | 0.33–0.40 s | 1.22–1.29 s | 215 KB |
| `?q=node.js` | 0.33 s | 0.32–0.33 s | 1.62–1.65 s | 200 KB |
| `?type=hook` | 0.37 s | 0.33–0.36 s | 0.79–0.85 s | 186 KB |
| `?type=skill&cap=network` | 0.33 s | 0.34–0.36 s | 1.23–1.29 s | 216 KB |
| `?page=40` | 0.34 s | 0.33–0.34 s | 0.86–1.09 s | 201 KB |
| 결과 0건 | 0.34 s | 0.31–0.34 s | 1.21–1.24 s | 35 KB |
| 상세(skill) | **3.05 s** | 1.24–1.27 s | 1.42–1.45 s | 86 KB |

- `/artifacts` TTFB 0.33초는 `loading.tsx`가 shell을 먼저 stream한 값입니다. 쿼리 결과가 도착하는 시점은 "전체" 열입니다.
- 결과 0건이 1.2초인 이유는 full-text가 비면 trigram fallback 문장이 이어서 실행되기 때문입니다(`searchPackages` 설계).

**E-05 — 문장 1개의 비용(운영, 6회씩)**: DB를 쓰지 않는 정적 404(`/zz-no-route`)는 TTFB 0.11–0.13초입니다. 쿼리 1개로 끝나는 404(`/r/zz-none-owner/zz-none-repo`)는 0.76–0.80초이고, 첫 요청은 2.62초였습니다. 함수 shell(0.33초)을 빼면 **문장 1개 ≈ 0.44초**입니다. Phase 8이 Sync 로그에서 역산한 0.46초/문장과 일치합니다.

**E-06 — postgres.js 왕복 횟수(로컬 지연 프록시, RTT 100ms, `scratchpad/bench/rtt*.mjs`)**

| 경우 | 시간 | 왕복 |
|---|---|---|
| 연결 수립 + 첫 문장 | 323–426 ms | 약 3–4 RTT(로컬은 TLS 없음) |
| 같은 문장 반복(같은 연결) | 102 ms | 1 RTT |
| 그 연결에서 처음 보는 문장 | 202–204 ms | 2 RTT |
| `prepare: false` | 203 ms | 2 RTT(이득 없음) |

**결론**: 쿼리 실행 시간은 7.3k 기준 수십 ms(§10)이고, 운영 문장 비용 0.44초의 대부분은 함수(iad1)와 Neon 사이 왕복입니다. 함수 리전은 iad1로 확인했고(`x-vercel-id: icn1::iad1::…`), Neon 리전은 저장소에 기록되어 있지 않습니다.
- 이 차이를 줄이는 방법은 코드가 아니라 Vercel Function Region을 Neon과 같은 리전으로 맞추는 것입니다(`VERCEL_DEPLOY.md` 5단계가 이미 그렇게 안내합니다).
- 확인은 운영자가 Neon 콘솔에서 리전을 보는 것입니다. **PENDING**.

**코드에서 검토하고 바꾸지 않은 것**
- 상세 페이지는 순차 batch가 2개입니다(detail → [findings, related, history]). 두 번째 batch가 첫 batch의 id에 의존하므로 SQL을 하나로 합치기 전에는 줄일 수 없습니다. 바꾸지 않았습니다.
- 상세 페이지 `loading.tsx`: `artifacts/loading.tsx` 주석이 기록한 대로, loading boundary가 있으면 `notFound()`가 200이 됩니다. 404 계약 때문에 의도적으로 없습니다. NO CHANGE.
- 캐시 추가: 데이터 최신성 계약(`force-dynamic`)과 충돌하고, 병목이 네트워크이므로 효과 근거가 없습니다. NO CHANGE.
- `prepare: false`: E-06에서 이득이 없었습니다. `idle_timeout`: Neon 과금을 근거로 정한 값이라 유지합니다.

## 10. DB Query Performance (P-2)

로컬 PG(`agentdock-testdb`, schema `agentdock`)에 Phase 4–7의 합성 corpus 생성기(`scratchpad/perf/gen.sql`)를 그대로 썼습니다. 저장소 1개당 artifact 20개, artifact당 version 2개, 2%는 parse 실패, finding은 25%입니다.

harness는 `scratchpad/perf/p20-bench.mjs`이고 실제 query 함수를 호출합니다. 워밍업 2회 후 20회 측정, 동시성 1입니다.

**E-07 — p50 / p95 (ms)**

| Query | 7.3k | 10k | 50k |
|---|---|---|---|
| browse(recent) rows / count | 34.1/39.0 · 31.7/32.2 | 49.0/52.7 · 45.2/46.0 | 258.1/266.2 · 244.4/255.1 |
| browse changed | 43.2/49.1 | 58.2/63.2 | 321.5/328.1 |
| browse name | 36.0/36.6 | 50.4/52.0 | 280.7/290.5 |
| browse page 200(offset 4,975) | 68.6/74.8 | 82.2/83.0 | 307.4/323.3 |
| type=skill | 14.2/14.9 | 20.0/20.1 | 104.7/124.8 |
| cap no_network+no_shell | 33.7/40.0 | 46.6/51.0 | 287.6/293.4 |
| q=review | 8.4/15.7 | 10.6/11.6 | 47.6/56.5 |
| q=pdf + type + cap | 7.7/14.1 | 9.7/15.7 | 42.4/43.2 |
| q=node.js | 6.7/7.1 | 7.7/8.1 | 27.7/27.8 |
| q=code review(2단어) | 7.6/10.8 | 7.3/7.7 | 30.7/30.9 |
| q=kubernetes wechat(any) | 12.7/13.0 | 17.0/20.2 | 84.8/92.4 |
| q=playwrit(fuzzy) | 71.4/73.8 | 33.5/34.2 | 161.7/168.7 |
| q=0건(fuzzy) | 6.5/6.6 | 7.6/8.0 | 26.8/27.1 |
| 홈 listPackages(18) | 33.7/35.8 | 46.6/47.7 | 266.1/271.9 |
| 홈 countPackagesByType | 31.8/32.0 | 44.5/44.9 | 249.2/261.8 |
| 상세 getPackageDetail | 0.5/0.6 | 0.4/0.6 | 0.4/0.5 |
| 상세 findings+related+history | 1.5/3.0 | 1.8/2.8 | 1.2/1.4 |
| 저장소 getRepositoryPackages | 1.5/4.6 | 1.8/5.7 | 1.1/1.7 |

**E-08 — 50k browse count의 EXPLAIN ANALYZE(로컬)**: 286ms, shared hit 841,003입니다.
- package 50,000행 Seq Scan(6ms) 뒤에 행마다 `NOT_LISTED_BECAUSE`의 SubPlan 2개가 실행됩니다. 하나는 최신 version parse_status(loops=50,000)이고, 다른 하나는 duplicate EXISTS(loops=49,000)입니다.
- 비용은 행 수에 비례하고, 행당 약 5.7µs입니다. index 누락이나 N+1은 없습니다.

**판정 NO CHANGE**: 현재 규모(7.3k)에서 DB 시간은 운영 문장 비용(0.44초)의 10% 미만입니다. 상세와 저장소 쿼리는 규모와 무관하게 2ms 이하입니다. browse·홈·count를 행 수와 무관하게 만들려면 listed 여부를 파생 저장해야 하는데, 이는 쓰기 경로와 migration을 바꾸는 구조 변경입니다(Phase 4–7 §122와 같은 결론).

재검토 시점은 listing count가 100ms를 넘을 때입니다. 측정치로 보면 held artifact 약 20k입니다.

## 11. 10k/50k Scalability (P-3)

- 환경: 로컬 Docker PG(같은 머신), 연결 1개, 동시성 1, 워밍업 2회, 반복 20회. **운영과 같은 성능이라고 주장하지 않습니다.** 운영에는 문장마다 약 0.44초의 네트워크 비용이 더해집니다.
- 오류: 0건(세 규모, 모든 query). 메모리: 50k에서 DB 크기 148MB, sort는 모두 메모리 안(quicksort 25kB)에서 처리됩니다.
- 50k에서 300ms를 넘는 것은 browse changed(322), page 200(307), cap 필터(288)입니다. 모두 위의 행별 분류 비용 때문입니다.
- 운영 환산: 50k에서 browse 페이지는 현재보다 약 0.25초 느려집니다. 네트워크 비용 0.44초/문장보다는 작습니다.

## 12. Accessibility (U-1)

| 검사 | 범위 | 결과 |
|---|---|---|
| axe 4.10.3(wcag2a/aa, 21a/aa, 22aa), 로컬(**E-09**) | 14개 화면(홈, 목록, 검색, 필터, 2쪽, 빈 결과, 범위 밖 쪽, hook 목록, 저장소, skill·mcp·hook·component·command 상세) × light/dark × 1280/320px = 56회 | 위반 0, 가로 overflow 0px |
| axe + best-practice, 로컬 | 위 14개 + 404 2종(`/r/nobody/nothing`, `/jobs/999999`) | 위반 0 |
| axe, 운영(**E-10**) | 홈, `q=node.js`, `type=hook`, 상세 × (light 1280, dark 320) = 8회 | 위반 0, overflow 0px |
| 키보드 | 기존 E2E "keyboard: / focuses search, Tab reaches a sort link and a result, focus is visible", MCP JSON 복사(키보드) | PASS(이번 E2E 실행) |
| reduced motion | `src/app/motion.test.ts`, axe 실행 시 `reducedMotion: 'reduce'` | PASS |

결과 변경 안내: 검색과 필터는 GET 이동이라 페이지 전체가 바뀌고 `<title>`에 검색어가 들어갑니다. `/artifacts` loading 상태에는 `role="status"` 안내가 있습니다. 결함을 찾지 못해 **NO CHANGE**입니다.

자동 검사로 WCAG 2.2 AA 전체 준수를 주장하지 않습니다. 스크린리더 실기기 테스트는 NOT RUN입니다.

## 13. SEO (U-2)

**현황(코드 + 운영 응답)**
- 목록: type별 URL만 색인되고, 검색·필터·정렬·2쪽 이상은 `noindex, follow`입니다(기존 E2E로 확인).
- canonical, sitemap, robots.txt, 구조화 데이터는 없습니다. `robots.txt` 404는 "전부 허용"과 같고, 페이지네이션 링크로 전체 artifact에 도달할 수 있습니다(`maxPage` 10,000).
- 절대 URL이 필요한 canonical과 sitemap은 "배포 origin을 저장소에 기록하지 않는다"는 기존 결정(layout.tsx 주석, CLAUDE.md Deployment work)과 충돌합니다. 구조화 데이터는 escape되지 않는 sink라 일부러 쓰지 않습니다(상세 페이지 주석).

**E-11 — 중복 URL(운영과 로컬 모두 재현)**

| 요청 | 전 | 후 |
|---|---|---|
| `/r/anthropics/claude-plugins-official/…/access`(사이트가 링크하는 주소) | 200 | 200 |
| `/r/Anthropics/Claude-Plugins-Official/…/access` | **200**(같은 내용) | 308 → 정규 주소 |
| `/r/anthropics/skills/skills/pdf/SKILL.md` | **200** | 308 → `…/skills/pdf` |
| `/r/ANTHROPICS/skills`(저장소) | **200** | 308 → `/r/anthropics/skills` |
| `/r/FIXTURE/…/c%23-review.md` | 200 | 308 → `/r/fixture/…/c%23-review.md` |
| `/r/nobody/nothing`, 없는 경로 | 404 | 404 |

- 운영 목록은 저장된 철자(`/r/ComposioHQ/…`)로 링크합니다. 반면 seed, registry, 외부 링크는 소문자로 들어옵니다(`repo_seed`는 소문자 저장).
- 비교는 decode한 값끼리 합니다. 그래서 브라우저가 escape를 다르게 골라도 redirect가 반복되지 않습니다(단위 테스트 5종으로 확인).
- 사이트 내부 링크 전수(목록 9쪽 + 저장소 페이지 164개, 상세 안 링크 53개)가 redirect 없이 200입니다.

**E-12 — 메타데이터**
- 설명이 없는 artifact는 `description`이 빈 문자열이 되어 layout 기본 설명까지 덮어썼습니다. 그 결과 meta description 태그가 아예 없었습니다. e2e corpus에서는 hook 8/8, command 12/40, mcp 1/1, plugin 1/15로 22/177입니다. 운영에서는 hook 상세 2개에서 확인했고, 운영 전체 수는 DB가 필요해 미확인입니다.
- 변경 후 fallback은 저장된 사실만 씁니다: `Hook Configuration at .claude/settings.json in fixture/ui-edge-cases, as read at commit eeeeeee.` 안전성이나 품질을 판정하는 말은 없습니다(check:boundaries OK).
- 저장소 페이지와 목록 페이지의 og:title·twitter:title이 "AgentDock", 설명이 사이트 기본값이던 것을 페이지 제목·설명과 같게 했습니다.

같은 저장소 안 hook 두 개의 `<title>`이 같은 문제("hooks — anthropics/claude-plugins-official")는 C-1이 다시 읽기 시점에 이름을 바꾸면서 해소됩니다(PENDING). 그래서 title 규칙은 바꾸지 않았습니다.

검색 노출이나 순위 변화는 보장하지 않습니다.

## 14. UX Reliability (U-3)

기존 E2E 27건이 다음을 확인합니다: 검색어 유지, 필터 적용과 해제, Clear all, 정렬 유지, 빈 결과 안내와 출구, 범위 밖 쪽("There is no page N"), 상세 → Back과 공유 URL, 잘못된 파라미터의 기본값 처리, 320/390px에서 overflow 없음과 긴 이름 줄바꿈.
- 로딩: `/artifacts`만 skeleton을 쓰고, `/r/**`·`/jobs`는 404 계약 때문에 의도적으로 없습니다.
- 오류: `error.tsx`가 있습니다.
- 없음과 오류의 구분: 0건 검색은 200 페이지, 없는 artifact는 404입니다.
- slow network: 운영 상세의 첫 요청 3초 동안 이전 페이지가 유지됩니다(브라우저 기본 동작). 이를 바꾸려면 loading boundary가 필요한데 404 계약과 충돌합니다.

결함을 재현하지 못해 **NO CHANGE**입니다.

## 15. 변경 전후 비교

| ID | 문제 | 근거 | 전 | 원인 | 변경 파일 | 후 | 회귀 | 운영 영향 | 남은 제약 |
|---|---|---|---|---|---|---|---|---|---|
| O-3 | registry 요청 1건 실패 → run FAILED | E-02, E-03 | 06:00 회차 3/3 FAILED | 재시도 없음 | `src/registry/{types,sync}.ts`, `scripts/corpus-sync.mjs` | 로컬: 500 한 번 → 재시도 후 sweep 완료, 두 번 실패 → stage 실패와 메시지 | registry 테스트 19 → 21 전부 PASS | 다음 Sync부터. 최악 +10초/run | 운영 효과 PENDING. 실패 시 cursor는 여전히 저장되지 않는다(이전과 같음, registry 대역폭만 사용) |
| O-2 | 실패한 health summary가 빈칸 | E-13 | 0 B | stdout 미출력 | `scripts/ops.mjs` | 128 B 안내 | 정상 출력 동일(1,001 B) | 다음 Sync부터 | 자동 테스트 없음(subprocess 테스트는 boundary 규칙상 두지 않음). 수동 3케이스로 확인 |
| U-2a | 중복 URL 200 | E-11 | 변형 4종 200 | 대소문자 무시 조회 + SKILL.md 후보 | `src/app/r/…/page.tsx` 2개, `src/components/hrefs.ts` | 308 | 내부 링크 217개 200, 404 유지, SQL 문 수 동일 | 웹 배포 즉시. 외부 소문자 링크는 1 hop 추가 | JobPanel의 `/r/<target>`(소문자)도 1 hop |
| U-2b | description 없음, 공유 카드 불일치 | E-12 | 22/177 태그 없음 | `''`가 layout을 덮음 | `src/components/metadata.ts`, 위 페이지 + `artifacts/page.tsx` | 모든 상세에 설명, OG = 페이지 | escaping 테스트 PASS | 웹 배포 즉시 | 운영 전체 영향 건수는 미확인 |

**E-18 — 로컬 페이지 비교(e2e corpus, base `:3971` vs 변경 `:3972`, 30회 교차)**
- SQL 문 수: 정규 주소에서 모든 페이지가 같습니다(목록 2, 홈 3, 저장소 3, 상세 5–6). redirect되는 변형은 5 → 3 + 정규 주소 요청입니다.
- p50(ms): 홈 16.5 → 15.1, `/artifacts` 16.0 → 17.3, `q=review` 12.0 → 13.1, 상세 command 9.6 → 10.4, 저장소 8.2 → 7.6. 측정 잡음 범위입니다.
- HTML 크기: 상세 +0 ~ +918 B(meta 태그), 목록 −232 B.

## 16. 변경 파일 (13개, +208 / −25)

| 파일 | 내용 |
|---|---|
| `src/registry/types.ts` | `REGISTRY_CAPS.retryDelayMs`와 측정 근거 |
| `src/registry/sync.ts` | 실행당 1회 재시도, `retries` 결과 필드 |
| `src/registry/sync.test.ts` | 재시도 2건, `stubPages`에 상태 코드 지원 |
| `scripts/corpus-sync.mjs` | registry 줄에 `retried=` |
| `scripts/ops.mjs` | `--markdown` 실패 안내 |
| `src/components/hrefs.ts` | `detailTail` 분리(`detailHref` 출력 동일) |
| `src/components/hrefs.test.ts` | `detailTail` ↔ `sourcePathCandidates` 왕복 5종 |
| `src/components/metadata.ts` | `metaDescription(text, fallback)` |
| `src/components/escaping.test.tsx` | fallback 1건 |
| `src/app/r/[owner]/[repo]/[...path]/page.tsx` | 정규 주소 redirect, fallback 설명 |
| `src/app/r/[owner]/[repo]/page.tsx` | 정규 주소 redirect, fallback 설명, OG/Twitter |
| `src/app/artifacts/page.tsx` | OG/Twitter |
| `e2e/journeys.spec.ts` | redirect 1건, 메타데이터 1건 |

## 17. 테스트 결과

| 항목 | 결과 | 비고 |
|---|---|---|
| check:boundaries | PASS | 100 source, 32 UI 파일 |
| lint(biome) | PASS | 231 files, no fixes |
| typecheck | PASS | |
| `CI=1 bun run test` | **PASS** 79 files + 1 skipped, **1,483 passed / 3 skipped** | DB 테스트는 로컬 test DB(`TEST_DATABASE_URL`). skip 3건은 CI에서 생략되는 live GitHub 테스트 |
| search:eval | PASS 54/54 | 검색 코드 변경 없음 |
| build(placeholder DATABASE_URL) | PASS | |
| e2e:seed + Playwright | **PASS 27/27** | 신규 2건은 base 빌드에서 FAIL(308 기대·200 수신 / 메타 없음)을 확인 |
| 신규 registry 테스트를 HEAD 코드로 | FAIL 2/2 확인 | 회귀 테스트 성립 |
| Migration validation | 해당 없음 | migration 추가 없음 |
| 비CI `bun run test` | NOT RUN | live permalink 테스트가 미인증 rate limit으로 실패하는 것이 알려져 있다(Phase 17–19) |
| 스크린리더 실기기 | NOT RUN | |

## 18. 운영 영향

| 항목 | 영향 |
|---|---|
| API / DB schema / migration | 없음 |
| URL 계약 | 사이트가 링크하는 정규 주소는 그대로다. 비정규 변형만 308이 되고, 404는 그대로다 |
| Sync workflow | 코드만 바뀐다(push 후 첫 예약 run부터). registry 장애 시 최대 +10초 |
| Deploy workflow | 변경 없음 |
| 기존 데이터 / 검색 결과 | 변경 없음 |
| SEO 메타 | 설명이 없던 상세에 fallback 설명이 생기고, 저장소·목록 OG가 바뀐다 |
| 캐시 | 변경 없음(`force-dynamic`). 308은 브라우저가 캐시할 수 있다 — 주소 규칙을 되돌리면 이미 캐시한 클라이언트에는 남는다 |
| 배포 순서 | 제약 없음. web은 배포 즉시, sync는 다음 예약 run |
| Rollback | `git revert`. 위의 308 캐시 외에는 상태가 남지 않는다 |

## 19. 미해결 위험

1. **함수–DB 리전 불일치(추정)**: 운영 문장 1개에 약 0.44초가 들고, 상세 첫 요청은 3초입니다. Neon 리전이 미확인이라 추정입니다. PENDING.
2. **06:00 회차 registry 실패**: 1회 재시도로 복구되는지는 다음 06:00 회차가 지나야 압니다. 장애가 10초보다 길면 지금처럼 FAILED가 됩니다.
3. **D-1·C-1 운영 효과**: 배포 후 Sync가 0회입니다.
4. **Read-only Guard 운영 첫 실행**: 같은 이유로 미확인입니다. guard가 실패하면 이제 summary에 "Not available"이 보입니다.
5. 50k 이상에서 browse·홈이 선형으로 느려집니다(§10 재검토 시점).

## 20. 후속 권고

1. **운영자 확인**: Neon 콘솔에서 리전을 보고, Vercel Function Region이 다르면 맞춥니다(`VERCEL_DEPLOY.md` 5단계). 변경 전후 E-05 방식(쿼리 1개 404 TTFB, 6회)으로 비교합니다.
2. **다음 예약 Sync 후**: §5의 D-1 비교, "Sync health summary" step 결과(guard PASS, role, exit 0), registry `retried=` 값을 확인합니다.
3. 06:00 회차가 재시도 후에도 실패하면 `retryDelayMs`를 늘리기보다 실패 시각 분포를 더 모읍니다. 실행 끝에 registry를 한 번 더 시도하는 방안은 그다음에 검토합니다.
4. sitemap이나 canonical이 필요하다고 판단되면, origin을 기록하지 않는 기존 결정을 먼저 다시 정해야 합니다(사용자 결정).
5. listing count가 100ms를 넘는 규모(약 20k)에 가까워지면 listed 파생 저장을 설계합니다.

## 21. Obsidian 반영

`work-log/2026-10-23.md`에 이번 측정과 작업 기록을 추가했습니다. 지속 지식(decision, architecture, troubleshooting, inbox)은 최종 응답의 `Knowledge:` 목록으로 Stop hook이 upsert합니다.

## 22. Git Status

```
 M e2e/journeys.spec.ts
 M scripts/corpus-sync.mjs
 M scripts/ops.mjs
 M src/app/artifacts/page.tsx
 M src/app/r/[owner]/[repo]/[...path]/page.tsx
 M src/app/r/[owner]/[repo]/page.tsx
 M src/components/escaping.test.tsx
 M src/components/hrefs.test.ts
 M src/components/hrefs.ts
 M src/components/metadata.ts
 M src/registry/sync.test.ts
 M src/registry/sync.ts
 M src/registry/types.ts
?? docs/analysis/agentdock-phase20-22-operations-performance-experience.md
```

## 23. 권장 Commit Message

```
fix(ops,seo): retry a registry page once, report an unreadable health summary, one address per artifact

Three scheduled runs failed the registry stage on one request part-way through a sweep (39586894653, 39765655496) and turned FAILED; the page is now asked for once more after 10 s, once per run. ops:status --markdown appended 0 bytes when it could not read, now one line. Detail and repository pages answered 200 to other spellings (case, .../SKILL.md); they redirect 308 to the address the site links. Pages whose artifact declares no description get one built from stored facts, and repository and listing pages get their own sharing card.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

## Evidence 목록과 재현 조건

| ID | 내용 | 재현 |
|---|---|---|
| E-01 | Git, CI, Deploy 상태 | `git rev-parse HEAD origin/develop`, `gh run list --limit 25`, `curl -sI <prod>/artifacts` |
| E-02 | Sync 이력 | `gh run list --workflow sync.yml --limit 30` |
| E-03 | registry 실패 시점 | `gh run view <id> --log`에서 `corpus-sync.mjs --scheduled`와 `stage=registry` 시각 |
| E-04 | 운영 TTFB | curl `-w %{time_starttransfer}`, 8 URL × 4회(05:32Z), `scratchpad/web-prod-1.txt` |
| E-05 | 문장 비용 | `/zz-no-route`, `/r/zz-none-owner/zz-none-repo[/zz/x.md]` × 6 |
| E-06 | 왕복 횟수 | `scratchpad/bench/proxy.mjs`(DELAY=50) + `rtt.mjs`/`rtt2.mjs`/`rtt3.mjs` |
| E-07 | 규모별 query | `psql -v n=<N> < scratchpad/perf/gen.sql` 후 `bun --no-env-file scratchpad/perf/p20-bench.mjs`, `p20-<N>.json` |
| E-08 | 50k EXPLAIN | `explain (analyze, buffers)` + `scratchpad/perf/count.sql`(로컬) |
| E-09 | axe 로컬 | `scratchpad/axe-run/axe13.mjs`, `axe20bp.mjs` + `p20-axe-pages*.txt` |
| E-10 | axe 운영 | `scratchpad/axe-run/axe20prod.mjs` + `p20-axe-prod-pages*.txt` |
| E-11 | 중복 URL | curl `-w "%{http_code} %{redirect_url}"`(운영 4 URL, 로컬 11 URL × 2 빌드) |
| E-12 | 메타데이터 | curl + `grep meta description/og` |
| E-13 | 빈 summary | `DATABASE_URL=<거부 대상> bun --no-env-file scripts/ops.mjs status --markdown >> f` |
| E-14 | S-1 운영 검색 | `/artifacts?q=<term>` GET 1회씩 |
| E-18 | 전후 페이지 | `scratchpad/p20-measure.sh`(log_statement 일시 on, 이후 none으로 복구), `p20-latency.py` |

scratchpad = `/tmp/claude-1000/-home-ChoiGwanghun-workspace-auto-agentdock/5f3bf29d-8c4e-417d-a177-083dcd61f8ca/scratchpad`
