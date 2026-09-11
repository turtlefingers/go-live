/**
 * 정적 모드 서버.
 *
 * 원래 명세는 five-server 위임이었지만, five-server 는 모든 버전이 "배포 금지(지인 범위 공유만 허용)"
 * 자체 라이선스라 .vsix / 마켓플레이스 배포에 포함할 수 없다. 그래서 필요한 최소 기능만 Node 내장 API 로 구현한다.
 *
 * - 정적 파일 서빙 (index.html, MIME, Range, 한글 경로, CORS)
 * - HTML 에 리로드 클라이언트 주입
 * - fs.watch(recursive) 로 변경 감지 → WebSocket 으로 reload / refreshcss 브로드캐스트
 * - WebSocket 은 서버→클라이언트 텍스트 프레임만 필요하므로 핸드셰이크와 프레임을 직접 처리한다
 *
 * 설계는 ritwickdey/vscode-live-server 와 tapio/live-server(MIT) 의 동작을 따른다.
 */
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import * as crypto from 'crypto';
import { t } from '../l10n';

export const WS_PATH = '/__go-live/ws';
export const CLIENT_PATH = '/__go-live/client.js';
const INJECT_TAG = `<script src="${CLIENT_PATH}" data-go-live></script>`;
const WATCH_DEBOUNCE_MS = 100;
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const IGNORED_DIRS = new Set(['node_modules', '.git', '.svn', '.hg', '.DS_Store']);

/** 웹 수업에서 쓰는 형식 위주. 없으면 application/octet-stream */
const MIME: Record<string, string> = {
  html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript',
  json: 'application/json', map: 'application/json', xml: 'application/xml', txt: 'text/plain', md: 'text/markdown',
  csv: 'text/csv', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon', bmp: 'image/bmp', mp3: 'audio/mpeg', wav: 'audio/wav',
  ogg: 'audio/ogg', m4a: 'audio/mp4', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', pdf: 'application/pdf',
  wasm: 'application/wasm', glb: 'model/gltf-binary', gltf: 'model/gltf+json', obj: 'text/plain', mtl: 'text/plain',
  zip: 'application/zip', webmanifest: 'application/manifest+json',
};
const TEXT_TYPES = /^(text\/|application\/(json|javascript|xml|manifest))/;

export function contentTypeFor(file: string): string {
  const ext = path.extname(file).slice(1).toLowerCase();
  const type = MIME[ext] ?? 'application/octet-stream';
  return TEXT_TYPES.test(type) ? `${type}; charset=utf-8` : type;
}

/** 브라우저에 주입되는 리로드 클라이언트 */
const CLIENT_SCRIPT = `(() => {
  const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '${WS_PATH}';
  let retries = 0;
  const refreshCss = () => {
    document.querySelectorAll('link[rel="stylesheet"]').forEach((link) => {
      const u = new URL(link.href);
      u.searchParams.set('_go_live', String(Date.now()));
      const next = link.cloneNode();
      next.href = u.toString();
      next.onload = () => link.remove();
      link.after(next);
    });
  };
  const connect = () => {
    const ws = new WebSocket(url);
    ws.onopen = () => { if (retries > 0) { location.reload(); } retries = 0; };
    ws.onmessage = (e) => {
      if (e.data === 'reload') { location.reload(); }
      else if (e.data === 'refreshcss') { refreshCss(); }
    };
    ws.onclose = () => { setTimeout(connect, Math.min(500 * 2 ** retries, 5000)); retries += 1; };
  };
  connect();
})();
`;

/**
 * staticRoot 설정을 워크스페이스 기준으로 해석한다. 워크스페이스 밖이면 undefined.
 * (설정 설명이 "루트 하위 경로"이므로 `..` 로 상위 폴더를 서빙하는 것은 허용하지 않는다)
 */
export function resolveStaticRoot(workspace: string, subRoot: string): string | undefined {
  const ws = path.resolve(workspace);
  const target = path.resolve(ws, subRoot.trim() || '.');
  return isInside(ws, target) ? target : undefined;
}

/** target 이 base 와 같거나 base 아래에 있으면 true (문자열 기준) */
export function isInside(base: string, target: string): boolean {
  return target === base || target.startsWith(base + path.sep);
}

export class StaticServer {
  private server: http.Server | undefined;
  private root = '';
  /** 심볼릭 링크를 푼 실제 루트. 링크로 프로젝트 밖을 가리키는 것을 막는 기준 */
  private rootReal = '';
  private readonly sockets = new Set<net.Socket>();
  private readonly clients = new Set<net.Socket>();
  private watcher: fs.FSWatcher | undefined;
  private debounce: NodeJS.Timeout | undefined;
  private pendingCssOnly = true;

