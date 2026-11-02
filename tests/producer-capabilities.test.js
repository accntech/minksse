import { expect, test } from 'bun:test';

const registry = await import('../src/producer-capabilities.js').catch(() => ({}));

test('private producer capabilities are scoped to an exact body and consumed once', () => {
  expect(typeof registry.registerProducerCapabilities).toBe('function');
  expect(typeof registry.installProducerCapabilities).toBe('function');
  const body = new ReadableStream();
  const other = new ReadableStream();
  const capabilities = { byteLength: value => value.length };
  const state = {};
  registry.registerProducerCapabilities(body, state);
  expect(registry.installProducerCapabilities(other, capabilities)).toBe(false);
  expect(state.byteLength).toBeUndefined();
  const reader = body.getReader();
  expect(registry.installProducerCapabilities(body, capabilities)).toBe(true);
  expect(state.byteLength).toBe(capabilities.byteLength);
  expect(registry.installProducerCapabilities(body, capabilities)).toBe(false);
  reader.releaseLock();
});

test('private capabilities cannot be installed on an unlocked body', () => {
  const body = new ReadableStream();
  const state = {};
  const capabilities = { byteLength: value => value.length };
  registry.registerProducerCapabilities(body, state);
  expect(registry.installProducerCapabilities(body, capabilities)).toBe(false);
  expect(state.byteLength).toBeUndefined();
  const reader = body.getReader();
  expect(registry.installProducerCapabilities(body, capabilities)).toBe(true);
  reader.releaseLock();
});
