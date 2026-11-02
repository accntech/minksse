import { expect, test } from 'bun:test';
import { produce, SSE_MAX_BUFFER_BYTES } from '../src/server.js';

const encoder = new TextEncoder();
const frame = (id, data) => `id: ${id}\nevent: tick\ndata: ${data}\n\n`;
const values = Array.from({ length: 16 }, (_, index) => JSON.stringify({ index, payload: 'x'.repeat(1024) }));

test('64 KiB coalescing keeps a blocked reader within the aggregate wire budget', async () => {
  let controls;
  let cleanups = 0;
  let stops = 0;
  const response = produce(value => { controls = value; return () => cleanups++; }, { coalesceBytes: 65536, onStop: () => stops++ });
  let acceptedBytes = 0;
  let accepted = 0;
  let rejectedBytes = 0;
  for (let batch = 0; batch < 32; batch++) {
    const wire = values.map((value, index) => frame(accepted + index + 1, value)).join('');
    const size = encoder.encode(wire).byteLength;
    const result = controls.emitBatch('tick', values);
    if (result.error) { rejectedBytes = size; break; }
    acceptedBytes += size;
    accepted += values.length;
    expect(acceptedBytes).toBeLessThanOrEqual(SSE_MAX_BUFFER_BYTES);
  }
  expect(accepted).toBeGreaterThan(0);
  expect(rejectedBytes).toBeGreaterThan(0);
  expect(acceptedBytes + rejectedBytes).toBeGreaterThan(SSE_MAX_BUFFER_BYTES);
  expect(cleanups).toBe(1);
  expect(stops).toBe(1);
  await expect(response.text()).rejects.toThrow('buffer');
});

test('64 KiB output storage can be transferred without corrupting the next batch', async () => {
  let controls;
  const response = produce(value => { controls = value; }, { coalesceBytes: 65536 });
  const reader = response.body.getReader();
  try {
    const pending = reader.read();
    expect(controls.emitBatch('tick', values).error).toBe(false);
    const first = (await pending).value;
    expect(new TextDecoder().decode(first)).toBe(values.map((value, index) => frame(index + 1, value)).join(''));
    expect(first.buffer.byteLength).toBe(first.byteLength);
    first.fill(0);
    structuredClone(first.buffer, { transfer: [first.buffer] });
    expect(first.byteLength).toBe(0);
    expect(controls.emitBatch('tick', values).error).toBe(false);
    controls.lock.set(false);
    const second = (await reader.read()).value;
    expect(new TextDecoder().decode(second)).toBe(values.map((value, index) => frame(index + 17, value)).join(''));
    expect(second.buffer.byteLength).toBe(second.byteLength);
    expect((await reader.read()).done).toBe(true);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
});

test('64 KiB coalescing delivers a small first batch without waiting to fill the target', async () => {
  let controls;
  const response = produce(value => { controls = value; }, { coalesceBytes: 65536 });
  const reader = response.body.getReader();
  try {
    const pending = reader.read();
    expect(controls.emitBatch('tick', ['first']).error).toBe(false);
    const result = await Promise.race([pending, Bun.sleep(100).then(() => ({ timedOut: true }))]);
    expect(result.timedOut).toBeUndefined();
    expect(new TextDecoder().decode(result.value)).toBe(frame(1, 'first'));
  } finally { await reader.cancel(); reader.releaseLock(); }
});

test('canceling buffered 64 KiB output releases producer resources exactly once', async () => {
  let controls;
  let cleanups = 0;
  let stops = 0;
  const response = produce(value => { controls = value; return () => cleanups++; }, { coalesceBytes: 65536, onStop: () => stops++ });
  expect(controls.emitBatch('tick', values).error).toBe(false);
  expect(controls.emitBatch('tick', values).error).toBe(false);
  const reader = response.body.getReader();
  await reader.cancel('consumer gone');
  reader.releaseLock();
  expect(cleanups).toBe(1);
  expect(stops).toBe(1);
  expect(controls.emitBatch('tick', values).error).toBeInstanceOf(Error);
});
