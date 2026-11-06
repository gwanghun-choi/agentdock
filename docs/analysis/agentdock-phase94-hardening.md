# AgentDock Phase 94 — 저사양 렌더링, 색인 안정성, 보안, 검색

작성 2026-11-06. 기준 `058d36a`(develop), §6·§8·§10·§12·§13은 Expand/Contract 전환 후 갱신. **Phase 94 변경은 미커밋이다.** Phase 94의 commit, push, deploy, 운영 DB 변경, 운영 Sync, rosetta 재수집은 하지 않았다.

자료: `docs/analysis/phase94-artifacts/`, 스크린샷: `docs/images/phase94/`

## 1. 핵심 결론

**최종 판정: CONDITIONAL.** 로컬과 일회용 DB 기준으로 완료 조건을 충족했다. 운영 적용과 운영 검증은 배포 금지로 NOT RUN이고 actionlint도 NOT RUN이라 PASS가 아니다.

**갱신: Phase 93은 `c1d4e7b`로 운영에 반영됐다.** 이 문서 작성 시점에는 `058d36a`의 CI 실패(Phase 92에서 제가 넣은 시간 테스트, 러너 576ms, 상한 500ms)로 미배포였다. 복구 커밋은 그 테스트 파일 하나만 바꿨고, 결과는 Phase 93 보고서 첫머리에 있다.

| 항목 | 결과 |
|---|---|
| 저사양 3D | 소프트웨어 렌더러는 정적 그림이 기본. 초기 JS 1,389KB → 463KB, 3D chunk 928KB 미다운로드, draw 0 |
| 실제 GPU | 유지. 60.1fps → 60.1fps, 첫 프레임 932ms → 924ms |
| `source_path` 54000 | Expand(`0011`)와 Contract(`0012`)로 나눠 해결. **Contract 적용 전까지 54000은 남는다.** 작업 트리는 Expand 상태이고 Contract는 `contract-0012.patch`다(§10) |
| High 취약점 | 4건 → 0건. 남은 것은 개발 전용 moderate 1건 |
| 스트리밍 실패 | 검색과 칩을 유지한 채 안내. 20초 상한. JS 끔 안내 추가 |
| 새 인스턴스 + 잠든 DB | 첫 바이트 6,221ms → 1,480ms |
| 검색창 X | 입력창 오른쪽 끝. 3개 엔진, 58개 조합(174건) 통과 |
| `ponytail` 중복 | **실제 중복 0건.** 22행 전부 서로 다른 파일. 데이터 수정 없음 |
| 검색 순위와 성능 | 순위 동일(17개 검색어), 쿼리 수와 시간 동일 |
| 테스트 | Expand 단위 1,637, Contract 단위 1,639 통과, 각 2 skip. E2E 각 112 통과. §8 |

리뷰에서 **기존 배포 게이트의 구멍**도 나왔다. `/artifacts`가 DB 장애여도 smoke가 통과했다. 함께 고쳤다(§9).

## 2. 변경 전 기준

**Git과 운영 (2026-11-06 05:35 UTC 기준, `phase93-state.txt`)**

| 항목 | 값 |
|---|---|
| HEAD, origin/develop | `058d36a` |
| 운영 SHA | `94ec743` (Phase 92) |
| CI `058d36a` | failure (`redos.test.ts` 1건) |
| Deploy `058d36a` | skipped |
| 마지막 Sync | 42125980160, 11-05 22:58 UTC, success, `COMPLETED` |

**Phase 93 운영 After: NOT RUN.** 스냅샷 유무, 적용 여부, 운영 LCP와 TTFB를 잴 수 없다. Phase 93의 판정은 CONDITIONAL 그대로다. 비교 기준(운영 Warm TTFB 2,298ms, LCP 2,796ms)은 Phase 93 보고서에 있다. §11에 측정 절차를 적었다.

**Sync 실행 시각 정정.** Cron은 06:00, 18:00 UTC인데 실제 시작은 최근 6회 모두 약 13:10~13:39와 22:39~22:58 UTC였다. Phase 93 보고서의 "06:00/18:00에 첫 스냅샷"은 부정확하다.

**Sync 상태 (로그만 읽음, `sync-summary-42125980160.txt`).** 운영 DB에는 접속하지 않았다.

| 항목 | 값 |
|---|---|
| Status | `COMPLETED`, 200건 처리 |
| Other failures, Could not be read | 0, 0 |
| Jobs still queued | 0 |
| refresh `not-reached` | 1,309 (cap 100, 이번 작업과 무관) |
| listed / held | 46,672 / 56,671 |

`griddynamics/rosetta`의 `storage_failed`는 Phase 91 기록 그대로다. `source_path` 54000은 운영에서 관측된 적이 없고, 이번 수정은 재현에 근거한 예방이다.

## 3. 각 문제의 원인

**3D.** `DockBoard`가 WebGL 존재만 확인하고 chunk를 받았다. 소프트웨어 렌더러 판별은 chunk를 받은 뒤 `DockScene` 안에서 품질을 낮추는 데만 쓰였다.

**브라우저 판별 한계 (실측, `gpu-signal-probe.txt`)**

| 환경 | 렌더러 문자열 | `failIfMajorPerformanceCaveat` |
|---|---|---|
| Chromium SwiftShader | `... SwiftShader driver` | **컨텍스트를 그대로 줌** |
| Chromium 실제 GPU | `... Intel(R) Graphics (RPL-S) ...` | 줌 |
| Firefox | `Intel(R) HD Graphics, or similar` (고정값) | 줌 |
| WebKit | `Apple GPU` (고정값) | 줌 |

즉 쓸 수 있는 신호는 Chromium의 렌더러 문자열뿐이다. 표준 플래그는 아무것도 구분하지 못했다.

**`source_path`.** Unique 제약이 경로 전체를 btree에 넣는데, btree 항목은 약 2,700바이트로 제한된다. 저장소 하나의 트랜잭션 전체가 실패한다. 재현: `index row size 3856 exceeds btree version 4 maximum 2704`(`migration-cost.txt`).

**스트리밍.** 첫 바이트 후 실패가 `app/error.tsx`로 올라가 검색창과 칩까지 교체했고, 그 안내는 JS가 있어야 보였다. DB가 응답하지 않으면 연결 제한 30초까지 skeleton이 남았다. JS를 끄면 skeleton이 영원히 남았다. 새 인스턴스는 `register()`가 끝날 때까지 어떤 요청도 받지 않았다.

**검색창 X.** 입력창 자체가 아니라 브라우저 기본 `::-webkit-search-cancel-button`이었다. 단축키 자리로 잡은 `padding-right: 7.5rem` 안쪽에 그려져 중간에 떴다. 키보드로 닿지 않고, Firefox에는 없었다.

**검색 결과.** 데이터 문제가 아니라 표시 문제였다. 경로가 메타 줄의 "Matched in …" 뒤에 있어 이름이 같은 행의 차이를 찾기 어려웠다.

**취약점.** §7.

## 4. 구현 내용

**3D (`DockBoard.tsx`, `DockScene.tsx`, `dockBoard.ts`)**

