# AgentDock Phase 4 — Discovery·수집 엔진·데이터 품질

작성일 2026-10-21 · 기준 HEAD `57c7c54` (develop) · 변경은 미커밋 작업 트리

## 1. 변경 목표

- Subagent 유형을 추가해도 기존 유형의 수집 범위가 줄지 않게 한다.
- 새 Discovery 소스를 넣을지는 측정한 근거로만 판단한다.
- Backfill이 상한 안에서 실제로 화면에 보이는 행부터 처리하게 한다.
- Seed 목록의 회귀를 막는다.
- 404 장기 정책은 대안만 정리하고, 결정은 사용자에게 남긴다.

## 2. 기존 동작 (코드 기준 재확인)

| 영역 | 위치 | 현재 동작 |
|---|---|---|
| Discovery 소스 | `scripts/corpus-sync.mjs` | MCP Registry, `config/seeds.json`(seed 15, link list 2, rejected 6), link list 파싱, topic sweep 5개(`src/github/search.ts` `SEARCH_TOPICS`), refresh |
| 파일 상한 | `src/github/scan.ts` `CAPS.maxFiles` | 400. 7개 detector가 함께 쓰고, `orderedNeeds`가 round-robin으로 잘라 유형 간 공정성을 유지한다 |
| 부분 읽기 | `src/ingest/pipeline.ts` | 잘린 읽기는 delist하지 않는다. 같은 sha에서 결정적으로 잘린 경우는 short-circuit한다 |
| Backfill | `scripts/analyze-backfill.mjs`, `src/ingest/reanalyze.ts` | `analyzed_at IS NULL`인 version을 id 순으로 최대 N개 처리한다. 저장된 본문만 쓰고 GitHub 요청은 0회다 |
| 404 처리 | Phase 3 `checked_at`/`check_failures` | backoff만 한다(`stale × 2^min(n,4)`). delist하지 않는다 |
| ETag | `src/github/repo.ts:41`, `persist.ts` | 응답의 ETag를 저장만 하고 조건부 요청에는 쓰지 않는다 |

운영 Sync 로그와 운영 DB는 이번 작업에서 접근하지 않았다. 그래서 다음 항목은 측정하지 않았으며 **NOT VERIFIED**다.

- 소스별 실제 발견량
- 중복률
- drain 처리량
- 실패율

## 3. 변경 내용

### 3.1 `CAPS.maxFiles` 400 → 600 (`src/github/scan.ts`)

**Baseline.** 고정 fixture 7개에 대해 detector가 요구하는 파일 수를 측정했다(2026-10-21).

| corpus | 기존 6 detector | Subagent 추가 | 합계 |
|---|---|---|---|
| wshobson-agents | 384 | +204 | **588** |
| anthropics-claude-code | 46 | +15 | 61 |
| disler-hooks-mastery | 22 | +19 | 41 |
| addyosmani-agent-skills | 35 | +4 | 39 |
| anthropics-skills / baoyu-skills / obra-superpowers | 19 / 23 / 17 | 0 | 동일 |

400을 유지하면 wshobson은 588 > 400이 되어 부분 읽기로 바뀐다. 이때 round-robin 때문에 skill을 포함한 모든 유형이 함께 잘린다. 새 유형 때문에 기존 유형의 수집 범위가 줄어드는 셈이다.

600에서 concurrency 2와 120초 wall clock이면 파일당 시간 예산은 400ms다. 원래 예산이 가정한 raw read는 약 150ms였다(AGD-01 RESEARCH A3, 대량 측정은 아님).

- **raw read 비용:** core quota는 0이다.
- **영향:** raw host의 abuse-throttle 노출과 wall clock이 최대 1.5배까지 늘 수 있다.
- **검증:** `pipeline.test.ts`의 phase gate가 wshobson을 `truncated: false`로 끝까지 읽는지 단언한다(PASS).
- **함께 따라가는 값:** `getRepositoryPackages`의 상한은 `CAPS.maxFiles`를 그대로 읽으므로 함께 600이 된다.

### 3.2 Backfill 우선순위 (`src/ingest/reanalyze.ts` `unanalyzedVersionIds`)

- **이전:** `ORDER BY id`. 오래된 version부터 처리했다.
- **이후:** 각 package의 최신 version을 먼저 처리하고, 그다음을 id 순으로 처리한다.
  - 화면, 목록, capability 필터는 최신 version만 읽는다(`search.ts` `LATEST_PACKAGE_VERSION_ID`).
  - 그래서 `bun run analyze:backfill 500`처럼 상한을 둔 실행도 보이는 결과부터 채운다.
- **재개:** 분석이 끝난 행은 조건에서 빠지므로 다시 실행하면 이어서 진행된다.
- **회귀 테스트:** `reanalyze.test.ts` "hands out the latest version of a package before an older one". 이전 코드에서는 `[old, latest]`로 실패한다.

### 3.3 Seed 품질 (`src/corpus/seedList.test.ts`)

`rejected`에 기록된 저장소가 `seeds`나 `linkLists`에 다시 들어오면 실패하는 테스트를 추가했다. 로더는 `rejected`를 버리므로 이런 행은 아무 경고 없이 다시 요청된다. 기존 테스트는 중복, 형식, 개행 주입을 이미 검증한다.

