# AgentDock Phase 10 — UI/UX 고도화

작성일: 2026-10-22 · 기준 commit `1a2cf91` (develop) · 상태: **미커밋, 로컬 검증 완료, 운영 미반영**

이 문서의 수치는 모두 로컬 측정값이다. 측정 환경은 standalone production build, 로컬 PostgreSQL 17,
headless Chromium 151이다. Production 사용자 성능과는 다르다. 재현에 쓴 스크립트와 스크린샷은
작업자의 scratchpad에 있으며 저장소에는 넣지 않았다(§18).

---

## 1. Executive Summary

Phase 10은 디자인을 새로 만드는 작업이 아니었다. 이미 있던 디자인 시스템에서 **실제로 측정된 사용성 결함을 고치는**
작업이었다. 현행 UI는 이미 다음을 갖추고 있었다.

- `light-dark()` 토큰 기반의 다크·라이트 테마
- skip link, 전역 focus ring
- reduced-motion 처리
- 404와 오류 경계
- 검색 skeleton
- type badge의 3채널(색·글자·모양) 표기

Baseline에서 측정된 결함은 다음 다섯 가지다.

1. **필터 칩이 결과를 바꾸지 않았다.** 칩을 클릭하면 선택 표시만 바뀌고, Search 버튼을 눌러야 결과가 바뀌었다. 그동안 화면 상태와 결과가 서로 달랐다.
2. **모바일 상세 페이지가 가로로 넘쳤다.** 긴 이름의 artifact에서 페이지 폭이 390px 화면에서 674px, 320px 화면에서 673px였다.
3. **axe-core 위반 2종이 있었다.**
   - Markdown task-list 체크박스에 레이블이 없음(`label`, critical)
   - 스크롤되는 `<code>`에 focus가 가지 않음(`scrollable-region-focusable`, serious)
4. **모바일 검색 화면에서 결과가 늦게 나왔다.** 필터 패널이 줄바꿈되어 결과 수 표시가 y=855에 있었다(390×844 화면).
5. **탐색 경로가 부족했다.**
   - 홈에 type별 진입점이 없었다.
   - 상세 페이지에 breadcrumb·섹션 이동·복사 기능이 없었다.
   - pager가 Next 버튼과 "Page 1 of 7"뿐이었다.

결과는 다음과 같다.

- 측정한 화면(14개 화면 × 5개 viewport = 70개)에서 가로 overflow는 3건에서 0건, axe 위반은 9 node에서 0 node가 됐다.
- 브라우저 E2E는 21개 시나리오가 모두 통과했고, 3회 연속 같은 결과였다.
- 기존 test는 1,327건에서 1,345건이 됐다. 18건이 추가됐고 기존 test는 모두 통과한다.
- 검색 ranking, 검색 predicate, DB schema, migration은 바꾸지 않았다.

## 2. 작업 배경 및 목표

Phase 1–9에서 수집, 검색, 배포 기반을 만들었다. Phase 10의 목표는 사용자가 artifact를 찾고, 이해하고, 출처로
이동하는 경로를 개선하는 것이다. 작업 원칙은 저장소의 `AGENTS.md`와 `CLAUDE.md`(ponytail)를 따랐다.

- 새 UI 라이브러리, CSS 프레임워크, 애니메이션 라이브러리를 추가하지 않는다.
- server component를 우선한다.
- 판정 어휘를 쓰지 않는다(no verdict vocabulary).
- 인기도를 순위에 쓰지 않는다(popularity never ranks).

## 3. 현재 UI 아키텍처

