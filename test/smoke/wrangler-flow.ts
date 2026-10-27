/**
 * Cloudflare Workers(wrangler dev) 스모크: npm install → wrangler dev → "Local Explorer API" 안내가 먼저 찍혀도
 * Ready 줄의 루트 주소를 고르는지, 그 주소에서 정적 페이지와 Worker API 가 응답하는지 확인한다.
 *   npm run smoke:wrangler   (네트워크 필요, wrangler 설치 용량 큼)
 */
import * as path from 'path';
import { NpmSession } from '../../src/runner/npm';
import { ProcessTerminal } from '../../src/runner/pty';
import { resolveNodeEnv } from '../../src/detect';
import { GoLiveConfig } from '../../src/config';
import { t } from '../../src/l10n';

const FIXTURES = path.resolve(__dirname, '../test/fixtures');
const config: GoLiveConfig = {
  staticPort: 5500, npmScript: '', packageManager: 'auto', alwaysInstall: false, browser: 'none',
  showTerminalOnStart: false, staticRoot: '', inspect: true, devtoolsWorkspace: true, staticHost: '127.0.0.1', cors: false,
};

class MemoryMemento {
  private m = new Map<string, unknown>();
  keys() { return [...this.m.keys()]; }
  get<T>(k: string, d?: T): T | undefined { return (this.m.has(k) ? this.m.get(k) : d) as T | undefined; }
  async update(k: string, v: unknown) { this.m.set(k, v); }
}

(async () => {
  let failures = 0;
  const expect = (cond: boolean, msg: string) => { console.log(`  ${cond ? '✔' : '✘'} ${msg}`); if (!cond) { failures++; } };
  const node = await resolveNodeEnv();
  if (!node.found) { throw new Error('node not found'); }
  const pty = new ProcessTerminal();
  const seen: string[] = [];
  pty.onDidWrite((s) => { const txt = s.replace(/\r\n/g, '\n'); seen.push(txt); process.stdout.write(txt); });
  pty.open();
  const session = new NpmSession({
    root: path.join(FIXTURES, 'cloudflare-worker'), config, workspaceState: new MemoryMemento(), env: node.env, pty,
    onState: (s) => console.log(`  [state] ${s}`),
    notify: (m) => console.log(`  [notify] ${m}`),
  });
  console.log('\n===== cloudflare-worker (wrangler dev) =====');
  const outcome = await session.start();
  console.log('  [outcome]', outcome.kind, outcome.kind === 'running' ? outcome.url : outcome.kind === 'failed' ? `${outcome.classification.rule?.id ?? '-'} → ${t(outcome.classification.messageKey)}` : '');
  if (outcome.kind === 'running' && outcome.url) {
    const url = outcome.url;
    const output = seen.join('');
    expect(/Local Explorer API/.test(output), 'wrangler 가 Explorer API 안내를 먼저 찍었다 (재현 조건)');
    expect(/^http:\/\/localhost:\d+\/$/.test(url), `루트 주소를 골랐다: ${url}`);
    expect(!/cdn-cgi/.test(url), 'Explorer API 주소가 아니다');
    const page = await fetch(url).then((r) => r.text()).catch(() => '');
    expect(page.includes('Cloudflare Worker'), '정적 페이지(public/index.html) 응답');
    const hello = await fetch(url + 'api/hello').then((r) => r.json() as Promise<{ message: string }>).catch(() => undefined);
    expect(!!hello && /Cloudflare Worker/.test(hello.message), '/api/hello Worker 응답');
    const c1 = await fetch(url + 'api/count', { method: 'POST' }).then((r) => r.json() as Promise<{ count: number }>).catch(() => undefined);
    const c2 = await fetch(url + 'api/count', { method: 'POST' }).then((r) => r.json() as Promise<{ count: number }>).catch(() => undefined);
    expect(!!c1 && !!c2 && c2.count === c1.count + 1, `Durable Object 카운터 증가 (${c1?.count} → ${c2?.count})`);
  } else {
    expect(false, 'cloudflare-worker running');
  }
  await session.stop();
  await new Promise((r) => setTimeout(r, 1500));
  console.log(failures ? `\n${failures} failure(s)` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
