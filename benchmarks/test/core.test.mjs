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
  const frame = new TextEncoder().encode('event: message\ndata: {"sequence":0,"payload":"héllo🌏"}\n\n');
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
