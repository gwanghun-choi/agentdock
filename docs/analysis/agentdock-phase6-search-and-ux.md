# AgentDock Phase 6 — 검색 정확도·UX·성능

작성일 2026-10-21 · 기준 HEAD `57c7c54` · 미커밋 · 모든 측정은 로컬 PostgreSQL 17(pg_trgm 설치)에서 했다

## 1. 변경 목표

- 고정 평가셋으로 현재 검색 품질을 기록한다(Baseline).
- 측정으로 개선이 확인된 변경만 반영한다.
- 규모가 커질 때 성능이 어떻게 변하는지 측정한다.

## 2. 평가셋 (`src/db/queries/search.eval.test.ts`)

- **Corpus:** fixtures/에 본문이 캡처된 파일 전부를 **실제 detector**로 파싱한 155행에, 요약을 직접 작성한 agent 6행을 더해 7개 저장소 161행이다. 저장소 description과 topic은 실제 값이다.
- **질의:** 21개, 각각 정답 행을 정해 두었다. 유형은 다음과 같다.
  - 정확한 이름, 하이픈 이름, 접두어, 부분 일치, 복합어
  - 설명 단어, 설명 구문, 동의어
  - 경로, 오타 2개
  - 저장소 이름, 저장소 설명, topic
  - 2글자, 한국어, 중국어
  - type 필터, mcp
  - agent 이름, agent 설명
- **판정 기준:** 정답이 처음 나오는 순위(`firstRelevant`)와 결과 수(`total`)를 본다. 테스트는 고정값보다 나빠지면 실패한다. 순위가 내려가거나, 결과 수가 2배를 넘으면 실패다.

### Baseline → 변경 후

| id | 질의 | total | 정답 순위 (전 → 후) |
|---|---|---|---|
| exact-name | pdf | 3 | 1 → 1 |
| exact-hyphen | canvas-design | 1 | 1 → 1 |
| prefix | brainstorm | 1 | 1 → 1 |
| partial | debugging | 14 | 1 → 1 |
| compound | code review | 11 | 1 → 1 |
| description-word | playwright | 1 | 1 → 1 |
| description-phrase | image generation | 8 | 2 → 2 |
| description-synonym | twitter | 2 | 1 → 1 |
| **path** | skills/pdf | 3 | **3 → 1** |
| typo | debuging | 14 | 1 → 1 (stemming이 처리) |
| typo-2 | brainstroming | 0 | 미발견 → 미발견 |
| repo-name | superpowers | 16 | 1 → 1 |
| repo-description | hooks mastery | 12 | 12 → 12 |
| repo-topic | sdlc | 0 | 미발견 → 미발견 |
| short | ai | 7 | (정답 없음) |
| korean | 번역 | 0 | (정답 없음 — 한국어 본문이 없다) |
| cjk | 微信 | 3 | 2 → 2 |
| type-filter | review + command | 2 | 1 → 1 |
| mcp | mcp | 4 | 1 → 1 |
| agent-name | code-reviewer + agent | 1 | 1 → 1 |
| agent-description | security audit + agent | 1 | 1 → 1 |

정답이 정해진 질의 18개 중 1위 적중은 14개에서 15개로 늘었다. 나머지 20개 질의는 결과가 바이트 단위까지 같다.

## 3. 반영한 변경

### 3.1 경로 질의 가산점 (`SEARCH_CAPS.pathBonus = 1.0`)

- **조건:** 질의에 `/`가 있을 때만 적용하며, `lower(source_path) LIKE '%q%'`이면 +1.0이다.
- **가중치 위치:** exactNameBonus(2.0)보다 낮고, prefixNameBonus(1.0)와 같다.
- **적용 위치:** `rankExpr`에만 넣었다. 필터 조건과 count는 바뀌지 않으므로 pagination 총계도 그대로다.
- **입력 처리:** `escapeLikeOperand`로 `%`와 `_`를 이스케이프한 바인딩 값만 쓴다.

