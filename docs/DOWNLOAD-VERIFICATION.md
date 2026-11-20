# ToDo 다운로드 패키지 검증

> 이 문서는 0.1 당시 기록입니다. 현재 0.2의 기능·마이그레이션·검증 결과는 [V02-VERIFICATION.md](V02-VERIFICATION.md)를 먼저 읽으세요.

확인일: 2026-11-19, 한국 시간.

## 배포 범위

- 저장소: `https://github.com/byun712/GROUP`, 별도 다운로드 브랜치: `todo-standalone`.
- GROUP main의 보존 기준: `3e4e6930f70cda566036cec46e7d649e7a683223`.
- 취소 전 보관한 로컬 ToDo를 독립 앱으로 분리했다. GROUP main에 ToDo를 다시 추가하지 않는다.
- ZIP 루트에 앱 소스, 잠금 파일, 빌드된 `dist/`, Windows/Unix 실행 스크립트, 실행 안내를 포함한다. Node.js 24 이상이 필요하며 제품 의존성은 0개다.
- 운영 DB, 첨부파일, 환경 변수 값, 인증정보, 실제 사용자 IndexedDB 데이터는 포함하지 않는다. 문서의 화면과 JSON은 검증용 예시다.
- GitHub 소스 브랜치 게시는 운영 서비스 배포나 Codex 환경 게시와 별개다.

## 이번 패키지에서 실행한 검증

| 항목 | 결과 |
|---|---|
| 잠금 파일 설치 | `npm ci --ignore-scripts --no-audit --no-fund` 성공 |
| 도메인 테스트 | `npm test`: 9개 통과, 실패 0 |
| 빌드 | `npm run build` 성공, 정적 자산/SW 생성 |
| 실제 브라우저 | 1366×768, 1920×1080의 17개 검증 그룹 통과, page error 0 |
| 저장·오프라인·업데이트 | 실제 IndexedDB 저장/실패 재시도/프로필 재시작, 캐시 후 오프라인 조회·수정, SW 업데이트 후 데이터 유지 확인 |
| ZIP 폴더명 호환 | 이름에 `todo`가 없는 `GROUP-archive-…` 폴더에 복제한 뒤 빌드 성공 |
| Unix 실행 스크립트 | `sh START-TODO.sh` 실행 후 앱과 JS·아이콘·Manifest·SW HTTP 200 확인 |
| 포트 충돌 | 기존 4174 서버는 보존. 검증은 `PORT`로 빈 임시 포트를 지정하여 실행 |

실제 브라우저 결과: [download-verification.json](screenshots/download-verification.json). 기존 구현 당시 검증과 화면은 [VERIFICATION.md](VERIFICATION.md)를 참고한다.

## 코드 리뷰

이번 패키징 변경은 실행 스크립트, 안내 문서, 빌드 출력 경로 검사에 한정한다. UI·도메인·IndexedDB 코드는 보관본 그대로다. 빌드는 폴더명에 특정 단어가 있어야 하는 조건을 제거하고, 앱의 `dist/` 또는 별도 임시 디렉터리만 허용한다. 실행기는 자기 파일 위치를 기준으로 서버를 시작하며 기본 주소는 `127.0.0.1:4174`다. 앱 자산과 서비스 워커는 `/todo/`로 제한한다.

## 미검증 및 제한

- Windows `.cmd` 및 실제 사용자 PC에서의 직접 실행은 Linux 환경에서 확인하지 못했다. Windows 스크립트의 Node 검사·경로 인용·서버 실행 코드를 검토했고 동일 서버와 Unix 실행기를 실행했다.
- Linux Chromium의 자동 설치·재실행 결과를 Windows/Edge/macOS/Safari 또는 수동 OS 설치 검증으로 확대하지 않는다.
- 모바일 최적화, GROUP API·로그인·사용자 간 공유·서버 동기화·푸시·엑셀 보고서는 후속 작업이다.
- 데이터는 같은 주소·포트·브라우저 프로필에 저장된다. ZIP에 사용자 데이터가 들어 있지 않으므로 이전 기록은 앱의 JSON 내보내기/복원으로 별도 옮긴다.
