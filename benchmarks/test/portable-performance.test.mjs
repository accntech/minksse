import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readConfiguration, summarizeSamples } from '../experiments/portable-performance.mjs';

const base = { clients: 16, events: 20_000 };
const workloads = { primary: {} };
const repeats = { primary: 3 };
function samples(after = 120) {
  return Array.from({ length: 3 }, (_, index) => ['native', 'before-generic', 'after-generic'].map(variant => ({
    workload: 'primary', variant, repeat: index + 1, events: 320_000,
    wireBytes: 64_000_000, eventsPerSecond: variant === 'after-generic' ? after : 100,
    elapsedMs: 100, clientCpuMs: 20,
    server: { fatal: null, setup: { bridge: 'direct' }, cpuMs: 10 }
  }))).flat();
}

test('portable control rejects ambiguous workload and repeat selections', () => {
  const config = readConfiguration({});
  assert.equal(config.repeats.primary, 18);
  assert.equal(config.repeats.single, 6);
  for (const env of [{ CASES: 'unknown' }, { CASES: 'single,single' }, { REPEATS: '0' }, { REPEATS: '1.5' }])
    assert.throws(() => readConfiguration(env));
});

test('portable control requires complete consistent validated samples before claiming parity', () => {
  const report = summarizeSamples(samples(), workloads, repeats, base).primary;
  assert.equal(report.complete, true);
  assert.equal(report.nativeParitySupported, true);
  assert.equal(report.measuredEvents, 2_880_000);
  assert.equal(report.ratiosOfMedians.afterVsNative, 1.2);
  assert.equal(summarizeSamples(samples(80), workloads, repeats, base).primary.nativeParitySupported, false);
  assert.equal(summarizeSamples(samples().slice(1), workloads, repeats, base).primary.complete, false);
  for (const mutate of [
    value => { value[0].events--; },
    value => { value[0].wireBytes--; },
    value => { value[0].server.fatal = 'bad'; },
    value => { value[0].server.setup.bridge = 'other'; },
    value => { value.push(value[0]); }
  ]) {
    const invalid = samples(); mutate(invalid);
    assert.throws(() => summarizeSamples(invalid, workloads, repeats, base));
  }
});

test('portable control accepts an explicit frozen build and coalescing target', () => {
  const config = readConfiguration({ CASES: 'unicode', BEFORE_BUILD: 'benchmarks/fixtures/pre-unicode-optimization', COALESCE: '65536' });
  assert.equal(config.coalesce, 65536);
  assert.ok(config.beforeBuild.endsWith('/benchmarks/fixtures/pre-unicode-optimization'));
  assert.equal(readConfiguration({}).coalesce, 16384);
  assert.equal(readConfiguration({ COALESCE: '0' }).coalesce, 0);
  for (const value of ['-1', '1.5', '262145', 'NaN'])
    assert.throws(() => readConfiguration({ COALESCE: value }));
});