| 환경 | 동작 |
|---|---|
| 실제 GPU | 기존과 동일. 스스로 시작 |
| 소프트웨어 렌더러(Chromium) | 정적 그림 + "View in 3D". chunk 미다운로드 |
| 렌더러를 숨기는 브라우저 | 일단 시작. 최저 품질에서 15fps 미만이 3회 연속이면(약 4.5초) 그림으로 복귀 |
| WebGL 없음 | 그림만. 버튼 없음 |
| Reduced Motion, 데이터 절약 | 그림 + 버튼. 요청 시 Pause 상태로 시작 |
| 폰, 좁은 화면 | 그림만 |
| 사용자 선택 | `agentdock:scene`에 저장, 다음 방문에도 유지. 요청한 사람에게는 프레임 복귀 없음 |
| 실패 | 그림 + "The 3D view could not start" (요청한 경우). 포커스가 버튼에 있을 때만 옮김 |

렌더러 문자열은 판별 후 버린다. 저장하거나 전송하지 않는다. 사이트가 영어라 버튼 문구는 요청의 "3D로 보기" 대신 "View in 3D"로 했다. 정적 그림은 기존 SVG를 그대로 썼다. 6종 형상, plate 규칙, 허브, DOM 레이블을 이미 갖고 있어(`whole-done-desktop.png`) 고칠 이유가 없었다.

**`source_path`.** §6.

**스트리밍 (`page.tsx`, `instrumentation.ts`)**

| 상황 | Before | After (실측, `streaming-results.txt`) |
|---|---|---|
| 첫 바이트 후 DB 실패 | error 화면이 검색·칩까지 교체 | **200, 검색·칩 7개 유지, 안내와 Try again**, `home_unavailable` 로그(`code: ECONNREFUSED`) |
| DB 무응답 | 연결 제한까지 대기 | 첫 바이트 0.46초, **20.5초에 안내로 종료** |
| JS 끔 + 느린 DB | skeleton이 영구히 남음 | skeleton 숨김(`@media (scripting: none)`), "Reload" 안내 |
| 예산 안의 실패 | 500 | 500 유지 |
| 잘못된 role | 부팅 실패 | exit 1 (부팅 직후) |
| 잘못된 환경 변수 | 부팅 실패 | exit 1 |
| DB 무응답 부팅 | 부팅 실패 | 프로세스 유지, 30초 간격 10회 재검사 후 한 줄 로그 |

첫 바이트 후 200은 바꿀 수 없다. 스트리밍을 없애는 대신 페이지가 상태를 말하도록 했고, 판정은 §9의 smoke가 맡는다.

**검색 UI (`SearchLauncher.tsx`, `SearchHotkey.tsx`, `globals.css`).** 실제 `<button aria-label="Clear search">`를 넣었다. 표시 여부는 `:placeholder-shown`으로 CSS만으로 정하고, 지우기와 포커스는 기존 `SearchHotkey`가 맡아 **클라이언트 컴포넌트는 늘지 않았다.** 입력값이 있으면 단축키 표시를 숨기고 여백을 2.75rem으로 줄인다. JS를 끄면 기본 X가 입력창 끝에 남는다. 홈, 목록, 팔레트에 같은 규칙을 적용했다.

**검색 결과 (`PackageRows.tsx`).** 이름 바로 아래에 경로를 둔다. 플러그인 안의 파일은 `in the plugin at …`, 같은 이름·저장소의 다른 경로는 `a separate file from the row above`를 표시한다. 폰에서는 경로를 설명 아래에 둔다(360×800에서 첫 결과의 설명이 화면 밖으로 밀렸다). 홈 피드는 바꾸지 않았다. 긴 한 단어 검색어가 390px에서 268px 넘치던 기존 문제도 고쳤다.

**그룹화, 접기, 다양성 재정렬은 하지 않았다.** §14-6 참고.

## 5. 성능 Before/After

로컬 standalone 빌드, 같은 테스트 DB. Before는 `058d36a`. 로컬 측정이며 운영 수치가 아니다.

**3D, 1920×1080 (`scene-summary.txt`). Chromium은 n=3 중앙값, Firefox와 WebKit은 n=1**

| 환경 | 지표 | Before | After 기본 | After 요청 시 |
|---|---|---|---|---|
| SwiftShader 2코어 | FPS | 4.6 | 그림 (draw 0) | 4.7 |
| | 초기 JS | 1,389KB | **463KB** | 1,391KB |
| | 가장 큰 JS | 928KB | **224KB** | 928KB |
| | JS Heap | 11.9MB | **4.7MB** | 12.0MB |
| | Canvas | 1 | 0 | 1 |
| | 측정 중 머신 사용 코어 | 4.93 | **1.11** | 3.81 |
| | 첫 프레임 | 약 3.9초 | 없음 | 약 4.1초 |
| SwiftShader 전체 코어 | FPS | 20.7 | 그림 | 23.5 |
| | 머신 사용 코어 | 17.91 | **1.13** | 16.97 |
| 실제 GPU (Intel) | FPS | 60.1 | **60.1** | 60.1 |
| | Draw/초, Tris/초 | 5,839, 248만 | 동일 | 동일 |
| | 첫 프레임 | 932ms | 924ms | 928ms |
| Firefox 157 | FPS | 60.1 | 60.1 | 60.1 |
| Playwright WebKit | FPS | 37.2 | 36.1 | 36.2 |
| 폰 390 | JS | 461KB | 463KB | 동일 |

- 정지 시 draw(3초): 모든 조합에서 0.
- 머신 사용 코어의 바닥값은 약 1.1이다. 측정기와 상주 컨테이너 몫이라 "그림이 1코어를 쓴다"는 뜻이 아니다.
- 그림 경로의 probe는 WebGL 컨텍스트를 하나 만들고 바로 해제한다. 그 비용은 따로 재지 않았다.
- WebKit은 렌더러를 숨겨 스스로 시작한다. 36fps라 복귀 조건에 걸리지 않는다. 소프트웨어로 도는 것으로 보이지만 확인할 방법이 없다(추정).
- Before 측정 중에 제가 짧은 테스트를 몇 번 돌려 약간의 잡음이 있을 수 있다. After는 테스트와 겹치지 않았다.
- After 3D 표는 마지막 CSS와 Escape 수정 이전 빌드에서 쟀다. 두 수정은 장면을 건드리지 않는다.
- **WebGL 누수:** 기존 journey(4회 왕복 후 live context)와 새 journey(토글 4회, canvas 1→0, 오류 0) 통과. 30회 장기 측정은 다시 돌리지 않았다.

**홈 TTFB (합성 45,287행, ABAB, `local-ttfb-summary.txt`)**

| 조건 | Before | After |
|---|---|---|
| Warm loopback (n=40) | 15ms | 14ms |
| Warm 왕복 100ms (n=40) | 215ms | 217ms |
| 잠든 DB, 인스턴스 유지 (n=6) | 410ms | 409ms |
| **새 인스턴스 + 잠든 DB (n=6)** | **6,221ms** | **1,480ms** |

데이터가 모두 도착하는 시간은 그대로다(약 5.7~5.9초, 깨어나는 시간 5초 모의).

**CLS.** 완성 경로 0. 스트리밍 경로 데스크톱·태블릿 0, 폰 0.0346(`browser-summary.txt`). 왕복 800ms에서 h1 약 437~457ms.

## 6. DB 인덱스 변경 사항

경로의 SHA-256을 담는 **식 unique index** 2개를 두고, 옛 unique 제약은 별도 단계에서 지운다. `source_path`는 원문 그대로 유지하며 열은 추가하지 않는다.

