# 마켓플레이스 공개 절차

Go Live 는 두 곳에 올려야 한다. **Antigravity 는 Open VSX 에서 확장을 받는다** (product.json 의 extensionsGallery 가 open-vsx.org). VS Code 는 Microsoft Marketplace.

## 0. 공개 전 체크

- [ ] GitHub 저장소 생성 후 `package.json` 의 `repository`/`homepage`/`bugs` URL 을 실제 주소로 맞춘다 (현재 `github.com/turtlefingers/go-live` 가정)
- [ ] `publisher` 이름(`doodlefingers`)이 두 마켓플레이스 모두에서 사용 가능한지 확인
- [ ] `npm test && npm run smoke && npm run smoke:server && npm run smoke:crash` 전부 통과
- [ ] `npm run vsix` 로 만든 vsix 를 깨끗한 계정의 macOS / Windows 에 설치해 M1(정적)·M2(Vite) 시나리오 확인
- [ ] README 의 감사의 말이 유지돼 있는지, 스크린샷을 넣을지 결정
- [ ] 라이선스: 런타임 코드는 MIT(tree-kill 포함). five-server 코드는 포함돼 있지 않아야 한다 (`unzip -l go-live-*.vsix | grep five` 가 비어야 함)

## 1. Open VSX (Antigravity, Cursor, VSCodium 용) — 우선

1. https://open-vsx.org 에 GitHub 계정으로 로그인
2. 프로필 → Settings → **Access Tokens** → 토큰 생성 (직접 발급받아 보관, Claude 에게 넘기지 않는다)
3. **네임스페이스 생성** (publisher 와 같은 이름): 아래 명령을 터미널에서 직접 실행
   ```bash
   npx ovsx create-namespace doodlefingers -p <토큰>
   ```
4. 게시
   ```bash
   npm run vsix
   npx ovsx publish go-live-0.1.0.vsix -p <토큰>
   ```
5. 확인: https://open-vsx.org/extension/doodlefingers/go-live — Antigravity 확장 패널에서 "Go Live" 검색되면 성공

## 2. Microsoft Marketplace (VS Code 용)

1. https://marketplace.visualstudio.com/manage 에서 Microsoft 계정으로 로그인 → **Create publisher** (ID: `doodlefingers`)
2. https://dev.azure.com 에서 아무 조직이나 만든 뒤 User settings → **Personal Access Tokens** → New Token
   - Organization: **All accessible organizations**
   - Scopes: Custom defined → **Marketplace: Manage**
3. 게시
   ```bash
   npx @vscode/vsce login doodlefingers     # PAT 입력
   npx @vscode/vsce publish                  # package.json 의 version 으로 게시
   ```
4. 확인: https://marketplace.visualstudio.com/items?itemName=doodlefingers.go-live (반영까지 몇 분 걸린다)

## 3. 버전 올리기

```bash
npm version patch        # 0.1.0 → 0.1.1 (package.json 갱신)
npm run vsix
npx ovsx publish go-live-0.1.1.vsix -p <토큰>
npx @vscode/vsce publish
```

## 주의

- 토큰과 PAT 는 절대 저장소에 커밋하지 않는다. `.gitignore` 에 `.env*` 를 추가해 둔다
- 이름 "Go Live" 는 마켓플레이스에서 유일하지 않을 수 있다. 검색 노출은 `displayName` 보다 `description` 과 `keywords`("live server", "vite") 가 좌우한다
- Open VSX 는 `LICENSE` 파일이 없으면 게시를 거부한다 (현재 MIT LICENSE 포함)
