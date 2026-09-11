# Go Live — VS Code 확장 제작 명세

> 이 문서는 Claude Code 프로젝트의 기준 문서다. `CLAUDE.md`에서 이 파일을 참조하고, 구현 중 판단이 필요하면 이 문서의 "비목표"와 "설계 원칙"을 우선한다.

작업명(가칭): **Go Live**
확장 ID(가칭): `doodlefingers.go-live` — 배포 전 변경 가능
라이선스: MIT

---

## 1. 제작 의도

### 1.1 문제

디자인과 학생을 대상으로 웹 인터랙션 수업(p5.js, three.js, vibe coding)을 진행한다. 학생들은 터미널을 쓰지 않고, 에러 메시지를 읽지 못하며, Node.js 설치 여부조차 모르는 경우가 많다.

기존 Live Server(ritwickdey)는 상태바 "Go Live" 버튼 하나로 정적 HTML을 띄워주는 최고의 UX를 제공하지만, `package.json`이 있는 프로젝트(Vite 등)는 전혀 다루지 못한다. AI 코딩 도구는 기본적으로 npm 기반 코드를 생성하므로, 학생이 vibe coding을 하는 순간 Live Server의 세계에서 튕겨 나간다.

그 결과 수업 시간의 상당 부분이 "제 컴퓨터에서만 안 돼요"에 소모된다.

### 1.2 목표

**정적 프로젝트든 npm 프로젝트든 상태바 버튼 하나로 동일하게 동작하는 "Go Live"를 만든다.**

- 학생은 프로젝트 종류를 구분할 필요가 없다
- 학생은 터미널을 열 필요가 없다
- 실패했을 때 학생이 이해할 수 있는 한국어로 원인과 해결책을 알려준다

### 1.3 비목표 (하지 않는 것)

- 번들러를 직접 구현하지 않는다. Vite 등 프로젝트의 dev 스크립트를 실행할 뿐이다
- Five Server의 instant update(저장 없이 반영)를 재구현하지 않는다. 저장 시 리로드면 충분하다
- PHP, SSR 지원을 하지 않는다
- 멀티루트 워크스페이스는 1차 범위에서 제외한다 (첫 번째 폴더만 대상)
- 마켓플레이스 공개는 1차 범위에서 제외한다. `.vsix` 배포로 시작한다

### 1.4 설계 원칙

1. **에러 메시지가 제품이다.** "Go Live" 버튼은 껍데기고, 진짜 가치는 `ENOENT: node`를 "Node.js가 설치되어 있지 않아요"로 바꿔주는 데 있다
2. **학생에게 보이는 표면적은 최소화한다.** 평소엔 상태바 버튼과 브라우저만 보인다. 터미널은 실패했을 때만 나타난다
3. **기존 도구를 최대한 재사용한다.** 정적 서빙은 `five-server` 라이브러리에 위임한다. 직접 짜는 건 판단 로직과 npm 실행뿐이다
4. **Windows와 macOS에서 똑같이 동작해야 한다.** 학생의 절반은 Windows다

---

## 2. 사용자 시나리오

### 2.1 정적 프로젝트

```
학생: index.html이 있는 폴더를 연다
학생: 상태바 "Go Live" 클릭
확장: five-server 기동 → 브라우저에서 http://localhost:5500 열림
학생: 파일 저장 → 브라우저 자동 리로드
학생: 상태바 "Stop" 클릭 → 서버 종료
```

### 2.2 npm 프로젝트 (정상)

```
학생: package.json이 있는 Vite 프로젝트를 연다
학생: 상태바 "Go Live" 클릭
확장: node_modules 없음 감지 → npm install 실행 (상태바에 진행 표시)
확장: npm run dev 실행 → 출력에서 localhost URL 감지 → 브라우저 열림
학생: 파일 저장 → Vite HMR
학생: 상태바 "Stop" 클릭 → 프로세스 트리 종료
```

### 2.3 npm 프로젝트 (Node 미설치)

```
학생: 상태바 "Go Live" 클릭
확장: node 실행 파일 없음 감지
확장: 모달 표시
       "Node.js가 설치되어 있지 않아요.
        이 프로젝트를 실행하려면 Node.js가 필요합니다.
        [다운로드 페이지 열기] [설치 안내 보기]"
```

