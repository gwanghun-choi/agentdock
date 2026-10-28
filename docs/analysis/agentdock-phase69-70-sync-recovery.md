# AgentDock Phase 69–70 — Sync 복구 준비 (A 단계, 승인 대기)

- 작성: 2026-10-27 (UTC 05:30 전후 조사)
- 범위: A 단계(읽기 전용 조사와 복구 준비)까지다. B 단계(Phase 69 secret 교체, Phase 70 Sync 검증)는 **사용자 승인 전이라 실행하지 않았다.**
- 표기: FACT(직접 확인), INFERENCE(근거 있는 추정), PENDING(승인·운영 접근이 있어야 확인 가능), NOT RUN(실행하지 않음)
- **최종 결과(2026-10-28 00:5xZ): Phase 69 교체 완료, Phase 70 PASS.** 교체 뒤 예약 Sync 2회가 모두 COMPLETED로 끝났다(§18.4). §2–§17은 작성 당시 상태 그대로 두었다.
- 이 문서에는 연결 문자열, 비밀번호, host를 적지 않았다. fingerprint는 `user@host:port/db`의 sha256 앞 16 hex이고, Deploy 공개 로그에도 출력되는 값이다.

## 1. 기준 HEAD

| 항목 | 값 | 구분 |
|---|---|---|
| 브랜치 | `develop` | FACT |
| HEAD = origin/develop | `c821102` (docs: Phase 66–68 보고서) | FACT |
| working tree | 이 보고서 외 변경 없음 | FACT |
| 운영 배포 commit | `c821102`. Deploy 40454829318(05:21Z) success, 응답 헤더 `x-agentdock-commit=c821102…` | FACT |
| 직전 기능 commit | `2c4c7a3`(Deploy 40443671711). `c821102`는 문서만 바꿨다 | FACT |

이전 보고의 "운영 배포 commit 2c4c7a3"은 05:21Z 이후 `c821102`로 바뀌었다. Sync 코드는 같다.

## 2. 현재 Sync 상태

**FAIL — 2026-10-25 20:26Z 이후 corpus 갱신 없음.**

- 마지막 성공: 40229151309 (FACT)
- guard가 들어간 코드로 실행된 예약 Sync 2회가 모두 role 거부로 실패했다 (FACT)
- 05:29Z 기준 그 뒤의 Sync run은 없다. 실행 중인 workflow도 없다 (FACT, `gh run list`)
- 다음 예약 slot은 `0 6,18`의 06:00 slot이다. 최근 06:00 slot은 09:56–11:45Z에 시작됐다. secret을 그 전에 바꾸지 않으면 같은 이유로 한 번 더 실패한다. 실패해도 쓰기는 0이다 (INFERENCE)

## 3. 최신 Actions 실행 이력 (Sync workflow, 최근 10회)

| run | 시작(UTC) | trigger | commit | 결과 | 시간 | 실패 단계 / 메시지 | 데이터 처리 |
|---|---|---|---|---|---:|---|---|
| 40409047009 | 10-26 22:00 | schedule | 048023a | failure | 21 s | `bun run sync`: `Refusing to start: connected as a role other than "agentdock_app"` (exit 1). ops: role, search_path FAIL (exit 2, continue-on-error) | 없음 ("Nothing was read or written") |
| 40317405590 | 10-26 11:45 | schedule | 048023a | failure | 19 s | 같음 | 없음 |
| 40229151309 | 10-25 20:05 | schedule | 0f2cb82 | **success** | 1,242 s | — (COMPLETED) | drain 200, refresh 100 |
| 40184235414 | 10-25 10:18 | schedule | 0f2cb82 | success | 1,449 s | — | 있음 |
| 40127517179 | 10-24 19:55 | schedule | 0f2cb82 | success | 1,242 s | — | 있음 |
| 40083909354 | 10-24 09:56 | schedule | 0f2cb82 | success | 1,506 s | — (PARTIAL_CAP) | 있음 |
| 40021567316 | 10-23 20:44 | schedule | 0f2cb82 | success | 1,311 s | — (PARTIAL_CAP) | 있음 |
| 39940525800 | 10-23 10:38 | schedule | 0f2cb82 | failure | 1,241 s | registry 단계 FAILED(외부 응답 없음, 1회 재시도) | 나머지 단계는 처리됨 |
| 39853119505 | 10-22 20:56 | schedule | 3a8a3c3 | success | 1,423 s | — | 있음 |
| 39765655496 | 10-22 10:46 | schedule | 3a8a3c3 | failure | 1,064 s | registry 500 | 나머지 단계는 처리됨 |

- 수동 실행은 10-22에 2회(39716460966, 39706897344)뿐이고, 둘 다 success였다 (FACT).
- 두 실패 run 모두 schema plan(`migrate.mjs --plan --require-current`)은 `11 applied, 0 pending — UP_TO_DATE`로 PASS였다 (FACT).
- 실패 원인은 지금도 DB role 하나다. 다른 새 이슈는 없다 (FACT). 10-22·10-23의 registry 실패는 별개의 외부 장애이고, guard 이전 일이다.

## 4. 장애 원인

| 항목 | 내용 | 구분 |
|---|---|---|
| 직접 원인 | repository secret `DATABASE_URL`의 username이 `agentdock_app`이 아니다. `assertSchemaIsolation`이 `current_user`를 확인해 거부한다 | FACT (로그와 코드) |
| guard 위치 | `scripts/corpus-sync.mjs:151-152` → `src/db/client.ts:67` `assertSchemaIsolation`. 요구 role은 `AGENTDOCK_ROLE='agentdock_app'`(`src/db/schema.ts:43`) | FACT |
| guard 도입 | `5bf8450`. 그 전 6회는 같은 secret으로 수집하면서 ops에서만 role FAIL이 났다 | FACT |
| search_path FAIL | `ALTER ROLE agentdock_app SET search_path = agentdock`(VERCEL_DEPLOY.md bootstrap)가 다른 role에는 적용되지 않기 때문이다 | INFERENCE |
| secret 변경 이력 | `DATABASE_URL` 마지막 갱신 2026-10-22T05:28:37Z. 그 뒤로 바뀌지 않았다 | FACT (`gh secret list`, 값은 읽지 않음) |

현재 secret의 role 이름은 알 수 없다. GitHub API는 secret 값을 돌려주지 않는다. 로그에서는 role 이름이 출력되지 않게 되어 있다(`client.ts:73-74`). "agentdock_app이 아니다"까지만 FACT다. Neon 소유자 role일 가능성이 높다(INFERENCE).

## 5. DB 연결 요구사항

