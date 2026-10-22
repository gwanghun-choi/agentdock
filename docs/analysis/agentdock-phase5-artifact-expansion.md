# AgentDock Phase 5 — Artifact 유형 확장 및 연관 탐색

작성일 2026-10-21 · 기준 HEAD `57c7c54` · 미커밋

## 1. 변경 목표

1. Claude Code Subagent를 일곱 번째 유형(`agent`)으로 추가한다. Detector → Analyzer → Persist → Search → 상세 UI 경로를 모두 연결한다.
2. Plugin과 그 구성요소의 관계를 화면에 보여준다.
3. 유형별 사용 안내를 정적 템플릿으로 제공한다.
4. Version 이력을 보여준다.
5. Codex·Cursor·Gemini 형식을 조사하고, 구현할지 판단한다.

## 2. 공식 형식 확인 (읽기 전용 조사, 2026-10-21)

| 형식 | 경로 | 필수 필드 | 출처 | 상태 |
|---|---|---|---|---|
| Claude Code Subagent | `.claude/agents/**/*.md`(재귀), plugin의 `agents/**` | `name`, `description`. plugin agent는 frontmatter가 없어도 파일명으로 로드된다 | code.claude.com/docs/en/sub-agents, plugins-reference | **VERIFIED, 구현함** |
| Gemini CLI extension | `gemini-extension.json`, `commands/*.toml` | 필수 여부가 문서에 없다 | gemini-cli docs/extensions/reference.md | 필수 필드 NOT VERIFIED, **구현 보류** |
| Cursor rules | `.cursor/rules/**/*.mdc` | 없음(`description`, `globs`, `alwaysApply`는 선택) | cursor.com/docs/context/rules | VERIFIED, **보류** — rule은 지시문이라 artifact 경계와 탐지 정밀도를 따로 정해야 한다 |
| Cursor/Codex subagent | `.cursor/agents/`, `.codex/agents/` | 모두 선택 | cursor.com/docs/context/subagents | VERIFIED(Cursor 기준). Codex 쪽 공식 문서는 NOT VERIFIED, **보류** |
| Codex skills | `.agents/skills/<name>/SKILL.md` | `name`, `description` | learn.chatgpt.com/docs/build-skills | **기존 skill detector가 이미 매칭한다**(`skill.ts`는 경로와 무관하게 `SKILL.md`를 찾음) |
| Codex custom prompts | `~/.codex/prompts/*.md` | — | learn.chatgpt.com/docs/custom-prompts | home 전용이고 저장소에 없다. deprecated. **해당 없음** |

제품 이름만 다르고 형식이 같은 것은 따로 등록하지 않는다. `.agents/skills`와 `.cursor/skills`는 기존 `skill` 유형으로 들어간다.

## 3. Subagent 구현

### 3.1 데이터 흐름

```
tree ─▶ agent.match()  (src/detect/agent.ts)
         ├─ .md, README 아님, 'commands' 세그먼트 없음 (command detector와 중복 방지)
         └─ 'agents' 세그먼트의 부모가 '.claude'이거나 plugin.match()가 돌려준 plugin root
      ─▶ assignParentPaths  (nesting.ts, 변경 없음) → plugin 안의 agent는 parent_path를 받는다
      ─▶ agent.parse()
         ├─ .claude/agents에 frontmatter 없음 → status 'none' (artifact 아님)
         ├─ .claude/agents에서 YAML 오류 → failed
         ├─ plugin agent에서 frontmatter 없음/오류 → partial, 이름은 파일명
         └─ meta: scope, declaredTools(verbatim|null), disallowedTools, model, mcpServers(이름만)
      ─▶ declaredCapabilities (src/analyze/declared.ts) → "declares tools: X" 한 줄당 finding 1개
      ─▶ persistScan (변경 없음) → package.type='agent'  ← FK: artifact_type('agent') 필요 (0009)
      ─▶ search ARTIFACT_TYPE_IDS / typeFilters / ArtifactBadge / Icon / CSS / IndexFlow
      ─▶ 상세 화면: AGENT_SPEC_KEYS 기준 frontmatter 판정, 사용 안내, 소속 plugin
```

### 3.2 정밀도 근거 (Baseline 측정)

| corpus | tree의 `*/agents/*.md` | 매칭 | 비고 |
|---|---|---|---|
| wshobson-agents | 204 | 204 | plugin root |
| disler-hooks-mastery | 19 | 19 | `.claude/agents/`, 하위 폴더 포함 |
| anthropics-claude-code | 15 | 15 | plugin root |
| addyosmani-agent-skills | 4 | 4 | root manifest plugin |
| anthropics-skills | 3 | **0** | `skills/skill-creator/agents/` — Claude Code가 읽지 않는 위치라 제외 |

### 3.3 신뢰하지 않는 입력 처리

