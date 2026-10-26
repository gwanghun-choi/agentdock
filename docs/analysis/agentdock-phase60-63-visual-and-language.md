# AgentDock Phase 60–63: Visual Experience · Motion · Interactive Graphics · Language Visibility

작성일 2026-10-26, 기준 commit `cb9a92e`(develop = origin/develop = 운영 배포 commit). 변경은 모두 미커밋 상태다.

표기:
- FACT: 이번 작업에서 실행·측정한 결과
- INFERENCE: 근거에서 추론한 판단
- PENDING: push나 운영 반영 뒤에야 확인할 수 있는 항목
- NOT RUN: 실행하지 않은 항목

---

## 1. 핵심 결론

- **(FACT) 정적이던 홈을 하나의 연출 중심으로 다시 짰다.** 1280 이상 화면의 hero 오른쪽 빈 열에 "Latest read" 그림을 넣었다. 실제 최신 Artifact를 repo → 선언 파일 → AgentDock read → commit의 git lane으로 그리고, Artifact 카드로 끝난다.
  - 로드할 때 lane, 노드 4개, 카드 순서로 1.5초 안에 그려진다. 그 뒤 빛 점이 lane을 두 번 타고 내려간 다음 멈춘다.
  - Phase 57에서 지운 dot grid와 wash 두 개를 "pipeline을 그리는 종이"로 되살렸다. 색은 accent와 commit teal이다.
  - 검색창에 focus가 가면 halo가 생기고 뒤의 wash가 밝아진다.
- **(FACT) Indexing Flow를 한 섹션 위로 올렸다(Recently indexed 바로 아래).**
  - 1280×800 기준 y=2,493 → 2,178이다.
  - 등장 효과를 load 시간이 아니라 스크롤에 묶었다(CSS `animation-timeline: view()`, 지원하지 않는 브라우저는 기존 시간 기반 효과).
  - 이전에는 화면 밖에서 재생되고 끝나 버렸다.
- **(FACT) 중국어 설명 Artifact를 기본 목록에서 뺐다.** 대상은 홈 feed와 type 수, browse, search, count, pagination, 0건 화면의 대안 경로, trigram 대체 결과다.
  - DB 행은 그대로이고, 저장소 페이지와 상세 URL도 그대로다.
  - `lang=zh`로는 중국어만, `lang=any`("All languages")로는 모든 언어를 다시 볼 수 있다.
  - 숨긴 사실은 모든 목록이 개수 옆에 밝힌다. 정책은 배열 하나(`HIDDEN_UNLESS_ASKED = ['zh']`)라 비우면 원래대로 돌아간다.
- **(FACT) 검증 결과**
  - unit 1,540 passed / 2 skipped (이전 1,536 + 신규 4)
  - E2E 42/42 (이전 39 + 신규 3). 로컬 서체와 CI 서체 재현 조건 둘 다 통과했다.
  - search:eval 54/54, 품질 지표(P@5, MRR, NDCG 등)는 이전과 같다.
  - multilingual 15/15
  - axe는 120회 실행에 위반 0건이다. reduce 40, no-preference 40, 최종 build 40.
- **(FACT) 비용**
  - JS는 바이트 단위까지 같다. client component는 4개 그대로다.
  - CSS는 +7.6KB(gzip +1.45KB), 홈 HTML은 gzip +714B다.
  - 운영 규모(19,113행) browse·home query는 약 +50ms다. 검색어가 있는 query는 CASE fold로 +8ms다(§14).

## 2. Git 기준

| 항목 | 값 |
|---|---|
| HEAD | `cb9a92e` feat(ui): self-hosted typeface, quieter motion, and font-independent mobile e2e |
| origin/develop | 같음 |
| 운영 `x-agentdock-commit` | `cb9a92e…` (FACT, 2026-10-26 읽기 전용 HTTP) |
| 직전 CI/Deploy | CI 40298291982 success, Deploy 40298494972 success |
| 작업 전 working tree | clean |

## 3. frontend-design 호출 확인

- (FACT) `Skill(frontend-design:frontend-design)`을 실제로 호출했고 `Launching skill: frontend-design:frontend-design`이 반환됐다. Skill 파일을 직접 읽는 방식은 쓰지 않았다.
- Skill 지침 중 이번 작업에 적용한 것:
  - 대담함은 한 곳에만 쓴다. 이번에는 Latest read 그림이다.
  - user가 일으키지 않은 모션은 한 번의 연출로 모은다.
  - 모든 섹션에 fade-up을 거는 방식은 피했다.
  - 숫자 마커는 실제 순서가 있는 곳(index flow)에만 쓴다.
  - 화면을 직접 찍어 자기 평가를 했다.

## 4. 기존 디자인 문제 분석

