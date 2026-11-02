import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';

function nodeCase(name, source) {
  test(name, () => {
    const result = spawnSync('node', ['--input-type=module', '--eval', `
      import assert from 'node:assert/strict';
      import { EventEmitter } from 'node:events';
      import { createServer, get } from 'node:http';
      import { produce } from './src/server.js';
      import { writeSseResponse } from './src/node.js';
      const capabilities = await import('./src/producer-capabilities.js');
      const frame = (id, event, value) => 'id: ' + id + '\\nevent: ' + event + '\\ndata: ' + value.replace(/\\r\\n|\\r|\\n/g, '\\ndata: ') + '\\n\\n';
      const turn = () => new Promise(resolve => setImmediate(resolve));
      async function deadline(promise) {
        let timer;
        try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('queue notification did not settle')), 1000); })]); }
        finally { clearTimeout(timer); }
      }
      class Destination extends EventEmitter {
        destroyed = false; writableEnded = false; writableFinished = false; headersSent = false; writes = [];
        setHeader() {}
        writeHead() { this.headersSent = true; }
        flushHeaders() {}
        write(value, encoding) { this.writes.push({ value, encoding }); return true; }
        end() { this.writableEnded = true; this.writableFinished = true; this.emit('finish'); }
        destroy() { this.destroyed = true; this.emit('close'); }
      }
      async function assertConsumed(body) {
        assert.equal(body.locked, false);
        const reader = new ReadableStreamDefaultReader(body);
        try { assert.deepEqual(await reader.read(), { value: undefined, done: true }); }
        finally { reader.releaseLock(); }
      }
      ${source}
    `], { cwd: new URL('../', import.meta.url), encoding: 'utf8', timeout: 6000 });
    expect({ status: result.status, stderr: result.stderr, error: result.error?.message }).toEqual({ status: 0, stderr: '', error: undefined });
  }, 10000);
}

nodeCase('private native queue requires an owned reader and transfers validated wire frames without changing Web chunks', `
  assert.equal(typeof capabilities.claimProducerQueue, 'function', 'native queue claim is implemented');
  let controls, cleanup = 0;
  const response = produce(value => { controls = value; return () => { cleanup++; }; }, { coalesceBytes: 4096 });
  const body = response.body;
  assert.equal(capabilities.claimProducerQueue(body, { byteLength: Buffer.byteLength }), undefined);
  const reader = new ReadableStreamDefaultReader(body);
  const queue = capabilities.claimProducerQueue(body, { byteLength: value => Buffer.byteLength(value, 'utf8') });
  assert.ok(queue);
  assert.equal(capabilities.claimProducerQueue(body, {}), undefined, 'a producer queue can only be claimed once');
  assert.equal(queue.tryAttach(), true);
  let terminalSettled = false;
  const terminal = reader.read().then(value => { terminalSettled = true; return value; });
  const encode = TextEncoder.prototype.encode;
  let encodes = 0;
  TextEncoder.prototype.encode = function(...args) { encodes++; return encode.apply(this, args); };
  try {
    assert.equal(controls.emit('更新', 'é😀\\ud800').error, false);
    assert.equal(controls.emitBatch('更新', ['a\\r\\nb\\rc\\nd', 'last']).error, false);
    await turn();
    assert.equal(terminalSettled, false, 'attached Web reader watches terminal state without consuming wire frames');
    const chunks = [];
    while (true) { const chunk = queue.take(); if (!chunk) break; assert.equal(typeof chunk.wire, 'string'); assert.equal(chunk.bytes, Buffer.byteLength(chunk.wire, 'utf8')); chunks.push(chunk.wire); }
    assert.equal(chunks.join(''), frame(1, '更新', 'é😀\\ud800') + frame(2, '更新', 'a\\r\\nb\\rc\\nd') + frame(3, '更新', 'last'));
    assert.equal(queue.take(), undefined, 'frames transfer exactly once');
    assert.equal(encodes, 0);
    controls.lock.set(false);
    assert.deepEqual(await deadline(terminal), { value: undefined, done: true });
    assert.equal(queue.isDone(), true);
    assert.equal(cleanup, 1);
  } finally {
    TextEncoder.prototype.encode = encode;
    queue.dispose(); await reader.cancel().catch(() => {}); reader.releaseLock();
  }
`);

