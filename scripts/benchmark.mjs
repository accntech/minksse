// Run with Node or Bun. Optional argument: directory containing an earlier build.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const current = new URL('../dist/', import.meta.url);
const baseline = process.argv[2] ? pathToFileURL(resolve(process.argv[2]) + '/') : undefined;
const targets = baseline ? [['baseline', baseline], ['current', current]] : [['current', current]];
const frame = 'id: 7\nevent: tick\ndata: {"value":"piñata 😀"}\n\n';
const batch = frame.repeat(1000);
const fragments = [...frame];

async function workloads(directory) {
  const { createSseParser } = await import(new URL('parser.js', directory));
  const { produce } = await import(new URL('server.js', directory));
  return {
    'parser batched': () => {
      let count = 0;
      const parser = createSseParser(() => { count++; });
      for (let index = 0; index < 100; index++) parser.push(batch);
      assert.equal(count, 100_000);
    },
    'parser fragmented': () => {
      let count = 0;
      const parser = createSseParser(() => { count++; });
      for (let index = 0; index < 10_000; index++) {
        for (const fragment of fragments) parser.push(fragment);
      }
      assert.equal(count, 10_000);
    },
    'producer drained': async () => {
      for (let index = 0; index < 100; index++) {
        const response = produce(({ emit, lock }) => {
          for (let event = 0; event < 100; event++) assert.equal(emit('tick', 'piñata 😀').error, false);
          lock.set(false);
        });
        const wire = await response.text();
        assert.equal(wire.match(/^id: /gm).length, 100);
        assert.ok(wire.endsWith('id: 100\nevent: tick\ndata: piñata 😀\n\n'));
      }
    }
  };
}

const suites = await Promise.all(targets.map(async ([label, directory]) => ({ label, tasks: await workloads(directory) })));
const runtime = process.versions.bun ? `Bun ${process.versions.bun}` : `Node ${process.version}`;
console.log(`${runtime}; median of 7 samples after 3 warmups (lower is better)`);
for (const name of Object.keys(suites[0].tasks)) {
  for (let warmup = 0; warmup < 3; warmup++) {
    for (const suite of suites) await suite.tasks[name]();
  }
  const times = suites.map(() => []);
  for (let sample = 0; sample < 7; sample++) {
    // Alternate order to reduce systematic warmup/order bias in comparisons.
    const order = sample % 2 ? [...suites.keys()].reverse() : [...suites.keys()];
    for (const index of order) {
      const started = performance.now();
      await suites[index].tasks[name]();
      times[index].push(performance.now() - started);
    }
  }
  const medians = times.map(samples => samples.sort((a, b) => a - b)[3]);
  console.log(`${name}: ${suites.map((suite, index) => `${suite.label} ${medians[index].toFixed(2)} ms`).join('; ')}${baseline ? `; ratio ${(medians[1] / medians[0]).toFixed(2)}x` : ''}`);
}
