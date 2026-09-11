import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, MatchContext } from '../../src/errors';

const ctx = (output: string, extra: Partial<MatchContext> = {}): MatchContext => ({
  output,
  stage: 'install',
  root: '/Users/student/project',
  ...extra,
});

test('node 미설치 (spawn ENOENT)', () => {
  const c = classify(ctx('', { spawnErrorCode: 'ENOENT', spawnCommand: 'npm' }));
  assert.equal(c.rule?.id, 'node-missing');
});

test('node 미설치 (셸 메시지, macOS / Windows)', () => {
  assert.equal(classify(ctx('/bin/sh: npm: command not found\n')).rule?.id, 'node-missing');
  assert.equal(classify(ctx("'npm' is not recognized as an internal or external command,\noperable program or batch file.")).rule?.id, 'node-missing');
});

test('EADDRINUSE', () => {
  const c = classify(ctx('error when starting dev server:\nError: listen EADDRINUSE: address already in use :::5173', { stage: 'dev' }));
  assert.equal(c.rule?.id, 'port-in-use');
  assert.ok(c.actions.some((a) => a.kind === 'retryPort'));
});

test('EACCES / EPERM', () => {
  assert.equal(classify(ctx('npm ERR! code EACCES\nnpm ERR! syscall mkdir')).rule?.id, 'permission');
});

test('pnpm 미설치 → 자동 npm 폴백, 두 번째엔 액션만', () => {
  const first = classify(ctx('/bin/sh: pnpm: command not found'));
  assert.equal(first.rule?.id, 'pnpm-missing');
  assert.equal(first.auto, 'fallbackNpm');
  const second = classify(ctx('/bin/sh: pnpm: command not found'), new Set(['fallbackNpm']));
  assert.equal(second.auto, undefined);
  assert.ok(second.actions.length > 0);
});

test('ERESOLVE → legacy-peer-deps 자동 재시도 (install 단계에서만)', () => {
  const c = classify(ctx('npm ERR! code ERESOLVE\nnpm ERR! ERESOLVE unable to resolve dependency tree'));
  assert.equal(c.rule?.id, 'peer-conflict');
  assert.equal(c.auto, 'legacyPeerDeps');
  const dev = classify(ctx('npm ERR! code ERESOLVE', { stage: 'dev' }));
  assert.notEqual(dev.rule?.id, 'peer-conflict');
});

test('네트워크 오류', () => {
  assert.equal(classify(ctx('npm ERR! code ENOTFOUND\nnpm ERR! network request to https://registry.npmjs.org/vite failed')).rule?.id, 'network');
  assert.equal(classify(ctx('npm ERR! code ETIMEDOUT')).rule?.id, 'network');
  assert.equal(classify(ctx('npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/this-package-does-not-exist-xyz')).rule?.id, 'network');
});

test('EBUSY / ENOTEMPTY (Windows)', () => {
  assert.equal(classify(ctx('npm ERR! code EBUSY\nnpm ERR! syscall rename')).rule?.id, 'file-busy');
});

test('Missing script', () => {
  const c = classify(ctx('npm ERR! Missing script: "dev"', { stage: 'dev' }));
  assert.equal(c.rule?.id, 'missing-script');
  assert.ok(c.actions.some((a) => a.kind === 'openSettings'));
});

test('EBADENGINE', () => {
  assert.equal(classify(ctx('npm WARN EBADENGINE Unsupported engine {')).rule?.id, 'bad-engine');
  assert.equal(classify(ctx('You are using Node.js 16.20.0. Vite requires Node.js version 18+ or 20+.', { stage: 'dev' })).rule?.id, 'bad-engine');
});

test('Cannot find module → 자동 재설치', () => {
  const c = classify(ctx("Error: Cannot find module 'vite'", { stage: 'dev' }));
  assert.equal(c.rule?.id, 'missing-module');
  assert.equal(c.auto, 'reinstall');
});

test('한글/공백 경로는 다른 규칙이 없을 때만', () => {
  const c = classify(ctx('something weird happened', { root: '/Users/학생/테스트 폴더/proj' }));
  assert.equal(c.rule?.id, 'path-warning');
  const english = classify(ctx('something weird happened'));
  assert.equal(english.rule, undefined);
  assert.equal(english.messageKey, 'msg.genericFail');
  const port = classify(ctx('EADDRINUSE', { root: '/Users/학생/proj', stage: 'dev' }));
  assert.equal(port.rule?.id, 'port-in-use');
});
