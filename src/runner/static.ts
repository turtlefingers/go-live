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
import { EventEmitter } from 'events';
import { t } from '../l10n';
import { decodeFrames } from './wsFrame';
import { parseCssBlocks, findBlockByPath, locateInlineRule } from './cssLocate';

export const WS_PATH = '/__go-live/ws';
export const CLIENT_PATH = '/__go-live/client.js';
/** Chrome DevTools 자동 워크스페이스 연결 (Chromium 135+). 페이지가 localhost 일 때만 요청한다 */
export const DEVTOOLS_JSON_PATH = '/.well-known/appspecific/com.chrome.devtools.json';
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

/** 브라우저에서 보내는 요소 검사 요청 */
export interface InspectRule {
  /** 외부 시트의 URL 경로 (예: /css/style.css). 인라인 <style> 이면 undefined */
  sheet?: string;
  /** 인라인 <style> 의 문서 내 순서 */
  styleIndex?: number;
  /** 인라인 <style> 내용 앞부분. 런타임에 끼어든 <style> 때문에 순서가 어긋나도 찾기 위해 */
  styleText?: string;
  /** CSSOM 규칙 경로 */
  path: number[];
  selector: string;
}

export interface InspectRequest {
  page: string;
  element: string;
  rules: InspectRule[];
}

/** 에디터로 넘길 결과 */
export interface InspectCandidate {
  file: string;
  line: number;
  selector: string;
}

export interface InspectEvent {
  element: string;
  candidates: InspectCandidate[];
}

export interface StaticServerOptions {
  /** DevTools 워크스페이스 연결용 uuid. 없으면 devtools.json 을 서빙하지 않는다 */
  devtoolsUuid?: string;
  /** Alt+클릭 요소 검사 → 에디터 점프 */
  inspect?: boolean;
  /** 바인딩 주소. 기본 127.0.0.1 (이 컴퓨터만). '0.0.0.0' 이면 같은 네트워크의 기기(휴대폰)에서도 접근 */
  host?: '127.0.0.1' | '0.0.0.0';
  /** Access-Control-Allow-Origin: * 를 붙일지. 기본 false */
  cors?: boolean;
}

/** Host 헤더가 이 서버를 가리키는지 확인한다 (DNS 리바인딩 방지). LAN 모드에서는 사설 대역도 허용 */
export function isAllowedHost(hostHeader: string | undefined, lan: boolean): boolean {
  if (!hostHeader) {
    return false;
  }
  const host = hostHeader.replace(/:\d+$/, '').replace(/^\[(.*)\]$/, '$1').toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost')) {
    return true;
  }
  if (!lan) {
    return false;
  }
  return (
    /^10\.\d+\.\d+\.\d+$/.test(host) ||
    /^192\.168\.\d+\.\d+$/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(host) ||
    /^169\.254\.\d+\.\d+$/.test(host) ||
    host.endsWith('.local') ||
    /^f[cd][0-9a-f]{2}:/.test(host) ||
    /^fe80:/.test(host)
  );
}

/** 숨김 파일/폴더(.env, .git, .vscode …)는 서빙하지 않는다 */
export function hasHiddenSegment(pathname: string): boolean {
  return pathname.split('/').some((seg) => seg.length > 1 && seg.startsWith('.'));
}

