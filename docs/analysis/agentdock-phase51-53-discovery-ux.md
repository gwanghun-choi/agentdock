# AgentDock Phase 51–53 — Discovery UX · Artifact Detail · Exploration

- 작성: 2026-10-26 (관찰 시각은 UTC)
- 기준 commit: `3ee2de5` (HEAD = origin/develop = Production). 변경은 작업 트리에만 있다(미커밋).
- 운영에서 한 일: 읽기 전용 HTTP GET만 했다(화면 캡처, 상세 페이지 표본, 이름 검색 표본).
- 하지 않은 일: 운영 DB 접속·변경, migration, Sync 변경, 검색 순위 변경, commit·push·deploy.
- 표기: FACT(직접 관찰) / INFERENCE(근거가 있는 추론) / PENDING(조건이 아직 오지 않음) / NOT RUN(실행하지 않음)

## 1. 핵심 결론

1. **기존 UI는 이미 많은 것을 갖추고 있었다(FACT).**
   - 목록: 유형·언어·Capability 필터 칩, 적용 필터 제거 링크, 정렬, 번호 pager, 일치 위치 표시("Matched in …"), 언어 표시, star·읽은 날짜·commit permalink
   - 상세: breadcrumb, 페이지 목차, 경로·permalink 복사 버튼, 유형별 사용 안내, frontmatter 기반 Setup, 버전 이력, 같은 plugin·저장소의 관련 Artifact, 이름으로 검색 넘기기, 원문 안내
   - 이 기능들은 다시 만들지 않았다.
2. **가장 큰 실제 문제는 모바일 목록에서 결과가 첫 화면 밖에 있었다는 점이다(FACT, P0).**
   - 운영 `?q=code+review`에서 375px 기준 첫 결과가 y=1,085px, 320px 기준 y=1,168px였다.
   - Phase 10이 y=741로 고쳤던 결과 수 위치가 y=904(390×844)로 되돌아가 있었다.
   - 원인은 Phase 41에서 늘어난 필터 설명문(375px에서 약 230px)과 세 줄로 접히는 정렬 칩이다.
3. **고친 것은 세 가지다.**
   - (P0) 필터 설명문을 접고, 정렬 칩을 한 줄로 만들었다. 결과 수 위치는 y=904에서 y=720으로 올라왔다(390×844).
   - (P1) 결과 없음 화면이 필터를 하나씩 뺐을 때와 검색어를 뺐을 때 각각 몇 건이 되는지 보여 준다.
   - (P1) 상세 페이지 본문 위에 작성자 원문의 제목 목차를 둔다. 각 항목은 해당 제목으로 이동한다.
4. **설치 명령은 만들지 않았다(FACT).**
   - 표본 52건 중 본문에 명령이 있는 것은 4건이었다.
   - 그 4건 중 해당 Artifact를 설치하는 명령은 하나도 없었다.
   - 대신 목차로 작성자의 "Quick Start", "Setup", "Usage" 절에 바로 갈 수 있다. 이런 제목은 52건 중 12건에 있었다.
5. **유사 Artifact는 보류했다(FACT, P2).**
   - 이름으로 검색한 상위 5건을 26건 표본에서 확인했다.
   - 관련 있는 대안이 나온 경우는 8건(31%)이었다.
   - 나머지는 결과가 없거나(6), 같은 파일의 복제본이거나, 일반 이름이라 관련 없는 결과였다.
   - 기존 "Search {type} for {name}" 링크를 유지한다.
6. **검색 품질과 동작은 그대로다(FACT).**
   - search:eval 54/54, multilingual 15/15이고, 사례별 출력이 Phase 48과 같다.
   - 검색·count 쿼리, URL, 필터, pager는 바꾸지 않았다.
7. **검증은 모두 통과했다(FACT).** check:boundaries, lint, typecheck, test 1,558 passed(조건부 skip 2), build, E2E 33/33(기존 28과 새 5).

## 2. 기존 UI/UX 분석

