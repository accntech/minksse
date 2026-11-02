import { expect, spyOn, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { produce, SSE_MAX_BUFFER_BYTES } from '../src/server.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const wire = (id, event, data) => `id: ${id}\nevent: ${event}\ndata: ${data.replace(/\r\n|\r|\n/g, '\ndata: ')}\n\n`;

function open(options) {
  let controls;
  let cleanups = 0;
  const response = produce(value => { controls = value; return () => { cleanups++; }; }, options);
  expect(typeof controls.emitBatch).toBe('function');
  return { response, controls, cleanups: () => cleanups };
}
async function chunks(response) {
  const output = [];
  for await (const chunk of response.body) output.push(chunk);
  return output;
}

test('emitBatch groups an available positive-target batch into its first output chunk', async () => {
  const { response, controls, cleanups } = open({ coalesceBytes: 8192 });
  expect(controls.emitBatch('tick', ['one', 'two', 'three']).error).toBe(false);
  controls.lock.set(false);
  const output = await chunks(response);
  expect(output.map(value => decoder.decode(value))).toEqual([
    wire(1, 'tick', 'one') + wire(2, 'tick', 'two') + wire(3, 'tick', 'three')
  ]);
  expect(cleanups()).toBe(1);
});

test('emitBatch with coalescing off retains independent event chunks and scalar ordering', async () => {
  const { response, controls } = open();
  controls.emit('first', 'before');
  expect(controls.emitBatch('tick', ['one', 'two']).error).toBe(false);
  controls.emit('last', 'after'); controls.lock.set(false);
  expect((await chunks(response)).map(value => decoder.decode(value))).toEqual([
    wire(1, 'first', 'before'), wire(2, 'tick', 'one'), wire(3, 'tick', 'two'), wire(4, 'last', 'after')
  ]);
});

test('emitBatch counts UTF-8 and multiline frames against the chunk target without splitting events', async () => {
  const values = ['€\r\n😀', 'one', 'a\rb\nc', '', 'final'];
  const expected = values.map((value, index) => wire(index + 1, '更新', value));
  const target = encoder.encode(expected[0] + expected[1]).byteLength;
  const { response, controls } = open({ coalesceBytes: target });
  expect(controls.emitBatch('更新', values).error).toBe(false); controls.lock.set(false);
  const output = await chunks(response);
  expect(output.map(value => decoder.decode(value)).join('')).toBe(expected.join(''));
  for (const chunk of output) {
    const text = decoder.decode(chunk);
    expect(chunk.byteLength <= target || expected.some(value => value === text)).toBe(true);
    expect(text.endsWith('\n\n')).toBe(true);
  }
});

test('an empty batch neither consumes an ID nor encodes a chunk', async () => {
  const { response, controls } = open({ coalesceBytes: 8192 });
  const encode = spyOn(TextEncoder.prototype, 'encode');
  try {
    expect(controls.emitBatch('tick', []).error).toBe(false);
    expect(encode).toHaveBeenCalledTimes(0);
    controls.emit('tick', 'first'); controls.lock.set(false);
    expect(await response.text()).toBe(wire(1, 'tick', 'first'));
  } finally { encode.mockRestore(); }
});

test('scalar and batch success results remain fresh caller-owned objects', async () => {
  const { response, controls } = open({ coalesceBytes: 8192 });
  const scalar = controls.emit('tick', 'one');
  const batch = controls.emitBatch('tick', ['two']);
  scalar.error = new Error('caller-owned scalar result');
  batch.error = new Error('caller-owned batch result');
  const nextScalar = controls.emit('tick', 'three');
  const nextBatch = controls.emitBatch('tick', ['four']);
  expect(nextScalar).not.toBe(scalar); expect(nextScalar.error).toBe(false);
  expect(nextBatch).not.toBe(batch); expect(nextBatch.error).toBe(false);
  controls.lock.set(false);
  expect(await response.text()).toBe(['one', 'two', 'three', 'four'].map((data, index) => wire(index + 1, 'tick', data)).join(''));
});

test('invalid batch inputs and a late invalid value terminate without encoding a staged prefix', async () => {
  const cases = [
    ['tick', 'not an array'], ['tick', ['valid', 123]], ['bad\nevent', []], ['tick', ['valid', , 'hole']]
  ];
  for (const [event, values] of cases) {
    const { response, controls, cleanups } = open({ coalesceBytes: 8192 });
    const encode = spyOn(TextEncoder.prototype, 'encode');
    try {
      const result = controls.emitBatch(event, values);
      expect(result.error).toBeInstanceOf(Error);
      expect(encode).toHaveBeenCalledTimes(0);
      await expect(response.text()).rejects.toThrow();
      expect(cleanups()).toBe(1);
    } finally { encode.mockRestore(); }
  }
});

test('an overflowing batch is atomic and includes already prefetched bytes in the budget', async () => {
  const { response, controls, cleanups } = open({ coalesceBytes: 8192 });
  controls.emit('tick', 'prefetch');
  const encode = spyOn(TextEncoder.prototype, 'encode');
  try {
    const result = controls.emitBatch('tick', ['x'.repeat(SSE_MAX_BUFFER_BYTES - 100), 'x'.repeat(100)]);
    expect(result.error?.message).toContain('buffer');
    expect(encode).toHaveBeenCalledTimes(0);
    await expect(response.text()).rejects.toThrow('buffer');
    expect(cleanups()).toBe(1);
  } finally { encode.mockRestore(); }
});

test('a throwing array getter reports its original error without publishing a valid staged prefix', async () => {
  const { response, controls, cleanups } = open({ coalesceBytes: 8192 });
  const failure = new Error('getter failed');
  const values = ['valid', 'placeholder'];
  Object.defineProperty(values, 1, { get() { throw failure; } });
  expect(controls.emitBatch('tick', values).error).toBe(failure);
  await expect(response.text()).rejects.toThrow('getter failed');
  expect(cleanups()).toBe(1);
});

for (const operation of ['emit', 'emitBatch']) {
  test(`a reentrant ${operation} from a value getter fails the whole batch without publishing it`, async () => {
    const { response, controls, cleanups } = open({ coalesceBytes: 8192 });
    let nested;
    const values = ['valid', 'placeholder'];
    Object.defineProperty(values, 1, { get() {
      nested = operation === 'emit' ? controls.emit('nested', 'data') : controls.emitBatch('nested', ['data']);
      return 'ignored';
    } });
    const result = controls.emitBatch('tick', values);
    expect(result.error).toBeInstanceOf(Error);
    expect(nested.error).toBe(result.error);
    await expect(response.text()).rejects.toThrow(); expect(cleanups()).toBe(1);
  });
}

test('a proxy length getter cannot reenter scalar emission during batch validation', async () => {
  const { response, controls } = open({ coalesceBytes: 8192 });
  const values = new Proxy(['one'], { get(target, key, receiver) {
    if (key === 'length') controls.emit('nested', 'data');
    return Reflect.get(target, key, receiver);
  } });
  expect(controls.emitBatch('tick', values).error).toBeInstanceOf(Error);
  await expect(response.text()).rejects.toThrow();
});

for (const stop of ['abort', 'finish']) {
  test(`${stop} in a getter drops staging while draining only earlier accepted frames`, async () => {
    const controller = new AbortController();
    const { response, controls, cleanups } = open({ signal: controller.signal, coalesceBytes: 8192 });
    controls.emit('old', 'accepted');
    const values = ['staged', 'placeholder'];
    Object.defineProperty(values, 1, { get() {
      if (stop === 'abort') controller.abort(); else controls.lock.set(false);
      return 'ignored';
    } });
    expect(controls.emitBatch('new', values).error).toBeInstanceOf(Error);
    expect(await response.text()).toBe(wire(1, 'old', 'accepted'));
    expect(cleanups()).toBe(1);
  });
}

test('a reader pulled from a getter cannot observe an invalid batch prefix', async () => {
  const { response, controls } = open({ coalesceBytes: 8192 });
  const reader = response.body.getReader();
  let pending;
  const values = ['placeholder', 'placeholder'];
  Object.defineProperty(values, 0, { get() { pending = reader.read(); pending.catch(() => {}); return 'valid'; } });
  Object.defineProperty(values, 1, { get() { throw new Error('late failure'); } });
  try {
    expect(controls.emitBatch('tick', values).error?.message).toBe('late failure');
    await expect(pending).rejects.toThrow('late failure');
  } finally { reader.releaseLock(); }
});

test('batch output buffers remain independently owned and a later batch resumes the ID sequence', async () => {
  const target = encoder.encode(wire(1, 'tick', 'one') + wire(2, 'tick', 'two')).byteLength;
  const { response, controls } = open({ coalesceBytes: target });
  controls.emitBatch('tick', ['one', 'two', 'three']);
  const reader = response.body.getReader();
  try {
    const first = (await reader.read()).value;
    first.fill(0); structuredClone(first.buffer, { transfer: [first.buffer] });
    expect(decoder.decode((await reader.read()).value)).toBe(wire(3, 'tick', 'three'));
    controls.emitBatch('tick', ['four']); controls.lock.set(false);
    expect(decoder.decode((await reader.read()).value)).toBe(wire(4, 'tick', 'four'));
    expect((await reader.read()).done).toBe(true);
  } finally { reader.releaseLock(); }
});

for (const runtime of [process.execPath, Bun.which('node')].filter(Boolean)) {
  test(`batch queue cannot retain a large caller slice (${runtime.split('/').at(-1)})`, () => {
    const node = runtime === Bun.which('node');
    const source = `
      import assert from 'node:assert/strict';
      import { produce } from './src/server.js';
      const collect = () => ${node ? 'global.gc()' : 'Bun.gc(true)'};
      new Response('warm runtime'); collect(); const before = process.memoryUsage().heapUsed;
      let controls; const response = produce(value => { controls = value; }, { coalesceBytes: 8192 });
      assert.equal(typeof controls.emitBatch, 'function');
      controls.emit('prefetch', 'one');
      function send() {
        const original = 'x'.repeat(16 * 1024 * 1024);
        assert.equal(controls.emitBatch(original.slice(100, 300), [original.slice(500, 700)]).error, false);
      }
      send();
      for (let index = 0; index < 3; index++) { await new Promise(resolve => setTimeout(resolve, 0)); collect(); }
      assert.ok(process.memoryUsage().heapUsed - before < 4 * 1024 * 1024);
      await response.body.cancel();
    `;
    const result = spawnSync(runtime, [...(node ? ['--expose-gc'] : []), '--input-type=module', '--eval', source], {
      cwd: new URL('../', import.meta.url), encoding: 'utf8', timeout: 5000
    });
    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
  });
}

for (const runtime of [process.execPath, Bun.which('node')].filter(Boolean)) {
  for (const coalesceBytes of [0, 512, 1024]) {
    for (const prefetch of [false, true]) {
      test(`multi-group batch detaches event/data parents (${runtime.split('/').at(-1)}, ${coalesceBytes}, prefetch ${prefetch})`, () => {
        const node = runtime === Bun.which('node');
        const source = `
          import assert from 'node:assert/strict';
          import { produce } from './src/server.js';
          const collect = () => ${node ? 'global.gc()' : 'Bun.gc(true)'};
          new Response('warm runtime'); collect(); const before = process.memoryUsage().heapUsed;
          let controls;
          const response = produce(value => { controls = value; }, { coalesceBytes: ${coalesceBytes} });
          ${prefetch ? "controls.emit('prefetch', 'accepted');" : ''}
          function send() {
            const original = 'x'.repeat(16 * 1024 * 1024);
            const event = original.slice(100, 300);
            const values = Array.from({ length: 8 }, (_, index) => original.slice(500 + index * 200, 700 + index * 200));
            assert.equal(controls.emitBatch(event, values).error, false);
          }
          send();
          for (let index = 0; index < 4; index++) { await new Promise(resolve => setTimeout(resolve, 0)); collect(); }
          assert.ok(process.memoryUsage().heapUsed - before < 4 * 1024 * 1024, 'batch retained a caller parent');
          controls.lock.set(false);
          const text = await response.text();
          assert.equal((text.match(/^id: /gm) ?? []).length, ${prefetch ? 9 : 8});
        `;
        const result = spawnSync(runtime, [...(node ? ['--expose-gc'] : []), '--input-type=module', '--eval', source], {
          cwd: new URL('../', import.meta.url), encoding: 'utf8', timeout: 5000
        });
        expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
      });
    }
  }
}

test('emitBatch reads each proxy value and its length only once', async () => {
  const { response, controls } = open({ coalesceBytes: 8192 });
  const reads = new Map();
  const values = new Proxy(['one', 'two', 'three'], { get(target, key, receiver) {
    reads.set(key, (reads.get(key) ?? 0) + 1);
    return Reflect.get(target, key, receiver);
  } });
  expect(controls.emitBatch('tick', values).error).toBe(false); controls.lock.set(false);
  expect(reads.get('length')).toBe(1);
  for (const index of ['0', '1', '2']) expect(reads.get(index)).toBe(1);
  expect(await response.text()).toBe(['one', 'two', 'three'].map((data, index) => wire(index + 1, 'tick', data)).join(''));
});

test('emitBatch does not combine Unicode or line endings across event boundaries', async () => {
  const values = ['ascii', '\ud800', '\udc00', '\r', '\n', '😀', 'a\r\nb', 'last'];
  const { response, controls } = open({ coalesceBytes: 8192 });
  expect(controls.emitBatch('更新', values).error).toBe(false); controls.lock.set(false);
  const expected = values.map((data, index) => wire(index + 1, '更新', data)).join('');
  expect(await response.text()).toBe(decoder.decode(encoder.encode(expected)));
});

