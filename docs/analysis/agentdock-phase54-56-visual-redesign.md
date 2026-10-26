# AgentDock Phase 54–56 — Homepage Redesign · Discovery UX · Visual Consistency

작성일 2026-10-26 · 기준 commit `3a0dcb7` (origin/develop = Production) · 변경은 작업 트리에만 있고 commit하지 않음

표기: **FACT** 직접 측정·실행한 결과 / **INFERENCE** 측정에서 추론 / **PENDING** 배포 후 확인 필요 / **NOT RUN** 실행하지 않음

---

## 1. 핵심 결론

- **FACT — 홈:** 같은 Artifact 18개를 대표 카드, 자동으로 흐르는 레일, 목록으로 세 번 그리던 구성을 목록 하나로 합쳤다. 색인 과정 도식은 "How a repository gets indexed" 절로 옮겼다.
  - 첫 Artifact 위치: 1280×800에서 y=1,232 → 670, 390×844에서 y=2,236 → 773
  - 데스크톱 첫 화면에 검색창, 유형 칩, 실제 Artifact가 함께 보인다.
  - 홈 HTML은 274,317B → 116,635B(gzip 21.5KB → 13.2KB)로 줄었다.
- **FACT — 검색(휴대폰):** 검색 버튼을 입력란 옆으로, 필터 이름을 칩 줄 옆으로 옮기고 필터 설명을 검색 패널 안으로 넣었다.
  - 390×844에서 첫 결과 위치가 y=840 → 603이 됐다. 첫 결과 전체(215px)가 첫 화면에 들어온다(이전 3.7px).
  - 375×667에서는 첫 결과 위쪽 64px이 보인다.
  - 320×568에서는 아직 보이지 않는다(y=624).
- **FACT — 검증:**
  - axe-core 4.14.0 WCAG 2.2 AA + best-practice 검사: 변경 전후 모두 28회 실행 위반 0건
  - axe 검사를 E2E에 넣었다.
  - 6개 폭 × 6개 화면에서 가로 넘침 0
- **FACT — 회귀:**
  - test 1,536 passed / 2 skipped. 1,558에서 22개가 줄었는데, 삭제한 컴포넌트의 테스트 22개(12+10)와 같은 수다.
  - E2E 38/38(기존 33 + 신규 5)
  - search:eval 54/54, multilingual 15/15. 사례별 출력과 품질 지표가 Phase 51과 같다.
  - 클라이언트 JS 바이트는 같고, client component는 4개 그대로다. DB query 수도 늘지 않았다.

## 2. Git 기준

| 항목 | 값 |
|---|---|
| HEAD | `3a0dcb7 feat(ui): improve mobile discovery and artifact navigation` |
| origin/develop | `3a0dcb7` |
| Production | `x-agentdock-commit: 3a0dcb7356c4…` (2026-10-26 확인, 읽기 전용 HTTP) |
| 작업 시작 시 작업 트리 | clean |

## 3. 기존 UI 분석 (변경 전, 로컬 `3a0dcb7` 빌드 + E2E seed, `prefers-reduced-motion: reduce`)

### 측정 (FACT)

| 화면 | 폭×높이 | 검색창 y | 결과 수 y | 첫 Artifact y | 첫 화면에 보인 첫 Artifact | 첫 Artifact까지 스크롤 |
|---|---|---|---|---|---|---|
| 홈 | 1280×800 | 392 | – | 1,232 | 0px | 739px |
| 홈 | 390×844 | 387 | – | 2,236 | 0px | 1,709px |
| 검색 `q=review` | 1280×800 | 252 | 524 | 608 | 108/108px | 0 |
| 검색 | 390×844 | 278 | 720 | 840 | 3.7/215px | 211px |
| 검색 | 375×667 | 278 | 720 | 840 | 0px | 408px |
| 검색 | 320×568 | 299 | 741 | 861 | 0px | 582px |

- axe 위반 0건(28회: 7개 화면 × 1280 light/dark × 390 light/dark)
- 가로 넘침 0

### 화면별 정리