/** 브라우저에 주입되는 클라이언트: 리로드 + (옵션) Alt+클릭 검사 */
function clientScript(opts: StaticServerOptions): string {
  const msgs = JSON.stringify({
    // t() 가 {0} 을 비워 버리므로 자리표시자를 남겨 클라이언트에서 채운다
    opened: t('inspect.opened', '__FILE__'),
    none: t('inspect.none'),
    hint: t('inspect.hint'),
  });
  return `(() => {
  const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '${WS_PATH}';
  const INSPECT = ${opts.inspect ? 'true' : 'false'};
  const MSG = ${msgs};
  let ws = null;
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
  let toastTimer = null;
  const toast = (text, ok) => {
    let el = document.getElementById('__go-live-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = '__go-live-toast';
      el.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;padding:10px 16px;border-radius:12px;font:14px system-ui,sans-serif;color:#F5F5F5;background:#1E1E1E;box-shadow:0 6px 24px rgba(0,0,0,.25);pointer-events:none;transition:opacity .2s';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.style.background = ok ? '#1E1E1E' : '#B3261E';
    el.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.style.opacity = '0'; }, 2200);
  };
  const connect = () => {
    ws = new WebSocket(url);
    ws.onopen = () => { if (retries > 0) { location.reload(); } retries = 0; };
    ws.onmessage = (e) => {
      if (e.data === 'reload') { location.reload(); return; }
      if (e.data === 'refreshcss') { refreshCss(); return; }
      if (typeof e.data === 'string' && e.data[0] === '{') {
        try {
          const m = JSON.parse(e.data);
          if (m.type === 'inspect-result') {
            toast(m.ok ? MSG.opened.replace('__FILE__', m.file + ':' + m.line) : MSG.none, m.ok);
          }
        } catch {}
      }
    };
    ws.onclose = () => { setTimeout(connect, Math.min(500 * 2 ** retries, 5000)); retries += 1; };
  };
  connect();

  if (!INSPECT) { return; }
  // ── Alt+클릭 요소 검사: 적용된 CSS 규칙을 찾아 서버(에디터)로 보낸다 ──
  const specificity = (sel) => {
    const s = sel.replace(/:not\\(([^)]*)\\)/g, '$1');
    const ids = (s.match(/#[\\w-]+/g) || []).length;
    const cls = (s.match(/\\.[\\w-]+|\\[[^\\]]+\\]|:(?!:)[\\w-]+(\\([^)]*\\))?/g) || []).length;
    const tags = (s.match(/(^|[\\s>+~])[a-zA-Z][\\w-]*|::[\\w-]+/g) || []).length;
    return ids * 10000 + cls * 100 + tags;
  };
  const describe = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.classList.length ? '.' + [...el.classList].slice(0, 3).join('.') : '');
  const collect = (el) => {
    const out = [];
    const styles = [...document.querySelectorAll('style')];
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; } // 다른 출처(CDN) 시트는 읽을 수 없다
      const sheetPath = sheet.href ? new URL(sheet.href).pathname : undefined;
      const styleIndex = sheet.href ? undefined : styles.indexOf(sheet.ownerNode);
      const styleText = sheet.href ? undefined : (sheet.ownerNode.textContent || '').trim().slice(0, 160);
      const walk = (list, path) => {
        for (let i = 0; i < list.length; i++) {
          const r = list[i];
          // 스타일 규칙도 CSS 중첩 때문에 cssRules 를 갖는다. selectorText 유무로 먼저 가른다
          if (!r.selectorText) {
            if (r.cssRules && r.type !== CSSRule.KEYFRAMES_RULE) { walk(r.cssRules, [...path, i]); }
            continue;
          }
          for (const part of r.selectorText.split(',')) {
            let hit = false;
            try { hit = el.matches(part.trim()); } catch {}
            if (hit) { out.push({ sheet: sheetPath, styleIndex, styleText, path: [...path, i], selector: r.selectorText, spec: specificity(part), order: out.length }); break; }
          }
        }
      };
      walk(rules, []);
    }
    out.sort((a, b) => b.spec - a.spec || b.order - a.order);
    return out.slice(0, 20).map(({ spec, order, ...rest }) => rest);
  };
  const flash = (el) => {
    const prev = el.style.outline;
    el.style.outline = '2px solid #3DDC84';
    setTimeout(() => { el.style.outline = prev; }, 600);
  };
  document.addEventListener('click', (e) => {
    if (!e.altKey || !(e.target instanceof Element)) { return; }
    e.preventDefault();
    e.stopPropagation();
    const el = e.target;
    flash(el);
    if (!ws || ws.readyState !== 1) { return; }
    ws.send(JSON.stringify({ type: 'inspect', page: location.pathname, element: describe(el), rules: collect(el) }));
  }, true);
  console.info('[Go Live] ' + MSG.hint);
})();
`;
}

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

