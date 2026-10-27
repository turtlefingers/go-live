import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findLocalUrl, portOf, stripAnsi } from '../../src/runner/url';

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

test('Vite 출력에서 Local URL 을 찾아 정규화한다', () => {
  const out = `\n  VITE v5.4.0  ready in 320 ms\n\n  ${ESC}[32m➜${ESC}[39m  ${ESC}[1mLocal${ESC}[22m:   ${ESC}[36mhttp://localhost:${ESC}[1m5173${ESC}[22m/${ESC}[39m\n  ➜  Network: use --host to expose\n`;
  assert.equal(findLocalUrl(out), 'http://localhost:5173/');
  assert.equal(portOf('http://localhost:5173/'), 5173);
});

test('webpack-dev-server 출력', () => {
  const out = '<i> [webpack-dev-server] Project is running at:\n<i> [webpack-dev-server] Loopback: http://localhost:8080/, http://[::1]:8080/\n';
  assert.equal(findLocalUrl(out), 'http://localhost:8080/');
});

test('Parcel 출력', () => {
  assert.equal(findLocalUrl('Server running at http://localhost:1234\n'), 'http://localhost:1234/');
});

test('Next.js 출력', () => {
  const out = '   ▲ Next.js 14.2.3\n   - Local:        http://localhost:3000\n   - Network:      http://192.168.0.5:3000\n';
  assert.equal(findLocalUrl(out), 'http://localhost:3000/');
});

test('Astro 출력', () => {
  const out = ' astro  v4.0.0 ready in 400 ms\n\n┃ Local    http://localhost:4321/\n┃ Network  use --host to expose\n';
  assert.equal(findLocalUrl(out), 'http://localhost:4321/');
});

test('127.0.0.1 / 0.0.0.0 / [::1] 을 localhost 로 정규화한다', () => {
  assert.equal(findLocalUrl('Listening on http://127.0.0.1:3000\n'), 'http://localhost:3000/');
  assert.equal(findLocalUrl('Listening on http://0.0.0.0:4000/app\n'), 'http://localhost:4000/app');
  assert.equal(findLocalUrl('Listening on http://[::1]:5000\n'), 'http://localhost:5000/');
});

test('뒤에 붙은 문장부호를 제거한다', () => {
  assert.equal(findLocalUrl('open (http://localhost:5173/).\n'), 'http://localhost:5173/');
});

test('URL 이 없으면 undefined', () => {
  assert.equal(findLocalUrl('compiling...\n'), undefined);
  assert.equal(findLocalUrl('see https://vitejs.dev/guide\n'), undefined);
});

test('stripAnsi 는 OSC 하이퍼링크도 제거한다', () => {
  const s = `${ESC}]8;;http://localhost:5173/${BEL}link${ESC}]8;;${BEL}`;
  assert.equal(stripAnsi(s), 'link');
});

import { UrlDetector, isPreferredUrlLine } from '../../src/runner/url';

test('UrlDetector: 청크가 URL 중간에서 끊겨도 완성된 줄만 본다', () => {
  const d = new UrlDetector();
  assert.deepEqual(d.push('  ➜  Local:   http://localhost:51'), []);
  assert.deepEqual(d.push('73/\n'), [{ url: 'http://localhost:5173/', preferred: true }]);
});

test('UrlDetector: 백엔드 로그는 preferred=false, Vite Local 은 true', () => {
  const d = new UrlDetector();
  const a = d.push('[0] API listening on http://localhost:3100\n');
  assert.deepEqual(a, [{ url: 'http://localhost:3100/', preferred: false }]);
  const b = d.push('[1]   ➜  Local:   http://localhost:5173/\n[1]   ➜  Network: use --host\n');
  assert.deepEqual(b, [{ url: 'http://localhost:5173/', preferred: true }]);
});

