# AgentDock

한국어 | [English](./README.en.md)

AI agent artifact — Skill, Plugin, Marketplace, MCP Server, Slash Command,
Hook — 를 모아 놓은 공개 index입니다. 자리를 잡은 공개 GitHub repository에서
artifact를 discovery하고, 파일을 직접 읽어 선언 내용을 기록하고, 읽은 시점의
정확한 commit에 있는 정확한 파일로 다시 링크합니다.

![AgentDock artifact discovery 화면](docs/images/agentdock-artifacts.png)

**AgentDock은 파일을 읽고 읽은 내용을 보고합니다. 실행하지 않으며, 어떤
artifact가 안전한지 말해주지 않습니다.** 위험 점수도, 등급도, 안전 배지도
화면 어디에도 없습니다. 의도한 설계입니다.

## AgentDock이란?

작고, 직접 호스팅할 수 있는 index입니다. 공개 repository들을 지켜보다가 그
안의 artifact 파일을 발견하고, 그 파일이 무엇을 선언하는지 기록하고, 그 결과를
검색할 수 있게 만듭니다. 제품의 전부입니다.

marketplace도, installer도, package manager도 아니며, GitHub 전체를 색인하지도
않습니다. 아무것도 실행하지 않고, 아무것도 미러링하지 않고, 아무것도 추천하지
않습니다.

여기서 두 가지가 따라 나오고, 아래 설계 결정 대부분이 여기서 비롯됩니다.

- **corpus는 생태계가 아닙니다.** 모든 검색 결과 페이지가 이 사실을 명시합니다.
  AgentDock이 색인하지 않은 artifact가 존재하지 않는 artifact인 것은 아닙니다.
- **인기도는 scheduling signal이지 안전성 보증이 아닙니다.** 아래의 star 하한선은
  제한된 request budget을 아직 읽지 않은 repository 중 어디에 먼저 쓸지 결정할
  뿐, 어떤 artifact에 대해서도 아무 말을 하지 않습니다.

## 지원하는 Artifact

여섯 가지이며, `src/detect/`에 detector가 하나씩 있습니다.

| Type | 인식 기준 |
|---|---|
| **Agent Skill** | YAML frontmatter가 있는 `SKILL.md` |
| **Claude Code Plugin** | `.claude-plugin/plugin.json`, 또는 그런 모양의 디렉터리 |
| **Plugin Marketplace** | `.claude-plugin/marketplace.json` — catalog이며, artifact가 아니라 repository를 공급합니다 |
| **MCP Server** | `.mcp.json`, 그리고 MCP registry의 자체 항목 |
| **Slash Command** | `.claude/commands/` 아래의 Markdown 파일 |
| **Hook Configuration** | `.claude/settings.json`의 `hooks` 블록 |

인식은 **파일의 모양**으로만 하며, repository 이름이나 topic으로 하지 않습니다.
이 중 아무것도 없는 repository는 파일을 한 번도 읽지 않습니다 — tree에서 경로를
먼저 확인하고, 일치하는 경로만 가져오기 때문입니다.

## Repository Discovery 정책

자동 discovery는 다음을 **모두** 만족할 때만 repository를 추가합니다.

- public repository
- GitHub Stars **50 이상**
- fork 아님
- archived 아님
- 그리고 실제로 지원하는 artifact 파일이 들어 있을 것

**제출 폼은 없습니다.** AgentDock에는 계정도, 로그인도, 운영자 검토도 없습니다.
따라서 익명 방문자가 repository 이름을 적어 넣을 수 있는 endpoint는 공용
request budget을 인증 없이 소모하는 통로이자, 아무거나 공개 index에 밀어 넣는
통로가 되며, 그 책임을 물을 대상도 없습니다. discovery는 전부 자동으로
이루어집니다 — 공개 registry, 큐레이션된 seed list, 큐레이션된 link list, 그리고
GitHub 자체 topic search에서 가져옵니다.

