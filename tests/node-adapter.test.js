import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';

function nodeCase(name, source) {
  test(name, () => {
    const result = spawnSync('node', ['--input-type=module', '--eval', `
      import assert from 'node:assert/strict';
      import { createServer, get } from 'node:http';
      import { once } from 'node:events';
      import { produce } from './src/server.js';
      const adapter = await import('./src/node.js').catch(() => ({}));
      assert.equal(typeof adapter.writeSseResponse, 'function', 'Node adapter is implemented');
      const { writeSseResponse } = adapter;
      const listen = async handler => {
        const server = createServer(handler);
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        return server;
      };
      const stop = async server => {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
      };
      ${source}
    `], { cwd: new URL('../', import.meta.url), encoding: 'utf8', timeout: 5000 });
    expect({ status: result.status, stderr: result.stderr, error: result.error?.message }).toEqual({ status: 0, stderr: '', error: undefined });
  }, 10000);
}

nodeCase('Node adapter streams sparse events with status, headers and separate cookies, then awaits finish', `
  let cleanup = 0, finished = false, resolved = false;
  let operation;
  const server = await listen((req, res) => {
    res.once('finish', () => { finished = true; });
    const response = produce(({ emit, lock }) => {
      emit('notice', 'first');
      const timer = setTimeout(() => { emit('notice', 'second'); lock.set(false); }, 30);
      return () => { clearTimeout(timer); cleanup++; };
    });
    const headers = new Headers(response.headers);
    headers.append('set-cookie', 'first=1; Path=/');
    headers.append('set-cookie', 'second=2; Path=/');
    headers.set('x-adapter', 'yes');
    operation = writeSseResponse(new Response(response.body, { status: 201, headers }), res).then(() => {
      assert.equal(finished, true); resolved = true;
    });
  });
  try {
    let wire = '', sawFirst = false;
    await new Promise((resolve, reject) => {
      get('http://127.0.0.1:' + server.address().port, response => {
        assert.equal(response.statusCode, 201);
        assert.equal(response.headers['x-adapter'], 'yes');
        assert.deepEqual(response.headers['set-cookie'], ['first=1; Path=/', 'second=2; Path=/']);
        response.setEncoding('utf8');
        response.on('data', chunk => { wire += chunk; if (!sawFirst) { assert.match(wire, /first/); assert.equal(resolved, false); sawFirst = true; } });
        response.on('end', resolve); response.on('error', reject);
      }).on('error', reject);
    });
    await operation;
    assert.equal(wire, 'id: 1\\nevent: notice\\ndata: first\\n\\nid: 2\\nevent: notice\\ndata: second\\n\\n');
    assert.equal(cleanup, 1); assert.equal(resolved, true); assert.equal(sawFirst, true);
  } finally { await stop(server); }
`);

nodeCase('Node adapter cancels a pending Web read on external abort and releases its lock', `
  let cancelled = 0, outcome;
  const abort = new AbortController();
  const reason = new Error('external stop');
  const body = new ReadableStream({ cancel() { cancelled++; } });
  const server = await listen((req, res) => {
    outcome = writeSseResponse(new Response(body), res, { signal: abort.signal });
    outcome.catch(() => {});
    setImmediate(() => abort.abort(reason));
  });
  try {
    const request = get('http://127.0.0.1:' + server.address().port);
    request.on('error', () => {});
    await new Promise(resolve => setTimeout(resolve, 30));
    await assert.rejects(outcome, error => error === reason);
    assert.equal(cancelled, 1); assert.equal(body.locked, false);
  } finally { await stop(server); }
`);

nodeCase('Node adapter cancels producer exactly once when the real client disconnects', `
  let cleanup = 0, body, outcome;
  const server = await listen((req, res) => {
    const response = produce(({ emit }) => { emit('notice', 'first'); return () => { cleanup++; }; });
    body = response.body;
    outcome = writeSseResponse(response, res); outcome.catch(() => {});
  });
  try {
    await new Promise((resolve, reject) => {
      get('http://127.0.0.1:' + server.address().port, response => {
        response.once('data', () => { response.destroy(); resolve(); });
        response.on('error', () => {});
      }).on('error', reject);
    });
    await assert.rejects(outcome, error => error.name === 'AbortError');
    assert.equal(cleanup, 1); assert.equal(body.locked, false);
  } finally { await stop(server); }
`);

