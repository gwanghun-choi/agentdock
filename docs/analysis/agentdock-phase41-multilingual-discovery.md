# AgentDock Phase 41 — 다국어 Artifact 탐색 품질

- 작성: 2026-10-26 (KST)
- 기준 commit: `e4c2773` (HEAD = origin/develop, 작업 시작 시 working tree clean)
- 범위: 운영 언어 분포 조사, 원본 대조, 무료 언어 감지 비교, 정책 비교, 최소 구현(언어 필터·배지·`lang` 속성)
- 표기: **FACT**는 이번 작업에서 직접 측정하거나 확인한 것, **INFERENCE**는 측정에서 추론한 것, **PENDING**은 확인하지 못한 것이다.
- 하지 않은 것: 운영 DB 접속, migration, Secret·Sync·배포 변경, commit·push, 번역 API 호출, 데이터 삭제.
- 참고: 지시문이 말하는 "Phase 38–40 보고서"는 `docs/analysis/`에 없다(FACT). 이 보고서는 단독으로 읽히도록 썼다.

---

## 1. 핵심 결론

1. **중국어 설명은 모두 원본에서 온 것이다.** 원본과 대조한 17건 모두에서 저장된 설명이 해당 commit의 frontmatter `description`과 같았다(FACT, §4). 추출 결함(C·D 유형)은 0건이다. 구조상으로도 그렇다. 설명은 `description` 필드를 그대로(trim만 해서) 저장하고, README나 본문에서 고르는 로직이 없다(`src/detect/skill.ts:105`).
2. **비영어 설명은 소수지만 무시할 규모가 아니다.** 운영에 등재된 19,113건 가운데 Latin 문자가 89.4%, 중국어 3.2%(609), 일본어 0.9%(169), 혼합 0.3%(59), 키릴 등 기타 0.3%(51), 한국어 0.2%(37)이고, 설명 없음이 5.8%(1,105)다(FACT, §3). 비영어 설명이 있는 저장소는 583개 중 85개다.
3. **일본어의 87%는 번역본이다.** 일본어 169건 중 147건이 `affaan-m/ECC`의 `docs/ja-JP/` 번역본이다. Latin 문자 class 안에도 스페인어·포르투갈어 번역본과 성조 없는 베트남어가 약 1.2% 있다(FACT, §3·§5).
4. **추천 정책은 B(전체 유지 + 언어 필터)이고, 이번에 구현했다.** 필터를 고르지 않으면 결과·순서·URL이 기존과 같다. 검색 평가 54/54는 사례 단위까지 baseline과 동일했다(FACT, §10).
5. **정책 C(영어 우선 정렬)는 적용하지 않는다.** 평가셋이 다국어 순위를 판정하지 못해서 개선 근거가 없다. 반면 운영에서 `math modeling`을 검색하면 중국어 설명의 `math-modeling` skill이 2위로 나오는데, 영어 우선 정렬을 하면 이 결과가 Latin 일치 결과 전부보다 아래로 밀린다(§10).
6. **정책 D(비영어 수집 제외)는 권하지 않는다.** 925건(4.8%)이 사라지고, 그중 원문 자체가 비영어인 정상 데이터다.
7. **언어 판정은 SQL 하나로 정의했고 migration은 없다.** 문자 코드 범위로 판정한다. 운영 설명 19,113건에 적용해 무작위 90건을 직접 읽어 보니 모두 맞았다. 다만 Latin 문자를 "영어"라고 부를 수는 없어서 class 이름을 `latin`("Latin alphabet")으로 정했다(§5).

판정: Phase 41 **CONDITIONAL**. 코드·테스트는 완료됐다. 운영 성능과 운영 화면 확인은 배포 뒤에만 할 수 있어 PENDING이다(§13).

---

## 2. 운영 다국어 현황

### 2.1 데이터 수집 방법 (운영 DB 미접속)

- 운영 화면 `GET /artifacts?sort=name&page=1..770`을 읽기 전용으로 수집했다. 동시 요청은 최대 2건이고 요청 사이에 0.4초씩 쉬었다. User-Agent는 `agentdock-phase41-readonly-survey`, 시각은 2026-10-26 01:45–02:33Z다(FACT, E41-01).
- 화면에 표시된 총수는 19,247건이고 수집된 고유 artifact는 19,113건(99.3%)이다.
  - 누락 134건은 129개 페이지에서 한 행씩이다. 각 페이지의 streaming 경계에 걸린 행이 `<template id="P:n">` 자리표시자로 남고, 본문은 HTML 뒤쪽의 hidden 조각으로 전송된다. 수집기의 정규식은 이 조각을 읽지 못했다(FACT, `page=2`에서 확인).
  - 경계 위치는 내용과 무관하므로 분포에 주는 편향은 무시할 수준이다(INFERENCE).
- 목록 화면의 설명은 `package.summary` 전체다. CSS로 줄을 자를 뿐 원문은 그대로 전송된다.

### 2.2 화면에서 확인된 문제 사례 (FACT)

