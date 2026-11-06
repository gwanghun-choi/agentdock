# AgentDock Phase 91 — 운영 안정화·실사용 성능·브라우저 호환성 종합 검증

조사일: 2026-11-06 (KST). 대상: 운영 `https://agentdock-delta.vercel.app/`, 커밋 `1583f1f`.
이 문서의 모든 수치는 실제로 측정한 값이다. **추정**이라고 쓴 곳만 추론이다. 원자료는 `docs/analysis/phase91-artifacts/`, 화면은 `docs/images/phase91/`에 있다.

## 1. Executive Summary

운영 서비스는 정상 동작한다. 검색, 목록, 상세, 404, 3D, 예약 Sync가 모두 작동했고 확인한 범위에서 오류 로그는 없었다. 다만 해결이 필요한 위험이 두 가지 있다.

1. **홈 LCP는 서버 응답이 거의 전부를 차지한다.** LCP 요소는 항상 `h1`이고, 데스크톱 기준 LCP 3,676ms 중 3,440ms(94%)가 최종 응답 헤더를 기다린 시간이다. 3D, 폰트, JS, CPU 제한은 LCP를 의미 있게 바꾸지 않았다. 홈은 요청마다 전체 행을 계산하는 쿼리 2개가 끝나야 응답을 보내기 때문이다. 목록 행이 하루 약 2,500개씩 늘고 있어 **방치하면 계속 느려진다.**
2. **Next.js 16.3.0에 critical 권고 5건이 있다.** 조건을 대조한 결과 이 앱이 바로 노출되는 항목은 확인되지 않았지만, 패치 버전(≥ 16.4.1)이 나와 있으니 올려야 한다.

**유휴 뒤 첫 방문은 더 느리다.** 8분 유휴 후 첫 응답이 5.4~13.7초였다.

WebGL 누수는 재발하지 않았고, 실제 GPU에서는 60fps를 유지한다. 소프트웨어 렌더러에서는 3D를 실행하되 2코어에서 2.3~5.6fps로 쓸 만하지 않아, 정적 화면을 기본으로 바꾸는 편이 낫다.

## 2. 최종 판정

**WARNING** — 현재 장애는 없지만, 데이터 증가와 함께 나빠지는 성능 병목과 미패치 프레임워크가 있어 후속 작업이 필요하다. 실기기, 실제 Safari, 실제 스크린리더 청취는 하지 않았다.

| 영역 | 판정 | 근거 요약 |
|---|---|---|
| 운영 배포 상태 | PASS | 운영 `x-agentdock-commit` = HEAD = origin/develop = `1583f1f` |
| 운영 LCP | WARNING | 2.4~3.8초, 유휴 후 첫 방문 5.4~13.7초 이상. 서버 응답 대기가 지배적 |
| 3D 실제 GPU | PASS | 60fps, 프레임 p95 16.9ms, 정지 시 draw 0 |
| 저사양 3D | WARNING | SwiftShader 2코어 2.3~5.6fps, 전체 코어 14~16fps |
| WebGL 메모리 | PASS | 30회 반복 후 컨텍스트 1, 렌더러 1, 힙 안정 |
| 브라우저 호환성(엔진) | CONDITIONAL | Chromium, Firefox, WebKit 모두 기능 통과. 실제 Safari는 NOT RUN |
| 모바일 UX | CONDITIONAL | 가로 스크롤·숫자 잘림 0건. 터치 환경의 `Ctrl K` 겹침 결함 1건 |
| 접근성(자동·키보드) | CONDITIONAL | axe 위반 0건, 다만 대비 판정 불가 노드 많음 |
| 실제 스크린리더 | NOT RUN | §11 참고 |
| 운영 API | PASS | 50개 GET 요청 중 5xx 0건, 수치 일치 |
| Vercel 로그 | BLOCKED(일부) | 런타임 로그 최근 30분만 조회 가능, CDN 요청 로그는 플랜 제한 |
| GitHub Actions | CONDITIONAL | 정상. E2E Job 제한 여유가 줄어드는 중 |
| 예약 Sync | CONDITIONAL | 10-29 이후 15회 연속 성공. 시작 지연 2~8시간, 대기열 증가 |
| 보안 | WARNING | 앱 방어는 양호. Next.js 미패치 |

## 3. 조사 환경

| 항목 | 값 |
|---|---|
| OS | Ubuntu 26.04.1 LTS, Linux 7.0.0-42 |
| CPU / 메모리 | Intel Raptor Lake-S 데스크톱, 30GiB |
| GPU | Intel UHD Graphics 770 |
| 실제 GPU 렌더러 | `ANGLE (Intel, Vulkan 1.4.335 (Intel(R) Graphics (RPL-S)), Intel open-source Mesa driver)` |
| 소프트웨어 렌더러 | `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)` |
| Chromium | Playwright headless shell 156.0.8078.4 (대조: Chrome 안정판 156.0.8078.79 headless) |
| Firefox / WebKit | Playwright Firefox 157.0 / Playwright WebKit 27.2 (실제 Safari 아님) |
| 측정 위치 | 한국 가정용 회선. 응답 경로 `icn1::iad1` |
| Viewport | 데스크톱 1920×1080, 모바일 390×844 DPR 3(터치 에뮬레이션), 호환성 1440×900 |
| Network | 기본은 제한 없음. Slow 4G = 1.6Mbps, RTT 150ms(CDP) |
| CPU Throttling | 없음 또는 4배(CDP) |
| Cache | Cold = 매번 새 컨텍스트. Warm = 같은 컨텍스트에서 재방문 |
| 측정 횟수 | LCP는 조건당 5회 중앙값. 다른 항목은 해당 절에 표기 |

**측정 품질에 대해 알아둘 점**

- 첫 LCP 묶음(07:50~08:02)은 제가 실행한 `next build`, 그리고 예약 Sync(07:58~08:24)와 일부 겹쳤다. 그래서 09:09에 데스크톱·모바일 Cold를 다시 쟀다. 두 묶음의 차이는 작았다(데스크톱 3,728 → 3,676ms).
- 제 측정 스크립트에 버그가 두 번 있었다. JS 비활성 조건이 47분간 멈췄고(추적 이벤트 방식으로 교체), 3D 샘플러가 `requestAnimationFrame`을 두 번 호출해 수치가 무효였다(수정 후 재측정). 무효 수치는 이 보고서에 쓰지 않았다.
- 운영 요청은 약 2시간 동안 근사 4,400건이고 정적 자산이 대부분이다. 모두 GET/HEAD다.
- 테스트 DB는 트랜잭션 안에서 합성 행을 넣고 ROLLBACK했다. 행 수(287)와 스키마가 원상태임을 확인했다. 시퀀스 값 증가와 dead tuple은 남는다(기능 영향 없음).
- 이전 보고값(LCP 72ms, 2,692ms, 18.3→18.5MB 등)은 측정 조건이 다르므로 아래 표에 직접 비교값으로 넣지 않았다.

## 4. 운영 배포 상태

| 항목 | 값 |
|---|---|
| HEAD / origin/develop | `1583f1f41643cbbadc2358b4501e7aa1e1d01fb3` |
| 운영 `x-agentdock-commit` | 동일 |
| Vercel Deployment | `dpl_FkNn7DYtKq4mgqZYAMyQQcb2AgEX`, Ready, production |
| Function Region | `iad1` (`x-vercel-id: icn1::iad1::…`, 프로젝트 설정도 iad1) |
| Edge | `icn1` (서울) |
| Neon Region | 미확인. 연결 문자열 열람 금지 조건이라 조회하지 않음 |

## 5. LCP 원인 분석

### 5.1 결론

- **LCP 요소:** 모든 실행에서 `h1` "Find agent artifacts, and see where they came from." (데스크톱 크기 282,406, 모바일 58,080). LCP 후보도 하나뿐이고 FCP와 동시다.
- **3D Canvas는 LCP 후보가 아니다.** Canvas는 LCP 이후에 생긴다.
- **주요 병목은 서버 응답 대기다.** 2,692ms는 이번 측정 범위(2,420~3,840ms) 안에 있고, 이번 UI 변경 때문이라는 근거는 없다. 다만 이전 배포 URL이 SSO로 보호되어 같은 조건 전후 비교는 BLOCKED다.

### 5.2 단계별 시간 (운영, 09:09 재측정, 데스크톱 Cold 5회 중앙값)

