# 새 채팅의 GROUP 연결·실행 안내

환경 설정 표는 2026-11-12 저장된 초안의 실제 조회 기록이다. 2026-11-13에는 현재 실행 환경의 running/connected 상태와 쉘·Git·런타임·테스트를 다시 확인했으며 초안 저장/게시를 수행하지 않았다. [HANDOFF.md](HANDOFF.md)의 기능·권한·검증 기준과 함께 읽는다. 문서에 기록된 경로가 새 머신에도 있다고 가정하지 말고 확인한다.

## 선택할 값과 현재 확인 범위

| 항목 | 값 / 확인 범위 |
|---|---|
| 환경 종류·설정 이름 | Codex 관리형 Linux 클라우드, `GROUP` |
| 저장소·브랜치 | `byun712/GROUP`, 원격 `main` |
| mount / 실제 경로 | 저장 초안 `GROUP`, 현재 실제 `/workspace/GROUP` |
| 로컬 브랜치 | 현재 `work`; 새 체크아웃 브랜치 이름은 다시 확인 |
| 이번 개선 시작 SHA | `42248a1ffd911a7399efbff22f0d3bbe826c7d78`. 실제 사용할 기능은 [그래프 확장·계층형 보고서](project-expansion-report-review.md)을 포함한 main |
| 최종 인수인계 SHA | 완료 응답의 전체 SHA와 `git log -1 --format=%H -- docs/HANDOFF.md docs/NEW-CHAT-SETUP.md`로 확인. 최신 main은 새로 fetch |
| 요구 런타임 | package.json: Node.js `>=24`, 내장 `node:sqlite`; 확인 버전 Node 24.22.1 |
| 패키지 관리자 | npm 11.9.0 확인, `package-lock.json` lockfileVersion 3 |
| 설치 | `npm ci --cache /workspace/.cache/npm --no-audit --no-fund` |
| 서버 / 테스트 | `npm start` / `npm test`; 별도 build 스크립트 없음 |
| 브라우저 | Chromium 156.0.8078.79, Playwright 1.62.1 (이 머신에서 확인) |
| 인터넷 | `github.com` Git, 소스 ZIP 리디렉션 `codeload.github.com`, 잠금 파일 패키지 `registry.npmjs.org`; 기존 Git 프록시·CA 사용 |
| 정책 | restricted, `package_managers` preset, custom hosts 없음, 관측 state=enforced |
| 비밀정보 요구 | 로컬 개발·자동 테스트용 추가 비밀정보 없음. 메일/운영 연결은 별도 요구 확인 |

환경 상태 API는 현재 인스턴스의 `running`, `connected`, `observations_current=true`, failure 없음으로 보고했고 실제 명령·Git read·설치·테스트·서버 요청도 성공했다. 초안의 이름·저장소·install_script·start_skill을 조회하여 확인했다. 이것은 설정 초안과 현재 인스턴스의 증거이며 새 작업 복원이나 최신 설정 게시가 성공했다는 증거는 아니다. PC 페어링 연결은 제공되거나 확인되지 않았다.

GitHub push는 Git 객체와 main 브랜치의 업데이트다. 환경 초안 저장은 재사용할 설치/시작 지침 저장이다. 환경 게시는 제품에서 제공하는 준비된 파일시스템/설정의 재사용 절차이며 별도다. 이름이 GROUP이라고 해서 같은 상태로 복구되었다고 판정하지 않는다. 새로운 작업에서는 그 작업의 환경을 조회하며 이전 실행 환경 ID는 사용하지 않는다.

## 복사해서 실행하는 절차

아래 개발 명령은 현재 머신에서 실제 실행·검증했다. 새 작업에서는 경로·도구 존재를 먼저 확인한다. 실제 운영 데이터 백업/복원, 새 환경 게시/복원, 외부 메일/HTTPS는 실행 완료로 간주하지 않는다.

### 1. 체크아웃과 인증 확인

```sh
cd /workspace/GROUP
pwd
git rev-parse --show-toplevel
git branch --show-current
git rev-parse HEAD
git status --short --untracked-files=all
git status --short --ignored
git ls-remote origin refs/heads/main
git fetch origin main
git log --oneline HEAD..origin/main
git log --oneline origin/main..HEAD
```

