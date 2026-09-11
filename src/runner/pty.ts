/**
 * Pseudoterminal 구현.
 * - 내부에서 child_process.spawn 으로 프로세스를 실행한다
 * - 출력은 터미널(onDidWrite)에 그대로 흘리면서, ANSI를 제거한 사본을 onData 로 내보내
 *   URL 감지와 에러 매핑에 쓴다
 * - 터미널 하나에서 install → dev 를 순서대로 실행할 수 있다
 * - 종료는 tree-kill 로 프로세스 트리 전체를 죽인다 (Windows에서 Vite 자식 프로세스 대응)
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import treeKill from 'tree-kill';
import { stripAnsi } from './url';
import { t } from '../l10n';

export interface RunOptions {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  /**
   * true 면 확장 호스트가 죽어도 이 프로세스 트리가 정리되도록 감시 프로세스를 함께 띄운다.
   * 창 닫기/강제 종료 시 deactivate() 가 완주하지 못하는 경우의 안전망. dev 서버에 쓴다.
   */
  watchdog?: boolean;
}

const IS_WIN = process.platform === 'win32';
/** dist/watchdog.js 위치 (esbuild 가 extension.js 와 나란히 번들한다) */
const WATCHDOG_SCRIPT = path.join(__dirname, 'watchdog.js');

export interface RunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  /** ANSI 제거된 stdout+stderr 전체 */
  output: string;
  /** spawn 자체가 실패했을 때 (예: 셸을 못 찾음) */
  spawnError?: NodeJS.ErrnoException;
  /** kill() 로 종료된 경우 true */
  killed: boolean;
}

const SIGTERM_GRACE_MS = 3000;
const SIGKILL_WAIT_MS = 2000;

export class ProcessTerminal implements vscode.Pseudoterminal {
  private readonly writeEmitter = new vscode.EventEmitter<string>();
  private readonly closeEmitter = new vscode.EventEmitter<number | void>();
  private readonly dataEmitter = new vscode.EventEmitter<string>();

  readonly onDidWrite = this.writeEmitter.event;
  readonly onDidClose = this.closeEmitter.event;
  /** 실행 중인 프로세스의 출력 (ANSI 제거) */
  readonly onData = this.dataEmitter.event;

  private opened = false;
  private pending: string[] = [];
  private proc: ChildProcess | undefined;
  private running = false;
  private killRequested = false;
  private exitPromise: Promise<RunResult> | undefined;

  get isRunning(): boolean {
    return this.running;
  }

  // ── vscode.Pseudoterminal ──────────────────────────────────────────────

  open(): void {
    this.opened = true;
    for (const s of this.pending) {
      this.writeEmitter.fire(s);
    }
    this.pending = [];
  }

  /** 사용자가 터미널 패널을 닫았을 때 */
  close(): void {
    void this.kill();
  }

  handleInput(data: string): void {
    // Ctrl+C
    if (data === '\u0003') {
      void this.kill();
      return;
    }
    // Vite 등 dev 서버의 단축키(r, o, q …)를 그대로 전달
    this.proc?.stdin?.write(data);
  }

  // ── 출력 ───────────────────────────────────────────────────────────────

  write(text: string): void {
    const s = text.replace(/\r?\n/g, '\r\n');
    if (this.opened) {
      this.writeEmitter.fire(s);
    } else {
      this.pending.push(s);
    }
  }

  writeLine(text = ''): void {
    this.write(text + '\n');
  }

  // ── 실행 / 종료 ────────────────────────────────────────────────────────

