import { expect, mock, spyOn, test } from 'bun:test';
import { createSseConnection, createSseParser, produce } from 'minksse';

import { transport } from './helpers/event-source.js';

test('reentrant unsubscribe/resubscribe delivers each frame only once per listener', async () => {
  const wire = transport();
  const opened = Promise.withResolvers      ();
  const delivered = Promise.withResolvers      ();
  const connection = createSseConnection('/events', { eventSource: wire.eventSource, onopen: () => opened.resolve() });
  let calls = 0;
  let stop;
  const listener = () => {
    calls++;
    // Bound the old live-Set loop so the regression test itself cannot hang.
    if (calls < 4) { stop(); stop = connection.subscribe('message', listener); }
  };
  stop = connection.subscribe('message', listener);
  connection.subscribe('message', () => delivered.resolve());
  try {
    await Promise.resolve();
    wire.open();
    await opened.promise;
    wire.send('message', '{}');
    await delivered.promise;
    expect(calls).toBe(1);
  } finally { connection.close(); }
});

test('async setup cleanup and onStop failures are reported without blocking each other', async () => {
  const diagnostic = spyOn(console, 'error').mockImplementation(() => {});
  const cleanup = mock(async () => { throw new Error('cleanup failed'); });
  const onStop = mock(async () => { throw new Error('onStop failed'); });
  try {
    const response = produce(({ lock }) => {
      lock.set(false);
      return cleanup;
    }, { onStop });
    await response.text();
    await Bun.sleep(0);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(diagnostic).toHaveBeenCalledTimes(2);
  } finally { diagnostic.mockRestore(); }
});

test('invalid heartbeat durations fail before setup and still release caller resources', async () => {
  for (const ping of [0, -1, NaN, Infinity, 1.5, 2_147_483_648]) {
    const setup = mock(() => {});
    const release = mock(() => {});
    let response;
    try {
      expect(() => { response = produce(setup, { ping, onStop: release }); }).toThrow(RangeError);
      expect(setup).not.toHaveBeenCalled();
      expect(release).toHaveBeenCalledTimes(1);
    } finally { await response?.body?.cancel(); }
  }
});

test('invalid idle deadlines cannot start requests or create hot retry loops', () => {
  for (const idleTimeoutMs of [-1, NaN, Infinity, 1.5, 2_147_483_648]) {
    let connection;
    try {
      expect(() => { connection = createSseConnection('/events', { idleTimeoutMs }); }).toThrow(RangeError);
    } finally { connection?.close(); }
  }
});

test('invalid parser budgets cannot disable the frame limit', () => {
  for (const limit of [0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => createSseParser(() => {}, limit)).toThrow(RangeError);
  }
});

test('an obsolete unsubscribe cannot remove a replacement subscription', async () => {
  const wire = transport();
  const opened = Promise.withResolvers      ();
  const connection = createSseConnection('/events', { eventSource: wire.eventSource, onopen: () => opened.resolve() });
  const listener = mock(() => {});
  const stop = connection.subscribe('message', () => {});
  stop();
  connection.subscribe('message', listener);
  stop();
  try {
    await Promise.resolve();
    wire.open();
    await opened.promise;
    wire.send('message', '{}');
    await Bun.sleep(0);
    expect(listener).toHaveBeenCalledTimes(1);
  } finally { connection.close(); }
});

test('a synchronously throwing EventSource constructor still permits a later retry', async () => {
  let attempts = 0;
  const ended = Promise.withResolvers      ();
  let reconnect;
  const connection = createSseConnection('/events', {
    eventSource: class { constructor() { attempts++; throw new Error('synchronous EventSource failure'); } },
    onclose({ connect }) { reconnect = connect; ended.resolve(); }
  });
  try {
    await ended.promise;
    await reconnect();
    expect(attempts).toBe(2);
  } finally { connection.close(); }
});

test('a replacement subscription waits until the next event even with the same callback', async () => {
  const wire = transport();
  const opened = Promise.withResolvers      ();
  const connection = createSseConnection('/events', { eventSource: wire.eventSource, onopen: () => opened.resolve() });
  const values = [];
  const listener = (value) => { values.push(value); };
  let stop = () => {};
  connection.subscribe('message', (value) => {
    if (value === 1) { stop(); stop = connection.subscribe('message', listener); }
  });
  stop = connection.subscribe('message', listener);
  try {
    await Promise.resolve();
    wire.open();
    await opened.promise;
    wire.send('message', '1');
    wire.send('message', '2');
    await Bun.sleep(0);
    expect(values).toEqual([2]);
  } finally { connection.close(); }
});

test('native heartbeats reach subscribers without JSON errors', async () => {
  const wire = transport();
  const opened = Promise.withResolvers      ();
  const heartbeat = Promise.withResolvers         ();
  const errors = [];
  const connection = createSseConnection('/events', {
    eventSource: wire.eventSource,
    onopen: () => opened.resolve(),
    onerror: (cause) => { errors.push(cause); }
  });
  connection.subscribe('ping', (value) => heartbeat.resolve(value));
  try {
    await Promise.resolve();
    wire.open();
    await opened.promise;
    wire.send('ping', '');
    const value = await heartbeat.promise;
    expect(errors).toEqual([]);
    expect(value).toBe('');
  } finally { connection.close(); }
});

test('registrations sharing a callback have independent disposers', async () => {
  const wire = transport();
  const opened = Promise.withResolvers      ();
  const connection = createSseConnection('/events', { eventSource: wire.eventSource, onopen: () => opened.resolve() });
  const values = [];
  const listener = (value) => { values.push(value); };
  const stopFirst = connection.subscribe('message', listener);
  const stopSecond = connection.subscribe('message', listener);
  try {
    await Promise.resolve();
    wire.open();
    await opened.promise;
    stopFirst();
    wire.send('message', '1');
    await Bun.sleep(0);
    stopSecond();
    wire.send('message', '2');
    await Bun.sleep(0);
    expect(values).toEqual([1]);
  } finally { connection.close(); }
});

test('empty application events still report malformed JSON', async () => {
  const wire = transport();
  const opened = Promise.withResolvers      ();
  const errors = [];
  const values = [];
  const connection = createSseConnection('/events', {
    eventSource: wire.eventSource, onopen: () => opened.resolve(), onerror: (cause) => { errors.push(cause); }
  });
  connection.subscribe('message', (value) => { values.push(value); });
  try {
    await Promise.resolve();
    wire.open();
    await opened.promise;
    wire.send('message', '');
    wire.send('message', '1');
    await Bun.sleep(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(SyntaxError);
    expect(values).toEqual([1]);
  } finally { connection.close(); }
});