방법:
- 운영 화면(현재 코드 `3ee2de5`)을 320/375/768/1280/1920px로 캡처했다. 대상은 홈, 목록, 검색, 결과 없음 2종, 상세 2종, 저장소다.
- 각 화면에서 가로 넘침, 첫 결과 위치, 24px 미만 터치 대상, 제목 구조를 측정했다.
- 운영 목록 19,113건(Phase 41에서 읽기 전용으로 수집)의 이름·설명 길이를 셌다.
- 운영 상세 페이지 52건 본문의 제목 수와 설치·사용 관련 제목·명령을 셌다.

| 화면 | 관찰 | 판단 |
|---|---|---|
| 홈 | 검색, 유형 바로가기, 색인 흐름이 있다. 숫자가 다르게 보인 18,788은 카운트업 애니메이션 도중 캡처라서 생긴 값이다(reduced-motion에서는 19,247로 같다). | 문제 없음 |
| 목록·검색 | 결과 위에 제목, 범위 문장, 검색 카드(유형·언어·Capability 3줄), 필터 설명문, 결과 수, 정렬이 있다. 375px에서 첫 결과가 y=1,085다. | **P0** |
| 결과 행 | 유형 배지가 고정 열에 있고, 이름 옆에 저장소, 2줄로 자른 설명, 일치 위치, 경로, 언어, star, 읽은 날짜, GitHub 링크가 나온다. 경로는 자르지 않는다. | 유지 |
| 필터 | 칩이 곧 링크라서 URL이 상태다. 적용된 필터마다 제거 링크와 Clear all이 있다. pager와 정렬도 searchHref 하나로 상태를 유지한다. | 유지 |
| 결과 없음 | "Clear filters", "Clear search", "Browse all"을 보여 주지만, 어느 쪽에 결과가 있는지는 알려 주지 않는다. | **P1** |
| 상세 | 상단 정보와 GitHub 링크 2개, 목차 칩 8개가 있다. 본문(File)은 맨 마지막이고, 375px에서 페이지가 7,000–11,500px다. 본문 안에서 이동할 방법이 없다. | **P1** |
| 저장소 | 저장소 설명, 메타데이터, Artifact 목록이 있다. CJK 설명도 정상이다. | 유지 |
| 반응형 | 5개 폭 × 8화면에서 가로 넘침은 0이다. 24px 미만 터치 대상은 행 안의 "source on GitHub"(19px)처럼 문장 속 링크다. 주변 간격이 있어 WCAG 2.5.8 간격 예외에 해당한다. | 유지 |

데이터로 본 가독성:
- 설명 길이 p50은 178자, p90은 503자, 최대는 4,015자다. 행에서 2줄로 잘린다.
- 40자를 넘는 이름이 385건(최대 57자), 35자를 넘는 저장소 이름이 2,621건(최대 52자)이다. 기존 E2E의 87자 이름 줄바꿈 검사가 이를 덮는다.
- 설명 안에 `\n`이 문자 그대로 들어 있는 경우가 55건(0.3%, 대부분 agent)이다. 작성자가 쓴 그대로라서 바꾸지 않았다(§13).

## 3. 개선 전 문제

| ID | 문제 | 근거 | 우선순위 |
|---|---|---|---|
| U1 | 모바일 검색 결과가 첫 화면 밖에 있다 | 첫 결과 y=1,085(375), 1,168(320). 결과 수 y=904(390×844, Phase 10 기준 741) | P0 |
| U2 | 정렬 칩이 모바일에서 3줄로 접힌다 | 375px에서 약 110px | P0(U1의 일부) |
| U3 | 결과 없음 화면에서 어느 필터 때문에 비었는지 알 수 없다 | 필터 3개를 건 검색에서 버튼을 하나씩 눌러 봐야 안다 | P1 |
| U4 | 긴 원문 안에서 이동할 수 없다 | 표본 52건의 제목 수 중앙값 7, 상위 25%는 14 이상, 최대 34. 5개 이상인 경우가 30건 | P1 |
| U5 | 사용 방법이 원문 속 절에 묻혀 있다 | 설치·사용 관련 제목이 12/52건에 있다 | P1(U4로 해결) |

## 4. 개선 우선순위