export class StaticServer extends EventEmitter {
  private server: http.Server | undefined;
  private root = '';
  private options: StaticServerOptions = {};
  private client = '';
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
  async start(workspace: string, subRoot: string, port: number, options: StaticServerOptions = {}): Promise<string> {
    this.options = options;
    this.client = clientScript(options);
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

    const actualPort = await this.listen(server, port, options.host ?? '127.0.0.1');
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

  private listen(server: http.Server, port: number, host: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const onError = (e: NodeJS.ErrnoException) => {
        if (e.code === 'EADDRINUSE' && port !== 0) {
          server.removeListener('error', onError);
          this.listen(server, 0, host).then(resolve, reject);
        } else {
          reject(e);
        }
      };
      server.once('error', onError);
      server.listen(port, host, () => {
        server.removeListener('error', onError);
        const addr = server.address();
        resolve(typeof addr === 'object' && addr ? addr.port : port);
      });
    });
  }

  // ── HTTP ──────────────────────────────────────────────────────────────

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (!isAllowedHost(req.headers.host, this.options.host === '0.0.0.0')) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      return void res.end('Forbidden');
    }
    if (this.options.cors) {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Cache-Control', 'no-cache');
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    } catch {
      return this.notFound(res, req.url ?? '/');
    }
    if (pathname === CLIENT_PATH) {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      return void res.end(this.client);
    }
    if (pathname === DEVTOOLS_JSON_PATH) {
      if (!this.options.devtoolsUuid) {
        return this.notFound(res, pathname);
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return void res.end(JSON.stringify({ workspace: { root: this.rootReal, uuid: this.options.devtoolsUuid } }));
    }
    if (hasHiddenSegment(pathname)) {
      return this.notFound(res, pathname);
    }

    const resolved = this.resolveFile(pathname);
    if (!resolved) {
      return this.notFound(res, pathname);
    }
    const { file, stat } = resolved;

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

  /** URL 경로를 프로젝트 안의 파일로 해석한다. 루트 밖(../, 심볼릭 링크)이면 undefined */
  private resolveFile(pathname: string): { file: string; stat: fs.Stats } | undefined {
    // 경로 탈출 방지 1: 문자열 기준 (../ 등)
    const file = path.normalize(path.join(this.root, pathname));
    if (!isInside(this.root, file)) {
      return undefined;
    }
    try {
      const stat = fs.statSync(file);
      // 경로 탈출 방지 2: 심볼릭 링크를 푼 실제 경로도 프로젝트 안이어야 한다
      if (!isInside(this.rootReal, fs.realpathSync(file))) {
        return undefined;
      }
      return { file, stat };
    } catch {
      return undefined;
    }
  }

  /** 페이지 URL 경로 → HTML 파일 (폴더면 index.html) */
  private resolvePage(pathname: string): string | undefined {
    const r = this.resolveFile(pathname);
    if (!r) {
      return undefined;
    }
    if (r.stat.isDirectory()) {
      const index = path.join(r.file, 'index.html');
      return fs.existsSync(index) ? index : undefined;
    }
    return r.file;
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
      .filter((e) => !IGNORED_DIRS.has(e.name) && !e.name.startsWith('.'))
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
    if (pathname !== WS_PATH || typeof key !== 'string' || !isAllowedHost(req.headers.host, this.options.host === '0.0.0.0')) {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }
    const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    this.clients.add(socket);
    let pending: Buffer = Buffer.alloc(0);
    socket.on('data', (buf: Buffer) => {
      const decoded = decodeFrames(Buffer.concat([pending, buf]));
      pending = Buffer.from(decoded.rest);
      if (decoded.close) {
        try {
          socket.end(Buffer.from([0x88, 0x00]));
        } catch {
          /* ignore */
        }
        return;
      }
      if (decoded.ping) {
        socket.write(Buffer.from([0x8a, 0x00]));
      }
      for (const text of decoded.messages) {
        this.handleClientMessage(socket, text);
      }
    });
    const drop = () => this.clients.delete(socket);
    socket.on('close', drop);
    socket.on('error', drop);
    socket.on('end', drop);
    this.sendText(socket, 'connected');
  }

  private handleClientMessage(socket: net.Socket, text: string): void {
    let msg: { type?: string } & Partial<InspectRequest>;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (msg.type !== 'inspect' || !this.options.inspect) {
      return;
    }
    const candidates = this.locateRules(msg.page ?? '/', Array.isArray(msg.rules) ? msg.rules : []);
    const first = candidates[0];
    this.sendText(
      socket,
      JSON.stringify(first ? { type: 'inspect-result', ok: true, file: path.basename(first.file), line: first.line } : { type: 'inspect-result', ok: false })
    );
    if (first) {
      this.emit('inspect', { element: String(msg.element ?? ''), candidates } satisfies InspectEvent);
    }
  }

  /** 브라우저가 보낸 규칙 목록을 파일과 줄 번호로 바꾼다. 못 찾는 규칙은 건너뛴다 */
  private locateRules(page: string, rules: InspectRule[]): InspectCandidate[] {
    const out: InspectCandidate[] = [];
    const cssCache = new Map<string, ReturnType<typeof parseCssBlocks>>();
    let html: { file: string; text: string } | undefined | null = null;
    for (const rule of rules) {
      if (!Array.isArray(rule.path) || rule.path.some((n) => !Number.isInteger(n) || n < 0)) {
        continue;
      }
      if (typeof rule.sheet === 'string') {
        let pathname: string;
        try {
          pathname = decodeURIComponent(rule.sheet);
        } catch {
          continue;
        }
        const r = this.resolveFile(pathname);
        if (!r || !r.stat.isFile()) {
          continue;
        }
        let blocks = cssCache.get(r.file);
        if (!blocks) {
          try {
            blocks = parseCssBlocks(fs.readFileSync(r.file, 'utf8'));
          } catch {
            continue;
          }
          cssCache.set(r.file, blocks);
        }
        const block = findBlockByPath(blocks, rule.path);
        if (block) {
          out.push({ file: r.file, line: block.line, selector: String(rule.selector ?? block.prelude) });
        }
      } else if (typeof rule.styleIndex === 'number') {
        if (html === null) {
          const file = this.resolvePage(page);
          html = file ? { file, text: fs.readFileSync(file, 'utf8') } : undefined;
        }
        if (!html) {
          continue;
        }
        const line = locateInlineRule(html.text, rule.styleIndex, rule.path, typeof rule.styleText === 'string' ? rule.styleText.slice(0, 160) : undefined);
        if (line !== undefined) {
          out.push({ file: html.file, line, selector: String(rule.selector ?? '') });
        }
      }
    }
    return out;
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
