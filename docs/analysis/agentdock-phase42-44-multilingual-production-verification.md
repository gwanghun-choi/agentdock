# AgentDock Phase 42–44 — 다국어 운영 검증 · 검색 품질 · 운영 마감

- 작성: 2026-10-26 (03:50–04:30Z 측정)
- 기준: HEAD `e4c2773` = origin/develop = Production. Phase 41·42·43 변경은 working tree에만 있고 커밋하지 않았다.
- 운영 접촉
  - 읽기 전용 GET 약 103회를 순차로, 1초 간격으로 보냈다. 모두 HTTP 200이었다.
  - `gh run list` / `gh run view`와 secret·variable의 이름·갱신 시각만 조회했다. 값은 조회하지 않았다.
  - 운영 DB 접속, migration, Sync 실행, 재enqueue, 배포, commit·push는 하지 않았다.
- 표기
  - **FACT**: 이번에 실행해 확인한 것
  - **INFERENCE**: 근거에서 추론한 것
  - **PENDING**: 조건이 갖춰지면 확인할 것
  - **NOT RUN**: 실행하지 않은 것

## 1. 핵심 결론

| 질문 | 답 | 근거 |
|---|---|---|
| Phase 41 배포 가능? | **가능하다(코드 기준).** 리뷰에서 나온 RISK 2건은 수정했고, 1건은 실측해 문서화했다. 검증은 전부 통과했다. | §7, §17 |
| 운영 UI 정상? | **확인할 수 없다(NOT RUN).** Production이 `e4c2773`이라 Phase 41이 배포되지 않았다. | §2·§3 |
| 언어 필터 추가 지연 | 운영 값은 **PENDING**이다. 로컬에서는 +0–72ms였다. 운영 비교용 기준선(필터 없음, `lang` 무시 상태)은 측정해 두었다. | §6 |
| 기존 검색 품질 | **유지된다.** `search:eval` 54/54이고, 사례별 출력이 Phase 41과 같다. 영어 대조 4개 검색어의 결과·순서도 같다. | §7·§17 |
| CJK 검색 품질 | **변경 전:** 판정 6개 검색어 Recall@10 0.42, nDCG@10 0.50, 결과 0건 4/10.<br>**변경 후:** Recall@10 0.72, nDCG@10 0.72. | §9 |
| 최선의 무료 방법 | 후보 D를 택했다. CJK 검색어일 때만, **기존 trigram index를 이용한 이름+설명 부분 문자열 일치를 OR로 추가**한다. migration과 API Key가 필요 없다. | §10 |
| 지금 적용? | **적용했다(로컬).** §11의 구현 조건 8개를 모두 충족한다. 커밋 여부는 사용자가 정한다. | §11 |
| Sync Guard·수집 | **PENDING.** guard가 들어간 코드가 배포된 뒤 예약 Sync가 한 번도 실행되지 않았다. secret도 10/22 이후 그대로이므로 첫 실행은 guard FAIL이 예상된다(INFERENCE). | §12·§13 |
| Job 771·978 | **복구되지 않았다.** 둘 다 `could not store the result`, Attempt 3 상태다. 재enqueue 흔적이 없다. | §15 |
| Refresh cap 150 | **변경하지 않는다.** guard 이후 정상 Sync가 0회라 평가 근거가 없다. | §16 |
| 커밋·푸시 | 검증은 모두 통과했다. 커밋 메시지를 §22에 제안했다. 커밋·푸시는 사용자가 한다. | §17·§22 |

- Phase 38–40 보고서(`docs/analysis/agentdock-phase38-40-operational-recovery.md`)는 **존재하지 않는다**(FACT, `find` 0건).
  - Obsidian work-log에도 Phase 38–40 기록이 없다.
  - 따라서 이번 Phase 44는 Phase 35–37 보고서와 Actions 기록을 기준으로 판단했다.

## 2. Git 및 Production SHA

| 항목 | 값 | 구분 |
|---|---|---|
| 현재 브랜치 | `develop` | FACT |
| HEAD | `e4c277323030130fb86792ee66684c778e555a64` | FACT |
| origin/develop | 같음 | FACT |
| Production SHA | `x-agentdock-commit: e4c2773…`(`/` HEAD 응답과 `/artifacts?lang=zh` 응답, 03:50Z) | FACT |
| 마지막 CI / Deploy | CI 40256640152 success, Deploy 40256758887 success(`e4c2773`, 01:58Z). 단계는 gate·migrate plan·migrate·verify·vercel deploy·smoke 모두 success. | FACT |

- `release.mjs`의 `servedCommit`이 쓰는 헤더와 같은 방법으로 확인했다.

## 3. Phase 41 배포 상태

- **배포되지 않았다(FACT).** Phase 41 파일은 모두 미커밋 상태이고, 운영은 `e4c2773`을 서비스한다.
- 운영에서 `?lang=zh`는 무시된다. `/artifacts`와 첫 결과가 같다(`/r/oil-oil/oil-ui/SKILL.md`).
- 지시에 따라 운영 기능 검증(§4 UI·§5 필터·§6 지연)은 실행하지 않았다(NOT RUN). 대신 다음을 했다.
  1. 코드 리뷰(§7)
  2. 리뷰 결함 수정과 로컬 전체 검증(§17)
  3. 배포 후 비교용 운영 기준선 측정(§6)

## 4. 다국어 UI 검증

