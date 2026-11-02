// From any cwd: CASES=primary REPEATS=18 node /path/to/benchmarks/experiments/portable-performance.mjs
// OUTPUT is absolute or repository-relative; default benchmarks/results/portable-performance.json.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpus, platform, arch, release } from 'node:os';
import { measureTarget } from '../harness.mjs';
import { parseOptions, summarize } from '../core.mjs';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const variants = ['native', 'before-generic', 'after-generic'];
const available = {
  primary: {},
  single: { clients: 1, loaders: 1 },
  large: { bytes: 1024, events: 5000 },
  unicode: { payload: 'unicode' },
  multiline: { payload: 'multiline' }
};

export function readConfiguration(environment = process.env) {
  const names = (environment.CASES ?? 'primary,single,large,unicode,multiline').split(',');
  if (!names.length || new Set(names).size !== names.length || names.some(name => !Object.hasOwn(available, name)))
    throw new Error(`CASES must contain distinct workload names: ${Object.keys(available).join(',')}`);
  const override = environment.REPEATS === undefined ? undefined : Number(environment.REPEATS);
  if (override !== undefined && (!Number.isSafeInteger(override) || override < 1))
    throw new Error('REPEATS must be a positive integer');
  const workloads = Object.fromEntries(names.map(name => [name, { ...available[name] }]));
  const repeats = Object.fromEntries(names.map(name => [name, override ?? (name === 'primary' ? 18 : 6)]));
  const output = resolve(repository, environment.OUTPUT ?? 'benchmarks/results/portable-performance.json');
  if (!output.endsWith('.json')) throw new Error('OUTPUT must end in .json');
  const coalesce = Number(environment.COALESCE ?? 16384);
  if (!Number.isSafeInteger(coalesce) || coalesce < 0 || coalesce > 262144)
    throw new Error('COALESCE must be an integer from 0 through 262144');
  const beforeBuild = resolve(repository, environment.BEFORE_BUILD ?? 'benchmarks/fixtures/pre-portable-performance');
  return { workloads, repeats, output, coalesce, beforeBuild };
}

export function summarizeSamples(samples, workloads, repeats, base) {
  const summary = {};
  for (const [workload, overrides] of Object.entries(workloads)) {
    const expectedEvents = (overrides.clients ?? base.clients) * (overrides.events ?? base.events);
    const selected = samples.filter(sample => sample.workload === workload);
    const byVariant = Object.fromEntries(variants.map(variant => [variant, selected.filter(sample => sample.variant === variant)]));
    for (const [variant, values] of Object.entries(byVariant)) {
      const seen = new Set();
      for (const sample of values) {
        assert.ok(Number.isInteger(sample.repeat) && sample.repeat >= 1 && sample.repeat <= repeats[workload], `${workload}/${variant}: invalid repeat`);
        assert.ok(!seen.has(sample.repeat), `${workload}/${variant}: duplicated repeat`);
        seen.add(sample.repeat);
        assert.equal(sample.events, expectedEvents, `${workload}/${variant}: event count`);
        assert.equal(sample.server.fatal, null, `${workload}/${variant}: server failure`);
        assert.equal(sample.server.setup.bridge, 'direct', `${workload}/${variant}: generic bridge required`);
        assert.ok(Number.isFinite(sample.eventsPerSecond) && sample.eventsPerSecond > 0, `${workload}/${variant}: invalid throughput`);
      }
    }
    const wireBytes = [...new Set(selected.map(sample => sample.wireBytes))];
    assert.ok(wireBytes.length <= 1, `${workload}: unequal wire bytes between candidates or repeats`);
    const complete = variants.every(variant => byVariant[variant].length === repeats[workload]);
    const scores = Object.fromEntries(variants.map(variant => {
      const values = byVariant[variant];
      return [variant, values.length ? {
        measuredRepeats: values.length,
        eventsPerSecond: summarize(values.map(sample => sample.eventsPerSecond)),
        elapsedMs: summarize(values.map(sample => sample.elapsedMs)),
        serverCpuMs: summarize(values.map(sample => sample.server.cpuMs)),
        clientCpuMs: summarize(values.map(sample => sample.clientCpuMs))
      } : null];
    }));
    const paired = {};
    if (complete) {
      for (const reference of ['before-generic', 'native']) {
        const controls = new Map(byVariant[reference].map(sample => [sample.repeat, sample]));
        paired[reference] = {
          metric: 'after-generic throughput percent difference within the same repeat block',
          ...summarize(byVariant['after-generic'].map(sample => 100 * (sample.eventsPerSecond / controls.get(sample.repeat).eventsPerSecond - 1)))
        };
      }
    }
    summary[workload] = {
      complete, expectedRepeats: repeats[workload], expectedEventsPerTrial: expectedEvents,
      measuredEvents: selected.reduce((sum, sample) => sum + sample.events, 0),
      identicalWireBytes: wireBytes[0] ?? null,
      scores, paired,
      ratiosOfMedians: complete ? {
        afterVsBefore: scores['after-generic'].eventsPerSecond.median / scores['before-generic'].eventsPerSecond.median,
        afterVsNative: scores['after-generic'].eventsPerSecond.median / scores.native.eventsPerSecond.median
      } : null,
      nativeParitySupported: complete && paired.native.ci95 !== null && paired.native.ci95[0] >= 0
    };
  }
  return summary;
}

