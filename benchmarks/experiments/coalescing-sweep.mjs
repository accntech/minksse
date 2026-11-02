// From any cwd: OUTPUT=benchmarks/results/coalescing-sweep.json node /path/to/this/file
// Settings are explicit experiments; the package default and benchmark default are unchanged.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { cpus, platform, arch, release } from 'node:os';
import { measureTarget } from '../harness.mjs';
import { parseOptions, summarize, percentile, createPayload, serializeData, createValidator } from '../core.mjs';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const settings = [16384, 32768, 65536];
const available = {
  primary: {}, single: { clients: 1, loaders: 1 },
  large: { bytes: 1024, events: 5000 }, unicode: { payload: 'unicode' }, multiline: { payload: 'multiline' }
};

export function readSweepConfiguration(environment = process.env) {
  const names = (environment.CASES ?? 'primary,single,large,unicode,multiline').split(',');
  if (!names.length || new Set(names).size !== names.length || names.some(name => !Object.hasOwn(available, name)))
    throw new Error(`CASES must contain distinct workload names: ${Object.keys(available).join(',')}`);
  const repeats = Number(environment.REPEATS ?? 6);
  if (!Number.isSafeInteger(repeats) || repeats < 1) throw new Error('REPEATS must be a positive integer');
  const output = resolve(repository, environment.OUTPUT ?? 'benchmarks/results/coalescing-sweep.json');
  if (!output.endsWith('.json')) throw new Error('OUTPUT must end in .json');
  return { buildDirectory: resolve(repository, environment.BUILD ?? 'dist'), settings: [...settings], workloads: Object.fromEntries(names.map(name => [name, { ...available[name] }])), repeats, output };
}

export function summarizeSweep(samples, configuration, base) {
  assert.ok(samples.every(sample => Object.hasOwn(configuration.workloads, sample.workload)), 'Unknown workload sample');
  const summary = {};
  for (const [workload, overrides] of Object.entries(configuration.workloads)) {
    const selected = samples.filter(sample => sample.workload === workload);
    const expectedEvents = (overrides.events ?? base.events) * (overrides.clients ?? base.clients);
    assert.ok(selected.every(sample => configuration.settings.includes(sample.coalesce)), `${workload}: unknown setting`);
    const groups = Object.fromEntries(configuration.settings.map(coalesce => [coalesce, selected.filter(sample => sample.coalesce === coalesce)]));
    for (const [coalesce, rows] of Object.entries(groups)) {
      const seen = new Set();
      for (const sample of rows) {
        assert.ok(Number.isInteger(sample.repeat) && sample.repeat >= 1 && sample.repeat <= configuration.repeats, 'Invalid repeat');
        assert.ok(!seen.has(sample.repeat), 'Duplicate repeat'); seen.add(sample.repeat);
        assert.equal(sample.events, expectedEvents, `${workload}: event count`);
        assert.equal(sample.server.fatal, null, `${workload}: server error`);
        assert.equal(sample.server.setup.bridge, 'direct', 'Generic Web bridge required');
        assert.equal(sample.server.setup.minkApi, 'batch', 'Public batch API required');
        assert.equal(sample.server.setup.coalesceBytes, Number(coalesce), 'Resolved coalescing setting differs');
        assert.ok(Number.isFinite(sample.eventsPerSecond) && sample.eventsPerSecond > 0, 'Invalid throughput');
      }
    }
    const wireBytes = [...new Set(selected.map(sample => sample.wireBytes))];
    assert.ok(wireBytes.length <= 1, `${workload}: unequal wire bytes`);
    const complete = configuration.settings.every(coalesce => groups[coalesce].length === configuration.repeats);
    const baseline = new Map(groups[16384].map(sample => [sample.repeat, sample]));
    const scores = Object.fromEntries(configuration.settings.map(coalesce => {
      const rows = groups[coalesce];
      if (!rows.length) return [coalesce, null];
      const result = {
        measuredRepeats: rows.length,
        eventsPerSecond: summarize(rows.map(sample => sample.eventsPerSecond)),
        elapsedMs: summarize(rows.map(sample => sample.elapsedMs)),
        serverCpuMs: summarize(rows.map(sample => sample.server.cpuMs)),
        clientCpuMs: summarize(rows.map(sample => sample.clientCpuMs)),
        firstEventP95Ms: summarize(rows.map(sample => percentile(sample.firstEventMs, 0.95))),
        rssAfterMiB: summarize(rows.map(sample => sample.server.rssAfterBytes / 1048576)),
        processPeakRssMiB: summarize(rows.map(sample => sample.server.processPeakRssBytes / 1048576))
      };
      if (complete) {
        result.ratioOfMediansVs16KiB = result.eventsPerSecond.median / summarize(groups[16384].map(sample => sample.eventsPerSecond)).median;
        result.pairedVs16KiB = summarize(rows.map(sample => 100 * (sample.eventsPerSecond / baseline.get(sample.repeat).eventsPerSecond - 1)));
        result.pairedFirstEventP95MsVs16KiB = summarize(rows.map(sample => percentile(sample.firstEventMs, 0.95) - percentile(baseline.get(sample.repeat).firstEventMs, 0.95)));
        result.pairedRssAfterMiBVs16KiB = summarize(rows.map(sample => (sample.server.rssAfterBytes - baseline.get(sample.repeat).server.rssAfterBytes) / 1048576));
      }
      return [coalesce, result];
    }));
    summary[workload] = {
      complete, expectedRepeats: configuration.repeats, expectedEventsPerTrial: expectedEvents,
      measuredEvents: selected.reduce((sum, sample) => sum + sample.events, 0),
      identicalWireBytes: wireBytes[0] ?? null, settings: scores,
      observedBestMedian: complete ? configuration.settings.reduce((best, value) => scores[value].eventsPerSecond.median > scores[best].eventsPerSecond.median ? value : best, 16384) : null
    };
  }
  return summary;
}