| 항목 | 운영 | 로컬 |
|---|---|---|
| 행의 언어명 표시, `lang` 속성 | NOT RUN | E2E 언어 여정(`journeys.spec.ts`) PASS |
| Description facet 칩, 적용 칩, 해제 | NOT RUN | E2E PASS (`Any language` 칩 aria-current) |
| 상세 페이지 안내문 | NOT RUN | 단위 테스트(`getPackageDetail().summaryLanguage`) PASS |
| 모바일 레이아웃 | NOT RUN | 기존 320px E2E 2건 PASS. 언어 칩만 따로 검증한 테스트는 없다. `.row-meta`·`.facet-chips`가 `flex-wrap`이라는 점은 리뷰에서 확인했다. → **PENDING(배포 후 화면 확인)** |
| XSS | — | 출력은 모두 React 텍스트 노드다. `lang` 값은 상수 `zh`/`ja`/`ko`뿐이다(리뷰). |

## 5. 언어 필터 동작 (로컬, FACT)

| 확인 | 결과 |
|---|---|
| `lang` 검증 | page의 `parseLanguageFilter`와 `validLanguages` 두 곳에서 allowlist로 거른다. `inArray` 값은 bind parameter다. → SQL injection 경로가 없다. |
| 잘못된 값 | `lang=zz`, `lang=unknown`, `lang=<script>`는 버려지고 필터 없이 렌더된다. `noindex`가 붙는다. 반복 파라미터는 첫 값만 읽는다(`type`과 같은 방식). |
| URL 유지 | 순서는 q, type, lang, cap, sort, page다. pagination, 정렬, type 칩, capability 토글, Clear search에서 유지되고, 적용 칩 제거와 Clear filters/all에서 빠진다. |
| rows·count·fuzzy 일치 | 모두 같은 `searchWhere`를 거친다. 단위 테스트 7건이 PASS다. |
| 정렬 안정성 | `orderFor`는 바뀌지 않았고 id tie-break가 유지된다. 페이지 3개에 걸쳐 7행이 각각 한 번씩 나온다(테스트). |
| 필터 없을 때 | WHERE에 붙는 조건이 `undefined`다. href가 HEAD와 같다. |

## 6. 운영 검색 성능 (배포 전 기준선)

- 측정: 2026-10-26 03:53–04:00Z. 10개 URL을 1초 간격 순차로 교차 실행하며 5라운드 돌렸다(`p42/bench1.txt`).
- 측정 의미
  - 모두 200이었다.
  - TTFB는 streaming shell이 나가는 시점이라 DB 시간이 들어 있지 않다. 그래서 total(본문 수신 완료)을 같이 적는다.
  - 5개 표본이므로 p95는 최대값과 같다.

| URL | TTFB p50 / 최대 | Total p50 |
|---|---|---|
| `/artifacts` | 0.389 / 0.418 s | 1.132 s |
| `/artifacts?lang=zh` | 0.397 / 0.424 | 1.154 |
| `/artifacts?lang=latin` | 0.375 / 0.424 | 1.119 |
| `/artifacts?lang=ja` | 0.392 / 0.416 | 1.128 |
| `/artifacts?lang=ko` | 0.384 / 0.386 | 1.134 |
| `/artifacts?lang=mixed` | 0.404 / 0.438 | 1.148 |
| `/artifacts?q=review` | 0.388 / 0.435 | 1.106 |
| `/artifacts?q=review&lang=zh` | 0.386 / 0.397 | 1.118 |
| `/artifacts?q=math%20modeling` | 0.381 / 0.411 | 1.388 |
| `/artifacts?q=math%20modeling&lang=zh` | 0.396 / 0.414 | 1.272 |

- 현재 운영은 `lang`을 무시하므로, 필터 행과 무필터 행의 차이(±0.04s)는 **측정 잡음의 크기**를 보여 준다(FACT).
  - 배포 후 같은 스크립트로 다시 재면, 이 잡음 폭을 넘는 증가분이 필터 비용이다.
- 로컬 기준(Phase 41, 19,113행):

  | 대상 | 지연 |
  |---|---|
  | browse | 86 → 84ms(zh) / 158ms(latin) |
  | `review` | 23 → 81ms |
  | 필터 추가 비용 | 0–72ms |

- DB RTT와 서버 처리 시간은 HTTP만으로 나눌 수 없다. 배포 후에는 같은 조건의 무필터·필터 쌍의 total 차이로 판정한다. 200ms를 계속 넘으면 STORED generated column(migration)을 승인 대상으로 올린다.
- 운영 다국어 검색어 14개도 각 3회 측정했다(`p43/prod_results.json`).
  - CJK 검색어 total p50은 0.63–1.10s, 영어 검색어는 1.27–1.35s였다.
  - 단발 이상치 2건: `math modeling` 1회 5.13s, `建模` 1회 8.65s. 반복하지 않았으므로 cold start 여부는 확인하지 못했다.

## 7. 기존 검색 회귀와 코드 리뷰

독립 리뷰 subagent(읽기 전용)의 보고를 소스와 측정으로 다시 확인했다. **정확성 버그는 없었다.**