```sql
CREATE UNIQUE INDEX package_identity_digest ON agentdock.package
  (repository_id, type, sha256(replace(source_path, '\', '\\')::bytea));
CREATE UNIQUE INDEX capability_finding_identity_digest ON agentdock.capability_finding
  (package_version_id, detector_id, category, sha256(replace(source_path, '\', '\\')::bytea), start_line, summary);
```

| 대안 | 기각 이유 |
|---|---|
| 경로 자르기 | 앞부분이 같은 다른 파일이 합쳐진다. 요청에서 금지 |
| 저장 전 상한으로 건너뛰기 | 정상 파일이 목록에서 사라진다 |
| MD5 | 공격자가 정하는 입력에 쓸 근거가 약하다 |
| 생성 열 (처음 구현) | 테이블을 재작성한다. 45,287 패키지에서 읽기 3,315ms 정지. 운영 부적합으로 폐기 |

식은 `convert_to`가 immutable이 아니어서 `replace` + `::bytea`를 쓴다. 다국어, `\x41`, 백슬래시 경로에서 Node SHA-256과 일치함을 테스트로 확인했다.

**Drizzle.** `drizzle-kit generate`는 식 인덱스를 그대로 생성한다. `onConflict` target만 열을 요구하므로 package upsert와 finding insert 두 곳은 `` tx.execute(sql`${insert.getSQL()} on conflict ...`) ``로 쓴다. 값 인코딩은 Drizzle 그대로이고, 같은 입력의 저장 결과 지문이 구 코드와 신 코드, 모든 스키마 상태에서 같았다(`d3a6c3146e81`).

**bigint.** `tx.execute`는 Drizzle의 값 매핑을 거치지 않아 `package.id`가 문자열로 온다(테스트로 재현). 그대로 쓰면 `minted`의 number 키와 어긋나 finding이 오류 없이 사라진다. `packageIdOf`가 숫자로 바꾸고 2^53 이상이면 트랜잭션을 멈춘다. `package_version.id`와 `repository.id`는 Drizzle의 `mode: 'number'`이므로 같은 상한이 있으나 현재 행 수로는 도달하지 않는다.

**테스트 (`src/ingest/persist.test.ts`).** 압축되지 않는 임의 문자열을 쓴다. `'d'.repeat()`는 압축돼 옛 제약도 통과한다.

| 요청 항목 | Expand | Contract |
|---|---|---|
| 100, 1,000자 | 저장 | 저장 |
| 4,000, 8,000자 | `54000`, 기존 행 유지 | 저장 (`toHaveLength`로 길이 고정) |
| 멀티바이트 8,000바이트 초과 (비압축) | `54000` | 저장, finding 포함, 저장 크기 2,704바이트 초과 단언 |
| 동일 경로 재수집 | 같은 id, 새 version 0 | 같음 |
| 끝 또는 앞만 다른 경로 | 별도 행 | 별도 행 |
| 같은 경로, 다른 타입 | 2개 | 2개 |
| 백슬래시, `\x41` | 별도 행, 값 보존 | 같음 |
| UPSERT 충돌의 모든 갱신 열 | 단언 | 단언 |
| 줄만 다른 finding / 완전 중복 | 2행 / 1행 | 같음 |
| 문자열 id, 2^53-1, 2^53, 2^53+1 | 사용 / 사용 / 중단 / 중단 | 같음 |
| 기존 데이터 호환 | 리허설(§10-5). 기존 행 지문 불변 | 같음 |

**변조 시험.** `src/ingest/persist.ts`를 일부러 망가뜨려 테스트가 잡는지 확인했다(`phase94-verify.txt`). 문자열 id를 그대로 키로 사용, 안전 범위 검사 제거, finding conflict target 삭제 모두 지정한 테스트가 실패했다.

## 7. 보안 취약점 처리

`bun audit` 13건(High 4) → **1건(moderate 1)** (`audit-before.txt`, `audit-after.txt`). Major 변경 없음.

| 패키지 | Advisory | 설치 → 수정 | 경로 | 실제 위험 |
|---|---|---|---|---|
| `js-yaml` | GHSA-2883-xcg3-v3hh, merge key CPU | 4.3.1 → **4.3.2** | 직접, Sync의 frontmatter | **낮음.** 아래 |
| `zod` | GHSA-mrhx-c7xc-m3w5, 과대 배열 메모리 | 4.4.3 → **4.6.7** | 직접. env, seed 목록, registry, 스냅샷, 검색 파라미터 | 낮음~중간. registry는 외부 입력 |
| `source-map-js` | GHSA-68fv-2mgg-jv7q, 이벤트 루프 차단 | 1.2.1 → **1.2.2** | 간접(next, vite의 postcss). override | 낮음. CSS 빌드에만 쓰며 외부 입력 없음 |
| `launch-editor` (vite) | GHSA-587h-7wmj-h5pm 외 | vite 8.2.1 → **8.3.6** | 개발 전용. override | 없음(운영 미포함, Windows 조건) |
| `vitest`, `@vitest/mocker` | moderate 2건 | 4.1.10 → **4.1.12** | 개발 전용 | 없음 |
| `esbuild` | GHSA-67mh-4wv8-2f99, moderate | **보류** | drizzle-kit, 개발 전용 | 없음. 개발 서버를 쓰지 않는다 |

**`js-yaml` 실측 (`audit-yaml.txt`).** 보고된 경로의 실제 위험은 예상보다 작았다. 파서가 merge key를 제외한 `CORE_SCHEMA`를 쓰기 때문이다.

| 입력 | 4.3.1 | 4.3.2 |
|---|---|---|
| `CORE_SCHEMA`, 64KB 상한의 PoC (실제 경로) | 6.1ms | 6.4ms |
| 기본 스키마, 64KB (실제 경로 아님) | 35.6ms | 1.2ms, 거부 |
| 기본 스키마, Advisory n=20000 | 957ms | 3.5ms, 거부 |

업그레이드 후 단위 테스트와 빌드를 모두 다시 돌렸다.

## 8. 테스트 결과

| 항목 | 결과 |
|---|---|
| `check:boundaries` | OK |
| `lint`, E2E 직후 lint | 통과 |
| `typecheck` | 통과 |
| 단위 | **1,630 통과, 2 skip** (pg_trgm fallback, 잘못된 비밀번호 접속. 기존과 동일) |
| E2E | **112 통과, 실패 0** (최종 코드, Chromium + SwiftShader, `final-checks.txt`). 과정의 실패는 §8.1 |
| 빌드 | `VERCEL=1`, standalone 모두 성공 |
| 실제 smoke | 정상 DB PASS, DB 거부 FAIL (올바름) |
| `search:eval` | 기존 기준 통과 |
| 검색창 3개 엔진 | Chromium 156, Firefox 157, WebKit 27.2 각 58조합, **실패 0** |

**새 회귀 테스트:** 3D 기본·요청·GPU·숨김 렌더러·WebGL 없음·Reduced Motion·저장된 선택·데이터 절약·실패·토글 반복·axe, 검색창 위치·키보드·URL 질의·8개 폭·axe, 같은 이름 행, 특수 검색어 11종, 긴 검색어, 긴 경로, 부팅 판정, 늦은 실패, smoke.

