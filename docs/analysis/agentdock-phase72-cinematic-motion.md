# AgentDock Phase 72 — Cinematic Motion & Visual Experience

- 기준: `develop` HEAD `c821102`, Phase 71 미커밋 변경 위에서 작업했다(2026-10-27).
- 범위: 시각 표현만 바꿨다. 콘텐츠·텍스트·데이터·검색/필터/정렬·URL·SEO·API·DB는 변경하지 않았다.
- 새 의존성 0, client JS 증가 0B, client component 4개 유지(`git grep -l "^'use client'" src/`).
- 측정 환경: 로컬 standalone 빌드(`127.0.0.1:3970`), test DB(`agentdock_test`, e2e seed), Playwright Chromium headless.

## 1. 기존 UI의 시각적 한계 (Phase 71 기준)

| 영역 | 한계 |
|---|---|
| Hero | 정지 상태에서는 dot 배경과 옅은 glow만 있다. 오른쪽 Latest read 카드 주변이 비어 있어 "AI·개발자 플랫폼"다운 상징 요소가 없다. |
| 카드 | type 카드는 hover 시 들어 올림과 hue glow만 있고, 목록 행은 회색 배경과 왼쪽 hue 선만 있다. 정지 상태의 카드는 평평하다. |
| 페이지 | 홈을 벗어나면(목록·상세) 배경이 완전히 평면이다. 섹션 구분은 여백뿐이다. |
| 전환 | 섹션 간 page fade만 있고, 목록의 항목과 상세 페이지가 시각적으로 이어지지 않는다. |

## 2. 검토한 디자인 후보

| 후보 | 판정 | 근거 |
|---|---|---|
| A. Animated Neural Network (SVG) | **채택** | 서버 렌더 SVG로 JS 0B. 정지 상태에서도 그래픽이 남는다. 신호가 Latest read 레인으로 들어가는 구성은 제품이 하는 일("저장소를 읽어 커밋에 기록")과 맞는다. |
| D. Abstract Data Visualization | **A와 결합** | 곡선 trace와 신호 펄스를 A의 near layer에 넣었다. |
| B. Interactive Technology Grid (pointer 반응) | 부분 채택 | pointer 좌표 추적은 JS가 필요해 5번째 client component가 생기므로 거부했다. 대신 상호작용 반응은 검색창 focus에 걸었다(CSS `:has()`). |
| C. Cinematic Aurora | 거부 | 무한 색 변화는 WCAG 2.2.2(5초 넘는 움직임에는 정지 수단 필요)에 걸려 Phase 60에서 이미 거부됐다. 1회 등장 wash는 Phase 71에 있다. |
| 카드 tilt / 큰 확대 | 거부 | 요구사항에서 금지했고, 터치 기기에서 동작하지 않으며 글이 많은 카드의 가독성을 떨어뜨린다. |
| 행 stagger / 검색 결과 전환 | 보류 | 행 stagger는 Phase 57의 결정(읽으러 온 콘텐츠는 즉시 보인다)을 유지했다. 검색은 GET form이라 문서 전체가 이동하고, 결과 목록 높이가 매번 달라 morph가 늘어나 보인다. 브라우저 기본 crossfade(Phase 71)를 유지했다. |
| Skeleton → Content 전환 | 보류 | `loading.tsx`의 기존 결정(placeholder가 레이아웃을 고정하고 내부는 움직이지 않는다)을 유지했다. |

## 3. 선택한 디자인과 이유

**"읽기 네트워크"**: Hero 오른쪽에 저장소(노드)들이 연결된 네트워크를 둔다. 첫 진입 때 노드와 선이 그려지고, 세 개의 신호가 Latest read 카드의 레인 높이로 들어간다. Phase 60의 레인 빛(1.4초 시작)과 같은 박자다.

- 홈의 시각적 중심이 생긴다. 정지 상태에서도 그래픽이 남는다.
- 제목 열(왼쪽)은 mask로 비워 두어 콘텐츠가 그래픽보다 앞선다.
- 카드·섹션·상세 페이지는 같은 재료(hue 색, dot 배경, accent→commit 그라디언트)를 재사용해 사이트 전체가 한 언어로 보이게 했다.

## 4. 실제 구현한 그래픽

