import { expect, spyOn, test } from 'bun:test';
import { produce, SSE_MAX_BUFFER_BYTES } from '../src/server.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const frame = (id, event, data) => `id: ${id}\nevent: ${event}\ndata: ${data.replace(/\r\n|\r|\n/g, '\ndata: ')}\n\n`;

async function readChunks(response) {
  const reader = response.body.getReader();
  const chunks = [];
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) return chunks;
      chunks.push(result.value);
    }
  } finally { reader.releaseLock(); }
}

test('coalescing is opt-in and preserves the default single-frame chunks', async () => {
  for (const options of [{}, { coalesceBytes: 0 }]) {
    const response = produce(({ emit, lock }) => {
      for (let id = 1; id <= 4; id++) emit('notice', String(id));
      lock.set(false);
    }, options);
    expect((await readChunks(response)).map(chunk => decoder.decode(chunk))).toEqual(
      [1, 2, 3, 4].map(id => frame(id, 'notice', String(id)))
    );
  }
});

test('a pull coalesces only queued frames and keeps the prefetched first event independent', async () => {
  const expected = [1, 2, 3, 4, 5].map(id => frame(id, 'notice', String(id)));
  const coalesceBytes = encoder.encode(expected[1] + expected[2]).byteLength;
  const encode = spyOn(TextEncoder.prototype, 'encode');
  try {
    const response = produce(({ emit, lock }) => {
      for (let id = 1; id <= 5; id++) emit('notice', String(id));
      lock.set(false);
    }, { coalesceBytes });
    expect(encode).toHaveBeenCalledTimes(1);
    const chunks = await readChunks(response);
    expect(chunks.map(chunk => decoder.decode(chunk))).toEqual([
      expected[0], expected[1] + expected[2], expected[3] + expected[4]
    ]);
    expect(encode).toHaveBeenCalledTimes(3);
  } finally { encode.mockRestore(); }
});

test('the byte target counts UTF-8 and multiline framing while preserving a final partial group', async () => {
  const values = ['prefetch', '€\r\n😀', 'a\rb\nc', '', 'final'];
  const expected = values.map((value, index) => frame(index + 1, '更新', value));
  const coalesceBytes = encoder.encode(expected[1] + expected[2]).byteLength;
  const response = produce(({ emit, lock }) => {
    for (const value of values) emit('更新', value);
    lock.set(false);
  }, { coalesceBytes });
  const chunks = await readChunks(response);
  expect(chunks.map(chunk => decoder.decode(chunk))).toEqual([
    expected[0], expected[1] + expected[2], expected[3] + expected[4]
  ]);
  expect(chunks.every(chunk => chunk.byteLength <= coalesceBytes)).toBe(true);
});

test('an event larger than the target stays whole and does not absorb a following frame', async () => {
  const values = ['first', '😀'.repeat(100), 'tail', 'last'];
  const expected = values.map((value, index) => frame(index + 1, 'notice', value));
  const coalesceBytes = encoder.encode(expected[2] + expected[3]).byteLength;
  const response = produce(({ emit, lock }) => {
    for (const value of values) emit('notice', value);
    lock.set(false);
  }, { coalesceBytes });
  const chunks = await readChunks(response);
  expect(chunks.map(chunk => decoder.decode(chunk))).toEqual([
    expected[0], expected[1], expected[2] + expected[3]
  ]);
  expect(chunks[1].byteLength).toBeGreaterThan(coalesceBytes);
});

test('coalescing neither encodes unread backlog nor delays a sparse pending read', async () => {
  const encode = spyOn(TextEncoder.prototype, 'encode');
  let emit;
  let finish;
  let cleanups = 0;
  const response = produce(controls => {
    emit = controls.emit;
    finish = () => controls.lock.set(false);
    return () => { cleanups++; };
  }, { coalesceBytes: 16 * 1024 });
  const reader = response.body.getReader();
  try {
    const pending = reader.read();
    await Promise.resolve();
    emit('notice', 'sparse');
    expect(decoder.decode((await pending).value)).toBe(frame(1, 'notice', 'sparse'));
    expect(encode).toHaveBeenCalledTimes(1);
    emit('notice', 'prefetched');
    emit('notice', 'queued');
    emit('notice', 'also queued');
    await Promise.resolve();
    expect(encode).toHaveBeenCalledTimes(2);
    await reader.cancel();
    expect(encode).toHaveBeenCalledTimes(2);
    expect(cleanups).toBe(1);
    expect(emit('late', 'late').error).toBeInstanceOf(Error);
    finish();
    expect(cleanups).toBe(1);
  } finally { await reader.cancel(); reader.releaseLock(); encode.mockRestore(); }
});

