# AgentDock Phase 45–47 — Release Finalization · Production Verification · Sync Recovery

- 작성: 2026-10-26 (UTC 05:20–05:40 측정)
- 기준 HEAD: `e4c2773` (develop = origin/develop = Production)
- 표기: **FACT**(직접 관찰) / **INFERENCE**(관찰에서 추론) / **PENDING**(조건 충족 후 확인) / **NOT RUN**(이번에 하지 않음)

이번 작업에서 운영에 한 일은 다음뿐이다.
- 읽기 전용 HTTP GET 5회: 홈 헤더, `/jobs/771`, `/jobs/978`, `/r/…` 2개
- Actions run·job 로그와 secret 갱신 시각 조회

운영 DB 접속, secret 값 조회·변경, Sync 실행, 재enqueue, commit·push·deploy는 하지 않았다.

## 1. 핵심 결론

1. **Phase 41–44는 미배포다(FACT).**
   - Production `x-agentdock-commit`은 `e4c277323030…`이다.
   - 그래서 Phase 46의 운영 검증(필터 지연, 운영 UI, 운영 CJK 품질)은 모두 **PENDING**이다.
2. **코드는 배포할 수 있는 상태다.**
   - 최종 리뷰 10개 항목에서 결함은 주석 수치 1건뿐이었다(§3).
   - 검증은 모두 통과했다: boundaries, lint, typecheck, test 1554/2 skip, build, E2E 28, search:eval 54/54, multilingual eval 15/15.
3. **다국어 평가셋을 저장소에 영속화했다(§4).**
   - 구성: 운영 등재 19,113건 중 128행 fixture + 14개 검색어·정답표 + 지표 계산.
   - 변경 전 코드(`e4c2773`)에 이 fixture를 넣어 돌리면, **14개 검색어 모두 운영의 상위 10개를 순서까지 그대로 재현**한다.
   - 따라서 이 fixture는 "운영 기준선"으로 쓸 수 있다.
4. **Phase 42–44 보고서의 MRR 수치를 정정한다.**
   - 이전 값: 0.833 → 0.833.
   - 이 값은 로컬에 적재할 때 생긴 동점 순서에서 나왔다.
   - 운영의 동점 순서로 다시 재면 **MRR 0.750 → 0.750(불변), NDCG@10 0.481 → 0.704, Recall@10 0.417 → 0.717**이다.
5. **Sync guard는 다음 예약 Sync에서 FAIL할 것으로 판단한다(INFERENCE, 근거는 FACT).**
   - 마지막 예약 Sync 40229151309(10/25 20:05Z)의 health 단계가 **같은 secret으로 `connected as agentdock_app` FAIL**을 기록했다(FACT).
   - secret 갱신 시각 `2026-10-22T05:28:37Z`는 그 run보다 앞서며, 이후 바뀌지 않았다(FACT).
   - guard(`5bf8450`)가 들어간 코드로는 아직 한 번도 실행되지 않았다.
6. **Job 771·978은 미복구 상태다(FACT).**
   - 두 job 모두 "could not store the result"이고, 저장소 페이지는 404다.
   - parser 수정은 배포됐다.
   - 재enqueue는 secret 교체 후에 해야 의미가 있다.
7. **Refresh cap 150 변경 조건을 충족하지 못했다.**
   - guard를 통과한 정상 Sync가 0회다.
   - cap 100을 유지한다.

## 2. Git/Production SHA

| 항목 | 값 | 구분 |
|---|---|---|
| 로컬 HEAD | `e4c2773` (develop) | FACT |
| origin/develop | `e4c2773` | FACT |
| Production `x-agentdock-commit` | `e4c277323030130fb86792ee66684c778e555a64` (05:2xZ) | FACT |
| 마지막 Deploy / CI | 40256758887 / 40256640152 (`e4c2773`, success) | FACT |
| Phase 41–44 변경 | working tree에만 있다(미커밋) | FACT |

## 3. Phase 41–44 최종 리뷰