| # | 지적 | 판정 | 조치 |
|---|---|---|---|
| R1 | KANA 범위에 U+30FB `・`, U+30FC `ー`가 포함됨. "克劳德・代码技能"가 `ja`로 분류됨. | FACT. 변경 전 테스트가 FAIL했다. | KANA에서 두 문자를 뺐다. 운영 설명 19,113건 중 분류가 바뀐 것은 0건이다. |
| R2 | OTHER에 이름을 붙인 6개 문자 외(벵골어·타밀어·조지아어 등)는 `unknown`으로 분류됨. | FACT. 변경 전 테스트가 FAIL했다. | OTHER를 U+0370–10FF, 1200–139F, 1780–17FF로 넓혔다. 분류 변화는 0건이다. |
| R3 | 필터가 없어도 언어 판정을 projection함. 깊은 페이지 비용. | **FACT(실측).** 1페이지와 홈은 같다. browse offset 9,000은 157 → 199ms, offset 19,000은 218 → 307ms(recent 기준), name 정렬은 239 → 325ms다. | **고치지 않았다.** OFFSET 행까지 projection되는 성격은 기존 commitSha subquery와 같다(HEAD에서도 마지막 페이지가 이미 239ms). `language.ts` 주석과 Phase 41 보고서의 "25행만" 문장을 실측값으로 정정했다. |
| N1 | 저장소 페이지에 언어 표시 없음 | **사실 아님.** `getRepositoryPackages`는 `listPackages`를 호출하고, 여기에 `summaryLanguage`가 있다. | 없음 |
| N2 | `PackageRows`에서 언어 span이 stars 주석과 stars span 사이에 끼어 있음 | FACT | 블록을 주석 위로 옮겼다. 렌더 순서는 같다. |
| N3 | 다중 `lang` 파라미터는 첫 값만 읽음 | `type`과 같은 방식 | 없음 |

- 필터가 없을 때의 회귀 확인(FACT)
  - `search:eval` 54/54. 사례별 `SEARCH_EVAL_CASE` 줄과 총괄 지표가 Phase 41 실행과 diff 0이다.
  - 영어 4개 검색어(`math modeling`, `code review`, `document processing`, `browser automation`)의 결과 목록과 total이 변경 전과 같다.

## 8. CJK 검색 문제 분석

### 8.1 검색 경로 (소스 추적, FACT)

`normalizeQuery`(trim·공백 축약·길이 상한) 다음은 다음 순서로 진행된다.

1. **`searchMode`:** 여러 단어로 된 plain 검색어가 `all`로 0건이면 `any`로 바꾼다. EXISTS 1회.
2. **`searchWhere`:**
   - `search_vector @@ tsQuery`
   - 3자 이상이면 `OR repository.full_name ILIKE`
   - 이번 변경으로, CJK가 있으면 `OR 부분 문자열`이 추가된다.
   - 그 밖에 `NOT_LISTED_BECAUSE is null`, type, language, capability 조건이 붙는다.
3. **`search_vector`**(generated, schema.ts):

   | 가중치 | 내용 | 비고 |
   |---|---|---|
   | A | name | `to_tsvector('english')` |
   | B | summary | 〃 |
   | C | source_path | `/`·`.`을 공백으로 바꾼 뒤 |
   | D | type | |

   - **본문(README·SKILL.md body)은 색인하지 않는다.** 따라서 "본문 검색"은 존재하지 않는다.
4. **`tsQuery`:** plain 단어는 `w1 & w2 & wN:*`(마지막 단어만 prefix)로 만든다. 따옴표, `-`, `or`가 있으면 `websearch_to_tsquery`를 쓴다.
5. **`rankExpr`:**
   - 이름 완전 일치 3.0
   - 이름 prefix
   - 이름 단어 0.5
   - `ts_rank`
   - 저장소 이름 보너스
   - 경로 보너스(`/` 포함 시)
6. **`fuzzySearch`:** 위 결과가 0건이고 offset 0일 때만 실행한다. `word_similarity(q, name||' '||summary) ≥ 0.6`(`<%`, trigram index).
7. **결과 병합:** 하지 않는다. FTS와 fuzzy는 둘 중 하나만 쓴다.
8. **`matchedIn`과 `marked`:** 위치 표시와 `ts_headline` 강조. 부분 문자열로 일치한 경우는 강조되지 않는다.

### 8.2 원인 (FACT, 로컬 PG17 실험)

- `to_tsvector('english','当用户要求数学建模、建模竞赛时使用。')`의 결과는 `'当用户要求数学建模':1 '建模竞赛时使用':2`다.
  - 띄어쓰기 없는 CJK 절은 구두점 사이 전체가 lexeme 하나가 된다.
  - 그래서 `数学建模`는 그 절의 **맨 앞에 올 때만**(prefix `:*`) 일치한다.
- 한국어는 띄어 쓰지만 조사가 붙는다. `코드`는 lexeme `'코드를'`과 같지 않다.
  - prefix는 마지막 단어에만 붙으므로, 여러 단어 검색어의 앞 단어는 정확히 일치해야 한다.
- fuzzy는 0건일 때만 실행되고, 절 중간의 4자 단어는 word_similarity가 0.6 경계에 걸린다(실측 0.6).
  - 2자 단어는 0.4–0.8로 들쭉날쭉하다.

### 8.3 유형 분류 (변경 전, 운영과 로컬 corpus)

| 유형 | 사례 | 원인 |
|---|---|---|
| A. 원문에 뜻은 있지만 검색 안 됨 | `コードレビュー` → `Flutterコードレビュアー`, `…をレビューします` 등 7건 | 어형 차이(レビュアー/レビュー). 부분 문자열로도 일치하지 않는다. 형태소 분석이 필요하다. |
| B. 이름으로만 검색됨 | `math modeling` → 중국어 설명의 `math-modeling` skill. 운영 21건 중 2위. | 이름 lexeme이 일치한다. 설명(중국어)은 기여하지 않는다. |
| C. 설명 안의 부분 문자열 실패 | `数学建模` → 본 `SKILL.md`("当用户要求数学建模、…"), `代码审查` → `code-review-specialist`("提供全面的代码审查能力"), `浏览器自动化` → `browser-cdp` 2건 | §8.2의 lexeme 경계. **이번 변경으로 해결했다.** |
| D. 검색되지만 순위가 낮음 | 변경 후 `数学建模`의 본 `SKILL.md`는 7건 중 5위다. | 부분 문자열로만 일치한 행은 `ts_rank`가 0이라 FTS 일치 뒤에 온다. 가중치 변경은 이번 범위에서 하지 않았다. |
| E. 언어 간 동의어 실패 | `浏览器自动化`는 영어 "browser automation" 65건에 닿지 못한다. 반대로 `math modeling`은 중국어 설명에 닿지 못한다. | 번역이나 다국어 사전 없이는 불가능하다. 이번 범위 밖이다. |
| (언어 내 동의어) | `文档处理`: 관련 artifact 5건 모두 "PDF/Word/解析/转换" 등 다른 낱말을 쓴다. | 유의어 문제다. 부분 문자열로는 해결할 수 없다. |

