/**
 * CSS 텍스트에서 규칙의 위치(줄 번호)를 찾는다.
 * 브라우저의 CSSOM 은 규칙을 순서대로 번호 매기므로(@import 같은 세미콜론 규칙 포함),
 * 여기서도 같은 순서로 세어야 브라우저가 보낸 경로([상위 인덱스, 하위 인덱스...])와 맞는다.
 * vscode 모듈에 의존하지 않는다 (단위 테스트 대상).
 */

export interface CssBlock {
  /** 규칙 시작 오프셋 (프렐류드 첫 글자) */
  start: number;
  /** 1부터 시작하는 줄 번호 */
  line: number;
  /** 선택자 또는 @규칙 머리 (예: ".hero h1", "@media (max-width: 600px)") */
  prelude: string;
  /** @media 같은 그룹 규칙의 하위 규칙. 스타일 규칙은 빈 배열 */
  children: CssBlock[];
}

/** 하위 규칙을 담는 그룹 @규칙. CSSOM 에서 cssRules 를 가진다 */
const GROUP_AT_RULES = /^@(media|supports|layer|container|document|scope|starting-style)\b/i;

/** 텍스트를 CSSOM 순서의 규칙 트리로 파싱한다. 선언부는 해석하지 않는다 */
export function parseCssBlocks(text: string): CssBlock[] {
  let i = 0;
  const n = text.length;

  const lineAt = (pos: number) => {
    let line = 1;
    for (let k = 0; k < pos && k < n; k++) {
      if (text.charCodeAt(k) === 10) {
        line++;
      }
    }
    return line;
  };

  /** 문자열/주석을 건너뛰며 다음 의미 있는 문자 위치로 이동. 반환값은 현재 문자 */
  const skipNoise = (): boolean => {
    // 주석
    if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;
      return true;
    }
    const c = text[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && text[j] !== c) {
        if (text[j] === '\\') {
          j++;
        }
        j++;
      }
      i = Math.min(j + 1, n);
      return true;
    }
    return false;
  };

  const skipBlock = (): void => {
    // i 는 '{' 위치. 짝이 맞는 '}' 다음으로 이동
    let depth = 0;
    while (i < n) {
      if (skipNoise()) {
        continue;
      }
      const c = text[i];
      if (c === '{') {
        depth++;
      } else if (c === '}') {
        depth--;
        if (depth === 0) {
          i++;
          return;
        }
      }
      i++;
    }
  };

  const parseList = (): CssBlock[] => {
    const out: CssBlock[] = [];
    let preludeStart = -1;
    while (i < n) {
      if (skipNoise()) {
        continue;
      }
      const c = text[i];
      if (c === '}') {
        // 상위 그룹의 끝
        i++;
        return out;
      }
      if (/\s/.test(c)) {
        i++;
        continue;
      }
      if (preludeStart < 0) {
        preludeStart = i;
      }
      if (c === ';') {
        // 세미콜론으로 끝나는 @규칙 (@import, @charset, @layer a, b;)
        const prelude = text.slice(preludeStart, i).trim();
        if (prelude.startsWith('@')) {
          out.push({ start: preludeStart, line: lineAt(preludeStart), prelude, children: [] });
        }
        preludeStart = -1;
        i++;
        continue;
      }
      if (c === '{') {
        const prelude = text.slice(preludeStart, i).trim();
        const block: CssBlock = { start: preludeStart, line: lineAt(preludeStart), prelude, children: [] };
        if (GROUP_AT_RULES.test(prelude)) {
          i++; // '{' 다음부터 하위 목록
          block.children = parseList();
        } else {
          skipBlock();
        }
        out.push(block);
        preludeStart = -1;
        continue;
      }
      i++;
    }
    return out;
  };

  return parseList();
}

/** CSSOM 경로([i, j, ...])로 규칙을 찾는다. 없으면 undefined */
export function findBlockByPath(blocks: CssBlock[], path: number[]): CssBlock | undefined {
  let list = blocks;
  let node: CssBlock | undefined;
  for (const idx of path) {
    node = list[idx];
    if (!node) {
      return undefined;
    }
    list = node.children;
  }
  return node;
}

export interface StyleTag {
  /** <style> 내용 시작 오프셋 */
  contentStart: number;
  content: string;
  /** 내용 시작 줄 (1부터) */
  line: number;
}

/** HTML 안의 <style> 태그들을 문서 순서대로 찾는다 (CSSOM 의 인라인 시트 순서와 같다) */
export function findStyleTags(html: string): StyleTag[] {
  const out: StyleTag[] = [];
  const re = /<style\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const contentStart = m.index + m[0].length;
    const end = html.toLowerCase().indexOf('</style', contentStart);
    const content = html.slice(contentStart, end < 0 ? html.length : end);
    const line = html.slice(0, contentStart).split('\n').length;
    out.push({ contentStart, content, line });
  }
  return out;
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * 브라우저가 보낸 <style> 을 HTML 소스에서 찾는다.
 * 문서 순서 인덱스는 Tailwind CDN 처럼 런타임에 끼어드는 <style> 때문에 어긋날 수 있으므로,
 * 내용 앞부분(snippet)이 일치하는 태그를 우선하고, 없으면 인덱스로 돌아간다.
 */
export function findStyleTag(html: string, styleIndex: number, snippet?: string): StyleTag | undefined {
  const tags = findStyleTags(html);
  if (snippet) {
    const want = squash(snippet);
    if (want) {
      const hit = tags.find((tg) => squash(tg.content).startsWith(want));
      if (hit) {
        return hit;
      }
    }
  }
  return tags[styleIndex];
}

/**
 * 인라인 <style> 의 규칙 줄 번호 = 태그 내용 시작 줄 + 규칙의 상대 줄 - 1
 */
export function locateInlineRule(html: string, styleIndex: number, path: number[], snippet?: string): number | undefined {
  const tag = findStyleTag(html, styleIndex, snippet);
  if (!tag) {
    return undefined;
  }
  const block = findBlockByPath(parseCssBlocks(tag.content), path);
  return block ? tag.line + block.line - 1 : undefined;
}