| 사례 | 저장소 | 설명(앞부분) | 판정 |
|---|---|---|---|
| oil-ui | oil-oil/oil-ui | 设计、改进和评审网站、App、后台与组件的界面… | zh |
| math-modeling | XiaoMaColtAI/math-modeling-skill | 当用户要求数学建模、建模竞赛、建模分析… | zh |
| DOCX工具 | XiaoMaColtAI/math-modeling-skill | 创建、编辑、校验和转换 Word DOCX… | zh |

---

## 3. 언어별 분포

### 3.1 전체 (설명 기준, 19,113건, FACT, E41-02)

| 판정 | 건수 | 비율 | 의미 |
|---|---:|---:|---|
| latin | 17,082 | 89.37% | Latin 문자. eld 기준 약 1.2%는 영어가 아니다(§5) |
| (없음) | 1,105 | 5.78% | 설명 미저장(hook 전체, MCP 절반 등) |
| zh | 609 | 3.19% | 중국어(간체·번체 모두) |
| ja | 169 | 0.88% | 일본어 |
| mixed | 59 | 0.31% | CJK와 영어 문장이 함께 있음 |
| other | 51 | 0.27% | 키릴(러·우크라이나어)·아랍 문자 등 |
| ko | 37 | 0.19% | 한국어 |
| unknown | 1 | 0.01% | 글자가 없음(`/=====/`) |

조사 항목별로 정리하면 다음과 같다.

- 영어 비율: Latin 89.37% × (1 − 0.012) ≈ **88.3%**(INFERENCE, eld 보정).
- 중국어 3.19%, 한국어 0.19%, 일본어 0.88%다.
- 기타 언어는 other 0.27%에 Latin 안의 비영어 약 1.1%를 더한 값이다.
- 혼합 0.31%, 설명 없음 1,105건, 판정 불가 0.01%다.

### 3.2 유형별 (FACT)

| 유형 | 전체 | latin | zh | ja | ko | mixed | other | 없음 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| skill | 12,652 | 11,973 | 470 | 63 | 15 | 59 | 21 | 50 |
| command | 2,516 | 2,120 | 112 | 40 | 0 | 0 | 24 | 220 |
| agent | 2,213 | 1,847 | 22 | 64 | 21 | 0 | 5 | 254 |
| plugin | 1,299 | 1,027 | 5 | 2 | 1 | 0 | 1 | 263 |
| mcp_server | 230 | 115 | 0 | 0 | 0 | 0 | 0 | 115 |
| hook | 203 | 0 | 0 | 0 | 0 | 0 | 0 | 203 |

skill의 unknown 1건은 표에서 생략했다.

### 3.3 저장소·경로·이름 (FACT)

- 비영어(zh·ja·ko·mixed) 설명이 있는 저장소는 583개 중 85개이고, 두 가지 이상 class가 섞인 저장소는 56개다.
- 비영어가 많은 상위 저장소:

  | 저장소 | 분포 |
  |---|---|
  | affaan-m/ECC | latin 427, ja 147, ko 12 |
  | nexu-io/html-anything | zh 79 |
  | 1mcp-app/agent | latin 51, zh 51 |
  | skillmds/skillmd | zh 31, mixed 15 |
  | zenstory-ai/oh-story-claudecode | zh 46 |

- 언어 디렉터리(`/ja-JP/`, `/zh/`, `/es/`, `/vi/` 등) 아래에 있는 비율:

  | 판정 | 언어 디렉터리 안 | 비율 |
  |---|---:|---:|
  | ja | 147 / 169 | 87% |
  | zh | 78 / 609 | 13% |
  | ko | 12 / 37 | 32% |
  | latin | 228 / 17,082 | — |

  같은 artifact의 번역본이 별도 행으로 등재되어 있는 것이다. 내용이 다르므로 `NOT_LISTED_BECAUSE`의 duplicate 판정에는 걸리지 않는다.
- **이름과 설명의 언어는 대부분 다르다.** 비영어 설명 925건 중 916건(99%)이 Latin 이름이다. 이름이 CJK인 것은 11건뿐이다(`DOCX工具`, `建模手` 등). 이름으로는 설명 언어를 알 수 없다.

### 3.4 별도 사례 (FACT, 판정 결과)

| 사례 | 예 | 판정 |
|---|---|---|
| 영어 용어가 섞인 중국어 | `管理 Runtime Target Context 的 CLI Admin 会话。` | zh |
| 영어 용어가 섞인 한국어 | `Build 및 TypeScript 에러 해결 전문가…` | ko |
| 중국어 trigger를 인용한 영어 | `…Use when user says "改论文", "improve paper"…` | latin |
| 한국어 trigger를 덧붙인 영어 | `…support escalation, 고객 지원 에스컬레이션…` | mixed |
| 영어 번역을 덧붙인 중국어 | anything2explainer | mixed |
| 코드가 섞인 영어·중국어 | `Run \`npx prettier --write .\`…` / `运行 \`npm run build\` 并检查…` | latin / zh |
| 짧은 설명 | `Lint` / `测试` / `テスト` | latin / unknown / ja |

### 3.5 README·SKILL.md 본문·저장소 설명

전수 조사는 PENDING이다. 운영 화면은 목록에 본문과 README를 싣지 않고, 운영 DB에는 접속하지 않았다. §4의 표본 17건에서 측정한 결과:

