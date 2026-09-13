/**
 * 프로젝트 감지: package.json, lockfile, 패키지 매니저, 실행 스크립트, Node 존재 여부.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { spawn } from 'child_process';

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';
export type PackageManagerSetting = 'auto' | PackageManager;

export interface PackageJson {
  name?: string;
  scripts?: Record<string, string>;
  packageManager?: string;
}

export const SCRIPT_CANDIDATES = ['dev', 'start', 'serve', 'preview'] as const;

const PACKAGE_MANAGERS: ReadonlySet<string> = new Set(['npm', 'pnpm', 'yarn', 'bun']);

/**
 * VS Code 는 설정의 enum 을 실행 시점에 강제하지 않는다. settings.json 에 임의 문자열이 올 수 있으므로
 * 셸에 넘기기 전에 반드시 허용 목록과 대조한다. 목록 밖이면 'auto'.
 */
export function normalizePackageManagerSetting(value: unknown): PackageManagerSetting {
  return typeof value === 'string' && PACKAGE_MANAGERS.has(value) ? (value as PackageManager) : 'auto';
}

/**
 * npm 스크립트 이름으로 안전한 문자만 허용한다 (셸 메타문자 배제).
 * package.json 에 실제로 있는 이름이어야 하는 검사는 pickScript 에서 한다.
 */
export function isSafeScriptName(name: string): boolean {
  return /^[A-Za-z0-9_@:.\/-]{1,100}$/.test(name);
}

// ── package.json ────────────────────────────────────────────────────────────

export function hasPackageJson(root: string): boolean {
  return fs.existsSync(path.join(root, 'package.json'));
}

/**
 * startDir 에서 위로 올라가며 package.json 이 있는 가장 가까운 폴더를 찾는다.
 * stopDir(워크스페이스 루트) 밖으로는 나가지 않는다. 없으면 undefined.
 * node_modules 안의 package.json 은 프로젝트가 아니므로 건너뛴다.
 */
export function findNearestProjectDir(startDir: string, stopDir: string): string | undefined {
  const stop = path.resolve(stopDir);
  let dir = path.resolve(startDir);
  if (dir !== stop && !dir.startsWith(stop + path.sep)) {
    return undefined;
  }
  while (true) {
    if (!dir.split(path.sep).includes('node_modules') && fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    if (dir === stop) {
      return undefined;
    }
    dir = path.dirname(dir);
  }
}

/** 없으면 undefined, 파싱 실패면 'invalid' */
export function readPackageJson(root: string): PackageJson | undefined | 'invalid' {
  const file = path.join(root, 'package.json');
  if (!fs.existsSync(file)) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return typeof parsed === 'object' && parsed !== null ? (parsed as PackageJson) : 'invalid';
  } catch {
    return 'invalid';
  }
}

export type ScriptPick =
  | { kind: 'ok'; script: string }
  | { kind: 'none' }
  | { kind: 'forcedMissing'; script: string }
  | { kind: 'forcedInvalid'; script: string };

/**
 * 실행할 스크립트를 고른다. 설정으로 강제한 이름은 package.json 의 scripts 키와 정확히 일치하고
 * 안전한 문자로만 이뤄져야 한다. 아니면 이유를 돌려준다.
 */
export function pickScript(pkg: PackageJson, forced?: string): ScriptPick {
  const scripts = pkg.scripts ?? {};
  const wanted = forced?.trim();
  if (wanted) {
    if (!isSafeScriptName(wanted)) {
      return { kind: 'forcedInvalid', script: wanted };
    }
    if (typeof scripts[wanted] !== 'string') {
      return { kind: 'forcedMissing', script: wanted };
    }
    return { kind: 'ok', script: wanted };
  }
  const found = SCRIPT_CANDIDATES.find((name) => typeof scripts[name] === 'string' && scripts[name].trim() !== '');
  return found ? { kind: 'ok', script: found } : { kind: 'none' };
}

// ── 패키지 매니저 ───────────────────────────────────────────────────────────

const LOCKFILES: Array<[string, PackageManager]> = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['package-lock.json', 'npm'],
];

