/**
 * 에디터 강제 종료 시나리오: 확장 호스트 역할 프로세스를 SIGKILL 로 죽이고 dev 서버 트리가 정리되는지 확인.
 *   npm run smoke:crash
 */
import { spawn, execSync } from 'child_process';
import * as path from 'path';

const listeners = (port: number) => { try { return execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`).toString().trim().split('\n').filter(Boolean); } catch { return []; } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function scenario(fixture: string, port: number, extraPorts: number[] = []) {
  console.log(`\n===== ${fixture} (호스트 SIGKILL) =====`);
  const host = spawn('node', [path.join(__dirname, 'host-crash-child.js'), fixture], { stdio: ['ignore', 'pipe', 'inherit'] });
  const info = await new Promise<{ outcome: string; url?: string; childPid?: number }>((resolve) => {
    let buf = '';
    host.stdout.on('data', (d) => { buf += d.toString(); const line = buf.split('\n').find((l) => l.startsWith('{')); if (line) { resolve(JSON.parse(line)); } });
  });
  console.log(`  host pid ${host.pid}, dev child pid ${info.childPid}, ${info.outcome} ${info.url ?? ''}`);
  const before = [port, ...extraPorts].map((p) => `${p}:${listeners(p).length}`).join(' ');
  console.log(`  listeners before crash → ${before}`);
  host.kill('SIGKILL');
  await sleep(6500); // 감시 1초 폴링 + SIGTERM 3초 유예 + 여유
  const after = [port, ...extraPorts].map((p) => listeners(p).length);
  const ok = after.every((n) => n === 0);
  console.log(`  ${ok ? '✔' : '✘'} 호스트 SIGKILL 6.5초 후 listeners → ${[port, ...extraPorts].map((p, i) => `${p}:${after[i]}`).join(' ')}`);
  const dogs = execSync('ps -eo pid,command | grep -E "node [^ ]*watchdog.js [0-9]+ [0-9]+" | grep -v grep || true').toString().trim();
  console.log(`  ${dogs ? '✘' : '✔'} 감시 프로세스도 종료됨${dogs ? '\n' + dogs : ''}`);
  if (!ok) { for (const p of [port, ...extraPorts]) { for (const pid of listeners(p)) { execSync(`kill -9 ${pid}`); } } }
  return ok && !dogs;
}

(async () => {
  let ok = true;
  ok = (await scenario('ws-chat', 3200)) && ok;
  ok = (await scenario('fullstack-concurrently', 5173, [3100])) && ok;
  console.log(`\n${ok ? 'ALL PASSED' : 'FAILED'}`);
  process.exit(ok ? 0 : 1);
})();
