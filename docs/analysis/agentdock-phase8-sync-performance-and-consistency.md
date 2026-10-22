# AgentDock Phase 8 — Sync 처리량·재개 안정성·데이터 정합성

작성일 2026-10-22 · 기준 HEAD `28730e9` (develop, 운영 배포 commit) · 변경은 미커밋 · commit, push, 운영 DB 접근, workflow 실행은 하지 않았다

표기:

- **[사실]** 로그, 코드, 로컬 측정으로 확인했다.
- **[추론]** 사실에서 계산하거나 해석했다. 운영에서 다시 확인해야 한다.
- **[운영 전용]** 운영 환경에서만 검증할 수 있다.

## 1. Executive Summary

- **Sync #8이 제한 시간에 걸린 원인은 GitHub가 아니라 DB 왕복이다.**
  - [사실] Sync #8 로그에서 job별 `durationMs`를 집계했다. 수집 성공(ok) job은 **약 4.7초 + artifact당 1.59초**였다.
  - [사실] drain 31.6분 중 ok job 47개가 28.1분을 차지했다.
  - [사실] GitHub core 요청은 5,000 중 235만 썼다.
  - [추론] fan-out·refresh 구간에서 역산한 DB statement 하나의 비용은 **0.46초**다. artifact 하나는 statement 3~4개를 썼다(`persistScan`의 artifact별 upsert·insert·update).
- **수정:** `persistScan`의 artifact별 statement를 테이블별 다중 행 statement로 바꿨다.
  - [사실] fixture 7개에서 DB 왕복은 **2,875 → 140회**로 줄었다.
  - [사실] 왕복 100ms를 넣은 측정에서 **577초 → 26초**가 됐다.
  - [사실] 저장 결과(행, 본문, finding)의 hash는 변경 전후가 같다.
- **"Success인데 106개가 남은" 문제:** exit code 정책(부분 완료는 0)은 유지했다. 대신 summary 첫 줄과 notice 제목에 `Status: PARTIAL_DEADLINE` 같은 상태를 명시하고, 직전 실행 대비 backlog 변화도 출력한다.
- **Subagent 35/34 차이:** 결함이 아니라 정책이다. [사실] 화면의 목록과 count는 같은 `NOT_LISTED_BECAUSE` 조건을 쓴다. 이 조건은 fork, `failed` 파싱, 중복 사본을 숨긴다. 운영 sync 로그에도 `listed=2609 of held=3384`가 찍혀 있다. 숨겨진 1개가 어떤 이유인지는 [운영 전용] 읽기 SQL(§10.4)로 확인해야 한다.
- **Migration:** 필요 없다.
- **판정:** CONDITIONAL. 운영 효과는 다음 Sync에서 확인해야 한다(§16).

## 2. 작업 범위

| 포함 | 제외(이유) |
|---|---|
| Sync 경로 추적, 운영 로그 분석(읽기 전용 `gh run view --log`) | 운영 DB 연결(금지), workflow 실행(금지) |
| `persistScan` 배치화, drain 함수 분리, 상태·처리량 출력 | ETag 조건부 요청(측정 근거 없음, Phase 4의 RESEARCH NEEDED 유지) |
| Queue 재개·복구·중복 시나리오 테스트, agent 건수 정합성 테스트 | `enqueueJob` 단일 statement화(§15, 효과가 작음) |
| 문서 갱신(DEPLOY.md, 이 문서) | postgres.js `prepare` 변경(§15, pooler 호환 위험) |

## 3. 현재 구현 분석

### 3.1 Sync #8 실측 (로그, run 39706897344, 28730e9)

[사실] 단계별 시간은 log timestamp 차이로 계산했다.

| 단계 | 시간 | 비고 |
|---|---|---|
| registry | 70.3초 | 40 page, page cap |
| seeds / links | 0.5 / 2.4초 | |
| search | 146.6초 | 28 요청, seed_cap |
| **fan-out** | **141.9초** | enqueue 100개 |
| **refresh** | **38.3초** | enqueue 27개 |
| **drain** | **1,894초(31.6분)** | 107 job, deadline |
| 종료 집계 | 약 1초 | |
| 합계 | 2,295초 | workflow 38분 27초 |

[사실] drain job 107개를 결과별로 나누면 다음과 같다(`event:"ingest"` 줄의 `durationMs`).

| 결과 | 개수 | 합계 | p50 | p95 | max |
|---|---|---|---|---|---|
| ok | 47 | 1,685초 | 14.0초 | 161.6초 | 290.4초 |
| below_star_floor | 43 | 53초 | 1.18초 | 1.46초 | 1.58초 |
| no_artifacts | 10 | 12초 | 1.19초 | 1.40초 | |
| unreadable / too_large / archived / forked | 4 / 1 / 1 / 1 | 9초 | 약 1.1초 | | |
| job 사이 간격(claim, finishJob) | | 135초 | 1.84초 | 1.86초 | |

