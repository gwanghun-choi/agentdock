# AgentDock Phase 71 — UI/UX Motion 2.0 (Cinematic Interactive Experience)

- 기준: `develop` HEAD `c821102`. 작업 시작 시 미커밋 파일은 `docs/analysis/agentdock-phase69-70-sync-recovery.md` 하나였고, 보존했다.
- 범위: 콘텐츠, 텍스트, 데이터, API, DB, Schema, URL, 검색·필터·정렬 동작은 바꾸지 않았다. 바뀐 것은 CSS와 서버 컴포넌트 하나(`src/app/template.tsx`)다.
- 하지 않은 것: 운영 DB 접근, Actions·Secret·Variable 변경, workflow dispatch, Job 771·978 재enqueue, commit, push, 배포.
- 표기: FACT(측정·실행함), INFERENCE(추론), NOT RUN(실행하지 않음).

## 1. 핵심 결론

- **이미 갖춘 motion 체계 위에 비어 있던 부분만 채웠다.**
  - Phase 60에서 hero 연출, scroll-driven flow, hover와 focus 응답이 이미 들어가 있었다.
  - 이번에 추가한 것은 다섯 가지다. ① 페이지 전환(SPA와 문서 간 모두), ② hero wash 등장, ③ type 카드 스크롤 등장, ④ 누름(`:active`) 피드백, ⑤ 카드의 키보드 focus 대응과 hue glow.
- **새 의존성 0, client JS 증가 0B, client component 수 그대로 4개(FACT).** CSS는 gzip 기준 +261B 늘었다.
- **회귀 없음(FACT).**
  - E2E 43/43(회귀 테스트 1건 추가), unit 1,556 passed, axe 24회 실행 위반 0, LCP·CLS·long task가 변경 전과 같은 범위였다.
  - reduce 설정에서 애니메이션 0개, 정지 상태 화면은 10개 중 9개가 픽셀 단위로 같았다. 나머지 1개(홈 데스크톱)는 Latest read 영역 534px이 1/255만 다르다.
- **보류했다.**
  - pointer 추적 하이라이트, 3D tilt, particle, R3F, 무한 aurora, hero 텍스트 등장, 피드 행 stagger(§5).
  - parallax는 구현해서 측정한 뒤 되돌렸다. hero 글자의 subpixel anti-aliasing을 영구적으로 바꿨기 때문이다(§4.7).

## 2. 기존 Motion 현황 (FACT, `c821102` 소스)