| # | 요구 | 근거 (소스) | 현재 secret | 구분 |
|---|---|---|---|---|
| 1 | **direct** endpoint (host에 `-pooler` 없음) | `productionTargetRejection`(`scripts/migration-gate.mjs`)과 `readOnlyTarget`(`src/db/readOnly.ts:61`)이 pooled를 거부한다. `sync.yml` 주석 | 충족. Deploy plan이 pooled를 거부하지 않고 통과했다 | FACT(간접) |
| 2 | pooler endpoint | 웹(Vercel)만 쓴다. Actions에서는 쓸 수 없다 | — | FACT |
| 3 | username = `agentdock_app` | guard, ops `connected as agentdock_app` | **불충족** | FACT |
| 4 | database | 운영 database. fingerprint의 `/db` 부분에 들어간다 | 현재 pin과 일치 | FACT(간접) |
| 5 | host/port | 같은 Neon endpoint. port가 없으면 5432로 계산한다 | 현재 pin과 일치 | FACT(간접) |
| 6 | SSL | 코드에서 강제하지 않는다. Neon 연결 문자열 기본값(`sslmode=require`)을 그대로 쓴다 | 확인 불가 | PENDING |
| 7 | schema | `DATABASE_SCHEMA=agentdock`(workflow env). `agentdock`과 `agentdock_test`만 허용한다(`migrate.mjs:40`) | 충족 | FACT |
| 8 | search_path | 정확히 `agentdock`. startup parameter와 role 기본값이 함께 정한다 | **불충족**(role 기본값 미적용) | FACT(ops) |
| 9 | 권한 | `agentdock` schema와 11개 테이블의 소유자여야 한다. NOCREATEDB이고 database에 대한 CREATE 권한은 없다(`migrate.mjs:4-21`) | 새 URL로 확인 필요 | PENDING |
| 10 | 운영과 로컬의 차이 | 웹은 Vercel의 `DATABASE_URL`(agentdock_app pooled)을 쓰고, boot할 때마다 guard를 통과한다(운영 200). Actions의 secret은 이것과 별개다 | — | FACT(간접) |

**공유 secret 주의 (FACT, `deploy.yml`):** repository secret `DATABASE_URL` 하나를 Sync(`sync.yml`)와 Deploy의 migrate 단계가 함께 쓴다. 교체하면 Deploy가 migration을 실행하는 role도 `agentdock_app`으로 바뀐다. 원래 의도한 구성이 이것이다(`migrate.mjs:4` "Applies the reviewed migrations … as agentdock_app"). 다만 10-22 이후 migration은 다른 role로 실행됐을 수 있어서, 소유권 검사(§8 step 3)가 필요하다.

## 6. Secret 변경 계획

| 대상 | 범위 | 현재 | 변경 후 |
|---|---|---|---|
| A. `DATABASE_URL` | repository secret (Sync와 Deploy 공용) | agentdock_app이 아닌 role의 direct URL (2026-10-22T05:28:37Z) | `agentdock_app`의 **direct** URL. Neon console의 같은 프로젝트, 같은 branch, 같은 database |
| B. `AGENTDOCK_TARGET_FINGERPRINT` | `production` environment 변수 (repository 변수에는 없음) | `54680e3e225b4bf4` (2026-10-22T05:18:58Z) | 새 URL로 계산한 16 hex |

새 URL을 만드는 방법:
- Neon console → 프로젝트 → Connect → role `agentdock_app`, database는 운영 database, **Connection pooling 끔**으로 문자열을 복사한다.
- 같은 role의 pooled 문자열(Vercel `DATABASE_URL`)에서 host의 `-pooler`만 뺀 것과 같아야 한다. 비밀번호는 같다 (INFERENCE, Neon 명명 규칙).
- 비밀번호를 새로 설정(`\password agentdock_app`)하면 **Vercel 웹이 즉시 끊긴다.** 하지 않는다.

## 7. Fingerprint 계산 방법

구현(FACT, `scripts/migration-gate.mjs:184-188`):

```js
const id = `${decodeURIComponent(u.username)}@${u.hostname.toLowerCase()}:${u.port || '5432'}${u.pathname}`;
return createHash('sha256').update(id).digest('hex').slice(0, 16);
```

| 확인 사항 | 결과 |
|---|---|
| username 포함 | **포함**(percent-decode). role이 바뀌면 fingerprint도 바뀐다 |
| host / port / database | 포함. host는 소문자, port가 없으면 `5432`, `pathname`(`/dbname`) |
| password | 제외 |
| query (`sslmode` 등) | 제외 |
| 해시 | sha256 hex 앞 16자 |
| 비교 위치 | `productionTargetRejection` ← `migrate.mjs --production`(Deploy plan·migrate·verify), `ops.mjs --production` |
| 불일치 시 | `Refusing the production target: its fingerprint X does not match the pinned Y.` → exit 1. Deploy가 BLOCKED되고 운영 웹은 이전 배포를 계속 서비스한다(fail-closed) |
| Sync에서 | **비교하지 않는다.** `sync.yml`은 pin을 넘기지 않는다. 그래서 pin이 틀려도 Sync는 막히지 않고, Deploy만 막힌다 |

로컬 계산 절차(값은 화면과 history에 남기지 않는다). 실행 위치는 `~/workspace_auto/agentdock`이다.

```zsh
read -rs "DATABASE_URL?agentdock_app direct URL: "; echo; export DATABASE_URL DATABASE_SCHEMA=agentdock
bun --no-env-file scripts/migrate.mjs --fingerprint        # → "target fingerprint <16 hex>". 연결하지 않는다(migrate.mjs:103-106)
```

`--no-env-file`이 필요하다. 붙이지 않으면 Bun이 `.env`를 읽는다. 다만 export한 값이 이기므로 결과는 같다. 그래도 `.env`를 섞지 않는 것이 원칙이다.

## 8. Guard / Migration Gate / Ops 사전 검증 (운영자 로컬, 읽기 전용)

Claude는 운영 DB 자격증명이 없고, 쓸 권한도 받지 않았다. 아래는 모두 **PENDING(운영자 실행)**이다. 같은 셸에서 §7에 이어 실행한다.

**대상 DB 동일성은 별도로 확인해야 한다.** §7의 새 fingerprint는 새 URL에서 계산한 값이다. 이 값을 같은 URL과 비교하면 항상 일치하므로, 대상 database가 맞는지는 알 수 없다. Neon의 다른 branch에도 `agentdock_app` role, 비밀번호, 11건의 history가 그대로 복제된다. 그래서 step 1–3만으로는 잘못된 branch를 잡지 못한다. Sync는 pin을 비교하지 않으므로, 잘못된 branch에 조용히 쓰게 된다. step 0a·0b는 독립된 기준인 이전 pin과 운영 화면을 근거로 이 문제를 막는다.

