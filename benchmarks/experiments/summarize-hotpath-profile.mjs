// node benchmarks/experiments/summarize-hotpath-profile.mjs profile.cpuprofile ...
// CPU samples include imports, warmup, measured work and shutdown; never use as ranking timings.
import { readFile, writeFile } from 'node:fs/promises';
const summaries = [];
for (const file of process.argv.slice(2)) {
  const p = JSON.parse(await readFile(file));
  const nodes = new Map(p.nodes.map(n => [n.id, n.callFrame]));
  const totals = new Map();
  let totalUs = 0;
  for (let i = 0; i < p.samples.length; i++) {
    const f = nodes.get(p.samples[i]);
    const us = p.timeDeltas[i];
    totalUs += us;
    const key = JSON.stringify({ function: f.functionName || '(anonymous)', url: f.url, line: f.lineNumber + 1 });
    totals.set(key, (totals.get(key) ?? 0) + us);
  }
  summaries.push({ source: file, instrumented: true, totalSampledMs: totalUs / 1000,
    top: [...totals].sort((a, b) => b[1] - a[1]).slice(0, 45).map(([key, us]) => ({ ...JSON.parse(key), selfMs: us / 1000, percentTotal: us / totalUs * 100 })) });
}
await writeFile(process.env.OUTPUT ?? 'benchmarks/results/four-loader-hotpath-profile-summary.json', JSON.stringify(summaries, null, 2) + '\n');
console.log(summaries.map(p => ({ source: p.source, top: p.top.slice(0, 16) })));