| 후보 | 사용자 가치 | 난이도 | 성능 | 결정 |
|---|---|---|---|---|
| 필터 설명문 접기(필터 적용 시 펼침) | 높음 | 낮음 | 없음 | **구현** |
| 정렬 칩 한 줄 가로 스크롤 | 중간 | 낮음 | 없음 | **구현**(필터 칩과 같은 방식) |
| 결과 없음 화면의 필터별 결과 수 | 중간–높음 | 낮음 | 결과 없음 화면에서만 +32–81ms(로컬) | **구현** |
| 원문 제목 목차 | 높음 | 중간 | 상세 페이지 렌더링 +1.5–9ms CPU | **구현** |
| 본문에서 설치 명령 자동 추출 | 낮음(오정보 위험) | 중간 | — | 보류: 표본에서 자기 설치 명령이 0/4 |
| 유사 Artifact(이름 검색) | 낮음 | 중간 | 상세 페이지마다 +2 쿼리 | 보류: 관련성 31% |
| 설명의 `\n` 정리 | 낮음 | 낮음 | — | 보류: 작성자 원문, 0.3% |
| 상세 → 검색 결과로 돌아가는 링크 | 낮음 | 중간(URL 상태 추가) | — | 보류: 브라우저 뒤로 가기가 상태를 보존한다(E2E로 확인) |

## 5. Phase 51 결과 — Search Result UX

### 5.1 필터 설명문 (`src/app/artifacts/page.tsx`, `globals.css`)

- `<p class="notice">`를 기본 `<details class="notice">`로 바꿨다. 제목은 "What these filters mean"이다.
- Capability나 언어 필터가 적용되면 `open` 상태로 렌더링한다. 설명이 필요한 순간에는 결과 옆에 펼쳐져 있다.
- 문구는 바꾸지 않았다.
- 클라이언트 코드는 추가하지 않았다. 접고 펴는 동작은 브라우저의 기본 disclosure 위젯이 한다.

### 5.2 정렬 칩

- 정렬 링크를 `.facet-chips` 안에 넣었다. 휴대폰에서는 필터 칩과 같은 가로 스크롤 한 줄이 된다.
- 데스크톱 배치는 그대로다.

결과(로컬, 같은 seed 데이터, before = `3ee2de5` build, after = 작업 트리 build):

| 폭 | 결과 수 y (before → after) | 첫 결과 y (before → after) |
|---|---|---|
| 390×844 | 904 → **720** | 1,026 → 840 |
| 375 | 925 → 720 | 1,085 → 840 |
| 320 | 1,008 → 741 | 1,168 → 861 |
| 768 | — | 764 → 684 |
| 1280 | — | 647 → 608 (보이는 행 1 → 2, browse) |

- 결과 수가 Phase 10 기준(741)보다 위로 돌아왔다.
- 첫 결과 제목 아래쪽은 390×844 화면에서 y=912라 아직 첫 화면에 다 들어오지는 않는다. 그 위에 남은 것은 필수 범위 문장(D-39), 검색 입력, 필터 3줄이다.

### 5.3 결과 없음 화면

- 결과 없음 분기에서 기존 적용 필터 목록 대신 "Ways to widen this search" 목록을 보여 준다.
  - 각 필터를 뺐을 때의 결과 수
  - 검색어와 필터가 함께 있으면, 검색어를 뺐을 때의 결과 수
- 결과가 있는 항목만 링크로 만든다. 결과가 없으면 "no match either"라고 쓴다.
- 결과 수는 이동할 페이지와 같은 방식(searchMode → count)으로 센다. E2E가 표시된 수와 이동 후 total이 같은지 확인한다.
- 기존 "Clear filters", "Clear search", "Browse all artifacts" 버튼은 그대로 둔다.

예(로컬 seed): `?q=git&type=hook&cap=no_shell`

```
Without “Hook Configurations” — 13 artifacts   (링크)
Without “No Bash grant declared” — no match either
Without the search words — no match either
```

### 5.4 그 밖의 상태 (변경 없음, 확인함)

