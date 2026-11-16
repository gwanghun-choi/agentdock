# Phase 98 — 2026-11-15 예약 Sync 실패 (SQLSTATE 53100)

작성 2026-11-16, 기준 `16e14bb`(develop, 운영 web `f6cf179`). 분석만 했다. 운영 DB 접속·쓰기, Sync 실행, 요금제 변경, commit/push/deploy는 하지 않았다. 운영에 보낸 요청은 GitHub API 읽기와 홈 GET 1회뿐이다.

표기: **FACT**는 로그·소스·HTTP 응답으로 확인한 사실, **INFERENCE**는 근거가 있는 추론, **UNVERIFIED**는 운영 DB나 Neon 콘솔이 있어야 확인할 수 있는 항목이다.

## 1. 대상 Run

| 항목 | 값 |
|---|---|
| Run | `43768074098` (job `132977552763`), schedule, head `16e14bb` |
| 시각 | 생성 2026-11-15 22:13:21Z, 종료 22:24:20Z, sync 635s |
| 결과 | `status=FAILED processed=54 ingested=47 failed-stages=drain`, exit 1 |
| 직전 Run | `43717136582` (13:05Z) COMPLETED, `held=86066`, home snapshot published |
| migrate gate | `12 applied, 0 pending — UP_TO_DATE` |

registry·seeds·links·search·fan-out·refresh 단계(22:13–22:18)는 모두 쓰기에 성공했다. drain 단계에서 job 9940–9991이 정상 처리됐다. 실패는 drain 마지막 8초에 몰려 있다.

```
22:23:46  9991 rodydavis/agent-skills-generator  no_artifacts           (마지막 정상 쓰기)
22:23:52  9992 fallow-rs/fallow-skills           storage_failed 53100  → scheduleRetry 성공
22:23:56  9993 da7-tech/sureforge                storage_failed 53100  → scheduleRetry 성공
22:24:00  9994 joeseesun/qiaomu-codex-imagegen   storage_failed 53100  → scheduleRetry의 INSERT ingest_attempt 실패
          → 예외가 runJob → drainQueue를 지나 stage=drain FAILED
          → "home snapshot kept, not refreshed: the run failed (drain)"
```

**FACT:** 2026-10-19 이후 Sync 59회의 로그 가운데 `53100`이 나온 것은 이번 Run이 처음이다. 이전의 `storage_failed`는 `54000`(tsvector 길이, Phase 92) 3건이었다.

## 2. 소스 경로 (FACT)

1. `src/ingest/pipeline.ts` `ingestRepository`: `persistScan`(artifact 트랜잭션)이 throw하면 catch에서 `toIngestOutcome`가 GitHubError가 아닌 모든 예외를 `storage_failed`로 바꾼다(`src/ingest/errors.ts:109`, `:124`). 로그에는 `errorCode()`가 SQLSTATE만 남긴다. 메시지에 값이 섞일 수 있어서 의도적으로 뺐다(`errors.ts:98-102`).
2. `src/ingest/worker.ts` `runJob`: `storage_failed`는 `retryable`이다(`retry.ts:52`). `attempts < MAX_ATTEMPTS(3)`이면 `scheduleRetry`를 부른다(`jobs.ts:227`). 이 함수는 트랜잭션 안에서 `INSERT ingest_attempt`와 `UPDATE ingest_job`을 한다.
3. 9994는 2번의 INSERT가 실패했다. `runJob`에는 catch가 없으므로 예외가 `drainQueue`를 지나 `stage('drain')`에서 잡혔다. `onRun`은 job이 끝난 뒤에만 불리므로 9994는 `processed=54`에 들어가지 않는다(9940–9993 = 54건).
4. 9994의 트랜잭션은 롤백됐다. `claimJob`이 별도 문장으로 커밋한 `status='running'`, `started_at`, `attempts+1`(`jobs.ts:124-131`)은 그대로 남았다. `reapAbandoned`는 attempts를 되돌리지 않는다(`jobs.ts:155`). 다음 Run의 `reapAbandoned(REAP_AFTER_MS)`(`corpus-sync.mjs:709`)가 이 job을 큐로 되돌린다. attempt 기록은 없다.
5. drain이 실패했으므로 `corpus-sync.mjs:802`의 조건이 거짓이 되어 `publishHomeSnapshot`은 실행되지 않았다. `sync:last_success`(`:831`, `:842`)도 갱신되지 않았다.
6. 요약이 실제와 다르게 찍혔다. drain이 throw했는데도 `Drain stopped by  its cap or an empty queue`(`corpus-sync.mjs:318-319`)와 `Jobs still queued  not measured (no drain)`(`:308`)이 출력됐고, `sync:last_attempt`에는 `drainStoppedBy=null`이 기록됐다(`:851-873`).