ok job이 오래 걸린 순서:

| 저장소 | artifact | 시간 |
|---|---|---|
| packmindhub/packmind | 178 | 290초 |
| hoangsonww/claude-code-agent-monitor | 160 | 271초 |
| nimbalyst/nimbalyst | 101 | 162초 |
| openweb-org/openweb | 96 | 144초 |
| michael-denyer/pstack-claude | 71 | 108초 |

[사실] 이 5개 저장소가 16분을 썼다. ok job의 선형 회귀는 `duration ≈ 4,700ms + 1,592ms × found`다.

### 3.2 statement 비용 역산 [추론]

DB만 쓰고 GitHub를 쓰지 않는 단계로 statement 하나의 비용을 역산했다.

- **refresh:** select 1 + `enqueueJob` 27회 × 3 statement + count 1 = 83 statement, 38.3초 → 0.46초.
- **fan-out:** 그룹 4개 × 2 query + `enqueueJob` 100회 × 3 = 308 statement, 141.9초 → 0.46초.

이 단가로 ok job을 설명할 수 있다.

- 새 artifact는 statement 3~4개를 쓴다(package upsert, version insert, analyzed_at update, finding insert). 3.5 × 0.46 ≈ 1.6초로, 회귀 기울기 1.59초와 맞는다.
- 정책 거절 job은 DB 2회(denylist, lastIngestedState)에 GitHub 응답을 더해 약 1.2초다.
- job 사이 간격은 claim과 finishJob transaction을 합쳐 약 4 statement × 0.46 ≈ 1.84초다.

로컬 지연 프록시에서 측정한 결과, postgres.js의 statement 하나는 **네트워크 왕복 2회**가 들었다(§7.2). 따라서 0.46초는 runner와 Neon 사이 RTT 약 230ms에 해당한다. **Neon region은 확인하지 않았다** [운영 전용].

### 3.3 원인이 아닌 것 [사실]

| 후보 | 근거 |
|---|---|
| GitHub rate limit | core 4,765/5,000 남음, `rate_limited` 0 |
| 파일 읽기 상한(`wallClockMs` 120초) | `truncated` 0. 290초 job이 상한을 넘었으므로 시간 대부분은 읽기 이후(저장)에 쓰였다 |
| 재시도 대기 | `retriesScheduled` 0 |
| 같은 저장소 중복 처리 | `ingest_job_active_key`(target unique)가 막는다. 로그에서 같은 target이 반복되지 않았다 |
| Workflow timeout | 60분 중 38.5분에 끝났다. 앱 deadline(35분)이 먼저 걸렸다 |

## 4. Sync Execution Map

```
.github/workflows/sync.yml  (cron 06:00/18:00 UTC, concurrency: sync, no cancel, timeout 60m)
└─ bun run sync → scripts/corpus-sync.mjs --scheduled
   ├─ syncBudget(token)                     src/corpus/budget.ts   enqueue 100 / refresh 100 / drain 200
   ├─ stage registry  → syncRegistry        src/registry/sync.ts   repo_seed upsert, schema_meta cursor
   ├─ stage seeds     → upsertSeeds         src/db/queries/seeds.ts
   ├─ stage links     → expandLinkLists     src/corpus/links.ts    raw host, core 0
   ├─ stage search    → sweepTopics         src/corpus/search.ts   search bucket, schema_meta cursor
   ├─ stage fan-out   → fanOutBySource → unenqueuedSeeds → enqueueJob (denylist, MAX_QUEUED 500, ON CONFLICT)
   ├─ stage refresh   → refreshStaleRepositories → enqueueJob
   ├─ stage drain
   │   ├─ reapAbandoned(REAP_AFTER_MS=900s)            running → queued (attempts 유지)
   │   ├─ fetchCoreRateLimit                           GitHub /rate_limit (무료)
   │   └─ drainQueue (src/ingest/worker.ts, Phase 8)
   │       loop ≤ limit:
   │         stop()? = drainStop(rate, elapsed)        core<2 → core_budget, elapsed≥35m → deadline
   │         claimJob                                  UPDATE … WHERE id=(SELECT … FOR UPDATE SKIP LOCKED)
   │         runJob → ingestRepository (src/ingest/pipeline.ts)
   │            ├─ denylist select, lastIngestedState
   │            ├─ fetchRepoScanInputs (src/github/scan.ts): metadata+tree(core 2) → 정책 gate → sha 비교
   │            │     → raw read ≤600, concurrency 2, ≤120s
   │            ├─ detect(7) → parse → analyze → contentHash
   │            └─ persistScan (한 transaction):
   │                 repository upsert → before snapshot → package upsert[chunk] → version insert[chunk]
   │                 → A→B→A bump[chunk] → finding insert[chunk] → delist → seed upsert[chunk]
   │                 → ingest_attempt insert → ingest_job succeeded
   │         실패: finishJob(failed|succeeded) / scheduleRetry(backoff | rate reset, refund)
   │         rate_limited → stop
   │   └─ queueDepth → queued, due
   ├─ countPackages(listed / held)
   ├─ lastSyncAttempt (직전 queued) → summarize (Status, 단계별 시간, 처리량)
   ├─ ::notice / ::warning / ::error
   ├─ recordSyncSucceeded (FAILED가 아닐 때)
   └─ recordSyncAttempt (schema_meta sync:last_attempt, status·due 추가)
```