- 본문 언어는 17건 중 15건이 설명 언어와 같았다.
- README와 저장소 설명은 artifact 언어와 자주 달랐다.
  - ECC의 README 첫머리는 중국어로 판정됐지만 저장소 설명은 영어다.
  - oil-ui는 설명이 중국어이고 README는 영어다.
- 그래서 저장소 수준 메타데이터는 artifact 언어의 근거가 되지 못한다(INFERENCE).

---

## 4. 중국어 원본 검증

### 4.1 방법

1. 운영 상세 페이지에서 commit 고정 링크(`github.com/<repo>/blob/<sha>/<path>`)를 읽는다.
2. `raw.githubusercontent.com/<repo>/<sha>/<path>`에서 그 commit의 원본을 받는다.
3. frontmatter를 `js-yaml` CORE_SCHEMA로 파싱해 `description`을 꺼내고, 화면 설명과 문자열이 같은지 비교한다.
4. 저장소 설명과 README는 `gh api`로 읽었다(공개 저장소, 읽기 전용).
5. 원본 설명·본문·README·저장소 설명에는 같은 SQL 판정을 적용했다(E41-06).

### 4.2 결과 (FACT, 17건)

| artifact | 화면 판정 | 원본 일치 | 원본 설명 | 본문 | README | 저장소 설명 | 분류 |
|---|---|---|---|---|---|---|---|
| oil-oil/oil-ui | zh | SAME | zh | zh | latin | latin | A |
| math-modeling (SKILL.md) | zh | SAME | zh | zh | zh | zh | A |
| DOCX工具 (tools/docx) | zh | SAME | zh | zh | zh | zh | A |
| im-not-ai/commit-ko | ko | SAME | ko | ko | ko | mixed | A |
| html-anything/deck-pitch | zh | SAME | zh | zh | latin | latin | A |
| anything2explainer | mixed | SAME | mixed | zh | latin | latin | B |
| ai-business-skills/00-ke-hoach-mkt | latin(베트남어) | SAME | latin | latin | latin | latin | A* |
| claude-code-starter/commit | other(러시아어) | SAME | other | other | other | latin | A |
| skillmd/src-hunter | zh | SAME | zh | zh | latin | latin | A |
| superpowers-zh/brainstorming | zh | SAME | zh | zh | mixed | zh | A |
| ChineseResearchLaTeX/complete-example | zh | SAME | zh | zh | zh | zh | A |
| baoyu-skills/baoyu-translate | mixed | SAME | mixed | latin | latin | — | B |
| ECC docs/ja-JP/a11y-architect | ja | SAME | ja | ja | zh | latin | A(번역본) |
| ECC docs/es/api-design | latin(스페인어) | SAME | latin | latin | zh | latin | A*(번역본) |
| 1mcp docs/site/zh/admin | zh | SAME | zh | zh | latin | latin | A(번역본) |
| ECC agents/a11y-architect | latin | SAME | latin | latin | zh | latin | (영어 원본) |
| beads hooks.json | 없음 | SAME(null) | — | — | latin | latin | E |

- 분류 결과: A 13(A* 2건은 Latin 문자 비영어), B 2, C 0, D 0, E 1, F 0. 영어 원본 1건은 대조군이다.
- **C·D가 0건이므로 설명 추출 로직은 고치지 않았다.** 정상적인 중국어 원문을 파싱 결함으로 분류하지 않았다.

---

## 5. 언어 감지 후보 비교

### 5.1 후보와 측정 (FACT, E41-03·E41-04)

측정 대상은 설명이 있는 운영 18,008건이다. 라이브러리는 scratch 디렉터리에 설치해 측정했고 프로젝트에는 설치하지 않았다.

| 후보 | 방식 | API Key | 크기 | 18,008건 처리 | 판정 일치(latin→en / zh / ja / ko) | 라이선스·유지보수 | SQL 사용 |
|---|---|---|---|---|---|---|---|
| **A. Unicode 범위(채택)** | 문자 코드 범위 집계 | 불필요 | 0(의존성 없음) | 19k행 75 ms(PG17, 로컬) | 기준 | — | **가능** |
| B1. franc-min 6.2.0 | trigram | 불필요 | 148 KB(+trigram-utils 24 KB) | 3,863 ms | 15,939/17,082 · 506/609 · 163/169 · 33/37 | MIT, 2024-01 | 불가 |
| B2. tinyld 1.3.4 | n-gram | 불필요 | 12 MB | 5,417 ms | 15,009 · 545 · 169 · 36 | MIT, 2024-01 | 불가 |
| B3. eld 2.1.0 | n-gram(medium DB) | 불필요 | 8.8 MB, RSS 약 290 MB, 로드 142 ms | 733 ms | **16,877** · 585 · 163 · 36 | Apache-2.0, 2026-08 | 불가 |
| C. 통계 기반 | B1–B3이 이 방식이다 | | | | | | |
| D. 원본 메타데이터 | frontmatter에 언어 필드 없음, 저장소 메타는 artifact와 불일치(§3.5) | | | | | | 해당 없음 |
| E. 복합(A + eld) | CJK는 A, Latin 세분은 eld | 불필요 | 8.8 MB | — | — | — | eld 부분 불가 |

