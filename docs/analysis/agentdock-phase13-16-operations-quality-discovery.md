# AgentDock Phase 13–16 — Operations, Data Quality & Discovery

작성 2026-10-22 · 기준 HEAD `3a8a3c3` (develop) · 변경은 미커밋 상태

## 1. Executive Summary

Phase 13–16을 하나로 묶어 구현했다. migration, 새 dependency, 새 client component, 공개 API는 추가하지 않았다.

| Phase | 결과 |
|---|---|
| 13 Sync Monitoring | `bun run ops:status` 추가. 판정은 OK / PARTIAL / DEGRADED / UNKNOWN이다. Sync workflow의 run summary에 표를 붙인다. 연결은 read-only다. |
| 14 Data Quality | `bun run quality:check` 추가. 위반 규칙 7개와 관찰 13개로 구성되고, 위반이 있으면 exit 1이다. 자동 수정은 없다. 진단 과정에서 실제 버그 2건을 테스트로 찾아 고쳤다(§10). |
| 15 Related Discovery | 상세 페이지에 "같은 plugin의 다른 구성요소"와 "같은 저장소의 나머지"(최대 12개, 총수 표시)를 추가했다. 이름 검색 링크도 둔다. 목록 정책을 그대로 적용한다. |
| 16 Freshness | 정렬 `added`(최초 색인)와 `changed`(내용 변경 기록)를 추가했다. 정렬마다 날짜의 의미를 화면에 설명한다. Stars 기반 "인기" 목록은 AGENTS.md 불변식에 따라 **구현하지 않았다**. |

검증 결과:
- CI(boundaries, lint, typecheck, test): 1449 passed / 3 skipped
- E2E: 25/25
- search:eval: 사례별 결과까지 동일
- axe: 24개 조합에서 위반 0
- Docker·Vercel 빌드: 모두 PASS

판정은 **CONDITIONAL**이다. 남은 조건은 push 후 CI green과 운영 화면·첫 Sync summary 확인이다.

## 2. 프로젝트 현황

- Branch는 `develop`, HEAD는 `3a8a3c3`이다. 시작 시점 working tree는 clean이었다. Phase 12는 `c1f1969`로 이미 commit되어 있었다.
- Commit, Push, 배포, 운영 DB 접근, workflow 실행은 하지 않았다.

## 3. 통합 작업 목표

이미 저장된 기록(schema_meta, ingest_job, ingest_attempt, package, package_version)만으로 다음 세 가지를 개선한다.

1. 운영자가 sync 상태를 볼 수 있게 한다.
2. 데이터 정합성을 진단할 수 있게 한다.
3. 독자가 관련 artifact와 최신 항목을 탐색할 수 있게 한다.

이를 위해 새로운 저장 구조는 만들지 않는다.

## 4. 실제 Source Map

```
discovery (registry / seeds / links / topic search)   scripts/corpus-sync.mjs stage()
  → repo_seed (src/db/queries/seeds.ts)
  → ingest_job via enqueueJob (src/db/queries/jobs.ts)
  → drainQueue → runJob (src/ingest/worker.ts)
  → ingestRepository (src/ingest/pipeline.ts): tree + raw reads (src/github/scan.ts)
  → detect (src/detect/*), nesting → parent_path (src/detect/nesting.ts)
  → persistScan (src/ingest/persist.ts): repository, package upsert, package_version
    ON CONFLICT DO NOTHING, capability_finding, ingest_attempt
  → listing: NOT_LISTED_BECAUSE (src/db/queries/packages.ts)
  → search: searchWhere/orderFor (src/db/queries/search.ts)
  → detail: getPackageDetail / getRelatedPackages / getVersionHistory
```

Sync의 실행 결과는 다음 위치에 남는다.
- **stdout summary**: `summarize()`가 출력한다.
- **Actions annotation**: `::notice::` 등.
- **`schema_meta`의 `sync:last_attempt`·`sync:last_success`**: Phase 8에서 추가된 키다.

