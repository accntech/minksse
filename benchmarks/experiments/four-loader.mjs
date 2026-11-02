// Run after npm run build: node --conditions=svelte benchmarks/experiments/four-loader.mjs
import { measureTarget } from '../harness.mjs';
import { parseOptions, summarize } from '../core.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { cpus, platform, arch, release } from 'node:os';

const root = fileURLToPath(new URL('../', import.meta.url));
const base = parseOptions(['--targets=native,minksse', '--loaders=4', '--clients=16', '--events=20000', '--repeats=5']);
const variants = {
  before: `${root}/fixtures/four-loader-before`,
  after: fileURLToPath(new URL('../../dist/', import.meta.url)),
  native: null
};
const workloads = {
  primary: {}, unicode: { payload: 'unicode' }, multiline: { payload: 'multiline' },
  large: { bytes: 1024, events: 5000 }, single: { clients: 1, loaders: 1 },
  sparse: { batch: 1, interval: 1, events: 200 }
};
const report = {
  createdAt: new Date().toISOString(), node: process.version,
  environment: { cpu: cpus()[0].model, os: platform(), arch: arch(), release: release() },
  method: 'Seven rotated repeats for primary, five for each held-out workload; fresh server and persistent loader pool per trial, one full warmup. Same optimized batch16 configuration except sparse batch1 interval1ms. Independent IDs/order/count/payload/status validation; wire bytes reported for equivalence checks.',
  base, workloads, hashes: {}, samples: [], summary: {}
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
for (const file of ['harness.mjs', 'server.mjs', 'core.mjs', 'load-workers.mjs', 'load-worker.mjs'])
  report.hashes[file] = await hash(`${root}/${file}`);

for (const [workload, overrides] of Object.entries(workloads)) {
  for (let repeat = 0; repeat < (workload === 'primary' ? 7 : 5); repeat++) {
    const names = Object.keys(variants);
    const order = names.map((_, index) => names[(index + repeat) % names.length]);
    for (const variant of order) {
      const options = { ...base, ...overrides, minkbuild: variants[variant] ?? '', minkapi: 'batch' };
      const sample = await measureTarget(variant === 'native' ? 'native' : 'minksse', options);
      report.samples.push({ workload, variant, repeat: repeat + 1, ...sample });
      console.log(workload, repeat + 1, variant, Math.round(sample.eventsPerSecond), sample.server.cpuMs);
    }
  }
  report.summary[workload] = Object.fromEntries(Object.keys(variants).map(variant => {
    const samples = report.samples.filter(sample => sample.workload === workload && sample.variant === variant);
    return [variant, {
      eventsPerSecond: summarize(samples.map(sample => sample.eventsPerSecond)),
      cpuMs: summarize(samples.map(sample => sample.server.cpuMs)),
      wireBytes: [...new Set(samples.map(sample => sample.wireBytes))]
    }];
  }));
  const wireBytes = new Set(Object.values(report.summary[workload]).flatMap(summary => summary.wireBytes));
  if (wireBytes.size !== 1) throw new Error(`${workload}: candidates delivered different wire byte counts`);
  await writeFile(`${root}/results/four-loader-final.json`, JSON.stringify(report, null, 2) + '\n');
}