### 5.2 불일치를 직접 읽어 본 결과 (FACT)

- **franc가 프랑스어로 판정한 Latin 578건**: 40번째마다 표본을 읽었더니 거의 전부 영어였다("Quick Claude Code config audit…"). 짧은 기술 문장에서 오판이 많다.
- **tinyld**도 Berber 287건, French 286건 등 영어를 대량으로 오판했다.
- **eld가 비영어로 판정한 Latin 205건(1.2%)**: 표본 49건을 읽었다.
  - 대부분 실제로 비영어였다. ECC의 스페인어·포르투갈어 번역본, `minhnv0807/ai-business-skills`의 성조 없는 베트남어, 프랑스어 일부다.
  - 영어인데 비영어로 판정된 것은 3건 정도였다("Jailbreak LLMs: …" 등).
- **eld가 영어로 판정한 zh 22건**은 영어 용어가 많은 중국어 문장이다(예: `To do / In progress / In review / Done 四列, 卡片 + 头像 + 泳道`). A의 zh 판정이 사람의 판단과 더 가깝다.
- **영어 기능어 규칙(the/and/for… 포함 여부)**은 SQL로 만들 수 있지만 쓸 수 없다. Latin 315건에 기능어가 없었는데 대부분 짧은 영어였다("Implement secure user authentication system"). 반대로 베트남어는 `ma`, `to` 같은 단어 때문에 통과했다.

### 5.3 A의 정확도 (FACT, E41-05)

- seed 41로 zh 20, ja 15, ko 10, mixed 20, latin 25건, 합계 90건을 무작위로 뽑아 직접 읽었다. **90/90이 맞았다.**
  - mixed 20건은 모두 CJK 문장과 6단어 이상의 영어 문장을 함께 갖고 있었다. 어느 영어 구절 때문에 mixed가 됐는지도 확인했다.
- 한계(ceiling):
  1. Latin 문자 안에서 영어와 비영어를 구별하지 못한다(약 1.2%).
  2. Han 문자만 4자 미만이면 중국어인지 일본어 한자어인지 알 수 없어 unknown으로 둔다.
  3. 간체와 번체를 구별하지 않는다(둘 다 zh).

### 5.4 선택 이유

- **필터는 SQL의 WHERE 조건이어야 한다.** 행 query와 count query가 같은 식으로 걸러야 마지막 페이지가 사라지지 않는다(`searchWhere`). B1–B3은 JS라서 저장 컬럼(migration) 없이는 필터에 쓸 수 없다.
- A는 의존성 0, build·CI 영향 0이고, CJK 판정에서는 B보다 정확하다.
- eld는 나중에 "저장 컬럼 + ingest 시점 판정"으로 Latin을 en과 비영어로 나눌 때의 1순위 후보로 남긴다(§14).

---

## 6. 정책 A~D 비교

| 기준 | A. 유지 + 표시 | **B. 유지 + 필터(+표시)** | C. 영어 우선 정렬 | D. 비영어 수집 제외 |
|---|---|---|---|---|
| Artifact 감소 | 0 | 0 | 0 | **925건(4.8%) 이상** |
| 검색 결과 변화 | 없음 | 필터를 고를 때만 좁아짐 | 모든 영어 검색어의 순위가 바뀜 | 비영어 결과 소멸 |
| 데이터 손실 위험 | 없음 | 없음 | 없음(순위만 바뀜) | 높음. 원문이 비영어인 정상 데이터, 번역본 |
| 사용자 편의 | 언어를 미리 앎 | 숨기기와 찾기 모두 가능 | 영어 사용자만 유리하고 중국어 사용자는 불리 | 비영어 사용자 배제 |
| 구현 복잡도 | 낮음 | 낮음(SQL 식 1개 + URL 파라미터 1개) | 중간(관련성 점수와 충돌) | 중간(ingest 정책, 기존 행 처리) |
| 운영 비용 | 1페이지는 화면 25행만 판정(깊은 페이지는 OFFSET 행까지 판정, Phase 42 정정) | 필터 사용 시 전체 스캔 +0–72 ms(§10) | 모든 검색에 판정 비용 | 재수집·정리 작업 |
| 회귀 위험 | 낮음 | 낮음(기본 동작 동일, 54/54 동일) | 높음(§10의 반례) | 높음(사용자 승인 필요) |

---

## 7. 추천 정책

**정책 B + A(표시)를 함께 적용한다.**

- 기본값은 모든 언어를 지금 순서 그대로 보여 주는 것이다. 영어를 기본 언어로 강제하지 않는다(§7.7 판단).
- 언어 필터를 명시하면 해당 언어만 보여 준다. 검색어가 중국어인지 영어인지로 결과를 바꾸지 않는다. 검색어 언어 추정은 근거가 없는 기능이기 때문이다.
- 각 행에는 영어 화면에서 예상하기 어려운 설명 언어(Chinese, Japanese, Korean, Mixed languages, Other scripts)를 한 단어로 표시하고, title로 "번역하지 않은 원문"임을 밝힌다.
- 번역 API 없이 할 수 있는 개선만 한다. 번역되지 않은 내용을 번역된 것처럼 보이게 하지 않는다.

