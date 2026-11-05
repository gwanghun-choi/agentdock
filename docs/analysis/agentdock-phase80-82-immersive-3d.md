# AgentDock Phase 80–82 — Interactive Artifact Cosmos

- 작성: 2026-11-05. 기준선: `e323e21`(Phase 79, 커밋 완료). 시작 시 작업 트리는 깨끗했다. 요청서의 "미커밋" 설명과 달라 Git 자체를 비교 기준으로 삼았다.
- 표기: PASS / FAIL / WARNING / PENDING. commit, push, 배포, 운영 DB 접근은 하지 않았다. 로컬 테스트 DB만 썼다.

## 1. Phase 79 분석

| 항목 | 측정 또는 소스 |
|---|---|
| 공간 | 2560×1440에서 `main` 1152px(폭의 45%), hero 554px(높이의 38%), h1 52px 고정 |
| 3D | 납작한 판 하나, 고정 카메라, 포인터 기울임 ±0.07rad, 입력 없음 |
| 재질·조명 | 환경 맵 없음, `flat`, 반구광과 그림자 조명 하나 |
| 루프 | `frameloop="demand"`, 진입 1.5초 뒤 정지 |
| 대체 화면 | 서버 SVG, 넓은 화면·모션 허용·WebGL·data-saver 아님 조건에서만 3D 로드 |

