# Phase 99 — DB 초기화, Star 5000, 같은 Skill 1건 표시

작성 2026-11-16. 운영 `3a5e9a7`. 원인 분석은 Phase 98(`agentdock-phase98-sync-53100.md`)에 있다.

## 판정

**완료.** 초기화, 재수집, 배포, smoke를 모두 마쳤다. 남은 이슈는 §8에 정리했다.

## 1. 운영 DB 초기화

| 단계 | 결과 |
|---|---|
| 예약 Sync 중지 | `gh workflow disable sync.yml`. 실행 중이거나 대기 중인 run이 없음을 확인 |
| 대상 검증 | `ops:preflight --production` PASS. pinned fingerprint, direct URL, read-only 확인 |
| 백업 | `corpus-reset.yml`에서 pg_dump(298 MB) 실행. scratch PostgreSQL 18에 복원한 뒤 8개 테이블의 행 수와 checksum이 **동일**함을 확인(run 43789112001, 43790110510) |
| 로컬 보관 | `~/agentdock-backups/2026-11-16-*`. 내려받은 사본을 다시 복원해 동일함을 확인. public 저장소라 GitHub artifact는 모두 삭제 |
| 초기화 | 비운 행 수: capability_finding 263,053 · package_version 98,971 · package 88,226 · repo_seed 38,356 · ingest_job 10,093 · ingest_attempt 9,955 · repository 2,901 · schema_meta 5개 키 |
| 유지 | artifact_type, repository_denylist, __drizzle_migrations, schema_meta `last_boot` |
| 방식 | TRUNCATE(CASCADE 없음, 테이블 잠금, lock_timeout 5s). DELETE는 파일 공간을 반환하지 않아 한도에 걸린 DB가 계속 한도에 남는다 |

## 2. 저장 공간 (FACT, `pg_database_size`)

| 시점 | DB | package_version | package | capability_finding |
|---|---:|---:|---:|---:|
| 초기화 전 | **1,001 MB** (Free 1 GB 한도) | 545 MB | 239 MB (index 110) | 184 MB |
| 초기화 직후 | 9.3 MB | 40 kB | 72 kB | 40 kB |
| 재수집 1회 후 | **63 MB** | 26 MB | 15 MB | 13 MB |

artifact당 약 11.4 KB로 Phase 98의 추정(11–12 KB)과 같다. 남은 대기열은 1,851건이다. 지금 속도라면 1 GB의 절반에 닿는 시점은 수개월 뒤로 추정한다(INFERENCE). 확인이 필요하면 `corpus-reset.yml`을 confirm 없이 실행해 용량만 측정한다.

## 3. Star 5000

- `MIN_REPOSITORY_STARS = 5000`(`src/corpus/policy.ts`). 기준 적용 위치는 `ingestRepository` 한 곳이고, registry, seeds, links, topic sweep, backlog가 모두 이 함수를 거친다. refresh는 이미 저장된 저장소라 기준을 다시 적용하지 않는다(진입 기준).
- 공개 제출 경로는 없다(AGENTS.md). 따라서 예외도 없다.
- `stargazers_count`가 없으면 0으로 읽지 않고 `unavailable`로 처리해 재시도한다. 검색 hint는 null("모름")로 남긴다.
- 테스트: 4999는 거부, 5000과 5001은 허용, star 수 누락은 보류.
- 재수집 결과: 100건 처리, 기준 미달 18건과 archived 2건 거부. 저장된 저장소 69개의 최소 star는 5,235다.

## 4. 같은 Skill 1건 표시 (`variant`)

**원인:** `ponytail` 검색 28건 중 6건이 `ponytail`이었다. 같은 저장소의 `skills/`와 `.openclaw/skills/` 사본과, 다른 저장소의 사본이 섞여 있었다. 내용이 조금씩 달라서 byte-identical 중복 규칙에 걸리지 않았다.

**규칙:** 같은 저장소, 같은 유형(skill, command, subagent), 대소문자를 무시한 같은 이름, 같은 상위 Plugin(`parent_path`), 같은 설명 문자 체계일 때만 하나로 묶는다. 대표로 남는 행은 dot 디렉터리 밖 → 얕은 경로 → 짧은 경로 → 먼저 색인된 행 순서로 정한다. Star는 기준에 쓰지 않는다.

| 측정 쌍 (GitHub 원본, difflib) | 유사도 | 판정 |
|---|---:|---|
| DietrichGebert `skills/ponytail` ↔ `.openclaw/skills/ponytail` | 0.95 | 묶음 |
| anthropics/claude-plugins-official `discord/access` ↔ `telegram/access` | 0.90 | 따로 (상위 Plugin 다름, 기능도 다름) |
| OmniRoute `ponytail` ↔ DietrichGebert `ponytail` | 0.26 | 따로 (다른 저장소) |

