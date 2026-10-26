# AgentDock Phase 48–50 — Production Release · Sync Recovery · Refresh Capacity

- 작성: 2026-10-26 (관찰 시각은 모두 UTC)
- 기준 commit: `8f4d96f` (HEAD = origin/develop = Production)
- 운영에서 한 일: 읽기 전용 HTTP GET, Actions·Deploy 로그와 메타데이터 조회만 했다.
- 하지 않은 일: 운영 DB 접속, secret 조회·변경, 수동 Sync, 재enqueue, migration, commit·push·deploy.
- 표기: FACT(직접 관찰) / INFERENCE(근거가 있는 추론) / PENDING(조건이 아직 오지 않음) / NOT RUN(실행하지 않음)

## 1. 핵심 결론

1. **다국어 검색 변경(Phase 41–45)은 Production에 반영됐다(FACT).**
   - 사용자가 `8f4d96f`를 push했다.
   - CI 40275711719와 Deploy 40275836492가 성공했다.
   - 05:46:02Z부터 `x-agentdock-commit: 8f4d96f…`가 응답된다.
2. **운영 검색 품질은 fixture와 같다(FACT).**
   - 14개 검색어 중 11개는 운영 상위 목록이 fixture와 순서까지 같다.
   - 나머지 3개는 같은 집합 안에서 인접한 두 행의 순서만 다르다.
   - 판정된 6개 검색어의 지표를 운영 순서로 다시 계산해도 R@10 0.717, MRR 0.750, NDCG@10 0.704로 같다.
   - 필터 없는 영어 검색 4개의 상위 10개는 배포 전 운영 결과와 같다.
3. **언어 필터는 정상 동작한다. 성능은 `lang=latin` 하나만 기준을 넘는다(FACT).**
   - 무필터 대비 p50 증가: zh·ja·ko·mixed +0.12–0.14s, `q=review&lang=zh` +0.19s
   - `lang=latin`은 +0.42s이며 5라운드 모두 넘었다.
   - 원인은 행마다 계산하는 언어 분류 비용이다(§7). 개선 후보는 migration이 필요해 승인 대상으로 남긴다.
4. **모바일·데스크톱 UI는 정상이다(FACT).** 320px·1280px 26개 화면이 모두 200이고 가로 넘침은 0이다.
5. **Sync Guard는 아직 한 번도 실행되지 않았다(PENDING).**
   - guard가 들어간 코드 배포 후 예약 Sync는 0회다(05:55Z 기준).
   - 최근 Sync 4회 모두 health에서 `connected as agentdock_app` 등 6개 항목이 FAIL했다(FACT).
   - secret은 10/22 05:28:37Z 이후 바뀌지 않았다. 따라서 다음 Sync는 guard에서 거부될 것으로 본다(INFERENCE).
6. **운영자가 바꿔야 할 설정:** Actions secret `DATABASE_URL`(`agentdock_app` direct URL)과 production 변수 `AGENTDOCK_TARGET_FINGERPRINT`. 둘은 같은 자리에서 함께 바꾼다(§9, §17).
7. **Job 771·978은 아직 실패 상태다.** 복구 코드는 배포됐다. 재enqueue는 secret 교체와 guard PASS 뒤에 한다.
8. **Refresh cap은 100을 유지한다.** guard를 통과한 정상 Sync가 0회다.
9. **Stop hook 오류는 Knowledge 누락을 만들지 않았다(FACT).**
   - 실패한 hook은 gstack `timeline-stop-hook` 하나다.
   - 원인은 PATH에 남은 끊긴 Orca AppImage FUSE 마운트다(§15).
   - Obsidian hook은 같은 turn들에서 정상 실행됐다.

## 2. Git / Production SHA

| 항목 | 값 | 구분 |
|---|---|---|
| HEAD | `8f4d96f` feat(search): add language filters and improve CJK search | FACT |
| origin/develop | `8f4d96f` (`git fetch` 후) | FACT |
| 마지막 CI | 40275711719, push, `8f4d96f`, success (05:42:53–05:44:15Z). check·database·e2e 모두 success | FACT |
| 마지막 Deploy | 40275836492, workflow_run, `8f4d96f`, success (05:44:17–05:45:55Z), deployment 7324983054 | FACT |
| Production SHA | 05:44:25Z `e4c2773` → 05:46:02Z `8f4d96f` | FACT |
| Git Status | 커밋 전 clean. 이번 작업으로 untracked 2개(보고서, `docs/images/phase48/`) | FACT |

## 3. 배포 정합성

- Phase 41–45 변경은 `8f4d96f` 하나에 담겨 배포됐다.
  - 대상 파일: `language.ts`, `search.ts`의 CJK substring, 평가셋, UI 칩·표시
  - 배포된 코드와 이 작업 트리의 코드가 같다(clean tree, HEAD = Production).
- 배포 SHA 기준 로컬 재검증 결과 (FACT):
  - `bun run search:eval` 54/54. Phase 45의 사례별 출력과 diff 0
  - `bun run search:eval:multilingual` 15/15, summary `{"judged":6,"recall10":0.7167,"mrr":0.75,"ndcg10":0.7035,"cjkZeroResult":0.4}`
  - 실행 후 test DB에 남은 `ml-eval-`·`p43-` 행은 0건이다.