C와 D는 적용하지 않는다(§1, §10).

---

## 8. 실제 구현 내용

### 8.1 판정: `src/db/queries/language.ts` (신규)

- `summaryLanguage(text)`는 SQL 식이고, `SUMMARY_LANGUAGE`는 이를 `package.summary`에 적용한 값이다. `NOT_LISTED_BECAUSE`처럼 한 객체를 WHERE와 SELECT에서 같이 쓴다.
- 판정 규칙(위에서부터 처음 맞는 것):
  1. 설명이 null이거나 공백뿐이면 null.
  2. CJK가 없으면 `~` 검사만 한다. 기타 문자가 없으면 latin(글자가 아예 없으면 unknown)이고, 있으면 Latin과 기타 문자의 수를 비교한다.
  3. CJK가 글자의 10% 미만이면 latin 또는 other.
  4. 공백으로 구분된 Latin 단어가 6개 이상 이어지면 mixed. 단어 안의 `/`·`.`·`-`는 단어의 일부로 본다(`topics/writing/…`는 한 단어).
  5. Hangul이 CJK의 절반 이상이면 ko, kana가 CJK의 10% 이상이면 ja, CJK가 4자 미만이면 unknown, 나머지는 zh.
- 코드 포인트 범위만 쓰고 POSIX 클래스(`[[:alpha:]]`)는 쓰지 않는다. collation이 다른 Neon에서도 같은 결과를 내기 위해서다.
- 성능 개선 이력(로컬 PG17, 운영 설명 18,995건, 매 단계 결과 동일 0 differ):

  | 단계 | 시간 |
  |---|---:|
  | 모든 행에서 5회 집계 | 11.1 s |
  | CJK 없는 행 fast path | 165 ms |
  | kana·Hangul·기타 집계를 lazy하게 | 165 ms |
  | `[범위]+` 연속 구간 삭제로 집계 | **75 ms** |

### 8.2 필터·URL: `src/db/queries/search.ts`, `src/components/searchState.ts`, `src/app/artifacts/page.tsx`

- `LANGUAGE_FILTER_IDS = ['latin','zh','ja','ko','mixed','other']`. unknown은 찾을 언어가 없으므로 제외했다.
- `SearchFilters.languages?`는 optional이다. 이전 호출자는 모두 "모든 언어"를 뜻한다.
- `searchWhere`에 `inArray(SUMMARY_LANGUAGE, languages)` conjunct를 하나 추가했다. 행·count·trigram fallback이 같은 조건을 쓴다.
- URL 파라미터 `lang`(단일 선택, type과 같은 방식)을 추가했다.
  - 순서는 `q, type, lang, cap, sort, page`이고, 값이 없으면 URL에 쓰지 않는다. 기존 URL은 그대로다.
  - 모르는 값은 무시한다(빈 페이지를 만들지 않는다). `lang`이 있으면 noindex다.
- 화면 변경:
  - Description facet: "Any language" + 6개 칩.
  - 적용 필터 칩: "Description: …".
  - 검색 form의 hidden input으로 새 검색어를 입력해도 필터가 유지된다.
  - 필터 안내문에 "번역하지 않으며 Latin alphabet에는 영어 외 언어도 포함된다"는 문장을 추가했다.

### 8.3 표시: `src/components/language.ts`(신규), `PackageRows.tsx`, 상세 페이지

- 행 메타 줄에는 zh·ja·ko·mixed·other일 때만 언어명을 표시한다. latin과 unknown은 표시하지 않는다.
- 설명 `<p>`에 `lang="zh|ja|ko"`를 붙인다. 화면 판독기의 음성 전환과 Han 글꼴 선택에 쓰인다. 확신할 수 없는 class에는 붙이지 않는다. 틀린 `lang`은 페이지의 `lang="en"`보다 나쁘기 때문이다.
- 상세 페이지 안내문: "Description language: Chinese. Shown as the author wrote it; AgentDock does not translate it, and a browser's translate feature can." 브라우저 번역을 서버에서 실행하지 않고 안내만 한다.

### 8.4 관측: `src/log.ts`

- search 로그 한 줄에 `languages: string[]` 필드를 추가했다. 빈 배열도 생략하지 않는다. 언어 필터 사용 빈도를 §14 판단의 근거로 쓰기 위해서다.

### 8.5 검토했지만 구현하지 않은 것

- **설명 없음 표시 개선**: hook 203건은 설명 필드가 없는 형식이다. "No description in the file"을 일괄 표시하면 형식상 존재할 수 없는 것을 빠졌다고 말하게 된다. 유형별 문구가 필요해 별도 작업으로 남긴다.
- **본문(SkillBody)에 `lang` 붙이기**: 본문 언어를 판정하지 않았다. 표본 17건 중 15건만 설명 언어와 같았다.
- **번역본 묶기**(ECC `docs/ja-JP` 등): identity와 duplicate 정책을 바꾸는 결정이라 범위 밖이다.

---

## 9. DB/API/URL 영향

