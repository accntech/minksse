import { test } from 'node:test';
import assert from 'node:assert/strict';
const sweep = await import('../experiments/coalescing-sweep.mjs').catch(() => ({}));

test('coalescing sweep keeps settings explicit and rejects ambiguous configuration', () => {
  assert.equal(typeof sweep.readSweepConfiguration, 'function');
  const config = sweep.readSweepConfiguration({});
  assert.deepEqual(config.settings, [16384, 32768, 65536]);
  assert.equal(config.repeats, 6);
  assert.equal(config.workloads.single.clients, 1);
  assert.equal(config.workloads.large.bytes, 1024);
  assert.equal(config.workloads.unicode.payload, 'unicode');
  for (const env of [{ CASES: 'unknown' }, { CASES: 'large,large' }, { REPEATS: '0' }, { REPEATS: '1.5' }, { OUTPUT: 'out.txt' }])
    assert.throws(() => sweep.readSweepConfiguration(env));
});

function validSamples() {
  return Array.from({ length: 3 }, (_, repeat) => [16384, 32768, 65536].map(coalesce => ({
    workload: 'primary', coalesce, repeat: repeat + 1, events: 320000, wireBytes: 50000000,
    eventsPerSecond: coalesce === 16384 ? 100 : 120, elapsedMs: 100, clientCpuMs: 20, firstEventMs: Array(16).fill(1),
    server: { fatal: null, cpuMs: 10, rssAfterBytes: 52428800, processPeakRssBytes: 52428800, setup: { bridge: 'direct', coalesceBytes: coalesce, minkApi: 'batch' } }
  }))).flat();
}

test('coalescing sweep requires complete validated controls and preserves inconclusive outcomes', () => {
  assert.equal(typeof sweep.summarizeSweep, 'function');
  const config = { workloads: { primary: {} }, settings: [16384, 32768, 65536], repeats: 3 };
  const base = { clients: 16, events: 20000 };
  const report = sweep.summarizeSweep(validSamples(), config, base).primary;
  assert.equal(report.complete, true);
  assert.equal(report.measuredEvents, 2880000);
  assert.equal(report.settings['32768'].ratioOfMediansVs16KiB, 1.2);
  assert.ok(report.settings['32768'].pairedVs16KiB.ci95[0] > 0);
  assert.equal(sweep.summarizeSweep(validSamples().slice(1), config, base).primary.complete, false);
  for (const mutate of [
    rows => { rows.push(rows[0]); },
    rows => { rows[0].events--; },
    rows => { rows[0].wireBytes--; },
    rows => { rows[0].server.fatal = 'failure'; },
    rows => { rows[0].server.setup.bridge = 'other'; },
    rows => { rows[0].server.setup.coalesceBytes = 7; },
    rows => { rows[0].coalesce = 7; }
  ]) {
    const rows = validSamples(); mutate(rows);
    assert.throws(() => sweep.summarizeSweep(rows, config, base));
  }
});