nodeCase('native queue wait is level-triggered before and after output and wakes on stop or disposal', `
  assert.equal(typeof capabilities.claimProducerQueue, 'function', 'native queue claim is implemented');
  for (const terminalMode of ['stop', 'dispose']) {
    let controls, cleanup = 0;
    const response = produce(value => { controls = value; return () => { cleanup++; }; }, { coalesceBytes: 64 });
    const reader = new ReadableStreamDefaultReader(response.body);
    const queue = capabilities.claimProducerQueue(response.body, { byteLength: value => Buffer.byteLength(value, 'utf8') });
    assert.ok(queue); assert.equal(queue.tryAttach(), true);
    const terminal = reader.read();
    try {
      const waitingBefore = queue.wait();
      assert.equal(controls.emit('tick', 'first').error, false);
      await deadline(waitingBefore);
      await deadline(queue.wait());
      assert.equal(queue.take().wire, frame(1, 'tick', 'first'));
      assert.equal(queue.take(), undefined);
      const waitingOnEmpty = queue.wait();
      if (terminalMode === 'stop') controls.lock.set(false); else queue.dispose();
      await deadline(waitingOnEmpty);
      assert.deepEqual(await deadline(terminal), { value: undefined, done: true });
      await deadline(queue.wait());
      assert.equal(queue.isDone(), true); assert.equal(queue.take(), undefined);
      queue.dispose(); queue.dispose(); assert.equal(cleanup, 1);
    } finally { queue.dispose(); await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
`);

nodeCase('native queue cannot attach inside scalar accounting, batch getters or while byte output is prefetched', `
  let controls, queue;
  const response = produce(value => { controls = value; }, { coalesceBytes: 128 });
  const reader = new ReadableStreamDefaultReader(response.body);
  let probes = 0;
  queue = capabilities.claimProducerQueue(response.body, { byteLength(value) {
    probes++; assert.equal(queue.tryAttach(), false, 'active scalar validation cannot switch transports');
    return Buffer.byteLength(value, 'utf8');
  } });
  try {
    assert.ok(queue);
    assert.equal(controls.emit('tick', 'one').error, false);
    assert.ok(probes > 0);
    assert.equal(queue.tryAttach(), false, 'prefetched Web bytes must be read first');
    const values = ['two', 'placeholder'];
    Object.defineProperty(values, 1, { get() { assert.equal(queue.tryAttach(), false, 'batch staging cannot switch transports'); return 'three'; } });
    assert.equal(controls.emitBatch('tick', values).error, false);
    assert.equal(queue.tryAttach(), false);
    const chunks = [];
    chunks.push((await reader.read()).value);
    chunks.push((await reader.read()).value);
    for (const chunk of chunks) assert.equal(chunk instanceof Uint8Array, true);
    assert.equal(Buffer.concat(chunks).toString(), frame(1, 'tick', 'one') + frame(2, 'tick', 'two') + frame(3, 'tick', 'three'));
    assert.equal(queue.tryAttach(), true);
    const terminal = reader.read();
    controls.lock.set(false);
    assert.deepEqual(await deadline(terminal), { value: undefined, done: true });
  } finally { queue?.dispose(); await reader.cancel().catch(() => {}); reader.releaseLock(); }
`);