유사도 임계값으로는 0.90과 0.95를 안전하게 가를 수 없다. 그래서 구조적 사실만 기준으로 쓴다.

재수집 후 판정 결과(FACT): 목록 4,910, **variant 189**, duplicate 114, unparsed 305.

## 5. `ponytail` Before / After

- Before(운영, Star 50): **28건**. `ponytail`이 6번 나오고 lnwjud, shob 등 다른 저장소의 사본이 섞여 있었다. 화면: `docs/images/phase99/ponytail-before.png`
- After(운영, Star 5000): **7건**. Skill `ponytail` → Plugin `ponytail` → `-debt/-gain/-help/-audit/-review` 순서다. Skill 카드마다 "1 other source"가 붙는다. 화면: `docs/images/phase99/ponytail-after.png`
- 상세 페이지의 "Other sources of this artifact"에 `.openclaw/skills/ponytail/SKILL.md`가 "same name in this repository"로 나온다. 각 출처는 자기 페이지, commit, 설치 명령을 그대로 유지한다.
- 순위 규칙(정확 일치 2.0 > 접두사 1.0 > 본문)은 기존 그대로다. 바꾼 것은 반복 제거뿐이다.

## 6. 검증

| 항목 | 결과 |
|---|---|
| 단위 테스트 | 1,678 passed, 2 skipped(기준선 1,661/2). 새 테스트는 그룹화 11개, 검색 1개, star 3개 |
| e2e | 128 passed(로컬). CI 전 job 성공 |
| 성능 (89k 합성) | 목록 count 629 → 964 ms, 1,068행 저장소 7 → 14 ms(index 0012 적용) |
| 성능 (재수집 데이터, ANALYZE 후) | count 74 ms(variant 없이 47), ECC 저장소 23 ms |
| 운영 | `/artifacts` 1.8 s, 검색 0.8–1.2 s, 홈 1.1 s, `/r/affaan-m/ECC` 3.7 s |
| PR Review Toolkit | code-reviewer와 silent-failure-hunter에서 HIGH 2건과 MEDIUM 5건을 수정. 수정 내용: 배포 순서, reset 실패 보고, duplicate·variant 교차로 그룹 전체가 사라지는 문제(회귀 테스트로 확인), collation, pipefail, 측정 구간, 라벨 |

## 7. Commit, CI, Deploy

`5699058` Star 5000 → `adce640` reset 도구 → `8eb804e` e2e seed → `40beecc` 홈 숫자 크기 → `aabb194` fingerprint collation → `3a5e9a7` variant 그룹화와 0012.

- 실패했던 run과 원인:
  - CI 43786410851: e2e seed가 star 5000 미만 fixture를 거부
  - corpus-reset 43788762457: `order by 1 collate` 오류. 초기화 전 단계라 아무것도 바꾸지 않았다
  - Deploy 43791649858: corpus가 비어 smoke 실패
- 각각 수정하거나 재수집으로 해결했고, Deploy 43793665666은 smoke까지 성공했다.
- 운영 `X-AgentDock-Commit: 3a5e9a7`.

## 8. 남은 이슈

1. **Phase 94 contract 번호.** 0012 번호를 새 index가 먼저 썼다. 그래서 `contract-0012.patch`는 0011이 아니라 0012를 기준으로 0013으로 다시 생성해야 한다(패치 파일은 손대지 않음).
2. **같은 이름이라도 묶지 않는 경우.** Plugin 안과 밖에 있는 같은 Skill(honey-gain 형태)과, 다른 저장소의 수정된 사본(OmniRoute)은 따로 남는다. 의도한 보수적 판단이다.
3. **path로만 맞는 검색.** 그룹의 대표가 아닌 사본은 경로로만 일치하는 검색(예: `openclaw`)에서 목록에 나오지 않는다. 대신 대표 행의 상세 페이지에 나온다.
4. **저장소 페이지 지연.** 운영 ECC 저장소 페이지가 3.7초다. 로컬 쿼리는 23 ms라 원인은 쿼리가 아니다(렌더링이나 Neon 쪽). 이 Phase에서는 측정만 했다.
5. **카드의 출처 수 범위.** "N other sources"에는 fork나 unparsed 사본도 들어간다. 상세 목록과 숫자는 일치한다.
6. **star 수 누락 사유.** star 수가 없을 때 남는 사유가 "GitHub에 연결할 수 없음"이라는 일반 문구다(silent-failure 리뷰 MEDIUM, 미수정).