- 이번 Phase에서 코드는 바꾸지 않았다. 따라서 전체 테스트(lint·typecheck·test·build·E2E)는 다시 돌리지 않았다(NOT RUN). 같은 SHA로 CI가 check·database·e2e를 통과했다.

## 4. 다국어 검색 정확도

운영 `/artifacts?q=` 결과의 상위 25개와 `search:eval:multilingual`의 `MULTILINGUAL_EVAL_RANKS`를 비교했다.
- 비교할 때 identity 끝의 `/SKILL.md`는 양쪽에서 똑같이 떼었다. 운영 링크는 skill 디렉터리를 가리키기 때문이다.
- 원시 데이터는 `probe.json`, `ml-eval.txt`, `compare.txt`다(§19).

| 검색어 | 운영 total | 상위 10 = fixture | 차이 | 배포 전 운영 상위 10과 |
|---|---|---|---|---|
| math modeling | 21 | 같음(21개 전부) | — | 같음 |
| code review | 751 | 같음(25개 전부) | — | 같음 |
| document processing | 59 | 같음 | 11위: 운영 `alirezarezvani/…/business-operations-skills`가 fixture에 없음(Phase 45에서 이미 알려짐) | 같음 |
| browser automation | 65 | 같음(25개 전부) | — | 같음 |
| **数学建模** | 7 | **같음(7개 전부)** | — | 달라짐(의도한 개선) |
| 代码审查 | 6 | 집합 같음 | 4위↔6위 교환. 두 행 모두 정답 | 달라짐 |
| 文档处理 | 0 | 같음 | — | 같음 |
| 浏览器自动化 | 4 | 같음 | — | 달라짐 |
| 数学モデリング | 0 | 같음 | — | 같음 |
| **コードレビュー** | 3 | 집합 같음 | 2위↔3위 교환. 두 행 모두 정답 | 달라짐 |
| 文書処理 | 0 | 같음 | — | 같음 |
| 수학 모델링 | 0 | 같음 | — | 같음 |
| 코드 리뷰 | 2 | 같음 | — | 같음 |
| **문서 처리** | 2 | 집합 같음 | 1위↔2위 교환(`privacy-global` ↔ `privacy-global-jp`). 판정 대상 아님 | 달라짐 |

- **지표(FACT, 계산):** 교환된 두 쌍은 모두 정답끼리 자리가 바뀐 것이다. 그래서 운영 순서로 계산한 R@10·MRR·NDCG@10이 fixture 값과 같다(0.717 / 0.750 / 0.704). 배포 전은 0.417 / 0.750 / 0.481이었다.
- **교환이 생긴 이유(INFERENCE):**
  - 세 쌍은 모두 CJK substring으로 새로 일치하게 된 행이다.
  - 이런 행은 rank가 같고, 운영에서는 동점을 `updated_at desc, id`로 정렬한다.
  - fixture는 배포 전 운영 목록에 없던 행의 상대 순서를 알 수 없어서 이름순 위상 정렬로 넣었다.
  - 이 세 쌍을 운영 순서로 바꾸면 14/14가 순서까지 같아진다. 지표가 같으므로 이번에는 fixture를 고치지 않았다. 다음에 fixture를 다시 만들 때 반영한다.
- **필터 없는 기존 결과 유지(FACT):** 영어 4개 검색어의 상위 10개는 배포 전 운영 결과(Phase 43 수집)와 순서까지 같다. `math modeling` total 21도 그대로다.

## 5. 언어 필터

운영에서 읽기 전용 GET으로 확인했다(FACT, 05:47–05:49Z).

| URL | 결과 | 선택 칩 | pagination |
|---|---|---|---|
| `/artifacts` | 19,247 | Any language | `?page=2` … `?page=770` |
| `lang=zh` | 609 (행 25/25 `lang="zh"`) | Chinese | `lang=zh&page=2` … `page=25` |
| `lang=latin` | 17,275 | Latin alphabet | `lang=latin&page=2` … `page=691` |
| `lang=ja` | 169 (25/25 `lang="ja"`) | Japanese | `page=7`까지 |
| `lang=ko` | 37 (25/25 `lang="ko"`) | Korean | `page=2` |
| `lang=mixed` | 59 | Mixed languages | `page=3`까지 |
| `lang=other` | 51 | Other scripts | `page=3`까지 |
| `lang=xx`, `ZH`, `zh,ja`, `unknown` | 19,247. 필터 무시 | Any language | 무필터와 같음 |
| `q=review&lang=zh` | 38, 검색창 `review` 유지 | Chinese, Relevance | `q=review&lang=zh&page=2` |
| `q=数学建模&lang=zh` | 7 | Chinese | — |
| `q=math modeling&lang=latin` | 12 | Latin alphabet | — |
| `lang=zh&page=2` | Showing 26–50 | Chinese | 앞뒤 링크에 `lang=zh` 유지 |
| `lang=zh&page=25` | Showing 601–609, 9행 | Chinese | — |
| `lang=zh&page=26` | 행 0개(기존 "no page N" 분기) | Chinese | — |