| 상태 | 화면 |
|---|---|
| 결과 있음 | 결과 수, "Showing a–b", 적용 필터, 정렬 |
| 일부 단어만 일치 | "No artifact matched every word; these match at least one." |
| 정확히 일치하는 결과 없음 | 이름·설명이 비슷한 결과를 보여 주고 count와 pager는 숨긴다 |
| 범위를 벗어난 쪽 | "There is no page N" + 첫 쪽 링크 |
| 잘못된 파라미터 | 기본값으로 처리한다(E2E `bad parameters fall back to defaults`) |
| 빈 검색어 | browse와 같다 |
| 로딩 | `loading.tsx`의 skeleton 행 10개 |

## 6. Phase 52 결과 — Artifact Detail UX

### 6.1 원문 목차 (`SkillBody.tsx`, 상세 `page.tsx`)

- `bodyOutline(markdown)`은 렌더러와 같은 파서(`unified` + `remark-parse` + `remark-gfm`)로 같은 문자열을 읽는다. 깊이 3까지의 제목을 `{depth, text, href}`로 돌려준다.
- 렌더된 제목에는 시작 줄 번호로 만든 id(`file-L<line>`)를 붙인다.
  - rehype-sanitize가 끝난 뒤 React component에서 붙인다. `<pre tabIndex>`와 같은 방식이고, sanitizer allowlist는 그대로다.
  - 두 쪽이 같은 파서·같은 입력을 쓰므로 목차의 줄 번호와 제목 id가 항상 맞는다. unit test가 fence, setext, blockquote, frontmatter에서 이를 확인한다.
- 상세 페이지 "File" 절 아래에 `nav[aria-label="Sections in this file"]`를 둔다.
  - 제목이 3개 미만이면 만들지 않는다.
  - 깊이 3까지 15개를 넘으면, 깊이 2까지가 3개 이상일 때만 그것으로 줄인다.
  - 들여쓰기는 작성자가 쓴 가장 얕은 단계를 기준으로 한다(`##`로 시작하는 문서가 많다).
- 제목 텍스트는 React가 escape한다. raw HTML은 본문처럼 버려진다.

로컬 확인:

| 페이지 | 목차 | id가 없는 링크 | 마지막 링크 이동 |
|---|---|---|---|
| baoyu-comic (375/1280) | 14 | 0 | 제목이 화면 안 |
| temporal-python-testing (375/1280) | 15 | 0 | 제목이 화면 안 |

### 6.2 원본·신뢰 정보 (변경 없음, 확인함)

- 원본 저장소: breadcrumb, 상단 링크, Details 표
- 원본 파일: "View this file at commit abc1234", 복사할 수 있는 permalink
- 확인 시점: "Last changed upstream"과 "Last read by AgentDock"을 따로 표시한다.
- 외부 작성자의 원문: "An excerpt of … as published by …, at commit …" 문장과 FILE_DISCLAIMER
- Star는 "GitHub stars"로만 표시하고, 순위나 등급으로 쓰지 않는다.
- 보안 등급이나 인증 배지는 없다. 이번에도 만들지 않았다(check:boundaries OK).

### 6.3 사용 방법

- 이미 있는 것:
  - SetupPanel: frontmatter와 `.mcp.json`·hook 값, credential 가림
  - 유형별 안내: 프로젝트·개인 복사 경로와 Copy 버튼. Copy 버튼은 E2E로 키보드 복사까지 확인돼 있다.
- 새 복사 버튼은 추가하지 않았다. 복사할 검증된 명령이 없기 때문이다(§1-4).

## 7. Phase 53 결과 — Exploration UX

### 7.1 유사 Artifact (보류)

- 운영에서 이름 + 유형으로 검색했다(26건). 이는 기존 "Search {type} for {name}" 링크가 하는 일과 같다.

| 결과 유형 | 건수 |
|---|---|
| 자기 자신 외에 결과 없음 | 6 |
| 같은 이름의 복제본(다른 저장소의 같은 파일) | 5 |
| 일반 이름이라 관련 없는 결과(`settings`, `export`, `AGENTS`, `run-prompt` 등) | 7 |
| 의미 있는 대안(`skill-deck`, `improve-architecture`, `advisor`, `gsd-plan-phase` 등) | 8 |