## 5. Queue State Machine

```
           enqueueJob (active unique: target, status in queued|running)
                │
                ▼
   ┌──────► queued(next_attempt_at) ──claimJob (due, SKIP LOCKED, order next_attempt_at,id)──► running
   │            ▲   ▲                                                                         │
   │            │   └── reapAbandoned (started_at < now-900s, 다음 sync 시작 시, attempts 유지) ◄─┤ 프로세스 사망
   │            │                                                                             │
   │  scheduleRetry: retryable & attempts<3 → +1/2/4…≤15분                                     │
   │            rate_limited → reset 시각까지, attempt 환불                                     │
   │            └──────────────────────────────────────────────────────────────────────────────┤
   │                                                                                          │
   │   ok / unchanged: persistScan·touchRepository 안에서 succeeded (artifact와 같은 commit)  ◄──┤
   │   gate·no_artifacts·denylisted: finishJob(succeeded)                                     ◄──┤
   │   unreadable·too_large·invalid_input·재시도 소진: finishJob(failed) + repository.checked_at ◄─┘
   │
   └── 종료된 job은 다시 queued가 되지 않는다. 같은 target은 refresh가 새 job으로 다시 넣는다.
```

보장 수준(실제로 성립하는 것만 적는다):

- **At-least-once 실행.**
  - 프로세스가 죽으면 다음 실행의 reaper가 job을 되돌린다. 그 job의 attempt는 소모된다.
  - 성공 상태는 artifact와 같은 transaction에서 기록된다. 그래서 "artifact는 저장됐는데 job은 running"인 창이 없다.
- **Idempotent write.**
  - unique 제약: `package_identity`, `(package_id, content_hash)`, finding identity, `repo_seed.full_name`, active job의 `target`.
  - 같은 scan을 다시 실행하면 새 version이 0개다(§12 테스트).
- **Exactly-once는 주장하지 않는다.** 실행 도중 transaction이 끊기면 rollback 후 다시 실행된다. 다시 실행해도 쓰기는 idempotent다.
- **공정성.** `(next_attempt_at, id)` 순서라 먼저 due가 된 retry가 새 job보다 앞선다(테스트로 확인).
- **영구 대기 방지.** attempts ≤ 3이고, rate limit 대기는 최대 1시간으로 clamp한다. running은 reaper가 회수한다.

## 6. 운영 증상과 실제 원인

| 증상 | 원인 | 근거 | 조치 |
|---|---|---|---|
| deadline, 107 처리 / 106 대기 | DB statement 수 × 0.46초. 특히 큰 저장소의 artifact별 저장 | §3.1–3.2 | `persistScan` 배치화(§9.1) |
| 대기가 남았는데 Workflow Success | 의도된 정책이다. 상한 정지는 오류가 아니며 exit 0이다(Phase 3 결정). 하지만 상태가 구분되어 출력되지 않았다 | `corpus-sync.mjs` | Status 출력(§9.3) |
| 290초짜리 job이 `REAP_AFTER_MS` 전제(최대 약 150초)를 넘음 | 저장 단계는 어떤 상한도 받지 않는다 | packmind 290초 | 배치화로 해소. 900초 여유는 원래도 넘지 않았다(주석 갱신) |
| backlog 증가 추세 | 실행당 enqueue 127 > drain 107 | summary | 처리량 개선. 추세를 출력에 추가 |
| 사용자 표의 합계 3,264 | 표의 행을 더하면 **3,384**이고, sync 로그의 `held=3384`와 같다. 합계 칸의 산술 오류다 | 요청서 §2.3 표 | 문서에만 기록 |

## 7. Baseline

### 7.1 고정 테스트셋

- **데이터:** `fixtures/` 7개 저장소(anthropics-skills, anthropics-claude-code, addyosmani-agent-skills, baoyu-skills, disler-hooks-mastery, obra-superpowers, wshobson-agents).
- **방법:**
  - 실제 `ingestRepository`를 실행하고, `fetch`는 교체해 네트워크를 쓰지 않는다. fixture에 본문이 없는 agent 파일은 합성 본문을 쓴다(Phase 5와 같다).
  - 1차는 신규로 수집한다. 2차는 저장된 sha를 무효화해 같은 내용을 다시 읽는다(전체 읽기와 conflict 경로).