star 하한선은 `src/corpus/policy.ts` 한 곳에만 정의되어 있고, 나머지 전부 —
topic sweep의 자체 하한선, 안내 메시지, UI 문구 — 가 그 값을 읽어 씁니다.

**진입 gate이지 삭제 규칙이 아닙니다.** 이미 들어온 repository는 이후 star가
하한선 아래로 떨어져도 기여한 artifact를 그대로 유지하고, 평소 일정대로 계속
다시 읽힙니다. repository의 인기가 떨어졌다는 이유로 artifact를 지우는 것은
신뢰 점수를 다른 이름으로 부르는 것과 같습니다. `src/db/queries/search.ts`는 이
하한선을 참조하지 않으며, **어떤 module이 이 값을 import해도 되는지 그 전체
목록을 테스트가 검증**합니다.

**하한선은 품질 점수가 아니고 ranking 입력값도 아닙니다.** 오직 한 가지 질문에만
답합니다 — 시간당 60건이라는 GitHub request budget 안에서, 아직 아무도 들여다보지
않은 repository 중 무엇을 먼저 읽을 것인가. 검색 결과는 star 순으로 정렬되지
않으며, repository가 인기 있다는 이유로 어떤 artifact가 다른 artifact보다 위에
오지 않습니다.

## Repository가 Index되는 방식

```
      registry            seed list        curated lists       topic search
   (MCP registry)      (config/seeds)     (awesome-*.md)     (GitHub search API)
          │                   │                  │                   │
          └───────────────────┴────────┬─────────┴───────────────────┘
                                       ▼
                                   repo_seed              GitHub core 비용 0
                                       │
                                       ▼
                                  ingest_job              큐
                                       │
                                       ▼
                          ┌───────────────────────┐
                          │  metadata + tree      │        core request 2회
                          ├───────────────────────┤
                          │  discovery gate       │ ─────► 거절: 여기서 종료
                          ├───────────────────────┤
                          │  commit SHA 그대로?   │ ─────► 변경 없음: 여기서 종료
                          ├───────────────────────┤
                          │  detect → 파일 수집   │        raw host, quota 소모 없음
                          │  → parse → analyze    │
                          └───────────┬───────────┘
                                      ▼
                          package / package_version /
                          capability_finding  ────────────► 검색, 브라우즈
```

두 gate 모두 비싼 구간보다 **위**에 있습니다. 거절된 repository와 변경 없는
repository는 각각 core request 2회와 파일 읽기 **0회**로 끝납니다. 전체를 읽을
때 드는 최대 400회의 raw fetch와 2분의 wall clock에 대비되는 비용입니다.

## Scheduled Synchronization

**web server는 ingestion을 하지 않습니다.** `docker compose up`, 재시작, 크래시
복구, 롤백 모두 GitHub request를 0건 발생시킵니다. in-process worker도 없고
`INGEST_WORKER` 플래그도 없습니다 — 부팅 시 돌던 poll loop는 기본값을 off로
바꾼 것이 아니라 **삭제**했습니다. 플래그로 남겨두면 그 결합이 환경변수 하나
거리에 계속 남기 때문입니다.

ingestion은 명령 하나이고, cron이 **하루 2회** 실행하며, 끝나면 종료됩니다.

```bash
bun run sync
```

모든 소스에서 discovery하고, 마지막으로 읽은 지 12시간이 지난 저장된
repository를 다시 확인하고(가장 오래전에 읽은 것부터 — corpus가 굶는 구간 없이
순환합니다), 큐를 비우고, 요약을 출력합니다.

```
AgentDock scheduled sync

  Repositories processed        12
    ingested (new or changed)   11
    unchanged, no files read     0
    no artifacts found           0

  Declined by discovery policy   0
    below 50 stars               0
    archived on GitHub           0
    a fork                       0

  Could not be read              0
  Rate limited, deferred         1
  Other failures                 0

  GitHub core requests left      0 of 60
  Duration                      94s
```

