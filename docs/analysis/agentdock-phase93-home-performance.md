# AgentDock Phase 93: 홈 TTFB/LCP 개선

작성 2026-11-06. 기준 커밋 `94ec743`(운영과 동일) 위의 **미커밋 작업 트리**입니다. commit, push, deploy, 운영 DB 변경, 운영 Sync, 운영 재수집은 하지 않았습니다. 운영에는 GET/HEAD 요청만 보냈습니다.

**판정: CONDITIONAL.** 구현, 정확성, 로컬 전후 개선, 테스트, 리뷰는 통과했습니다. 다만 **운영 After는 측정할 수 없었습니다**(배포 금지). 운영 수치 개선은 배포 후 §11 절차로 확인해야 확정됩니다.

| 지표 | Before | After | 조건 |
|---|---|---|---|
| Warm TTFB | 529ms | 213ms | 로컬, DB 왕복 100ms |
| DB 깨어나는 중 TTFB | 5,866ms | 409ms | 로컬, 5초 깨어남 모의 |
| 집계 SQL 실행 시간(요청당) | 약 800ms | 1ms 미만 | 로컬, 합성 45,287행 |
| 운영 Warm TTFB | 2,298ms | **NOT RUN** | 배포 금지 |

## 1. 기존 구조

`src/app/page.tsx`가 `Promise.all`로 쿼리 3개를 기다린 뒤에야 첫 바이트를 보냈습니다.

| 쿼리 | 내용 | 로컬 실행 시간(합성 45,287행) |
|---|---|---|
| `countVisibleByType` | 전체 행을 `NOT_LISTED_BECAUSE`와 언어 식으로 판정 후 그룹 집계 | 385~403ms |
| `listPackages(limit 10)` | 같은 판정 후 정렬 | 413~430ms |
| `lastSyncSucceededAt` | `schema_meta` PK 조회 | 0.1ms 미만 |

- **연결:** 요청당 커넥션 3개를 동시에 사용했습니다.
- **캐시:** `force-dynamic`이고 운영 헤더는 `private, no-cache, no-store`입니다. 캐시 계층은 없습니다.
- **Sync:** 끝에서 `recordSyncSucceeded`와 `recordSyncAttempt`를 `schema_meta`에 기록합니다. `key/value` 테이블이라 Migration 없이 값을 추가할 수 있습니다.
- **loading.tsx:** `/artifacts`에만 있습니다. 앱 전체에 두면 `notFound()`의 404가 200으로 바뀌기 때문입니다. 홈은 `notFound()`를 쓰지 않아 페이지 안 Suspense가 안전합니다.

## 2. 병목 원인

Phase 91의 가설을 재검증했고 맞았습니다. `phase93-artifacts/prod-warm.txt`, `prod-cold.txt`, `prod-lcp.jsonl`.

운영 Baseline: `94ec743`, 2026-11-06 02:33~03:20 UTC, 한국→`iad1`, curl과 Chromium.

| 항목 | 값 |
|---|---|
| `/` Warm TTFB (n=10) | 중앙값 **2,298ms** (2,219~2,502), 전체 평균 2,698ms |
| `/artifacts` Warm TTFB (n=10) | 353ms (330~545), 전체 평균 2,504ms |
| `/r/nobody/nothing` (쿼리 1개, n=10) | 556ms (530~778) |
| `/` 8.5분 유휴 후 첫 TTFB (n=3) | 4,118 / 4,989 / **8,398ms**. 이어지는 요청 1,851~2,557ms |
| `/artifacts` 8.5분 유휴 후 (n=2) | TTFB 1,123 / 1,834ms, 전체 4,988 / 13,290ms |
| 데스크톱 LCP, 재방문 컨텍스트 (n=5) | 2,796ms (2,728~3,696), 최종 헤더 2,572ms, 요소 `h1` |
| 모바일 LCP, 재방문 컨텍스트 (n=5) | 2,816ms (2,480~3,656), 최종 헤더 2,593ms |

LCP의 약 92%가 최종 헤더를 기다린 시간입니다. 표본이 작고 측정 시각에 Neon 유휴 상태가 달라, 범위를 함께 봐야 합니다.

