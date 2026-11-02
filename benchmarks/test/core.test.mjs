import { test } from 'node:test';
import assert from 'node:assert/strict';

const core = await import('../core.mjs').catch(() => ({}));

test('rejects invalid workload options before starting a server', () => {
  assert.equal(typeof core.parseOptions, 'function', 'benchmark options are implemented');
  assert.throws(() => core.parseOptions(['--clients=0']), /clients/);
  assert.throws(() => core.parseOptions(['--events=2.5']), /events/);
  assert.throws(() => core.parseOptions(['--unknown=3']), /Unknown/);
  assert.throws(() => core.parseOptions(['--targets=missing']), /target/);
});

test('validates UTF-8 events across byte boundaries and rejects missing, duplicate or corrupted events', () => {
  assert.equal(typeof core.createValidator, 'function', 'wire validator is implemented');
  const payload = 'héllo🌏';
  const validator = core.createValidator(2, payload);
  const bytes = new TextEncoder().encode('id: 1\nevent: message\ndata: {"sequence":0,"payload":"héllo🌏"}\n\nid: 2\nevent: message\ndata: {"sequence":1,"payload":"héllo🌏"}\n\n');
  for (const byte of bytes) validator.push(Uint8Array.of(byte));
  assert.equal(validator.finish(), 2);
  const missing = core.createValidator(1, payload);
  assert.throws(() => missing.finish(), /Expected 1/);
  const duplicate = core.createValidator(2, payload);
  const frame = new TextEncoder().encode('id: 1\nevent: message\ndata: {"sequence":0,"payload":"héllo🌏"}\n\n');
  duplicate.push(frame);
  assert.throws(() => duplicate.push(frame), /sequence/);
  const corrupt = core.createValidator(1, payload);
  assert.throws(() => corrupt.push(new TextEncoder().encode('event: message\ndata: {"sequence":0,"payload":"wrong"}\n\n')), /payload/);
});

test('summarizes actual samples with median and a mean confidence interval', () => {
  assert.equal(typeof core.summarize, 'function', 'summary statistics are implemented');
  const summary = core.summarize([1, 2, 3, 4, 5]);
  assert.equal(summary.median, 3);
  assert.equal(summary.mean, 3);
  assert.ok(summary.ci95[0] < 3 && summary.ci95[1] > 3);
  assert.deepEqual(core.summarize([2]).ci95, null);
});

 test('setup and explicit transport strategies are validated and reproducible', () => {
  assert.equal(core.parseOptions([]).setup, 'optimized');
  assert.equal(core.parseOptions(['--setup=optimized']).setup, 'optimized');
  assert.equal(core.parseOptions(['--setup=baseline']).setup, 'baseline');
  assert.throws(() => core.parseOptions(['--setup=magic']), /setup/);
  assert.equal(core.parseOptions(['--bridge=direct']).bridge, 'direct');
  assert.throws(() => core.parseOptions(['--bridge=missing']), /bridge/);
  assert.equal(core.parseOptions(['--profile=/tmp/profiles']).profile, '/tmp/profiles');
  const optimized = core.parseOptions([]);
  assert.equal(core.resolveSetup(optimized, 'hono').bridge, 'hono-node');
  assert.equal(core.resolveSetup(optimized, 'sveltekit-sse').bridge, 'kit');
  assert.equal(core.resolveSetup(optimized, 'minksse').bridge, 'minksse-node');
  assert.equal(core.resolveSetup(optimized, 'better-sse').better, 'batch');
  assert.equal(core.resolveSetup(optimized, 'native').cork, 'off');
  assert.equal(core.resolveSetup(optimized, 'native').native, 'batch');
  assert.equal(core.resolveSetup(optimized, 'fastify').fastify, 'send');
  assert.equal(core.resolveSetup({ ...optimized, bridge: 'pipeline' }, 'hono').bridge, 'pipeline');
 });

test('native write strategy is explicit and validated', () => {
  assert.equal(core.parseOptions(['--native=batch']).native, 'batch');
  assert.equal(core.resolveSetup({setup:'baseline'}, 'native').native, 'write');
  assert.throws(() => core.parseOptions(['--native=invalid']), /native/);
});