- 정렬: 무검색은 "Recently indexed", 검색은 "Relevance"가 기본으로 선택된다(FACT).
- 적용·해제(FACT, Playwright): `?q=review` → Chinese 클릭 → `?q=review&lang=zh` → Any language 클릭 → `?q=review`. 검색창 값은 계속 `review`다(320px·1280px 모두).
- 잘못된 `lang`은 오류 없이 무시된다. 허용 목록은 `LANGUAGE_FILTER_IDS`이고 `unknown`은 의도적으로 빠져 있다(FACT, `search.ts:153`).
- 건수 비교: zh·ja·ko 609/169/37은 Phase 45의 로컬 스냅샷과 같다. 전체 19,247과 latin 17,275는 로컬 스냅샷(19,113 / 17,082)보다 많다. 스냅샷을 마지막 Sync 이전에 수집한 것으로 보인다(INFERENCE).

## 6. 운영 UI

Playwright(headless Chromium)로 운영 URL을 직접 열었다(FACT, 05:49–05:50Z). 결과는 `ui.json`이다.

| 확인 | 320×1000 | 1280×900 |
|---|---|---|
| HTTP status (12개 목록 + 상세 1) | 전부 200 | 전부 200 |
| 가로 overflow | 0px (13화면) | 0px |
| 언어 표시 | 행에 `lang="zh"/"ja"/"ko"`가 붙는다. latin·mixed 행에는 붙지 않는다(문서 기본값 `en`) | 같음 |
| 필터 칩 `aria-current` | Chinese / Japanese / Korean / Latin alphabet / Mixed languages / Any language 정상 | 같음 |
| 상세 원문 안내 | `/r/oil-oil/oil-ui/SKILL.md`에 "Description language: Chinese. Shown as the author wrote it; AgentDock does not translate it, and a browser's translate feature can." 표시, 설명 요소 `lang="zh"` | 같음 |
| HTML lang | `en` | `en` |
| CJK 검색 | `数学建模` 7건, `コードレビュー` 3건, `문서 처리` 2건. 행 `lang`이 각 언어와 일치 | 같음 |

- **관찰(기존과 같음):** 320px에서 선택된 Description 칩(예: Chinese)이 가로 스크롤 줄의 오른쪽 밖에 있어 첫 화면에 보이지 않는다. Type 줄도 같은 방식이다. 결과 개수 줄의 "Remove filter: Description: Chinese ×"가 선택 상태를 보여 주므로 기능 결함은 아니다. 개선한다면 별도 UI 작업이다.
- 스크린샷 8장은 `docs/images/phase48/`에 새로 저장했다. 기존 파일은 덮어쓰지 않았다.
  - `lang-zh`, `review-zh`, `cjk-search`, `detail-zh` × `320`/`1280`
  - 26장 전체는 scratchpad의 `p48/shots/`에 있다(§19).

## 7. 응답 성능

### 측정 (운영, FACT)

- 05:50:50–05:52:56Z에 10개 URL을 5라운드 교차로 측정했다. 요청 간격은 1초, 응답은 50/50 모두 200이다.
- 값은 curl `time_total` 기준이다(TTFB는 모든 URL에서 0.33–0.36s로 같다).

| URL | p50 | p95 | max | min | 무필터 대비 p50 |
|---|---|---|---|---|---|
| `/artifacts` (기준선 1.132) | 1.137 | 1.179 | 1.189 | 1.107 | — |
| `lang=zh` | 1.260 | 1.365 | 1.390 | 1.079 | +0.123 |
| **`lang=latin`** | **1.560** | 1.600 | 1.603 | 1.516 | **+0.423** |
| `lang=ja` | 1.276 | 1.308 | 1.311 | 1.239 | +0.139 |
| `lang=ko` | 1.252 | 1.297 | 1.302 | 1.055 | +0.115 |
| `lang=mixed` | 1.259 | 1.295 | 1.304 | 1.239 | +0.121 |
| `q=review` (기준선 1.106) | 1.093 | 1.232 | 1.236 | 1.039 | — |
| `q=review&lang=zh` | 1.282 | 1.544 | 1.554 | 1.196 | +0.189 |
| `q=数学建模` | 0.813 | 0.824 | 0.824 | 0.584 | (결과 7건) |
| `q=math modeling` (기준선 1.388) | 1.241 | 1.609 | 1.651 | 1.229 | — |

- **필터가 없는 URL은 기준선과 같다.** browse 1.132 → 1.137, review 1.106 → 1.093. 배포로 인한 회귀는 없다.
- **필터 추가 비용:** zh·ja·ko·mixed는 +0.12–0.14s, review+zh는 +0.19s로 200ms 이하다. `lang=latin`은 5라운드 모두 1.52s 이상이었고 무필터 최대값(1.19s)보다 높았다. 반복적으로 +0.42s가 추가된다.
- 응답 크기는 원인이 아니다. `/artifacts` 212,827B, `lang=latin` 212,315B로 거의 같다(FACT).
- Phase 45에서 추정한 "필터 +0–72ms"는 로컬 PG17 값이다. 운영에서는 같은 쿼리 차이가 약 5–6배로 커진다(로컬 +75ms → 운영 +0.42s). Neon compute와 로컬 CPU의 차이로 본다(INFERENCE, 운영 실행계획은 볼 수 없다).

### 원인 분석 (로컬, FACT)

- 방법: 운영 목록 19,113건(Phase 41 수집, 저장소 583개)을 `agentdock_test`에 잠시 적재했다. 측정이 끝난 뒤 지웠고(`left after cleanup 0`, package 0행), 이 데이터는 운영 DB나 저장소로 들어가지 않았다.
- 측정 결과 (3회 반복, ms):