- **측정 위치:**
  - DB: 로컬 일회용 PostgreSQL 17(`agentdock-testdb`, loopback).
  - 그 앞에 지연 프록시(`scratchpad/p8/bench/latency-proxy.mjs`)를 둔다. 방향당 고정 지연을 넣고, 서버의 ReadyForQuery(`Z`) 메시지 수를 왕복 수로 센다.
- **최종 상태 비교:** 행·본문·finding hash(`stateHash`, `findingHash`)를 비교한다.

### 7.2 결과 (Baseline → After)

| 경로 | 저장소 | artifact | DB 왕복(`Z`) | 0ms 지연(초) | 왕복 100ms(초) |
|---|---|---|---|---|---|
| 신규 | anthropics-skills | 18 | 71 → 9 | 0.50 → 0.08 | 14.2 → 1.7 |
| 신규 | anthropics-claude-code | 61 | 229 → 10 | 1.09 → 0.08 | 46.0 → 1.9 |
| 신규 | addyosmani-agent-skills | 28 | 107 → 9 | 0.51 → 0.07 | 21.4 → 1.6 |
| 신규 | baoyu-skills | 22 | 93 → 9 | 0.44 → 0.07 | 18.6 → 1.6 |
| 신규 | disler-hooks-mastery | 41 | 159 → 10 | 0.75 → 0.05 | 31.9 → 1.8 |
| 신규 | obra-superpowers | 16 | 58 → 10 | 0.32 → 0.06 | 11.5 → 1.8 |
| 신규 | wshobson-agents | 224 | 883 → 14 | 4.16 → 0.17 | 177.9 → 2.7 |
| 재수집(내용 동일) | anthropics-skills | 18 | 60 → 9 | 0.42 → 0.05 | 12.0 → 1.6 |
| 재수집(내용 동일) | anthropics-claude-code | 61 | 190 → 10 | 0.91 → 0.06 | 38.1 → 1.8 |
| 재수집(내용 동일) | addyosmani-agent-skills | 28 | 90 → 9 | 0.43 → 0.06 | 18.0 → 1.6 |
| 재수집(내용 동일) | baoyu-skills | 22 | 72 → 9 | 0.35 → 0.06 | 14.3 → 1.6 |
| 재수집(내용 동일) | disler-hooks-mastery | 41 | 130 → 10 | 0.61 → 0.05 | 26.0 → 1.8 |
| 재수집(내용 동일) | obra-superpowers | 16 | 55 → 10 | 0.26 → 0.09 | 10.9 → 1.8 |
| 재수집(내용 동일) | wshobson-agents | 224 | 678 → 12 | 3.22 → 0.14 | 136.4 → 2.3 |
| **합계** | | 820 | **2,875 → 140** | **14.0 → 1.1** | **577.3 → 25.9** |

최종 상태는 변경 전후가 같다(바이트 단위).

- 유형별 행: agent 242, command 39, hook 7, plugin 14, skill 108.
- version 410개, 모두 analyzed.
- finding 993개.
- `stateHash`는 `e5aa93e71b41468c86f0c9e6548e77f6`, `findingHash`는 `9348fb7d2167e0b709ad1f772c0e96ac`로 같다.

왕복 100ms에서 statement 하나는 약 200ms였다. 즉 statement 하나가 왕복 2회다. drizzle의 postgres-js 경로는 이름 없는 statement를 쓰기 때문에 매번 Parse/Describe 후 Bind/Execute를 한다고 [추론]한다.

### 7.3 Sync #8에 적용한 추정 [추론, 운영 미검증]

- **ok job:** 실행당 statement 9~14개 × 0.46초 ≈ 4~6.5초에 GitHub 응답과 raw read를 더한다. 47개면 약 4~6분이다. 실측은 28.1분이었다.
- **나머지 60개 job과 간격:** 그대로 약 3.4분.
- **drain 전체:** 31.6분 → **약 8~10분**. raw read 시간은 이 모델에 포함되지 않았다. 기존 회귀에서 artifact당 기울기가 DB 단가와 거의 같았으므로, raw read는 작다고 본다.
- **효과:** 같은 35분 안에서 drain cap 200에 먼저 도달할 가능성이 높다. 그때 Status는 `PARTIAL_CAP` 또는 `COMPLETED`다.

## 8. 개선 설계