**바꾼 기존 테스트와 이유**
- `the dock board` 묶음: 러너에 GPU가 없어 요청 상태(`agentdock:scene=on`)로 실행. 장면 자체를 검증하는 목적은 그대로다.
- `reduced motion` journey: "never loads" → "does not load by itself". 요청 경로가 생겼다.
- `.hero-search button` → `[type="submit"]`: X 버튼이 추가됐다.
- `.row-meta .path mark` → `.row-where .path mark`: 경로 위치가 바뀌었다.
- `redos.test.ts`의 상한 500ms → 2초: CI 실패 원인. 이차 결함(64KB에 5.9초)은 여전히 잡힌다.

**Expand/Contract 전환 후 재실행 (`phase94-verify.txt`).** 전용 컨테이너와 코드 복사본에서 실행했고, 저장소와 `agentdock_test` 지문이 전후 동일했다. 복사본에서만 테스트 가드의 포트를 전용 컨테이너로 바꿨고, 포트를 단언하는 2개 파일은 원본 가드로 따로 돌렸다.

| 항목 | Expand | Contract |
|---|---|---|
| 빌드 `VERCEL=1`, standalone | 통과 | 통과 |
| `check:boundaries`, lint, typecheck | 통과 | 통과 |
| 일회용 DB migration | 12개 적용 | 13개 적용 |
| 단위 (DB 포함) | 1,600 + 가드 37 통과, 2 skip | 1,602 + 가드 37 통과, 2 skip |
| `search:eval` | 54 통과 | 54 통과 |
| E2E (Chromium + SwiftShader) | 112 통과 | 112 통과 |

**actionlint: NOT RUN.** 이 머신에 없고 외부 바이너리 다운로드가 권한 정책으로 거부됐다. Phase 94는 `.github/`를 바꾸지 않았다. 이 절 앞부분의 수치는 전환 전 기록이다.

**NOT RUN:** 실제 Safari, 실기기(폰, 터치), 운영 측정, 실제 스크린리더. 브라우저 확대는 CSS 뷰포트 축소로 모의했다(폭 ÷ 배율).

### 8.1 측정 중 제 실수 (결과 무효 처리 후 재측정)

- `next-server`로 프로세스 이름이 바뀌는 것을 놓쳐 고아 서버가 포트를 잡았다. 삭제된 빌드를 서빙해 JS가 500이 났고, After가 "GPU에서도 그림"으로 나왔다. 오류 수를 보고 알아챘다. **그 수치는 전부 폐기하고 다시 쟀다.**
- 재시작 명령에 넣은 `cat >> /dev/null`이 멈춰 측정이 시작되지 않았고, 옛 로그의 `finished`를 완료로 읽어 다른 측정을 시작했다. 중단 후 합성 데이터를 지우고 다시 돌렸다.
- 합성 데이터를 지우고 `home:snapshot`을 다시 발행하지 않아 E2E 11건이 실패했다. 스냅샷을 다시 발행해 해결했다. Phase 93에서 "낮은 위험"으로 적은 스냅샷 정체가 실제로 일어난 사례다(테스트 DB).
- 처음 구현한 식 인덱스는 Drizzle에서 쓸 수 없다고 판단해 생성 열로 다시 만들었다. 우회가 있었고, 결국 식 인덱스로 돌아왔다.
- 전환 작업 중 `fresh.sh`로 로컬 `agentdock_test`를 `DROP DATABASE ... WITH (FORCE)`로 지우고 `agentdock_app` 역할과 `.drizzle-test`도 지웠다. 당시 일회용 DB 변경 허용 범위라 판단했으나, 사용자가 이후 금지했다. 이후 그 DB는 건드리지 않았고 현재 Contract 스키마에 0행이다. 복구는 사용자 지시를 기다린다.
- 롤백 SQL의 첫 판은 `package` 제약 전환을 finding 인덱스 빌드 앞에 두어, 100만 finding에서 읽기를 1,260ms 막았다. "빌드 중 읽기 유지"라는 이전 문구는 틀렸다. 측정으로 발견해 순서를 바꿨고 1ms가 됐다.
- 0011의 첫 판은 finding → package 순서로, Sync와 교착할 수 있었다. 리뷰에서 지적받아 package 먼저로 고치고 교착 시험을 추가했다.
- 테스트의 `noise`가 지정 길이를 만들지 못해 "8,000자"가 실제 7,408자였다. 리뷰에서 지적받아 고치고 길이를 단언했다.
- 처음 고른 E2E fixture의 skill은 `duplicate`로 이미 숨겨져 있었다.

## 9. 코드 리뷰 결과

PR Review Toolkit `code-reviewer`, `silent-failure-hunter`, `pr-test-analyzer`를 제 결론 없이 실행했다. **CodeWatcher: NOT RUN (이 환경에 없음).**

**고친 것**

| 심각도 | 내용 | 조치 |
|---|---|---|
| CRITICAL (기존 결함) | smoke가 `/artifacts*`의 DB 장애를 ok로 통과. `loading.tsx`로 항상 200이고 오류 문구도 HTML에 없다 | 결과 수 또는 no-match 표시를 요구. 실측: DB 거부 시 8개 경로 FAIL |
| IMPORTANT | 잘못된 env가 unhandled rejection이 되어 프로세스가 살아남음 | 부팅 검사 전체를 try 안으로, exit 1 |
| IMPORTANT | 연결 실패 시 격리 검사가 다시 돌지 않음 | 30초 간격 10회 재시도. `ponytail:` 주석에 한계 명시 |
| IMPORTANT | 28P01, 3D000, 42xxx가 "DB down"으로 뭉개짐 | 응답이 "설정이 틀림"이면 exit 1 |
| IMPORTANT | 늦은 실패의 원인 코드 소실, info 레벨 | `code` 필드 추가, `console.error` |
| IMPORTANT | 장면 실패 시 입력 중인 포커스를 빼앗음 | 포커스가 버튼에 있을 때만 이동 |
| 테스트 | `0011` 생성식을 아무도 비교하지 않음 | `migrations.test.ts` 확장 |
| 테스트 | 저장된 선택 + Reduced Motion, 데이터 절약, 렌더러 표, 13.7초 도착 없음 | 추가 |
| MINOR | 안내문이 관찰 못 한 사실을 단정("Nothing is missing…") | 문장 삭제 |
| MINOR | 저장소 차단 시 선택이 사라짐, 3D 실패 무안내, 같은 경로에 "separate file" | 수정 |
| 문서 | `DEPLOY.md`, `VERCEL_DEPLOY.md`의 "refuses to boot" | 수정 |

리뷰가 삭제를 권한 Escape 핸들러는 지웠다가, WebKit에서 입력이 지워지지 않는 것을 측정하고 복구했다.

**Expand/Contract 전환 리뷰.** `code-reviewer`, `pr-test-analyzer`(코드), `code-reviewer`, `silent-failure-hunter`(리허설 스크립트). CRITICAL은 스크립트의 race 결과 미검사 1건이고 고쳤다.

| 심각도 | 내용 | 조치 |
|---|---|---|
| IMPORTANT | 0011 순서가 Sync 잠금 순서와 반대라 교착 가능 | package 먼저, 교착 시험 추가 |
| IMPORTANT | `noise` 길이 오류 | 수정, 길이 단언 |
| IMPORTANT | target 없는 DO NOTHING이 PK 충돌과 인덱스 변경을 숨김 | `findingIdentity` target 명시 |
| IMPORTANT | 줄만 다른 finding, conflict 분기의 열 미검증 | 테스트 추가 |
| MINOR | 0012 순서, 주석 사유, 롤백 문서, 저장 크기 단언 | 수정 |
| MINOR | package 외 id의 2^53 상한 | 기록만 (§6) |
| 스크립트 | 지문 약함, Contract 원자성 미검증, 로그 소실, 표본 없음 통과 | 수정 |

