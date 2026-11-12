# GROUP 개발 인수인계

확인일: 2026-11-12 (한국 시간). 이 문서는 현재 코드의 인수인계 기준이다. 과거 작업별 문서와 내용이 다르면 실제 최신 코드 및 이 문서의 현행 동작을 먼저 확인한다. 실행·연결·데이터 보존 절차는 [NEW-CHAT-SETUP.md](NEW-CHAT-SETUP.md)를 읽는다.

## 실제 확인한 저장소와 작업 범위

| 항목 | 확인 결과 |
|---|---|
| 저장소 | https://github.com/byun712/GROUP |
| origin | `https://github.com/byun712/GROUP.git` |
| 기준 브랜치 | 원격 `main` |
| 현재 로컬 작업 브랜치 | `work` (브랜치 이름이 main과 다르므로 SHA로 비교) |
| 실제 체크아웃 | `/workspace/GROUP` |
| 원격에서 가져온 기능 커밋 | `7989e9ecb0569542beeb1638d4608e82e7ce1331` |
| 이번 브라우저 검증 수정 커밋 | `78c5aa15a51545eb2c97022e1adf9b14abcde5fe` |
| AGENTS.md | 확인 당시 `/workspace` 아래 프로젝트 지침 파일 없음. 새 작업에서는 다시 검색 |

작업 시작 시 추적 파일 변경 및 추적되지 않는 파일은 없었다. 원격 main이 초기 환경의 `5148be9d74a70566ca0398fce1238e3cf7e4aedb`보다 앞서 있어 `git fetch origin main` 후 `git merge --ff-only origin/main`으로 보존하여 반영했다. 예전 커밋으로 되돌리지 않는다.

이번 요청 이전의 작업은 클라우드 환경 설정이었다. 별도로 전달되지 않은 기능 요구사항을 완료했다고 간주하지 않는다. 이번에는 최신 원격 기능 확인, 발견된 구형 브라우저 검증 수정, 테스트·변경 리뷰, 인수인계 문서와 재사용 설정 준비를 수행했다. 애플리케이션 로직·DB 스키마·의존성·잠금 파일은 이번 인수인계 작업에서 변경하지 않았다.

최종 문서 커밋 자신의 SHA는 본문에 하드코딩하지 않는다. 문서를 포함하는 전체 SHA는 `git log -1 --format=%H -- docs/HANDOFF.md docs/NEW-CHAT-SETUP.md`로 구하고, 작업 완료 응답의 최종 SHA와 비교한다. main 반영은 커밋 메시지나 이 문서의 존재만으로 판정하지 말고 아래처럼 현재 원격에서 확인한다.

```sh
git fetch origin main
git rev-parse HEAD
git ls-remote origin refs/heads/main
git status --short --untracked-files=all
git log --oneline origin/main..HEAD
```

최종 응답에는 push 후 조회한 SHA와 깨끗한 작업 트리 여부를 별도로 남긴다. 새 작업에서 원격이 더 진행되었다면 그 변경도 보존한다. `data/`, `node_modules/`는 ignored 로컬 항목이며 깨끗한 Git 상태가 이들의 부재를 뜻하지 않는다.

## 프로젝트와 중요한 파일

Node.js 24 이상, 내장 SQLite, 일반 HTML/CSS/JavaScript로 구성된 ELSOLTEC 그룹웨어다. 별도 프런트엔드 빌드 단계가 없다. 로그인, 전자결재, 업무보고, 프로젝트·공정, 고객사, 회계, 일정, 근태·휴가, 공지·첨부파일, POP3/SMTP 메일을 제공한다.

| 파일 | 역할 |
|---|---|
| `server.js` | HTTP/정적 파일, 인증·세션, DB 초기화·추가 마이그레이션, API 연결, 계정 CLI |
| `accounts.js`, `user-purge.js`, `network.js` | 계정·Admin·권한·삭제, 신뢰 프록시/IP |
| `approvals.js`, `expenses.js`, `document-workflow.js`, `document-deletion.js` | 결재, 금액, 수정·재상신·회수·삭제 |
| `report-templates.js`, `form-excel.js`, `signatures.js` | 업무보고 양식, Excel, 승인 시점 서명 |
| `projects.js`, `project-members.js`, `project-excel.js` | 공정·완료 일수·참여자·이력, 전체 프로젝트 XLSX |
| `excel-print-layout.js` | 한글 출력용 폭·줄바꿈·행 높이 계산 |
| `schedules.js`, `attendance.js`, `leave-management.js` | 공유 일정, 근태, 휴가 부여·예약·사용 |
| `crm.js`, `accounting.js`, `announcements.js`, `expense-attachments.js` | 고객·명함, 균형 전표, 공지·증빙 BLOB |
| `mail.js`, `mail-organization.js` | 메일 계정 암호화, POP3/SMTP, 개인 메일함·첨부 |
| `public/index.html`, `public/app.js`, `public/business.js`, `public/reports.js` | 화면·탐색·달력·업무 모듈·서식 |
| `public/style.css`, `public/design.css`, `docs/design-system.md` | 기존 스타일과 현행 디자인 보완 |
| `scripts/database.js` | 온라인 SQLite 백업, 새 디렉터리 복원, 메일 키 동반 복사 |
| `test/`, `test-support/server.js`, `scripts/*-smoke.mjs` | API/DB 및 임시 데이터 브라우저 검증 |