| 화면 | 유지 | 개선 | 제거·통합 | 근거 |
|---|---|---|---|---|
| 홈 | 제목·소개문, 검색창, trust 3줄, "Browse by type" 카드, 색인 조건(gate), 별점 설명 | 첫 화면에 실제 Artifact, 유형별 진입 | 대표 카드("Latest read"), 숫자 tile 3개, 자동 레일과 일시정지 체크박스, board의 "Search" 링크, hero의 "Browse all" 버튼(유형 칩 "All N"로 통합) | 같은 18행을 세 번 표시했다. 대표 카드는 목록 첫 행과 같은 내용이고, 레일 2–10번째 카드는 목록과 겹친다. tile은 18개 창의 통계라 전체 corpus 수치가 아니다. 레일 중복 마크업은 홈 HTML의 12.2%였다(ArtifactRail 주석의 측정값). |
| 홈 도식(IndexFlow) | 도식 자체, count-up | 위치 | – | "어떻게 들어오는가"를 설명하는 도식이라 같은 주제의 절로 옮겼다. hero에 있으면 첫 Artifact를 화면 밖으로 민다. |
| 검색 결과 | 필터 칩 링크, 적용 필터, 정렬, pager, 행 구성, 범위 안내문 | 휴대폰의 세로 낭비 | 필터 설명의 별도 상자를 패널 안 한 줄로 | 측정 결과 휴대폰 첫 결과가 3.7px만 보였다. |
| 결과 없음 | Phase 51의 넓히기 제안과 결과 수 | 위 검색 패널 축소 효과를 그대로 받음 | – | 휴대폰 문서 높이 1,491 → 1,282 |
| Artifact 상세 | 전부 | – | – | 표에 해당하는 문제(넘침, axe, 작은 터치 영역)가 없었다. 의미 없는 변경을 피했다. |
| Repository 상세 | 전부 | – | – | 위와 같음 |

**장점과 제약.** 디자인 토큰(`--s-*`, `--t-*`, `--r-*`, `--shadow*`, `light-dark()` 색)은 이미 하나의 체계로 잘 정리돼 있다. 대비는 측정값이 주석에 기록돼 있고, focus ring도 `--ring` 하나로 통일돼 있다. 그래서 새 토큰 체계는 만들지 않았다. 제약은 client component를 늘리지 않는다는 점과, 모션은 `no-preference` 블록 하나 안에만 둔다는 점이다(`motion.test.ts`).

## 4. 디자인 방향

1. **한 번만 그린다.** 같은 데이터는 한 가지 표현으로만 보여 준다(홈의 18행 3중 표시 제거).
2. **첫 화면에는 컨트롤과 실제 콘텐츠를 함께 둔다.** 설명 도식은 그 주제를 다루는 절로 옮긴다.
3. **휴대폰에서도 데스크톱의 배치 규칙을 따른다.** 필터 이름은 칩 옆에, 버튼은 입력란 옆에 둔다. 스크롤 줄은 기존 `.facet-chips`를 그대로 쓴다.
4. **새 컴포넌트·토큰·라이브러리를 만들지 않는다.** 유형 칩은 검색 페이지의 `.chip`이다.

## 5. Homepage 개선 (Phase 54)

`src/app/page.tsx`

- **Hero:** 제목, 소개문, 검색창, **유형 칩 줄**, trust 3줄 순서다.
  - 유형 칩은 `All 250 · Agent Skills 193 · Claude Code Plugins 16 · …` 형태다. 각 칩은 `/artifacts?type=…`로 연결되고, 개수는 홈이 이미 실행하던 `countPackagesByType` 결과다. 새 query는 없다.
  - E2E가 칩 개수와 이동한 목록의 total이 같은지 확인한다.
  - 검색 페이지 칩을 그대로 쓰되, 선택 표시용 원 마크만 없앴다. 이 칩은 선택 상태가 아니라 이동 링크이기 때문이다.
- **Recently indexed:** `listPackages({limit: 10})` 한 번으로 행 10개를 보여 준다. 이전에는 limit 18로 조회한 뒤 카드 1개, 레일 17개, 행 10개로 그렸다.
  - 행에는 레일과 카드가 담던 사실이 모두 있다: 유형, 이름, 저장소, 설명, 경로, 별, 읽은 날짜, 원본 링크.
  - E2E가 각 Artifact 링크가 한 번씩만 나오는지 확인한다.
