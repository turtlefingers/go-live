import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StaticServer, resolveStaticRoot, isInside } from '../../src/runner/static';

function project(): { root: string; outside: string } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'go-live-static-'));
  const root = path.join(base, 'proj');
  const outside = path.join(base, 'outside');
  fs.mkdirSync(path.join(root, 'sub'), { recursive: true });
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(root, 'index.html'), '<h1>ok</h1>');
  fs.writeFileSync(path.join(root, 'sub', 'a.txt'), 'inside');
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'SECRET');
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'link-out.txt'));
  fs.symlinkSync(outside, path.join(root, 'link-out-dir'));
  fs.symlinkSync(path.join(root, 'sub', 'a.txt'), path.join(root, 'link-in.txt'));
  return { root, outside };
}

test('resolveStaticRoot 는 워크스페이스 밖을 거부한다 (보안 결함 2)', () => {
  const ws = path.join(os.tmpdir(), 'ws');
  assert.equal(resolveStaticRoot(ws, ''), path.resolve(ws));
  assert.equal(resolveStaticRoot(ws, 'src'), path.join(path.resolve(ws), 'src'));
  assert.equal(resolveStaticRoot(ws, './public/'), path.join(path.resolve(ws), 'public'));
  assert.equal(resolveStaticRoot(ws, '..'), undefined);
  assert.equal(resolveStaticRoot(ws, '../../etc'), undefined);
  assert.equal(resolveStaticRoot(ws, 'src/../..'), undefined);
  assert.equal(resolveStaticRoot(ws, '/etc'), undefined);
  assert.equal(isInside('/a/b', '/a/bc'), false);
});

test('심볼릭 링크로 프로젝트 밖을 가리키면 404, 안을 가리키면 200 (보안 결함 1)', async () => {
  const { root } = project();
  const s = new StaticServer();
  const url = await s.start(root, '', 0);
  try {
    const status = async (p: string) => (await fetch(url + p)).status;
    assert.equal(await status(''), 200);
    assert.equal(await status('sub/a.txt'), 200);
    assert.equal(await status('link-in.txt'), 200);
    assert.equal(await status('link-out.txt'), 404);
    assert.equal(await status('link-out-dir/secret.txt'), 404);
    assert.equal(await status('link-out-dir/'), 404);
    assert.equal(await status('..%2Fsecret.txt'), 404);
    assert.equal(await status('%2e%2e/outside/secret.txt'), 404);
    const body = await (await fetch(url + 'link-out.txt')).text();
    assert.ok(!body.includes('SECRET'));
  } finally {
    await s.stop();
  }
});

test('start 는 워크스페이스 밖 staticRoot 를 거부한다', async () => {
  const { root } = project();
  const s = new StaticServer();
  await assert.rejects(() => s.start(root, '..', 0));
});
