import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';

function nodeCase(name, source) {
  test(name, () => {
    const result = spawnSync('node', ['--input-type=module', '--eval', `
      import assert from 'node:assert/strict';
      import { produce } from './src/server.js';
      import { claimProducerQueue } from './src/producer-capabilities.js';
      function open(coalesceBytes = 16384) {
        let controls, cleanup = 0;
        const response = produce(value => { controls = value; return () => { cleanup++; }; }, { coalesceBytes });
        const reader = new ReadableStreamDefaultReader(response.body);
        const queue = claimProducerQueue(response.body, { byteLength: value => Buffer.byteLength(value, 'utf8') });
        assert.equal(queue.tryAttach(), true);
        const terminal = reader.read(); terminal.catch(() => {});
        return { controls, reader, queue, terminal, cleanup: () => cleanup };
      }
      ${source}
    `], { cwd: new URL('../', import.meta.url), encoding: 'utf8', timeout: 6000 });
    expect({ status: result.status, stderr: result.stderr, error: result.error?.message }).toEqual({ status: 0, stderr: '', error: undefined });
  });
}

nodeCase('native batch captures the trusted counter once instead of dispatching scalar capabilities per member', `
  const set = WeakMap.prototype.set;
  let reads = 0;
  WeakMap.prototype.set = function(key, value) {
    if (key instanceof ReadableStream && value && Object.hasOwn(value, 'control')) {
      let counter;
      Object.defineProperty(value, 'byteLength', {
        configurable: true,
        get() { reads++; return counter; },
        set(value) { counter = value; }
      });
    }
    return set.call(this, key, value);
  };
  let stream;
  try { stream = open(); } finally { WeakMap.prototype.set = set; }
  const { controls, reader, queue, terminal, cleanup } = stream;
  try {
    reads = 0;
    assert.equal(controls.emitBatch('message', Array.from({ length: 1024 }, (_, index) => 'value ' + index)).error, false);
    assert.ok(reads <= 2, 'native batch read scalar capability ' + reads + ' times');
    controls.lock.set(false);
    let output = '';
    for (let next; (next = queue.take());) output += next.wire;
    const ids = [...output.matchAll(/^id: (\\d+)$/gm)].map(match => Number(match[1]));
    assert.deepEqual(ids, Array.from({ length: 1024 }, (_, index) => index + 1));
    assert.deepEqual(await terminal, { value: undefined, done: true });
    assert.equal(cleanup(), 1);
  } finally { queue.dispose(); await reader.cancel().catch(() => {}); reader.releaseLock(); }
`);

for (const invalid of ['type', 'utf8-overflow']) {
  nodeCase(`native batch fully validates the first ${invalid} member before accessing another getter`, `
    const { controls, reader, queue, terminal, cleanup } = open();
    assert.equal(controls.emit('prior', 'p'.repeat(192 * 1024)).error, false);
    let laterReads = 0;
    const values = [${invalid === 'type' ? '123' : "'€'.repeat(25000)"}, 'placeholder'];
    Object.defineProperty(values, 1, { get() { laterReads++; throw new Error('later getter must not run'); } });
    try {
      const result = controls.emitBatch('更新', values);
      assert.match(result.error?.message ?? '', /${invalid === 'type' ? 'strings' : 'buffer'}/);
      assert.equal(laterReads, 0);
      assert.equal(queue.take(), undefined);
      await assert.rejects(terminal, error => error === result.error);
      assert.equal(cleanup(), 1);
    } finally { queue.dispose(); await reader.cancel().catch(() => {}); reader.releaseLock(); }
  `);
}

for (const coalesce of [0, 127, 16384]) {
  for (const backlog of [false, true]) {
    nodeCase(`native batch framing matches UTF-8 normalization at coalescing ${coalesce}, backlog ${backlog}`, `
      const { controls, reader, queue, terminal, cleanup } = open(${coalesce});
      let expected = '', id = 0;
      const append = (event, data) => {
        expected += 'id: ' + (++id) + '\\n' + 'event: ' + event + '\\n' + 'data: ' + data.replace(/\\r\\n|\\r|\\n/g, '\\ndata: ') + '\\n\\n';
      };
      const event = '更新😀';
      const values = ['', 'nul\\0tab\\tdelete\\x7f', 'é€😀', '\\ud800', '\\udc00', 'a\\r\\nb\\rc\\nd', '\\r\\n\\r\\n\\r\\n', 'cached', 'cached'];
      if (${backlog}) { assert.equal(controls.emit('prior', 'existing').error, false); append('prior', 'existing'); }
      assert.equal(controls.emitBatch(event, values).error, false);
      for (const value of values) append(event, value);
      assert.equal(controls.emit('next', 'last').error, false); append('next', 'last');
      controls.lock.set(false);
      const chunks = [];
      for (let frame; (frame = queue.take());) {
        assert.equal(frame.bytes, Buffer.byteLength(frame.wire));
        chunks.push(Buffer.from(frame.wire));
      }
      assert.deepEqual(Buffer.concat(chunks), Buffer.from(expected));
      assert.deepEqual(await terminal, { value: undefined, done: true });
      assert.equal(cleanup(), 1);
      queue.dispose(); reader.releaseLock();
    `);
  }
}