| 단계 | 시간 | 설명 |
|---|---|---|
| 103 Early Hints | 21ms | `firstInterimResponseStart` |
| **최종 응답 헤더** | **3,440ms** | `finalResponseHeadersStart`. 실제 TTFB |
| Resource Load Delay | 해당 없음 | LCP 요소가 텍스트 |
| Resource Load Duration | 해당 없음 | 〃 |
| Element Render Delay | 236ms | 헤더 도착부터 첫 페인트까지 |
| **LCP = FCP** | **3,676ms** | |
| 문서 수신 완료 | 3,789ms | HTML gzip 20.8KB, 원본 242KB |
| Hydration | 3,818ms | LCP 142ms 뒤 |
| 3D 첫 프레임 | 4,302ms | LCP 626ms 뒤 |

주의: Chrome의 `responseStart`는 103을 가리켜 약 20ms로 나온다. `responseStart`로 TTFB를 재면 **문제가 없는 것처럼 보인다.**

### 5.3 원인 실험

| 조건 (5회) | LCP 중앙값 | 범위 | 시기 |
|---|---|---|---|
| 데스크톱 Cold | 3,676 | 2,836~3,840 | 재측정 |
| 모바일 Cold | 2,744 | 2,704~3,712 | 재측정 |
| 데스크톱 Warm | 3,504 | 2,736~4,092 | 첫 묶음 |
| 모바일 Warm | 2,636 | 2,400~3,740 | 첫 묶음 |
| 데스크톱 CPU 4배 제한 | 3,700 | 2,480~3,896 | 첫 묶음 |
| 모바일 CPU 4배 제한 | 2,952 | 2,776~3,860 | 첫 묶음 |
| 데스크톱 Slow 4G | 3,300 | 2,736~3,932 | 첫 묶음 |
| 모바일 Slow 4G + CPU 4배 | 3,152 | 3,016~3,312 | 첫 묶음 |
| 3D 없음(Reduced Motion) | 2,972 | 2,596~3,820 | 첫 묶음 |
| 폰트 차단 | 3,796 | 2,936~16,776 | 첫 묶음 |
| Chrome 안정판 | 2,564 | 2,420~3,652 | 첫 묶음 |
| **JS 비활성** | **2,735** | 2,478~3,702 | 추적 이벤트 |

범위가 서로 겹치므로 **조건별 중앙값의 작은 차이에 의미를 두면 안 된다.** 결론은 "어떤 조건도 분포를 바꾸지 못했다"이다. 응답 시간은 약 2.3~2.8초와 3.4~3.8초로 나뉘는 경향이 있고, 그 원인은 찾지 못했다.

| 확인 항목 | 결과 |
|---|---|
| Font Loading | `font-display: swap`, 16ms(3,507→3,523). 차단해도 같은 분포. 원인 아님 |
| CSS Loading | 2ms 안팎, 15.9KB. 원인 아님 |
| JavaScript 실행 | LCP 전 18~19ms, LCP 후 532~584ms(hydration + 3D). JS를 꺼도 LCP 동일. 원인 아님 |
| Hydration | LCP 후에 발생. 원인 아님 |
| 3D Chunk | LCP 후 로드(260KB gzip, 951KB 원본). 원인 아님 |
| Canvas Initialization | LCP 후. 원인 아님 |
| 이미지·Asset | LCP 경로에 이미지 없음 |
| Main Thread Blocking | Long Task 1회, 최대 56ms, LCP 뒤 |
| **Server Rendering** | **주 원인.** 아래 참고 |

### 5.4 왜 서버가 느린가

curl로 경로별 응답을 10회씩 쟀다(09:13, 중앙값).

| 경로 | TTFB | 전체 |
|---|---|---|
| `/` | **2,221ms** | 2,581ms |
| `/artifacts` | 325ms | 2,357ms |
| `/artifacts?lang=any` | 327ms | 1,655ms |
| 정적 CSS | 약 95ms | 약 100ms |

- `/artifacts`는 `loading.tsx`로 먼저 응답을 흘려보내 TTFB가 325ms인데, 전체 시간은 홈과 비슷하다. **느린 부분은 네트워크가 아니라 데이터 조회다.**
- 홈(`src/app/page.tsx:38-42`)은 `listPackages`, `countVisibleByType`, `lastSyncSucceededAt`을 기다린 뒤에야 첫 바이트를 보낸다. 앱 전체 `loading.tsx`는 404 상태 코드를 지키려고 일부러 두지 않았다(`src/app/artifacts/loading.tsx` 주석).
- **`/artifacts`를 대조군으로 쟀더니** FCP는 360ms로 빠르지만 LCP는 2,592ms(`p.row-desc`, 크기 60,828)였다. 스트리밍만으로는 `/artifacts`의 LCP가 해결되지 않는다. 홈은 `h1`이 훨씬 커서 스트리밍 효과가 나타날 수 있다(추정).
- 운영 로그의 검색 이벤트 106건에서 서버 측 `durationMs`는 중앙값 1,842ms, 최대 4,127ms다. DB 시간이 지배적이라는 점과 맞는다.

**쿼리 비용 분해** (로컬 PG17, 합성 45,287행·버전 60,287개, 네트워크 없음, 3회 측정, 운영 절대값이 아님)

| 쿼리 | 실행 시간 |
|---|---|
| `countVisibleByType` 현재 그대로 | 430~440ms |
| 언어 조건 제거 | 328~339ms |
| `NOT_LISTED_BECAUSE` 제거 | 133~135ms |
| 둘 다 제거 | 13ms |
| `listPackages(limit 10)` 현재 그대로 | 452~463ms |
| 후보: 언어를 저장 컬럼으로 | 349~364ms |
| 후보: `updated_at` 부분 인덱스 | 482~496ms. **효과 없음**(플래너가 전체 스캔 후 정렬 유지) |

- **주 비용은 언어 정규식이 아니라 `NOT_LISTED_BECAUSE`다.** 조사 초반에 저는 언어 필터를 의심했는데, 측정 결과 이 가설은 부분적으로만 맞다.
- `language.ts`의 주석은 "약 25k행에서 재검토"라고 적어 두었고, 운영은 이미 46,672행이다. 기존 기록에도 목록 비용이 행 수에 비례한다는 측정이 있다(합성 50k에서 258ms, 2026-10-23).
- 운영의 약 1.9초(TTFB 2.2초 − 함수 shell 0.33초)는 로컬 값의 약 4배다. Neon 컴퓨트 크기와 RTT 차이로 보이지만 **추정**이다. 운영 `EXPLAIN`은 자격증명 열람 금지 조건으로 실행하지 않았다.

**증가 추세**

| 시점 | 목록 행 | 홈 TTFB | 출처 |
|---|---|---|---|
| Phase 60–63 (10-27경) | 약 21k | 1,243ms | 기존 보고서 |
| Phase 66–68 | | 1,083ms | 기존 보고서(네트워크 조건 다름) |
| 11-06 | 46,672 | 2,221ms | 이번 측정 |

10-25의 19,247행에서 11-05의 46,672행으로, 하루 약 2,500행씩 늘었다. 이 비율이면 홈 TTFB는 하루 약 100ms씩 늘어날 수 있다(**추정**, 두 시점으로 그은 직선이며 Neon 플랜 등 다른 요인은 빠져 있다).

### 5.5 유휴 후 Cold Start

8분 유휴 후 첫 요청을 3회 쟀다(curl, 09:35~09:52). 코드 주석상 Neon은 5분 유휴 후 컴퓨트를 멈춘다.

| 회차 | 첫 요청 TTFB | 두 번째 | 세 번째 |
|---|---|---|---|
| 1 | **5,357ms** | 2,668ms | 2,342ms |
| 2 | **5,353ms** | 2,358ms | 2,248ms |
| 3 | **13,686ms** | 2,459ms | 2,276ms |

- 별도로, 47분 유휴 직후 브라우저 첫 방문에서 **LCP 16,776ms**가 한 번 나왔다(폰트 차단 조건의 첫 실행).
- **트래픽이 적은 사이트에서는 이것이 흔한 첫 방문 경험일 수 있다.** 실제 방문 분포는 측정 수단이 없어 모른다.
- Function 기동과 Neon 재개 중 어느 쪽이 큰지는 분리하지 않았다(**추정**: Neon 재개 비중이 큼). 13.7초가 왜 한 번 나왔는지도 모른다.

### 5.6 Production과 Local 차이