| 버전 | 첫인상 | 그래픽·모션 | 콘텐츠 강조 | 첫 Artifact 위치(1280/390) | 장점 | 단점 |
|---|---|---|---|---|---|---|
| A. Phase 54 이전(3a0dcb7) | 기술적, 입체적 | dot grid, 청·보라 orb 48초 drift, connector beam, 행 등장 | Featured 카드 + 자동 rail + 목록. 같은 feed를 세 번 표시 | 1,232 / 2,236 | 인덱싱 그림이 hero에 있어 제품 정체성이 즉시 보임 | 첫 화면에 실제 Artifact가 없음, 중복 표시 |
| B. Phase 54–56(73df119) | 검색 중심 | A의 장식 유지, flow는 하단으로 | 목록 하나 | 670 / 773 | 검색과 실제 Artifact가 첫 화면에 보임 | flow가 화면 밖에서 재생됨 |
| C. Phase 57–59(cb9a92e) | 정돈됐지만 평면적 | 장식 삭제, 등장 효과 대부분 삭제 | 목록 하나 | 646 / 755 | 가볍고 읽기 쉬움, 브랜드 서체 | 사용자 평가 "정적·평면적", hero 오른쪽 40%가 빈 캔버스 |
| D. 운영 | C와 같은 commit | C와 같음 | C와 같음, 다만 운영 데이터에 중국어 행이 많음 | — | — | Recently indexed에 중국어가 연속 노출됨(사용자 제기) |

- (INFERENCE) A의 장점은 "제품이 하는 일을 그림으로 보여 준다"는 것이었고, 이 장점은 B와 C에서 하단으로 밀려나 사라졌다.
- A의 단점은 그 그림이 콘텐츠를 밀어냈다는 것이다.

## 5. 디자인 방향

- **주제:** 공개 GitHub 저장소에서 agent artifact를 읽어 commit까지 추적하는 index다. 이 분야를 대표하는 시각 언어는 git lane, commit sha, 선언 파일 이름이다.
- **방향:** Modern AI developer platform + technical data visualization이다. 모션은 한 번의 연출로 모으고, user 조작에 반응하는 모션만 따로 둔다.
- **토큰**
  - 기존 색 토큰은 유지한다.
  - `--commit`(teal)을 추가했다. MCP badge 색과 같은 값이어서 이미 대비 측정을 거친 색이다.
  - `--grid-dot`, `--glow-a`, `--glow-b`를 추가했다.
  - 종류별 `--hue`를 :has(.badge-*)로 행과 type 카드에 올렸다.
- **서체:** Schibsted Grotesk는 유지했다. 화면으로 비교해 보니 hero 제목의 성격을 이미 이 서체가 만들고 있어서, 바꾸면 비용만 늘어난다고 판단했다.
- **스스로 거른 기본값:**
  - 큰 숫자와 gradient를 쓰는 hero, 모든 카드의 등장 효과, 무한 drift는 쓰지 않았다.
  - 무한 drift를 넣으려면 WCAG 2.2.2의 정지 수단이 필요해진다.

## 6. Homepage 개선

후보 비교(Featured/Recently indexed):

| 후보 | 시각 효과 | 중복 | 밀도 | 첫 화면 | 성능 | 모바일 |
|---|---|---|---|---|---|---|
| A. Featured + Compact List | 중 | 1회 | 중 | 카드 높이만큼 밀림 | 0 query | 밀림 |
| B. Animated Rail + List | 높음 | 2배(rail 복제 포함) | 높음 | 밀림 | HTML +12%(Phase 54 측정) | 정지 수단 필요 |
| C. Featured Grid + Recently Indexed | 중 | 다수 | 높음 | 크게 밀림 | 0 query | 밀림 |
| **D. Visual Spotlight + Compact Feed (채택)** | 높음 | **최신 1건, 데스크톱만** | 그대로 | 데스크톱 +40px(안내 줄 포함), 모바일은 숨김 행이 없으면 그대로 | 0 query, HTML gzip +714B | 표시하지 않음 |

- **채택(D):** spotlight를 빈 오른쪽 열에 둔다. 따라서 feed를 밀어내지 않는다. spotlight의 내용은 인덱싱 과정 그 자체다.
- **인기·추천 순위를 만들지 않음:** spotlight에 쓰는 데이터는 `recent[0]`(updated_at 순 최신)뿐이다. 라벨도 "Featured"가 아니라 "Latest read"다.
- **type 카드:** 종류 색 줄, 은은한 종류 색 wash, hover 시 2px 상승을 넣었다.

## 7. Hero 그래픽