**수정 후 재리뷰는 하지 않았다.** 수정은 위 테스트, 변조 시험, 리허설 재실행으로 확인했다.

**남긴 것:** §13.

## 10. 배포 시 필요한 migration

전체 로그: `phase94-artifacts/migration-rehearsal.txt`, 재현: `migration-rehearsal.sh --plan`, `--execute`. 일회용 전용 컨테이너(PostgreSQL 17, tmpfs, CPU 2)에서 실제 `scripts/migrate.mjs`, 앱 역할 `agentdock_app`, 각 코드 판의 실제 `persistScan`으로 실행했다. 운영에는 접속하지 않았다.

### 10-1. 설계

| 단계 | 내용 | 게이트 | 푸는 것 |
|---|---|---|---|
| Expand `drizzle/0011_path_digest_identity.sql` | digest 인덱스 2개 추가. package 먼저 | **자동 적용** (allowlist) | 없음. 54000은 남는다 |
| Code | package upsert와 finding insert가 digest target 사용 | - | 없음 |
| Contract `contract-0012.patch` → `drizzle/0012_path_digest_contract.sql` | 옛 제약 2개 삭제. 대기 상한 2초. package 먼저 | **사람의 승인 필요** | 긴 경로 저장 |

**0012가 작업 트리에 없는 이유.** 0011과 0012가 함께 pending이면 Deploy가 `NEEDS_APPROVAL`로 멈춘다. 0011만 승인해도 아무것도 적용되지 않는다(실행). 그동안 모든 Sync도 실패한다. 그래서 Expand를 먼저 배포해 검증한 뒤 패치를 적용한다. `schema.ts`, 테스트, snapshot은 커밋마다 한 상태만 가질 수 있으므로 패치로 묶었다.

### 10-2. 실제 호환성 매트릭스

| 코드 ＼ 스키마 | 구 스키마 (0010) | Expand (0011) | Contract (0012) | 제약 복원 |
|---|---|---|---|---|
| 구 코드 `c1d4e7b` | 정상, 긴 경로 `54000` | **정상**, `54000` | 쓰기 `42P10`, 행 변화 없음 | 정상 (실행은 복귀 코드) |
| 구 코드 복귀 (코드만 revert, migration 유지) | - | **정상**, 게이트 통과, CI 묶음 통과 | `42P10` | 런타임 정상. CI는 통과 불가(§12) |
| 신 코드 Expand | `42P10`, 행 변화 없음. **Sync는 게이트가 먼저 막음** | **정상**, `54000` | - | - |
| 신 코드 Contract | - | - | **정상, 4,000자 저장** | 정상, `54000` |
| 웹 읽기 (목록, 검색, 상세) | 모든 칸 정상 | 모든 칸 정상 | 모든 칸 정상 | 모든 칸 정상 |

열을 추가하거나 지우지 않으므로 웹 읽기는 구조상 영향이 없다.

**게이트 (`migrate.mjs` 실행 결과)**

| 상황 | 결과 |
|---|---|
| 구 스키마에서 신 코드 Sync `--require-current` | exit 1, 쓰기 없음 |
| Expand 후 구 checkout 배포 | `BLOCKED`, exit 1 |
| Contract 커밋 후 승인 전 | `NEEDS_APPROVAL`, exit 2. 그동안 Sync는 쓰기 없이 실패 |

**동시성.** 같은 저장소의 동시 쓰기 40건이 구 스키마, Expand, Contract 모두 `{"ok":40}`, 20행이었다. `persistScan`의 첫 문장인 repository upsert가 행을 잠가 직렬화되기 때문으로 본다. 이전 보고의 "Expand 중 `23505` 가능성"은 이 경로에서 재현되지 않았다.

### 10-3. 적용 시간과 잠금 (실행)

합성 패키지 61,912행, version 75,802행. 표본은 읽기 20ms, 쓰기 100ms, 잠금 5ms 간격이고, 서버 로그의 문장 시간이다. 쓰기 표본은 두 테이블을 모두 갱신한다.

| 단계 | finding 20만 | finding 100만 | 잠금 | 읽기 최대 | 쓰기 최대 |
|---|---|---|---|---|---|
| Expand: package 인덱스 | 43ms | 41ms | package `SHARE` commit까지 | 1ms | - |
| Expand: finding 인덱스 | 145ms | 1,272ms | finding `SHARE` commit까지 | 1ms | 99ms / 1,309ms |
| Contract: DROP 2개 | 0.5ms | 0.4ms | 두 테이블 `ACCESS EXCLUSIVE` commit까지 | 1ms | 1ms |
| Contract: 첫 문장이 6초 읽기 트랜잭션에 막힘 | 2초에 `55P03` | 같음 | 대기만 | **약 2,000ms** | 약 1,900ms |
| Contract: 둘째 문장이 막힘 (최악) | 2초에 `55P03`, 첫 문장도 롤백 | 같음 | package를 쥔 채 대기 | **약 2,000ms** | 약 1,950ms |
| 롤백 SQL | 155ms | 1,313ms | 인덱스 `SHARE`, 제약 전환 `ACCESS EXCLUSIVE` 수 ms | 1ms | 116ms / 1,214ms |

**상세 조회.** 5,000행 저장소에서 구 스키마 0.7~1.3ms, Contract 후 2.4~5.2ms다. Contract 후에는 digest 인덱스로 `repository_id`를 찾고 경로는 필터로 거른다(저장소 안 행 수에 비례).

### 10-4. 운영 규모 추정 (추정, 운영 미접속)

운영 패키지 56,671행은 측정치, finding 수는 미확인이다. 로컬 대비 약 8배(Phase 66의 추정)를 쓴다.

| 항목 | 추정 |
|---|---|
| Expand | package 약 0.3초. finding은 100만 행당 약 10초 |
| Expand 중 읽기 | **멈추지 않는다** (`SHARE`는 `ACCESS SHARE`와 호환). 수치가 틀려도 같다 |
| Expand 중 쓰기 | 빌드 시간만큼 대기. Sync 창을 피하면 대상이 없다 |
| Contract | 왕복 시간 + 수 ms. 다른 트랜잭션에 막히면 최대 약 2초 후 실패, 재시도 |
| 비교: 폐기한 생성 열 | 약 30초 이상 페이지 정지 |

finding 수는 Deploy 전에 읽기 전용으로 확인하면 추정이 정확해진다(`select count(*) from agentdock.capability_finding`, 사람이 실행).

### 10-5. 리허설 결과

