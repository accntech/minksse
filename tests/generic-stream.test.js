import { expect, spyOn, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { produce, SSE_MAX_BUFFER_BYTES } from '../src/server.js';

const wire = (id, event, data) => `id: ${id}\nevent: ${event}\ndata: ${data.replace(/\r\n|\r|\n/g, '\ndata: ')}\n\n`;

test('producer has no adapter imports or private native capability branches', async () => {
  const source = await readFile(new URL('../src/server.js', import.meta.url), 'utf8');
  expect(source).not.toMatch(/producer-capabilities|nativeCapabilities|nativeAttached|stageNativeBatch|wakeNative|encodeOwned|node:/);
});

for (const coalesceBytes of [0, 128, 16384]) {
  test(`generic stream drains scalar and atomic Unicode batches at coalescing ${coalesceBytes}`, async () => {
    let controls;
    let stops = 0;
    const response = produce(value => { controls = value; return () => stops++; }, { coalesceBytes });
    const reader = response.body.getReader();
    const values = ['é😀\r\nnext\rend\n', '', '\uD800'];
    const pending = reader.read();
    expect(controls.emit('first', 'immediate').error).toBe(false);
    expect(controls.emitBatch('更新', values).error).toBe(false);
    controls.lock.set(false);
    let output = new TextDecoder().decode((await pending).value);
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      expect(result.value).toBeInstanceOf(Uint8Array);
      output += new TextDecoder().decode(result.value);
    }
    expect(output).toBe(wire(1, 'first', 'immediate') + values.map((value, index) => wire(index + 2, '更新', value)).join('').replace('\uD800', '\uFFFD'));
    expect(stops).toBe(1);
    expect(controls.emit('late', '{}').error).toBeInstanceOf(Error);
    reader.releaseLock();
  });
}

test('invalid atomic batch errors a pending generic read without exposing its first member', async () => {
  let controls;
  let stops = 0;
  const response = produce(value => { controls = value; return () => stops++; });
  const reader = response.body.getReader();
  const pending = reader.read();
  const values = ['must not publish', 123];
  expect(controls.emitBatch('message', values).error).toBeInstanceOf(Error);
  await expect(pending).rejects.toThrow('strings');
  expect(stops).toBe(1);
  await reader.cancel().catch(() => {});
  reader.releaseLock();
});

test('generic prefetch plus backlog obey the exact UTF-8 wire budget', async () => {
  let controls;
  const response = produce(value => { controls = value; });
  const first = 'é😀';
  const encoder = new TextEncoder();
  const firstBytes = encoder.encode(wire(1, 'x', first)).length;
  const secondHeaderBytes = encoder.encode(wire(2, 'x', '')).length;
  const second = 'a'.repeat(SSE_MAX_BUFFER_BYTES - firstBytes - secondHeaderBytes);
  expect(controls.emit('x', first).error).toBe(false);
  expect(controls.emitBatch('x', [second]).error).toBe(false);
  expect(controls.emit('x', '').error).toBeInstanceOf(Error);
  await expect(response.text()).rejects.toThrow('buffer');
});

for (const mode of ['clone', 'tee', 'transform']) {
  test(`generic ${mode} consumers preserve byte output and release producer resources`, async () => {
    let controls;
    let stops = 0;
    const response = produce(value => { controls = value; return () => stops++; }, { coalesceBytes: 128 });
    let outputs;
    if (mode === 'clone') outputs = [response, response.clone()];
    else if (mode === 'tee') outputs = response.body.tee().map(body => new Response(body));
    else outputs = [new Response(response.body.pipeThrough(new TransformStream({ transform(chunk, controller) { controller.enqueue(chunk); } })))];
    const pending = outputs.map(output => output.text());
    expect(controls.emitBatch('notice', ['first', 'é😀\r\nsecond']).error).toBe(false);
    controls.lock.set(false);
    const expected = wire(1, 'notice', 'first') + wire(2, 'notice', 'é😀\r\nsecond');
    expect(await Promise.all(pending)).toEqual(outputs.map(() => expected));
    expect(stops).toBe(1);
  });
}