| step | 명령 | 기대 | 확인 대상 | 쓰기 |
|---|---|---|---|---|
| 0a | `read -r "OLD_USER?이전 secret의 role 이름: "; export OLD_USER` 후 `bun --no-env-file -e 'const { targetFingerprint } = await import("./scripts/migration-gate.mjs"); const u = new URL(process.env.DATABASE_URL); u.username = process.env.OLD_USER; console.log(targetFingerprint(u.href) === "54680e3e225b4bf4" ? "SAME TARGET" : "DIFFERENT TARGET");'` | `SAME TARGET` (연결 없음. 출력은 판정 한 단어뿐) | 새 URL의 host·port·database가 현재 운영 pin과 같은지 | 없음 |
| 0b | `bun --no-env-file scripts/ops.mjs status` (step 1 통과 후) | 마지막 성공 sync 시각이 운영 홈의 "last sync without errors"와 같다(2026-10-25 20:26Z 전후) | 운영 데이터와 같은 database인지 | 없음(read-only 세션) |
| 1 | `bun --no-env-file scripts/ops.mjs preflight --production` (앞에 `AGENTDOCK_TARGET_FINGERPRINT=<§7 출력값>`) | 7줄 모두 PASS: pool, read-only ×2, statement_timeout, **connected as agentdock_app**, **search_path is exactly agentdock**, 쓰기 거부 25006 | role, search_path, direct, fingerprint | 없음(read-only 세션) |
| 2 | `AGENTDOCK_TARGET_FINGERPRINT=<새 값> bun --no-env-file scripts/migrate.mjs --plan --production --require-current` | `target fingerprint <새 값>` / `agentdock: 11 applied, 0 pending, 11 on disk — UP_TO_DATE` | 올바른 database(history 11건), pending DDL 없음 | 없음 |
| 3 | Phase 35–37 §11 (b) 소유권 query(`sql.begin("read only", …)`) | `{"role_ok":true,"tables":11,"not_owned":0,"no_dml":0}` | 10-22 이후 다른 role이 만든 객체가 없는지 | 없음(read-only transaction) |
| 4 | (승인 후, 같은 셸) `printf '%s' "$DATABASE_URL" \| gh secret set DATABASE_URL` → 이어서 `gh variable set AGENTDOCK_TARGET_FINGERPRINT --env production --body <§7 출력값>` | `✓ Set Actions secret` / `✓ Updated variable` | **검증한 값을 그대로 등록한다.** 다시 붙여넣지 않는다. `printf`는 셸 builtin이라 history와 프로세스 목록에 값이 남지 않는다 | GitHub |
| 5 | `unset DATABASE_URL DATABASE_SCHEMA AGENTDOCK_TARGET_FINGERPRINT OLD_USER` | — | — | — |

판정 규칙:
- step 0a가 `DIFFERENT TARGET`이면 다른 endpoint나 database다. **중단한다.** 이전 role 이름을 틀렸을 수도 있으니 먼저 그것을 확인한다.
- step 0b의 시각이 운영 홈과 다르면 다른 branch다. **중단한다.**
- step 1에서 role FAIL이면 URL의 role이 틀린 것이다. **중단한다.**
- 인증 실패(`error code 28P01`/`28000`)이면 비밀번호나 role 이름이 틀린 것이다. **중단한다.**
- step 2에서 `history:` 문제가 나오거나 applied ≠ 11이면 다른 database다. **중단한다.**
- step 3의 `no_dml`은 검증력이 약하다. `has_table_privilege`에 권한을 쉼표로 나열하면 그중 하나만 있어도 true가 된다. 판정 근거는 `not_owned=0`이다(소유자는 모든 DML 권한을 가진다).
- step 3에서 `not_owned>0`이면 교체하지 않는다. 소유권 이전(`ALTER … OWNER TO`)은 운영 DDL이라 별도 승인 사항이다.
- step 1에서 role·search_path는 PASS이고 read-only 계열만 FAIL이면 Neon이 `options`를 버리는 것이다. Sync는 동작하지만 health summary가 "Not available"이 된다(Phase 35–37 §12 E). 교체해도 된다.

0008–0010은 기존 테이블에 대한 ALTER와 INDEX뿐이라 `not_owned=0`일 가능성이 높다(INFERENCE, Phase 35–37 §11). VERCEL_DEPLOY.md bootstrap은 소유자 role을 `agentdock_app`의 member로 만든다(`GRANT agentdock_app TO <owner role>`). 그래서 소유자 role로 실행한 ALTER가 성공했을 수 있다.

## 9. Migration Gate (현재)

- 최신 Deploy 40454829318(`c821102`): `target fingerprint 54680e3e225b4bf4`, `11 applied, 0 pending, 11 on disk — UP_TO_DATE`가 plan과 verify에서 두 번 나왔다 (FACT).
- 디스크의 migration은 0000–0010, 11개다. 마지막 migration 파일은 `28730e9`(10-22 01:31Z)에 들어왔다 (FACT).
- 교체 후 첫 Deploy부터 plan·migrate·verify를 `agentdock_app`으로 실행한다. pending이 0이면 migrate는 아무 일도 하지 않는다 (FACT, `deploy.yml` 주석·`migrate.mjs`).

## 10. Ops 검사

| 검사 (`src/db/readOnly.ts:134-149`) | 40229151309 (e4c2773 이전) | 40409047009 (현재 코드) | 교체 후 기대 |
|---|---|---|---|
| pool 연결 열기 | PASS | PASS | PASS |
| default_transaction_read_only | FAIL | PASS | PASS |
| transaction_read_only | FAIL | PASS | PASS |
| statement_timeout | FAIL | PASS | PASS |
| connected as agentdock_app | FAIL | **FAIL** | PASS |
| search_path is exactly agentdock | FAIL | **FAIL** | PASS |
| 쓰기 거부(25006) | FAIL | PASS | PASS |

위 표는 FACT다(ops는 FAIL만 출력하므로 FAIL이 출력되지 않은 항목을 PASS로 판정했다). 교체 후 7/7은 PENDING이다.

## 11. 승인 필요 작업

| # | 작업 | 실행 주체 | 쓰기 대상 | 승인 |
|---|---|---|---|---|
| P69-1 | §7–§8 로컬 사전 검증(읽기 전용) | **운영자**(자격증명 입력 필요) | 없음 | 운영자 판단. Claude는 자격증명을 받지 않는다 |
| P69-2 | 이전 secret 값 보관 확인(§14) | 운영자 | 없음 | — |
| P69-3 | `DATABASE_URL` secret 교체. §8 step 4처럼 검증한 셸에서 바로 등록한다 | 운영자 | GitHub secret | **필요** |
| P69-4 | `AGENTDOCK_TARGET_FINGERPRINT` 교체(production env). §8 step 4 | 운영자, 또는 승인 시 Claude(값은 hash라 secret이 아니다) | GitHub variable | **필요** |
| P69-5 (선택) | Deploy `workflow_dispatch`로 Actions 안에서 새 pin과 `agentdock_app` 권한을 검증한다. `ALREADY_DEPLOYED` 경로라 plan → migrate → verify → smoke만 실행되고 Vercel 배포는 없다 | 승인 시 Claude | migrate는 0 pending이어도 `CREATE TABLE IF NOT EXISTS`(이력 테이블, `migrate.mjs:167`)와 `artifact_type` `INSERT … ON CONFLICT DO NOTHING`(`migrate.mjs:250-264`)을 실행한다. 바뀌는 행은 없고, 그 권한이 있는지 검증하는 효과가 있다 | **필요** |
| P70-1 | 다음 예약 Sync 관찰 | Claude(읽기 전용) | 없음 | 불필요 |
| P70-2 (조건부) | 예약을 기다리지 않는 수동 Sync `workflow_dispatch` | 승인 시 Claude | corpus 전체(정규 Sync와 같음) | **별도 승인** |
| P70-3 | job 771·978 재enqueue (§13) | 운영자(자격증명 필요) | `ingest_job` 2행 INSERT | **별도 승인**, P70-1 성공 뒤 |