| 단계 | 결과 |
|---|---|
| 구 스키마 + 시드(240행, finding 240) | 지문 기록. **이후 모든 단계에서 불변** |
| Expand 실패 A: 잠금 20초 | 15,091ms에 `55P03`, 전부 롤백, 재시도 가능 |
| Expand 실패 B: 둘째 문장 실패 | `42P07`, 첫 인덱스도 롤백 |
| Sync처럼 package → finding 쓰는 트랜잭션 중 Expand | 둘 다 성공, 교착 없음 |
| 신 코드, 구 코드, 복귀 코드 | §10-2 |
| Contract 승인 없음 | exit 2, 변화 없음 |
| Contract 실패: 둘째 문장 대기 | 약 2초에 `55P03`, 첫 DROP도 롤백 |
| Contract 재시도 | 성공 |
| 롤백: 긴 경로 저장 상태 | `54000`, 변화 없음 |
| 롤백: 긴 경로 제거 후 | 성공, 신 코드와 복귀 코드 모두 동작 |
| 재Contract (손으로 DROP) | 신 코드 정상, 긴 경로 저장 |

### 10-6. 운영 배포 순서

| # | 작업 | 승인 | 확인 | 실패 시 |
|---|---|---|---|---|
| 1 | 진행 중 Sync 0건, 최근 시작 약 13:10~13:40, 22:40~23:00 UTC를 피함 | - | `gh run list --workflow=Sync --status in_progress` | 다음 창까지 대기 |
| 2 | 로컬 `develop` 전진 후 커밋 3개로 분리(§10-7), push | **사용자** | CI green | 커밋 전이면 영향 없음 |
| 3 | CI 후 Deploy가 **0011을 자동 적용**, Vercel, smoke | 사람 없음 | Deploy 로그, `x-agentdock-commit` | 트랜잭션 롤백, 웹은 구 버전. **Deploy를 다시 실행할 때까지 Sync가 실패한다** |
| 4 | 다음 Sync 1회 이상 `COMPLETED`, 54000 외 `storage_failed` 0 | - | Sync 요약. 긴 경로 실패는 이 단계에서 정상 | §12 |
| 5 | §10-8의 Contract 조건 확인, DB 백업 | **사용자** | | |
| 6 | `git apply docs/analysis/phase94-artifacts/contract-0012.patch`, 검사, 커밋, push | **사용자** | CI green | 커밋 revert |
| 7 | Deploy가 `NEEDS_APPROVAL`로 멈춤(정상) → 수동 실행 | **사용자** | `gh workflow run deploy.yml --ref develop -f approve_migrations=0012_path_digest_contract` | `55P03`이면 같은 명령 재실행. 대기 중 Sync는 쓰기 없이 실패하므로 바로 진행 |
| 8 | 다음 Sync `COMPLETED`, 긴 경로 저장 가능 | - | Sync 요약 | §12 |
| 9 | rosetta 재수집은 별도 승인 (§11) | **사용자** | | |

### 10-7. 커밋 분리

구 코드 복귀가 커밋 하나의 revert로 끝나도록 나눈다. ①만 있는 상태의 구 persist 조합으로 typecheck와 단위 1,583건 통과를 확인했다.

실제 커밋은 `git log`가 기준이다. migration과 persist 커밋을 나눈 위 이유는 그대로이고, 나머지는 의존성, 검색, 홈·부팅, 장면, E2E, 문서로 나누었다.

**1차 커밋에서 제외한 파일:** `docs/analysis/phase94-artifacts/contract-0012.patch`, `rollback-0012.sql`. Contract는 별도 승인이라 작업 트리에만 둔다(추적 안 됨). 2차 전까지 이 저장소에서 `git add -A`를 쓰지 않는다. 지우면 §10-6의 6단계를 할 수 없다.

### 10-8. Contract 적용 조건

모두 만족해야 한다.

1. 0011이 운영에 적용되었고 `--require-current` 통과.
2. 신 코드 Sync가 1회 이상 `COMPLETED`.
3. 진행 중 Sync 0건. 구 코드 Sync가 도는 동안 적용하면 남은 저장소가 `42P10`.
4. 백업 완료.
5. Docker cron 경로를 쓰는 호스트가 있다면 sync 이미지를 먼저 새로 빌드. `corpus-sync.mjs` 자체에는 `--require-current` 검사가 없다(현재 운영은 GitHub Actions라 해당 없음, 미검증).

### 10-9. 배포 전 최종 리뷰에서 기록만 한 항목 (MINOR, 2026-11-06)

MAJOR 이상은 없다. 아래는 고치지 않고 배포했다.

1. **Docker 경로에 스키마 게이트가 없다.** `corpus-sync.mjs`, `analyze:backfill`, compose의 `sync`는 `--require-current`를 거치지 않는다. `DEPLOY.md`는 `agentdock`만 다시 빌드하라고 안내하는데 `migrate`와 `sync`는 tools 이미지를 함께 쓰므로, 그 절차로는 0011이 적용되지 않는다. tools 이미지만 새로 빌드한 호스트에서는 패키지가 있는 저장소마다 `42P10`이 나고, 3회 재시도 뒤 job이 terminal이 된다. 롤백되므로 행은 손상되지 않는다. 운영은 Vercel + `sync.yml`이라 해당 없다. Docker 호스트의 부재 자체는 확인할 방법이 없어 미검증이다.
2. **`release.mjs` smoke의 빈틈 2개.** `/artifacts?q=mcp`가 `No artifacts matched`도 통과시키므로 오류 없이 0건을 내는 검색 회귀를 잡지 못한다. 트라이그램 fallback 분기에는 두 표식이 모두 없어 작은 코퍼스에서는 건강한 사이트가 실패할 수 있다. 현재 규모의 `mcp`는 목록 분기로 간다.
3. **산출물의 호스트와 개인 경로.** 운영 공개 도메인과 로컬 경로가 산출물에 있다. `phase91`, `phase93` 추적 파일과 같은 형태이고 비밀값은 없다.
4. **`0011`의 인덱스 항목이 옛 제약보다 약간 커질 수 있다.** 한계 근처의 cap 이전 finding 행이 있으면 `54000`으로 실패하고 전체 롤백된다. 현재 cap은 500자다.

## 11. 운영 검증 계획

**Phase 93 (`x-agentdock-commit` 확인 후)**

| 항목 | 방법 | 기준 |
|---|---|---|
| Warm TTFB | `prod-baseline.sh`, n=10 | Before 2,298ms, 목표 800ms 이하 |
| Idle 후 TTFB | 8.5분 대기 | Before 4,118~8,398ms, 목표 2.5초 이하 |
| LCP | `phase91-artifacts/lcp.cjs` | Before 2,796ms |
| 스냅샷 적용 | 첫 Sync 전후를 나눠 측정 | 전: live 경로 |
| 정확성 | 칩 합계와 `/artifacts` 총수 | 일치 |
| 마지막 Sync | 홈 `last sync without errors`, `Status` | Sync가 `home-snapshot` 발행 |

Neon 풀러에서 repeatable read 동작은 첫 Sync가 첫 검증이다.

**Phase 94**

| 항목 | 방법 |
|---|---|
| 3D | 실제 GPU에서 자동 시작, 소프트웨어(`--use-angle=swiftshader`)에서 chunk 0 |
| 검색창 | 운영 `/`, `/artifacts`에서 `search-field-check.cjs` (GET만) |
| `ponytail` | 22행 유지, 순위 비교 (`ponytail-rows.json`) |
| 0011, 0012 | §10-6의 확인 항목 |
| 부팅 | Vercel 로그의 `boot:`, 새 인스턴스 첫 바이트 |
| 실기기 | Safari, 실제 폰 터치 |

