# Go Live

**정적 HTML 이든 Vite 같은 npm 프로젝트든, 상태바 버튼 하나로 실행합니다.**

터미널을 열 필요가 없어요. `npm install` 도, `npm run dev` 도 버튼이 대신 눌러줍니다.
문제가 생기면 영어 에러 대신 한국어로 "무엇이 문제인지, 무엇을 하면 되는지" 알려줘요.

## 설치

**Antigravity, Cursor, VSCodium** — 확장 패널에서 검색해 설치합니다.

1. 왼쪽 **확장(Extensions)** 패널을 엽니다.
2. 검색창에 `Go Live` 를 입력하고, 게시자가 **doodlefingers** 인 항목의 **Install** 을 누릅니다.
3. 오른쪽 아래 상태바에 **📡 Go Live** 버튼이 나타나면 끝.

**VS Code** — 파일로 설치합니다. (VS Code 는 다른 마켓플레이스를 쓰기 때문에 검색으로는 나오지 않아요.)

1. https://github.com/turtlefingers/go-live/releases 에서 최신 `go-live-x.y.z.vsix` 파일을 내려받아 바탕화면 등 찾기 쉬운 곳에 둡니다.
2. 왼쪽 **확장(Extensions)** 패널을 열고, 오른쪽 위 `···` 메뉴 → **VSIX에서 설치... (Install from VSIX...)** 를 누릅니다.
3. 1번 파일을 고르면 끝. 상태바에 **📡 Go Live** 버튼이 나타납니다.

## 사용

1. 프로젝트 **폴더**를 엽니다 (파일 > 폴더 열기). 파일 하나만 열면 버튼이 동작하지 않아요.
2. 오른쪽 아래 상태바의 **Go Live** 를 누릅니다.
3. 브라우저가 열립니다. 파일을 저장하면 자동으로 새로고침돼요.
4. 끝나면 상태바의 **Stop** 을 누릅니다.

프로젝트 종류는 구분할 필요 없어요.

