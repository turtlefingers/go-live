/**
 * vscode 없이 NpmSession 을 실제 fixture 에 대해 돌려보는 스모크 테스트.
 *   npm run smoke
 * 네트워크가 필요하다 (vite 설치).
 */
import * as path from 'path';
import * as net from 'net';
import { NpmSession, lockfileHashKey } from '../../src/runner/npm';
import { ProcessTerminal } from '../../src/runner/pty';
import { freePort } from '../../src/runner/commands';
import { lanAddress, isReachable } from '../../src/lan';
import { resolveNodeEnv } from '../../src/detect';
import { GoLiveConfig } from '../../src/config';
import { t } from '../../src/l10n';

const FIXTURES = path.resolve(__dirname, '../test/fixtures');
const config: GoLiveConfig = {
  staticPort: 5500,
  npmScript: '',
  packageManager: 'auto',
  alwaysInstall: false,
  browser: 'none',
  showTerminalOnStart: false,
  staticRoot: '',
  inspect: true,
  devtoolsWorkspace: true,
  staticHost: '127.0.0.1',
  cors: false,
};

class MemoryMemento {
  private m = new Map<string, unknown>();
  keys() { return [...this.m.keys()]; }
  get<T>(k: string, d?: T): T | undefined { return (this.m.has(k) ? this.m.get(k) : d) as T | undefined; }
  async update(k: string, v: unknown) { this.m.set(k, v); }
}

function makeTerminal(): ProcessTerminal {
  const pty = new ProcessTerminal();
  pty.onDidWrite((s) => process.stdout.write(s.replace(/\r\n/g, '\n')));
  pty.open();
  return pty;
}

async function run(name: string, root: string, extra: Partial<ConstructorParameters<typeof NpmSession>[0]> = {}, state = new MemoryMemento()) {
  console.log(`\n===== ${name} =====`);
  const node = await resolveNodeEnv();
  if (!node.found) { throw new Error('node not found'); }
  const pty = makeTerminal();
  const session = new NpmSession({
    root, config, workspaceState: state, env: node.env, pty,
    onState: (s) => console.log(`  [state] ${s}`),
    notify: (m) => console.log(`  [notify] ${m}`),
    ...extra,
  });
  const outcome = await session.start();
  console.log('  [outcome]', outcome.kind, outcome.kind === 'running' ? outcome.url : outcome.kind === 'failed' ? `${outcome.classification.rule?.id ?? '-'} → ${t(outcome.classification.messageKey)}` : '');
  return { outcome, session, pty, state };
}

/** Vite 는 localhost 를 ::1 또는 127.0.0.1 로 바인딩한다. 둘 다 점유해야 확실히 충돌한다 */
async function holdPort(port: number): Promise<{ close: () => void }> {
  const servers: net.Server[] = [];
  for (const host of ['127.0.0.1', '::1']) {
    await new Promise<void>((resolve) => {
      const srv = net.createServer();
      srv.on('error', () => resolve()); // IPv6 없는 환경 등
      srv.listen(port, host, () => { servers.push(srv); resolve(); });
    });
  }
  return { close: () => servers.forEach((s) => s.close()) };
}