| 경우 | rows 쿼리 | count 쿼리 |
|---|---|---|
| browse | 90 | 85 |
| zh | 85 | 84 |
| ja | 84 | 82 |
| **latin** | **164** | **159** |
| review | 27 | 22 |
| review+zh | 84 | 82 |

- `EXPLAIN ANALYZE`(count)를 보면 비용은 두 가지다.
  1. **등재 여부 검사**(`NOT_LISTED_BECAUSE`의 상관 subquery): 살아남은 행마다 계산한다. 19,113행이면 약 95ms, 609행이면 약 4ms다.
  2. **언어 분류**(`SUMMARY_LANGUAGE`): 필터가 있으면 package scan 단계에서 모든 행에 계산한다. 19,113행에 약 84ms다.
- 경우별로 보면 다음과 같다.
  - browse는 1만 낸다.
  - zh는 2를 내지만 행이 97% 걸러지므로 1이 거의 사라진다. 그래서 browse와 비슷하다.
  - latin은 89%가 살아남는다. 1과 2를 모두 내서 약 2배가 된다.
- 즉 원인은 `language.ts`의 `ponytail:` 주석에 적어 둔 상한("computed per row at query time, so a language filter scans every listed row")이다. 운영에서 사용자 기준 200ms를 넘었다.

### 개선 후보 (구현하지 않음, 승인 대상)

| 후보 | 효과 (추정) | 비용·위험 |
|---|---|---|
| A. `package.summary_language` STORED generated column (+ 필요하면 index) | 분류 84ms가 사라진다. latin ≈ browse, zh는 더 빨라진다 | migration이며 채워진 테이블을 rewrite한다. 운영 DB 변경이므로 승인이 필요하다. 이번 Phase 범위 밖이다 |
| B. 필터가 있을 때 count를 생략하거나 추정치로 대체 | count 한 번분(운영 약 0.2s) | "Every cap says what it dropped"와 정확한 paginator 원칙에 어긋난다. 권하지 않는다 |
| C. 유지 | — | latin 1.56s. 기능은 정상이다. latin 필터는 "영어가 아님을 말하지 않는" 보조 필터다 |

- **권고:** 이번에는 C로 두고, A를 다음 migration 묶음 후보로 올린다. 판정 근거는 반복된 +0.42s(5/5)다.
- `language.ts` 주석의 재검토 기준("filtered listing passes 200 ms")은 로컬 ms 기준이었다. 운영 측정값을 주석에 남길지는 A를 진행할 때 함께 정한다.

## 8. Sync Guard

| 항목 | 값 | 구분 |
|---|---|---|
| guard 위치 | `scripts/corpus-sync.mjs:151-152` → `assertSchemaIsolation`(`src/db/client.ts:67`). `current_user ≠ agentdock_app`이면 "Refusing to start: connected as a role other than "agentdock_app"…"로 중단, search_path가 정확히 `agentdock`(또는 `_test`)이 아니어도 중단 | FACT (코드) |
| guard 포함 코드 배포 | `5bf8450` Deploy 40254796355 (10/26 01:35Z) 이후 | FACT |
| guard 포함 코드로 실행된 예약 Sync | **0회** (05:55:26Z 기준, 마지막 Sync는 40229151309, 10/25 20:05Z, `0f2cb82`) | FACT |
| Guard Outcome | 관찰 없음 | PENDING |
| 다음 Sync 예상 결과 | guard에서 exit 1. 수집과 쓰기는 0이다 | INFERENCE (§9 근거) |
| 다음 예약 slot | cron `0 6,18 * * *`의 06:00 slot. 최근 06:00 slot 7회는 3.9–5.6시간 늦게(09:56–11:37Z) 시작됐다. 09:50–11:40Z 사이로 예상한다 | INFERENCE |

## 9. Actions DB Role

판정은 실제 연결 검사 결과(`ops:status`의 `readOnlyChecks`)로 한다. secret 갱신 시각은 근거로 쓰지 않는다.

| 검사 | 최근 4회(10/24 09:56Z – 10/25 20:26Z) | 구분 |
|---|---|---|
| pool 연결 열기 | PASS(FAIL 줄 없음. `ops.mjs`는 FAIL만 출력한다) | FACT |
| `connected as agentdock_app` | **FAIL ×4** | FACT |
| search_path is exactly agentdock | FAIL ×4 | FACT |
| default_transaction_read_only / transaction_read_only | FAIL ×4 | FACT |
| statement_timeout = 30000 ms | FAIL ×4 | FACT |
| 쓰기 거부(25006) | FAIL ×4 ("got accepted, rolled back") | FACT |
| direct endpoint | Sync 경로에서는 관찰하지 않았다. Deploy의 `migrate --production` plan이 매 배포에서 통과하므로 direct이고 fingerprint가 일치한다 | INFERENCE |

- **secret 시각:** `DATABASE_URL` 2026-10-22T05:28:37Z, `AGENTDOCK_GITHUB_TOKEN` 2026-10-19T05:54:55Z (`gh secret list`, 값은 조회하지 않았다). 위 4회는 모두 이 시각 이후 실행됐다. 따라서 10/22 갱신 뒤에도 role은 `agentdock_app`이 아니다(FACT).
- **FAIL 6개를 나눠 보면 다음과 같다(INFERENCE).**
  - read-only, statement_timeout, 쓰기 거부, search_path의 4개는 연결 options가 서버에 전달되지 않을 때 함께 실패한다. 이 문제는 `e4c2773`("preserve database session options")에서 고쳤다. 4회 모두 그 이전 코드(`0f2cb82`)로 돌았으므로, 다음 run에서 이 4개가 PASS로 바뀔 수 있다.
  - **role FAIL은 options와 무관하다.** URL의 user가 정한다. 이것만으로도 guard는 거부한다.
