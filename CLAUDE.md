# Go Live — Claude Code 작업 지침

기준 문서: [docs/GO_LIVE_SPEC.md](docs/GO_LIVE_SPEC.md). 구현 중 판단이 필요하면 그 문서의 "비목표(1.3)"와 "설계 원칙(1.4)"을 우선한다.

## 빠른 명령

```bash
npm run compile     # 개발 번들 (dist/extension.js)
npm run watch       # 파일 변경 시 자동 번들
npm run typecheck   # tsc --noEmit
npm test            # 순수 모듈 단위 테스트 (errors, url, detect, commands)
npm run smoke       # vscode 스텁으로 실제 npm install→dev→URL→tree-kill 검증 (네트워크 필요)
npm run smoke:server # 서버 기능 검증: Express API, concurrently URL 선택, WebSocket, Next SSR, 정적 서버 MIME/리로드/404/Range, Vite HMR (--skip-next 가능)
npm run smoke:crash  # 확장 호스트 SIGKILL 후 dev 서버 트리가 감시 프로세스로 정리되는지
npm run smoke:kill   # Stop 이 프로세스 트리를 반복적으로 잘 죽이는지
npm run vsix        # production 번들 + .vsix 패키징
```

F5 (Run Extension) → Extension Development Host 가 `test/fixtures/static-basic` 을 연다.

## 구조

| 파일 | 역할 |
|---|---|
| `src/extension.ts` | activate/deactivate, 명령 등록, Controller (정적/npm 분기, 브라우저 열기, 실패 안내) |
| `src/statusBar.ts` | 상태바 상태 머신 idle / checking / installing / starting / running / error |
| `src/detect.ts` | package.json, lockfile, 패키지 매니저, 스크립트, node 존재(PATH 보강) 감지 |
| `src/runner/static.ts` | 정적 서버 (Node 내장 http/fs.watch/직접 구현한 WebSocket 프레임). five-server 는 배포 금지 라이선스라 쓰지 않는다 |
| `src/runner/npm.ts` | NpmSession: install → dev → URL 감지, 자동 복구 재시도 |
| `src/runner/pty.ts` | Pseudoterminal + spawn(detached) + tree-kill/프로세스 그룹 종료 + 감시 프로세스 기동 |
| `src/runner/watchdog.ts` | dist/watchdog.js 로 따로 번들. 확장 호스트가 죽으면 dev 서버 트리를 정리 (창 닫기/강제 종료 대응) |
| `src/runner/commands.ts` | 패키지 매니저별 인자 구성, freePort |
| `src/runner/cssLocate.ts` | CSS 텍스트를 CSSOM 순서로 파싱해 규칙의 줄 번호를 찾는다. 인라인 <style> 은 내용 앞부분으로 대조 (런타임 주입 대비) |
| `src/runner/wsFrame.ts` | 클라이언트→서버 WebSocket 프레임 해석 (마스킹 텍스트/close/ping) |
| `src/lan.ts` | 휴대폰으로 보기: LAN IPv4 선택, 접속 확인, QR(qrcode-generator), 도구별 --host 인자 |
| `src/runner/url.ts` | localhost URL 정규식, ANSI 제거, UrlDetector ("Local:" 줄 우선) |
| `src/errors.ts` | 에러 매핑 테이블 (`ERROR_RULES`) 과 `classify()` |
| `src/l10n/ko.json` | 사용자 노출 문자열 전부 |

## 규칙

- TypeScript strict. 런타임 의존성은 `tree-kill`, `qrcode-generator` (둘 다 MIT, 번들 포함). 추가 시 이유를 커밋 메시지에 남기고, **라이선스가 MIT/BSD/Apache 계열인지 반드시 확인**한다 (five-server 는 배포 금지 라이선스였다)
- 사용자 노출 문자열은 전부 `src/l10n/ko.json`. 코드에 한국어 리터럴을 쓰지 않는다 (`t('key')` 사용)
- 런타임 코드는 전부 esbuild 로 번들한다 (`dist/extension.js`, `dist/watchdog.js`). vsix 에 node_modules 는 들어가지 않는다
- `errors.ts` 에 규칙을 추가하면 `test/unit/errors.test.ts` 와 `test/fixtures/` 에 재현 케이스를 함께 추가한다
- `src/errors.ts`, `src/runner/url.ts`, `src/runner/commands.ts`, `src/detect.ts` 는 `vscode` 모듈을 import 하지 않는다 (단위 테스트가 vscode 없이 돌아야 한다)
- Windows 를 항상 고려한다. spawn 은 `shell: true`, 종료는 `tree-kill`, PATH 키는 `Path` 일 수 있다
- 판단이 갈리면 "디자인과 학생이 이 화면을 보고 다음 행동을 알 수 있는가"로 결정한다
