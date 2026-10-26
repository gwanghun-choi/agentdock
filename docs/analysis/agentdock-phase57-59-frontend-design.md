# AgentDock Phase 57–59 — Frontend Design · Visual Identity · Detail Experience

작성일 2026-10-26 · 기준 commit `73df119` (HEAD = origin/develop) · 변경은 작업 트리에만 있고 commit하지 않았다

표기: **FACT**는 직접 측정·실행한 결과, **INFERENCE**는 측정에서 추론한 것, **PENDING**은 배포 후 확인이 필요한 것, **NOT RUN**은 실행하지 않은 것이다.

측정 조건: 로컬 production build(standalone), E2E seed DB(`agentdock` schema, 250 artifacts), `prefers-reduced-motion: reduce`, before는 `73df119` 빌드(:3971), after는 작업 트리 빌드(:3972)다.

---

## 1. 핵심 결론

**운영 미배포 (FACT)**
- Phase 54–56 commit `73df119`은 운영에 배포되지 않았다. 운영 `x-agentdock-commit`은 아직 `3a0dcb7`이다.
- 원인은 GitHub CI run 40292716368의 e2e job 실패다.
  - 실패한 단언은 `on a phone › the first result is on the first screen at 390…`이고, 첫 결과 하단이 848.45 > 844였다.
  - 그래서 Deploy run은 skipped됐다.

**CI 실패 원인과 수정 (FACT)**
- 로컬 머신은 sans·mono를 모두 Noto Sans CJK로 해석한다. 이 mono는 글자 폭이 0.5em으로 좁다.
- CI runner는 DejaVu Sans Mono(0.6em)를 쓴다. SF Mono·Menlo·Roboto Mono도 0.6em 안팎이다.
- 폭이 넓은 mono에서는 첫 결과의 경로가 한 줄 더 감긴다.
- fontconfig로 DejaVu를 강제하자 before 빌드에서 848.5가 재현됐다. CI 값은 848.45다.
- 휴대폰 행의 상하 padding을 16→12px로 줄였다. 같은 조건에서 840.5가 되고, E2E는 CI 서체 조건에서 39/39 통과했다.

**디자인 (FACT)**
- frontend-design Skill을 실제로 호출해 방향을 정했다(§3).
- **서체:** 자체 호스팅 서체 Schibsted Grotesk(OFL-1.1, 46,752B)로 OS마다 달라지던 서체를 하나로 고정했다.
- **장식 제거:** 근거 없는 장식인 hero의 dot grid, 파랑·보라 orb, 48초 drift를 걷어냈다.
- **모션 정리:** 반복·자동 재생 애니메이션 6종을 지웠다.
- **라벨:** 전부 대문자로 쓰던 라벨을 문장형 대소문자로 바꿨다.

**상세 페이지 버그 (FACT)**
- 상세 페이지의 목차와 원문 목차 링크 6종을 누르면 이동한 제목이 sticky header(57px) 아래 y=24에 가려졌다.
- 수정 후에는 y=80에 놓인다.

**첫 Artifact 위치 (FACT)**
- 1280에서 670 → 646, 390에서 773 → 755다.
- 기준선보다 아래로 밀린 화면은 없다.

**회귀 (FACT)**
- test 1,536 passed / 2 skipped(기준선과 같다)
- E2E 39/39(38 + 신규 1)
- search:eval 54/54(지표가 Phase 54와 동일), multilingual 15/15(출력 동일)
- axe 28회 위반 0건
- JS 바이트, client component 4개, DB query 수 모두 그대로다.

## 2. Git 기준

| 항목 | 값 |
|---|---|
| HEAD | `73df119 feat(ui): put search and real artifacts on the first screen` |
| origin/develop | `73df119` |
| Production | `x-agentdock-commit: 3a0dcb7356c4…` (2026-10-26 읽기 전용 HTTP) |
| CI `73df119` | run 40292716368: check success / database success / **e2e failure** |
| Deploy `73df119` | skipped (CI 실패로) |
| 작업 시작 시 작업 트리 | clean |