재시도 정책은 `src/ingest/retry.ts`의 `DISPOSITION` total record에 있다.

## 5. 데이터 모델

### 시간 필드의 의미

| 필드 | 의미 | 쓰는 곳 |
|---|---|---|
| `package.created_at` | AgentDock이 그 artifact 행을 처음 저장한 시점. upsert의 `set`에 없으므로 다시 쓰지 않는다. | 신규: `added` 정렬 |
| `package.updated_at` | 전체 read가 그 행을 쓴 시점(새 commit에서 읽을 때마다) | 기존 `recent` 정렬 |
| `package_version.ingested_at` | 해당 내용(hash)을 기록한 시점. 이전 hash로 돌아가면 그 행을 now로 옮긴다. | 신규: `changed` 정렬 |
| `repository.scanned_at` | 마지막으로 읽은 시점 | 상세의 "Last read" |
| `repository.checked_at` | 마지막으로 확인을 시도한 시점(성공 여부 무관) | refresh 순서 |
| `repository.pushed_at` | GitHub 기준 **저장소 전체**의 마지막 push | 상세의 "Last changed upstream" |
| `ingest_attempt.started_at/finished_at` | attempt 1회의 시작과 끝 | 신규: ops p50/p95 |

### 실패와 상태

- **`ingest_job.status`**: `queued`, `running`, `succeeded`, `failed` 중 하나다. 현재 상태만 담는다.
- **`ingest_attempt.outcome`**: 모든 claim마다 1행씩 append된다.
- **`truncated`**: tree나 file 상한에 걸린 부분 읽기를 뜻한다.

## 6. Baseline

| 항목 | 측정값 | 방법 |
|---|---|---|
| search:eval | MRR 0.924, nDCG@10 0.903, Recall@10 0.883, p50 3.7 ms / p95 11.1 ms | e2e 시드 corpus, `$S/p13-eval-before.txt` |
| 페이지당 SQL 문 수 | 홈 3, /artifacts 2, 상세 4–5 | `log_statement=all`을 임시로 설정, §19 |
| Client JS | 592,480 B (14 files) | `.next/static/**/*.js` |
| Sync 성공·실패율 | **NOT MEASURED**: 운영 DB에 접근하지 않음. 로컬 시드에는 job과 attempt가 0건이다. | — |
| Data Quality | 진단 도구가 없었으므로 이전 수치는 없다. 같은 데이터로 신규 도구를 실행한 결과는 §10에 있다. | — |
| CI 실행 시간 | NOT MEASURED. GitHub Actions를 실행하지 않음. | — |

## 7. Phase 13 — Sync Monitoring

새 저장 필드는 없다. 이미 저장된 다음 데이터를 읽는다.
- `sync:last_attempt`: status, ok, failedStages, processed, ingested, unchanged, unreadable, rateLimited, enqueued, queued, due, drainStoppedBy, durationSeconds
- `sync:last_success`
- 전체 `ingest_job`과 `ingest_attempt`

다음 값은 구분한다.
- **"Queue now"**: 전체 job의 *현재* 상태다.
- **"Last scheduled run"**: 한 번의 실행이 기록한 값이다.
- **"Attempts finished in the last N h (any run)"**: 시간 창 안의 attempt다. 어느 실행이 만든 것이든 포함한다.

세 영역의 제목에 분모와 기간을 함께 적었다.

### 상태 판정 (`src/corpus/health.ts` `syncHealth`)

| 상태 | 근거 |
|---|---|
| UNKNOWN | `last_attempt`와 `last_success`가 모두 없음 |
| DEGRADED | 마지막 실행 실패(`ok=false`), 또는 `staleHours`(기본 36 h, `--stale-hours`) 동안 실행 기록이나 오류 없는 실행이 없음 |
| PARTIAL | 마지막 status가 `PARTIAL_*` 또는 `NO_DRAIN` |
| OK | 최근 실행이 `COMPLETED` |

