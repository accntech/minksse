import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';

function nodeCase(name, source, runtime = 'node') {
  test(name, () => {
    const result = spawnSync(runtime === 'node' ? 'node' : process.execPath, [...(runtime === 'node' ? ['--expose-gc'] : []), '--input-type=module', '--eval', `
      import assert from 'node:assert/strict';
      import { produce, SSE_MAX_BUFFER_BYTES } from './src/server.js';
      import { claimProducerQueue } from './src/producer-capabilities.js';
      const collect = () => globalThis.Bun ? Bun.gc(true) : global.gc();
      const frame = (id, event, value) => 'id: ' + id + '\\nevent: ' + event + '\\ndata: ' + value.replace(/\\r\\n|\\r|\\n/g, '\\ndata: ') + '\\n\\n';
      async function deadline(promise) {
        let timer;
        try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('native transfer notification did not settle')), 1000); })]); }
        finally { clearTimeout(timer); }
      }
      function open(coalesceBytes) {
        let controls, cleanup = 0;
        const response = produce(value => { controls = value; return () => { cleanup++; }; }, { coalesceBytes });
        const reader = new ReadableStreamDefaultReader(response.body);
        const queue = claimProducerQueue(response.body, { byteLength: value => Buffer.byteLength(value, 'utf8') });
        assert.ok(queue); assert.equal(queue.tryAttach(), true);
        const terminal = reader.read(); terminal.catch(() => {});
        return { controls, reader, queue, terminal, cleanup: () => cleanup };
      }
      ${source}
    `], { cwd: new URL('../', import.meta.url), encoding: 'utf8', timeout: 7000 });
    expect({ status: result.status, stderr: result.stderr, error: result.error?.message }).toEqual({ status: 0, stderr: '', error: undefined });
  }, 10000);
}

for (const coalesceBytes of [0, 128, 16384]) {
  for (const backlog of [false, true]) {
    for (const extra of [0, 1]) {
      nodeCase(`native batch transfer enforces exact UTF-8 budget (target ${coalesceBytes}, backlog ${backlog}, excess ${extra})`, `
        const { controls, reader, queue, terminal, cleanup } = open(${coalesceBytes});
        const event = '更新😀';
        const old = ${backlog} ? frame(1, 'prior', 'old é😀\\r\\nnext\\rtail\\nend') : '';
        if (${backlog}) assert.equal(controls.emit('prior', 'old é😀\\r\\nnext\\rtail\\nend').error, false);
        const firstId = ${backlog ? 2 : 1};
        const seed = 'π😀\\r\\nalpha\\rbeta\\ngamma';
        const values = Array.from({ length: 64 }, (_, index) => seed + index);
        const base = old + values.map((value, index) => frame(firstId + index, event, value)).join('');
        values[values.length - 1] += 'p'.repeat(SSE_MAX_BUFFER_BYTES - Buffer.byteLength(base, 'utf8') + ${extra});
        const expected = old + values.map((value, index) => frame(firstId + index, event, value)).join('');
        assert.equal(Buffer.byteLength(expected, 'utf8'), SSE_MAX_BUFFER_BYTES + ${extra});
        const notify = queue.wait();
        const encode = TextEncoder.prototype.encode;
        let encodes = 0;
        TextEncoder.prototype.encode = function(...args) { encodes++; return encode.apply(this, args); };
        try {
          const result = controls.emitBatch(event, values);
          await deadline(notify);
          if (${extra}) {
            assert.match(result.error?.message ?? '', /buffer/);
            assert.equal(queue.take(), undefined, 'overflow cannot publish staged frames or retain earlier output');
            await assert.rejects(terminal, error => error === result.error);
            assert.equal(queue.isDone(), true);
          } else {
            assert.equal(result.error, false);
            assert.equal(cleanup(), 0);
            controls.lock.set(false);
            const chunks = [];
            let bytes = 0;
            while (true) {
              const chunk = queue.take(); if (!chunk) break;
              assert.equal(chunk.bytes, Buffer.byteLength(chunk.wire, 'utf8'));
              bytes += chunk.bytes; chunks.push(chunk.wire);
            }
            const output = chunks.join('');
            assert.equal(output, expected);
            assert.equal(bytes, SSE_MAX_BUFFER_BYTES);
            const ids = [...output.matchAll(/^id: (\\d+)$/gm)].map(match => Number(match[1]));
            assert.deepEqual(ids, Array.from({ length: ${backlog ? 65 : 64} }, (_, index) => index + 1));
            assert.deepEqual(await deadline(terminal), { value: undefined, done: true });
            assert.equal(queue.isDone(), true);
            assert.equal(queue.take(), undefined, 'ownership transfer happens once');
          }
          assert.equal(encodes, 0);
          assert.equal(cleanup(), 1);
          await deadline(queue.wait());
          queue.dispose(); queue.dispose(); assert.equal(cleanup(), 1);
        } finally {
          TextEncoder.prototype.encode = encode;
          queue.dispose(); await reader.cancel().catch(() => {}); reader.releaseLock();
        }
      `);
    }
  }
}