## 3. 53100의 실제 의미

**FACT:** SQL 오류 원문(`error.cause.message`)은 로그에 남지 않았다. 로그에 있는 것은 `errorCode:"53100"`과 drizzle의 `Failed query: insert into "agentdock"."ingest_attempt" ... params: 9994,...`뿐이다. 원문을 다시 얻을 방법은 없다(Actions 로그가 유일한 사본이다).

**INFERENCE (강함): 물리 디스크가 아니라 Neon project storage 한도에 걸렸다.**

- Neon은 compute와 storage가 분리되어 있다. 테이블 파일을 키워야 할 때(relation extend) project의 logical size가 한도를 넘었으면 `could not extend file because project size limit (N MB) has been exceeded`를 SQLSTATE 53100(`disk_full`)으로 반환한다. Neon 커뮤니티에 같은 문구의 사례가 여럿 있다.
- 9992와 9993은 artifact 트랜잭션(행이 많아 새 페이지가 필요하다)에서 실패했다. 그런데 바로 뒤의 작은 `ingest_attempt` 한 행은 기존 페이지의 빈 공간에 들어가 성공했다. 9994 차례에는 `ingest_attempt`의 마지막 페이지도 가득 차서 extend가 필요했고 실패했다. "extend할 때만 실패한다"는 동작과 일치한다. 디스크가 실제로 가득 찼다면 WAL 쓰기부터 실패하므로 이런 선별적 성공은 나오기 어렵다.
- **FACT:** 9994 실패 뒤에 실행된 `recordSyncAttempt`(schema_meta 한 행 upsert, `syncState.ts:116-122`)는 성공했다. 실패했다면 `could not record sync:last_attempt`(`corpus-sync.mjs:880`)가 찍혔을 텐데 로그에 없다. 이미 있는 페이지 안에서 끝나는 쓰기는 한도를 넘은 뒤에도 성공한다는 위 설명과 맞는다.
- 실패 직후에도 같은 프로세스의 `countPackages()`(읽기)는 성공했다. 지금 운영 홈 GET도 200이다. Neon 문서는 "storage 한도에 걸려도 compute는 살아 있고 조회·pg_dump는 되지만 쓰기는 실패한다"고 설명한다.

기각한 다른 원인:

| 후보 | 기각 근거 |
|---|---|
| `temp_file_limit` | SQLSTATE가 53400이다. |
| 행 크기·tsvector 한계 | 54000 계열이다(Phase 92에서 본 것). |
| compute 로컬 디스크(정렬 spill) | 실패한 문장이 1행 INSERT다. |
| 일시적 장애 | 이 경우 연속 3건이 아니라 08xxx나 57P01 계열이 나온다. |

**UNVERIFIED:** 현재 요금제와 한도 값. 하드 한도에 걸렸다는 것은 Free 플랜일 가능성이 높다는 뜻이다(Launch/Scale은 storage에 하드 한도가 없다). Neon은 2026-10-02부터 Free 한도를 project당 0.5 GB에서 1 GB로 올렸다. Neon 콘솔 Usage 화면에서 확인해야 한다.

## 4. 저장 공간 현황과 증가 추세