- **바탕(`.hero::before`):** dot grid(1.1px, 22px 간격, 16%)를 위쪽 가운데를 중심으로 한 radial mask로 흐리게 한다. viewport 끝까지 bleed된다.
- **wash(`.hero::after`):** 두 개의 wash를 둔다. 하나는 검색창 뒤에 있는 accent wash이고, 다른 하나는 commit 노드 뒤에 있는 teal wash다.
  - 평소 opacity는 0.7이다.
  - `.hero:has(.hero-search input:focus)`이면 1이 된다. focus 상태에 대한 시각 응답이다.
- **검색창:** focus 시 5px accent halo와 아래쪽 accent 그림자가 생긴다. 이것은 기존 2px focus ring을 대신하지 않고 그 아래에 더해진다.
- **Latest read(`LatestRead.tsx`, server component)**
  - 구조는 `<figure>`, `<figcaption>`, `<ol>`(4단계), 카드다. 이름 링크의 `::after`가 카드 전체를 덮는다.
  - commit 링크에는 "Source on GitHub at commit" sr-only 문구가 있다.
  - 64rem 미만에서는 `display:none`이다.

## 8. 애니메이션

| 효과 | 구현 | 시간 | 반복 | 가치 |
|---|---|---|---|---|
| hero 바탕 fade-in | opacity | 0.9s | 1 | 첫 인상 |
| lane 그리기 | scaleY | 0.9s(+0.2s) | 1 | 읽기 과정을 순서대로 보여 줌 |
| 노드 4개 | opacity+translateX, 0.2s 간격 | ~1.2s | 1 | 단계 구분 |
| 카드 등장 | opacity+translate+scale | 0.52s(+1.0s) | 1 | 결과물 강조 |
| lane 빛 | opacity+translateY | 1.5s(+1.4s) | 2 | "read 후 commit에 기록됨" |
| flow 단계·연결선·파일 칩·count | scroll-driven(view()), fallback은 시간 | 진입 구간 | 1 | 화면 밖에서 재생되던 문제 해결 |
| 검색 focus·row·type 카드 hover | transition `--dur`/`--dur-fast` | 120–180ms | — | 조작 응답 |

- **(FACT) 모든 시간 기반 애니메이션은 5초 안에 끝난다.** E2E가 `getAnimations()`의 endTime ≤ 5000으로 단언한다. 예외는 loading skeleton sweep 하나로, 자리표시가 있는 동안만 돈다.
- **(FACT) reduced motion:** 애니메이션 수 0(E2E 단언). keyframe은 모두 `no-preference` 블록 안에 있다(motion.test.ts 통과).
- **보류:** hero wash의 무한 drift. 정지 수단이 필요하고 그만한 가치가 없다고 판단했다(§20).

## 9. Indexing Flow 개선

- **위치:** hero, Recently indexed, **How a repository gets indexed**, Browse by type 순서로 바꿨다(이전에는 Browse by type 다음이었다).
  - 1280에서 y=2,493 → 2,178, 390에서 3,928 → 3,178이다.
  - Hero 위로는 올리지 않았다. Phase 54에서 측정한 대로 첫 Artifact를 1,232px까지 밀어내기 때문이다. 대신 hero의 Latest read가 축약판(Compact Preview) 역할을 한다.
- **그래픽:**
  - hero와 같은 dot 바탕을 깔았다.
  - 연결선은 accent 색이다.
  - 마지막 단계는 commit teal로 칠하고 그림자를 줬다. hero의 lane이 끝나는 곳과 같은 색이다.
- **바꾸지 않은 것:** 단계 내용, 파일 이름 8개, 문구는 그대로다. 존재하지 않는 단계를 만들지 않았다(IndexFlow.test 통과).
- **count의 의미:** "N artifacts indexed right now"는 숨김 언어를 포함한 indexed 수다(§13).

## 10. Search/Discovery 개선

- **Description facet:** 첫 칩이 "All except Chinese"(기본)이고, 다음 칩이 "All languages"(`lang=any`)다.
- **결과 개수 줄:** 개수 옆에 "Not counting descriptions written in Chinese. Include them"을 붙였다.
  - 휴대폰(≤40rem)에서는 숨긴다. 첫 결과를 +33/+54px 밀어 기존 위치 가드(<625)를 깨기 때문이다. 같은 사실은 선택된 칩이 화면에 표시한다.
- **`any` 모드로 완화될 때:** 문구를 "No artifact outside descriptions written in Chinese matched every word…"로 좁혔다. 이 문구는 휴대폰에서도 보인다.
- **0건 화면:** "Including descriptions written in Chinese — N artifacts" 경로를 결과가 있을 때만 보여 준다. 이때 "has indexed a match, but…"이라고 말하고, "not indexed"라고 하지 않는다.
- **trigram 대체 결과:** 같은 고지와 링크를 붙였다.
- **corpus 전체가 숨김 언어인 경우:** "Nothing indexed"가 아니라 0건 화면으로 보낸다. 이 분기에서만 count를 한 번 더 실행한다.
- 검색 알고리즘, 가중치, 순위는 바꾸지 않았다(§12, §18).

