# AgentDock Phase 66–68: 운영 성능 검증, Sync 장애 분석, Obsidian Stop hook 복구

작성일 2026-10-27, 기준 commit `2c4c7a3`(develop). 이 문서 외에 AgentDock 저장소의 변경은 없다.

표기:
- FACT: 이번 작업에서 실행·관찰한 결과
- INFERENCE: 근거에서 추론한 판단
- PENDING: 조건이 아직 오지 않아 확인하지 못한 항목
- NOT RUN: 실행하지 않은 항목

운영에는 읽기 전용 GET만 보냈다(총 260회). 운영 DB 접속, 쓰기, migration, Sync·reenqueue·refresh 실행, Secret·변수·workflow 변경, commit·push·deploy는 하지 않았다.

---

## 1. 기준 상태 (FACT)

| 항목 | 값 |
| --- | --- |
| 브랜치 | `develop` |
| HEAD / origin/develop | `2c4c7a31868d1860c2e79bbdc88b9a942e1e176f` (같음) |
| 작업 트리 | 시작 시 clean |
| CI | run 40443524002, success, `2c4c7a3` |
| Deploy | run 40443671711, success, `2c4c7a3`. `migrate --plan --production`이 `11 applied, 0 pending — UP_TO_DATE` |
| 운영 `x-agentdock-commit` | `2c4c7a31868d1860c2e79bbdc88b9a942e1e176f` |
| Graphify | `built_at_commit` = HEAD, 205 파일·1,338 노드·3,168 엣지, hook 판정 "일치" |

## 2. Phase 66 — 배포 상태

**판정: A. Phase 65가 운영에 배포됐다(FACT).** CI와 Deploy가 `2c4c7a3`에서 성공했고, 운영 응답 245회 모두의 `x-agentdock-commit`이 `2c4c7a3`이다.

## 3. 운영 성능 재측정

### 3.1 방법 (FACT)

Phase 64 §27.3과 같은 스크립트(`run.sh`)를 썼고, commit header 기록만 추가했다.
- 일시: 2026-10-27 03:52:48Z–03:57:25Z
- 위치: 로컬(서울), `curl`. 요청마다 새 TLS 연결을 연다.
- 규모: 7개 경로 × 35라운드 = 245회. 라운드마다 경로 순서를 무작위로 섞었다.
- 경로: Phase 64와 같다. 정적 CSS(edge 비교 기준), `/`, `/artifacts`, `/artifacts?page=2`, `?lang=any`, `?lang=zh`, `?q=review`

### 3.2 결과 (FACT)

- 245회 모두 HTTP 200이다(오류율 0%).
- 동적 경로 210회는 `x-vercel-cache: MISS`, `icn1::iad1`이고, 정적 CSS 35회는 HIT다.

| 경로 | p50 | p95 | 최소 | 최대 | TTFB p50 | 본문(전체−TTFB) p50 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 정적 CSS (edge HIT) | 95 ms | 158 | 85 | 308 | 92 | 4 |
| `/` | 1,263 | 1,442 | 1,070 | 1,615 | 1,083 | 183 |
| `/artifacts` (기본) | 1,462 | 1,573 | 1,143 | 1,747 | 388 | 1,078 |
| `/artifacts?page=2` | 1,256 | 1,462 | 1,071 | 1,494 | 389 | 865 |
| `/artifacts?lang=any` | 1,132 | 1,353 | 938 | 1,438 | 382 | 749 |
| `/artifacts?lang=zh` | 1,257 | 1,349 | 1,076 | 1,970 | 385 | 872 |
| `/artifacts?q=review` | 1,123 | 1,358 | 936 | 1,669 | 385 | 741 |

**측정 환경 차이(FACT):** 이번 측정의 네트워크는 Phase 64보다 느렸다.
- TLS p50: 21 → 79ms
- 정적 CSS: 39 → 95ms
- 동적 TTFB: 약 326 → 388ms

그래서 전체 시간보다 **같은 라운드 안의 차이**와 **본문 구간**을 우선해서 비교한다.

## 4. Phase 64와 비교

### 4.1 p50 (FACT)