// Executed in a separate process before timing: instrumentation never enters the
// measured server, load generator, scorer or parent benchmark process.
async function diagnostic() {
  const { produce } = await import(pathToFileURL(resolve(readSweepConfiguration().buildDirectory, 'server.js')).href);
  const result = [];
  for (const [workload, overrides] of Object.entries(available)) {
    if (workload === 'single') continue; // Same initial batch geometry as primary.
    const bytes = overrides.bytes ?? 128;
    const payload = createPayload(bytes, overrides.payload ?? 'ascii');
    const values = Array.from({ length: 16 }, (_, index) => serializeData(index, payload, overrides.payload ?? 'ascii'));
    const normalizedWire = values.map((value, index) => `id: ${index + 1}\nevent: message\ndata: ${value.replace(/\r\n|\r|\n/g, '\ndata: ')}\n\n`).join('');
    for (const coalesce of settings) {
      const counts = { encodeCalls: 0, encodeIntoCalls: 0, incompleteEncodeInto: 0, encodeIntoDestinationBytes: 0, encodedInputUnits: 0 };
      const Original = globalThis.TextEncoder;
      class ObservedEncoder extends Original {
        encode(value = '') { counts.encodeCalls++; counts.encodedInputUnits += value.length; return super.encode(value); }
        encodeInto(value, destination) {
          counts.encodeIntoCalls++; counts.encodedInputUnits += value.length; counts.encodeIntoDestinationBytes += destination.byteLength;
          const encoded = super.encodeInto(value, destination);
          if (encoded.read !== value.length) counts.incompleteEncodeInto++;
          return encoded;
        }
      }
      let controls;
      let response;
      try {
        globalThis.TextEncoder = ObservedEncoder;
        response = produce(value => { controls = value; }, { coalesceBytes: coalesce, ping: 2147483647 });
      } finally { globalThis.TextEncoder = Original; }
      const validator = createValidator(16, payload);
      const chunks = [];
      try {
        assert.equal(controls.emitBatch('message', values).error, false);
        controls.lock.set(false);
        for await (const chunk of response.body) { chunks.push(chunk.byteLength); validator.push(chunk); }
        assert.equal(validator.finish(), 16);
      } finally { await response.body?.cancel().catch(() => {}); }
      result.push({ workload, coalesceBytes: coalesce, events: 16, bytes, framedBytes: new Original().encode(normalizedWire).byteLength,
        conservativeUtf8Bound: normalizedWire.length * 3, chunkBytes: chunks, ...counts });
    }
  }
  return result;
}

