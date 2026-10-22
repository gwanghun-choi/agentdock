# AgentDock Phase 12 — Artifact Installation & Usage Experience

작성 2026-10-22 · 기준 HEAD `34a7561`(develop) + 미커밋 변경 · 측정 환경: 로컬 test DB(`127.0.0.1:55432/agentdock_test`, schema `agentdock`), e2e seed(fixture 7개 + `fixture/ui-edge-cases`)

## 1. Executive Summary

- 이번 Phase의 핵심 발견은 **detector가 이미 저장한 설정 정보가 상세 화면에 한 줄도 표시되지 않았다**는 점이다.
  - MCP 서버의 이름·transport·command·args·url·env 이름(`meta.servers`)과 hook의 event·matcher·command(`meta.handlers`)는 Phase 3부터 DB에 있었다.
  - 그런데 두 타입은 body가 `''`라서, 상세 화면의 File 섹션에는 "No body."만 나왔다.
- 새 **Setup** 섹션(`src/components/SetupPanel.tsx`)이 이 저장된 값을 타입별로 보여 준다. 새 DB query, column, migration, GitHub 요청, client JS는 모두 0이다.
- 출처는 블록마다 표시한다. "From the file"(원문 그대로)과 "Derived"(파일명과 문서 규약에서 계산)를 구분한다.
- 설치 명령은 만들지 않았다. 특히 plugin은 marketplace를 기록하지 않기 때문에, 명령을 보여 주지 않는다는 사실과 그 이유를 화면에 쓴다.
- 기존 결함 두 가지를 실측으로 찾아 고쳤다.
  1. 파일명에 `#`이 있는 artifact의 상세 페이지가 **404**였다. route segment가 인코딩된 채로 전달되기 때문이다.
  2. GitHub permalink의 경로를 인코딩하지 않아 `#`, `?`, 공백이 있는 경로의 링크가 깨졌다.
- hook command에 들어 있는 credential 형태의 값이 Capabilities 줄에 원문으로 노출되던 것을 `<redacted>`로 가린다. baseline에서 1건 노출을 실측했고, 변경 후에는 0건이다.
- 검증 결과: unit/DB 1425–1426 passed(§21), E2E 21/21, axe WCAG 2.2 AA 위반 0(6페이지 × 1280/320px), search eval은 Phase 11과 같다.
- **판정: CONDITIONAL.** 로컬 검증은 모두 통과했다. CI와 운영 데이터에서의 표시는 push 이후에 확인해야 한다(§23).

## 2. Phase 12 목표와 범위

| 우선순위 | 항목 | 결과 |
|---|---|---|
| P0 | 기존 상세·Usage 구현 분석 | 완료(§3–§6) |
| P0 | 유형별 사용 안내 | Setup 섹션 6개 타입 구현 |
| P0 | 설치 정보의 출처 표시 | 블록별 provenance 문구 |
| P0 | Copy UX | 기존 `CopyButton` 재사용: MCP JSON, command 이름 |
| P0 | Plugin–Subagent 관계 | 기존 구현이 이미 동작함. E2E 유지(§14) |
| P0 | MCP 설정 보안 | `redact.ts` 추가, env 값은 원래 저장하지 않음 |
| P0 | 모바일·접근성 | axe 0 위반, 320px overflow 0 |
| P1 | Slash Command 안내 | `/name [argument-hint]` |
| P1 | Hook 안내 | handler별 블록 |
| P1 | Version History 개선 | content hash 열, GitHub 파일 이력 링크 |
| P1 | Source Commit 비교 링크 | **미구현**(§15: 순서가 보장되지 않음) |
| P2 | 설치 명령 생성, 설정 생성기, Text Diff, Compatibility Matrix, Dependency Graph | **미구현**(근거 부족 또는 비용 대비 효과 없음) |

## 3. 기존 Artifact Detail Source Map