| # | 항목 | 결과 |
|---|---|---|
| 1 | Git 변경 파일 | 수정 13개, 신규 9개(§18). 전부 이번 작업 범위 안이다. |
| 2 | 언어 필터 SQL | rows와 count가 같은 `searchWhere` 하나로 `inArray(SUMMARY_LANGUAGE, languages)`를 쓴다. pagination의 마지막 페이지가 맞는다(로컬 `lang=zh` 609건/25쪽, `lang=latin` 17,082건/684쪽). |
| 3 | CJK substring | CJK 문자가 있는 plain 검색어에서만 동작한다. 영어 검색어 4개는 결과·순서가 그대로다(§5). `contains`는 대소문자 있는 단어에 ILIKE, CJK에 LIKE, 3자 미만에 strpos를 쓴다. |
| 4 | 기존 순위 회귀 | `search:eval` 54/54. 사례별 출력이 Phase 41·43과 diff 0이다. |
| 5 | URL·pagination | 파라미터 순서는 q, type, lang, cap, sort, page로 고정이다. `lang`이 있는 pager 링크는 `/artifacts?lang=zh&page=2`이고, 칩을 누르면 page 1로 간다. 로컬 브라우저로 확인했다(§7). |
| 6 | 모바일 | 320px에서 가로 넘침 0px. 칩 줄은 기존 Type 줄과 같은 가로 스크롤 방식이다(§7). |
| 7 | 잘못된 `lang` | `?lang=xx`는 필터 없음과 같은 19,113건을 낸다. 배열이면 첫 값만 쓰고, 허용 목록 밖의 값은 버린다(`parseLanguageFilter`). `varied`가 true가 되는 것은 cap·sort와 같은 처리다. |
| 8 | SQL injection·escaping | 모든 값은 parameter다. `plainWords`는 `[\p{L}\p{N}]+`만 남기므로 LIKE 패턴에 `%`나 `_`가 들어갈 수 없다. 언어 값은 허용 목록으로 걸러진 뒤 `inArray`로 들어간다. 저장소명 ILIKE는 기존 `escapeLikeOperand`를 쓴다. |
| 9 | generic plan | Phase 43에서 측정했다. 2자 LIKE가 trgm index 전체를 훑던 문제(46ms)는 strpos(12ms)로 피했고, OR 안의 seq scan(45ms)은 InitPlan으로 피했다(17ms). 이번에 바뀐 SQL은 없다. |
| 10 | 불필요·중복 코드 | 지표 계산 `caseMetrics`가 두 평가셋에서 필요해 `searchMetrics.ts`로 옮겼다(복사 대신 이동). 그 밖에 삭제할 것은 없다. |

결함은 1건이었다. `search.ts`의 `cjkWords` 주석에 있던 "MRR unchanged at 0.83"을 운영 순서 기준 수치로 고쳤다(§1-4).

관찰한 것 1건(결함 아님): 320px에서 선택된 언어 칩이 칩 줄 오른쪽에 있으면 화면 밖에 있다. 대신 결과 위의 "Description: Chinese ×" 칩으로 적용 상태가 보인다. Type 줄도 이전부터 같은 방식이다.

## 4. 다국어 평가셋 영속화

### 판단

넣었다. 근거는 다음과 같다.
- 운영 데이터 전체를 복제하지 않아도 운영 결과를 재현할 수 있다.
- `ts_rank`와 trigram 유사도는 corpus 통계 없이 행마다 점수를 매긴다(PostgreSQL에 IDF가 없다).
- 그래서 "어느 검색어든 상위 25에 든 행 + 정답 행"만 있으면, 그 행들의 상대 순서는 전체 corpus와 같다.

### 구성

| 파일 | 내용 |
|---|---|
| `fixtures/multilingual-search.json` | 128행, 저장소 60개, 69KB. 행마다 `repo`, `type`, `path`, `name`, `summary`가 있다. search가 읽는 입력은 이 다섯 개뿐이다(`search_vector`에 본문이 없다). 원본은 2026-10-26 공개 목록 crawl이다. |
| `src/db/queries/search.multilingual.eval.test.ts` | 14개 검색어(언어 표시: en 4, zh 4, ja 3, ko 3)와 정답 identity(`<repository>/<source_path>`), 사례별 기준선, 평균 지표 하한 |
| `src/db/queries/searchMetrics.ts` | `caseMetrics`: 이진 relevance 기반 P@5, P@10, Recall@10, RR, NDCG@10. 기존 평가셋도 같은 함수를 쓴다. |
| `package.json` | `search:eval:multilingual` script. 기존 `search:eval`과 분리했다. |

