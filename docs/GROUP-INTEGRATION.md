# 로컬 구조와 후속 GROUP 연결

현재는 `todo-standalone` 브랜치로 분리된 완전히 로컬인 시제품이다. 실행 파일과 소스는 이 브랜치의 루트에 있으며 GROUP main의 코드·운영 데이터와 분리되어 있다. 아래 내용은 후속 구현을 위한 설계 경계와 제안이며 확정된 GROUP API 규격이 아니다. 현재 버전에는 GROUP 요청·토큰·로그인·동기화 버튼이 없다.

## 계층과 파일

| 위치 | 역할 |
|---|---|
| `src/ui/app.js`, `src/ui/workspace.js`, `src/ui/views.js`, `src/ui/markdown.js`, `src/ui/dom.js`, `styles.css` | 화면·폼·포커스·입력 초안·메시지. IndexedDB를 직접 호출하지 않음 |
| `src/domain/model.js` | 로컬 모델, 날짜 규칙, 상태/우선순위, 목록 분류/검색/정렬 |
| `src/domain/service.js` | 업무 명령·연결 검증·완료 시각·삭제·버전 충돌·백업·예시 |
| `src/data/contracts.js` | TaskRepository, ProjectRepository, ProcessRepository, WorkLogRepository, SettingsRepository, SavedViewRepository, TaskTemplateRepository, LocalProfileRepository 및 트랜잭션 provider 계약 |
| `src/data/indexed-db.js` | 유일한 IndexedDB 접근 구현, 스키마/인덱스/마이그레이션, 원자적 트랜잭션 |
| `src/main.js` | 현재 로컬 provider를 조립하는 진입점, 같은 origin의 탭 변경 알림 |
| `src/pwa.js`, `scripts/build.mjs` | 설치 가능 이벤트·업데이트 보호, 정적 자산만 캐시하는 서비스 워커 생성 |
| `scripts/serve.mjs` | 별도 개발/미리보기 서버. GROUP 서버나 DB를 import하지 않음 |

흐름은 `UI → TodoService → RepositoryProvider → IndexedDB`다. UI는 저장소의 SQL/IDB 요청이나 외부 응답 형식을 알지 않는다. 미래 remote provider도 `snapshot`, `transaction`, 타입별 `list/get/put/delete` 계약을 구현한다. 실제 서버에서는 여러 저장 명령을 하나의 원자적 작업으로 처리해야 하므로 단순히 여러 REST 요청으로 흉내 내지 말고 서버 트랜잭션/업무 명령 단위와 맞춘다.

## 로컬 데이터 모델

공통 필드: 로컬 문자열 UUID `id`, UTC ISO `createdAt`/`updatedAt`, 충돌 검사용 정수 `version`, `sample` 표식, `externalRef`.

`externalRef`는 현재 `null`이다. 나중에 `{provider: string, value: unknown}` 형태의 불투명 참조를 저장할 수 있다. `value`가 숫자인지 문자열인지 등을 이번 버전에서 GROUP 식별자 규격으로 확정하지 않는다. 로컬 UUID를 외부 ID로 덮어쓰지 않는다.

| 모델 | 주요 필드 / 관계 |
|---|---|
| 프로젝트 | `name`, `description` |
| 공정 | `name`, 필수 `projectId` |
| 할 일 | `title`, `description`, `status`, `priority`, `dueDate`, 선택적 `projectId`/`processId`, `completedAt`, `parentId`, `assigneeId`, `tags` |
| 업무 기록 | 필수 `taskId`, `workDate`, `content` |
| 저장한 보기 | `name`, `preferences`: 메뉴/보기 종류/필터/정렬/그룹. 업무 레코드를 복사하지 않음 |
| 업무 템플릿 | `name`, `title`, `description`, `priority`, `tags`, `subtasks`(제목 배열). 생성 시 새 업무 ID 발급 |
| 로컬 프로필 | `name`, 로컬 UUID. 한 개만 지원. 서버 사용자/권한이 아님 |
| 화면 설정 | `id=preferences`, `values`, `onboarded` 및 공통 생성/수정 정보 |

```text
프로젝트 ─ 공정
    └──────── 할 일 ─ 업무 수행 기록 여러 개
                 ↑
       연결 없는 개인 할 일도 가능
```