| 항목 | 현황 |
|---|---|
| Next.js / React | 16.3.0 / 19.2.8. App Router가 React canary를 내장해서 `ViewTransition`을 설정 없이 쓸 수 있다(`node_modules/next/dist/docs/01-app/02-guides/view-transitions.md`) |
| 애니메이션 라이브러리 | 없음. `motion@13.1.0`은 2026-08-13에 측정한 뒤 거부했다. client JS gzip +40KB, 목록이 Client Component로 바뀜(`globals.css` motion 블록 주석) |
| CSS 구성 | Tailwind 없음. `src/app/globals.css` 한 파일(3,768줄), 토큰은 `--dur-fast` 120ms, `--dur` 180ms, `--dur-slow` 320ms, `--ease`, `--ease-emphasized` |
| motion 규칙 | transition 시간은 토큰으로만 지정한다. `animation`과 `@keyframes`는 `prefers-reduced-motion: no-preference` 블록 하나에만 둔다(`src/app/motion.test.ts`). 시간 기반 애니메이션은 5초 안에 끝나야 하고, reduce에서는 0개여야 한다(`e2e/journeys.spec.ts:182-204`) |
| Client component | 4개: `error.tsx`, `CopyButton`, `PollUntilDone`, `SearchHotkey` |
| Hero | dot grid(`::before`)와 wash 2개(`::after`). 검색창 focus 시 wash 밝기 0.7→1. Latest read 그림이 1.5초 동안 그려지고 lane 빛이 2회 지나간다 |
| 목록 카드(행) | hover와 `:focus-within` 모두에서 1px 상승, hue edge, 그림자 |
| type 카드 | hover만 2px 상승, 테두리, 띠. **키보드 focus에는 반응하지 않음** |
| Latest read 카드 | hover만 2px 상승과 teal glow. **키보드 focus에는 반응하지 않음** |
| Scroll 애니메이션 | index flow만 `animation-timeline: view()`. 지원하지 않는 브라우저에는 시간 기반 fallback |
| 페이지 전환 | **없음** |
| 누름(`:active`) | **없음**. 파일 전체에 `:active`가 0건 |
| Loading | `artifacts/loading.tsx`의 skeleton sweep |
| 필터 칩 | 선택 시 ring과 1px 상승. sliding indicator는 이전에 거부했다(Firefox anchor 미지원, 칩 폭이 서로 다름) |
| 모바일 | 휴대폰에서는 Latest read를 숨긴다. 첫 화면 위치를 지키는 E2E 가드가 있다 |
| 이미지 자산 | 없음. 그래픽은 CSS gradient이고, 아이콘은 `Icon.tsx`의 inline SVG |
| 이력 | Phase 57에서 장식을 삭제한 뒤 "정적·평면적"이라는 평가를 받았다. Phase 60에서 "연출은 한 번으로 모은다"는 방향으로 되살렸고, 무한 drift는 WCAG 2.2.2 때문에 보류했다 |

## 3. 부족했던 부분

1. **페이지가 바뀔 때 연결감이 없다.** 홈에서 목록으로 가면 화면이 그냥 바뀐다. 검색은 native GET form이라 문서 전체를 다시 불러온다.
2. **누름 피드백이 없다.** 서버 렌더링 페이지는 응답까지 시간이 걸린다. 클릭이 접수됐다는 신호가 hover 색 말고는 없다.
3. **키보드 사용자와 pointer 사용자가 받는 응답이 다르다.** 목록 행은 둘 다 같지만, type 카드와 Latest read 카드는 hover에만 반응한다.
4. **hero의 빛이 처음부터 그 자리에 있다.** 바탕은 fade되지만 wash는 정지 상태 그대로 나타난다.
5. **Browse by type 영역이 정적이다.** 바로 위의 flow는 스크롤에 맞춰 등장하는데, 이 영역은 그렇지 않다.

## 4. 구현 상세

### 4.1 페이지 전환 (P1-D)

- **`src/app/template.tsx`(신규, 서버 컴포넌트).** 내용은 `<ViewTransition enter="page-enter" exit="page-exit" default="none">`이다.
  - template은 navigation마다 다시 mount되므로 enter와 exit이 여기서 발생한다.
  - header와 footer는 layout에 있어서 움직이지 않는다.
- **`default="none"`이 필요하다.** 없으면 같은 페이지 안에서 갱신될 때도 전환이 실행된다.
  - FACT: 로컬 test DB의 job 하나를 잠시 running으로 바꿔 시험했다. 6.5초 동안 refresh가 4회 일어났고, 시작된 view transition은 0회였다. 값은 바로 되돌렸다.
- **애니메이션.** 나가는 화면은 `page-out`(opacity, 120ms), 들어오는 화면은 `page-in`(opacity와 8px 상승, 240ms, 60ms 지연)이다.
- **문서 간 전환.** `@view-transition { navigation: auto; }`로 검색 form 제출에도 브라우저 기본 crossfade가 실행된다.
- **reduce 설정.**
  - keyframe과 `@view-transition`은 no-preference 블록 안에 있어서 아예 존재하지 않는다.
  - React가 여는 전환에는 브라우저 기본 crossfade가 남는다. 그래서 reduce 블록에서 `::view-transition-*`의 `animation-duration`을 0.01ms로 줄였다.
  - FACT: reduce에서 모든 전환 pseudo가 0.01ms였다. 문서 간 전환은 no-preference에서 `pagereveal.viewTransition`이 있었고, reduce에서는 없었다.