모든 상한선은 자기가 무엇을 버렸는지 출력합니다. budget이 떨어져 멈춘 실행은
상한선 중 얼마를 쓰지 않고 남겼는지 말하고, 오래된 repository를 전부 확인하지
못한 refresh는 몇 개를 남겼는지 말합니다. 아무것도 출력하지 않는 상한선은
"전부 훑었다"로 읽히기 때문입니다.

### Commit SHA 기준 Incremental refresh

마지막으로 읽은 이후 default branch가 움직이지 않은 repository는 **파일을 단 한
개도 가져오기 전에** 조기 종료합니다. tree 응답과 함께 도착하는 commit SHA를
저장된 `last_ingested_sha`와 비교하고, 일치하면 core request 2회와 raw fetch
0회로 끝납니다.

따라서 sync를 연달아 두 번 실행하면 두 번째는 사실상 아무것도 읽지 않습니다.
하루 2회 일정이 성립하는 근거가 바로 이 성질입니다.

다시 확인할 대상은 `scanned_at` 오래된 순으로 정합니다. 한 번의 실행 상한을
넘는 크기의 corpus도 뒤쪽이 굶지 않고 순환합니다. fork와 archived repository는
refresh 대상에서 제외되지만 — archive에는 다음 commit이 없습니다 — **삭제되지는
않으며, star는 아예 참조하지 않습니다.**

## Search / Browse

- **전문 검색(Full text).** 이름, 요약, 경로, type을 A→D 가중치로 색인합니다.
  PostgreSQL의 generated `tsvector` column이며 데이터베이스가 직접 유지합니다.
- **오타 허용.** 전문 검색이 아무것도 찾지 못하면 이름과 요약에 대한 trigram
  검색이 유사한 항목을 제시합니다. 정확히 일치한 결과가 아니라 **유사 항목**이라고
  분명히 표시합니다.
- **필터.** artifact type과 capability 관찰 결과로 좁힐 수 있으며, 개수를 세는
  것과 동일한 술어(predicate)를 써서 SQL 안에서 적용됩니다.
- **URL이 곧 상태.** 검색어, 필터, 페이지가 모두 주소창에 있습니다. 폼은 native
  control을 쓰는 평범한 GET이고, JavaScript를 꺼도 페이지 전체가 동작합니다.
- **키보드.** `/`는 어디에서든 검색 입력에 커서를 놓고, 검색 페이지가 아니라면
  그쪽으로 이동합니다. Ctrl/Cmd+K도 같은 일을 하며 입력란 안에서도 동작해서
  기존 검색어를 선택해 둡니다 — 다음 타자가 그대로 덮어씁니다. 별도의 검색
  화면은 없습니다. 키는 같은 폼과 같은 route에 작용합니다.
- **Permalink.** 모든 artifact에 고정 URL이 있고, 모든 "source on GitHub" 링크는
  AgentDock이 실제로 읽은 commit SHA를 가리킵니다. branch를 가리키지 않습니다 —
  branch는 움직이기 때문입니다.

capability 필터는 결과를 좁힐 뿐 ranking 입력값이 아닙니다. star, 다운로드 수,
그 밖에 repository의 인기와 관련된 어떤 것도 마찬가지입니다.

## Architecture

```
Next.js 16 (App Router, 모든 route가 force-dynamic, client component 3개)
        │
        └── PostgreSQL 16          유일한 datastore. cache 없음, queue 없음
             ├── 검색: tsvector + GIN, 오타 허용은 pg_trgm
             └── ingest 큐: SELECT … FOR UPDATE SKIP LOCKED
```

Redis도, OpenSearch도, vector database도, message broker도 없습니다. 큐는
테이블이고, scheduler는 cron이고, lock manager는 PostgreSQL입니다.

프런트엔드도 같은 모양입니다. 모든 페이지는 Server Component이고, 스타일은
custom property를 쓰는 순수 CSS입니다 — UI kit도, CSS framework도, animation
library도, icon package도 없습니다. `'use client'`를 가진 component는 3개뿐이며
어느 것도 데이터를 갖거나 fetch하지 않습니다: job 페이지의 polling effect,
검색 입력에 커서를 놓는 keyboard shortcut(`/` 또는 Ctrl/Cmd+K), 그리고
framework가 client component이기를 요구하는 error boundary입니다. 검색, 필터,
페이지네이션은 native control을 쓰는 GET form이라 JavaScript를 꺼도 동작합니다.