| 항목 | 확인 내용 |
|---|---|
| Artifact Type | `skill`, `plugin`, `mcp_server`, `command`, `hook`, `agent`(그리고 badge만 있는 `catalog`) |
| Detector | `src/detect/{skill,plugin,mcp,command,hook,agent,catalog}.ts`, nesting은 `src/detect/nesting.ts` |
| Source Content | `package_version.body`: 상한이 있는 발췌. MCP, hook, plugin은 `''` |
| Metadata | `package.meta`(jsonb, detector별), `package_version.frontmatter`(jsonb) |
| Relationship | `package.parent_path`: nesting pass가 plugin root 아래 artifact에 기록한다 |
| Usage Data | `src/components/usageGuide.ts`: 타입 단위 설명, 문서 링크, 복사 위치(skill/command/agent) |
| Detail UI | `src/app/r/[owner]/[repo]/[...path]/page.tsx` |
| Version | `package_version`(content hash당 1행), `getVersionHistory` 20행 |
| Tests | `src/components/*.test.tsx`(render), `src/db/queries/packages.test.ts`(DB), `e2e/journeys.spec.ts` |

데이터 흐름(실측 구조)은 다음과 같다.

```text
GitHub tree + raw file (src/github/)
  → detector match()/parse() (src/detect/*)   meta·frontmatter·body 생성. env 값은 버린다
  → nesting pass                              parent_path
  → persistScan (src/ingest/persist.ts)        package / package_version (content hash로 dedupe)
  → getPackageDetail / getRelatedPackages / getVersionHistory / getCapabilityFindings
  → 상세 page: Details · Files · Capabilities · Related · Setup(신규) · Using it · Versions · File
```

## 4. Artifact Type별 저장 데이터 현황

| Type | `meta`에 이미 있는 것 | Phase 11까지 화면에 나온 것 |
|---|---|---|
| skill | frontmatterKeys, specPure, allowedTools | Files 표, allowed-tools(Capabilities), 타입 가이드, 복사 경로 2개 |
| plugin | detectionConfidence, mcpServers(이름), declaredComponents / shape-only의 components | Related(포함된 컴포넌트), 타입 가이드 |
| mcp_server(.mcp.json) | serverCount, servers[name, transport, command, args, url, envKeys] | **command 문자열만** Capabilities 한 줄에 나옴. 나머지는 미표시, File은 "No body." |
| mcp_server(server.json) | packages[registryType, identifier, version, transport], remotes | **미표시** |
| command | frontmatterKeys, allowedTools. frontmatter에 `argument-hint` | 본문, 복사 경로 2개 |
| hook | scope, events, hookCount, handlers[event, matcher, type, command] | command만 Capabilities 줄에 원문으로 나옴. event와 matcher는 미표시 |
| agent | declaredTools, disallowedTools, model, mcpServers(이름), scope | 도구(Capabilities), 본문. model, 제외 도구, MCP 이름은 미표시 |

## 5. Usage/Installation Baseline: 사용자가 할 수 있던 행동

baseline 측정은 HEAD 빌드를 `:3971`에 띄우고 같은 DB에서 했다.

| Type | Before(Phase 11) | After(Phase 12) |
|---|---|---|
| Skill | 경로 복사, 타입 문서 링크 | + "skill은 디렉터리 전체"라는 안내와 **commit 고정 디렉터리 링크**(`/tree/<sha>/<dir>`) |
| Plugin | 포함 컴포넌트 탐색 | + manifest가 선언한 컴포넌트 경로와 inline MCP 이름. **설치 명령을 보여 주지 않는 이유**를 명시 |
| MCP(.mcp.json) | 파일 permalink뿐 | 서버별 transport, 실행 명령, URL, env 이름. **mcpServers JSON 복사** |
| MCP(server.json) | 파일 permalink뿐 | package(registry, identifier, version)와 remote. launch 명령을 만들지 않는다는 사실을 명시 |
| Command | 경로 복사 | + **`/name [argument-hint]`** 표시와 `/name` 복사 |
| Hook | Capabilities 줄의 원문 command | handler별 event, matcher, command(마스킹), type |
| Subagent | 도구, 본문, parent plugin | + model, 제외 도구, 참조 MCP 서버 이름 |
| `#` 등 특수문자 파일명 | **상세 404, GitHub 링크 깨짐** | 정상 표시, 링크가 `%23`으로 인코딩됨 |
| Version | commit, 시각, 선언 버전, 상태 | + content hash 12자, **GitHub의 파일 commit 이력** 링크 |