| | Local(이전 보고) | 운영 |
|---|---|---|
| DB 규모 | 287행 | 46,672행 (held 56,671) |
| 앱↔DB | loopback | iad1↔Neon (이전 추정 RTT 215ms) |
| 사용자↔앱 | loopback | 한국↔iad1 |
| LCP | 72ms | 2.4~3.8초 |

### 5.7 개선 후보와 수정 예상 파일

평상시 응답은 A안이, 유휴 후 빈 화면은 B안이 해결한다. 둘은 경쟁 관계가 아니며 A안을 먼저 권한다. B안은 JS 없는 방문자의 화면을 먼저 확인해야 한다.

| 안 | 내용 | 효과 | 비용·위험 |
|---|---|---|---|
| **A. Sync 스냅샷(권장)** | Sync 끝에 타입별 수량과 최신 10행을 `schema_meta`에 기록하고 홈은 그 한 행을 읽음. 스키마 변경 없음 | TTFB 약 0.6초 예상(쿼리 1개인 404가 0.6초, 추정), DB 부하 감소, JS 없이도 동작 | 데이터는 Sync에서만 변하므로 의미 변화가 적음. Sync 중 칩 수와 목록 총수가 잠시 어긋날 수 있어 불변식 재검토 필요 |
| B. 홈 Suspense 스트리밍 | 정적 `h1`을 먼저 내보내고 칩·피드를 나중에 | LCP 약 0.4초 예상(추정) | DB 부하는 그대로. JS를 끄면 fallback에 머물 수 있고, 칩 자리 예약 필요 |
| C. 데이터 캐시 | `unstable_cache` 등 TTL 캐시 | 대부분 요청이 빨라짐 | 칩 수가 TTL만큼 뒤처짐. `use cache` 권고가 있어 Next 업그레이드 후 |
| D. Function Region 정렬 | Neon과 같은 리전 확인 | RTT만큼 감소 | 운영자 확인 필요(전부터 PENDING) |

수정 예상 파일: `scripts/corpus-sync.mjs`, `src/db/queries/syncState.ts`, `src/db/queries/packages.ts`, `src/app/page.tsx`.

검증: 같은 스크립트(`phase91-artifacts/lcp.cjs`)로 `finalHead`와 LCP를 전후 비교하고, 칩 합계와 `/artifacts` 총수의 일치를 확인한다.

## 6. 3D 성능

운영 데이터, 1920×1080, Chromium 156.

| 항목 | 실제 GPU | SwiftShader 전체 코어 | SwiftShader 2코어 |
|---|---|---|---|
| FPS: 진입 후 | 60.1 | 16.4 | 5.6 |
| FPS: Hover | 60.4 | 16.6 | 3.4 |
| FPS: 검색 입력 | 60.3 | 14.8 | 2.7 |
| FPS: 칩 이동 | 60.4 | 14.0 | 2.3 |
| 프레임 p50 / p95 | 16.7 / 16.9ms | 60.9 / 66.6ms | 241 / 281ms |
| Draw Calls/프레임 | 97 | 79 | 79 |
| Triangles/프레임 | 63,266 | 44,194 | 44,194 |
| Points/프레임 | 5,691 | 5,691 | 5,691 |
| Pixel Ratio / 버퍼 | 1 / 1920×882 | 0.65 / 1248×573 | 0.65 / 1248×573 |
| 그림자 조명 | 1 | 0 | 0 |
| Main thread 사용(실행 중) | 9.6% | 4.0% | 1.3% |
| 문서 수신→첫 프레임 | 818ms | 1,258ms | 2,953ms |
| 정지 시 draw(5초) | **0** | **0** | 1,264 (16프레임, 아직 정지 전) |

- 소프트웨어 렌더링의 비용은 main thread가 아니라 GPU 프로세스에 잡힌다. 그래서 main thread 수치가 낮다.
- 이전 보고의 2코어 6.4fps는 다른 측정이다. 이번 값은 운영 데이터 기준이고 상호작용 중에는 더 떨어진다.

| 리소스 (실제 GPU) | 값 |
|---|---|
| three.js | r186 |
| `info.memory.geometries` / `textures` | 82 / 6 |
| Programs / Shaders | 24 / 48 |
| 장면 Mesh / Instanced / 인스턴스 합 | 74 / 8 / 276 |
| Materials | 86 (Standard 53, Shader 17, Sprite 7, Basic 7, Line 2) |
| 조명 / Points | 5 / 3 |
| Shader 호출 시간 | link 1.6ms (실제 컴파일은 드라이버 비동기라 전체 비용이 아님) |
| 업로드 추정 | 버퍼 1MB, 텍스처 약 20MB (호출 인자 합계, VRAM 실측 아님) |
| JS Heap | 13.2MB |
| Context Loss | `failed` 상태로 전환, Canvas 제거, SVG 표시, 칩 7개 유지. 정상 |
| Resource Disposal | §8 |
| GPU Usage | **NOT RUN.** `intel_gpu_top`은 root 필요 |

참고: 화면을 벗어난 뒤와 Pause 뒤에도 몇 프레임을 더 그리고 멈춘다(Pause 후 1.5초 지난 3초 구간에 18프레임). 코드상 의도된 감속이다(`DockScene.tsx:1024`). 콘솔에는 `THREE.Clock` 사용 중단 경고가 매번 뜬다.

## 7. 저사양 환경 Fallback 정책

| 질문 | 답 | 근거 |
|---|---|---|
| 1. SwiftShader를 정확히 감지하는가 | **Chromium은 가능.** Firefox(`Intel(R) HD Graphics, or similar`)와 WebKit(`Apple GPU`)은 값을 가려 렌더러 문자열로는 판별 불가 | `DockScene.tsx:104,817-821`, 측정 |
| 2. 소프트웨어에서도 3D를 실행하는가 | **실행한다.** 그림자 끄고 품질만 낮춤 | `DockScene.tsx:813-828` |
| 3. 자동 정적 전환이 가능한 구조인가 | **가능.** `still`, `failed` 상태가 이미 있음 | `DockBoard.tsx:10,105` |
| 4. Fallback에서 검색·카테고리 유지 | **유지.** 칩과 검색은 3D 밖 DOM. 컨텍스트 손실 후에도 칩 7개 | 측정 |
| 5. 3D 재활성 선택권 | 없음. `PAUSE_KEY`와 같은 패턴으로 추가 가능 | `DockBoard.tsx:12,157` |
| 6. 추가 Client JS 없이 가능한가 | 새 컴포넌트·의존성 없이 **기존 컴포넌트 안의 몇 줄**로 가능. CSS만으로는 불가 | 코드 |
| 7. 전환이 레이아웃 이동을 일으키는가 | 진입 시 CLS 0(측정). 그림이 자리를 잡고 Canvas가 위에 겹치며 `.dock-controls`도 `absolute`라 이동이 없을 것으로 봄. **전환 순간의 CLS는 미측정** | `globals.css:908` |

**제안 정책 (구현하지 않음)**

1. `hasWebGL()`(`DockBoard.tsx:28`)에서 렌더러 문자열까지 읽어, 소프트웨어면 chunk를 받기 전에 `still`로 끝낸다. 260KB를 내려받지 않는다.
2. 그림 옆에 "3D로 보기" 버튼을 두고 선택을 저장한다.
3. 렌더러를 가리는 브라우저와 약한 실제 GPU는 기존 시간 기반 품질 단계에 맡기되, 최저 단계에서도 느리면 `failed`처럼 그림으로 돌아가도록 한다.
4. `DockScene.tsx:813-828`은 위 정책이 들어오면 삭제할 수 있다.

**주의:** CI는 GPU 없는 러너에서 3D Journey를 돌린다. 이 정책을 넣으면 그 Journey들은 버튼으로 3D를 켜야 한다. CI 부담이 줄어드는 대신 테스트 수정이 함께 필요하다.

## 8. WebGL 메모리

**결론: 누수는 재발하지 않았다.** GC 후 값이며, 측정 코드는 Locator와 WeakRef만 쓴다.

시나리오(30회, 로컬 production build + 테스트 DB): Home → Pause → Resume → 칩 포커스(패널 열기) → Esc → Artifacts → Detail → Home. 모두 soft navigation이다.

