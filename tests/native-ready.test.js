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
      import { claimProducerQueue } from './src/producer-capabilities.js';
      const frame = (id, event, value) => 'id: ' + id + '\\nevent: ' + event + '\\ndata: ' + value.replace(/\\r\\n|\\r|\\n/g, '\\ndata: ') + '\\n\\n';
      const turn = () => new Promise(resolve => setImmediate(resolve));
      async function deadline(promise) {
        let timer;
        try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('native ready operation did not settle')), 1000); })]); }
        finally { clearTimeout(timer); }
      }
      function open(coalesceBytes = 128) {
        let controls, cleanup = 0;
        const response = produce(value => { controls = value; return () => { cleanup++; }; }, { coalesceBytes });
        const reader = new ReadableStreamDefaultReader(response.body);
        const queue = claimProducerQueue(response.body, { byteLength: value => Buffer.byteLength(value, 'utf8') });
        assert.ok(queue); assert.equal(queue.tryAttach(), true);
        const terminal = reader.read(); terminal.catch(() => {});
        return { controls, queue, reader, terminal, cleanup: () => cleanup };
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
    `], { cwd: new URL('../', import.meta.url), encoding: 'utf8', timeout: 7000 });
    expect({ status: result.status, stderr: result.stderr, error: result.error?.message }).toEqual({ status: 0, stderr: '', error: undefined });
  }, 10000);
}

nodeCase('native ready callbacks are asynchronous, coalesce notifications and observe output or terminal levels', `
  const { controls, queue, reader, terminal, cleanup } = open();
  assert.equal(typeof queue.whenReady, 'function', 'native callback readiness is implemented');
  let insideProducer = false, notifications = 0;
  try {
    queue.whenReady(() => { assert.equal(insideProducer, false); notifications++; });
    insideProducer = true;
    try {
      assert.equal(controls.emitBatch('tick', ['one', 'two']).error, false);
      assert.equal(controls.emit('tick', 'three').error, false);
      assert.equal(notifications, 0, 'notifications may not run inline in producer calls');
    } finally { insideProducer = false; }
    await turn();
    assert.equal(notifications, 1, 'several emissions wake one pending callback once');
    let alreadyReady = 0;
    queue.whenReady(() => { alreadyReady++; });
    assert.equal(alreadyReady, 0);
    await turn(); assert.equal(alreadyReady, 1);
    let output = '';
    for (let next; (next = queue.take());) output += next.wire;
    assert.equal(output, frame(1, 'tick', 'one') + frame(2, 'tick', 'two') + frame(3, 'tick', 'three'));
    let stopped = 0;
    queue.whenReady(() => { stopped++; });
    controls.lock.set(false);
    assert.equal(stopped, 0, 'terminal notification may not run inline');
    await turn(); assert.equal(stopped, 1);
    assert.deepEqual(await deadline(terminal), { value: undefined, done: true });
    let terminalLevel = 0;
    queue.whenReady(() => { terminalLevel++; });
    assert.equal(terminalLevel, 0);
    await turn(); assert.equal(terminalLevel, 1);
    assert.equal(cleanup(), 1);
  } finally { queue.dispose(); await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const disposed = open();
  try {
    let calls = 0;
    disposed.queue.whenReady(() => { calls++; });
    disposed.queue.dispose(); disposed.queue.dispose();
    assert.equal(calls, 0);
    await turn(); assert.equal(calls, 1);
    assert.deepEqual(await deadline(disposed.terminal), { value: undefined, done: true });
    assert.equal(disposed.cleanup(), 1);
  } finally { disposed.queue.dispose(); await disposed.reader.cancel().catch(() => {}); disposed.reader.releaseLock(); }
`);

nodeCase('native Node HTTP delivery uses callback readiness without per-batch queue wait promises', `
  const originalSet = WeakMap.prototype.set;
  let queueWaitCalls = 0, registeredQueues = 0, insideProducer = false, completion;
  WeakMap.prototype.set = function(key, value) {
    if (key instanceof ReadableStream && value && typeof value.control?.wait === 'function') {
      registeredQueues++;
      const wait = value.control.wait;
      value.control.wait = function(...args) { queueWaitCalls++; return wait.apply(this, args); };
    }
    return originalSet.call(this, key, value);
  };
  const expected = Array.from({ length: 5 }, (_, index) => frame(index + 1, 'tick', String(index))).join('');
  let cleanup = 0, writes = 0;
  const server = createServer((_, res) => {
    const write = res.write;
    res.write = function(...args) { assert.equal(insideProducer, false); writes++; return write.apply(this, args); };
    const response = produce(controls => {
      void (async () => {
        for (let index = 0; index < 5; index++) {
          await turn(); insideProducer = true;
          try { assert.equal(controls.emitBatch('tick', [String(index)]).error, false); }
          finally { insideProducer = false; }
        }
        controls.lock.set(false);
      })();
      return () => { cleanup++; };
    }, { coalesceBytes: 128 });
    completion = writeSseResponse(response, res); completion.catch(() => {});
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    let output = '';
    await new Promise((resolve, reject) => get('http://127.0.0.1:' + server.address().port, res => {
      res.setEncoding('utf8'); res.on('data', chunk => { output += chunk; }); res.on('end', resolve); res.on('error', reject);
    }).on('error', reject));
    await completion;
    assert.equal(output, expected);
    assert.equal(registeredQueues, 1, 'instrumentation must observe the actual producer control');
    assert.equal(queueWaitCalls, 0, 'native adapter must not allocate a queue-wait promise per batch');
    assert.equal(writes, 5);
    assert.equal(cleanup, 1);
  } finally {
    WeakMap.prototype.set = originalSet;
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
`);

nodeCase('a native ready callback can rearm after draining without losing the next notification', `
  const { controls, queue, reader, terminal, cleanup } = open();
  assert.equal(typeof queue.whenReady, 'function');
  let callbacks = 0, inFirstCallback = false;
  let resolveSecond;
  const second = new Promise(resolve => { resolveSecond = resolve; });
  try {
    queue.whenReady(() => {
      callbacks++; inFirstCallback = true;
      try {
        assert.equal(queue.take().wire, frame(1, 'tick', 'first'));
        assert.equal(queue.take(), undefined);
        queue.whenReady(() => {
          assert.equal(inFirstCallback, false);
          callbacks++;
          assert.equal(queue.take().wire, frame(2, 'tick', 'second'));
          assert.equal(queue.take(), undefined);
          controls.lock.set(false); resolveSecond();
        });
        assert.equal(controls.emit('tick', 'second').error, false);
        assert.equal(callbacks, 1);
      } finally { inFirstCallback = false; }
    });
    assert.equal(controls.emit('tick', 'first').error, false);
    await deadline(second);
    assert.equal(callbacks, 2);
    assert.deepEqual(await deadline(terminal), { value: undefined, done: true });
    assert.equal(cleanup(), 1);
  } finally { queue.dispose(); await reader.cancel().catch(() => {}); reader.releaseLock(); }
`);

nodeCase('an idle callback-driven Node destination settles on abort, error, close or source completion without output', `
  for (const action of ['abort', 'error', 'close', 'finish']) {
    let controls, cleanup = 0;
    const response = produce(value => { controls = value; return () => { cleanup++; }; });
    const destination = new Destination();
    const abort = new AbortController(), reason = new Error('idle native ' + action);
    const completion = writeSseResponse(response, destination, { signal: abort.signal }); completion.catch(() => {});
    await turn();
    assert.equal(destination.writes.length, 0);
    assert.equal(response.body.locked, true);
    if (action === 'abort') abort.abort(reason);
    else if (action === 'error') destination.emit('error', reason);
    else if (action === 'close') destination.destroy();
    else controls.lock.set(false);
    if (action === 'finish') await deadline(completion);
    else await assert.rejects(deadline(completion), error => action === 'close' ? error.name === 'AbortError' : error === reason);
    assert.equal(cleanup, 1);
    assert.equal(destination.writes.length, 0);
    assert.equal(destination.listenerCount('drain'), 0);
    assert.equal(destination.listenerCount('finish'), 0);
    assert.equal(destination.listenerCount('error'), 0);
    await assertConsumed(response.body);
    await turn(); assert.equal(destination.writes.length, 0);
  }
`);

nodeCase('native writes may enqueue and finish another batch without reentrant writes or duplicated ready callbacks', `
  let controls, cleanup = 0, inWrite = false;
  const response = produce(value => { controls = value; return () => { cleanup++; }; }, { coalesceBytes: 0 });
  const destination = new Destination();
  destination.write = function(value, encoding) {
    assert.equal(inWrite, false, 'writing nested emissions must wait for the current write to return');
    inWrite = true;
    try {
      this.writes.push({ value, encoding });
      if (this.writes.length === 1) {
        assert.equal(controls.emit('tick', 'second').error, false);
        assert.equal(controls.emitBatch('tick', ['third', 'fourth']).error, false);
        controls.lock.set(false);
        assert.equal(this.writes.length, 1);
      }
      return true;
    } finally { inWrite = false; }
  };
  const completion = writeSseResponse(response, destination); completion.catch(() => {});
  assert.equal(controls.emit('tick', 'first').error, false);
  await deadline(completion);
  const expected = ['first', 'second', 'third', 'fourth'].map((value, index) => frame(index + 1, 'tick', value)).join('');
  assert.equal(destination.writes.map(({ value }) => value).join(''), expected);
  assert.equal(destination.writes.length, 4);
  assert.equal(cleanup, 1);
  assert.equal(destination.listenerCount('drain'), 0);
  assert.equal(destination.listenerCount('error'), 0);
  await assertConsumed(response.body);
  await turn(); assert.equal(destination.writes.length, 4);
`);

nodeCase('inline native write aborts, errors and throws reject immediately without another ready wake', `
  for (const action of ['abort', 'error', 'throw', 'stop-throw', 'abort-last']) {
    let controls, cleanup = 0;
    const response = produce(value => { controls = value; return () => { cleanup++; }; }, { coalesceBytes: action === 'abort-last' ? 128 : 0 });
    const abort = new AbortController(), reason = new Error('inline native write ' + action);
    const destination = new Destination();
    destination.write = function(value, encoding) {
      assert.ok(typeof value === 'string' || value instanceof Uint8Array);
      this.writes.push({ value, encoding });
      assert.equal(this.writes.length, 1, 'inline failure must prevent later queued writes');
      if (action === 'abort' || action === 'abort-last') abort.abort(reason);
      else if (action === 'error') this.emit('error', reason);
      else {
        if (action === 'stop-throw') controls.lock.set(false);
        throw reason;
      }
      return true;
    };
    const completion = writeSseResponse(response, destination, { signal: abort.signal }); completion.catch(() => {});
    const values = action === 'abort-last' ? ['first'] : ['first', 'second', 'third'];
    assert.equal(controls.emitBatch('tick', values).error, false);
    if (action === 'abort-last') controls.lock.set(false);
    await assert.rejects(deadline(completion), error => error === reason);
    assert.equal(destination.destroyed, true);
    assert.equal(destination.writes.length, 1);
    assert.equal(cleanup, 1);
    assert.equal(destination.listenerCount('drain'), 0);
    assert.equal(destination.listenerCount('error'), 0);
    assert.equal(destination.listenerCount('finish'), 0);
    await assertConsumed(response.body);
    await turn(); assert.equal(destination.writes.length, 1);
  }
`);

nodeCase('Node readiness uses its supplied native scheduler instead of allocating portable microtask resources per batch', `
  let controls, completion, cleanup = 0;
  const microtask = globalThis.queueMicrotask;
  let portableCalls = 0;
  globalThis.queueMicrotask = callback => { portableCalls++; return microtask(callback); };
  const server = createServer((_, res) => {
    const response = produce(value => { controls = value; return () => { cleanup++; }; }, { coalesceBytes: 16384 });
    completion = writeSseResponse(response, res); completion.catch(() => {});
    void (async () => {
      for (let index = 0; index < 5; index++) {
        await turn();
        assert.equal(controls.emitBatch('tick', ['value ' + index]).error, false);
      }
      controls.lock.set(false);
    })();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const chunks = [];
    await new Promise((resolve, reject) => get('http://127.0.0.1:' + server.address().port, res => {
      res.on('data', chunk => chunks.push(chunk)); res.on('end', resolve); res.on('error', reject);
    }).on('error', reject));
    await completion;
    assert.equal(Buffer.concat(chunks).toString(), Array.from({length: 5}, (_, index) => frame(index + 1, 'tick', 'value ' + index)).join(''));
    assert.equal(portableCalls, 0, 'Native readiness should use its native scheduler');
    assert.equal(cleanup, 1);
  } finally {
    globalThis.queueMicrotask = microtask;
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
`);
