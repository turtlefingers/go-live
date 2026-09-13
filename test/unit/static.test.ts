import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as net from 'net';
import * as crypto from 'crypto';
import { StaticServer, resolveStaticRoot, isInside, InspectEvent } from '../../src/runner/static';
import { encodeMaskedText, decodeFrames } from '../../src/runner/wsFrame';

function project(): { root: string; outside: string } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'go-live-static-'));
  const root = path.join(base, 'proj');
  const outside = path.join(base, 'outside');
  fs.mkdirSync(path.join(root, 'sub'), { recursive: true });
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(root, 'index.html'), '<h1>ok</h1>');
  fs.writeFileSync(path.join(root, 'sub', 'a.txt'), 'inside');
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'SECRET');
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'link-out.txt'));
  fs.symlinkSync(outside, path.join(root, 'link-out-dir'));
  fs.symlinkSync(path.join(root, 'sub', 'a.txt'), path.join(root, 'link-in.txt'));
  return { root, outside };
}

test('resolveStaticRoot 는 워크스페이스 밖을 거부한다 (보안 결함 2)', () => {
  const ws = path.join(os.tmpdir(), 'ws');
  assert.equal(resolveStaticRoot(ws, ''), path.resolve(ws));
  assert.equal(resolveStaticRoot(ws, 'src'), path.join(path.resolve(ws), 'src'));
  assert.equal(resolveStaticRoot(ws, './public/'), path.join(path.resolve(ws), 'public'));
  assert.equal(resolveStaticRoot(ws, '..'), undefined);
  assert.equal(resolveStaticRoot(ws, '../../etc'), undefined);
  assert.equal(resolveStaticRoot(ws, 'src/../..'), undefined);
  assert.equal(resolveStaticRoot(ws, '/etc'), undefined);
  assert.equal(isInside('/a/b', '/a/bc'), false);
});

test('심볼릭 링크로 프로젝트 밖을 가리키면 404, 안을 가리키면 200 (보안 결함 1)', async () => {
  const { root } = project();
  const s = new StaticServer();
  const url = await s.start(root, '', 0);
  try {
    const status = async (p: string) => (await fetch(url + p)).status;
    assert.equal(await status(''), 200);
    assert.equal(await status('sub/a.txt'), 200);
    assert.equal(await status('link-in.txt'), 200);
    assert.equal(await status('link-out.txt'), 404);
    assert.equal(await status('link-out-dir/secret.txt'), 404);
    assert.equal(await status('link-out-dir/'), 404);
    assert.equal(await status('..%2Fsecret.txt'), 404);
    assert.equal(await status('%2e%2e/outside/secret.txt'), 404);
    const body = await (await fetch(url + 'link-out.txt')).text();
    assert.ok(!body.includes('SECRET'));
  } finally {
    await s.stop();
  }
});

test('start 는 워크스페이스 밖 staticRoot 를 거부한다', async () => {
  const { root } = project();
  const s = new StaticServer();
  await assert.rejects(() => s.start(root, '..', 0));
});

/** 핸드셰이크 뒤 남은 바이트까지 프레임으로 읽는 간단한 클라이언트 */
class WsClient {
  private buf: Buffer = Buffer.alloc(0);
  private queue: string[] = [];
  private waiters: Array<(m: string) => void> = [];
  constructor(readonly sock: net.Socket) {
    sock.on('data', (d) => this.feed(d));
  }
  feed(d: Buffer): void {
    const decoded = decodeFrames(Buffer.concat([this.buf, d]));
    this.buf = Buffer.from(decoded.rest);
    for (const m of decoded.messages) {
      const w = this.waiters.shift();
      if (w) { w(m); } else { this.queue.push(m); }
    }
  }
  /** 리로드 신호는 건너뛰고 다음 메시지를 기다린다 */
  next(timeoutMs = 3000): Promise<string> {
    return new Promise((resolve, reject) => {
      const take = (m: string) => (m === 'reload' || m === 'refreshcss' ? this.next(timeoutMs).then(resolve, reject) : resolve(m));
      if (this.queue.length) { return take(this.queue.shift()!); }
      const t = setTimeout(() => reject(new Error('timeout')), timeoutMs);
      this.waiters.push((m) => { clearTimeout(t); take(m); });
    });
  }
  send(text: string): void { this.sock.write(encodeMaskedText(text)); }
  close(): void { this.sock.destroy(); }
}