- **Browse by type:** 그대로 두고 위치만 목록 뒤로 옮겼다. 유형 정의를 설명하는 역할이다.
- **How a repository gets indexed:** 소개문 아래에 IndexFlow 도식을 두고, 그 아래 gate가 온다.
- **삭제:**
  - `FeaturedArtifact.tsx`, `BoardStats.tsx`(+test), `ArtifactRail.tsx`(+test)
  - 관련 CSS 약 600줄(rail, featured, tile, bento, dist, pause, 레일 애니메이션)
- **CSS:**
  - hero 아래 여백을 `--s-7` → `--s-5`, 그리드 간격을 `--s-6` → `--s-5`로 줄였다.
  - h1 최소 크기를 2.25rem → 1.875rem으로 줄였다.
  - board 제목 위의 이중 여백(패딩 32 + margin 32)을 하나로 줄였다.
  - `.hero-copy { min-width: 0 }`을 추가했다. 칩 줄이 페이지를 넓혀 390px에서 378px 넘침이 생겼던 것을 고친다.
- "Popular", "Recommended", "Trending" 같은 근거 없는 제목은 쓰지 않았다. 순서는 기존과 같이 읽은 시각순이다.

## 6. Search 개선 (Phase 55)

`src/app/artifacts/page.tsx`, `src/app/globals.css`. 검색 SQL, 순위, 필터 파서, URL은 바꾸지 않았다.

- **필터 설명(`details.notice`)을 검색 패널 안으로 넣었다.** 접힘 조건(Capability·언어 필터가 있으면 펼침)과 문구는 그대로다. 별도 상자의 테두리, 패딩, 여백을 없앴다.
- **휴대폰(≤40rem)에서 바꾼 점:**
  - 필터 이름(TYPE/DESCRIPTION/CAPABILITY)을 칩 줄 왼쪽에 고정 폭 6rem으로 둔다. 칩 줄은 그 옆에서 가로로 스크롤된다(스크롤 영역은 BFC라 float 옆 폭을 쓴다). 정렬 줄도 같은 방식이다.
  - 검색 버튼을 입력란 옆에 둔다.
  - 패널의 "Search artifacts" 라벨을 화면에서 숨기고 보조기술에는 남긴다(`for="q"` 연결 유지, axe `label` 통과).
  - 단축키 표시(`Ctrl K`, `/`)를 숨긴다. 버튼이 입력란 옆에 오면서 마우스가 있는 320px 창에서 placeholder를 가렸기 때문이다. 터치 기기는 원래 숨긴다.
- **결과 행:** 바꾸지 않았다. 이름 강조, 저장소, 일치 위치, 경로, 별, 날짜, 원본 링크는 Phase 41–51에서 정리된 그대로이고, axe와 터치 영역 측정에서 문제가 없었다.
- **결과 없음:** Phase 51의 넓히기 제안(실제 count 쿼리 결과)을 그대로 두었다.

## 7. 모바일 개선

| 화면 | 폭×높이 | 검색창 y | 결과 수 y | 첫 Artifact y | 첫 화면에 보인 첫 Artifact | 첫 Artifact까지 스크롤 | 문서 높이 |
|---|---|---|---|---|---|---|---|
| 검색 | 390×844 | 278 → **246** | 720 → **512** | 840 → **603** | 3.7 → **215/215px** | 211 → **0** | 6,173 → 5,936 |
| 검색 | 375×667 | 278 → 246 | 720 → 512 | 840 → 603 | 0 → **64px** | 408 → 171 | 6,240 → 6,003 |
| 검색 | 320×568 | 299 → 266 | 741 → 532 | 861 → 624 | 0 → 0 | 582 → 345 | 7,292 → 7,055 |
| 목록 `/artifacts` | 390×844 | 278 → 246 | 720 → 512 | 890 → 653 | 0 → 191/207px | 253 → 16 | |
| 홈 | 390×844 | 387 → 353 | – | 2,236 → **773** | 0 → 71px | 1,709 → **136** | 6,096 → 5,090 |
| 홈 | 375×667 | 432 → 352 | – | 2,301 → 773 | 0 → 0 | 1,950 → 313 | |
| 홈 | 320×568 | 479 → 399 | – | 2,405 → 820 | 0 → 0 | 2,181 → 514 | |
| 결과 없음 | 390×844 | 278 → 246 | – | – | – | – | 1,491 → 1,282 |

