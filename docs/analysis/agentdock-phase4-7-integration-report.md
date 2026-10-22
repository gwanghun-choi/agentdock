# AgentDock Phase 4~7 통합 보고서

작성일 2026-10-21 · 기준 HEAD `57c7c54` (develop) · 변경은 모두 미커밋 · commit, push, 배포는 하지 않았다

후속: [Phase 8 — Sync 처리량·재개 안정성·정합성](agentdock-phase8-sync-performance-and-consistency.md)

세부 문서:

- [Phase 4](agentdock-phase4-ingestion-and-data-quality.md)
- [Phase 5](agentdock-phase5-artifact-expansion.md)
- [Phase 6](agentdock-phase6-search-and-ux.md)
- [Phase 7](agentdock-phase7-operations-and-validation.md)

## 1. 결론

- 판정: **CONDITIONAL**.
- 조건: **Migration-before-Push(0009, 0010)**와 원격 CI의 `database` job green.
- 구현 범위: 일곱 번째 유형 Subagent를 수집부터 상세 화면까지 연결했다. 아울러 plugin 연관 탐색, 사용 안내, Version 이력, 경로 검색 순위, Backfill 우선순위, 그리고 홈·검색 이차 지연 결함(index)을 반영했다.
- 테스트: 1211개에서 **1258 passed / 3 skipped**로 늘었다. 격리 로컬 DB에서 실행했다.
- 보류: 근거가 부족하거나 사용자 결정이 필요한 항목은 아래 표에 정리했다.

| 과제 | 상태 |
|---|---|
| A-1 수집 구조 재검증 | DONE(코드 기준). 운영 지표는 NOT VERIFIED(접근 금지) |
| A-2 Discovery 확대 | 측정 완료, **보류**(topic 효과 미미하거나 잡음). 사용자 결정 필요 |
| A-3 Seed 품질 | DONE(회귀 테스트 1건) |
| A-4 재분석·Backfill | PARTIALLY DONE(최신 version 우선). analyzer version 단위 stale 판정은 PENDING(컬럼 필요) |
| A-5 404 장기 정책 | 대안과 영향을 정리. **사용자 결정 필요**, 구현하지 않음 |
| A-6 처리량 | PARTIALLY DONE(`maxFiles` 600). ETag 304는 RESEARCH NEEDED |
| B-1 / B-2 Subagent | DONE |
| B-3 Codex·Cursor·Gemini | 조사 DONE. Codex·Cursor skill은 기존 detector가 이미 처리한다. Gemini extension, Cursor rules, `.cursor/.codex/agents`는 PENDING |
| B-4 연관 탐색 | DONE(디렉터리 기준. manifest override는 따라가지 않음) |
| B-5 사용 안내 | DONE(정적) |
| B-6 Version 이력 | DONE(목록). 본문 diff는 보류 |
| C-1 검색 Baseline | DONE(평가셋 21건) |
| C-2 검색 대상 확대 | 측정 후 **기각**(저장소 description·topic이 결과 수를 폭증시킴) |
| C-3 랭킹 | DONE(`pathBonus`, 1건 개선, 나머지 20건 불변). trigram 임계값은 실측 후 유지 |
| C-4 / D-4 성능 | DONE(1k·10k·50k 측정. 결함을 찾아 0010으로 수정) |
| C-5 / C-6 UI | DONE(Subagent 필터, 상세 섹션 3개) |
| D-1 관측성 | 기존 구현 확인. 변경 없음 |
| D-2 장애 진단 | DONE(기존 테스트와 0009 누락 리허설) |
| D-3 테스트 | DONE(+47) |
| D-5 보안 | DONE |

## 2. 데이터 모델과 Migration

| # | 파일 | 내용 | 기존 데이터 | Backfill | 이전 코드 호환 |
|---|---|---|---|---|---|
| 0009 | `0009_subagent_type.sql` | `artifact_type`에 `('agent','Subagent')` INSERT, ON CONFLICT DO NOTHING | 바뀌지 않음 | 불필요 | 호환(이전 코드는 이 행을 읽지 않음) |
| 0010 | `0010_version_content_hash_idx.sql` | `CREATE INDEX package_version_content_hash_idx` | 바뀌지 않음 | 불필요 | 호환(index만 추가) |