- 운영 대조(FACT): 운영과 로컬 corpus(운영 등재 19,113건을 로컬에 적재)의 결과를 14개 검색어 × 3회로 비교했다.
  - CJK 10개 검색어의 total이 모두 같다(4·3·0·2·0·1·0·0·2·7).
  - 결과 집합도 같다. 다른 것은 동점 행의 순서뿐이다. 로컬에는 실제 날짜가 없어 tie-break가 다르기 때문이다.
  - 영어는 751 대 745 등 소폭 차이가 있다. 수집 누락 134건과 그 뒤 수집분 때문이다.
- 운영 pg_trgm의 CJK 동작(FACT/INFERENCE)
  - 운영 `/artifacts?q=建模`의 결과는 로컬 trigram fallback과 **같은 3건, 같은 순서**였다(SKILL.md, 建模手, 论文手).
  - 따라서 운영 DB의 LC_CTYPE도 CJK를 word 문자로 분류해 trigram을 추출한다고 판단한다. 3자 이상 CJK 단어의 index 사용은 운영에서도 성립한다(INFERENCE, 강함).
  - Phase 41의 PENDING 5번은 이것으로 해소한다.

## 9. 다국어 평가셋

- corpus: 운영 등재 19,113건(Phase 41 수집)을 로컬 `agentdock_test`에 실제 저장소 이름으로 적재했다(`p43/load.ts`).
  - search_vector의 입력(이름·설명·경로·type·저장소)이 운영과 같다.
  - 측정 뒤 모두 삭제했다(`left after cleanup 0`).
- 정답 판정 규칙
  - 설명을 읽고, 그 주제를 다루는 **비Latin 설명 artifact**를 정답으로 했다. 영어 설명 artifact는 E 유형이라 정답에서 뺐다.
  - 정답이 없는 검색어(`数学モデリング`, `文書処理`, `수학 모델링`, `문서 처리`)에는 **정답을 만들지 않았다.**
  - 판정 중 Latin 설명 1건(`zenstory-ai/…/skills/browser-cdp`)이 섞인 것을 발견해 제외했다.
  - 원본 대조: Phase 41에서 17건을 GitHub 원본과 대조했고 모두 저장된 설명과 같았다. 이번에 GitHub를 다시 조회하지는 않았다.
- 측정: 페이지와 같은 순서(`searchMode` → rows + count)로 8회 실행하고 p50을 취했다(prepared statement의 generic plan 포함).

| 검색어 | 정답 | 결과 수 | R@5 | R@10 | MRR | nDCG@10 | p50 ms | 후보 B(trgm) 결과 / ms |
|---|---|---|---|---|---|---|---|---|
| math modeling | — | 21 → 21 | — | — | — | — | 29.2 → 22.2 | 21 / 27.1 |
| code review | — | 745 → 745 | — | — | — | — | 34.3 → 28.8 | 745 / 31.1 |
| document processing | — | 58 → 58 | — | — | — | — | 28.8 → 21.8 | 58 / 27.0 |
| browser automation | — | 65 → 65 | — | — | — | — | 27.2 → 23.5 | 65 / 27.3 |
| 数学建模 | 6 | 4 → 7 | 0.50 → 0.67 | 0.50 → **1.00** | 1.00 → 1.00 | 0.58 → **0.91** | 21.8 → 21.1 | 6 / 531 |
| 代码审查 | 5 | 3 → 6 | 0.40 → 0.80 | 0.40 → **1.00** | 1.00 → 1.00 | 0.55 → **0.95** | 20.4 → 19.4 | 7 / 589 |
| 文档处理 | 5 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 | 26.4 → 21.4 | 0 / 603 |
| 浏览器自动化 | 4 | 2 → 4 | 0.50 → 1.00 | 0.50 → **1.00** | 1.00 → 1.00 | 0.64 → **1.00** | 21.3 → 17.2 | 3 / 605 |
| 数学モデリング | 없음 | 0 → 0 | — | — | — | — | 24.6 → 23.3 | 0 / 616 |
| コードレビュー | 10 | 1 → 3 | 0.10 → 0.30 | 0.10 → 0.30 | 1.00 → 1.00 | 0.22 → 0.47 | 21.5 → 17.6 | 6 / 605 |
| 文書処理 | 없음 | 0 → 0 | — | — | — | — | 26.2 → 23.4 | 0 / 605 |
| 수학 모델링 | 없음 | 0 → 0 | — | — | — | — | 47.3 → 58.9 | 0 / 1074 |
| 코드 리뷰 | 2 | 2 → 2 | 1.00 | 1.00 | 1.00 | 1.00 | 25.4 → 41.0 | 3 / 684 |
| 문서 처리 | 없음 | 7 → 2 | — | — | — | — | 40.5 → 46.5 | 7 / 1042 |

**판정 6개 검색어 평균(변경 전 → 변경 후):**

