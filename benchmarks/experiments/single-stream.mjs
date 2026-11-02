// npm run build && node --conditions=svelte benchmarks/experiments/single-stream.mjs
// CASES=single,primary REPEATS=9 OUTPUT=results/single-stream-selection.json ...
import { measureTarget } from '../harness.mjs';
import { parseOptions, summarize } from '../core.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { cpus, platform, arch, release } from 'node:os';

const root = fileURLToPath(new URL('../', import.meta.url));
const base = parseOptions(['--targets=native,minksse', '--loaders=4', '--clients=16', '--events=20000']);
const variants = {
  original: `${root}/fixtures/four-loader-before`,
  previous: `${root}/fixtures/pre-single-stream-pass`,
  current: fileURLToPath(new URL('../../dist/', import.meta.url)),
  native: null
};
if (process.env.EXTRA_BUILD) variants.extra = process.env.EXTRA_BUILD;
const available = {
  single: { clients: 1, loaders: 1 },
  long: { clients: 1, loaders: 1, events: 100000 },
  primary: {}, unicode: { payload: 'unicode' }, multiline: { payload: 'multiline' },
  large: { bytes: 1024, events: 5000 }, sparse: { batch: 1, interval: 1, events: 200 },
  scalar: { minkapi: 'emit' }, web: { bridge: 'direct' },
  uncoalesced: { clients: 1, loaders: 1, coalesce: 0 },
  defaults: { clients: 1, loaders: 1, coalesce: 0, minkapi: 'emit' }
};
const repeats = Number(process.env.REPEATS ?? 7);
if (!Number.isSafeInteger(repeats) || repeats < 1) throw new Error('REPEATS must be a positive integer');
const workloads = Object.fromEntries((process.env.CASES ?? 'single,long,primary,unicode,multiline,large,sparse').split(',').map(name => {
  if (!Object.hasOwn(available, name)) throw new Error(`Unknown workload ${name}`);
  return [name, available[name]];
}));
const report = {
  createdAt: new Date().toISOString(), node: process.version,
  environment: { cpu: cpus()[0].model, os: platform(), arch: arch(), release: release() },
  method: 'Rotated candidate order within each repeat, rotated workload order by repeat. Fresh server and loader pool per trial; one full warmup. Exact HTTP/status/payload/ID/order/count validation. Errors retained and invalidate a workload result; no automatic retries.',
  base, repeats, workloads, hashes: {}, samples: [], errors: [], summary: {}
};
const hash = async path => createHash('sha256').update(await readFile(path)).digest('hex');
for (const [variant, directory] of Object.entries(variants)) {
  if (!directory) continue;
  report.hashes[variant] = {};
  for (const file of ['server.js', 'node.js', 'producer-capabilities.js']) {
    try { report.hashes[variant][file] = await hash(`${directory}/${file}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
for (const file of ['harness.mjs', 'server.mjs', 'core.mjs', 'load-workers.mjs', 'load-worker.mjs', 'experiments/single-stream.mjs'])
  report.hashes[file] = await hash(`${root}/${file}`);
function summarizeReport() {
  for (const [workload, overrides] of Object.entries(workloads)) {
    const expectedEvents = (overrides.clients ?? base.clients) * (overrides.events ?? base.events);
    const summaries = Object.fromEntries(Object.keys(variants).map(variant => {
      const samples = report.samples.filter(sample => sample.workload === workload && sample.variant === variant);
      if (!samples.length) return [variant, null];
      for (const sample of samples) if (sample.events !== expectedEvents) throw new Error('Unexpected total event count');
      return [variant, {
        valid: samples.length === repeats && !report.errors.some(error => error.workload === workload && error.variant === variant),
        eventsPerSecond: summarize(samples.map(sample => sample.eventsPerSecond)),
        cpuMs: summarize(samples.map(sample => sample.server.cpuMs)),
        wireBytes: [...new Set(samples.map(sample => sample.wireBytes))]
      }];
    }));
    const wireBytes = new Set(Object.values(summaries).filter(Boolean).flatMap(summary => summary.wireBytes));
    if (wireBytes.size > 1) throw new Error(`${workload}: candidates delivered different wire byte counts`);
    report.summary[workload] = summaries;
  }
}
const names = Object.keys(variants), cases = Object.keys(workloads);
for (let repeat = 0; repeat < repeats; repeat++) {
  for (const workload of cases.map((_, index) => cases[(index + repeat) % cases.length])) {
    for (const variant of names.map((_, index) => names[(index + repeat) % names.length])) {
      const options = { ...base, minkapi: 'batch', ...workloads[workload], minkbuild: variants[variant] ?? '' };
      try {
        const sample = await measureTarget(variant === 'native' ? 'native' : 'minksse', options);
        report.samples.push({ workload, variant, repeat: repeat + 1, ...sample });
        console.log(workload, repeat + 1, variant, Math.round(sample.eventsPerSecond), sample.server.cpuMs);
      } catch (error) {
        report.errors.push({ workload, variant, repeat: repeat + 1, error: String(error?.stack ?? error) });
        console.error(workload, repeat + 1, variant, error);
      }
      summarizeReport();
      await writeFile(`${root}/${process.env.OUTPUT ?? 'results/single-stream-selection.json'}`, JSON.stringify(report, null, 2) + '\n');
    }
  }
}