**FACT (Sync 로그의 `held=`, 전체 artifact 수):**

| 시점 | held | 비고 |
|---|---:|---|
| 10-19 | 130 | |
| 10-25 | 22,560 | |
| 11-01 | 45,621 | |
| 11-08 12:21 | 66,040 | |
| 11-15 13:05 | 86,066 | 마지막 성공 |
| 11-15 22:13 | 86,976 | 실패 Run (+910) |

- 최근 7.4일 동안 +20,936개, 하루 약 2,830개다. Run마다 1,000–2,500개씩 늘었다.
- **FACT:** 보존 기간이나 정리 경로가 없다. 소스 전체에서 `.delete(` 호출은 `reanalyze.ts`의 capability_finding 재작성 하나뿐이다. `ingest_job`, `ingest_attempt`, `repo_seed`, 과거 `package_version`은 계속 쌓이기만 한다.
- 대기열 `still-pending=33008`과 `not-reached=2560`을 보면 앞으로도 같은 속도로 늘어날 수 있다.

**INFERENCE:** 한도를 1 GB로 보면 artifact당 전체 비용(본문 32 KB excerpt의 TOAST, frontmatter jsonb, capability_finding, tsvector GIN, trgm GIN, 이력 테이블)은 약 11–12 KB다. 지금 속도면 하루 약 30 MB, 한 달 약 1 GB가 늘어난다. 0.5 GB 한도였다면 훨씬 일찍 실패했을 것이므로 1 GB 한도(Free) 가설과 맞는다.

**UNVERIFIED:** 테이블·인덱스별 크기, dead tuple, 다른 스키마가 쓰는 용량. 확인용 SQL은 `docs/analysis/phase98-artifacts/readonly-53100-diagnosis.sql`이다. 모두 SELECT이고 `begin read only … rollback` 안에서 실행된다. 임시 PostgreSQL 17에 0000–0011을 적용해 9개 쿼리가 모두 오류 없이 실행되는 것을 확인했다. 운영에서는 실행하지 않았다.

실행 순서(로컬 터미널, 사람이 실행):

```bash
# agentdock 저장소 루트에서
DATABASE_URL='<Neon direct URL>' AGENTDOCK_TARGET_FINGERPRINT='<pin>' bun run ops:preflight --production
PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=30000' \
  psql '<같은 direct URL>' -X -v ON_ERROR_STOP=1 -f docs/analysis/phase98-artifacts/readonly-53100-diagnosis.sql
```

## 5. 데이터 손상 여부

- **FACT:** 성공 47건(stored 합계 910)은 각자의 `persistScan` 트랜잭션에서 커밋됐다. 실패 직후의 `held=86976`이 직전 Run의 `86066`보다 정확히 910 많다.
- **FACT:** 실패 3건은 트랜잭션 단위로 롤백됐다(`Nothing was saved`). 일부만 쓰인 artifact는 없다.
- **FACT:** 홈 snapshot 유지 정책이 의도대로 동작했다. 운영 `/`(commit `f6cf179`)는 `71,286`과 `last sync without errors 2026-11-15 13:30 UTC`를 보여 준다. 이는 직전 성공 Run이 게시한 `listed=71286`과 같다. 실패 Run이 셌던 72,163은 게시되지 않았다.
- **INFERENCE:** job 상태는 9992·9993이 `queued`(attempts 1, 1분 backoff, attempt 행 1건), 9994가 `running`(attempts 1, attempt 행 0건)일 것이다. SQL Q6·Q8로 확인한다.

**재시도 위험 (P0-1을 하는 진짜 이유):**

