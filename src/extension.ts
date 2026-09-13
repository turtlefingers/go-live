/**
 * Go Live 진입점.
 * - 상태바 버튼 하나로 정적 모드(내장 정적 서버)와 npm 모드(install → dev)를 동일하게 다룬다
 * - 평소엔 상태바와 브라우저만 보이고, 터미널은 실패했을 때만 나타난다
 */
import * as vscode from 'vscode';
import { StatusBar } from './statusBar';
import { getConfig, BrowserMode } from './config';
import { hasPackageJson, resolveNodeEnv, findNearestProjectDir } from './detect';
import * as path from 'path';
import * as crypto from 'crypto';
import { StaticServer, InspectEvent } from './runner/static';
import { NpmSession } from './runner/npm';
import { freePort } from './runner/commands';
import { ProcessTerminal } from './runner/pty';
import { portOf, urlForFile } from './runner/url';
import { resolveStaticRoot } from './runner/static';
import { classify, Classification, NODE_DOWNLOAD_URL, UserAction } from './errors';
import { setLanguage, t } from './l10n';
import { lanAddress, isReachable, qrSvg } from './lan';

interface StartOptions {
  forceInstall?: boolean;
  cleanInstall?: boolean;
  port?: number;
  /** 정적 모드에서 시작 후 브라우저로 열 파일 (절대 경로). npm 모드에서는 무시된다 */
  openFile?: string;
  /** 실행할 프로젝트 폴더. 없으면 워크스페이스 루트. 워크스페이스 안이어야 한다 */
  root?: string;
  /** 휴대폰 등 다른 기기에서 접속할 수 있게 0.0.0.0 에 듣는다 */
  lan?: boolean;
  /** 브라우저를 열지 않는다 (이미 열려 있는 상태에서 다시 시작할 때) */
  noBrowser?: boolean;
}