**rosetta 재수집 (실행하지 않음, 절차만).** 0011과 무관하게 Phase 92 코드로 가능하다. 종료된 job의 seed는 다시 제안되지 않고 저장 실패로 refresh 대상도 아니어서, 자동으로 다시 수집되지 않는다. 그래서 운영자가 해당 저장소의 `ingest_job`을 다시 넣고 다음 Sync가 처리하게 해야 한다. 쓰기 작업이라 별도 승인이 필요하다. 운영 목록이 최대 605건 늘어난다(Phase 92 측정). 확인: `/r/griddynamics/rosetta` 200, `storage_failed` 0.

## 12. 롤백 계획

| 상황 | 방법 | 검증 |
|---|---|---|
| Expand 적용 실패 | 트랜잭션 전체 롤백. 원인 해소 후 Deploy 재실행 | 실행 |
| Expand 후 신 코드 문제 | 커밋 ②만 `git revert`. **0011 파일, journal, snapshot, `schema.ts`, DB 인덱스는 둔다.** 게이트 통과, 구 코드 정상 | 실행 |
| Contract 적용 실패 | 트랜잭션 전체 롤백. 같은 승인 값으로 재실행 | 실행 |
| Contract 후 신 코드 문제 | **앞으로 고친다.** 구 코드로 돌아가지 않는다. 0012가 있으면 `schema.ts`와 어긋나 revert 커밋이 CI를 통과하지 못하고, Deploy는 CI 성공을 요구한다 | 소스 |
| Contract 후 제약 복원이 꼭 필요 | `phase94-artifacts/rollback-0012.sql`을 사람이 실행. 코드와 0012 기록은 그대로 둔다. 인덱스를 먼저 만들어 읽기 지연 1ms | 실행 |
| 복원 후 구 코드까지 복귀 | 런타임은 동작한다(실행). 다만 CI를 통과하려면 제약을 복원하는 새 migration과 `schema.ts` 변경이 필요하다. 그 절차는 미작성 | 런타임만 실행 |
| 긴 경로 저장 후 복원 | `54000`으로 실패, 변화 없음. 행 삭제는 사람의 결정이다 | 실행 |
| 절대 하지 않음 | digest 인덱스 삭제(신 코드 전부 `42P10`), history 행 삭제, 구 커밋 배포(`BLOCKED`), 복원 전 코드 revert(`42P10`) | 실행 |
| 의존성, 3D 정책 | revert. 3D는 사용자별 `agentdock:scene` 삭제 | - |

`rollback-0011.sql`은 폐기한 생성 열용이다. 쓰지 않는다. 스냅샷 긴급 대응은 Phase 93 §12와 같다.

## 13. 남은 위험

| 위험 | 수준 | 내용 |
|---|---|---|
| 운영 미검증 | 높음 | Phase 93의 첫 Sync 후 스냅샷과 Phase 94의 운영 동작 모두 미확인 |
| CI 시간 테스트 | 중간 | `WALL_CLOCK_BOUND_MS=500`을 쓰는 다른 테스트도 같은 이유로 실패할 수 있다 |
| Vercel의 비차단 부팅 | 중간 | 요청에 묶이지 않은 프로미스가 인스턴스 동결 때 끝나는지, `process.exit`가 어떻게 보이는지 미확인. 잘못된 연결로 잠시 페이지가 응답할 수 있다(스키마 한정 쿼리라 다른 스키마는 못 읽음) |
| 늦은 실패의 200 | 중간 | 상태 코드만 보는 모니터는 놓친다. 외부 모니터를 두면 `chip-count">\d`를 봐야 한다. 평시 모니터는 현재 없다 |
| 54000이 Contract까지 남음 | 중간 | Expand와 Contract 사이에 긴 경로 저장소는 계속 `storage_failed`다. 현재와 같은 상태이지 악화는 아니다 |
| 0011 자동 적용 | 낮음 | 사람 없이 적용된다. 읽기는 멈추지 않으나 실패하면 재실행 전까지 Sync가 멈춘다 |
| Contract 대기 | 낮음 | 긴 읽기 트랜잭션 뒤에 줄 서면 페이지 읽기가 최대 약 2초 대기 |
| Contract 후 상세 조회 | 낮음 | 저장소 안 행 수에 비례. 5,000행에서 2~5ms |
| 패치 노후화 | 낮음 | `contract-0012.patch`는 CI 대상이 아니다. Expand 뒤 코드가 바뀌면 적용 전에 재검증한다 |
| Neon 실측 없음 | 중간 | 적용 시간은 로컬 측정과 추정이다. 잠금 동작은 PostgreSQL 규칙이라 같다고 본다 |
| Firefox, WebKit의 소프트웨어 렌더링 | 낮음 | 판별 불가. chunk를 받고 약 10초 뒤 복귀(15fps 미만일 때만). 방문마다 반복. 36fps인 경우는 그대로 돈다 |
| Reduced Motion + 3D 요청 | 낮음 | Pause여도 칩 hover의 카메라 이동은 남는다. 요청한 사람에 한함 |
| 긴 경로 URL | 낮음 | 로컬 10.8KB까지 200. Vercel의 URL 한도는 미확인. 더 긴 경로는 상세 링크가 실패할 수 있다. 목록과 저장은 정상 |
| 실패 시 `IndexFlow`, 칩 | 낮음 | 카운트 없이 남는다(가짜 수치는 아님) |
| `/artifacts`의 JS 끔 skeleton | 기존 | B-02 그대로 |

## 14. 추후 개선 사항

- 렌더러를 숨기는 브라우저의 느림 판정을 다음 방문으로 잇기.
- 시간 상한 테스트 재검토.
- `@playwright/test`의 WebKit 프로젝트를 CI에 넣을지 판단. 현재 3개 엔진 검사는 수동 스크립트다.
- refresh `not-reached` 1,309 추세 확인.
- Sync 예약 지연(5~7시간) 원인 확인.
- 3D 실패 시 저장된 `on` 처리.

---

# 검색 UI 및 검색 품질 (14장 요구사항)

**스크린샷 2장은 전달받지 못했다.** 운영에서 같은 화면을 재현해 분석했다(`before-search-*.png`, `before-results-*.png`).

## 14-1. 검색창 X 버튼

| | Before | After |
|---|---|---|
| 정체 | 브라우저 기본 cancel 버튼 | `<button aria-label="Clear search">` |
| 위치 (1280) | 오른쪽 끝에서 약 120px 안쪽 | 입력창 오른쪽 끝 |
| 키보드 | 닿지 않음 | Tab, Enter |
| Firefox | 없음 | 있음 |
| 지운 뒤 포커스 | 브라우저별 | 입력창 |

`before-search-1280.png`와 `after-search-1280.png`를 비교하면 된다.

**화면 크기별 검증 (`search-field-check.json`).** 390, 640, 768, 1024, 1280, 1440, 1920, 2560 × 100, 125, 150, 200%(뷰포트 320px 미만 제외), `/`와 `/artifacts`, 엔진당 58조합. **174건 실패 0.**

확인 항목: 빈 값에서 숨김, 내부 오른쪽 끝, 입력창 크기 불변, 긴 텍스트 여백, hover·focus·blur에서 위치 고정, 단축키 표시 숨김, 지우기, 포커스 유지, 다시 숨김, Escape, 가로 넘침 0.

## 14-2, 14-3. `ponytail` 결과의 실제 중복 여부