export function detectPackageManager(root: string, pkg: PackageJson, setting: PackageManagerSetting = 'auto'): PackageManager {
  const safeSetting = normalizePackageManagerSetting(setting);
  if (safeSetting !== 'auto') {
    return safeSetting;
  }
  // package.json 의 packageManager 필드가 최우선 (예: "pnpm@9.1.0")
  const declared = pkg.packageManager?.split('@')[0]?.trim();
  if (declared === 'npm' || declared === 'pnpm' || declared === 'yarn' || declared === 'bun') {
    return declared;
  }
  for (const [file, pm] of LOCKFILES) {
    if (fs.existsSync(path.join(root, file))) {
      return pm;
    }
  }
  return 'npm';
}

export function lockfilePath(root: string): string | undefined {
  for (const [file] of LOCKFILES) {
    const p = path.join(root, file);
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return undefined;
}

/** lockfile(없으면 package.json) 내용의 해시. 설치 필요 여부 판단에 쓴다 */
export function lockfileHash(root: string): string {
  const file = lockfilePath(root) ?? path.join(root, 'package.json');
  try {
    return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
  } catch {
    return '';
  }
}

export function hasNodeModules(root: string): boolean {
  return fs.existsSync(path.join(root, 'node_modules'));
}

// ── 실행 파일 존재 확인 ─────────────────────────────────────────────────────

const IS_WIN = process.platform === 'win32';

/** `cmd --version` 이 정상 종료하면 true */
export function commandExists(cmd: string, env: NodeJS.ProcessEnv, timeoutMs = 8000): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (!done) {
        done = true;
        resolve(ok);
      }
    };
    try {
      const child = spawn(cmd, ['--version'], { env, shell: true, windowsHide: true, stdio: 'ignore' });
      const timer = setTimeout(() => {
        child.kill();
        finish(false);
      }, timeoutMs);
      child.on('error', () => {
        clearTimeout(timer);
        finish(false);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        finish(code === 0);
      });
    } catch {
      finish(false);
    }
  });
}

/** 환경 변수 객체에서 PATH 키 이름을 찾는다 (Windows는 Path 일 수 있다) */
export function pathKey(env: NodeJS.ProcessEnv): string {
  return Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
}

/** 존재하는 디렉터리만 PATH 앞에 덧붙인 새 env 를 돌려준다 */
export function withExtraPath(env: NodeJS.ProcessEnv, dirs: string[]): NodeJS.ProcessEnv {
  const key = pathKey(env);
  const current = (env[key] ?? '').split(path.delimiter).filter(Boolean);
  const extra = dirs.filter((d) => d && !current.includes(d) && fs.existsSync(d));
  if (extra.length === 0) {
    return env;
  }
  return { ...env, [key]: [...extra, ...current].join(path.delimiter) };
}

/** nvm/fnm 처럼 버전별 디렉터리를 두는 매니저에서 가장 높은 버전의 bin 을 고른다 */
function highestVersionBin(versionsDir: string, binSuffix: string): string | undefined {
  try {
    const entries = fs
      .readdirSync(versionsDir)
      .filter((n) => /^v?\d+\.\d+\.\d+$/.test(n))
      .sort((a, b) => compareSemver(b, a));
    for (const v of entries) {
      const bin = path.join(versionsDir, v, binSuffix);
      if (fs.existsSync(bin)) {
        return bin;
      }
    }
  } catch {
    /* 디렉터리 없음 */
  }
  return undefined;
}

function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) {
      return pa[i] - pb[i];
    }
  }
  return 0;
}