| 항목 | 영향 |
|---|---|
| Schema·migration | **없음.** 새 컬럼·인덱스·함수 없음. 조회 시점 SQL 식만 추가 |
| 운영 DB 쓰기 | 없음 |
| Artifact identity | 변경 없음(`package_identity`, ingest 경로 미변경) |
| 원본 Description | 덮어쓰지 않음(읽기 전용 식) |
| 검색 의미 | 필터가 없으면 동일(평가 54/54 사례 단위 동일). 순위식 미변경 |
| URL 계약 | 기존 URL은 같은 상태를 가리킨다. `lang`은 추가 파라미터이고, 값이 없으면 기존 URL과 같다(`searchState.test.ts`) |
| 공개 API | 없음(AgentDock에는 JSON API가 없다) |
| 외부 호출 | 없음(번역 API·유료 API 미도입, 새 의존성 0) |

`check:boundaries` OK, verdict 어휘 검사 통과.

---

## 10. 검색 품질 영향

### 10.1 평가셋 54건 (FACT, E41-10·E41-12)

- 변경 전 HEAD(별도 worktree)와 변경 후 모두 54 passed다.
- 요약 지표가 같다: p5 0.3277, recall10 0.8882, MRR 0.9273, nDCG10 0.9068, top1 0.9149, zeroResult 0.0426.
- 사례별 결과 JSON(`SEARCH_EVAL [...]`)이 diff 0으로 동일하다.

### 10.2 정책 C 시뮬레이션 (FACT, E41-13)

- 별도 worktree에서 순위식에 "검색어에 CJK가 없으면 비-latin 행 −10"을 넣고 평가했다.
- **요약 지표와 사례별 첫 관련 순위가 모두 같았다.** 판정되지 않은 상위 결과만 바뀌었다. 예를 들어 `mcp-name`의 2위가 `baoyu-wechat-summary`에서 `release-skills`로 바뀌었다.
- 평가셋에는 다국어 관련성 판정이 사실상 없어서 C의 효과도 피해도 측정하지 못한다는 뜻이다.
- 운영 반례(FACT, 읽기 전용 GET): `q=math modeling`의 21건 중 2위가 중국어 설명의 `XiaoMaColtAI/math-modeling-skill`이다. 영어 사용자에게도 관련 있는 결과인데, C를 적용하면 Latin 일치 결과 전부보다 아래로 밀린다.
- "개선 근거 없음 + 구체적 피해 사례"이므로 **C는 적용하지 않는다.**

### 10.3 중국어 검색어의 현재 동작 (FACT, 바꾸지 않음)

- PostgreSQL `english` parser는 CJK 문장을 구두점 단위의 큰 lexeme 하나로 색인한다.
  - 로컬 측정: `当用户要求数学建模、建模竞赛…`는 `'当用户要求数学建模'`, `'建模竞赛'` 등으로 색인된다.
  - 그래서 `建模竞赛`는 맞지만 `数学建模`는 전문 검색으로 맞지 않는다.
- 운영 결과:

  | 검색어 | 결과 | 비고 |
  |---|---:|---|
  | `数学建模` | 4건 | 이름·경로·trigram 경로. 본 SKILL.md는 빠짐 |
  | `建模竞赛` | 1건 | 본 SKILL.md |
  | `DOCX工具` | 1건 | |

- 이 동작을 바꾸려면 검색 의미(parser나 trigram 범위)를 바꿔야 하므로 이번 범위에서 제외했다(§14).

### 10.4 성능 (FACT, E41-09, 로컬 PG17, 운영 설명 19,113건을 test schema에 적재했다 삭제)

| 조건 | count p50 | rows p50 |
|---|---:|---:|
| browse, 필터 없음 | 86 ms | 91 ms |
| browse, lang=zh | 84 ms | 85 ms |
| browse, lang=latin | 158 ms | 161 ms |
| `review`, 필터 없음 | 23 ms | 29 ms |
| `review`, lang=zh | 81 ms | 87 ms |

- 필터가 없으면 언어 식은 정렬 뒤에 계산된다. 1페이지에서는 화면의 25행만 계산한다(실행 계획 `SubPlan … loops=25`).
  - **정정(Phase 42):** 깊은 페이지에서는 OFFSET으로 건너뛰는 행도 계산된다. offset 9,000에서 +42ms, offset 19,000에서 +89ms다(browse recent 기준 157→199ms, 218→307ms).
  - 1페이지와 홈 화면은 변하지 않는다. 자세한 내용은 `agentdock-phase42-44-multilingual-production-verification.md` §7에 있다.
- 필터를 쓰면 식이 package 컬럼만 참조하기 때문에 planner가 scan 단계에 적용한다. 그래서 전문 검색 조건보다 먼저 전체 행에 계산되고, 이것이 `review`의 23 → 81 ms다.
- `ponytail:` 표식에 상한을 적어 두었다. 필터 적용 목록이 200 ms를 넘으면(이 속도로 약 25k행) 다시 검토하고, 그때의 해법은 STORED generated column(migration 승인 필요)이다.

---

## 11. 테스트 결과

### 11.1 언어 테스트셋 (`src/db/queries/language.test.ts`, 21건, DB 기반)

필수 12개 사례를 모두 포함한다.

