# AgentDock Phase 92 — 보안·즉시 수정

작업일: 2026-11-06 (KST). 대상: `develop`, 운영 `https://agentdock-delta.vercel.app/`.
원자료는 `docs/analysis/phase92-artifacts/`, 화면은 `docs/images/phase92/`에 있다. 재기는 Phase 91 보고서(§18~19)의 우선순위를 따랐다.

## 1. 요약

**판정: PASS (범위 내). 남은 항목은 §8의 PENDING이다.**

Phase 91이 찾은 즉시 수정 항목 네 건과, 그 수정을 검토하다 발견한 마스킹 결함을 고쳐 운영에 배포했다.

| 항목 | 결과 |
|---|---|
| 코드 커밋 | `74968bb8d528a0f94860b20c2b9f3f36aedcc1f8` |
| CI | `42147353830` success (check, database, e2e) |
| Deploy | `42148274462` success, 스모크 단계 포함 |
| 운영 배포 | `dpl_2RZ72BboSzBHdQeQ9mjhmgWCVtZ2` Ready, `x-agentdock-commit: 74968bb…` |
| 운영 DB | 변경 없음. migrate `11 applied, 0 pending — UP_TO_DATE` |
| Sync, rosetta 재수집 | 실행하지 않음. `/r/griddynamics/rosetta`는 그대로 404 |

## 2. 변경 내용

| ID | 수정 | 위치 |
|---|---|---|
| F-01 | Next `16.3.0` → `16.4.5` (sharp `0.35.5`). `bun audit` critical 5 → 0, 전체 28 → 13 | `package.json`, `bun.lock` |
| A-01 | 터치 환경의 키 안내를 `content: none`에서 `display: none`으로 변경 | `src/app/globals.css` |
| A-02 | finding `summary`를 500자로 제한 | `src/analyze/run.ts`, `types.ts` |
| F-02 | E2E Job 제한 15분 → 25분 | `.github/workflows/ci.yml` |
| 신규 | `redactSecrets`의 라벨 삼킴과 2차 시간 정규식 수정, 패널 `signal` 마스킹 | `src/components/redact.ts`, `CapabilityPanel.tsx` |
| 신규 | 측정 원본을 Biome 대상에서 제외. `431d288`의 CI 실패 원인 | `biome.json` |

### 2.1 `431d288` CI 실패

Phase 91 보고서 커밋의 CI `42142350810`이 실패해 Deploy가 건너뛰어졌다. `docs/analysis/phase91-artifacts/`의 JSON과 스크립트를 Biome이 검사해 오류 26개가 났다. 커밋을 권하기 전에 lint를 돌리지 않은 작성자 실수다. 운영은 `1583f1f`에 머물러 서비스 영향은 없었다.

### 2.2 A-02 원인

테스트 DB에서 실제 파이프라인으로 재현했다.

```
ERROR: index row size 3600 exceeds btree version 4 maximum 2704 for index "capability_finding_identity"
```

`plugins/core-claude/hooks/hooks.json`의 4,737바이트 hook 명령이 `declares a hook command: …` 형태로 고유 인덱스 컬럼인 `summary`에 그대로 들어갔다. 500자 제한 초판을 적용한 뒤 같은 저장소가 605건 저장에 성공했고(제한에 걸린 finding 6건, 파싱 실패 6건), 테스트 DB에서 그 행은 지웠다.

**최종 코드로는 재수집하지 않았다.** 초판 이후 마스킹과 해시가 추가됐고, rosetta 재수집이 금지돼 같은 조건은 DB 테스트(§3)로 대신 확인했다.

## 3. `summary` 제한 검토

초판을 검토하자 고유성과 마스킹 모두 결함이 있었다. 세 건 모두 실패하는 테스트나 측정으로 먼저 재현한 뒤 고쳤다.

| 질문 | 초판 결과 | 조치 |
|---|---|---|
| 뒷부분만 다른 두 명령이 구분되는가 | **아니오.** 앞부분과 길이가 같으면 `summary`가 같아져, `start_line`이 있는 행은 `ON CONFLICT DO NOTHING`이 하나를 버린다 | 마스킹한 전체 문자열의 SHA-256 앞 8자리를 붙임 |
| 잘린 뒤에도 비밀값이 가려지는가 | **아니오.** `PASSWORD="두 단어"` 안에서 잘리면 닫는 따옴표가 사라져 렌더 규칙이 값을 못 잡는다 | 자르기 전에 전체 문자열을 마스킹 |
| 마스킹이 수집을 멈출 수 있는가 | **그렇다.** 초판 수정이 렌더 경로의 2차 시간 정규식을 수집 경로로 가져왔다. 64KB `-` 연속 문자열 5,931ms | 이름 128자, scheme 32자로 제한. 같은 입력 29ms |

저장 형식은 `… (4708 characters, 1a2b3c4d)`다. 같은 입력이면 같은 값이 나오므로 재분석해도 행이 바뀌지 않는다.