요청서에 적힌 "Phase 54–56 배포 버전 기준"은 실제로 운영에 존재하지 않는다. 그래서 비교 기준은 로컬 `73df119` 빌드로 잡았다.

## 3. frontend-design 호출 확인

- **첫 호출 (FACT):** `Skill(frontend-design:frontend-design)`을 호출했지만 `Unknown skill`로 실패했다.
  - 플러그인은 2026-10-26 17:30(KST)에 설치됐고, 세션은 그보다 먼저 시작돼 로드되지 않은 상태였다.
  - SKILL.md를 직접 읽어 대신하지 않고 작업을 멈췄다.
- **재호출 (FACT):** 사용자가 플러그인을 다시 로드한 뒤 다시 호출했고 `Launching skill: frontend-design:frontend-design`로 로드됐다.

적용한 Skill 원칙과 그 결과는 다음과 같다.

| Skill 원칙 | 적용 |
|---|---|
| 주제에서 디자인을 끌어낸다 | AgentDock의 고유 정보는 "정확한 commit에서 읽은 파일"이다. 그래서 정체성은 질감이 아니라 서체와 저장소·SHA·경로 주소(mono)로 표현했다. |
| 서체를 의도적으로 고른다. system 기본값을 쓰지 않는다 | 후보 4종(Schibsted Grotesk, Public Sans, Instrument Sans, Hanken Grotesk)과 현재 system-ui를 실제 문구로 렌더해 비교했다. 편집 디자인에서 나온 Schibsted Grotesk를 골랐다. |
| 생성형 디자인의 상투적 특징을 피한다 | 다음 두 가지를 제거했다. ① 그라디언트 wash + dot grid 장식 ② 전부 대문자이고 자간을 넓힌 라벨(TYPE, DESCRIPTION, LICENCE…) |
| 비사용자 모션은 아껴서 쓴다. 섹션마다 fade-up은 쓰지 않는다 | 모든 블록의 page-rise, 행 stagger, 무한 beam·glow·drift를 삭제했다. |
| 대담함은 한 곳에만 쓴다 | hero 제목에만 700 weight, −0.032em, line-height 1.05를 줬다. 나머지는 조용하게 둔다. |
| 품질 하한(반응형, focus, reduced motion, 접근성) | axe 0건, focus ring, reduced-motion 계약(motion.test)을 유지했다. |
| 화면을 찍어 스스로 비평한다 | before/after를 캡처해 검토했다. 그 과정에서 발견한 문제는 아래 두 가지다. |

검토 중 발견한 문제:
- "38.6k"가 "38 .6k"처럼 벌어졌다. Schibsted의 tabular 마침표가 숫자 폭으로 그려지기 때문이다. `.row-stars`의 tabular-nums를 제거했다.
- 모바일 목차의 nowrap이 뒤쪽 규칙에 덮여 적용되지 않았다. 규칙 위치를 옮겼다.

## 4. 기존 디자인 분석 (FACT, `73df119`)

- **토큰:** 표면 4단계(bg/surface/surface-2/surface-3)와 band, 텍스트 4단계, accent 4개가 있다. 모두 `light-dark()` 한 선언으로 두 모드를 처리한다. 대비는 이미 측정·기록돼 있다(--faint 5.24/5.88:1). 잘 정리돼 있어 색 토큰은 바꾸지 않았다.
- **서체:** `ui-sans-serif, system-ui …` stack이라 OS마다 다른 서체로 렌더된다. 이 머신에서는 Noto Sans CJK였고, Windows는 Segoe UI, macOS는 SF다.
  - 브랜드가 기기마다 다른 제품처럼 보였다.
  - E2E 기하도 기기마다 달라졌다. 이것이 §1의 CI 실패와 같은 뿌리다.
- **장식:**
  - hero에 dot grid(마스크 처리), 파랑·보라 blur orb 두 개, 48초 무한 drift가 있었다.
  - 보라는 사이트 전체에서 이 장식에만 쓰이는 두 번째 색이었다.
