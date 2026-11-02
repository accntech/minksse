import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';

function nodeCase(name, source) {
  test(name, () => {
    const result = spawnSync('node', ['--expose-gc', '--input-type=module', '--eval', String.raw`
      import assert from 'node:assert/strict';
      import { EventEmitter } from 'node:events';
      import { produce } from './src/server.js';
      import { writeSseResponse } from './src/node.js';
      const turn = () => new Promise(resolve => setImmediate(resolve));
      const frame = (id, event, value) => 'id: ' + id + '\nevent: ' + event + '\ndata: ' + value.replace(/\r\n|\r|\n/g, '\ndata: ') + '\n\n';
      async function deadline(promise) {
        let timer;
        try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('owned output operation did not settle')), 1000); })]); }
        finally { clearTimeout(timer); }
      }
      class Destination extends EventEmitter {
        destroyed = false; writableEnded = false; writableFinished = false; headersSent = false; writes = [];
        setHeader() {}
        writeHead() { this.headersSent = true; }
        flushHeaders() {}
        write(value) { this.writes.push(value); return true; }
        end() { this.writableEnded = true; this.writableFinished = true; this.emit('finish'); }
        destroy() { this.destroyed = true; this.emit('close'); }
      }
      function assertOwned(value) {
        assert.ok(value instanceof Uint8Array, 'native delivery must write owned bytes instead of strings');
        assert.equal(value.byteOffset, 0, 'output must own its exact allocation');
        assert.equal(value.buffer.byteLength, value.byteLength, 'output must not retain unrelated pooled bytes');
      }
      async function assertConsumed(body, reason) {
        assert.equal(body.locked, false);
        const reader = new ReadableStreamDefaultReader(body);
        try {
          if (reason) await assert.rejects(reader.read(), error => error === reason);
          else assert.deepEqual(await reader.read(), { value: undefined, done: true });
        }
        finally { reader.releaseLock(); }
      }
      ${source}
    `], { cwd: new URL('../', import.meta.url), encoding: 'utf8', timeout: 7000 });
    expect({ status: result.status, stderr: result.stderr, error: result.error?.message }).toEqual({ status: 0, stderr: '', error: undefined });
  }, 10000);
}

nodeCase('native batches deliver independently owned exact UTF-8 chunks with coalescing on and off', String.raw`
  for (const coalesceBytes of [0, 127, 16384]) {
    let controls, cleanup = 0;
    const response = produce(value => { controls = value; return () => { cleanup++; }; }, { coalesceBytes });
    const destination = new Destination();
    const completion = writeSseResponse(response, destination); completion.catch(() => {});
    const values = ['ASCII', 'é€😀', '\ud800', '\udc00', 'a\r\nb\rc\nd', 'x'.repeat(200)];
    assert.equal(controls.emitBatch('更新', values).error, false);
    controls.lock.set(false);
    await deadline(completion);
    assert.ok(destination.writes.length > 0);
    for (const value of destination.writes) assertOwned(value);
    assert.equal(new Set(destination.writes.map(value => value.buffer)).size, destination.writes.length, 'output chunks must not share reusable backing storage');
    assert.deepEqual(Buffer.concat(destination.writes), Buffer.from(values.map((value, index) => frame(index + 1, '更新', value)).join('')));
    assert.equal(cleanup, 1);
    assert.equal(destination.listenerCount('error'), 0);
    await assertConsumed(response.body);
  }
`);

nodeCase('a late invalid member publishes no native bytes and releases the attached reader', String.raw`
  let controls, cleanup = 0;
  const response = produce(value => { controls = value; return () => { cleanup++; }; }, { coalesceBytes: 127 });
  const destination = new Destination();
  const completion = writeSseResponse(response, destination); completion.catch(() => {});
  const result = controls.emitBatch('tick', ['first'.repeat(50), 'é😀', 123]);
  assert.match(result.error?.message ?? '', /strings/);
  await assert.rejects(deadline(completion), error => error === result.error);
  assert.deepEqual(destination.writes, []);
  assert.equal(destination.destroyed, true);
  assert.equal(cleanup, 1);
  assert.equal(destination.listenerCount('drain'), 0);
  assert.equal(destination.listenerCount('error'), 0);
  await assertConsumed(response.body, result.error);
`);

nodeCase('owned native chunks respect drain and abort without mutating an earlier write', String.raw`
  for (const action of ['drain', 'abort']) {
    let controls, cleanup = 0, settled = false;
    const response = produce(value => { controls = value; return () => { cleanup++; }; }, { coalesceBytes: 0 });
    const abort = new AbortController(), reason = new Error('blocked owned output');
    const destination = new Destination();
    destination.write = function(value) { this.writes.push(value); return this.writes.length !== 1; };
    const completion = writeSseResponse(response, destination, { signal: abort.signal });
    void completion.then(() => { settled = true; }, () => { settled = true; });
    assert.equal(controls.emitBatch('tick', ['one', 'two', 'three']).error, false);
    await turn();
    assert.equal(destination.writes.length, 1);
    const first = Buffer.from(destination.writes[0]);
    controls.lock.set(false);
    await turn();
    assert.equal(settled, false, 'terminal source must not bypass a blocked destination');
    if (action === 'drain') {
      destination.emit('drain');
      await deadline(completion);
      assert.equal(destination.writes.length, 3);
      assert.deepEqual(Buffer.concat(destination.writes.map(value => Buffer.from(value))), Buffer.from(['one', 'two', 'three'].map((value, index) => frame(index + 1, 'tick', value)).join('')));
    } else {
      abort.abort(reason);
      await assert.rejects(deadline(completion), error => error === reason);
      destination.emit('drain');
      await turn();
      assert.equal(destination.writes.length, 1);
    }
    assert.deepEqual(Buffer.from(destination.writes[0]), first);
    for (const value of destination.writes) assertOwned(value);
    assert.equal(cleanup, 1);
    assert.equal(destination.listenerCount('drain'), 0);
    assert.equal(destination.listenerCount('error'), 0);
    await assertConsumed(response.body);
  }
`);