### 2.4 npm 프로젝트 (설치 실패)

```
확장: npm install 종료 코드 ≠ 0
확장: 터미널 패널을 자동으로 표시 (reveal)
확장: 에러 매핑 테이블에서 원인 추정 → 상단에 한국어 안내 + 원문 로그
```

---

## 3. 아키텍처

### 3.1 의사결정 흐름

```
Go Live 클릭
 │
 ├─ 이미 실행 중? ──→ Stop (프로세스 트리 종료 / five-server shutdown)
 │
 └─ 워크스페이스 루트에 package.json 존재?
      │
      ├─ 없음 ─→ [정적 모드]
      │            five-server.start({ root, port, open: true })
      │
      └─ 있음 ─→ [npm 모드]
                   1. node 존재 확인 (없으면 안내 후 중단)
                   2. 패키지 매니저 감지 (lockfile 기준)
                   3. 실행 스크립트 결정 (dev > start > serve, 없으면 안내 후 중단)
                   4. 설치 필요 여부 판단
                      - node_modules 없음 → install
                      - lockfile 해시가 workspaceState에 저장된 값과 다름 → install
                   5. install 실행 (Pseudoterminal, 완료까지 대기)
                   6. dev 스크립트 실행 (Pseudoterminal, 백그라운드)
                   7. stdout에서 localhost URL 정규식 감지 → 브라우저 열기
                   8. 상태바를 "Stop"으로 전환
```

### 3.2 파일 구조

```
go-live/
├── package.json            # 확장 매니페스트 (contributes, activationEvents)
├── tsconfig.json
├── esbuild.js              # 번들링 (five-server 포함)
├── CLAUDE.md               # 이 문서를 참조하도록 작성
├── docs/
│   └── GO_LIVE_SPEC.md     # 본 문서
├── src/
│   ├── extension.ts        # activate/deactivate, 명령 등록
│   ├── statusBar.ts        # 상태바 아이템 상태 머신 (idle / installing / running / error)
│   ├── detect.ts           # package.json, lockfile, node 존재, 스크립트 이름 감지
│   ├── runner/
│   │   ├── static.ts       # five-server 래퍼
│   │   ├── npm.ts          # install + dev 실행, URL 감지
│   │   └── pty.ts          # Pseudoterminal 구현 (출력 가로채기 + 터미널 표시)
│   ├── errors.ts           # 에러 매핑 테이블 + 사용자 메시지 생성
│   └── l10n/
│       └── ko.json         # 한국어 문자열 (기본), 필요 시 en.json
├── test/
│   └── fixtures/           # 테스트용 프로젝트 (정적, vite, pnpm, 스크립트 없음 등)
└── README.md               # 학생용 설치/사용 안내
```

### 3.3 상태 머신

```
idle ──(click)──→ checking ──→ installing ──→ starting ──→ running
  ▲                  │              │             │           │
  │                  └──(error)─────┴─────────────┘           │
  │                                 ▼                         │
  └───────────────────────────── error ◄──(click: 재시도)      │
  ▲                                                           │
  └────────────────────────────(click: stop)──────────────────┘
```

상태바 표시:

| 상태 | 텍스트 | 색상 |
|---|---|---|
| idle | `$(radio-tower) Go Live` | 기본 |
| checking / installing | `$(sync~spin) 설치 중...` | 기본 |
| starting | `$(sync~spin) 시작 중...` | 기본 |
| running | `$(circle-slash) Stop :5173` | `statusBarItem.warningBackground` |
| error | `$(error) Go Live` | `statusBarItem.errorBackground` |

---

## 4. 기술 결정

### 4.1 정적 서빙: `five-server` 라이브러리

> **구현 변경 (2026-09-11):** five-server 는 모든 버전이 "배포 금지, 지인 범위 공유만 허용" 자체 라이선스라 .vsix / 마켓플레이스 배포에 포함할 수 없다. 정적 서빙·파일 감시·WebSocket 리로드는 `src/runner/static.ts` 에 Node 내장 API(http, fs.watch, 직접 구현한 WebSocket 프레임)로 구현했다. 아래 내용은 원래 계획의 기록이다.