nodeCase('Node HTTP drains byte prefetch then writes deferred native queue frames outside emission with exact UTF-8', `
  let completion, cleanup = 0, body, insideEmit = false, encodes = 0;
  const written = [];
  const encode = TextEncoder.prototype.encode;
  const values = ['é😀\\ud800', 'a\\r\\nb\\rc\\nd'];
  const expected = frame(1, 'sync', 'already encoded') + frame(2, '更新', values[0]) + frame(3, '更新', values[1]);
  const server = createServer((_, res) => {
    const write = res.write;
    res.write = function(value, encoding, ...args) {
      assert.equal(insideEmit, false, 'destination writes must never reenter an emit call');
      written.push({ value, encoding }); return write.call(this, value, encoding, ...args);
    };
    const response = produce(controls => {
      controls.emit('sync', 'already encoded');
      setImmediate(() => {
        insideEmit = true;
        try {
          assert.equal(controls.emit('更新', values[0]).error, false);
          assert.equal(controls.emitBatch('更新', [values[1]]).error, false);
          controls.lock.set(false);
        } finally { insideEmit = false; }
      });
      return () => { cleanup++; };
    }, { coalesceBytes: 128 });
    body = response.body;
    TextEncoder.prototype.encode = function(...args) { encodes++; return encode.apply(this, args); };
    completion = writeSseResponse(response, res); completion.catch(() => {});
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const chunks = [];
    await new Promise((resolve, reject) => get('http://127.0.0.1:' + server.address().port, res => {
      res.on('data', chunk => chunks.push(chunk)); res.on('end', resolve); res.on('error', reject);
    }).on('error', reject));
    await completion;
    assert.deepEqual(Buffer.concat(chunks), Buffer.from(expected, 'utf8'));
    assert.equal(encodes, 0, 'deferred attached output must avoid producer TextEncoder');
    assert.equal(written.some(({ value }) => value instanceof Uint8Array), true);
    assert.equal(written.some(({ value, encoding }) => typeof value === 'string' && encoding === 'utf8'), true);
    assert.equal(cleanup, 1);
    await assertConsumed(body);
  } finally {
    TextEncoder.prototype.encode = encode;
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
`);

nodeCase('unclaimed Web, cloned, teed and transformed responses always retain ordinary byte output', `
  const expected = frame(1, '更新', 'é😀') + frame(2, '更新', 'a\\r\\nb\\nc');
  for (const mode of ['web', 'clone', 'tee', 'transform']) {
    let controls, cleanup = 0;
    const source = produce(value => { controls = value; return () => { cleanup++; }; }, { coalesceBytes: 128 });
    let response = source, other;
    if (mode === 'clone') { response = source.clone(); other = source.text(); }
    if (mode === 'tee') {
      const branches = source.body.tee(); response = new Response(branches[0]); other = new Response(branches[1]).text();
    }
    if (mode === 'transform') response = new Response(source.body.pipeThrough(new TransformStream({
      transform(value, controller) { assert.equal(value instanceof Uint8Array, true); controller.enqueue(value); }
    })));
    const destination = new Destination(), chunks = [];
    const completion = mode === 'web' ? (async () => {
      const reader = new ReadableStreamDefaultReader(response.body);
      try { while (true) { const part = await reader.read(); if (part.done) break; assert.equal(part.value instanceof Uint8Array, true); chunks.push(Buffer.from(part.value)); } }
      finally { reader.releaseLock(); }
    })() : writeSseResponse(response, destination);
    completion.catch(() => {});
    assert.equal(controls.emitBatch('更新', ['é😀', 'a\\r\\nb\\nc']).error, false);
    controls.lock.set(false);
    await completion;
    if (other) assert.equal(await other, expected);
    if (mode !== 'web') for (const { value } of destination.writes) {
      assert.equal(value instanceof Uint8Array, true, mode + ' output must stay bytes'); chunks.push(Buffer.from(value));
    }
    assert.deepEqual(Buffer.concat(chunks), Buffer.from(expected), mode);
    assert.equal(cleanup, 1);
    await assertConsumed(response.body);
  }
`);

nodeCase('header failure after reentrant byte emission cancels output before any native attachment escapes', `
  let controls, cleanup = 0;
  const response = produce(value => { controls = value; return () => { cleanup++; }; });
  const reason = new Error('header failed after claim');
  const destination = new Destination();
  destination.setHeader = () => {
    assert.equal(controls.emit('tick', 'accepted before attach').error, false);
    throw reason;
  };
  await assert.rejects(writeSseResponse(response, destination), error => error === reason);
  assert.equal(destination.destroyed, true);
  assert.equal(destination.writes.length, 0);
  assert.equal(cleanup, 1);
  await assertConsumed(response.body);
`);