(FACT, 로컬. 측정 브라우저는 마우스 환경, reduced motion이다. 터치 환경에서는 coarse pointer 규칙으로 링크 높이가 24px로 늘어 수치가 몇 px 다를 수 있다. E2E는 `isMobile/hasTouch`로 같은 조건을 다시 확인한다.)

- 검색창과 모든 필터는 첫 화면에 남아 있다. 숨기거나 접은 필터는 없다.
- 320×568에서는 첫 결과가 여전히 첫 화면 밖이다. 남은 높이는 범위 안내문 5줄(약 130px)과 필터 3줄이다. 안내문은 "완전한 색인이 아니다"라는 범위 고지라서 줄이지 않았다(§14).

## 8. 디자인 시스템 정리 (Phase 56)

- **토큰:** 기존 체계가 충분하다(§3). 새 토큰은 없다. 삭제한 `.metric`을 가리키던 `--t-metric` 주석을 실제 사용처인 `.count` 기준으로 고쳤다.
- **컴포넌트 일관성:**
  - 홈의 유형 진입이 검색 페이지와 같은 `.chip`이 됐다. 같은 역할을 같은 모양으로 보여 준다.
  - 검색 패널 안 필터 설명은 패널의 한 줄로 그린다(상자 속 상자 제거).
  - 버튼, 검색창, pager, breadcrumb, empty state, loading state는 이미 하나의 규칙을 공유하고 있었다(`--ring`, `.btn`, `.search-row`, `.empty`, `.skeleton`). 바꿀 근거가 없어 그대로 두었다.
- **중복 CSS:** 쓰이지 않게 된 약 600줄을 삭제했다(globals.css 825줄 변경 중 대부분). 중복 정의는 새로 만들지 않았다. biome의 `noDescendingSpecificity` 경고가 나지 않도록 hero 칩 규칙을 칩 규칙 뒤로 옮겼다.

## 9. 접근성 검사

### 자동 검사 (FACT)

- **도구:** `axe-core@4.14.0`(devDependency, exact, 2026-10-05 배포). 래퍼 패키지 없이 `axe.min.js`를 페이지에 주입한다.
- **규칙:** `wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa, best-practice`
- **수동 실행(scratchpad):**
  - 대상 7개 화면: 홈, 검색, 목록, 결과 없음, skill 상세, agent 상세, 저장소
  - 조건 4가지: 1280 light/dark, 390 light/dark
  - 변경 전 28회 위반 0건, 변경 후 28회 위반 0건
- **E2E에 추가:** `accessibility: axe finds no violation at 1280px, light / 390px, dark`, 5개 화면.
- **E2E 첫 실행의 실패 1건:** 결과 없음 화면에서 `page-has-heading-one`이 나왔다. 원인은 `/artifacts`의 `loading.tsx` 상태를 검사한 것이다. 이 상태는 설계상 제목이 없다(loading.tsx 주석). 검사 전에 `main h1`을 기다리도록 테스트를 고쳤다. 페이지의 접근성 문제가 아니라 테스트가 검사한 시점의 문제다.

### 수동 확인 (FACT)