| 지표 | 변경 전 | 변경 후 |
|---|---|---|
| R@5 | 0.417 | 0.628 |
| R@10 | 0.417 | 0.717 |
| MRR | 0.833 | 0.833 |
| nDCG@10 | 0.499 | 0.722 |

- CJK 결과 0건 비율은 4/10 → 4/10이다. 남은 0건은 정답 없음 3개와 유의어 문제 1개다.
- **랭킹 개선과 결과 증가의 구분**
  - MRR은 같다. 첫 정답은 원래 1위였다.
  - 늘어난 것은 recall과 nDCG이고, 추가된 행은 모두 기존 결과 **뒤에** 붙었다.
  - 결과가 변한 9개 CJK 검색어 모두 기존 결과의 상대 순서가 유지됐다(FACT, 스크립트 확인).
  - 예외는 `문서 처리` 하나다. 두 단어를 모두 포함한 행이 2건 생겨 `any` 완화가 일어나지 않았고, 그래서 7건이 2건이 됐다. 두 경우 모두 정답이 없는 검색어다.
- 짧은 CJK 검색어(판정 없음, 비용 확인용, 3회 반복)

  | 검색어 | 결과 수 | 지연 |
  |---|---|---|
  | `代码` | 7 → 57 | 4 → 14ms |
  | `文档` | 6 → 41 | 2 → 13ms |
  | `审查` | 7 → 37 | 2 → 14ms |
  | `建模` | fuzzy 3 → 10 | 6 → 10ms |
  | `코드` | 5 → 6 | — |
  | `리뷰` | 2 → 2 | — |
  | `数学 建模` | — | 30 → 40ms |

## 10. 개선 후보 비교

| 후보 | 정확도·Recall (6개 평균 R@10) | Precision | 검색 시간 (CJK p50 중앙값) | DB 부하 | 인덱스 | Migration | 복잡도 | 위험 |
|---|---|---|---|---|---|---|---|---|
| A. 현행 FTS | 0.42 | 높음 | 25ms | 낮음 | 기존 GIN | 없음 | — | CJK 절 중간 실패(C) |
| B. pg_trgm 유사도(`<%`)를 WHERE에 OR로 추가 | 0.61 | 중간(유사도 경계) | **605ms** | 높음(OR 때문에 index 미사용) | 기존 trgm | 없음 | 낮음 | 지연 |
| C. CJK bigram n-gram tsvector | 이 평가셋에서는 D와 비슷하다고 추정(INFERENCE: 연속 문자열이면 bigram AND ≈ 부분 문자열) | 높음 | 낮을 것 | 낮음 | 새 GIN | **필요**(generated column, table rewrite) | 중간 | 운영 migration |
| **D. 이름·설명 부분 문자열(CJK 검색어만)** | **0.72** | 높음(문자 그대로 일치) | **22ms** (2자 단어 +8–12ms) | 낮음(3자 이상은 trgm index, 2자는 strpos scan) | 기존 `package_fuzzy_trgm_idx` | 없음 | 낮음(함수 4개, +70줄) | 2자 단어는 행 수에 비례해 비용 증가 |
| E. 언어별 검색 분기(zhparser, pg_jieba, MeCab) | 높을 것 | 높음 | — | — | 새 index | 확장 설치 필요 | 높음 | **새 확장은 전제 밖** |
| F. 로컬 tokenizer(`Intl.Segmenter` 등)로 ingest 시 분절 | 높을 것(A 유형 일부 해결) | 높음 | 낮을 것 | 낮음 | 새 GIN | **필요**(저장 열) | 중간 | ingest 변경과 migration |

- B·D는 로컬에서 실측했다(같은 corpus, 같은 실행 방식). C·E·F는 정량 측정을 하지 않았다(NOT RUN). 셋 다 migration이나 확장이 필요해 이번 조건을 벗어나기 때문이다.
- 사용 가능한 확장(로컬 PG17 FACT): `plpgsql 1.0`, `pg_trgm 1.6`(public).
  - 운영에 pg_trgm이 있다는 근거: DEPLOY·VERCEL_DEPLOY 문서, migration guard, 그리고 §8의 운영 fuzzy 응답.
- D의 index 사용 형태도 측정했다(로컬, 19k 행).

  | 형태 | 지연 |
  |---|---|
  | WHERE에 OR로 직접 넣음 | 45ms(seq scan) |
  | `id = any(array(select …))` InitPlan | 17ms(Bitmap Index Scan) |
  | ILIKE | 31ms |
  | LIKE(CJK에는 대소문자가 없음) | 8ms |
  | 2자 단어를 LIKE로 | generic plan이 trigram index 전체를 훑음(19,113 entries, 46ms) |
  | 2자 단어를 strpos로 | 12ms |

## 11. 구현 여부와 근거

**적용했다(로컬, 미커밋).** 조건 충족 여부는 다음과 같다.

| 조건 | 결과 |
|---|---|
| 실제 결함 재현 | `数学建模`가 운영과 로컬 모두에서 본 SKILL.md를 반환하지 않는다(§8.3 C). |
| 개선 전 실패 확인 | 새 테스트 8건이 변경 전 코드(Phase 41 상태, scratch worktree)에서 FAIL했다. CJK 검색 5건, 언어 판정 3건. Latin 대조 1건은 의도대로 변경 전에도 PASS다. |
| 개선 후 품질 향상 | R@10 0.42 → 0.72, nDCG 0.50 → 0.72 |
| 기존 54/54 유지 | 54/54, 사례별 diff 0 |
| 영어 회귀 없음 | CJK 문자가 없는 검색어는 구성상 SQL 문자열까지 변경 전과 같다(`cjkWords`가 null이면 기존 template만 쓴다). 영어 4개 검색어의 결과도 같다. |
| migration 불필요 | 기존 trigram index와 기존 열만 쓴다. |
| 로컬 성능 수용 가능 | 3자 이상은 ±0, 2자는 +8–12ms, 여러 단어는 +10ms |
| API Key 불필요 | 외부 호출이 없다. |