**`/artifacts`의 유휴 수치가 중요합니다.** 응답 전체는 5~13초 걸렸지만 첫 바이트는 1.1~1.8초였습니다. 즉 **느린 건 DB를 기다리는 구간이고, 스트리밍을 쓰면 그 대기가 첫 바이트에서 빠집니다.**

## 3. 변경한 구조

두 가지를 함께 적용했습니다. 스냅샷은 평상시 응답과 DB 부하를, 렌더링 경계는 DB가 잠든 경우를 해결합니다.

**스냅샷.** 완료된 Sync가 피드 10행과 집계를 JSON으로 `schema_meta`의 `home:snapshot` 한 행에 기록합니다(약 7KB). 홈은 이 행과 `sync:last_success`를 한 문장으로 읽습니다. **스키마 변경과 Migration은 없습니다.** 별도 테이블은 필요하지 않았습니다.

**요청당 쿼리는 3개에서 2개로 줄었습니다.** 두 번째는 피드 10행이 아직 살아 있는지 PK로 확인합니다. 리뷰에서 나온 문제의 수정이며 왕복 1회가 듭니다. 측정: 왕복 100ms에서 After가 114ms → 213ms가 됐습니다. 집계 비용은 행 수와 무관해졌습니다.

**첫 바이트 예산 400ms.** `FIRST_BYTE_BUDGET_MS`까지만 데이터를 기다립니다.

- **안에 오면:** Suspense 없이 완성된 HTML을 보냅니다. placeholder도, 이동도 없고 JS를 꺼도 완전합니다.
- **넘으면:** h1, 설명, 검색창, 동작하는 칩 링크를 먼저 보내고 나머지를 스트리밍합니다.

순수 스트리밍을 택하지 않은 이유: Warm 요청마다 placeholder가 깜빡이고 JS를 끈 방문자가 칩 수와 피드를 잃기 때문입니다. 대신 Warm TTFB에 최대 400ms를 더 씁니다.

처음에는 `await race` 후 항상 Suspense를 두었는데, **데이터가 이미 도착해도 fallback이 나갔습니다**(첫 바이트 18ms에 대기 경계 5개). 그래서 분기를 둘로 나눴습니다.

대기 화면의 구성은 다음과 같습니다.

| 영역 | 데이터 전 |
|---|---|
| h1, 설명, 검색 | 그대로, 사용 가능 |
| 칩 | 링크 동작, 숫자만 빈칸 |
| 3D 보드 | 같은 상자에 빈 도크. 숫자 없음. WebGL은 데이터가 온 뒤 시작 |
| 피드 | `/artifacts`와 같은 skeleton 10행, JS 없을 때 `noscript` 링크 |
| 파이프라인 숫자 | `…` |
| 타입 타일 | 기본 순서, 수량 빈칸 |

## 4. 주요 수정 파일

| 파일 | 변경 |
|---|---|
| `src/db/queries/homeSnapshot.ts` (신규) | 발행, 읽기, fallback |
| `src/app/page.tsx` | 예산, `withHome` 경계, 칩과 타일 컴포넌트 분리 |
| `src/db/queries/packages.ts` | `listPackages`, `countVisibleByType`에 `reader` 인자 |
| `scripts/corpus-sync.mjs` | `home-snapshot` stage |
| `scripts/corpus-reset.mjs` | 리셋 시 스냅샷 삭제 |
| `scripts/release.mjs` | smoke가 칩 숫자까지 확인 |
| `src/components/IndexFlow.tsx` | "right now" → "at the last complete sync" |
| `src/components/RowsPlaceholder.tsx` (신규) | `loading.tsx`에서 추출, 홈과 공유 |
| `src/log.ts` | `home_snapshot` 이벤트(닫힌 값) |
| `biome.json` | `!test-results` 한 줄 |
| `e2e/seed.mjs`, `e2e/journeys.spec.ts` | 시드가 스냅샷 발행, 여정 1개 추가 |
| 테스트 | `homeSnapshot.test.ts`, `page.test.tsx`(신규), `release.test.ts` |

## 5. 스냅샷 생성·갱신 흐름