- **키보드:** 홈에서 Tab 14번의 이동 순서는 skip link → brand → Artifacts → Search → 검색 입력 → Search 버튼 → 유형 칩 7개 → Newly added다. 모두 `:focus-visible`이고 ring이 보인다.
- **터치 영역:** 터치 환경 390/320px의 홈과 검색에서 문장 밖 링크·버튼 중 24px 미만 0개다. 기존 `@media (pointer: coarse)` 규칙이 적용된다.
- **Label:** 휴대폰에서 시각적으로 숨긴 라벨도 `<label for="q">`로 그대로 연결된다(axe `label` 통과).
- **Landmark·Heading:** 홈은 h1 하나, h2 3개(Recently indexed / Browse by type / How a repository gets indexed)다. hero 칩은 `<nav aria-label="Artifact types">`다.
- **모션:** 자동으로 움직이던 레일이 없어져 WCAG 2.2.2용 일시정지 컨트롤도 필요 없어졌다. 남은 애니메이션(hero 배경, IndexFlow, 행 등장, loading skeleton)은 모두 `no-preference` 블록 안에 있다.
- 형식적인 점수 개선용 수정은 하지 않았다. 변경 전부터 0건이었다.

## 10. 변경 전후 비교

같은 seed, 같은 viewport, reduced motion. 스크린샷은 §15에 있다.

| # | 화면 | 콘텐츠 표시량 (첫 화면) | 첫 결과 위치 | 시각적 계층 | 검색 동선 |
|---|---|---|---|---|---|
| 1 | 홈 Desktop 1280×800 | Artifact 0 → 1(전체 129px) | 1,232 → 670 | 제목 → 검색 → 유형 칩 → 최근 목록. 도식은 아래 절로 | 검색창 y 392 → 380. 유형 진입이 첫 화면에 생김 |
| 2 | 홈 Mobile 390×844 | 0 → 1(71px) | 2,236 → 773 | 같음 | 검색창 387 → 353. 유형 칩 첫 화면 |
| 3 | 검색 Desktop 1280×800 | 행 2 → 3 | 608 → 578 | 필터 설명이 패널 안 한 줄 | 같음 |
| 4 | 검색 Mobile 390×844 | 3.7px → 행 1개 전체와 다음 행 시작 | 840 → 603 | 필터 이름이 칩 옆, 버튼이 입력란 옆 | 검색창 278 → 246 |
| 5 | 상세 Desktop | 변화 없음 | – | – | – |
| 6 | 상세 Mobile | 변화 없음 | – | – | – |

- **정보 밀도:** 홈 문서 높이는 1280에서 3,750 → 3,150, 390에서 6,096 → 5,090이다. 줄어든 높이는 중복 표시를 없앤 몫이다.
- **가독성:** 행 글꼴과 줄 간격은 그대로다. 표시된 사실 중 빠진 것은 없다. 18개 창의 통계 3개만 없앴다.
- **"세련됨" 판단은 하지 않았다.** 위 수치와 중복 제거, 동선 위치로만 평가한다.

## 11. 성능 영향 (FACT, 로컬 30회, 처음 2회 제외)

| 경로 | before p50 / p95 ms | after p50 / p95 ms | HTML (gzip) |
|---|---|---|---|
| `/` | 12.3 / 15.7 | 9.2 / 11.6 | 274,317 (21,478) → 116,635 (13,159) |
| `/artifacts?q=review` | 8.7 / 12.2 | 9.2 / 12.8 | 200,184 → 200,182 |
| `/artifacts` | 8.5 / 11.7 | 8.4 / 13.8 | 209,987 → 209,985 |
| 결과 없음 | 10.2 / 18.1 | 9.6 / 23.0 | 39,648 → 39,646 |
| skill 상세 | 12.9 / 19.6 | 13.9 / 22.0 | 91,756 → 91,756 |

- **DB query:**
  - 홈은 3개 그대로다(`listPackages` limit 18 → 10, `countPackagesByType`, `lastSyncSucceededAt`).
  - 검색과 상세는 query 코드를 바꾸지 않았다. 유형 칩은 기존 grouped count를 다시 쓴다.
- **JS:** 홈과 검색이 불러오는 JS는 8개 파일, 575,673B로 변경 전후가 같다. `'use client'` 파일은 4개 그대로다(error, CopyButton, PollUntilDone, SearchHotkey).
- **CSS:** 46,729B → 40,123B(gzip 8,905 → 7,878)
- **INFERENCE:** 검색과 상세의 p50 차이(±1ms)는 측정 잡음 범위다. 같은 query와 같은 HTML이기 때문이다.