| 우선 | 항목 | 결정 |
|---|---|---|
| P1 | 저장 statement 수 | 테이블별 다중 행 statement를 200행 단위로 나눈다. 결과는 위치가 아니라 identity로 다시 매핑한다(RETURNING 순서는 문서화된 보장이 아니다). 같은 identity가 두 번 오면 마지막 것을 쓴다(기존 per-row upsert의 결과와 같다) |
| P0 | 완료 판정 표현 | 실패는 exit 1, 부분 완료는 exit 0을 유지한다. 대신 Status 단어를 출력한다. 매번 빨간색이 되는 실행은 진짜 실패를 묻는다 |
| P0 | Resume 검증 | drain loop를 `drainQueue`로 분리해 정지 규칙을 테스트할 수 있게 했다. 동작은 바뀌지 않았다 |
| P2 | 관측성 | 단계별 시간, job p50/p95/max, jobs/min, backlog의 due/대기 분리, 직전 실행 대비 증감 |
| — | Migration | 필요 없다. 기존 unique 제약과 index로 충분하다 |

## 9. 구현 상세

### 9.1 `src/ingest/persist.ts` — `persistScan`

- `ROWS_PER_STATEMENT = 200`, `chunks()`:
  - 행 크기 상한: finding은 12 bind, version은 본문 최대 32KB다.
  - 200행이면 statement 하나가 약 7MB, 2,400 parameter 이하다(상한 65,535).
- **package:** identity(`type`, `source_path`)로 dedupe(마지막 것)한 뒤 다중 행 upsert한다. `set`은 `excluded.*`다. `RETURNING id, type, source_path`로 id를 매핑한다.
- **version:** 다중 행 insert에 `ON CONFLICT DO NOTHING`, `RETURNING id, package_id`. `analyzed_at`은 별도 UPDATE 대신 insert 값으로 넣는다. 같은 transaction의 같은 `now()`이고, 새로 만든 행에만 들어간다.
- **A→B→A:** conflict가 난 package만 모아 `(package_id, content_hash) IN (…)` 조건의 UPDATE 한 번으로 처리한다. "이미 latest가 아님" guard는 그대로다.
- **finding / seed:** 다중 행 insert. seed는 이름으로 dedupe한다(마지막 것).
- **counter와 `packageIds`:** 기존처럼 `scan.packages` 순서로 계산한다.

### 9.2 `src/ingest/worker.ts` — `drainQueue`

- **동작:** `stop()`을 claim 전에 확인하고, claim한 job은 끝까지 실행한다. `rate_limited`가 나오면 멈춘다.
- **`onRun` callback:** 중간에 throw가 나도 이미 끝난 job의 카운트가 summary에 남는다(기존 inline loop의 성질을 유지).
- **주입 가능한 의존성:** `claim`과 `run`을 주입할 수 있다(테스트 전용). 기본값은 실제 `claimJob`과 `runJob`이다.
- **`REAP_AFTER_MS` 주석:** 290초 측정값을 반영했다.

### 9.3 `scripts/corpus-sync.mjs`, `src/corpus/budget.ts`, `src/db/queries/jobs.ts`

- **`syncStatus`:** `COMPLETED | PARTIAL_DEADLINE | PARTIAL_CORE_BUDGET | PARTIAL_RATE_LIMITED | PARTIAL_CAP | NO_DRAIN | FAILED`. 이 중 FAILED만 exit 1이다.
- **`queueDepth`:** `{ queued, due }`를 반환한다. 아직 시간이 오지 않은 retry나 deferral은 "남긴 일"로 세지 않는다.
- **summary:**
  - `Status`
  - `Jobs still queued N (D due now, …)`
  - `since the previous run ±k (was P)`
  - 단계별 초
  - `Drain throughput x jobs/min`
  - `per job p50/p95/max`
- **notice:** 제목이 `AgentDock sync: <STATUS>`가 됐고, `status=`, `queued=`, `due=`를 포함한다.
- **`sync:last_attempt`:** `status`와 `due` 필드를 추가했다(JSON이라 migration이 없고, 이전 코드는 이 필드를 읽지 않는다).
- **비밀 정보:** URL, token, 오류 원문은 출력하지 않는다. 기존 `stage()` 정책(메시지만)을 유지했다.

### 9.4 문서와 주석

- `DEPLOY.md` Step 12: Status의 의미와 green의 뜻을 설명했다.
- `caps.ts` `drainDeadlineMs` 주석에 Sync #8 측정값을 넣었다.
- `seeds.ts`의 ponytail 주석에서 낡은 줄 번호 참조를 고쳤다.

## 10. DB·웹 정합성 분석

### 10.1 경로

```
/artifacts?type=agent → page → searchMode / searchPackages / countSearchResults (src/db/queries/search.ts)
   └─ searchWhere(q, filters):  delisted_at IS NULL
                                AND NOT_LISTED_BECAUSE IS NULL   (packages.ts — fork / unparsed / duplicate)
                                AND type IN (…) AND capability 조건
   rows와 count는 같은 searchWhere를 쓴다 (innerJoin repository, DISTINCT 불필요: package 행 1개 = 결과 1개)
홈 countPackages / listPackages: 같은 NOT_LISTED_BECAUSE를 쓴다
```

