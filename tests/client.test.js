import { expect, mock, spyOn, test } from 'bun:test';
import { createSseConnection } from '../src/client.js';
import { createSseParser } from '../src/parser.js';

test('parser preserves split CRLF, multiline data, comments, IDs, and empty data', () => {
  const messages = [];
  const parser = createSseParser((message) => messages.push(message));
  for (const chunk of ['\uFEFF: comment\r', '\nid: 7\revent: notice\r', '\ndata: first\r\ndata: second\r', '\n\r', '\nevent: ping\ndata:\n\n']) parser.push(chunk);
  expect(messages).toEqual([
    { event: 'notice', data: 'first\nsecond', id: '7' },
    { event: 'ping', data: '', id: '7' }
  ]);
  parser.push('data: incomplete');
  expect(messages).toHaveLength(2);
});

test('parser rejects an oversized unfinished frame', () => {
  const parser = createSseParser(() => {}, 20);
  expect(() => parser.push('data: ' + 'x'.repeat(21))).toThrow('SSE frame exceeds');
});

function transport() {
  let controller;
  let signal;
  const cancelled = mock(() => {});
  const fetcher = mock(async (_url, options) => {
    signal = options.signal ;
    return new Response(new ReadableStream            ({
      start(value) { controller = value; },
      cancel: cancelled
    }), { headers: { 'content-type': 'text/event-stream' } });
  });
  return {
    fetcher: fetcher,
    send(value) { controller.enqueue(new TextEncoder().encode(value)); },
    bytes(value) { controller.enqueue(value); },
    end() { controller.close(); },
    get signal() { return signal; },
    cancelled
  };
}

test('POST transport decodes split UTF-8 and delivers every identical event in a burst', async () => {
  const wire = transport();
  const opened = Promise.withResolvers      ();
  const delivered = Promise.withResolvers      ();
  const values = [];
  const errors = [];
  const connection = createSseConnection('/api/events', { fetch: wire.fetcher, onopen: () => opened.resolve(), onerror: (error) => errors.push(error) });
  connection.subscribe('notify', (value) => { values.push(value); if (values.length === 3) delivered.resolve(); });
  await opened.promise;
  const bytes = new TextEncoder().encode('event: notify\ndata: {"title":"piñata"}\n\nevent: notify\ndata: {"title":"same"}\n\nevent: notify\ndata: {"title":"same"}\n\n');
  for (const byte of bytes) wire.bytes(new Uint8Array([byte]));
  await delivered.promise;
  expect(values).toEqual([{ title: 'piñata' }, { title: 'same' }, { title: 'same' }]);
  expect(errors).toEqual([]);
  connection.close();
});

test('close aborts a pending read and cancels the reader without reconnect callbacks', async () => {
  const wire = transport();
  const opened = Promise.withResolvers      ();
  const closed = mock(() => {});
  const connection = createSseConnection('/api/events', { fetch: wire.fetcher, onopen: () => opened.resolve(), onclose: closed });
  await opened.promise;
  connection.close();
  expect(wire.signal.aborted).toBe(true);
  await Bun.sleep(0);
  expect(wire.cancelled).toHaveBeenCalledTimes(1);
  expect(closed).not.toHaveBeenCalled();
});

test('unsubscribe and throwing callbacks do not lose remaining subscribers or future events', async () => {
  const wire = transport();
  const opened = Promise.withResolvers      ();
  const received = Promise.withResolvers      ();
  const errors = mock(() => {});
  const stale = mock(() => {});
  const connection = createSseConnection('/api/events', { fetch: wire.fetcher, onopen: () => opened.resolve(), onerror: errors });
  connection.subscribe('changed', () => { throw new Error('listener failed'); });
  const stop = connection.subscribe('changed', stale);
  stop();
  connection.subscribe('changed', (value) => { if (value === 2) received.resolve(); });
  await opened.promise;
  wire.send('event: changed\ndata: 1\n\nevent: changed\ndata: 2\n\n');
  await received.promise;
  expect(stale).not.toHaveBeenCalled();
  expect(errors).toHaveBeenCalledTimes(2);
  connection.close();
});

test('normal completion offers one explicit reconnect, never overlapping requests', async () => {
  const wire = transport();
  const opened = Promise.withResolvers      ();
  const ended = Promise.withResolvers                     ();
  const connection = createSseConnection('/api/events', {
    fetch: wire.fetcher,
    onopen: () => opened.resolve(),
    onclose: ({ connect }) => ended.resolve(connect)
  });
  await opened.promise;
  wire.end();
  const connect = await ended.promise;
  const first = connect();
  const second = connect();
  expect(first).toBe(second);
  connection.close();
  await first;
});