## 11. Chinese Visibility 정책

- **(FACT) 운영 설명 19,113건(2026-10-26 크롤)의 분포:** latin 17,082, 설명 없음 1,105, zh 609(3.2%), ja 169, mixed 59, other 51, ko 37, unknown 1.
- **숨기는 대상은 `zh` 하나뿐이다.**
  - **ja/ko:** kana가 CJK의 1/10 이상이면 ja, Hangul이 1/2 이상이면 ko로 각자 분류되므로 숨기지 않는다.
  - **mixed:** 6단어 라틴 문장이 정의상 포함되므로 유지한다. 59건 중 46건은 Han만 있고 kana·Hangul은 없다. 즉 영어 옆에 중국어가 붙은 경우다.
  - **unknown:** Han이 4자 미만인 경우인데, 유지한다.
- **한계(INFERENCE):** kana가 10% 미만인 한자 위주 일본어는 `zh`로 분류되어 숨겨진다. 이 상한은 기존 분류에 이미 적혀 있었다.
- **새 언어 감지 엔진은 도입하지 않았다.** Phase 41의 `SUMMARY_LANGUAGE`를 재사용했다.

## 12. 언어 필터 처리

| URL | 의미 |
|---|---|
| `lang` 없음 | 기본: `HIDDEN_UNLESS_ASKED`(zh) 제외 |
| `lang=zh` / `ja` / `ko` / `latin` / `mixed` / `other` | 그 언어만(기존과 동일, 명시 선택이 기본보다 우선) |
| `lang=any` | 모든 언어(신규. 숨김 해제) |
| `lang=xx` 등 무효 값 | 기본으로 처리(기존처럼 무시) |

- **URL 호환:** 기존 URL은 모두 계속 동작한다. 다만 `lang` 없는 URL의 의미는 "모든 언어"에서 "중국어 제외"로 바뀌었다. 이것은 의도한 정책 변경이다.
- **`lang=any` 유지:** 새 검색, 정렬, 페이지 이동에서 유지된다(hidden input과 `searchHref`). E2E로 확인했다.
- **query 계층의 기본값은 여전히 "모든 언어"다.** 숨김은 route가 `withDefaultVisibility`로 넣는다. 그래서 다음은 바뀌지 않는다.
  - search eval 두 개
  - quality report의 `listing-counts-agree` 검사
  - ops report
  - sync summary

## 13. DB 조회 및 집계 변경

- **Migration·schema·sync 변경 없음.** 조회 시점 SQL 식만 추가했다.
- **`visibleLanguage(hidden)`(language.ts):** `summary is null OR summary !~ [CJK] OR coalesce(SUMMARY_LANGUAGE,'') NOT IN (…)`이다. 빈 배열이면 `true`를 돌려준다.
- **`searchWhere`(search.ts):**
  - 검색어가 있으면 `CASE WHEN <text match> THEN <visible> ELSE false END`로 묶는다. 일치한 행만 분류된다.
  - 검색어가 없으면 독립 conjunct다.
- **홈:** `listPackages({ hiddenLanguages })`와 `countVisibleByType(hidden)`을 쓴다. 후자는 grouped query 하나에서 `count(*) FILTER`로 visible과 hidden을 함께 센다. 홈의 query 수는 3개 그대로다.
- **수치의 의미**

| 화면 수치 | 의미 |
|---|---|
| 홈 칩 "All N", "Browse all N artifacts", `/artifacts` 개수 | **Visible**(기본 목록) |
| 홈 "Not listed by default: M artifacts …" | 숨긴 수 |
| Index flow "N artifacts indexed right now" | **Indexed listed**(visible + hidden) |
| ops/quality/sync 집계 | 바꾸지 않음(모든 언어) |

- (FACT, 19k 데이터) visible 18,504 + hidden 609 = listed 19,113이다. browse 기본 count 18,504, `lang=any` 19,113, `lang=zh` 609로 정확히 맞는다.
- (FACT) 같은 후보 집합 안에서는 순위가 같다. `q=review` 상위 50건이 "any 결과에서 zh를 뺀 것"과 순서까지 일치한다.

## 14. 성능

**DB(FACT, 로컬 PG17, 운영 설명 19,113건을 `agentdock_test`에 적재해 9회 p50 측정 후 삭제, 잔여 0)**