| 경로 | Phase 64 | Phase 66 | 차이 | 비율 |
| --- | ---: | ---: | ---: | ---: |
| `/artifacts` | 1,628 | 1,462 | −166 ms | −10.2% |
| `page=2` | 1,414 | 1,256 | −158 | −11.2% |
| `lang=any` | 1,204 | 1,132 | −72 | −6.0% |
| `lang=zh` | 1,341 | 1,257 | −84 | −6.3% |
| `q=review` | 1,126 | 1,123 | −3 | −0.3% |
| `/` | 1,426 | 1,263 | −163 | −11.4% |
| 본문 `/artifacts` | 1,301 | 1,078 | −223 | −17.1% |
| 본문 `lang=any` | 878 | 749 | −129 | −14.7% |

### 4.2 같은 라운드 차이 (paired median, FACT)

| 비교 | Phase 64 | Phase 66 | 앞쪽이 느린 라운드(66) |
| --- | ---: | ---: | ---: |
| `/artifacts` − `lang=any` | +430 ms | **+303 ms** | 34/35 |
| `page=2` − `lang=any` | +208 | +132 | 31/35 |
| `lang=zh` − `lang=any` | +129 | +123 | 27/35 |
| `q=review` − `lang=any` | −68 | −4 | 16/35 |

### 4.3 판정

- **(FACT) 언어 필터 추가 지연이 줄었다.** 같은 라운드 차이 기준 +430 → +303ms로, 127ms(−29.5%) 감소했다.
  - 로컬 예측은 54.7 → 34.3ms(−37%)였다. 운영 감소율도 같은 방향이고 크기가 비슷하다.
  - 언어 필터 비용이 완전히 없어지지는 않았다. 운영에서 여전히 약 0.3초가 남는다.
- **(FACT) 기본 목록의 절대 개선은 −166ms(−10.2%)다.**
  - 다만 Phase 65가 건드리지 않은 `lang=any`도 −72ms 빨라졌다. 로컬에서 `lang=any`는 93.8 → 93.5ms로 변화가 없었다.
  - 따라서 절대 개선의 일부는 측정 시점의 DB나 function 상태 차이로 본다(INFERENCE).
  - Phase 65 효과로 볼 수 있는 값은 paired 감소량 약 127ms다.
- **(FACT) `lang=any` 회귀 없음.** 1,204 → 1,132ms다.
- **(FACT) `q=review` 절대값 회귀 없음.** 1,126 → 1,123ms이고, 본문 구간은 793 → 741ms다.
  - `lang=any`와의 상대 차이는 −68 → −4ms로 바뀌었다. `lang=any`만 빨라졌기 때문이다.
  - 로컬 Phase 65 측정에서 `q=review`는 −2.7ms였다. 그래서 상대 차이의 변화를 코드 회귀로 보지 않는다(INFERENCE).
- **(INFERENCE) 운영/로컬 배율 추정**
  - 감소량 기준: 127 / 20.4 ≈ 6.2배
  - 남은 비용 기준: 303 / 34.3 ≈ 8.8배
  - Phase 64의 추정치는 약 8배였다. 운영 DB 실행계획을 직접 보지 않았으므로 이 값은 계속 PENDING이다.

## 5. 언어 정책 Smoke Test (FACT, 읽기 전용 GET 13회)

| 항목 | 결과 |
| --- | --- |
| 기본 목록 중국어 제외 | `/artifacts`의 첫 페이지 `lang="zh"` 0개, "Not counting descriptions written in Chinese" 표시 |
| `lang=any` | 19,247 artifacts, 첫 페이지 `lang="zh"` 10개 |
| `lang=zh` | 609 artifacts, 첫 페이지 `lang="zh"` 25개 |
| 홈 | "Browse all 18638 artifacts", "Not listed by default: 609 artifacts …" |
| 홈 유형별 개수 | Skills 12,297 · Plugins 1,299 · MCP 230 · Commands 2,409 · Hooks 203 · Subagents 2,200. 합계 18,638로 기본 목록 개수와 같다 |
| 개수 정합성 | 18,638 + 609 = 19,247 |
| 검색 | `q=review` 2,184 artifacts, 중국어 0개, 숨김 안내 표시 |
| 페이지 이동 | `page=2` "Showing 26 – 50" |
| 정렬 | `sort=name` 첫 8개가 이름순이다. 정렬 링크는 `sort=added/changed/name`이다 |
| 상세 | `/r/XiaoMaColtAI/…/pdf` 200, GitHub 링크가 commit sha `7ed5a10…`를 가리킨다 |
| 0건 | `q=zzzqqxxnotaword`에서 "No artifacts matched … AgentDock has not indexed a match." 중국어 대안 경로는 결과가 있을 때만 나오므로 표시되지 않는다 |