test('a retained completed generic response releases its large setup callback capture in Node', () => {
  const source = `
    import assert from 'node:assert/strict';
    import { produce } from './src/server.js';
    new Response('warm runtime');
    await produce(({ lock }) => { lock.set(false); }).text();
    global.gc();
    const before = process.memoryUsage().heapUsed;
    function makeResponse() {
      const captured = 'x'.repeat(16 * 1024 * 1024);
      return produce(({ emit, lock }) => {
        emit('tick', String(captured.length + captured.charCodeAt(0)));
        lock.set(false);
      });
    }
    globalThis.completedResponse = makeResponse();
    await globalThis.completedResponse.text();
    for (let index = 0; index < 4; index++) {
      await new Promise(resolve => setTimeout(resolve, 0));
      global.gc();
    }
    const retained = process.memoryUsage().heapUsed - before;
    assert.equal(globalThis.completedResponse.bodyUsed, true);
    assert.ok(globalThis.completedResponse.body instanceof ReadableStream);
    delete globalThis.completedResponse;
    assert.ok(retained < 4 * 1024 * 1024, 'completed response retains setup capture: ' + retained);
  `;
  const result = spawnSync('node', ['--expose-gc', '--input-type=module', '--eval', source], {
    cwd: new URL('../', import.meta.url), encoding: 'utf8', timeout: 5000
  });
  expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
});


test('generic TextEncoder failure errors a pending read and cleans up once', async () => {
  let controls;
  let stops = 0;
  const response = produce(value => { controls = value; return () => stops++; }, { coalesceBytes: 8192 });
  const reader = response.body.getReader();
  const failure = new Error('generic encode failed');
  const encode = spyOn(TextEncoder.prototype, 'encode').mockImplementation(() => { throw failure; });
  const encodeInto = spyOn(TextEncoder.prototype, 'encodeInto').mockImplementation(() => { throw failure; });
  try {
    expect(controls.emitBatch('tick', ['one', 'two']).error).toBe(failure);
    await expect(reader.read()).rejects.toThrow('generic encode failed');
    expect(stops).toBe(1);
  } finally { reader.releaseLock(); encode.mockRestore(); encodeInto.mockRestore(); }
});

test('generic delivered buffers remain independently transferable', async () => {
  let controls;
  const response = produce(value => { controls = value; });
  const reader = response.body.getReader();
  controls.emitBatch('tick', ['one', 'two']);
  controls.lock.set(false);
  const first = (await reader.read()).value;
  first.fill(0);
  structuredClone(first.buffer, { transfer: [first.buffer] });
  expect(new TextDecoder().decode((await reader.read()).value)).toBe(wire(2, 'tick', 'two'));
  expect((await reader.read()).done).toBe(true);
  reader.releaseLock();
});

for (const batch of [false, true]) for (const coalesceBytes of [0, 128]) {
  test(`generic UTF-8 and CR/LF matrix (batch ${batch}, target ${coalesceBytes})`, async () => {
    const values = ['ascii', '\u007f', '\u0080', 'é', '€', '😀', '\ud800', '\udfff', '\r', '\n', '\r\n', '\r\n\r\n', '\n\r', '\r\r\n', '\r\n\n', '😀\r\n€'];
    let controls;
    const response = produce(value => { controls = value; }, { coalesceBytes });
    if (batch) expect(controls.emitBatch('更新😀', values).error).toBe(false);
    else for (const value of values) expect(controls.emit('更新😀', value).error).toBe(false);
    controls.lock.set(false);
    const expected = values.map((value, index) => wire(index + 1, '更新😀', value)).join('');
    expect(await response.text()).toBe(new TextDecoder().decode(new TextEncoder().encode(expected)));
  });
}