| 요소 | 구현 | 위치 |
|---|---|---|
| Hero 네트워크 | 서버 컴포넌트 `HeroSignal`의 inline SVG. far 링(점선, 작은 노드 14개)과 near 네트워크(노드 15개, 허브 3개와 halo, 곡선 엣지 23개, 신호 trace 3개)로 구성했다. `aria-hidden`이고 `focusable="false"`이며 `pointer-events: none`이다. | `src/components/HeroSignal.tsx`, `globals.css` `.hero-signal`, `.sig-*` |
| 배치 | viewBox는 1280×800에서 본 hero 박스와 같다(1104×560, `xMaxYMin slice`). 데스크톱은 제목 열을 mask로 투명하게 하고(52%→64%) 아래쪽을 fade한다. 모바일(`width < 64rem`)은 오른쪽 위 radial mask를 쓰고 신호를 숨긴다(신호가 들어갈 Latest read 카드가 모바일에는 없다). | 같은 곳 |
| 타입 카드 깊이 | 정지 상태에 3겹 배경(왼쪽 위 hue, 오른쪽 아래 옅은 hue, 위쪽 1px 하이라이트)을 깔았다. 빛 band(`::after`)는 카드 밖 왼쪽에 두었다. | `.type-card`, `.type-card::after` |
| 목록 행 | hover/focus 시 타입 hue의 빛이 왼쪽에서 45%까지 배어든다(`::before` opacity, 행마다 `isolation: isolate`). | `.rows > li::before` |
| 섹션 제목 rule | 각 `h2` 아래에 accent→commit 그라디언트의 1.75rem rule을 넣었다(absolute라 레이아웃이 바뀌지 않는다). 정적이다(§11). | `.section-head h2::after` |
| 목록·상세 상단 | hero와 같은 dot 배경과 blue glow를 bleed로 깔았다. 상세는 breadcrumb 위가 끊기지 않도록 위쪽도 fade한다. | `.page-head::before`, `.detail-head::before` |
| 빈 상태 | 메시지 위에 낮게 blue glow를 넣었다. | `.empty` |

## 5. 적용한 애니메이션

모두 `prefers-reduced-motion: no-preference` 블록 안에 있다. 시간 기반 애니메이션은 모두 1회 또는 2회 재생되고 5초 안에 끝난다.

| 애니메이션 | 시점·길이 | 속성 |
|---|---|---|
| far 링 fade (`ground-in` 재사용) | 0–0.9초 | opacity |
| 엣지 그리기 `sig-draw` | 0.15–1.25초 | stroke-dashoffset |
| 노드 등장 `sig-node-in` | 0.25–0.67초 | opacity, transform |
| 허브 bloom `sig-bloom` | 0.7–2.1초, 정지 halo로 안착 | opacity, transform |
| 신호 `sig-run` ×2 | 1.0/1.2/1.4초 시작, 1.3초씩 2회 → 마지막 프레임 4.0초 | stroke-dashoffset, opacity |
| 검색 focus 신호 `sig-run-again` | focus 때 1회 1.3초, 세 신호가 동시에 출발한다. blur 때는 재생하지 않는다 | 같음 |
| 타입 카드 빛 `sweep` | hover/focus-visible 때 1회 850ms | transform |
| 카드→상세 morph | 클릭(또는 Enter)한 링크의 이름과 배지가 상세 제목·배지로 380ms 동안 이동 | View Transitions |

### 카드→상세 morph 설계

- `view-transition-name`은 **focus를 가진 링크**에만 붙는다(`:is(.row-title a, .trace-name):focus`). 상세 페이지에서는 `.detail-head:has(> .badge) > h1`과 배지에 붙는다.
- 같은 이름이 두 요소에 붙으면 브라우저가 transition 전체를 중단한다. 홈은 최신 artifact를 두 번 보여 주고(Latest read와 첫 행), 홈과 목록의 행은 같은 artifact를 담는다. 그래서 artifact마다 이름을 붙이는 방식은 쓰지 않았다. focus는 한 요소만 가질 수 있으므로 이름이 하나뿐임이 구조적으로 보장된다.
- 저장소 페이지(`/r/o/r`)에도 `.detail-head`와 행이 있어서 `:has(> .badge)`로 제외했다.
- 쌍이 없을 때(다른 곳에서 상세로 들어오거나 상세를 떠날 때)는 `:only-child`로 page-in/page-out과 같이 움직인다.
- Chromium은 클릭한 링크에 focus를 준다. Safari와 macOS Firefox는 주지 않으므로 그 환경에서는 쌍이 없고 Phase 71의 page 전환만 재생된다(점진적 향상).

## 6. 변경 파일

| 파일 | 변경 |
|---|---|
| `src/components/HeroSignal.tsx` | 신규. 서버 컴포넌트, inline SVG. |
| `src/app/page.tsx` | import 1줄, `<HeroSignal />` 1줄. |
| `src/app/globals.css` | 위 §4·§5의 규칙. |
| `e2e/journeys.spec.ts` | 테스트 1건 추가(아래 §10). |
| `docs/images/phase72/` | 스크린샷 9장. |
| `docs/analysis/agentdock-phase72-cinematic-motion.md` | 이 보고서. |

## 7. 변경 전후 비교

