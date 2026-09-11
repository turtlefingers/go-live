/**
 * 에러 매핑 테이블.
 * stdout+stderr 전체 문자열(ANSI 제거)에 대해 순서대로 매칭하고 첫 매치를 쓴다.
 * 새 규칙을 추가할 때는 반드시 test/fixtures 에 재현 케이스도 함께 추가한다.
 *
 * 이 모듈은 vscode 모듈에 의존하지 않는다 (단위 테스트 대상).
 */

export type Stage = 'check' | 'install' | 'dev';

export interface MatchContext {
  /** ANSI 제거된 전체 출력 */
  output: string;
  stage: Stage;
  /** 워크스페이스 루트 절대 경로 */
  root: string;
  /** spawn 자체가 실패한 경우의 에러 코드 (예: ENOENT) */
  spawnErrorCode?: string;
  /** spawn 실패한 실행 파일 이름 */
  spawnCommand?: string;
}

/** 사용자가 버튼으로 고를 수 있는 액션 */
export type UserAction =
  | { kind: 'openUrl'; labelKey: string; url: string }
  | { kind: 'openGuide'; labelKey: string }
  | { kind: 'retryPort'; labelKey: string }
  | { kind: 'showTerminal'; labelKey: string }
  | { kind: 'retry'; labelKey: string }
  | { kind: 'openSettings'; labelKey: string; setting: string }
  | { kind: 'reinstall'; labelKey: string };

/** 사용자에게 묻지 않고 확장이 자동으로 수행하는 복구 */
export type AutoRecovery = 'fallbackNpm' | 'legacyPeerDeps' | 'reinstall';

export interface ErrorRule {
  id: string;
  match: (ctx: MatchContext) => boolean;
  /** ko.json 키 */
  messageKey: string;
  actions: UserAction[];
  /** 자동 복구 (한 번만 시도). 있으면 사용자에게 묻지 않고 진행한다 */
  auto?: AutoRecovery;
  /** 자동 복구를 이미 시도했는데 다시 같은 규칙에 걸리면 보여줄 액션 */
  fallbackActions?: UserAction[];
}

export const NODE_DOWNLOAD_URL = 'https://nodejs.org/ko/download';

const showTerminal: UserAction = { kind: 'showTerminal', labelKey: 'action.showTerminal' };
const retry: UserAction = { kind: 'retry', labelKey: 'action.retry' };
const download: UserAction = { kind: 'openUrl', labelKey: 'action.download', url: NODE_DOWNLOAD_URL };

const re = (pattern: RegExp) => (ctx: MatchContext) => pattern.test(ctx.output);