**인덱스 여유:** 최악의 입력(3바이트 문자, pglz로 줄지 않는 순서)은 약 1,532바이트로, DB 테스트에서 실제 인덱스에 2행이 들어갔다. 원래 값은 같은 테스트에서 거부된다. 남는 여유 약 1,170바이트는 `source_path`와 다른 컬럼 몫이다. `source_path`에는 별도 상한이 없어 극단적으로 긴 경로는 같은 오류를 낼 수 있으나 재현하지 않았다(**추정**). rosetta의 최장 경로는 129바이트다.

**해시의 한계:** 마스킹된 값만 다른 두 명령은 같은 값이 된다. 비밀값의 해시를 공개 페이지에 남기지 않기 위한 선택이다. `start_line`이 NULL인 선언 행은 제약상 충돌하지 않아 행이 사라지지 않는다.

### 3.1 기존 마스킹 결함 (이번 변경 이전부터 운영에 있었음)

코드 리뷰에서 발견해 재현했다. 렌더 시점 함수를 고쳤으므로 이미 저장된 행에도 적용된다.

| 입력 | 수정 전 | 수정 후 |
|---|---|---|
| `declares a hook command: API_KEY=abc123xyz run` | 그대로 표시 | `API_KEY=<redacted>` |
| `declares allowed-tools: Bash(API_KEY=…:*)` | 그대로 표시 | `Bash(API_KEY=<redacted>` |
| 패널의 `signal` 열 | 마스킹 없음 | 마스킹 |

원인은 `declares a hook command:`의 `command`가 `name: value`로 먼저 잡혀 뒤의 단어 전체를 삼킨 것이다. 민감하지 않은 이름의 값을 한 단계만 다시 검사하도록 했다. 재귀로 만들면 `a=a=a=…`에서 2차 시간이 되므로 한 단계로 제한했다.

값은 공개 저장소에 있는 것이라 원본 링크로도 볼 수 있다. 그래도 AgentDock이 복사하기 쉬운 두 번째 위치가 되지 않게 하는 것이 이 함수의 목적이다.

## 4. 리뷰

PR Review Toolkit의 코드, 테스트, 주석 리뷰어 3개를 돌렸다. **CodeWatcher는 NOT RUN이다.** 이 환경에 명령, 플러그인, 도구 어느 형태로도 없었다.

| 리뷰어 | 발견 | 처리 |
|---|---|---|
| 코드 | 수집 경로의 2차 시간 정규식 | 수정, 회귀 테스트 |
| 코드 | `signal` 미마스킹, 라벨 뒤 값 미마스킹 | 수정, 회귀 테스트 |
| 테스트 | 토큰 테스트가 redaction 없이도 통과(공허) | 공백 없는 패딩으로 수정 |
| 테스트 | 해시 입력 계약, 단어 중간 절단, 마우스 대조군 미검증 | 테스트 추가 |
| 테스트 | `rejects.toThrow()`에 오류 코드 미지정, `display` 구현에 묶인 단언 | 유지. 직후 호출이 성공해야 하므로 실질 위험이 작다 |
| 주석 | `ci.yml`의 Run ID 오류(취소된 run은 `42082401349`) | 수정, API로 대조 |
| 주석 | `persist.test`의 한도 설명, `types.ts` 계산, `next.config` 현재형 | 수정 |

`next.config.ts`의 "16.4.5에서 no-op 어댑터로 재현 안 됨"은 주석 리뷰어가 추적 파일 복사본으로 측정한 값이다. 분기는 유지했다.

## 5. 검증

### 5.1 로컬 (커밋 직전, 최종 코드)

| 항목 | 결과 |
|---|---|
| `check:boundaries`, `lint`, `typecheck` | 통과 |
| 단위 | 1,575 통과, 2 skip |
| 빌드 | `VERCEL=1`, standalone 모두 성공 |
| E2E | 73 통과, 2.7분 |

2 skip은 `search.test.ts`의 pg_trgm 미설치 시 fallback, `client.test.ts`의 잘못된 비밀번호 접속이다. 이번 변경과 무관하다.

### 5.2 CI `42147353830` (`74968bb`)

| Job | 결과 | 비고 |
|---|---|---|
| check | success | `bun run ci` 12초 |
| database | success | `bun run test` 35초 |
| e2e | success | 8분 17초(제한 25분). 설치 32초, **73 통과** 6.9분, 재시도 없음 |

### 5.3 Deploy `42148274462`

전 단계 success, 2분 16초. migrate plan과 require-current는 `0 pending`, 대상 fingerprint `0e4385657437449d`. 실제 Vercel 어댑터로 Next 16.4.5 빌드가 통과했고 `release.mjs smoke`도 성공했다.

## 6. 운영 Smoke (2026-11-06 11:10 KST, GET/HEAD만)

Playwright Chromium 156. 브라우저 요청 중 GET/HEAD 외 0건.