| 이미지 | 내용 |
|---|---|
| `docs/images/phase72/home-1280-before-after.png` | 홈 1280, 왼쪽 Phase 71, 오른쪽 Phase 72(정지 상태) |
| `docs/images/phase72/home-390-before-after.png` | 홈 390 전후 |
| `docs/images/phase72/hero-entrance-frames.png` | 0.4/1.0/1.8/2.6초 프레임. 엣지 그리기 → 허브 bloom → 신호가 레인에 도착 |
| `docs/images/phase72/home-1280-search-focus.png` | 검색 focus 때 신호 재생과 밝기 상승 |
| `docs/images/phase72/home-1280-dark.png` | 다크 모드 |
| `docs/images/phase72/typecard-sweep.png` | 타입 카드 hover와 빛 지나감 |
| `docs/images/phase72/row-hover.png` | 목록 행 hover의 hue 빛 |
| `docs/images/phase72/detail-1280-before-after.png` | 상세 상단 dot 배경과 glow 전후 |
| `docs/images/phase72/empty-1280-dark.png` | 빈 상태 glow |

움직임은 스크린샷만으로 판단할 수 없어 브라우저에서 `document.getAnimations()`와 View Transition pseudo 요소로 따로 확인했다(§9). 화면 녹화는 남기지 않았고, 대신 프레임 시퀀스 이미지를 남겼다.

## 8. 성능 영향

Phase 71 기준선을 같은 환경에서 다시 측정한 값과 비교했다(측정 2026-10-27).

| 항목 | Phase 71 | Phase 72 |
|---|---|---|
| client JS | 592,480B (gzip 181,997) | 592,480B (gzip 181,997) — 같음 |
| CSS | 47,111B (gzip 9,286) | 52,566B (gzip 10,240, **+954B**) |
| 홈 HTML | — | SVG 마크업 약 3KB 추가(서버 렌더) |
| LCP 요소 | 홈 데스크톱 H1, 모바일 P.lede | 같음(SVG 도형은 LCP 후보가 아니다) |
| LCP (ms, 1회) | 홈 D 200 / M 100 | 홈 D 72 / M 120 — 단일 측정이라 잡음 범위다 |
| CLS | 0, 상세 데스크톱 0.0972(기존) | 0, 상세 데스크톱 0.0972(기존과 같다) |
| long task 합(모바일 CPU×4) | 76–95ms | 76–83ms |
| 스크롤 프레임 p95 | D 16.8 / M 17.3ms | D 17.1 / M 17.3ms, 34ms 초과 0 |
| 유휴 2초 rAF | 122 | 122 |
| 콘솔 오류·가로 넘침 | 0 / 0 | 0 / 0 (5개 화면 × 2 viewport × 2 motion) |

- 홈 로드 직후 animation 수: 31→79(데스크톱), 24→69(모바일). 대부분 SVG 노드와 엣지의 1회 등장이다. 5.5초 시점에 실행 중인 것은 기존 스크롤 연동뿐이다(리뷰 반영 전 측정에서는 24개였고, 그중 섹션 rule 2개는 이후 제거했다).
- `stroke-dashoffset` 애니메이션은 compositor가 아니라 main thread paint가 필요하다. 그래도 4초 안에 끝나고, 모바일 CPU×4 long task 합이 기준선 범위 안이다.
- INP: 이 변경에는 이벤트 핸들러가 없다(JS 0B). 상호작용 반응은 CSS 상태(`:hover`, `:focus`)뿐이다. INP 자체는 측정하지 않았다(NOT RUN).

## 9. 접근성

- 장식 SVG는 `aria-hidden="true"`이고 `focusable="false"`이며 텍스트와 링크가 없다.
- 제목 열은 mask로 비워 텍스트 뒤에 선이 지나가지 않게 했다. 모바일은 opacity가 낮은 선이 제목 끝 근처에만 남는다.
- axe: 6개 페이지 × 라이트/다크 × 1280/390 = 24회, 위반 0(E2E 포함).
- reduce:
  - 모든 페이지 로드 직후 animation 0개.
  - 네트워크는 정지 상태로 보이고 신호는 보이지 않는다(정지 opacity 0).
  - 카드 빛 band는 카드 밖에 머문다(`overflow: hidden`).
  - morph 이름이 붙지 않고, 전환은 0.01ms다(§10 스크립트에서 확인).
- 5초 규칙: 기존 E2E "its motion ends"가 문서 타임라인의 모든 애니메이션 endTime ≤ 5,000ms를 검사하고 통과한다.

## 10. 테스트 결과