- **새 테이블과 컬럼:** 없다. 관계는 기존 `parent_path`를, 이력은 기존 `package_version`을 쓴다.
- **journal:** idx 9 = `1792577697648`, idx 10 = `1792578824084`. 둘 다 0008(`1792545594506`)보다 크다.
- **snapshot:** 0009는 0008과 같고, 0010은 index를 포함한다. `migrations.test.ts`로 drizzle/를 적용한 결과와 `schema.ts`가 일치하는지 확인했다(PASS).
- **필요성:**
  - 0009가 없으면 새 sync 코드는 Subagent가 있는 저장소를 전부 `storage_failed`로 처리한다(transaction rollback, 데이터 손실 없음, 갱신 정지).
  - 0010이 없어도 동작은 하지만, 홈과 검색이 규모에 따라 이차적으로 느려진다.
- **웹 코드:** migration 없이도 동작한다. 새 컬럼을 읽지 않는다.

## 3. 운영 반영 순서 (Phase 3 Runbook의 연장)

전제: Phase 3 runbook의 0008이 이미 적용돼 있어야 한다. 즉 운영 이력이 9행이어야 한다. **0008이 아직이면 Phase 3 runbook을 먼저 끝낸다.** 그러면 이 절차에서 0008, 0009, 0010이 한 번에 적용된다(`applied 3 of 11`).

```bash
# 실행 위치: 로컬 checkout(~/workspace_auto/agentdock), 사용자가 직접 실행
# ① Neon branch 생성 (콘솔): pre-0010-YYYYMMDD
# ② 연결 (URL은 화면/기록에 남기지 않는다)
read -rs DATABASE_URL && export DATABASE_URL && export DATABASE_SCHEMA=agentdock
psql "$DATABASE_URL" -Atc "select count(*), max(created_at) from agentdock.__drizzle_migrations"
#    기대: 9|1792545594506  (0008 적용 상태). 다르면 중단.
# ③ 실행 중인 Sync가 없는지 확인 (gh run list --workflow=sync.yml --limit 3) 후
bun run db:migrate
#    기대: "agentdock: applied 2 of 11 migration(s)."
# ④ 검증
psql "$DATABASE_URL" -Atc "select count(*), max(created_at) from agentdock.__drizzle_migrations"   # 11|1792578824084
psql "$DATABASE_URL" -Atc "select id from agentdock.artifact_type where id='agent'"                  # agent
psql "$DATABASE_URL" -Atc "select indexname from pg_indexes where schemaname='agentdock' and indexname='package_version_content_hash_idx'"
bun run db:migrate   # 기대: already up to date (11 migration(s) on disk).
unset DATABASE_URL
```

⑤ 그다음 commit을 만들고 **한 번에 push**한다(§6). 이후 원격 CI 두 job → Vercel Ready → smoke 순서로 확인한다. smoke 대상은 기존 7개에 `/artifacts?type=agent`를 더한 것이다.

⑥ 첫 예약 Sync에서 확인할 항목:

- `listed=` / `held=`가 증가하는지(agent 포함)
- `failed-stages=none`
- 출력에서 `truncated` 저장소 수
- 저장소당 실행 시간과 `drainStoppedBy`
- `storage_failed`가 0인지 — 0이 아니면 0009가 적용됐는지 다시 확인

⑦ 읽기 전용 SQL:

```sql
select type, count(*) from agentdock.package where delisted_at is null group by 1;
select count(*) filter (where pv.parse_status='partial')::float / count(*) from agentdock.package p
  join agentdock.package_version pv on pv.package_id=p.id where p.type='agent';
```

실패 시 대응:

| 증상 | 조치 |
|---|---|
| 0009/0010 적용 실패 | transaction 단위라 아무것도 바뀌지 않는다. 원인을 확인하고 재시도한다 |
| push 후 sync `storage_failed` 급증 | 0009 미적용이다. ③을 실행한다. 코드 revert는 필요 없다 |
| 홈이나 검색이 느려짐 | 0010 적용 여부를 확인한다 |
| 화면 오류 | `git revert <range>` 후 push. migration은 되돌리지 않아도 된다(이전 코드와 호환) |

## 4. 운영 영향 요약