### 3.2 trigram 임계값 실측 (코드 동작은 그대로, 주석만 갱신)

`search.ts`의 `fuzzyThreshold` 주석은 그동안 BLOCKED(pg_trgm 미설치)였다. 이번에 측정한 값은 다음과 같다.

| 질의 | 의도한 행 | 최고 word_similarity | 0.6 통과 |
|---|---|---|---|
| playwrit | webapp-testing | 0.778 | ✓ |
| mcp-sever | mcp-builder | 0.600 | ✓(경계값) |
| postgress | (corpus에 대상 없음) | — | 측정 불가 |
| brainstroming | brainstorming | 0.556 | ✗ |
| tranlsate | baoyu-translate | 0.429 | ✗ |

임계값을 0.5로 낮추면 brainstroming이 잡히지만, 표본 8개 중 회복되는 것은 1개뿐이다. 게다가 운영 pooler가 세션 GUC를 받는지 확인되지 않았다. 그래서 **0.6을 유지**한다. 재검토 조건은 운영 검색 로그(DIS-08)에서 실제 오타 질의를 모은 뒤로 정했다.

## 4. 검토 후 반영하지 않은 변경 (측정 근거)

### 4.1 저장소 description과 topic을 검색 대상에 넣는 안

평가 corpus에서, package 텍스트로는 매칭되지 않지만 저장소 description·topic으로는 매칭되는 행 수를 쟀다.

| 질의 | package 텍스트 매칭 | description/topic으로 추가되는 행 |
|---|---|---|
| agent | 32 | **+123** (corpus 161행 중 155행이 매칭) |
| claude | 43 | +89 |
| workflow | 14 | +57 |
| cursor | 0 | +47 |
| mcp | 4 | +20 |
| sdlc | 0 | +16 (obra 저장소 전체) |
| hooks mastery | 0 | 0 ("mastery"와 "master"의 stem이 다르다) |

저장소 단위 신호는 그 저장소의 모든 artifact를 끌어온다. wshobson처럼 600행짜리 저장소가 흔한 단어 하나로 통째로 매칭된다. 정확도가 손상되고 결과 수가 폭증하므로 **기각**했다.

저장소를 찾는 질의는 기존 `full_name` ILIKE 신호와 저장소 페이지로 해결한다. 이 기각으로 남는 미발견 사례(repo-topic, repo-description)는 평가셋에 그대로 고정해 두었다.

## 5. 성능 (C-4 / D-4)

### 5.1 데이터와 방법

- **데이터:** 로컬 일회용 DB의 `agentdock` schema에 합성 데이터를 넣었다(`generate_series`).
  - package당 version 2개, version 4개 중 1개에 finding, 50개 중 1개는 failed.
  - 1k / 10k / 50k package 규모, 각각 repository는 package 수의 1/20.
- **측정:** 애플리케이션의 실제 함수(`searchMode`, `searchPackages`, `countSearchResults`, `listPackages`, `countPackages`)를 5회 실행한 중앙값(ms)이다.
- **해석상 주의:** 합성 데이터는 단어 분포가 균일해서, 한 단어가 실제보다 많은 행에 매칭된다. 이 측정은 운영 성능을 보장하지 않는다.

### 5.2 결함 발견: 목록과 count가 규모에 따라 이차적으로 느려짐

`NOT_LISTED_BECAUSE`의 중복 판정은 행마다 `package_version.content_hash`로 조회한다. 그런데 이 컬럼에는 index가 없다(unique 키는 `package_id`가 앞이라 쓰지 못한다). 그래서 행마다 seq scan이 일어난다.

| 홈 목록 count | index 없음 | `package_version_content_hash_idx` 추가 후 |
|---|---|---|
| 1k pkg / 2k ver | 111 ms | 6.3 ms |
| 10k / 20k | **11,102 ms** | 51 ms |

