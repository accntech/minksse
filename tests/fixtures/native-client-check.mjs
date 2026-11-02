import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createSseConnection } from '../../dist/client.js';
import { produce } from '../../dist/server.js';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

let route;
const server = createServer((req, res) => route(req, res));
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const url = `http://127.0.0.1:${server.address().port}/events`;
const connections = new Set();
server.on('connection', socket => { connections.add(socket); socket.on('close', () => connections.delete(socket)); });
const clients = [];
const connect = options => { const client = createSseConnection(url, options); clients.push(client); return client; };
function deferred() { return Promise.withResolvers(); }
const results = [];
try {
  // Native parser handles byte-split Unicode and CRLF; wrapper preserves duplicate events.
  const got = deferred();
  const disconnected = deferred();
  const values = [];
  route = (req, res) => {
    assert.equal(req.method, 'GET');
    assert.equal(req.headers.accept, 'text/event-stream');
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    req.on('close', () => disconnected.resolve());
    const bytes = Buffer.from('event: notice\r\ndata: {"name":"piñata😀"}\r\n\r\nevent: notice\ndata: 1\n\nevent: notice\ndata: 1\n\n');
    let index = 0;
    const timer = setInterval(() => { if (index < bytes.length) res.write(bytes.subarray(index, ++index)); else clearInterval(timer); }, 1);
    res.on('close', () => clearInterval(timer));
  };
  const first = connect({ onerror: got.reject });
  first.subscribe('notice', value => { values.push(value); if (values.length === 3) got.resolve(); });
  await got.promise;
  assert.deepEqual(values, [{ name: 'piñata😀' }, 1, 1]);
  first.close();
  await disconnected.promise;
  results.push('GET, fragmented Unicode, duplicates, socket cleanup');

  // Real native error is closed before native retry; explicit retry uses a fresh stream.
  let requests = 0;
  let retryHeaders;
  const ended = deferred();
  const retried = deferred();
  route = (req, res) => {
    requests++;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    if (requests === 1) res.end('retry: 10\nid: 42\nevent: notice\ndata: 1\n\n');
    else { retryHeaders = req.headers; res.write('event: notice\ndata: 2\n\n'); }
  };
  const recovery = connect({ onclose: ({ connect }) => ended.resolve(connect) });
  recovery.subscribe('notice', value => { if (value === 2) retried.resolve(); });
  const retry = await ended.promise;
  await delay(80);
  assert.equal(requests, 1, 'native retry must be stopped');
  const attempt = retry();
  await retried.promise;
  assert.equal(requests, 2);
  assert.equal(retryHeaders['last-event-id'], undefined);
  recovery.close();
  await attempt;
  results.push('native retries suppressed, explicit recovery, fresh event ID');

  // Producer heartbeats are dispatched even when no application event is subscribed.
  const open = deferred();
  let closes = 0;
  route = (req, res) => {
    const abort = new AbortController();
    res.on('close', () => abort.abort());
    // Test-server plumbing only: the package returns a portable streaming Response.
    const response = produce(() => {}, { ping: 15, signal: abort.signal });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.flushHeaders();
    void pipeline(Readable.fromWeb(response.body), res).catch(error => {
      if (!abort.signal.aborted) open.reject(error);
    });
  };
  const heartbeat = connect({ idleTimeoutMs: 120, onopen: open.resolve, onclose: () => closes++ });
  await open.promise;
  await delay(300);
  assert.equal(closes, 0);
  heartbeat.close();
  results.push('real producer heartbeats prevent idle expiry');

  // Comments are deliberately invisible to the wrapper's event timeout.
  const idle = deferred();
  route = (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(': comment\n\n');
    const timer = setInterval(() => res.write(': heartbeat\n\n'), 10);
    res.on('close', () => clearInterval(timer));
  };
  const stalled = connect({ idleTimeoutMs: 80, onclose: idle.resolve });
  await idle.promise;
  stalled.close();
  results.push('comment traffic cannot mask event-idle timeout');

  for (const [status, type] of [[401, 'text/event-stream'], [200, 'text/html']]) {
    const rejected = deferred();
    let opens = 0;
    let errors = 0;
    route = (_req, res) => { res.writeHead(status, { 'content-type': type }); res.end('denied'); };
    const invalid = connect({ onopen: () => opens++, onerror: () => errors++, onclose: rejected.resolve });
    await rejected.promise;
    assert.equal(opens, 0);
    assert.equal(errors, 1);
    invalid.close();
  }
  results.push('native HTTP and content-type rejection');
  console.log(JSON.stringify(results));
} finally {
  for (const client of clients) client.close();
  for (const socket of connections) socket.destroy();
  await new Promise(resolve => server.close(resolve));
}
