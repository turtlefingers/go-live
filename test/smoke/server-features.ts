/**
 * 서버가 있어야만 동작하는 기능들을 실제로 검증한다.
 *   npm run smoke:server
 * - npm run dev 가 필요한 서버 기능: Express API, concurrently 풀스택(URL 선택), WebSocket, Next.js SSR/API
 * - 서버로 열어야 동작하는 프론트 기능: ES module, fetch, 한글 경로, MIME(.glb/.wasm), 리로드 신호, Vite HMR
 */
import * as fs from 'fs';
import * as path from 'path';
import { NpmSession } from '../../src/runner/npm';
import { ProcessTerminal } from '../../src/runner/pty';
import { StaticServer } from '../../src/runner/static';
import { resolveNodeEnv } from '../../src/detect';
import { GoLiveConfig } from '../../src/config';
import { portOf } from '../../src/runner/url';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const WebSocket = require('ws') as typeof import('ws');

const FIXTURES = path.resolve(__dirname, '../test/fixtures');
const SKIP_NEXT = process.argv.includes('--skip-next');
const config: GoLiveConfig = {
  staticPort: 5600, npmScript: '', packageManager: 'auto', alwaysInstall: false,
  browser: 'none', showTerminalOnStart: false, staticRoot: '', inspect: true, devtoolsWorkspace: true,
};

class MemoryMemento {
  private m = new Map<string, unknown>();
  keys() { return [...this.m.keys()]; }
  get<T>(k: string, d?: T): T | undefined { return (this.m.has(k) ? this.m.get(k) : d) as T | undefined; }
  async update(k: string, v: unknown) { this.m.set(k, v); }
}