| 경로 | 이전(any) | 기본(hide zh) |
|---|---:|---:|
| browse count | 87.9 ms | 137.6 ms |
| browse rows p1 | 93.6 | 143.4 |
| browse rows offset 9,000 | 195.3 | 236.5 |
| browse rows offset 18,000 | 289.7 | 323.2 |
| `q=review` count (CASE fold) | 22.7 | 31.3 |
| `q=review` count (독립 conjunct, 거절) | 23.4 | 75.3 |
| `q=数学建模` count | 13.9 | 13.9 |
| 홈 listPackages(10) | 93.4 | 143.6 |
| 홈 type counts | 89.1 (countPackagesByType) | 146.5 (countVisibleByType) |
| 참고: `lang=latin` count | 164.4 | — |
| raw count, `~` 사전 필터 있음/없음 | — | 54.9 / 82.2 |
| raw count, ASCII(`octet_length`) 사전 필터 추가 | — | 55→54 (효과 없어 거절) |

- **비용의 원인:** CJK가 들어 있는 1,132행을 분류하는 데서 나온다. 분류 자체 말고는 어느 행이 중국어인지 말해 줄 수단이 없다.
- **최소 비용 대안 비교**
  - 검색어 경로: CASE fold를 채택했다(75→31ms).
  - 목록 경로: STORED generated column을 쓰면 indexed equality가 된다. 다만 migration이므로 **승인 대상**이다(§21).
  - `ponytail:` 표식에 상한을 적었다. browse count가 200ms를 넘으면 다시 검토한다(이 속도로 약 28k행).
- **화면(FACT, 로컬 seed, Chromium)**
  - JS 575,673B는 전후가 같다. client component는 4개다.
  - CSS 37,849 → 45,463B(gzip 7,531 → 8,984), 홈 HTML gzip 13,051 → 13,765B다.
  - CLS는 0 → 0이다.
  - 첫 5초 main-thread task: 1280에서 129 → 176ms, 390(CPU ×4)에서 196 → 183ms.
  - 전체 스크롤: 34ms를 넘는 frame 0, p95 16.7ms.
  - 5초 뒤에는 실행 중인 애니메이션이 없어 CPU와 배터리를 계속 쓰지 않는다.
  - 서체는 변경하지 않았다(Phase 57의 46,752B woff2 그대로).
- **운영 기준선(FACT, 읽기 전용, cb9a92e):** `/` p50 1,235ms, `/artifacts` 1,218, `q=review` 1,106, `lang=zh` 1,356(5회, 네트워크 포함). 변경 후 운영 수치는 **PENDING**이다.

## 15. 접근성

**자동(FACT)**
- axe(WCAG 2.0/2.1/2.2 A·AA + best-practice), 10페이지 × 1280/390 × light/dark에서 실행했다.
  - before 40회 0건, after 40회 0건, motion(no-preference, 5.2초 대기) 40회 0건, 최종 build 40회 0건이다.
  - 새 페이지(`lang=any`, `q=wenjian` 0건 화면, `lang=zh`)도 포함했다.
- E2E로 단언한 것:
  - reduced motion에서 애니메이션 0개
  - 시간 기반 애니메이션은 모두 5초 이하
  - 휴대폰에서 trace 숨김
  - 가로 넘침 없음

**수동(FACT, Playwright 키보드 순회와 ARIA snapshot)**
- **Tab 순서:** skip, brand, nav, 검색, 버튼, type 칩 7개, commit 링크, 카드 이름 링크, feed 순이다. 모든 요소에 2px solid focus ring이 보인다.
- **리뷰 뒤 고친 점:**
  - commit 링크 이름이 "c4b82b0" 하나뿐이었다. "Source on GitHub at commit …"으로 바꿨다.
  - 카드 링크 이름에 설명 전체가 들어가 있었다. 이름만 링크로 하고, 카드 전체를 클릭할 수 있게 stretched ::after를 썼다.
- **heading 계층:** 변경 없음(figure에 heading 없음).
- **dot 바탕 위 텍스트:** 점 면적은 1% 미만이다. axe는 배경 이미지 아래의 단색 `--bg`로 대비를 판정해 통과했다.
- **실기기 screen reader·Safari·Firefox:** NOT RUN.

## 16. 변경 전후 스크린샷

`docs/images/phase60/`에 41장이 있다(PNG 256색 양자화, 1.73MB). 같은 seed 데이터와 같은 viewport로 찍었고, before는 cb9a92e build, after는 이번 build다. reduced motion(정지 상태)이다.

- **홈 (light):** 320 / 375 / 390 / 768 / 1280 / 1920 before·after. 홈 dark는 390 / 1280.
- **검색:** light 375 / 390 / 1280, dark 390 / 1280.
- **상세:** 1280 light, 390 dark. 상세 화면은 변경하지 않았고, hover 색만 바뀌었다.
- **Indexing Flow:** 390 / 1280 × light / dark.
- **모션:** `after-motion-latest-read-frames.png`(300 / 700 / 1100 / 1700 / 2300ms 프레임)
- **언어 정책:** `after-lang-default-1280-light.png`(0건과 대안 경로), `after-lang-any-1280-light.png`
- **README 대표 이미지:** `docs/images/agentdock-home.png`를 교체했다.