nodeCase('Node adapter rejects and cancels when the real destination closes during backpressure', `
  let cancelled = 0, blocked = false, outcome, responseBody, serverResponse, initialFinish;
  const server = await listen((req, res) => {
    serverResponse = res; initialFinish = res.listenerCount('finish');
    const originalWrite = res.write;
    res.write = function (...args) {
      const writable = originalWrite.apply(this, args);
      if (!writable) { blocked = true; setImmediate(() => this.destroy()); }
      return writable;
    };
    responseBody = new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array(8 * 1024 * 1024)); },
      cancel() { cancelled++; }
    }, { highWaterMark: 0 });
    outcome = writeSseResponse(new Response(responseBody), res); outcome.catch(() => {});
  });
  try {
    const request = get('http://127.0.0.1:' + server.address().port, response => {
      response.pause(); response.on('error', () => {});
    });
    request.on('error', () => {});
    await new Promise(resolve => setTimeout(resolve, 40));
    await assert.rejects(outcome, error => error.name === 'AbortError');
    assert.equal(blocked, true); assert.equal(cancelled, 1); assert.equal(responseBody.locked, false);
    assert.equal(serverResponse.listenerCount('drain'), 0);
    assert.equal(serverResponse.listenerCount('finish'), initialFinish);
  } finally { await stop(server); }
`);

nodeCase('Node adapter rejects original body errors and releases the read lock', `
  const reason = new Error('source failed');
  const body = new ReadableStream({ start(controller) { controller.error(reason); } });
  let outcome;
  const server = await listen((req, res) => {
    outcome = writeSseResponse(new Response(body), res); outcome.catch(() => {});
  });
  try {
    get('http://127.0.0.1:' + server.address().port).on('error', () => {});
    await new Promise(resolve => setTimeout(resolve, 20));
    await assert.rejects(outcome, error => error === reason);
    assert.equal(body.locked, false);
  } finally { await stop(server); }
`);

nodeCase('Node adapter cancels before reading a pre-aborted response', `
  let cancelled = 0, pulled = 0, outcome;
  const reason = new Error('already aborted');
  const signal = AbortSignal.abort(reason);
  const body = new ReadableStream({ pull() { pulled++; }, cancel() { cancelled++; } }, { highWaterMark: 0 });
  const server = await listen((req, res) => {
    outcome = writeSseResponse(new Response(body), res, { signal }); outcome.catch(() => {});
  });
  try {
    get('http://127.0.0.1:' + server.address().port).on('error', () => {});
    await new Promise(resolve => setTimeout(resolve, 20));
    await assert.rejects(outcome, error => error === reason);
    assert.equal(cancelled, 1); assert.equal(pulled, 0); assert.equal(body.locked, false);
  } finally { await stop(server); }
`);

nodeCase('Node adapter ends a bodyless response and removes adapter listeners', `
  let operation, destination, initialFinish;
  const server = await listen((req, res) => {
    destination = res; initialFinish = res.listenerCount('finish');
    operation = writeSseResponse(new Response(null, { status: 204, headers: { 'x-empty': 'yes' } }), res);
  });
  try {
    await new Promise((resolve, reject) => {
      get('http://127.0.0.1:' + server.address().port, response => {
        assert.equal(response.statusCode, 204); assert.equal(response.headers['x-empty'], 'yes');
        response.resume(); response.on('end', resolve);
      }).on('error', reject);
    });
    await operation;
    assert.equal(destination.listenerCount('finish'), initialFinish);
    assert.equal(destination.listenerCount('drain'), 0);
  } finally { await stop(server); }
`);

nodeCase('Node adapter cancels a body when the destination was already destroyed', `
  let cancelled = 0, outcome;
  const body = new ReadableStream({ cancel() { cancelled++; } });
  const server = await listen((req, res) => {
    res.destroy();
    outcome = writeSseResponse(new Response(body), res); outcome.catch(() => {});
  });
  try {
    get('http://127.0.0.1:' + server.address().port).on('error', () => {});
    await new Promise(resolve => setTimeout(resolve, 20));
    await assert.rejects(outcome, error => error.name === 'AbortError');
    assert.equal(cancelled, 1); assert.equal(body.locked, false);
  } finally { await stop(server); }
`);