nodeCase('a late invalid native batch member publishes no staging and discards an earlier backlog atomically', `
  for (const coalesceBytes of [0, 128, 16384]) for (const backlog of [false, true]) {
    const { controls, reader, queue, terminal, cleanup } = open(coalesceBytes);
    try {
      if (backlog) assert.equal(controls.emit('old', 'accepted earlier').error, false);
      const notify = queue.wait();
      const values = Array.from({ length: 64 }, (_, index) => 'é😀\\r\\n' + index + '\\rtail\\nend');
      values.push(123);
      const result = controls.emitBatch('更新😀', values);
      assert.match(result.error?.message ?? '', /strings/);
      await deadline(notify);
      assert.equal(queue.take(), undefined);
      await assert.rejects(terminal, error => error === result.error);
      assert.equal(queue.isDone(), true);
      assert.equal(cleanup(), 1);
      queue.dispose(); assert.equal(cleanup(), 1);
    } finally { queue.dispose(); await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
`);

for (const coalesceBytes of [0, 128, 16384]) {
  for (const backlog of [false, true]) {
    for (const runtime of ['node', 'bun'])
    nodeCase(`native multi-group transfer detaches caller event/data parents (target ${coalesceBytes}, backlog ${backlog}, runtime ${runtime})`, `
      new Response('warm runtime'); collect();
      const before = process.memoryUsage().heapUsed;
      const { controls, reader, queue, terminal, cleanup } = open(${coalesceBytes});
      if (${backlog}) assert.equal(controls.emit('old', 'prior accepted').error, false);
      function sendSlicedParents() {
        // These parents are created after produce(), outside its setup closure.
        // A surviving 32 MiB parent therefore indicates wire ownership failure.
        const eventParent = 'E'.repeat(32 * 1024 * 1024);
        const dataParent = 'D'.repeat(32 * 1024 * 1024);
        const event = eventParent.slice(100, 300);
        const values = Array.from({ length: 96 }, (_, index) => dataParent.slice(500 + index * 200, 700 + index * 200));
        assert.equal(controls.emitBatch(event, values).error, false);
      }
      try {
        sendSlicedParents();
        for (let index = 0; index < 4; index++) { await new Promise(resolve => setTimeout(resolve, 0)); collect(); }
        const retained = process.memoryUsage().heapUsed - before;
        assert.ok(retained < 4 * 1024 * 1024, 'native batch retained a caller parent: ' + retained);
        assert.equal(cleanup(), 0);
        controls.lock.set(false);
        const chunks = [];
        while (true) { const chunk = queue.take(); if (!chunk) break; assert.equal(chunk.bytes, Buffer.byteLength(chunk.wire, 'utf8')); chunks.push(chunk.wire); }
        const output = chunks.join('');
        const ids = [...output.matchAll(/^id: (\\d+)$/gm)].map(match => Number(match[1]));
        assert.deepEqual(ids, Array.from({ length: ${backlog ? 97 : 96} }, (_, index) => index + 1));
        assert.equal((output.match(/^event: E{200}$/gm) ?? []).length, 96);
        assert.equal((output.match(/^data: D{200}$/gm) ?? []).length, 96);
        assert.deepEqual(await deadline(terminal), { value: undefined, done: true });
        assert.equal(cleanup(), 1);
      } finally { queue.dispose(); await reader.cancel().catch(() => {}); reader.releaseLock(); }
    `, runtime);
  }
}

nodeCase('a drained transferred batch leaves a native waiter that disposal settles exactly once', `
  for (const coalesceBytes of [0, 128, 16384]) {
    const { controls, reader, queue, terminal, cleanup } = open(coalesceBytes);
    try {
      assert.equal(controls.emitBatch('更新😀', ['é😀\\r\\nfirst', 'second\\rtail\\nend']).error, false);
      const chunks = [];
      while (true) { const chunk = queue.take(); if (!chunk) break; chunks.push(chunk.wire); }
      assert.equal(chunks.join(''), frame(1, '更新😀', 'é😀\\r\\nfirst') + frame(2, '更新😀', 'second\\rtail\\nend'));
      assert.equal(cleanup(), 0);
      const waiting = queue.wait();
      queue.dispose(); queue.dispose();
      await deadline(waiting);
      await deadline(queue.wait());
      assert.deepEqual(await deadline(terminal), { value: undefined, done: true });
      assert.equal(queue.isDone(), true); assert.equal(queue.take(), undefined); assert.equal(cleanup(), 1);
    } finally { queue.dispose(); await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
`);
