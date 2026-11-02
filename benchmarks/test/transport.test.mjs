import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fork } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { targets } from '../core.mjs';

const harness = await import('../harness.mjs').catch(() => ({}));

test('every genuine adapter delivers all validated events over concurrent HTTP streams and exits', { timeout: 60000 }, async () => {
  assert.equal(typeof harness.measureTarget, 'function', 'HTTP benchmark harness is implemented');
  for (const setup of ['baseline', 'optimized']) for (const target of targets) {
    const sample = await harness.measureTarget(target, {
      setup, events: 37, clients: 3, bytes: 64, batch: 8, interval: 0, warmup: 1, timeout: 5000
    });
    assert.equal(sample.events, 111, target);
    assert.ok(sample.eventsPerSecond > 0, target);
    assert.equal(sample.firstEventMs.length, 3, target);
    assert.ok(sample.server.cpuMs >= 0, target);
    assert.ok(Number.isFinite(sample.clientCpuMs) && sample.clientCpuMs >= 0, target);
    assert.ok(['pipeline', 'direct', 'hono-node', 'kit', 'minksse-node'].includes(sample.server.setup.bridge));
  }
});

test('failed responses, malformed events and a stuck server invalidate the measurement', { timeout: 10000 }, async () => {
  assert.equal(typeof harness.measureClients, 'function', 'HTTP benchmark measurement is implemented');
  for (const response of ['status', 'corrupt', 'timeout']) {
    const server = createServer((_, res) => {
      if (response === 'status') { res.writeHead(500).end('failure'); return; }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (response === 'corrupt') res.end('event: message\ndata: {"sequence":99,"payload":"x"}\n\n');
      else res.flushHeaders();
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      await assert.rejects(harness.measureClients(`http://127.0.0.1:${server.address().port}`, {
        events: 1, clients: 2, bytes: 1, timeout: 100
      }));
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  }
});

test('server exits if its benchmark parent disconnects', { timeout: 5000 }, async () => {
  const child = fork(new URL('../server.mjs', import.meta.url), ['native', JSON.stringify({ events: 1, bytes: 1, batch: 1 })], {
    execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc']
  });
  try {
    await once(child, 'message');
    const exited = once(child, 'exit');
    child.disconnect();
    const outcome = await Promise.race([exited.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 200))]);
    assert.equal(outcome, true, 'disconnected server must not remain listening');
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
    }
  }
});

test('official Node adapters serve all Web producers without bypassing framing', { timeout: 20000 }, async () => {
  for (const bridge of ['hono-node', 'kit', 'minksse-node']) for (const target of ['hono', 'sveltekit-sse', 'minksse']) {
    const sample = await harness.measureTarget(target, {
      bridge, events: 37, clients: 3, bytes: 64, batch: 8, interval: 0, warmup: 1, timeout: 5000
    });
    assert.equal(sample.events, 111, target);
    assert.equal(sample.server.setup.bridge, bridge);
  }
});

test('MinkSSE coalescing can be disabled independently of its Node adapter', { timeout: 20000 }, async () => {
  for (const coalesce of [0, 256, 16384]) {
    const sample = await harness.measureTarget('minksse', { setup: 'optimized', coalesce,
      events: 53, clients: 3, bytes: 128, batch: 16, interval: 0, warmup: 1, timeout: 5000 });
    assert.equal(sample.events, 159);
    assert.equal(sample.server.setup.coalesceBytes, coalesce);
    assert.equal(sample.server.setup.bridge, 'minksse-node');
  }
});

test('CPU profiling flushes a readable profile on graceful child shutdown', { timeout: 10000 }, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'sse-profile-'));
  try {
    const sample = await harness.measureTarget('minksse', { setup: 'optimized', profile,
      events: 100, clients: 2, bytes: 64, batch: 8, interval: 0, warmup: 1, timeout: 5000 });
    assert.equal(sample.events, 200);
    const files = await readdir(profile);
    assert.equal(files.length, 1);
    const data = JSON.parse(await readFile(join(profile, files[0]), 'utf8'));
    assert.ok(data.nodes.length > 0);
    assert.ok(data.samples.length > 0);
  } finally { await rm(profile, { recursive: true, force: true }); }
});