- **구성:** Next.js 16.3(App Router)이다. 모든 route가 `force-dynamic`이다. CSP는 `src/proxy.ts`에서 요청마다 nonce를 만든다. `script-src`에 `'unsafe-inline'`은 없다.
- **스타일:** `src/app/globals.css` 한 파일이다(Phase 10 전 3,652줄). custom property 토큰을 쓰고 `light-dark()`로 테마를 나눈다.
- **아이콘:** `src/components/Icon.tsx`의 인라인 SVG다(lucide-react는 측정 후 기각됨).
- **Client component:** Phase 10 전에는 3개였다. `SearchHotkey`, `PollUntilDone`, `error.tsx`다. 이번에 4번째로 `CopyButton`을 추가했다.
- **데이터 흐름(검색):**
  1. `<form method=get action=/artifacts>`로 검색어를 보낸다.
  2. URL `?q&type&cap&page`가 route로 들어간다.
  3. `normalizeQuery`, `parseTypeFilter`, `parseCapabilityFilter`, `pageParam`(zod)이 값을 검증한다.
  4. `searchMode`, 그다음 `searchPackages`와 `countSearchResults`가 같은 predicate로 조회한다.
  5. `PackageRows`가 결과를 그리고, 각 행은 `detailHref`로 `/r/{owner}/{repo}/{path}`에 연결된다.

## 4. 기존 UI Source Map

| Route | Page | Data | State | 공통 컴포넌트 | Loading / Error | Test |
|---|---|---|---|---|---|---|
| `/` | `src/app/page.tsx` | `listPackages(18)`, `countPackages` → **`countPackagesByType`**, `lastSyncSucceededAt` | 없음 | IndexFlow, FeaturedArtifact, BoardStats, ArtifactRail, PackageRows | 없음 / `error.tsx` | IndexFlow·Rail·BoardStats test |
| `/artifacts` | `src/app/artifacts/page.tsx` | `searchMode`, `searchPackages`, `countSearchResults` | URL (`q`, `type`, `cap`, `page`) | PackageRows, **searchState** | `artifacts/loading.tsx` / `error.tsx` | search.test, SearchLauncher.test, **searchState.test** |
| `/r/[owner]/[repo]` | `…/[repo]/page.tsx` | `getRepositoryPackages`, `latestJobForTarget` | 없음 | PackageRows | 없음(404 유지가 목적) / `not-found.tsx` | packages.test |
| `/r/[owner]/[repo]/[...path]` | `…/[...path]/page.tsx` | `getPackageDetail`, capability findings, related, versions | 없음 | ArtifactBadge, CapabilityPanel, HiddenContentPanel, SkillBody, **CopyButton** | 같음 | CapabilityPanel·SkillBody·escaping test |
| `/jobs/[id]` | `src/app/jobs/[id]/page.tsx` | job | 없음 | JobPanel, PollUntilDone | 같음 | JobPanel test |
| 전역 | `layout.tsx` | 없음 | 없음 | SearchLauncher(`<dialog>`), SearchHotkey | 없음 | motion.test, no-public-ingest.test |

## 5. UX Baseline

측정 스크립트는 `measure.mjs`(Playwright 1.64.1, axe-core 4.10.3)다. 대상은 14개 화면이다.

- `/`
- 목록, 결과가 많은 검색, 결과 0개, type 필터, 마지막 페이지, 범위 초과 페이지
- skill, plugin, MCP server, subagent 상세
- 긴 이름 상세
- 저장소 페이지
- 404

viewport는 5개다.

| 이름 | 크기 |
|---|---|
| desktop | 1440×900 |
| laptop | 1280×800 |
| tablet | 768×1024 |
| mobile | 390×844 |
| small | 320×640 |

Fixture는 다음 두 가지다.

- **커밋된 fixture 7개:** `bun run db:seed`와 같은 경로로 넣었다(`scripts/seed-fixture.mjs`).
- **로컬 합성 저장소 `fixture/ui-edge-cases`:** subagent 3개, `.mcp.json`, subagent와 skill을 포함한 plugin, 87자 이름과 긴 설명을 가진 skill을 담았다.

데이터는 로컬 `agentdock` schema에만 넣었고 Production DB는 쓰지 않았다. 결과는 목록 기준 162개 artifact다.