판정 대상은 sync이고 사이트가 아니다. 그래서 "DOWN"은 없다. 36 h는 12시간 주기 실행을 두 번 놓친 경우에 GitHub의 지연 시작 여유를 더한 값이다.

실패 분류는 `retry.ts`의 `dispositionFor`를 재사용해 succeeded / terminal / retryable / rate_limited로 나눈다. `unchanged`는 succeeded로 본다. 알 수 없는 outcome은 `unknown`으로 그대로 보고한다.

## 8. Phase 13 — 운영 리포트

```
bun run ops:status [--hours=24] [--stale-hours=36] [--json | --markdown]
```

- **read-only 강제**: `DATABASE_URL`에 `default_transaction_read_only=on`을 붙인다. postgres.js는 URL query를 startup parameter로 보낸다. 실측 결과 pool 연결 4개 모두 `on`이었고, INSERT는 SQLSTATE 25006으로 거부됐다.
- **Exit code**: 0은 리포트 생성(상태와 무관), 2는 DB를 읽지 못함이다. 오류는 코드만 출력한다(`ECONNREFUSED`, `ENOTFOUND` 확인). 메시지에는 host나 statement가 들어갈 수 있어 출력하지 않는다.
- **Actions Summary**: `sync.yml`에 "Sync health summary" step을 추가했다.
  - `if: !cancelled()`, `continue-on-error: true`로 설정했다.
  - `>> $GITHUB_STEP_SUMMARY`는 셸 redirect로 처리한다. 프로세스가 파일을 직접 쓰지 않으므로 AGENTS.md의 "디스크 쓰기 0"과 충돌하지 않는다.
  - Markdown cell은 `| \ ` * _ < > [ ]`를 escape한다.
  - 저장소 이름은 넣지 않는다.
  - actionlint 1.7.7 PASS.
- **공개 UI는 추가하지 않았다.** 홈 화면에 이미 목록 수, 유형별 수, "last sync without errors"가 있다. 로그인이 없으므로 그 이상은 공개하지 않는다.

## 9. Phase 14 — Data Quality

```
bun run quality:check [--repo=owner/] [--stale-days=14] [--samples=5] [--json]
```

`src/db/queries/quality.ts`의 각 규칙은 SQL 하나로, `label`과 `n`을 반환한다. 공통 wrapper가 window 함수로 총계를 내고, `collate "C"` 순으로 표본을 자른다. 그래서 서버 locale과 관계없이 출력이 결정적이다.

다음 사실은 이미 PostgreSQL이 막고 있으므로 다시 검사하지 않는다.
- `package_identity`
- `package_version_content_key`
- `ingest_job_active_key`
- `artifact_type` FK

## 10. Phase 14 — Integrity Rules

### 위반 규칙(0이어야 하며, 하나라도 있으면 exit 1)

1. `package-without-version`: 상세가 404가 되는 artifact
2. `parent-plugin-missing`: **전부 읽은 저장소**에서 `parent_path`의 plugin 행이 없음
3. `source-path-shape`: 빈 경로, 절대 경로, 빈·`.`·`..` segment, 백슬래시, 제어문자. `#`과 공백은 정상이다.
4. `blank-name`
5. `finding-commit-mismatch`
6. `artifacts-without-read-date`
7. `listing-counts-agree`: 홈 총계, 검색 총계(빈 검색어), 유형별 합계가 일치하는지 본다.

### 관찰

- `not-listed`: 사유별
- `same-content-other-repositories`, `same-name-other-repositories`: 허용되는 상황이며 오류가 아니다.
- `read-age`: 구간별 분포
- `not-read-recently`
- `checks-failing`
- `partial-reads`
- `parent-plugin-not-read`
- `delisted`
- `latest-parse-status`
- `latest-not-analyzed`
- `failed-jobs`: 마지막 attempt의 outcome별
- `retries-exhausted`