```
Sync의 모든 stage 종료
  └─ 실패 없음(!failed && stageFailures 0)
       ├─ repeatable read, read only 트랜잭션: now(), 피드, 집계
       ├─ 자기 결과를 스키마로 검증
       ├─ upsert 1문장 (where 저장된 updated_at < 새 값)
       └─ 그 뒤 sync:last_success 기록
```

- **원자성:** 한 행 upsert이므로 독자는 이전 전체 또는 새 전체만 봅니다.
- **일관성:** 피드와 집계가 같은 DB 스냅샷을 읽습니다. 다른 연결의 커밋을 두 읽기 사이에 끼워 넣는 테스트로 확인했고, 트랜잭션을 제거하거나 격리 수준을 낮추면 실패합니다.
- **동시 Sync:** GitHub Actions는 `concurrency: sync`로 막습니다. Docker cron이 겹쳐도 `where` 절이 오래된 쓰기를 버립니다. upsert를 트랜잭션 밖에 둔 이유는 repeatable read 안에서 40001로 실패하기 때문입니다.
- **중복 실행:** 같은 결과로 덮어쓸 뿐입니다.
- **같은 기준:** 값은 `listPackages`와 `countVisibleByType`에서 나오므로 판정 기준이 둘이 될 수 없습니다.
- **비용:** 로컬 45,287행에서 발행 916ms. 12시간마다 한 번입니다.

## 6. 장애 및 실패 시 동작

| 상황 | 동작 | 검증 |
|---|---|---|
| 스냅샷 없음(첫 배포) | live 쿼리, 이전과 동일. `home_snapshot fallback=missing` 로그 | 단위 |
| 깨진 JSON, 형식 불일치 | live 쿼리, `unreadable` 로그 | 단위 |
| 48시간 초과 | live 쿼리, `stale` 로그 | 단위(경계 양쪽) |
| 일반 stage 실패 | 발행 안 함, 이전 값 유지, exit 1 | 실제 Sync 실행 |
| registry 파싱 실패 | 발행 안 함 | 소스 검사 테스트만 |
| 발행 실패 | 해당 run 실패, `last_success` 미기록, 이전 값 유지 | 단위(읽기 실패, 자기 검증 실패) |
| Sync 도중 | 이전 스냅샷. `/artifacts`만 먼저 늘어남 | 단위 |
| 스냅샷 뒤 delist된 행 | 피드에서 제외, 수량은 그대로 | 단위 |
| `corpus:reset` | 스냅샷 삭제 | 소스 검사 테스트 |
| DB 실패, 예산 안 | HTTP 500과 오류 화면(이전과 동일) | 브라우저, 단위 |
| DB 실패, 예산 후 | **HTTP 200**과 오류 화면 | 브라우저, 단위 |

**새 위험 하나:** 예산 뒤 실패는 상태 코드가 200입니다. JS를 끄면 오류 화면도 뜨지 않고 skeleton에 머뭅니다. Next 문서에도 있는 스트리밍 응답의 한계이며 `/artifacts`도 이미 같습니다. 그래서 smoke가 상태만이 아니라 칩 숫자를 확인하도록 고쳤습니다. 단, smoke는 배포 때만 돕니다.

**운영자 감지:** 스냅샷이 오래됐다면 run이 여러 번 실패했다는 뜻이고, 그 사실은 red run과 `ops:status`의 `DEGRADED`(36시간)로 드러납니다. 별도 지표는 추가하지 않았습니다. `home_snapshot` 로그가 없으면 스냅샷 경로입니다.

## 7. Before/After 성능 표

**같은 조건:** 로컬 production 빌드, 테스트 PostgreSQL 17, 합성 45,287행(`synth-load.sql`, Phase 91과 같은 생성식), Before와 After를 번갈아 2회 측정, 20코어. `latency-proxy.cjs`로 DB 왕복과 깨어남을 모의했습니다. **Neon의 처리 속도를 모델링한 것이 아니므로 운영 절대값이 아닙니다.** 원자료 `local-ttfb.txt`, `lcp-*.jsonl`, `browser-*.json`, `query-log.txt`.

