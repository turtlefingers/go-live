# Go Live - Live Server for npm & Vite

**정적 HTML이든 npm/Vite 프로젝트든, 상태바 버튼 하나로 실행하는 라이브 서버.**
*Live Server that also runs npm/Vite projects with one click — no terminal, no AI tokens.*

## 왜 만들었나

디자인과 학생들이 vibe coding으로 만든 결과물은 대부분 npm 기반(Vite, React, Next.js…)입니다. 기존 Live Server는 정적 HTML만 다루기 때문에 이런 프로젝트 앞에서 멈추고, 그다음 학생이 택하는 길은 둘 중 하나입니다. 터미널을 열어 `npm install`, `npm run dev`를 치거나, AI 에이전트에게 "실행해줘"라고 시키는 것.

전자는 터미널을 모르는 학생에게 벽이고, 후자는 실행 한 번마다 토큰을 쓰고 느리며 매번 다르게 동작합니다. **만든 결과물을 보는 데는 AI가 필요하지 않습니다.** Go Live는 그 지점을 버튼 하나로 대신합니다.

- 프로젝트 종류를 구분할 필요가 없습니다. 폴더를 열고 **Go Live**를 누르면 알아서 판단합니다.
- 터미널이 보이지 않습니다. 설치도 실행도 뒤에서 처리하고, 실패했을 때만 나타납니다.
- 에러는 한국어로 "무엇이 문제인지, 무엇을 하면 되는지"를 말합니다.

## 동작

| 폴더에 | 하는 일 |
|---|---|
| `index.html` 만 있음 | 내장 정적 서버로 서빙. 저장하면 리로드, CSS만 바뀌면 새로고침 없이 교체 |
| `package.json` 있음 | 패키지 매니저 감지(npm/pnpm/yarn/bun) → 필요하면 install → `dev`/`start`/`serve`/`preview` 중 첫 스크립트 실행 → 출력에서 로컬 주소를 찾아 브라우저 열기 |

Vite, webpack, Parcel, Next.js, Astro, SvelteKit, Express, `concurrently`로 묶은 풀스택 구성까지 확인했습니다. 백엔드와 프론트가 함께 뜨면 프론트의 `Local:` 주소를 엽니다.

**Stop**을 누르거나 에디터를 닫으면 dev 서버와 그 자식 프로세스까지 정리합니다. 창을 강제로 닫아도 감시 프로세스가 뒤처리합니다.

## 설치

**Antigravity, Cursor, VSCodium** (Open VSX): 확장 패널에서 `Go Live`를 검색해 게시자 **doodlefingers** 항목을 설치합니다.

**VS Code**: 아직 Microsoft Marketplace에 올리지 않았습니다. https://github.com/turtlefingers/go-live/releases 에서 `.vsix`를 받아 확장 패널 `···` → **VSIX에서 설치...** 로 설치합니다.

## 사용

1. 프로젝트 **폴더**를 엽니다. 파일 하나만 열면 동작하지 않습니다.
2. 오른쪽 아래 상태바의 **📡 Go Live** 를 누릅니다.
3. 브라우저가 열립니다. 저장하면 자동 반영됩니다.
4. **Stop** 을 누르면 끝.

### 우클릭으로 개별 실행

폴더 하나에 프로젝트가 여러 개 있어도 됩니다. 실행하고 싶은 것을 우클릭하면 됩니다.

| 우클릭한 파일 | 하는 일 |
|---|---|
| `package.json` | 그 폴더를 npm 프로젝트로 실행하고 dev 서버 주소를 엽니다 |
| HTML 파일 (npm 프로젝트 안) | 가장 가까운 `package.json`이 있는 프로젝트를 실행합니다 |
| HTML 파일 (정적) | 정적 서버를 띄우고 그 파일의 주소를 엽니다 (예: `about.html` → `/about.html`) |

메뉴 이름은 **Open with Go Live**, 실행 중에는 **Stop Go Live**입니다. 다른 프로젝트가 실행 중이면 먼저 중지하고 새로 시작합니다. 탐색기, 편집기 본문, 편집기 탭 어디에서 우클릭해도 같습니다.

단축키는 Live Server와 같습니다. `Alt+L Alt+O` 시작, `Alt+L Alt+C` 중지.

