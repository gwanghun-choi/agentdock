# AgentDock Phase 97: Full-Site Immersive Redesign

기준 `978bcba`, 배포 `94be7ad`, 2026-11-07(KST). 수치와 판정은 이 날짜의 실행 결과다. 브리프가 언급한 Phase 96은 커밋에도 문서에도 없어, Phase 95를 기준으로 삼았다.

## 1. 최종 판정

**PASS (사용자 직접 확인 대기).** CI, 배포, smoke, 운영 경량 확인을 통과했다. 코드 리뷰의 HIGH 2건과 MAJOR 6건은 모두 수정했다. "와, 이거 뭐야?"라는 체감과 실기기 터치, Safari는 자동으로 판정하지 않았다.

## 2. 디자인 콘셉트

브리프의 "Interactive AI Artifact Universe"를 이 제품의 재료로 옮겼다.

> **The Yard. 모든 Artifact는 부두의 컨테이너이고, 자신이 읽힌 커밋이 찍혀 있다.**

- **Commit print:** 커밋 SHA의 16진수 40자리를 그대로 막대 높이로 그린 그림이다. 사이트의 대표 그림이자 실제 데이터 자체라서, 사실이 아닌 내용을 말할 수 없다.
- **한 무대:** 라이트 모드로 넘어가던 목록과 상세까지 어두운 무대로 통일했다.
- **섹션마다 다른 리듬:** 하단 전체에 fade-in을 반복하지 않고, 쌓이는 상자, 지도, 고정 파이프라인, 색면 한 장, 큰 이름으로 맺는 마무리를 썼다.
- **쓰지 않은 것:** 보라색 그라데이션 카드, glassmorphism, 반복 glow.

| 결정 | 이유 |
|---|---|
| 라이트 모드 폐지 | 하단만 밝아지면 목록과 상세가 다른 사이트처럼 보였다. 되돌리기는 `color-scheme` 두 곳이다. |
| "Featured"를 만들지 않음 | 편집 선정이 없고, 별 수로 순위를 매기는 것은 불변 조건 위반이다. 최근 읽힌 피드를 Spotlight로 만들었다. |
| 3D 상자는 CSS | 상세 페이지에 WebGL 비용이 없고, GPU 없는 브라우저에서도 같게 그려진다. |
| 스크롤 연동 모션 위주 | 멈추면 같이 멈추고, 화면 밖 비용이 없으며, 일시정지 버튼이 필요 없다(WCAG 2.2.2). |

## 3. 메인 하단

| 섹션 | Before | After |
|---|---|---|
| Recently indexed | 목록과 미리보기 패널 | 패널에 실제 commit print 추가. 호버, 포커스, 유형별 색은 유지 |
| 유형 소개 | 벤토 타일 | 전체 폭 상자 6개가 스크롤에 따라 쌓임. 유형마다 자기 색 바닥과 그림 |
| The yard (신규) | 없음 | 최근 읽힌 실제 240건을 저장소별로 세운 탐색 지도 |
| 파이프라인 | 4단계 고정 스크롤 | 유지. 마지막 단계에 최신 실제 커밋이 찍힘 |
| 저장소 조건 | 밝은 띠 위 어두운 패널 | 사이트 유일의 앰버 전체 색면. 화면을 채우는 `50+` |
| Footer | 문장과 워드마크 | 마무리 문구, CTA, 유형과 날짜순 링크, 스크롤로 떠오르는 워드마크 |

유형별 그림은 문서가 정의한 동작을 스크롤로 보여 준다. 특정 Artifact에 대한 주장은 하지 않는다.

| 유형 | 동작 |
|---|---|
| Skill | 페이지가 부채처럼 펼쳐진다 |
| Plugin | 부품이 한 상자로 들어간다 |
| MCP | 클라이언트에서 연결선이 뻗는다 |
| Command | 이름이 한 글자씩 입력된다 |
| Hook | 이벤트가 선을 따라 와서 걸린다 |
| Subagent | 궤도를 돌고 작업을 돌려준다 |

Yard의 조건은 다음과 같다.
- 스크롤로 가까워질 때만 `/api/yard`를 CDN에서 받는다. 운영에서 스크롤 전 요청 0건을 확인했다.
- 화면에 표시되는 관계는 저장된 사실인 "같은 저장소" 하나뿐이다.
- 몇 건 중 몇 건인지와 무엇을 그렸는지를 문장으로 밝힌다.

## 4. 목록

- **세 가지 첫머리:** 전체 인덱스는 유형별 비율 막대, 유형 목록은 그 유형의 색 바닥과 그림과 정의, 검색은 검색어를 크게 보여 준다.
- **카드:** 25개 동일 행을 카드로 바꿨다. 첫 카드는 넓고, 카드 전체가 링크이며, 포인터를 따르는 빛과 commit print가 있다.
- **유형별 형태:** Command는 `/`, Hook은 레일, MCP는 양 끝점, Plugin은 스터드, Subagent는 고리.
- **상태:** 빈 결과는 빈 정박지로 그렸다. 무작위 링크는 버튼으로 올렸다.
- **유지:** URL 기반 검색, 필터, 정렬, 페이지 이동은 그대로다. 저장소 페이지 목록도 같은 카드를 쓴다.

