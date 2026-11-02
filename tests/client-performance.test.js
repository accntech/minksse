import { expect, spyOn, test } from 'bun:test';
import { createSseConnection } from '../src/client.js';
import { transport } from './helpers/event-source.js';

async function start(wire, options = {}) {
  const connection = createSseConnection('/events', { eventSource: wire.eventSource, ...options });
  await Promise.resolve();
  wire.open();
  return connection;
}

test('disabled idle detection avoids per-event clock reads', async () => {
  const wire = transport();
  const values = [];
  const connection = await start(wire, { idleTimeoutMs: 0 });
  connection.subscribe('notice', value => values.push(value));
  const clock = spyOn(performance, 'now');
  try {
    wire.send('notice', '1');
    wire.send('notice', '2');
    wire.send('ping', '');
    expect(clock).not.toHaveBeenCalled();
    expect(values).toEqual([1, 2]);
  } finally { connection.close(); clock.mockRestore(); }
});

test('synchronous listener return values do not schedule Promise work', async () => {
  const wire = transport();
  const values = [];
  const connection = await start(wire);
  connection.subscribe('notice', value => { values.push(value); return 42; });
  const resolve = spyOn(Promise, 'resolve');
  try {
    wire.send('notice', '1');
    wire.send('notice', '2');
    expect(resolve).not.toHaveBeenCalled();
    expect(values).toEqual([1, 2]);
  } finally { connection.close(); resolve.mockRestore(); }
});

test('custom decoding cannot replace a subscription in the current event snapshot', async () => {
  const wire = transport();
  const values = [];
  let stop;
  let connection;
  const listener = value => values.push(value);
  connection = await start(wire, {
    decode(data) {
      if (data === '1') {
        stop();
        stop = connection.subscribe('notice', listener);
      }
      return JSON.parse(data);
    }
  });
  stop = connection.subscribe('notice', listener);
  try {
    wire.send('notice', '1');
    wire.send('notice', '2');
    expect(values).toEqual([2]);
  } finally { connection.close(); }
});

test('closing during custom decode prevents delivery from the captured snapshot', async () => {
  const wire = transport();
  const values = [];
  let connection;
  connection = await start(wire, { decode() { connection.close(); return 1; } });
  connection.subscribe('notice', value => values.push(value));
  wire.send('notice', '{}');
  expect(values).toEqual([]);
});

test('thenable listener failures and throwing then getters reach onerror', async () => {
  const wire = transport();
  const errors = [];
  const delivered = [];
  const connection = await start(wire, { onerror: cause => errors.push(cause.message) });
  connection.subscribe('notice', () => ({ then(_resolve, reject) { reject(Error('thenable')); } }));
  connection.subscribe('notice', () => ({ get then() { throw Error('then getter'); } }));
  connection.subscribe('notice', value => delivered.push(value));
  try {
    wire.send('notice', '1');
    await Bun.sleep(0);
    expect(errors.toSorted()).toEqual(['then getter', 'thenable']);
    expect(delivered).toEqual([1]);
  } finally { connection.close(); }
});

test('listener thenables read a stateful then getter once', async () => {
  const wire = transport();
  const errors = [];
  let reads = 0;
  const connection = await start(wire, { onerror: cause => errors.push(cause.message) });
  connection.subscribe('notice', () => ({
    get then() {
      reads++;
      return reads === 1 ? (_resolve, reject) => reject(Error('stateful listener')) : undefined;
    }
  }));
  try {
    wire.send('notice', '1');
    await Bun.sleep(0);
    expect(reads).toBe(1);
    expect(errors).toEqual(['stateful listener']);
  } finally { connection.close(); }
});

test('error observer thenables read a stateful then getter once', async () => {
  const wire = transport();
  let reads = 0;
  const diagnostic = spyOn(console, 'error').mockImplementation(() => {});
  const connection = await start(wire, {
    onerror: () => ({
      get then() {
        reads++;
        return reads === 1 ? (_resolve, reject) => reject(Error('stateful observer')) : undefined;
      }
    })
  });
  connection.subscribe('notice', () => {});
  try {
    wire.send('notice', 'invalid');
    await Bun.sleep(0);
    expect(reads).toBe(1);
    expect(diagnostic).toHaveBeenCalledTimes(1);
    expect(diagnostic.mock.calls[0][1].message).toBe('stateful observer');
  } finally { connection.close(); diagnostic.mockRestore(); }
});