- 31%로는 상세 페이지마다 쿼리 2개를 더할 가치가 없다고 판단했다.
- 관련 Artifact 절(같은 plugin, 같은 저장소)과 검색 넘기기 링크는 유지한다.
- 부수 관찰: 같은 파일이 여러 저장소에 복제돼 있는 경우가 흔하다(`planning-with-files` 5곳 이상). "같은 내용이 다른 저장소에도 있다"는 content_hash로 확인할 수 있는 사실이라 다음 후보로 둔다(§18).

### 7.2 탐색 흐름 (E2E)

| 흐름 | 결과 |
|---|---|
| 검색 결과 → 상세 | 기존 `detail, Back and a shared URL` |
| 상세 → 원본 GitHub | commit SHA permalink(같은 테스트) |
| 상세 → 관련 Artifact → 상세 | 기존 `related: …` 2건 |
| 상세 → 뒤로 가기 → 같은 검색어·유형·정렬·쪽 | **새 journey** (`?q=skill&type=skill&sort=name&page=2`) |
| 상세 → 원문 절 | **새 journey** (목차 → `#file-L…` → 제목이 화면 안) |

### 7.3 반응형

- 320/375/768/1280/1920px × 9화면(after)에서 가로 넘침은 0이다.
- E2E(390×844 mobile)로 다음을 확인한다.
  - 결과 수 y < 741
  - 정렬 칩이 한 줄이다
  - 가로 넘침 0
- 목차 링크는 `min-height: 24px`이다. 접힌 설명문의 summary도 24px이다.

## 8. 변경 전후 화면 비교

`docs/images/phase51/`:

| 파일 | 내용 |
|---|---|
| `search-375-before.png` / `search-375-after.png` | 모바일 검색. 펼쳐진 설명문과 3줄 정렬 → 접힌 설명문과 1줄 정렬 |
| `search-1280-before.png` / `search-1280-after.png` | 데스크톱 검색 |
| `search-320-after.png` | 320px |
| `zero-375-before.png` / `zero-375-after.png` | 결과 없음. 버튼만 → 필터별 결과 수 |
| `outline-cjk-375.png` / `outline-long-1280.png` | 원문 목차 |

전체 캡처(5개 폭, before/after)는 scratchpad의 `p51/local-before/`, `p51/local-after/`, 운영 캡처는 `p51/before/`에 있다.

## 9. 추가 DB 조회 및 성능 영향

| 화면 | 추가 쿼리 | 측정 |
|---|---|---|
| 결과 있는 목록·검색 | 0 | 로컬 p50 8.6→8.6ms(browse), 8.8→8.1ms(search) |
| 결과 없음 | 필터 수 + 1(검색어가 있을 때)개의 경로마다 searchMode와 count, 경로끼리는 병렬 | 운영 목록 19,113건을 로컬에 적재해 측정: +32ms(유형·Capability), +81ms(언어 필터 포함). 원래 page 쿼리는 6–10ms |
| 상세 | 0. 본문 파싱이 한 번 더 일어난다 | 12KB 본문 3.5ms, 32KB 상한 9.2ms(CPU). 로컬 HTTP p50 +2.5ms(temporal), +7.3ms(baoyu-comic, 큰 본문) |

- N+1은 없다. 결과 없음 경로 수는 최대 6개이고, 결과가 있는 페이지에서는 아무것도 실행하지 않는다.
- 운영 Neon은 로컬보다 약 5–6배 느렸다(Phase 48). 그래서 결과 없음 화면에 언어 필터가 걸리면 +0.4–0.5s가 될 수 있다(INFERENCE). 원인은 `lang=latin`과 같은 언어 분류 비용이고, STORED generated column을 도입하면 함께 해소된다.
- 측정 뒤 적재 데이터는 지웠다(`ONLY_CLEAN`, 잔여 0).

## 10. 검색 회귀

| 항목 | 결과 |
|---|---|
| search:eval | 54/54. `SEARCH_EVAL_CASE` 52줄이 Phase 48 출력과 같다 |
| search:eval:multilingual | 15/15. 사례 14줄이 같고, summary도 R@10 0.7167, MRR 0.75, NDCG 0.7035, cjkZero 0.4로 같다 |
| 검색·count SQL | 바꾸지 않음(`src/db/queries/` diff 없음) |
| URL·필터·pager | searchHref, 파서, 파라미터를 바꾸지 않음. 기존 E2E 28건 통과 |

