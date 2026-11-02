import { expect, spyOn, test } from 'bun:test';
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { produce, SSE_MAX_BUFFER_BYTES } from '../src/server.js';
import { installProducerCapabilities } from '../src/producer-capabilities.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const wire = (id, event, data) => `id: ${id}\nevent: ${event}\ndata: ${data.replace(/\r\n|\r|\n/g, '\ndata: ')}\n\n`;
function open(options) {
  let controls; let cleanups = 0;
  const response = produce(value => { controls = value; return () => { cleanups++; }; }, options);
  const reader = response.body.getReader();
  return { response, reader, controls, cleanups: () => cleanups };
}
function capabilities() {
  const measured = [];
  return { measured, hooks: {
    byteLength(value) { measured.push(value); return Buffer.byteLength(value, 'utf8'); }
  } };
}
async function readAll(reader) {
  const output = [];
  try {
    while (true) { const part = await reader.read(); if (part.done) return output; output.push(part.value); }
  } finally { reader.releaseLock(); }
}

test('producer consumes its private byte counter after an owning reader attaches', async () => {
  const { response, reader, controls, cleanups } = open({ coalesceBytes: 8192 });
  const caps = capabilities();
  expect(installProducerCapabilities(response.body, caps.hooks)).toBe(true);
  expect(controls.emit('更新', 'deferred 😀').error).toBe(false); controls.lock.set(false);
  const output = await readAll(reader);
  expect(decoder.decode(output[0])).toBe(wire(1, '更新', 'deferred 😀'));
  expect(caps.measured).toContain('更新'); expect(caps.measured).toContain('deferred 😀');
  expect(cleanups()).toBe(1);
});

test('synchronous emissions use the generic path and queued byte counts remain valid after installation', async () => {
  let controls;
  const response = produce(value => {
    controls = value;
    value.emit('sync', '€'); value.emit('sync', 'already queued 😀');
  }, { coalesceBytes: 8192 });
  const reader = response.body.getReader(); const caps = capabilities();
  expect(installProducerCapabilities(response.body, caps.hooks)).toBe(true);
  const first = await reader.read(); expect(decoder.decode(first.value)).toBe(wire(1, 'sync', '€'));
  expect(caps.measured.length).toBe(0);
  const queued = await reader.read(); expect(decoder.decode(queued.value)).toBe(wire(2, 'sync', 'already queued 😀'));
  controls.emit('future', 'native count'); controls.lock.set(false);
  expect(decoder.decode((await reader.read()).value)).toBe(wire(3, 'future', 'native count'));
  expect(caps.measured).toContain('native count'); expect((await reader.read()).done).toBe(true);
  reader.releaseLock();
});

for (const batch of [false, true]) for (const coalesceBytes of [0, 128]) {
  test(`private native counts preserve UTF-8 and every CR/LF combination (batch ${batch}, target ${coalesceBytes})`, async () => {
    const values = ['ascii', '\u007f', '\u0080', 'é', '€', '😀', '\ud800', '\udfff', '\r', '\n', '\r\n', '\r\n\r\n', '\n\r', '\r\r\n', '\r\n\n', '😀\r\n€'];
    const { response, reader, controls } = open({ coalesceBytes }); const caps = capabilities();
    expect(installProducerCapabilities(response.body, caps.hooks)).toBe(true);
    if (batch) expect(controls.emitBatch('更新😀', values).error).toBe(false);
    else for (const value of values) expect(controls.emit('更新😀', value).error).toBe(false);
    controls.lock.set(false);
    const output = await readAll(reader);
    const expected = values.map((value, index) => wire(index + 1, '更新😀', value)).join('');
    expect(output.map(value => decoder.decode(value)).join('')).toBe(decoder.decode(encoder.encode(expected)));
    expect(caps.measured).toContain('😀\r\n€');
  });
}

test('native counting accepts an exact wire budget with Unicode and normalized newlines', async () => {
  const event = '更新😀'; const pattern = '😀\r\n€\n';
  const base = Buffer.byteLength(wire(1, event, ''));
  const patternBytes = Buffer.byteLength(pattern.replace(/\r\n|\r|\n/g, '\ndata: '));
  const count = Math.floor((SSE_MAX_BUFFER_BYTES - base) / patternBytes);
  const value = pattern.repeat(count) + 'x'.repeat(SSE_MAX_BUFFER_BYTES - base - patternBytes * count);
  expect(Buffer.byteLength(wire(1, event, value))).toBe(SSE_MAX_BUFFER_BYTES);
  const { response, reader, controls } = open({ coalesceBytes: 8192 }); const caps = capabilities();
  expect(installProducerCapabilities(response.body, caps.hooks)).toBe(true);
  expect(controls.emitBatch(event, [value]).error).toBe(false); controls.lock.set(false);
  const output = await readAll(reader);
  expect(output.length).toBe(1); expect(output[0].byteLength).toBe(SSE_MAX_BUFFER_BYTES);
  expect(decoder.decode(output[0])).toBe(wire(1, event, value));
});