function markdown(report) {
  const f = value => value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  const lines = [
    '# Portable Web-stream producer control', '',
    `Status: **${report.status}**. Generated ${report.createdAt}. ${report.environment.node}, ${report.environment.cpu}, ${report.environment.os}/${report.environment.arch}.`, '',
    report.methodology, '',
    '| Workload | Repeats per candidate | Native median events/s | Before generic | After generic | After/before | After/native |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |'
  ];
  for (const [workload, summary] of Object.entries(report.summary)) {
    if (!summary.complete) { lines.push(`| ${workload} (incomplete) | ${summary.expectedRepeats} | — | — | — | — | — |`); continue; }
    const scores = summary.scores;
    lines.push(`| ${workload} | ${summary.expectedRepeats} | ${f(scores.native.eventsPerSecond.median)} | ${f(scores['before-generic'].eventsPerSecond.median)} | ${f(scores['after-generic'].eventsPerSecond.median)} | ${f(100 * (summary.ratiosOfMedians.afterVsBefore - 1))}% | ${f(100 * summary.ratiosOfMedians.afterVsNative)}% |`);
  }
  lines.push('', 'Paired mean throughput differences (after versus reference), with Student-t 95% intervals:', '',
    '| Workload | Versus before generic | Versus native | Native parity supported¹ |', '| --- | ---: | ---: | --- |');
  const interval = score => `${f(score.mean)}% [${score.ci95 ? score.ci95.map(value => `${f(value)}%`).join(', ') : 'insufficient repeats'}]`;
  for (const [workload, summary] of Object.entries(report.summary)) {
    if (summary.complete)
      lines.push(`| ${workload} | ${interval(summary.paired['before-generic'])} | ${interval(summary.paired.native)} | ${summary.nativeParitySupported ? 'Yes' : 'No'} |`);
  }
  lines.push('', '¹ Defined narrowly as the lower bound of the paired mean after/native throughput difference being at least zero. This repeat-level criterion does not establish equivalence across machines or production workloads.', '',
    `Validated measured events: ${f(report.samples.reduce((sum, sample) => sum + sample.events, 0))}. Errors: ${report.errors.length}. No retries or sample exclusions. A failed trial invalidates this control.`, '',
    'Default primary workload: sixteen streams, four loaders, 20,000 events per stream, 128-byte ASCII payload, batch sixteen. Single uses one stream/loader; large uses 1 KiB payloads and 5,000 events per stream; Unicode and multiline retain the primary layout. All use a fresh server and loader pool per trial, one full warmup, public batch API and the same explicit coalescing target for both MinkSSE versions.',
    `Coalescing target: ${f(Number(report.base.coalesce))} bytes. Before build: ${report.builds['before-generic']}.`, '',
    'The native baseline is unchanged Node HTTP SSE. Both MinkSSE builds use the same generic Web reader bridge; no private adapter, native producer capability, custom counter or alternate scorer is used. Native has fewer validation/queue semantics than MinkSSE. These are finite loopback measurements on a shared machine, not browser or production capacity results.', '',
    'JSON contains every raw sample, CPU measurements, workload settings, source hashes and paired statistics. Source hashes are checked again after measurement; changing inputs invalidate the report.', '');
  if (report.errors.length) lines.push('Failure details are retained in the JSON report.', '');
  return lines.join('\n');
}