공정을 지정하려면 소속 프로젝트도 일치해야 한다. 공정 없는 프로젝트 할 일과 프로젝트 없는 개인 할 일을 지원한다. 업무 기록은 직접 작성한 내용만 저장한다. 자동 상태 변경 이벤트가 필요해지면 별도 이벤트 모델을 추가하며 `workLogs`에 가짜 수행 내용을 넣지 않는다.

`todo/doing/done`은 **ToDo 상태**다. GROUP 공정의 날짜별 완료 일수·프로젝트 평균 계산은 기존 `projects.js`의 별도 업무 규칙이다. 할 일 완료와 GROUP 공정 진척률 사이에는 자동 변환/반영을 구현하지 않았다. 후속 연결에서도 명확한 업무 승인 없이 이런 반영을 추가하면 안 된다.

날짜 전용 값은 ISO 날짜 문자열끼리 비교하고 UTC 시점으로 임의 변환하지 않는다. 오늘은 `Asia/Seoul` 기준이다. 정렬 동률은 로컬 ID로 안정적으로 처리한다. 날짜 입력 컨트롤의 보이는 형식은 브라우저/OS에 따라 달라도 값은 `YYYY-MM-DD`다.

## 저장·마이그레이션·충돌

DB `group-todo-local`, 버전 2. 스키마 변경은 `src/data/indexed-db.js`의 upgrade 경로에서 버전별로 추가한다. 신규 object store/index를 추가하거나 기존 값을 변환할 때 실제 이전 버전의 복제 DB로 upgrade 테스트를 먼저 작성한다. 실패했다고 DB를 삭제하거나 샘플을 자동으로 덮어쓰지 않는다. 다른 탭이 오래된 연결을 보유하면 blocked 안내 후 해당 탭을 닫도록 안내한다.

현재는 버전 비교 후 갱신하여 다른 탭의 변경을 조용히 덮어쓰지 않는다. 실패한 폼은 DOM과 입력을 유지한다. 탭 간 BroadcastChannel은 로컬 변경 알림일 뿐 서버 동기화나 공유 기능이 아니다. 삭제 시 할 일과 그 업무 기록은 같은 트랜잭션으로 정리하고 연결 중인 프로젝트/공정의 삭제는 차단한다. 백업 복원도 참조 검증 후 원자적으로 교체한다.

## GROUP 연결 시 권장 작업 순서

1. **기존 서버와 권한 확인:** 최신 GROUP의 실제 인증 방식·세션/CSRF·활성 계정 검사·프로젝트 조회 범위·개인 데이터 정책을 확인한다. 현재 프로젝트 공동 조회 권한이 미래 개인 ToDo 공유 권한을 뜻하지 않는다. 사용자별/프로젝트별 읽기·쓰기·삭제 권한을 서버에서 정의한다.
2. **실제 API 계약 합의:** 프로젝트·공정 조회, 할 일 조회/등록/수정, 업무 기록 조회/등록/수정, 삭제 및 종속 기록 처리, 페이지네이션·전체 조회 기준을 합의한다. 이 문서는 확정된 API 경로나 요청 형식을 제시하지 않는다. 후속 문서에 예시를 추가할 때 반드시 **제안안**으로 표시하고 실제 서버와 구분한다.
3. **DTO 변환 계층:** 예를 들어 미래 `src/data/group-mapper.js`에 외부 응답 → 로컬 모델 변환을 둔다. 실제 ID·날짜·타임스탬프·상태를 명시적으로 매핑하고 잘못된 참조를 차단한다. 외부 모델을 UI에 직접 전달하지 않는다.
4. **원격 provider:** 예를 들어 미래 `src/data/group-provider.js`가 기존 RepositoryProvider 계약과 원자적 업무 명령을 구현한다. `src/main.js`의 provider 선택을 바꾸되 UI는 TodoService를 계속 사용한다. 서버 측 인가, 오류 형식, 재시도/중복 생성 방지를 검증한다.
5. **삭제·충돌·동기화:** hard delete/soft delete/tombstone, 서버 버전/ETag, 오프라인 outbox와 멱등 키, 서버와 로컬의 충돌 해결 UI, 로그인 사용자 변경 시 로컬 데이터 격리를 먼저 결정한다. 현행 로컬 `version`을 서버 버전으로 임의 해석하지 않는다. 암묵적인 last-write-wins나 브라우저 로컬 데이터를 서버로 자동 업로드하지 않는다.
6. **기존 로컬 데이터 이전:** JSON 백업을 먼저 확보하고 사용자 동의 하에 개인 할 일/예시 데이터/외부 연결을 구분해 import 정책을 만든다. 동기화 완료 판정, 실패/부분 성공의 복구와 재실행 안전성을 테스트한다.
7. **모바일 PWA·알림:** 모바일 탐색·터치·접근성·브라우저별 설치/저장 제약을 설계하고 실기기로 확인한다. 푸시는 서버 구독·인증·권한·알림 허용/해제·전달 실패를 별도 구현한다.