nodeCase('native destination write failure discards all remaining wire frames and releases its reader once', `
  let controls, cleanup = 0;
  const response = produce(value => { controls = value; return () => { cleanup++; }; }, { coalesceBytes: 32 });
  const reason = new Error('native destination write failed');
  const destination = new Destination();
  destination.write = function(value) { assert.ok(typeof value === 'string' || value instanceof Uint8Array); throw reason; };
  const completion = writeSseResponse(response, destination); completion.catch(() => {});
  assert.equal(controls.emitBatch('tick', ['one', 'two', 'three']).error, false);
  await assert.rejects(completion, error => error === reason);
  assert.equal(destination.destroyed, true);
  assert.equal(cleanup, 1);
  assert.equal(destination.listenerCount('drain'), 0);
  assert.equal(destination.listenerCount('error'), 0);
  await assertConsumed(response.body);
`);

nodeCase('the final native write must drain or fail even when its terminal Web reader has already completed', `
  for (const action of ['drain', 'abort', 'close']) {
    let controls, cleanup = 0, settled = false;
    const response = produce(value => { controls = value; return () => { cleanup++; }; }, { coalesceBytes: 128 });
    const abort = new AbortController(), reason = new Error('stop final blocked write');
    const destination = new Destination();
    destination.write = function(value, encoding) { assert.ok(typeof value === 'string' || value instanceof Uint8Array); this.writes.push({ value, encoding }); return false; };
    const completion = writeSseResponse(response, destination, { signal: abort.signal });
    completion.then(() => { settled = true; }, () => { settled = true; });
    assert.equal(controls.emit('tick', 'last').error, false);
    controls.lock.set(false);
    await turn();
    assert.equal(destination.writes.length, 1);
    assert.equal(destination.writableEnded, false);
    assert.equal(settled, false, action + ': terminal completion must not bypass socket backpressure');
    if (action === 'drain') { destination.emit('drain'); await deadline(completion); }
    else {
      if (action === 'abort') abort.abort(reason); else destination.destroy();
      await assert.rejects(deadline(completion), error => action === 'abort' ? error === reason : error.name === 'AbortError');
      assert.equal(destination.destroyed, true);
    }
    assert.equal(cleanup, 1);
    assert.equal(destination.listenerCount('drain'), 0);
    await assertConsumed(response.body);
  }
`);

nodeCase('an empty attached queue commits a staged batch without per-group Web budget queries', `
  let controls, cleanup = 0;
  const response = produce(value => { controls = value; return () => { cleanup++; }; }, { coalesceBytes: 128 });
  const reader = new ReadableStreamDefaultReader(response.body);
  const queue = capabilities.claimProducerQueue(response.body, { byteLength: value => Buffer.byteLength(value, 'utf8') });
  assert.ok(queue); assert.equal(queue.tryAttach(), true);
  const terminal = reader.read();
  const prototype = ReadableStreamDefaultController.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'desiredSize');
  let reads = 0;
  Object.defineProperty(prototype, 'desiredSize', { ...descriptor, get() { reads++; return descriptor.get.call(this); } });
  try {
    assert.equal(controls.emitBatch('tick', Array.from({ length: 1024 }, (_, index) => String(index))).error, false);
    assert.ok(reads <= 2, 'native commit queried the Web budget ' + reads + ' times');
  } finally { Object.defineProperty(prototype, 'desiredSize', descriptor); }
  try {
    controls.lock.set(false);
    let output = '';
    for (let next; (next = queue.take());) {
      assert.equal(next.bytes, Buffer.byteLength(next.wire)); output += next.wire;
    }
    assert.equal(output, Array.from({ length: 1024 }, (_, index) => frame(index + 1, 'tick', String(index))).join(''));
    assert.deepEqual(await deadline(terminal), { value: undefined, done: true });
    assert.equal(cleanup, 1);
  } finally { queue.dispose(); await reader.cancel().catch(() => {}); reader.releaseLock(); }
`);