| 지표 | Before | 측정 방법 |
|---|---|---|
| 가로 overflow | **3 / 70**(long 상세, tablet·mobile·small) | `scrollWidth > clientWidth` |
| axe 위반 | **9 node**(`label` ×5 viewport, `scrollable-region-focusable` ×2 ×2) | wcag2a/aa, 21a/aa, 22aa, best-practice |
| 24px 미만 target(input 제외) | 200(desktop 계열 153) | bounding box, 문장 속 inline link 제외 |
| LCP 중앙값 / 최대 | 512 ms / 832 ms | PerformanceObserver, 로컬 |
| CLS 최대 | 0.0331(desktop, 결과 0개) | PerformanceObserver |
| 첫 JS 전송량 | 136.4 KB | resource timing, 새 context에서 첫 페이지 |
| 모바일 결과 수 위치 | y=855 | E2E #12 |

다음 항목은 측정하지 않았다(**NOT MEASURED**).

- INP: field data가 없다.
- Production LCP/CLS: 운영 접근을 금지했다.
- 요청당 DB query 수: 코드로만 확인했다. 홈은 3개로 변화가 없고, 목록·상세 query도 바뀌지 않았다.

## 6. 사용자 Journey 분석

| Journey | Before | 문제 |
|---|---|---|
| 홈에서 "subagent를 보고 싶다" | 검색어를 입력하거나 Browse all로 들어간 뒤 칩을 고르고 Search를 눌러야 한다 | type별 진입점이 없다 |
| 검색 결과를 type으로 좁히기 | 칩 클릭 → 표시만 바뀜 → Search 클릭 | 2단계가 필요하고, 그 사이 화면과 결과가 다르다 |
| 필터를 하나만 해제하기 | 칩을 다시 고르고 Search를 누른다. 모바일에서는 칩이 화면 위쪽에 있다 | 결과 옆에 적용 상태와 해제 수단이 없다 |
| 결과의 5페이지 이동 | Next를 4번 누른다 | 번호 링크가 없다 |
| 상세 페이지에서 "파일 내용" 보기 | 9개 섹션을 지나 스크롤한다 | 섹션 이동 수단이 없다 |
| 설치 경로 복사 | 직접 드래그해서 선택한다 | 복사 기능이 없다 |
| 상세에서 같은 type 목록으로 돌아가기 | 뒤로 가기만 가능하다 | breadcrumb이 없다 |

## 7. 발견한 UX 문제

| # | 문제 | 근거 |
|---|---|---|
| U1 | 필터 칩을 바꿔도 결과가 바뀌지 않는다 | Baseline E2E #05 FAIL. radio/checkbox가 GET form 안에 있었고 제출 trigger가 없었다(`artifacts/page.tsx` 구 facets) |
| U2 | 긴 이름 상세에서 모바일 가로 overflow가 생긴다 | `.facts { grid-template-columns: … 1fr }`의 1fr이 auto minimum이고, `.install code { white-space: pre }`가 열을 넓혔다 |
| U3 | task-list 체크박스에 레이블이 없다 | axe `label` critical. remark-gfm이 만든 `<input type=checkbox disabled>` |
| U4 | `.install code`가 스크롤되지만 focus를 받을 수 없다 | axe `scrollable-region-focusable` |
| U5 | 모바일에서 필터가 5줄로 줄바꿈된다 | 결과 수가 y=855(화면 높이 844) |
| U6 | 모바일 radio/checkbox가 13×13이다 | 2.5.8 측정. label이 target이므로 실제 위반은 아니지만 칩을 링크로 바꾸면서 함께 해소됐다 |
| U7 | 터치 화면에 Ctrl K, `/` 키 힌트가 보인다 | 390px에서 placeholder의 약 3분의 1을 가린다 |
| U8 | 홈 소개 문구에 subagent가 빠져 있다 | `page.tsx` hero lede. Phase 5에서 type을 추가할 때 남은 누락 |
| U9 | 검색·필터 URL이 모두 색인 대상이다 | metadata가 정적인 `Artifacts — AgentDock` 하나뿐이었다 |
| U10 | 상세 repo 링크, breadcrumb 높이가 21px이다 | coarse pointer에서 2.5.8 미달 |

## 8. 개선 우선순위

**P0 — 모두 완료**
- U1–U5
- 적용 필터 표시와 개별 해제
- 번호형 pager
- 상세 breadcrumb
- 회귀 test

**P1 — 완료**
- 섹션 이동
- 복사 버튼과 성공·실패 피드백
- SEO(noindex 규칙, OG/Twitter text card)
- type 진입점
- U7, U8, U10

