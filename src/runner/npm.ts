/**
 * npm 모드: install → dev 실행 → URL 감지.
 * 실패하면 errors.ts 의 매핑 테이블로 분류하고, 자동 복구가 가능한 경우
 * (npm 폴백, --legacy-peer-deps, node_modules 재설치) 한 번씩 재시도한다.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ProcessTerminal, RunResult } from './pty';
import { UrlDetector, DetectedUrl } from './url';
import { devArgs, installArgs } from './commands';
import { lanArgs } from '../lan';
import { classify, Classification, AutoRecovery, Stage } from '../errors';
import {
  commandExists,
  detectPackageManager,
  hasNodeModules,
  lockfileHash,
  PackageManager,
  pickScript,
  readPackageJson,
} from '../detect';
import { GoLiveConfig } from '../config';
import { State } from '../statusBar';
import { t } from '../l10n';

export interface NpmSessionOptions {
  root: string;
  config: GoLiveConfig;
  workspaceState: vscode.Memento;
  /** node 를 찾을 수 있도록 PATH 가 보강된 env */
  env: NodeJS.ProcessEnv;
  pty: ProcessTerminal;
  onState: (state: State) => void;
  /** 자동 복구 등 진행 상황을 학생에게 알릴 때 */
  notify: (message: string) => void;
  forceInstall?: boolean;
  cleanInstall?: boolean;
  /** 포트 충돌 재시도 시 지정 */
  port?: number;
  /** 휴대폰 등 다른 기기에서 접속할 수 있게 dev 서버를 0.0.0.0 에 듣게 한다 */
  lan?: boolean;
}

export type SessionOutcome =
  | { kind: 'running'; url?: string; warnKey?: string }
  | { kind: 'cancelled' }
  | { kind: 'failed'; classification: Classification; stage: Stage };

type DevOutcome =
  | { kind: 'url'; url: string }
  | { kind: 'timeout' }
  | { kind: 'exited'; result: RunResult }
  | { kind: 'cancelled' };

const URL_TIMEOUT_MS = 30_000;
/** 첫 URL 이 "Local:" 줄이 아닐 때, 더 나은 URL 이 찍히길 기다리는 시간 (백엔드 → 프론트 순서 대응) */
const URL_GRACE_MS = 2_500;
const MAX_ATTEMPTS = 5;
export const LOCKFILE_HASH_KEY = 'goLive.lockfileHash';
/** 워크스페이스 안에 프로젝트가 여러 개일 수 있으므로 폴더별로 저장한다 */
export const lockfileHashKey = (root: string) => `${LOCKFILE_HASH_KEY}:${root}`;

export class NpmSession {
  private cancelled = false;
  private readonly triedAuto = new Set<AutoRecovery>();
  private readonly devExitEmitter = new vscode.EventEmitter<RunResult>();
  /** URL 감지 이후(= running 상태에서) dev 프로세스가 스스로 종료됐을 때 */
  readonly onDevExit = this.devExitEmitter.event;

  private pm: PackageManager = 'npm';
  private legacyPeer = false;
  private clean = false;
  private needsInstall = false;
  private scriptCommand = '';

  constructor(private readonly o: NpmSessionOptions) {}