원격 URL을 확인할 때 userinfo/토큰은 출력하지 않는다. 이 머신의 origin은 위 표의 저장소다. 경로가 없으면 환경 준비 상태부터 확인하고 `/workspace`의 실제 checkout을 찾는다. 정상 checkout이 있으면 재사용한다. 로컬 변경과 로컬 전용 커밋을 보존한 상태에서만 fast-forward(`git merge --ff-only origin/main`) 여부를 결정한다. 이 명령도 무조건 실행하지 않는다. 새로 연결한 main이 인수인계 SHA 이후인지 `git merge-base --is-ancestor <완료응답의_SHA> HEAD` 및 원격 main 대상으로 확인한다. shallow checkout이면 필요한 이력을 먼저 가져온다.

기존 HTTPS Git 프록시 인증을 먼저 테스트한다. 이 머신에서 Git read는 성공했고 GH_TOKEN은 존재, GITHUB_TOKEN은 미설정이었으나 값은 읽거나 기록하지 않았다. 토큰 변수 유무나 gh 로그인 안내만으로 새 토큰을 요구하지 않는다. read 성공과 push 권한은 별도이며 push는 승인 범위 안에서만 한다.

### 2. 런타임 확인 및 3. 잠금 파일 설치

```sh
node --version
npm --version
node -e "if (+process.versions.node.split('.')[0] < 24) throw Error('Node.js >=24 required'); const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync(':memory:'); if(db.prepare('select 1 as ok').get().ok!==1) throw Error('SQLite unavailable'); db.close(); console.log('Node.js and built-in SQLite ready');"
npm ci --cache /workspace/.cache/npm --no-audit --no-fund
```

프로젝트 의존성은 저장된 잠금 파일로 설치한다. Node가 없거나 24 미만이면 관리형 환경이 지원하는 런타임 설치 절차로 먼저 준비한다. 기존 플랫폼 프록시와 인증서 검증을 유지한다. `npm install`로 잠금 파일을 바꾸거나 TLS/무결성 검증을 끄지 않는다. 의존성/설치 캐시는 재설치 가능하며 비밀정보가 아니다.

### 4. 자동 테스트

```sh
npm test
```

현재 45개 통과. 테스트는 각각 별도 임시 DATA_DIR을 사용한다. 테스트 0개 실행이나 skipped를 통과로 세지 않는다.