- **Relevance 기준:** 2026-10-26에 이름과 설명만 보고 사람이 판정했다. 정답이 없는 4개 검색어(数学モデリング, 文書処理, 수학 모델링, 문서 처리)에는 정답을 만들지 않았다. 영어 4개는 판정 대상이 아니다. CJK 변경이 영어 결과를 건드리지 않는지 고정하는 용도다.
- **지표 정의:**
  - Recall@10 = 상위 10개 중 정답 수 / 전체 정답 수
  - RR = 1 / 첫 정답 순위
  - NDCG@10 = Σ 1/log2(i+2) / 이상적 DCG
  - 셋 다 판정된 6개 검색어의 평균이다.
- **동점 순서:** fixture에는 `updated_at`이 없다. 행 순서로 이를 대신하며, 그 순서는 운영 결과 목록(Phase 43 probe)에서 위상 정렬로 뽑았다. 제약 101개에 순환은 없었다. 모든 행을 한 문장으로 insert해 `updated_at`을 같게 만들면, 동점은 id(=fixture 순서)로 정렬된다.
- **격리:**
  - `agentdock_test`에만 쓴다(`github_node_id` 접두어 `ml-eval-`).
  - `afterAll`에서 항상 지운다. 실행 뒤 남은 행이 0건인지 psql로 확인했다.
  - 운영 DB에는 적재하지 않는다(테스트 DB allowlist가 막는다).

### 재현성 검증 (FACT)

| 검증 | 결과 |
|---|---|
| `e4c2773`의 search.ts + fixture vs 운영 `/artifacts?q=` (Phase 43 probe) | 14/14 검색어에서 상위 10개가 순서까지 같다. 상위 25개는 13/14가 같다(document processing의 운영 23위 행 1개가 crawl에 없었다). |
| 변경 전 FAIL | `e4c2773` worktree에서 2건 FAIL: `ko-document-processing`(total 7 > 기준 2×2), 평균 지표 하한 |
| 변경 후 PASS | 15/15 |

**한계(`ponytail:` 주석으로 남김):** 2026-10-26 상위 25로 고정된 corpus다. 이 128행 밖의 정답을 새로 찾게 되는 변경은 여기서 점수가 오르지 않는다. 그런 변경을 할 때는 재수집과 재판정이 필요하다. 절차는 Phase 41 crawl(`/artifacts?sort=name` 순차 GET) → 상위 25 합집합 → 운영 순서로 위상 정렬이다.

## 5. 검색 품질 검증

fixture 기준이며, 변경 전 수치는 운영에서 지금 보이는 것과 같다.

| 검색어 | 변경 전 total / 첫 정답 | 변경 후 total / 첫 정답 | R@10 전→후 |
|---|---|---|---|
| 数学建模 | 4 / 1 | 7 / 1 | 0.50 → 1.00 |
| 代码审查 | 3 / 2 | 6 / 2 | 0.40 → 1.00 |
| 文档处理 | 0 / – | 0 / – | 0 → 0 (유의어 한계) |
| 浏览器自动化 | 2 / 1 | 4 / 1 | 0.50 → 1.00 |
| コードレビュー | 1 / 1 | 3 / 1 | 0.10 → 0.30 (レビュアー 어형 한계) |
| 코드 리뷰 | 2 / 1 | 2 / 1 | 1.00 → 1.00 |
| 문서 처리 (정답 없음) | 7 | 2 | – |
| 영어 4개 | 21 / 25 / 25 / 25 (fixture 안) | 같음, 순서도 같음 | – |

| 평균 (판정 6개) | 변경 전 | 변경 후 |
|---|---|---|
| Recall@10 | 0.417 | 0.717 |
| MRR | 0.750 | 0.750 |
| NDCG@10 | 0.481 | 0.704 |
| CJK 결과 0건 비율 | 4/10 | 4/10 |