| 반복 | JS Heap | WebGL2 Context | 살아 있는 렌더러 / 생성 누적 | DOM 노드 | 리스너 | Canvas(DOM) |
|---|---|---|---|---|---|---|
| 0 | 11.86MB | 1 | 1 / 1 | 1,442 | 395 | 1 |
| 10 | 16.60MB | 1 | 1 / 11 | 1,375 | 399 | 1 |
| 20 | 16.57MB | 1 | 1 / 21 | 1,375 | 399 | 1 |
| 30 | 16.84MB | 1 | 1 / 31 | 1,375 | 399 | 1 |
| 검색(전체 이동) 3회 후 | 12.60MB | 1 | 1 / 1 | 1,434 | 399 | 1 |

- 첫 10회에서 힙이 4.7MB 늘고 이후 20회는 +0.24MB에 그친다. 첫 증가는 라우터 캐시 등으로 보이며(**추정**), 안정 상태는 평평하다.
- 렌더러를 31개 만들었지만 살아 있는 것은 1개다.
- Detached 노드는 1개(`<canvas 128×128>`)로, 반복 횟수와 무관하게 하나로 보인다. 힙 스냅샷은 마지막 시점 1회만 찍었다.
- `deleteTexture` 호출 없이 생성 수가 누적되는 것은(텍스처 190, 프로그램 624) 컨텍스트 강제 손실로 함께 해제되기 때문이다. 컨텍스트와 렌더러가 1개로 유지되어 뒷받침된다. **GPU 메모리 자체는 측정하지 못했다.**
- 운영 데이터 Home↔Artifacts 10회: 힙 12.33→15.18MB, 컨텍스트 1, 렌더러 1.
- 이전 보고(18.3→18.5MB)와는 시나리오가 달라 직접 비교하지 않는다.

## 9. 브라우저 호환성

운영, 1440×900. **Playwright 엔진 결과이며 실제 제품 브라우저 검증이 아니다.**

| 기능 | Chromium 156 | Firefox 157 | WebKit 27.2 | 실제 Safari |
|---|---|---|---|---|
| Hero | PASS | PASS | PASS | NOT RUN |
| 3D Rendering | live | live | live | NOT RUN |
| 3D Fallback(800px, Reduced Motion) | PASS | PASS | PASS | NOT RUN |
| Category Selection | PASS | PASS | PASS | NOT RUN |
| Search | PASS | PASS | PASS | NOT RUN |
| Filters / Sorting / Pagination | PASS | PASS | PASS | NOT RUN |
| Detail / 커밋 링크 40자 | PASS | PASS | PASS | NOT RUN |
| Sticky Navigation | PASS | PASS | PASS | NOT RUN |
| Scroll-spy | 동작 | **미지원, 표시 없음** | 동작 | NOT RUN |
| 스크롤 후 숨은 콘텐츠 | 없음 | 없음 | 없음 | NOT RUN |
| Reduced Motion | PASS | PASS | PASS | NOT RUN |

| CSS·API | Chromium | Firefox | WebKit |
|---|---|---|---|
| `:has()` | O | O | O |
| `animation-timeline: view()` | O | **X** | O |
| `timeline-scope` | O | **X** | O |
| `transition-behavior: allow-discrete` | O | O | O |
| Container Query, `cqi` | O | O | O |
| `requestIdleCallback` | O | O | **X** (`setTimeout` 200ms로 대체, `DockBoard.tsx:109`) |

**미지원 경로를 소스에서 확인한 결과**

- `animation-timeline`은 `@supports (animation-timeline: view())` 안에 있어(`globals.css:5032`), Firefox는 스크롤 연동 없이 콘텐츠가 그대로 보인다. 실측으로도 확인했다.
- `:has()`로 패널을 보여주는 규칙은 `@supports selector(:has(*))` 안에 있다(`globals.css:3338`).
- 3D 칩 호버의 `.hero:has(...)` 규칙(`globals.css:827`)은 `@supports` 밖이지만, 강조 효과일 뿐 기능에 영향이 없다.

**관찰 사항**

- WebKit: `Fetch API cannot load … due to access control checks` 페이지 오류 12건. 전부 RSC prefetch이고 이동으로 취소된 요청으로 보인다(**추정**). 기능 실패는 없었다.
- Firefox: 콘솔 오류 2건. RSC fetch가 이동으로 중단된 것으로 보이며, 객체로만 찍혀 내용을 확정하지 못했다.
- Firefox·WebKit의 3D FPS는 재지 않았다.
- WebKit은 시스템에 라이브러리가 없어, root 없이 scratchpad에 풀어 실행했다.

## 10. 모바일 UX

운영, 터치 에뮬레이션. **실기기 NOT RUN.**

| 기준 | 360×800 | 390×844 | 768×1024 | 1024×768 |
|---|---|---|---|---|
| 가로 스크롤 | 0 | 0 | 0 | 0 |
| 숫자 이탈 | 0 | 0 | 0 | 0 (아래 설명) |
| 검색 | PASS | PASS | PASS | PASS |
| 3D | still | still | still | live |
| 홈 전체 높이 | 5,632px | 5,577px | 5,253px | 4,470px |
| 24px 미만 대상(홈) | 1 | 1 | 1 | 1 |
| 44px 미만 대상(홈) | 43/52 | 43/52 | 43/52 | 44/53 |
| Browse by Type 높이 | 1,775px | 1,807px | 1,469px | 1,419px |

- 1024px에서 자동 검사가 숫자 이탈 23px를 표시했는데, 카드별 재측정에서 이탈은 없었고 해당 선택자의 오탐으로 판단했다.
- 상세 페이지의 `a.path`와 복사 버튼 겹침도 자동 검사에 잡혔지만, 줄바꿈된 인라인 링크의 박스 때문이며 화면상 겹치지 않는다(`phase91/390-path-copy.png`).
- 24px 미만 대상은 `List every language`(114×16)이고, 상세에 몇 개 더 있다(본문 인라인 링크).

**결함: 터치 환경의 `Ctrl K` 겹침 (A-01)**

터치 + 너비 641px 이상에서 `Ctrl K` 표시가 남고 이를 위한 패딩은 사라진다. `hint-touch-1024.png`에서 placeholder 글자가 표시 뒤로 지나간다. 태블릿에는 키보드가 없을 수 있으니 표시 자체도 불필요하다.

| 너비(터치) | 입력칸 | 글자 끝 | `Ctrl K` 시작 | 겹침 |
|---|---|---|---|---|
| 768, 820, 912 | 529 | 338 | 430 | 없음(표시만 남음) |
| 1024 | 353 | 338 | 254 | **84px** |
| 1180 | 385 | 338 | 286 | **52px** |
| 1366 | 463 | 338 | 364 | 없음(표시만 남음) |

**Browse by Type 390px 판단: 결함 아님**

카드 6개, 각 231~296px, 간격 약 15px이고 빈 공간이나 반복 내용이 없다. 길이는 각 카드의 정보량에서 나온다. 줄이려면 설명을 빼야 하는데, 이는 정보를 줄이는 결정이다. 전체 높이의 32%를 차지하므로, 필요하면 설명 접기나 2열 수량 요약을 후속으로 시도할 수 있다(사용성 데이터 없음, 필수 아님).

## 11. 접근성

| 항목 | 결과 | 근거 |
|---|---|---|
| axe (8개 화면, WCAG 2.0~2.2 AA + best-practice) | 위반 0 | home, reduced, 390, list, 빈 검색, detail, detail 390, 404 |
| Color Contrast | **PARTIAL** | axe 판정 불가 노드: 홈 147~201, 상세 19~21. 그라디언트 위 텍스트라 자동 판단 불가 |
| Keyboard Navigation / Tab Order | PASS | 홈 34회, 목록 30회, 상세 24회 Tab. 순서가 화면과 맞음 |
| Focus Visible | PASS | 걸어 본 요소 모두 2px outline |
| Focus Trap | PASS | 검색 launcher에서 8회 Tab 후 내부 유지, Esc 닫힘 |
| Dock Panel | PASS | 칩 포커스로 열림, Esc로 닫히고 칩으로 복귀 |
| ARIA Label | PASS | 패널 `Hook Configurations in the index`, 이름 없는 링크 0 |
| Semantic Heading | PASS | H1 1개, 건너뜀 0 |
| Link Text | 개선 후보 | `source on GitHub`가 목적지가 다른 링크 10~25개 |
| Reduced Motion | PASS | canvas 0, 실행 중 애니메이션 0, 대용량 chunk 0 |
| Dynamic Announcement | 일부 | 복사 버튼에 `role=status` 있음. **Dock Panel 열림은 알림 없음** |
| 3D Fallback 접근성 | PASS | 장면은 `aria-hidden`, 같은 수치는 칩 텍스트로 제공 |
| Skip Link | 확인 필요 | 첫 Tab에 나타나고 `#main`으로 이동. 포커스는 `BODY`에 남음. 다음 Tab의 위치는 미확인 |
| 터치 대상 | §10 | |