참고 사이트(https://3-d-fortfolio-introduce.vercel.app/)는 headless Chromium으로 열어 조사했다. 큰 GLTF 모델(`desktop_pc/scene.gltf`) 하나를 첫 화면에 크게 두고, 그 아래로 스크롤 섹션이 이어지는 구조다. 첫 화면을 3D가 채우는 규모감만 참고했고, 모델과 구성은 가져오지 않았다. 포인터 인터랙션 세부는 코드까지 확인하지 않았다.

사용한 스킬: frontend-design, Taste Skill(이번 세션 Phase 79에서 적용한 원칙), UI UX Pro Max(`threejs` 스택, 3D 스타일 검색). 스킬의 "모션 절제" 규칙보다 이번 요청의 몰입 목표를 우선했다.

## 2. 디자인

- **콘셉트:** "궤도 도크". 지름이 hero를 채우는 링 위에 유형별 도크 6개가 있고 중심에 인덱스가 있다. 브랜드의 `+`를 3D로 만든 코어가 초점이다.
- **데이터 연결:** 판 개수는 `plates()`(로그)이고, 입자는 등재 항목 1개당 1개(유형당 900개 상한), 라벨과 패널은 정확한 개수다. 케이블과 펄스는 장식이고 실시간 상태가 아니다(`dockBoard.ts` 상단).
- **공간:** hero 높이는 `100svh − 13rem`이라 1280×800에서도 첫 행이 첫 화면에 남는다(y=782). 120rem 이상에서 루트 글자 크기를 112.5%, 160rem 이상에서 131.25%로 키우고 `--wrap`을 84rem으로 넓혔다. 이 변경은 목록·상세에도 적용된다. 2560에서 h1은 105px, hero 높이는 1167px이다.

## 3. 인터랙션

| # | 기능 | 판정 | 동작 |
|---|---|---|---|
| 1 | Pointer Reactive Camera | 구현 | 포인터에 따라 yaw ±0.11, pitch ±0.05 |
| 2 | 3D Object Hover | 구현 | 레이캐스트, 도크 상승과 강조, 커서 변경 |
| 3 | 3D Object Selection | 구현 | 클릭하면 패널 고정. 빈 곳 클릭, Esc, Close로 해제 |
| 4 | Interactive Lighting | 구현 | 포인터 광원, 선택 도크의 색 광원 |
| 5 | Depth Parallax | 구현 | 먼 먼지, 바닥 격자, 링, 가까운 먼지가 서로 다르게 이동 |
| 6 | Type Highlight | 구현 | 칩 호버·포커스로 강조, 나머지 어둡게 |
| 7 | Smooth Camera Transition | 구현 | 링이 최단 경로로 돌아 도크를 앞으로 가져오고 카메라 접근 |
| 8 | Entrance | 구현 | 2.6초, 카메라 접근과 판 낙하, h1은 transform만 사용(LCP 영향 없음) |
| 9 | Scroll Camera | 구현 | hero 스크롤에 따라 위로 기울고 후퇴 |
| 10 | Data Signal | 구현(장식) | 케이블 셰이더 펄스 |
| 11 | Particles | 구현 | 항목당 입자, 셰이더로 이동(CPU 갱신 없음) |
| 12 | Search Focus | 구현 | 코어 발광, 입자가 코어로 흐름, 키 입력마다 펄스 |
| 13 | Info Panel | 구현 | 개수, 정의, 목록 링크. SVG 대체 화면에서도 칩으로 동작 |
| 14 | Card Depth | 부분 | Browse by type 카드만 스크롤 진입 시 회전. 행 틸트는 스캔을 해쳐 제외 |
| 15 | Page Transition | 기존 유지 | 기존 view transition 사용. 지연을 더하는 전환은 제외 |
| 16 | Custom Shader | 구현 | 입자, 먼지, 케이블, 바닥 |
| 17 | Environmental | 구현 | 코드로 만든 PMREM 환경 맵, CSS 조명, 선택 시 바닥 파동 |
| 18 | Advanced Scene Transition | 제외 | 장면이 홈에만 있어 얻는 것이 없음 |
| 19 | Micro-interactions | 구현 | 키 입력 펄스, 검색창 포커스 빛 |

키보드: 칩 포커스로 도크 이동과 패널 열기, Tab으로 패널 링크, Esc로 닫으면 포커스가 칩으로 돌아간다. 캔버스는 계속 `pointer-events: none`이고 hero 리스너가 레이캐스트하므로 컨트롤과 글자가 항상 먼저 입력을 받는다.

## 4. 기술 선택

추가 라이브러리 없음. three는 `three` 외부화, 최소화 기준(`bun build`)으로 측정했다.

| 후보 | gzip | 판단 |
|---|---|---|
| drei 10.7.9 (Float, AdaptiveDpr, Sparkles) | 2.1 KB | 몇 줄로 대체 가능 |
| drei (+Environment, Html, Text, OrbitControls, ContactShadows) | 73.5 KB | 쓰지 않을 기능 비용 |
| gsap 3.15.1 + ScrollTrigger | 45.6 KB | 스크롤은 passive 리스너, 보간은 프레임 루프로 충분 |
| @react-spring/three 10.1.2 | 15.6 KB | 지수 감쇠 한 줄로 대체 |
| 커스텀 GLSL | 약 1 KB 미만 | **채택**: 입자 수천 개가 draw call 1회 |

drei, GSAP, react-spring은 설치해 런타임을 비교하지 않았다. 번들 크기만 비교했고, 메모리·CPU·GPU는 설치하지 않았으므로 측정값이 없다. 외부 모델과 텍스처는 없다. 모두 코드로 생성하므로 라이선스 대상이 없다.

## 5. 성능 (Phase 79 → 현재)

로컬 production 빌드 2개, 같은 시드 DB(251행), cold context, 실제 GPU는 3회 중앙값, SwiftShader는 1회.

### 실제 GPU: Intel UHD 770 (ANGLE/Vulkan, headless)

| 지표 | 1440×900 | 1920×1080 | 2560×1440 |
|---|---|---|---|
| FCP/LCP (ms) | 60 → 64 | 52 → 76 | 68 → 72 |
| CLS | 0 → 0 | 0 → 0 | 0 → 0 |
| TBT (ms) | 0 → 57 | 0 → 53 | 0 → 56 |
| 가장 긴 Long Task (ms) | 0 → 83 | 0 → 79 | 0 → 94 |
| INP 근사(최대 입력 지연, ms) | 24 → 32 | 24 → 32 | 24 → 32 |
| 드리프트 중 FPS (최악 프레임 ms) | 60.3 → 60.1 (17) | 60.4 → 60.1 (17) | 60.4 → 60.2 (17) |
| 포인터 이동 중 FPS | 60.1 → 60.1 | 60.0 → 60.1 | 60.1 → 60.1 |
| 드리프트 중 메인 스레드 CPU % | 1.8 → 10.8 | 1.9 → 10.9 | 1.9 → 8.7 |
| 정지 시 CPU %, draw call | 0, 0 → 0, 0 | 0, 0 → 0, 0 | 0, 0 → 0, 0 |
| GC 후 JS heap (MB) | 8.3 → 10.3 | 8.3 → 10.4 | 8.3 → 10.3 |

Phase 79에는 드리프트가 없어, 그 CPU 값은 측정용 rAF 비용이다.

vsync를 끈 전체 프레임률(프레임 비용): 1440 606 → 471 fps, 1920 458 → 285 fps, 2560 379 → 144 fps. 2560에서 약 6.9 ms로 16.7 ms 예산 안이다. 캔버스 면적은 2560에서 1208×585 → 2560×1209로 약 4.4배 늘었다.

### 번들

| 항목 | Phase 79 | 현재 |
|---|---|---|
| 3D 청크 gzip | 244,603 B | 250,277 B |
| 데스크톱 홈 JS 전송량 | 383,068 B | 389,745 B |
| 390 홈 JS 전송량 | 138,465 B | 139,467 B |
| CSS gzip | 9,089 B | 9,865 B |
| 홈 HTML gzip | 16,599 B | 16,931 B |

### SwiftShader (소프트웨어, 1440×900)

FPS 60 → 35 (최악 100 ms), TBT 166 → 728 ms, INP 근사 56 → 200 ms, `data-scene=live`까지 1129 → 1877 ms. 적응 단계가 tier 4까지 내려간다(그림자 끔, DPR 하향). GPU 없는 환경에서는 비용이 크다.

### 유휴 렌더링

드리프트가 입력 없이 도는 이유는 정지 화면과 움직이는 공간의 인상 차이 때문이다. 비용은 위의 메인 스레드 약 9–11%와 GPU 프레임이다. 그래서 다음 경우 렌더링이 완전히 멈춘다.

- 입력 없이 20초가 지나면(약 4초 감속)
- hero가 화면 밖이면
- Pause를 누르면(약 1초, 다음 방문에도 유지)
- 탭이 숨겨지면(rAF 정지)

### 적용한 최적화

지연 로딩, 픽셀 예산(약 3.7M), 적응 품질(그림자 끔 → DPR 단계 하향), 화면 밖 정지, reduced-motion, WebGL 대체 화면, 모바일 정적 화면, 인스턴싱(판, 리브), 지오메트리와 머티리얼 재사용, 해제(`dispose`) 처리.

## 6. Three.js 경고 2건

| 경고 | 원인 | 조치 |
|---|---|---|
| `PCFSoftShadowMap has been removed` | **프로젝트에서 해결 가능.** `shadows`(값 없음)를 R3F가 PCFSoft로 해석. three r182 제거 | `shadows="percentage"`로 해결. E2E가 재발을 막음 |
| `THREE.Clock deprecated` | **라이브러리 내부.** R3F 9.8.2 `createStore`의 `new THREE.Clock()`. 2026-11-05 기준 latest도 9.8.2 | 숨기지 않고 유지. R3F 10 정식판에서 재확인 |

## 7. 브라우저 검증

실제 GPU(Intel UHD 770)로 2560, 1920, 1440, 1024, 390에서 10단계를 재현했다. 콘솔 오류 0, HTTP 4xx·5xx 0, 가로 넘침 0. 1024 이상은 `data-scene=live`, 390은 `still`이다. 경고는 Clock 1건뿐이다. reduced-motion과 일시정지 재방문도 확인했다.

스크린샷과 영상: `docs/images/phase80-82/` (영상 `journey-1920.webm`, 약 4.8 MB).

미확인: 외장 GPU, 실기기, Safari, Firefox, 운영 규모 약 19,000행에서의 입자 상한 장면(시드 251행으로만 측정).

## 8. 코드 리뷰 (PR Review Toolkit)

code-reviewer, silent-failure-hunter, pr-test-analyzer를 실행했다. 모두 소스에서 대조했다.

| 심각도 | 내용 | 결과 |
|---|---|---|
| CRITICAL | 일시정지로 재방문하면 판이 스케일 0에 머묾 | 수정 |
| CRITICAL | 셰이더 링크 실패 시 빈 캔버스, `live`가 첫 프레임 전에 켜짐 | 수정, E2E 추가 |
| IMPORTANT | 낮춘 DPR이 리렌더마다 복원 | 수정(state) |
| IMPORTANT | Close 후 패널이 다시 열림 | 수정, E2E 추가 |
| IMPORTANT | 패널 링크에서 Esc 시 포커스 유실 | 수정, E2E 추가 |
| IMPORTANT | 인라인 `args`로 셰이더 머티리얼 재생성 | 수정 |
| IMPORTANT | 화면 밖 스크롤 렌더, 이벤트 간격으로 tier 오판 | 수정 |
| IMPORTANT | 거터 위 도크가 입력을 못 받음 | 수정(`.hero::before`) |
| IMPORTANT | 폭을 줄였다 늘리면 장면 미복구(Phase 79부터) | 수정, E2E 추가 |
| IMPORTANT | 테스트 약점(드리프트 미검증, 고정 대기, flaky 스윕) | 수정 |
| MINOR | 잘못된 주석, 효과 없는 tier 단계 | 수정 |

자체 수정: 호버 패널이 포인터를 덮으면 생길 수 있는 깜빡임을 막기 위해 패널을 선택·칩 전용으로 변경(재현으로 확인한 문제는 아니고 구조상 예방). 강조된 도크를 클릭하면 드리프트 후에도 그 도크를 선택.

## 9. 의도적으로 바꾼 기존 테스트

`arrives without moving anything…`: 캔버스가 전체 폭이 되어 "박스가 검색창 앞에서 멈춘다"를 "컨트롤과 빈 무대 어디서도 캔버스가 입력을 받지 않는다"로, "휴식 시 draw 0"을 Pause·화면 밖·20초 세 경로로 나눠 검증한다. 삭제한 기능 검증은 없다.

## 10. 남은 문제

- WARNING: 홈↔목록 왕복당 JS heap 증가. Phase 79 0.47 MB, 현재 0.58 MB(14회 왕복). 대부분 기존 동작이고, 차이 0.1 MB의 원인은 미확인이다.
- WARNING: `The destination stream closed early` 서버 로그. Phase 79 서버에서도 17건 재현, 이번 변경과 무관하다.
- WARNING: `THREE.Clock` 경고(§6).
- WARNING: 소프트웨어 렌더러에서 FPS 35, INP 근사 200 ms.
- WARNING: 1440px 이하에서 선택한 도크가 패널을 피해 왼쪽으로 가면서 글자용 스크림에 걸려 어둡게 보인다(`4-selected-1440.png`). 가려지지는 않는다.
- PENDING: §7의 미확인 항목. GPU 사용률 자체는 도구가 없어 측정하지 못했고 프레임 비용으로 대신했다.
