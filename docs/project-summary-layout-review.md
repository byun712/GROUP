# 프로젝트 요약 카드: 큰 중앙 원형 그래프와 하단 한 줄

2026-11-12 한국 시간. 기준 원격 main은 `57404962ccfcf62bcb4b4d6107c186f6c22c0aad`이며 시작 시 로컬 HEAD와 일치하고 작업 트리는 깨끗했다. 이 변경은 이전의 작은 왼쪽 도넛/두 줄 정보 배치를 대체한다. 회계 표·XLSX·고객사 펼침과 네 개 프로젝트 선택 목록은 그대로 유지한다.

## 최종 구조와 실제 크기

선택 요약을 **제목 행 / 그래프 본문 / 하단 정보 행** 세 영역으로 분리했다. 제목 왼쪽에 프로젝트 색상과 전체 이름, 오른쪽에 실제 상태가 있다. 세 패널의 공통 상단 패딩은 14px, 제목 행은 32px, 제목 글꼴은 16px·줄 높이 24px다. 제목과 상태·등록 버튼은 같은 행에서 중앙 정렬된다.

그래프는 이미지·SVG·canvas가 아니라 기존 CSS `conic-gradient`다. 실제 원 요소를 본문 폭의 66%와 본문 높이 중 작은 값으로 정하고 1:1 비율 및 가로·세로 중앙 배치를 적용했다. 카드 전체 폭으로는 약 59~61%다. 가운데 구멍은 원 지름의 76%, 숫자는 원 크기에 비례한 굵은 글꼴, 설명은 보조 크기로 표시한다. 공정 색상·채워진 부분·남은 부분의 생성 로직과 서버 진척률 계산은 변경하지 않았다.

| 검증 창 크기 | 카드 실제 폭 | 이전 원 지름 | 수정 원 지름 | 세 패널 공통 높이 | 수정 후 원 중심 오차 |
|---|---:|---:|---:|---:|---:|
| 1366×768 | 362.66px | 128px | 216px | 322px | 0px |
| 1920×1080 | 547.33px | 128px | 322.39px | 428.39px | 0px |
| 390×844 | 342px | 112px | 208.55px | 322px | 0.01px 미만 |

넓은 데스크톱에서는 큰 원의 비율을 유지할 수 있도록 **세 패널이 함께** 늘어난다. `20cqw + 93.6px`는 상위 목록 폭에서 두 간격(32px)을 제외한 3등분 카드 폭의 60%에 제목/하단 공간 100px를 더한 값이다. 최소 높이는 322px다. 요약 카드만 별도로 커지지 않는다. 좁은 화면(1150px 이하)은 세 패널을 세로로 배치한다. 수행 내역은 본문 높이를 두 카드와 간격으로 나누고 추가 공정은 내부 스크롤한다. 세로 막대그래프는 기존 눈금/높이 비율을 유지하며 남은 본문 가운데 배치한다.

하단은 `2026-07-27 ~ 2027-02-26 / 진척률 20% (공정 0 / 3)` 형식의 **한 줄**이다. 기간·구분 기호·진척률의 기준선이 같고 글꼴은 12~14px다. 완료수는 완료 공정 수이며 완료 일수가 아니다. 계산 설명 문구는 다시 넣지 않았다.

첨부 이미지의 `[KEPCO E&C] 스택 설계`는 세 폭 모두 전체가 한 줄로 보인다. 카드보다 긴 제목은 줄바꿈·말줄임표·글꼴 축소 없이 제목 영역의 가로 스크롤로 끝까지 읽는다. Tab으로 초점을 둔 후 좌우 방향키/Home/End도 사용할 수 있다. 하단도 극단적으로 긴 공정 수나 더 좁은 창에서는 내부 가로 탐색을 제공하며 카드·페이지 밖으로 넘치지 않는다. 검증한 세 폭의 하단 정보는 스크롤 없이 모두 보인다.

## 수정 전·후 실제 브라우저 캡처

운영 데이터 대신 임시 DATA_DIR에 제공된 프로젝트명·기간을 넣어 재현했다. 5일 공정 세 개를 만들고 완료 일수 2/1/0일 → 공정률 40/20/0% → 프로젝트 평균 20%, 완료 공정 0/3으로 계산한다. 상태는 임시 프로젝트의 실제 초기 상태인 `계획`이다. 두 색상의 위치·색은 기존 공정 ID 기반 규칙을 따른다.

기준 코드의 수정 전 화면과 수정 후 화면은 동일한 테스트 데이터·창 크기·브라우저·폰트 로딩 조건으로 촬영했다. 세 패널 전체 영역 캡처이므로 모바일 이미지 높이는 창 높이보다 크다.

| 창 크기 | 수정 전 세 패널 | 수정 후 세 패널 | 수정 전 요약 | 수정 후 요약 |
|---|---|---|---|---|
| 1366×768 | [보기](screenshots/project-summary-layout/before-panels-1366.png) | [보기](screenshots/project-summary-layout/after-panels-1366.png) | [보기](screenshots/project-summary-layout/before-summary-1366.png) | [보기](screenshots/project-summary-layout/after-summary-1366.png) |
| 1920×1080 | [보기](screenshots/project-summary-layout/before-panels-1920.png) | [보기](screenshots/project-summary-layout/after-panels-1920.png) | [보기](screenshots/project-summary-layout/before-summary-1920.png) | [보기](screenshots/project-summary-layout/after-summary-1920.png) |
| 390×844 | [보기](screenshots/project-summary-layout/before-panels-390.png) | [보기](screenshots/project-summary-layout/after-panels-390.png) | [보기](screenshots/project-summary-layout/before-summary-390.png) | [보기](screenshots/project-summary-layout/after-summary-390.png) |

