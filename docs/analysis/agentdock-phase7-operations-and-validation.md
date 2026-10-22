# AgentDock Phase 7 — 운영·관측성·품질 자동화

작성일 2026-10-21 · 기준 HEAD `57c7c54` · 미커밋

## 1. 운영 관측성 (D-1) — 기존 구현 재확인, 코드 변경 없음

`scripts/corpus-sync.mjs`가 이미 다음을 제공한다(Phase 3).

| 요구 항목 | 현재 위치 |
|---|---|
| 마지막 시도 / 오류 없이 끝난 마지막 sync | `schema_meta`의 `sync:last_attempt` / `sync:last_success`(홈 표시는 "last sync without errors") |
| 처리 / 수집 / 변경 없음 / 읽기 실패 / rate limit / 재시도 / delist / enqueue | `recordSyncAttempt`의 카운트 필드 |
| Core API 사용량 | `coreSpent`(reset 시각이 같을 때만 계산, 아니면 null) |
| Queue 대기량, drain 종료 사유 | `queued`, `drainStoppedBy` |
| Topic 탐색 상태 | topic마다 `requests`, `new-repos`, 멈춘 shard, 측정하지 못한 floor 출력 |
| 단계별 실패 | `stage()`로 격리하고 `::error` annotation을 남긴다. 실패가 있으면 exit 1이며 last_success를 기록하지 않는다 |
| 실행 시간 | `durationSeconds`, `::notice` 요약 |

- **공개 노출:** 웹에는 last sync 시각만 나간다. 카운트와 오류 메시지는 공개 웹에 나가지 않는다.
- **관리자 화면:** 인증 정책 없이 만들 수 없으므로 **만들지 않았다**.
- **이번 변경이 관측성에 주는 영향:** 출력 형식은 바뀌지 않는다. `listed=` / `held=` 카운트에 agent가 자동으로 포함된다.

## 2. 장애 진단 (D-2)

| 상황 | 검증 위치 | 결과 |
|---|---|---|
| Registry, Search, link list 실패 | `corpus-sync` stage 격리(Phase 3 E2E run5–8) | 기존 PASS, 이번 변경 없음 |
| Core / Secondary rate limit, Retry-After | `client.test.ts`, `worker.test.ts` | PASS |
| Repository 404, tree 잘림, raw 404 | `scan.test.ts`, `pipeline.test.ts` | PASS |
| Detector 오류(match / parse throw) | `run.test.ts`, `safeParse` | PASS. agent도 같은 guard를 거친다 |
| **DB transaction 실패: 새 유형인데 0009 없음** | 로컬 리허설 §4 | FK 오류를 재현. 저장소 단위 rollback이며 retryable. 데이터 손실은 없다 |
| Topic shard 반복 실패 | `search.test.ts`(R-shard) | PASS |
| 실행 시간 상한 | `drainDeadlineMs`, `wallClockMs` | 기존 PASS |

## 3. 테스트 확대 (D-3)

| 파일 | 추가 | 내용 |
|---|---|---|
| `src/detect/agent.test.ts` | 20(신규) | corpus별 매칭 수, root 규칙, README·commands 제외, nesting, parse 분기, env 비저장, tools null, declared |
| `src/db/queries/search.eval.test.ts` | 21(신규) | 검색 평가셋과 회귀 고정값 |
| `src/db/queries/packages.test.ts` | +4 | 관계 양방향, shape-only, root plugin, history 상한, `pluginRoot` |
| `src/ingest/reanalyze.test.ts` | +1 | backfill에서 최신 version을 먼저 처리 |
| `src/corpus/seedList.test.ts` | +1 | rejected와 seeds가 겹치지 않음 |
| 기존 테스트 기대값 갱신 | — | registry 7종, phase gate 개수(agent 추가), IndexFlow 파일명 8개 |

- **CI 호환:** 실제 GitHub API를 부르는 테스트는 추가하지 않았다. 모든 DB 테스트는 `TEST_DATABASE_URL`만 쓰고, CI의 `database` job(postgres:17 service)에서 그대로 돈다.
- **pg_trgm:** CI DB에서 pg_trgm 설치 여부는 bootstrap SQL을 따른다. eval의 `typo-2`는 0건이 기준값이라 extension이 없어도 통과한다.

## 4. Migration 리허설 (0008 → 0010)

스크립트: `scratchpad/mig0010/upgrade.sh`(로컬 `agentdock-testdb` 전용).

