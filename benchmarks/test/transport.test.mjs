import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { targets } from '../core.mjs';

const harness = await import('../harness.mjs').catch(() => ({}));

test('every genuine adapter delivers all validated events over concurrent HTTP streams and exits', { timeout: 60000 }, async () => {
  assert.equal(typeof harness.measureTarget, 'function', 'HTTP benchmark harness is implemented');
  for (const target of targets) {
    const sample = await harness.measureTarget(target, {
      events: 37, clients: 3, bytes: 64, batch: 8, interval: 0, warmup: 1, timeout: 5000
    });
    assert.equal(sample.events, 111, target);
    assert.ok(sample.eventsPerSecond > 0, target);
    assert.equal(sample.firstEventMs.length, 3, target);
    assert.ok(sample.server.cpuMs >= 0, target);
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
