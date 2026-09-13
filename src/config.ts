import * as vscode from 'vscode';
import { PackageManagerSetting, normalizePackageManagerSetting } from './detect';

export type BrowserMode = 'external' | 'simple' | 'none';

export interface GoLiveConfig {
  staticPort: number;
  npmScript: string;
  packageManager: PackageManagerSetting;
  alwaysInstall: boolean;
  browser: BrowserMode;
  showTerminalOnStart: boolean;
  staticRoot: string;
  inspect: boolean;
  devtoolsWorkspace: boolean;
  staticHost: '127.0.0.1' | '0.0.0.0';
  cors: boolean;
}

const BROWSER_MODES: ReadonlySet<string> = new Set(['external', 'simple', 'none']);

/** 설정은 settings.json 에서 임의 값이 올 수 있으므로 타입과 허용 목록을 여기서 강제한다 */
export function getConfig(scope?: vscode.ConfigurationScope): GoLiveConfig {
  const c = vscode.workspace.getConfiguration('goLive', scope);
  const port = c.get<unknown>('staticPort', 5500);
  const browser = c.get<unknown>('browser', 'external');
  const str = (key: string) => {
    const v = c.get<unknown>(key, '');
    return typeof v === 'string' ? v : '';
  };
  return {
    staticPort: typeof port === 'number' && Number.isInteger(port) && port >= 0 && port <= 65535 ? port : 5500,
    npmScript: str('npmScript'),
    packageManager: normalizePackageManagerSetting(c.get<unknown>('packageManager', 'auto')),
    alwaysInstall: c.get<unknown>('alwaysInstall', false) === true,
    browser: typeof browser === 'string' && BROWSER_MODES.has(browser) ? (browser as BrowserMode) : 'external',
    showTerminalOnStart: c.get<unknown>('showTerminalOnStart', false) === true,
    staticRoot: str('staticRoot'),
    inspect: c.get<unknown>('inspect', true) !== false,
    devtoolsWorkspace: c.get<unknown>('devtoolsWorkspace', true) !== false,
    staticHost: c.get<unknown>('staticHost', 'localhost') === 'network' ? '0.0.0.0' : '127.0.0.1',
    cors: c.get<unknown>('cors', false) === true,
  };
}
