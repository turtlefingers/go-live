// 확장 호스트 역할: NpmSession 으로 fixture 를 띄우고 URL 을 출력한 뒤 그대로 대기한다. 부모가 SIGKILL 로 죽인다.
import * as path from 'path';
import { NpmSession } from '../../src/runner/npm';
import { ProcessTerminal } from '../../src/runner/pty';
import { resolveNodeEnv } from '../../src/detect';
import { GoLiveConfig } from '../../src/config';
const config: GoLiveConfig = { staticPort: 5500, npmScript: '', packageManager: 'auto', alwaysInstall: false, browser: 'none', showTerminalOnStart: false, staticRoot: '', inspect: true, devtoolsWorkspace: true };
class M { m = new Map<string, unknown>(); keys() { return [...this.m.keys()]; } get<T>(k: string, d?: T) { return (this.m.has(k) ? this.m.get(k) : d) as T; } async update(k: string, v: unknown) { this.m.set(k, v); } }
(async () => {
  const root = path.join(__dirname, '../test/fixtures', process.argv[2]);
  const node = await resolveNodeEnv();
  const pty = new ProcessTerminal(); pty.open();
  const s = new NpmSession({ root, config, workspaceState: new M(), env: node.env, pty, onState: () => undefined, notify: () => undefined });
  const o = await s.start();
  console.log(JSON.stringify({ outcome: o.kind, url: o.kind === 'running' ? o.url : undefined, childPid: (pty as unknown as { proc?: { pid?: number } }).proc?.pid }));
  setInterval(() => undefined, 1000); // 살아 있기
})();