- **지원하지 않는 브라우저.** 이전과 똑같이 이동한다.

### 4.2 Hero wash 등장 (P0-A)

- `.hero::after`에 `wash-in`을 넣었다. opacity 0과 `translateY(3%)`에서 시작해 1.6초 동안 1회 실행한다.
- 처음에는 `scale(1.06)`도 넣었다. 리뷰에서 가로 넘침을 지적받아 세로 이동만 남겼다(§10).
- 바탕 fade, lane 그리기와 함께 하나의 연출로 묶인다. lane 빛의 첫 통과가 시작될 무렵 끝난다.
- 정지 상태의 opacity 0.7과 focus 시 1로 바뀌는 transition은 그대로다(`backwards`만 쓰고 `forwards`는 쓰지 않음).

### 4.3 Browse by type 스크롤 등장 (P0-B, Scroll Entrance)

- `.type-card`에 `card-rise`(opacity와 14px 상승)를 넣었다. `animation-timeline: view()`, `entry 0% → entry 100%`로 flow와 같은 구간이다.
- **시간 기반 fallback은 넣지 않았다.** 두 화면 아래에 있는 요소라, 시간에 맞춰 재생하면 아무도 보지 않을 때 끝나 버린다. flow를 스크롤 연동으로 바꾼 것과 같은 이유다.
- 피드 행(첫 화면에 있는 본문)에는 등장 효과를 넣지 않았다. Phase 57의 결정을 유지한 것이다.

### 4.4 누름 피드백 (P1-E)

- 대상은 `.btn`, `.submit button`, `.search button[type=submit]`, `.hero-search button[type=submit]`, `.pager a`, `.facet .chip`이다. `:active`일 때 `scale(0.97)`로 줄어든다.
- 시간은 `--dur-fast` 토큰을 쓴다. 그래서 reduce에서는 즉시 바뀐다.
- transform이라 옆 요소의 layout이 움직이지 않는다.
- 선택된 칩은 1px 상승을 유지한 채 눌린다(`translateY(-1px) scale(0.97)`). 누르는 순간 선택이 풀린 것처럼 보이지 않게 하기 위해서다.
- FACT(CDP로 `:active` 강제): 검색 버튼과 칩 모두 `matrix(0.97, …)`였다.

### 4.5 카드의 키보드 대응과 hue glow (P0-B)

- `.type-card:focus-visible`에 hover와 같은 상승, 테두리, 띠를 적용했다. 종류별 hue로 아래쪽 glow도 더했다(hover와 focus 공통).
- `.trace-card:focus-within`에 hover와 같은 상승과 teal glow를 적용했다.
- FACT: Tab으로 이동했을 때 type 카드는 `translateY(-2px)`가 되고 focus ring(solid)이 유지됐다. Latest read 카드도 `translateY(-2px)`였다.

### 4.6 전환 중 헤더와 클릭

- **헤더.** sticky 헤더에 `view-transition-name: site-header`를 줬다. 전환 중에는 이 group을 페이지 snapshot 위(z-index 1)에 두고 crossfade를 끈다.
  - 이렇게 하지 않으면, 헤더 아래로 스크롤돼 가려져 있던 이전 페이지 내용이 120ms 동안 헤더 위에 그려진다.
  - FACT: 전환 중 site-header group의 z-index는 1이고, 헤더 애니메이션은 0개였다.
- **클릭.** `::view-transition { pointer-events: none }`을 넣었다. 전환이 진행되는 약 0.3초 동안 오버레이가 클릭을 가로채지 않는다.
  - FACT: 전환 중 오버레이의 pointer-events는 none이었다.

### 4.7 구현 후 되돌린 것: hero 바탕 parallax

