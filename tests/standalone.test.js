import { expect, mock, spyOn, test } from 'bun:test';
import { createSseConnection, createSseParser, produce } from 'minksse';

function transport(cancel = () => {}) {
  let controller;
  let signal;
  return {
    fetcher: (async (_url, init) => {
      signal = init .signal ;
      return new Response(new ReadableStream            ({
        start(value) { controller = value; },
        cancel() { return cancel(signal); }
      }), { headers: { 'content-type': 'text/event-stream' } });
    }),
    send(value) { controller.enqueue(new TextEncoder().encode(value)); },
    get signal() { return signal; }
  };
}

test('reentrant unsubscribe/resubscribe delivers each frame only once per listener', async () => {
  const wire = transport();
  const opened = Promise.withResolvers      ();
  const delivered = Promise.withResolvers      ();
  const connection = createSseConnection('/events', { fetch: wire.fetcher, onopen: () => opened.resolve() });
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
    await opened.promise;
    wire.send('data: {}\n\n');
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

for (const kind of ['abort-dependent', 'uncooperative']) {
  test(`parser failure can recover when cancellation is ${kind}`, async () => {
    const wire = transport((signal) => new Promise      ((resolve) => {
      if (kind === 'uncooperative') return;
      if (signal.aborted) resolve();
      else signal.addEventListener('abort', () => resolve(), { once: true });
    }));
    const opened = Promise.withResolvers      ();
    const ended = Promise.withResolvers      ();
    const connection = createSseConnection('/events', { fetch: wire.fetcher, onopen: () => opened.resolve(), onclose: () => ended.resolve() });
    try {
      await opened.promise;
      wire.send('data: ' + 'x'.repeat(1_048_576));
      const settled = await Promise.race([ended.promise.then(() => true), Bun.sleep(250).then(() => false)]);
      expect(settled).toBe(true);
      expect(wire.signal.aborted).toBe(true);
    } finally { connection.close(); }
  });
}

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
  for (const idleTimeoutMs of [0, -1, NaN, Infinity, 1.5, 2_147_483_648]) {
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
  const connection = createSseConnection('/events', { fetch: wire.fetcher, onopen: () => opened.resolve() });
  const listener = mock(() => {});
  const stop = connection.subscribe('message', () => {});
  stop();
  connection.subscribe('message', listener);
  stop();
  try {
    await opened.promise;
    wire.send('data: {}\n\n');
    await Bun.sleep(0);
    expect(listener).toHaveBeenCalledTimes(1);
  } finally { connection.close(); }
});

test('a synchronously throwing custom fetch still permits a later retry', async () => {
  let attempts = 0;
  const ended = Promise.withResolvers      ();
  let reconnect;
  const connection = createSseConnection('/events', {
    fetch: (() => { attempts++; throw new Error('synchronous fetch failure'); }),
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
  const connection = createSseConnection('/events', { fetch: wire.fetcher, onopen: () => opened.resolve() });
  const values = [];
  const listener = (value) => { values.push(value); };
  let stop = () => {};
  connection.subscribe('message', (value) => {
    if (value === 1) { stop(); stop = connection.subscribe('message', listener); }
  });
  stop = connection.subscribe('message', listener);
  try {
    await opened.promise;
    wire.send('data: 1\n\ndata: 2\n\n');
    await Bun.sleep(0);
    expect(values).toEqual([2]);
  } finally { connection.close(); }
});

test('producer heartbeats reach subscribers without JSON errors', async () => {
  const opened = Promise.withResolvers      ();
  const heartbeat = Promise.withResolvers         ();
  const errors = [];
  const connection = createSseConnection('/events', {
    fetch: (async () => produce(() => {}, { ping: 5 })),
    onopen: () => opened.resolve(),
    onerror: (cause) => { errors.push(cause); }
  });
  connection.subscribe('ping', (value) => heartbeat.resolve(value));
  try {
    await opened.promise;
    const value = await Promise.race([heartbeat.promise, Bun.sleep(100).then(() => 'no heartbeat')]);
    expect(errors).toEqual([]);
    expect(value).toBe('');
  } finally { connection.close(); }
});

test('registrations sharing a callback have independent disposers', async () => {
  const wire = transport();
  const opened = Promise.withResolvers      ();
  const connection = createSseConnection('/events', { fetch: wire.fetcher, onopen: () => opened.resolve() });
  const values = [];
  const listener = (value) => { values.push(value); };
  const stopFirst = connection.subscribe('message', listener);
  const stopSecond = connection.subscribe('message', listener);
  try {
    await opened.promise;
    stopFirst();
    wire.send('data: 1\n\n');
    await Bun.sleep(0);
    stopSecond();
    wire.send('data: 2\n\n');
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
    fetch: wire.fetcher, onopen: () => opened.resolve(), onerror: (cause) => { errors.push(cause); }
  });
  connection.subscribe('message', (value) => { values.push(value); });
  try {
    await opened.promise;
    wire.send('data:\n\ndata: 1\n\n');
    await Bun.sleep(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(SyntaxError);
    expect(values).toEqual([1]);
  } finally { connection.close(); }
});