/** GUI 앱이 셸 PATH 를 물려받지 못했을 때를 대비한 후보 디렉터리 */
export function candidateNodeDirs(): string[] {
  const home = os.homedir();
  if (IS_WIN) {
    const e = process.env;
    return [
      path.join(e['ProgramFiles'] ?? 'C:\\Program Files', 'nodejs'),
      path.join(e['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'nodejs'),
      path.join(e['APPDATA'] ?? path.join(home, 'AppData', 'Roaming'), 'npm'),
      path.join(e['LOCALAPPDATA'] ?? path.join(home, 'AppData', 'Local'), 'Programs', 'nodejs'),
      path.join(e['LOCALAPPDATA'] ?? path.join(home, 'AppData', 'Local'), 'Volta', 'bin'),
      path.join(e['LOCALAPPDATA'] ?? path.join(home, 'AppData', 'Local'), 'pnpm'),
      path.join(home, '.bun', 'bin'),
      e['NVM_SYMLINK'] ?? '',
    ].filter(Boolean);
  }
  return [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/opt/local/bin',
    path.join(home, '.volta', 'bin'),
    path.join(home, '.bun', 'bin'),
    path.join(home, '.asdf', 'shims'),
    path.join(home, '.local', 'share', 'pnpm'),
    path.join(home, 'Library', 'pnpm'),
    highestVersionBin(path.join(home, '.nvm', 'versions', 'node'), 'bin') ?? '',
    path.join(home, '.fnm', 'aliases', 'default', 'bin'),
    path.join(home, 'Library', 'Application Support', 'fnm', 'aliases', 'default', 'bin'),
    path.join(home, '.local', 'share', 'fnm', 'aliases', 'default', 'bin'),
    highestVersionBin(path.join(home, '.local', 'share', 'fnm', 'node-versions'), path.join('installation', 'bin')) ?? '',
  ].filter(Boolean);
}

/** 로그인 셸을 한 번 띄워 실제 PATH 를 읽어온다 (macOS/Linux). 실패하면 undefined */
export function loginShellPath(timeoutMs = 5000): Promise<string | undefined> {
  if (IS_WIN) {
    return Promise.resolve(undefined);
  }
  return new Promise((resolve) => {
    const shell = process.env['SHELL'] || '/bin/zsh';
    const marker = '__GO_LIVE_PATH__';
    let out = '';
    let done = false;
    const finish = (v: string | undefined) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    try {
      const child = spawn(shell, ['-ilc', `echo "${marker}$PATH${marker}"`], {
        stdio: ['ignore', 'pipe', 'ignore'],
        env: { ...process.env, TERM: 'dumb' },
      });
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        finish(undefined);
      }, timeoutMs);
      child.stdout.on('data', (b: Buffer) => (out += b.toString('utf8')));
      child.on('error', () => {
        clearTimeout(timer);
        finish(undefined);
      });
      child.on('close', () => {
        clearTimeout(timer);
        const m = new RegExp(`${marker}(.*?)${marker}`, 's').exec(out);
        finish(m?.[1]?.trim() || undefined);
      });
    } catch {
      finish(undefined);
    }
  });
}

export interface NodeEnv {
  found: boolean;
  env: NodeJS.ProcessEnv;
}

let cachedNodeEnv: NodeEnv | undefined;

/**
 * node 를 찾을 수 있는 env 를 돌려준다.
 * 1) 현재 env  2) 후보 디렉터리 보강  3) 로그인 셸 PATH 병합  순으로 시도하고
 * 성공한 결과만 캐시한다 (학생이 Node 를 설치한 뒤 재시도할 수 있도록).
 */
export async function resolveNodeEnv(): Promise<NodeEnv> {
  if (cachedNodeEnv?.found) {
    return cachedNodeEnv;
  }
  const base: NodeJS.ProcessEnv = { ...process.env };

  if (await commandExists('node', base)) {
    return (cachedNodeEnv = { found: true, env: base });
  }

  const augmented = withExtraPath(base, candidateNodeDirs());
  if (augmented !== base && (await commandExists('node', augmented))) {
    return (cachedNodeEnv = { found: true, env: augmented });
  }

  const shellPath = await loginShellPath();
  if (shellPath) {
    const merged = withExtraPath(augmented, shellPath.split(path.delimiter));
    if (await commandExists('node', merged)) {
      return (cachedNodeEnv = { found: true, env: merged });
    }
  }

  return { found: false, env: augmented };
}

/** 테스트/재시도용 */
export function resetNodeEnvCache(): void {
  cachedNodeEnv = undefined;
}