**데이터 변화:** 숨김 609건과 전체 개수가 Phase 64와 같다. 마지막 성공 Sync(2026-10-25 20:26Z)가 Phase 64 측정보다 앞서고, 그 뒤로 데이터를 쓴 Sync는 없다(§6). 따라서 두 측정은 같은 데이터에서 비교한 것이다.

## 6. Phase 67 — Sync 운영 이력

로그는 GitHub API(`actions/jobs/{id}/logs`)로 받았다. secret은 `***`로 가려져 있고, 이 문서에 연결 정보는 옮기지 않았다.

| run | 시작(UTC) | commit | 결과 | 시간 | 요약 |
| --- | --- | --- | --- | ---: | --- |
| 40409047009 | 10-26 22:00 | 048023a | failure | 21 s | `Refusing to start: connected as a role other than "agentdock_app"`. ops FAIL 2개(role, search_path) |
| 40317405590 | 10-26 11:45 | 048023a | failure | 19 s | 같음. guard가 들어간 코드의 첫 예약 실행 |
| 40229151309 | 10-25 20:05 | 0f2cb82 | success | 1,242 s | COMPLETED, drain 200/200, refresh 100, queued 0. **마지막 성공** |
| 40184235414 | 10-25 10:18 | 0f2cb82 | success | 1,449 s | COMPLETED |
| 40127517179 | 10-24 19:55 | 0f2cb82 | success | 1,242 s | COMPLETED |
| 40083909354 | 10-24 09:56 | 0f2cb82 | success | 1,506 s | PARTIAL_CAP, queued 1 |
| 40021567316 | 10-23 20:44 | 0f2cb82 | success | 1,311 s | PARTIAL_CAP, queued 3 |
| 39940525800 | 10-23 10:38 | 0f2cb82 | failure | 1,241 s | registry 단계 FAILED, "Retried once after 10 s". 나머지 단계는 실행됐다 |
| 39853119505 | 10-22 20:56 | 3a8a3c3 | success | 1,423 s | PARTIAL_CAP |
| 39765655496 | 10-22 10:46 | 3a8a3c3 | failure | 1,064 s | registry 500(재시도 코드 배포 전) |

관찰(FACT):
- **예약 실행:** cron은 `0 6,18 * * *`이다. 실제 시작은 4~6시간 늦다.
  - 06:00 slot: 10:18Z, 11:45Z
  - 18:00 slot: 20:05Z, 22:00Z
  - 최근 10회는 모두 schedule이었다. workflow_dispatch는 10-22에 2회 있었다.
  - 10-27 06:00 slot은 04:07Z 기준 아직 실행되지 않았다.
- **실행 시간:** 성공 run은 1,242~1,506s로 증가 추세가 없다. drain은 911~1,081s, refresh는 50~64s다.
- **Rate limit:** 성공 run에서 rate limit으로 멈춘 drain은 없다(Status에 `PARTIAL_RATE_LIMITED` 없음). registry 단계의 `retried`는 0이다.
- **Backlog:** 실행당 enqueue 상한은 100이고, 아직 enqueue되지 않은 seed는 run마다 늘었다.
  - `still-pending`: 11,600 → 12,488 → 12,549 → 13,128 → 13,823 → 14,427 → 15,023 → 15,591
  - 상한 때문에 생긴 누적이고, 출력에도 표시된다.
- **NUL 정제:** registry 단계에서 `sanitized=0`이다. 저장 실패 job(771, 978)은 재처리되지 않아 효과를 확인하지 못했다.
- **guard 이후 데이터 변경:** 없다. guard는 `recordSyncAttempt`보다 먼저 종료하고 "Nothing was read or written"을 출력한다(`scripts/corpus-sync.mjs:146-164`).

## 7. 코드와 운영 로그 교차 검증