function markdown(report) {
  const f = value => value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  const lines = ['# Explicit coalescing sweep', '', `Status: **${report.status}**. ${report.environment.node}, ${report.environment.cpu}, ${report.environment.os}/${report.environment.arch}.`, '',
    report.methodology, '', '| Workload | Setting | Median events/s | Median server CPU ms | Median first-event p95 ms | Median RSS after MiB | Paired mean throughput vs 16 KiB (95% CI) |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: |'];
  for (const [workload, summary] of Object.entries(report.summary)) {
    if (!summary.complete) { lines.push(`| ${workload} (incomplete) | — | — | — | — | — | — |`); continue; }
    for (const coalesce of report.configuration.settings) {
      const score = summary.settings[coalesce];
      const paired = score.pairedVs16KiB;
      const interval = paired.ci95 ? paired.ci95.map(value => `${f(value)}%`).join(', ') : 'insufficient repeats';
      lines.push(`| ${workload} | ${coalesce / 1024} KiB | ${f(score.eventsPerSecond.median)} | ${f(score.serverCpuMs.median)} | ${f(score.firstEventP95Ms.median)} | ${f(score.rssAfterMiB.median)} | ${f(paired.mean)}% [${interval}] |`);
    }
  }
  lines.push('', '| Workload | Setting | Paired mean first-event p95 delta ms (95% CI) | Paired mean RSS-after delta MiB (95% CI) |', '| --- | ---: | ---: | ---: |');
  const delta = score => `${f(score.mean)} [${score.ci95 ? score.ci95.map(f).join(', ') : 'insufficient repeats'}]`;
  for (const [workload, summary] of Object.entries(report.summary)) {
    if (!summary.complete) continue;
    for (const coalesce of report.configuration.settings) {
      const score = summary.settings[coalesce];
      lines.push(`| ${workload} | ${coalesce / 1024} KiB | ${delta(score.pairedFirstEventP95MsVs16KiB)} | ${delta(score.pairedRssAfterMiBVs16KiB)} |`);
    }
  }
  lines.push('', `Validated measured events: ${f(report.samples.reduce((sum, sample) => sum + sample.events, 0))}; errors: ${report.errors.length}. No retries or exclusions.`, '',
    'These are explicit settings, not default changes. Public coalescing remains off by default; the shared comparison harness retains its 16 KiB setting. A larger target can alter chunk count and fast-path eligibility simultaneously. Any proposed setting must retain its 16 KiB control in subsequent acceptance measurements.', '',
    'The separately isolated untimed diagnostic records initial 16-event batch geometry, emitted chunk sizes, encode/encodeInto calls and incomplete encodeInto attempts. It is not throughput evidence and does not instrument timed server/scorer processes.', '',
    'First-event p95 is request-to-first-validated-event latency across concurrent clients, not per-event latency. RSS-after and process peak RSS include imports/warmup; they do not establish per-connection allocation or sustained slow-reader retention.', '',
    'Finite loopback results on one Node host do not establish browser/runtime portability, long-lived slow-consumer memory behavior or a universally optimal target. JSON retains every sample, paired intervals, exact settings, diagnostics and before/after source hashes.', '');
  return lines.join('\n');
}