let failures = 0;
const expect = (cond: boolean, msg: string) => { console.log(`  ${cond ? '✔' : '✘'} ${msg}`); if (!cond) { failures++; } };
const quiet = (s: string) => s.replace(/\r\n/g, '\n').split('\n').filter((l) => /Local|listening|running|error|Error|➜|http:\/\//.test(l)).join('\n');

async function startNpm(name: string, root: string) {
  console.log(`\n===== ${name} =====`);
  const node = await resolveNodeEnv();
  const pty = new ProcessTerminal();
  pty.onDidWrite((s) => { const q = quiet(s); if (q) { console.log('   │ ' + q.replace(/\n/g, '\n   │ ')); } });
  pty.open();
  const session = new NpmSession({
    root, config, workspaceState: new MemoryMemento(), env: { ...node.env, NEXT_TELEMETRY_DISABLED: '1' }, pty,
    onState: (s) => console.log(`  [state] ${s}`), notify: (m) => console.log(`  [notify] ${m}`),
  });
  const t0 = Date.now();
  const outcome = await session.start();
  console.log(`  [outcome] ${outcome.kind} ${outcome.kind === 'running' ? outcome.url : ''} (${Date.now() - t0}ms)`);
  return { outcome, session, pty };
}

/** 열린 소켓을 유지한 채 파일 변경 후 오는 메시지를 기다린다 */
function wsWatch(url: string, opts: { protocol?: string }) {
  const ws = opts.protocol ? new WebSocket(url, opts.protocol) : new WebSocket(url);
  const queue: string[] = [];
  const waiters: Array<(m: string) => void> = [];
  ws.on('message', (d) => { const m = d.toString(); const w = waiters.shift(); if (w) { w(m); } else { queue.push(m); } });
  const open = new Promise<void>((res, rej) => { ws.on('open', () => res()); ws.on('error', rej); });
  const next = (timeoutMs = 8000) => new Promise<string>((res, rej) => {
    if (queue.length) { return res(queue.shift()!); }
    const t = setTimeout(() => rej(new Error('ws message timeout')), timeoutMs);
    waiters.push((m) => { clearTimeout(t); res(m); });
  });
  return { open, next, close: () => ws.close(), send: (m: string) => ws.send(m) };
}

const touch = (file: string, mutate: (s: string) => string) => fs.writeFileSync(file, mutate(fs.readFileSync(file, 'utf8')));

(async () => {
  // ── A. 서버 기능 (npm run dev) ─────────────────────────────────────────
  {
    const { outcome, session } = await startNpm('express-api', path.join(FIXTURES, 'express-api'));
    if (outcome.kind === 'running' && outcome.url) {
      const hello = (await (await fetch(outcome.url + 'api/hello')).json()) as { from?: string };
      expect(hello.from === 'express', 'GET /api/hello → JSON');
      const echo = (await (await fetch(outcome.url + 'api/echo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"a":1}' })).json()) as { echo?: { a?: number } };
      expect(echo.echo?.a === 1, 'POST /api/echo → body 왕복');
      const html = await (await fetch(outcome.url)).text();
      expect(html.includes("fetch('/api/hello')"), '정적 index.html 서빙');
    } else { expect(false, 'express-api running'); }
    await session.stop();
  }

  {
    const { outcome, session } = await startNpm('fullstack-concurrently (백엔드 3100 먼저 → Vite Local 선택)', path.join(FIXTURES, 'fullstack-concurrently'));
    if (outcome.kind === 'running' && outcome.url) {
      expect(portOf(outcome.url) !== 3100, `선택된 URL 이 백엔드(3100)가 아님: ${outcome.url}`);
      const html = await (await fetch(outcome.url)).text();
      expect(html.includes('/main.js') && html.includes('@vite/client'), 'Vite 가 index.html 서빙 (HMR 클라이언트 주입)');
      const viaProxy = (await (await fetch(outcome.url + 'api/hello')).json()) as { from?: string };
      expect(viaProxy.from === 'backend', 'Vite proxy 로 /api → 백엔드 응답');
    } else { expect(false, 'fullstack running'); }
    await session.stop();
    const backendAlive = await fetch('http://localhost:3100/api/hello').then(() => true, () => false);
    expect(!backendAlive, 'Stop 후 concurrently 자식(백엔드 3100)까지 종료됨');
  }

  {
    const { outcome, session } = await startNpm('ws-chat', path.join(FIXTURES, 'ws-chat'));
    if (outcome.kind === 'running' && outcome.url) {
      const wsUrl = outcome.url.replace(/^http/, 'ws');
      const html = await (await fetch(outcome.url)).text();
      expect(html.includes('id="form"') && html.includes('공유 카운터'), '인터랙션 UI (채팅 폼 + 공유 카운터) 서빙');
      // 탭 두 개를 흉내: A 가 보낸 채팅과 카운터가 B 에도 도착해야 한다
      const a = wsWatch(wsUrl, {});
      const b = wsWatch(wsUrl, {});
      await Promise.all([a.open, b.open]);
      const welcomeA = JSON.parse(await a.next());
      expect(welcomeA.type === 'welcome', `A 연결 (welcome, id ${welcomeA.id})`);
      // presence 메시지들을 흘려보내고 채팅을 기다린다
      const until = async (sock: ReturnType<typeof wsWatch>, type: string) => { let m = JSON.parse(await sock.next()); while (m.type !== type) { m = JSON.parse(await sock.next()); } return m; };
      a.send(JSON.stringify({ type: 'chat', text: '안녕' }));
      const chatB = await until(b, 'chat');
      expect(chatB.text === '안녕' && chatB.from === welcomeA.id, 'A 의 채팅이 B 에 브로드캐스트');
      a.send(JSON.stringify({ type: 'count' }));
      const cntB = await until(b, 'counter');
      expect(cntB.counter === 1, `A 의 카운터 +1 이 B 에 반영 (${cntB.counter})`);
      a.close(); b.close();
    } else { expect(false, 'ws-chat running'); }
    await session.stop();
  }

  if (!SKIP_NEXT) {
    const { outcome, session } = await startNpm('next-api (SSR + API 라우트)', path.join(FIXTURES, 'next-api'));
    if (outcome.kind === 'running' && outcome.url) {
      const api = (await (await fetch(outcome.url + 'api/hello')).json()) as { from?: string };
      expect(api.from === 'next-api', 'GET /api/hello → JSON');
      const html = await (await fetch(outcome.url)).text();
      // React 는 텍스트와 표현식 사이에 <!-- --> 를 넣는다
      const ssr = /id="ssr"[^>]*>서버에서 렌더링됨: (<!-- -->)?\d{4}-\d{2}-\d{2}T/.test(html);
      if (!ssr) { console.log('   │ html:', html.slice(0, 600).replace(/\n/g, ' ')); }
      expect(ssr, 'getServerSideProps 로 SSR 된 HTML');
    } else { expect(false, 'next-api running'); }
    await session.stop();
  } else {
    console.log('\n===== next-api: --skip-next 로 건너뜀 =====');
  }

  // ── B. 서버로 열어야 동작하는 프론트 기능 (정적 서버) ─────────────────────
  {
    console.log('\n===== static-modules (정적 서버) =====');
    const root = path.join(FIXTURES, 'static-modules');
    const server = new StaticServer();
    const url = await server.start(root, '', config.staticPort);
    console.log('  [url]', url);
    const get = async (p: string) => { const r = await fetch(url + p); return { status: r.status, type: r.headers.get('content-type') ?? '', body: await r.text() }; };

    const html = await get('');
    expect(html.status === 200 && html.body.includes('type="module"') && html.body.includes('/__go-live/client.js'), 'index.html + 리로드 스크립트 주입');
    const mod = await get('main.js');
    expect(mod.status === 200 && /javascript/.test(mod.type), `ES module main.js (${mod.type})`);
    const lib = await get('lib.js');
    expect(lib.status === 200 && /javascript/.test(lib.type), `import 대상 lib.js (${lib.type})`);
    const json = await get('data.json');
    expect(json.status === 200 && /application\/json/.test(json.type) && JSON.parse(json.body).name === '디자인과', `fetch data.json (${json.type})`);
    const ko = await get(encodeURI('한글 폴더/노트.json'));
    expect(ko.status === 200 && JSON.parse(ko.body).text.includes('한글'), '한글 폴더/파일명 에셋');
    const koRaw = await fetch(url + '한글 폴더/노트.json').then((r) => r.status, () => 0);
    expect(koRaw === 200, '인코딩 안 한 한글 URL 도 200 (브라우저는 자동 인코딩)');
    const glb = await get(encodeURI('assets/모델.glb'));
    expect(glb.status === 200 && /model\/gltf-binary/.test(glb.type), `.glb MIME (${glb.type})`);
    const wasm = await get('assets/demo.wasm');
    expect(wasm.status === 200 && /application\/wasm/.test(wasm.type), `.wasm MIME (${wasm.type})`);
    const css = await get('style.css');
    expect(css.status === 200 && /text\/css/.test(css.type), `.css MIME (${css.type})`);

    const nf = await get('없는파일.html');
    expect(nf.status === 404 && nf.body.includes('파일을 찾을 수 없어요'), '404 는 한국어 안내 페이지');
    const listing = await get('assets/');
    expect(listing.status === 200 && listing.body.includes('모델.glb') && listing.body.includes('demo.wasm'), 'index.html 없는 폴더는 목록 표시');
    const client = await get('__go-live/client.js');
    expect(client.status === 200 && client.body.includes('refreshCss'), '리로드 클라이언트 스크립트');
    const rangeRes = await fetch(url + 'assets/demo.wasm', { headers: { Range: 'bytes=0-3' } });
    expect(rangeRes.status === 206 && rangeRes.headers.get('content-range') === 'bytes 0-3/8', `Range 요청 (video/audio 용) → ${rangeRes.status} ${rangeRes.headers.get('content-range')}`);
    const traversal = await fetch(url + '..%2F..%2Fpackage.json');
    expect(traversal.status === 404, '경로 탈출(../) 차단');

    // 저장 → 리로드 신호
    const sock = wsWatch(url.replace(/^http/, 'ws') + '__go-live/ws', {});
    await sock.open;
    const first = await sock.next();
    expect(first === 'connected', `리로드 소켓 연결 (${first})`);
    await new Promise((r) => setTimeout(r, 600));
    touch(path.join(root, 'main.js'), (s) => s + '\n// touched\n');
    const msgJs = await sock.next();
    expect(msgJs === 'reload', `main.js 저장 → "${msgJs}"`);
    touch(path.join(root, 'style.css'), (s) => s + '\n/* touched */\n');
    const msgCss = await sock.next();
    expect(msgCss === 'refreshcss', `style.css 저장 → "${msgCss}" (전체 리로드 없이 CSS 교체)`);
    sock.close();
    touch(path.join(root, 'main.js'), (s) => s.replace(/\n\/\/ touched\n$/, ''));
    touch(path.join(root, 'style.css'), (s) => s.replace(/\n\/\* touched \*\/\n$/, ''));
    await server.stop();
    const alive = await fetch(url).then(() => true, () => false);
    expect(!alive, '정적 서버 stop 후 포트 닫힘');
  }

  // ── C. Vite HMR ──────────────────────────────────────────────────────────
  {
    const root = path.join(FIXTURES, 'vite-vanilla');
    const { outcome, session } = await startNpm('vite-vanilla HMR', root);
    if (outcome.kind === 'running' && outcome.url) {
      const sock = wsWatch(outcome.url.replace(/^http/, 'ws'), { protocol: 'vite-hmr' });
      await sock.open;
      const hello = JSON.parse(await sock.next());
      expect(hello.type === 'connected', `HMR 소켓 연결 (${hello.type})`);
      // 브라우저처럼 모듈을 한 번 로드해야 Vite 가 해당 모듈 변경을 추적한다
      await fetch(outcome.url + 'main.js');
      await new Promise((r) => setTimeout(r, 500));
      touch(path.join(root, 'main.js'), (s) => s + '\n// hmr touch\n');
      let msg = JSON.parse(await sock.next());
      while (msg.type === 'ping') { msg = JSON.parse(await sock.next()); }
      expect(msg.type === 'update' || msg.type === 'full-reload', `main.js 저장 → HMR "${msg.type}"`);
      sock.close();
      touch(path.join(root, 'main.js'), (s) => s.replace(/\n\/\/ hmr touch\n$/, ''));
    } else { expect(false, 'vite running'); }
    await session.stop();
  }

  console.log(`\n${failures === 0 ? 'ALL PASSED' : failures + ' FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