### e2e 시드 corpus 실행 결과(177 artifact, 8 저장소)

- 위반: 0
- not-listed: 13(duplicate 1, unparsed 12)
- partial-reads: 6
- parent-plugin-not-read: 20
- latest-parse-status: ok 111 / partial 54 / failed 12
- 실행 시간: 19 ms

### 진단 중 발견한 사항

1. **`parent_path`가 저장되지 않은 plugin을 가리킨다.** wshobson/agents의 skill 20개가 해당한다.
   - 원인: nesting은 tree 전체를 기준으로 디렉터리를 연결한다. 그런데 부분 읽기(`tree_truncated`)에서는 `plugin.json`을 읽지 않아 plugin 행이 없다.
   - 영향: 화면에는 "Inside the plugin"이 표시되지 않을 뿐, 깨지는 링크는 없다.
   - 처리: 규칙을 둘로 나눴다. 전부 읽은 저장소에서 생기면 위반, 부분 읽기에서 생기면 관찰이다. 운영에서도 600 파일 또는 120초 상한에 걸리면 생길 수 있다.
2. **`opsReport`의 하위 query가 잘못 결합됐다(구현 중 버그).**
   - 원인: Drizzle은 단일 테이블 select에서 column을 테이블 이름 없이 출력한다. 그래서 하위 query 안의 `v.package_id = "id"`가 v에 결합됐다.
   - 발견: DB 테스트가 `changedInWindow` 0을 잡았다.
   - 처리: `${packageTable}.id`로 고쳤다.
3. **관련 목록에서 NULL 정렬 문제(구현 중 버그).**
   - 원인: `parent_path = $1`은 top-level 행에서 NULL이 되고, DESC 정렬에서 NULL이 먼저 온다. 그래서 형제가 LIMIT에 잘렸다.
   - 처리: `coalesce(…, false)`로 고쳤다.
   - 검증: 회귀 테스트가 이전 코드에서 실패하고 수정 후 통과함을 확인했다.

## 11. Phase 15 — Related Discovery

기존에 있던 것:
- container plugin(`parent_path`)
- plugin의 components

새로 추가한 것(`getRelatedPackages`, 3개 문을 병렬 실행):
- **Other components of the same plugin**: 같은 `parent_path`를 가진 형제
- **Elsewhere in {저장소}**: 나머지 목록 artifact. container와 components는 중복 표시하지 않는다.
- 형제 → type → lower(name) → id 순으로 정렬한다(완전 순서).
- `RELATED_LIMIT` 12, 총계는 window 함수로 구한다.
- `NOT_LISTED_BECAUSE is null` 정책을 적용한다. fork, 중복, 파싱 실패 artifact는 다음 이동 대상으로 제시하지 않는다. 이들은 저장소 페이지에서 사유와 함께 계속 볼 수 있다.

유사도 점수는 만들지 않았다. 대신 "Search {유형} for "{이름}"" 링크로 Phase 11에서 측정한 검색 ranking에 넘긴다. 이 링크는 query 비용이 0이다.

## 12. Phase 15 — Query / UI

- 상세 페이지 SQL 문은 1개 늘었다(4→5, plugin과 component는 5→6). N+1은 없다.
- 10k 합성 데이터(artifact 10,001, 한 저장소에 600개, plugin 하나에 300개) 측정 결과:

| 경우 | p50 | p95 |
|---|---|---|
| 600 저장소의 component | 6.1 ms | 8.4 ms |
| 300-component plugin | 5.0 ms | 7.0 ms |
| 20 저장소 | 1.1 ms | 1.2 ms |

- "Related" 섹션은 이제 항상 렌더링한다. 최소한 저장소 링크와 검색 링크가 있기 때문이다. TOC에서도 항상 보인다.

## 13. Phase 16 — Freshness & Trends