| 단계 | 코드 | 운영 증거 |
| --- | --- | --- |
| Workflow | `.github/workflows/sync.yml`: checkout → bun install → `migrate.mjs --plan --require-current` → `bun run sync` → `ops:status --markdown`(continue-on-error) | 각 run의 step 목록 |
| 환경변수 | `DATABASE_URL`(repo secret, Deploy와 공유), `DATABASE_SCHEMA=agentdock`, `GITHUB_TOKEN`=`AGENTDOCK_GITHUB_TOKEN` | log의 env 블록(`***`) |
| 스키마 preflight | `migrate.mjs --plan --require-current`(읽기 전용). 실패하면 run이 실패한다 | 두 실패 run 모두 `UP_TO_DATE`(PASS) |
| DB 격리 guard | `corpus-sync.mjs:150-164` → `assertSchemaIsolation`(`src/db/client.ts:67`). `current_user ≠ agentdock_app`이면 throw → exit 1, 쓰기 0 | 40317405590, 40409047009에서 거부 |
| Registry | `src/registry/sync.ts`, 응답이 없으면 10초 뒤 1회 재시도(`REGISTRY_CAPS.retryDelayMs`) | 39940525800 "Retried once after 10 s" |
| Fan-out(D-1 포함) | seeds/search/links/backlog 각 33~34, 합계 상한 100 | 성공 run마다 `fan-out source=backlog considered=33 enqueued=33` |
| Refresh | stale 12h, 상한 100, `checked_at` backoff | `refresh … considered=100 enqueued=100 … failing-checks=0` |
| Drain/Ingest/Persist | 실행당 200 job, 35분 deadline | `drained 200 job(s) of at most 200`, JSON ingest 이벤트 |
| 결과 보고 | Status 줄, `::error` annotation, ops summary | 성공 run에서 Status 표 출력. 실패 run에서 annotation과 ops FAIL 출력 |

guard 이후 ops FAIL 수는 6개에서 2개로 줄었다(FACT).
- 40229151309에서는 read-only 2개, timeout, role, search_path, 쓰기 수락이 FAIL이었다.
- 40409047009에서는 role과 search_path만 FAIL이다.
- read-only·timeout·쓰기 FAIL은 `e4c2773`의 options 수정으로 해소된 것으로 본다(INFERENCE).
- role FAIL은 남아 있다. search_path FAIL도 같은 원인으로 본다. `agentdock_app` role의 기본값(`ALTER ROLE agentdock_app SET search_path = agentdock`)이 다른 role에는 적용되지 않기 때문이다(INFERENCE).

Graphify는 `assertSchemaIsolation`의 호출자로 `client.test.ts`만 보여 준다. 실제 호출자인 `scripts/corpus-sync.mjs:152`와 `src/instrumentation.ts:23`은 동적 `await import()` 뒤에 있어서 그래프에 없다(§12).

## 8. Sync 문제별 최종 상태

| 항목 | 상태 | 근거 |
| --- | --- | --- |
| DATABASE_URL | **ACTIVE** | secret이 `agentdock_app`이 아닌 role로 접속한다. 40317405590과 40409047009에서 guard가 거부했고, 그 전 6회는 ops에서 role FAIL이었다 |
| DB role | **ACTIVE** | 같은 원인이다 |
| Preflight | **ACTIVE** | 스키마 plan은 PASS다. 격리 guard(role)와 ops 연결 검사(role, search_path)가 FAIL이다 |
| TARGET_FINGERPRINT | RESOLVED (현재 기준) | Deploy 40443671711의 plan에서 fingerprint가 일치했다. fingerprint는 URL의 username을 포함한다(`scripts/migration-gate.mjs:184-188`). 그래서 secret을 교체할 때 같이 다시 계산해야 한다 |
| D-1 (backlog 우선순위) | RESOLVED | Phase 29–31에서 39940525800 기준으로 생산적인 slot이 1/33 → 26/33이 됐다. 이후 성공 run마다 backlog fan-out 33이 실행됐다 |
| C-1 (hook 이름) | RESOLVED | 2026-10-27 GET `/artifacts?type=hook`에서 hook 이름이 `budgetclaw`, `claude-code-audit-stack`, `claude-ops` 등 plugin 디렉터리 이름으로 보인다 |
| O-2 (health summary) | RESOLVED | 실패 run에서도 ops가 FAIL 사유를 출력하고 exit 2로 끝난다. continue-on-error라 summary step은 성공으로 표시된다(40409047009) |
| O-3 (registry 재시도) | RESOLVED (동작) | 39940525800에서 재시도가 실행됐다. registry가 계속 응답하지 않아 run은 FAILED였다. 외부 일시 장애로 run을 실패 처리할지는 정책 결정으로 남는다 |
| Failed jobs 771/978 | **ACTIVE** | 2026-10-27 GET 결과 둘 다 "could not store the result", Attempt 3이다. 재enqueue는 secret 교체 뒤에만 의미가 있다 |
| Refresh | RESOLVED (기능) | 성공 run마다 considered 100, 50~64s, failing-checks 0이다. 지금은 Sync가 guard에서 멈춰 실행되지 않는다 |
| Sync schedule | RESOLVED | 예약 실행이 하루 2회 시작된다(4~6시간 지연). 실패 원인은 schedule이 아니라 role이다 |
| Neon region | PENDING | Vercel function은 `iad1`이다(FACT, `x-vercel-id`). Neon 리전 증거는 없다. 연결 문자열은 열람 금지다 |