- 스크롤 연동으로 dot grid를 0~32rem 구간에서 4rem 움직이는 parallax를 데스크톱에만 넣었다.
- 정지 상태 스크린샷을 비교하자 홈 1280px hero 영역에서 **25,436px이 변경 전과 달랐다(FACT)**.
- 원인을 확인했다. parallax만 끄면 hero 본문과 검색 영역의 차이가 사라진다. 이 애니메이션은 `fill: both`라 끝나지 않는다. 그래서 바탕이 계속 별도 compositor layer에 남고, 그 위의 제목, 본문, 검색창이 subpixel이 아닌 grayscale anti-aliasing으로 그려진다.
- 효과는 스크롤해야만 보이는데, 이 비용은 스크롤하지 않아도 항상 든다. 가독성을 우선하는 원칙에 따라 제거했다. 측정 근거는 CSS 주석으로 남겼다.

## 5. 보류·거부한 항목과 이유

| 항목 | 판단 | 근거 |
|---|---|---|
| Pointer 추적 하이라이트, 3D tilt | 거부 | CSS만으로는 만들 수 없어서 pointermove를 처리하는 5번째 client component가 필요하다. 터치 기기에서는 동작하지 않는다. 글이 많은 카드를 기울이면 읽기 어려워진다. 장식이 주는 가치보다 비용이 크다 |
| Particle (tsParticles), React Three Fiber | 거부(P2) | WebGL·canvas를 계속 실행하면 배터리와 CPU를 쓰고, client bundle이 수십~수백 KB 늘어난다(공개 수치 기준 추정, 미측정). 이 index의 주제(commit 추적)와도 관련이 없다 |
| 무한 aurora / gradient drift | 거부 | Phase 60과 같은 결정이다. 5초를 넘는 움직임에는 WCAG 2.2.2 정지 수단이 필요하다. 끝나는 1회 버전(§4.2)으로 대체했다 |
| Hero 텍스트 등장 | 거부 | 홈 데스크톱의 LCP 요소가 `H1`이다(FACT, 측정). opacity 0에서 시작하는 등장 효과는 LCP를 그만큼 늦춘다 |
| 피드 행 stagger | 거부 | Phase 57의 결정을 유지했다. 방문자가 읽으러 온 본문이고 첫 화면에 있다 |
| 필터 칩 sliding indicator | 거부 | 기존 결정을 유지했다(`globals.css` `.facet .chip[aria-current]` 주석) |
| Hero parallax | 구현 후 제거 | §4.7 |
| Empty state 등장 | 보류 | 0건 화면에서는 안내문이 본문이자 LCP다. 등장 효과는 읽는 시점만 늦춘다 |
| Loading 전환(skeleton→내용) | 보류 | skeleton sweep이 이미 있다. Suspense reveal 전환은 `loading.tsx`의 구조를 바꿔야 한다 |

### 라이브러리 비교

| 후보 | 호환성 | Bundle | Runtime | 유지보수 | 접근성 | SSR/Hydration |
|---|---|---|---|---|---|---|
| **CSS + React ViewTransition (채택)** | 이미 쓰는 방식이고, `motion.test.ts` 규칙 안에 들어간다 | **0B JS**(FACT), CSS gzip +261B | transform·opacity만, compositor 처리 | 기존 한 블록에 추가 | reduce에서 존재하지 않음 | 서버 컴포넌트라 hydration 대상이 아님 |
| Motion / Framer Motion | 목록이 Client Component로 바뀐다 | +40KB gzip(FACT, 2026-08-13 측정) | 양호 | API 추가 | `useReducedMotion` 수동 처리 | client 경계가 생긴다 |
| GSAP | client 코드가 필요하다 | 수십 KB(추정) | 양호 | 명령형 timeline | 수동 처리 | effect 정리 필요 |
| React Three Fiber | client와 WebGL이 필요하다 | three.js 포함 큼(추정) | GPU를 계속 씀 | 높음 | 대체 콘텐츠 필요 | canvas는 SSR 불가 |
| tsParticles | client가 필요하다 | 수십 KB(추정) | canvas를 계속 씀 | 중 | 정지 수단 필요 | client 전용 |

