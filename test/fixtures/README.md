# 테스트 fixture

각 폴더를 Antigravity/VS Code 에서 **폴더로 열고** 상태바 "Go Live" 를 누른다.

| fixture | 기대 동작 |
|---|---|
| `static-basic` | five-server 기동, http://localhost:5500 열림, 저장 시 리로드 |
| `static-nested` | `.vscode/settings.json` 의 `goLive.staticRoot: "src"` 로 src/index.html 이 루트로 열림 |
| `vite-vanilla` | npm install → npm run dev → 5173 열림 |
| `vite-pnpm` | pnpm 으로 실행 (pnpm 없으면 npm 폴백 경고) |
| `vite-yarn` | yarn 으로 실행 (yarn 없으면 npm 폴백 경고) |
| `no-script` | "실행할 스크립트(dev/start)가 package.json에 없어요" |
| `start-only` | npm start 실행, 3456 열림 |
| `port-conflict` | 먼저 `node hold-port.js` 로 5173 점유 → "포트가 이미 사용 중이에요" + [다른 포트로 재시도] |
| `korean-path/테스트 폴더` | 정상 동작. 실패 시 경로 경고 메시지 |
| `broken-deps` | 설치 실패 → 네트워크/설치 에러 메시지 + 터미널 표시 |

## 서버 기능 fixture (`npm run smoke:server`)

| fixture | 검증 내용 |
|---|---|
| `express-api` | `npm run dev` 로만 동작하는 API 라우트. 감지된 URL 로 `/api/hello` JSON 응답 |
| `fullstack-concurrently` | 백엔드(3100)가 먼저 URL 을 찍어도 Vite 의 Local 주소를 연다. Vite proxy 로 `/api` 통과 |
| `ws-chat` | 같은 포트의 WebSocket 에코. Stop 시 소켓까지 정리 |
| `next-api` | Next.js SSR 페이지 + `/api/hello` (설치 용량 큼) |
| `static-modules` | five-server 에서 ES module, fetch JSON, 한글 폴더/파일명, .glb/.wasm MIME, 저장 시 reload/refreshcss 신호 |
| `vite-vanilla` (재사용) | Vite HMR 웹소켓으로 파일 수정 → update 메시지 수신 |

## 디자인

예제 페이지는 모두 같은 테마를 씁니다. 확장 아이콘의 색(바탕 `#F5F5F5`, 글자 `#1E1E1E`, 선 `#D0D0D0`)을 기본으로, 포인트는 상태바의 라이브 초록 `#3DDC84`.
글꼴은 Pretendard(산세리프). 디자인 시스템은 [daisyUI](https://daisyui.com) 의 `cupcake` 테마를 CDN 으로 불러 CSS 변수만 덮어씁니다. 각 fixture 는 서로 다른 폴더로 열리므로 `<head>` 의 공통 스니펫이 파일마다 복사돼 있습니다 (인터넷 필요).