**실제 스크린리더: NOT RUN.** Orca 50.3은 설치되어 있지만 실행하지 않았다. 실행하면 현재 데스크톱 세션의 키보드와 음성을 가져가고, 사람이 듣지 않으면 판정할 수 없기 때문이다. NVDA는 Windows 전용이라 이 환경에 없다. 참고 자료로 접근성 트리를 `phase91-artifacts/aria-home-reduced.yml`에 저장했지만 청취를 대신하지는 않는다.

## 12. 운영 API 및 데이터

요청 50건(GET, 0.4초 간격)과 보조 조회. 5xx 0건.

| 항목 | 값 |
|---|---|
| 목록 총수 (`/artifacts`) | 44,746 (1,790페이지) |
| 전체 언어 (`lang=any`) | 46,672 = 44,746 + 중국어 1,926, **일치** |
| Type | Skills 30,253 / Commands 5,392 / Subagents 5,080 / Plugins 2,972 / MCP 545 / Hooks 504, **합 44,746 일치** |
| 언어 | 중국어 1,926 / 한국어 460 / 일본어 363 |
| 검색 | `code review` 1,827 / `코드 리뷰` 9 / `代码审查` 35 |
| 빈 결과 | `No artifacts matched "zzzzqqqqxxxx"` |
| 최신 인덱싱 | newest read 2026-11-05, last sync 2026-11-05 23:22 UTC (실제 Sync 종료와 일치) |
| 긴 이름·설명 | 4개 해상도에서 이탈 0 |
| 잘못된 입력 | `page=abc`, `page=-1`, `sort=bogus`, `type=bogus`, `lang=xx` → 200, 기본값으로 처리 |
| `page=999999` | 200, **1페이지를 보여 줌** (F-08) |
| 404 | `/r/nobody/nothing`, `/jobs/999999`, `/jobs/abc` 정상 |
| 리다이렉트 | `/skills` → 308 |

## 13. Vercel 운영 상태

| 항목 | 결과 |
|---|---|
| Production Deployment / SHA / Status | **PASS**, §4 |
| 인증 | 기존 CLI 로그인을 읽기 전용으로 사용(`whoami`, `ls`, `inspect`, `project inspect`, `logs`). 토큰 출력 없음 |
| Runtime Logs | **최근 30분만 조회 가능.** 1시간 이상은 `The hobby plan does not retain runtime logs for the requested time range`로 거부 |
| 30분 구간 (08:52~09:22) | 106건, 모두 level `info`, source `function`, `error`·`warning` **0** |
| 5xx / Timeout / CDN 로그 | **BLOCKED.** `CDN request logs require Observability Plus…` 플랜 제한. 우회하지 않음 |
| Function Errors (7일) | **BLOCKED.** 위 보존 기간 제한 |
| 브라우저 측 5xx | 측정 중 0건. **서버 오류 0건을 의미하지 않음** |
| 이전 배포 URL | SSO 보호(302). 우회하지 않음 |

30분 로그에 찍힌 것은 search 이벤트뿐이다. 페이지 응답 코드는 런타임 로그에 없다.

## 14. GitHub Actions CI/CD

| Run | 대상 | 결과 | E2E Job | Playwright 설치 | E2E 실행 |
|---|---|---|---|---|---|
| 40618155165 | `a46298a` | success | 99초 | 13초 | 47초 |
| 42000007187 | `03e01c7` | success | 270초 | 12초 | 219초 |
| 42076948384 | `3427f79` | **failure** | 673초 | 18초 | 600초(회귀) |
| 42082401349 #1 | `65d01d8` | **cancelled** | 902초 | **520초** | 332초(71 통과) |
| 42082401349 #2 | `65d01d8` | success | 399초 | 13초 | 335초 |
| 42088569302 | `1583f1f` | success | 461초 | 11초 | 406초 |

| 항목 | 결과 |
|---|---|
| Deploy 42089814534 | success, 103초. smoke 33초 PASS |
| Deploy Trigger | CI success 후 `workflow_run`. 실패 시 skipped 정상 |
| Job Timeout | e2e 15분 / deploy 25분 / sync 60분 |
| Cache Hit | Playwright 브라우저 캐시 hit(113MB). 520초 때도 hit |
| Retry | CI 1회. 최종 run은 재시도 0, 71 통과 |
| 병렬도 | worker 1 |
| GPU 없는 환경 | 3D Journey가 CI 시간의 대부분으로 보임(§7, 47초→406초) |

**520초 원인:** 브라우저는 캐시에서 복구됐고, `install --with-deps`의 시스템 패키지(apt) 단계가 오래 걸렸다. 평소 11~18초이고 재실행 시 13초여서 **일시적 지연**이다(원인은 러너·미러 측으로 추정).

**위험:** 정상 Job이 461초로 제한의 51%를 쓴다. E2E 실행 시간이 **8일 사이(10-28→11-05) 47초에서 406초로** 늘었다. 이번 같은 설치 지연(+500초)이 또 오면 다시 cancelled될 수 있다.

**개선 후보 (수정하지 않음)**

1. `timeout-minutes`를 25로 올린다. 가장 단순하다.
2. 3D Journey를 별도 Job으로 나누고 일반 E2E는 짧게 유지한다. §7 정책과 잘 맞는다.
3. `--with-deps` 단계에 별도 시간 제한과 재시도를 건다.
4. apt 캐시는 효과 대비 복잡해 권하지 않는다.
5. worker 병렬은 실제 3D Journey가 CPU를 나눠 쓰므로 GPU 없는 2코어 러너에서는 권하지 않는다.
6. 실패 시 trace를 올리는 현재 방식은 유지한다.

그 외 `actions/checkout@v4`의 Node 20 사용 중단 경고가 있다.

## 15. 예약 Sync

설정: `0 6,18 * * *`, 변경 없음. 수동 실행하지 않았다.

| 항목 | 결과 |
|---|---|
| 마지막 성공 | 42125980160, 2026-11-05 22:58~23:24 UTC, COMPLETED |
| 마지막 실패 | 40868968364, 10-29. 검색 토픽 5개 중단(`stopped=failed`), 다음 실행부터 복구 |
| 그 이전 실패 | 10-26 2건: `connected as a role other than "agentdock_app"`, secret 교체로 해결된 건(기존 기록과 일치). 10-20~10-23 4건은 다시 조사하지 않음 |
| 최근 연속 성공 | 10-29 이후 15회 전부 success |
| 실행 시간 | 약 20~26분 (제한 60분) |
| 시작 지연 (전체 35회) | 중앙값 **4.6시간**, 1.9~8.0시간 |
| 실행 간격 | 중앙값 11.6시간, **9.2~16.6시간** (설계 12시간) |
| 중복 실행 | 없음(`concurrency: sync`, 최소 간격 9.2시간) |
| Rate Limit | 최근 표본 7회 deferred 0, `##[error]` 0. core 잔여 약 4,500/5,000 |
| 저장 실패 | **`griddynamics/rosetta` job 5143이 3회 연속 `storage_failed`, 코드 `54000`** (11-03~11-04, 시도당 50~64초). A-02 참고. 다른 표본 7회의 나머지 실패는 `unavailable`, `too_large` 각 1~2건 |

| 추세 (10-25 → 11-05) | 시작 | 최신 |
|---|---|---|
| 목록 행 | 19,247 | 46,672 |
| 보유 행 | 22,560 | 56,671 |
| 대기 seed (`still-pending`) | 15,591 | **27,655** |
| 재확인 못 한 저장소 (`not-reached`) | 282 | **1,309** |
| 재확인 처리량 | 100/회 | 100/회 |

**해석**