GSAP, R3F, tsParticles의 크기는 이번에 설치해서 측정하지 않았다. 표의 값은 추정이다.

## 6. 변경 파일

| 파일 | 변경 |
|---|---|
| `src/app/template.tsx` | 신규. 서버 컴포넌트, ViewTransition 경계 |
| `src/app/globals.css` | 누름 규칙, focus 대응, glow, transition에 transform 추가, 헤더 `view-transition-name`, motion 블록(wash-in, card-rise, page-in/out, 헤더 고정, 오버레이 pointer-events, `@view-transition`), reduce 블록(view transition 시간), parallax 거부 주석 |
| `src/app/artifacts/loading.tsx` | 주석 1곳. 다른 section에서 들어올 때 skeleton도 page 전환을 받는다는 사실을 반영 |
| `e2e/journeys.spec.ts` | 회귀 테스트 1건. motion이 켜진 휴대폰에서 등장 애니메이션 동안 매 frame 가로 넘침이 0인지 검사 |
| `docs/analysis/agentdock-phase71-motion-2.md` | 이 보고서 |
| `docs/images/phase71/*.png` | 스크린샷 5장(128색 양자화) |

## 7. 변경 전후 비교 (FACT)

**자산(`.next/static`)**

| | 전 | 후 |
|---|---:|---:|
| client JS | 14 files, 592,480B (gzip 181,997B) | **같음** |
| CSS | 45,582B (gzip 9,025B) | 47,111B (gzip 9,286B), +1,529B / gzip +261B |
| client component | 4 | 4 |

**페이지 측정**
- 조건: 로컬 standalone, E2E seed, Chromium. 데스크톱 1280×800, 모바일 390×844에 CPU ×4. 각 1회, 5.5초 대기.

| 페이지 / 화면 / motion | LCP ms | CLS | long task ms | 로드 직후 애니메이션 | 5.5초 뒤 running | 콘솔 오류 |
|---|---|---|---|---|---|---|
| home desktop no-preference | 80→60 | 0→0 | 0→0 | 24→31 | 16→22 | 0→0 |
| home desktop reduce | 64→48 | 0→0 | 0→0 | 0→0 | 0→0 | 0→0 |
| home mobile no-preference | 108→116 | 0→0 | 81→87 | 17→24 | 16→22 | 0→0 |
| home mobile reduce | 104→108 | 0→0 | 82→81 | 0→0 | 0→0 | 0→0 |
| artifacts desktop no-preference | 356→344 | 0→0 | 0→0 | 50→50 | 0→0 | 0→0 |
| search mobile no-preference | 108→104 | 0→0 | 82→80 | 0→0 | 0→0 | 0→0 |
| detail desktop no-preference | 76→72 | 0.0972→0.0972 | 0→0 | 0→0 | 0→0 | 0→0 |
| empty desktop no-preference | 344→348 | 0→0 | 0→0 | 50→50 | 0→0 | 0→0 |

- **1회 측정이라 잡음이 있다.** 표는 최종 빌드 값이다. 중간 빌드에서 모바일 검색 long task가 138ms로 튀어서 5회 반복했다. 중앙값은 홈 82ms, 검색 84ms(변경 전 81–82ms)로 잡음이었다.
- **5.5초 뒤 running이 +6인 것은 type 카드의 scroll-driven 애니메이션이다.** 스크롤할 때만 진행된다. flow의 16개도 원래 같은 상태였다.
- **홈 전체 스크롤(rAF 40px 간격, 2회).**
  - 데스크톱: p50 16.7ms, p95 16.8ms, 34ms 초과 프레임 0.
  - 모바일(CPU ×4): p95 17.3ms, 34ms 초과 0.
  - Phase 60 기록(p95 16.7ms, 초과 0)과 같은 수준이다. 변경 전 빌드로 같은 스크롤 측정을 다시 하지는 않았다.