- drain은 처음으로 종결 쓰기가 실패한 job에서 throw로 끝난다. 그래서 한 Run에 attempt를 날리는 job은 보통 맨 앞의 몇 개뿐이다. 반면 `claimJob`에는 attempts 상한 조건이 없어서(`jobs.ts:104-110`), 같은 job이 Run마다 attempts를 1씩 더 쓴다.
- 9992–9994는 모두 처음 들어온 저장소다. attempts가 3에 닿은 뒤 `finishJob('failed')`가 한 번이라도 커밋되면, fan-out은 상태와 관계없이 `ingest_job` 행이 있는 seed를 제외하므로(`seeds.ts:115-117`) **그 저장소는 discovery에서 영구히 빠진다.** 한도를 푼 뒤에도 attempts가 이미 3 이상이면, 일시적 실패가 한 번만 나도 재시도 없이 바로 failed로 끝난다.
- registry와 seed upsert도 extend가 필요하면 실패한다(이번 Run에서는 성공했다). 다음 예약은 2026-11-16 06:00 UTC다(실제 시작은 보통 1–7시간 늦다).

## 6. 해결 방안 비교

중요한 제약: Neon 문서에 따르면 한도에 걸린 상태에서는 **DELETE도 실패한다**. 따라서 데이터 정리로 즉시 복구할 수 없다. 즉시 복구 수단은 한도를 늘리는 것뿐이다.

| 방안 | 즉시 효과 | 비용·영향 | 판단 |
|---|---|---|---|
| A. 스토리지 증설 (Launch 전환) | 즉시 | storage $0.35/GB-month, 최소 요금 없음. 현재 약 1 GB면 월 약 $0.35. Free의 compute 100 CU-h가 없어지므로 compute 사용량 과금이 더 크다(UNVERIFIED, 콘솔 Usage 필요). | **P1, 유일한 즉시 해결책** |
| B. 불필요한 증가 방지 | 없음 | 코드 변경이 필요하다. `ingest_attempt`는 job당 최신 행만 화면에 쓴다. | Q2 측정 후 |
| C. 보존 기간 정책 | 없음 (공간을 확보하려면 VACUUM이 필요하고 Neon에서는 반영이 늦다) | 끝난 `ingest_job`/`ingest_attempt`를 N일 뒤 삭제하는 것은 위험이 낮다. 과거 `package_version`은 "Provenance is exact or absent"와 관련된 결정이라 별도 승인이 필요하다. | 설계 phase |
| D. 저장 구조 최적화 | 없음 | 본문 excerpt 32 KB 축소는 제품 결정이다. `SET COMPRESSION lz4`는 새 행에만 적용된다. | 측정 후 |
| E. 인덱스 용량 최적화 | 없음 | `idx_scan=0` 인덱스와 `package_version_content_hash_idx`(64자 hex text btree) 크기를 Q3로 확인한다. REINDEX·DROP은 승인 사항이다. | 측정 후 |
| F. 실패 이력 기록 안정성 | 재발 시 피해 축소 | §7 참고. | 코드 변경, 별도 phase |

## 7. 재발 방지

1. **용량 관찰:** Sync summary에 `pg_database_size`(현재 database 하나만 잰다. project 한도와 비교하려면 Neon logical size가 필요하다) 한 줄을 추가하고, 한도의 80%와 90%에 notice를 낸다. 지금까지 59회 Run 동안 용량은 한 번도 출력되지 않았다. 원칙은 "상한에 걸리면 무엇을 남겼는지 말한다"인데, 용량 상한은 그 원칙의 사각지대였다.
2. **53xxx fail-fast:** drain에서 `storage_failed`의 SQLSTATE가 class 53(자원 부족)이면 다음 claim을 멈춘다. 새 `DrainStop` 값(`worker.ts:130`)과, 남긴 job 수를 밝히는 `INCOMPLETE` 줄을 함께 둔다. 이번에는 9992 이후 9993·9994가 attempt를 하나씩 더 썼다. 한계: 첫 job의 종결 쓰기 실패(9994 유형)는 이 방법으로 막지 못한다.
3. **종결 쓰기 실패 처리:** `scheduleRetry`/`finishJob` 실패가 drain 전체를 throw로 끝내는 것은 fail-closed라 옳다. 다만 그 job은 `REAP_AFTER_MS`까지 `running`에 묶인다. 실패 job id와 SQLSTATE를 한 줄로 남긴다. 주의: `stage()`는 지금도 drizzle `error.message`를 `params:`까지 그대로 출력한다(`corpus-sync.mjs:184`, 이번 로그 260-263줄). 이번에는 params가 고정 문구였을 뿐이다. 이 경로도 `errors.ts`의 "never the message" 원칙과 맞춰야 한다.
   - **요약 정정:** drain이 throw하면 `Drain stopped by`에 `failed`를 찍고, queued는 `not measured (drain failed)`로 표시해 `sync:last_attempt`에도 그대로 남긴다. 지금은 "cap에 걸렸거나 큐가 비었다"고 잘못 말한다.
