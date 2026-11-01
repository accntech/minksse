import { expect, spyOn, test } from 'bun:test';
import { produce, SSE_MAX_BUFFER_BYTES } from '../src/server.js';

const decoder = new TextDecoder();

test('unread backlog stays unencoded beyond one prefetched frame and cancellation drops it', async () => {
  const encode = spyOn(TextEncoder.prototype, 'encode');
  let cleanups = 0;
  const response = produce(({ emit }) => {
    for (let index = 0; index < 100; index++) expect(emit('notice', 'x'.repeat(1024)).error).toBe(false);
    return () => { cleanups++; };
  });
  try {
    await Promise.resolve();
    expect(encode).toHaveBeenCalledTimes(1);
    await response.body .cancel();
    expect(encode).toHaveBeenCalledTimes(1);
    expect(cleanups).toBe(1);
  } finally { await response.body?.cancel().catch(() => {}); encode.mockRestore(); }
});

test('normal termination releases resources immediately and drains accepted frames on demand', async () => {
  const encode = spyOn(TextEncoder.prototype, 'encode');
  let cleanups = 0;
  let finalizers = 0;
  const response = produce(({ emit, lock }) => {
    emit('one', '1'); emit('two', '2'); lock.set(false);
    return () => { cleanups++; };
  }, { onStop: () => { finalizers++; } });
  const reader = response.body .getReader();
  try {
    expect(cleanups).toBe(1); expect(finalizers).toBe(1);
    expect(encode).toHaveBeenCalledTimes(1);
    expect(decoder.decode((await reader.read()).value)).toBe('id: 1\nevent: one\ndata: 1\n\n');
    expect(encode).toHaveBeenCalledTimes(1);
    expect(decoder.decode((await reader.read()).value)).toBe('id: 2\nevent: two\ndata: 2\n\n');
    expect((await reader.read()).done).toBe(true);
    expect(encode).toHaveBeenCalledTimes(2);
  } finally { await reader.cancel(); reader.releaseLock(); encode.mockRestore(); }
});

test('pending reader receives a later emit and stops without waiting for another emit', async () => {
  let emit;
  let finish;
  const response = produce(controls => { emit = controls.emit; finish = () => controls.lock.set(false); });
  const reader = response.body .getReader();
  try {
    const pending = reader.read();
    await Promise.resolve();
    expect(emit('notice', 'hello').error).toBe(false);
    expect(decoder.decode((await pending).value)).toBe('id: 1\nevent: notice\ndata: hello\n\n');
    const ended = reader.read();
    finish();
    expect((await ended).done).toBe(true);
  } finally { await reader.cancel(); reader.releaseLock(); }
});

test('combined prefetched and demand queue retains the byte limit without encoding the backlog', async () => {
  const encode = spyOn(TextEncoder.prototype, 'encode');
  let cleanups = 0;
  let queued = 0;
  const response = produce(({ emit }) => {
    while (!emit('notice', 'x'.repeat(1024)).error) queued++;
    return () => { cleanups++; };
  });
  try {
    expect(queued * 1024).toBeLessThanOrEqual(SSE_MAX_BUFFER_BYTES);
    expect(cleanups).toBe(1);
    expect(encode).toHaveBeenCalledTimes(1);
    await expect(response.text()).rejects.toThrow('buffer');
  } finally { encode.mockRestore(); }
});

test('an encoding failure errors the body even after normal cleanup has run', async () => {
  let cleanups = 0;
  const response = produce(({ emit, lock }) => {
    emit('notice', 'prefetched'); emit('notice', 'payload'); lock.set(false);
    return () => { cleanups++; };
  });
  const encode = spyOn(TextEncoder.prototype, 'encode').mockImplementation(() => { throw new Error('encode failed'); });
  try {
    expect(cleanups).toBe(1);
    await expect(response.text()).rejects.toThrow('encode failed');
    expect(cleanups).toBe(1);
  } finally { encode.mockRestore(); }
});

test('cancellation after normal termination drops frames beyond the prefetched frame', async () => {
  let cleanups = 0;
  const encode = spyOn(TextEncoder.prototype, 'encode');
  const response = produce(({ emit, lock }) => {
    emit('notice', 'payload'); lock.set(false);
    return () => { cleanups++; };
  });
  try {
    await response.body .cancel();
    expect(encode).toHaveBeenCalledTimes(1);
    expect(cleanups).toBe(1);
  } finally { encode.mockRestore(); }
});

