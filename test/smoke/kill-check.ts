// Stop 이 프로세스 트리를 정말 다 죽이는지 반복 확인
import * as path from 'path';
import { execSync } from 'child_process';
import { NpmSession } from '../../src/runner/npm';
import { ProcessTerminal } from '../../src/runner/pty';
import { resolveNodeEnv } from '../../src/detect';
import { GoLiveConfig } from '../../src/config';
const config: GoLiveConfig = { staticPort: 5500, npmScript: '', packageManager: 'auto', alwaysInstall: false, browser: 'none', showTerminalOnStart: false, staticRoot: '', inspect: true, devtoolsWorkspace: true };
class M { m = new Map<string, unknown>(); keys() { return [...this.m.keys()]; } get<T>(k: string, d?: T) { return (this.m.has(k) ? this.m.get(k) : d) as T; } async update(k: string, v: unknown) { this.m.set(k, v); } }
const listeners = (port: number) => { try { return execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`).toString().trim().split('\n').filter(Boolean); } catch { return []; } };
(async () => {
  const root = path.join(__dirname, '../test/fixtures', process.argv[2] ?? 'ws-chat');
  const port = Number(process.argv[3] ?? 3200);
  const node = await resolveNodeEnv();
  for (let i = 1; i <= 3; i++) {
    const pty = new ProcessTerminal(); pty.open();
    const s = new NpmSession({ root, config, workspaceState: new M(), env: node.env, pty, onState: () => undefined, notify: () => undefined });
    const o = await s.start();
    const before = listeners(port);
    const pidTree = pty['proc'] ? execSync(`pstree -p ${pty['proc'].pid} 2>/dev/null || ps -o pid,ppid,command -g $(ps -o pgid= -p ${pty['proc'].pid})`).toString() : '(no proc)';
    const t0 = Date.now();
    await s.stop();
    await new Promise((r) => setTimeout(r, 500));
    const after = listeners(port);
    console.log(`run ${i}: outcome=${o.kind} listeners before=${before.length} after=${after.length} stop=${Date.now() - t0}ms ${after.length ? 'LEFTOVER pids ' + after.join(',') : 'ok'}`);
    if (after.length) { console.log(pidTree); for (const p of after) { console.log(execSync(`ps -o pid,ppid,command -p ${p}`).toString()); } execSync(`kill -9 ${after.join(' ')}`); }
  }
  process.exit(0);
})();