## 9. 운영자 조치 필요 항목 (승인 대기, 실행하지 않음)

이번 작업에서는 Secret, 변수, workflow를 바꾸지 않았다. 절차는 Phase 48–50 §9와 같다.

1. **Actions secret `DATABASE_URL`을 `agentdock_app` direct URL로 교체한다. production 변수 `AGENTDOCK_TARGET_FINGERPRINT`도 함께 교체한다.** (최우선)
   - (로컬, 저장소 루트) 값을 화면과 history에 남기지 않게 읽는다: `read -rs DATABASE_URL && export DATABASE_URL`
   - `bun --no-env-file scripts/ops.mjs preflight`를 실행해 `PASS  connected as agentdock_app`, `PASS  search_path is exactly agentdock`이 나오는지 확인한다.
   - `bun --no-env-file scripts/migrate.mjs --fingerprint`로 새 16 hex 값을 얻는다.
   - `AGENTDOCK_TARGET_FINGERPRINT=<새 값> bun --no-env-file scripts/migrate.mjs --plan --production --require-current`가 `UP_TO_DATE`인지 확인한다.
   - 이전 URL과 fingerprint를 별도 보관소에 남긴다. GitHub secret은 다시 읽을 수 없다.
   - GitHub Settings에서 secret과 변수를 **연달아** 교체한다. 하나만 바꾸면 다음 Deploy의 plan이 BLOCKED된다.
   - Rollback: 보관한 이전 값으로 되돌린다. 다만 guard가 있으므로 Sync는 계속 거부된다.
2. 교체 후 다음 예약 Sync(또는 승인된 workflow_dispatch)에서 다음을 확인한다.
   - guard 통과
   - ops 7/7 PASS
   - Status
3. 그다음 job 771과 978을 재enqueue한다(Phase 35–37 §14). 다음 run 뒤에 `/r/…`가 200인지 확인한다.
4. Neon 리전을 확인하고 Vercel Function Region을 정렬할지 결정한다(Phase 23–25 §7).

## 10. Phase 68 — Stop hook 원인

두 문제는 **원인이 다르다(FACT).**

### 10.1 B: `env: unknown error: execvp failed`

- **발생:** Claude Code transcript에 기록된 Stop hook summary 627건 중 47건이다. 2026-10-26부터 41건, 10-27에 6건이다.
- **재현(FACT):** Stop hook 4개를 같은 stdin으로 하나씩 실행했다.
  - gstack `timeline-stop-hook`만 rc=126과 함께 `env: unknown error: execvp failed`를 냈다.
  - 이 파일은 `#!/usr/bin/env bash` shim이다.
  - `/usr/bin/env bash -c true`도 지금 셸에서 같은 오류를 낸다.
- **원인(FACT):** PATH에 `/tmp/.mount_orca-loIPonl`(와 그 `/usr/sbin`)이 `/usr/bin`보다 앞에 있다.
  - 이 경로는 소유 프로세스가 없는 Orca AppImage FUSE mount이고, stat하면 `ENOTCONN`을 돌려준다.
  - `env`(uutils coreutils 0.10.0)의 execvp는 ENOENT가 아닌 오류를 만나면 PATH 탐색을 멈추고 실패한다.
  - 같은 날 `xargs grep`도 "전송 종료지점이 연결되어 있지 않습니다"로 실패했다.
  - 이 경로만 PATH에서 빼면 같은 hook이 rc=0으로 끝난다.