  run(opts: RunOptions): Promise<RunResult> {
    if (this.running) {
      throw new Error('ProcessTerminal: a process is already running');
    }
    this.killRequested = false;
    this.running = true;

    this.writeLine();
    this.writeLine(t('terminal.run', [opts.command, ...opts.args].join(' ')));
    this.writeLine(t('terminal.cwd', opts.cwd));
    this.writeLine();

    let output = '';
    const proc = spawn(opts.command, opts.args, {
      cwd: opts.cwd,
      env: opts.env,
      // shell: true → Windows에서 npm.cmd/pnpm.cmd 해석, macOS에서 PATH 탐색
      shell: true,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      // macOS/Linux: 프로세스 그룹 리더로 만들어 그룹 단위로 종료할 수 있게 한다 (Vite 의 esbuild 자식 등)
      detached: !IS_WIN,
    });
    this.proc = proc;
    if (opts.watchdog && proc.pid !== undefined) {
      this.spawnWatchdog(proc.pid, opts.env);
    }

    const onChunk = (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      this.write(text);
      const clean = stripAnsi(text);
      output += clean;
      this.dataEmitter.fire(clean);
    };
    proc.stdout?.on('data', onChunk);
    proc.stderr?.on('data', onChunk);

    this.exitPromise = new Promise<RunResult>((resolve) => {
      let resolved = false;
      let spawnError: NodeJS.ErrnoException | undefined;

      const finish = (code: number | null, signal: NodeJS.Signals | null) => {
        if (resolved) {
          return;
        }
        resolved = true;
        this.running = false;
        this.proc = undefined;
        this.writeLine();
        this.writeLine(this.killRequested ? t('terminal.killed') : t('terminal.exit', code ?? signal ?? '?'));
        resolve({ code, signal, output, spawnError, killed: this.killRequested });
      };

      proc.on('error', (err: NodeJS.ErrnoException) => {
        spawnError = err;
        this.writeLine(t('terminal.spawnError', err.message));
        // Node는 spawn 실패 시 close 이벤트를 보장하지 않으므로 직접 마무리한다
        setTimeout(() => finish(null, null), 100);
      });
      proc.on('close', (code, signal) => finish(code, signal));
    });

    return this.exitPromise;
  }

  /** 프로세스 트리 종료. SIGTERM → 3초 대기 → SIGKILL */
  async kill(): Promise<void> {
    const proc = this.proc;
    const exited = this.exitPromise;
    if (!proc || !this.running || proc.pid === undefined || !exited) {
      return;
    }
    this.killRequested = true;
    const pid = proc.pid;

    this.signalTree(pid, 'SIGTERM');
    const first = await Promise.race([exited, delay(SIGTERM_GRACE_MS).then(() => 'timeout' as const)]);
    if (first === 'timeout') {
      this.signalTree(pid, 'SIGKILL');
      await Promise.race([exited, delay(SIGKILL_WAIT_MS)]);
    }
  }

  /** tree-kill(부모→자식 추적) 과 프로세스 그룹 시그널을 둘 다 쓴다. 부모가 먼저 죽어 고아가 된 손자까지 잡기 위해 */
  private signalTree(pid: number, signal: NodeJS.Signals): void {
    treeKill(pid, signal, () => undefined);
    if (!IS_WIN) {
      try {
        process.kill(-pid, signal);
      } catch {
        /* 그룹이 이미 없음 */
      }
    }
  }

  /** 확장 호스트(process.pid)를 감시하다가 호스트가 사라지면 childPid 트리를 죽이는 독립 프로세스 */
  private spawnWatchdog(childPid: number, env: NodeJS.ProcessEnv): void {
    if (!fs.existsSync(WATCHDOG_SCRIPT)) {
      console.warn(`[Go Live] watchdog script not found: ${WATCHDOG_SCRIPT}`);
      return;
    }
    try {
      const dog = spawn('node', [WATCHDOG_SCRIPT, String(process.pid), String(childPid)], {
        env,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        shell: IS_WIN, // Windows 에서 PATH 의 node.exe 해석
      });
      dog.on('error', () => undefined);
      dog.unref();
    } catch {
      /* 감시 프로세스는 안전망일 뿐, 실패해도 실행은 계속한다 */
    }
  }

  dispose(): void {
    void this.kill();
    this.writeEmitter.dispose();
    this.closeEmitter.dispose();
    this.dataEmitter.dispose();
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