권장 변경 순서와 정합성 유지:
1. `gh run list --status in_progress`가 비어 있는지 확인한다. Sync와 Deploy 모두 실행 중이 아니어야 한다. 두 workflow는 concurrency group이 다르다(`sync`, `production`). 그래서 서로를 막지 않는다.
2. 교체하는 동안 develop에 push하지 않는다. push하면 CI → Deploy가 돌면서 두 값을 읽는다.
3. **secret(A)을 먼저 바꾸고, 곧바로 변수(B)를 바꾼다.** 두 값은 범위(repository/env)가 달라서 원자적으로 바꿀 수 없다.
   - A만 바뀐 사이에 실행되는 Sync는 새 role로 guard를 통과한다. Sync는 pin을 쓰지 않는다.
   - 그 사이에 Deploy가 돌면 fingerprint 불일치로 BLOCKED된다. fail-closed라 운영 웹은 영향이 없다.
   - 순서를 거꾸로 하면 그 사이 Sync는 지금처럼 거부되고, Deploy는 마찬가지로 BLOCKED된다. 위험은 같고 얻는 것이 적다.
4. **06:00 slot이 시작하기 전(이르면 09:56Z, 18:56 KST)에 끝내는 것을 권장한다.** 늦으면 guard FAIL run이 하나 더 생길 뿐, 피해는 없다.
5. 교체 확인: `gh secret list`(갱신 시각만 확인)와 `gh variable list --env production`(새 16 hex).

## 12. 실행 후 검증 계획 (Phase 69 → 70)

Phase 69 (교체 직후):

| 항목 | 방법 | 기대 | 상태 |
|---|---|---|---|
| secret 존재·갱신 | `gh secret list` | `DATABASE_URL` 시각이 교체 시각 | PENDING |
| variable 값 | `gh variable list --env production` | 새 fingerprint | PENDING |
| 값의 정합성 | P69-5 Deploy dispatch의 plan 줄 `target fingerprint` = 새 pin | 일치, UP_TO_DATE | PENDING(선택) |
| 대상 DB / role / guard / ops | §8 step 1–3(로컬) + 첫 Sync | 7/7, 11 applied | PENDING |

Phase 70 (첫 Sync):

| 항목 | 확인 위치 | 기대 |
|---|---|---|
| Schema plan | sync job 첫 단계 | `UP_TO_DATE` |
| Guard | `bun run sync` 로그 | `Refusing` 없음. 첫 stage 출력 |
| Role / search_path / ops | health summary step | `ops: FAIL` 0줄, summary 표 렌더링 |
| Fingerprint | Sync는 쓰지 않는다. 다음 Deploy(또는 P69-5) plan으로 확인 | 일치 |
| Workflow | conclusion | success (registry 같은 외부 stage 실패는 별도 판단) |
| Status | notice `status=` | `COMPLETED` 또는 `PARTIAL_*` |
| 실제 수집 | drain `drained N job(s)`, ingest 줄 outcome 합계, `refresh … enqueued=` | N>0, `storage_failed` 0 |
| Retry | registry `retried=` | 기록만 한다 |
| duration | notice | 1,242–1,506 s 범위 |
| corpus 갱신 시각 | 운영 홈 "last sync without errors"(GET), ops summary의 last run | 새 run 시각 |
| DB 변경 범위 | AgentDock 정규 Sync 경로(`agentdock` schema만) | 정규 동작 |

**Workflow success만으로는 정상화를 판정하지 않는다.** drain 처리 건수 > 0이고, 운영 홈의 마지막 sync 시각이 갱신된 것을 확인해야 Phase 70을 완료로 본다.

예약 Sync를 기다리지 못하는 경우(P70-2): 수동 dispatch는 정규 Sync와 같은 일을 한다. GitHub 예산과 Neon compute를 1회분 더 쓰고, `concurrency: sync`로 예약 run과 겹치지 않는다(뒤에 온 run이 대기한다). 사이 간격이 짧으면 두 번째 run의 refresh·fan-out 대상이 줄어든다. 별도 승인이 필요하다.

## 13. 실패 Job 771·978 상태

| 항목 | 771 | 978 | 구분 |
|---|---|---|---|
| 대상 | `elementalsouls/claude-bughunter` | `maxritter/claude-codepro` | FACT (GET `/jobs/<id>`, 05:3xZ) |
| 상태 | failed: "AgentDock read the repository but could not store the result. Nothing was saved." | 같음 | FACT |
| Attempt | 3 (terminal) | 3 | FACT |
| 요청 시각 | 2026-10-22 21:00 UTC | 2026-10-23 10:42 UTC | FACT |
| `/r/<target>` | 404 | 404 | FACT |
| 원인 | YAML `\0` escape가 U+0000으로 decode → 저장 22021 | 원문 literal NUL | FACT (Phase 35–37 로컬 재현) |
| 수정 배포 | `e4c2773`의 `replaceEscapedNul`(`src/detect/json.ts:70`)이 HEAD와 운영에 포함 | `5bf8450`·`e4c2773` | FACT |
| 자동 재처리 | 되지 않는다. failed job이 있는 저장소는 fan-out에서 빠지고, repository 행이 없어 refresh 대상도 아니다 | 같음 | FACT (코드, Phase 35–37) |
| idempotency | `enqueueJob`: queued 중 다시 enqueue하면 같은 id(부분 unique index). 저장은 `github_node_id` `ON CONFLICT`. 실패 시도는 transaction rollback | 같음 | FACT (코드), 운영 미검증 |
| 978의 이름 변경 | GitHub에서 `maxritter/qualitylayer`로 바뀌었다. 운영에 그 행이 이미 있으면 같은 행이 갱신된다 | — | PENDING |

재enqueue 절차는 Phase 35–37 §14 runbook 그대로다. guard가 내장돼 있어 role이 틀리면 아무것도 쓰지 않는다. **전제는 P70-1(교체 후 첫 Sync) 성공이다.** 그 전에 enqueue하면 queued로 남거나, 같은 guard에 막힌다. 이번 단계에서는 실행하지 않았다(NOT RUN).

## 14. 롤백 방법