**P1 — 범위에서 제외**

| 항목 | 이유 |
|---|---|
| Sort UX | §11 |
| List/Grid 전환 | 행 하나에 이름·저장소·요약·경로·별·날짜·출처를 담는 밀집 행이 정보량에 맞는다. 두 레이아웃을 유지하는 비용이 효용보다 크다. 행 레이아웃은 Phase 6에서 측정해 결정됐다(`PackageRows.tsx` 주석) |
| Visual Regression 자동화 | Before/After 스크린샷 70장씩을 확보하는 데 그쳤다. 픽셀 비교 파이프라인은 만들지 않았다 |

**P2 — 미구현**

| 항목 | 이유 |
|---|---|
| Light mode toggle | 테마는 이미 OS를 따른다. 토글을 넣으려면 첫 렌더에서 깜빡임을 막는 인라인 script가 필요한데, CSP가 이를 금지한다(`layout.tsx` 주석) |
| 자동완성, 최근 검색 | 요청 수가 늘거나 클라이언트에 상태를 저장해야 한다 |
| 비교, 추천 | 근거가 되는 데이터가 없다 |

## 9. 디자인 시스템

**토큰은 새로 만들지 않았다.** 기존 `:root` 토큰이 요청 항목을 이미 모두 덮는다.

| 분류 | 토큰 |
|---|---|
| 배경·면 | `--bg`, `--surface`, `--surface-2`, `--surface-3`, `--band` |
| 경계선 | `--border`, `--border-strong` |
| 글자색 | `--fg`, `--fg-strong`, `--muted`, `--faint` |
| 강조 | `--accent`, `--accent-hover`, `--accent-soft`, `--on-accent` |
| focus | `--ring`, `--ring-w`, `--ring-offset` |
| 글자 크기 | `--t-xs`부터 `--t-2xl`까지, `--t-metric` |
| 간격 | `--s-1`부터 `--s-7`까지 |
| 모서리 | `--r-sm`, `--r-md`, `--r-lg` |
| 그림자 | `--shadow`, `--shadow-lift`, `--shadow-modal` |
| 움직임 | `--dur`, `--dur-fast`, `--ease` |
| 폭 | `--wrap` 72rem, `--prose` 46rem |
| breakpoint | 64rem, 52rem, 40rem, 30rem |

Success, Warning, Danger 색은 의도적으로 두지 않는다. 판정 어휘를 쓰지 않는다는 invariant 때문에 상태 색을 쓰지 않는다.

**이번에 추가한 컴포넌트와 스타일**

| 이름 | 종류 | 내용 |
|---|---|---|
| `.chip` | link | 선택 상태를 `aria-current`로 나타낸다. 기존 칩 스타일을 재사용하고, 모양 표시를 `::before`로 그린다 |
| `.applied` | 목록 | 적용된 필터 목록. 각 항목이 해제 링크다 |
| `.pager-pages` | 목록 | 번호 링크. 현재 페이지는 `aria-current="page"` |
| `.crumbs` | nav | breadcrumb |
| `.toc` | nav | 섹션 이동 링크 |
| `.type-grid`, `.type-card` | 홈 | type 진입점 |
| `CopyButton` | client component | 복사 버튼과 `role=status` 피드백 |

모두 기존 토큰만 사용한다.

## 10. 페이지별 개선 내용

**Homepage**
- "Browse by type" 카드 6장을 추가했다. 카드마다 badge, listed 수, `usageGuide.ts`의 type 정의 문장이 들어간다.
- 카드 숫자는 `countPackagesByType`(listing predicate를 GROUP BY) 한 번으로 얻는다. 합계가 기존 total을 대체하므로 query 수는 3개로 같다.
- hero 문구에 subagents를 추가했다.

**Search**
- 필터 칩을 링크로 바꿨다(§11).
- 적용 필터 목록을 추가했다.
- 새 검색어를 제출해도 적용 필터가 유지된다(hidden input).
- 번호형 pager를 추가했다.
- noindex 규칙을 적용했다.
- 터치 화면에서 키 힌트를 숨겼다.