| 지표 | Before | After | 조건·표본 |
|---|---|---|---|
| Warm TTFB | 431ms (419~465) | **14ms** (10~24) | 지연 없음, n=40 |
| Warm TTFB | 529ms (517~640) | **213ms** (210~224) | 왕복 100ms, n=40 |
| DB 유휴 TTFB(첫 바이트) | 5,866ms (5,850~6,064) | **409ms** (406~412) | 왕복 100ms + 5초 깨어남, n=6 |
| 위 조건의 데이터 완료 시각 | 5,908ms | 5,631ms | 데이터 준비 자체는 거의 그대로 |
| 새 인스턴스 + DB 유휴 | 6,675ms | **6,199ms** | 프로세스 시작부터, n=6. **거의 개선 없음** |
| 데스크톱 LCP | 604ms (576~712) | **368ms** (272~508) | 왕복 100ms, 새 컨텍스트, n=10 |
| 모바일 LCP | 584ms (572~664) | **268ms** (256~284) | 같음 |
| 쿼리 수 | 3 | 2 | 요청당 |
| 집계 SQL 실행 시간 | 약 800ms | 1ms 미만 | PostgreSQL 로그 |
| 커넥션 사용 | 3 | 1 | PostgreSQL 로그의 PID |
| 클라이언트 JS | 1,551,192B | 1,551,192B | `.next/static` |
| 홈 HTML(gzip) | 32,473B | 32,486B | 평균, CSS 한 줄 추가 전 |
| CLS(완성 경로) | 0 | 0 | n=10 |
| CLS(스트리밍 경로) | 해당 없음 | 최대 0 / 0 / **0.0421** | 데스크톱/태블릿/폰, n=5. 폰은 피드 섹션 배경 `::before` 1회 |

**정적 h1과 실제 데이터를 구분한 측정**(왕복 800ms로 예산을 강제로 넘긴 스트리밍 경로, n=5):

| 뷰포트 | 최종 헤더 | h1 표시(LCP) | 칩 숫자·피드 도착 |
|---|---|---|---|
| 데스크톱 1440 | 408ms | **452ms** | 칩 1,646ms, 피드 1,943ms |
| 태블릿 1024 | 409ms | **468ms** | 칩 1,641ms, 피드 1,937ms |
| 폰 390 | 408ms | **444ms** | 칩 1,629ms, 피드 1,635ms |

스크린샷을 비교하다 칩 숫자가 들어오며 칩이 2줄에서 3줄로 늘어 h1이 25px 움직이는 것을 발견했습니다(당시 CLS 0.0039로 수치는 작았음). `.chip-count:empty`로 자리를 예약해 데스크톱과 태블릿 CLS가 0이 됐습니다. 이 CSS 한 줄은 TTFB, LCP 표의 측정 뒤에 들어갔고, 이 표와 CLS, 브라우저 경로, 전체 검사는 그 이후 다시 실행했습니다.

즉 스트리밍 경로의 LCP는 내용이 준비된 시점이 아니라 h1이 보인 시점입니다. LCP 숫자만으로 데이터가 빨라졌다고 읽으면 안 됩니다. 시각은 페이지 시작 기준 평가 지연을 포함합니다.

**운영 예상(추정, 측정 아님).** Warm 첫 바이트는 약 0.6~0.75초로 예상합니다. 근거는 셸 353ms, 쿼리 1개 페이지 556ms, 예산 상한 400ms입니다. 유휴 후 h1은 `/artifacts`의 1.1~1.8초에 예산 0.4초를 더한 약 1.5~2.2초로 예상합니다.

**개선 목표(Baseline 기준, 배포 후 판정):** Warm TTFB 중앙값 800ms 이하, 유휴 후 첫 바이트 2.5초 이하, CLS 0.1 미만, 콘솔 오류 0.

## 8. 데이터 정확성 비교

`phase93-artifacts/sync-flow.txt`, 최종 코드, 실제 `corpus-sync.mjs` 실행 후 합성 데이터.

| 항목 | 홈 | `/artifacts` 총계 | 결과 |
|---|---|---|---|
| 전체 | 38,556 | 38,556 | 일치 |
| `lang=any` | 38,697 | 38,697 | 일치 |
| agent | 420 | 420 | 일치 |
| command | 7,286 | 7,286 | 일치 |
| hook | 1,228 | 1,228 | 일치 |
| mcp_server | 140 | 140 | 일치 |
| plugin | 2,335 | 2,335 | 일치 |
| skill | 27,147 | 27,147 | 일치 |

