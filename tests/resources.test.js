import { expect, spyOn, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { createSseConnection } from '../src/client.js';
import { transport } from './helpers/event-source.js';
import { createSseParser } from '../src/parser.js';
import { produce, SSE_MAX_BUFFER_BYTES } from '../src/server.js';

async function isolated(source) {
  const child = Bun.spawn([process.execPath, '--eval', source], { stdout: 'pipe', stderr: 'pipe' });
  const [output, errors, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect(errors).toBe('');
  expect(code).toBe(0);
  return JSON.parse(output);
}

test('closed connection releases sibling captures even when a disposer is retained', async () => {
  const result = await isolated(`
    import { createSseConnection } from ${JSON.stringify(fileURLToPath(new URL('../src/client.js', import.meta.url)))};
    const connection = createSseConnection('/never-requested');
    globalThis.retainedStop = connection.subscribe('message', () => {});
    function addSibling() {
      const payload = { bytes: new Uint8Array(1_000_000) };
      connection.subscribe('message', () => payload.bytes.length);
      return new WeakRef(payload);
    }
    const reference = addSibling();
    connection.close();
    for (let i = 0; i < 8; i++) { await Bun.sleep(0); Bun.gc(true); }
    console.log(JSON.stringify({ collected: reference.deref() === undefined }));
    globalThis.retainedStop();
  `);
  expect(result.collected).toBe(true);
});

test('unfinished parser line has bounded retained heap overhead', async () => {
  const result = await isolated(`
    import { createSseParser } from ${JSON.stringify(fileURLToPath(new URL('../src/parser.js', import.meta.url)))};
    Bun.gc(true);
    const before = process.memoryUsage().heapUsed;
    globalThis.parser = createSseParser(() => {});
    globalThis.parser.push('data: ' + 'x'.repeat(262_000));
    Bun.gc(true);
    console.log(JSON.stringify({ heapBytes: process.memoryUsage().heapUsed - before }));
  `);
  expect(result.heapBytes).toBeLessThan(4_000_000);
});

test('heartbeat bursts use one live idle timer rather than one timer per event', async () => {
  const wire = transport();
  let values = 0;
  const timer = spyOn(globalThis, 'setTimeout');
  const connection = createSseConnection('/events', {
    idleTimeoutMs: 60_000,
    eventSource: wire.eventSource
  });
  connection.subscribe('message', () => { values++; });
  try {
    await Promise.resolve();
    expect(wire.source).toBeDefined();
    wire.open();
    for (let index = 0; index < 100; index++) {
      wire.send('ping', '');
      wire.send('message', '1');
    }
    expect(values).toBe(100);
    expect(timer).toHaveBeenCalledTimes(1);
  } finally { connection.close(); timer.mockRestore(); }
});

for (const data of ['\n'.repeat(SSE_MAX_BUFFER_BYTES - 20), '€'.repeat(100_000), 'x'.repeat(SSE_MAX_BUFFER_BYTES)]) {
  test(`oversized wire frame rejects before encoding (${data.charCodeAt(0)})`, async () => {
    const encode = spyOn(TextEncoder.prototype, 'encode');
    const response = produce(({ emit }) => {
      expect(emit('x', data).error).toBeInstanceOf(Error);
    });
    try {
      expect(encode).not.toHaveBeenCalled();
      await expect(response.text()).rejects.toThrow('buffer');
    } finally { encode.mockRestore(); }
  });
}

test('parser handles every chunk boundary with Unicode, CRLF, BOM, and empty data', () => {
  const input = '\uFEFFid: 7\r\nevent: notice\r\ndata: 😀\r\ndata: second\r\n\r\nevent: ping\ndata:\n\n';
  for (let boundary = 0; boundary <= input.length; boundary++) {
    const messages = [];
    const parser = createSseParser(message => messages.push(message));
    parser.push(input.slice(0, boundary));
    parser.push(input.slice(boundary));
    expect(messages).toEqual([
      { id: '7', event: 'notice', data: '😀\nsecond' },
      { id: '7', event: 'ping', data: '' }
    ]);
  }
});

test('parser code-point budget is independent of surrogate-pair chunk boundaries', () => {
  for (let split = 0; split <= 10; split++) {
    const messages = [];
    const parser = createSseParser(message => messages.push(message), 9);
    const input = 'data: 😀\n\n';
    parser.push(input.slice(0, split));
    parser.push(input.slice(split));
    expect(messages).toEqual([{ id: '', event: 'message', data: '😀' }]);
  }
});

test('idle deadline follows heartbeat events without replacing the timer on each event', async () => {
  let now = 0;
  let callback;
  let delay = 0;
  let scheduleCount = 0;
  const wire = transport();
  const ended = Promise.withResolvers      ();
  const opened = Promise.withResolvers      ();
  const clock = spyOn(performance, 'now').mockImplementation(() => now);
  const timer = spyOn(globalThis, 'setTimeout').mockImplementation(((fn, ms) => {
    callback = fn;
    delay = ms;
    scheduleCount++;
    return 123;
  }));
  const clear = spyOn(globalThis, 'clearTimeout').mockImplementation(() => {});
  const connection = createSseConnection('/events', {
    idleTimeoutMs: 100,
    eventSource: wire.eventSource,
    onopen: () => opened.resolve(), onclose: () => ended.resolve()
  });
  try {
    await Promise.resolve();
    expect(wire.source).toBeDefined();
    wire.open();
    await opened.promise;
    now = 80;
    wire.send('ping', '');
    for (let index = 0; index < 5; index++) await Promise.resolve();
    expect(scheduleCount).toBe(1);
    now = 100;
    callback();
    expect(wire.source.closed).toBe(false);
    expect(delay).toBe(80);
    now = 180;
    callback();
    await ended.promise;
    expect(wire.source.closed).toBe(true);
    expect(scheduleCount).toBe(2);
  } finally { connection.close(); clock.mockRestore(); timer.mockRestore(); clear.mockRestore(); }
});

test('UTF-8 framing preflight accepts an exact budget and rejects a one-byte excess', async () => {
  for (const value of ['x', '€', '😀', '\uD800']) {
    const emptyFrame = 'id: 1\nevent: x\ndata: \n\n';
    const available = SSE_MAX_BUFFER_BYTES - new TextEncoder().encode(emptyFrame).length;
    const unicodeBytes = new TextEncoder().encode(value).length;
    const data = value + 'a'.repeat(available - unicodeBytes);
    const response = produce(({ emit, lock }) => {
      expect(emit('x', data).error).toBe(false);
      lock.set(false);
    });
    expect((await response.arrayBuffer()).byteLength).toBe(SSE_MAX_BUFFER_BYTES);
    const rejected = produce(({ emit }) => { expect(emit('x', data + 'a').error).toBeInstanceOf(Error); });
    await expect(rejected.text()).rejects.toThrow('buffer');
  }
});

test('one-character chunks avoid per-character substring allocations', () => {
  const input = ('data: ' + 'x'.repeat(1_000) + '\n\n').split('');
  const messages = [];
  const parser = createSseParser(message => messages.push(message));
  const slice = spyOn(String.prototype, 'slice');
  let slices;
  try {
    for (const character of input) parser.push(character);
    slices = slice.mock.calls.length;
  } finally { slice.mockRestore(); }
  expect(messages).toEqual([{ id: '', event: 'message', data: 'x'.repeat(1_000) }]);
  expect(slices ).toBeLessThan(8);
});

test('one-character fragments preserve BOM, empty pushes, CRLF, Unicode, and exact budget', () => {
  const messages = [];
  const parser = createSseParser(message => messages.push(message), 9);
  for (const character of '\uFEFFdata: 😀\r\n\r\ndata: x\n\n'.split('')) {
    parser.push(character);
    parser.push('');
  }
  expect(messages).toEqual([
    { id: '', event: 'message', data: '😀' },
    { id: '', event: 'message', data: 'x' }
  ]);
  const overflow = createSseParser(() => {}, 8);
  for (const character of 'data: x\n') overflow.push(character);
  expect(() => overflow.push('\n')).toThrow('size limit');
});

test('one-character unfinished lines retain bounded heap overhead', async () => {
  const result = await isolated(`
    import { createSseParser } from ${JSON.stringify(fileURLToPath(new URL('../src/parser.js', import.meta.url)))};
    Bun.gc(true);
    const before = process.memoryUsage().heapUsed;
    globalThis.parser = createSseParser(() => {});
    globalThis.parser.push('data: ');
    for (let i = 0; i < 262_000; i++) globalThis.parser.push('x');
    Bun.gc(true);
    console.log(JSON.stringify({ heapBytes: process.memoryUsage().heapUsed - before }));
  `);
  expect(result.heapBytes).toBeLessThan(4_000_000);
});

test('switching between tiny and general chunks preserves order across compaction', () => {
  const body = 'x'.repeat(9_000) + '😀\uD800z' + 'y'.repeat(257);
  const input = `\uFEFFid: 42\r\nevent: notice\r\ndata: ${body}\r\ndata: end\r\n\r\n`;
  for (const sizes of [[1], [1, 2, 1, 64], [127, 1, 128, 1, 129], [4096, 1]]) {
    const messages = [];
    const parser = createSseParser(message => messages.push(message));
    for (let offset = 0, index = 0; offset < input.length; index++) {
      const end = offset + sizes[index % sizes.length] ;
      parser.push(input.slice(offset, end));
      offset = end;
    }
    expect(messages).toEqual([{ id: '42', event: 'notice', data: body + '\nend' }]);
  }
});