- **상세 페이지 데스크톱 CLS 0.0972는 변경 전부터 있었다.** 이번 변경과 관계없다.

**정지 상태 화면(5.5초 뒤 viewport, 10장)**
- 9장은 픽셀까지 같다.
- 홈 1280은 Latest read 영역 534px이 최대 1/255 차이다. 반복 촬영해도 같고, wash-in을 끄면 사라진다. wash 그라데이션의 렌더링 경로 차이로, 눈으로는 구분할 수 없다.
- `docs/images/phase71/before-home-1280.png`, `after-home-1280.png`

**움직임(after)**
- `after-hero-entrance-frames.png`: 200ms, 700ms, 1300ms 프레임(최종 `translateY(3%)` 버전). wash가 떠오르고 lane이 그려진다.
- `after-home-390.png`: 휴대폰 정지 화면.
- `after-typecard-focus-1280.png`: 키보드 focus를 받은 type 카드.

## 8. 접근성 (FACT)

- **axe**: WCAG 2.0/2.1/2.2 A·AA와 best-practice 규칙으로 실행했다. 6페이지 × light·dark × 1280·390 = **24회, 위반 0**이다(5.5초 대기 뒤, motion은 no-preference).
- **reduce**: 로드 직후와 5.5초 뒤 모두 애니메이션 0개(20개 측정). 페이지 전환은 0.01ms, 문서 간 전환은 없음.
- **키보드**: type 카드와 Latest read 카드가 focus에서 hover와 같은 응답을 한다. 기존 focus ring은 유지된다.
- **WCAG 2.2.2**: 시간 기반 애니메이션은 모두 5초 안에 끝난다(E2E 단언 통과). 새로 추가한 무한 반복은 없다.
- **가로 넘침**: 20개 측정 모두 없음.
- **실기기 screen reader, Safari, Firefox**: NOT RUN.

## 9. 테스트 결과 (FACT)

| 항목 | 결과 |
|---|---|
| `bun run check:boundaries` | OK |
| `bun run lint` | 235 files, 오류 0 |
| `bun run typecheck` | OK |
| `bun run test` | 최종 실행: 80 files, **1,556 passed / 2 skipped / 0 failed** |
| └ 참고 | 중간 실행 1회에서는 live 테스트 `src/github/permalink.test.ts`가 GitHub rate limit으로 실패했다. 이번 변경과 관계없는 네트워크 조건이고, 최종 실행에서는 통과했다 |
| `bun run build` | OK (전/후) |
| E2E (`bunx playwright test`, 로컬 test DB) | 전 42/42, **후 43/43**. 5초 이하 단언과 reduce에서 애니메이션 0개 단언 포함 |
| 신규 회귀 테스트 | 이전 코드(`scale(1.06)`)로 빌드하면 **FAIL**(넘침 12px), 수정 코드에서는 **PASS**(FACT) |
| 페이지 전환 브라우저 확인 | SPA는 no-preference에서 page-out 120ms와 page-in 240ms, reduce에서 0.01ms. 문서 간 전환은 no-preference에서만 실행 |
| polling 중 전환 | 0회 (§4.1) |

- E2E 서버 로그의 `The destination stream closed early`는 변경 전에도 같은 횟수로 나왔다.

## 10. PR Review Toolkit 결과

- 도구는 `pr-review-toolkit:code-reviewer`다. 결과는 CRITICAL 0, IMPORTANT 2, MINOR 4건이었고 모두 처리했다.