첫 행과 flow 위치(FACT, 같은 데이터):

| 화면 | before → after |
|---|---|
| 홈 첫 행 1280 | 646 → 686 (+40, 숨김 안내 줄과 hero) |
| 홈 첫 행 390 | 755 → 809 (+54, 숨김 안내 줄. 숨긴 행이 없는 데이터에서는 755 → 755) |
| 홈 첫 행 320 | 802 → 856 |
| 검색 첫 행 375 / 390 / 320 | 603 / 603 / 624 그대로 |
| 검색 첫 행 1280 | 578 → 616 (Description 칩이 2줄) |
| flow 1280 / 390 | 2,493 → 2,178 / 3,928 → 3,178 |
| 가로 넘침 | 모든 화면 0 |

## 17. PR Review Toolkit 결과

`/pr-review-toolkit:review-pr`를 실행했다. 리뷰어 4명(code, tests, comments, silent-failure)을 병렬로 돌렸다.

| 리뷰어 | 등급 | 지적 | 처리 |
|---|---|---|---|
| code | IMPORTANT | commit 링크 이름이 sha뿐 | 수정(sr-only 문구) |
| code | minor | corpus 전체가 숨김 언어일 때 "Nothing indexed"라는 모순 | 수정(홈은 `hidden===0`일 때만, /artifacts는 0건 분기로 보냄) |
| code | minor | IndexFlow 주석 "restates" | 수정 |
| silent-failure | HIGH | trigram 대체 결과에 숨김 고지 없음 | 수정(고지와 링크) |
| silent-failure | HIGH | `any` 완화 문구가 거짓이 될 수 있음, 휴대폰에서 고지 없음 | 수정(문구를 좁히고 휴대폰에서도 보이게) |
| silent-failure | MEDIUM | 0건 화면의 "not indexed" 단정 | 수정 |
| silent-failure | MEDIUM | 낡은 주석 5곳 | 수정 |
| silent-failure | LOW | label 접두어로 경로를 식별 | 수정(`hiddenLanguage` flag) |
| silent-failure | LOW | DB 인코딩이 UTF8이 아니면 숨김이 동작하지 않음 | 기존 위험. 운영 UTF8이고 Phase 41과 같은 regex라 유지(§20) |
| tests | 7점 | searchMode가 숨김 때문에 `any`로 완화되는 테스트 없음 | 추가 |
| tests | 6점 | `lang=any`가 새 검색·정렬 뒤에도 유지되는지 테스트 없음 | E2E 추가 |
| comments | 높음 | 모션 블록 머리말이 "scroll 연동 없음, 1회 재생"이라 사실과 다름 | 수정 |
| comments | 높음 | 보고서 참조가 존재하지 않음 | 이 보고서로 해결(§14, §15) |
| comments | 높음 | `.board-scope`가 기존 주석과 그 규칙 사이에 끼어듦 | 위치 수정 |
| comments | 중–높음 | kana·Hangul 판정 설명이 틀림 | 수정(1/10, 1/2 기준과 상한 명시) |
| comments | 중 | "배열을 비우면 원복"이 거짓(안내문에 빈 라벨) | 안내문을 조건부로 바꿔 사실이 되게 함 |
| comments | 중 | `hiddenLanguages` 호출자 설명 오류, `any`가 동작하는 원리 미기재 | 수정 |
| comments | 중 | count-up "on arrival" 서술 | 수정 |
| comments | 개선 | CASE 채택안 수치, 홈 수치 측정 근거, lane 빛 기하, mask 방향, 46/59 서술, flow 새 y, 하드코딩 라벨, 행 edge 주석, motion.test 주석, e2e 테스트 이름, README | 모두 수정. lane 빛은 실제 끝점 오차 4px까지 코드로 고쳤다 |

반박한 지적은 없다. 수정 뒤 전체 검증(§18)을 다시 실행했다.

## 18. 테스트 결과

| 항목 | 결과 |
|---|---|
| `bun run check:boundaries` | OK |
| `bun run lint` | 234 files, 경고 0 |
| `bun run typecheck` | OK |
| `bun run test` | 80 files, **1,540 passed / 2 skipped** (skip은 기존과 같은 조건부 2건) |
| `bun run build` | OK |
| E2E 로컬 서체 / CI 서체(DejaVu, FONTCONFIG_FILE) | **42/42 / 42/42** |
| `search:eval` | **54/54**, 품질 지표 JSON이 이전과 같음(latency만 다름) |
| `search:eval:multilingual` | **15/15** |
| axe | 160회 실행 위반 0 (before 40 포함) |