## 6. 기존 기능 재사용 분석

- **`usageGuide.ts`(타입 단위)는 그대로 유지했다.** 새 Setup 섹션은 "이 파일" 단위 정보만 담당한다. 페이지에는 "Setting up this file"(파일)과 "Using this kind of artifact"(타입) 두 섹션이 나란히 있다.
- **`CopyButton`을 재사용했다.** 기존 동작을 그대로 쓴다: secure context에서만 표시, `role="status"`로 Copied와 실패 알림. 새 client component는 없다.
- **`.facts install` 스타일을 재사용했다.** 긴 값에는 기존 `fact-long`을 붙였다. CSS 변경은 0줄이다.
- **`getRelatedPackages`(plugin↔component)는 이미 Phase 10/11에서 완성돼 있다.** 중복 개발하지 않았다.
- **상세 query는 기존 query에 column 2개만 추가했다.** 상세 query에 `frontmatter->'argument-hint'`, history query에 `content_hash`를 더했다.

## 7. Usage Instruction 모델

요청서의 예시 인터페이스(`UsageInstruction { kind, source, verified }`)는 도입하지 않았다. 이유는 다음과 같다.

- 정보의 출처는 이미 타입별 detector의 `meta` 형태로 고정돼 있다. 범용 instruction 배열로 바꾸면 "detector → instruction" 변환 계층이 하나 더 생길 뿐이다. 그 계층의 소비자는 SetupPanel 하나다.
- `verified: boolean`은 이 프로젝트에서 쓸 수 없는 단어다. "verified"는 `check-boundaries`의 no-verdict-vocabulary 대상이고, 원본에서 확인했다는 사실을 안전성이나 동작 보장으로 오해하게 만든다.

대신 출처를 **문구로** 구분한다.

| 구분 | 화면 문구 | 쓰는 곳 |
|---|---|---|
| Source | "From {path}, as written." | MCP, hook, agent, plugin |
| Derived | "Derived: the documentation names a command after its file …" | command 이름 |
| Convention | "About the type, from its documentation — not about this file." | 기존 usageGuide 섹션 |
| Unavailable | "Not shown. … any command here would be a guess." / "not composed here" | plugin 설치, registry launch |

어느 문구도 실행 성공이나 안전성을 말하지 않는다. 페이지에는 원래부터 "AgentDock … cannot say whether it is safe."가 있다.

## 8. Skill 안내

- 복사 위치 `.claude/skills/<slug>/`와 `~/.claude/skills/<slug>/`는 기존 usageGuide에 있다(문서 규약).
- 새로 추가한 것:
  - "A skill is its whole directory, not one file." 안내
  - `https://github.com/<repo>/tree/<commit>/<dir>` 링크. 읽은 commit에 고정되어 있어 provenance 규칙을 지킨다.
- `SKILL.md` 하나만 복사하면 된다고 말하지 않는다. Files 표가 디렉터리의 script, reference, asset을 나열한다.
- raw URL(`raw.githubusercontent.com`) 복사는 넣지 않았다. AGENTS.md의 "Every GitHub hostname lives in `src/github/`"를 `check-boundaries`의 `HOST_RULES`가 강제하므로 UI에 그 host를 둘 수 없다. permalink로 충분하다.

## 9. Plugin 안내

- 표시하는 것: manifest의 `declaredComponents`(경로 원문), inline `mcpServers` 이름. shape-only plugin은 인식 근거가 된 component 디렉터리를 보여 준다.
- **Install command: "Not shown."** marketplace detector(`catalog.ts`)는 seed만 만들고 marketplace 이름과 entry를 저장하지 않는다. 그래서 `/plugin install name@marketplace`의 `@marketplace` 부분에 근거가 없다.
- 이 명령을 보여 주려면 catalog를 artifact로 저장하는 ingest 변경과 재수집이 필요하다. §22에 남은 과제로 적었다.
- 포함 컴포넌트는 기존 Related 섹션에서 탐색한다. parent_path로 디렉터리상 확인된 관계만 보여 주고, manifest가 다른 경로를 가리키는 컴포넌트는 따라가지 않는다는 사실도 이미 화면에 적혀 있다.