- 변경 내용: `src/db/queries/search.ts`
  - `CJK_LETTER`, `cjkWords`, `cjkSubstring`, `contains`, `cjkIn`을 추가했다.
  - `searchWhere`의 텍스트 조건에 `OR cjkSubstring`을 붙였다.
  - `matchedIn`의 name/summary 사유에 같은 부분 문자열 검사를 넣었다. 그래서 "Matched in description"이 실제로 참인 조건이다.
- 판단 근거와 측정값은 코드 주석에 남겼고, 주석에는 `ponytail:` 상한을 달았다.
  - 상한: 2자 단어는 행 수에 비례하는 scan이다.
  - 재검토 조건: 200ms를 넘으면 bigram tsvector migration으로 간다.
- 하지 않은 것
  - 부분 문자열 일치 행에 순위 가중치를 주는 것(가중치 변경은 별도 결정)
  - CJK 부분 문자열 강조(`ts_headline`은 lexeme 단위)
  - A·E 유형(형태소 분석, 번역)

## 12. Sync 정상화 상태

| 항목 | 값 | 구분 |
|---|---|---|
| 마지막 예약 Sync | 40229151309, 10/25 20:05Z, `0f2cb82`, success | FACT |
| guard 코드(`5bf8450`) 배포 이후 Sync | **0회** (03:50Z와 04:10Z에 확인) | FACT |
| 다음 예약 | cron `0 6,18 * * *`. 최근 실제 시작은 예약보다 2–4.7시간 늦었다(09:56–10:38Z, 19:55–20:44Z). | FACT |
| secret `DATABASE_URL` | 갱신 2026-10-22T05:28:37Z(Phase 35–37 때와 같음). 저장소 secret은 이 하나와 `AGENTDOCK_GITHUB_TOKEN`(10-19) 둘뿐이다. | FACT(갱신 시각만) |
| 변수 `AGENTDOCK_TARGET_FINGERPRINT` | 갱신 2026-10-22T05:18:58Z | FACT |
| 다음 Sync 예상 | 기존 secret은 `agentdock_app` role이 아니라고 Phase 32–37에서 판단했다. 그 판단이 맞다면 guard FAIL, 수집 0이다. | INFERENCE |

- 지시대로, 갱신 시각만으로 secret 교체 여부를 확정하지 않았다. 실제 Guard 결과는 다음 run에서 확인한다(PENDING).
- 운영자 조치 절차는 Phase 35–37 보고서 §10–§12에 있다. 다시 쓰지 않는다.
  - 요약: preflight → 소유권 검사 → 새 fingerprint 계산 → secret과 변수를 함께 교체 → Deploy plan 성공 확인 → 다음 Sync의 guard·role 확인.

## 13. DB Guard / Health Summary

| 확인 항목 | 결과 |
|---|---|
| `agentdock_app` role, direct endpoint, search_path, read-only, statement_timeout, 쓰기 차단, Guard PASS, Health Summary | **PENDING.** guard가 포함된 Sync run이 없다. |

- 확인 방법: 다음 run에서 다음을 본다.
  - `gh run view <id> --json jobs`의 단계 결론
  - `gh api repos/gwanghun-choi/agentdock/actions/jobs/<jobId>/logs`의 `connected as agentdock_app`, ops 7/7, Status 첫 줄
- 이전 Sync 5회(40021567316 … 40229151309)는 Phase 32–34와 35–37에서 이미 분석했으므로 다시 하지 않았다.
  - 5회 모두 storage_failed는 771·978뿐이었고 FAILED는 0회였다.

## 14. Storage Failure

- Phase 35–37 parser 수정(`e4c2773`)은 **push·배포됐다**(FACT: CI 40256640152, Deploy 40256758887 success).
- Sync는 실행 시점의 develop HEAD를 checkout하므로, 다음 예약 Sync부터 수정된 parser가 쓰인다(INFERENCE: schedule 이벤트는 기본 브랜치에서 실행된다).
- 수정 이후 실행된 Sync가 없으므로, 새 storage_failed가 0인지는 PENDING이다.

## 15. Job 771·978

| Job | 저장소 | 운영 화면(`/jobs/<id>`, GET 1회) | 저장소 페이지 | 구분 |
|---|---|---|---|---|
| 771 | `elementalsouls/claude-bughunter` | "read the repository but could not store the result. Nothing was saved." Requested 2026-10-22 21:00 UTC, Attempt 3 | `/r/elementalsouls/claude-bughunter` 404 | FACT |
| 978 | `maxritter/claude-codepro` | 같은 문구. Requested 2026-10-23 10:42 UTC, Attempt 3 | `/r/maxritter/claude-codepro` 404, `/r/maxritter/qualitylayer` 404 | FACT |

- **복구되지 않았다.** 재enqueue 흔적이 없고(새 job의 결과로 저장소가 생기지 않았다), 이번 작업에서도 재enqueue하지 않았다.
- 전제 조건: secret 교체(§12) 이후, Phase 35–37 보고서 §14 runbook으로 진행한다.
- 완료 후 확인할 것
  - 저장소 페이지 200
  - artifact 수(978은 로컬 재현에서 ok 9/9)
  - 같은 identity가 중복되지 않음(`/r/<repo>`의 artifact 경로가 하나씩만 있는지)