**List** — 행 구조는 그대로다. 모바일 필터 높이가 줄어 결과가 위로 올라왔다(y=855에서 741).

**Detail**
- breadcrumb을 추가했다: Artifacts / type 목록 / 저장소 / 이름.
- 섹션 이동 링크를 추가했다.
- 복사 버튼을 붙였다: path, permalink, 설치 경로 2곳.
- U2, U3, U4를 수정했다.
- OG/Twitter text card를 추가했다.

**Mobile** — §14.

## 11. 검색 UX 상세

**필터를 링크로 바꾼 결정**

후보는 세 가지였다.

| 후보 | 판단 |
|---|---|
| change 이벤트에서 JS로 자동 제출 | 기각. JS가 필요하고, radio에서 화살표 키를 누를 때마다 페이지가 이동한다(WCAG 3.2.2 On Input) |
| 버튼 문구로 안내 | 기각. 2단계 조작이 그대로 남는다 |
| 링크 | 채택 |

- 각 칩의 href는 이전 form이 제출하던 URL과 같다. `type`과 `cap` 파라미터, parser, query가 모두 바뀌지 않는다.
- 선택된 칩은 그 필터를 해제하는 URL을 가리킨다.
- 페이지 번호는 항상 1로 초기화한다.
- 결과: 클릭 한 번으로 적용되고, 뒤로 가기·공유 링크·JS off에서 모두 동작한다.

**URL builder**
- `src/components/searchState.ts`로 옮겼다. 그래서 DB 없이 test할 수 있다.
- 파라미터 순서를 고정해 같은 상태는 항상 같은 URL이 된다.
- 들어온 파라미터 검증은 route가 계속 맡는다(`ARTIFACT_TYPE_IDS`, zod).

**Sort를 만들지 않은 이유**
- 정렬 기준을 추가하면 search query가 바뀐다. 검색 의미 변경은 Phase 11 범위다.
- "Repository Stars" 정렬은 AGENTS.md의 "Popularity … never ranks artifacts" invariant에 어긋나므로 만들지 않는다.

**성능**
- debounce와 자동 검색은 없다. 요청은 제출하거나 링크를 누를 때 1회뿐이다.
- 클라이언트 상태는 없다. 검색 화면의 client JS는 변하지 않았다.

**총건수 정합성**
- type 카드의 숫자가 해당 목록의 총건수와 같은지 E2E #01b가 6개 type 모두 확인한다.
- DB test는 type별 합계가 `countPackages` 값과 같은지 확인한다.

## 12. 목록 UX 상세

**Pager**
- 구성: Previous, 번호 링크, Next, "Page N of M".
- 번호는 `pageWindow` 규칙으로 고른다: 첫 페이지와 마지막 페이지, 현재 페이지와 그 양옆. 빠진 페이지가 1개뿐이면 생략 표시 대신 그 번호를 쓴다. 항목은 최대 7개다.
- 30rem 이하에서는 Previous/Next 글자를 시각적으로 숨긴다. 접근성 이름은 유지된다.
- 결과가 한 페이지뿐이면 pager를 렌더하지 않는다.

**경계 확인**

| 방법 | 확인한 경우 |
|---|---|
| E2E | 15개(1페이지, pager 없음), 27개(2페이지), 162개(7페이지, 마지막 페이지 12행), 범위 초과 |
| unit test | `pageWindow` 1–40 전 범위 |

0, 1, 24, 25, 26개 경계는 `Math.ceil(total/25)`와 `pageWindow`의 unit test로 확인했다. 해당 건수의 fixture는 만들지 않았다.

## 13. Artifact 상세 UX

**정보 신뢰성 구분은 기존 구조를 유지했다.** 행 이름이 이미 출처를 밝힌다.

| 출처 | 행 이름 |
|---|---|
| 작성자 선언 | "Licence, declared in the file", "Declared by the author" |
| GitHub | "detected by GitHub", "GitHub stars" |
| AgentDock 관측 | "Observed in the file text", "Last read by AgentDock" |
| AgentDock이 확인하지 않는 것 | "What AgentDock does not check" |