test('coalesced backlog drains after normal finish or abort and finalizers run once', async () => {
  for (const mode of ['finish', 'abort']) {
    const controller = new AbortController();
    let cleanups = 0;
    let finalizers = 0;
    let finish;
    const response = produce(({ emit, lock }) => {
      for (let id = 1; id <= 5; id++) emit('notice', String(id));
      finish = () => lock.set(false);
      return () => { cleanups++; };
    }, { signal: controller.signal, coalesceBytes: 16 * 1024, onStop: () => { finalizers++; } });
    if (mode === 'finish') finish(); else controller.abort();
    expect(cleanups).toBe(1);
    expect(finalizers).toBe(1);
    const chunks = await readChunks(response);
    expect(chunks).toHaveLength(2);
    expect(chunks.map(chunk => decoder.decode(chunk)).join('')).toBe(
      [1, 2, 3, 4, 5].map(id => frame(id, 'notice', String(id))).join('')
    );
    await response.body.cancel();
    expect(cleanups).toBe(1);
    expect(finalizers).toBe(1);
  }
});

test('a coalesced chunk has independently owned bytes from the next chunk', async () => {
  const expected = [1, 2, 3, 4, 5].map(id => frame(id, 'notice', String(id)));
  const coalesceBytes = encoder.encode(expected[1] + expected[2]).byteLength;
  const response = produce(({ emit, lock }) => {
    for (let id = 1; id <= 5; id++) emit('notice', String(id));
    lock.set(false);
  }, { coalesceBytes });
  const reader = response.body.getReader();
  try {
    await reader.read();
    const grouped = (await reader.read()).value;
    expect(decoder.decode(grouped)).toBe(expected[1] + expected[2]);
    grouped.fill(0);
    structuredClone(grouped.buffer, { transfer: [grouped.buffer] });
    expect(decoder.decode((await reader.read()).value)).toBe(expected[3] + expected[4]);
    expect((await reader.read()).done).toBe(true);
  } finally { await reader.cancel(); reader.releaseLock(); }
});

