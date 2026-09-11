/**
 * 패키지 매니저별 명령 인자 구성. vscode 모듈에 의존하지 않는다 (단위 테스트 대상).
 */
import * as net from 'net';
import { PackageManager } from '../detect';

export function installArgs(pm: PackageManager, legacyPeer: boolean): string[] {
  switch (pm) {
    case 'npm':
      return ['install', '--no-audit', '--no-fund', ...(legacyPeer ? ['--legacy-peer-deps'] : [])];
    case 'pnpm':
      return ['install'];
    case 'yarn':
      return ['install'];
    case 'bun':
      return ['install'];
  }
}

export function devArgs(pm: PackageManager, script: string, port?: number): string[] {
  const portArgs = port ? ['--port', String(port)] : [];
  const safeScript = quoteIfNeeded(script);
  switch (pm) {
    case 'npm':
      // npm 은 스크립트로 인자를 넘길 때 -- 가 필요하다
      return ['run', safeScript, ...(portArgs.length ? ['--', ...portArgs] : [])];
    case 'pnpm':
    case 'yarn':
    case 'bun':
      return ['run', safeScript, ...portArgs];
  }
}

/**
 * shell: true 로 실행하므로 인자를 셸 규칙에 맞게 감싼다.
 * 스크립트 이름은 detect.isSafeScriptName 으로 이미 걸러지므로 보통 그대로 통과한다. 이 함수는 마지막 방어선이다.
 */
export function quoteIfNeeded(arg: string): string {
  if (/^[\w@:./-]+$/.test(arg)) {
    return arg;
  }
  if (process.platform === 'win32') {
    // cmd.exe: 큰따옴표 안에서는 " 를 "" 로, 그리고 %VAR% 확장을 막기 위해 % 를 제거한다
    return `"${arg.replace(/"/g, '""').replace(/%/g, '')}"`;
  }
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

/** 비어 있는 포트 하나를 찾는다 */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}