```
src/
  app/          페이지만 — server function은 의도적으로 없음
    artifacts/                   브라우즈와 검색
    jobs/[id]/                   ingest 실행 1건, 읽기 전용
    r/[owner]/[repo]/            repository와 그 안에서 목록에 오른 것들
    r/[owner]/[repo]/[...path]/  artifact 1개: 모든 필드와 permalink
  components/   Markdown sanitize 렌더러, 목록 행, inline icon
  corpus/       policy.ts (discovery gate), caps.ts (모든 수집 상한),
                refresh.ts (어떤 저장 repository를 다시 볼지),
                fanout.ts, seedList.ts, links.ts, search.ts
  db/           schema, 연결, 페이지가 쓰는 조회 query
  detect/       detector 6종, 관대한 frontmatter 파싱, 상한 있는 JSON 파싱
  analyze/      capability 관찰 — 파일이 무엇을 참조하는지, 판정이 아님
  github/       HTTP client, metadata / tree / raw 읽기
  ingest/       pipeline.ts (전체 경로), persist.ts (단일 transaction),
                errors.ts (사람에게 보여줄 수 있는 모든 문장),
                retry.ts (지연 곡선과 outcome별 처리), worker.ts (job 1건)
  proxy.ts      요청별 nonce와 Content-Security-Policy
scripts/        migrate, sync, corpus reset, 경계 검사, fixture 수집
fixtures/       고정된 GitHub 응답과 직접 작성한 악의적 입력
```

## Local Development

```bash
cp .env.example .env      # bootstrap 때 정한 password를 채웁니다
bun install
bun run db:migrate
bun run dev               # http://localhost:3000
```

`bun run dev`는 `search_path`가 AgentDock 소유 schema로 한정된 role로 연결되지
않으면 아예 기동을 거부합니다.

아직 아무것도 색인되어 있지 않고, dev server는 아무것도 색인하지 않습니다.
채우려면 다음 중 하나를 씁니다.

```bash
# 고정된 fixture, 네트워크 전혀 사용하지 않음. 실제 repository 4개, SHA 고정.
bun run db:seed
bun run db:seed baoyu-skills

# 또는 실제 수집. 상한 있음 — repository 약 25개, core request 60건 중 50건.
bun run sync
```

`db:seed`는 `fetch`만 fixture reader로 바꾼 **실제** pipeline을 돌립니다. 따라서
seed로 들어간 행은 실제 ingest가 만들어내는 것과 정확히 같습니다.

## Database

AgentDock은 다른 애플리케이션과 PostgreSQL 서버를 공유하도록 만들어졌습니다.
`agentdock`과 `agentdock_test` 두 schema를 소유하며, 그 밖의 어떤 객체에도
권한을 갖지 않습니다.

```bash
# 최초 1회, superuser로. 먼저 내용을 읽어보세요.
psql -U <superuser> -d <database> -v ON_ERROR_STOP=1 -f scripts/sql/bootstrap-agentdock.sql
psql -U <superuser> -d <database> -c '\password agentdock_app'
```

`\password`는 입력을 화면에 표시하지 않고 SCRAM verifier만 전송하므로, 평문이
파일·명령행·서버 로그 어디에도 남지 않습니다.

- 되돌리기: `scripts/sql/rollback-agentdock.sql`
- 경계가 유지되는지 확인: `scripts/sql/verify-isolation.sql`