**CopyButton**
- 서버 렌더에서는 렌더하지 않는다. hydration 뒤 `navigator.clipboard`가 있을 때만 버튼을 보여준다.
- Docker 배포는 HTTP라 Clipboard API가 없다. 이때 버튼이 나타나지 않고, 값은 그대로 선택 가능한 텍스트로 남는다.
- 복사가 거부되면 "Copy failed — select the text"라고 안내한다.
- E2E #19가 실제 clipboard 내용과 실패 메시지를 확인한다.

**Related** — 기존 디렉터리 기반 관계만 표시한다. 추천은 없다. E2E #18이 plugin과 subagent 양방향 링크를 확인한다.

## 14. Responsive 설계

**모바일(40rem 이하) 필터**
- legend를 칩 위 줄로 올렸다.
- 칩 행은 줄바꿈 대신 가로로 스크롤한다. 스크롤 영역 안에는 링크만 있으므로 Tab으로 도달할 수 있고, axe도 통과한다.

**overflow 수정**
- `.facts`의 열 정의를 `minmax(0, 1fr)`로 바꿨다.
- `.install code`를 `pre-wrap`과 `overflow-wrap: anywhere`로 바꿨다.

**터치(coarse pointer) 대상**
- 24px 미만 target은 tablet·mobile·small에서 viewport당 67개에서 2개로 줄었다(input 포함). Before의 대부분은 13×13 radio/checkbox였다.
- 남은 2개:
  - disabled task 체크박스: 조작 대상이 아니다.
  - 이름이 "list"인 command의 제목 링크(23×24): 2.5.8의 spacing 예외에 해당한다.

**desktop의 fine pointer** — "source on GitHub"(113×19) 등 93개가 남아 있다. 기존 결정(coarse pointer에만 높이 보정, `globals.css`의 `@media (pointer: coarse)`)을 유지했다. 2.5.8 spacing 예외에 해당한다.

## 15. Accessibility

| 항목 | 결과 |
|---|---|
| axe(wcag2a/aa, 21, 22aa, best-practice) | 70개 측정에서 9 node → **0** |
| 키보드 흐름 | Home → `/` → 검색어 → Enter → 칩(focus-visible ring 확인) → 결과 → 상세 → 출처 링크(focus ring 확인). E2E #14 PASS |
| landmark | 페이지마다 main 1개, nav에 aria-label(Main, Breadcrumb, On this page, Pagination). 필터는 `<fieldset>`과 `<legend>` |
| 상태 안내 | 복사 결과는 `role=status`. 적용 필터 해제 링크는 sr-only로 "Remove filter:"를 붙인다 |
| 현재 위치 | 칩과 breadcrumb은 `aria-current`, pager는 `aria-current="page"` |
| reduced motion | 새 transition은 `--dur`, `--dur-fast` 토큰만 쓴다. `motion.test.ts` PASS |
| 대비 | 새 요소는 기존 토큰 조합(`--muted`/`--surface`, `--accent`/`--accent-soft`)만 쓴다. axe `color-contrast` 위반 0 |

axe와 E2E 통과가 모든 보조기기와 장애 유형에서 사용성을 보장하지는 않는다. 실제 스크린리더(NVDA, VoiceOver)로는 확인하지 않았다(**NOT RUN**).

## 16. SEO

- **`/artifacts`의 `generateMetadata`:** 파라미터만 읽으므로 query가 추가로 실행되지 않는다.
  - `?type=` 하나만 있는 URL은 색인 대상이다. 제목은 "Subagents — AgentDock" 형식이다.
  - `q`, `cap`, `page>1`이 있으면 `robots: noindex, follow`다. 무한히 조합되는 URL이 색인되는 것을 막고, 그 페이지의 링크는 따라가게 한다.
- **layout과 상세 페이지:** OG/Twitter `summary` text card를 추가했다. 이미지나 절대 URL은 없다.
- **만들지 않은 것:** canonical, sitemap, robots.txt. 셋 다 배포 origin이 필요한데, 저장소에 host를 기록하지 않는다는 규칙(CLAUDE.md "Deployment work")이 있다. `metadataBase`를 env로 받는 방안은 Phase 11 후보다.
- **404:** 기존 not-found 동작(실제 404 상태 코드)을 유지한다. E2E #15에서 확인했다.

