import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { cpus, availableParallelism, platform, arch, release } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { parseOptions, summarize, percentile } from './core.mjs';
import { measureTarget } from './harness.mjs';

const options = parseOptions(process.argv.slice(2));
const packageNames = ['hono', 'fastify', '@fastify/sse', 'better-sse', 'sveltekit-sse', 'svelte', '@sveltejs/kit', 'esbuild'];
const versions = Object.fromEntries(await Promise.all(packageNames.map(async name => {
  const json = JSON.parse(await readFile(new URL(`./node_modules/${name}/package.json`, import.meta.url)));
  return [name, json.version];
})));
const hashFile = async url => createHash('sha256').update(await readFile(url)).digest('hex');
const root = resolve(import.meta.dirname, '..');
const report = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  environment: { node: process.version, v8: process.versions.v8, os: platform(), osRelease: release(), arch: arch(),
    cpu: cpus()[0].model, logicalCpus: cpus().length, availableParallelism: availableParallelism() },
  versions,
  source: {
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()),
    localServerSha256: await hashFile(new URL('../dist/server.js', import.meta.url)),
    lockSha256: await hashFile(new URL('./package-lock.json', import.meta.url))
  },
  options,
  methodology: {
    transport: 'HTTP/1.1 POST over 127.0.0.1, Node fetch client in parent, isolated fresh server process per repeat',
    payload: 'Pre-serialized JSON {sequence,payload}, payload is bytes ASCII x characters, named message events, IDs 1..events',
    schedule: 'All candidates yield each batch; native/Hono/Fastify also await backpressure where their APIs expose it',
    order: 'Rotated candidate order by repeat; sequential measured trials',
    warmup: 'Each fresh server gets warmup full workload passes before its one measured pass',
    firstEvent: 'Request start until first chunk containing a complete validated event is processed; not per-event latency',
    memory: 'Server RSS before/after measured workload; processPeakRssBytes includes imports and warmup',
    cpu: 'Server CPU user+system delta covering measured workload and stats IPC; excludes startup and warmup',
    scope: 'Server framing/HTTP delivery only. No package clients, Kit routing/build, browser UI, broadcast, replay, slow consumers or production network'
  },
  samples: [],
  summary: {}
};

// Rotate rather than measuring every repeat of one candidate consecutively.
for (let repeat = 0; repeat < options.repeats; repeat++) {
  const order = options.targets.map((_, index) => options.targets[(index + repeat) % options.targets.length]);
  for (const target of order) {
    process.stderr.write(`${target} repeat ${repeat + 1}/${options.repeats} ... `);
    const sample = await measureTarget(target, options);
    report.samples.push({ target, repeat: repeat + 1, ...sample });
    process.stderr.write(`${Math.round(sample.eventsPerSecond).toLocaleString()} events/s\n`);
  }
}

for (const target of options.targets) {
  const samples = report.samples.filter(sample => sample.target === target);
  report.summary[target] = {
    eventsPerSecond: summarize(samples.map(sample => sample.eventsPerSecond)),
    elapsedMs: summarize(samples.map(sample => sample.elapsedMs)),
    firstEventMedianMs: summarize(samples.map(sample => percentile(sample.firstEventMs, 0.5))),
    firstEventP95Ms: summarize(samples.map(sample => percentile(sample.firstEventMs, 0.95))),
    serverCpuMs: summarize(samples.map(sample => sample.server.cpuMs)),
    serverRssAfterMiB: summarize(samples.map(sample => sample.server.rssAfterBytes / 1048576)),
    serverProcessPeakRssMiB: summarize(samples.map(sample => sample.server.processPeakRssBytes / 1048576))
  };
}

const f = value => value.toLocaleString('en-US', { maximumFractionDigits: 2 });
const lines = [
  '# SSE HTTP benchmark results', '',
  `Generated ${report.createdAt}. ${options.clients} concurrent clients × ${options.events} events; ${options.bytes}-byte ASCII payload per event, batch ${options.batch}, interval ${options.interval} ms.`, '',
  `${options.repeats} measured repeats, ${options.warmup} full warmup pass(es) per fresh server. ${report.environment.node}, ${report.environment.cpu}, ${report.environment.os}/${report.environment.arch}.`, '',
  '| Candidate | Median events/s | Mean events/s (95% CI) | Median completion ms | Median first event ms | Median per-trial p95 first event ms | Median server CPU ms | Median RSS after MiB |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'
];
for (const target of options.targets) {
  const s = report.summary[target];
  const ci = s.eventsPerSecond.ci95;
  lines.push(`| ${target} | ${f(s.eventsPerSecond.median)} | ${f(s.eventsPerSecond.mean)} (${ci ? ci.map(f).join('–') : 'insufficient repeats'}) | ${f(s.elapsedMs.median)} | ${f(s.firstEventMedianMs.median)} | ${f(s.firstEventP95Ms.median)} | ${f(s.serverCpuMs.median)} | ${f(s.serverRssAfterMiB.median)} |`);
}
lines.push('', 'All recorded streams passed exact event-count, order, payload and HTTP validation. Any error aborts the run without writing a successful report.', '',
  'Throughput includes connection/request overhead, socket delivery and independent client validation. Both processes share this machine; client CPU and scheduler contention can cap results. Small samples and wide confidence intervals do not establish a reliable ranking. The Student-t interval describes mean throughput across these repeats, not a production guarantee.', '',
  'The native baseline uses Node HTTP writes. Hono includes its router; Fastify includes its router and plugin. Hono, sveltekit-sse and MinkSSE use the same Web Response → Node HTTP adapter. sveltekit-sse uses its real published producer bundled by esbuild; SvelteKit routing and the package clients are outside this measurement. Native/Hono/Fastify await exposed write backpressure; producer APIs cannot be made identical in that respect. See README.md for scope and reproducibility.', '',
  `Package versions: ${Object.entries(versions).map(([name, version]) => `${name} ${version}`).join(', ')}.`, '',
  `Raw samples and environment: ${options.output.split('/').at(-1)}. Local MinkSSE source commit ${report.source.commit}; dirty checkout: ${report.source.dirty}. The JSON includes the local compiled server and dependency lock hashes.`, ''
);

const output = resolve(options.output);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
await writeFile(output.replace(/\.json$/, '') + '.md', lines.join('\n'));
console.log(lines.join('\n'));