- 결론: Actions DB 연결은 비정상이다. 운영자 조치가 필요하다.

### 운영자 절차 (승인 대상, Claude는 실행하지 않음)

- 실행 위치: `~/workspace_auto/agentdock` (`8f4d96f`, clean tree)
- 값은 화면, 로그, 보고서, 셸 history에 남기지 않는다.
- 상세 명령은 Phase 35–37 보고서 §10–§12에 있고, 아래는 그 순서를 사용자가 요청한 9단계에 맞춘 것이다.

1. **새 direct URL 로컬 검증**
   - Neon console에서 `agentdock_app` role의 **direct** 연결 문자열(host에 `-pooler` 없음)을 준비한다.
   - `read -rs "DATABASE_URL?agentdock_app direct URL: "; echo; export DATABASE_URL DATABASE_SCHEMA=agentdock`
   - role이 없으면 중단한다. bootstrap(`VERCEL_DEPLOY.md` step 2)은 별도 승인 대상이다.
2. **Role·schema 검사**
   - `bun --no-env-file scripts/ops.mjs preflight`
   - 기대: 7줄 모두 PASS(`connected as agentdock_app`, `search_path is exactly agentdock` 포함)
3. **읽기 전용 권한 검사**
   - 같은 preflight의 `default_transaction_read_only`, `transaction_read_only`, `statement_timeout`, 쓰기 거부(25006) 항목이다.
   - role PASS인데 이것들만 FAIL이면 Sync는 동작하지만 health summary가 "Not available"이 된다. Phase 35–37 §12 E와 §20을 따른다.
4. **테이블 소유권 확인**
   - Phase 35–37 §11 (b)의 읽기 전용 query를 실행한다.
   - 기대: `{"role_ok":true,"tables":11,"not_owned":0,"no_dml":0}`
   - `not_owned>0`이면 교체하지 않는다. 10/22 이후 migration이 다른 role로 실행됐기 때문에 이 확인이 필요하다. `ALTER … OWNER TO`는 운영 DB 변경이라 별도 승인 대상이다.
5. **Migration plan 확인**
   - `AGENTDOCK_TARGET_FINGERPRINT=<6의 값> bun --no-env-file scripts/migrate.mjs --plan --production --require-current`
   - 기대: UP_TO_DATE. 이 단계는 아무것도 적용하지 않는다.
6. **새 fingerprint 계산**
   - `bun --no-env-file scripts/migrate.mjs --fingerprint` → 16 hex. 5보다 먼저 실행한다.
7. **변경 순서**
   - (a) 지금 쓰는 URL과 fingerprint를 별도 보관소에 남긴다. GitHub secret은 다시 읽을 수 없다.
   - (b) GitHub → Settings → Secrets and variables에서 repository secret `DATABASE_URL`과 production environment 변수 `AGENTDOCK_TARGET_FINGERPRINT`를 **연달아** 바꾼다. 하나만 바꾸면 다음 Deploy의 plan이 BLOCKED된다.
   - (c) `unset DATABASE_URL DATABASE_SCHEMA`
   - 다음 예약 Sync(예상 09:50–11:40Z) 전에 끝내면 guard FAILED run이 생기지 않는다.
8. **변경 후 검증**
   - `gh secret list`의 `DATABASE_URL` 갱신 시각이 바뀌었는지 본다(시각만으로 판정하지 않는다).
   - 다음 예약 Sync에서 다음을 확인한다.
     - guard 오류 줄이 없다.
     - health `ops:` FAIL 줄이 0이다(7/7).
     - Status가 `COMPLETED` 또는 `PARTIAL_*`이다.
     - `storage_failed`가 0이다.
   - 다음 코드 push 때 Deploy의 plan·migrate·smoke가 success인지 본다.
9. **실패 시 rollback** (Phase 35–37 §12)
   - 인증 실패(28P01/28000)나 권한·소유권 문제(42501, plan `history:`): 보관한 이전 URL과 이전 fingerprint로 되돌린다.
   - fingerprint 불일치(plan BLOCKED): 변수만 다시 계산해 넣는다.
   - guard 실패: 코드를 되돌리지 않는다. 되돌리면 잘못된 role로 다시 수집된다. secret 반영 여부를 확인한다.
   - 이전 URL로 돌아가면 Deploy는 살아나지만 Sync는 guard 때문에 계속 거부된다.

## 10. Health Summary

| run | 시작–종료 | SHA | ops 결과 | step 표시 |
|---|---|---|---|---|
| 40083909354 | 10/24 09:56–10:21Z | `0f2cb82` | 6 FAIL, "the connection is not confirmed read-only; nothing was read." | success (`continue-on-error`) |
| 40127517179 | 10/24 19:55–20:16Z | `0f2cb82` | 6 FAIL | success |
| 40184235414 | 10/25 10:18–10:42Z | `0f2cb82` | 6 FAIL | success |
| 40229151309 | 10/25 20:05–20:26Z | `0f2cb82` | 6 FAIL | success |