test('HTTP and non-SSE responses fail before onopen and offer recovery once', async () => {
  for (const response of [new Response('Denied', { status: 401 }), new Response('<html>login</html>', { headers: { 'content-type': 'text/html' } })]) {
    const ended = Promise.withResolvers      ();
    const opened = mock(() => {});
    const errors = mock(() => {});
    const connection = createSseConnection('/api/events', {
      fetch: (async (_url, init) => {
        expect(init?.method).toBe('POST');
        expect(new Headers(init?.headers).get('accept')).toBe('text/event-stream');
        expect(init?.cache).toBe('no-store');
        return response;
      }),
      onopen: opened,
      onerror: errors,
      onclose: () => ended.resolve()
    });
    await ended.promise;
    expect(opened).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalledTimes(1);
    connection.close();
  }
});

test('network failures offer recovery once and early close prevents a request', async () => {
  const ended = Promise.withResolvers      ();
  const errors = mock(() => {});
  const fetcher = mock(async () => { throw new TypeError('Network unavailable'); });
  const connection = createSseConnection('/api/events', { fetch: fetcher, onerror: errors, onclose: () => ended.resolve() });
  await ended.promise;
  expect(errors).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledTimes(1);
  connection.close();
  const never = mock(async () => new Response());
  createSseConnection('/api/events', { fetch: never                            }).close();
  await Bun.sleep(0);
  expect(never).not.toHaveBeenCalled();
});

test('a stalled transport times out, cancels its reader, and offers recovery', async () => {
  const wire = transport();
  const ended = Promise.withResolvers      ();
  const connection = createSseConnection('/api/events', { fetch: wire.fetcher, idleTimeoutMs: 10, onclose: () => ended.resolve() });
  await ended.promise;
  expect(wire.signal.aborted).toBe(true);
  expect(wire.cancelled).toHaveBeenCalledTimes(1);
  connection.close();
});

test('closing from an event callback fences later frames in the same chunk', async () => {
  const wire = transport();
  const opened = Promise.withResolvers      ();
  const revoked = Promise.withResolvers      ();
  const late = mock(() => {});
  const connection = createSseConnection('/api/events', { fetch: wire.fetcher, onopen: () => opened.resolve() });
  connection.subscribe('auth:revoked', () => { connection.close(); revoked.resolve(); });
  connection.subscribe('notify', late);
  await opened.promise;
  wire.send('event: auth:revoked\ndata: {}\n\nevent: notify\ndata: {"title":"late"}\n\n');
  await revoked.promise;
  expect(late).not.toHaveBeenCalled();
});

test('a throwing close observer is reported without an unhandled rejection', async () => {
  const wire = transport();
  const opened = Promise.withResolvers      ();
  const reported = Promise.withResolvers         ();
  const failure = new Error('close observer failed');
  const connection = createSseConnection('/events', {
    fetch: wire.fetcher,
    onopen: () => opened.resolve(),
    onclose: () => { throw failure; },
    onerror: (cause) => reported.resolve(cause)
  });
  await opened.promise;
  wire.end();
  expect(await reported.promise).toBe(failure);
  connection.close();
});

test('an error observer failure cannot terminate sibling event delivery', async () => {
  const wire = transport();
  const opened = Promise.withResolvers      ();
  const delivered = Promise.withResolvers      ();
  const diagnostic = spyOn(console, 'error').mockImplementation(() => {});
  const connection = createSseConnection('/events', {
    fetch: wire.fetcher,
    onopen: () => opened.resolve(),
    onerror: () => { throw new Error('error observer failed'); }
  });
  try {
    connection.subscribe('message', () => { throw new Error('listener failed'); });
    connection.subscribe('message', () => delivered.resolve());
    await opened.promise;
    wire.send('data: {}\n\n');
    await delivered.promise;
    expect(diagnostic).toHaveBeenCalledTimes(1);
  } finally { connection.close(); diagnostic.mockRestore(); }
});

test('async open and event callback failures reach onerror while siblings continue', async () => {
  const wire = transport();
  const opened = Promise.withResolvers      ();
  const delivered = Promise.withResolvers      ();
  const reported = Promise.withResolvers      ();
  const errors = [];
  const openError = new Error('async open failed');
  const listenerError = new Error('async listener failed');
  const connection = createSseConnection('/events', {
    fetch: wire.fetcher,
    async onopen() { opened.resolve(); throw openError; },
    onerror(cause) { errors.push(cause); if (errors.length === 2) reported.resolve(); }
  });
  connection.subscribe('message', async () => { throw listenerError; });
  connection.subscribe('message', () => delivered.resolve());
  try {
    await opened.promise;
    wire.send('data: {}\n\n');
    await Promise.all([delivered.promise, reported.promise]);
    expect(errors).toEqual([openError, listenerError]);
  } finally { connection.close(); }
});