function wsConnect(url: string): Promise<WsClient> {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const sock = net.connect(Number(u.port), '127.0.0.1', () => {
      const key = crypto.randomBytes(16).toString('base64');
      sock.write(`GET /__go-live/ws HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    });
    sock.once('data', (d) => {
      const text = d.toString('latin1');
      if (!text.startsWith('HTTP/1.1 101')) { return reject(new Error(text)); }
      const client = new WsClient(sock);
      const end = text.indexOf('\r\n\r\n');
      const rest = d.subarray(end + 4);
      if (rest.length) { client.feed(rest); } // 같은 청크에 'connected' 프레임이 붙어 올 수 있다
      resolve(client);
    });
    sock.on('error', reject);
  });
}

test('devtools.json 은 uuid 가 있을 때만 서빙되고 실제 루트 경로를 준다 (옵션 A)', async () => {
  const { root } = project();
  const s = new StaticServer();
  const url = await s.start(root, '', 0, { devtoolsUuid: 'abc-123', inspect: false });
  try {
    const r = await fetch(url + '.well-known/appspecific/com.chrome.devtools.json');
    assert.equal(r.status, 200);
    const j = (await r.json()) as { workspace: { root: string; uuid: string } };
    assert.equal(j.workspace.uuid, 'abc-123');
    assert.equal(j.workspace.root, fs.realpathSync(root));
  } finally { await s.stop(); }
  const s2 = new StaticServer();
  const url2 = await s2.start(root, '', 0, {});
  try { assert.equal((await fetch(url2 + '.well-known/appspecific/com.chrome.devtools.json')).status, 404); } finally { await s2.stop(); }
});

test('Alt+클릭 검사: 외부 CSS 와 인라인 <style> 규칙을 파일:줄 로 찾아 에디터에 알린다', async () => {
  const { root } = project();
  fs.writeFileSync(path.join(root, 'style.css'), '/* c */\nbody { margin: 0 }\n@media (min-width: 1px) {\n  .hero h1 { color: red }\n}\n');
  fs.writeFileSync(path.join(root, 'index.html'), '<html><head>\n<style>\n  h1 { font-weight: 700 }\n</style>\n<link rel="stylesheet" href="style.css"></head><body><div class="hero"><h1>x</h1></div></body></html>');
  const s = new StaticServer();
  const url = await s.start(root, '', 0, { inspect: true });
  const events: InspectEvent[] = [];
  s.on('inspect', (e: InspectEvent) => events.push(e));
  try {
    const sock = await wsConnect(url);
    assert.equal(await sock.next(), 'connected');
    sock.send(JSON.stringify({ type: 'inspect', page: '/', element: 'h1', rules: [
      { sheet: '/style.css', path: [1, 0], selector: '.hero h1' },
      { styleIndex: 0, path: [0], selector: 'h1' },
      { sheet: '/../../etc/passwd', path: [0], selector: 'x' },
    ] }));
    const reply = JSON.parse(await sock.next());
    assert.deepEqual(reply, { type: 'inspect-result', ok: true, file: 'style.css', line: 4 });
    assert.equal(events.length, 1);
    assert.deepEqual(events[0].candidates.map((c) => [path.basename(c.file), c.line, c.selector]), [
      ['style.css', 4, '.hero h1'],
      ['index.html', 3, 'h1'],
    ]);
    sock.close();
  } finally { await s.stop(); }
});

test('inspect 옵션이 꺼져 있으면 무시한다', async () => {
  const { root } = project();
  const s = new StaticServer();
  const url = await s.start(root, '', 0, { inspect: false });
  let fired = false;
  s.on('inspect', () => (fired = true));
  try {
    const sock = await wsConnect(url);
    await sock.next();
    sock.send(JSON.stringify({ type: 'inspect', page: '/', element: 'h1', rules: [{ sheet: '/x.css', path: [0], selector: 'h1' }] }));
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(fired, false);
    sock.close();
  } finally { await s.stop(); }
});
