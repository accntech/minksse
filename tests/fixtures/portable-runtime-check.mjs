// No runtime-specific imports: run with Node, Bun, or Deno.
import { produce, SSE_MAX_BUFFER_BYTES } from '../../src/server.js';

const checks = [];
function assert(value, message) { if (!value) throw new Error(message); }
function wire(id, event, data) { return `id: ${id}\nevent: ${event}\ndata: ${data}\n\n`; }

for (const coalesceBytes of [0, 16384, 65536]) {
  let controls;
  let cleanup = 0;
  const response = produce(value => { controls = value; return () => cleanup++; }, { coalesceBytes });
  assert(controls.emitBatch('更新😀', ['ascii', 'é😀', '\uD800', 'line\r\nnext\rend\n']).error === false, 'Unicode batch rejected');
  controls.lock.set(false);
  const expected = wire(1, '更新😀', 'ascii') + wire(2, '更新😀', 'é😀') + wire(3, '更新😀', '\uFFFD') + wire(4, '更新😀', 'line\ndata: next\ndata: end\ndata: ');
  assert(await response.text() === expected, 'Unicode/newline wire differs');
  assert(cleanup === 1, 'Completion cleanup did not run exactly once');
  checks.push(`Unicode, surrogates, newline normalization and cleanup at ${coalesceBytes}`);
}

{
  let controls;
  const response = produce(value => { controls = value; }, { coalesceBytes: 65536 });
  const reader = response.body.getReader();
  const values = Array.from({ length: 16 }, () => 'x'.repeat(1024));
  assert(controls.emitBatch('tick', values).error === false, 'Large batch rejected');
  const first = (await reader.read()).value;
  assert(first.buffer.byteLength === first.byteLength, 'First chunk retains excess capacity');
  structuredClone(first.buffer, { transfer: [first.buffer] });
  assert(first.byteLength === 0, 'Transfer failed');
  assert(controls.emitBatch('tick', values).error === false, 'Second batch rejected');
  controls.lock.set(false);
  let output = '';
  while (true) { const part = await reader.read(); if (part.done) break; output += new TextDecoder().decode(part.value); }
  assert(output === values.map((value, index) => wire(index + 17, 'tick', value)).join(''), 'Transferred chunk corrupted later output');
  reader.releaseLock();
  checks.push('64 KiB large batches have independently transferable output');
}

{
  let controls;
  let cleanup = 0;
  const response = produce(value => { controls = value; return () => cleanup++; }, { coalesceBytes: 65536 });
  const values = Array.from({ length: 16 }, () => 'x'.repeat(1024));
  let acceptedBytes = 0;
  let nextId = 1;
  let rejected = false;
  for (let pass = 0; pass < 32; pass++) {
    const size = new TextEncoder().encode(values.map((value, index) => wire(nextId + index, 'tick', value)).join('')).byteLength;
    const result = controls.emitBatch('tick', values);
    if (result.error) { rejected = true; assert(acceptedBytes + size > SSE_MAX_BUFFER_BYTES, 'Premature overflow'); break; }
    nextId += values.length;
    acceptedBytes += size;
    assert(acceptedBytes <= SSE_MAX_BUFFER_BYTES, 'Aggregate byte budget exceeded');
  }
  assert(rejected && cleanup === 1, 'Blocked consumer did not terminate and release resources');
  let errored = false;
  try { await response.text(); } catch { errored = true; }
  assert(errored, 'Overflow did not error the body');
  checks.push('Blocked consumer obeys aggregate byte limit and cleanup');
}

{
  const original = TextEncoder.prototype.encodeInto;
  try {
    TextEncoder.prototype.encodeInto = undefined;
    const response = produce(({ emitBatch, lock }) => {
      assert(emitBatch('tick', ['ascii']).error === false, 'encode-only runtime rejected ASCII');
      assert(emitBatch('tick', ['😀']).error === false, 'encode-only runtime rejected Unicode');
      lock.set(false);
    }, { coalesceBytes: 65536 });
    assert(await response.text() === wire(1, 'tick', 'ascii') + wire(2, 'tick', '😀'), 'encode-only fallback corrupted output');
  } finally { TextEncoder.prototype.encodeInto = original; }
  checks.push('TextEncoder.encode-only fallback');
}

console.log(JSON.stringify({ checks, passed: checks.length }));