- npm `five-server` 패키지를 dependency로 포함하고 esbuild로 번들링한다
- `new FiveServer().start({ root, port, open: false })` 후 URL을 직접 열어 브라우저 오픈 로직을 npm 모드와 통일한다
- `shutdown()`으로 종료
- 이유: 정적 서빙 + chokidar 감시 + WebSocket 리로드를 직접 짜는 건 재발명이다

### 4.2 프로세스 실행: `child_process.spawn` + Pseudoterminal

- `vscode.window.createTerminal({ name, pty })`의 `Pseudoterminal` 인터페이스를 구현한다
- 내부에서 `spawn(cmd, args, { cwd, shell: true, env })` 실행
- stdout/stderr를 `onDidWrite`로 터미널에 흘리면서 동시에 URL 감지·에러 매핑에 사용한다
- 이유: `createTerminal().sendText()`는 출력을 읽을 수 없고, OutputChannel만 쓰면 학생이 에러를 못 본다. Pseudoterminal은 둘 다 해결한다
- 터미널은 생성 시 `preserveFocus: true`, `show` 하지 않는다. 에러 발생 시에만 `terminal.show()`

### 4.3 프로세스 종료: `tree-kill`

- Vite/webpack은 자식 프로세스를 만들고, Windows에서 `proc.kill()`은 부모만 죽인다
- `tree-kill(pid, 'SIGTERM')` 사용, 3초 후 미종료 시 `SIGKILL`
- `deactivate()`에서도 반드시 호출

### 4.4 패키지 매니저 감지

우선순위: lockfile 존재 여부

| lockfile | 매니저 |
|---|---|
| `pnpm-lock.yaml` | pnpm |
| `yarn.lock` | yarn |
| `bun.lock` / `bun.lockb` | bun |
| `package-lock.json` 또는 없음 | npm |

`package.json`의 `packageManager` 필드가 있으면 그것을 우선한다. 감지된 매니저가 설치되어 있지 않으면 npm으로 폴백하고 경고를 표시한다.

### 4.5 실행 스크립트 결정

`package.json.scripts`에서 순서대로 탐색: `dev` → `start` → `serve` → `preview`
설정 `goLive.npmScript`로 강제 지정 가능. 없으면 에러 상태로 전환하고 "실행할 스크립트가 없습니다" 안내.

### 4.6 설치 필요 여부 판단

```
needsInstall =
  !exists(node_modules)
  || hash(lockfile) !== workspaceState.get('lockfileHash')
```

install 성공 시 `workspaceState.update('lockfileHash', hash(lockfile))`.
설정 `goLive.alwaysInstall: true`면 항상 install.

### 4.7 URL 감지

dev 서버 stdout에 대해 정규식:

```
/(https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):\d+\/?[^\s]*)/
```

첫 매치를 `localhost`로 정규화하여 연다. Vite, webpack-dev-server, Parcel, Next.js, Astro, SvelteKit 출력 포맷으로 테스트한다.
감지 타임아웃 30초. 초과 시 터미널을 표시하고 "서버 주소를 찾지 못했습니다. 터미널을 확인하세요" 안내.

### 4.8 브라우저 열기

기본: `vscode.env.openExternal(uri)` — 시스템 기본 브라우저
설정 `goLive.browser: "simple"`이면 `vscode.commands.executeCommand('simpleBrowser.show', url)` — 에디터 내 프리뷰

### 4.9 Node 존재 확인

- `spawn('node', ['--version'])` 실행, ENOENT면 미설치로 판정
- macOS GUI 앱은 셸 PATH를 상속하지 않을 수 있다. `process.env.PATH`에 `/usr/local/bin`, `/opt/homebrew/bin`, `~/.nvm/versions/node/*/bin`, `~/.volta/bin` 등을 보강한 뒤 재시도한다
- 그래도 없으면 다운로드 안내 모달

### 4.10 활성화