- 결과 0건 비율이 그대로인 이유: 0건인 4개 중 3개는 정답이 없는 검색어이고, 文档处理는 유의어 문제다.
- 검색 지연은 Phase 43의 19k 로컬 측정과 같다. 3자 이상은 변화가 없고, 2자는 +8–12ms다. fixture 128행에서의 지연은 의미가 없어 재지 않는다.
- 운영 CJK 품질: **PENDING**(배포 후 §6의 명령으로 측정).

## 6. 운영 언어 필터 성능

**PENDING**(미배포). 배포 전 기준선은 Phase 42에서 측정했다(10 URL × 5라운드).

| URL | total p50 |
|---|---|
| browse | 1.132s |
| review | 1.106s |
| math modeling | 1.388s |

- 필터 유무 차이는 ±0.04s다(지금 운영은 `lang`을 무시한다).
- 로컬 추정은 +0–72ms다. `review&lang=zh`는 23→81ms다.

### 배포 후 측정 명령

실행 위치는 아무 디렉터리나 괜찮다. 읽기 전용 GET만 보낸다.

```bash
base=https://agentdock-delta.vercel.app
curl -sI $base/ | grep -i x-agentdock-commit   # 새 commit SHA인지 먼저 확인
paths=("/artifacts" "/artifacts?lang=zh" "/artifacts?lang=latin" "/artifacts?lang=ja" "/artifacts?lang=ko" \
       "/artifacts?q=review" "/artifacts?q=review&lang=zh" "/artifacts?q=%E6%95%B0%E5%AD%A6%E5%BB%BA%E6%A8%A1")
for r in 1 2 3 4 5; do for p in "${paths[@]}"; do
  echo "r$r $p $(curl -sS -o /dev/null -w '%{http_code} %{time_starttransfer} %{time_total}' -A agentdock-readonly-bench "$base$p")"
  sleep 1
done; done | tee bench-after.txt
```

- **판정 기준:** 필터 URL의 total p50에서 무필터 p50을 뺀 값이 반복해서 200ms를 넘으면, 실행계획 분석을 별도 후속 작업으로 연다.
- 후보는 STORED generated column이다(`language.ts`의 `ponytail:`). migration이 필요하므로 승인 대상이다.

## 7. UI 검증

운영: **PENDING**.

로컬 production build(standalone)로 대신 확인했다(FACT).
- 데이터는 두 가지로 확인했다. ① E2E seed. ② 운영 등재 19,113건을 `agentdock_test`에 잠시 적재. ②는 확인 뒤 지웠다(`left after cleanup 0`).
- 320×1000과 1280×900에서 확인했다.

| 확인 | 320px | 1280px |
|---|---|---|
| HTTP status (9개 URL + 상세) | 전부 200 | 전부 200 |
| 가로 넘침 | 0px | 0px |
| Description 칩 `aria-current` | `Chinese` / `Japanese` / `Korean` / `Latin alphabet` / `Any language` 정상 | 같음 |
| 행 언어 표시·`lang` 속성 | `lang=zh` 목록 6/6행이 `lang="zh"`, `lang=latin` 목록은 `lang` 없음(의도된 것: 문서 기본 언어 `en`) | 같음 |
| 상세 페이지 원문 안내 | "Description language: Chinese. Shown as the author wrote it; AgentDock does not translate it, and a browser's translate feature can." + 설명 요소 `lang="zh"` | 같음 |
| HTML lang | `en`(문서), 설명 요소만 해당 언어 | 같음 |
| 적용 → 해제 | `?q=review` → `?q=review&lang=zh` → `?q=review`. 검색창 값 `review`가 계속 유지됨 | 같음 |
| Pagination | `lang=zh` 609건, `page=2`에서 "Showing 26–50", 링크에 `lang=zh` 유지 | 같음 |
| 잘못된 lang | `?lang=xx` → 19,113건, "Any language" 선택 상태 | 같음 |
| CJK 검색 | `数学建模` → 7건, 6/6행 `lang="zh"` | 같음 |