- guard 포함 코드로 실행된 health summary는 0회다(PENDING).
- step이 success로 표시되는 것은 sync.yml:86-88의 `continue-on-error: true` 때문이다. 결과는 로그의 `ops: FAIL` 줄로 판정한다.

## 11. 최근 Sync 실행 결과

모두 guard 이전 코드(`0f2cb82`)이고 role이 맞지 않는 상태에서 실행됐다. Guard Outcome은 "해당 없음"이다.

| 항목 | 40083909354 | 40127517179 | 40184235414 | 40229151309 |
|---|---|---|---|---|
| Status | PARTIAL_CAP | COMPLETED | COMPLETED | COMPLETED |
| processed / ingested | 200 / 94 | 200 / 87 | 200 / 100 | 200 / 79 |
| unchanged / no artifacts | 63 / 16 | 67 / 18 | 58 / 12 | 74 / 15 |
| below 50 stars / archived / fork | 26 / 0 / 0 | 26 / 0 / 2 | 29 / 0 / 0 | 30 / 2 / 0 |
| storage_failed (Could not be read) / Other failures | 0 / 1 | 0 / 0 | 0 / 1 | 0 / 0 |
| delisted | 0 | 0 | 1 | 0 |
| registry pages / seeds / retried | 40 / 854 / 0 | 40 / 673 / 0 | 40 / 761 / 0 | 40 / 709 / 0 |
| refresh considered / enqueued / **not-reached** | 100 / 100 / **270** | 100 / 100 / **171** | 100 / 100 / **382** | 100 / 100 / **282** |
| core left / spent | 4719 / 측정 불가 | 4809 / 측정 불가 | 4591 / 406 | 4593 / 406 |
| Duration (summary) | 1483s | 1222s | 1430s | 1222s |
| stage refresh / drain | 52s / 1081s | 64s / 911s | 61s / 985s | 63s / 917s |
| drain per job p50 / p95 / max | 2.6 / 17.0 / 61.4s | 2.8 / 9.7 / 42.5s | 3.9 / 11.4 / 45.3s | 2.8 / 9.4 / 42.9s |
| Jobs still queued | 1 | 0 | 0 | 0 |
| health | 6 FAIL | 6 FAIL | 6 FAIL | 6 FAIL |

- 원시 로그는 `gh api repos/gwanghun-choi/agentdock/actions/jobs/<jobId>/logs`로 받았다(§19).
- 신규 artifact 수는 summary가 따로 세지 않는다. "ingested (new or changed)"가 저장소 단위 지표다.

## 12. Job 771·978

| 항목 | 상태 | 구분 |
|---|---|---|
| `/jobs/771`, `/jobs/978` | 200, "could not store the result", failed (05:52Z) | FACT |
| `/r/elementalsouls/claude-bughunter`, `/r/maxritter/claude-codepro` | 404 (05:52Z) | FACT |
| parser 수정 배포 | NUL 정제(`5bf8450`)와 session options·파싱 후 NUL 정제(`e4c2773`)가 배포됐고, 현재 `8f4d96f`에도 포함돼 있다 | FACT |
| 재수집 가능 여부 | 코드 기준으로는 가능하다. 다만 Sync가 guard를 통과해야 drain이 job을 처리한다 | INFERENCE |
| 중복 방지 | `enqueueJob`이 같은 target의 active job 중복과 queue 상한을 검사한다. 이 경로는 scheduler와 운영자 스크립트 공용이고 public caller는 없다 | FACT (코드, Phase 35–37 §14) |
| identity 유지 | 실패한 저장은 transaction rollback이라 repository 행이 없다. 성공하면 `github_node_id` 기준으로 새 행 1개가 생긴다 | INFERENCE (운영 미검증) |
| 재enqueue | **권하지 않는다(지금).** guard가 정상화되지 않았으므로 queued로 남을 뿐이다. 이번 작업에서 실행하지 않았다 | 판단 |

- **Runbook(guard PASS를 확인한 뒤):** Phase 35–37 §14의 절차를 그대로 쓴다. 다음 run 뒤에 `/jobs/<새 id>`가 succeeded이고, 위 `/r/…` 두 페이지가 200이고, 로그에 `storage_failed`가 없는지 확인한다.

## 13. Refresh 처리량

조건("guard를 통과한 정상 Sync 2회 이상")을 충족하지 못했다. 정상 Sync는 0회다. 아래는 guard 이전 4회(role 불일치)를 참고로 정리한 값이다(FACT).

| 지표 | 4회 범위 | 참고 |
|---|---|---|
| Drain 시간 | 911–1081s | cap 200 jobs, 4회 모두 cap 또는 빈 queue에서 정지 |
| Refresh stage | 52–64s | enqueue 단계 시간(considered 100) |
| API quota | core 406/5000 사용(측정 가능한 2회) | 여유가 크다 |
| not-reached | 270 → 171 → 382 → 282 | 단조 증가가 아니다. 10/24 09:56Z→10/25 20:05Z 순증은 +12다 |
| 전체 실행 시간 | 1222–1483s | 마감 2,100s 대비 여유 617–878s |
| 실패율 | Other failures 0–1/200, rate limit 0, storage_failed 0 | — |