## 이미 구현된 기능과 유지할 동작

- **최신 프로젝트 화면**: 공정별 세로 막대, 공통 0~100% 축, 정확한 퍼센트·공정명, 고정 너비와 많은 공정의 내부 가로 스크롤. 도넛과 같은 공정 ID 기반 색상. 이전 가로 그래프·타임라인으로 되돌리지 않는다. 세 패널 322px, 수행 내역 영역 244px·기본 두 카드·추가 기록 스크롤을 유지한다.
- **진척률**: 공정은 완료 일수 ÷ 기간 전체 일수(주말 포함), 프로젝트는 공정별 진척률의 단순 평균 후 반올림이다. 완료 공정 수 비율이 아니다. 일자 체크는 수행 내용 자동 생성과 분리한다.
- **프로젝트 Excel 보고서**: `GET /api/projects/:id/excel`, 전체 기간·공정·실제 수행 기록·일정 변경 기록. 화면 월/스크롤/두 카드 제한에 묶이지 않는 세 시트 XLSX. 숫자 진척률, 한국 시간, 장문 보존·분할, A4 가로·너비 한 페이지·높이 제한 없음. 현재 프로젝트와 동일한 로그인 공동 조회 권한이며 개인 일정 내용은 포함하지 않는다.
- **전자결재·업무보고·사용자 메뉴**: 다른 화면에서 첫 클릭은 기본 화면, 기본 화면에서 재클릭하면 우측 하위 메뉴, 다시 클릭하면 닫힘. 하위 작성/설정 화면에서는 먼저 기본 화면으로 복귀한다. body의 고정 패널로 한 번에 하나만 표시하며 외부 클릭·선택·Esc·Tab으로 닫는다. Esc는 부모에 포커스를 돌려준다. 12개 결재·4개 보고 양식, 권한별 사용자 메뉴를 유지한다. 제거된 `#new-draft`를 재생성하거나 예전 인라인 메뉴로 복원하지 않는다.
- **홈 달력**: 날짜는 고정하고 일정 목록만 내부 스크롤한다. 모든 일정을 유지하며 키보드로 접근한다. 이전 `+N 더보기` 동작이 아니다. 4/5/6주 균등 행, 화면 잔여 높이·최소 220px를 유지한다. 매우 낮은 창에서는 페이지 스크롤이 정상일 수 있다. 모바일은 읽기 쉬운 크기와 페이지 스크롤을 사용한다.
- **일정관리**: 주간 목록 기본 접힘, 일요일~토요일, 월·연도 경계 조회 및 ID 중복 제거, 갱신 시 펼침 상태 유지. 본인·회사·초대 권한 필터와 오래된 응답 차단을 유지한다.
- **권한**: employee/manager/ceo와 Admin은 별도다. 마지막 활성 Admin 보호, 계정 권한·상태·비밀번호 변경 시 세션 종료. Admin만 결재 운영 조회·휴가 부여·관리자 근태 수정 등을 할 수 있다. 회계는 manager/ceo이며 Admin 권한만으로 접근하지 못한다.
- **업무 규칙**: 이사→대표 순차 결재, 허용된 본인 승인, 작성자의 단계별 수정·재상신, 회차별 서명·이력 보존. 최종 승인 지출의 회계 중복 생성 금지. 휴가는 이사 승인부터 일정·사용량에 반영하고 반려·삭제 시 환원한다. 초기 휴가 부여는 0이다.
- **데이터 격리**: 개인 일정·메일·첨부 권한, 사외 출퇴근 차단, 신뢰 프록시만 IP 전달 허용. 테스트용 OFFICE_IP를 운영 설정으로 사용하지 않는다.

세부 최신 기능은 [프로젝트 보고서·메뉴 리뷰](project-report-navigation-review.md)를 참고한다. [workspace-v2-review.md](workspace-v2-review.md)의 인라인 메뉴·가로 그래프 설명은 당시 이력이며 최신 메뉴·그래프 설계가 아니다.

## 이번 수정 및 검증 결과

구형 테스트 두 개를 현재 제품 동작에 맞췄다. 동작을 바꿔 테스트를 통과시키거나 assertion을 끄지 않았다.