- Sync는 정상 동작한다. 다만 **발견 속도가 처리 속도보다 빨라** 대기열이 계속 늘어난다. 상한은 의도된 설계이고 로그에 정직하게 출력된다.
- 재확인 대기 1,309개는 일부 저장소 데이터가 12시간보다 오래됐다는 뜻이다. 데이터 전체가 최신이라고 말할 수 없다.
- 시작 지연은 GitHub 스케줄러 쪽이다(저장소 설정 변경 없음, 지연 원인은 **추정**). `12시간` 가정은 현실에서 9~17시간이다.
- 11-05 13:39 실행의 삭제 227건은 저장소 하나(`nwave-ai/nwave`)의 `removed` 값이다. 상류 변경으로 보이지만 내용을 확인하지는 않았다(**추정**).

## 16. 보안 점검

| 항목 | 결과 | 위험도 |
|---|---|---|
| CSP | nonce + `strict-dynamic`, `object-src 'none'`, `frame-ancestors 'none'` | 양호 |
| HSTS / nosniff / Referrer / Permissions | 모두 있음 | 양호 |
| `style-src 'unsafe-inline'` | 사유가 코드에 기록됨(`src/proxy.ts`) | 낮음 |
| `x-powered-by: Next.js` | 노출 | 낮음 |
| Source Map | `.map` 11개 모두 403, `sourceMappingURL` 없음 | 양호 |
| 환경변수·비밀 노출 | 번들과 HTML에서 DB URL·토큰 패턴 0건 | 양호 |
| `/.env`, `/.git/config`, `/package.json` | 404 | 양호 |
| 공개 API | `/api/*` 404, server function 없음 | 양호 |
| XSS (`<script>`, `<img onerror>`, `<svg onload>`) | HTML에 그대로 나오지 않음, 이스케이프 확인 | 양호 |
| SQL 입력 (`'; select pg_sleep(5)--`) | 200, 전체 1.6초로 지연 없음 | 양호 |
| 5,000자 검색어 | 200 | 양호 |
| Null byte, 경로 탐색 | 400 | 양호 |
| `/_next/image` | 시험한 두 URL 400 | 아래 |
| GitHub URL | 40자 SHA 고정 | 양호 |
| `/jobs/1` | 200, 저장소·커밋·수량 공개. 민감 정보 없음, ID 순차 조회 가능 | 낮음 |
| Vercel 로그의 검색어 | 사용자 검색어 원문이 로그에 남음 | 낮음 |

**의존성 감사 (`bun audit`, 28건: critical 5, high 8, moderate 13, low 2)**

| 패키지 | 등급 | 이 앱에 적용되는가 |
|---|---|---|
| `next@16.3.0` RCE: Image Optimization, SVG (GHSA-2464-fhr4-w9xw) | critical | 코드에 `next/image` 없음, `public/` 없음, `remotePatterns` 없음. 엔드포인트는 존재(400 응답). Vercel에서의 실제 처리 경로와 Docker 경로는 **미검증** |
| `next` RCE: Image Optimization, AVIF (GHSA-2xp9-vwfh-vxw4) | critical | 〃 |
| `next` RCE: `next/og` (GHSA-vcvr-r3jv-pc5j) | critical | `next/og` 사용 없음 |
| `next` RCE: `use cache` (GHSA-673q-mjm6-r5xr) | critical | `use cache` 사용 없음. **§5.7 C안을 쓰려면 먼저 업그레이드** |
| `next` RCE: Windows (GHSA-p293-qw3h-jr36) | critical | Windows 호스팅 아님 |
| `next` DoS: Server Actions | high | Server Action 없음 |
| `next` SSRF: Image | high | `remotePatterns` 없음, 권고상 비해당 |
| `sharp@0.35.3` | high 2 | Next 이미지 경로에 묶임. 상기와 동일 |
| `js-yaml@4.3.1` | high | Sync가 신뢰 불가 frontmatter를 파싱하지만 `CORE_SCHEMA`는 merge 타입을 쓰지 않음(`default.js`만 포함). 영향 낮음(**추정**, 재현 안 함) |
| `zod@4.4.3` | high | 큰 입력 검증 시 메모리. 영향 낮음(**추정**) |
| vite, vitest, esbuild, source-map-js | 혼합 | 개발 도구 또는 빌드 시점 |

**결론:** 즉시 악용 경로는 찾지 못했지만, 조건 대조는 코드 기준이며 침투 시험이 아니다. **`next` ≥ 16.4.1**로 올리는 것을 권한다(현재 최신 16.4.5, `sharp` ≥ 0.35.5). 패키지 업그레이드는 하지 않았다.

## 17. 주요 발견 사항

우선순위: P1 = 다음 작업, P2 = 그 다음, P3 = 여유 있을 때.

### A. 실제 결함

**A-01 터치 환경의 `Ctrl K`가 검색 안내문을 가림 (P2)**
- 증상: 태블릿·터치 화면에서 표시가 남고, 약 1024~1280px에서 안내문과 겹침(1280px는 마우스 환경의 입력칸 너비로 계산한 10px).
- 재현: `hover: none` + 너비 641px 이상. Chromium 터치 에뮬레이션.
- 실제 관측: §10 표. 1024px 84px, 1180px 52px 겹침.
- 근거: `docs/images/phase91/hint-touch-1024.png`, 마우스 환경은 정상(`hint-1024.png`).
- 원인: `globals.css:1633`의 `content: none`이 `globals.css:1649`의 `:root[data-platform="other"] …::before`보다 우선순위가 낮다. 패딩 쪽은 `:root[data-platform]`로 올렸지만 `content`는 그대로다.
- 영향: 터치 + 641px 이상 전 페이지의 검색칸(실기기는 미검증).
- 관련 소스: `src/app/globals.css:1633-1642`, `:1644-1652`.
- 수정 후보: `@media (hover: none)` 안을 `display: none`으로 바꾼다. `globals.css:3082`의 40rem 규칙과 같은 방식이다.
- 검증: 터치 컨텍스트 640~1366px에서 `::before`의 `display`가 `none`인지 확인하는 Journey.

**A-02 저장소 하나가 매번 저장에 실패함 (P2)**
- 증상: `griddynamics/rosetta`(별 370)의 job 5143이 시도 3회 모두 `storage_failed`.
- 재현: Sync 41732645946, 41837871106, 41929766977의 ingest 줄. 로컬 재현은 하지 않음.
- 실제 관측: `errorCode: "54000"`(PostgreSQL `program_limit_exceeded`), `found: 0, stored: 0`, 시도당 50~64초. 공개 트리는 8,865개 항목에 `SKILL.md` 759개, `plugin.json` 24개, 가장 긴 경로 129바이트, 가장 큰 산출물 Markdown 18.8KB.
- 근거: Sync 로그, GitHub Trees API. 운영 `/r/griddynamics/rosetta`는 09:55에 404로, 이 저장소는 색인되어 있지 않다.
- 원인: **미확정.** 로그는 비밀 유출을 막으려고 코드만 남겨 메시지가 없다. 경로와 본문은 길지 않아, 큰 inventory(`files` jsonb)나 파생 값이 한도에 걸렸을 가능성이 있다(**추정**).
- 영향: 이 저장소의 산출물이 수집되지 않음. 같은 입력이면 재시도가 소용없어 시도마다 약 1분을 쓴다. 비슷한 저장소가 또 나올 수 있다.
- 관련 소스: `src/ingest/pipeline.ts:139`, `src/ingest/errors.ts:102,124`, `src/ingest/retry.ts:52`. 선례는 `src/ingest/pipeline.test.ts:608`(job 771, 978의 22021).
- 수정 후보: 테스트 DB에 이 저장소를 수집해 실패 문장과 제약을 찾고, 그 값을 잘라 저장한 뒤 회귀 테스트를 추가. `54000`을 재시도 불가로 분류할지도 함께 판단.
- 검증: 로컬 수집 성공, 회귀 테스트, 이후 Sync에서 해당 job 성공.

### B. 성능 병목

**B-01 홈 첫 바이트가 전체 행 쿼리를 기다림 (P1)**
- 증상: 홈 LCP 2.4~3.8초, TTFB 약 2.2~3.4초.
- 재현: 한국에서 모든 측정 조건에서 재현. 다른 지역은 미검증.
- 실제 관측: §5.2, §5.3, §5.4.
- 근거: JS 비활성·3D 없음·폰트 차단에서도 분포 동일. `/` TTFB 2,221ms vs `/artifacts` 325ms.
- 원인: 스트리밍 경계 없이 `listPackages`·`countVisibleByType`를 기다림(확정). 그 쿼리의 비용이 행 수에 비례(합성 데이터로 확인, 운영 플랜은 미확인).
- 영향: 모든 홈 방문. 하루 약 2,500행씩 악화.
- 관련 소스: `src/app/page.tsx:38-42`, `src/db/queries/packages.ts:138,175,281`, `src/db/queries/language.ts`.
- 수정 후보: §5.7 A안(권장).
- 검증: `finalHead` 전후 비교, 칩 합계 일치.