export const ERROR_RULES: ErrorRule[] = [
  {
    id: 'node-missing',
    match: (ctx) =>
      (ctx.spawnErrorCode === 'ENOENT' && /^(node|npm|npx)(\.cmd|\.exe)?$/i.test(ctx.spawnCommand ?? '')) ||
      /\b(node|npm)(\.cmd|\.exe)?: (command not found|not found)\b/i.test(ctx.output) ||
      /'(node|npm)' is not recognized as an internal or external command/i.test(ctx.output) ||
      /spawn (node|npm)(\.cmd|\.exe)? ENOENT/i.test(ctx.output),
    messageKey: 'err.nodeMissing',
    actions: [download, { kind: 'openGuide', labelKey: 'action.installGuide' }],
  },
  {
    id: 'port-in-use',
    match: re(/EADDRINUSE|address already in use|port \d+ is (already )?in use/i),
    messageKey: 'err.portInUse',
    actions: [{ kind: 'retryPort', labelKey: 'action.retryPort' }, showTerminal],
  },
  {
    id: 'permission',
    match: re(/\b(EACCES|EPERM)\b|permission denied|operation not permitted/i),
    messageKey: 'err.permission',
    actions: [showTerminal],
  },
  {
    id: 'pnpm-missing',
    match: (ctx) =>
      (ctx.spawnErrorCode === 'ENOENT' && /^(pnpm|yarn|bun)(\.cmd|\.exe)?$/i.test(ctx.spawnCommand ?? '')) ||
      /\b(pnpm|yarn|bun)(\.cmd)?: (command not found|not found)|'(pnpm|yarn|bun)' is not recognized|ERR_PNPM_/i.test(ctx.output),
    messageKey: 'err.pnpmMissing',
    actions: [],
    auto: 'fallbackNpm',
    fallbackActions: [showTerminal],
  },
  {
    id: 'peer-conflict',
    match: (ctx) =>
      ctx.stage === 'install' && /\bERESOLVE\b|peer dep|peerDependencies|conflicting peer dependency/i.test(ctx.output),
    messageKey: 'err.peerConflict',
    actions: [],
    auto: 'legacyPeerDeps',
    fallbackActions: [showTerminal],
  },
  {
    id: 'network',
    match: re(
      /\b(ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN|E404)\b|network (error|request failed|timeout)|getaddrinfo|FetchError|request to https?:\/\/registry|Not Found - GET https?:\/\/registry/i
    ),
    messageKey: 'err.network',
    actions: [retry, showTerminal],
  },
  {
    id: 'file-busy',
    match: re(/\b(EBUSY|ENOTEMPTY)\b/i),
    messageKey: 'err.fileBusy',
    actions: [showTerminal],
  },
  {
    id: 'missing-script',
    match: re(/Missing script:|npm ERR! missing script|error Command "[^"]+" not found|Command "[^"]+" not found|script "[^"]+" not found|Script not found/i),
    messageKey: 'err.missingScript',
    actions: [{ kind: 'openSettings', labelKey: 'action.openSettings', setting: 'goLive.npmScript' }, showTerminal],
  },
  {
    id: 'bad-engine',
    match: re(
      /Unsupported engine|EBADENGINE|You are using Node\.js [\d.]+\. .*(requires|supported)|Node\.js version [\d.]+ is not supported|requires Node(\.js)? (version )?[>=^~v]?\d/i
    ),
    messageKey: 'err.badEngine',
    actions: [download, showTerminal],
  },
  {
    id: 'missing-module',
    match: re(/ERR_MODULE_NOT_FOUND|Cannot find module|Cannot find package|Failed to resolve import|failed to load config .* Cannot find/i),
    messageKey: 'err.missingModule',
    actions: [],
    auto: 'reinstall',
    fallbackActions: [{ kind: 'reinstall', labelKey: 'action.reinstall' }, showTerminal],
  },
  {
    id: 'path-warning',
    // 실패했고, 다른 규칙이 하나도 안 맞았을 때만 여기까지 온다
    match: (ctx) => /[가-힣]/.test(ctx.root) || /\s/.test(ctx.root),
    messageKey: 'err.pathWarning',
    actions: [showTerminal],
  },
];

export interface Classification {
  rule?: ErrorRule;
  messageKey: string;
  /** messageKey 의 {0}.. 치환 인자 */
  messageArgs?: string[];
  actions: UserAction[];
  auto?: AutoRecovery;
}

/**
 * 출력과 문맥으로 사용자 메시지를 결정한다.
 * @param triedAuto 이미 시도한 자동 복구 목록. 같은 규칙이 다시 걸리면 fallbackActions를 쓴다.
 */
export function classify(ctx: MatchContext, triedAuto: ReadonlySet<AutoRecovery> = new Set()): Classification {
  for (const rule of ERROR_RULES) {
    if (!rule.match(ctx)) {
      continue;
    }
    if (rule.auto && !triedAuto.has(rule.auto)) {
      return { rule, messageKey: rule.messageKey, actions: rule.actions, auto: rule.auto };
    }
    return { rule, messageKey: rule.messageKey, actions: rule.fallbackActions ?? rule.actions };
  }
  return { messageKey: 'msg.genericFail', actions: [showTerminal] };
}
