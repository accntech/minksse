import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const module = await import('../load-workers.mjs').catch(() => ({}));
const options = { clients: 5, loaders: 3, events: 20, bytes: 16, timeout: 2000 };

async function fixture(mode = 'valid') {
  let requests = 0;
  const server = createServer((_, res) => {
    requests++;
    if (mode === 'status') { res.writeHead(500).end(); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    if (mode === 'timeout') { res.flushHeaders(); return; }
    const count = mode === 'corrupt' ? 1 : options.events;
    for (let sequence = 0; sequence < count; sequence++) {
      res.write(`id: ${sequence + 1}\nevent: message\ndata: ${JSON.stringify({ sequence: mode === 'corrupt' ? 99 : sequence, payload: 'x'.repeat(options.bytes) })}\n\n`);
    }
    res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    get requests() { return requests; },
    connections() { return new Promise((resolve, reject) => server.getConnections((error, count) => error ? reject(error) : resolve(count))); },
    async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  };
}

async function until(check) {
  const deadline = Date.now() + 1000;
  while (!(await check())) {
    assert.ok(Date.now() < deadline, 'expected socket state before deadline');
    await new Promise(resolve => setTimeout(resolve, 2));
  }
}

test('worker load generator balances clients and reuses ready workers across passes', { timeout: 10000 }, async () => {
  assert.equal(typeof module.createLoadGenerator, 'function', 'worker load generator is implemented');
  const server = await fixture();
  const generator = await module.createLoadGenerator(options);
  try {
    const first = await generator.measure(server.url);
    const second = await generator.measure(server.url);
    assert.equal(server.requests, options.clients * 2);
    for (const sample of [first, second]) {
      assert.equal(sample.events, options.clients * options.events);
      assert.equal(sample.firstEventMs.length, options.clients);
      assert.deepEqual(sample.loaderClients, [2, 2, 1]);
      assert.ok(sample.eventsPerSecond > 0);
      assert.ok(Number.isFinite(sample.clientCpuMs) && sample.clientCpuMs >= 0);
      assert.ok(sample.wireBytes > 0);
    }
    assert.equal(first.loaderThreadIds.length, options.loaders);
    assert.deepEqual(first.loaderThreadIds, second.loaderThreadIds);
  } finally { await generator.close(); await generator.close(); await server.close(); }
  await assert.rejects(generator.measure(server.url), /closed/);
});

test('single-loader path preserves the validated measurement contract', { timeout: 10000 }, async () => {
  assert.equal(typeof module.createLoadGenerator, 'function', 'worker load generator is implemented');
  const server = await fixture();
  const generator = await module.createLoadGenerator({ ...options, loaders: 1 });
  try {
    const sample = await generator.measure(server.url);
    assert.equal(sample.events, options.clients * options.events);
    assert.equal(sample.firstEventMs.length, options.clients);
    assert.deepEqual(sample.loaderClients, [options.clients]);
    assert.deepEqual(sample.loaderThreadIds, []);
  } finally { await generator.close(); await server.close(); }
});

test('invalid loader counts fail before starting workers', async () => {
  assert.equal(typeof module.createLoadGenerator, 'function', 'worker load generator is implemented');
  for (const loaders of [0, -1, 1.5, options.clients + 1, NaN]) {
    await assert.rejects(module.createLoadGenerator({ ...options, loaders }), /loaders/);
  }
});

for (const mode of ['status', 'corrupt', 'timeout']) {
  test(`worker failures invalidate ${mode} responses and close the pool`, { timeout: 10000 }, async () => {
    assert.equal(typeof module.createLoadGenerator, 'function', 'worker load generator is implemented');
    const server = await fixture(mode);
    const generator = await module.createLoadGenerator({ ...options, timeout: mode === 'timeout' ? 150 : 2000 });
    try {
      await assert.rejects(generator.measure(server.url), /Invalid|sequence|timeout/i);
      await assert.rejects(generator.measure(server.url), /closed/);
    } finally { await generator.close(); await server.close(); }
  });
}

for (const loaders of [1, 3]) {
  test(`closing an active ${loaders}-loader pass rejects it and releases sockets`, { timeout: 10000 }, async () => {
    assert.equal(typeof module.createLoadGenerator, 'function', 'worker load generator is implemented');
    const server = await fixture('timeout');
    const generator = await module.createLoadGenerator({ ...options, loaders });
    try {
      const pass = generator.measure(server.url);
      const rejected = assert.rejects(pass, /closed|exit|terminated/i);
      await until(() => server.requests === options.clients);
      await generator.close();
      await rejected;
      await until(async () => await server.connections() === 0);
    } finally { await generator.close(); await server.close(); }
  });
}