**B-02 목록 LCP도 쿼리 대기 (P2)**
- 증상: `/artifacts` FCP 360ms, LCP 2,592ms(`p.row-desc`).
- 재현: 데스크톱·모바일 Cold.
- 실제 관측: 기본 전체 2,357ms vs `lang=any` 1,655ms(각 10회, 약 +700ms).
- 근거: `phase91-artifacts/lcp3-artifacts.jsonl`, `ttfb-now.txt`, 로그 `durationMs` 중앙값 1,842ms.
- 원인: 언어 정규식과 `NOT_LISTED_BECAUSE`의 행별 계산. `language.ts` 주석의 재검토 조건(약 25k행)을 넘김.
- 영향: 목록, 검색, 필터.
- 관련 소스: `src/db/queries/search.ts`, `src/db/queries/language.ts`, `src/db/queries/packages.ts:138`.
- 수정 후보: `NOT_LISTED_BECAUSE`와 언어를 Sync 때 계산해 저장(Migration 필요, 별도 승인). 저장 언어 컬럼 단독은 약 20% 개선에 그침.
- 검증: 45k 합성과 운영 전후 측정. 검색 결과 동일성 fixture.

**B-03 유휴 후 Cold Start (P1)**
- 증상·관측·근거: §5.5.
- 재현: 수 분 유휴 후 첫 방문.
- 원인: Function 기동과 Neon 재개 조합으로 추정. 분리 측정 안 함.
- 영향: 트래픽이 적은 시간의 첫 방문자.
- 관련 소스: `src/db/client.ts`, Neon 설정(콘솔).
- 수정 후보: 스냅샷(A안)도 DB를 읽으므로 깨우는 시간은 남는다. **이 시간 동안 화면을 보여 주려면 B안(정적 `h1` 먼저)이 필요하다.** 주기적 깨우기는 Neon 무료 시간을 쓰므로 권하지 않음.
- 검증: 8분 유휴 후 측정 반복.

**B-04 소프트웨어 렌더러의 3D (P2)**
- 증상: 2코어 2.3~5.6fps. 입력 반응이 수백 ms.
- 재현: `--use-angle=swiftshader`, `taskset -c 0,1`, 운영 사이트.
- 실제 관측: §6.
- 근거: `phase91-artifacts/scene-sw2c.json`.
- 원인: 3D를 그대로 실행하고 품질만 낮춤(`DockScene.tsx:813-828`).
- 영향: GPU 없는 PC, 가상 머신, 원격 데스크톱. 실제 사용자 비중은 측정 없음.
- 관련 소스: `src/components/DockBoard.tsx:28,105`, `src/components/DockScene.tsx:104,813`.
- 수정 후보: §7 정책.
- 검증: SwiftShader에서 chunk 요청 0, 버튼으로 켜기, E2E 수정.

**B-05 홈 방문당 RSC prefetch 15건 (P3)**
- 증상: 데스크톱 홈 27개 요청 중 15개가 prefetch. 상세 페이지 포함.
- 재현: 데스크톱 Cold 워터폴.
- 실제 관측: 응답 158~1,015B, 약 200ms. Chromium에서 이동 시 약 50건 취소.
- 근거: `lcp3.jsonl`의 `res`.
- 원인: `<Link>` 기본 prefetch. 함수 호출 수 비용은 **미측정**.
- 영향: Vercel Hobby 호출 한도 소모.
- 관련 소스: `src/app/page.tsx`, `src/components/PackageRows.tsx`.
- 수정 후보: 행 링크에 `prefetch={false}`. 체감 이동 속도와 교환.
- 검증: 요청 수와 Vercel 사용량 비교.

### C. 호환성

**C-01 Firefox에서 상세 현재 섹션 표시 없음 (P3)**
- 증상: Scroll-spy 표시가 없다.
- 재현: Playwright Firefox 157, 상세 페이지 스크롤.
- 실제 관측: 링크 색상이 하나, 애니메이션 0.
- 근거: `compat-firefox.json`, `animation-timeline` 미지원.
- 원인: 의도된 CSS 전용 설계. 링크와 스크롤은 정상.
- 영향: 표시만 없음.
- 관련 소스: `globals.css:4717,5296`.
- 수정 후보: 현재 그대로 두는 것을 권함. 필요하면 IntersectionObserver.
- 검증: Firefox 상세 스크롤.

**C-02 WebKit 콘솔의 prefetch 오류 (P3)**
- 증상: `Fetch API cannot load … access control checks` 12건.
- 재현: Playwright WebKit 27.2, 이동이 많은 시나리오.
- 실제 관측: 기능 실패 없음, 전 항목 통과.
- 근거: `compat-webkit.json`.
- 원인: 이동으로 취소된 prefetch로 **추정**. 실제 Safari에서도 나오는지 미확인.
- 영향: 콘솔 노이즈 외 없음.
- 관련 소스: Next 라우터.
- 수정 후보: 실제 Safari 확인 후 판단.
- 검증: 실제 Safari 콘솔.

### D. 접근성

**D-01 Dock Panel 열림 알림 없음 (P3)**
- 증상: 칩 포커스로 패널이 열리지만 알리지 않음.
- 재현: 칩 Tab, 라이브 영역 확인.
- 실제 관측: `aria-live` 없음. 칩 자체에 이름과 수량이 있고 다음 Tab이 패널 링크.
- 근거: `a11y.json`.
- 원인: `DockBoard.tsx:199`.
- 영향: 추가 설명을 듣지 못할 수 있음. 실제 청취 전이라 심각도 미확정.
- 수정 후보: 스크린리더 청취 후 판단. 포커스마다 알리면 오히려 시끄러울 수 있음.
- 검증: Orca/NVDA 청취.

**D-02 색 대비 자동 판정 불가 (P2)**
- 증상: axe 판정 불가 노드 홈 147~201.
- 재현: axe `color-contrast` incomplete.
- 실제 관측: §11.
- 근거: `a11y.json`.
- 원인: 그라디언트·겹친 배경.
- 영향: 위반 0을 "대비 통과"로 읽으면 안 됨.
- 관련 소스: `src/app/globals.css`.
- 수정 후보: 코드 수정 전에 스크린샷 기반 표본 측정으로 실제 위반부터 확인.
- 검증: 표본 텍스트별 대비 4.5:1 측정.

**D-03 `source on GitHub` 반복 링크 (P3)**
- 증상: 같은 문구, 다른 목적지 10~25개.
- 재현: 링크 목록으로 탐색.
- 실제 관측: `a11y.json`의 `ambiguous`.
- 원인: `src/components/PackageRows.tsx`.
- 영향: 링크 목록 탐색 시 구분 어려움. WCAG 2.4.4는 문맥으로 충족될 수 있음.
- 수정 후보: 시각 숨김 텍스트로 항목명 추가.
- 검증: 접근성 트리 이름 확인.

### E. 운영 관측 공백

**E-01 Vercel 로그가 30분뿐이고 5xx를 볼 수 없음 (P2)**
- 증상: 어제의 오류를 알 방법이 없음.
- 재현: `vercel logs --since 1h`, `vercel logs requests`.
- 실제 관측: §13.
- 근거: CLI 오류 메시지 원문.
- 원인: Hobby 플랜.
- 영향: 장애 사후 분석 불가. 이 보고의 "오류 0"은 30분 구간뿐.
- 수정 후보: 예약 Sync나 별도 Actions에 운영 GET 점검을 넣어 Actions 이력에 남김. 플랜 업그레이드는 운영자 결정.
- 검증: 의도적 404 경로와 정상 경로 기록 확인.

**E-02 Neon 리전 미확인 (P2)**
- 증상: Function↔DB 왕복이 큰지 판단 못 함.
- 재현: 해당 없음.
- 실제 관측: 전부터 PENDING. 이번에도 자격증명을 열람하지 않음.
- 근거: Phase 20~25, 66~68 보고서.
- 원인: 운영자 콘솔 정보.
- 영향: §5.7 D안 효과 미확정.
- 수정 후보: 운영자가 콘솔에서 확인.
- 검증: 쿼리 1개 404 TTFB 전후 비교.