4. **원문 확보:** class 53의 메시지에는 값이 들어가지 않는다. 이 class만 `cause.message`의 앞 120자를 로그에 남기는 것을 검토한다. 이번에 원문이 없어 추론에 의존했다. `errors.ts:98-101`의 원칙에 예외를 두는 결정이므로, 근거를 같은 자리의 주석에 남긴다.
5. **보존 정책:** §6 C를 GSD phase로 설계한다. 측정(Q2·Q3) → 결정 → migration 순서로 진행한다.

## 8. 복구 절차 (우선순위)

| 순서 | 작업 | 확인 | 승인 |
|---|---|---|---|
| P0-1 | 다음 예약(11-16 06:00Z) 전에 Sync 일시 중지: 먼저 `gh run list --workflow sync.yml`로 실행 중인 run이 없는지 본 뒤 `gh workflow disable sync.yml`. disable은 진행 중인 run을 취소하지 않는다. 이미 돈 run이 있으면 Q6 기대값이 달라진다 | `gh workflow list`에서 disabled 확인 | **필요** |
| P0-2 | Neon 콘솔에서 플랜, storage 사용량/한도, 다른 스키마 사용량 확인 | 스크린샷이나 수치 | 콘솔 읽기 |
| P0-3 | 읽기 전용 SQL 키트 실행(ops:preflight PASS 후) | Q1–Q9 결과 기록 | 사람이 실행 |
| P1 | 한도 증설(Launch 전환 등) | 콘솔에서 한도 해제 확인 | **필요** |
| P2 | Sync 재개(`gh workflow enable`). 첫 실행은 예약 또는 운영자의 workflow_dispatch | Status `COMPLETED`, `home snapshot published`, `returned 1 abandoned job(s)` | **필요** |
| P3 | 정합성 확인 | Q6: 9992–9994가 succeeded 또는 queued이고 running 0, failed 0, attempts ≤ 3. Q8: 47행 모두 저장됨. `bun run quality:check` exit 0. 홈의 listed가 72k 이상이고 last sync가 갱신됨 | 사람이 실행 |
| P4 | §7 재발 방지와 §6 B–E를 별도 phase로 진행 | 측정치와 함께 설계 | 별도 |

## 9. 별도 승인이 필요한 작업

- Sync 워크플로 비활성화·재활성화, workflow_dispatch 수동 실행
- Neon 요금제 변경과 그에 따른 비용 발생
- 운영 DB 쓰기 전부: 데이터 삭제, 보존 정책 적용, 인덱스 DROP, REINDEX, VACUUM(FULL 포함), 압축 방식 변경 migration
- 본문 excerpt 상한(32 KB) 변경과 과거 `package_version` 보존 여부(provenance 정책)
- 코드 변경(§7)의 commit·push·deploy

## 출처

- Neon 2026-10-02 changelog: Free 1 GB/project — https://neon.com/docs/changelog/2026-10-02
- Neon Plans: 한도 초과 시 쓰기 실패와 읽기 유지, Launch $0.35/GB-month, paid storage 무제한 — https://neon.com/docs/introduction/plans
- 같은 오류 문구의 사례 — https://community.n8n.io/t/could-not-extend-file-because-project-size-limit-512-mb-has-been-exceeded/222076