(async () => {
  let failures = 0;
  const expect = (cond: boolean, msg: string) => { console.log(`  ${cond ? '✔' : '✘'} ${msg}`); if (!cond) { failures++; } };

  // 1. no-script → 실패 + msg.noScript
  {
    const { outcome } = await run('no-script', path.join(FIXTURES, 'no-script'));
    expect(outcome.kind === 'failed' && outcome.classification.messageKey === 'msg.noScript', 'msg.noScript');
  }

  // 2. vite-vanilla → install → dev → URL → fetch → stop
  const state = new MemoryMemento();
  {
    const { outcome, session, pty } = await run('vite-vanilla (첫 실행: install 포함)', path.join(FIXTURES, 'vite-vanilla'), {}, state);
    expect(outcome.kind === 'running' && !!outcome.url, 'running with url');
    if (outcome.kind === 'running' && outcome.url) {
      const res = await fetch(outcome.url);
      const html = await res.text();
      expect(res.status === 200 && html.includes('/main.js'), `fetch ${outcome.url} → 200`);
      expect(state.get(lockfileHashKey(path.join(FIXTURES, 'vite-vanilla'))) !== undefined, 'lockfile hash stored');
      const t0 = Date.now();
      await session.stop();
      expect(!pty.isRunning, `stopped in ${Date.now() - t0}ms`);
      const alive = await fetch(outcome.url).then(() => true, () => false);
      expect(!alive, 'server no longer responds after tree-kill');
    }
  }

  // 3. vite-vanilla 두 번째 실행 → install 건너뜀
  {
    const states: string[] = [];
    const { outcome, session } = await run('vite-vanilla (두 번째: install 생략)', path.join(FIXTURES, 'vite-vanilla'), { onState: (s) => states.push(s) }, state);
    expect(!states.includes('installing'), `skipped install (states: ${states.join(' → ')})`);
    expect(outcome.kind === 'running', 'running');
    await session.stop();
  }

  // 4. port-conflict → EADDRINUSE → retryPort 로 성공
  {
    const holder = await holdPort(5173);
    const { outcome } = await run('port-conflict (5173 점유)', path.join(FIXTURES, 'port-conflict'));
    expect(outcome.kind === 'failed' && outcome.classification.rule?.id === 'port-in-use', 'port-in-use classified');
    const port = await freePort();
    const retry = await run(`port-conflict (retry --port ${port})`, path.join(FIXTURES, 'port-conflict'), { port });
    expect(retry.outcome.kind === 'running' && retry.outcome.url?.includes(`:${port}`) === true, `running on ${port}`);
    await retry.session.stop();
    holder.close();
  }

  // 5. start-only → npm start, PORT 환경변수 없이 3456
  {
    const { outcome, session } = await run('start-only', path.join(FIXTURES, 'start-only'));
    expect(outcome.kind === 'running' && outcome.url === 'http://localhost:3456/', 'start script used, url 3456');
    await session.stop();
  }

  // 6. broken-deps → 설치 실패 → network(E404) 분류
  {
    const { outcome } = await run('broken-deps', path.join(FIXTURES, 'broken-deps'));
    expect(outcome.kind === 'failed' && outcome.stage === 'install', 'failed at install');
    expect(outcome.kind === 'failed' && outcome.classification.rule?.id === 'network', `classified as network (got ${outcome.kind === 'failed' ? outcome.classification.rule?.id : '-'})`);
  }

  // 6b. 휴대폰으로 보기: lan 옵션이면 Vite 가 0.0.0.0 에 듣는다
  {
    const ip = lanAddress();
    if (ip) {
      const { outcome, session } = await run('vite-vanilla (lan: --host 0.0.0.0)', path.join(FIXTURES, 'vite-vanilla'), { lan: true });
      if (outcome.kind === 'running' && outcome.url) {
        const port = Number(new URL(outcome.url).port);
        expect(await isReachable(ip, port), `LAN 주소 ${ip}:${port} 에서 접속 가능`);
      } else { expect(false, 'lan 모드 running'); }
      await session.stop();
    } else { console.log('\n(LAN 주소 없음 → lan 테스트 건너뜀)'); }
  }

  // 7. node 미설치 시뮬레이션: PATH 비움 → shell "command not found" → node-missing
  {
    const node = await resolveNodeEnv();
    const { outcome } = await run('node-missing (PATH=/nonexistent)', path.join(FIXTURES, 'start-only'), { env: { ...node.env, PATH: '/nonexistent', Path: '/nonexistent' } });
    expect(outcome.kind === 'failed' && outcome.classification.rule?.id === 'node-missing', 'node-missing classified');
  }

  console.log(`\n${failures === 0 ? 'ALL PASSED' : failures + ' FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