검색의 오타 허용에는 `pg_trgm`이 필요합니다. AgentDock은 이 extension을 **절대
설치하지 않습니다** — 이를 사용하는 migration은 첫 문장이 guard이며, 없으면
필요한 명령을 그대로 알려주면서 크게 실패합니다.

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA public;   -- superuser, 최초 1회
```

### `drizzle-kit migrate` 대신 `scripts/migrate.mjs`를 쓰는 이유

drizzle-kit도 drizzle-orm의 자체 migrator도 `CREATE SCHEMA IF NOT EXISTS`로
시작합니다. PostgreSQL은 schema가 이미 있는지 확인하기 **전에** *database*에 대한
`CREATE` 권한을 먼저 검사하므로, `NOCREATEDB`이고 database에 `CREATE` 권한이 없는
role에서는 이 문장이 `42501`로 실패합니다. AgentDock의 role이 정확히 그렇게
만들어져 있습니다. 의도한 것입니다.

그 권한을 부여하면 AgentDock에게 공유 database에 schema를 만들 능력을 주는
것이 됩니다. 그래서 `scripts/migrate.mjs`가 drizzle의 migration reader와 이력
테이블 형식을 그대로 재사용하고 — 같은 파일, 같은 hash, 같은
`__drizzle_migrations` column — role이 실행할 수 없는 그 한 문장만 생략합니다.
나중에 되돌아가더라도 데이터 변경은 필요 없습니다. `drizzle-kit generate`는 손대지
않았습니다. offline이고 연결을 열지 않습니다.

## Docker Deployment

Compose service는 4개입니다. 상시 실행되는 것은 첫 번째뿐이고, 나머지 셋은
`tools` profile 뒤에 있는 one-shot이라 `docker compose up`으로는 시작되지
않습니다.

| Service | Profile | 역할 |
|---|---|---|
| `agentdock` | — | web container: SSR, 브라우즈, 검색 |
| `sync` | `tools` | cron이 실행하는 scheduled ingest |
| `migrate` | `tools` | 새 이미지를 올리기 전 migration 적용 |
| `corpus-reset` | `tools` | corpus 비우기. gate가 걸려 있고 거의 쓰지 않음 |

```bash
cp .env.example .env.production      # AGENTDOCK_PORT 추가
docker compose --env-file .env.production --profile tools run --rm migrate
docker compose --env-file .env.production build agentdock
docker compose --env-file .env.production up -d agentdock
```

`--env-file`은 선택 사항이 아닙니다. service의 `env_file:`은 실행 중인 container
안으로 주입되지만, Compose가 `ports:` 매핑의 `${AGENTDOCK_PORT}`를 치환할 때는
읽히지 **않습니다**. 그때 읽히는 것은 Compose 자신의 env 파일뿐이고, 이 저장소는
`.env`를 포함하지 않습니다. 플래그를 빼면 크게 실패하는데, 조용히 기본 포트를
잡는 것보다 그 편이 의도한 동작입니다.

`AGENTDOCK_PORT`에 기본값이 없는 것도 의도적입니다. 호스트의 다른 service가
쓰려는 포트를 조용히 가로챌 수 없게 하기 위함입니다.

일회성 corpus reset과 cron 등록을 포함한 전체 runbook은 [DEPLOY.md](DEPLOY.md)에
있습니다.

## Cron 설정

하루 2회, 12시간 간격입니다. 이 간격이 12시간 staleness 기준과 맞아떨어집니다.

```cron
0 3,15 * * * cd /path/to/agentdock && docker compose --env-file .env.production --profile tools run --rm sync >> /var/log/agentdock-sync.log 2>&1
```

`/path/to/agentdock`은 실제 배포 경로로 바꾸고, 시각은 서버의 local timezone
기준이라는 점에 유의하세요. systemd timer를 **추가로** 걸지 마세요. 같은 one-shot을
두 scheduler가 실행하면 시간당 60건짜리 budget이 두 배로 소모됩니다.

## Testing

```bash
bun run ci     # 경계 검사, lint, type check, test — CI가 돌리는 것과 동일
```

**소켓을 여는 테스트는 없습니다.** `fixtures/`에 실제 repository 4개의 GitHub
응답이 commit SHA로 고정되어 있고, 직접 작성한 악의적 입력(`adversarial/`,
`xss/`)도 함께 들어 있습니다. 전체 suite가 이 바이트들만 가지고 돌아갑니다.

데이터베이스가 필요한 suite는 `agentdock_test` schema를 쓰고, `DATABASE_URL`이
없으면 눈에 보이게 skip합니다. 덕분에 CI는 데이터베이스 없이도 통과하고, 로컬
실행은 실제 query를 검증합니다.

```bash
bun run db:test:setup     # agentdock_test 구성 (DDL만 — 행은 지우지 않음)
bun run db:test:reset     # 비우기 (schema 이름이 스크립트 안에 리터럴로 박혀 있음)
```

Vitest는 그 하나의 schema에 대해 테스트 **파일을 병렬로** 실행합니다. 따라서
데이터베이스를 쓰는 suite는 다른 suite가 만들 수 없는 sentinel 값으로 자기 행을
구분합니다.

## 명령어

| 명령어 | 하는 일 |
|---|---|
| `bun run dev` | 개발 서버. ingestion을 시작하지 않습니다. |
| `bun run build` / `bun run start` | 프로덕션 빌드와 서빙. 빌드에는 데이터베이스가 필요 없습니다. |
| `bun run sync` | **scheduled job.** discovery, refresh, drain, 요약 출력. |
| `bun run corpus:sync --source=…` | 같은 기능을 소스와 상한선을 노출한 형태로. 색인을 수동으로 채울 때 씁니다. |
| `bun run corpus:reset --confirm` | corpus 비우기. `AGENTDOCK_ALLOW_CORPUS_RESET=1`도 함께여야 실행됩니다. 어떤 것도 DROP하지 않습니다. |
| `bun run ci` | 경계 검사, lint, type check, test |
| `bun run test` | Vitest. `run`이 붙어 있는 데 유의 — 맨 `bun test`는 Bun 자체 러너를 부르고, 이 파일들에서 멈춥니다. |
| `bun run lint` / `bun run format` | Biome, 검사와 자동 수정 |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run check:boundaries` | migration과 소스 경계 검사 |
| `bun run db:generate` | `src/db/schema.ts`에서 migration 생성. offline. |
| `bun run db:migrate` | `drizzle/`의 검토된 migration 적용 |
| `bun run db:seed [fixture]` | 고정 fixture를 실제 pipeline으로 ingest |
| `bun run db:reset --confirm` | `agentdock`의 모든 테이블 DROP (개발 전용) |
| `bun run db:test:setup` / `db:test:reset` | 테스트 schema 구성 / 비우기 |
| `bun run fixtures:capture` | GitHub에서 fixture corpus 다시 고정 |
| `bun run analyze:backfill [limit]` | 저장된 바이트에 대해 capability analyzer 재실행. GitHub request를 발생시키지 않습니다. |

