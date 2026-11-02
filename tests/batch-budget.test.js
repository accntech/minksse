import { expect, spyOn, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { produce, SSE_MAX_BUFFER_BYTES } from '../src/server.js';
import { installProducerCapabilities } from '../src/producer-capabilities.js';

const decoder = new TextDecoder();
const wire = (id, event, data) => `id: ${id}\nevent: ${event}\ndata: ${data.replace(/\r\n|\r|\n/g, '\ndata: ')}\n\n`;

function open() {
  let controls;
  let cleanups = 0;
  const response = produce(value => {
    controls = value;
    return () => { cleanups++; };
  }, { coalesceBytes: 8192 });
  const reader = response.body.getReader();
  return { response, controls, reader, cleanups: () => cleanups };
}

test('a getter consuming large prefetched output frees budget for the remaining atomic batch', async () => {
  const { controls, reader, cleanups } = open();
  const earlier = 'p'.repeat(192 * 1024);
  const later = 'z'.repeat(200 * 1024);
  expect(controls.emit('old', earlier).error).toBe(false);
  let accepted;
  const values = ['first staged', 'placeholder'];
  Object.defineProperty(values, 1, { get() {
    // read() removes the prefetched chunk synchronously, before its promise is
    // awaited. A cached batch budget must notice the newly available room.
    accepted = reader.read();
    return later;
  } });
  try {
    expect(controls.emitBatch('tick', values).error).toBe(false);
    controls.lock.set(false);
    const first = await accepted;
    expect(decoder.decode(first.value)).toBe(wire(1, 'old', earlier));
    const output = [];
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      output.push(decoder.decode(part.value));
    }
    expect(output.join('')).toBe(wire(2, 'tick', values[0]) + wire(3, 'tick', later));
    expect(cleanups()).toBe(1);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
});

for (const invalid of ['malformed', 'oversized']) {
  test(`consuming prefetched output in a getter cannot publish staging before a later ${invalid} member fails`, async () => {
    const { controls, reader, cleanups } = open();
    const earlier = 'p'.repeat(192 * 1024);
    expect(controls.emit('old', earlier).error).toBe(false);
    let accepted;
    let waiting;
    const values = ['first staged', 'placeholder', invalid === 'malformed' ? 123 : 'x'.repeat(SSE_MAX_BUFFER_BYTES)];
    Object.defineProperty(values, 1, { get() {
      accepted = reader.read();
      waiting = reader.read();
      waiting.catch(() => {});
      return 'z'.repeat(200 * 1024);
    } });
    const encode = spyOn(TextEncoder.prototype, 'encode');
    try {
      const result = controls.emitBatch('tick', values);
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error.message).toContain(invalid === 'malformed' ? 'strings' : 'buffer');
      expect(encode).toHaveBeenCalledTimes(0);
      expect(decoder.decode((await accepted).value)).toBe(wire(1, 'old', earlier));
      await expect(waiting).rejects.toThrow(invalid === 'malformed' ? 'strings' : 'buffer');
      expect(cleanups()).toBe(1);
    } finally {
      encode.mockRestore();
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  });
}

for (const extra of [0, 1]) {
  test(`native Unicode and newline accounting refreshes a getter-freed budget at the exact limit plus ${extra} byte`, async () => {
    const { response, controls, reader, cleanups } = open();
    expect(installProducerCapabilities(response.body, { byteLength: Buffer.byteLength })).toBe(true);
    const earlier = 'p'.repeat(192 * 1024);
    expect(controls.emit('old', earlier).error).toBe(false);
    const event = '更新😀';
    const prefix = 'first staged';
    const seed = '前😀\r\nalpha\rbeta\ngamma\r\n終é';
    const fixedBytes = Buffer.byteLength(wire(2, event, prefix) + wire(3, event, seed));
    const later = seed + 'z'.repeat(SSE_MAX_BUFFER_BYTES - fixedBytes + extra);
    const expected = wire(2, event, prefix) + wire(3, event, later);
    expect(Buffer.byteLength(expected)).toBe(SSE_MAX_BUFFER_BYTES + extra);
    let accepted;
    const values = [prefix, 'placeholder'];
    Object.defineProperty(values, 1, { get() {
      accepted = reader.read();
      return later;
    } });
    const encode = spyOn(TextEncoder.prototype, 'encode');
    try {
      const result = controls.emitBatch(event, values);
      if (extra) {
        expect(result.error?.message).toContain('buffer');
        expect(encode).toHaveBeenCalledTimes(0);
        await expect(reader.read()).rejects.toThrow('buffer');
      } else {
        expect(result.error).toBe(false);
        controls.lock.set(false);
        const output = [];
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          output.push(decoder.decode(part.value));
        }
        expect(output.join('')).toBe(expected);
      }
      expect(decoder.decode((await accepted).value)).toBe(wire(1, 'old', earlier));
      expect(cleanups()).toBe(1);
    } finally {
      encode.mockRestore();
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  });
}

for (const extra of [0, 1]) {
  test(`reusing cached scalar data refreshes a getter-freed batch budget at the exact boundary plus ${extra} byte`, async () => {
    const { response, controls, reader, cleanups } = open();
    expect(installProducerCapabilities(response.body, { byteLength: Buffer.byteLength })).toBe(true);
    const earlier = 'p'.repeat(192 * 1024);
    const cached = 'é😀\r\ncached\rtail\n';
    expect(controls.emit('old', earlier).error).toBe(false);
    // Queue and cache this scalar. Its shorter event name leaves enough room
    // for the first staged value even in the one-byte-overflow case, so only
    // the later cached-data branch can decide the final boundary.
    expect(controls.emit('c', cached).error).toBe(false);
    const oldWire = wire(1, 'old', earlier);
    const cachedWire = wire(2, 'c', cached);
    const fixedBytes = Buffer.byteLength(wire(3, 'tick', '') + wire(4, 'tick', cached));
    const bulk = 'z'.repeat(SSE_MAX_BUFFER_BYTES - fixedBytes + extra);
    const expected = wire(3, 'tick', bulk) + wire(4, 'tick', cached);
    expect(Buffer.byteLength(expected)).toBe(SSE_MAX_BUFFER_BYTES + extra);
    expect(Buffer.byteLength(wire(3, 'tick', bulk) + cachedWire)).toBeLessThanOrEqual(SSE_MAX_BUFFER_BYTES);
    // Let start() complete so a read can synchronously pull the earlier queued
    // scalar into the encoded prefetch before the second getter consumes it.
    await Promise.resolve();
    let accepted;
    let acceptedCached;
    const values = ['placeholder', 'placeholder'];
    Object.defineProperty(values, 0, { get() {
      accepted = reader.read();
      return bulk;
    } });
    Object.defineProperty(values, 1, { get() {
      acceptedCached = reader.read();
      return cached;
    } });
    const encode = spyOn(TextEncoder.prototype, 'encode');
    try {
      const result = controls.emitBatch('tick', values);
      if (extra) {
        expect(result.error?.message).toContain('buffer');
        // Encoding the previously accepted queued scalar is allowed; encoding
        // any of the new staging before the cached-value overflow is not.
        expect(encode.mock.calls.map(args => args[0])).toEqual([cachedWire]);
        await expect(reader.read()).rejects.toThrow('buffer');
      } else {
        expect(result.error).toBe(false);
        controls.lock.set(false);
        const output = [];
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          output.push(decoder.decode(part.value));
        }
        expect(output.join('')).toBe(expected);
      }
      expect(decoder.decode((await accepted).value)).toBe(oldWire);
      expect(decoder.decode((await acceptedCached).value)).toBe(cachedWire);
      expect(cleanups()).toBe(1);
    } finally {
      encode.mockRestore();
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  });
}

test('batch budget bookkeeping does not read the stream controller once per member', () => {
  const source = `
    import assert from 'node:assert/strict';
    import { produce } from './src/server.js';
    const prototype = ReadableStreamDefaultController.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'desiredSize');
    let controls;
    const response = produce(value => { controls = value; }, { coalesceBytes: 8192 });
    let reads = 0;
    Object.defineProperty(prototype, 'desiredSize', {
      ...descriptor,
      get() { reads++; return descriptor.get.call(this); }
    });
    try {
      assert.equal(controls.emitBatch('tick', Array.from({ length: 1024 }, () => 'x')).error, false);
      assert.ok(reads < 16, 'batch reads stream budget ' + reads + ' times for 1024 members');
    } finally {
      Object.defineProperty(prototype, 'desiredSize', descriptor);
      await response.body.cancel();
    }
  `;
  const result = spawnSync('node', ['--input-type=module', '--eval', source], {
    cwd: new URL('../', import.meta.url), encoding: 'utf8', timeout: 5000
  });
  expect({ status: result.status, stderr: result.stderr, error: result.error?.message }).toEqual({ status: 0, stderr: '', error: undefined });
});

test('a validated batch counts a large event header once and preserves every event header', async () => {
  const { controls, reader, cleanups, response } = open();
  const event = '更新😀'.repeat(512);
  const counted = [];
  try {
    expect(installProducerCapabilities(response.body, { byteLength(value) {
      counted.push(value); return Buffer.byteLength(value, 'utf8');
    } })).toBe(true);
    expect(controls.emitBatch(event, ['one', 'two', 'three']).error).toBe(false);
    expect(counted.filter(value => value === event).length).toBe(1);
    expect(controls.emit('next', 'after the batch').error).toBe(false);
    controls.lock.set(false);
    const output = [];
    while (true) { const part = await reader.read(); if (part.done) break; output.push(decoder.decode(part.value)); }
    expect(output.join('')).toBe(wire(1, event, 'one') + wire(2, event, 'two') + wire(3, event, 'three') + wire(4, 'next', 'after the batch'));
    expect(cleanups()).toBe(1);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
});