- 캐시와 ISR은 없다. 모든 page가 `force-dynamic`이다(Phase 6).
- react `cache`는 요청 하나 안에서만 dedupe한다.

### 10.2 지표 계약

| # | 지표 | 정의 | 다른 지표와의 관계 |
|---|---|---|---|
| 1 | DB 전체 package | `count(*) from package` | delisted를 포함한다. ≥ 2 |
| 2 | DB 활성 package | `delisted_at is null` | 사용자 SQL이자 sync 로그의 `held=` |
| 3 | 공개 정책 충족 | 2 ∧ `NOT_LISTED_BECAUSE is null` | sync 로그의 `listed=`이고, 홈 총계와 **같아야 한다** |
| 4 | 검색 index 포함 | `search_vector`는 generated column이라 모든 행에 있다 | 2와 같다. 별도 index 누락 상태가 없다 |
| 5 | 웹 검색 가능 | 3 ∧ (q가 비면 조건 없음) ∧ type/capability 조건 | 빈 q와 type 필터의 결과는 3을 그 type으로 제한한 값과 **같아야 한다** |
| 6 | UI Total | `countSearchResults` | 5와 **같아야 한다**. 페이지 행을 모두 합친 수와도 같다 |

- 2와 3은 달라도 된다. 차이는 정책이고, 각 저장소 페이지에 사유가 표시된다.
- 3과 6(같은 필터)은 반드시 같아야 한다.

### 10.3 35 vs 34 판단

- [사실] 운영 sync 로그 기준 활성 행은 3,384개이고, 그중 listed는 2,609개다. 775개는 정책상 숨겨진 행이다.
- [사실] 1,959는 Sync #8 이전 화면의 값이다. 2,609와 시점이 다르다.
- [추론] agent 35 → 34의 1개 차이는 fork, unparsed(`.claude/agents`의 YAML 오류는 `failed`), 또는 중복 사본(별이 더 많은 다른 저장소에 같은 내용이 있음) 중 하나다. 결함이 아니다.
  - 근거: count와 list가 같은 술어를 쓴다(코드와 테스트).
  - 근거: 로컬 재현 테스트가 "활성 n+2, 화면 n"을 고정한다.
- [운영 전용] 어떤 행인지는 아래 읽기 전용 SQL로 확인한다.

### 10.4 운영 확인용 읽기 전용 SQL (사용자 실행)

```sql
-- 실행 위치: 운영 Neon SQL editor(읽기만). 숨겨진 agent와 그 이유의 근거.
with latest as (
  select distinct on (pv.package_id) pv.package_id, pv.content_hash, pv.parse_status
  from agentdock.package_version pv
  order by pv.package_id, pv.ingested_at desc
)
select r.full_name, r.stars, r.is_fork, p.source_path, l.parse_status,
       (select string_agg(r2.full_name || ' (' || r2.stars || '★)', ', ')
          from latest l2
          join agentdock.package p2 on p2.id = l2.package_id and p2.delisted_at is null and p2.id <> p.id
          join agentdock.repository r2 on r2.id = p2.repository_id
         where l2.content_hash = l.content_hash) as same_content_in
from agentdock.package p
join agentdock.repository r on r.id = p.repository_id
join latest l on l.package_id = p.id
where p.type = 'agent' and p.delisted_at is null
  and (r.is_fork or l.parse_status = 'failed' or exists (
        select 1 from latest l2 join agentdock.package p2 on p2.id = l2.package_id
        where l2.content_hash = l.content_hash and p2.id <> p.id and p2.delisted_at is null));
```

- 중복 그룹에서는 별이 더 많은 쪽, 같으면 id가 작은 쪽이 남는다.
- 결과에 두 행이 나오면 남지 못한 쪽이 숨겨진 행이다.

### 10.5 재현 테스트 (`search.test.ts`, "agent counts", 24/25/26)

- **데이터:**
  - 저장소 A(100★): agent n개, 실패 1개, delist된 1개.
  - 저장소 B(1★): A의 첫 agent와 같은 내용 1개.
- **단언:**
  - 활성 = n+2이고 count = n이다.
  - 페이지(25개 단위)를 모두 합치면 n행이고 중복이 없다.
  - 숨겨진 2개의 사유는 `duplicate`와 `unparsed`다.
- **결과:** PASS.

## 11. Before / After 비교