- 피드 10행 전체와 집계가 live 쿼리와 값까지 같습니다.
- **실패한 Sync:** registry 차단, exit 1, 스냅샷 `updated_at` 불변, 새로 넣은 행은 홈에 0건입니다.
- **이어진 정상 Sync:** exit 0, `updated_at` 갱신, 새 행이 홈에 나타납니다.

**의미 변화(결정 필요 없이 알림).** 칩 수는 이제 "지금"이 아니라 "마지막으로 온전히 끝난 Sync 시점"의 값입니다. Sync 도중이나 실패 뒤에는 `/artifacts`와 차이가 날 수 있고, 다음 정상 run 또는 48시간에 해소됩니다. 그래서 파이프라인 문구도 바꿨습니다. 운영 수량은 조회하지 않았으므로 운영 대조는 §11에 넣었습니다.

## 9. 테스트 및 리뷰 결과

| 검사 | 결과 |
|---|---|
| `check:boundaries` | OK |
| `lint` | 통과, **E2E 직후에도 통과** |
| `typecheck` | 통과 |
| 단위 (테스트 DB 포함) | **1,596 통과, 2 skip**. skip은 Phase 92와 같은 pg_trgm fallback, 잘못된 비밀번호 접속 |
| E2E | **74 통과**(2.7분). 신규 1개 포함. axe, 3D, 터치, 폰, 뒤로가기, WebGL 정리 여정 포함 |
| 빌드 | `VERCEL=1`, standalone 모두 성공 |
| 대기 화면 axe (1280 light, 390 dark) | 위반 0. 이 상태는 기존 여정이 다루지 않아 별도 실행 |
| 스트리밍 경로 브라우저 | 콘솔 오류 0(nonce CSP 포함), 가로 넘침 0, 3D `live` |
| 대기 중 조작 | 검색 → `/artifacts?q=review`, 칩 → `?type=hook`, 뒤로가기 후 칩·피드 복원 |
| JS 끔(완성 경로) | h1, 검색, 칩 숫자, 피드 전체 표시 |
| JS 끔(스트리밍 경로) | h1, 검색, 칩 링크, `noscript` 링크. 숫자와 피드 없음 |
| reduced motion | `still`, Canvas 0 |
| 메모리 누수 | 기존 여정(WebGL 컨텍스트 수) 통과. 별도 장시간 측정은 NOT RUN |

회귀 테스트는 일부러 망가뜨려 실패를 확인했습니다: 오래된 쓰기 guard 제거, 나이 판정 무력화, `withHome`의 완성 경로 차단, 격리 수준 하향, 트랜잭션 밖 읽기.

**`test-results` lint 문제.** Biome는 `.gitignore`를 따르지 않아 Playwright가 남긴 `test-results/.last-run.json`의 포맷을 검사했습니다. `biome.json`에 `!test-results`만 추가했고 다른 대상은 그대로입니다. `vcs.useIgnoreFile`은 범위가 넓어 쓰지 않았습니다.

**리뷰 (PR Review Toolkit: code-reviewer, silent-failure-hunter, pr-test-analyzer). CRITICAL 0.** CodeWatcher는 NOT RUN입니다(이 환경에 없음).

| 지적 | 처리 |
|---|---|
| `parse_failure`로 실패한 run도 발행 | 수정, 소스 검사 테스트 |
| delist된 행이 피드에 남아 404 | 수정, 테스트. 쿼리 1개 추가 |
| "right now" 문구가 거짓이 될 수 있음 | 문구 수정 |
| 새 컬럼이 스냅샷에서만 사라질 수 있음 | strict 스키마, 발행자 자기 검증, 테스트 |
| 일관성, `lastSync`, 예산 후 실패 테스트 없음 | 추가 |
| `recent-heading` id 중복, 주석 위치 | 수정 |
| 겹치는 발행 테스트가 순서를 검증하지 못함 | 유지. 40001 회귀만 잡는 테스트이고 순서는 별도 테스트가 봄 |
| 예산 후 실패 200, JS 끔 skeleton | §6, §10에 위험으로 기록 |
| 스냅샷 경로에 로그 없음 | 유지. 요청당 로그는 비용 대비 효과 낮음 |
| reset과 발행이 겹치면 삭제 코퍼스가 되살아남 | §10 |
| `db:seed` 후 개발 DB의 홈이 최대 48시간 낡음 | §10 |