test('native batching keeps exact event framing and writes one body chunk per shared batch', { timeout: 10000 }, async () => {
  for (const native of ['write', 'batch']) {
    const sample = await harness.measureTarget('native', { native, setup: 'baseline',
      events: 37, clients: 3, bytes: 64, batch: 8, interval: 0, warmup: 1, timeout: 5000 });
    assert.equal(sample.events, 111);
    assert.equal(sample.server.nativeWrites, native === 'write' ? 111 : 15);
  }
});

test('explicit build selection loads that producer rather than the current checkout', { timeout: 10000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sse-build-'));
  try {
    for (const file of await readdir(new URL('../../dist/', import.meta.url))) {
      if (file.endsWith('.js')) await copyFile(new URL(`../../dist/${file}`, import.meta.url), join(directory, file));
    }
    await writeFile(join(directory, 'package.json'), '{"type":"module"}');
    await writeFile(join(directory, 'server.js'), `export function produce() {
      return new Response('data: {"sequence":99,"payload":"x"}\\n\\n', {headers:{'content-type':'text/event-stream'}});
    }`);
    await assert.rejects(harness.measureTarget('minksse', { setup: 'optimized', minkbuild: directory,
      events: 1, clients: 1, bytes: 1, batch: 1, interval: 0, warmup: 0, timeout: 3000 }), /sequence/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('a load generator can abort pending client reads externally', { timeout: 5000 }, async () => {
  const controller = new AbortController();
  let requested;
  const ready = new Promise(resolve => { requested = resolve; });
  const server = createServer((_, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' }); res.flushHeaders(); requested();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = harness.measureClients(`http://127.0.0.1:${server.address().port}`, {
      events: 1, clients: 1, bytes: 1, timeout: 3000
    }, controller.signal);
    const rejection = assert.rejects(result, /external stop|aborted/i);
    await ready; controller.abort(new Error('external stop'));
    let deadline;
    try {
      await Promise.race([rejection, new Promise((_, reject) => {
        deadline = setTimeout(() => reject(new Error('External abort was ignored')), 1000);
      })]);
    } finally { clearTimeout(deadline); }
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('target measurements reuse parallel client workers across warmup and measurement', { timeout: 10000 }, async () => {
  const sample = await harness.measureTarget('native', { setup: 'optimized', loaders: 3,
    events: 20, clients: 5, bytes: 64, batch: 8, interval: 0, warmup: 1, timeout: 3000 });
  assert.equal(sample.events, 100);
  assert.deepEqual(sample.loaderClients, [2, 2, 1]);
  assert.equal(new Set(sample.loaderThreadIds).size, 3);
  assert.ok(sample.clientCpuMs > 0);
});

test('Native and MinkSSE frame Unicode and mixed-newline data over HTTP', { timeout: 20000 }, async () => {
  const { createPayload, serializeData } = await import('../core.mjs');
  for (const payload of ['unicode', 'multiline']) {
    const events = 19;
    const clients = 3;
    const bytes = 31;
    let expectedWireBytes = 0;
    for (let sequence = 0; sequence < events; sequence++) {
      const data = serializeData(sequence, createPayload(bytes, payload), payload).replace(/\r\n|\r|\n/g, '\ndata: ');
      expectedWireBytes += Buffer.byteLength(`id: ${sequence + 1}\nevent: message\ndata: ${data}\n\n`);
    }
    for (const [target, strategies] of [
      ['native', [{ native: 'write' }, { native: 'batch' }]],
      ['minksse', [{ minkapi: 'emit' }, { minkapi: 'batch' }]]
    ]) for (const strategy of strategies) {
      const sample = await harness.measureTarget(target, { setup: 'optimized', ...strategy, payload,
        events, clients, bytes, loaders: 2, batch: 8, interval: 0, warmup: 1, timeout: 3000 });
      assert.equal(sample.events, events * clients, `${target}: ${payload}`);
      assert.equal(sample.wireBytes, expectedWireBytes * clients, `${target}: ${payload}`);
    }
  }
});
