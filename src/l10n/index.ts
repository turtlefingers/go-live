/**
 * 사용자 노출 문자열 모듈.
 * 모든 문자열은 ko.json에 두고 코드에서는 키로만 참조한다.
 * 다른 언어를 추가하려면 en.json을 만들고 아래 bundles에 등록하면 된다.
 */
import ko from './ko.json';

type Bundle = Record<string, string>;
const bundles: Record<string, Bundle> = { ko };

let current: Bundle = ko;

/** vscode.env.language 값을 넘기면 해당 언어 번들이 있을 때만 전환한다. 기본은 한국어. */
export function setLanguage(language: string): void {
  const short = language.toLowerCase().split('-')[0];
  current = bundles[short] ?? ko;
}

/** `{0}`, `{1}` 자리표시자를 인자로 치환한다. 키가 없으면 키 자체를 돌려준다. */
export function t(key: string, ...args: Array<string | number>): string {
  const template = current[key] ?? (ko as Bundle)[key] ?? key;
  return template.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)] ?? ''));
}