| 항목 | Baseline | After | 변화 | 근거 |
|---|---|---|---|---|
| 저장 DB 왕복(fixture 14회 합) | 2,875 | 140 | −95% | §7.2 측정 |
| 실행 시간(왕복 100ms) | 577.3초 | 25.9초 | −96% | §7.2 측정 |
| 실행 시간(로컬 0ms) | 14.0초 | 1.1초 | −92% | §7.2 측정 |
| 최대 단일 job(wshobson, 왕복 100ms) | 177.9초 | 2.7초 | | §7.2 측정 |
| GitHub API 호출 수 | 저장소당 core 2 + raw ≤600 | 같음 | 0 | 코드 변경 없음 |
| 중복 처리 수 | 0(unique 제약) | 0 | 0 | 테스트 |
| Resume 성공률(200 job, deadline 107) | 측정 수단 없음 | 200/200 처리, 2회 처리 1건(죽은 worker 몫) | | `jobs.test.ts` |
| Detection 정확도 | 7 fixture 유형별 수 | 같음(state hash 같음) | 0 | §7.2 |
| Search count/list 정합 | 기존 테스트 PASS | 더해서 agent 24/25/26 PASS | | §10.5 |
| 운영 drain 시간(Sync #8 job 구성) | 31.6분 실측 | 약 8~10분 | | **추정**, 운영 미검증 |

**나빠진 영역:**

- 큰 multi-row statement 하나가 최대 약 7MB다. 기존 statement는 1행이었다.
- PostgreSQL 메시지 상한(1GB)보다 충분히 작다. 메모리 사용은 기존에도 scan 전체를 메모리에 두었으므로 같은 차수다.
- 로컬에서 측정한 결과 중 나빠진 수치는 없다.

## 12. 추가 테스트

| 요구(6.2) | 테스트 | 결과 |
|---|---|---|
| 1 Deadline 후 Resume | `worker.test.ts` drainQueue "stops before a claim once the deadline…", `jobs.test.ts` "a drain stopped by its deadline, then resumed" | PASS |
| 2 Worker 비정상 종료 후 Recovery | `jobs.test.ts` 같은 시나리오(dead-worker → reap → 재처리, attempts 2) + 기존 reapAbandoned 2건 | PASS |
| 3 Queue 중복 Claim | 기존 "hands two concurrent claims two different jobs" + 시나리오의 distinct 200 | PASS |
| 4 중복 Artifact 방지 | 기존 persist "is a no-op when the same scan runs again" + 신규 "takes the last of two scanned rows with one identity" | PASS. dedupe 제거 mutation 시 FAIL을 확인했다 |
| 5 동일 콘텐츠 Version 중복 방지 | 신규 450행(chunk 경계 2개) 재실행 newVersions 0, chunk 뒤쪽 A→B→A | PASS |
| 6 Rate limit Retry | 기존 `worker.test.ts`, `retry.test.ts` + drainQueue rate_limited 정지 | PASS |
| 7 Stage별 부분 실패 | 기존 stage 격리(Phase 3 E2E, 이번에는 미재실행) | 기존 PASS |
| 8 Repository 재검사 | 기존 `refresh.test.ts`, sha short-circuit 테스트 | PASS |
| 9 Subagent Detection | 기존 `agent.test.ts` 20건 + phase gate + fixture state hash 불변 | PASS |
| 10–12 검색 Count/List, Type, Pagination | 신규 agent counts 24/25/26 + 기존 | PASS |
| 13 Sync Partial 종료 상태 | `budget.test.ts` syncStatus + 로컬 E2E 2회(`PARTIAL_CAP`, `COMPLETED`) | PASS |
| 14 Production DB 보호 Guard | 기존 `testDatabase.test.ts`, `client.test.ts`(이번 변경 없음) | PASS |

## 13. 전체 회귀 테스트

| 항목 | 명령 | 결과 |
|---|---|---|
| boundaries | `bun run check:boundaries` | PASS(`11 migration file(s) … OK`) |
| lint | `bun run lint` | PASS(`Checked 200 files … No fixes applied.`) |
| typecheck | `bun run typecheck` | PASS |
| test(격리 DB, `TEST_DATABASE_URL`만 사용) | `CI=1 bun run test` | **PASS: 68 passed / 1 skipped files, 1269 passed / 3 skipped**(이전 1258) |
| build | `bun run build`(placeholder `DATABASE_URL`) | PASS |
| Vercel build | `VERCEL=1 bun run build` | PASS |
| Docker build | `docker build -t agentdock-phase8:local .` | PASS |
| 로컬 sync E2E(가짜 GitHub, 로컬 DB) | `scratchpad/e2e/run.sh --drain=1`, 기본 | PASS(`PARTIAL_CAP`, `COMPLETED`, 증감 −24) |

SKIP 3건은 Phase 3~7과 같다.

- pg_trgm 부재 케이스: 로컬에 pg_trgm이 설치돼 있다.
- wrong-password 케이스: trust 인증이라 실행할 수 없다.
- permalink live 테스트: `CI=1`이라 실행하지 않는다.

**NOT RUN:**

- 운영 Neon
- 원격 Actions
- Vercel 배포
- 실제 GitHub 대상 sync

## 14. 알려진 제약

- 0.46초/statement와 RTT 약 230ms는 로그에서 역산한 값이다. Neon region과 runner 위치는 확인하지 않았다.
- raw read 시간은 운영에서 분리해 측정하지 않았다(로그에 단계별 시간이 없다). 다음 실행부터는 job별 시간만 남는다. 단계별 분리가 필요하면 pipeline 로그에 필드를 추가해야 한다.
- `REAP_AFTER_MS`는 저장 시간을 상한으로 보장하지 않는다. 배치화로 저장 시간이 거의 상수가 되었을 뿐이다.
- 부분 완료는 계속 green이다. 사람이 `Status`와 backlog 추세를 봐야 한다.

## 15. 남은 개선 항목 (측정값 순)

| 항목 | 기대 효과(Sync #8 기준) | 비고 |
|---|---|---|
| `enqueueJob`을 단일 statement로(denylist, 깊이, insert를 한 문장에) | fan-out과 refresh 180초 → 약 60초 | AGENTS.md가 지키는 gate 함수다. 배치화 후에도 deadline이 묶이면 진행한다 |
| 정책 거절(43/107) 사전 차단 | 43 × 약 3초 ≈ 2분 | link/registry seed에는 별 정보가 없다. 별도 설계가 필요하다 |
| ingest 앞 query 2개 합치기, finishJob statement 축소 | 107 × 약 1초 ≈ 2분 | 작다 |
| postgres.js named prepared statement | statement당 왕복 2 → 1 | 웹은 pooled 연결(pgbouncer 계열)이라 호환 위험이 있다. sync 연결에만 적용하는 안을 검토 |
| drain cap 200 상향 | backlog 소진 | 배치화 후 운영 처리량을 보고 결정한다 |

## 16. 운영 배포 절차

Migration은 없다. 순서:

1. 로컬에서 `bun run ci && bun run build`(위 결과와 같아야 한다).
2. commit(§18 제안) → push. sync.yml은 push로 실행되지 않는다.
3. 원격 CI(`check`, `database`) green을 확인한다.
4. 다음 예약 Sync(또는 사용자가 직접 dispatch) 로그에서 확인한다.
   - summary 첫 줄 `Status`.
   - `Drain throughput`과 `per job p50/p95/max`. Sync #8의 ok p50 14.0초, p95 161.6초, max 290초와 비교한다.
   - `"event":"ingest"` 줄의 큰 저장소 `durationMs`.
   - `Jobs still queued … since the previous run`. 직전 106에서 줄어야 한다.
   - `stage drain` 시간과 처리 job 수.
   - `listed=` / `held=` 증가, `failed-stages=none`.
5. (선택) §10.4 SQL로 숨겨진 agent의 사유를 확인한다.

## 17. Rollback 절차

- 코드만 바뀌었으므로 `git revert <commit>` 후 push한다. DB 구조와 데이터 의미는 바뀌지 않는다.
- `sync:last_attempt` JSON에 남은 `status`, `due` 필드는 이전 코드가 읽지 않으므로 무해하다.
- 배치 저장이 운영에서 실패하면(예: 예상하지 못한 statement 크기 오류) `storage_failed`(retryable)로 기록되고 transaction 전체가 rollback된다. 데이터 손실은 없다. 그때는 revert하거나 `ROWS_PER_STATEMENT`를 낮춘다.

## 18. 최종 결론

- **해결:** 운영 deadline의 원인(artifact별 DB statement × 원격 왕복)을 로그로 규명했다. 저장 경로의 왕복을 95% 줄였고, 같은 결과가 저장되는 것을 hash로 확인했다.
- **명확해진 것:** 부분 완료 상태와 backlog 추세가 출력에 드러난다. Subagent 건수 차이는 정책으로 규명했고 재현 테스트로 고정했다.
- **남은 것:** 운영 처리량 실측(§16 ④)과 숨겨진 agent 1개의 사유 확인(§10.4).
- **판정: CONDITIONAL.** 코드와 로컬 검증은 끝났다. 운영 개선 폭은 다음 Sync에서 확인해야 한다.

권장 commit(실행 위치: `~/workspace_auto/agentdock`):

```bash
git add src/ingest/persist.ts src/ingest/persist.test.ts src/corpus/caps.ts src/db/queries/seeds.ts
git commit -m "perf(ingest): write a repository's artifacts in batched statements instead of per artifact"

git add src/ingest/worker.ts src/ingest/worker.test.ts src/corpus/budget.ts src/corpus/budget.test.ts \
  src/db/queries/jobs.ts src/db/queries/jobs.test.ts scripts/corpus-sync.mjs DEPLOY.md
git commit -m "feat(sync): report the run's status, stage timings, throughput and backlog trend"

git add src/db/queries/search.test.ts docs/analysis/agentdock-phase8-sync-performance-and-consistency.md \
  docs/analysis/agentdock-phase4-7-integration-report.md
git commit -m "test(search): pin stored vs listed agent counts across page boundaries; docs: Phase 8"
```