test('abort finalizes immediately while preserving already accepted frames', async () => {
  const abort = new AbortController();
  let cleanups = 0;
  const response = produce(({ emit }) => { emit('notice', 'accepted'); return () => { cleanups++; }; }, { signal: abort.signal });
  abort.abort();
  expect(cleanups).toBe(1);
  expect(await response.text()).toBe('id: 1\nevent: notice\ndata: accepted\n\n');
});

test('sustained partial draining preserves IDs and bytes across queue compaction', async () => {
  let emit;
  let finish;
  const response = produce(controls => { emit = controls.emit; finish = () => controls.lock.set(false); });
  const reader = response.body .getReader();
  let sent = 0, received = 0;
  const send = (count) => {
    for (let index = 0; index < count; index++) expect(emit('notice', String(++sent)).error).toBe(false);
  };
  const receive = async (count) => {
    for (let index = 0; index < count; index++) {
      const result = await reader.read();
      const id = ++received;
      expect(decoder.decode(result.value)).toBe(`id: ${id}\nevent: notice\ndata: ${id}\n\n`);
    }
  };
  try {
    send(200);
    for (let round = 0; round < 8; round++) { await receive(150); send(150); }
    finish();
    await receive(200);
    expect(received).toBe(sent);
    expect((await reader.read()).done).toBe(true);
  } finally { await reader.cancel(); reader.releaseLock(); }
});

test('mutating and transferring one delivered buffer cannot corrupt sibling frames', async () => {
  const response = produce(({ emit, lock }) => { emit('notice', 'first'); emit('notice', 'second'); lock.set(false); });
  const reader = response.body .getReader();
  try {
    const first = (await reader.read()).value ;
    first.fill(0);
    structuredClone(first.buffer, { transfer: [first.buffer] });
    expect(decoder.decode((await reader.read()).value)).toBe('id: 2\nevent: notice\ndata: second\n\n');
    expect((await reader.read()).done).toBe(true);
  } finally { await reader.cancel(); reader.releaseLock(); }
});

for (const runtime of [process.execPath, Bun.which('node')].filter((value) => !!value)) {
  for (const sliced of ['data', 'event']) {
    test(`queued ${sliced} slices cannot retain a larger source string (${runtime.split('/').at(-1)})`, async () => {
      const node = runtime === Bun.which('node');
      const source = `
        import { produce } from ${JSON.stringify(new URL('../src/server.js', import.meta.url).href)};
        const collect = () => ${node ? 'global.gc()' : 'Bun.gc(true)'};
        new Response('warm runtime');
        collect();
        const before = process.memoryUsage().heapUsed;
        let emit;
        const response = produce(controls => { emit = controls.emit; });
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
      const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      expect({ code, stderr }).toEqual({ code: 0, stderr: '' });
      expect(JSON.parse(stdout).retained).toBeLessThan(4 * 1024 * 1024);
    });
  }
}

test('cached payload framing accounts for event changes, ID digits, and exact remaining capacity', async () => {
  const data = '€'.repeat(100) + '\r\nsecond';
  const encoder = new TextEncoder();
  let expectedCount = 0;
  let expectedBytes = 0;
  for (let id = 1; ; id++) {
    const event = id % 2 ? 'notice' : '😀';
    const frame = `id: ${id}\nevent: ${event}\ndata: ${data.replace(/\r\n/g, '\ndata: ')}\n\n`;
    const bytes = encoder.encode(frame).byteLength;
    if (expectedBytes + bytes > SSE_MAX_BUFFER_BYTES) break;
    expectedBytes += bytes;
    expectedCount++;
  }
  let count = 0;
  const response = produce(({ emit }) => {
    for (let id = 1; ; id++) {
      if (emit(id % 2 ? 'notice' : '😀', data).error) break;
      count++;
    }
  });
  expect(count).toBe(expectedCount);
  await expect(response.text()).rejects.toThrow('buffer');
});

test('one bounded prefetched frame avoids a pull microtask on an empty producer', async () => {
  const encode = spyOn(TextEncoder.prototype, 'encode');
  let emit;
  const response = produce(controls => { emit = controls.emit; });
  try {
    emit('notice', 'ready');
    expect(encode).toHaveBeenCalledTimes(1);
    emit('notice', 'backlog');
    expect(encode).toHaveBeenCalledTimes(1);
  } finally { await response.body .cancel(); encode.mockRestore(); }
});