| 폴더 안에 | 동작 |
|---|---|
| `index.html` 만 있음 | 그대로 띄웁니다 (http://localhost:5500) |
| `package.json` 있음 (Vite 등) | 필요하면 설치부터 하고 dev 서버를 띄웁니다 |

단축키: `Alt+L Alt+O` 시작, `Alt+L Alt+C` 중지 (Live Server 와 같아요).

## 문제가 생겼을 때

상태바 버튼이 빨갛게 변하고 안내 메시지가 뜹니다. 메시지에 있는 버튼을 누르면 돼요.
자세한 로그는 아래 **터미널** 패널의 "Go Live" 탭에 그대로 남아 있습니다.

| 메시지 | 이렇게 하세요 |
|---|---|
| Node.js가 설치되어 있지 않아요 | [다운로드 페이지 열기] → LTS 설치 → 에디터를 완전히 껐다 켜기 |
| 포트가 이미 사용 중이에요 | [다른 포트로 재시도] 또는 다른 Go Live 를 먼저 Stop |
| 인터넷 연결을 확인해주세요 | 와이파이 확인 후 [다시 시도] |
| 실행할 스크립트가 없어요 | `package.json` 의 `scripts` 에 `dev` 또는 `start` 가 있는지 확인 |
| 폴더 경로에 한글이나 공백이 있으면… | 폴더를 `C:\dev\myproject` 처럼 영문 경로로 옮기기 |

명령 팔레트(`Cmd/Ctrl+Shift+P`) 에서 **Go Live: 패키지 다시 설치** 를 누르면 `node_modules` 를 지우고 처음부터 설치합니다. 뭔가 꼬였을 때 만능 해결책이에요.

## 설정 (선택)

| 설정 | 기본값 | 설명 |
|---|---|---|
| `goLive.staticPort` | 5500 | 정적 모드 포트 |
| `goLive.npmScript` | (자동) | 실행할 스크립트 이름 강제 지정 |
| `goLive.packageManager` | auto | npm / pnpm / yarn / bun |
| `goLive.alwaysInstall` | false | 매번 install 실행 |
| `goLive.browser` | external | external(기본 브라우저) / simple(에디터 안) / none |
| `goLive.showTerminalOnStart` | false | 시작할 때 터미널을 바로 표시 (교수자용) |
| `goLive.staticRoot` | (루트) | 정적 모드에서 서빙할 하위 폴더 |

## 개발자용

런타임 의존성은 `tree-kill` 하나뿐이고 번들에 포함됩니다. 정적 서버(파일 서빙·감시·리로드)는 Node 내장 API 로 직접 구현돼 있습니다 (`src/runner/static.ts`).

```bash
npm install
npm run compile      # 또는 F5 로 Extension Development Host 실행
npm test             # 단위 테스트
npm run smoke        # npm 흐름 (install → dev → URL → 종료)
npm run smoke:server # 서버 기능 (API, WebSocket, Next SSR, MIME, 리로드, HMR)
npm run smoke:crash  # 에디터 강제 종료 시 dev 서버 정리
npm run vsix         # .vsix 패키징
```

테스트 fixture 와 기대 동작은 `test/fixtures/README.md`, 설계 명세는 `docs/GO_LIVE_SPEC.md` 를 보세요.

## 라이선스

MIT

## 만든 배경

디자인과 웹 인터랙션 수업에서 학생들이 터미널 없이 정적 페이지와 Vite 프로젝트를 똑같이 실행할 수 있는 도구가 필요했는데 마땅한 것이 없어 직접 만들었습니다. 설계와 검증 외에 구현은 Claude Code 와 함께 했습니다. 문제가 있으면 이슈로 알려주세요.

— doodlefingers

## 감사의 말 (Acknowledgements)

이 확장은 다음 프로젝트들에 빚지고 있습니다. 아래 프로젝트의 코드는 포함되어 있지 않으며, 각 프로젝트와 무관하게 독립적으로 개발되었습니다.

- **[Live Server](https://github.com/ritwickdey/vscode-live-server)** by Ritwick Dey (MIT) — 상태바 "Go Live" 버튼 하나로 정적 페이지를 띄우는 경험, `Alt+L Alt+O` 키바인딩, 저장 시 리로드라는 사용자 경험이 이 확장에서 왔습니다. Go Live 는 그 경험을 npm/Vite 프로젝트까지 넓혀보려는 시도입니다.
- **[live-server](https://github.com/tapio/live-server)** by Tapio Vierros (MIT) — 정적 서빙 + 파일 감시 + WebSocket 리로드, CSS 만 바뀌면 페이지를 새로고침하지 않고 스타일만 교체하는 동작 방식을 참고해 Node 내장 API 로 새로 구현했습니다.
- **[Five Server](https://github.com/yandeu/five-server)** by Yannick Deubel — 에디터와 브라우저를 연결하는 여러 아이디어에서 영감을 받았습니다.
- **[tree-kill](https://github.com/pkrumins/node-tree-kill)** by Peteris Krumins (MIT) — Windows 에서도 dev 서버의 자식 프로세스까지 확실히 종료하는 데 씁니다. 이 확장에 포함된 유일한 외부 런타임 코드입니다.
- **[Codicons](https://github.com/microsoft/vscode-codicons)** by Microsoft (CC BY 4.0) — 확장 아이콘의 전파탑 모양은 VS Code 상태바에 쓰이는 codicon `radio-tower` 글리프를 색만 바꿔 사용했습니다. 상태바 버튼과 같은 모양이라 학생이 바로 알아볼 수 있습니다.
- **[Vite](https://vitejs.dev)** — 학생들이 처음 만나는 npm 프로젝트의 대부분이 Vite 입니다. Vite 의 `Local:` 출력 형식을 기준으로 서버 주소를 감지합니다.

이슈와 제안은 언제나 환영합니다.