| 상황 | 조치 | 비고 |
|---|---|---|
| step 1–3(로컬)에서 실패 | 교체하지 않는다 | GitHub 값은 그대로라 롤백할 것이 없다 |
| 교체 후 Deploy plan fingerprint 불일치 | 변수만 다시 계산해 넣는다 | secret 롤백 불필요 |
| 교체 후 인증 실패 28P01/28000, 42501, plan `history:` | 이전 secret과 이전 pin `54680e3e225b4bf4`로 되돌린다 | **이전 secret 값이 필요하다** |
| 교체 후 guard 실패 | 코드는 되돌리지 않는다. secret 반영 여부를 확인한다 | 되돌리면 잘못된 role로 다시 수집된다 |
| 첫 Sync에서 일부 저장 실패 | 롤백할 것이 없다. 저장은 repository 단위 transaction이다 | 다음 run의 reap가 회수한다 |

- **이전 secret 값 보관: PENDING(확인 불가).** GitHub에서는 다시 읽을 수 없다. Claude는 보관 여부를 확인할 수 없다.
  - 이전 값이 Neon 소유자 role이면 Neon console에서 다시 받을 수 있다(비밀번호를 바꾸지 않은 경우).
  - 다시 받을 수 없으면 롤백 대상은 "Deploy가 다시 동작하는 상태"뿐이다. 이전 값으로 돌아가도 Sync는 guard 때문에 계속 거부된다.
  - 따라서 이전 값을 잃어도 Sync 쪽 손해는 없다. 위험은 Deploy가 일시적으로 BLOCKED되는 것에 한정된다.
- 이전 pin `54680e3e225b4bf4`는 이 문서와 Deploy 로그에 남아 있다.

## 15. 남은 위험

| 등급 | 위험 | 완화 |
|---|---|---|
| IMPORTANT | 새 URL을 다른 Neon branch나 database에서 복사하는 실수 | step 1–3과 새 fingerprint로는 검출되지 않는다(자기 비교이고, branch는 role과 history를 복제한다). **§8 step 0a(이전 role 이름 + 새 host → 이전 pin 재현)와 0b(운영 화면의 마지막 sync 시각과 대조)로 검출한다.** 둘 다 통과하기 전에는 교체하지 않는다 |
| IMPORTANT | 검증한 값과 등록한 값이 다름(다시 붙여넣다 바뀜) | §8 step 4에서 같은 셸의 변수를 stdin으로 등록한다 |
| IMPORTANT | pooled 문자열을 넣는 실수 | `readOnlyTarget`과 `productionTargetRejection`이 거부한다(step 1). Sync 본체는 거부하지 않으므로 step 1을 건너뛰지 않는다 |
| IMPORTANT | `not_owned>0`인 상태에서 교체 | step 3 판정. `not_owned>0`이면 교체를 보류하고 소유권 이전을 따로 승인받는다 |
| MINOR | 이전 secret 미보관 | §14. Sync 손해는 없고, Deploy BLOCKED만 생길 수 있다 |
| MINOR | 교체 사이에 push가 들어감 | Deploy가 BLOCKED된다(fail-closed). push를 멈추면 된다 |
| MINOR | `agentdock_app` 비밀번호 재설정 | 웹이 끊긴다. 재설정하지 않는다 |
| MINOR | 첫 Sync가 밀린 작업을 처리 | drain 상한 200, refresh 상한 100, enqueue 상한 100이 그대로 적용된다. 평소 run과 같은 크기다 |
| 해당 없음 | Guard 우회, Sync 중복 실행 | 코드 변경이 없고 `concurrency: sync`가 있다 |

리뷰: §16 참고.

## 16. 리뷰

- PR Review Toolkit `code-reviewer`가 복구 절차를 검토했다(초점: 잘못된 DB 대상과 role, fingerprint 불일치, secret 노출, guard 우회, Sync 중복, 롤백, job 중복). 결과는 아래에 적는다.

| 등급 | 지적 | 반영 |
|---|---|---|
| CRITICAL | 새 fingerprint를 같은 URL과 비교하면 항상 일치한다. Neon branch는 role, 비밀번호, history를 복제하므로 step 1–3이 모두 통과한다. Sync는 pin을 비교하지 않아 잘못된 branch에 쓸 수 있다 | §8 step 0a·0b를 추가했다(이전 pin 재현, 운영 화면 대조). §15를 수정했다 |
| IMPORTANT | 검증 후 `unset`하고 다시 붙여넣으면, 검증한 값과 등록한 값이 다를 수 있다 | §8 step 4: 같은 셸에서 `printf … \| gh secret set`으로 등록한다 |
| MINOR | "step 0 값"이 무엇인지 불명확하다 | "§7 출력값"으로 고쳤다 |
| MINOR | `no_dml`의 검증력이 약하다 | 판정 근거를 `not_owned`로 명시했다 |
| MINOR | P69-5를 "행을 쓰지 않는다"고 쓴 것은 부정확하다 | 실제로 실행되는 statement를 적었다 |
| MINOR | Deploy와 Sync는 concurrency group이 다르다 | §11 step 1에 적었다 |

리뷰가 소스와 대조해 일치한다고 확인한 항목은 다음과 같다.
- `--fingerprint`는 연결하지 않는다.
- `ops.mjs preflight --production`은 실제로 파싱된다. 거부되면 exit 2다.
- zsh의 `read -rs "VAR?prompt"` 문법이 맞다.
- `DATABASE_URL`은 repository secret 하나다.
- `tables:11`은 테이블 10개와 이력 테이블 1개다.
- guard 메시지는 role 이름을 출력하지 않는다.
- 롤백과 재enqueue의 중복 방지는 Phase 35–37과 일치한다.

남은 CRITICAL/IMPORTANT는 없다. 반영한 결과가 실제로 동작하는지는 운영자가 실행해야 확인된다(PENDING).

## 17. 다음 단계

1. 사용자가 B 단계(P69-1 → P69-4, 선택 P69-5)를 승인하고, 운영자가 §8을 로컬에서 실행한다.
2. 06:00 slot(예상 09:56–11:45Z) 전에 교체한다.
3. 첫 예약 Sync를 §12 표로 검증한다(P70-1). 결과는 이 문서에 추가한다.
4. 성공하면 job 771·978 재enqueue를 별도로 승인받는다(P70-3).
5. 그 다음: Neon region 확인, enqueue 상한과 pending seed 15,591건 재평가.

## 18. Phase 69 최종 사전 검증 (2026-10-27 05:44Z~)

운영자가 Neon Console에서 확인한 대상은 다음과 같다. Project `agentdock`, Branch `production`, Database `neondb`, Role `agentdock_app`, Compute Primary, Connection pooling OFF, SSL require.

- Claude 세션의 셸에는 `DATABASE_URL`이 없다(FACT, 값은 보지 않고 존재 여부만 확인).
  - 운영자 터미널의 변수는 Claude 도구에서 보이지 않는다.
  - URL을 대화로 받는 것은 secret 노출이라 받지 않는다.
  - 그래서 운영 DB에 연결하는 검증은 **운영자 터미널에서 실행**한다.