- **영향 범위:** `#!/usr/bin/env`로 시작하는 hook만 영향을 받는다.
  - Obsidian `process_turn.py`는 `/usr/bin/python3.14`를 절대경로로 실행하므로 영향이 없다.
  - shim의 fail-open(`|| true`)은 bash가 뜬 뒤에야 동작하므로 이 실패는 막지 못한다.
- **수정:** 하지 않았다. hook 코드의 결함이 아니라 세션 환경 문제다.
  - 기존 Knowledge `stop-hook-execvp-stale-fuse`(2026-10-26)와 같은 결론이다.
  - 해결 방법은 둘 중 하나이고, 사용자 승인 대상이다.
    - (a) 새 터미널에서 Claude Code를 다시 시작한다. 그러면 PATH에 stale mount가 들어가지 않는다.
    - (b) `fusermount -uz /tmp/.mount_orca-loIPonl`로 끊긴 mount를 해제한다.

### 10.2 A: 예약 /loop turn 기록 누락 (`skip:no-turn`)

hooks.log에 기록된 Stop 결과는 다음과 같다(FACT).

| 결과 | 건수 |
| --- | ---: |
| recorded | 277 |
| skip:not-meaningful | 161 |
| **skip:no-turn** | **86** |
| skip:no-project | 50 |
| skip:optout | 10 |
| skip:cross-repo | 6 |
| duplicate | 1 |

86건 각각에 대해 Stop 시각 직전의 promptId를 transcript에서 찾아 다시 판정했다(FACT). 원인은 두 가지다.

- **A1. scheduled prompt 거부(18건):**
  - `/loop` wakeup은 사용자의 loop prompt를 `isMeta: true, turnOrigin: "scheduled"`로 저장한다.
  - `_is_prompt()`가 isMeta를 모두 제외했다.
  - Claude Code 2.1.311의 Stop 입력에는 `prompt_id`가 들어 있다(바이너리의 hook input schema). 그래서 해당 promptId를 가진 entry가 isMeta 하나뿐이면 turn을 찾지 못한다.
- **A2. 4MB tail 밖의 prompt(65건 중 대부분):**
  - prompt부터 Stop까지 transcript가 `TAIL_BYTES`(4MB)를 넘으면 prompt entry가 읽히지 않는다.
  - isMeta가 아닌 22건을 따로 쟀더니 21건이 4.2~40.8MB였다.
  - 앞서 "usage-limit 시스템 노트"로 보였던 36건도 실제로는 긴 human turn이었다. 노트가 같은 promptId로 turn 중간에 끼어 있었다.
- **나머지 8건(auto_continuation 7, peer 1):** 시스템 또는 다른 세션이 보낸 텍스트로 시작한 turn이다. 사용자 요청이 아니므로 계속 제외한다.

transcript entry 사실(FACT, 전체 transcript 집계):
- assistant entry 27,776건에는 promptId가 없다.
- user entry는 `"promptId":"uuid"` 형식으로 공백 없이 직렬화된다.
- scheduled user entry는 promptId마다 1개다.

## 11. Hook 수정사항 (AgentDock 저장소 외부)

| 파일 | 변경 |
| --- | --- |
| `~/.claude/hooks/obsidian-knowledge/process_turn.py` | ① `_is_prompt`: isMeta는 `turnOrigin == "scheduled"`일 때만 prompt로 인정한다. ② `turn_start()` 추가: tail에서 prompt를 못 찾으면, 파일의 마지막 `MAX_TURN_BYTES`(64MB) 안에서 첫 `"promptId": "<id>"`를 mmap과 정규식으로 찾아 그 줄부터 다시 읽는다. 스캔 범위에 상한이 있으므로 시간도 제한된다. ③ 64MB를 넘는 turn은 `skip:turn-too-long`으로 따로 기록한다. ④ `read_tail_entries(path, start=None)`: 시작 offset을 받는다 |
| `~/.claude/hooks/obsidian-knowledge/test_hooks.py` | `turn_origin_tests` T1–T9 추가 |

백업(수정 전, sha256):
- `process_turn.py` `fe70406e…`
- `test_hooks.py` `2b820445…`
- `settings.json` `5487b23d…`(변경하지 않음)

백업 위치는 scratchpad `p68/backup/`이다.

변경하지 않은 것:
- `settings.json`, `common.py`, `knowledge.py`, 기록 형식(`ok:id`, content hash), Vault 문서
- gstack hook, Orca hook