- Phase 45–47에서 추정한 "+112/day"는 10/22→10/25 두 점(43→282)으로 계산한 값이다. 4회를 보면 171–382 사이에서 오르내린다. 추세는 아직 판단할 수 없다(INFERENCE).

## 14. Cap 150 판단

- **cap 100 유지(판정).** 근거: guard PASS인 정상 Sync가 0회다(조건 2회 미충족).
- 참고 계산(INFERENCE): 가장 긴 run(1483s)에서 refresh 50건이 늘어 drain이 비례해 늘어난다고 하면 다음과 같다.
  - 50 × p95 17s = +850s로 보면 2,333s다. 마감 2,100s를 넘을 수 있다.
  - p50(2.6–3.9s) 기준이면 +130–195s로 1,613–1,678s다.
  - 어느 쪽이 맞는지는 guard 이후 정상 run의 drain 분포를 보고 다시 계산한다.
- 상한 변경은 승인 후 별도 commit으로 한다. 이번에는 바꾸지 않았다.

## 15. Stop Hook 진단

| 항목 | 결과 | 구분 |
|---|---|---|
| 오류가 난 hook | `~/.claude/skills/gstack/hosts/claude/hooks/timeline-stop-hook` (Stop). exit 126, 18–19ms, stderr "env: unknown error: execvp failed" | FACT (이 세션 transcript `hook_non_blocking_error`, 04:15:57Z·05:39:32Z) |
| 실행 명령 | settings.json Stop 4개: gsd-context-monitor(node 절대경로), **timeline-stop-hook**, obsidian `process_turn.py`(`/usr/bin/python3.14` 절대경로), orca hook(`/bin/sh`) | FACT |
| 실행 파일·권한 | `timeline-stop-hook` 존재, `-rwxrwxr-x`, shebang `#!/usr/bin/env bash`. `/usr/bin/bash`, `~/.bun/bin/bun` 존재 | FACT |
| 재현 | 현재 셸 PATH로 `echo '{}' \| timeline-stop-hook` → "env: unknown error: execvp failed" rc=126. `PATH=/usr/bin:/bin`으로는 shebang 단계를 통과한다 | FACT |
| 원인 | PATH에 `/tmp/.mount_orca-loIPonl/usr/sbin`이 `/usr/bin`보다 앞에 있다. 이 경로는 끊긴 Orca AppImage FUSE 마운트라 stat이 **ENOTCONN**(Transport endpoint is not connected)을 낸다. `execvp`는 ENOENT가 아닌 오류를 만나면 다음 PATH 항목으로 넘어가지 않고 실패한다 | FACT |
| 확인 | `PATH=<그 경로>:/usr/bin env bash` → uutils env 0.10.0 "unknown error: execvp failed" 126, GNU env(`gnuenv`) "Transport endpoint is not connected" 126, `/bin/sh -c bash`는 정상. env 구현체가 아니라 PATH 항목이 원인이다 | FACT |
| 시작 시점 | 이 Claude 프로세스(10/26 02:39Z 시작)의 환경에 그 PATH가 들어 있다. 02:57Z turn은 성공했고 04:15Z부터 실패했다. 그 사이에 해당 AppImage 인스턴스가 종료돼 마운트가 끊긴 것으로 본다 | FACT(시각) / INFERENCE(종료 시점) |
| 영향 범위 | `#!/usr/bin/env`로 시작하는 hook만 실패한다. 이번 설정에서는 timeline-stop-hook 하나다. 이 hook은 gstack timeline의 짝 없는 "started" 항목을 닫는 보정용이고 실패해도 세션을 막지 않는다. `~/.gstack/projects/`가 없어 보정할 timeline도 없다 | FACT |
| Obsidian 기록 | 오류가 난 두 turn에서도 `process_turn.py`가 실행됐다(88ms·75ms, 오류 없음). work-log `2026-10-26.md`에 `13:15 Phase 42–44`, `14:39 Phase 45–47` 항목이 있다. Phase 45–47의 Knowledge 키 8개(`multilingual-eval-fixture`, `cjk-substring-search`, `eval-tie-order-artifact`, `playwright-mcp-writes-repo`, `secret-swap-urgent`, `phase41-after-deploy`, `reenqueue-771-978`, `after-next-sync-0600`)가 모두 해당 문서에 있다 | FACT |
| 누락된 Knowledge | **없다** | FACT |
| 다른 프로젝트 | DocuAnalyzer 작업공간 transcript 5개에도 같은 문자열이 있다. 이번 범위 밖이라 조사하지 않았다 | FACT(존재) / NOT RUN |

- **조치 후보(사용자 판단, 실행하지 않음):**
  - (a) Claude Code를 새 터미널에서 다시 시작한다. 끊긴 마운트가 없는 PATH를 받는다.
  - (b) 끊긴 마운트를 정리한다(`fusermount -u /tmp/.mount_orca-loIPonl`). 그러면 ENOENT가 되어 execvp가 다음 항목으로 넘어간다.
  - hook 설정과 파일은 바꾸지 않았다.

## 16. 테스트 및 변경 코드

- **코드 변경: 없다.** 보고서와 스크린샷만 새로 만들었다.
- 다시 실행한 것 (FACT, `8f4d96f`):

| 항목 | 결과 |
|---|---|
| `bun run search:eval` | 54 passed (54). 사례별 출력이 Phase 45와 diff 0 |
| `bun run search:eval:multilingual` | 15 passed (15) |
| test DB 잔여 행 | 0 |