| 등급 | 지적 | 처리 |
|---|---|---|
| IMPORTANT | wash-in의 `scale(1.06)`이 viewport와 너비가 같은 `.hero::after`를 넓혀 390px 페이지가 0.5초 동안 402px가 된다. 기존 넘침 E2E는 reduce에서만 돌아서 잡지 못한다 | `translateY(3%)`만 남기고 수정했다. 회귀 E2E를 추가했다(이전 코드 FAIL 12px, 수정 코드 PASS) |
| IMPORTANT | 떠나는 페이지의 snapshot이 sticky 헤더 위에 그려진다 | 헤더에 view-transition-name을 주고 z-index로 위에 고정했다(§4.6, 브라우저에서 확인) |
| MINOR | template은 첫 URL 세그먼트가 바뀔 때만 remount된다. 주석이 사실과 다르다 | 주석에 경계를 명시했다. 같은 section 안에서는 전환하지 않는 것이 의도다 |
| MINOR | 전환 중 클릭이 사라진다 | `::view-transition { pointer-events: none }`을 넣었다 |
| MINOR | 문자열 enter/exit은 뒤로/앞으로 이동에도 재생된다 | 수용했다. 이유를 template 주석에 적었다 |
| MINOR | `loading.tsx` 주석과 wash-in 주석이 실제와 다르다 | 둘 다 고쳤다 |

- 리뷰어가 문제없다고 확인한 항목:
  - type 카드의 scroll 애니메이션과 hover transform
  - 칩의 `:active`와 선택 lift
  - SSR/hydration(서버 컴포넌트, react-server가 export함, 404 상태에 영향 없음)
  - PollUntilDone
  - 리스너 누수(새 리스너 없음)
  - reduce 처리의 완전성
  - WCAG 2.2.2
- `/ponytail-review`: NOT RUN.

## 11. 추가 개선 후보

- **type 카드 머리 행의 세로 정렬.** 설명 길이에 따라 badge 높이가 카드마다 다르다. grid 행이 늘어나면서 생기는 기존 레이아웃이다. 정렬은 motion과 별개라 이번에는 건드리지 않았다.
- **상세 페이지 데스크톱 CLS 0.0972.** 변경 전부터 있었다. 원인 조사가 필요하다.
- **같은 artifact의 목록→상세 morph.** `ViewTransition name`을 붙이면 되지만, 행과 상세 제목의 구조가 달라 디자인 검토가 먼저 필요하다.
- **Suspense reveal 전환(`loading.tsx` skeleton→내용).**
- **실기기 Safari·Firefox에서 view transition 확인.**

## 12. 화면 확인 방법 (로컬)

저장소 루트에서 실행한다.

```zsh
export TEST_DATABASE_URL=postgresql://agentdock_app@127.0.0.1:55432/agentdock_test
bun run e2e:seed
DATABASE_URL=postgresql://build@127.0.0.1:1/placeholder bun --no-env-file run build
cp -r .next/static .next/standalone/.next/
PORT=3970 HOSTNAME=127.0.0.1 DATABASE_URL=$TEST_DATABASE_URL DATABASE_SCHEMA=agentdock node .next/standalone/server.js
```

- http://127.0.0.1:3970/
  - 첫 1.6초 동안 hero가 등장한다.
  - 아래로 스크롤하면 Browse by type 카드가 떠오른다.
  - Tab 키로 카드를 이동하면 카드가 올라간다.
  - type 카드를 클릭하면 페이지 전환이 보인다.
  - 버튼을 누르고 있으면 줄어든다.
- 검색어를 입력하고 Enter를 누르면 문서 간 crossfade가 보인다.
- OS 설정에서 "동작 줄이기"를 켜면 모든 움직임이 사라진다.

## 13. Git Status (보고 시점)

```
 M e2e/journeys.spec.ts
 M src/app/artifacts/loading.tsx
 M src/app/globals.css
?? docs/analysis/agentdock-phase69-70-sync-recovery.md   (이전 작업, 보존)
?? docs/analysis/agentdock-phase71-motion-2.md
?? docs/images/phase71/
?? src/app/template.tsx
```