동작 변화(의도한 것):
- `/loop` 예약 turn도 일반 turn과 같은 기준(`should_record`)으로 기록된다. edit이 있거나, 명령과 300자 이상의 답이 있는 반복 wakeup은 반복마다 한 entry씩 남을 수 있다. dedup은 같은 prompt_id나 같은 내용일 때만 걸린다.

## 12. Hook 테스트

| 검증 | 결과 |
| --- | --- |
| 기존 suite(수정 전) | 42/42 PASS |
| 새 테스트를 수정 전 코드에 적용 | 47/50. T1(scheduled), T6(긴 turn), T8(손상된 긴 turn)이 FAIL해서 두 원인을 재현했다 |
| 수정 후 전체 | **51/51 PASS** |
| mutation 확인 | 수정 중에 `main()`의 타이머 변수 `start`를 offset으로 덮어쓰는 버그가 생겼다. 이를 잡는 T8 단언(`ms` 정상)을 넣고, 버그를 되살리면 T8이 FAIL하는 것을 확인한 뒤 복원했다 |
| 실제 transcript 86건 재판정 | 78건을 찾았다. 8건(auto_continuation, peer)은 의도대로 제외한다. 가장 느린 경우 0.48s(커진 현재 파일 기준 상한) |
| 실제 Claude Code Stop | **PASS.** `claude -p`(haiku)를 격리된 Vault 사본과 runtime(`OBSIDIAN_KNOWLEDGE_CONFIG`/`RUNTIME`)으로 2회 실행했다. `recorded:knowledge=1`, `recorded`. 운영 Vault와 운영 hooks.log의 흔적은 0건이다 |
| 실제 예약 /loop Stop | **NOT RUN.** 비대화식 실행에서는 `/loop` wakeup을 만들 수 없다. 첫 실제 예약 turn의 hooks.log 결과를 보고 확인한다(PENDING) |
| 이번 turn | 현재 transcript에서 prompt가 tail 경로로 찾아지는 것을 확인했다 |
| 여러 프로젝트 | 기존 N(동시 기록 8개), SP(session primary), K/L(non-git, vault 제외) 테스트가 PASS다. 로직은 프로젝트와 무관하다 |
| 기존 Knowledge 유지 | 기존 C, E2, Q~Y 테스트가 PASS다. 운영 Vault에는 테스트 데이터를 쓰지 않았다 |

부수 효과(FACT):
- 실제 probe 세션 2개의 transcript가 `~/.claude/projects/-tmp-claude-1000-…-scratchpad-p68-live-repo/`에 남았다.
- probe 세션에서는 전역 hook(gsd, gstack, Orca)도 평소처럼 실행됐다.

## 13. Graphify 상태

- **갱신:** 사용자가 직접 실행한 `graphify update`로 갱신됐다(2026-10-27 12:20 KST). 이번 Phase에서 다시 만들지는 않았다. AgentDock 소스는 변하지 않았고 HEAD도 같기 때문이다.
- **값(FACT):**
  - 저장소 경로: `/home/ChoiGwanghun/workspace_auto/agentdock`
  - `built_at_commit` = HEAD `2c4c7a3`
  - 205 파일(제외 18), 1,338 노드, 3,168 엣지, 65 커뮤니티
  - hook 판정 "일치"
- **대표 조회:**
  - `summaryLanguage`(L101, `only()`·`counted()` 호출): 소스와 일치한다.
  - `assertSchemaIsolation`(L67): 정의는 맞지만 호출자가 테스트 1개만 나온다.
- **한계(FACT):**
  - 동적 `await import()` 뒤의 호출은 엣지로 잡히지 않는다(`corpus-sync.mjs:152`, `instrumentation.ts:23`).
  - 모듈 최상위 상수 초기화식 안의 호출도 빠진다(`SUMMARY_LANGUAGE`, `language.ts:137`).
  - `tree_sitter_sql`이 설치되지 않아 `.sql` 5개가 그래프에 들어가지 않는다.
  - 이번 분석의 근거는 모두 소스와 운영 로그에서 직접 확인했다.

## 14. PR Review 결과

PR Review Toolkit 리뷰어 2개를 hook 변경에 대해 읽기 전용으로 실행했다.