## 12. 테스트 결과 (FACT)

| 검사 | 결과 |
|---|---|
| `bun run check:boundaries` | OK |
| `bun run lint` | 231 files, no fixes |
| `bun run typecheck` | OK (ci 안에서) |
| `bun run test` (TEST_DATABASE_URL, REQUIRE_TEST_DATABASE=1) | 80 files, **1,536 passed / 2 skipped** |
| `bun run build` | OK |
| `bun run test:e2e` | **38/38** (17.9s) |
| `search:eval` | **54/54**. 사례별 52줄이 Phase 51과 같고, summary는 latency만 다름 |
| `search:eval:multilingual` | **15/15**. 출력이 Phase 51과 같음 |
| axe 수동 실행 | 28/28 위반 0 |

- **테스트 수 변화:**
  - 1,558 → 1,536은 삭제한 `ArtifactRail.test.tsx`(12), `BoardStats.test.tsx`(10)만큼 줄어든 것이다. 다른 테스트의 기대값은 바꾸지 않았다.
  - skip 2건은 Phase 51과 같은 기존 조건부다(test URL 비밀번호 없음, pg_trgm 없음 경로).
- **`motion.test.ts` 1건 수정:**
  - 이 테스트는 `(prefers-reduced-motion: reduce), (pointer: coarse)` 블록이 stylesheet에 있다고 가정하고, helper가 그 블록과 reduced-motion 블록을 헷갈리지 않는지 확인했다. 그 블록은 레일 CSS였다.
  - 레일을 삭제했으므로 같은 decoy를 테스트 안에 직접 적어, helper 검사는 그대로 유지했다. 의도한 구조 변경에 따른 수정이고 회귀가 아니다.
- **신규 E2E 5건:**
  - 홈 데스크톱: 첫 행 y<800, 링크 중복 없음, 칩 개수 = 목록 total
  - 휴대폰 검색: 390에서 첫 행 전체가 844 안, 375에서 첫 행이 667 안, 필터 줄마다 한 줄
  - 휴대폰 홈: 검색창, 칩, 첫 행이 첫 화면에 있음
  - axe 2건
  - 변경 전 측정값(§3)은 이 조건들을 모두 만족하지 못한다. 예: 홈 1,232>800, 검색 390에서 840+215>844.
- **기존 테스트 33건:** 수정 없이 통과했다. Phase 51의 필터 설명 접힘 테스트도 `details.notice` 선택자 그대로 통과한다.
- **운영상 주의(FACT):** E2E를 돌리면 생기는 `test-results/.last-run.json`(gitignore 대상)을 biome가 검사해서 `bun run lint`가 실패한다. 이번에는 생성된 파일을 지우고 다시 실행했다. 코드 문제는 아니다.

## 13. 변경 파일

| 파일 | 변경 |
|---|---|
| `src/app/page.tsx` | hero 유형 칩, 도식 이동, board를 행 10개로, limit 18→10, import 정리 |
| `src/app/artifacts/page.tsx` | 필터 설명을 `.search` 패널 안으로 (+5/−10) |
| `src/app/globals.css` | hero·휴대폰 검색·board 여백 규칙, 레일·대표 카드·tile CSS 삭제 |
| `src/app/motion.test.ts` | prefix-match 회귀 테스트를 합성 decoy로 |
| `src/components/hrefs.ts` | 주석의 "rail" 제거 |
| `src/components/ArtifactRail.tsx`, `.test.tsx` | 삭제 |
| `src/components/BoardStats.tsx`, `.test.tsx` | 삭제 |
| `src/components/FeaturedArtifact.tsx` | 삭제 |
| `e2e/journeys.spec.ts` | 신규 journey 5건(axe 포함) |
| `package.json`, `bun.lock` | `axe-core@4.14.0` devDependency (exact, +4줄) |
| `README.md`, `README.en.md` | 홈 구성 설명, 레일 정지 컨트롤 단락 삭제, 모션 문장 |
| `docs/images/agentdock-home.png` | 새 홈 전체 화면 (1.69MB → 0.76MB) |
| `docs/images/phase54/` | 전후 스크린샷 18장 (996KB) |
| `docs/analysis/agentdock-phase54-56-visual-redesign.md` | 이 보고서 |