기존 `ponytail:` 주석이 정해 둔 trigger(목록이 100ms를 넘으면 이 index를 추가)를 1k 규모에서 이미 넘는다. Phase 4–5로 데이터를 늘릴수록 홈 화면이 초 단위로 느려지는 결함이다. → **migration 0010**(additive CREATE INDEX)으로 수정했다. 실행 계획에서 `Index Only Scan using package_version_content_hash_idx`를 확인했다.

### 5.3 index 적용 후 query별 시간 (ms, 중앙값)

| 질의 | 필터 | 1k | 10k | 50k |
|---|---|---|---|---|
| browse(빈 질의) rows / count | 없음 | 7.6 / 5.9 | 47.4 / 43.7 | 251.4 / 236.9 |
| browse | skill + no_network + no_scripts | 4.5 / 3.7 | 22.8 / 21.9 | 118.2 / 115.0 |
| pdf | 없음 | 2.6 / 1.5 | 11.4 / 9.5 | 54.6 / 46.5 |
| code review | 없음 | 1.7 / 1.1 | 6.9 / 5.9 | 30.0 / 28.0 |
| agent (흔한 단어) | 없음 | 3.8 / 2.7 | 22.9 / 17.6 | 117.7 / 91.8 |
| 두 단어 미스 → any | 없음 | 3.0 / 2.1 | 21.7 / 17.4 | 84.3 / 67.0 |
| 오타 → fuzzy(결과 0) | 없음 | 10.5 | 78.8 | **399.8** |
| path | 없음 | 2.4 / 1.6 | 11.8 / 9.3 | 54.9 / 48.6 |
| offset 1000 (browse) | 없음 | 14.5 | 54.2 | 255.5 |
| 홈 listPackages / countPackages | — | 10.3 / 6.0 | 47.5 / 43.7 | 247.0 / 237.1 |

남은 상한은 두 가지다.

- **50k에서 browse와 홈이 약 250ms:** 모든 행마다 `NOT_LISTED_BECAUSE`를 계산하는 비용이다. 해결하려면 파생 컬럼이나 materialized view로 "listed" 여부를 저장하는 등 구조를 바꿔야 한다. **운영 규모가 10k를 넘을 때** 재검토한다.
- **fuzzy가 0건일 때 50k에서 400ms:** trigram이 모든 행을 확인한다. 결과가 0건인 경로에서만 발생한다.

캐시는 도입하지 않았다. 모든 페이지가 `force-dynamic`이라 데이터가 늘 최신이고, 위 수치에서 10k 이하는 50ms 안팎이다.

## 6. UI (C-5 / C-6)

- **검색 필터:** type chip에 "Subagents"를 추가했다(`typeFilters.ts`, `ARTIFACT_TYPE_IDS`). 검색 launcher에도 같은 목록이 쓰인다.
- **상세 화면에 추가한 섹션:**
  - Related artifacts
  - Using this kind of artifact
  - Versions
- **frontmatter 판정:** 유형별 규격을 따른다. agent는 `AGENT_SPEC_KEYS`, 그 밖에는 기존 `SPEC_KEYS`를 쓴다.
- **바뀌지 않은 것:**
  - client component 3개(새 dependency 없음)
  - Markdown 렌더링 경로(`SkillBody`, sanitize)
  - 외부 링크의 `rel="noopener noreferrer"`
- **기존 Phase 2(U1–U4)에서 이미 구현돼 이번에 바꾸지 않은 것:**
  - 빈 결과, 오류, 유사 결과의 구분
  - 필터 해제 링크
  - 키보드 단축키

## 7. 검증

| 항목 | 결과 |
|---|---|
| `search.eval.test.ts` 21건(격리 DB) | PASS |
| `search.test.ts` 기존 전체 | PASS(trigram 부재 케이스 1건은 의도된 SKIP) |
| 로컬 E2E `/artifacts?type=agent`, `q=code-architect&type=agent` | 200, 17건 |

## 8. Rollback

- `pathBonus`: 코드만 되돌리면 된다.
- 0010: `DROP INDEX`로 되돌린다(절차는 migration 주석에 있음). 이전 코드는 index에 의존하지 않는다.