nodeCase('Node adapter cancels and rejects invalid response headers without retaining listeners', `
  let cleanup = 0, outcome, body;
  const server = await listen((req, res) => {
    const response = produce(({ emit }) => { emit('notice', 'first'); return () => { cleanup++; }; });
    body = response.body;
    response.headers.set('connection', 'invalid' + String.fromCharCode(1));
    outcome = writeSseResponse(response, res); outcome.catch(() => {});
  });
  try {
    get('http://127.0.0.1:' + server.address().port).on('error', () => {});
    await new Promise(resolve => setTimeout(resolve, 20));
    await assert.rejects(outcome);
    assert.equal(cleanup, 1); assert.equal(body.locked, false);
  } finally { await stop(server); }
`);

nodeCase('Node adapter treats abort from a finish listener as successful completed delivery', `
  const abort = new AbortController();
  let outcome;
  const server = await listen((req, res) => {
    res.once('finish', () => abort.abort(new Error('finished')));
    outcome = writeSseResponse(new Response('done'), res, { signal: abort.signal }); outcome.catch(() => {});
  });
  try {
    await new Promise((resolve, reject) => {
      get('http://127.0.0.1:' + server.address().port, response => {
        response.resume(); response.on('end', resolve);
      }).on('error', reject);
    });
    await outcome;
  } finally { await stop(server); }
`);

nodeCase('Node adapter flushes SSE headers while waiting for the first event', `
  let emit, finish, outcome;
  const server = await listen((req, res) => {
    const response = produce(controls => { emit = controls.emit; finish = () => controls.lock.set(false); });
    outcome = writeSseResponse(response, res); outcome.catch(() => {});
  });
  try {
    await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error('Expected SSE headers before the first event')), 1000);
      get('http://127.0.0.1:' + server.address().port, response => {
        clearTimeout(deadline);
        assert.equal(response.headers['content-type'], 'text/event-stream');
        response.resume(); response.on('end', resolve);
        emit('notice', 'after connection'); finish();
      }).on('error', reject);
    });
    await outcome;
  } finally { await stop(server); }
`);

nodeCase('Node adapter ignores normal-close signal abort after finish', `
  let outcome;
  const server = await listen((req, res) => {
    const controller = new AbortController();
    res.once('close', () => controller.abort());
    outcome = writeSseResponse(new Response('done'), res, { signal: controller.signal }); outcome.catch(() => {});
  });
  try {
    await new Promise((resolve, reject) => {
      get('http://127.0.0.1:' + server.address().port, response => {
        response.resume(); response.on('end', resolve);
      }).on('error', reject);
    });
    await outcome;
  } finally { await stop(server); }
`);

nodeCase('Node adapter ignores a destination error after successful finish', `
  let outcome;
  const server = await listen((req, res) => {
    res.once('finish', () => res.emit('error', new Error('after finish')));
    outcome = writeSseResponse(new Response('done'), res); outcome.catch(() => {});
  });
  try {
    await new Promise((resolve, reject) => {
      get('http://127.0.0.1:' + server.address().port, response => {
        response.resume(); response.on('end', resolve);
      }).on('error', reject);
    });
    await outcome;
  } finally { await stop(server); }
`);

nodeCase('Node adapter cancels if another owner ends the destination before body EOF', `
  let cancelled = 0, outcome;
  let began;
  const started = new Promise(resolve => { began = resolve; });
  const body = new ReadableStream({ cancel() { cancelled++; } });
  const server = await listen((req, res) => {
    outcome = writeSseResponse(new Response(body), res); outcome.catch(() => {});
    began();
    setImmediate(() => res.end());
  });
  try {
    get('http://127.0.0.1:' + server.address().port, response => response.resume()).on('error', () => {});
    await started;
    let deadline;
    try {
      await Promise.race([
        assert.rejects(outcome, error => error.name === 'AbortError'),
        new Promise((resolve, reject) => { deadline = setTimeout(() => reject(new Error('Premature finish did not cancel the pending reader')), 1000); })
      ]);
    } finally { clearTimeout(deadline); }
    assert.equal(cancelled, 1); assert.equal(body.locked, false);
  } finally { await stop(server); }
`);
