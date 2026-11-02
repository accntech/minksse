import { performance } from 'node:perf_hooks';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const modules = {
  before: await import('./fixtures/pre-wrapper-optimization/client.js'),
  after: await import('../src/client.js')
};
const count = 500_000;
const cases = [{ idleTimeoutMs: 75_000, listeners: 1 }, { idleTimeoutMs: 0, listeners: 1 }, { idleTimeoutMs: 75_000, listeners: 4 }];
const samples = [];
for (const options of cases) {
  for (let pass = -2; pass < 9; pass++) {
    for (const target of pass % 2 === 0 ? ['before', 'after'] : ['after', 'before']) {
      let source;
      class Source extends EventTarget {
        constructor() { super(); source = this; }
        close() {}
      }
      const client = modules[target].createSseConnection('/events', { eventSource: Source, idleTimeoutMs: options.idleTimeoutMs });
      let received = 0;
      for (let i = 0; i < options.listeners; i++) client.subscribe('tick', value => { received += value; });
      await Promise.resolve();
      source.dispatchEvent(new Event('open'));
      const event = new MessageEvent('tick', { data: '1' });
      globalThis.gc();
      const cpu = process.cpuUsage();
      const started = performance.now();
      for (let index = 0; index < count; index++) source.dispatchEvent(event);
      const ms = performance.now() - started;
      const used = process.cpuUsage(cpu);
      if (received !== count * options.listeners) throw Error('Invalid received count');
      client.close();
      if (pass >= 0) samples.push({ target, repeat: pass + 1, ...options, ms, cpuMs: (used.user + used.system) / 1000 });
    }
  }
}
const median = values => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
const summary = [];
for (const options of cases) {
  const result = { ...options, eventsPerRepeat: count, repeats: 9 };
  for (const target of ['before', 'after']) {
    const selected = samples.filter(value => value.target === target && value.idleTimeoutMs === options.idleTimeoutMs && value.listeners === options.listeners);
    result[target] = { medianMs: median(selected.map(v => v.ms)), medianCpuMs: median(selected.map(v => v.cpuMs)) };
  }
  result.elapsedReductionPct = 100 * (1 - result.after.medianMs / result.before.medianMs);
  summary.push(result);
}

const sha = async path => createHash('sha256').update(await readFile(new URL(path, import.meta.url))).digest('hex');
console.log(JSON.stringify({
  createdAt: new Date().toISOString(), node: process.version,
  methodology: 'Diagnostic in-memory EventTarget dispatch with one reused MessageEvent and JSON value 1. Two warmups, nine measured rotated before/after repeats; GC before each timed run. Exact sum validates delivery. Excludes network, native SSE parsing and connection startup; not an HTTP throughput result.',
  source: { wrapperSha256: await sha('../src/client.js'), wrapperBeforeSha256: await sha('./fixtures/pre-wrapper-optimization/client.js'), harnessSha256: await sha('./wrapper-dispatch.mjs') },
  samples, summary
}, null, 2));