명령 팔레트: `Start Go Live`, `Stop Go Live`, `Open with Go Live`, `Go Live: Reinstall packages`(node_modules 삭제 후 재설치), `Go Live: Show terminal`.

## 브라우저에서 코드로 (정적 모드)

디자인을 고칠 때 "이 부분이 코드 어디지?"를 브라우저가 답해 줍니다.

- **Alt(Option)+클릭 → 에디터 점프**: 브라우저에서 요소를 Alt+클릭하면 그 요소에 적용된 CSS 규칙을 찾아 에디터가 해당 파일의 그 줄을 엽니다. 외부 `.css` 파일이든 HTML 안의 `<style>`이든 됩니다. 규칙이 여러 개면 목록에서 고를 수 있습니다.
- **DevTools 에서 저장**: Chrome 계열 브라우저(Chromium 135 이상)에서는 DevTools 워크스페이스가 자동으로 연결됩니다. 개발자 도구의 Styles 패널에서 값을 끌어 맞춘 뒤 Cmd/Ctrl+S 를 누르면 원본 CSS 파일에 저장되고, 저장된 내용은 다시 라이브로 반영됩니다. 처음 한 번 "폴더 접근 허용" 확인이 뜹니다.

둘 다 정적 모드에서만 동작합니다. npm 프로젝트는 Vite 같은 dev 서버가 페이지를 서빙하므로 그쪽 플러그인(예: `vite-plugin-devtools-json`)을 쓰면 됩니다. `goLive.inspect`, `goLive.devtoolsWorkspace` 설정으로 끌 수 있습니다.

## 에러 안내

이 확장의 핵심입니다. 로그는 터미널에 그대로 남기되, 화면에는 원인과 다음 행동을 한국어로 보여줍니다.

| 상황 | 안내 |
|---|---|
| Node.js 미설치 | "Node.js가 설치되어 있지 않아요" + 다운로드 페이지, 설치 안내 |
| 포트 사용 중 | "포트가 이미 사용 중이에요" + 다른 포트로 재시도 버튼 |
| 인터넷 끊김 / 패키지 없음 | "인터넷 연결을 확인해주세요" + 재시도 |
| peer 의존성 충돌 | 자동으로 `--legacy-peer-deps` 재시도 |
| pnpm/yarn 미설치 | 자동으로 npm 폴백 |
| 모듈 누락 | 자동으로 node_modules 재설치 |
| 실행 스크립트 없음 | "실행할 스크립트(dev/start)가 package.json에 없어요" + 설정 열기 |
| Node 버전 불일치 | "LTS 버전으로 다시 설치하세요" |
| 한글/공백 경로에서 실패 | "영문 경로로 옮겨보세요" |

macOS GUI 앱이 셸 PATH를 물려받지 못해 Node를 못 찾는 경우(nvm, volta, fnm, Homebrew)도 알아서 찾습니다.

## 설정

| 설정 | 기본값 | 설명 |
|---|---|---|
| `goLive.staticPort` | 5500 | 정적 모드 포트. 사용 중이면 빈 포트로 대체 |
| `goLive.npmScript` | (자동) | 실행할 스크립트 강제 지정. package.json의 scripts에 있는 이름만 허용 |
| `goLive.packageManager` | auto | npm / pnpm / yarn / bun |
| `goLive.alwaysInstall` | false | 시작할 때마다 install |
| `goLive.browser` | external | external(기본 브라우저) / simple(에디터 안) / none |
| `goLive.showTerminalOnStart` | false | 시작 시 터미널 표시 |
| `goLive.staticRoot` | (루트) | 정적 모드에서 서빙할 하위 폴더 |
| `goLive.inspect` | true | 정적 모드에서 Alt+클릭한 요소의 CSS 규칙을 에디터에서 열기 |
| `goLive.devtoolsWorkspace` | true | 정적 모드에서 Chrome DevTools 워크스페이스 자동 연결 |
| `goLive.staticHost` | localhost | 정적 서버 공개 범위. `network`로 바꾸면 같은 와이파이의 휴대폰에서도 접근 |
| `goLive.cors` | false | 정적 서버에 CORS `*` 헤더. 다른 포트의 페이지에서 파일을 불러올 때만 |

## 보안