- 스크린샷 20장은 `/tmp/claude-1000/-home-ChoiGwanghun-workspace-auto-agentdock/5f3bf29d-8c4e-417d-a177-083dcd61f8ca/scratchpad/p45/shots2/`에 있다(`<이름>-<폭>.png`, 예: `review-zh-320.png`, `detail-zh-1280.png`). 임시 경로이므로 보존이 필요하면 옮겨야 한다.
- 원시 결과는 같은 폴더 위의 `ui2.json`에 있다.
- 콘솔 오류: `/favicon.ico` 404 1건. 로컬 standalone에서 났고, 이번 변경과 무관하다.

## 8. Sync Guard

| 검사 | 마지막 관찰 (run 40229151309, 10/25 20:26Z, `0f2cb82`, health 단계 `ops:status`) | 구분 |
|---|---|---|
| `agentdock_app` role | **FAIL** (`connected as agentdock_app`) | FACT |
| search_path = agentdock | **FAIL** | FACT |
| default_transaction_read_only / transaction_read_only | **FAIL** | FACT |
| statement_timeout 30000ms | **FAIL** | FACT |
| 쓰기 차단 | **FAIL** ("expected 25006, got accepted, rolled back") | FACT |
| direct endpoint | 관찰 없음(Deploy의 plan 검사 대상이다) | NOT RUN |
| Guard (corpus-sync의 `assertSchemaIsolation`) | 배포 후 실행 0회 | PENDING |

- **판단(INFERENCE):** secret이 그 run 뒤로 바뀌지 않았으므로, 다음 예약 Sync는 guard에서 `corpus-sync: Refusing to start: connected as a role other than "agentdock_app"…`로 exit 1할 것이다. 아무것도 읽거나 쓰지 않는다.
- **secret 시각과 연결 결과는 다르다.** secret은 10/22 05:28Z에 갱신됐지만, 그 뒤의 run 5개가 모두 같은 role FAIL을 냈다. 갱신은 있었으나 `agentdock_app`으로 바뀌지 않았다(FACT: 시각 / FACT: 연결 결과).
- **서비스 영향:**
  - 웹은 영향이 없다. Vercel은 별도 환경 변수를 쓰고, 웹 서버는 수집하지 않는다.
  - corpus 갱신(신규·refresh)은 멈춘다. sync.yml이 실패로 표시된다.
- **운영자 조치:** Phase 35–37 보고서 §11(검사 a·b·c) → §10의 step 4 → §12 rollback을 그대로 쓴다. 실행 위치는 `~/workspace_auto/agentdock`이고, 운영자가 자기 셸에서 `agentdock_app` direct URL을 환경 변수로 준비한 상태여야 한다. 값은 출력하지 않는다.
  ```bash
  bun --no-env-file scripts/ops.mjs preflight                        # (a) 7/7 PASS 기대
  bun --no-env-file scripts/migrate.mjs --fingerprint                # (c) 새 16 hex
  AGENTDOCK_TARGET_FINGERPRINT=<16hex> bun --no-env-file scripts/migrate.mjs --plan --production --require-current
  # 통과하면 GitHub Settings에서 secret DATABASE_URL과 변수 AGENTDOCK_TARGET_FINGERPRINT를 함께 교체
  ```
- **검증:**
  - 교체 뒤 첫 예약 Sync 로그에 guard 오류가 없어야 한다.
  - health 단계는 `ops: PASS connected as agentdock_app`를 포함해 7/7이어야 한다.
  - Status는 `COMPLETED` 또는 `PARTIAL_*`이어야 한다.
- **Rollback:** 보관해 둔 이전 URL과 이전 fingerprint로 되돌린다(§12 A/B). 이전 URL로 돌아가도 guard가 있으므로 Sync는 계속 거부된다. 따라서 rollback은 "Deploy를 살리는 것"이지 "Sync를 살리는 것"이 아니다.

## 9. Health Summary

| run | 시각 | SHA | ops 결과 |
|---|---|---|---|
| 40229151309 | 10/25 20:26Z | `0f2cb82` | 6 FAIL, "the connection is not confirmed read-only; nothing was read." (step은 `continue-on-error`라 success로 표시됨) |

guard가 있는 코드(`5bf8450` 이후)로 실행된 health summary는 0회다(PENDING).

## 10. 예약 Sync 결과