| 후보 | 결정 |
|---|---|
| Recently Discovered | `sort=added` (`package.created_at`) |
| Recently Updated | `sort=changed` (`CONTENT_CHANGED_AT`) |
| Recently Indexed | 기존 `sort=recent` 유지 |
| Popular by Stars | **구현하지 않음.** AGENTS.md "Popularity … never ranks artifacts". star순 목록은 곧 ranking이다. 불변식이 틀렸다고 보지 않으므로 우회하지 않았다. |
| Same Repository 최신 | Related의 "Elsewhere"로 대체(유형·이름순). 날짜순은 근거가 약해 만들지 않았다. |

`changed`의 정의: version이 2개 이상인 artifact에서 가장 최근 `ingested_at`이다.
- version이 1개면 NULL이고, 이런 artifact는 `recent` 순으로 뒤에 붙는다. 정렬은 결과 집합을 바꾸지 않는다.
- 첫 version은 변경으로 보지 않는다.
- `repository.pushed_at`은 저장소 전체 값이라 파일 단위 변경으로 쓰지 않았다.

## 14. Timestamp 의미 구분(화면 문구)

- `/artifacts`에서 날짜 정렬을 쓰면 칩 아래에 `.sort-note`가 그 날짜가 무엇의 날짜인지 설명한다. *recent*는 마지막 저장, *added*는 최초 색인("Not when it was written"), *changed*는 기록 시점("not when that change was committed")이다.
- 행에는 기존 "read YYYY-MM-DD" 옆에 정렬 기준 날짜를 별도 단어로 붙인다. "first indexed …" 또는 "content changed …"이다.

## 15. UI/UX 변경

- **홈**: board-actions에 "Newly added", "Content changed" 링크를 추가했다.
- **/artifacts**: 정렬 칩이 5개가 됐고 설명 문장을 추가했다.
- **상세**: Related 섹션에 h3 그룹 두 개와 하단 링크 줄을 추가했다.
- **CSS**: `.sort-note { flex-basis: 100% }` 한 규칙만 추가했다. 애니메이션과 새 토큰은 없다.
- **axe-core 4.10.3**: 6페이지(홈, added, changed+type, component, command, skill) × light/dark × 1280/320px, 24개 조합에서 위반 0, 가로 overflow 0이다.

## 16. Security Review