| 리뷰어 | CRITICAL | IMPORTANT | 처리 |
| --- | ---: | ---: | --- |
| code-reviewer | 0 | 0 | MINOR 3건. ① skip 사유 구분은 반영했다(`skip:turn-too-long`). ② `/loop` 반복 기록 누적은 의도한 동작이라 §11에 적었다. ③ cap 경로와 메타문자 prompt_id 테스트는 T9로 보강했다. 리뷰어가 463MB 합성 파일로 잰 결과: 탐색 0.12s, 파싱 0.46s |
| silent-failure-hunter | 0 | 2 | ① 64MB 초과와 prompt 없음이 같은 `skip:no-turn`으로 기록됐다 → 사유를 분리했다. ② promptId가 없으면 파일 전체를 스캔해서 timeout으로 kill되고 로그도 남지 않을 수 있었다 → 스캔을 마지막 64MB로 제한했다. 둘 다 반영하고 T9로 검증했다 |

남은 MINOR(반영하지 않음):
- `"error"` 로그에 예외 타입명만 남는다. 기존부터 있던 문제다.
- scheduled entry content에 시스템 문구가 섞일 수 있는지는 첫 실제 기록에서 눈으로 확인한다.

## 15. 변경 파일

| 위치 | 파일 | 상태 |
| --- | --- | --- |
| AgentDock 저장소 | `docs/analysis/agentdock-phase66-68-operations-and-hooks.md` | 신규, 미커밋 |
| 저장소 외부 | `~/.claude/hooks/obsidian-knowledge/process_turn.py` | 수정 |
| 저장소 외부 | `~/.claude/hooks/obsidian-knowledge/test_hooks.py` | 수정 |
| Obsidian Vault | `projects/agentdock/*.md` | Knowledge 갱신(§16 키) |

AgentDock 소스 코드는 변경하지 않았다.

## 16. 남은 PENDING

| 항목 | 상태 | 조건 |
| --- | --- | --- |
| secret·fingerprint 교체 후 guard PASS, ops 7/7 | PENDING | 운영자 조치(§9-1) |
| job 771·978 복구, NUL 정제 효과 | PENDING | 교체 → 재enqueue → Sync |
| 운영 DB 실행계획, 운영/로컬 배율(6~9배 추정) | PENDING | 운영 DB 접속 금지 |
| Neon region | PENDING | 운영자 확인 |
| 실제 `/loop` 예약 turn의 Stop 기록 | PENDING | 다음 예약 wakeup의 hooks.log |
| execvp 오류 해소 | PENDING | 세션 재시작 또는 mount 해제(승인) |
| 실기기(iOS Safari, Android Chrome) | NOT RUN | 이전 Phase부터 이어짐 |

## 17. 다음 권장 작업

1. **(승인 필요, 최우선) secret과 fingerprint를 교체한다(§9).** 2026-10-25 20:26Z 이후 corpus가 갱신되지 않고 있다. 하루 2회 예약 실행이 모두 거부된다.
2. 교체 후 첫 Sync에서 guard, ops 7/7, Status를 확인하고, job 771·978을 재enqueue한다.
3. 새 터미널에서 Claude Code를 다시 시작한다. 또는 끊긴 mount 해제를 승인한다.
4. 언어 필터 비용은 운영에서 여전히 약 +0.3초다. 더 줄이려면 STORED generated column이 필요하고, migration 승인 대상이다(Phase 64 §27.5). 사용자가 운영 체감 기준으로 상한을 다시 정할지 결정한다.
5. `still-pending` seed 누적(15,591)에 대해 enqueue 상한 100을 재평가한다. 정상 Sync 2회를 관찰한 뒤에 한다.

## 18. Evidence

| ID | 내용 | 위치(scratchpad) |
| --- | --- | --- |
| E66-01 | 운영 245회 원자료, 집계, paired 비교 | `p66/run.sh`, `prod.tsv`, `stats.py`, `paired.py` |
| E66-02 | Smoke 페이지 13개 | `p66/smoke/` |
| E67-01 | Sync 10회, Deploy 1회 job 로그 | `p66/sync/*.log`, `p66/deploy-40443671711.log` |
| E68-01 | 수정 전 백업, diff | `p68/backup/`, `p68/*.diff` |
| E68-02 | 실제 Claude Code probe(격리 Vault) | `p68/live/` |
| E68-03 | hook 실행 로그 | `~/.claude/hooks/obsidian-knowledge/logs/hooks.log` |