async function runSweep() {
  const configuration = readSweepConfiguration();
  const base = parseOptions(['--targets=minksse', '--bridge=direct', '--loaders=4', '--clients=16', '--events=20000', '--warmup=1', '--repeats=1']);
  const inputs = {
    producerSource: 'src/server.js', selectedProducer: resolve(configuration.buildDirectory, 'server.js'), frozenBeforeUnicode: 'benchmarks/fixtures/pre-unicode-optimization/server.js',
    dependencyLock: 'benchmarks/package-lock.json',
    ...Object.fromEntries(['harness.mjs', 'server.mjs', 'core.mjs', 'load-workers.mjs', 'load-worker.mjs', 'experiments/coalescing-sweep.mjs'].map(file => [file, `benchmarks/${file}`]))
  };
  const hashInputs = async () => Object.fromEntries(await Promise.all(Object.entries(inputs).map(async ([name, path]) =>
    [name, createHash('sha256').update(await readFile(resolve(repository, path))).digest('hex')])));
  const hashes = await hashInputs();
  if (configuration.buildDirectory === resolve(repository, 'dist'))
    assert.equal(hashes.producerSource, hashes.frozenBeforeUnicode, 'For a baseline sweep, current source must equal the frozen snapshot; use BUILD=benchmarks/fixtures/pre-unicode-optimization to reproduce the baseline after source changes');
  const report = {
    schemaVersion: 1, status: 'running', createdAt: new Date().toISOString(),
    environment: { node: process.version, v8: process.versions.v8, cpu: cpus()[0].model, os: platform(), arch: arch(), release: release() },
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(),
    dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: repository, encoding: 'utf8' }).trim()),
    methodology: 'Same frozen baseline producer at explicit 16/32/64 KiB targets, rotated setting order within repeat and workload order between repeats. Six repeats per setting by default. Fresh server and loader pool per trial, one complete warmup, unchanged generic Web reader/scorer/native implementation, public emitBatch API. Strict CR/LF/CRLF-aware HTTP/status/name/ID/count/order/payload validation and equal wire bytes. No native target is measured in this sweep; no native-parity conclusion follows.',
    configuration, base, inputs, hashes, diagnostic: null, samples: [], errors: [], summary: {}
  };
  const save = async (validate = true) => {
    if (validate) report.summary = summarizeSweep(report.samples, configuration, base);
    await mkdir(dirname(configuration.output), { recursive: true });
    await writeFile(configuration.output, JSON.stringify(report, null, 2) + '\n');
    await writeFile(configuration.output.replace(/\.json$/, '.md'), markdown(report));
  };
  try {
    await save();
    const { stdout } = await promisify(execFile)(process.execPath, [fileURLToPath(import.meta.url), '--diagnostic']);
    report.diagnostic = JSON.parse(stdout);
    const names = Object.keys(configuration.workloads);
    for (let repeat = 0; repeat < configuration.repeats; repeat++) {
      for (const workload of names.map((_, index) => names[(index + repeat) % names.length])) {
        for (const coalesce of configuration.settings.map((_, index) => configuration.settings[(index + repeat) % configuration.settings.length])) {
          process.stderr.write(`${workload} ${repeat + 1}/${configuration.repeats} ${coalesce / 1024} KiB ... `);
          try {
            const sample = await measureTarget('minksse', { ...base, ...configuration.workloads[workload], coalesce, minkbuild: configuration.buildDirectory });
            report.samples.push({ workload, coalesce, repeat: repeat + 1, ...sample });
            process.stderr.write(`${Math.round(sample.eventsPerSecond).toLocaleString()} events/s\n`);
          } catch (error) {
            report.errors.push({ workload, coalesce, repeat: repeat + 1, error: String(error?.stack ?? error) }); throw error;
          }
          await save();
        }
      }
    }
    assert.deepEqual(await hashInputs(), hashes, 'Sweep inputs changed during measurement');
    report.status = 'complete';
    await save();
    assert.ok(Object.values(report.summary).every(summary => summary.complete), 'Incomplete sweep');
    console.log(markdown(report));
  } catch (error) {
    report.status = 'failed';
    if (!report.errors.length) report.errors.push({ error: String(error?.stack ?? error) });
    await save(false); throw error;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv[2] === '--diagnostic') console.log(JSON.stringify(await diagnostic()));
  else await runSweep();
}