## 16. Refresh Capacity

- 정상 Sync(guard PASS)는 **0회**다. 조건(최소 2회)을 채우지 못했으므로 100 → 150은 **평가하지 않았다(NOT RUN). cap 100을 유지한다.**
- 기존 추정(Phase 35–37, guard 이전 5회)
  - cap 150 적용 시 p95 최장 1,718s, 마감 2,100s
  - 실측 drain 1,222–1,483s
- 상한 변경은 이번 변경에 넣지 않았다. 정상 run 2회의 drain·refresh·quota·not-reached를 확인한 뒤 **별도 변경**으로 다룬다.

## 17. 테스트 결과

모두 최종 코드 기준이다. 마지막 주석 수정 뒤에는 lint, typecheck, language test를 다시 돌렸다.

| 단계 | 결과 |
|---|---|
| `bun run check:boundaries` | OK (migration 11, source 102, UI 33) |
| `bun run lint` | Checked 233 files, No fixes applied |
| `bun run typecheck` | 통과 |
| `bun run test` | **81 files, 1539 passed, 2 skipped**. Phase 41 대비 +9: CJK 6, 언어 판정 3. skip 2건은 이전과 같다(trust 인증이라 실행할 수 없는 비밀번호 테스트, pg_trgm 부재 runtime 테스트). |
| `bun run build` | 성공 (placeholder `DATABASE_URL`) |
| `bun run e2e:seed` + `bun run test:e2e` | **28 passed**. 서버 로그에 `The destination stream closed early` 4줄이 있다. 탐색 중 연결이 끊긴 것으로 보이며(INFERENCE), 실패한 테스트는 없다. |
| `bun run search:eval` | **54/54**. p5 0.3277, MRR 0.9273, nDCG10 0.9068, top1 0.9149. 사례별 출력이 Phase 41과 diff 0이다. |
| 다국어 평가(§9) | 실행. 변경 전·후, 후보 B. |
| 변경 전 FAIL | 8 failed / 134 passed (scratch worktree, Phase 41 코드 + 새 테스트) |

- 정리
  - 로컬 corpus 행 0건(`left after cleanup 0`)
  - scratch worktree 제거(`git worktree list`에 1개만 남음)
  - `test-results/` 삭제

## 18. 변경 파일

이번 Phase에서 추가로 바꾼 것만 적는다. Phase 41 변경은 Phase 41 보고서 §8에 있다.

| 파일 | 변경 |
|---|---|
| `src/db/queries/search.ts` | CJK 부분 문자열 일치(§11) |
| `src/db/queries/search.test.ts` | `a CJK word inside a description` 6건 |
| `src/db/queries/language.ts` | KANA에서 U+30FB·30FC 제외, OTHER 확장, projection 비용 주석 정정 |
| `src/db/queries/language.test.ts` | `chinese-middle-dot`, `tamil`, `georgian` |
| `src/components/PackageRows.tsx` | 언어 span을 stars 주석 위로 이동(렌더 동일) |
| `docs/analysis/agentdock-phase41-multilingual-discovery.md` | "25행만" 문장 정정 |
| `docs/analysis/agentdock-phase42-44-multilingual-production-verification.md` | 이 보고서 |

## 19. 운영 승인 사항

1. **긴급:** Actions secret `DATABASE_URL`을 `agentdock_app` direct URL로 교체하고, 변수 `AGENTDOCK_TARGET_FINGERPRINT`도 함께 교체한다(Phase 35–37 §10–§11).
2. Phase 41–43 변경의 commit, push, 배포(사용자).
   - schema 변경이 없어 1번과 순서 제약은 없다.
   - 원인을 분리하려면 1번을 먼저 하는 편이 좋다.
3. Job 771·978 재enqueue(운영 DB 쓰기). 1번 이후에 한다.
4. (조건부) 다음 두 migration은 측정값이 상한을 넘을 때만 올린다.
   - 언어 STORED generated column: 필터를 쓴 목록이 200ms를 넘을 때
   - CJK bigram tsvector: 2자 CJK 검색이 200ms를 넘을 때
5. (조건부) refresh cap 150: 정상 Sync 2회 확인 뒤 별도 변경으로 한다.

## 20. PENDING / NOT RUN

| 항목 | 상태 | 해소 조건 |
|---|---|---|
| 운영 다국어 UI, 필터 칩, pagination, 모바일 화면 | NOT RUN | 배포 후 |
| 운영 언어 필터 지연(p50, p95, 최대, 무필터 대비) | PENDING | 배포 후 `p42/bench.sh` 재실행(5라운드 교차) |
| 운영 CJK 부분 문자열 검색 지연 | PENDING | 배포 후 `p43/prod_probe.py` 재실행 |
| Sync guard, role, Health Summary | PENDING | guard 이후 첫 예약 run |
| 새 storage_failed 0 | PENDING | 같은 run |
| Job 771·978 복구 | PENDING(승인) | §19-3 |
| Refresh cap 평가 | NOT RUN | 정상 run 2회 |
| C·E·F 후보의 정량 평가 | NOT RUN | migration이나 확장이 전제라 범위 밖 |
| 이상치 2건(5.13s, 8.65s)의 원인 | 미확인 | 배포 후 측정에서 반복되는지 본다 |
| Phase 38–40 보고서 | 존재하지 않음 | — |

## 21. Evidence ID

scratch 경로는 `/tmp/claude-1000/-home-ChoiGwanghun-workspace-auto-agentdock/5f3bf29d-8c4e-417d-a177-083dcd61f8ca/scratchpad/`이다.

