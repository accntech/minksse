import { expect, spyOn, test } from 'bun:test';
import { produce } from '../src/server.js';

const frame = (id, data) => `id: ${id}\nevent: tick\ndata: ${data}\n\n`;

test('staging multiple coalescing groups does not copy wire strings before final validation', async () => {
  let controls;
  const response = produce(value => { controls = value; }, { coalesceBytes: 40 });
  const values = ['first', 'second', 'placeholder'];
  let stagingCopies;
  const join = spyOn(Array.prototype, 'join');
  Object.defineProperty(values, 2, { get() {
    // Header setup may compact/cache one event name. Closing staged groups must
    // not copy wire data that could be discarded by this final invalid value.
    stagingCopies = join.mock.calls.filter(args => args[0] === '').length;
    return 123;
  } });
  try {
    expect(controls.emitBatch('tick', values).error).toBeInstanceOf(Error);
    expect(stagingCopies).toBeLessThanOrEqual(2);
    await expect(response.text()).rejects.toThrow('strings');
  } finally { join.mockRestore(); }
});

test('direct and retained groups preserve every value without touching caller arrays twice', async () => {
  let controls;
  const response = produce(value => { controls = value; }, { coalesceBytes: 80 });
  const values = ['one', 'two', 'three', 'four'];
  const reads = [];
  const input = new Proxy(values, { get(target, key) { reads.push(key); return Reflect.get(target, key); } });
  expect(controls.emitBatch('tick', input).error).toBe(false);
  controls.lock.set(false);
  expect(await response.text()).toBe(values.map((value,index) => frame(index+1,value)).join(''));
  expect(reads).toEqual(['length','0','1','2','3']);
});

test('a conservatively bounded direct batch avoids per-member Unicode scans', async () => {
  let controls;
  const response = produce(value => { controls = value; }, { coalesceBytes: 16384 });
  const values = Array.from({ length: 16 }, (_, index) => JSON.stringify({ index, payload: 'x'.repeat(128) }));
  const testRegex = spyOn(RegExp.prototype, 'test');
  try {
    expect(controls.emitBatch('tick', values).error).toBe(false);
    // Event validation/name accounting plus one completed-group classification
    // stay constant; no per-member Unicode scans are needed for the safe bound.
    expect(testRegex.mock.calls.length).toBeLessThanOrEqual(3);
  } finally { testRegex.mockRestore(); }
  controls.lock.set(false);
  expect(await response.text()).toBe(values.map((value, index) => frame(index + 1, value)).join(''));
});

test('leaving the bounded direct path never rereads earlier getters or skips exact limits', async () => {
  let controls;
  const response = produce(value => { controls = value; }, { coalesceBytes: 128 });
  const reads = [];
  const values = ['one', '😀'.repeat(100), 'last'];
  const input = new Proxy(values, { get(target, key) { reads.push(key); return Reflect.get(target, key); } });
  expect(controls.emitBatch('tick', input).error).toBe(false);
  controls.lock.set(false);
  expect(await response.text()).toBe(values.map((value,index) => frame(index+1,value)).join(''));
  expect(reads).toEqual(['length', '0', '1', '2']);
});

test('oversized event names are rejected before copying retained metadata', async () => {
  let controls;
  const response = produce(value => { controls = value; }, { coalesceBytes: 16384 });
  const join = spyOn(Array.prototype, 'join');
  try {
    expect(controls.emitBatch('x'.repeat(300_000), ['value']).error).toBeInstanceOf(Error);
    expect(join).not.toHaveBeenCalled();
    await expect(response.text()).rejects.toThrow('buffer');
  } finally { join.mockRestore(); }
});

test('newline-heavy overflow is rejected before allocating normalized data', async () => {
  let controls;
  const response = produce(value => { controls = value; }, { coalesceBytes: 16384 });
  const replace = spyOn(String.prototype, 'replace');
  try {
    expect(controls.emitBatch('tick', ['\n'.repeat(100_000)]).error).toBeInstanceOf(Error);
    expect(replace).not.toHaveBeenCalled();
    await expect(response.text()).rejects.toThrow('buffer');
  } finally { replace.mockRestore(); }
});

test('bounded ASCII batches encode once into exactly owned byte storage', async () => {
  let controls;
  const response = produce(value => { controls = value; }, { coalesceBytes: 16384 });
  const into = spyOn(TextEncoder.prototype, 'encodeInto');
  const encode = spyOn(TextEncoder.prototype, 'encode');
  try {
    expect(controls.emitBatch('tick', ['one', 'two']).error).toBe(false);
    expect(into).toHaveBeenCalledTimes(1);
    expect(encode).not.toHaveBeenCalled();
  } finally { into.mockRestore(); encode.mockRestore(); }
  controls.lock.set(false);
  const reader = response.body.getReader();
  const result = await reader.read();
  expect(result.value.buffer.byteLength).toBe(result.value.byteLength);
  expect(new TextDecoder().decode(result.value)).toBe(frame(1, 'one') + frame(2, 'two'));
  reader.releaseLock();
});