- **GitHub core/search 요청 수:** 바뀌지 않는다.
- **raw read:** 저장소당 상한이 400에서 600으로 늘었다.
- **Neon:** 행 1개와 index 1개가 추가된다.
- **Vercel:** 상세 화면 query가 최대 2개 늘지만 병렬로 실행된다. 함수 호출 수는 바뀌지 않는다.
- **비용:** 새 유료 서비스나 AI API는 없다.

## 5. 남은 위험 (우선순위순)

1. **(높음) 배포 순서.** 0009보다 코드가 먼저 나가면 Subagent가 있는 저장소의 갱신이 멈춘다. 리허설로 확인했다.
2. **(중간) 큰 저장소의 실행 시간.** 600 파일 저장소는 raw read가 1.5배로 늘어, 한 번의 Sync가 처리하는 저장소 수가 줄 수 있다. 운영에서 측정하지 않았다.
3. **(중간) 실제 Subagent 본문의 파싱 품질.** fixture에는 본문이 없고 합성 본문으로만 검증했다. 첫 Sync 후 `partial` 비율을 봐야 한다.
4. **(중간) 50k 이상 규모.** 홈과 browse가 약 250ms이고, fuzzy가 0건일 때 400ms다. 개선하려면 구조를 바꿔야 한다(listed 파생 저장). 운영 규모는 확인하지 않았다.
5. **(낮음) Vercel Production Branch 설정 미확인, Phase 3의 2026-10-19 원인 미상 실패 기록.** Phase 3 보고서에서 그대로 이어지는 위험이다.
6. **(낮음) 중간 commit이 각각 green인지는 검증하지 않았다.** 최종 트리만 검증했다.

## 6. 권장 Commit 구성

한 번의 push로 올린다. 아래 순서를 권장하며, 중간 commit의 green 여부는 NOT VERIFIED다.

```bash
# 실행 위치: ~/workspace_auto/agentdock
git add drizzle/0009_subagent_type.sql drizzle/0010_version_content_hash_idx.sql \
  drizzle/meta/0009_snapshot.json drizzle/meta/0010_snapshot.json drizzle/meta/_journal.json \
  src/db/schema.ts scripts/migrate.mjs
git commit -m "feat(db): add the agent artifact type and index package_version.content_hash (0009, 0010)"

git add src/detect/agent.ts src/detect/agent.test.ts src/detect/index.ts src/detect/skill.test.ts \
  src/analyze/declared.ts src/github/scan.ts src/ingest/pipeline.test.ts \
  src/components/ArtifactBadge.tsx src/components/Icon.tsx src/app/globals.css \
  src/components/IndexFlow.tsx src/components/IndexFlow.test.tsx
git commit -m "feat(detect): detect Claude Code subagents and raise the file cap to 600"

git add src/db/queries/search.ts src/db/queries/search.eval.test.ts src/components/typeFilters.ts
git commit -m "feat(search): filter by subagent, rank path queries by path, pin an evaluation set"

git add "src/app/r/[owner]/[repo]/[...path]/page.tsx" src/components/usageGuide.ts \
  src/db/queries/packages.ts src/db/queries/packages.test.ts src/ingest/persist.ts
git commit -m "feat(ui): show related plugin components, stored versions and a usage note per type"

git add src/ingest/reanalyze.ts src/ingest/reanalyze.test.ts src/corpus/seedList.test.ts
git commit -m "fix(ingest): backfill latest versions first; guard seeds against rejected entries"

git add README.md README.en.md docs/analysis/
git commit -m "docs: Phase 4-7 analysis, runbook additions and README for subagents"
```

## 7. 사용자 결정이 필요한 항목

1. 404 장기 정책: A(현행), B(N회 404 후 delist, migration 필요), C(표시만 추가). 권장은 C다.
2. Subagent Discovery: topic `subagents` 추가 여부(22개 신규, 잡음 포함). 또는 `VoltAgent/awesome-claude-code-subagents`를 seed로 추가할지(사전에 tree 확인 필요).
3. 다음 형식 확장 순서: Gemini extension(필수 필드 확인 필요), Cursor rules(artifact 경계 정의 필요), `.cursor/.codex/agents`(필수 필드 규칙이 다름).
4. trigram 임계값 재검토: 운영 검색 로그를 수집한 뒤에 할지.