- **모션:** keyframe 10종이 있었다.
  - 모든 페이지·블록의 page-rise(내비게이션마다 320ms 지연)
  - 행 stagger
  - 무한 반복인 connector beam(5.4s), stage glow(6s), wash drift(48s)
  - Phase 54 이후 IndexFlow는 첫 화면 밖에 있어서, 그 reveal은 대부분 보이지 않는 곳에서 재생됐다.
- **라벨:** facet legend, facts dt, 표 머리글, stats dt가 대문자 + 0.04–0.06em 자간이었다. "DESCRIPTION"이 옆의 칩보다 넓어 시선을 끌었다.
- **상세 페이지:** 목차 칩 8개가 390에서 2줄, 320에서 3줄로 감겼다. anchor 이동은 6종 모두 header 아래에 가려졌다.
  - 측정값: target y=24, header 하단 57
  - E2E는 `toBeInViewport()`만 검사해서 이 문제를 잡지 못했다.

## 5. 디자인 방향

**Provenance-first technical editorial.** 색은 측정된 기존 팔레트를 유지한다. 정체성은 다음 세 가지에서 나온다.

1. **서체 하나:** Schibsted Grotesk가 UI, 본문, 제목을 모두 맡는다.
2. **주소는 mono:** 저장소, SHA, 경로는 문자 그대로의 코드라서 mono를 정당하게 쓴다. 장식용 데이터 라벨에는 쓰지 않는다.
3. **장식은 없다:** 남는 구조(테두리, 칩, 배지)는 전부 정보를 담는다.

| 축 | 결정 |
|---|---|
| Canvas / Ink | `#fcfcfd`/`#0b0d10`, `#16191d`/`#e6e8eb` 유지(측정된 AA) |
| Accent | Commit blue `#1a56b8`/`#7aa7f0` 하나. 보라 제거 |
| 의미 색 | artifact type 6색만(기존) |
| Type | Schibsted Grotesk 400–900 variable. 제목 −0.02em, hero −0.032em/700/1.05 |
| Labels | 문장형 대소문자, `--muted`, 500 |
| Layout | 기존 단일 열, 왼쪽 정렬 유지 |
| Motion | 사용자 행동에 대한 응답(전환 토큰)과 로딩 sweep, flow의 한 번의 reveal만 |

**계획을 다시 검토하며 바꾼 점:**
- 첫 안은 hero wash를 약하게 유지하는 것이었다. 하지만 Skill의 상투적 목록 ①과 겹치고 정보도 없어서 완전히 제거했다.
- sticky 목차도 검토했지만 채택하지 않았다. 휴대폰에서 header 56px에 목차 약 44px이 더해져 첫 화면의 12%를 상시 차지하기 때문이다. 대신 한 줄 스크롤 목차와 anchor 수정으로 해결했다.

## 6. 디자인 토큰 변경

| 토큰 | 변경 |
|---|---|
| `--sans` | 맨 앞에 `var(--font-brand)` 추가(next/font/local이 정의). CJK 등 latin 밖의 글자는 기존 stack으로 fallback |
| `--grid-dot`, `--hero-wash-a`, `--hero-wash-b` | 삭제(사용처 제거) |
| `--dur-slow`, `--ease-emphasized` | 유지(flow reveal·count-up이 사용) |
| 색·간격·radius·shadow | 변경 없음 |

`html { scroll-padding-top: 3.5rem }`을 추가했다. header 높이와 같다. 기존 `#main [id] { scroll-margin-top: 24px }`과 합쳐져 이동한 제목이 y=80에 놓인다.

## 7. Homepage