test('a bounded batch never encodes before a late invalid member is rejected', async () => {
  let controls;
  const response = produce(value => { controls = value; }, { coalesceBytes: 16384 });
  const into = spyOn(TextEncoder.prototype, 'encodeInto');
  const encode = spyOn(TextEncoder.prototype, 'encode');
  try {
    expect(controls.emitBatch('tick', ['prefix', 123]).error).toBeInstanceOf(Error);
    expect(into).not.toHaveBeenCalled();
    expect(encode).not.toHaveBeenCalled();
    await expect(response.text()).rejects.toThrow('strings');
  } finally { into.mockRestore(); encode.mockRestore(); }
});

test('an empty producer pull avoids querying the byte budget', async () => {
  const response = produce(() => {}, { coalesceBytes: 16384 });
  const prototype = ReadableStreamDefaultController.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'desiredSize');
  let reads = 0;
  Object.defineProperty(prototype, 'desiredSize', { ...descriptor, get() { reads++; return descriptor.get.call(this); } });
  const reader = response.body.getReader();
  try {
    const pending = reader.read();
    await Promise.resolve();
    await Promise.resolve();
    expect(reads).toBe(0);
    await reader.cancel();
    expect((await pending).done).toBe(true);
  } finally { Object.defineProperty(prototype, 'desiredSize', descriptor); await reader.cancel(); reader.releaseLock(); }
});

test('default response headers avoid redundant Headers constructors and stay isolated', async () => {
  const Original = globalThis.Headers;
  let constructions = 0;
  globalThis.Headers = class extends Original { constructor(...args) { super(...args); constructions++; } };
  let first;
  let second;
  try {
    first = produce(({ lock }) => { lock.set(false); });
    second = produce(({ lock }) => { lock.set(false); });
    expect(constructions).toBe(0);
    first.headers.set('Cache-Control', 'private');
    expect(second.headers.get('Cache-Control')).toBe('no-store');
    expect(second.headers.get('Content-Type')).toBe('text/event-stream');
  } finally {
    globalThis.Headers = Original;
    await first?.body?.cancel();
    await second?.body?.cancel();
  }
});

for (const event of ['tick', '更新😀', 'data: text: suffix']) {
  test(`bounded frame capture replays IDs and raw data once across fallback (${event})`, async () => {
    let controls;
    const response = produce(value => { controls = value; }, { coalesceBytes: 512 });
    const reader = response.body.getReader();
    expect(controls.emitBatch('seed', Array.from({ length: 984 }, () => '')).error).toBe(false);
    let seeded = 0;
    while (seeded < 984) seeded += (new TextDecoder().decode((await reader.read()).value).match(/^id: /gm) ?? []).length;
    const values = ['data: embedded text', '😀before', 'line\r\nnext\rend\n', ...Array.from({ length: 13 }, (_, i) => 'value:' + i)];
    const reads = [];
    const input = new Proxy(values, { get(target, key) { reads.push(key); return Reflect.get(target, key); } });
    expect(controls.emitBatch(event, input).error).toBe(false);
    controls.lock.set(false);
    let output = '';
    while (true) { const part = await reader.read(); if (part.done) break; output += new TextDecoder().decode(part.value); }
    expect(output).toBe(values.map((value, index) => `id: ${985 + index}\nevent: ${event}\ndata: ${value.replace(/\r\n|\r|\n/g, '\ndata: ')}\n\n`).join(''));
    expect(reads).toEqual(['length', ...values.map((_, index) => String(index))]);
    reader.releaseLock();
  });
}

test('a safely bounded multiline batch avoids per-member exact Unicode scans', async () => {
  let controls;
  const response = produce(value => { controls = value; }, { coalesceBytes: 16384 });
  const values = Array.from({ length: 16 }, (_, index) => `line:${index}\r\n${'x'.repeat(100)}\rtail\n`);
  const regex = spyOn(RegExp.prototype, 'test');
  const into = spyOn(TextEncoder.prototype, 'encodeInto');
  const encode = spyOn(TextEncoder.prototype, 'encode');
  try {
    expect(controls.emitBatch('tick', values).error).toBe(false);
    expect(regex.mock.calls.length).toBeLessThanOrEqual(3);
    expect(into).toHaveBeenCalledTimes(1);
    expect(encode).not.toHaveBeenCalled();
  } finally { regex.mockRestore(); into.mockRestore(); encode.mockRestore(); }
  controls.lock.set(false);
  expect(await response.text()).toBe(values.map((value, index) => frame(index + 1, value.replace(/\r\n|\r|\n/g, '\ndata: '))).join(''));
});