| 단계 | 결과 |
|---|---|
| 0000–0008 상태 재현, 이전 seed 6종 | `9 \| 1792545594506`, `catalog,command,hook,mcp_server,plugin,skill` |
| 0009 없이 `type='agent'` INSERT | `ERROR: ... violates foreign key constraint "package_type_artifact_type_id_fk"` |
| `bun scripts/migrate.mjs` | `applied 2 of 11`, 0.047초 |
| 결과 | 이력 11행, max `1792578824084`. `agent\|Subagent` 존재. `package_version_content_hash_idx` 생성 |
| 같은 INSERT 다시 실행 | 성공. 기존 행은 그대로 |
| 재실행 | `already up to date (11 migration(s) on disk).` |
| 계획 | `Index Only Scan using package_version_content_hash_idx` |
| 두 migration의 rollback SQL 실행 → 재적용 | 이력 9 → `applied 2 of 11` → 11 |

## 5. 보안·안전성 (D-5)

- **`check:boundaries`:** OK — migration 11개, UI 파일 27개에서 금지 어휘 0건.
  - 새 외부 호스트 접근 없음(문서 링크는 렌더링되는 href일 뿐 접속하지 않는다).
  - 새 실행 경로나 디스크 쓰기 없음.
- **Subagent frontmatter:** 신뢰하지 않는 입력으로 다룬다.
  - YAML은 core schema로 파싱하고 크기 상한 두 개를 그대로 적용한다.
  - `mcpServers`의 인라인 정의와 env는 저장하지 않는다.
- **사용 안내:** 정적 문구이며 원본의 명령을 옮기지 않는다.
- **SQL:** 모든 값은 바인딩한다. `pathBonus`의 LIKE 피연산자는 `escapeLikeOperand`를 거친다.
- **테스트 DB 격리:** 다음 장치를 유지한다.
  - `vitest.config.ts` main과 worker, `testPreload.ts`
  - `migrate.mjs`의 `--test-database`
  - 이번 세션에서는 모든 DB 명령을 `TEST_DATABASE_URL`(loopback, 55432) 또는 `docker exec agentdock-testdb`로만 실행했다.
- **Secret 스캔:** 변경 전체(diff와 untracked 파일)에서 다음 결과를 얻었다.
  - Neon 호스트 0건
  - 비밀번호가 포함된 postgres URL 0건
  - token 패턴 0건

## 6. 최종 검증 결과

| 항목 | 명령 | 결과 |
|---|---|---|
| boundaries | `bun run check:boundaries` | PASS (`11 migration file(s) ... OK`) |
| lint | `bun run lint` | PASS (`Checked 200 files ... No fixes applied.`) |
| typecheck | `bun run typecheck` | PASS (exit 0) |
| unit + DB integration + migration + search SQL + Sync E2E(mock) + detector E2E | `CI=1 bun run test`(`TEST_DATABASE_URL`만) | **PASS: 68 files passed / 1 skipped, 1258 passed / 3 skipped** |
| Next.js build | `bun run build`(placeholder `DATABASE_URL`) | PASS (exit 0) |
| Vercel build mode | `VERCEL=1 bun run build` | PASS (exit 0) |
| Docker build | `docker build -t agentdock-phase47:local .` | PASS (exit 0) |
| Secret scan | grep 패턴 | PASS (0건) |
| git diff check | `git diff --check` | PASS |

- **Baseline:** 작업 전 1211 passed / 3 skipped였다.
- **SKIP 3건:** 모두 의도된 것이며 Phase 3와 같다.
  - `search.test` D-04 pg_trgm 부재 케이스: 로컬에 pg_trgm이 있다.
  - `client.test` wrong-password: trust 인증 DB라서다.
  - `permalink` live 테스트: `CI=1`이라서다.
- **실행하지 않은 것(NOT RUN):**
  - 운영 Neon과 관련된 모든 것
  - 원격 GitHub Actions
  - Vercel 배포
  - 실제 GitHub 대상 sync

## 7. 운영 영향

| 대상 | 영향 |
|---|---|
| GitHub API | core 요청 수는 바뀌지 않는다(raw read만 저장소당 최대 600). Search 요청은 바뀌지 않는다(topic 변경 없음) |
| Neon | 작은 row 1개와 index 1개를 추가한다. index 크기는 version 수에 비례한다(64자 hex hash) |
| Vercel | 상세 화면 query가 최대 2개 늘지만 병렬로 실행된다. 홈과 검색은 index 덕분에 빨라진다. 함수 호출 수는 바뀌지 않는다 |
| GitHub Actions | sync 시간이 늘 수 있다(큰 저장소의 raw read 증가). timeout 60분은 유지한다 |
| 비용 | 새 유료 서비스와 외부 AI API가 없다 |