| 대상 | 기대 | 결과 |
|---|---|---|
| `/` | 200 | 200 |
| `/artifacts` | 200 | 200, 44,746건 |
| `lang=any` | 200 | 200, 46,672건 |
| `q=code review` / `코드 리뷰` | 200 | 200, 1,827 / 9건 |
| `代码审查` 기본 | 200 | 200, 빈 결과(중국어 기본 제외 정책) |
| `代码审查` + `lang=any` | 200 | 200, 35건 |
| 빈 결과 `zzzzqqqqxxxx` | 200 | 200, "No artifacts matched" |
| `type=hook` / `mcp_server` | 200 | 200, 504 / 545건 |
| `type=agent&sort=name` | 200 | 200, 5,080건 |
| `page=2` | 200 | 200 |
| `q=<script>alert(1)</script>` | 이스케이프 | 원문 태그 없음, `&lt;script&gt;` 표시 |
| 상세(hook, skill) | 200 | 200, 40자 commit 링크, hook 페이지에 `<redacted>` 표시 |
| `/r/griddynamics/rosetta`, `/r/nobody/nothing` | 404 | 404 |
| `/skills` | 308 | 308 |

| 브라우저 동작 | 결과 |
|---|---|
| 홈 3D | `data-scene="live"`, 칩 포커스로 패널 열림, Esc 닫힘 |
| 검색 → 정렬 → 상세 → 뒤로 | 통과, `?q=review&sort=name`으로 복귀 |
| A-01 터치 1024·1180·390 | 키 안내 `display: none`, 가로 넘침 없음 |
| 마우스 1440 | 키 안내 유지(`block`) |
| 콘솔 오류 | 전 경로 0건 |

타입과 검색 건수는 Phase 91과 같다. 배포 후 Sync가 돌지 않았으니 예상과 맞는다.

**서버 로그:** Vercel 런타임 로그 최근 30분 50건 모두 `info`, 5xx와 오류 0건. Hobby 플랜 제한으로 30분 이전과 CDN 로그는 볼 수 없으므로 이 결과가 서버 오류 전체 0건을 뜻하지는 않는다.

### 6.1 LCP

데스크톱 1920×1080, Chromium 156, 캐시 없음, 5회.

| 회차 | 최종 헤더 | LCP | 요소 |
|---:|---:|---:|---|
| 1 | 2,619 | 2,872 | h1 |
| 2 | 2,703 | 2,924 | h1 |
| 3 | 2,674 | 2,896 | h1 |
| 4 | 2,454 | 2,676 | h1 |
| 5 | 2,473 | 2,692 | h1 |
| **중앙값** | **2,619** | **2,872** | |

Phase 91의 3,676ms와 **직접 비교하지 않는다.** 시각과 유휴 상태가 달라 업그레이드 효과라고 말할 수 없다. 응답 대기가 대부분이라는 구조는 그대로이며, 해결은 Phase 93 범위다.

## 7. 사이드 이펙트

- 테스트 DB에 rosetta를 두 번 수집했고(실패 1, 성공 1), 성공 행과 seed를 지웠다. `package` 287행, `repository` 11행으로 복귀를 확인했다. 시퀀스 증가와 dead tuple은 남는다.
- GitHub 읽기에 기존 `gh` 로그인 토큰을 그 프로세스 환경변수로만 썼다. 저장하거나 출력하지 않았다.
- 주석 리뷰어가 일회용 `postgres:17` 컨테이너를 만들었다가 지웠다.

## 8. PENDING

| 항목 | 상태 | 비고 |
|---|---|---|
| rosetta 운영 재수집 | **승인 대기** | 배포만으로 다시 수집되지 않는다. 종료된 job의 seed는 재제안되지 않고(`src/corpus/refresh.ts`), 저장에 실패해 refresh 대상도 아니다. 재수집하면 운영 목록이 최대 605건 늘어난다 |
| 같은 `54000` 실패 저장소 | 미확인 | 운영 DB 미조회. 다른 저장소가 있으면 같은 절차 필요 |
| 다음 예약 Sync | 미확인 | `74968bb` 코드로 도는 첫 실행의 `storage_failed` 확인 필요 |
| 최종 코드의 긴 명령 실제 저장 | 미확인 | 운영에서 재수집 또는 새 저장소 수집이 있을 때 확인 |
| 남은 high 4건 | 미처리 | 런타임 `js-yaml`(< 4.3.2), `zod`(< 4.6.6), 개발 `source-map-js`, `vite`. 실제 영향 미분석 |
| `source_path` 상한 | 미처리 | 극단적으로 긴 경로의 `54000` 가능성(추정) |
| 터치 실기기 | NOT RUN | Playwright 터치 에뮬레이션으로만 확인 |
| CodeWatcher | NOT RUN | 환경에 없음 |
| Phase 91 보고서의 나머지 항목 | 다음 Phase | 홈 스냅샷(Phase 93), 소프트웨어 렌더러 정책(Phase 94) |