| 항목 | 40229151309 (마지막, guard 없는 코드) |
|---|---|
| SHA | `0f2cb82` |
| Guard Outcome | 해당 없음(guard 이전 코드) |
| DB Role | `agentdock_app` 아님(ops FAIL) |
| 신규·변경 ingest | 79 (processed 200, unchanged 74, no artifacts 15) |
| storage_failed / Other failures | 0 / 0 |
| Registry | pages=40, rows 4000, seeds 709, retried=0 |
| Refresh | considered 100, enqueued 100, **not-reached 282 (cap 100)** |
| GitHub core 사용 | 406 / 5000 |
| 총 실행 시간 | 1222s (job 20:05:57–20:26:36Z) |
| 최종 Outcome | Status COMPLETED, job success |

- guard가 포함된 코드가 배포된 뒤(01:31Z) 예약 Sync는 0회다(05:37Z 기준, FACT).
- 06:00 slot은 지금까지의 지연 패턴으로 보면 09:50–10:50Z 무렵 실행될 것이다(INFERENCE). 해당 run은 PENDING이다.

## 11. Job 771·978

| 항목 | 상태 | 구분 |
|---|---|---|
| `/jobs/771`, `/jobs/978` | 200, "could not store the result" | FACT (05:36Z) |
| `/r/elementalsouls/claude-bughunter`, `/r/maxritter/claude-codepro` | 404 | FACT |
| parser 수정(NUL 정제, session options) | `e4c2773`로 배포됨(Deploy 40256758887) | FACT |
| 재enqueue 필요 | 필요하다. terminal failed는 자동 재시도되지 않는다 | FACT(Phase 35–37 §14) |
| 지금 재enqueue | **하지 않는다.** secret이 바뀌기 전에는 Sync가 guard에서 멈추므로 queued 상태로 남을 뿐이다 | 판단 |
| 중복 방지·identity | `enqueueJob`의 target 중복 검사와 queue 상한을 거친다. 실패한 시도는 transaction rollback이라 repository 행이 없으므로, 성공하면 새 행 1개만 생긴다. 절차는 Phase 35–37 §14 runbook | INFERENCE(코드 기준, 운영 미검증) |

## 12. Refresh Capacity

- 조건은 "guard를 통과한 정상 Sync 2회"이며, 현재 **0회**다. 비교 평가는 **NOT RUN**이다.
- 참고 추세(guard 이전 코드, role 불일치 상태): 10/22 21시 not-reached 43 → 10/25 20시 282. backlog가 늘고 있다.
- 결론: **cap 100 유지.** 정상 Sync 2회 뒤 drain 시간, refresh 시간, core 사용량(지금 406/5000으로 여유 있음), not-reached 추이, 60분 timeout 대비 여유(1222s), 실패율을 비교하고, 150은 별도 변경으로 다룬다.

## 13. 변경 코드 (Phase 45)

| 파일 | 변경 |
|---|---|
| `fixtures/multilingual-search.json` | 신규. 다국어 평가 corpus 128행 |
| `src/db/queries/search.multilingual.eval.test.ts` | 신규. 다국어 평가셋, 기준선, 하한 |
| `src/db/queries/searchMetrics.ts` | 신규. `search.eval.test.ts`에 있던 `caseMetrics`를 이동 |
| `src/db/queries/search.eval.test.ts` | `caseMetrics` 정의를 지우고 import로 바꿈. 동작은 같다(54/54, 사례별 diff 0) |
| `src/db/queries/search.ts` | `cjkWords` 주석 수치만 정정 |
| `package.json` | `search:eval:multilingual` script 추가 |

검색 SQL, 순위, 스키마, migration은 바꾸지 않았다.

## 14. 테스트 결과

DB 테스트는 로컬 docker `agentdock-testdb`(`TEST_DATABASE_URL`, loopback 55432)에서 실행했다.