`db:push`와 `db:pull`은 의도적으로 없습니다. 이 둘은 살아 있는 데이터베이스
상태와 diff하는 유일한 migration 명령이고, 이 데이터베이스에는 다른
애플리케이션의 데이터가 있을 수 있습니다. 그런 script가 생기면
`bun run check:boundaries`가 빌드를 실패시킵니다.

CI는 `bun run build` 다음에 `bun run ci`를 실행합니다. 직접 돌리는 것과 같은
명령이라 서로 어긋날 수 없습니다. 빌드가 먼저인 이유는 linter가 읽는 타입 선언을
빌드가 다시 만들어내기 때문입니다.

## Security Considerations

**AgentDock은 어떤 artifact가 안전한지 말해주지 않습니다.** 파일을 읽고 읽은
내용을 보고할 뿐입니다.

대신 읽는 동안 무엇을 *관찰했는지*는 말합니다. 판정이 아니라 관찰의 어휘로
쓰여 있습니다.

- *No network request observed* (네트워크 요청이 관찰되지 않음)
- *No Bash grant declared* (Bash 권한 선언이 없음)
- *No bundled script files* (동봉된 script 파일이 없음)

각각은 AgentDock이 **무엇을 들여다봤는지**를 서술할 뿐, artifact가 할 수 있는
모든 것을 서술하지 않습니다. 이 문구를 보여주는 모든 페이지가 그 사실을 함께
적습니다. null과 empty는 끝까지 구분됩니다 — 분석했더니 아무것도 선언하지 않은
artifact와, 아무도 분석하지 않은 artifact는 다르게 표시됩니다.