test('bounded CRLF proof counts a pair once before normalization', async () => {
  const value = '\r\n'.repeat(10);
  const raw = frame(1, value);
  const target = raw.length * 3 + 10 * 6;
  let controls;
  const response = produce(result => { controls = result; }, { coalesceBytes: target });
  const into = spyOn(TextEncoder.prototype, 'encodeInto');
  try {
    expect(controls.emitBatch('tick', [value]).error).toBe(false);
    expect(into).toHaveBeenCalledTimes(1);
  } finally { into.mockRestore(); }
  controls.lock.set(false);
  const reader = response.body.getReader();
  const chunk = (await reader.read()).value;
  expect(chunk.byteLength).toBeLessThanOrEqual(target);
  expect(new TextDecoder().decode(chunk)).toBe(frame(1, value.replace(/\r\n|\r|\n/g, '\ndata: ')));
  reader.releaseLock();
});

test('large multiline batches avoid normalization that exact staging would repeat', async () => {
  let controls;
  const response = produce(value => { controls = value; }, { coalesceBytes: 16384 });
  const values = Array.from({ length: 16 }, (_, index) => `row:${index}\r\n${'x'.repeat(1000)}\n`);
  const replace = spyOn(String.prototype, 'replace');
  try {
    expect(controls.emitBatch('tick', values).error).toBe(false);
    expect(replace).toHaveBeenCalledTimes(values.length);
  } finally { replace.mockRestore(); }
  controls.lock.set(false);
  expect(await response.text()).toBe(values.map((value, index) => frame(index + 1, value.replace(/\r\n|\r|\n/g, '\ndata: '))).join(''));
});

test('large ASCII batches choose exact staging after only one speculative member', async () => {
  let controls;
  const response = produce(value => { controls = value; }, { coalesceBytes: 16384 });
  const values = Array.from({ length: 16 }, (_, index) => `row:${index}:${'x'.repeat(1000)}`);
  const push = spyOn(Array.prototype, 'push');
  let captured;
  try {
    expect(controls.emitBatch('tick', values).error).toBe(false);
    captured = push.mock.calls.filter(args => typeof args[0] === 'string' && values.includes(args[0])).length;
    expect(captured).toBe(1);
  } finally { push.mockRestore(); }
  controls.lock.set(false);
  expect(await response.text()).toBe(values.map((value, index) => frame(index + 1, value)).join(''));
});

test('eligibility prediction preserves the 64 KiB direct batch fast path', async () => {
  let controls;
  const response = produce(value => { controls = value; }, { coalesceBytes: 65536 });
  const values = Array.from({ length: 16 }, (_, index) => `row:${index}:${'x'.repeat(1000)}`);
  const into = spyOn(TextEncoder.prototype, 'encodeInto');
  const encode = spyOn(TextEncoder.prototype, 'encode');
  try {
    expect(controls.emitBatch('tick', values).error).toBe(false);
    expect(into).toHaveBeenCalledTimes(1);
    expect(encode).not.toHaveBeenCalled();
  } finally { into.mockRestore(); encode.mockRestore(); }
  controls.lock.set(false);
  expect(await response.text()).toBe(values.map((value, index) => frame(index + 1, value)).join(''));
});

test('a heterogeneous batch chosen for exact staging still reads each getter once', async () => {
  let controls;
  const response = produce(value => { controls = value; }, { coalesceBytes: 16384 });
  const values = ['x'.repeat(2000), ...Array.from({ length: 15 }, (_, index) => index % 2 ? 'é\r\nshort' : '😀')];
  const reads = [];
  const input = new Proxy(values, { get(target, key) { reads.push(key); return Reflect.get(target, key); } });
  expect(controls.emitBatch('tick', input).error).toBe(false);
  controls.lock.set(false);
  expect(await response.text()).toBe(values.map((value, index) => frame(index + 1, value.replace(/\r\n|\r|\n/g, '\ndata: '))).join(''));
  expect(reads).toEqual(['length', ...values.map((_, index) => String(index))]);
});

test('early exact staging rejects Unicode overflow before reading a later getter', async () => {
  let controls;
  const response = produce(value => { controls = value; }, { coalesceBytes: 16384 });
  let laterRead = false;
  const values = ['x'.repeat(2000), '€'.repeat(100_000), 'later'];
  Object.defineProperty(values, 2, { get() { laterRead = true; return 'later'; } });
  expect(controls.emitBatch('tick', values).error).toBeInstanceOf(Error);
  expect(laterRead).toBe(false);
  await expect(response.text()).rejects.toThrow('buffer');
});
