/**
 * 상태바 아이템 상태 머신.
 * idle → checking → installing → starting → running, 실패 시 error.
 */
import * as vscode from 'vscode';
import { t } from './l10n';

export type State = 'idle' | 'checking' | 'installing' | 'starting' | 'running' | 'error';

export interface StateDetail {
  url?: string;
  port?: number;
}

export class StatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private _state: State = 'idle';
  private _detail: StateDetail = {};

  constructor() {
    this.item = vscode.window.createStatusBarItem('goLive.status', vscode.StatusBarAlignment.Right, 100);
    this.item.name = 'Go Live';
    this.item.command = 'goLive.toggle';
    this.render();
    this.item.show();
  }

  get state(): State {
    return this._state;
  }

  get detail(): StateDetail {
    return this._detail;
  }

  /** 시작 흐름이 진행 중이거나 실행 중이면 true (클릭 시 stop 으로 해석) */
  get isActive(): boolean {
    return this._state === 'checking' || this._state === 'installing' || this._state === 'starting' || this._state === 'running';
  }

  set(state: State, detail: StateDetail = {}): void {
    this._state = state;
    this._detail = detail;
    this.render();
  }

  private render(): void {
    const item = this.item;
    item.backgroundColor = undefined;
    switch (this._state) {
      case 'idle':
        item.text = t('statusBar.idle');
        item.tooltip = t('statusBar.idle.tooltip');
        break;
      case 'checking':
        item.text = t('statusBar.checking');
        item.tooltip = t('statusBar.checking.tooltip');
        break;
      case 'installing':
        item.text = t('statusBar.installing');
        item.tooltip = t('statusBar.installing.tooltip');
        break;
      case 'starting':
        item.text = t('statusBar.starting');
        item.tooltip = t('statusBar.starting.tooltip');
        break;
      case 'running': {
        const port = this._detail.port !== undefined ? String(this._detail.port) : '';
        item.text = t('statusBar.running', port).replace(/ :$/, '');
        item.tooltip = t('statusBar.running.tooltip', this._detail.url ?? '');
        item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        break;
      }
      case 'error':
        item.text = t('statusBar.error');
        item.tooltip = t('statusBar.error.tooltip');
        item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        break;
    }
  }

  dispose(): void {
    this.item.dispose();
  }
}