| 검증 | 이번 실제 결과 |
|---|---|
| `npm test` | 43개 통과, 실패/건너뜀/취소 0 |
| `scripts/project-report-navigation-smoke.mjs` | 통과: 1366/1920/390px, 세로 그래프·XLSX 다운로드·통합 메뉴·권한 |
| `scripts/workspace-v2-smoke.mjs` | 통과: 홈 달력·날짜 스크롤·주간 경계·비공개 제외·서식·공정 |
| `scripts/ui-smoke.mjs` | 수정 후 통과: 로그인·검색·근태·공지·상신·이사/대표 승인·일정 CRUD·모바일 |
| `scripts/home-dashboard-smoke.mjs` | 수정 후 통과: 6개 PC 크기와 모바일, 4/5/6주, 최소 높이, 날짜 목록 키보드 스크롤, 안전한 제목·실제 일정 수정·등록 진입 |
| `npm start` + HTTP 확인 | 별도 `mktemp` DATA_DIR, 3100 포트에서 HTML/JS 200 및 비로그인 API 401 확인; 확인 후 해당 서버 중지 |
| 변경 구문·공백 | 수정 JS의 `node --check`, `git diff --check` 통과 |

수정 전 재현: 초기 환경 커밋의 `ui-smoke.mjs`는 제거된 `#new-draft`를 기다려 timeout, `home-dashboard-smoke.mjs`는 내부 스크롤 항목 전체가 화면 안에 있어야 한다는 이전 assertion에서 실패했다. 최신 메뉴 클릭과 스크롤 컨테이너 경계·실제 접근 검증으로 바꾸었으며, 낮은 창의 220px 최소 높이도 명시 검증한다. 이 두 문제는 수정 후 미해결 항목이 아니다.

### 코드 리뷰 (실행 테스트와 별개)

이번 변경 diff를 직접 검토했다. 테스트 DB는 임시 경로이고 기존 데이터 경로를 사용하지 않는다. 결재·일정·모바일 검증을 보존하고 현재 메뉴 동작으로 탐색한다. 일정 8개 모두 유지, HTML처럼 보이는 제목의 안전한 텍스트 처리, End 키 스크롤, 실제 수정 저장과 날짜별 등록 진입을 확인한다. 낮은 창의 무조건적인 무스크롤 가정을 제거하되 날짜·목록 경계·최소 높이·가로 넘침 검사는 유지했다.

최신 원격 기능의 `project-excel.js`, 인증 전후 라우팅, 공정 조회 범위, 메일 저장소 및 백업 구현도 인수인계 관점에서 확인했다. 이는 전체 저장소 보안 감사나 별도 독립 리뷰어의 승인을 의미하지 않는다. 문서·설정에는 비밀 값, 계정 비밀번호, 운영 데이터, 오래된 실행 환경 ID를 넣지 않는다.

## 남은 사항과 제한

- 새 채팅의 환경 선택·새 머신 복원·실행은 아직 그 새 환경에서 검증되지 않았다. 현재 머신 실행 성공과 초안 저장은 게시/복원 성공이 아니다.
- 환경 게시 여부는 사용자 측 게시 완료 상태와 새 작업의 실제 실행으로 확인해야 한다. GitHub push와 별개다.
- 이번에 실행한 네 브라우저 스크립트 외 모든 선택 smoke 스크립트를 다시 검증한 것은 아니다. 향후 관련 기능 변경 시 해당 테스트도 실행하고 과거 선택자 여부를 진단한다.
- 실제 외부 POP3/SMTP, 운영 HTTPS/Caddy/DNS, Windows 실행, 실제 iOS/Safari/Firefox는 미검증이다. 메일 자동 테스트는 로컬 테스트 서버를 사용한다.
- Microsoft Excel/LibreOffice의 실제 인쇄/PDF 렌더링은 미검증이다. XLSX API·재열람·데이터·출력 설정 테스트 통과와 구분한다.
- 자동 외부 백업·운영 배포·계정 발급은 이번 작업에서 수행하지 않았다. 새 데이터나 기본 비밀번호를 운영 데이터 대신 만들지 않는다.

## 새 채팅에서 먼저 할 일

1. 그 채팅에 실제 연결된 환경의 상태와 쉘 실행을 확인한다. 현재 환경 ID를 복사해 재사용하지 않는다.
2. 체크아웃의 실제 경로·origin·브랜치·전체 HEAD·미커밋/미추적/ignored 데이터를 확인한다. 정상 체크아웃을 재사용하며 worktree를 임의 생성하지 않는다.
3. 현재 존재하는 AGENTS.md, README, 이 문서, NEW-CHAT-SETUP을 읽는다.
4. 인증을 기존 Git 연결로 확인하고 fetch한다. 최종 인수인계 SHA가 현재 HEAD/원격 main의 조상인지 검사한다. diverged/로컬 변경은 보존하고 자동 reset/clean/강제 checkout/push를 하지 않는다.
5. 별도 임시 DATA_DIR에서 필요한 설치·검증을 수행한다. 결과와 코드 리뷰를 구분해 보고한 뒤 다음 개발 요구사항을 기다린다.