- `preflight.zsh`(scratchpad `p69/`)는 아래 순서로 검사하고, 판정·role·schema 이름·fingerprint만 출력한다.
  - 0: URL 형식. username, `-pooler` 없음, `/neondb`, `sslmode=require`
  - 1: 이전 role 이름과 새 host로 이전 pin `54680e3e225b4bf4`가 재현되는지(§8 0a)
  - 6: 새 fingerprint
  - 2: ops preflight 7개 항목
  - 3: read-only transaction에서 `current_user`, `search_path`, `current_database()`, `sync:last_success` 조회(§8 0b)
  - 4: plan
  - 5: 소유권. 테이블 11개, `not_owned=0`, schema 소유
  - 하나라도 실패하면 거기서 멈춘다.
- 오프라인 dry run(FACT, 가짜 URL, 연결 없음): 정상 URL은 step 0·1·6을 통과했다. pooled URL은 step 0에서, 다른 host는 step 1(`DIFFERENT TARGET`)에서 멈췄다.
- `swap.zsh`(승인 후 실행): 실행 중인 run이 없는지 확인한다. URL을 다시 입력받아 그 fingerprint가 검토한 `NEW_PIN`과 같을 때만 진행한다. preflight를 한 번 더 통과하면 secret(stdin)과 변수를 연달아 바꾼다. **실행하지 않았다.**
- 운영 DB에 대한 step 2–5 결과는 PENDING이다. 운영자가 출력을 공유하면 이 절에 기록한다.

### 18.1 이전 role 이름에 의존하지 않도록 변경 (2026-10-27 05:5xZ)

현재 secret의 role 이름은 저장소 문서, Obsidian, Claude 세션 이력 어디에도 없다(FACT). 그래서 이름을 추측하지 않고, `preflight.zsh`를 Neon Console 값(Endpoint `ep-bold-pond-aohvj2sb`)을 기준으로 다시 썼다. 이전 pin 재현은 `OLD_USER`를 환경변수로 줄 때만 실행하는 선택 검사로 분리했다.

| # | 검사 | 근거 | 연결 |
|---|---|---|---|
| 1 | URL 형식: `agentdock_app`, 호스트 첫 label = `ep-bold-pond-aohvj2sb`(→ `-pooler`도 거부), `*.neon.tech`, port 5432, `/neondb`, `sslmode=require` | Neon은 호스트 첫 label의 endpoint ID로 compute를 고른다 | 없음 |
| 2 | 운영 대상: `current_database()=neondb`, `pg_is_in_recovery()=false`(Primary, read replica 아님), `sync:last_success`가 운영 홈 값 `2026-10-25 20:26`과 분 단위까지 같음 | 홈은 같은 키를 `toISOString().slice(0,16)`으로 표시한다(`src/app/page.tsx:164`, `syncState.ts:94`) | read-only tx |
| 3 | ops preflight `--production` 7/7 | `src/db/readOnly.ts:131-149` | read-only |
| 4 | `current_user=agentdock_app`, `search_path=agentdock` | | read-only tx |
| 5 | plan `--require-current` UP_TO_DATE | | read-only |
| 6 | 소유권: 11 tables, `not_owned=0`, schema 소유 | | read-only tx |
| 7 | `NEW_PIN` | `migration-gate.mjs:184` | 없음 |

**이름과 Endpoint만으로 충분한가.**
- Project·Branch 이름은 증명이 되지 않는다. 이름은 고유하지 않다.
- Endpoint ID는 Neon 전체에서 고유하고, 한 branch에만 속한다. 그래서 1번은 "이 URL이 운영자가 Console에서 본 바로 그 compute로 간다"를 증명한다.
- 그래도 그 compute가 "지금 운영이 쓰는 데이터"라는 증명은 아니다. 그래서 2번에서 데이터로 대조한다.
- 남는 틈: 10-25 20:26 이후에 만든 자식 branch는 데이터까지 같아서 2번을 통과한다(INFERENCE). 이 틈은 Console의 Branches 목록으로만 닫을 수 있다.
- Project ID·Branch ID는 DB 안에서 조회할 수 없다. Neon compute가 노출하는 `neon.*_id` 설정은 `neon.tenant_id`, `neon.timeline_id`뿐이고 Console ID와 다르다(Neon community 글. 공식 문서는 확인하지 못함). Neon API를 쓰면 대조할 수 있지만 API key라는 새 인증정보가 필요해서 하지 않았다.
- 그래서 스크립트는 `MANUAL` 줄로 Console 확인을 요구한다. 확인할 것은 Branches → production → Computes에 이 endpoint가 있는지, Branch ID·Project ID가 운영자가 기록한 값인지다.
- 교체 후 잔여 확인: Phase 70에서 홈의 last sync 시각이 갱신되는 것을 본다(§12). 다른 branch로 들어갔다면 Sync가 성공해도 홈 값이 바뀌지 않으므로 여기서 드러난다.

**오프라인 검증 (FACT, 가짜 URL, 연결 없음)**
- `zsh -n` 통과(preflight, swap).
- 섹션 2 앞에서 끊은 사본으로 시험했다. 정상 URL은 1번 7개 PASS 후 NEW_PIN을 계산했다. pooler, 다른 endpoint, 다른 role, sslmode 없음 + 다른 DB는 1번에서 STOP했다. 출력에 비밀번호는 없었다.
- 섹션 2·4 판정식을 가짜 행으로 시험했다. 정상은 PASS였고, replica, 다른 last_success, 기록 없음, 다른 role, 따옴표 붙은 search_path는 모두 FAIL이었다.
- 기준값(FACT, 05:53Z GET): 운영 홈은 `last sync without errors 2026-10-25 20:26 UTC`이고, 최신 Sync run은 여전히 40409047009(failure)다.
- 운영 DB를 대상으로 한 2–6번은 PENDING이다. `swap.zsh`는 바꾸지 않았다. fingerprint에 host가 들어가므로, NEW_PIN이 같다는 검사가 곧 같은 endpoint라는 검사다. 실행하지 않았다.

### 18.2 운영자 preflight 결과와 교체 직전 GO/NO-GO 검토 (2026-10-27 05:59Z)

**운영자 실행 결과(운영자가 보고한 값).** preflight ALL PASS, `current_user=agentdock_app`, `search_path=agentdock`, endpoint `ep-bold-pond-aohvj2sb`, `11 applied, 0 pending — UP_TO_DATE`, `not_owned=0`, `NEW_PIN=0e4385657437449d`.

**GitHub 상태 (FACT, 05:59Z, 읽기 전용 조회).**
- Sync 최신 run은 40409047009(10-26 22:00Z)와 40317405590(10-26 11:45Z)이고 둘 다 failure다. 마지막 성공은 40229151309다.
- Deploy 최신 run은 40454829318(c821102, success)이다.
- in_progress, queued, waiting, requested, action_required 상태의 run은 모두 0건이다.
- HEAD와 origin/develop은 모두 c821102다.
- secret: repository `DATABASE_URL`(10-22 05:28:37Z), `AGENTDOCK_GITHUB_TOKEN`. production env secret은 `VERCEL_TOKEN`뿐이다. env 단계에 `DATABASE_URL`이 없으므로 repository secret을 덮어쓰는 값이 없다.
- production env 변수 `AGENTDOCK_TARGET_FINGERPRINT=54680e3e225b4bf4`는 아직 그대로다.