| 항목 | before | after |
|---|---|---|
| hero 배경 | dot grid + orb 2개 + 48s drift | 없음(canvas) |
| 제목 | system-ui 660 | Schibsted 700, −0.032em, lh 1.05 |
| 첫 Artifact y, 1280×800 | 670 | **646** |
| 첫 Artifact y, 390×844 | 773 | **755** |
| 첫 Artifact y, 375 / 320 / 768 | 773 / 820 / 690 | 755 / 802 / 673 |
| 검색창 y, 1280 / 390 | 380 / 353 | 357 / 335 |

Phase 54의 단일 Recently indexed 목록, hero 검색창, 유형 칩, 행 구성은 그대로 두었다.

## 8. Search

- 검색어, 결과 수, 필터, 정렬, 행의 위치는 바뀌지 않았다. 1280 기준 첫 결과 y=578로 같다.
- facet 이름(Type, Description, Capability, Sort)은 대문자 xs/faint에서 문장형 sm/muted/500으로 바꿨다. 칩보다 덜 튀고 더 읽기 쉽다.
- 휴대폰 행의 상하 padding을 16→12px로 줄였다.
  - 결과 목록 높이: 390에서 5,936 → 5,775px, 320에서 7,055 → 6,894px
  - 첫 결과 하단: 로컬 834.1, CI 서체 840.5(이전 848.5)
- 별 개수는 proportional로 바꿨다(§3).
- 긴 이름과 다국어 설명: 6개 폭 × 5개 화면에서 가로 넘침 0. E2E의 320px 긴 이름 테스트도 통과했다.
- CJK는 시스템 서체로 fallback하므로 서체 변경의 영향이 없다(INFERENCE: latin subset만 vendor했다).

## 9. Detail