실제 Neon·PgBouncer 위 트랜잭션 동작은 리뷰가 소스로만 확인했습니다. 첫 예약 Sync가 곧 검증이므로 §11에 넣었습니다.

## 10. 남은 문제

**이번 변경과 관련**

| 항목 | 내용 |
|---|---|
| 운영 After 미측정 | 배포 금지. §11 |
| 새 인스턴스 + 잠든 DB | `register()`가 DB를 기다려 h1도 함께 늦습니다(로컬 6,675 → 6,199ms). 운영 `/artifacts`의 수치는 항상 막히지는 않음을 보이지만 빈도는 모릅니다. `register()`를 비차단으로 바꾸면 "잘못된 연결이면 시작 거부"가 약해지므로 별도 결정 사항입니다 |
| JS 끔 + 유휴 시 | 수량과 피드 없음. `/artifacts`는 이 조건 없이도 skeleton에 머무는 문제가 있어(범위 밖 후속) 이미 더 심합니다 |
| Warm 요청이 예산을 넘는 경우 | 운영 왕복이 길면 placeholder가 깜빡일 수 있습니다. 배포 후 `<!--$?-->` 비율로 판단, 값은 `FIRST_BYTE_BUDGET_MS` 하나 |
| reset과 발행 경합 | 수동 작업과 Sync가 겹칠 때만. 피드는 PK 확인으로 걸러지나 수량은 다음 run까지 남습니다 |
| `db:seed` | 개발 DB 한정, 영향 낮음 |

**Phase 92 잔여 항목 확인**

| 항목 | 결과 |
|---|---|
| 최종 `capSummary`로 긴 명령 저장 | **통과.** 테스트 DB에서 rosetta 수집 성공, 605건 저장, 54000 없음(이후 행 삭제). 다만 후속 통계 쿼리가 제 SQL 오류로 실패해 finding 수와 잘린 요약 수는 미확인 |
| `source_path` 길이 위험 | **실재.** 약 3,840자 경로로 `index row size 3872 exceeds ... "package_identity"` 재현(롤백). `capability_finding_identity`에도 같은 열이 있습니다. 경로 상한이 없어 저장소 전체 저장이 실패할 수 있습니다. 후속 |
| Sync와 스냅샷 충돌 | 없음. §5, §8 |
| Next 16.4.5 캐시·스트리밍 | `force-dynamic` 유지, 스트리밍과 nonce CSP 로컬 동작. Vercel 스트리밍은 `/artifacts`로 확인. `cacheComponents` 미사용 |
| 런타임 High 취약점 | **이번 변경으로 악화되지 않음**, 미처리. `zod`(<4.6.6, 과대 컬렉션 메모리)는 이번에 스냅샷 파싱에도 쓰지만 입력이 자기 DB의 약 7KB입니다. `js-yaml`(<4.3.2, merge key CPU)은 `src/detect/frontmatter.ts`로 **신뢰할 수 없는 frontmatter를 Sync에서 파싱**하며 홈 경로에는 없습니다. 업그레이드 후속 권장 |

**범위 밖 후속**

- `source_path` 상한(새 상한은 `src/corpus/caps.ts`).
- `js-yaml`, `zod` 업그레이드.
- `/artifacts`의 LCP와 JS 끔 skeleton(B-02). 응답 전체 약 2.5초는 그대로입니다.
- rosetta 운영 재수집(승인 필요).
- `register()` 비차단 결정.
- 대안 메모: Vercel CDN 캐시 헤더(`Vercel-CDN-Cache-Control`)는 유휴 대기를 더 줄일 수 있으나 로컬에서 검증할 수 없고 캐시 계층이라 넣지 않았습니다.

## 11. 운영 배포 시 필요한 절차