  get isRunning(): boolean {
    return this.server !== undefined;
  }

  /**
   * 서버를 띄우고 localhost URL 을 돌려준다. 포트가 사용 중이면 빈 포트를 고른다.
   * @param workspace 워크스페이스 루트 (절대 경로)
   * @param subRoot   서빙할 하위 폴더 (상대 경로, 빈 문자열이면 루트)
   */
  async start(workspace: string, subRoot: string, port: number): Promise<string> {
    const root = resolveStaticRoot(workspace, subRoot);
    if (!root) {
      throw new Error(t('msg.staticRootOutside', subRoot));
    }
    this.root = root;
    this.rootReal = fs.realpathSync(root);
    const server = http.createServer((req, res) => this.handle(req, res));
    server.on('upgrade', (req, socket) => this.handleUpgrade(req, socket as net.Socket));
    server.on('connection', (socket) => {
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
    });
    this.server = server;

    const actualPort = await this.listen(server, port);
    this.startWatch();
    return `http://localhost:${actualPort}/`;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (this.debounce) {
      clearTimeout(this.debounce);
    }
    this.watcher?.close();
    this.watcher = undefined;
    for (const c of this.clients) {
      try {
        c.end(Buffer.from([0x88, 0x00])); // close frame
      } catch {
        /* ignore */
      }
      c.destroy();
    }
    this.clients.clear();
    for (const s of this.sockets) {
      s.destroy();
    }
    this.sockets.clear();
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  // ── listen ────────────────────────────────────────────────────────────

  private listen(server: http.Server, port: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const onError = (e: NodeJS.ErrnoException) => {
        if (e.code === 'EADDRINUSE' && port !== 0) {
          server.removeListener('error', onError);
          this.listen(server, 0).then(resolve, reject);
        } else {
          reject(e);
        }
      };
      server.once('error', onError);
      server.listen(port, () => {
        server.removeListener('error', onError);
        const addr = server.address();
        resolve(typeof addr === 'object' && addr ? addr.port : port);
      });
    });
  }

  // ── HTTP ──────────────────────────────────────────────────────────────

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache');
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    } catch {
      return this.notFound(res, req.url ?? '/');
    }
    if (pathname === CLIENT_PATH) {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      return void res.end(CLIENT_SCRIPT);
    }

    // 경로 탈출 방지 1: 문자열 기준 (../ 등)
    const file = path.normalize(path.join(this.root, pathname));
    if (!isInside(this.root, file)) {
      return this.notFound(res, pathname);
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(file);
      // 경로 탈출 방지 2: 심볼릭 링크를 푼 실제 경로도 프로젝트 안이어야 한다
      if (!isInside(this.rootReal, fs.realpathSync(file))) {
        return this.notFound(res, pathname);
      }
    } catch {
      return this.notFound(res, pathname);
    }

    if (stat.isDirectory()) {
      if (!pathname.endsWith('/')) {
        res.writeHead(301, { Location: encodeURI(pathname) + '/' });
        return void res.end();
      }
      const index = path.join(file, 'index.html');
      if (fs.existsSync(index)) {
        return this.sendHtml(res, index);
      }
      return this.sendListing(res, file, pathname);
    }

    if (/\.html?$/i.test(file)) {
      return this.sendHtml(res, file);
    }
    this.sendFile(req, res, file, stat);
  }

  private sendHtml(res: http.ServerResponse, file: string): void {
    let html = fs.readFileSync(file, 'utf8');
    const idx = html.search(/<\/body\s*>/i);
    html = idx >= 0 ? html.slice(0, idx) + INJECT_TAG + html.slice(idx) : html + INJECT_TAG;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  }

  private sendFile(req: http.IncomingMessage, res: http.ServerResponse, file: string, stat: fs.Stats): void {
    const type = contentTypeFor(file);
    res.setHeader('Accept-Ranges', 'bytes');
    // <video>/<audio> 는 Range 요청이 필요하다 (Safari)
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    if (range && stat.size > 0) {
      let start = range[1] ? Number(range[1]) : NaN;
      let end = range[2] ? Number(range[2]) : NaN;
      if (Number.isNaN(start)) {
        start = Math.max(0, stat.size - end);
        end = stat.size - 1;
      } else if (Number.isNaN(end) || end >= stat.size) {
        end = stat.size - 1;
      }
      if (start > end || start >= stat.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
        return void res.end();
      }
      res.writeHead(206, {
        'Content-Type': type,
        'Content-Length': end - start + 1,
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      });
      return void fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size });
    if (req.method === 'HEAD') {
      return void res.end();
    }
    fs.createReadStream(file).pipe(res);
  }

  private sendListing(res: http.ServerResponse, dir: string, pathname: string): void {
    const entries = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => !IGNORED_DIRS.has(e.name))
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name, 'ko'));
    const items = entries
      .map((e) => {
        const name = e.name + (e.isDirectory() ? '/' : '');
        return `<li><a href="${encodeURI(name)}">${escapeHtml(name)}</a></li>`;
      })
      .join('\n');
    const up = pathname !== '/' ? `<li><a href="../">../</a></li>` : '';
    const body = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${escapeHtml(t('static.dirTitle', pathname))}</title>
