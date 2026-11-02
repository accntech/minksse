import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';

function nodeCase(name, source) {
  test(name, () => {
    const result = spawnSync('node', ['--input-type=module', '--eval', `
      import assert from 'node:assert/strict';
      import { createServer, get } from 'node:http';
      import { writeSseResponse } from './src/node.js';
      import { registerProducerCapabilities } from './src/producer-capabilities.js';
      async function captureCapabilities() {
        const capabilities = {};
        let locked;
        const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('ready')); c.close(); } });
        registerProducerCapabilities(body, new Proxy(capabilities, { set(target, key, value) {
          locked = body.locked; return Reflect.set(target, key, value);
        } }));
        let completion;
        const server = createServer((_, res) => { completion = writeSseResponse(new Response(body), res); completion.catch(() => {}); });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        try {
          await new Promise((resolve, reject) => get('http://127.0.0.1:' + server.address().port, res => {
            res.resume(); res.on('end', resolve);
          }).on('error', reject));
          await completion;
        } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
        assert.equal(locked, true, 'capabilities installed only after taking reader lock');
        assert.equal(typeof capabilities?.byteLength, 'function');
        return capabilities;
      }
      ${source}
    `], { cwd: new URL('../', import.meta.url), encoding: 'utf8', timeout: 5000 });
    expect({ status: result.status, stderr: result.stderr, error: result.error?.message }).toEqual({ status: 0, stderr: '', error: undefined });
  });
}

nodeCase('owning Node adapter installs an exact UTF-8 byte counter after taking the reader lock', `
  const capabilities = await captureCapabilities();
  const values = ['', 'ascii', '€😀', '\\ud800', '\\udc00', 'a\\r\\nb\\nc\\rd'];
  for (const value of values)
    assert.equal(capabilities.byteLength(value), new TextEncoder().encode(value).length);
`);

nodeCase('Node adapter captures and owns one body even when a Response getter changes', `
  const actual = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('actual')); c.close(); } });
  const decoy = new ReadableStream({ start(c) { c.close(); } });
  const actualState = {}, decoyState = {};
  registerProducerCapabilities(actual, actualState);
  registerProducerCapabilities(decoy, decoyState);
  const response = new Response(actual);
  let bodyReads = 0;
  Object.defineProperty(response, 'body', { get() { return ++bodyReads === 1 ? actual : decoy; } });
  let completion;
  const server = createServer((_, res) => { completion = writeSseResponse(response, res); completion.catch(() => {}); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    let output = '';
    await new Promise((resolve, reject) => get('http://127.0.0.1:' + server.address().port, res => {
      res.setEncoding('utf8'); res.on('data', chunk => { output += chunk; }); res.on('end', resolve);
    }).on('error', reject));
    await completion;
    assert.equal(output, 'actual');
    assert.equal(bodyReads, 1);
    assert.equal(typeof actualState.byteLength, 'function');
    assert.equal(decoyState.byteLength, undefined);
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
`);

nodeCase('Node adapter acquires its own native reader despite an overridden getReader method', `
  const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('owned')); c.close(); } });
  Object.defineProperty(body, 'getReader', { value() { throw new Error('instance getReader must not run'); } });
  const state = {};
  registerProducerCapabilities(body, state);
  let completion;
  const server = createServer((_, res) => { completion = writeSseResponse(new Response(body), res); completion.catch(() => {}); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    let output = '';
    await new Promise((resolve, reject) => get('http://127.0.0.1:' + server.address().port, res => {
      res.setEncoding('utf8'); res.on('data', chunk => { output += chunk; }); res.on('end', resolve);
    }).on('error', reject));
    await completion;
    assert.equal(output, 'owned');
    assert.equal(typeof state.byteLength, 'function');
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
`);