## 4. Discovery 소스 확대 검토 (A-2) — 구현 보류

GitHub Search API로 읽기 전용 요청 10회를 보냈다(2026-10-21, 인증 없음). 현재 floor는 `MIN_REPOSITORY_STARS = 50`이다.

| topic | 전체 | ≥10★ | ≥50★ | ≥50★ 중 기존 5개 topic에 이미 포함 | 새로 발견 |
|---|---|---|---|---|---|
| claude-code-subagents | 98 | 22 | 13 | 11 | 2 |
| claude-subagents | 30 | 11 | — | — | — |
| subagents | 1,553 | 209 | 76 | 54 | 22 |
| claude-code-agents | 89 | 21 | — | — | — |

판단은 다음과 같다.

- topic sweep은 요청 예산을 topic 수로 나눠 쓴다. topic 하나를 추가하면 기존 5개 topic의 몫이 줄어든다.
- `claude-code-subagents`는 새로 찾는 저장소가 2개뿐이다.
- `subagents`는 22개를 새로 찾지만, 예시(`desplega-ai/agent-swarm`, `Decade-qiu/CookHero` 등)를 보면 Claude 형식과 무관한 agent framework가 섞여 있다.
  - 이런 저장소는 `no_artifacts`로 끝나면서 core 요청을 2회씩 쓴다.

결론: **topic 목록을 바꾸지 않는다.** 대안은 `VoltAgent/awesome-claude-code-subagents`를 seed로 추가하는 것이다. 다만 tree를 확인하지 않았으므로 RESEARCH NEEDED로 남기고, 사용자가 결정한다.

## 5. 404 저장소 장기 정책 (A-5) — 사용자 결정 필요

현재 정책은 보수적 유지다. 404여도 delist하지 않고 확인 간격만 늘린다.

| 대안 | 동작 | 장점 | 위험 |
|---|---|---|---|
| A. 현행 유지 | 4회 실패 후 최대 16배 간격으로 계속 확인 | 데이터 손실이 없다. 일시적 장애에도 안전하다 | 삭제된 저장소의 artifact가 영구히 목록에 남는다 |
| B. N회 연속 404 + T일 경과 시 delist | `check_failures ≥ N`이고 `checked_at - scanned_at > T`면 `package.delisted_at` 설정 | 목록이 정확해진다. 행은 남아 복구할 수 있다 | rate limit을 404로 오판하면 잘못 내린다. 404만 집계하도록 구분 컬럼이 필요하다(migration) |
| C. 표시만 추가 | 상세 화면에 "N회 연속 읽지 못함" 표시 | 정책 변경 없이 사실만 노출한다 | 목록에는 그대로 남는다 |

권장은 C를 먼저 적용하는 것이다. C는 `check_failures`가 이미 있어 migration이 필요 없다. B는 실패 사유 컬럼을 추가하는 migration이 필요하므로 사용자 결정 후 진행한다. **이번에는 구현하지 않았다.**

## 6. 처리량 최적화 검토 (A-6)

- **ETag 조건부 요청 — RESEARCH NEEDED.** GitHub 문서에 따르면 304 응답은 primary rate limit에 집계되지 않는다(이번에 재확인하지 않음). 그렇다면 변경 없는 저장소의 metadata 요청 1회를 아낄 수 있다.
  - 다만 tree 요청은 sha를 알아야 해서 여전히 1회가 필요하다.
  - 304를 처리하려면 `fetchRepoMetadata`와 client의 응답 처리를 바꿔야 한다. 고정 fixture로는 절감량을 잴 수 없어 보류한다.
- **Secondary rate limit / Retry-After:** R9–R11에서 구현했다. 이번 변경은 없다.
- **같은 저장소 중복 작업 방지:** `enqueueJob`의 unique 조건이 담당한다. 이번 변경은 없다.

## 7. 사이드이펙트

- 600 파일을 꽉 채운 저장소는 실행 시간이 최대 1.5배 늘 수 있다. 다만 sync 전체 상한(drain 35분)은 그대로라서, 한 번의 실행이 처리하는 저장소 수가 줄 수 있다. **운영에서 측정하지 않았다.**
- Backfill 정렬은 null 행마다 상관 서브쿼리를 하나씩 추가한다. `package_version_recent_idx`를 사용하며, 상한 500 기준으로 측정하지는 않았다.

## 8. Rollback

- `maxFiles`: 값 하나만 되돌리면 된다. 저장된 데이터는 바뀌지 않는다.
- Backfill 정렬: 코드만 되돌리면 된다.
- Seed 테스트: 테스트만 바뀌었다.

## 9. 후속 작업

1. 첫 운영 Sync에서 다음을 확인한다.
   - `truncated=true` 저장소 수
   - 저장소당 실행 시간
   - `drainStoppedBy`
2. 404 정책 C 구현 여부를 결정한다.
3. ETag 304가 실제로 quota를 절약하는지 소규모로 측정한다.
4. topic이나 seed 추가 여부를 결정한다.