- 실행하지 않은 것 (NOT RUN, 코드 변경이 없어서): check:boundaries, lint, typecheck, test, build, E2E. 같은 SHA에서 CI 40275711719의 check·database·e2e job이 success다.
- 신규 결함: 없다. `lang=latin`의 지연은 기존 `ponytail:` 상한이 운영에서 드러난 것이다. 고치려면 migration이 필요해 이번 범위 밖이다.

## 17. 운영 승인 사항

| # | 항목 | 주체 | 상태 |
|---|---|---|---|
| 1 | secret `DATABASE_URL`을 `agentdock_app` direct URL로, 변수 `AGENTDOCK_TARGET_FINGERPRINT`를 새 값으로 교체(§9 절차 1–9) | 운영자 | **승인 대기** |
| 2 | (조건부) `not_owned>0`이면 소유권 이전 | 운영자 | 1의 4단계 결과에 따라 결정 |
| 3 | guard PASS 확인 후 Job 771·978 재enqueue | 운영자 | 1 이후 |
| 4 | `summary_language` STORED generated column migration(§7 후보 A) | 사용자 | 검토 대기 |
| 5 | refresh cap 100→150 | 사용자 | 정상 Sync 2회 뒤 평가 |
| 6 | Stop hook 환경 정리(§15 a 또는 b) | 사용자 | 선택 |

## 18. PENDING / NOT RUN

| 항목 | 상태 | 해소 조건 |
|---|---|---|
| guard 포함 코드의 첫 예약 Sync 결과 | PENDING | 06:00 slot(예상 09:50–11:40Z) |
| health 7/7 | PENDING | secret 교체 후 Sync |
| Job 771·978 복구 | PENDING | 교체 → 재enqueue → Sync |
| cap 150 평가 | PENDING | 정상 Sync 2회 |
| 운영 실행계획(EXPLAIN) | NOT RUN | 운영 DB 접속 금지. 로컬 계획으로 대신했다 |
| 전체 테스트 재실행 | NOT RUN | 코드 변경이 없다 |
| DocuAnalyzer hook 오류 | NOT RUN | 범위 밖 |

## 19. Evidence ID

- Actions:
  - CI 40275711719
  - Deploy 40275836492 (deployment 7324983054)
  - 이전 Deploy 40256758887 (`e4c2773`), 40254796355 (`5bf8450`)
- Sync run / job:
  - 40083909354 / 120842835162
  - 40127517179 / 120972006489
  - 40184235414 / 121141517511
  - 40229151309 / 121276928619
- secret 메타데이터: `DATABASE_URL` updated 2026-10-22T05:28:37Z (값은 조회하지 않았다)
- Production header: `x-agentdock-commit: 8f4d96f57589b12a77592455070d49c0ca5cc691` (05:46:02Z)
- 원시 자료: scratchpad `/tmp/claude-1000/-home-ChoiGwanghun-workspace-auto-agentdock/5f3bf29d-8c4e-417d-a177-083dcd61f8ca/scratchpad/p48/` 아래 다음 파일. 임시 경로라 보존하려면 옮겨야 한다.
  - `probe.json`, `compare.txt`: 검색·필터
  - `ui.json`, `shots/`: UI 26장
  - `bench-after.txt`: 성능
  - `ml-eval.txt`, `eval54.txt`: 평가
  - `timing.ts`, `explain.ts`: 로컬 원인 분석
  - `run-<id>.log`: Sync 로그
- 저장소: `docs/images/phase48/*.png` (8장)
- Stop hook: 이 세션 transcript의 `hook_non_blocking_error` 2건(2026-10-26T04:15:57Z, 05:39:32Z)

## 20. Git Status

```
?? docs/analysis/agentdock-phase48-50-production-stabilization.md
?? docs/images/phase48/
```

권장 commit (사용자가 실행):

```bash
git add docs/analysis/agentdock-phase48-50-production-stabilization.md docs/images/phase48
git commit -m "docs(analysis): add Phase 48-50 production stabilization report" -m "Verify the multilingual search release in production: fixture order reproduced for 11 of 14 queries, the other 3 differ by one tied pair each with unchanged metrics; language filters, pagination and 320/1280px UI checked.

Measure filter latency: lang=latin adds 0.42s at p50 from per-row classification; a stored generated column is the candidate and needs an approved migration.

Record that four scheduled syncs connected as a role other than agentdock_app and that no guarded sync has run yet; keep refresh cap at 100.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## 21. 다음 작업

1. **(승인 대기, 가장 급함)** 다음 예약 Sync 전에 secret과 fingerprint를 교체한다(§9).
2. 교체 후 첫 예약 Sync에서 guard 통과, health 7/7, Status, storage_failed 0을 확인한다.
3. Job 771·978을 재enqueue하고(Phase 35–37 §14), 다음 run에서 `/r/…` 200을 확인한다.
4. 정상 Sync 2회의 drain 분포로 cap 150을 다시 계산한다(§14). 변경하면 별도 commit으로 한다.
5. `summary_language` generated column migration 검토(§7 A)와, fixture 동점 3쌍을 운영 순서로 맞추는 작업은 다음 migration·평가셋 갱신 때 함께 한다.
6. Stop hook 환경을 정리한다(§15).