test('coalescing preserves the exact queue budget before and after a grouped pull', async () => {
  let emit;
  let cleanups = 0;
  const response = produce(controls => {
    emit = controls.emit;
    return () => { cleanups++; };
  }, { coalesceBytes: 4096 });
  const reader = response.body.getReader();
  try {
    emit('notice', 'prefetched');
    const second = frame(2, 'notice', '€'.repeat(300));
    const third = frame(3, 'notice', '😀'.repeat(200));
    emit('notice', '€'.repeat(300));
    emit('notice', '😀'.repeat(200));
    await reader.read();
    const grouped = (await reader.read()).value;
    expect(decoder.decode(grouped)).toBe(second + third);
    expect(grouped.byteLength).toBe(encoder.encode(second + third).byteLength);
    // A pending consumer has taken all bytes. One event can now use the full cap.
    const overhead = encoder.encode(frame(4, 'notice', '')).byteLength;
    expect(emit('notice', 'x'.repeat(SSE_MAX_BUFFER_BYTES - overhead)).error).toBe(false);
    // It is prefetched and its encoded bytes count against the same cap.
    expect(emit('notice', '').error).toBeInstanceOf(Error);
    expect(cleanups).toBe(1);
    await expect(reader.read()).rejects.toThrow('buffer');
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
});

test('coalescing cannot admit extra queued bytes or encode an overflowing unread backlog', async () => {
  const data = '€'.repeat(100) + '\r\nsecond';
  let expectedBytes = 0;
  let expectedCount = 0;
  for (let id = 1; ; id++) {
    const bytes = encoder.encode(frame(id, id % 2 ? 'notice' : '😀', data)).byteLength;
    if (expectedBytes + bytes > SSE_MAX_BUFFER_BYTES) break;
    expectedBytes += bytes;
    expectedCount++;
  }
  const encode = spyOn(TextEncoder.prototype, 'encode');
  let count = 0;
  let cleanups = 0;
  const response = produce(({ emit }) => {
    for (let id = 1; ; id++) {
      if (emit(id % 2 ? 'notice' : '😀', data).error) break;
      count++;
    }
    return () => { cleanups++; };
  }, { coalesceBytes: SSE_MAX_BUFFER_BYTES });
  try {
    expect(count).toBe(expectedCount);
    expect(encode).toHaveBeenCalledTimes(1);
    expect(cleanups).toBe(1);
    await expect(response.text()).rejects.toThrow('buffer');
  } finally { encode.mockRestore(); }
});

test('invalid coalescing targets fail before setup and finalize exactly once', () => {
  for (const coalesceBytes of [-1, 0.5, NaN, Infinity, SSE_MAX_BUFFER_BYTES + 1]) {
    let starts = 0;
    let stops = 0;
    expect(() => produce(() => { starts++; }, { coalesceBytes, onStop: () => { stops++; } })).toThrow(RangeError);
    expect(starts).toBe(0);
    expect(stops).toBe(1);
  }
});

test('a grouped encoding failure discards backlog and retains one finalization', async () => {
  let stops = 0;
  const response = produce(({ emit, lock }) => {
    emit('notice', 'first');
    emit('notice', 'second');
    emit('notice', 'third');
    lock.set(false);
    return () => { stops++; };
  }, { coalesceBytes: 16 * 1024 });
  const encode = spyOn(TextEncoder.prototype, 'encode').mockImplementation(() => { throw new Error('group encode failed'); });
  try {
    expect(stops).toBe(1);
    await expect(response.text()).rejects.toThrow('group encode failed');
    expect(stops).toBe(1);
  } finally { encode.mockRestore(); }
});

for (const runtime of [process.execPath, Bun.which('node')].filter(Boolean)) {
  for (const sliced of ['data', 'event']) {
    test(`coalescing cannot retain a large caller ${sliced} string through a queued slice (${runtime.split('/').at(-1)})`, async () => {
      const node = runtime === Bun.which('node');
      const source = `
        import { produce } from ${JSON.stringify(new URL('../src/server.js', import.meta.url).href)};
        const collect = () => ${node ? 'global.gc()' : 'Bun.gc(true)'};
        new Response('warm runtime');
        collect();
        const before = process.memoryUsage().heapUsed;
        let emit;
        const response = produce(controls => { emit = controls.emit; }, { coalesceBytes: 16384 });
        emit('warmup', 'fill the prefetched frame');
        function sendSlice() {
          const original = 'x'.repeat(16 * 1024 * 1024);
          ${sliced === 'data' ? "emit('notice', original.slice(100, 300));" : "emit(original.slice(100, 300), 'data');"}
        }
        sendSlice();
        for (let index = 0; index < 3; index++) {
          await new Promise(resolve => setTimeout(resolve, 0));
          collect();
        }
        console.log(JSON.stringify({ retained: process.memoryUsage().heapUsed - before }));
        await response.body.cancel();
      `;
      const child = Bun.spawn(node
        ? [runtime, '--expose-gc', '--input-type=module', '--eval', source]
        : [runtime, '--eval', source], { stdout: 'pipe', stderr: 'pipe' });
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited
      ]);
      expect({ code, stderr }).toEqual({ code: 0, stderr: '' });
      expect(JSON.parse(stdout).retained).toBeLessThan(4 * 1024 * 1024);
    });
  }
}

test('Node coalesces a bounded backlog and keeps sparse delivery immediate', async () => {
  const source = `
    import assert from 'node:assert/strict';
    import { produce } from ${JSON.stringify(new URL('../src/server.js', import.meta.url).href)};
    const decoder = new TextDecoder();
    const response = produce(({ emit, lock }) => {
      emit('notice', 'first'); emit('notice', 'second'); emit('notice', 'third'); lock.set(false);
    }, { coalesceBytes: 16384 });
    const reader = response.body.getReader();
    assert.equal(decoder.decode((await reader.read()).value), 'id: 1\\nevent: notice\\ndata: first\\n\\n');
    assert.equal(decoder.decode((await reader.read()).value), 'id: 2\\nevent: notice\\ndata: second\\n\\nid: 3\\nevent: notice\\ndata: third\\n\\n');
    assert.equal((await reader.read()).done, true);
    reader.releaseLock();
    let emit;
    const sparse = produce(controls => { emit = controls.emit; }, { coalesceBytes: 16384 });
    const sparseReader = sparse.body.getReader();
    const pending = sparseReader.read();
    await Promise.resolve();
    emit('notice', 'sparse');
    assert.equal(decoder.decode((await pending).value), 'id: 1\\nevent: notice\\ndata: sparse\\n\\n');
    await sparseReader.cancel();
    sparseReader.releaseLock();
  `;
  const child = Bun.spawn([Bun.which('node'), '--input-type=module', '--eval', source], { stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited
  ]);
  expect({ stdout, stderr, code }).toEqual({ stdout: '', stderr: '', code: 0 });
});
