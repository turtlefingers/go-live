/**
 * dev 서버 stdout에서 로컬 URL을 찾아 localhost로 정규화한다.
 * vscode 모듈에 의존하지 않아 단위 테스트가 가능하다.
 */

export const LOCAL_URL_RE =
  /(https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):\d+\/?[^\s]*)/;

/** ANSI 이스케이프 시퀀스 제거 (색상, 커서 이동, OSC 하이퍼링크 등) */
export function stripAnsi(text: string): string {
  return text.replace(
    // eslint-disable-next-line no-control-regex
    /[\u001b\u009b][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-ntqry=><~]))/g,
    ''
  );
}

/** 텍스트에서 첫 로컬 URL을 찾아 정규화해 돌려준다. 없으면 undefined. */
export function findLocalUrl(text: string): string | undefined {
  const m = LOCAL_URL_RE.exec(stripAnsi(text));
  if (!m) {
    return undefined;
  }
  return normalizeLocalUrl(m[1]);
}

export function normalizeLocalUrl(raw: string): string {
  // 뒤에 붙은 문장부호/닫는 괄호 제거 (예: "http://localhost:5173/)" 또는 "…/," )
  const cleaned = raw.replace(/[)\],.'"`>]+$/, '');
  try {
    const u = new URL(cleaned);
    u.hostname = 'localhost';
    return u.toString();
  } catch {
    return cleaned.replace(/\/\/(127\.0\.0\.1|0\.0\.0\.0|\[::1?\])/, '//localhost');
  }
}

/** URL 문자열에서 포트를 뽑는다. 명시된 포트가 없으면 undefined. */
export function portOf(url: string): number | undefined {
  try {
    const p = new URL(url).port;
    return p ? Number(p) : undefined;
  } catch {
    return undefined;
  }
}

/** dev 서버가 "이게 사용자가 열 주소"라고 표시하는 줄 (Vite/Next/Astro "Local:", webpack "Loopback:") */
export function isPreferredUrlLine(line: string): boolean {
  return /\b(local|loopback)\b/i.test(stripAnsi(line));
}

export interface DetectedUrl {
  url: string;
  /** "Local:" 같은 줄에서 나온 URL 이면 true. 백엔드 로그보다 우선한다 */
  preferred: boolean;
}

/**
 * 스트림 청크를 받아 완성된 줄에서 로컬 URL 을 찾아낸다.
 * concurrently 등으로 백엔드와 프론트가 함께 뜰 때, 먼저 찍힌 백엔드 주소 대신
 * 프론트의 "Local:" 주소를 고를 수 있도록 preferred 플래그를 함께 돌려준다.
 */
export class UrlDetector {
  private buffer = '';

  push(chunk: string): DetectedUrl[] {
    this.buffer += chunk;
    const found: DetectedUrl[] = [];
    let nl: number;
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      const url = findLocalUrl(line);
      if (url) {
        found.push({ url, preferred: isPreferredUrlLine(line) });
      }
    }
    // 줄바꿈 없이 무한히 쌓이는 출력 방어 (프로그레스 바 등)
    if (this.buffer.length > 20_000) {
      this.buffer = this.buffer.slice(-5_000);
    }
    return found;
  }
}

/**
 * 서버 루트 기준으로 파일의 URL 을 만든다. index.html 은 폴더 경로로, 루트 밖 파일은 base 그대로.
 * 경로 구분자는 OS 와 무관하게 처리한다 (Windows 의 \\ 포함).
 */
export function urlForFile(baseUrl: string, root: string, file: string): string {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '');
  const r = norm(root);
  const f = norm(file);
  const base = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
  const lower = (x: string) => (process.platform === 'win32' || process.platform === 'darwin' ? x.toLowerCase() : x);
  if (!(lower(f) === lower(r) || lower(f).startsWith(lower(r) + '/'))) {
    return base;
  }
  let rel = f.slice(r.length).replace(/^\//, '');
  if (/(^|\/)index\.html?$/i.test(rel)) {
    rel = rel.replace(/index\.html?$/i, '');
  }
  return base + rel.split('/').map(encodeURIComponent).join('/');
}