[요약 카드 2배 해상도 확대 캡처](screenshots/project-summary-layout/after-summary-detail-2x.png). [수정 전 측정값](screenshots/project-summary-layout/before-measurements.json), [수정 후 측정값](screenshots/project-summary-layout/after-measurements.json)도 보존했다. 제공된 목표 이미지와 비교하여 큰 중앙 원·한 줄 하단·상단 제목/상태 구조를 확인했다.

## 실행 테스트 결과

- `npm test`: **44개 통과**, 실패·취소·건너뜀 0.
- `scripts/project-summary-layout-smoke.mjs`: 통과. 위 세 폭의 실제 지름/중앙 좌표/본문 수직 중앙/제목 기준선/패널 높이/한 줄 하단/가로 넘침을 검사한다. 프로젝트 없음, 공정 없음, 긴 제목, 0/20/100%, 여러 공정, 프로젝트 전환, 공정색과 세로 막대색 일치, 공정 상세/등록 진입, 날짜 체크에 따른 실제 20→27→20% 갱신을 확인한다.
- `scripts/project-report-navigation-smoke.mjs`: 통과. 기존 세로 막대 0/65/100%의 실제 높이·색·공정 상세·전체 프로젝트 XLSX·메뉴·권한 유지.
- `scripts/compact-business-smoke.mjs`: 통과. 네 개 가로 목록·회계 5행 독립 페이지/집계·XLSX·고객사 내부 펼침/CRUD/메일·권한 유지.
- `scripts/workspace-layout-smoke.mjs`: 통과. 두 수행 내역 카드·정렬·완료 체크와 기존 출퇴근/주간 목록/메뉴.
- `scripts/workboard-ui-smoke.mjs`: 통과. 프로젝트 변경·0/65/100%·오래된 응답 차단·공정 날짜/기간 변경·삭제·기존 양식.
- `scripts/design-refinement-smoke.mjs`: 통과. 다른 화면의 긴 데이터·회계 금액·고객사·모바일·권한.

현재 환경에서 실행한 브라우저 명령:

```sh
cd /workspace/GROUP
export PLAYWRIGHT_MODULE=/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs
export BROWSER_EXECUTABLE=/usr/bin/chromium
node scripts/project-summary-layout-smoke.mjs
```

기본 캡처 경로는 `/tmp/project-summary-layout`다. `UI_SCREENSHOT_DIR`로 변경할 수 있다. `CAPTURE_BASELINE=1`은 실행 중인 코드의 기준 화면 캡처 모드이며, 자동으로 과거 코드를 불러오는 옵션이 아니다. 저장된 before 이미지는 구현 전에 기준 main에서 실제 촬영했다.

## 코드 리뷰 결과와 수정

실행 테스트와 별도로 변경 diff를 직접 검토했다. 수정 제품 파일은 `public/business.js`, `public/design.css`이며 API·권한·DB·계산 로직·의존성·잠금 파일은 변경하지 않았다. 데이터 표시는 기존 안전한 텍스트 생성과 서버 값을 그대로 사용한다.

기존 요약/도넛/패널/제목의 중복 규칙과 작은 원을 강제하던 미디어 규칙을 제거하고 프로젝트 화면에 한정된 공통 규칙으로 정리했다. 이 과정에서 발견한 CSS 주석 범위 오류가 기존 가로 목록 등 뒤쪽 규칙을 가리는 문제를 수정했다. 수정 후 브라우저 CSSOM의 프로젝트 외 규칙을 기준 코드와 비교하여 차이 0건을 확인하고, 회계·고객사·네 개 목록 회귀 검증을 다시 통과시켰다.

긴 제목에서 브라우저 기본 End 키만으로 가로 끝에 도달하지 않는 문제는 해당 제목/하단 영역만 처리하는 키보드 이동으로 보완했다. 프로젝트가 없는 카드도 안내가 작은 제목 행에 갇히지 않도록 전체 카드 영역에 배치했다. 이전 고정 322px/두 줄 정보를 가정하던 관련 테스트는 공통 높이·한 줄 정보 및 기존 기능 검증으로 갱신했다. 별도 독립 리뷰어의 승인은 아니다.

## 제한 및 다음 작업

요청된 배치에 알려진 미완료 항목은 없다. 실제 iOS/Safari/Firefox·터치 장치 검증은 하지 않았으며 Chromium의 모바일 폭 검증과 구분한다. 카드보다 훨씬 긴 이름 전체를 동시에 표시할 수는 없으므로 위의 내부 가로 탐색을 사용한다. 데이터와 화면을 이미지만으로 고정하지 않는다.

운영 데이터는 사용하거나 변경하지 않았다. 새 채팅에서는 최신 main과 [HANDOFF.md](HANDOFF.md)를 확인하고 두 줄/왼쪽 작은 원 배치로 복원하지 않는다. GitHub push는 사용자 승인 범위이며 Codex 환경 설정 저장·게시는 수행하지 않는다.