**Migration과 운영 수동 작업은 필요 없습니다.** 순서 제약도 없습니다. 배포 직후 스냅샷이 없으면 홈은 이전과 같은 live 경로로 동작하고, **다음 예약 Sync(06:00 또는 18:00 UTC)가 처음 발행합니다.** 그 전까지는 스트리밍 효과만 있습니다.

1. 커밋 전: `bun run ci`, `bun run build`, E2E.
2. 커밋·푸시 후 CI, Deploy 확인. smoke는 이제 홈 칩 숫자까지 봅니다.
3. **배포 직후 (스냅샷 전):** `/`가 200, 콘솔 오류 0, Vercel 로그에 `home_snapshot fallback=missing`.
4. **첫 예약 Sync 후:**
   - 로그에 `home snapshot published, listed=… hidden=…`와 Status 확인. **Neon 풀러 위 repeatable read 트랜잭션의 첫 실제 검증입니다.**
   - `fallback` 로그가 사라졌는지 확인.
   - 칩 전체가 `/artifacts` 총계와, 타입별 칩이 각 필터 총계와 같은지 확인(§8 방식, Sync 진행 중이 아닐 때).
5. **성능 판정(Baseline과 같은 스크립트):**
   - `docs/analysis/phase93-artifacts/prod-baseline.sh <출력 디렉터리>`
   - `node docs/analysis/phase93-artifacts/summarize-lcp.cjs <출력>/prod-lcp.jsonl`
   - §7 목표와 비교합니다. 측정 시각과 Neon 유휴 상태를 함께 기록합니다.
6. 응답에 `<!--$?-->`가 Warm에서 자주 보이면 예산을 조정합니다.

## 12. 운영 롤백 및 복구 방법

| 상황 | 방법 | 비고 |
|---|---|---|
| 코드 전체 되돌리기 | `git revert` 후 정상 배포 경로 | Migration이 없어 DB 조치 불필요. 이전 코드는 `home:snapshot` 행을 읽지 않습니다. force push와 Vercel 수동 rollback은 쓰지 않습니다(도메인 배정 중단, `release.mjs` 경고) |
| 스냅샷 값이 잘못됨 | 승인 후 `DELETE FROM agentdock.schema_meta WHERE key = 'home:snapshot'` | 다음 요청부터 즉시 live. 데이터 손실 없음, 다음 정상 Sync가 재생성 |
| 발행이 계속 실패 | 이전 스냅샷 유지, 48시간 뒤 자동 live | 원인은 run의 `stage=home-snapshot FAILED` |
| 부분 비활성화 | 없음 | 플래그를 두지 않았습니다. 위 DELETE는 다음 Sync까지만 유효 |

되돌린 뒤 남은 행은 약 7KB이고 어떤 코드도 읽지 않으므로 그대로 둬도 됩니다.

## 측정 데이터

`docs/analysis/phase93-artifacts/`

| 파일 | 내용 |
|---|---|
| `prod-baseline.sh`, `prod-warm.txt`, `prod-cold.txt`, `prod-lcp.jsonl` | 운영 Baseline |
| `synth-load.sql`, `latency-proxy.cjs`, `local-bench.sh`, `summarize-*` | 로컬 재현 |
| `local-ttfb.txt`, `lcp-before.jsonl`, `lcp-after.jsonl` | 전후 원자료 |
| `query-log.txt` | PostgreSQL 문장 로그. `docker logs --since`가 초 단위라 인접 요청이 함께 잡혀 있습니다. 요청당 수는 §7 |
| `late-path.cjs`, `browser-whole.json`, `browser-late.json`, `browser-summary.txt` | 브라우저 경로 |
| `a11y-pending.cjs`, `a11y-pending.txt` | 대기 화면 axe |
| `sync-flow.txt` | 실제 Sync 실패·성공 흐름과 수량 대조 |

스크린샷: `docs/images/phase93/` (`whole-*` 완성 경로, `late-pending-*`, `late-done-*` 스트리밍 경로, `*-nojs-*`).

측정 후 테스트 DB의 합성 행을 지우고 시드를 다시 넣었습니다(11개 저장소, 287행). 역할의 임시 로그 설정도 되돌렸습니다.