test('native counting rejects a one-byte excess before expanding data or encoding a body chunk', async () => {
  const event = '更新'; const pattern = '😀\r\n€\n';
  const base = Buffer.byteLength(wire(1, event, ''));
  const patternBytes = Buffer.byteLength(pattern.replace(/\r\n|\r|\n/g, '\ndata: '));
  const count = Math.floor((SSE_MAX_BUFFER_BYTES - base) / patternBytes);
  const value = pattern.repeat(count) + 'x'.repeat(SSE_MAX_BUFFER_BYTES - base - patternBytes * count + 1);
  const { response, reader, controls, cleanups } = open({ coalesceBytes: 8192 }); const caps = capabilities();
  expect(installProducerCapabilities(response.body, caps.hooks)).toBe(true);
  const replace = spyOn(String.prototype, 'replace');
  const encode = spyOn(TextEncoder.prototype, 'encode');
  try {
    expect(controls.emitBatch(event, [value]).error?.message).toContain('buffer');
    expect(replace).toHaveBeenCalledTimes(0); expect(encode).toHaveBeenCalledTimes(0);
    await expect(reader.read()).rejects.toThrow('buffer'); expect(cleanups()).toBe(1);
  } finally { reader.releaseLock(); replace.mockRestore(); encode.mockRestore(); }
});

test('private byteLength failures retain normal producer cleanup and stream error behavior', async () => {
  const { response, reader, controls, cleanups } = open({ coalesceBytes: 8192 });
  const failure = new Error('byteLength failed');
  expect(installProducerCapabilities(response.body, { byteLength() { throw failure; } })).toBe(true);
  expect(controls.emitBatch('tick', ['one', 'two']).error).toBe(failure);
  await expect(reader.read()).rejects.toThrow('byteLength failed');
  expect(cleanups()).toBe(1); reader.releaseLock();
});

test('native counting retains generic TextEncoder failures and cleanup behavior', async () => {
  const { response, reader, controls, cleanups } = open({ coalesceBytes: 8192 }); const caps = capabilities();
  expect(installProducerCapabilities(response.body, caps.hooks)).toBe(true);
  const failure = new Error('generic encode failed');
  const encode = spyOn(TextEncoder.prototype, 'encode').mockImplementation(() => { throw failure; });
  try {
    expect(controls.emitBatch('tick', ['one', 'two']).error).toBe(failure);
    await expect(reader.read()).rejects.toThrow('generic encode failed'); expect(cleanups()).toBe(1);
  } finally { reader.releaseLock(); encode.mockRestore(); }
});

test('native counting retains independently transferable output buffers', async () => {
  const { response, reader, controls } = open(); const caps = capabilities();
  expect(installProducerCapabilities(response.body, caps.hooks)).toBe(true);
  controls.emitBatch('tick', ['one', 'two']); controls.lock.set(false);
  const first = (await reader.read()).value; first.fill(0); structuredClone(first.buffer, { transfer: [first.buffer] });
  expect(decoder.decode((await reader.read()).value)).toBe(wire(2, 'tick', 'two'));
  expect((await reader.read()).done).toBe(true); reader.releaseLock();
});

test('cloned response bodies retain the generic Web path', async () => {
  let controls;
  const response = produce(value => { controls = value; });
  const clone = response.clone(); const reader = clone.body.getReader(); const caps = capabilities();
  expect(installProducerCapabilities(clone.body, caps.hooks)).toBe(false);
  const cancelOriginal = response.body.cancel();
  controls.emit('tick', 'clone fallback'); controls.lock.set(false);
  expect((await readAll(reader)).map(value => decoder.decode(value)).join('')).toBe(wire(1, 'tick', 'clone fallback'));
  await cancelOriginal;
  expect(caps.measured.length).toBe(0);
});

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

test('native newline jumps preserve long mixed-data exact and overflowing budget boundaries', async () => {
  for (const prefetch of [false, true]) for (const extra of [0, 1]) {
    const { response, reader, controls, cleanups } = open({ coalesceBytes: 16384 }); const caps = capabilities();
    expect(installProducerCapabilities(response.body, caps.hooks)).toBe(true);
    const previous = prefetch ? wire(1, 'old', 'accepted') : '';
    if (prefetch) controls.emit('old', 'accepted');
    const event = '更新😀'; const id = prefetch ? 2 : 1;
    const seed = 'start\r\n' + 'x'.repeat(32768) + '\r' + '😀'.repeat(4096) + '\n' + 'é'.repeat(8192) + '\n\r' + 'tail\r\n';
    const used = Buffer.byteLength(previous + wire(id, event, seed));
    const value = seed + 'z'.repeat(SSE_MAX_BUFFER_BYTES - used + extra);
    expect(Buffer.byteLength(previous + wire(id, event, value))).toBe(SSE_MAX_BUFFER_BYTES + extra);
    const result = controls.emitBatch(event, [value]);
    if (extra) {
      expect(result.error?.message).toContain('buffer');
      await expect(reader.read()).rejects.toThrow('buffer');
      reader.releaseLock();
    } else {
      expect(result.error).toBe(false); controls.lock.set(false);
      const output = await readAll(reader);
      expect(output.map(part => decoder.decode(part)).join('')).toBe(previous + wire(id, event, value));
    }
    expect(cleanups()).toBe(1);
  }
});