정적 모드 서버는 개발용이지만 기본값을 보수적으로 잡았습니다.

- 이 컴퓨터(127.0.0.1)에서만 접근됩니다. 휴대폰으로 확인하려면 `goLive.staticHost`를 `network`로 바꾸세요.
- `.env`, `.git` 같은 숨김 파일과 폴더는 서빙하지 않습니다.
- Host 헤더가 localhost가 아니면 거부합니다 (DNS 리바인딩 방지). network 모드에서는 사설 IP 대역을 허용합니다.
- CORS 헤더는 기본으로 붙지 않습니다.
- 프로젝트 폴더 밖(`../`, 심볼릭 링크)은 서빙하지 않습니다.

브라우저로 가는 파일에는 API 키 같은 비밀을 넣지 마세요. 정적이든 Vite든 번들에 그대로 들어갑니다.

## 개발

```bash
npm install
npm run compile      # 또는 F5 로 Extension Development Host
npm test             # 단위 테스트
npm run smoke        # 실제 npm install → dev → URL 감지 → 종료 (네트워크 필요)
npm run smoke:server # Express API, WebSocket, Next SSR, 정적 서버 MIME/리로드, Vite HMR
npm run smoke:crash  # 확장 호스트 강제 종료 시 dev 서버 정리
npm run vsix         # .vsix 패키징
```

런타임 의존성은 `tree-kill` 하나이고 번들에 포함됩니다. 정적 서버(서빙·감시·리로드)는 Node 내장 API로 직접 구현했습니다. 테스트 fixture와 기대 동작은 `test/fixtures/README.md`, 설계 명세는 `docs/GO_LIVE_SPEC.md`에 있습니다.

## 만든 배경

디자인과 웹 인터랙션 수업에서 학생들이 터미널 없이 정적 페이지와 Vite 프로젝트를 똑같이 실행할 수 있는 도구가 필요했는데 마땅한 것이 없어 직접 만들었습니다. 설계와 검증 외에 구현은 Claude Code 와 함께 했습니다. 문제가 있으면 이슈로 알려주세요.

— doodlefingers

## 감사의 말 (Acknowledgements)

이 확장은 다음 프로젝트들에 빚지고 있습니다. 아래 프로젝트의 코드는 포함되어 있지 않으며, 각 프로젝트와 무관하게 독립적으로 개발되었습니다.

- **[Live Server](https://github.com/ritwickdey/vscode-live-server)** by Ritwick Dey (MIT) — 상태바 "Go Live" 버튼 하나로 정적 페이지를 띄우는 경험, `Alt+L Alt+O` 키바인딩, 저장 시 리로드라는 사용자 경험이 이 확장에서 왔습니다. Go Live 는 그 경험을 npm/Vite 프로젝트까지 넓혀보려는 시도입니다.
- **[live-server](https://github.com/tapio/live-server)** by Tapio Vierros (MIT) — 정적 서빙 + 파일 감시 + WebSocket 리로드, CSS 만 바뀌면 페이지를 새로고침하지 않고 스타일만 교체하는 동작 방식을 참고해 Node 내장 API 로 새로 구현했습니다.
- **[Five Server](https://github.com/yandeu/five-server)** by Yannick Deubel — 에디터와 브라우저를 연결하는 여러 아이디어에서 영감을 받았습니다.
- **[tree-kill](https://github.com/pkrumins/node-tree-kill)** by Peteris Krumins (MIT) — Windows 에서도 dev 서버의 자식 프로세스까지 확실히 종료하는 데 씁니다. 이 확장에 포함된 유일한 외부 런타임 코드입니다.
- **[Codicons](https://github.com/microsoft/vscode-codicons)** by Microsoft (CC BY 4.0) — 확장 아이콘의 전파탑 모양은 VS Code 상태바에 쓰이는 codicon `radio-tower` 글리프를 색만 바꿔 사용했습니다. 상태바 버튼과 같은 모양이라 바로 알아볼 수 있습니다.
- **[Vite](https://vitejs.dev)** — 학생들이 처음 만나는 npm 프로젝트의 대부분이 Vite 입니다. Vite 의 `Local:` 출력 형식을 기준으로 서버 주소를 감지합니다.

이슈와 제안은 언제나 환영합니다.

## 라이선스

MIT