| 항목 | 결과 |
|---|---|
| Secret 노출 | 리포트에는 URL과 환경변수가 없다. 오류는 코드만 출력한다. 가짜 자격 증명으로 실측했을 때 비밀번호와 host가 출력되지 않았다. |
| SQL Injection | 모든 값은 parameter로 넘긴다. `--repo`의 `%`, `_`, `\`는 escape해 LIKE 리터럴로 처리하고, 테스트로 확인했다. 숫자 flag는 양의 정수만 받는다. |
| HTML Injection / XSS | 화면은 React 텍스트로 렌더링한다. 검색 링크는 `URLSearchParams`로 만든다. Markdown summary는 cell을 escape하며 테스트로 확인했다. CLI 표본은 `JSON.stringify`로 출력해 제어문자가 터미널에서 실행되지 않는다. |
| Path Traversal | 파일 접근이 없다. |
| Unbounded Query | 관련 목록은 12개로 제한한다. components는 기존 `CAPS.maxFiles` 상한을 따른다. 리포트 표본은 `--samples`로 제한한다. |
| Public/Internal 분리 | 운영 정보는 CLI와 Actions summary에만 둔다. 페이지와 API는 추가하지 않았다. |
| Readonly | `default_transaction_read_only=on`으로 연결하며, 25006 거부를 실측했다. |
| 추적·세션 | cookie, 세션, 사용자 식별은 없다. 서버 함수도 없다(`no-public-ingest.test.ts` 통과). |
| 판정 어휘 | `check:boundaries` 규칙 6을 통과했다. |

## 17. DB 영향

- Migration 0, 새 index 0, schema 변경 0이다. index 크기는 변하지 않는다.
- `changed` 정렬은 기존 `package_version_recent_idx (package_id, ingested_at)`를 행마다 correlated로 사용한다.
- 쓰기 부하는 늘지 않는다. 새 코드는 모두 SELECT다.

## 18. CI/CD 영향

- `deploy.yml`은 바꾸지 않았다. 새 테스트는 기존 check job(DB 없이 1060 passed)과 database job에서 실행된다.
- 운영 DB 상태에 따라 결과가 달라지는 검사는 CI 필수 조건으로 넣지 않았다.
- 2026-10-23 보강: `ci.yml` database job에 `ops.mjs preflight`·`status`·`quality`를 한 step으로 추가했다. 대상은 그 job의 일회용 DB(loopback, 방금 migration한 빈 `agentdock` schema)이고 secret은 쓰지 않는다. 운영 데이터가 아니라 배선(읽기 전용 확인 → 리포트)을 검사한다.
- 2026-10-23 보강: 두 리포트는 읽기 전에 `src/db/readOnly.ts`의 연결 확인을 거친다. pool 연결 10개 모두에서 `default_transaction_read_only`·`transaction_read_only`가 on, `statement_timeout` 30 s, role `agentdock_app`, search_path가 schema 하나인지 확인하고, rollback되는 transaction 안의 `CREATE TEMP TABLE`이 25006으로 거부되는지 시험한다. 하나라도 어긋나면 exit 2로 아무것도 읽지 않는다. `-pooler` 호스트는 연결 전에 거부하고, `--production`은 `migration-gate.mjs`의 `productionTargetRejection`(loopback·pooler 거부, fingerprint 일치)을 재사용한다. `bun run ops:preflight`가 확인만 출력한다. 회귀 테스트는 `src/db/readOnly.test.ts` 17개이며, 읽기 전용 파라미터 제거·pool 확인 생략·probe 무조건 통과·pooler 허용·transaction_read_only 확인 생략의 다섯 변형을 각각 잡는 것을 확인했다.
- `sync.yml`: summary step이 약 1초 늘어난다(로컬 측정: 10k에서 52 ms). GitHub 요청은 0이다. `continue-on-error`이므로 sync 결과에는 영향이 없다. drain deadline(35분) 안에 들지 않는 후속 step이다.

## 19. Performance Before/After

### e2e corpus, 로컬 standalone 서버

baseline `:3971`은 HEAD 복사본, after `:3972`는 변경본이다. 페이지마다 요청 40회를 교차로 보냈다.

| 페이지 | SQL 문 수 B→A | p50 B→A (ms) | p95 B→A (ms) | gzip B→A |
|---|---|---|---|---|
| `/` | 3→3 | 12.5→12.0 | 18.0→17.2 | 22,940→23,030 |
| `/artifacts` | 2→2 | 9.6→10.2 | 15.2→15.4 | 18,242→20,389 |
| `/artifacts?q=review` | 2→2 | 9.0→10.6 | 13.8→17.8 | — |
| `?sort=added` | 2→2 | 9.5→8.8 | 13.0→14.4 | — |
| `?sort=changed` | 2→2 | 9.2→10.3 | 13.8→14.3 | — |
| skill 상세(pdf) | 4→5 | 11.7→13.2 | 15.2→18.2 | 15,969→17,160 |
| plugin component 상세 | 5→6 | 7.1→8.2 | 8.9→10.3 | 9,276→10,544 |
| command 상세 | 4→5 | 7.3→8.7 | 9.9→11.1 | 9,500→10,453 |

- baseline에는 `added`와 `changed` 정렬이 없어 `recent`로 fallback한 값이다.
- `/artifacts`의 gzip +2.1 KB는 칩 2개, 설명 문장, 행별 조건부 자리값이 HTML과 RSC payload 양쪽에 실린 결과다.
- **Client JS**: 592,480 → 592,480 B. **CSS**: 45,801 → 45,828 B.
- **외부 요청 증가**: 0.

### 10k 합성 데이터, query 단위(p50 / p95)

| Query | 결과 |
|---|---|
| 빈 검색어, `recent` | 46.0 / 47.8 ms |
| 빈 검색어, `added` | 45.9 / 48.1 ms |
| 빈 검색어, `changed` | 55.7 / 56.2 ms (+21%) |
| `review` 검색, `changed` | 11.6 / 18.0 ms |
| `quality:check` 전체 | 461 / 502 ms |
| `ops:status` | 52 / 57 ms |

`changed`의 추가 비용은 행마다 실행되는 correlated aggregate다. 100 ms를 넘으면 `package`에 변경 시각 column을 두는 방안을 검토한다. 그 전에는 쓰기 경로를 바꾸지 않는다.

## 20. Search Evaluation

- Before와 After 모두 MRR 0.9241, nDCG@10 0.9026, Recall@10 0.8832, Top-1 0.911이다.
- 질의 50개의 total과 firstRelevant가 **모두 같다**(diff 0).
- 평가 데이터셋도 같다(e2e 시드 7개 fixture와 ui-edge-cases).

## 21. E2E Results

`bun --no-env-file x playwright test` 결과 **25 passed**(기존 21, 신규 4)다.

신규 시나리오:
1. **related**: 형제 → 나머지 → `c#-review` 이동. container는 중복 표시되지 않는다.
2. **related 정책**: 파싱 실패한 `cook.md`는 제시되지 않는다. 검색 링크가 유형을 유지한다.
3. **날짜 정렬**: 홈 링크, 설명 문구, 행 날짜, 총계 동일, 필터 조합, 빈 결과.
4. **320px**: related와 날짜 정렬에서 overflow 0.