합계(소스·테스트·README): 15 files, +341 / −1,474

## 14. 보류한 개선

| 항목 | 이유 |
|---|---|
| 휴대폰 검색 화면의 범위 안내문 축소 | "완전한 색인이 아니다"라는 고지(D-39)다. 320px에서 5줄, 약 130px로 첫 결과를 가리는 남은 주요 원인이지만 내용 결정이 필요하다. 사용자 승인 대상이다. |
| 휴대폰에서 Description·Capability 필터 접기 | 최대 약 100px를 더 줄일 수 있지만 "필수 필터 접근성"과 충돌한다. 지금은 모두 보인다. |
| 상세 페이지 정보 순서 (원문 본문이 390px에서 약 y=4,300) | 본문 앞에 사실·분석·관련·설치 절이 온다. 순서 변경은 정보 구조 결정이라 별도로 논의해야 한다. 페이지 목차 칩으로 "File"에 바로 갈 수 있다. |
| 상세 action 버튼 2개가 휴대폰에서 두 줄 | 두 라벨의 폭 합(약 413px)이 358px보다 크다. 라벨을 줄이면 commit 표기가 빠진다. |
| 다크 모드 전후 스크린샷 | axe 다크 검사(14회)는 실행했다. 시각 비교 캡처는 찍지 않았다. |
| hero 유형 칩과 "Browse by type" 카드의 역할 중복 | 칩은 빠른 이동, 카드는 정의 설명이다. 사용 데이터가 없어 둘 다 두었다. |

## 15. 스크린샷 (`docs/images/phase54/`)

PNG 128색으로 줄였다. 전체 화면 캡처는 절반 크기다.

| 비교 | before | after |
|---|---|---|
| 홈 Desktop 첫 화면 | `before-home-1280.png` | `after-home-1280.png` |
| 홈 Desktop 전체 | `before-home-1280-full.png` | `after-home-1280-full.png` |
| 홈 Mobile 390×844 | `before-home-390.png` | `after-home-390.png` |
| 검색 Desktop | `before-search-1280.png` | `after-search-1280.png` |
| 검색 Mobile 390×844 | `before-search-390.png` | `after-search-390.png` |
| 검색 Mobile 375×667 | `before-search-375.png` | `after-search-375.png` |
| 상세 Desktop | `before-detail-1280.png` | `after-detail-1280.png` |
| 상세 Mobile | `before-detail-390.png` | `after-detail-390.png` |
| 결과 없음 Mobile | – | `after-zero-390.png` |
| 긴 다국어 텍스트 320px | – | `after-longtext-search-320.png` |

- **다국어 확인(FACT):** 시드에는 순수 CJK 설명이 없다(`lang=zh/ja/ko` 0행, `mixed` 4행). 그래서 홈·검색·상세의 첫 4행에 한국어, 중국어, 일본어, 영어 긴 이름(공백 없는 64–150자)과 긴 설명을 DOM으로 넣어 320/390/1280에서 측정했다. 9회 모두 가로 넘침 0이다. 상세의 표 머리(THEAD)는 가로 스크롤 영역 안이라 페이지는 넘치지 않는다. DB에는 쓰지 않았다.
- `lang=mixed` 실데이터는 320과 390에서 넘침 0이다.

## 16. PENDING / NOT RUN

- **PENDING:**
  - 운영 배포 후 홈과 검색 화면 확인(390×844 첫 결과 위치, 유형 칩 개수와 목록 total 일치)
  - 운영 데이터(19,000여 행)에서 홈 칩 개수 표시
- **NOT RUN:**
  - 다크 모드 시각 전후 캡처(axe 다크 검사는 실행함)
  - 실제 iOS/Android 기기 확인(Chromium의 `isMobile/hasTouch` 에뮬레이션만 함)
  - `VERCEL=1` 빌드
  - 스크린리더 실기 낭독(NVDA/VoiceOver)

## 17. Evidence ID