## 배치와 GROUP 보호

현재는 별도 서버의 `/todo/` 경로다. GROUP 메인 메뉴나 로그인 화면에 링크를 추가하지 않았고 GROUP의 `server.js`, `public/`, root service worker, SQLite는 변경하지 않았다.

향후 같은 도메인에 배치하려면 `dist/`를 **정확히 `/todo/` 하위 경로**로 제공하도록 정적 파일/프록시 경로를 먼저 구성한다. `/todo/sw.js`에 `/todo/` 범위만 허용하고 GROUP 루트 SW나 API를 캐시 대상에 넣지 않는다. GROUP과 ToDo 양쪽에서 로그인·메뉴·정적 자산·SW의 최장 scope 선택과 업데이트를 다시 브라우저로 검사한다. 앱 경로 자체를 바꾸면 manifest의 id/start_url/scope와 build의 자산 URL 및 서버 경로를 함께 변경해야 한다.

운영 GROUP 데이터·메일 암호화 키·첨부파일을 ToDo 예시나 소스 ZIP에 넣지 않는다. 이 로컬 시제품의 실행으로 운영 데이터가 복구되거나 서버와 연결됐다고 표시하지 않는다.

## 0.2 계층 및 집계 규칙

세 보기 모두 `selectTasks(snapshot, preferences)`의 최상위 할 일 결과를 사용한다. 하위 작업은 같은 tasks 저장소의 `parentId`로 연결하며 한 단계만 허용한다. 신규 하위 작업의 소속은 서버가 없더라도 업무 계층에서 상위 기준으로 강제한다. 상위 소속 변경은 하위 작업의 버전도 증가시켜 낡은 탭에서 덮어쓰지 못하게 한다. 삭제는 상위·직접 하위·소속 업무 기록을 원자적으로 정리한다.

`projectSummary`는 전체 snapshot의 최상위 할 일만 사용한다. `subtaskSummary`는 해당 상위의 하위 작업만 계산한다. 어느 값도 GROUP 진척률로 전송하거나 표시하지 않는다.

IndexedDB 스키마와 JSON 백업 형식은 2다. 마이그레이션은 `src/data/indexed-db.js`, 이전 JSON 변환·검증은 `src/domain/service.js`의 `validateBackup`에 있다. 모든 신규 저장소는 백업·복원·초기화의 동일 원자적 경계에 포함한다.

## 후속 협업 연결 지점

- LocalProfile → 실제 인증 사용자 매핑을 합의한다. 기존 로컬 UUID와 외부 GROUP ID를 구분하고 로컬 담당자 필터를 권한 검사로 사용하지 않는다.
- 서버가 각 프로젝트/공정/할 일/하위 작업/업무 기록의 읽기·쓰기·삭제를 인가해야 한다. 상위 소속 변경 및 종속 삭제도 서버 트랜잭션으로 처리한다.
- SavedView, TaskTemplate의 개인/공유 소유권·접근 범위와 삭제 정책을 정한다. 현재는 로컬만 존재한다.
- DTO 변환, 버전 충돌, 재시도·멱등성, 삭제 tombstone, 오프라인 outbox, 로그인 사용자 변경 시 로컬 분리, 기존 로컬 데이터의 선택적 업로드를 순서대로 구현한다.
- 댓글/멘션/팀원 초대/첨부 업로드/알림/서버 반복 작업은 별도 모델과 서버 권한·전달 체계가 필요하다. 현재 동작하는 UI나 API를 제공하지 않는다.

경로와 요청 형식은 아직 정하지 않았다. 향후 추가하는 예시 API는 **제안안**이라고 명시하고 실제 확인된 GROUP 계약과 구분한다.