기존 테스트 하나는 의도한 변경으로 수정했다. 브라우즈 시 정렬 칩 목록에 'Newly added'와 'Content changed'가 추가됐다.

## 22. 기존 기능 회귀

| 항목 | 결과 |
|---|---|
| `bun run ci`(`CI=1`, test DB) | 1449 passed / 3 skipped. Phase 12는 1425 / 3. |
| DB 없이 실행 | 1060 passed / 392 skipped(DB suite) |
| `next build` (standalone) | PASS |
| `VERCEL=1` build | PASS |
| Docker `agentdock:phase13-local` | PASS, 322 MB(Phase 12와 같음) |
| actionlint 1.7.7 | ci/deploy/sync PASS |

skip 3건의 사유는 다음과 같다.
- `client.test.ts`의 wrong password: 로컬 trust 인증 때문이다.
- `search.test.ts`의 pg_trgm 미설치 경로.
- live `permalink.test.ts`: `CI=1`에서 skip된다. 이번에는 단독 실행하지 않았으므로 NOT RUN이다.

## 23. 변경 파일 목록

### 신규

| 파일 | 내용 |
|---|---|
| `scripts/ops.mjs` | `status`와 `quality` 두 모드. 수동 flag 파싱, read-only URL, exit code 0/1/2, 종료 시한 1초 |
| `src/corpus/health.ts` (+ test 13개) | `syncHealth`, `outcomeCategory`, text와 Markdown 렌더링 |
| `src/db/queries/opsReport.ts` | `readSyncReport`: 문 9개를 병렬 실행 |
| `src/db/queries/quality.ts` (+ `quality.test.ts` 8개) | 품질 규칙, 운영 리포트 delta 테스트 |
| `docs/analysis/agentdock-phase13-16-operations-quality-discovery.md` | 이 문서 |

### 수정