## 5. 상세

공통 구조는 큰 이름, CSS 3D 컨테이너, 유형 고유 띠, 확인 항목 4개다. 유형 고유 띠는 파일이 선언한 내용으로만 만든다. 선언이 없으면 빈 띠를 그리지 않고 생략한다.

| 유형 | 고유 띠 |
|---|---|
| Command | 입력 형태 `/name [args]`를 큰 프롬프트로 |
| MCP | 클라이언트, transport, 서버 연결선과 실행 명령 |
| Hook | 이벤트 레일, matcher, 명령 |
| Subagent | 모델, 제외한 도구, 지명한 MCP 서버 |
| Skill | 디렉터리에 담긴 파일 |
| Plugin | 담긴 구성요소 모듈. 각각 링크 |

- **자격증명:** 띠의 명령은 Setup과 같은 redaction을 거친다. 단위 테스트와 E2E로 확인했다.
- **코드 블록:** 언어 표시, 복사, 서버 측 구문 강조, 실행 명령 강조. 줄 단위 상한을 넣었다. 32 KB 한 줄 악성 입력이 상한 전 959 ms였다.
- **섹션:** Setup은 유형 색, "무엇인가"는 큰 문장, 확인하지 않는 항목은 타일, Related는 카드, 파일은 읽기 시트로 구성했다. 상단에 읽기 진행 막대를 넣었다.

## 6. Motion System과 신규 아트워크

| 종류 | 값 | 쓰임 |
|---|---|---|
| 즉각 반응 | `--dur-fast` 120 ms, `--dur` 180 ms | 호버, 포커스 |
| 도착 | `--dur-slow` 320 ms, `--ease-emphasized` | 카드 등장, 30 ms 스태거 |
| 스크롤 연동 | 시간 없음 | 그림, 제목, 상자, 지도, 색면 |
| 페이지 전환 | 기존 View Transition | 유지 |
| Reduced motion | 키프레임이 존재하지 않음 | 모든 요소가 완성 상태로 표시 |

- **신규 컴포넌트:** `CommitPrint`, `KindArt`(SVG 6종), `CargoBox`, `DetailSignature`, `ArtifactYard`(클라이언트), `PointerTilt`(클라이언트, 렌더 없음).
- **새 의존성과 외부 이미지:** 없음. 모두 코드로 그려서 저작권 문제가 없다.
- **Phase 95 로직:** 투어와 스크롤 복귀를 건드리지 않았다. 운영에서 스크롤 복귀 후 투어 재개를 확인했다.

## 7. Before/After

파일은 `docs/images/phase97/`에 있다. Before 전체 페이지는 스크롤 연동 요소가 시작 상태로 찍혀, 파이프라인과 조건 섹션이 실제보다 어둡게 보인다.

| 화면 | Before | After |
|---|---|---|
| 메인 | `before-home.png` | `after-home-1-hero`부터 `after-home-10-footer`까지 10장 |
| 목록 | `before-artifacts.png` | `after-list.png` |
| 검색, 빈 결과 | `before-search.png`, `before-search-empty.png` | `after-list-search.png`, `after-list-empty.png` |
| 유형 목록 | `before-type.png` | `after-list-kind.png` |
| 상세 | `before-detail.png` | `after-detail-{skill,plugin,mcp,mcp2,command,hook,agent}.png`, `after-detail-usage.png`, `after-detail-file.png` |

## 8. 모바일

`before-home-phone.png`, `before-artifacts-phone.png`, `before-detail-phone.png`와 `after-phone-{home,kinds,yard,gate,list,kind,detail}.png`, 태블릿 `after-tablet-list.png`를 비교한다.

390×844 운영 값이다.

| 항목 | 값 |
|---|---|
| 가로 넘침 | 0 |
| 홈 첫 Artifact | y=834 (기준 844) |
| 목록 첫 카드 | y=678 |
| 유형 목록 첫 카드 | y=764 |

- 휴대폰에서는 상자를 쌓지 않고 순서대로 보여 주며, 그림을 줄이고 설명을 먼저 둔다.
- Yard 박스는 첫 탭에 내용을 보여 주고 두 번째 탭에 연다.
- GPU 없는 환경은 정적 그림 그대로이고 three.js 청크는 0개다.

## 9. 테스트와 리뷰

**CI `42243638387`:** 성공.

| Job | 결과 |
|---|---|
| database | 1,660 통과, 3 skip |
| check | 1,143 통과, 520 skip(DB 없는 job) |
| e2e | 127 통과, 1 flaky |