| 항목 | 값 |
|---|---|
| 기준 Production 헤더 | `x-agentdock-commit 3a0dcb7356c4ed44cc864f7d5823793a0955d0a7` (2026-10-26) |
| 비교 기준 빌드 | `3a0dcb7` standalone, 127.0.0.1:3971 |
| 변경 빌드 | 작업 트리 standalone, 127.0.0.1:3970 |
| DB | 로컬 docker `agentdock-testdb`, schema `agentdock`, E2E seed (운영 DB 접속 없음) |
| axe | `axe-core 4.14.0` |
| Playwright | `@playwright/test 1.64.1`, Chromium |
| 측정 스크립트 | scratchpad `p54/survey.mjs`, `axe.mjs`, `manual.mjs`, `longtext.mjs` (저장소 밖) |

## 18. Git Status (보고 시점)

```
 M README.en.md
 M README.md
 M bun.lock
 M docs/images/agentdock-home.png
 M e2e/journeys.spec.ts
 M package.json
 M src/app/artifacts/page.tsx
 M src/app/globals.css
 M src/app/motion.test.ts
 M src/app/page.tsx
 D src/components/ArtifactRail.test.tsx
 D src/components/ArtifactRail.tsx
 D src/components/BoardStats.test.tsx
 D src/components/BoardStats.tsx
 D src/components/FeaturedArtifact.tsx
 M src/components/hrefs.ts
?? docs/analysis/agentdock-phase54-56-visual-redesign.md
?? docs/images/phase54/
```

## 19. 권장 Commit

저장소 루트(`~/workspace_auto/agentdock`)에서 실행한다.

```bash
git add -A README.md README.en.md bun.lock package.json e2e/journeys.spec.ts \
  src/app/page.tsx src/app/artifacts/page.tsx src/app/globals.css src/app/motion.test.ts \
  src/components/hrefs.ts src/components/ArtifactRail.tsx src/components/ArtifactRail.test.tsx \
  src/components/BoardStats.tsx src/components/BoardStats.test.tsx src/components/FeaturedArtifact.tsx \
  docs/images/agentdock-home.png docs/images/phase54 docs/analysis/agentdock-phase54-56-visual-redesign.md
git commit -m "feat(ui): put search and real artifacts on the first screen" -m "Home drew the same 18 rows three times (featured card, auto-scrolling rail, list) with the index-flow diagram above them; the first artifact started at y=1,232 on 1280x800 and y=2,236 on 390x844. It is now one list of the ten newest under the search box and a per-type chip row (counts from the existing grouped query), with the diagram moved into 'How a repository gets indexed'. FeaturedArtifact, BoardStats and ArtifactRail are deleted with their tests (22) and CSS.

On a phone the search button sits beside the field, facet legends beside their chip rows and the filter note inside the search panel: the first result moves from y=840 to y=603 at 390x844 and is fully on the first screen.

Adds axe-core 4.14.0 (dev) and E2E journeys for the first-screen positions and an axe sweep (WCAG 2.2 AA + best-practice). motion.test's prefix-match regression now writes its decoy inline, since the rail rule it relied on is gone. No query, ranking or URL change; client JS unchanged.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## 20. 다음 작업

1. **운영 확인:** 배포 후 홈과 검색 화면의 첫 결과 위치, 칩 개수 = 목록 total을 확인한다(읽기 전용 HTTP).
2. **범위 안내문의 휴대폰 표현 결정:** 320–375px에서 첫 결과를 가리는 남은 주요 요인이다. 문구를 줄일지, 결과 아래로 옮길지는 사용자가 결정한다.
3. **상세 페이지 정보 순서 검토:** 원문 본문이 휴대폰에서 약 4,300px 아래에 있다. 목차 칩이 있지만, 본문을 먼저 볼지는 사용 맥락을 보고 정한다.
4. **운영 secret 교체**(`DATABASE_URL`, `AGENTDOCK_TARGET_FINGERPRINT`): 이전 Phase에서 이어지는 운영 과제다. UI와는 별개다.
5. **언어 generated column migration 검토:** `lang=latin`과 결과 없음 화면의 언어 판정 비용을 줄인다. 승인이 필요하다.