test('MinkSSE coalescing is explicit, bounded and reproducible', () => {
  const optimized = core.parseOptions([]);
  assert.equal(core.resolveSetup(optimized, 'minksse').coalesceBytes, 16384);
  assert.equal(core.resolveSetup(core.parseOptions(['--setup=baseline']), 'minksse').coalesceBytes, 0);
  assert.equal(core.resolveSetup(core.parseOptions(['--coalesce=0']), 'minksse').coalesceBytes, 0);
  assert.equal(core.resolveSetup(core.parseOptions(['--coalesce=4096']), 'minksse').coalesceBytes, 4096);
  assert.equal(core.parseOptions(['--bridge=minksse-node']).bridge, 'minksse-node');
  for (const value of ['-1', '1.5', '262145', 'NaN']) {
    assert.throws(() => core.parseOptions([`--coalesce=${value}`]), /coalesce/);
  }
});

test('an explicit MinkSSE build can be compared without replacing the current build', () => {
  assert.equal(core.parseOptions([]).minkbuild, '');
  assert.equal(core.parseOptions(['--minkbuild=/tmp/minksse-before-native-pass']).minkbuild, '/tmp/minksse-before-native-pass');
});

test('MinkSSE scalar and batch APIs are explicitly selected', () => {
  assert.equal(core.resolveSetup(core.parseOptions([]), 'minksse').minkApi, 'batch');
  assert.equal(core.resolveSetup(core.parseOptions(['--setup=baseline']), 'minksse').minkApi, 'emit');
  assert.equal(core.resolveSetup(core.parseOptions(['--minkapi=emit']), 'minksse').minkApi, 'emit');
  assert.throws(() => core.parseOptions(['--minkapi=invalid']), /minkapi/);
});

test('wire validation rejects incorrect IDs even when JSON payload order is correct', () => {
  const validator = core.createValidator(1, 'x');
  assert.throws(() => validator.push(new TextEncoder().encode('id: 9\nevent: message\ndata: {"sequence":0,"payload":"x"}\n\n')), /ID/);
});

test('parallel loader count is bounded and independent of option order', () => {
  assert.equal(core.parseOptions([]).loaders, 1);
  assert.equal(core.parseOptions(['--loaders=4','--clients=4']).loaders, 4);
  assert.throws(() => core.parseOptions(['--loaders=4','--clients=2']), /loaders/);
  assert.throws(() => core.parseOptions(['--clients=64','--loaders=33']), /loaders/);
});

test('payload modes have explicit CLI validation and preserve the ASCII default', () => {
  assert.equal(core.parseOptions([]).payload, 'ascii');
  for (const payload of ['ascii', 'unicode', 'multiline']) {
    assert.equal(core.parseOptions([`--payload=${payload}`]).payload, payload);
  }
  assert.throws(() => core.parseOptions(['--payload=invalid']), /payload/);
});

test('payload generation preserves the exact requested UTF-8 byte length', () => {
  assert.equal(typeof core.createPayload, 'function');
  for (const kind of ['ascii', 'unicode', 'multiline']) for (let bytes = 0; bytes < 40; bytes++) {
    const payload = core.createPayload(bytes, kind);
    assert.equal(Buffer.byteLength(payload), bytes, `${kind}: ${bytes}`);
    assert.equal(payload.includes('é😀'), kind === 'unicode' && bytes >= 6);
  }
  assert.equal(core.createPayload(13, 'unicode'), 'é😀é😀x');
  assert.equal(core.createPayload(5), 'xxxxx');
});

test('multiline serialization includes mixed line endings and remains valid JSON', () => {
  assert.equal(typeof core.serializeData, 'function');
  const payload = 'é😀xxxx';
  for (const kind of ['ascii', 'unicode', 'multiline']) {
    const serialized = core.serializeData(42, payload, kind);
    assert.deepEqual(JSON.parse(serialized), { sequence: 42, payload });
    if (kind === 'multiline') {
      assert.match(serialized, /\r\n/);
      assert.match(serialized, /\r(?!\n)/);
      assert.match(serialized, /(?<!\r)\n/);
      assert.deepEqual(JSON.parse(serialized.replace(/\r\n|\r|\n/g, '\n')), { sequence: 42, payload });
    } else assert.equal(serialized, JSON.stringify({ sequence: 42, payload }));
  }
});