| 명령 | 결과 |
|---|---|
| `bun run check:boundaries` | OK (migration 11, source 103, UI 33 scanned) |
| `bun run lint` | Checked 236 files, no fixes |
| `bun run typecheck` | 통과 |
| `bun run test` | **82 files, 1554 passed, 2 skipped**. 이전 1539에서 다국어 평가 15건이 늘었다. skip 2건은 이전과 같다 |
| `bun run build` | 성공 (placeholder `DATABASE_URL`) |
| `bun run e2e:seed` + `bun run test:e2e` | **28 passed** |
| `bun run search:eval` | **54/54**. 사례별 출력이 Phase 43 최종과 diff 0. MRR 0.9273, NDCG 0.9068 |
| `bun run search:eval:multilingual` | **15/15**. R@10 0.717, MRR 0.750, NDCG 0.704, CJK 0건 0.4 |
| 변경 전 FAIL 확인 | `e4c2773` worktree에서 다국어 평가 2 FAIL / 13 PASS. worktree는 제거함 |
| 실행 뒤 test 스키마 잔여 | `ml-eval-`·`p43-` 행 0건, 그 뒤 `search:eval` 54/54 다시 확인 |

## 15. 운영 승인 항목

1. **긴급:** Actions secret `DATABASE_URL`을 `agentdock_app` direct URL로 교체하고 `AGENTDOCK_TARGET_FINGERPRINT`를 함께 갱신한다(§8).
2. Phase 41–45 commit, push, 배포(§19).
3. secret 교체 후 Job 771·978 재enqueue(Phase 35–37 §14).
4. (조건부) 필터 추가 지연이 반복해서 200ms를 넘으면 STORED generated column migration을 검토한다.
5. (조건부) 정상 Sync 2회 뒤 refresh cap 100→150.

## 16. PENDING / NOT RUN

| 항목 | 구분 | 조건 |
|---|---|---|
| 운영 언어 필터 지연·결과 수·정렬·pagination | PENDING | 배포 후 §6 명령 |
| 운영 CJK Recall/NDCG/MRR | PENDING | 배포 후. fixture 순위가 운영과 같은지 대조 |
| 운영 320px·데스크톱 UI | PENDING | 배포 후 |
| guard 첫 실행 결과 | PENDING | 다음 예약 Sync (06:00 slot, 예상 10Z 전후) |
| guard 이후 health summary | PENDING | 같음 |
| Job 771·978 복구 | PENDING | secret 교체 → 재enqueue |
| Refresh cap 평가 | NOT RUN | 정상 Sync 2회 |
| direct endpoint 검사 | NOT RUN | Deploy plan / 운영자 preflight |
| Neon `options` forward 여부 | PENDING | 운영자 preflight (Phase 35–37 §7) |

## 17. Evidence ID

- Production header: `x-agentdock-commit: e4c277323030130fb86792ee66684c778e555a64` (2026-10-26 05:2xZ)
- Deploy 40256758887, CI 40256640152 (`e4c2773`)
- Sync run 40229151309 / job 121276928619 (`0f2cb82`, 10/25 20:05:57–20:26:36Z). summary·ops 줄은 job log의 20:26:30–20:26:33Z
- 그 이전 Sync: 40184235414, 40127517179, 40083909354, 40021567316 (success), 39940525800 (failure)
- Secret metadata: `DATABASE_URL` 2026-10-22T05:28:37Z, `AGENTDOCK_GITHUB_TOKEN` 2026-10-19T05:54:55Z
- Job page 확인: 2026-10-26T05:36:51Z
- Phase 43 운영 probe 결과(동점 순서의 근거): scratchpad `p43/prod_results.json`

## 18. Git Status

```
 M e2e/journeys.spec.ts
 M package.json
 M src/app/artifacts/page.tsx
 M src/app/r/[owner]/[repo]/[...path]/page.tsx
 M src/components/PackageRows.tsx
 M src/components/searchState.test.ts
 M src/components/searchState.ts
 M src/db/queries/packages.ts
 M src/db/queries/search.eval.test.ts
 M src/db/queries/search.test.ts
 M src/db/queries/search.ts
 M src/log.test.ts
 M src/log.ts
?? docs/analysis/agentdock-phase41-multilingual-discovery.md
?? docs/analysis/agentdock-phase42-44-multilingual-production-verification.md
?? docs/analysis/agentdock-phase45-47-release-and-sync-recovery.md
?? fixtures/multilingual-search.json
?? src/components/language.ts
?? src/db/queries/language.test.ts
?? src/db/queries/language.ts
?? src/db/queries/search.multilingual.eval.test.ts
?? src/db/queries/searchMetrics.ts
```