`activationEvents: ["onStartupFinished"]` — 워크스페이스 열리면 상태바 버튼이 항상 보여야 한다. `workspaceContains` 조건은 쓰지 않는다 (빈 폴더에서도 버튼이 있어야 학생이 혼란스럽지 않다).

---

## 5. 에러 매핑 테이블

`src/errors.ts`에 아래 규칙을 배열로 정의한다. stdout+stderr 전체 문자열에 대해 순서대로 매칭하고, 첫 매치의 메시지를 표시한다. 어떤 것도 매치되지 않으면 일반 메시지 + 터미널 표시.

| 감지 패턴 | 사용자 메시지 (ko) | 액션 |
|---|---|---|
| spawn ENOENT (node) | Node.js가 설치되어 있지 않아요. 이 프로젝트를 실행하려면 Node.js가 필요합니다. | [다운로드] → https://nodejs.org/ko/download |
| `EADDRINUSE` | 포트가 이미 사용 중이에요. 다른 Go Live나 서버가 켜져 있지 않은지 확인하세요. | [다른 포트로 재시도] |
| `EACCES` / `EPERM` | 권한 문제로 실행할 수 없어요. 폴더를 바탕화면이나 문서 폴더로 옮겨보세요. | [터미널 보기] |
| `ERR_PNPM_` / `pnpm: command not found` | pnpm이 설치되어 있지 않아요. npm으로 대신 설치할게요. | 자동 폴백 |
| `ERESOLVE` / `peer dep` | 패키지 버전 충돌이에요. 강제 설치를 시도할게요. | `--legacy-peer-deps` 재시도 |
| `ENOTFOUND` / `ETIMEDOUT` / `network` | 인터넷 연결을 확인해주세요. 패키지 다운로드에 실패했어요. | [재시도] |
| `EBUSY` / `ENOTEMPTY` (Windows) | 파일이 다른 프로그램에서 사용 중이에요. VS Code를 닫았다 다시 열어보세요. | — |
| `Missing script:` | 실행할 스크립트(dev/start)가 package.json에 없어요. | [설정에서 지정] |
| `Unsupported engine` / `EBADENGINE` | Node.js 버전이 너무 낮거나 높아요. LTS 버전으로 다시 설치하세요. | [다운로드] |
| `ERR_MODULE_NOT_FOUND` / `Cannot find module` | 필요한 패키지가 빠져 있어요. 다시 설치할게요. | node_modules 삭제 후 재설치 |
| 한글/공백 경로 + 실패 | 폴더 경로에 한글이나 공백이 있으면 일부 도구가 실패해요. 영문 경로로 옮겨보세요. | 조건: `/[가-힣]/.test(root) \|\| /\s/.test(root)` |

메시지 원칙:
- 첫 문장은 "무엇이 문제인지", 두 번째 문장은 "무엇을 하면 되는지"
- 기술 용어(ENOENT, peer dependency)는 쓰지 않는다
- 원문 로그는 숨기지 않는다. 터미널에 그대로 남긴다

---

## 6. 설정 (`contributes.configuration`)

| 키 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `goLive.staticPort` | number | 5500 | 정적 모드 포트 |
| `goLive.npmScript` | string | `""` | 실행할 스크립트 강제 지정 (빈 값이면 자동 감지) |
| `goLive.packageManager` | enum | `"auto"` | auto / npm / pnpm / yarn / bun |
| `goLive.alwaysInstall` | boolean | false | 매번 install 실행 |
| `goLive.browser` | enum | `"external"` | external / simple / none |
| `goLive.showTerminalOnStart` | boolean | false | 시작 시 터미널 표시 (교수자용) |
| `goLive.staticRoot` | string | `""` | 정적 모드 루트 하위 경로 |

---

## 7. 명령 (`contributes.commands`)

| ID | 제목 | 비고 |
|---|---|---|
| `goLive.toggle` | Go Live: 시작/중지 | 상태바 버튼에 연결 |
| `goLive.start` | Go Live: 시작 | |
| `goLive.stop` | Go Live: 중지 | |
| `goLive.reinstall` | Go Live: 패키지 다시 설치 | node_modules 삭제 후 install |
| `goLive.showTerminal` | Go Live: 터미널 보기 | |