## 10. MCP 안내

- **.mcp.json:** 서버별로 다음을 보여 준다.
  - Server, Transport
  - Starts(command와 args), Connects to(url)
  - Environment variables(이름만, "AgentDock does not store the values.")
- **"As configuration":** 저장된 필드만으로 `{"mcpServers": {...}}`를 다시 만들어 보여 주고, Copy JSON 버튼을 붙였다.
  - `env`는 값이 저장되지 않으므로 넣지 않는다.
  - transport가 `stdio`(문서상 기본값)이면 `type`을 생략한다.
  - 마스킹된 값이 있으면 "each `<redacted>` has to be replaced"라고 알린다.
- **server.json(registry manifest):** package와 remote를 보여 준다. 실행 명령(`npx …` 등)은 manifest에 없으므로 "not composed here"라고 적는다.
- AgentDock는 아무것도 실행하지 않는다. 버튼은 복사만 한다.

## 11. Subagent 안내

- 표시: Model, Tools withheld(`disallowedTools`), MCP servers named. 값이 없으면 "not declared" 또는 "none declared"라고 쓴다.
- 독립 설치와 plugin을 통한 제공 구분:
  - `.claude/agents/`에 있는 것은 usageGuide의 복사 위치가 적용된다.
  - plugin 안에 있는 것은 Related의 "Inside the plugin X"가 표시된다(기존 기능, E2E로 확인).
- 호출 문구("Use the X subagent")는 만들지 않았다. 문서 규약이 자동 위임과 명시 호출을 모두 허용하므로, 한 가지 형태를 보여 주면 근거 없는 단정이 된다.

## 12. Slash Command 안내

- `Typed as /<file-name> <argument-hint>`. 이름은 파일명에서 나오고(`command.ts`: `name = basename − .md`), 문서 규약이 그렇게 정한다. 그래서 **Derived**로 표시한다.
- **argument-hint 실측:**
  - 문서 예시 `argument-hint: [file]`은 YAML에서 **문자열이 아니라 길이 1인 배열**로 파싱된다. 처음 구현한 문자열 전용 SQL은 이 값을 놓쳤고, E2E가 실패해서 발견했다.
  - `hintText()`는 문자열 배열을 `[a, b]` 형태로 되돌린다. 회귀 테스트가 있다.
- Copy command는 `/<name>`만 복사한다. hint는 자리표시자이기 때문이다.
- plugin 안의 command(`/plugin:cmd` 이름공간)는 표시하지 않는다. 문구는 "a copy at one of the paths below"로 범위를 한정했다.

## 13. Hook 안내

- handler별 블록에 Event, Matcher(비어 있으면 `every`), Command(코드 텍스트, 마스킹), Type을 보여 준다.
- 문구: "Each command runs when its event fires; it is shown as text and nothing here runs it."
  - 기존 usageGuide note "Read every command it names before copying"도 그대로 있다.
- hook에는 복사 버튼을 두지 않았다. 버튼 하나로 다른 사람의 shell 명령을 붙여 넣게 만드는 것은 이 Phase의 위험 기준에 맞지 않는다. 확인하는 경로는 permalink다.
- event에 handler가 문서 형태로 없으면, 명령이 없다는 사실을 그대로 쓴다.
- 처음에는 4열 표로 만들었는데, 320px에서 axe `scrollable-region-focusable` 위반이 1건 났다. 열 폭을 줄이자 이번에는 단어가 글자 단위로 끊겼다. 그래서 MCP와 같은 `dl` 블록으로 바꿨다.

## 14. Related Artifact

- 기존 `getRelatedPackages`를 그대로 쓴다. container 1 query와 components 1 query이고, 둘 다 같은 repository의 행만 본다. N+1은 없다.
- 지원하는 관계: plugin → skill, agent, command, hook, mcp(디렉터리 기준), 그리고 artifact → container plugin.
- 동일 repository의 다른 artifact는 repository 페이지(`/r/<owner>/<repo>`)가 이미 전체 목록을 보여 준다. 상세 화면에 중복으로 넣지 않았다.
- 새 query도 index도 없다.