새 테스트 목록:
- **unit(DB) 4개**
  - 기본 숨김, 순서 유지, 명시 언어 우선, trigram fallback
  - 기본 집합 pagination과 count 일치
  - 홈 feed·집계 정합성(visible + hidden = 전체, visible = browse count), 저장소 페이지는 전체 표시
  - searchMode 완화
- **E2E 3개**
  - 중국어 기본 제외, 0건 대안 경로, `lang=any` / `zh` / `ja`, 유지, 저장소·상세 접근
  - 홈 숨김 안내와 칩 수 정합성
  - Latest read와 최신 행 일치, 5초 이하, reduced motion 0
- **기존 E2E 수정:**
  - 기본 칩 라벨 기대값 2곳: "Any language" → "All except Chinese". 정책 변경이 이유다.
  - 휴대폰 홈 테스트에 trace 숨김 단언을 추가했다.

**변경 전 FAIL, 변경 후 PASS(FACT)**
- `visibleLanguage`를 `true`로 바꾼 mutation에서 신규 unit 3개가 FAIL했고, 원래대로 되돌리자 PASS했다.
- 0건 대안 경로를 결과가 0일 때도 노출하던 첫 구현에서 기존 empty-state E2E가 FAIL했다. 구현을 고쳐 PASS시켰고, 테스트는 바꾸지 않았다.

**정책과 알고리즘의 분리:** eval은 query 계층을 정책 없이 호출한다. 그래서 eval 54/54와 15/15는 알고리즘 회귀가 없다는 증거다. 정책의 효과는 §13의 19k 측정(숨김 609건, 나머지 순서 동일)으로 따로 검증했다.

## 19. 변경 파일

| 파일 | 내용 |
|---|---|
| `src/db/queries/language.ts` | `HIDDEN_UNLESS_ASKED`, `CjkLanguage`, `visibleLanguage` |
| `src/db/queries/search.ts` | `hiddenLanguages`, `ANY_LANGUAGE`, CASE fold |
| `src/db/queries/packages.ts` | `listPackages({hiddenLanguages})`, `countVisibleByType` |
| `src/app/artifacts/page.tsx` | `withDefaultVisibility`, `lang=any`, 칩, 고지, 0건·fuzzy·corpus-empty 처리 |
| `src/app/page.tsx` | Latest read, 숨김 안내, 섹션 순서, visible·indexed 수 |
| `src/components/LatestRead.tsx` (신규) | hero 그림 |
| `src/components/IndexFlow.tsx`, `searchState.ts`, `src/app/motion.test.ts` | 주석 |
| `src/app/globals.css` | 토큰, hero 바탕, focus halo, trace, hue, flow, scope, 모션 |
| `src/db/queries/search.test.ts` | unit 4개 |
| `e2e/journeys.spec.ts`, `e2e/seed.mjs`, `e2e/fixtures/language-visibility/` (신규) | E2E와 fixture |
| `README.md`, `README.en.md` | 언어 정책과 모션 문단 |
| `docs/images/agentdock-home.png`, `docs/images/phase60/` (신규 41장) | 스크린샷 |
| 이 보고서 | — |

새 의존성, 외부 폰트, CDN은 추가하지 않았다. client component는 4개 그대로다.

## 20. 보류한 개선

- **hero wash 무한 drift:** WCAG 2.2.2 정지 수단이 필요하고, 그 대가로 얻는 가치가 작다.
- **휴대폰용 Latest read 축약판:** 첫 화면에서 첫 행을 밀어낸다. 휴대폰 hero는 바탕과 focus 효과만 받는다.
- **상세·저장소 페이지 그래픽:** 중심 범위가 아니다. hue edge만 공유한다.
- **결과 집합별 실제 숨김 수 표시:** count query가 한 번 더 필요하다. 지금은 "Not counting…" 고지만 하므로, 숨긴 행이 0인 집합에도 고지가 나온다(과잉 고지).
- **DB 인코딩 확인:** 운영은 UTF8이다. SQL_ASCII에서는 숨김이 동작하지 않는데, 이 위험은 Phase 41 분류에도 똑같이 있다.

## 21. 운영 승인 사항

- **(제안, 승인 필요) `package.summary_language` STORED generated column과 index를 두는 migration:** 목록의 +50ms를 없애고 `lang=latin`의 비용도 함께 없앤다. 테이블 rewrite가 생긴다. 지금은 필요하지 않고, 상한은 browse count 200ms(약 28k행)다.
- 이번 변경 자체에는 운영 설정, Secret, DB 변경이 필요 없다.

## 22. PENDING / NOT RUN