**ID 기준값 대조.**

| 항목 | 기존 기록 | 판정 |
|---|---|---|
| Endpoint ID | 오늘 운영자가 준 `ep-bold-pond-aohvj2sb` 말고는 저장소, Obsidian, 세션 이력에 기록이 없다 | URL과는 일치한다(preflight 1번). 이전 기록과는 대조할 수 없다 |
| Project ID | 기록 없음 | PENDING (Console) |
| Branch ID | 기록 없음 | PENDING (Console) |
| 데이터 동일성 | 운영 홈 `2026-10-25 20:26 UTC` = DB `sync:last_success` | PASS(운영자 preflight 2번) |

**swap.zsh 검토.**
- secret 대상: `gh secret set DATABASE_URL`은 `--env` 없이 repository secret을 바꾼다. sync.yml(61, 69, 91행)과 deploy.yml(91, 102, 110행)이 쓰는 secret이 바로 이것이다. 정확하다.
- 변수 대상: `gh variable set AGENTDOCK_TARGET_FINGERPRINT --env production`이다. deploy.yml 92, 103, 111행이 production environment에서 읽는 변수다. 정확하다.
- 교체 전 재검사:
  - 다시 입력받은 URL의 fingerprint가 `NEW_PIN`과 같아야 한다. pin에는 user, host, port, db가 들어가므로 preflight 때와 같은 대상이라는 뜻이다.
  - 이어서 `ops preflight --production` 7개 항목을 다시 통과해야 한다.
- 수정 1건: run 상태 검사를 `in_progress`에서 `queued`, `waiting`, `requested`까지 넓혔다. `zsh -n`을 통과했다.
- 중단 경로 시험(FACT):
  - pin 형식이 틀리면 `STOP NEW_PIN must be 16 hex`로 멈췄다.
  - 가짜 URL은 `STOP this URL is not the one preflight verified`로 멈췄다. DB에는 연결하지 않았다.
  - 시험 뒤 secret과 변수 시각이 그대로임을 확인했다.
- 부분 실패:
  - secret 교체가 실패하면 변수는 바뀌지 않고 상태도 그대로다.
  - secret은 바뀌었는데 변수 교체가 실패하면, Sync는 pin을 검사하지 않으므로 새 secret으로 동작한다. Deploy는 pin 불일치로 migration 전에 거부된다. 안전한 쪽으로 실패하며, 복구는 `gh variable set` 한 줄을 다시 실행하는 것이다.
- 교체 사이의 충돌:
  - Deploy는 develop push 뒤 CI가 끝나야만 시작한다(`workflow_run`). push를 멈추면 두 명령 사이(수 초)에 시작될 수 없다.
  - 예약 Sync는 시작할 때 secret을 읽는다.
    - 교체 전에 시작하면 이전 secret이 guard에 막혀 아무것도 쓰지 않는다.
    - 교체 후에 시작하면 새 secret으로 동작한다.
    - Sync는 pin을 쓰지 않으므로 두 명령 사이의 상태에 영향을 받지 않는다.
  - 06:00 slot은 지난 이틀 동안 10:18Z와 11:45Z에 시작됐다.

**롤백 준비.**
- 변수 롤백(`--body 54680e3e225b4bf4`)은 바로 가능하다.
- 이전 secret 값은 GitHub에서 다시 읽을 수 없다. Neon Console에서 그 role의 URL을 다시 받을 수 있는지는 PENDING이다.
- 이전 secret으로 되돌리면 Sync는 지금처럼 guard에 막힌다. 그래서 되돌릴 이유는 "새 secret 때문에 Deploy가 깨지는 경우" 하나다. 그 경우에도 Vercel은 마지막 배포를 계속 서비스한다.

**판정: 조건부 GO.**
- 기술 조건은 모두 충족했다.
- 교체 전에 운영자가 할 일이 두 가지다.
  - ① Console에서 production branch의 Computes에 이 endpoint가 있는지, 그 이후 만든 자식 branch가 없는지 확인한다.
  - ② 이전 secret을 복원하지 못할 수도 있다는 점을 받아들이거나, 복원 가능하다고 확인한다.
- swap.zsh는 실행하지 않았다.

### 18.3 Phase 70 첫 검증 — 교체 직후 (2026-10-27 06:10Z)

**교체 반영 (FACT, 읽기 전용 조회).** repository secret `DATABASE_URL`은 2026-10-27T06:09:38Z, production 변수 `AGENTDOCK_TARGET_FINGERPRINT`는 `0e4385657437449d`(06:09:40Z)로 바뀌었다. 운영자가 `swap.zsh`로 실행했다.

**Sync 상태 (FACT, 06:10:22Z).**
- 06:09Z 이후 생성된 run은 어느 workflow에도 없다.
- 최신 Sync run은 여전히 40409047009(failure, 이전 secret)다.
- 운영 홈은 `last sync without errors 2026-10-25 20:26 UTC`다.

**판정: Phase 70 PENDING.** 새 secret으로 실행된 Sync가 아직 없다. Guard, current_user, search_path, ops, 종료 상태, 처리·실패 건수는 모두 NOT RUN이다(PASS 아님).

**다음 예약 실행.**
- cron `0 6,18 * * *`이다.
- 06:00 slot은 지난 두 번 10:18Z(10-25)와 11:45Z(10-26)에 실제로 시작됐다. 오늘도 10~12Z쯤으로 예상한다(INFERENCE).
- 그다음 slot은 18:00이다. 지난 기록에서는 20:05Z, 22:00Z에 시작했다.
- 수동 dispatch는 하지 않는다.

**run이 생기면 확인할 것(읽기 전용).**
1. `gh run list --workflow sync.yml -L 1 --json databaseId,status,conclusion,createdAt`. createdAt이 06:09:38Z보다 뒤여야 한다.
2. `gh run view <ID> --log | grep -E "Refusing to start|corpus-sync|Status|drain|failed"`
   - "Refusing to start"가 **없어야** guard 통과다(`scripts/corpus-sync.mjs:151`).
   - Status 줄이 FAILED가 아니어야 한다.
   - drain 처리 건수와 실패 건수를 기록한다.
3. 실행 요약의 "Sync health summary"(ops:status --markdown)에서 `connected as agentdock_app`과 `search_path is exactly agentdock`이 PASS여야 한다.
4. 운영 홈 GET에서 `last sync without errors`가 2026-10-25 20:26보다 뒤여야 한다.

위 네 가지를 모두 확인해야 Phase 70 PASS다. 결과는 이 절 아래에 이어서 적는다.

### 18.4 Phase 70 결과 — 교체 후 예약 Sync 2회 (확인 2026-10-28 00:48Z)

