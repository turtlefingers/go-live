import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alive, processStartTime, sameProcess } from '../../src/runner/watchdog';

test('processStartTime 은 살아 있는 프로세스에만 값을 준다 (보안 결함 4)', () => {
  const mine = processStartTime(process.pid);
  assert.ok(mine && mine.length > 0, `own start time: ${mine}`);
  assert.equal(processStartTime(process.pid), mine, '같은 프로세스는 같은 값');
  assert.equal(processStartTime(2147483000), undefined, '없는 pid 는 undefined');
  assert.equal(alive(process.pid), true);
  assert.equal(alive(2147483000), false);
});

test('sameProcess 는 기록이 없거나 다르면 false → 죽이지 않는다', () => {
  const mine = processStartTime(process.pid);
  assert.equal(sameProcess(process.pid, mine), true);
  assert.equal(sameProcess(process.pid, undefined), false);
  assert.equal(sameProcess(process.pid, 'Mon Jan  1 00:00:00 2001'), false);
  assert.equal(sameProcess(2147483000, mine), false);
});