- PENDING: push 뒤 CI 통과, Deploy, 운영 `x-agentdock-commit` 변경, 운영 응답 시간 재측정, 운영 홈에서 중국어가 빠졌는지 확인.
- NOT RUN: 실기기(iOS Safari, Android Chrome), Firefox와 Safari의 scroll-driven fallback 육안 확인, 실제 screen reader 낭독.
- INFERENCE: 운영 홈의 Recently indexed에서 중국어 연속 노출은 사라진다. 운영 zh 609건이 이 정책의 대상이다.

## 23. Evidence ID

| ID | 내용 | 위치(scratchpad `p60/`) |
|---|---|---|
| E60-01 | before/after 측정 JSON | `before2.json`, `after2.json` |
| E60-02 | 모션 프레임, 타임라인 상태 | `frames.mjs`, `tl.mjs` |
| E60-03 | UI 성능(CLS·task·frame) | `perfui.mjs`, `perfui.txt` |
| E62-01 | 19k DB 성능 | `perf.ts`, `perf.txt`, `perf2.txt`, `perf3.txt` |
| E62-02 | 언어 분포 | `../p41/all-lang.jsonl` 집계 |
| E62-03 | mutation FAIL과 PASS | search.test 실행 로그(세션) |
| E63-01 | axe | `axe-before.json`, `axe-after.json`, `axe-after-motion.json`, `axe-final.json` |
| E63-02 | ci / e2e / eval | `ci2.log`, `e2e3.log`, `e2e2-ci.log`, `search:eval-2.log`, `search:eval:multilingual-2.log` |
| E63-03 | 운영 기준선 | 읽기 전용 HTTP 5회 측정(세션) |

## 24. Git Status

```
 M README.en.md
 M README.md
 M docs/images/agentdock-home.png
 M e2e/journeys.spec.ts
 M e2e/seed.mjs
 M src/app/artifacts/page.tsx
 M src/app/globals.css
 M src/app/motion.test.ts
 M src/app/page.tsx
 M src/components/IndexFlow.tsx
 M src/components/searchState.ts
 M src/db/queries/language.ts
 M src/db/queries/packages.ts
 M src/db/queries/search.test.ts
 M src/db/queries/search.ts
?? docs/analysis/agentdock-phase60-63-visual-and-language.md
?? docs/images/phase60/
?? e2e/fixtures/language-visibility/
?? src/components/LatestRead.tsx
```

## 25. 권장 Commit

```bash
cd ~/workspace_auto/agentdock
git add README.md README.en.md docs/images/agentdock-home.png docs/images/phase60 \
  docs/analysis/agentdock-phase60-63-visual-and-language.md \
  e2e/journeys.spec.ts e2e/seed.mjs e2e/fixtures/language-visibility \
  src/app/artifacts/page.tsx src/app/globals.css src/app/motion.test.ts src/app/page.tsx \
  src/components/IndexFlow.tsx src/components/LatestRead.tsx src/components/searchState.ts \
  src/db/queries/language.ts src/db/queries/packages.ts src/db/queries/search.ts \
  src/db/queries/search.test.ts
git commit -m "feat(ui): latest-read hero, scroll-tied index flow, and Chinese descriptions hidden by default" -m "The home page's empty right column now draws the newest artifact through the four steps of a read (repository, declaring file, read, commit) on a git lane, over the dot grid and washes Phase 57 removed. One load sequence, every animation over inside 5 s, none under reduced motion. The index flow moves up a section (y 2,493 -> 2,178 at 1280) and reveals as it scrolls in.

Listings leave out artifacts whose description is Chinese (HIDDEN_UNLESS_ASKED = ['zh']) unless a language is named: home feed and counts, browse, search, counts, the fallback. Nothing is deleted; lang=zh and the new lang=any list them, and every listing says what it leaves out. The query layer still defaults to every language, so both search evaluations and the quality report are unchanged. With words the test is folded into the match (review count 23 -> 31 ms at 19,113 rows, 75 ms as a separate conjunct); listings without words pay ~+50 ms, ceiling and upgrade in language.ts.

Tests: two e2e chip expectations change from 'Any language' to 'All except Chinese' because the default changed.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## 26. 다음 작업

1. push한 뒤 CI, Deploy, 운영 commit header를 확인한다. 운영 홈과 `/artifacts`에서 중국어가 빠졌는지, `lang=any`와 `lang=zh`가 동작하는지 읽기 전용으로 확인한다.
2. 운영 응답 시간을 다시 측정하고 §14의 기준선과 비교한다. browse count가 200ms에 가까워지면 §21의 migration 승인을 요청한다.
3. 실기기에서 확인한다. iOS Safari는 scroll-driven 지원 여부와 fallback, Android Chrome은 저사양에서의 load 연출을 본다.
4. 필요하면 상세 페이지에도 hero 언어(lane, commit teal)를 확장한다.