class Controller implements vscode.Disposable {
  private readonly status = new StatusBar();
  private readonly staticServer = new StaticServer();
  private session: NpmSession | undefined;
  private pty: ProcessTerminal | undefined;
  private terminal: vscode.Terminal | undefined;
  private busy = false;
  private stopRequested = false;
  /** 지금 실행 중(또는 시작 중)인 프로젝트 폴더 */
  private activeRoot: string | undefined;
  private phonePanel: vscode.WebviewPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly context: vscode.ExtensionContext) {
    this.staticServer.on('inspect', (e: InspectEvent) => void this.onInspect(e));
    this.disposables.push(
      vscode.window.onDidCloseTerminal((term) => {
        if (term === this.terminal) {
          this.terminal = undefined;
          if (this.session) {
            void this.stop();
          }
        }
      })
    );
  }

  // ── 명령 ────────────────────────────────────────────────────────────────

  toggle(): Promise<void> {
    return this.status.isActive ? this.stop() : this.start();
  }

  async start(opts: StartOptions = {}): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      void vscode.window.showWarningMessage(t('msg.noWorkspace'));
      return;
    }
    if (this.busy || this.status.isActive) {
      return;
    }
    const wsRoot = folder.uri.fsPath;
    const root = opts.root && (opts.root === wsRoot || opts.root.startsWith(wsRoot + path.sep)) ? opts.root : wsRoot;
    const config = getConfig(folder);
    this.activeRoot = root;

    this.busy = true;
    this.stopRequested = false;
    this.status.set('checking');
    try {
      if (hasPackageJson(root)) {
        await this.startNpm(root, config, opts);
      } else {
        await this.startStatic(root, config, opts);
      }
    } catch (e) {
      this.status.set('error');
      const message = e instanceof Error ? e.message : String(e);
      // 설정 문제는 설정 화면으로 안내한다
      if (e instanceof Error && e.message === t('msg.staticRootOutside', config.staticRoot)) {
        const open = t('action.openSettings');
        void vscode.window.showErrorMessage(message, open).then((choice) => {
          if (choice === open) {
            void vscode.commands.executeCommand('workbench.action.openSettings', 'goLive.staticRoot');
          }
        });
      } else {
        void vscode.window.showErrorMessage(t('msg.staticFail', message));
      }
    } finally {
      this.busy = false;
      if (this.stopRequested && this.status.isActive) {
        await this.stop();
      }
    }
  }

  async stop(): Promise<void> {
    this.stopRequested = true;
    const session = this.session;
    this.session = undefined;
    if (session) {
      await session.stop();
      session.dispose();
    }
    await this.staticServer.stop();
    this.activeRoot = undefined;
    this.status.set('idle');
  }

  async reinstall(): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      void vscode.window.showWarningMessage(t('msg.noWorkspace'));
      return;
    }
    if (!hasPackageJson(folder.uri.fsPath)) {
      void vscode.window.showInformationMessage(t('msg.notNpmProject'));
      return;
    }
    await this.stop();
    await this.start({ cleanInstall: true });
  }

  showTerminal(): void {
    this.terminal?.show(false);
  }

  /**
   * 상태바 휴대폰 버튼. 다른 기기에서 접속 가능하게 (필요하면 다시) 띄우고, 주소와 QR 을 보여준다.
   */
  async openOnPhone(): Promise<void> {
    const ip = lanAddress();
    if (!ip) {
      void vscode.window.showWarningMessage(t('phone.noWifi'));
      return;
    }
    // 이미 다른 기기에서 접속 가능하면(예: 0.0.0.0 에 듣는 Express) 재시작하지 않는다.
    // 재시작은 열려 있는 WebSocket 등 실시간 연결을 끊으므로 꼭 필요할 때만 한다
    let port = this.status.detail.url ? portOf(this.status.detail.url) : undefined;
    const reachable = this.status.state === 'running' && port !== undefined && (await isReachable(ip, port));
    if (!reachable) {
      if (this.status.isActive) {
        void vscode.window.showInformationMessage(t('phone.restarting'));
        await this.stop();
      }
      await this.start({ lan: true, root: this.activeRoot, noBrowser: true });
      if (this.status.state !== 'running') {
        return;
      }
      port = this.status.detail.url ? portOf(this.status.detail.url) : undefined;
      if (port === undefined || !(await isReachable(ip, port))) {
        void vscode.window.showErrorMessage(t('phone.notReachable'));
        return;
      }
    }
    const phoneUrl = `http://${ip}:${port}/`;
    await vscode.env.clipboard.writeText(phoneUrl);
    this.showPhonePanel(phoneUrl);
    void vscode.window.setStatusBarMessage(t('phone.copied', phoneUrl), 5000);
  }

  private showPhonePanel(phoneUrl: string): void {
    const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<style>
  body { font-family: system-ui, -apple-system, "Apple SD Gothic Neo", sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 90vh; margin: 0; gap: 18px; text-align: center; }
  .qr { width: min(60vw, 320px); background: #fff; padding: 12px; border-radius: 16px; }
  .qr svg { width: 100%; height: auto; display: block; }
  .url { font-size: 1.4em; font-weight: 600; user-select: all; word-break: break-all; }
  .hint { opacity: .7; }
</style></head><body>
<div class="qr">${qrSvg(phoneUrl)}</div>
<div class="url">${phoneUrl}</div>
<div class="hint">${t('phone.hint')}</div>
</body></html>`;
    if (!this.phonePanel) {
      this.phonePanel = vscode.window.createWebviewPanel('goLive.phone', t('phone.title'), vscode.ViewColumn.Beside, {});
      this.phonePanel.onDidDispose(() => (this.phonePanel = undefined));
    }
    this.phonePanel.webview.html = html;
    this.phonePanel.reveal(vscode.ViewColumn.Beside);
  }

  /**
   * 우클릭 "Open with Go Live".
   * - package.json → 그 폴더를 npm 모드로 실행
   * - HTML → 가장 가까운 package.json 이 있으면 그 프로젝트를 npm 모드로, 없으면 정적 모드로 그 파일 주소를 연다
   * - 다른 프로젝트가 실행 중이면 먼저 중지한다
   */
  async openWith(resource?: vscode.Uri): Promise<void> {
    const uri = resource ?? vscode.window.activeTextEditor?.document.uri;
    const file = uri?.scheme === 'file' ? uri.fsPath : undefined;
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      void vscode.window.showWarningMessage(t('msg.noWorkspace'));
      return;
    }
    const wsRoot = folder.uri.fsPath;
    const config = getConfig(folder);

    let targetRoot = wsRoot;
    let openFile: string | undefined;
    if (file && path.basename(file) === 'package.json') {
      targetRoot = path.dirname(file);
    } else if (file) {
      const project = findNearestProjectDir(path.dirname(file), wsRoot);
      if (project) {
        targetRoot = project;
      } else {
        openFile = file;
      }
    }

    if (this.status.isActive && this.activeRoot === targetRoot) {
      const url = this.status.detail.url;
      if (!url) {
        return;
      }
      if (hasPackageJson(targetRoot)) {
        await openBrowser(url, config.browser);
      } else {
        const serveRoot = resolveStaticRoot(targetRoot, config.staticRoot) ?? targetRoot;
        await openBrowser(openFile ? urlForFile(url, serveRoot, openFile) : url, config.browser);
      }
      return;
    }
    if (this.status.isActive) {
      await this.stop();
    }
    await this.start({ root: targetRoot, openFile });
  }

  // ── 정적 모드 ───────────────────────────────────────────────────────────

  private async startStatic(root: string, config: ReturnType<typeof getConfig>, opts: StartOptions): Promise<void> {
    this.status.set('starting');
    const url = await this.staticServer.start(root, config.staticRoot.trim(), config.staticPort, {
      inspect: config.inspect,
      devtoolsUuid: config.devtoolsWorkspace ? this.devtoolsUuidFor(root) : undefined,
      host: opts.lan ? '0.0.0.0' : config.staticHost,
      cors: config.cors,
    });
    if (this.stopRequested) {
      return;
    }
    this.status.set('running', { url, port: portOf(url) });
    if (opts.noBrowser) {
      return;
    }
    const serveRoot = resolveStaticRoot(root, config.staticRoot) ?? root;
    await openBrowser(opts.openFile ? urlForFile(url, serveRoot, opts.openFile) : url, config.browser);
  }

  // ── npm 모드 ────────────────────────────────────────────────────────────

  private async startNpm(root: string, config: ReturnType<typeof getConfig>, opts: StartOptions): Promise<void> {
    const node = await resolveNodeEnv();
    if (!node.found) {
      this.status.set('error');
      await this.showNodeMissing();
      return;
    }
    if (this.stopRequested) {
      return;
    }

    // 터미널은 세션마다 새로 만든다. 이전 로그는 버린다
    this.disposeTerminal();
    const pty = new ProcessTerminal();
    this.pty = pty;
    this.terminal = vscode.window.createTerminal({
      name: t('terminal.name'),
      pty,
      iconPath: new vscode.ThemeIcon('radio-tower'),
      isTransient: true,
    });
    if (config.showTerminalOnStart) {
      this.terminal.show(true);
    }

    const session = new NpmSession({
      root,
      config,
      workspaceState: this.context.workspaceState,
      env: node.env,
      pty,
      onState: (s) => this.status.set(s),
      notify: (m) => void vscode.window.showInformationMessage(m),
      forceInstall: opts.forceInstall,
      cleanInstall: opts.cleanInstall,
      port: opts.port,
      lan: opts.lan,
    });
    this.session = session;

    session.onDevExit((result) => {
      if (this.session !== session) {
        return;
      }
      this.session = undefined;
      this.status.set('error');
      this.terminal?.show(true);
      const cls = classify({ output: result.output, stage: 'dev', root }, new Set(['fallbackNpm', 'legacyPeerDeps', 'reinstall']));
      const messageKey = cls.rule ? cls.messageKey : 'msg.devExited';
      void this.showFailure({ ...cls, messageKey });
    });

    const outcome = await session.start();
    if (this.session !== session) {
      // 진행 중 stop 됨
      return;
    }

    switch (outcome.kind) {
      case 'cancelled':
        this.session = undefined;
        this.status.set('idle');
        return;
      case 'failed':
        this.session = undefined;
        this.status.set('error');
        this.terminal?.show(true);
        await this.showFailure(outcome.classification);
        return;
      case 'running':
        this.status.set('running', { url: outcome.url, port: outcome.url ? portOf(outcome.url) : undefined });
        if (outcome.warnKey) {
          this.terminal?.show(true);
          void vscode.window.showWarningMessage(t(outcome.warnKey));
        }
        if (outcome.url && !opts.noBrowser) {
          // npm 모드는 dev 서버가 라우팅을 정하므로 우클릭한 파일과 무관하게 루트를 연다
          // (Vite 는 about.html 을 서빙하지만 CRA/Next 는 그 경로가 404)
          await openBrowser(outcome.url, config.browser);
        }
        return;
    }
  }

  private async showNodeMissing(): Promise<void> {
    const download = t('action.download');
    const guide = t('action.installGuide');
    const choice = await vscode.window.showErrorMessage(
      t('msg.nodeMissing'),
      { modal: true, detail: t('msg.nodeMissing.detail') },
      download,
      guide
    );
    if (choice === download) {
      await vscode.env.openExternal(vscode.Uri.parse(NODE_DOWNLOAD_URL));
    } else if (choice === guide) {
      await this.openGuide();
    }
  }

  private async showFailure(cls: Classification): Promise<void> {
    const labels = cls.actions.map((a) => t(a.labelKey));
    const choice = await vscode.window.showErrorMessage(t(cls.messageKey, ...(cls.messageArgs ?? [])), ...labels);
    if (choice === undefined) {
      return;
    }
    const action = cls.actions[labels.indexOf(choice)];
    if (action) {
      await this.runAction(action);
    }
  }

  private async runAction(action: UserAction): Promise<void> {
    switch (action.kind) {
      case 'openUrl':
        await vscode.env.openExternal(vscode.Uri.parse(action.url));
        return;
      case 'openGuide':
        await this.openGuide();
        return;
      case 'showTerminal':
        this.showTerminal();
        return;
      case 'retry':
        await this.start();
        return;
      case 'retryPort':
        await this.start({ port: await freePort() });
        return;
      case 'openSettings':
        await vscode.commands.executeCommand('workbench.action.openSettings', action.setting);
        return;
      case 'reinstall':
        await this.reinstall();
        return;
    }
  }

  /** Chrome 이 "이미 승인한 폴더"로 기억하도록 프로젝트마다 고정된 uuid 를 쓴다 */
  private devtoolsUuidFor(root: string): string {
    const key = `goLive.devtoolsUuid:${root}`;
    let uuid = this.context.workspaceState.get<string>(key);
    if (!uuid) {
      uuid = crypto.randomUUID();
      void this.context.workspaceState.update(key, uuid);
    }
    return uuid;
  }

  /** 브라우저에서 Alt+클릭한 요소의 CSS 규칙을 에디터에서 연다 */
  private async onInspect(e: InspectEvent): Promise<void> {
    const [first, ...others] = e.candidates;
    if (!first) {
      return;
    }
    await this.revealRule(first.file, first.line);
    if (others.length === 0) {
      return;
    }
    const more = t('inspect.more', others.length);
    const choice = await vscode.window.showInformationMessage(`${e.element} → ${path.basename(first.file)}:${first.line}`, more);
    if (choice !== more) {
      return;
    }
    const picked = await vscode.window.showQuickPick(
      e.candidates.map((c) => ({ label: c.selector, description: `${path.basename(c.file)}:${c.line}`, c })),
      { title: t('inspect.pickTitle', e.element) }
    );
    if (picked) {
      await this.revealRule(picked.c.file, picked.c.line);
    }
  }

  private async revealRule(file: string, line: number): Promise<void> {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
    const pos = new vscode.Position(Math.max(0, line - 1), 0);
    const editor = await vscode.window.showTextDocument(doc, { preserveFocus: false, preview: true });
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
  }

  private async openGuide(): Promise<void> {
    const uri = vscode.Uri.joinPath(this.context.extensionUri, 'docs', 'INSTALL_NODE.md');
    try {
      await vscode.commands.executeCommand('markdown.showPreview', uri);
    } catch {
      await vscode.window.showTextDocument(uri);
    }
  }

  private disposeTerminal(): void {
    const term = this.terminal;
    this.terminal = undefined;
    term?.dispose();
    this.pty?.dispose();
    this.pty = undefined;
  }

  async dispose(): Promise<void> {
    await this.stop();
    this.disposeTerminal();
    this.status.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

async function openBrowser(url: string, mode: BrowserMode): Promise<void> {
  if (mode === 'none') {
    return;
  }
  if (mode === 'simple') {
    try {
      await vscode.commands.executeCommand('simpleBrowser.show', url);
      return;
    } catch {
      /* Simple Browser 가 없는 에디터 → 외부 브라우저로 */
    }
  }
  await vscode.env.openExternal(vscode.Uri.parse(url));
}

let controller: Controller | undefined;

export function activate(context: vscode.ExtensionContext): void {
  setLanguage(vscode.env.language);
  controller = new Controller(context);
  const c = controller;
  context.subscriptions.push(
    vscode.commands.registerCommand('goLive.toggle', () => c.toggle()),
    vscode.commands.registerCommand('goLive.start', () => c.start()),
    vscode.commands.registerCommand('goLive.stop', () => c.stop()),
    vscode.commands.registerCommand('goLive.reinstall', () => c.reinstall()),
    vscode.commands.registerCommand('goLive.showTerminal', () => c.showTerminal()),
    vscode.commands.registerCommand('goLive.openWith', (resource?: vscode.Uri) => c.openWith(resource)),
    vscode.commands.registerCommand('goLive.openOnPhone', () => c.openOnPhone())
  );
}

export async function deactivate(): Promise<void> {
  const c = controller;
  controller = undefined;
  if (c) {
    // 프로세스 트리를 반드시 종료한다 (Windows 에서 고아 프로세스 방지)
    await c.dispose();
  }
}
