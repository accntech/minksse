import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';

// Wire bytes alone do not describe queue overhead: many tiny frames used to
// retain one object and several string nodes for every event in a burst.
test('coalescing keeps tiny-frame queue heap overhead bounded in Node', () => {
  const source = `
    import assert from 'node:assert/strict';
    import { produce } from './src/server.js';
    new Response('warm runtime');
    global.gc();
    const before = process.memoryUsage().heapUsed;
    let emit;
    const response = produce(controls => { emit = controls.emit; }, { coalesceBytes: 8192 });
    for (let index = 0; index < 7000; index++) assert.equal(emit('tick', String(index)).error, false);
    for (let index = 0; index < 4; index++) {
      await new Promise(resolve => setTimeout(resolve, 0));
      global.gc();
    }
    const retained = process.memoryUsage().heapUsed - before;
    const wire = await response.body.cancel();
    assert.ok(retained < 1024 * 1024, 'tiny-frame queue retains ' + retained + ' bytes');
  `;
  const result = spawnSync('node', ['--expose-gc', '--input-type=module', '--eval', source], {
    cwd: new URL('../', import.meta.url), encoding: 'utf8', timeout: 5000
  });
  expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
});