async function run() {
  const configuration = readConfiguration();
  const base = parseOptions(['--targets=native,minksse', '--bridge=direct', '--loaders=4', '--clients=16', '--events=20000', '--warmup=1', '--repeats=1', `--coalesce=${configuration.coalesce}`]);
  const builds = {
    'before-generic': configuration.beforeBuild,
    'after-generic': fileURLToPath(new URL('../../dist/', import.meta.url))
  };
  const inputs = {
    beforeServer: resolve(builds['before-generic'], 'server.js'),
    afterServer: resolve(builds['after-generic'], 'server.js'),
    dependencyLock: resolve(repository, 'benchmarks/package-lock.json'),
    ...Object.fromEntries(['harness.mjs', 'server.mjs', 'core.mjs', 'load-workers.mjs', 'load-worker.mjs', 'experiments/portable-performance.mjs']
      .map(file => [file, resolve(repository, 'benchmarks', file)]))
  };
  const hashInputs = async () => Object.fromEntries(await Promise.all(Object.entries(inputs).map(async ([name, path]) =>
    [name, createHash('sha256').update(await readFile(path)).digest('hex')])));
  const hashes = await hashInputs();
  const report = {
    schemaVersion: 1, status: 'running', createdAt: new Date().toISOString(),
    environment: { node: process.version, v8: process.versions.v8, cpu: cpus()[0].model, os: platform(), arch: arch(), release: release() },
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(),
    dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: repository, encoding: 'utf8' }).trim()),
    methodology: 'Fixed native/before-generic/after-generic candidates rotate within each repeat, and workload order rotates between repeat blocks. Current unmodified benchmark harness/native target/scoring; generic direct Web bridge. Fresh server and loader pool; one complete warmup. Exact HTTP status, event name, ID, payload, sequence, count and wire-byte equivalence checks. Sequential trials, no automatic retries or exclusions. Throughput includes request/socket delivery and independent client validation; startup and warmup are excluded.',
    base, workloads: configuration.workloads, repeats: configuration.repeats,
    builds, hashes, samples: [], errors: [], summary: {}
  };
  const save = async (validate = true) => {
    if (validate) report.summary = summarizeSamples(report.samples, configuration.workloads, configuration.repeats, base);
    await mkdir(dirname(configuration.output), { recursive: true });
    await writeFile(configuration.output, JSON.stringify(report, null, 2) + '\n');
    await writeFile(configuration.output.replace(/\.json$/, '.md'), markdown(report));
  };
  try {
    await save();
    const cases = Object.keys(configuration.workloads);
    const maxRepeats = Math.max(...Object.values(configuration.repeats));
    for (let repeat = 0; repeat < maxRepeats; repeat++) {
      for (const workload of cases.map((_, index) => cases[(index + repeat) % cases.length])) {
        if (repeat >= configuration.repeats[workload]) continue;
        for (const variant of variants.map((_, index) => variants[(index + repeat) % variants.length])) {
          const options = { ...base, ...configuration.workloads[workload], minkbuild: builds[variant] ?? '' };
          process.stderr.write(`${workload} ${repeat + 1}/${configuration.repeats[workload]} ${variant} ... `);
          try {
            const sample = await measureTarget(variant === 'native' ? 'native' : 'minksse', options);
            report.samples.push({ workload, variant, repeat: repeat + 1, ...sample });
            process.stderr.write(`${Math.round(sample.eventsPerSecond).toLocaleString()} events/s\n`);
          } catch (error) {
            report.errors.push({ workload, variant, repeat: repeat + 1, error: String(error?.stack ?? error) });
            throw error;
          }
          await save();
        }
      }
    }
    assert.deepEqual(await hashInputs(), hashes, 'Benchmark inputs changed during measurement');
    report.status = 'complete';
    await save();
    assert.ok(Object.values(report.summary).every(summary => summary.complete), 'Incomplete benchmark samples');
    console.log(markdown(report));
  } catch (error) {
    report.status = 'failed';
    if (!report.errors.length) report.errors.push({ error: String(error?.stack ?? error) });
    await save(false);
    throw error;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  await run();
