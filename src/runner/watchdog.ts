/**
 * 감시 프로세스 (dist/watchdog.js 로 따로 번들된다).
 *
 *   node watchdog.js <hostPid> <childPid>
 *
 * 확장 호스트(hostPid)가 사라지면 dev 서버 프로세스 트리(childPid)를 종료한다.
 * 창을 닫거나 에디터가 강제 종료되면 deactivate() 가 끝까지 실행되지 않아
 * dev 서버가 고아로 남는 문제를 막는다. childPid 가 먼저 끝나면 조용히 종료한다.
 *
 * PID 재사용 대비: 시작할 때 childPid 의 프로세스 시작 시각을 기록해 두고, 죽이기 직전에 다시 읽어
 * 같은 프로세스일 때만 신호를 보낸다. 시작 시각을 읽을 수 없으면 죽이지 않는다 (남을 죽이느니 고아를 남긴다).
 *
 * 의존성 없음. macOS/Linux 에서는 childPid 가 프로세스 그룹 리더(detached spawn)라고 가정하고
 * 그룹 전체에 시그널을 보낸다. Windows 에서는 taskkill /T 로 트리를 죽인다.
 */
import { execFileSync } from 'child_process';

const POLL_MS = 1000;
const GRACE_MS = 3000;
const IS_WIN = process.platform === 'win32';

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM = 살아 있지만 권한 없음
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** 프로세스 시작 시각 문자열. 프로세스가 없거나 읽기 실패면 undefined */
export function processStartTime(pid: number): string | undefined {
  try {
    if (IS_WIN) {
      const out = execFileSync(
        'powershell',
        ['-NoProfile', '-Command', `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToString('o')`],
        { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, timeout: 5000 }
      );
      return out.toString().trim() || undefined;
    }
    const out = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 });
    return out.toString().trim() || undefined;
  } catch {
    return undefined;
  }
}

/** 기록해 둔 시작 시각과 지금의 시작 시각이 같을 때만 true */
export function sameProcess(pid: number, recordedStart: string | undefined): boolean {
  if (!recordedStart) {
    return false;
  }
  return processStartTime(pid) === recordedStart;
}

export function signalTree(pid: number, signal: NodeJS.Signals): void {
  if (IS_WIN) {
    try {
      execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } catch {
      /* 이미 죽었을 수 있다 */
    }
    return;
  }
  try {
    process.kill(-pid, signal); // 프로세스 그룹 전체
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      /* 이미 죽음 */
    }
  }
}

function main(): void {
  const hostPid = Number(process.argv[2]);
  const childPid = Number(process.argv[3]);
  if (!hostPid || !childPid) {
    process.exit(2);
  }
  const childStart = processStartTime(childPid);
  if (!childStart) {
    // 식별할 수 없으면 감시하지 않는다
    process.exit(0);
  }

  const timer = setInterval(() => {
    if (!alive(childPid) || !sameProcess(childPid, childStart)) {
      clearInterval(timer);
      process.exit(0);
    }
    if (!alive(hostPid)) {
      clearInterval(timer);
      if (sameProcess(childPid, childStart)) {
        signalTree(childPid, 'SIGTERM');
      }
      setTimeout(() => {
        if (alive(childPid) && sameProcess(childPid, childStart)) {
          signalTree(childPid, 'SIGKILL');
        }
        process.exit(0);
      }, GRACE_MS);
    }
  }, POLL_MS);
}

// 번들된 스크립트로 직접 실행될 때만 감시를 시작한다 (테스트에서 import 할 때는 실행하지 않는다)
if (require.main === module && /watchdog\.js$/.test(process.argv[1] ?? '')) {
  main();
}