test('isPreferredUrlLine', () => {
  assert.equal(isPreferredUrlLine('   - Local:        http://localhost:3000'), true);
  assert.equal(isPreferredUrlLine('<i> [webpack-dev-server] Loopback: http://localhost:8080/'), true);
  assert.equal(isPreferredUrlLine('Server running at http://localhost:1234'), false);
});

import { urlForFile } from '../../src/runner/url';

test('urlForFile: 루트 기준 상대 경로, index.html 은 폴더로, 루트 밖은 base', () => {
  const base = 'http://localhost:5500/';
  assert.equal(urlForFile(base, '/ws/proj', '/ws/proj/index.html'), 'http://localhost:5500/');
  assert.equal(urlForFile(base, '/ws/proj', '/ws/proj/about.html'), 'http://localhost:5500/about.html');
  assert.equal(urlForFile(base, '/ws/proj', '/ws/proj/pages/index.html'), 'http://localhost:5500/pages/');
  assert.equal(urlForFile(base, '/ws/proj', '/ws/proj/한글 폴더/소개.html'), 'http://localhost:5500/%ED%95%9C%EA%B8%80%20%ED%8F%B4%EB%8D%94/%EC%86%8C%EA%B0%9C.html');
  assert.equal(urlForFile(base, '/ws/proj', '/ws/other/x.html'), 'http://localhost:5500/');
  assert.equal(urlForFile('http://localhost:5173', '/ws/proj', '/ws/proj/about.html'), 'http://localhost:5173/about.html');
});

import { isBetterCandidate, urlPathDepth } from '../../src/runner/url';

test('wrangler 4.153 출력: "Local Explorer API" 안내 줄은 우선 줄이 아니고, 루트 주소인 Ready 줄을 고른다', () => {
  // 실제 출력 (AI 에이전트/비대화형 세션으로 감지되면 Explorer 안내가 Ready 보다 먼저 찍힌다)
  const d = new UrlDetector();
  const hits = d.push(
    '⎔ Starting local server...\n' +
      'Wrangler detected this dev session is running in an AI agent.\n' +
      'The Local Explorer API is available at http://localhost:8787/cdn-cgi/local/explorer/api\n' +
      'Useful routes:\n' +
      '  GET http://localhost:8787/cdn-cgi/local/explorer/api/local/workers - local Workers and bindings\n' +
      '  GET http://localhost:8787/cdn-cgi/local/explorer/api - OpenAPI schema\n' +
      '[wrangler:info] Ready on http://localhost:8787\n'
  );
  assert.equal(hits.length, 4);
  assert.equal(hits.some((h) => h.preferred), false);
  const best = hits.reduce((a, b) => (isBetterCandidate(b, a) ? b : a));
  assert.equal(best.url, 'http://localhost:8787/');
});

test('isPreferredUrlLine: 라벨 바로 뒤에 URL 이 와야 한다', () => {
  assert.equal(isPreferredUrlLine('┃ Local    http://localhost:4321/'), true);
  assert.equal(isPreferredUrlLine('  ➜  Local:   http://localhost:5173/'), true);
  assert.equal(isPreferredUrlLine('The Local Explorer API is available at http://localhost:8787/cdn-cgi/local/explorer/api'), false);
  assert.equal(isPreferredUrlLine('local dev server started, see http://localhost:3000'), false);
});

test('urlPathDepth / isBetterCandidate: 얕은 경로가 이기고, 같으면 기존 후보 유지', () => {
  assert.equal(urlPathDepth('http://localhost:8787/'), 0);
  assert.equal(urlPathDepth('http://localhost:4000/app'), 1);
  assert.equal(urlPathDepth('http://localhost:8787/cdn-cgi/local/explorer/api'), 4);
  const root = { url: 'http://localhost:3000/', preferred: false };
  const deep = { url: 'http://localhost:3000/a/b', preferred: false };
  assert.equal(isBetterCandidate(root, deep), true);
  assert.equal(isBetterCandidate(deep, root), false);
  assert.equal(isBetterCandidate({ ...root }, root), false);
});
