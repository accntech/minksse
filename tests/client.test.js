import { expect, mock, spyOn, test } from 'bun:test';
import { createSseConnection } from '../src/client.js';
import { transport } from './helpers/event-source.js';
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

async function start(wire, options = {}) {
  const connection = createSseConnection('/events', { eventSource: wire.eventSource, ...options });
  await Promise.resolve();
  wire.open();
  return connection;
}

test('wraps EventSource with credentials and defers construction for subscriptions', async () => {
  const wire = transport();
  const values = [];
  const connection = createSseConnection('/events', { eventSource: wire.eventSource, withCredentials: true });
  expect(wire.sources).toHaveLength(0);
  connection.subscribe('notice', value => values.push(value));
  await Promise.resolve();
  expect(wire.source.url).toBe('/events');
  expect(wire.source.options).toEqual({ withCredentials: true });
  wire.open();
  wire.send('notice', '{"title":"piñata"}');
  wire.send('notice', '1');
  wire.send('notice', '1');
  expect(values).toEqual([{ title: 'piñata' }, 1, 1]);
  connection.close();
});

test('close suppresses recovery, releases native listeners and fences stale events', async () => {
  const wire = transport();
  const ended = mock(() => {});
  const received = mock(() => {});
  const connection = await start(wire, { onclose: ended });
  connection.subscribe('notice', received);
  connection.close();
  connection.close();
  wire.send('notice', '{}');
  wire.end();
  expect(connection.closed).toBe(true);
  expect(wire.source.closeCalls).toBe(1);
  expect(received).not.toHaveBeenCalled();
  expect(ended).not.toHaveBeenCalled();
});

test('errors close native retry and offer deduplicated explicit reconnect', async () => {
  const wire = transport();
  let reconnect;
  let ended = 0;
  const errors = [];
  const values = [];
  const connection = await start(wire, { onerror: cause => errors.push(cause), onclose: ({ connect }) => { ended++; reconnect = connect; } });
  connection.subscribe('notice', value => values.push(value));
  const old = wire.source;
  wire.end();
  wire.end();
  expect(old.closed).toBe(true);
  expect(errors).toHaveLength(1);
  expect(ended).toBe(1);
  const first = reconnect();
  expect(reconnect()).toBe(first);
  await Promise.resolve();
  expect(wire.sources).toHaveLength(2);
  old.dispatchEvent(new MessageEvent('notice', { data: '0' }));
  wire.open();
  wire.send('notice', '1');
  expect(values).toEqual([1]);
  connection.close();
  await first;
});

test('decode is configurable and receives native event metadata', async () => {
  const wire = transport();
  const values = [];
  const connection = await start(wire, { decode: (data, event) => [event.type, data] });
  connection.subscribe('notice', value => values.push(value));
  wire.send('notice', 'plain text');
  expect(values).toEqual([['notice', 'plain text']]);
  connection.close();
});

test('JSON and sync/async observer failures are isolated from sibling delivery', async () => {
  const wire = transport();
  const errors = [];
  const values = [];
  const connection = await start(wire, { onerror: cause => errors.push(cause), async onopen() { throw Error('open'); } });
  connection.subscribe('notice', () => { throw Error('listener'); });
  connection.subscribe('notice', async () => { throw Error('async listener'); });
  connection.subscribe('notice', value => values.push(value));
  wire.send('notice', 'invalid');
  wire.send('notice', '1');
  await Bun.sleep(0);
  expect(values).toEqual([1]);
  expect(errors.map(error => error.message)).toContain('open');
  expect(errors.map(error => error.message)).toContain('listener');
  expect(errors.map(error => error.message)).toContain('async listener');
  expect(errors.some(error => error instanceof SyntaxError)).toBe(true);
  connection.close();
});

test('observer errors cannot interrupt native cleanup or retry notification', async () => {
  const wire = transport();
  const diagnostic = spyOn(console, 'error').mockImplementation(() => {});
  const ended = mock(() => { throw Error('close'); });
  const connection = await start(wire, { onerror() { throw Error('error observer'); }, onclose: ended });
  try {
    wire.end();
    expect(wire.source.closed).toBe(true);
    expect(ended).toHaveBeenCalledTimes(1);
    expect(diagnostic).toHaveBeenCalledTimes(2);
  } finally { connection.close(); diagnostic.mockRestore(); }
});

test('close from a listener prevents sibling delivery', async () => {
  const wire = transport();
  const connection = await start(wire);
  const late = mock(() => {});
  connection.subscribe('notice', () => connection.close());
  connection.subscribe('notice', late);
  wire.send('notice', '{}');
  expect(late).not.toHaveBeenCalled();
});

test('constructor failure can recover and early close prevents construction', async () => {
  let attempts = 0;
  let reconnect;
  class Broken { constructor() { attempts++; throw Error('constructor'); } }
  const connection = createSseConnection('/events', { eventSource: Broken, onclose: ({ connect }) => { reconnect = connect; } });
  await Bun.sleep(0);
  await reconnect();
  expect(attempts).toBe(2);
  connection.close();
  createSseConnection('/events', { eventSource: Broken }).close();
  await Bun.sleep(0);
  expect(attempts).toBe(2);
});

test('custom heartbeat keeps idle connection alive without application subscriptions', async () => {
  const wire = transport();
  const ended = mock(() => {});
  const connection = await start(wire, { heartbeatEvent: 'alive', idleTimeoutMs: 100, onclose: ended });
  try {
    for (let i = 0; i < 4; i++) { await Bun.sleep(35); wire.send('alive', ''); }
    expect(ended).not.toHaveBeenCalled();
    await Bun.sleep(130);
    expect(ended).toHaveBeenCalledTimes(1);
    expect(wire.source.closed).toBe(true);
  } finally { connection.close(); }
});

test('idle timeout can be disabled', async () => {
  const wire = transport();
  const ended = mock(() => {});
  const timer = spyOn(globalThis, 'setTimeout');
  const connection = await start(wire, { idleTimeoutMs: 0, onclose: ended });
  try { expect(timer).not.toHaveBeenCalled(); }
  finally { connection.close(); timer.mockRestore(); }
});

test('constructor overrides can dispatch message events from another realm', async () => {
  const wire = transport();
  const values = [];
  const errors = [];
  let opens = 0;
  const connection = await start(wire, { onerror: cause => errors.push(cause), onopen: () => opens++ });
  for (const name of ['notice', 'open', 'error']) {
    connection.subscribe(name, value => values.push(value));
    // Models a different Window's MessageEvent, which fails instanceof in this realm.
    const event = new Event(name);
    Object.defineProperty(event, 'data', { value: '1' });
    wire.source.dispatchEvent(event);
  }
  expect(values).toEqual([1, 1, 1]);
  expect(errors).toEqual([]);
  expect(opens).toBe(1);
  expect(wire.source.closed).toBe(false);
  connection.close();
});