  async start(): Promise<SessionOutcome> {
    const { root, config, env, pty } = this.o;

    // 1. package.json / 스크립트
    const pkg = readPackageJson(root);
    if (pkg === undefined || pkg === 'invalid') {
      return this.fail('check', { messageKey: 'msg.badPackageJson', actions: [] });
    }
    const pick = pickScript(pkg, config.npmScript);
    const openSettings = { kind: 'openSettings', labelKey: 'action.openSettings', setting: 'goLive.npmScript' } as const;
    if (pick.kind !== 'ok') {
      const messageKey =
        pick.kind === 'forcedMissing' ? 'msg.scriptNotFound' : pick.kind === 'forcedInvalid' ? 'msg.scriptNameInvalid' : 'msg.noScript';
      const arg = pick.kind === 'none' ? '' : pick.script;
      return this.fail('check', { messageKey, messageArgs: [arg], actions: [openSettings] });
    }
    const script = pick.script;
    this.scriptCommand = pkg.scripts?.[script] ?? '';

    // 2. 패키지 매니저
    this.pm = detectPackageManager(root, pkg, config.packageManager);
    if (this.pm !== 'npm' && !(await commandExists(this.pm, env))) {
      this.o.notify(t('msg.pmFallback', this.pm));
      this.pm = 'npm';
      this.triedAuto.add('fallbackNpm');
    }
    if (this.cancelled) {
      return { kind: 'cancelled' };
    }

    // 3. 설치 필요 여부
    this.clean = !!this.o.cleanInstall;
    this.needsInstall =
      !!this.o.forceInstall ||
      config.alwaysInstall ||
      this.clean ||
      !hasNodeModules(root) ||
      this.o.workspaceState.get<string>(lockfileHashKey(root)) !== lockfileHash(root);

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (this.cancelled) {
        return { kind: 'cancelled' };
      }

      // 4. install
      if (this.needsInstall) {
        this.o.onState('installing');
        if (this.clean) {
          pty.writeLine(t('msg.reinstalling'));
          await fs.promises.rm(path.join(root, 'node_modules'), { recursive: true, force: true });
          this.clean = false;
        }
        const result = await pty.run({ command: this.pm, args: installArgs(this.pm, this.legacyPeer), cwd: root, env });
        if (this.cancelled || result.killed) {
          return { kind: 'cancelled' };
        }
        if (result.code !== 0) {
          const cls = classify(
            { output: result.output, stage: 'install', root, spawnErrorCode: result.spawnError?.code, spawnCommand: this.pm },
            this.triedAuto
          );
          if (cls.auto) {
            this.applyAuto(cls.auto);
            continue;
          }
          return this.fail('install', cls);
        }
        await this.o.workspaceState.update(lockfileHashKey(root), lockfileHash(root));
        this.needsInstall = false;
      }

      // 5. dev
      this.o.onState('starting');
      const dev = await this.runDev(script);
      switch (dev.kind) {
        case 'url':
          return { kind: 'running', url: dev.url };
        case 'timeout':
          return { kind: 'running', warnKey: 'msg.urlTimeout' };
        case 'cancelled':
          return { kind: 'cancelled' };
        case 'exited': {
          const cls = classify(
            { output: dev.result.output, stage: 'dev', root, spawnErrorCode: dev.result.spawnError?.code, spawnCommand: this.pm },
            this.triedAuto
          );
          if (cls.auto) {
            this.applyAuto(cls.auto);
            continue;
          }
          return this.fail('dev', cls);
        }
      }
    }
    return this.fail('dev', { messageKey: 'msg.genericFail', actions: [{ kind: 'showTerminal', labelKey: 'action.showTerminal' }] });
  }

  /** 실행 중지. 프로세스 트리를 종료한다 */
  async stop(): Promise<void> {
    this.cancelled = true;
    await this.o.pty.kill();
  }

  dispose(): void {
    this.devExitEmitter.dispose();
  }

  // ── 내부 ────────────────────────────────────────────────────────────────

  private fail(stage: Stage, classification: Classification): SessionOutcome {
    return { kind: 'failed', stage, classification };
  }

  private applyAuto(auto: AutoRecovery): void {
    this.triedAuto.add(auto);
    this.needsInstall = true;
    switch (auto) {
      case 'fallbackNpm':
        this.o.notify(t('err.pnpmMissing'));
        this.pm = 'npm';
        break;
      case 'legacyPeerDeps':
        this.o.notify(t('msg.legacyPeerRetry'));
        this.legacyPeer = true;
        break;
      case 'reinstall':
        this.o.notify(t('msg.autoReinstall'));
        this.clean = true;
        break;
    }
  }

  private runDev(script: string): Promise<DevOutcome> {
    const { root, pty } = this.o;
    const port = this.o.port;
    const env: NodeJS.ProcessEnv = {
      ...this.o.env,
      // CRA 등 dev 서버가 스스로 브라우저를 여는 것을 막는다. 브라우저는 확장이 연다
      BROWSER: 'none',
      ...(port ? { PORT: String(port) } : {}),
      // CRA 등은 HOST 환경변수로 바인딩 주소를 정한다
      ...(this.o.lan ? { HOST: '0.0.0.0' } : {}),
    };
    const extra = this.o.lan ? lanArgs(this.scriptCommand) : [];

    return new Promise<DevOutcome>((resolve) => {
      const detector = new UrlDetector();
      let settled = false;
      let candidate: DetectedUrl | undefined;
      let graceTimer: NodeJS.Timeout | undefined;

      const settle = (v: DevOutcome) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (graceTimer) {
          clearTimeout(graceTimer);
        }
        sub.dispose();
        resolve(v);
      };

      const sub = pty.onData((chunk) => {
        for (const hit of detector.push(chunk)) {
          if (hit.preferred) {
            settle({ kind: 'url', url: hit.url });
            return;
          }
          if (!candidate) {
            // 백엔드 로그일 수 있으니 잠시 기다렸다가, 더 나은 주소가 없으면 이걸 쓴다
            candidate = hit;
            graceTimer = setTimeout(() => settle({ kind: 'url', url: hit.url }), URL_GRACE_MS);
          }
        }
      });
      const timer = setTimeout(() => settle({ kind: 'timeout' }), URL_TIMEOUT_MS);

      pty
        .run({ command: this.pm, args: devArgs(this.pm, script, port, extra), cwd: root, env, watchdog: true })
        .then((result) => {
          if (settled) {
            // running 상태에서 종료됨 → 정상 stop 이 아니면 알린다
            if (!result.killed && !this.cancelled) {
              this.devExitEmitter.fire(result);
            }
            return;
          }
          if (result.killed || this.cancelled) {
            settle({ kind: 'cancelled' });
          } else if (candidate && result.code === 0) {
            settle({ kind: 'url', url: candidate.url });
          } else {
            settle({ kind: 'exited', result });
          }
        });
    });
  }
}