다섯 개의 구조적 규칙을 `bun run check:boundaries`가 `src/` 아래 모든 비테스트
파일에 대해 강제합니다. 각각은 기억에 의존하지 않고 강제할 수 있는 요구사항이기
때문입니다.

| 규칙 | 실패 조건 | 보호하는 것 |
|---|---|---|
| `no-raw-html` | `rehype-raw`, `dangerouslySetInnerHTML`, `allowDangerousHtml` | 신뢰할 수 없는 Markdown이 markup으로 파싱되지 않습니다. skill 본문의 HTML은 text node입니다. |
| `no-execution` | `child_process`, `execSync`, `spawnSync`, `node:vm` | 스캔한 repository의 어떤 것도 실행되지 않습니다. |
| `no-disk-write` | `writeFileSync`, `createWriteStream`, `mkdirSync`, … | repository 내용이 디스크에 닿지 않습니다. 압축 해제와 path traversal이 구조적으로 사라집니다. |
| `no-host-sprawl` | `src/github/` 밖에 GitHub 호스트명이 등장 | "이 코드가 어디에 접속할 수 있는가"에 `git grep`이 완전하게 답합니다. 모든 URL은 검증된 두 조각으로 조립됩니다. |
| `no-verdict-vocabulary` | UI 문구의 *safe*, *clean*, *verified*, *trusted*, *approved*, *malicious*, *grade*, *risk score* | 어떤 페이지도 안전성 판정을 렌더링하지 않습니다. |

**50 star 하한선은 여기에 포함되지 않습니다.** request budget에 관한 scheduling
규칙일 뿐이며, 통과시킨 대상에 대해 어떤 보증도 사지 않습니다.

모든 artifact 본문은 출처를 붙인 상한 있는 발췌로 저장되며 미러가 아닙니다.
렌더링되는 모든 본문은 sanitize하는 Markdown pipeline을 거칩니다.

## 한계

- **corpus는 작고, 의도적으로 상한이 걸려 있습니다.** 모든 수집 소스에 상한이
  있고, 모든 상한은 자기가 무엇을 버렸는지 출력합니다.
- **인증 없는 GitHub은 시간당 60건**이고 repository당 2건이므로 시간당 약 30개
  repository입니다. index가 자랄 수 있는 속도의 실제 한계입니다. `GITHUB_TOKEN`을
  주면 5,000건으로 올라가며, scope는 필요 없습니다.
- **큰 repository는 부분적으로 읽힙니다.** 1회 400 파일, wall clock 120초.
  중간에 잘린 repository는 자기 페이지에 그 사실을 밝히고, 불완전한 읽기로는
  아무것도 목록에서 내리지 않습니다 — 부분적으로 읽었다는 것이 무언가 사라졌다는
  증거는 아니기 때문입니다.
- **capability 관찰은 분석이 아닙니다.** 파일이 선언한 frontmatter와 본문 텍스트를
  읽을 뿐, import를 해석하거나 참조를 따라가거나 무언가를 실행하지 않습니다.
- **검색은 PostgreSQL 전문 검색과 trigram입니다.** embedding도, 의미 검색도,
  텍스트 관련도 외의 ranking도 없습니다.
- **정렬은 최신순이며 품질순이 아닙니다.** "most starred" 정렬은 없고, 추가하려면
  그것이 무엇을 의미하는지에 대한 명시적 결정이 필요합니다.

## Development Workflow

작업 규약은 [CLAUDE.md](CLAUDE.md), 불변식은 [AGENTS.md](AGENTS.md)를 보세요.
요약하면 — 바꾸기 전에 소스를 읽고, diff를 좁게 유지하고, 버그였던 것에는 회귀
테스트를 붙이고, 끝났다고 말하기 전에 `bun run ci`와 `bun run build`를 돌립니다.