**로컬 경과(일회용 DB):**

| 실행 | 결과 |
|---|---|
| E2E 1차 | 113 통과, 7 실패 |
| E2E 2차 | 126 통과, 2 실패 |
| 수정 후 실패 건과 axe | 5 통과 |

실패는 실제 회귀 2건(휴대폰 첫 화면 예산, 워드마크 대비)과 테스트 쪽 문제였다.

**리뷰(PR Review Toolkit code-reviewer 1회):** 아래 8건을 수정했다. 수정본을 재리뷰하지는 않았고, 관련 테스트와 E2E로 확인했다.

| 등급 | 결함 | 조치 |
|---|---|---|
| HIGH | 터치 첫 탭이 바로 이동 | 누르는 시점의 상태로 판정, E2E 추가 |
| HIGH | 쌓인 상자 뒤로 Shift+Tab 포커스가 가려짐 | 포커스 시 앞으로, E2E 추가 |
| MAJOR | 좁은 화면에서 판독창이 지도를 가림 | sticky를 넓은 화면으로 한정 |
| MAJOR | Subagent 카드 포커스 링이 잘림 | 링을 안쪽에 그림 |
| MAJOR | 읽기 진행 막대가 헤더 뒤로 숨음 | 요소를 쌓임 맥락 밖으로 |
| MAJOR | 저장소 링크에 키보드로 못 감 | 판독창에 링크 추가 |
| MAJOR | 스크린리더에 필터가 무의미 | `aria-hidden`, 유형명, 라이브 안내 |
| MAJOR | prefetch로 요청 증가 | `prefetch={false}` |

리뷰 지적(미검증)을 근거로 `overflow-clip-margin`도 제거했다. Safari에서 전폭 배경이 잘릴 수 있어서다.

**NOT RUN:** 실기기 터치, Safari와 Firefox, 스크린리더 수동 확인, 성능과 부하 측정, Vercel 서버 로그, 운영 DB 조회.

## 10. 커밋 SHA

| SHA | 내용 |
|---|---|
| `708fbae` | 디자인 시스템, commit print, 그림, 3D 상자, 구문 강조 |
| `50ee009` | 메인 하단, Yard, Footer |
| `07dfe3b` | 목록 |
| `dc225b2` | 상세 |
| `94be7ad` | E2E, CLAUDE.md |

이 보고서와 스크린샷은 별도 커밋이다.

## 11. CI·Vercel 배포

- **CI:** `42243638387` 성공.
- **Deploy:** `42245616150` 성공. gate DEPLOY, smoke PASS.
- **운영 SHA:** `x-agentdock-commit` `94be7ad` 일치.
- **DB:** 마이그레이션 변경 없음. 0012 Contract 미적용, Contract 파일 2개 미추적 유지, 수동 Sync 없음.

운영 1회 측정이다.

| 경로 | 결과 |
|---|---|
| `/` | 200, 3.3 s, gzip 41.9 KB(이전 값 미측정) |
| `/artifacts` | 200, 3.1 s |
| `/artifacts?q=mcp` | 200, 1.5 s |
| `/artifacts?type=hook` | 200, 1.2 s |
| `/api/yard` | MISS 4.9 s, 이후 0.33 s, HIT 확인, 76 KB |
| `/artifacts/random?type=skill` | 307, 3.4 s |

실제 GPU 환경에서 scene live, 투어, 스크롤 복귀를 확인했다. Yard는 240박스, 9개 저장소였고 호버와 필터가 동작했다. 브라우저 오류는 0건이다.

## 12. 배포 URL

https://agentdock-delta.vercel.app

## 13. 남은 이슈

**원인 미확정**
- CI에서 `e2e/journeys.spec.ts:367`(행에서 패널로 가는 포인터 이동)이 한 번 실패한 뒤 재시도에서 통과했다. 이번에 패널 안에 print를 추가했으므로 무관하다고 단정할 수 없다. 원인은 조사하지 않았다.
- Phase 95의 `the tour stops off screen` 간헐 실패도 원인이 미확정인 채로 남아 있다. 이번 CI에서는 통과했다.

**MINOR**
- 카드 전체가 링크라서 본문 선택과 카드 안 `title` 툴팁이 막힌다.
- Yard는 최근 읽기 순이라 시점에 따라 소수 저장소에 몰린다(현재 9개).
- `/artifacts` 무필터 화면은 스냅샷 읽기가 1회 늘었다.
- `/api/yard`의 캐시 MISS 4.9 s, `/artifacts/random` 3.4 s.
- 휴대폰 홈 첫 Artifact y=834로 여유가 작다.
- 필터 칩에 유형 색이 없고, 목록 전용 키보드 단축키는 넣지 않았다.
- 저장소 페이지는 카드만 바뀌고 전용 첫머리가 없다.
- 라이트 토큰은 쓰이지 않는 상태로 남아 있다(되돌리기 대비).