## 17. Before/After

| 지표 | Before | After |
|---|---|---|
| 가로 overflow(70 측정) | 3 | **0** |
| axe 위반 node | 9 | **0** |
| 24px 미만 target(touch viewport, 합계) | 201 | **6** |
| 모바일 결과 수 위치(390px) | y=855 | **y=741** |
| 필터 적용 조작 | 칩 + Search, 2단계 | **칩 1단계** |
| E2E 21개 시나리오 | 7 PASS / 14 FAIL | **21 PASS**(3회 연속) |

Before 실행에서 #15b는 After 빌드의 DB 장애 서버를 대상으로 돌았으므로 비교 대상이 아니다. Before의 14개 FAIL 중 다수는 기능이 없어서 생긴 실패다(type 카드, applied, 번호 pager, breadcrumb, 복사). 다음 4건은 실제 결함이다.

- #05: 칩을 눌러도 적용되지 않음
- #13: 모바일 칩 동작
- #15: 잘못된 파라미터일 때 선택 상태를 표시하지 않음. 구조 변경과도 관련 있다.
- #16: overflow

스크린샷 경로(파일명은 `{viewport}-{page}.png`, 각 70장):
- Before: `/tmp/claude-1000/-home-ChoiGwanghun-workspace-auto-agentdock/5f3bf29d-8c4e-417d-a177-083dcd61f8ca/scratchpad/p10/before/`
- After: `/tmp/claude-1000/-home-ChoiGwanghun-workspace-auto-agentdock/5f3bf29d-8c4e-417d-a177-083dcd61f8ca/scratchpad/p10/after/`

## 18. 테스트 결과

| 항목 | 결과 |
|---|---|
| `bun run check:boundaries` | PASS(migration 11개, source 93개, UI 29개, verdict vocabulary 포함) |
| `bun run lint` | PASS(210 files) |
| `bun run typecheck` | PASS |
| `CI=1 bun run test`(TEST_DATABASE_URL, loopback) | **PASS 1,345 / skip 3**(Phase 9 1,327 → +18) |
| `bun run build` / `VERCEL=1` build / `docker build` | PASS / PASS / PASS |
| 브라우저 E2E(Playwright, CSP 적용 상태) | **21/21 PASS** × 3회 |
| 측정(70개 화면) | overflow 0, axe 0 |

- skip 3건은 Phase 9와 같다.
- 추가한 test:
  - `searchState.test.ts`: URL 상태, 칩 전이, `pageWindow`
  - `CopyButton.test.tsx`: SSR에서 렌더하지 않음, 거부 시 failed
  - `packages.test.ts`: `countPackagesByType` 합계와 suppressed 제외

**E2E 시나리오** — 번호는 요청서 14.3 기준이고, 19·20은 추가 항목이다.

1. Homepage. 01b: type 카드 숫자와 목록 총건수 일치
2. 검색어 입력
3. 검색 실행
4. 결과 표시
5. Type 칩
6. 필터 해제와 Clear all. 06b: 새 검색어에서 필터 유지
7. 번호 pager, 마지막 페이지, 범위 초과. 07b: 27개(2페이지)와 15개(1페이지) 경계
8. 상세 이동
9. 출처 링크(commit sha permalink, `_blank`, `noopener`)
10. 뒤로 가기
11. 공유 URL로 상태 복원
12. 모바일 검색
13. 모바일 칩
14. 키보드 전체 흐름
15. 404와 잘못된 파라미터. 15b: 부팅 뒤 DB 연결 끊김 → 오류 경계, Try again, 연결 정보 미노출
16. 긴 이름(320px)
17. Subagent 상세와 breadcrumb
18. Plugin ↔ Subagent 관계
19. 복사 성공과 실패
20. console 오류 0(CSP, hydration)

**E2E 도구를 저장소에 넣지 않았다.** Playwright를 devDependency와 CI job으로 들이려면 다음이 필요하다.
- 브라우저 설치
- 시드된 DB
- 빌드된 서버