**E-03 실제 사용자 지표(RUM) 없음 (P3)**
- 증상: 한국 외 지역과 실제 기기 값을 모름.
- 재현: 해당 없음.
- 실제 관측: 측정 위치 한 곳뿐.
- 근거: §3.
- 원인: 수집 장치 없음(의도적으로 추적 없는 사이트).
- 영향: 미국 사용자는 iad1과 가까워 다를 수 있음.
- 수정 후보: 다른 지역 Actions 러너에서 GET 시간 기록(Sync 러너 활용).
- 검증: 지역별 TTFB 비교.

### F. 개선 후보

**F-01 Next.js 업그레이드 (P1)**
- 증상: critical 5건 포함 권고.
- 재현: `bun audit`.
- 실제 관측·근거: §16.
- 원인: `next@16.3.0` 고정.
- 영향: 코드 기준 직접 노출은 찾지 못함. Docker 배포는 이미지 처리 경로 미검증.
- 관련 소스: `package.json`, `bun.lock`.
- 수정 후보: `next` ≥ 16.4.1, `sharp` ≥ 0.35.5. Vercel 어댑터·standalone 조건(`next.config.ts`) 재확인.
- 검증: `bun run ci`, `bun run build`, E2E, Vercel 배포, 재감사.

**F-02 E2E Job 제한 여유 부족 (P2)** — §14. `.github/workflows/ci.yml:143`. 검증: Job 시간 추세.

**F-03 Sync 대기열 증가 (P2)** — §15. `src/corpus/caps.ts`. 대기 seed 27,655, 재확인 대기 1,309. 처리량을 올리려면 예산 여유가 있어(core 잔여 약 4,500) 상한 조정이 가능하지만 수집 정책 결정이므로 별도 승인이 필요하다. 다만 B-01이 먼저다(행이 늘수록 홈이 느려진다). 검증: 두 수치의 추세.

**F-04 `search` 시 View Transition `AbortError` (P3)** — 로컬 검색 전체 이동 3회에 3건: `Transition was skipped. Navigation transition active`. 기능 영향 없음. `src/app/template.tsx`로 추정(**미확인**). 검증: 콘솔 오류 0.

**F-05 `THREE.Clock` 사용 중단 경고 (P3)** — 매 로드. R3F 내부로 추정(**미확인**). 업그레이드 때 재확인.

**F-06 `x-powered-by` 제거 (P3)** — `next.config.ts`에 `poweredByHeader: false`. 검증: 헤더 확인.

**F-07 Browse by Type 390px (선택)** — §10. 결함 아님.

**F-08 범위 밖 페이지가 1페이지로 대체 (P3)** — `page=999999` → 1페이지, 200. `src/app/artifacts/page.tsx:81`의 `.max(SEARCH_CAPS.maxPage).catch(1)`. 같은 파일 785행의 "There is no page" 안내는 상한 안에서만 동작. 수정 후보: 상한 초과도 안내로 연결. 검증: 범위 밖 URL 확인.

### G. 정상 동작

- 운영 SHA 일치, 배포 체인, smoke.
- 실제 GPU 60fps, 정지 시 draw 0, 컨텍스트 손실 복구.
- WebGL 컨텍스트·렌더러·리스너·DOM 안정.
- 3개 엔진 핵심 기능.
- 4개 해상도 가로 스크롤과 숫자 이탈 0.
- 키보드 순서, 포커스 표시, 포커스 트랩, Reduced Motion.
- 수치 일관성(타입 합 = 목록 총수, 숨김 포함 = 전체 언어).
- XSS, SQL 입력, 경로 탐색, Source Map, 비밀 노출.
- 예약 Sync 연속 성공(개별 저장소 실패는 A-02), 커밋 고정 링크.

## 18. 개선 우선순위

| 순위 | ID | 작업 | 규모 | 이유 |
|---:|---|---|---|---|
| 1 | F-01 | Next.js 업그레이드 | 소 | 패치가 있고, 다른 작업(캐시 등)의 전제 |
| 2 | B-01, B-03 | 홈 Sync 스냅샷, 정적 `h1` 먼저 | 중 | 효과 최대, 시간이 갈수록 악화 |
| 3 | A-01 | 터치 `Ctrl K` | 극소 | 확정 결함, 몇 줄 |
| 4 | F-02 | E2E 제한 조정 | 극소 | 또 cancelled되는 것을 방지 |
| 5 | A-02 | `54000` 저장 실패 조사 | 소 | 산출물 유실, 재발 가능 |
| 6 | B-04 | 소프트웨어 렌더러 정책 | 중 | F-02의 구조적 해법과 연결 |
| 7 | E-01, E-02 | 운영 관측, Neon 리전 | 소 | 다음 판단의 근거 |
| 8 | B-02 | 목록 쿼리 저장 컬럼 | 대 | Migration 승인 필요 |
| 9 | D-02, 실제 스크린리더, 실제 Safari | 수동 확인 | 소 | 사람이 필요 |
| 10 | 나머지 P3 | | | |

## 19. 후속 작업 계획

**Phase 92 — 보안·즉시 수정 (반나절)**
1. `next` ≥ 16.4.1 → verify: `bun audit` critical 0, CI, E2E, Vercel smoke.
2. A-01 → verify: 터치 Journey 추가.
3. F-02 `timeout-minutes` 25 → verify: 워크플로 실행.
4. A-02 원인 조사 → verify: 로컬 수집 성공과 회귀 테스트.

**Phase 93 — 홈 성능 (1일)**
1. Sync 스냅샷 쓰기와 읽기, 스냅샷 없을 때 기존 쿼리로 대체 → verify: 운영 `finalHead` < 약 0.7초(목표, 측정으로 확인).
2. 칩 합계 = `/artifacts` 총수 불변식 재검토 → verify: Sync 전후 비교.
3. 정적 `h1` 먼저 내보내기 → verify: 8분 유휴 후 FCP·LCP, JS 비활성 화면, CLS.

**Phase 94 — 저사양과 CI (1일)**
1. §7 정책 → verify: SwiftShader chunk 0, 전환 순간 CLS 측정, 버튼으로 켜기.
2. 3D Journey 분리 → verify: 일반 E2E 3분 미만.

**운영자 확인 (코드 아님)**
- Neon 리전과 플랜 → §5.7 D안 판단.
- 실기기, 실제 Safari, Orca/NVDA 청취.

**별도 승인이 필요한 결정**
- 목록 저장 컬럼(Migration), Sync 상한 조정, Vercel 플랜.

## 20. 검증하지 못한 항목

| 항목 | 상태 | 이유 |
|---|---|---|
| 실제 Safari | NOT RUN | Linux 환경 |
| 실기기(iOS, Android, 태블릿) | NOT RUN | 기기 없음. 에뮬레이션만 |
| 실제 스크린리더 청취 | NOT RUN | §11 |
| 이전 배포와 같은 조건 비교 | BLOCKED | 배포 URL SSO 보호 |
| 운영 DB `EXPLAIN` | BLOCKED | 자격증명 열람 금지. 합성 데이터로 대체 |
| Neon 리전 | BLOCKED | 운영자 콘솔 |
| 30분 이전 런타임 로그 | BLOCKED | Hobby 보존 기간 |
| 5xx, Timeout, CDN 로그 | BLOCKED | 플랜 제한 |
| GPU 사용률, VRAM | NOT RUN | root 필요. 텍스처 약 20MB는 추정 |
| Firefox·WebKit 3D FPS | NOT RUN | 범위 축소 |
| Fallback 전환 순간 CLS | NOT RUN | 구현 후 측정 |
| 색 대비 수동 표본 | NOT RUN | D-02 |
| 한국 외 지역 LCP | NOT RUN | 측정 위치 한 곳 |
| Skip Link 이후 Tab 위치 | NOT RUN | 후속 확인 |
| Next 권고 실제 악용 가능성 | NOT RUN | 침투 시험 범위 밖, 코드 대조만 |
| `griddynamics/rosetta` 로컬 재현 | NOT RUN | 조사 전용 범위에서 실제 수집을 돌리지 않음 |
| 10-20~10-23 Sync 실패 원인 재조사 | NOT RUN | 오래된 기록, 이후 정상 |
| Visual Regression | NOT RUN | 자동 도구 없음, 스크린샷 직접 확인 |