| 항목 | 결과 |
|---|---|
| `bun run ci` (boundaries, lint, typecheck, unit) | 리뷰 반영 후 최종: exit 0. unit 80 files, 1,556 passed, 2 skipped(Phase 71과 같은 2건) |
| `bun run build` | 리뷰 반영 후 최종: exit 0 |
| E2E (`bunx playwright test`) | 리뷰 반영 후 최종: **44/44** (Phase 71 43 + 신규 1) |
| 신규 E2E | "a row carries its name and badge to the detail heading, and only the row that was opened". 홈에서 focus 전에는 `artifact-name`이 0개이고 Latest read 링크나 행 링크에 focus하면 1개인지, 클릭하면 transition이 `artifact-name` old/new와 `artifact-badge` new를 animate하는지 검사한다. 3회 연속 통과. 이전 코드(Phase 71)에서는 focus 후 이름이 0개라 실패해야 하지만, 이전 빌드에서 직접 실행하지는 않았다. |
| morph 수동 확인 | 목록→상세, 홈 Latest read→상세, 홈 행→상세: 3경로 모두 이름·배지 group 380ms. 뒤로 가기 오류 0. reduce: 이름 없음, 전환 0ms. |
| 브라우저 | Chromium(Playwright)만. Safari·Firefox·실기기는 NOT RUN. |
| `/ponytail-review` | NOT RUN |

E2E 작성 중 발견: rAF 루프로 `getAnimations()`를 모으면 Playwright test runner에서는 transition 중 프레임을 놓쳤다(같은 코드가 독립 스크립트에서는 잡혔다). 그래서 `startViewTransition`의 `ready` 시점에 한 번 읽는 방식으로 바꿨고, 결과가 결정적이다.

## 11. PR Review 결과

PR Review Toolkit `code-reviewer`. CRITICAL 0, IMPORTANT 3, MINOR 6.

| 등급 | 지적 | 처리 |
|---|---|---|
| IMPORTANT | 검색창 blur 때마다 등장 신호(2회)가 다시 재생된다. focus 규칙이 `sig-run`을 목록에서 빼서, blur하면 새로 추가된 이름으로 다시 시작한다. | 수정. focus 규칙을 `sig-run …, sig-run-again …`으로 바꿨다. 브라우저 확인: focus 때 `sig-run-again` 3개, blur 직후와 1.5초 뒤 0개. |
| IMPORTANT | 정확히 1024px에서 `max-width: 64rem`과 `min-width: 64rem`이 동시에 적용된다. figure가 보이는데 신호가 숨고 모바일 mask가 적용된다. | 수정. `@media (width < 64rem)`로 바꿨다. 1024px에서 pulse가 `inline`이고 `.trace`가 `block`인 것을 확인했다. |
| IMPORTANT | 섹션 rule의 `view()` 대상이 2px짜리 `::after`라서 entry 구간이 2px뿐이다. 화면 하단에서 한 프레임 만에 그려진다. | 애니메이션을 제거하고 정적 rule만 남겼다. 이유는 주석에 적었다. |
| MINOR | 주석 "Last frame at 4.2 s"가 틀렸다(실제 4.0초). | 수정 |
| MINOR | 상세 상단 배경은 breadcrumb "뒤"가 아니라 "위"에 그려진다(겹치는 부분 opacity 20% 미만). | 주석을 사실대로 고쳤다. 시각 영향은 없다. |
| MINOR | 두 줄로 감기는 inline 링크는 view transition 캡처에서 빠질 수 있다. | 수용. 그 경우 배지만 morph되고 이름은 page-in으로 들어온다(transition은 중단되지 않는다). 현재 seed의 390px 목록에서는 25개 중 0개가 감긴다. Chromium에서 실제로 캡처가 빠지는지는 확인하지 않았다(PENDING). |
| MINOR | 1024–1279px에서 노드가 copy 끝 뒤에 겹칠 수 있다. | 1024px 스크린샷에서 겹침이 없음을 확인했다(`docs/images/phase72/`에는 넣지 않았다). |
| MINOR | 새 E2E가 Latest read 경로를 검사하지 않는다. | `.trace-name` focus 때 이름 1개 검사를 추가했다. |
| MINOR | 저장소 루트의 `.p72-*.mjs` 임시 스크립트 | 삭제했다(scratchpad로 옮겼다). |

## 12. 추가 개선 후보

- Safari·Firefox·실기기 확인. 특히 `mask-composite: intersect`와 SVG `vector-effect`의 렌더링.
- pointer 반응 grid: 필요하다면 client component 1개를 추가할지 별도로 결정한다(현재 규칙상 근거 필요).
- 상세 페이지 CLS 0.0972의 원인 조사(Phase 71부터 이어진 항목).
- 네트워크 노드 배치는 1280 기준이다. 1440 이상에서는 카드와 신호 도착점이 몇 px 어긋날 수 있다(viewBox가 hero 박스를 따라 늘어난다). 넓은 화면 전용 배치는 만들지 않았다.