이는 CI 설계 변경이라 사용자 결정 사항으로 남긴다(§21). 이번에는 scratchpad의 `pw/` 디렉터리에 설치해 실행했다. 스크립트는 `pw/measure.mjs`, `pw/e2e.mjs`, fixture는 `seed-edge.mjs`다.

**NOT RUN**
- 실제 스크린리더
- 실제 모바일 기기. `hover: none` 키 힌트 숨김은 Playwright 모바일 emulation이 hover를 흉내 내지 않아 확인하지 못했다.
- Safari, Firefox
- Production

## 19. 성능 비교

로컬 1회 측정이라 ±50 ms 수준의 잡음이 있다.

| 화면 | 문서 크기(KB) | LCP(ms) |
|---|---|---|
| home desktop | 19.9 → 21.2 | 500 → 456 |
| list mobile | 17.5 → 18.0 | 820 → 796 |
| skill 상세 desktop | 8.3 → 8.9 | 532 → 568 |
| long 상세 mobile | 8.3 → 8.9 | 380 → 420 |

- 첫 JS 전송량은 136.4 KB로 변화가 없다.
- 상세 페이지에는 `CopyButton` chunk 1.2 KB가 추가된다.
- CLS 최대값은 0.0331로 같다. 결과 0개 화면(desktop)의 기존 값이다.
- 상세 페이지 요청이 17개에서 20개로 늘었다. 추가된 breadcrumb 링크의 `next/link` prefetch와 CopyButton chunk 때문이다.
- 상세 LCP의 +30–50 ms는 잡음 범위와 겹치지만, 늘어난 쪽이므로 회귀 후보로 기록한다.
- 홈 query 수는 3개로 같다(`countPackages`를 `countPackagesByType`으로 교체).

## 20. 남은 위험

1. **운영 데이터 분포에서 확인하지 않았다.** 운영의 type별 건수, 긴 이름, task list 분포는 확인하지 않았다(Production 접근 금지).
2. **4번째 client component가 생겼다.** CLAUDE.md와 README를 함께 고쳤지만 정책상 근거가 필요한 변경이다. 근거는 Clipboard API를 대체할 markup이 없다는 것이다.
3. **필터 DOM 구조가 바뀌었다.** radio/checkbox에서 link로 바뀌었다. 외부 스크립트나 북마크릿이 form 필드에 의존했다면 영향을 받는다. URL 형식은 같다.
4. **상세 페이지 요청이 늘었다.** prefetch로 3개가 추가됐다. Vercel 호출량 한도에 민감하다면 breadcrumb 링크에 `prefetch={false}`를 검토한다.
5. **canonical과 sitemap이 없다**(§16).
6. **E2E가 CI에 들어가 있지 않다.** 회귀를 막는 것은 이번에 추가한 unit test뿐이다.

## 21. 후속 Phase 제안

- **Phase 11 — Search Quality**
  - 정렬(관련도, 최근 인덱싱, 이름). stars는 invariant상 제외한다.
  - 일치 부분 강조(`ts_headline`)
  - 결과가 나온 이유 표시
  - 오타 fallback 개선
- **E2E를 CI에 도입**
  - Playwright devDependency와 seed fixture job
  - `pw/e2e.mjs`를 `e2e/` 디렉터리로 옮긴다.
  - 사용자 승인이 필요하다.
- **SEO**
  - `metadataBase`를 env(`SITE_URL`)로 받는다.
  - canonical, sitemap(type 목록과 상세)을 만든다.
- **그 밖**
  - 실제 기기와 스크린리더로 수동 검증
  - Safari와 Firefox 확인

## 22. 최종 판정

**CONDITIONAL — 로컬 기준 READY, 운영 미반영.**

- 코드, test, 문서는 완료했다.
- 운영에 반영하려면 사용자가 commit과 push를 해야 한다. 그 뒤 Phase 9 deploy 경로를 거친다. 이번 변경에는 migration이 없다.
- 운영 데이터 분포 확인, 실제 기기 검증, E2E의 CI 도입은 남은 조건이다.