## 15. Version History

- 추가한 것:
  - content hash 열: 12자를 보여 주고 `title`에 전체 값을 둔다. "content당 1행"이라는 설명을 눈으로 확인할 수 있다.
  - "commits to this file, up to the one shown" 링크: `https://github.com/<repo>/commits/<commit>/<path>`. 읽은 commit부터 이어지는 GitHub 파일 이력이다.
- **compare 링크는 만들지 않았다.**
  - history는 `ingested_at` 순이다. 예전 content로 돌아간 경우 그 행이 맨 위로 올라가므로(persist.ts), 인접한 두 행이 commit 조상 관계라는 보장이 없다.
  - 순서가 뒤집힌 `base...head`는 GitHub에서 빈 비교나 diverged로 나온다. 조상 관계를 확인하려면 API 호출이 필요하다.
- **정적 Text Diff는 만들지 않았다.**
  - `package_version.body`는 상한이 있는 발췌다. MCP, hook, plugin은 body가 `''`다.
  - 그래서 diff가 의미 있는 타입은 skill, command, agent뿐이고, 그마저도 발췌의 diff다. P2로 남긴다.

## 16. UI/UX 구현 내용

- 섹션 순서: Details · Files · Capabilities · Related · **Setup**(신규, TOC 포함) · Using it · Versions · File.
  - 요청서의 권장 순서(Overview → Source → Install → Usage …)대로 전체를 재배치하지는 않았다. 기존 E2E와 사용자 경험을 바꾸는 큰 변경이기 때문이다. 새 섹션만 타입 가이드 바로 앞에 넣었다.
- 긴 명령, JSON, URL은 `fact-long`으로 전체 폭을 쓰고, `.install code`의 `pre-wrap`과 `overflow-wrap: anywhere`로 줄바꿈한다. 스크롤 박스가 없으므로 키보드 tab stop 문제도 없다.
- 모바일: E2E는 320px에서 MCP JSON과 hook 페이지의 가로 overflow 0을 확인한다. axe 실행 시 320px에서 6개 페이지 모두 overflow 0px였다.
- 키보드: E2E에서 `Copy JSON`에 focus를 주고 Enter를 누르면 `role=status`가 "Copied"가 되고, 클립보드 내용이 유효한 JSON인지 확인한다.

## 17. 출처 신뢰성

| 표시값 | 근거 |
|---|---|
| 서버, handler, 선언 경로, model 등 | detector가 저장한 원문(`meta`) |
| `/name` | 파일명 + 문서 규약. Derived로 표시 |
| 복사 위치 | usageGuide. 문서 URL은 2026-10-21에 200 응답 확인 |
| 디렉터리, 이력 링크 | 읽은 commit sha에 고정. 브랜치 링크는 없음 |
| 설치 명령 | **없음** |

## 18. 보안 검토

| 항목 | 처리 |
|---|---|
| XSS / HTML injection | 모든 값은 React text node다. markup 문자열을 만들지 않는다. fixture hook의 `echo "<script>alert(1)</script>"`가 텍스트로 표시되고 dialog가 0건인 것을 E2E로 확인했다. unit 테스트는 `&lt;b&gt;` escape를 확인한다. |
| Markdown injection | 해당 없음. Setup은 Markdown을 렌더링하지 않는다. File 섹션은 기존 sanitize pipeline을 쓴다. |
| Shell / JSON escaping | 명령은 텍스트로만 보여 준다. JSON은 `JSON.stringify`로 만들며 E2E가 클립보드 값을 `JSON.parse`한다. |
| Path traversal | 디스크 접근이 없다. route segment decode는 parameterized `inArray` 조회에만 쓴다. 잘못된 escape는 그대로 두어 아무것과도 일치하지 않는다. |
| Credential exposure | `redact.ts`를 Setup 전체와 Capabilities의 declared 줄에 적용한다. env 값은 원래 저장하지 않는다(mcp.ts, plugin.ts, agent.ts). |
| 잘못된 링크 | 경로를 segment별로 인코딩한다. `#`, `?`, 공백에 대한 회귀 테스트가 있다. |
| Source commit 불일치 | 모든 링크는 표시 중인 version의 `commit_sha`를 쓴다. |

