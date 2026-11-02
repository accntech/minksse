import { test } from 'node:test';
import assert from 'node:assert/strict';
const benchmark = await import('../client-benchmark.mjs').catch(() => ({}));

test('client score validation rejects lost, reordered, duplicated and corrupt events', () => {
  assert.equal(typeof benchmark.createClientValidator, 'function');
  const complete = benchmark.createClientValidator(2, 'é😀');
  assert.throws(() => complete.accept({ sequence: 1, payload: 'é😀' }), /sequence/);
  complete.accept({ sequence: 0, payload: 'é😀' });
  assert.throws(() => complete.finish({ count: 2 }), /Expected 2/);
  assert.throws(() => complete.accept({ sequence: 0, payload: 'é😀' }), /sequence/);
  assert.throws(() => complete.accept({ sequence: 1, payload: 'bad' }), /payload/);
  complete.accept({ sequence: 1, payload: 'é😀' });
  assert.throws(() => complete.accept({ sequence: 2, payload: 'é😀' }), /sequence/);
  assert.throws(() => complete.finish({ count: 1 }), /sentinel/);
  assert.equal(complete.finish({ count: 2 }), 2);
});