<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem}li{margin:.25rem 0}</style></head>
<body><h1>${escapeHtml(t('static.dirTitle', pathname))}</h1><p>${escapeHtml(t('static.dirHint'))}</p><ul>${up}${items}</ul>${INJECT_TAG}</body></html>`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(body);
  }

  private notFound(res: http.ServerResponse, pathname: string): void {
    const body = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>404</title>
<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:3rem auto;padding:0 1rem}code{background:#eee;padding:.1rem .3rem}</style></head>
<body><h1>${escapeHtml(t('static.notFound.title'))}</h1><p>${escapeHtml(t('static.notFound.detail', pathname))}</p><p><a href="/">/</a></p>${INJECT_TAG}</body></html>`;
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(body);
  }

  // ── WebSocket (서버 → 클라이언트 텍스트 프레임만) ──────────────────────

  private handleUpgrade(req: http.IncomingMessage, socket: net.Socket): void {
    const key = req.headers['sec-websocket-key'];
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (pathname !== WS_PATH || typeof key !== 'string') {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }
    const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    this.clients.add(socket);
    socket.on('data', (buf: Buffer) => {
      const opcode = buf[0] & 0x0f;
      if (opcode === 0x8) {
        // close → 응답 후 종료
        try {
          socket.end(Buffer.from([0x88, 0x00]));
        } catch {
          /* ignore */
        }
      } else if (opcode === 0x9) {
        // ping → pong (클라이언트 프레임은 마스킹돼 있지만 페이로드는 필요 없다)
        socket.write(Buffer.from([0x8a, 0x00]));
      }
    });
    const drop = () => this.clients.delete(socket);
    socket.on('close', drop);
    socket.on('error', drop);
    socket.on('end', drop);
    this.sendText(socket, 'connected');
  }

  private sendText(socket: net.Socket, text: string): void {
    const payload = Buffer.from(text, 'utf8');
    const header =
      payload.length < 126
        ? Buffer.from([0x81, payload.length])
        : Buffer.from([0x81, 126, (payload.length >> 8) & 0xff, payload.length & 0xff]);
    try {
      socket.write(Buffer.concat([header, payload]));
    } catch {
      this.clients.delete(socket);
    }
  }

  /** 모든 브라우저에 메시지를 보낸다 */
  broadcast(message: 'reload' | 'refreshcss'): void {
    for (const c of this.clients) {
      this.sendText(c, message);
    }
  }

  // ── 파일 감시 ─────────────────────────────────────────────────────────

  private startWatch(): void {
    const onChange = (_event: string, filename: string | Buffer | null) => {
      const name = filename ? filename.toString() : '';
      const parts = name.split(/[\\/]/);
      if (parts.some((p) => IGNORED_DIRS.has(p) || p.startsWith('.'))) {
        return;
      }
      if (!/\.css$/i.test(name)) {
        this.pendingCssOnly = false;
      }
      if (this.debounce) {
        clearTimeout(this.debounce);
      }
      this.debounce = setTimeout(() => {
        this.broadcast(this.pendingCssOnly ? 'refreshcss' : 'reload');
        this.pendingCssOnly = true;
      }, WATCH_DEBOUNCE_MS);
    };
    try {
      this.watcher = fs.watch(this.root, { recursive: true }, onChange);
    } catch {
      // 오래된 Linux 등 recursive 미지원 → 루트만 감시
      try {
        this.watcher = fs.watch(this.root, onChange);
      } catch {
        this.watcher = undefined;
      }
    }
    this.watcher?.on('error', () => undefined);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}