- **`mcpServers`:** 인라인 정의에는 env 값이 들어 있을 수 있다. 그래서 이름만 `meta.mcpServers`에 남기고 frontmatter 저장본에서는 지운다. sentinel 테스트로 확인한다.
- **`tools`:** 원문 그대로 저장한다. 필드가 없으면 모든 tool을 상속한다는 뜻이므로 `null`로 두고, "tool 없음"으로 해석하지 않는다.
- **부재 필터:** `no_network`, `no_shell`, `no_scripts`는 agent에 적용하지 않는다(`ABSENCE_OBSERVABLE_TYPES` 불변). 근거가 없는 부재를 주장하지 않기 위해서다.
- **실행:** 아무것도 실행하지 않는다. 모델 연결도 없다.

### 3.4 DB

- `drizzle/0009_subagent_type.sql`: `INSERT INTO artifact_type ('agent','Subagent') ON CONFLICT DO NOTHING`. 데이터만 바꾸며 snapshot은 0008과 같다.
- `scripts/migrate.mjs`의 seed 목록에 `('agent','Subagent')`를 추가했다. `agentdock_test`는 이 seed로만 행을 받는다.

## 4. Plugin 연관 탐색 (B-4)

- **`getRelatedPackages`(`src/db/queries/packages.ts`):** 이미 저장된 `parent_path`만 사용한다.
  - 상위 plugin: 같은 저장소의 `type='plugin'` 중 `source_path`가 `parent_path` 또는 `parent_path/.claude-plugin/plugin.json`인 것.
  - 구성요소: plugin root(`pluginRoot()`이 manifest 경로나 shape-only 디렉터리를 역산)를 `parent_path`로 가진 행. 상한은 `CAPS.maxFiles`.
- **관계 생성 원칙:** 관계는 디렉터리 포함 관계뿐이다. plugin.json의 `agents`/`skills` 경로 override는 따라가지 않으며, 화면에도 그렇게 적었다.
  - root(`''`) plugin은 구성요소 목록을 만들지 않는다. nesting pass가 `''`에는 아무것도 연결하지 않기 때문이다.
  - 저장되지 않은 관계는 만들지 않는다. `parent_path`가 있어도 plugin 행이 없으면 `null`이다(테스트로 확인).
- **질의 수:** 상세 화면 query가 최대 2개 늘어난다. capability와 history 조회와 함께 `Promise.all`로 묶었다.

## 5. 사용 안내 (B-5)

`src/components/usageGuide.ts`는 정적 데이터다. 6개 유형마다 다음을 담는다.

- 용도
- 형식을 정의한 문서(링크 8개, 2026-10-21에 HTTP 200 확인)
- 문서에 나온 복사 위치
- 주의사항

이 내용은 유형에 대한 설명이며, 해당 파일에 대한 평가가 아니다. 원본이 제시하는 명령은 그대로 옮기지 않는다. 금지 어휘 검사(`check:boundaries` rule 6)도 통과했다.

`catalog`는 목록에 노출되지 않는 유형이라 안내 항목이 없다. 기존 skill 전용 Install 블록은 이 안내 섹션으로 흡수했고, 같은 경로를 계속 표시한다.

## 6. Version 이력 (B-6)

`getVersionHistory`는 최신순으로 최대 20개를 보여주고 전체 개수도 함께 알려준다. 각 행에는 다음을 표시한다.

- commit permalink
- 기록 시각
- 선언 version
- 파싱 상태
- 분석 여부

A→B→A 동작은 Phase 2 그대로다. 같은 내용으로 돌아온 행은 `ingested_at`이 갱신되어 맨 위로 올라가며, 화면 문구도 이를 설명한다. 본문 diff는 비용과 구조 문제로 **보류**했다.

## 7. 검증

| 항목 | 결과 |
|---|---|
| `src/detect/agent.test.ts` 20건 | PASS |
| phase gate(`pipeline.test.ts`) — agent 4/204, 기존 유형 수 불변, `truncated:false` | PASS |
| `packages.test.ts` 관계·history 4건 | PASS(격리 DB) |
| 로컬 E2E: 실제 pipeline으로 fixture 2개 수집(agent 본문은 합성) → `next dev`로 화면 확인 | agent 상세(소속 plugin, `declares tools`, Version 표, 안내), plugin 상세(구성요소 4개), `type=agent` 17건(합성 본문이 같은 2건은 중복 제외), skill 안내 경로 확인 |

## 8. 사이드이펙트와 제약

- 0009가 없는 DB에서 새 sync 코드를 실행하면 Subagent가 있는 저장소의 transaction 전체가 rollback된다. 결과는 `storage_failed`(retryable)이고, 그 저장소의 다른 유형도 갱신되지 않는다. 리허설에서 FK 오류를 재현했다. → **Migration-before-Push.**
- 실제 agent 본문은 fixture에 없다. 운영에서 첫 sync를 돌린 뒤 `partial` 비율을 확인해야 한다(키 이름 오탈자 등).
- `.cursor/agents`와 `.codex/agents`는 매칭하지 않는다(필수 필드 규칙이 다르다).

## 9. Rollback

- 코드를 revert하면 `agent` 유형 행은 그대로 남는다. 이전 코드의 UI는 알 수 없는 유형을 라벨 없이 표시한다(`ArtifactBadge` fallback).
- 0009를 되돌리려면 `type='agent'` 행이 없어야 한다. 절차는 migration 파일 주석에 있다.