## 11. 테스트 결과

환경: 로컬 test DB(127.0.0.1:55432, `agentdock_test`), `TEST_DATABASE_URL`만 사용.

```
bun run check:boundaries  → check-boundaries: OK
bun run lint              → Checked 236 files. No fixes applied.
bun run typecheck         → OK
bun run test              → Test Files 82 passed; Tests 1558 passed | 2 skipped (1560)
bun run build             → OK
bun run test:e2e          → 33 passed (2회 연속, 최종 1회 13.9s)
bun run search:eval       → 54 passed
bun run search:eval:multilingual → 15 passed
```

- skip 2건은 기존의 조건부 skip이다.
  - `client.test.ts` wrong password: test URL에 비밀번호가 없다.
  - `search.test.ts` pg_trgm 없음 경로: 확장이 설치돼 있다.
- 새 테스트:
  - unit 4건(`bodyOutline`): 깊이 3 목록과 id 일치, fence·setext·blockquote·frontmatter에서 렌더러와 일치, CJK와 inline markup, raw HTML
  - E2E 5건: 설명문 접힘·펼침, 결과 없음의 경로별 수와 이동, 원문 목차 이동, 뒤로 가기 상태 보존, 모바일 결과 수 위치와 정렬 한 줄
- 수정한 기존 테스트 3건: 제목에 `id="file-L…"`가 붙어 `<h3>Title</h3>`처럼 정확히 비교하던 assertion을 고쳤다. 의도한 동작 변경이다.

## 12. 변경 파일

| 파일 | 변경 |
|---|---|
| `src/app/artifacts/page.tsx` | 설명문 `<details>`, 정렬 칩 `.facet-chips`, `relaxedCounts`와 결과 없음 목록. `appliedFilters`가 제거 뒤 상태도 돌려준다 |
| `src/app/globals.css` | `details.notice`, `.ways`, 모바일 정렬 줄, `.file-outline` |
| `src/app/r/[owner]/[repo]/[...path]/page.tsx` | 원문 목차 |
| `src/components/SkillBody.tsx` | 제목 id, `bodyOutline`, h6 override |
| `src/components/SkillBody.test.tsx` | 목차 테스트 4건, 제목 assertion 3곳 |
| `e2e/journeys.spec.ts` | journey 5건 |
| `package.json`, `bun.lock` | `unified@11.0.5`, `remark-parse@11.0.0`을 직접 의존성으로 선언했다. react-markdown이 이미 쓰는 같은 버전이라 설치 트리는 바뀌지 않는다(lock 2줄). 서버 전용이다 |
| `docs/images/phase51/*` | 스크린샷 9장(804KB) |

## 13. 보류한 개선안

| 안 | 이유 | 다시 볼 조건 |
|---|---|---|
| 유사 Artifact 추천 | 이름 검색으로 관련 대안이 나오는 비율이 31% | 설명·본문 기반 순위를 평가셋으로 측정할 수 있을 때 |
| 설치 명령 자동 표시 | 표본에서 자기 설치 명령이 0/4. 잘못된 명령을 보여 줄 위험 | 유형별로 검증된 출처(예: marketplace.json)가 생길 때 |
| 설명의 `\n` 정리 | 작성자 원문이고 0.3%(55건) | 행 가독성 불만이 관찰될 때 |
| 상세 → 검색 복귀 링크 | 뒤로 가기가 검색어·필터·정렬·쪽을 보존한다(E2E) | 외부 공유 링크로 들어온 사용자의 흐름을 다룰 때 |
| 첫 결과를 첫 화면에 완전히 넣기 | 남은 높이는 필수 범위 문장과 필터 3줄 | 필터 UI 개편 시 |
| 같은 내용의 복제본 표시 | content_hash로 확인할 수 있지만 쿼리·인덱스 검토가 필요 | 다음 Phase 후보 |

## 14. PENDING / NOT RUN