그래프 확장과 계층형 XLSX의 재현 명령·스크린샷은 [최신 검증 문서](project-expansion-report-review.md#실행-테스트)에 있다. 브라우저 도구 경로는 현재 머신에서 확인한 것이며 새 환경에서 다시 검사한다.

### 5. 개발 서버 — 검증용 임시 데이터만 사용

프로젝트 루트에서 별도 지속 터미널로 실행한다. 3100은 이번 확인에 사용한 포트이며 점유 중이면 다른 빈 포트와 PUBLIC_ORIGIN을 함께 지정한다. 다른 프로세스를 임의 종료하지 않는다.

```sh
cd /workspace/GROUP
export DATA_DIR="$(mktemp -d /tmp/group-dev.XXXXXX)"
export HOST=127.0.0.1 PORT=3100 OFFICE_IP=127.0.0.1 NODE_ENV=development
export TRUSTED_PROXY_IPS= PUBLIC_ORIGIN=http://127.0.0.1:3100
npm start
```

`Groupware started`를 확인한다. 테스트용 빈 DB는 이 명령의 명시적인 임시 경로에만 생성한다. 기본 계정/비밀번호는 없고 인수인계 작업에서 영구 계정을 만들지 않았다. 실제 계정은 README의 user:add와 안전하게 주입한 NEW_USER_PASSWORD를 사용한다. 비밀번호를 명령행 인수나 문서에 쓰지 않는다.

서버는 새 채팅에서 살아 있다고 가정하지 않는다. 필요할 때 위 절차로 재실행하고 검증용으로 시작한 프로세스만 Ctrl+C로 종료한다. 운영 데이터로 실행할 때는 위 mktemp 대신 **확인된 기존 DATA_DIR과 함께 메일 키·백업까지 확인한 후** 시작한다. 기존 데이터가 안 보인다고 default data를 생성해 복구 완료라고 하지 않는다.

### 6. 다른 터미널에서 응답 확인

```sh
cd /workspace/GROUP
node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
const base='http://127.0.0.1:3100';
const page=await fetch(base);assert.equal(page.status,200);assert.match(await page.text(),/id="login-form"/);
const asset=await fetch(base+'/app.js');assert.equal(asset.status,200);assert.match(asset.headers.get('content-type'),/javascript/);
const me=await fetch(base+'/api/me');assert.equal(me.status,401);assert.match((await me.json()).error,/로그인/);
console.log('PASS: temporary-data server, HTML, JS and authentication boundary');
NODE
```

루프백 주소는 내부 검증용이다. 온보딩의 사용자용 미리보기 링크로 제공하지 않는다. PID/포트 개방만으로 정상 동작을 판단하지 않는다.

### 7. 브라우저 검증

다음 두 경로는 현재 머신에서 확인한 값이다. 새 환경에서 파일 존재를 먼저 검사하고 없다면 그 환경의 Playwright/Chromium 설치 위치를 확인한다. 필요하면 별도 도구 디렉터리에 설치하고 프로젝트 잠금 파일은 보존한다.

```sh
cd /workspace/GROUP
export PLAYWRIGHT_MODULE=/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs
export BROWSER_EXECUTABLE=/usr/bin/chromium
test -f "$PLAYWRIGHT_MODULE"
test -x "$BROWSER_EXECUTABLE"
node scripts/project-summary-layout-smoke.mjs
node scripts/compact-business-smoke.mjs
node scripts/project-report-navigation-smoke.mjs
node scripts/workspace-v2-smoke.mjs
node scripts/ui-smoke.mjs
node scripts/home-dashboard-smoke.mjs
```

이번 요약 카드 변경에서 `project-summary-layout`, `compact-business`, `project-report-navigation`을 실행해 통과했다. `workspace-v2`는 앞선 회계·고객사 개선에서 통과한 기록이다. `ui-smoke`, `home-dashboard-smoke`는 이전 인수인계에서 통과한 기록이며 이번에 다시 실행한 것으로 세지 않는다. 이번 전체 검증 목록은 [요약 배치 리뷰](project-summary-layout-review.md)에 있다. 각각 임시 DB·테스트 계정·동적 로컬 포트를 사용하고 종료 시 DB를 제거한다. 필요하면 `UI_SCREENSHOT_DIR`을 저장소 밖 별도 경로로 지정한다. 기본 결과 디렉터리는 `/tmp/compact-business`, `/tmp/project-report-navigation`, `/tmp/workspace-v2`, `/tmp/group-home-dashboard-ui`이며 ui-smoke는 지정했을 때만 스크린샷을 저장한다. 실제 Windows/모바일 기기 검증과 Chromium 모바일 폭 검증은 다르다.

## 환경 변수와 비밀정보

| 이름 | 용도 |
|---|---|
| DATA_DIR | SQLite·메일 키 디렉터리. 기본은 저장소의 data, 테스트는 mktemp |
| HOST / PORT | 기본 127.0.0.1 / 3000. 이번 임시 서버는 3100 |
| OFFICE_IP | 출퇴근 허용 IP. 로컬 테스트 127.0.0.1, 운영 값은 별도 확인 |
| PUBLIC_ORIGIN | POST Origin 검사. 테스트 서버 주소와 일치해야 함 |
| NODE_ENV | development 로컬 / production HTTPS Secure 쿠키 |
| TRUSTED_PROXY_IPS | 신뢰 프록시 목록. 로컬 직접 접속은 빈 값 |
| NEW_USER_PASSWORD | 계정 생성 CLI의 일시적 비밀 입력. 안전하게 공급하고 이후 해제 |
| PLAYWRIGHT_MODULE / BROWSER_EXECUTABLE / UI_SCREENSHOT_DIR | 선택적 브라우저 도구·결과 경로 |

현재 저장된 클라우드 초안에 추가 secrets/runtime requirements는 없다. 애플리케이션 변수는 명령 단위로 지정했으며 .env를 자동 로딩하는 코드가 없다. `.env`에 적기만 하면 적용된다고 안내하지 않는다. 실제 메일 비밀번호는 애플리케이션 계정 설정으로 받아 DB에 암호화하며 일반 SMTP_PASSWORD 환경 변수나 MAIL_KEY 환경 변수를 읽는 구조가 아니다. 실제 값을 채팅에 요구하거나 덤프하지 않는다.

## 무엇이 복원되고 무엇을 따로 보존해야 하는가

| 대상 | 현재 구현·보존 방법 |
|---|---|
| 소스·문서·추적된 이미지/폰트 | GitHub main/해당 SHA ZIP으로 복원 가능. ZIP은 Git 이력/브랜치 메타데이터 없음 |
| DATA_DIR/group.db | 사용자·세션·업무·메일 데이터를 담은 운영 SQLite. Git 제외 |
| group.db-wal / group.db-shm | WAL 모드 부속 파일. 실행 중 DB 본체만 복사하지 않음. 지원 온라인 백업 사용, 또는 서버 중지 후 일관된 데이터 전체를 보존 |
| DATA_DIR/mail-key | AES-256-GCM 메일 계정 비밀번호 복호화용 32바이트 파일. DB와 함께 비공개 보존. 출력·재생성·공개 저장 금지 |
| 첨부/업로드 | 공지 announcement_files.content, 지출 expense_attachments.content, 메일 mail_attachments.content, 명함 customer_contacts.card, 서명 user_seals/decision_signatures.image 등 DB BLOB. 별도 uploads 폴더를 가정하지 않음. 메일 서명 이미지는 DB 필드 |
| 비밀 환경 변수·외부 연결 설정 | Git에 없음. 새 환경의 승인된 보안 설정/주입 방식으로 별도 제공 |
| node_modules / npm 캐시 | Git 제외. npm ci로 재구성 가능 |

현재 실제 `/workspace/GROUP/data`에서 group.db, WAL, SHM, mail-key의 **파일명/존재만** 확인했다. 운영 회사 데이터라고 단정하지 않았으며 내용을 내보내거나 변경하지 않았다. 새 환경 스냅샷이 이를 포함할 수 있어도 Git checkout 자체는 이를 복원하지 않는다. 소스 ZIP에는 ignored 데이터가 포함되지 않는다.

지원 백업 명령 형식은 `node scripts/database.js backup <확인한_원본DB> <존재하지_않는_비공개_백업파일>`이다. 온라인 SQLite API로 WAL 변경을 반영한다. 메일 계정이 있으면 mail-key를 `<백업파일>.mail-key`로 동반 복사한다. 계정이 없는 경우 도구가 키를 복사하지 않을 수 있으므로 원래 데이터 디렉터리와 키 보존 정책도 따로 확인한다. 지원 복원은 `node scripts/database.js restore <백업파일> <존재하지_않는_새디렉터리>`이며 키 이름을 mail-key로 바꾸고 세션을 삭제한다. 덮어쓰기를 허용하지 않는다.

위는 구현과 자동 테스트에서 확인한 절차이며 이번에 실제 운영 DB 백업·복원이나 외부 보관을 실행한 것은 아니다. 기존 데이터가 없거나 키가 빠졌으면 원래 환경/백업을 보존하고 위치·무결성을 확인한다. 빈 DB로 초기화하거나 키를 새로 만들어 대체하지 않는다. 실제 운영 백업은 권한 제한·암호화된 별도 저장소에 보관하고 소스 ZIP/GitHub에 넣지 않는다.

## 환경 연결이 안 될 때

1. **시작 중**: 해당 작업의 환경 상태를 조회하고 제공된 대기 도구를 사용한다. 준비 전 빈 workspace를 저장소 삭제로 판단하지 않는다. 이 대화에서는 시작 대기 뒤 정상 연결되었으며 확인된 지속 장애는 없었다.
2. **연결 실패**: 실제 오류 문구·관측 상태·시각·명령 실행 가능 여부를 구분해 보고한다. 초안 조회 성공, 저장 성공, 게시 성공, 쉘 실행 성공은 각각 다른 사건이다. 상태가 불명확하면 복구 완료라고 하지 않는다. 진단 로그에 비밀이 있을 수 있으므로 로그 공유는 지원되는 허가 절차에 따른다. 같은 설정을 근거 없이 반복 저장/게시하지 않는다.
3. **기존 GROUP 재사용 불가**: 기존 환경과 데이터를 보존한다. 위 저장소/main, Node >=24, npm ci, 네트워크 대상, 설치/시작 지침으로 별도 새 관리형 환경을 준비한다. 사용자 화면 조작을 도구로 대신할 수 없다면 사용자가 환경 선택/생성을 해야 함을 명확히 알린다. 같은 이름만으로 연결하지 않고 새 환경의 실제 체크아웃·HEAD·명령·테스트를 확인한다.

현재 에이전트가 확인한 것은 환경 API·초안·명령 실행이다. 사용자 화면의 실제 메뉴 경로·버튼 위치는 확인하지 않았다. 새 작업에 GROUP의 준비된 설정과 byun712/GROUP/main을 지정하고, 저장된 설치·시작 지침을 검토하여 재사용 가능한 상태로 게시하는 조작은 사용자 화면에서 수행한다. 게시 기능이 제공되는 경우 완료 상태를 확인한 뒤 새 작업에서 실제 검증한다. 이 문서의 저장이나 GitHub push를 게시 대용으로 취급하지 않는다.

이번 화면 개선에서는 사용자가 알린 게시 완료 상태를 존중하고 환경 설정 저장·게시를 반복하지 않았다. GitHub의 최신 코드와 이 문서는 새 작업에서 별도로 fetch하고 검증한다.