읽기 전용으로 확인했다(`gh run list/view`, job log API, 운영 GET). 수동 dispatch, 재enqueue, DB 쓰기는 하지 않았다.

| 항목 | 40494320276 | 40587752418 | 구분 |
|---|---|---|---|
| 시작 → 종료 (UTC) | 10-27 11:11:55 → 11:34:36 | 10-27 21:33:20 → 21:56:24 | FACT |
| event / commit | schedule / `d7622fc` | schedule / `d7622fc` | FACT |
| conclusion | success (모든 step success) | success | FACT |
| Schema plan | `11 applied, 0 pending, 11 on disk — UP_TO_DATE` | 같음 | FACT |
| Guard | `Refusing` 0줄. registry stage 출력으로 바로 진행 | 같음 | FACT |
| Status (notice) | `COMPLETED`, failed-stages=none | `COMPLETED`, failed-stages=none | FACT |
| drain | 200 / 최대 200, 남은 queue 0 | 200 / 200, 남은 queue 0 | FACT |
| 처리 내역 | ingested 91, unchanged 52, no artifacts 28, 정책 제외 28(stars<50 27, archived 1), 읽기 실패 0, rate limit 0, 기타 실패 1(`too_large`, 재시도 0) | ingested 105, unchanged 45, no artifacts 18, 정책 제외 32(stars<50), 읽기 실패 0, rate limit 0, 기타 실패 0 | FACT |
| artifact 저장 | found 5,372 = stored 5,372, 파일 단위 parse 실패 341 | found 4,933 = stored 4,933, 파일 단위 실패 130 | FACT (ingest 이벤트 200건 합산) |
| `storage_failed` | 0 | 0 | FACT |
| fan-out / refresh | 100 / 100 (not-reached 493) | 100 / 100 (not-reached 393) | FACT |
| listed / held | 20,350 / 23,959 | 21,419 / 25,138 | FACT |
| duration | 1,343 s | 1,364 s | FACT (기대 범위 1,242–1,506 s 안) |
| delisted | 25 | 0 | FACT |

**role / search_path.**
- guard(`src/db/client.ts:67`)는 `current_user = agentdock_app`이고 `search_path`가 `agentdock` 또는 `agentdock_test` 하나일 때만 통과한다. 두 run 모두 통과했다(FACT).
- ops 단계(`ops:status --markdown`)는 7개 read-only 검사 중 하나라도 실패하면 `ops: FAIL  <검사>`를 stderr로 쓰고 exit 2로 끝난다(`scripts/ops.mjs:118-125`). 그 검사에 `connected as agentdock_app`과 `search_path is exactly agentdock`(`src/db/readOnly.ts:146-147`)이 들어 있다. 두 run의 로그에는 `ops:` 줄이 0줄이다. 교체 전 run 8회(`39940525800`–`40409047009`)에는 같은 위치에 `ops: FAIL  connected as agentdock_app` 줄이 찍혔다(직전 `40409047009`는 role과 search_path 2줄). 따라서 두 검사 모두 PASS다(FACT, 로그 근거).
- step summary(Markdown 표) 본문은 API로 받을 수 없어 직접 보지 못했다(NOT RUN).

**운영 홈 (GET 2026-10-28 00:48Z).** `last sync without errors 2026-10-27 21:56 UTC`. 40587752418의 종료 시각과 같고, 교체 전 값 `2026-10-25 20:26 UTC`에서 갱신됐다(FACT).

**판정: Phase 70 PASS.** §18.3의 네 조건(교체 후 run, guard 통과·Status ≠ FAILED, ops role/search_path PASS, 홈 시각 갱신)을 모두 확인했다. drain 처리 건수 > 0 조건(§12)도 충족했다. 남은 확인은 Fingerprint 대조 하나다. Sync는 pin을 쓰지 않으므로 다음 Deploy plan 줄에서 `0e4385657437449d`가 나오는지 본다(PENDING).

**Job 771·978 재처리 준비 상태 (GET 00:48Z).**

| 항목 | 771 `elementalsouls/claude-bughunter` | 978 `maxritter/claude-codepro` |
|---|---|---|
| job 상태 | failed, Attempt 3 (변화 없음) | failed, Attempt 3 (변화 없음) |
| `/r/<target>` | 404 | 404 |
| 같은 저장소의 현재 상태 | corpus에 없음 | GitHub에서 `maxritter/qualitylayer`로 이름이 바뀌었다(API FACT). 40494320276의 job 2207(`maxritter/pilot-shell`로 enqueue, commit `60986fa`)이 `ok`, stored 9(new 9)로 끝났다. `/r/maxritter/qualitylayer`가 200이고 `read 2026-10-27 11:22 UTC`, `At commit 60986fa`, artifact 9개를 보여 준다 |
| 전제(교체 후 Sync 성공) | 충족 | 충족 |
| 판단 | **재enqueue 준비 완료.** Phase 35–37 §14 절차로 진행하되 별도 승인이 필요하다 | **재enqueue 불필요로 보인다.** 같은 저장소가 다른 경로로 이미 저장됐다(INFERENCE: 이름 변경 이력과 commit sha가 일치한다). 다시 enqueue해도 `github_node_id` `ON CONFLICT`로 같은 행이 갱신될 뿐이다(코드 FACT) |

- 978의 job 2207에 파일 단위 실패 8건이 있다. 다만 job 전체가 실패한 이전 사례(22021 NUL 저장 실패)와는 다르다. 실패한 파일이 무엇인지는 확인하지 않았다(NOT RUN).
- 이번 단계에서 재enqueue는 하지 않았다(NOT RUN).

## Evidence

- Sync run: 40409047009, 40317405590, 40229151309 외 7개. 로그는 scratchpad `p66/sync/*.log`에 있다(이전 Phase에서 받은 것을 재확인)
- 교체 후 Sync run: 40494320276, 40587752418. job log는 scratchpad `p70/*.log`에 있다(연결 문자열 0건 확인)
- 운영 GET(2026-10-28 00:48Z): `/` 200, `/jobs/771`·`/jobs/978` 200, `/r/elementalsouls/claude-bughunter`·`/r/maxritter/claude-codepro`·`/r/maxritter/pilot-shell` 404, `/r/maxritter/qualitylayer` 200
- Deploy run: 40454829318 (`c821102`), 40443671711 (`2c4c7a3`)
- CI run: 40454674756, 40443524002
- `gh secret list` / `gh variable list --env production` / `gh api …/environments/production` (이름과 시각만)
- 운영 GET 4회: `/jobs/771`, `/jobs/978` 200, `/r/elementalsouls/claude-bughunter`, `/r/maxritter/claude-codepro` 404
- 소스: `src/db/client.ts:67-89`, `scripts/corpus-sync.mjs:146-164`, `scripts/migration-gate.mjs:184-218`, `scripts/migrate.mjs:93-106`, `scripts/ops.mjs`, `src/db/readOnly.ts:51-66,134-149`, `.github/workflows/sync.yml`, `.github/workflows/deploy.yml`