| 파일 | 내용 |
|---|---|
| `src/db/queries/packages.ts` | `getRelatedPackages` 확장, `RELATED_LIMIT`, `RelatedPackages` 타입 |
| `src/db/queries/search.ts` | `SEARCH_SORTS`에 `added`·`changed` 추가, `CONTENT_CHANGED_AT`, projection `addedAt`·`changedAt` |
| `src/app/r/[owner]/[repo]/[...path]/page.tsx` | Related 그룹, `RelatedRow`, 하단 링크 |
| `src/app/artifacts/page.tsx` | `SORT_LABELS`, `SORT_NOTES`, `PackageRows date` |
| `src/components/PackageRows.tsx` | 정렬 날짜 표시 |
| `src/app/page.tsx` | 날짜 정렬 링크 2개 |
| `src/app/globals.css` | `.sort-note` |
| `.github/workflows/sync.yml` | summary step |
| `package.json` | `ops:status`, `quality:check` |
| 테스트 | `packages.test.ts`(+2), `search.test.ts`(+1), `e2e/journeys.spec.ts`(+4, 1개 수정) |
| 문서 | `README.md`, `README.en.md`, `VERCEL_DEPLOY.md` |

## 24. 남은 위험

- **운영 미검증**: 실제 sync 기록이 있는 DB에서는 `ops:status`와 `quality:check`를 실행하지 않았다.
  - 첫 운영 실행에서 위반 규칙이 0이 아닐 수 있다. 예를 들어 Phase 4 이전에 만들어진 행이 해당할 수 있다.
  - 이런 결과는 결함 데이터를 발견한 것이고, 도구의 오류가 아니다.
- **Neon startup parameter**: `default_transaction_read_only`를 startup parameter로 보낸다. sync는 direct endpoint를 쓰므로 PostgreSQL이 이를 받는다. 다만 pooled endpoint(PgBouncer)에서 이 명령을 실행하면 거부될 수 있다(미검증).
- **`changed` 정렬 비용**: 10k에서 +10 ms다. 100k 규모는 측정하지 않았다.
- **같은 저장소 목록의 크기**: 상세 HTML이 10–19 KB(gzip 약 1.2 KB) 늘었다.
- **NOT RUN / NOT MEASURED**:
  - GitHub Actions 실행
  - 운영 페이지 렌더링
  - LCP
  - Safari·Firefox
  - 스크린리더
  - live GitHub 테스트(이번 Phase에서 단독 실행하지 않음)

## 25. 운영 반영 체크리스트

1. push 후 CI의 check, database, e2e job이 모두 green인지 확인한다. 이 Phase에는 migration이 없으므로 deploy gate에 해당하는 것이 없다.
2. Vercel 배포 후 다음을 확인한다.
   - 상세 페이지의 "Elsewhere in …"
   - `/artifacts?sort=added`, `/artifacts?sort=changed`의 설명 문장
3. 다음 예약 Sync run의 summary 페이지에 "AgentDock sync health" 표가 붙는지 확인한다. 표에 저장소 이름이 없는지도 확인한다.
4. 운영자 터미널에서 `bun run quality:check`를 실행한다(direct URL, read-only). 위반이 나오면 표본을 보고 원인을 기록한다.

## 26. 후속 개발 후보

| 후보 | 착수 조건 |
|---|---|
| `package`에 변경 시각 column 추가 | `changed` 정렬이 100 ms를 넘을 때 |
| nesting이 저장되지 않은 plugin을 parent로 쓰지 않도록 수정 | `parent-plugin-not-read`가 운영에서 유의미하게 많을 때. persist와 detect의 경계 결정이 필요하다. |
| `ops:status --fail-on=degraded` | 외부 알림이 필요해질 때. 지금은 exit 0이다. |
| 운영 `quality:check`를 주 1회 workflow로 실행 | 결과를 공개해도 되는지 먼저 결정해야 한다. 표본에 저장소 이름이 들어간다. |

## 27. 최종 판정

**CONDITIONAL**

로컬에서 가능한 검증(CI, E2E, eval, axe, 3종 빌드, actionlint)은 모두 PASS다. 남은 조건은 push 후 CI green, 운영 화면 확인, 첫 Sync summary 확인이다.