## 19. 권장 commit

하나의 commit을 권한다. `search.ts`와 `search.test.ts`를 Phase 41과 43이 함께 바꿔서 나눌 수 없다.

실행 위치: `~/workspace_auto/agentdock`

```bash
git add e2e/journeys.spec.ts package.json \
  src/app/artifacts/page.tsx "src/app/r/[owner]/[repo]/[...path]/page.tsx" \
  src/components/PackageRows.tsx src/components/searchState.ts src/components/searchState.test.ts src/components/language.ts \
  src/db/queries/packages.ts src/db/queries/search.ts src/db/queries/search.test.ts \
  src/db/queries/search.eval.test.ts src/db/queries/search.multilingual.eval.test.ts src/db/queries/searchMetrics.ts \
  src/db/queries/language.ts src/db/queries/language.test.ts \
  src/log.ts src/log.test.ts fixtures/multilingual-search.json \
  docs/analysis/agentdock-phase41-multilingual-discovery.md \
  docs/analysis/agentdock-phase42-44-multilingual-production-verification.md \
  docs/analysis/agentdock-phase45-47-release-and-sync-recovery.md
git commit -m "feat(search): filter by description writing system and match CJK words inside descriptions" \
  -m "- Classify each description's writing system in SQL (latin, zh, ja, ko, mixed, other) and add the ?lang= filter; rows and count share one predicate.
- Show the description language on rows and the detail page, with a lang attribute and a no-translation note.
- Log the applied languages with each search.
- Match CJK query words as substrings of name and description through the existing trigram index (no migration); English queries and all 54 search.eval cases return identical rows in identical order.
- Review fixes: the middle dot no longer counts as kana; Tamil, Georgian and other scripts classify as other.
- Persist the multilingual evaluation set: 128 production rows that reproduce production's top 10 for all 14 queries, pinned at R@10 0.717, MRR 0.750, NDCG@10 0.704 (0.417 / 0.750 / 0.481 before).
- Move caseMetrics into searchMetrics.ts so both evaluation sets share it.
- e2e: the Description filter adds an 'Any language' chip with aria-current, so the journeys that counted current chips now expect it; behaviour for existing filters is unchanged.
- Reports for Phase 41, 42-44 and 45-47.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### push 전 체크리스트

1. `git status`에 의도하지 않은 파일이 없는지 본다(`.playwright-mcp/`, `test-results/`가 없어야 한다).
2. `bun run ci && bun run build`를 다시 실행한다. DB suite는 `TEST_DATABASE_URL`이 있을 때만 돈다.
3. secret 교체(§15-1)와 push 순서: Deploy의 plan은 secret과 fingerprint를 쌍으로 검사한다. 교체를 먼저 끝내면 원인 분리가 쉽다(Phase 35–37 §10). 이번 변경에는 migration이 없으므로 둘 중 어느 쪽을 먼저 해도 Deploy plan은 같은 판정을 낸다.
4. push 후 CI와 Deploy가 success인지, `x-agentdock-commit`이 새 SHA인지 확인한다.

### 배포 후 검증

- §6 측정 명령을 실행한다.
- §7 표의 항목을 운영 URL에서 다시 확인한다.
- `/artifacts?q=数学建模`가 7건이고 1위가 정답인지 본다(fixture 기준과 같아야 한다).
- Vercel 로그에 `prepared statement`/`26000` 오류가 없는지 본다.

## 20. 다음 작업

1. secret과 fingerprint 교체(운영자) → 첫 예약 Sync에서 guard PASS와 health 7/7 확인
2. 위 commit → push → 배포 → §6·§7 운영 검증, 기준선과 비교
3. Job 771·978 재enqueue → 다음 Sync에서 저장소 페이지 200 확인
4. 정상 Sync 2회 → refresh cap 평가(not-reached 282 추세 포함)
5. 4주 뒤: search 로그의 `languages`와 CJK 검색어를 집계하고, 다국어 평가셋에 검색어를 추가할지 판단