1. 영어
2. 간체
3. 번체
4. 한국어
5. 일본어
6. 영어+중국어 혼합
7. 영어+한국어 혼합
8. 코드 포함(영어·중국어)
9. 짧은 설명(Lint·测试·テスト)
10. 설명 없음·공백
11. 숫자·기호
12. 다국어 저장소: `search.test.ts`의 multilingual fixture

추가 사례: 영어 용어가 섞인 중국어, 영어 용어가 섞인 한국어, 중국어 trigger를 인용한 영어, slash 목록, 키릴, 성조 없는 베트남어(ceiling 명시).

### 11.2 필터·페이지네이션·identity (`search.test.ts` "the description language filter", 7건)

- 언어별로 정확히 한 행이고 count가 일치한다(zh·ja·latin·mixed).
- 필터가 없으면 같은 행이 같은 순서로 나오고, 설명 없는 행도 포함된다.
- 모르는 값은 무시한다.
- 필터를 건 페이지네이션(7행 / 3행씩 3페이지)에서 중복·누락이 0이고 count 7이 일치한다.
- type 필터, browse와 조합해도 동작한다.
- trigram fallback에서도 필터가 유지된다.
- 목록(`listPackages`)과 상세(`getPackageDetail`)에 언어가 표시된다.

### 11.3 URL 상태 (`searchState.test.ts`, 3건)

- 파라미터 순서가 맞고, 값이 없으면 기존 URL과 같다.
- 칩 토글 시 page 1로 돌아간다.
- type·cap·sort·page 변경 후에도 `lang`이 유지된다.

### 11.4 변경 전 FAIL / 변경 후 PASS (FACT, E41-11)

- HEAD worktree에 새 테스트 파일만 복사해서 실행했다: **3 files failed, 9 tests failed**.
  - `withLanguage is not a function`
  - `Cannot find module …/language`
  - `expected [5 rows] to deeply equal [1 row]` 등
- search 로그 필드는 `tsc`에서 실패했다(error TS 2건).
- 변경 후에는 모두 PASS다.

### 11.5 전체 검증 (FACT, 최종 코드 기준)

| 단계 | 결과 |
|---|---|
| check:boundaries | OK |
| lint | 233 files, 문제 없음 |
| typecheck | 오류 0 |
| test | **81 files, 1530 passed, 2 skipped**(baseline 80 files 1499 passed + 신규 31) |
| build | 성공(DATABASE_URL placeholder) |
| E2E | e2e:seed 후 **28 passed**(baseline 27 + 언어 필터 여정 1) |
| search:eval | **54/54**, 지표·사례 결과 baseline과 동일 |

- skip 2건은 baseline과 같다: trust 인증이라 실행할 수 없는 비밀번호 테스트, pg_trgm runtime 테스트.
- E2E 기존 2건(`detail, Back and a shared URL`, `bad parameters…`)의 기대값을 바꿨다. 새 Description facet의 기본 칩 "Any language"가 선택 상태(`aria-current`)라 선택 칩 목록에 하나가 더 잡힌다. 의도한 동작 변화다. 잘못된 `lang=zz`의 fallback 단언도 함께 추가했다.

---

## 12. 운영 영향

- **배포 전**: 운영 변화 없음. 이번 작업은 운영에 읽기 전용 GET만 보냈다(목록 770페이지, 상세 17건, 검색 4건).
- **배포 후(INFERENCE)**:
  - 필터가 없는 모든 페이지는 결과·순서가 그대로이고, 비영어 설명 행에 언어명이 한 단어 늘어난다.
  - 필터를 쓰면 목록당 로컬 기준 +0–72 ms가 든다. Neon의 실제 값은 PENDING이다.
- Sync, migration, Secret, 운영 DB 상태 모델은 바뀌지 않는다. **배포 순서 제약도 없다**(schema를 바꾸지 않음).
- 직전 Phase의 운영 승인 대기 항목(secret·fingerprint 교체 등)과 독립적이다.

---

## 13. PENDING

1. Neon에서 필터 적용 목록의 실제 응답 시간. 배포 후 `/artifacts?lang=zh`, `/artifacts?lang=latin`, `/artifacts?q=review&lang=zh`를 각 3회 측정한다.
2. 운영 화면에서 배지·칩·상세 안내가 어떻게 보이는지(배포 후 확인).
3. README·SKILL.md 본문·저장소 설명의 언어 전수 분포. 운영 DB를 읽지 않고는 불가능해서 표본 17건만 했다.
4. Latin 안 비영어의 정확한 비율. eld 205건의 표본 정밀도가 약 90%이고, eld가 영어로 놓친 비영어(재현율)는 측정하지 않았다.
5. 운영 collation에서의 pg_trgm CJK 동작. 로컬 en_US.utf8에서는 CJK trigram이 동작했다. 이번 변경과는 무관하다.
6. 언어 필터 사용 빈도. 배포 후 search 로그 `languages` 필드로 집계한다.

---

## 14. 향후 번역 도입 판단

번역 도입은 다음 조건이 확인될 때 검토한다.