| 항목 | 구분 | 이유 |
|---|---|---|
| 운영 반영 후 화면·성능 확인 | PENDING | commit·push·deploy는 사용자가 한다 |
| 운영 Neon에서 결과 없음 화면 응답 시간 | PENDING | 배포 후 읽기 전용 GET으로 잰다 |
| axe-core 접근성 스캔 | NOT RUN | 새 요소는 기본 `<details>`/`<summary>`, `<nav aria-label>`, 링크뿐이다. 다음 접근성 sweep에서 확인한다 |
| 다크 모드 캡처 | NOT RUN | 색은 기존 토큰(`--fg`, `--border`, `--muted`)만 쓴다 |
| Vercel 빌드(`VERCEL=1`) | NOT RUN | 설정·의존성 트리 변경이 없다. CI Deploy가 확인한다 |

## 15. Evidence ID

- 기준 commit: `3ee2de5` (CI 40283234839, Deploy 40283407705, 운영 헤더 07:04:43Z)
- 운영 캡처: scratchpad `p51/before/` (`before.json`)
- 로컬 전후 측정: `p51/local-before.json`, `p51/local-after.json`, `count-y.mjs` 출력
- 본문 표본: `p51/bodies.json`(52건), 유사 검색 표본: `similar.py` 출력(26건)
- 목차 검증: `p51/outline.mjs` 출력
- 성능: `p51/bench.txt`(로컬 HTTP), `p51/relax-timing.txt`(19,113건), outline 파싱 3.5/9.2ms
- 테스트 로그: `p51/final-ci.log`, `p51/e2e-final.log`, `p51/eval54.txt`, `p51/ml-eval.txt`, `p51/build.log`

(scratchpad = `/tmp/claude-1000/-home-ChoiGwanghun-workspace-auto-agentdock/5f3bf29d-8c4e-417d-a177-083dcd61f8ca/scratchpad`)

## 16. Git Status

```
 M bun.lock
 M e2e/journeys.spec.ts
 M package.json
 M src/app/artifacts/page.tsx
 M src/app/globals.css
 M src/app/r/[owner]/[repo]/[...path]/page.tsx
 M src/components/SkillBody.test.tsx
 M src/components/SkillBody.tsx
?? docs/analysis/agentdock-phase51-53-discovery-ux.md
?? docs/images/phase51/
```

## 17. 권장 Commit

```bash
git add bun.lock package.json e2e/journeys.spec.ts src/app/artifacts/page.tsx src/app/globals.css \
  "src/app/r/[owner]/[repo]/[...path]/page.tsx" src/components/SkillBody.tsx src/components/SkillBody.test.tsx \
  docs/analysis/agentdock-phase51-53-discovery-ux.md docs/images/phase51
git commit -m "feat(ui): surface results on mobile, explain empty searches, outline artifact bodies" -m "Fold the filter note unless a capability or language filter is applied and keep the sort chips on one scrolled line, so the result count is back above y=741 on a 390x844 screen (was 904).

An empty result now lists each filter removed, and the words removed, with the count the reader would land on; only non-empty ones are links.

The detail page lists the file's own headings above the body. Headings get line-based ids after sanitizing, and the outline is parsed by the renderer's parser so the two cannot disagree. Three existing assertions now expect the id. unified and remark-parse are declared at the versions react-markdown already installs.

Search queries, ranking, URLs and filters are unchanged: search:eval 54/54 and multilingual 15/15 match Phase 48 case by case.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## 18. 다음 작업

1. commit·push 뒤 운영에서 확인한다(읽기 전용 GET).
   - 모바일 결과 수 위치
   - 결과 없음 화면의 응답 시간. 특히 언어 필터가 걸린 경우
   - 원문 목차
2. Actions secret `DATABASE_URL`과 `AGENTDOCK_TARGET_FINGERPRINT` 교체가 여전히 가장 급하다(Phase 48–50 §9). 이것은 UI와 무관하다.
3. 언어 STORED generated column migration을 검토한다. `lang=latin`과 결과 없음 화면의 언어 경로 비용을 함께 줄인다.
4. "같은 내용이 다른 저장소에도 있음" 표시를 검토한다. content_hash 동일성으로 확인할 수 있는 사실이라 출처를 판단하는 데 도움이 된다.
5. 다음 접근성 sweep(axe)에서 `<details>`와 목차를 포함해 확인한다.