**결론: 실제 중복 0건, 인덱싱 오류 0건.** 운영 HTML의 22행을 각 행의 커밋 기준으로 GitHub blob과 대조했다(`ponytail-rows.json`).

- 식별 키(저장소, 타입, 경로) 중복 0.
- 내용이 바이트까지 같은 행 0.
- 운영 DB는 접속하지 않았다. 권한을 안전하게 확보하지 않았기 때문이다. artifact id, 내용 해시, 인덱싱 시각, capabilities는 미확인이며 blob SHA로 대신했다.

| 유형 | 건수 | 예시 | 원인 | 방침 |
|---|---|---|---|---|
| A 실제 중복 | 0 | | `UNIQUE`가 구조적으로 막는다 | 해당 없음 |
| B 같은 저장소의 별도 artifact | 다수 | `skills/ponytail/SKILL.md` (blob `d64edd3`, 3,496B), `.openclaw/skills/ponytail/SKILL.md` (`df5996b`, 3,267B) | 다른 도구용으로 내용을 약간 바꾼 별도 파일. `ponytail-gain`, `-help`, `-audit`, `-debt`, `-review`도 같은 쌍 | 보존, 경로 표시 |
| C 동일 콘텐츠 복제 | 표시 0 | 로컬: `anthropics/claude-code`와 `anthropics/skills`의 `frontend-design` skill은 내용 해시가 같고 목록에 한 행만 나온다 | `NOT_LISTED_BECAUSE`의 `duplicate`가 이미 숨긴다 | 기존 규칙 유지 |
| D 이름만 동일 | 2 | `shobcoder/shob`(5,199B), `cheaper-inference/OmniRoute`(7,421B)의 `ponytail` | 다른 저장소의 다른 파일(원본에서 파생한 것으로 보임) | 보존 |
| E Plugin과 하위 항목 | 있음 | `.claude-plugin/plugin.json`의 Plugin. 로컬 fixture: `feature-dev`의 plugin과 command | 패키지와 내용물이 각각 색인 대상 | 보존, 포함 관계 표시 |
| F 인덱싱 오류 | 0 | | | 해당 없음 |

행 3의 커밋(`96608e0`)이 다른 행(`09c434a`)과 다른 것은 정상이다. 내용이 바뀐 파일만 새 version을 만든다.

**삭제 대상 없음.** 데이터는 건드리지 않았다.

## 14-4, 14-6. 처리 정책과 관련성

| 대안 | 판단 |
|---|---|
| 같은 저장소 묶기, 접기 | 안 함. 실제 파일을 한 번 더 눌러야 찾고, 그룹 수와 총수를 나눠 설명해야 한다 |
| 대표 하나만 표시 | 안 함. 어느 쪽이 대표인지 근거가 없다 |
| 다양성 재정렬 | 안 함. 정확히 일치하는 행이나 프로젝트 본 저장소를 임의로 밀어내게 된다 |
| 행 표현 개선 | **적용** |

현재 순서는 합당하다. 정확 일치 5행이 먼저 오고(저장소 이름도 맞는 3행, 다른 저장소 2행), 접두 일치, 설명만 일치(18~22행) 순이다. 10행이 같은 저장소라 다른 저장소의 `ponytail-coding`이 16위인 점은 아쉽지만, 이름 일치보다 위로 올릴 근거가 없다. **이 판단은 측정이 아니라 22행을 읽고 내린 것이다.**

## 14-5. 결과 표현

`before-results-1280.png`와 `after-results-1280.png`를 비교하면 된다. 로컬 After는 운영 22행 중 3개 저장소의 15행으로 재현했다. 이름 아래 경로, `a separate file from the row above`, `in the plugin at …`을 추가했다. 커밋, 일치 근거, 소스 링크는 그대로다. 폰(`after-results-390.png`)은 설명 다음에 경로를 둔다.

## 14-7. 검색 성능 (합성 45,302행, 폰 390, `search-bench.jsonl`)

| 검색어 | TTFB Before→After | FCP | DOM | 행 | 순위 |
|---|---|---|---|---|---|
| ponytail | 13.9→15.6ms | 44→60ms | 694→720 | 15 | 같음 |
| mcp | 7.4→7.6 | 48→40 | 1,132→1,164 | 25 (933) | 같음 |
| plugin | 6.1→7.3 | 40→36 | 1,037→1,067 | 25 (9,645) | 같음 |
| agent | 8.0→7.2 | 40→40 | 1,082→1,116 | 25 (5,261) | 같음 |
| skill | 6.6→6.8 | 40→36 | 1,260→1,293 | 25 (27,704) | 같음 |
| hooks | 5.7→8.0 | 36→36 | 959→993 | 25 (2,406) | 같음 |
| REVIEW | 6.3→6.3 | 36→36 | 1,057→1,089 | 25 (3,093) | 같음 |

- 17개 검색어 전부 상태 200, 순위 해시 동일, 총수 동일. 한글, 일본어, 따옴표, `a%20b`, 공백, 이모지는 합성 데이터에 일치 행이 없어 0행이다. XSS, SQL 문자열, 200자 검색어도 정상 처리.
- TTFB는 `/artifacts`가 먼저 스트리밍하므로 SQL 시간을 뜻하지 않는다. SQL은 다음 줄로 본다.
- **쿼리 수와 시간 (`search-queries.txt`):** 요청당 9문장으로 동일. 주 문장 약 156ms → 155ms. Before 로그의 앞쪽 10줄은 웜업 요청이 시간 창에 섞인 것이라 제외했다.
- DOM은 행당 약 1.3 노드 증가(경로 줄). FCP 차이는 측정 잡음 범위(ms 단위, n=3)다.

**검색 관련성 Before/After:** SQL은 `parent_path` 한 열만 더 읽는다. 순위식은 바꾸지 않았고 `search:eval`도 통과했다.

## 14-8. E2E와 접근성

§8과 `e2e/journeys.spec.ts`의 `the search field`, `rows of one name`. axe는 버튼 표시 상태와 정적 그림 상태에서 위반 0. 색 대비는 axe 범위에 포함된다. 실제 스크린리더와 터치 기기는 NOT RUN.

## 14-9. 남은 문제

- 운영 DB 필드(내용 해시, capabilities) 미확인.
- 운영 After 스크린샷 없음.
- 다른 저장소의 접두 일치 순위는 그대로다.

## 14-10. 완료 기준 대조

| 조건 | 상태 |
|---|---|
| 저사양 기본 진입 개선 | 충족 (로컬) |
| 실제 GPU 3D 유지 | 충족 (로컬) |
| WebGL 누수 없음 | 충족 (journey). 30회 장기 측정 미실행 |
| 54000 재현 테스트 | 충족 |
| 식별 충돌 없음 | 충족 |
| 취약점 처리 또는 보류 근거 | 충족 |
| 스트리밍 실패 동작 | 충족 |
| 기존 기능 회귀 없음 | 충족 (E2E 112) |
| 전체 테스트 | 충족 |
| 코드 리뷰 | 충족. CodeWatcher 없음 |
| X 버튼, 모바일 검색창 | 충족 |
| 중복 원인 확인, 정상 artifact 보존 | 충족 |
| 실제 중복 원인 수정 | 해당 없음 (0건) |
| 차이 가독성 | 충족 |
| 관련성, 성능 회귀 없음 | 충족 |
| 운영 검증 | **NOT RUN (배포 금지)** |
