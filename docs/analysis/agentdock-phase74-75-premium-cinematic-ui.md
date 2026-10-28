# AgentDock Phase 74–75 — Premium Cinematic UI/UX

- 작성: 2026-10-28 (UTC 01:40 전후)
- 기준선: Phase 72, `d7622fc` (HEAD = origin/develop). 비교용 기준선 빌드는 `git archive d7622fc`로 scratchpad에 풀어서 따로 빌드했다(작업 트리는 건드리지 않음).
- 표기: FACT(직접 확인), INFERENCE(근거 있는 추정), PENDING(아직 확인 못 함), NOT RUN(실행하지 않음)
- commit, push, 배포, 운영 DB 접근, Secret/Variable 변경, workflow 실행은 하지 않았다.

## 1. 기존 디자인의 한계 (Phase 72 기준)

| 항목 | 한계 | 근거 |
|---|---|---|
| Hero 그래픽 | 서버 SVG 네트워크라 평면적이고, 처음 4초 뒤에는 멈춘다. 포인터에 반응하지 않는다 | `HeroSignal.tsx`(삭제됨), 스크린샷 `docs/images/phase72/home-1280-dark.png` |
| 색과 깊이 | 다크 팔레트가 중립 near-black(#0b0d10)이라 빛과 투명도로 층을 만들 바탕이 약하다 | `globals.css` `:root` |
| 라이트 모드 hero | hero가 페이지와 같은 흰 바탕이라 "무대"가 없다 | before 스크린샷 |
| 카드 | 고정된 hue 그라디언트, 한 번 지나가는 sweep뿐이다. 포인터 위치를 모른다 | Phase 72 §4 |
| 탐색 패널, 상세, Job | 평면 카드와 테두리 위주다. Job은 상태를 문장으로만 보여 준다 | before 스크린샷 |

## 2. 디자인 후보 비교

| 후보 | 장점 | 비용과 위험 | 판정 |
|---|---|---|---|
| A. Interactive 3D Artifact Universe | 6개 artifact 종류를 6개 군집으로 보여 줘 AgentDock의 의미와 맞는다. 포인터 시차와 선택 강조가 가능하다 | 3D 라이브러리를 쓰면 JS가 크게 는다(§7). 지속 모션이라 일시정지가 필요하다 | **채택**(직접 투영 Canvas 2D) |
| B. Cinematic Data Network | Phase 72의 연장선이다 | 72와 시각 차이가 작다. 요구사항 B(분명한 변화)를 만족하기 어렵다 | A의 "읽기 신호" 흐름으로 흡수 |
| C. Premium Abstract Visual | 정지 화면 완성도가 높다 | 의미가 없는 장식이다. 3D glass object는 이미지나 WebGL이 필요하다(CSP `img-src 'self'`) | 일부 결합: mesh 빛, glass 표면, 그라디언트 headline |

**선정: A + C 결합.** 공간은 A(3D universe, 궤도 링, 읽기 신호)로, 표면은 C(내비 무대, 보라와 파랑의 빛, glass)로 만들었다.

## 3. 선정한 디자인

- **톤:** Deep Navy / Graphite 바탕, Electric Blue(`--accent` #7da7ff)와 Violet(`--accent-2` #b9a0f5)을 두 개의 빛으로 쓴다.
- **Hero는 어떤 색 모드에서도 다크 무대다**(`.hero { color-scheme: dark }`). 라이트 모드 페이지에서도 hero만 어두운 띠로 보인다(`home-1440-light-before-after.png`).
- **층 구조(뒤→앞):**
  1. 무대 색과 universe canvas
  2. 파랑·보라·청록 mesh 빛
  3. dot grid
  4. 콘텐츠
  5. glass로 처리한 Latest read 카드
- **카드:** 포인터 위치를 따라가는 빛과 테두리 빛을 넣었다. Type 카드에는 최대 3° 기울임을 더했다(reduced-motion과 터치에서는 없음).

## 4. 실제 구현 내역

| 파일 | 변경 |
|---|---|
| `src/components/HeroUniverse.tsx` (신규, client) | Canvas 2D 3D 투영 universe. 고정 seed로 만든 132개 점, 군집 내 링크, 허브→core 곡선, 궤도 링 2개, 읽기 신호. 30fps 상한, DPR 1.5 상한. IntersectionObserver로 화면 밖에서 정지. 일시정지 버튼(localStorage 기억). reduced-motion에서는 정지 프레임 하나. hero의 type chip에 hover나 focus를 주면 해당 군집을 강조. `data-state`(`running`/`paused`/`still`) |
| `src/components/PointerGlow.tsx` (신규, client) | document `pointermove` 리스너 1개, rAF당 최대 1회 기록. 카드에 `--gx/--gy/--nx/--ny`를 쓴다. 터치는 무시. 렌더링 결과 없음 |
| `src/components/HeroSignal.tsx` | 삭제(Phase 72 SVG). 관련 CSS와 keyframes도 삭제 |
| `src/components/Icon.tsx` | `PauseIcon`, `PlayIcon` 추가 |
| `src/app/page.tsx` | `HeroSignal` → `HeroUniverse` (2줄) |
| `src/app/layout.tsx` | `<PointerGlow />` 추가, 주석 정정 |
| `src/app/jobs/[id]/page.tsx` | 장식용 진행 막대 `.job-track`(`aria-hidden`, `data-status`) |
| `src/app/globals.css` | 내비 팔레트, `--accent-2`/`--glow-c`/`--glass`/`--glass-edge` 토큰. `:root, .hero` 토큰 재선언. 아래 세부 항목 참고 |
| `e2e/journeys.spec.ts` | 테스트 2개 추가, 기존 테스트 주석 1곳 정정(단언은 그대로) |
| `CLAUDE.md`, `README.md` | client component 4개 → 6개 목록과 근거, 모션 정책 문장 |

`globals.css`에서 바꾼 부분은 다음과 같다.
- **공통:** body 고정 ambient 빛, glass header, footer 위쪽 빛 선
- **Hero:** hero 무대, universe 마스크, 일시정지 버튼, 그라디언트 headline, glass 검색창, 그라디언트 CTA, glass chip
- **카드:** Latest read glass, 행과 Type 카드의 포인터 빛과 테두리 빛, Type 카드 기울임
- **페이지:** 검색 패널, 활성 chip, 상세 헤더(큰 제목, 빛 선, 보라 glow), facts 패널, 빈 상태, Job 진행 막대

**`light-dark()` 함정 (FACT, 측정).** Chromium은 커스텀 속성 안의 `light-dark()`를 사용하는 곳이 아니라 **선언한 곳**에서 계산한다.
- 토큰을 `:root`에만 두면 `.hero { color-scheme: dark }`를 줘도 hero 안 `--fg`가 라이트 값(#16191d)으로 남았다.
- 토큰 블록의 선택자를 `:root, .hero`로 바꿔 hero에서 다시 계산하게 했다. 팔레트를 두 벌 둘 필요가 없다.

**바꾸지 않은 것 (FACT, diff 확인).**
- 콘텐츠와 텍스트, 데이터, 검색·필터·정렬·페이지네이션
- URL, API, DB, 인증, SEO 메타
- GitHub Actions와 workflow
- Phase 71 페이지 전환, Phase 72의 행→상세 morph
- Phase 69–70 보고서의 미커밋 변경

## 5. 변경 전후 스크린샷

`docs/images/phase74/`에 이미지 14장(1.6MB)과 영상 1개(1.4MB)가 있다.

| 파일 | 내용 |
|---|---|
| `home-1440-dark-before-after.png` | 홈 1440 다크 전후 |
| `home-1440-light-before-after.png` | 홈 1440 라이트 전후(hero는 다크 무대) |
| `home-390-before-after.png`, `home-390-light.png` | 모바일 390 |
| `home-1920-dark.png`, `home-1024-dark.png` | 1920과 1024 |
| `list-1440-before-after.png` | Artifacts 목록과 검색 패널 |
| `detail-1440-before-after.png` | 상세 헤더와 메타데이터 |
| `job-1440-before-after.png` | Job 진행 막대 |
| `hero-entrance-frames.png` | 등장 150 / 700 / 1400 / 3000 ms |
| `hero-chip-highlight.png` | "MCP Servers" chip hover 시 군집 강조 |
| `typecard-pointer-light.png`, `row-pointer-light.png` | 포인터 빛, 테두리 빛, 기울임 |
| `reduced-motion-home.png` | reduced-motion: 정지 프레임, 버튼 없음 |
| `walkthrough-1280.webm` | 약 15초 녹화: 등장, 포인터 시차, chip 강조, 카드 hover, 행→상세 morph |

## 6. 애니메이션 설명

| 분류 | 요소 | 동작 | 정지 조건 |
|---|---|---|---|
| 일회성 | Universe 등장 | core에서 바깥으로 1.8초 동안 펼쳐짐 | reduced-motion에서는 처음부터 완성된 상태 |
| 일회성 | 기존 CSS 등장(lane, 카드, flow, count) | Phase 60–72 그대로, 5초 안에 끝남 | reduced-motion에서는 선언되지 않음 |
| 상호작용 | 포인터 시차 | 포인터 위치에 따라 카메라가 최대 0.4 rad 기울어짐 | reduced-motion, 터치 |
| 상호작용 | chip hover/focus | 해당 종류 군집 2.6배, 나머지 0.25배 | 없음(정지 상태에서도 한 프레임 다시 그림) |
| 상호작용 | 카드 빛, 테두리 | 포인터를 따라감 | 터치(빛은 hover일 때만 보임) |
| 상호작용 | Type 카드 기울임 | 최대 3° | reduced-motion, `hover: none` |
| 지속형 | Universe 회전과 읽기 신호 | 0.07 rad/s, 30fps | 일시정지 버튼, 화면 밖, 숨은 탭, reduced-motion |
| 일회성 | 실행 중 Job 막대 | 로딩 sweep과 같은 1.4초 × 3회(4.2초). 리뷰 전에는 무한 반복이었다(§10) | reduced-motion에서는 선언되지 않음 |

삭제한 것: Phase 72 SVG 신호 애니메이션, Type 카드 sweep(포인터 빛으로 대체).

### Motion 정책 재검토 (요구사항 7)

| 정책 | 이전 | 이후 | 근거 |
|---|---|---|---|
| 5초 제한 | 모든 애니메이션 5초 이내(일시정지 버튼이 필요 없게) | CSS 애니메이션은 그대로 5초 이내다. 지속형은 universe 하나뿐이고 WCAG 2.2.2의 일시정지 장치를 갖춘다 | 2.2.2는 5초 넘게 자동으로 움직이는 콘텐츠에 일시정지·정지·숨김 장치를 요구한다. 버튼이 화면에 보이고 키보드로 닿으며(탭 순서상 hero 첫 요소), 선택이 기억된다 |
| client component 최소화 | 4개 | 6개 | CSS로는 포인터 좌표와 3D 투영을 얻을 수 없다. 둘 다 데이터를 갖지 않고 fetch하지 않는다. 증가분은 JS gzip +3.6KB(§8) |
| reduced-motion | keyframe은 no-preference 블록에만, transition은 토큰 | 그대로다. canvas는 같은 미디어 쿼리를 JS로 읽어 정지 프레임을 그린다 | `motion.test.ts` 통과(§9) |

기존 테스트는 지우거나 약하게 바꾸지 않았다. "모든 애니메이션 ≤ 5초" 테스트의 단언은 그대로이고, canvas가 그 대상이 아니라는 설명을 주석에 적었다. canvas는 새 테스트로 검증한다.

## 7. 사용 기술

**측정 (FACT, 2026-10-28):** scratchpad에서 각 패키지를 최소 사용 예로 묶고 `bun build --minify`, production define, `gzip -9`로 쟀다. React는 기존 사이트에 이미 있으므로 React 자체(56.8KB)를 뺀 증가분이다.

| 기술 | 추가 gzip | 판정 |
|---|---|---|
| three.js (points와 lines 장면) | +121.4KB | 기각: 사이트 JS 전체(182KB)의 +67% |
| React Three Fiber + three | +232.5KB | 기각 |
| Motion (`motion.div` 1개) | +41.3KB | 기각(Phase 57 측정과 같은 결론) |
| GSAP (tween 1개) | +27.6KB | 기각: 타임라인이 필요 없다 |
| **Canvas 2D 직접 투영 + CSS** | **+3.6KB**(새 client 컴포넌트 2개 포함, 사이트 전체 JS 기준) | **채택** |

필요한 것은 점 수백 개를 회전·투영해 그리는 일이다. scene graph, shader, timeline은 필요 없다.

## 8. 성능 변화

**자산 (FACT, `.next/static` 합계):**

| | Phase 72 | Phase 74 | 차이 |
|---|---|---|---|
| JS (14→15 파일) | 592,480 B (gzip 181,997) | 600,364 B (gzip 185,626) | +7,884 B (gzip +3,629) |
| 홈에서 로드하는 JS | 575,673 B | 583,557 B | +7,884 B |
| CSS | 52,566 B (gzip 10,240) | 56,803 B (gzip 10,895) | +4,237 B (gzip +655) |

**실측:** 홈, 다크, 각 3회 중앙값. 데스크톱은 1440×900 DPR1, 모바일은 390×844 DPR2에 CPU 4배 감속이다. CPU는 로드 2.5초 뒤 4초 동안 메인 스레드 TaskDuration의 비율이다.

| | LCP 요소 / 시간 | CLS | long task | CPU | JS heap | 대기 프레임 p95 | 스크롤 p95 / >34ms |
|---|---|---|---|---|---|---|---|
| 데스크톱 전 | H1 / 76ms | 0 | 0 | 3.1% | 4.0MB | 16.8 | 16.7 / 0 |
| 데스크톱 후, 동작 중 | H1 / 76ms | 0 | 0 | 8.5% | 4.5MB | 16.7 | 16.8 / 0 |
| 데스크톱 후, 일시정지 | H1 / 76ms | 0 | 0 | 2.1% | 4.7MB | 16.7 | 16.7 / 0 |
| 모바일 전 | P.lede / 128ms | 0 | 82ms | 1.8% | 3.6MB | 16.7 | 16.7 / 0 |
| 모바일 후, 동작 중 | P.lede / 132ms | 0 | 82ms | 26.4% | 4.9MB | 16.7 | 16.7 / 0 |
| 모바일 후, 일시정지 | P.lede / 108ms | 0 | 81ms | 1.9% | 4.4MB | 16.7 | 16.8 / 0 |

CPU 최적화 과정은 다음과 같다(FACT).

| 단계 | 데스크톱 | 모바일 |
|---|---|---|
| 60fps, 전체 폭 canvas, DPR 2 | 12.7% | 47.9% |
| 30fps, 데스크톱은 오른쪽 절반만, 모바일은 26rem×20rem | 8.4% | 32.2% |
| 링크 묶어 그리기, 화면 밖 점 생략 | 8.5% | 33.4%(변화 없음) |
| DPR 1.5 상한 | 8.5% | 26.4% |

모바일 26.4%를 나눠 보면, DPR 1과 2 비교에서 rAF 스크립트는 메인 스레드의 2.2%였다. 나머지는 headless Chromium의 **소프트웨어 래스터** 픽셀 비용이었다(DPR 1: 12.6%, DPR 2: 32.9%). GPU로 가속되는 실기기에서는 이 비용 대부분이 메인 스레드 밖으로 빠질 것으로 본다(INFERENCE, 실기기 NOT RUN).

**메모리:** heap +0.5~1.3MB. 30초 이상 장시간 증가 추이는 측정하지 않았다(NOT RUN). 프레임마다 배열을 새로 만들지만(projected 132개) 누적되는 참조는 없다.

**LCP, CLS:** LCP 요소는 그대로다(데스크톱 H1, 모바일 P.lede). 상세 페이지 CLS는 0.055 → 0.0445(1440)로 나빠지지 않았다(FACT). 다른 화면은 모두 0이다.

## 9. 테스트 결과

| 항목 | 결과 | 비고 |
|---|---|---|
| `bun run check:boundaries` | OK | verdict 어휘 스캔 34 UI 파일 |
| `bun run lint` | 오류 0, 경고 0 | 237 파일 |
| `bun run typecheck` | 통과 | |
| `bun run test` (`TEST_DATABASE_URL` 지정) | 80 파일, **1,557 통과**, 2 skip | 기준선 1,556 + 신규 1개(`motion.test.ts`: reduce 블록이 `--dur`를 선언하는 모든 선택자에 닿는지). skip 2개는 기준선과 같다 |
| `bun run ci` | exit 0 | 위 네 단계 |
| `bun run build` | 통과 | 리뷰 수정 뒤 마지막 빌드 |
| E2E (Playwright, Chromium) | **46/46, 전체 4회 연속** | 기존 44개 + 신규 2개(universe 일시정지·기억·정지 프레임, 포인터 빛·기울임). 기존 morph 테스트의 타이밍 경합을 고쳤다(§10) |
| axe (WCAG 2.2 AA + best-practice) | 위반 0 | 1280 라이트, 390 다크 × 5개 페이지. 라이트 모드의 다크 hero도 포함 |
| 브라우저 실측 | 1440·1920·1024·390, 다크·라이트, 홈·목록·상세·Job 성공/실패·빈 결과 | 가로 넘침 0, 콘솔 오류 0 |
| 키보드 | Tab 순서: skip link → brand → nav → **Pause** → 검색창 → Search → chip 7개 | 일시정지 버튼은 화면에서도 hero 오른쪽 위다 |
| Reduced motion | `data-state=still`, 버튼 없음, 포인터를 움직여도 픽셀 동일, Type 카드 기울임 없음, `getAnimations()` 0 | |
| NOT RUN | Safari, Firefox, 실기기, INP 직접 측정, 장시간 메모리, `/ponytail-review` | |

## 10. PR Review 결과

PR Review Toolkit `code-reviewer`로 성능, 접근성, 메모리 누수, hydration, 리스너 정리, 리렌더링, 모바일 UX, 회귀를 검토했다. 결과는 CRITICAL 1, IMPORTANT 1, MINOR 3이다.

| 등급 | 지적 | 조치 | 확인 |
|---|---|---|---|
| CRITICAL | `:root, .hero`가 `--dur`까지 다시 선언한다. 그래서 `:root`만 덮는 reduce 블록이 hero 안에 닿지 않아, 모션을 줄인 사용자에게도 hero 검색창·chip·카드 transition이 120/180ms로 재생됐다. `max-width: 40rem`의 `--t-2xl` 덮어쓰기도 같은 문제였다 | 두 미디어 블록의 선택자를 `:root, .hero`로 바꿨다. `motion.test.ts`에 회귀 테스트를 추가했다(`--dur`를 선언하는 모든 선택자가 reduce 블록에 있어야 함) | 수정 전 CSS에서 새 검사가 실패하고 수정 후 통과하는 것을 확인했다. 브라우저에서도 reduce일 때 hero input·chip·trace-card `transition-duration`이 `1e-05s`, no-preference일 때 0.12/0.18s였다(FACT) |
| IMPORTANT | CLAUDE.md와 README가 client component 4개라고 적고 있었다. PointerGlow에 client로 만든 이유가 없었다 | 리뷰와 동시에 6개 목록과 근거로 고쳤다. PointerGlow 주석에 "CSS에는 포인터 좌표가 없다"는 근거를 추가했다 | diff 확인 |
| MINOR | paused/still 상태에서 chip을 강조하려고 다시 그릴 때마다 카메라가 포인터 쪽으로 6%씩 움직였다 | `dt > 0`일 때만 포인터를 따라가게 했다 | e2e reduced 구간에서 픽셀 동일 |
| MINOR | 프레임마다 객체 약 420개를 할당한다(투영 결과와 궤도 링) | **보류.** 스크립트 비용이 메인 스레드의 2.2%이고, heap 증가가 0.5~1.3MB로 쌓이지 않았다(§8). `Float32Array` 재사용은 코드가 길어져서 실측 문제가 생기면 한다 | — |
| MINOR | 실행 중 Job 막대 sweep이 무한 반복이고 일시정지 장치가 없었다 | 3회(4.2초)로 제한했다. 5초 규칙 안이다 | CSS diff |

리뷰에서 문제없다고 확인한 항목:
- `setPaused`는 같은 값이면 React가 다시 렌더링하지 않는다.
- 버튼은 마운트한 뒤에만 그려서 hydration 불일치가 없다.
- label-in-name: aria-label "Pause background animation"이 화면 글자 "Pause"를 포함한다.
- RO, IO, matchMedia, 리스너 5개, rAF를 모두 정리한다.
- h1은 `color`가 `--fg-strong`으로 남고 forced-colors를 처리한다.
- morph 규칙은 바뀌지 않았다.
- verdict 어휘 스캔을 통과했다.

**E2E 타이밍 경합 (FACT).**
- 증상: 리뷰 수정 뒤 전체 suite에서 Phase 72의 행→상세 morph 테스트가 3회 중 2회 실패했다(`::view-transition-old(artifact-name)` 없음). 단독으로 15회 돌리면 모두 통과했다.
- 원인: 테스트가 새 h1을 확인한 직후 `ready` 콜백 결과를 한 번만 읽는다. 새 h1은 `ready`보다 먼저 DOM에 들어온다. 병렬 worker에서 hero canvas가 CPU를 나눠 쓰면서 이 경합이 드러난 것으로 본다(INFERENCE).
- 조치: 수집 배열이 찰 때까지 poll로 기다리게 했다. 세 단언은 그대로라 transition이 중단되면 여전히 실패한다.
- 결과: 그 뒤 전체 suite를 4회 연속 돌려 모두 46/46 통과했다.

## 11. 남은 개선 사항

1. **실기기와 다른 브라우저 확인.** Safari와 Firefox에서 `mask-composite`, `backdrop-filter`, canvas `lighter` 합성, `light-dark()` 재선언 동작을 확인해야 한다. 실기기 CPU와 배터리 영향도 아직 보지 못했다.
2. **모바일 CPU.** headless 소프트웨어 래스터에서 26.4%다. 실기기에서 높게 나오면 모바일 프레임 상한을 20fps로 내리는 방안이 있다(`HeroUniverse.tsx`의 `ponytail:` 주석).
3. **Universe의 데이터 연결.** 지금은 고정 seed로 만든 장식이다. 종류별 실제 개수를 군집 크기에 반영하려면 홈의 `countVisibleByType` 결과를 prop으로 넘기면 된다(client component가 데이터를 갖게 되므로 결정 필요).
4. **1440px 이상에서 hero 확대.** shell이 72rem이라 headline 크기는 3.5rem에서 멈춘다. 더 크게 하려면 hero만 shell 밖으로 넓히는 별도 결정이 필요하다.
5. **상세 페이지 CLS 0.04~0.05의 원인 조사.** Phase 72부터 있던 값이다.