마스킹 규칙(`src/components/redact.ts`):
- URL의 password
- `Bearer`, `Basic`, `Token` 뒤의 값
- 이름이 key, token, secret, passw, pwd, credential, signature, cookie, session을 포함하는 `name=value`, `name: value`, `--flag value`, `["--flag","value"]`
- GitHub, `sk-`, Stripe, Slack, AWS, Google, GitLab의 고정 prefix token

`${VAR}`와 `$VAR`는 변수 참조이므로 유지한다.

**실측:**
- 시드된 hook과 MCP 명령 32개에 적용했다. 바뀐 것은 합성 credential 2개뿐이고, 실제 fixture 명령 30개에서 오탐은 0건이다.
- baseline hook 페이지 HTML에는 합성 token이 1회 들어 있었다. 변경 후 6개 페이지에서는 0회다.

**한계:** 패턴 기반이므로 이름표 없는 secret은 놓칠 수 있다. 원본은 permalink에 있다. File 섹션의 Markdown 발췌(skill, command, agent 본문)는 공개된 그대로 렌더링한다. 관찰 기록이기 때문에 그 안의 값은 가리지 않았다.

## 19. 데이터 모델 변경 여부

**Schema 변경 없음, migration 없음, backfill 없음.**

- 필요한 값은 모두 이미 있었다. `meta.servers`, `meta.handlers`, agent와 plugin의 meta는 detector 출력 그대로이고, `frontmatter.argument-hint`와 `content_hash`도 저장돼 있다.
- 따라서 운영 DB에 있는 기존 행에도 push 직후 바로 표시된다. 재수집이 필요 없다.

## 20. 성능 Before/After

측정 조건: 같은 로컬 DB, 같은 seed. baseline은 HEAD 빌드(`:3971`), after는 변경 빌드(`:3972`). 각 3회 예열 후 측정했다.

| 페이지 | HTML Before | HTML After | SQL 문장 Before → After |
|---|---|---|---|
| MCP | 38,197 B | 46,218 B | 4 → 4 |
| Hook | 37,430 B | 41,684 B | 4 → 4 |
| Command(`c#-review`) | 404 | 43,024 B | 2(404) → 4 |
| Plugin | 43,401 B | 47,636 B | 6 → 6 |
| Skill | 41,561 B | 45,150 B | 5 → 5 |
| Agent | 40,648 B | 43,338 B | 4 → 4 |

- **SQL 문장 수**는 local test DB에 `log_statement=all`을 임시로 켜고 셌다. 측정 후 RESET했고, 이후 DB 단위 설정이 없음을 확인했다.
- **Client JS**는 `.next/static` 전체 592,480 B로 같고, 상세 페이지가 받는 script는 9개, 576,574 B로 같다. 바이트까지 동일하다.
- **응답 시간**은 로컬에서 6–19ms로 두 빌드 사이에 의미 있는 차이가 없다. LCP는 측정하지 않았다(§21 NOT RUN). 새 요소는 서버에서 렌더링하는 텍스트이고 이미지나 폰트를 추가하지 않는다.
- **외부 요청:** 새 GitHub 요청은 0이다. 새 HTML에 `api.github.com`과 `raw.githubusercontent` 문자열이 0회다. 링크는 사용자가 누를 때만 이동한다.
- **CI 시간:** E2E 6개 추가로 Playwright가 15개 약 6s에서 21개 7.6–8.8s로 늘었다(로컬).

## 21. 테스트 결과