키바인딩: Live Server와 동일하게 `alt+L alt+O` (시작), `alt+L alt+C` (중지). 학생 자료 호환용.

---

## 8. 개발 단계

### M0 — 스캐폴딩
- `npx --package yo --package generator-code -- yo code` (TypeScript, esbuild)
- 상태바 버튼이 뜨고 클릭 시 알림만 표시되는 상태까지
- F5 Extension Development Host로 확인

### M1 — 정적 모드
- `five-server` 통합, start/stop
- 브라우저 열기
- 완료 기준: index.html 폴더에서 Live Server와 동일한 경험

### M2 — npm 모드 (해피 패스)
- detect.ts: package.json, lockfile, 스크립트 감지
- pty.ts: Pseudoterminal + spawn
- npm.ts: install → dev → URL 감지 → 브라우저
- tree-kill 종료
- 완료 기준: `npm create vite` 프로젝트에서 버튼 하나로 동작

### M3 — 에러 처리
- errors.ts 매핑 테이블 구현
- Node 미설치 감지 + PATH 보강
- 터미널 자동 표시 조건
- 완료 기준: 5장의 모든 케이스가 fixture로 재현되고 의도한 메시지가 뜸

### M4 — 마감
- 설정 항목 전부 연결
- README(학생용) 작성: 설치 3단계 + 스크린샷
- `vsce package` → `.vsix`
- 완료 기준: 새 계정의 깨끗한 macOS/Windows에서 vsix 설치 후 M1, M2 시나리오 통과

---

## 9. 테스트 매트릭스

`test/fixtures/` 아래에 각 케이스 프로젝트를 둔다.

| fixture | 내용 | 기대 동작 |
|---|---|---|
| `static-basic` | index.html + style.css | five-server 기동, 5500 |
| `static-nested` | src/index.html | staticRoot 설정 시 동작 |
| `vite-vanilla` | `npm create vite` 기본 | install → dev → 5173 열림 |
| `vite-pnpm` | pnpm-lock.yaml | pnpm으로 실행 |
| `vite-yarn` | yarn.lock | yarn으로 실행 |
| `no-script` | scripts 비어 있음 | "실행할 스크립트가 없어요" |
| `start-only` | dev 없고 start만 | start 실행 |
| `port-conflict` | 5173 미리 점유 후 실행 | EADDRINUSE 메시지 |
| `korean-path` | `/테스트 폴더/` 안에 vite | 경고 메시지 (실패 시) |
| `broken-deps` | 존재하지 않는 패키지 의존 | 네트워크/설치 에러 메시지 |

수동 테스트 환경:
- macOS (Homebrew node / nvm / 미설치)
- Windows 10/11 (nodejs.org 설치 / 미설치)
- VS Code / Cursor 각각

---

## 10. 배포

### 1차: `.vsix` 직접 배포
```
npm run package        # esbuild production
npx vsce package       # go-live-0.1.0.vsix 생성
```
학생 안내: 확장 패널 → `...` → "Install from VSIX..."

### 2차: 마켓플레이스 (선택)
- MS Marketplace: Azure DevOps PAT 필요, `vsce publish`
- Open VSX: `ovsx publish` — Cursor/VSCodium 사용 학생을 위해 필수
- 이름은 기존 Live Server 계열과 혼동되지 않게 짓는다

---

## 11. Claude Code 작업 지침

- 언어: TypeScript strict. 런타임 의존성은 `five-server`, `tree-kill`만. 그 외 추가 시 이유를 커밋 메시지에 남긴다
- 사용자 노출 문자열은 전부 `src/l10n/ko.json`에 둔다. 코드에 한국어 리터럴을 직접 쓰지 않는다
- Windows 경로/셸 차이를 항상 고려한다. `shell: true` 사용 시 인자 이스케이프에 주의한다
- 각 마일스톤 완료 시 fixture로 검증한 뒤 다음 단계로 넘어간다
- 에러 매핑 테이블에 새 케이스를 추가할 때는 반드시 fixture도 함께 추가한다
- 판단이 갈리면 "디자인과 학생이 이 화면을 보고 다음 행동을 알 수 있는가"를 기준으로 결정한다