| 항목 | before | after |
|---|---|---|
| anchor 이동(목차·원문 목차·#file-L 공유 링크) | y=24, header 아래에 가려짐 | **y=80**, 6/6 보임 |
| 목차 칩, 390 / 320 | 2줄 / 3줄 | 1줄 가로 스크롤(8개 모두 도달 가능) |
| 원문 본문 y, 390 / 320 | 5,076 / 6,417 | 4,981 / 5,893 |
| facts 라벨 | 대문자 xs faint | 문장형 sm muted |

- 원문 목차, 설치 안내, 원본·commit 링크, 복사 버튼은 모두 그대로다.
- 설치 명령을 새로 만들지 않았다.

## 10. Mobile (FACT, 320 / 375 / 390 / 768)

| 화면 | 320 | 375 | 390 | 768 |
|---|---|---|---|---|
| 홈 첫 Artifact | 820→802 | 773→755 | 773→755 | 690→673 |
| 검색: 검색창 / facets / 결과 수 / 정렬 / 첫 결과 | 266/324/532/573/624 | 246/304/512/552/603 | 246/304/512/552/603 | 252/310/570/611/654 |
| 검색 첫 결과 보이는 높이 | 0 | 64 | 215→208 (전체) | 167→168 |
| 가로 넘침 | 0 | 0 | 0 | 0 |

- 검색 화면의 위치값은 전후가 같다. 범위 안내문과 필터는 그대로 두었다.
- 390의 첫 결과 보이는 높이가 215→208로 줄어든 것은 행 padding을 줄여 행 자체가 짧아졌기 때문이다. 결과 전체는 여전히 보인다.

## 11. Light / Dark

- light 3화면 × 2폭, dark 3화면 × 2폭을 before/after 모두 캡처했다(24장, §13).
- axe(색 대비 포함)를 1280 light/dark, 390 light/dark에서 7개 페이지씩 돌렸고, 28회 모두 0건이었다.
- 바뀐 라벨 색 `--muted`(#5c636b / #9aa2ab)는 기존 `--faint`보다 대비가 높다.
- focus ring은 `--ring` 토큰을 그대로 쓴다. 가로 스크롤 목차 안에서도 4px padding 덕분에 ring이 잘리지 않는다(code-reviewer 확인).

## 12. 접근성

- axe-core 4.14.0, WCAG 2.2 AA + best-practice: before 28회 0건, after 28회 0건(FACT)
- anchor 이동이 header에 가려지던 문제를 수정했고 E2E로 고정했다.
- 모션이 줄었다. reduced-motion을 요청하지 않은 사용자도 내비게이션마다 생기던 320ms 등장 지연과 무한 반복 모션이 없다.
- NOT RUN: 스크린리더 실기 낭독, 실기기 확인

## 13. 스크린샷 — `docs/images/phase57/` (24장, 912KB, 128색 양자화)

`{before|after}-{home|search|detail}-{1280|390}-{light|dark}.png`

- **home:** hero 배경 장식이 사라지고 제목이 서체로 존재감을 가진다. 첫 행이 24px 위로 올라왔다.
- **search:** 대문자 라벨이 문장형이 됐다. 390에서 행이 더 촘촘하다.
- **detail:** 390에서 목차가 한 줄이 됐다. facts 라벨이 문장형이다.

README의 `docs/images/agentdock-home.png`도 새 화면으로 바꿨다(758KB → 483KB).

## 14. 성능 (FACT, 같은 seed, 각 25회 중 뒤 20회 p50)

| 항목 | before | after |
|---|---|---|
| 홈 HTML / gzip | 116,635 / 13,172 | 117,077 / 13,359 |
| 검색 HTML / gzip | 200,182 / 16,681 | 200,597 / 16,818 |
| 상세 HTML / gzip | 91,756 / 14,183 | 92,171 / 14,390 |
| CSS / gzip | 40,123 / 7,878 | **37,849 / 7,531** |
| JS (8 files) / gzip | 575,673 / 176,556 | 575,673 / 176,556 |
| 서체 | 0 | **+46,752 (woff2, 같은 origin, `Link: rel=preload`, immutable 캐시)** |
| p50 홈 / 검색 / 상세 | 6.3 / 9.7 / 14.1 ms | 6.2 / 8.3 / 13.2 ms (잡음 범위) |
| client component | 4 | 4 |
| DB query | 변경 없음(데이터 코드 미변경) | |

- HTML이 약 440B 늘었다. html class와 `--font-brand` 정의 때문이다.
- 첫 방문 전송량은 약 +44KB(gzip 기준)다. 정체성과 기기 간 레이아웃 일관성을 얻는 비용으로 받아들였다. CI 실패도 같은 서체 차이에서 나왔다.
- 서체는 `display: swap`과 크기를 맞춘 Arial fallback(next/font가 자동으로 `size-adjust` 등 계산)을 써서 layout shift를 줄였다.

## 15. 테스트 결과 (FACT)

| 검사 | 결과 |
|---|---|
| `bun run check:boundaries` | OK |
| `bun run lint` | 231 files, 0 errors |
| `bun run typecheck` | OK |
| `bun run test`(test DB) | 80 files, **1,536 passed / 2 skipped**. skip 2건은 기존 조건부 |
| `bun run build` | OK |
| E2E(로컬 서체) | **39/39** |
| E2E(CI 서체 재현: fontconfig → DejaVu) | **39/39** |
| search:eval | 54/54. 품질 지표 JSON이 Phase 54와 같고 latency만 다르다 |
| search:eval:multilingual | 15/15. 출력이 Phase 54와 같다 |
| axe | 28회, 0건 |

테스트 변경 내역:
- `motion.test.ts`의 guard를 `>10` → `>5`로 바꿨다. 남은 사이트가 8개(animation 4 + @keyframes 4)라서이며, 빈 매칭을 막는 목적은 그대로다.
- E2E 강화 1: 원문 목차와 `#versions` 이동 후 제목 y ≥ header 높이를 확인한다. 이전 코드에서는 실패한다(y=24 < 57).
- E2E 신규 1: 휴대폰에서 목차 8개가 한 줄이고 마지막 링크로 이동하는지 확인한다.

## 16. PR Review Toolkit 결과

`/pr-review-toolkit:review-pr`을 실행해 code-reviewer, comment-analyzer, pr-test-analyzer를 병렬로 돌렸다. error handling과 type은 변경이 없어 해당 리뷰는 제외했다.

| 리뷰 | 등급 | 지적 | 조치 |
|---|---|---|---|
| code | IMPORTANT | connector의 beam gradient가 애니메이션 없이 남아 연결선 끝에 accent 반 그라디언트를 고정으로 그림 | 두 곳 모두 `background: var(--border-strong)`만 남김 ✅ |
| code / comment | IMPORTANT | `IndexFlow.tsx`·`IndexFlow.test.tsx` 주석이 지운 beam/pulse/spine을 설명 | 현재 구조(connector, stage number)로 수정 ✅ |
| comment | IMPORTANT | 모바일 `.toc` 주석이 cascade 순서를 반대로 설명 | 바로잡음 ✅ |
| comment | IMPORTANT | "plus one background-position"이 사실과 다름 | 삭제 ✅ |
| comment | IMPORTANT | "a spine drawing itself"(globals.css, motion.test.ts) | "the flow's stages arriving"으로 수정 ✅ |
| comment | IMPORTANT | `.row-stars` 주석이 규칙 없이 떠 있음 | "No `.row-stars` rule: …"로 다시 씀 ✅ |
| comment | SUGGESTION | "eight section links", "one reveal" 표현 | "up to eight", reveal 구성 명시 ✅ |
| tests | 4/10 | `#versions` 클릭 후 URL을 기다리지 않음 | `toHaveURL(/#versions$/)` 추가 ✅ |
| tests | 5/10 | 링크 1개면 한 줄 단언이 저절로 통과 | `toHaveCount(8)` 추가 ✅ |
| tests | 3/10 | 서체 적용 여부·tabular 회귀 테스트 없음 | 보류(비용 대비 효과 낮음) |

- CRITICAL은 0건이었다.
- 재검증으로 lint, ci(1,536), E2E 39/39(두 서체 조건), axe 0건을 다시 돌렸다.
- 리뷰와 별도로 직접 찾은 CRITICAL 1건: CI e2e 실패로 배포가 막혀 있었다(§1). 이것을 수정했다.

## 17. 변경 파일

| 파일 | 내용 |
|---|---|
| `src/app/layout.tsx` | `next/font/local` brand face, `--font-brand` |
| `src/app/fonts/SchibstedGrotesk-latin-wght.woff2`, `OFL.txt` | 신규. @fontsource-variable/schibsted-grotesk 5.3.0의 latin wght 파일과 라이선스. 의존성으로는 추가하지 않음 |
| `src/app/globals.css` | font stack, scroll-padding, hero 장식·토큰 삭제, 애니메이션 6종 삭제, 라벨 문장형, 모바일 목차·행 padding, connector 정리 |
| `src/app/motion.test.ts` | guard 기준값과 주석 |
| `src/components/IndexFlow.tsx`, `IndexFlow.test.tsx` | 오래된 주석 수정 |
| `e2e/journeys.spec.ts` | anchor 단언 강화, 휴대폰 목차 테스트 |
| `README.md`, `README.en.md` | 모션·서체 문단 |
| `docs/images/agentdock-home.png` | 새 홈 화면 |
| `docs/images/phase57/` | 전후 24장 |
| `docs/analysis/agentdock-phase57-59-frontend-design.md` | 이 보고서 |

합계: 추적 파일 9개(+145/−320)와 신규 4종이다.

## 18. 보류 사항

| 항목 | 이유 |
|---|---|
| 상세 페이지의 원문 본문 위치(390에서 y≈4,981) | 섹션 순서 변경은 정보 구조 결정이다. 한 줄 목차와 anchor 수정으로 한 번에 갈 수 있게 했다. 순서는 사용자 결정 |
| sticky 목차 | 휴대폰 첫 화면의 약 12%를 상시 차지 |
| 범위 안내문 휴대폰 축소(320에서 약 130px) | 고지 문구라 사용자 결정(Phase 54부터 보류) |
| mono 서체 vendor | 경로 줄바꿈이 기기마다 다른 원인이다. 행 padding으로 CI 조건을 맞췄고, 추가로 약 30KB가 든다 |
| 상세 summary lede의 휴대폰 크기(18px, 6줄) | 측정상 문제가 아님. 밀도 조정 후보 |
| tabular 회귀·서체 적용 테스트 | 리뷰 3/10 |

## 19. Git Status

```
 M README.en.md
 M README.md
 M docs/images/agentdock-home.png
 M e2e/journeys.spec.ts
 M src/app/globals.css
 M src/app/layout.tsx
 M src/app/motion.test.ts
 M src/components/IndexFlow.test.tsx
 M src/components/IndexFlow.tsx
?? docs/analysis/agentdock-phase57-59-frontend-design.md
?? docs/images/phase57/
?? src/app/fonts/
```

## 20. 권장 Commit

```bash
cd ~/workspace_auto/agentdock
git add README.md README.en.md docs/images/agentdock-home.png docs/images/phase57 \
  docs/analysis/agentdock-phase57-59-frontend-design.md e2e/journeys.spec.ts \
  src/app/fonts src/app/globals.css src/app/layout.tsx src/app/motion.test.ts \
  src/components/IndexFlow.tsx src/components/IndexFlow.test.tsx
git commit -m "feat(ui): self-hosted typeface, quieter motion, and anchors that clear the header" -m "Set every page in Schibsted Grotesk (OFL-1.1, one 46,752-byte latin variable woff2 via next/font/local, same origin). Remove the hero dot grid, orbs and drift, and the page-rise, row stagger, beam and glow animations. Labels move to sentence case.

In-page jumps landed headings at y=24 under the 57px sticky header; scroll-padding-top puts them at y=80, asserted in e2e. The detail page's section links are one scrolled line on phones.

Fix the e2e failure that blocked 73df119 from deploying: CI's DejaVu Sans Mono wraps the first result's path, putting its bottom at 848.5 on an 844px screen. Phone rows use 12px vertical padding (840.5). Reproduced locally with fontconfig; e2e passes 39/39 with both local and CI fonts.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## 21. 다음 작업

1. **push 후 CI e2e green을 확인한다(PENDING).** 운영 `x-agentdock-commit`이 새 commit인지 보고, 운영 홈의 첫 Artifact 위치와 서체 적용을 확인한다.
2. CI에 서체를 고정하는 방법을 검토한다. 예를 들어 E2E 단계에서 fontconfig를 고정하면 로컬과 CI 기하가 같아진다.
3. 상세 페이지 섹션 순서(원문 본문 위치)를 사용자가 결정한다.
4. 범위 안내문의 휴대폰 표시 방식을 사용자가 결정한다.
5. Actions secret 교체와 언어 generated column migration(승인 필요)은 이전 Phase부터 남아 있다.

---

## 22. 커밋 전 보완 — 모바일 E2E의 서체 민감도 (2026-10-26)

### 22.1 측정 (FACT)

첫 검색 결과(`/artifacts?q=review`)를 다음 조합으로 측정했다.

- 서체: 로컬 서체 / CI 서체(fontconfig → DejaVu)
- 웹폰트: 정상 / woff2 차단(크기를 맞춘 Arial fallback)
- viewport: 360×800, 375×667, 390×844, 412×915, 430×932

| 390×844 | top | 제목 하단 | 설명 하단 | 행 하단 |
|---|---|---|---|---|
| 로컬 서체 | 603.5 | 672.5 | 718.1 | 826.1 |
| CI 서체 | 603.5 | 672.5 | 718.1 | **840.5** |
| CI 서체 + 웹폰트 차단 | 603.5 | 672.5 | 718.1 | 840.5 |

- **웹폰트 로딩:** brand 서체는 `load` 시점에 이미 `loaded`였다(`Link: rel=preload`). `document.fonts.ready`를 기다려도 값이 같았다.
- **행 하단의 변동 원인:** 행의 마지막 약 110–120px은 경로가 든 메타 줄이다. mono 폭에 따라 이 높이가 기기마다 달라진다.
- **360×800(흔한 Android 폭):** 행 전체는 모든 조건에서 −40px로 화면을 넘는다. 설명 하단은 81.9px 여유가 있다. 단, CI 서체 + 웹폰트 차단 조건에서는 766.1로 여유가 33.9px다.
- **기존 테스트의 허점:** loading 자리표시(`loading.tsx`)도 `ul.rows > li`라서, `load` 이후에도 DOM에 남은 자리표시를 측정할 수 있었다. 이때 하단은 213이고 테스트는 공허하게 통과한다.

### 22.2 기준 선택

| 기준 | 판단 |
|---|---|
| A. 시작 부분이 보인다 | 너무 약하다. Phase 54 이전의 3.7px도 통과한다. 375×667에서만 유지한다(Phase 54가 문서화한 목표). |
| **B. 주요 정보(유형, 이름, 저장소, 설명)가 보인다** | 제품 요구("검색과 실제 Artifact를 함께 보고 빠르게 비교")에 맞는다. 서체·로딩 조건과 무관하게 718.1로 같다. **채택** |
| C. 행 전체가 보인다 | 페이지가 아니라 기기의 mono를 측정한다. CI에서 3.5px 여유이고, 360에서는 서체와 무관하게 실패한다. 채택하지 않는다. |

**B만으로는 부족했다.** 여유가 126px라서, Phase 54 이전 레이아웃을 일부 되돌리는 mutation을 놓쳤다. 세로로 쌓인 검색 버튼(+48)과 다시 보이는 field label(+41)이다.

그래서 행 top ≤ 625 가드를 추가했다.
- top은 결과 목록 위쪽 요소만으로 정해지므로 모든 조건에서 603.5로 같다.
- 625는 control 한 줄보다 작은 여유다.
- mutation 두 건 모두 CI 서체에서 잡혔다(651.5, 644.3).

### 22.3 추가 수정

- `e2e/journeys.spec.ts` 모바일 테스트를 고쳤다.
  - `.result-count`가 보일 때까지 기다린다.
  - `document.fonts.ready`를 기다린다.
  - `.rows:not([aria-hidden]) > li`로 실제 행만 측정한다.
  - 단언: 390 설명 하단 < 844, 390 top < 625, 360 설명 하단 < 800, 375 top < 667
- `globals.css`의 행 padding 주석을 테스트 사유가 아니라 제품 사유로 다시 썼다. 0.6em mono 기기에서도 첫 행 전체가 보이게 하려는 것이다.
- PR Review Toolkit 재검토 결과다.
  - test 리뷰: 6점 이상 0건
  - code 리뷰 IMPORTANT 1건: 제목 옆 저장소 이름도 mono라서 "어떤 mono도 움직이지 않는다"는 주장이 과장이었다. 측정한 범위로 좁혔다. ✅
  - code 리뷰 SUGGESTION 1건, test 리뷰 3점 2건: 문구를 고쳤다. ✅

### 22.4 검증 (FACT)

| 검사 | 결과 |
|---|---|
| check:boundaries, lint, typecheck | OK |
| test | 1,536 passed / 2 skipped |
| build | OK |
| E2E 로컬 서체 / CI 서체 | 39/39 / 39/39 |
| 변경 테스트 10회 반복(두 서체 조건) | 10/10, 10/10 |
| axe | 28회, 0건 |
| search:eval | 54/54, 품질 지표 동일 |
| multilingual | 15/15 |

### 22.5 남는 한계

- **INFERENCE:** Playwright의 390×844는 브라우저 toolbar를 빼지 않은 viewport다. 실제 Safari에서 보이는 높이는 이보다 작다.
- **NOT RUN:** 실기기 확인
- **CI 정보:** CI 서체는 fontconfig로 재현한 것이다. 실제 runner에서 통과하는지는 push 후 CI에서 확인해야 한다(PENDING).