| 항목 | 결과 |
|---|---|
| `check:boundaries` | PASS(11 migration, 96 source, 32 UI) |
| `lint`(biome) | PASS(222 files) |
| `typecheck` | PASS |
| `test`(unit+DB, `TEST_DATABASE_URL`) | 1차 **1426 passed, 2 skipped**. 마지막 변경 후 재실행에서는 live GitHub 테스트(`src/github/permalink.test.ts`, CI에서 skip) 1건이 비인증 rate limit 소진(remaining 0/60)으로 FAIL. `CI=1`로 재실행하면 **1425 passed, 3 skipped**. rate limit이 리셋된 뒤 live 테스트만 다시 실행해 **1 passed** |
| Search evaluation | PASS 52. MRR 0.924, nDCG@10 0.903, Recall@10 0.883으로 Phase 11과 같음 |
| Production build(standalone) | PASS |
| Vercel build mode(`VERCEL=1`) | PASS(standalone 미생성, 의도된 동작) |
| Docker build | PASS(`agentdock:phase12-local`, 322MB, 로컬 이미지) |
| Playwright E2E | **21 passed**(기존 15 + 신규 6) |
| axe-core 4.10.3 WCAG 2.0/2.1/2.2 A·AA | 6페이지 × 1280/320px에서 위반 0. 임시 실행이며 저장소 의존성은 아님 |

- skip 2건의 사유:
  - `client.test.ts`의 "wrong password": 로컬 test DB가 trust 인증이라 비밀번호가 없다.
  - `search.test.ts`의 "pg_trgm unavailable": extension이 없는 환경 전용 테스트다.
- axe 1차 실행에서 color-contrast 8–10건이 나왔지만 baseline에도 같은 수가 있었다. reduced-motion으로 다시 돌리면 양쪽 모두 0이므로, 진입 애니메이션 중간 프레임 때문이다.
- 신규 unit 테스트:
  - `redact.test.ts` 18개
  - `SetupPanel.test.tsx` 11개
  - `hrefs.test.ts` 6개. `#` permalink와 segment decode의 회귀 테스트를 포함한다.
- 신규 E2E:
  - MCP 표시, 마스킹, 키보드 복사, JSON 검증
  - hook 표시, 마스킹, markup 무력화
  - `#` 파일명 상세와 링크
  - plugin에 설치 명령이 없음, skill 디렉터리 링크
  - version hash와 이력 링크
  - 320px 줄바꿈
- **NOT RUN:**
  - GitHub Actions(push 이후)
  - LCP 계측
  - 운영 데이터로 렌더링(운영 DB 접속 금지)
  - Safari와 Firefox
  - 실제 스크린리더

## 22. 남은 한계

1. **plugin 설치 명령:** marketplace(`catalog.ts`)가 seed만 만들고 저장하지 않는다. 명령을 보여 주려면 catalog 이름과 entry를 저장하는 ingest 변경과 재수집이 필요하다.
2. **plugin 안의 command와 skill의 이름공간 호출**(`/plugin:name`)은 표시하지 않는다.
3. **compare 링크와 Text Diff:** §15 참고.
4. **마스킹은 휴리스틱이다.** 이름표 없는 secret은 놓칠 수 있다. Markdown 발췌는 가리지 않는다.
5. **MCP JSON 재구성은 저장된 필드만 담는다.** `headers`, `cwd`, `env` 값 등 detector가 저장하지 않는 필드는 빠진다. 화면에 "Rebuilt from the fields above"라고 쓴다.
6. **운영 데이터 형태:** 오래된 detector 버전이 쓴 `meta`에 필드가 없더라도 모든 접근을 type guard로 처리한다. 다만 운영 행으로 렌더링하는 것은 확인하지 못했다.

## 23. 운영 반영 체크리스트

- [ ] 사용자가 commit하고 develop에 push한다.
- [ ] CI(check, database, e2e)가 green인지 확인한다. 새 fixture는 새 CI DB에 seed된다.
- [ ] Deploy workflow: migration 없음 → Vercel 배포만 진행된다.
- [ ] 운영 페이지를 직접 확인한다: MCP 1개, hook 1개, command 1개의 Setup 섹션과 `<redacted>` 동작.
- [ ] 운영에서 파일명에 `#`이나 공백이 있는 artifact가 이제 200인지 확인한다(이전에는 404).
- 운영 DB 쓰기, migration, sync 재실행: **필요 없음.**

## 24. 최종 판정

**CONDITIONAL**

- 로컬에서 실행한 정적 검사, unit, DB, 검색 평가, build 3종, E2E, 접근성 검사는 모두 통과했다.
- 운영 반영 전 남은 조건은 CI green과 운영 데이터 화면 확인 두 가지다.