1. 사용 근거가 있다. 배포 후 4주 동안 search 로그의 `languages` 비율과 `zh`·`ja` 필터 사용 빈도를 본다.
2. 대상 규모가 고정적이다. 비영어 설명은 현재 925건이고, 설명 상한이 1,024자이므로 1회 번역량이 작다.
3. 저장 위치가 승인된다. 번역문은 원문 컬럼을 덮어쓰지 않고, 별도 컬럼이나 테이블에 "machine translation" 표시와 함께 저장해야 한다. 이는 migration이고 사용자 승인이 필요하다.
4. 비용 상한이 정해진다. ingest 시점에 새 설명만 번역하고, content_hash가 같으면 다시 번역하지 않는다.

그보다 먼저 할 수 있는 무료 개선:

- (a) 저장 컬럼 `summary_language`를 추가하고, 판정은 ingest 시점에 이 SQL 식으로 하거나 eld로 Latin을 en과 비영어로 나눈다. 성능 상한 문제도 함께 풀린다. migration 승인이 필요하다.
- (b) 번역본(`docs/ja-JP` 등)을 원본과 묶어 보여 준다.
- (c) CJK 검색어의 부분 일치. trigram 범위나 parser 변경이므로 검색 의미 변경 결정이 필요하다.

---

## 15. Evidence ID

scratch 경로는 이 세션 전용이며 저장소에 포함되지 않는다:
`/tmp/claude-1000/-home-ChoiGwanghun-workspace-auto-agentdock/5f3bf29d-8c4e-417d-a177-083dcd61f8ca/scratchpad/p41/`

| ID | 내용 | 근거 |
|---|---|---|
| E41-01 | 운영 목록 읽기 전용 수집 770페이지, 19,113건 | `crawl.py`, `prod.jsonl`, `prod2.jsonl`, `crawl*.log` |
| E41-02 | 이 SQL 식으로 분류한 전체 분포·유형·저장소 | `classify.ts`, `all-lang.jsonl` |
| E41-03 | franc·tinyld·eld 비교(시간·일치·혼동) | `detectors/bench.mjs` |
| E41-04 | eld 비영어 205건 분해와 표본 판독 | `detectors/eldrepos.mjs`, `inspect.mjs` |
| E41-05 | 무작위 90건 수기 판독(90/90) | seed 41 표본 출력 |
| E41-06 | 원본 대조 17건(전부 SAME) | `origin/origin.py`, `origin/cmp.jsonl`, `origin/cls-*.jsonl` |
| E41-07 | 언어 디렉터리 집계(ja 147/169) | 집계 스크립트 출력 |
| E41-08 | 이름·설명 언어 교차표(916/925 Latin 이름) | `names-lang.jsonl` |
| E41-09 | 성능(식 11.1 s → 75 ms, 실제 query 표, `loops=25`) | `render.ts`, `lang*.sql`, `perf.ts`, `plan*.ts` |
| E41-10 | 변경 전 baseline(1499 passed, eval 54) | `baseline-test.txt`, `baseline-eval.txt` |
| E41-11 | 새 테스트의 변경 전 FAIL(9 failed) | HEAD worktree 실행 출력 |
| E41-12 | 변경 후 전체 검증 | §11.5 |
| E41-13 | 정책 C 시뮬레이션 평가 | `sim-eval.txt` |
| E41-14 | 운영 CJK 검색 4건(읽기 전용) | 세션 출력 |
| E41-15 | PG `english` parser의 CJK 토큰화 | 로컬 `to_tsvector` 출력 |

정리한 것:

- 로컬 scratch 테이블 `postgres.public.p41_desc`를 삭제했다.
- test schema의 `p41-perf/%` 행은 0건으로 확인했다.
- worktree 2개(base, sim)를 제거했다.
- `test-results/`를 삭제했다.

---

## 16. Git Status

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
?? src/components/language.ts
?? src/db/queries/language.test.ts
?? src/db/queries/language.ts
```

HEAD는 `e4c2773`이고 commit·push는 하지 않았다.

---

## 17. 권장 Commit 메시지

```bash
git add src/db/queries/language.ts src/db/queries/language.test.ts \
  src/components/language.ts src/db/queries/search.ts src/db/queries/search.test.ts \
  src/db/queries/packages.ts src/components/searchState.ts src/components/searchState.test.ts \
  src/components/PackageRows.tsx src/app/artifacts/page.tsx \
  "src/app/r/[owner]/[repo]/[...path]/page.tsx" src/log.ts src/log.test.ts \
  e2e/journeys.spec.ts docs/analysis/agentdock-phase41-multilingual-discovery.md

git commit -m "feat(search): filter and label artifacts by description writing system

- SUMMARY_LANGUAGE classifies package.summary by Unicode ranges in SQL
  (latin/zh/ja/ko/mixed/other/unknown), no migration: production's 19,113
  listed descriptions are 89.4% latin, 3.2% zh, 0.9% ja, 0.3% mixed; 90 of a
  90-row hand-read sample agree; latin is not called English because ~1.2%
  of it is not (eld)
- lang URL parameter narrows search, browse, count and the trigram fallback;
  absent, results, order and URLs are unchanged (search eval 54/54 identical)
- rows and the detail page name non-Latin description languages, set lang
  on zh/ja/ko text, and say the description is the author's, untranslated
- search log records the language filter, for a later translation decision
- e2e: the default 'Any language' chip is now among the current chips
- docs: Phase 41 multilingual discovery report

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
