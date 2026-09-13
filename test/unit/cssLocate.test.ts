import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCssBlocks, findBlockByPath, findStyleTags, locateInlineRule, findStyleTag } from '../../src/runner/cssLocate';
import { decodeFrames, encodeMaskedText } from '../../src/runner/wsFrame';

const css = `@import url("x.css");
/* 주석 { 속임수 } */
:root { --c: red; }
.hero h1 {
  color: var(--c);
  content: "}"; /* 문자열 안 중괄호 */
}
@media (max-width: 600px) {
  .hero h1 { font-size: 1rem; }
  .card { padding: 0 }
}
@keyframes spin { from { transform: none } to { transform: rotate(1turn) } }
.last{margin:0}`;

test('parseCssBlocks: CSSOM 순서로 규칙을 세고 줄 번호를 준다', () => {
  const b = parseCssBlocks(css);
  assert.deepEqual(b.map((x) => [x.prelude, x.line]), [
    ['@import url("x.css")', 1],
    [':root', 3],
    ['.hero h1', 4],
    ['@media (max-width: 600px)', 8],
    ['@keyframes spin', 12],
    ['.last', 13],
  ]);
  assert.deepEqual(b[3].children.map((x) => [x.prelude, x.line]), [['.hero h1', 9], ['.card', 10]]);
  assert.equal(b[4].children.length, 0, 'keyframes 는 내려가지 않는다');
});

test('findBlockByPath: 브라우저가 보낸 경로로 규칙을 찾는다', () => {
  const b = parseCssBlocks(css);
  assert.equal(findBlockByPath(b, [2])?.line, 4);
  assert.equal(findBlockByPath(b, [3, 1])?.prelude, '.card');
  assert.equal(findBlockByPath(b, [9]), undefined);
});

test('인라인 <style> 규칙은 HTML 줄 번호로 환산된다', () => {
  const html = `<!doctype html>
<html><head>
<style>
  body { margin: 0 }
  h1 { color: red }
</style>
<style>.x{}</style>
</head><body></body></html>`;
  const tags = findStyleTags(html);
  assert.equal(tags.length, 2);
  assert.equal(locateInlineRule(html, 0, [1]), 5, 'h1 규칙은 5번째 줄');
  assert.equal(locateInlineRule(html, 1, [0]), 7);
  assert.equal(locateInlineRule(html, 2, [0]), undefined);
});

test('decodeFrames: 마스킹된 텍스트 프레임, 분할 수신, close/ping', () => {
  const one = encodeMaskedText('{"type":"inspect"}');
  const d = decodeFrames(one);
  assert.deepEqual(d.messages, ['{"type":"inspect"}']);
  assert.equal(d.rest.length, 0);
  // 두 프레임이 한 번에 + 세 번째는 절반만
  const two = encodeMaskedText('a'.repeat(300));
  const half = encodeMaskedText('tail').subarray(0, 4);
  const d2 = decodeFrames(Buffer.concat([one, two, half]));
  assert.deepEqual(d2.messages.map((m) => m.length), [18, 300]);
  assert.equal(d2.rest.length, 4, '미완성 프레임은 rest 로 남긴다');
  const close = decodeFrames(Buffer.from([0x88, 0x80, 1, 2, 3, 4]));
  assert.equal(close.close, true);
  const ping = decodeFrames(Buffer.from([0x89, 0x80, 1, 2, 3, 4]));
  assert.equal(ping.ping, true);
});

test('런타임에 끼어든 <style> 로 인덱스가 밀려도 내용으로 원래 태그를 찾는다', () => {
  const html = `<head>
<style>
  body { margin: 0 }
  h1 { color: red }
</style>
</head>`;
  // 브라우저에서는 Tailwind 가 앞에 <style> 을 하나 끼워 넣어 우리 것이 index 1 이 됐다
  assert.equal(findStyleTag(html, 1)?.line, undefined, '인덱스만으로는 못 찾는다');
  assert.equal(locateInlineRule(html, 1, [1], 'body { margin: 0 }\n  h1'), 4, '내용 앞부분으로 찾아 h1 은 4번째 줄');
  assert.equal(locateInlineRule(html, 0, [1], '전혀 다른 내용'), 4, '내용이 안 맞으면 인덱스로 돌아간다');
});