nodeCase('an unrecognized Web Response retains its generic byte delivery path', String.raw`
  const original = new TextEncoder().encode('data: generic\n\n');
  const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(original); controller.close(); } }));
  const destination = new Destination();
  await deadline(writeSseResponse(response, destination));
  assert.equal(destination.writes.length, 1);
  assert.equal(destination.writes[0], original);
  assert.deepEqual(Buffer.from(destination.writes[0]), Buffer.from('data: generic\n\n'));
  assert.equal(destination.listenerCount('drain'), 0);
  await assertConsumed(response.body);
`);

nodeCase('sealed native batches remain intact when scalar and batch output append behind them', String.raw`
  for (const coalesceBytes of [0, 127, 16384]) {
    let controls, cleanup = 0;
    const response = produce(value => { controls = value; return () => { cleanup++; }; }, { coalesceBytes });
    const destination = new Destination();
    const completion = writeSseResponse(response, destination); completion.catch(() => {});
    assert.equal(controls.emitBatch('更新', ['first é😀']).error, false);
    assert.equal(controls.emit('更新', 'scalar\r\nline').error, false);
    assert.equal(controls.emitBatch('更新', ['next\rline', 'last\nline']).error, false);
    controls.lock.set(false);
    await deadline(completion);
    assertOwned(destination.writes[0]);
    const output = Buffer.concat(destination.writes.map(value => Buffer.from(value)));
    const values = ['first é😀', 'scalar\r\nline', 'next\rline', 'last\nline'];
    assert.deepEqual(output, Buffer.from(values.map((value, index) => frame(index + 1, '更新', value)).join('')));
    assert.equal(cleanup, 1);
    await assertConsumed(response.body);
  }
`);

nodeCase('owned bytes remain included in the exact native queue limit', String.raw`
  for (const extra of [0, 1]) {
    let controls, cleanup = 0;
    const response = produce(value => { controls = value; return () => { cleanup++; }; }, { coalesceBytes: 16384 });
    const destination = new Destination();
    const completion = writeSseResponse(response, destination); completion.catch(() => {});
    const first = 'prior é😀\r\nline';
    assert.equal(controls.emitBatch('更新', [first]).error, false);
    const prefix = frame(1, '更新', first) + frame(2, '更新', '');
    const second = 'x'.repeat(262144 - Buffer.byteLength(prefix) + extra);
    const result = controls.emitBatch('更新', [second]);
    if (extra) {
      assert.match(result.error?.message ?? '', /buffer/);
      await assert.rejects(deadline(completion), error => error === result.error);
      assert.equal(destination.writes.length, 0);
    } else {
      assert.equal(result.error, false); controls.lock.set(false);
      await deadline(completion);
      const output = Buffer.concat(destination.writes.map(value => Buffer.from(value)));
      assert.equal(output.byteLength, 262144);
      assert.deepEqual(output, Buffer.from(frame(1, '更新', first) + frame(2, '更新', second)));
    }
    assert.equal(cleanup, 1);
  }
`);

nodeCase('blocked owned and backlogged string output cannot retain large caller string parents', String.raw`
  const controller = new AbortController();
  let controls, cleanup = 0;
  const response = produce(value => { controls = value; return () => { cleanup++; }; }, { coalesceBytes: 16384 });
  const destination = new Destination();
  destination.write = function(value) { this.writes.push(value); return false; };
  const completion = writeSseResponse(response, destination, { signal: controller.signal }); completion.catch(() => {});
  assert.equal(controls.emitBatch('initial', ['block']).error, false);
  await turn(); assert.equal(destination.writes.length, 1);
  for (let i = 0; i < 4; i++) global.gc();
  const baseline = process.memoryUsage().heapUsed;
  function enqueueSlices() {
    const parent = 'x'.repeat(32 * 1024 * 1024);
    // Slicing forces the parent rope flat; neither queued path may keep it.
    const first = parent.slice(1000, 1000 + 32768);
    assert.equal(controls.emitBatch('owned', [first]).error, false);
    const values = Array.from({ length: 40 }, (_, i) => parent.slice(100000 + i, 101024 + i));
    assert.equal(controls.emitBatch('backlog', values).error, false);
  }
  enqueueSlices();
  await turn();
  for (let i = 0; i < 6; i++) global.gc();
  assert.ok(process.memoryUsage().heapUsed - baseline < 4 * 1024 * 1024, 'queued native frames retained a 32 MiB caller string');
  assert.equal(destination.writes.length, 1, 'blocked output must not advance without drain');
  controller.abort();
  await assert.rejects(deadline(completion));
  assert.equal(cleanup, 1);
  assert.equal(destination.listenerCount('drain'), 0);
  await assertConsumed(response.body);
`);