| ID | 내용 | 위치 |
|---|---|---|
| E42-01 | Production SHA 헤더 `e4c2773`(03:50Z) | curl HEAD `/`, `/artifacts?lang=zh` |
| E42-02 | CI 40256640152, Deploy 40256758887 단계 결론 | `gh run view --json jobs` |
| E42-03 | 운영 기준선 50 GET | `p42/bench.sh`, `p42/bench1.txt`, `p42/html/` |
| E42-04 | 독립 코드 리뷰(R1–R3, N1–N3) | §7 |
| E42-05 | 깊은 페이지 비용 HEAD 대 현재 | `p43/deep.ts` 출력(§7) |
| E42-06 | 언어 분류 변화 0/19,113 | `p43/langdiff.ts` |
| E43-01 | 운영 다국어 14개 × 3회 | `p43/prod_probe.py`, `p43/prod_results.json`, `p43/prod_probe.log` |
| E43-02 | 운영 `建模` trigram fallback 3건 | `p43/trgm_建模.html` |
| E43-03 | 정답표와 검색어 | `p43/qrels.json`, `p43/queries.json` |
| E43-04 | 로컬 평가(base, candB, candD, impl, 짧은 검색어) | `p43/eval.ts`, `p43/eval-*.json` |
| E43-05 | `search:eval` Phase 41, candD, 최종 | `p43/eval54-phase41.txt`, `eval54-candD.txt`, `eval54-final.txt` |
| E43-06 | 변경 전 FAIL 8건 | scratch worktree 실행 출력(§17) |
| E43-07 | 실행 계획(OR → seq 45ms, InitPlan → index 17ms, generic plan LIKE 46ms) | psql EXPLAIN(§10) |
| E44-01 | Sync run 목록(guard 이후 0회), secret·변수 갱신 시각 | `gh run list`, `gh secret list`, `gh variable list` |
| E44-02 | Job 771·978 화면과 저장소 404 | `p42/job771.html`, `p42/job978.html` |
| E-T | 전체 test와 E2E 로그 | `p43/test-full.txt`, `p43/e2e.txt` |

## 22. Git Status

```
 M e2e/journeys.spec.ts
 M src/app/artifacts/page.tsx
 M src/app/r/[owner]/[repo]/[...path]/page.tsx
 M src/components/PackageRows.tsx
 M src/components/searchState.test.ts
 M src/components/searchState.ts
 M src/db/queries/packages.ts
 M src/db/queries/search.test.ts
 M src/db/queries/search.ts
 M src/log.test.ts
 M src/log.ts
?? docs/analysis/agentdock-phase41-multilingual-discovery.md
?? docs/analysis/agentdock-phase42-44-multilingual-production-verification.md
?? src/components/language.ts
?? src/db/queries/language.test.ts
?? src/db/queries/language.ts
```

- 권장 commit은 하나다. `search.ts`와 `search.test.ts`를 Phase 41과 43이 함께 바꿨기 때문에 파일 단위로 나눌 수 없다.
- Phase 41 보고서 §17의 제안은 이 commit으로 대체한다.

```bash
git add e2e/journeys.spec.ts src/app/artifacts/page.tsx 'src/app/r/[owner]/[repo]/[...path]/page.tsx' \
  src/components/PackageRows.tsx src/components/searchState.ts src/components/searchState.test.ts \
  src/components/language.ts src/db/queries/language.ts src/db/queries/language.test.ts \
  src/db/queries/packages.ts src/db/queries/search.ts src/db/queries/search.test.ts \
  src/log.ts src/log.test.ts \
  docs/analysis/agentdock-phase41-multilingual-discovery.md \
  docs/analysis/agentdock-phase42-44-multilingual-production-verification.md
git commit -m "feat(search): filter by description writing system and match CJK words inside descriptions" -m "- Classify each description's writing system in SQL (latin/zh/ja/ko/mixed/other/unknown); ?lang= filters rows, count and the trigram fallback through one predicate
- Name non-Latin descriptions on rows and the detail page; set lang=zh/ja/ko on the description
- Record the language filter in the search log
- For a query holding CJK letters, also match name+description substrings through the existing trigram index (no migration); queries without CJK are unchanged
- Review fixes: U+30FB/U+30FC are not kana; widen the other-script ranges
- e2e: two existing journeys now also see the 'Any language' chip as aria-current, an expected consequence of the new facet
- Docs: Phase 41 and Phase 42-44 analysis reports" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## 23. 다음 작업

1. 운영자: secret과 fingerprint를 교체한다(§19-1). 그 뒤 첫 예약 Sync에서 guard PASS, `connected as agentdock_app`, ops 7/7, Status를 확인한다.
2. 사용자: 위 commit을 만들고 push한다. Deploy가 success인지 확인하고, smoke identity가 새 SHA인지 본다.
3. 배포 직후 다음을 다시 실행해 §6·§9와 비교한다.
   - `p42/bench.sh`(5라운드)
   - `p43/prod_probe.py`
   - 모바일 320px 화면에서 Description 칩과 행의 언어명
4. Job 771·978을 재enqueue한다(§19-3). 저장소 페이지가 200인지, 중복이 없는지 확인한다.
5. 정상 Sync 2회 뒤 refresh cap 150을 평가한다. 하게 되면 별도 변경으로 만든다.
6. 4주 동안 search 로그의 `languages`와 CJK 검색어를 집계한다. 2자 CJK 검색의 지연과, 형태소(A)·유의어 유형이 실제로 얼마나 자주 나오는지 본 뒤 bigram이나 tokenizer migration이 필요한지 판단한다.
