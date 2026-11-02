import { readFileSync } from 'node:fs';

export const benchmarkCases = [
  ['single', 'ASCII, 1 client'],
  ['four-loader', 'ASCII, 16 clients'],
  ['large', '1 KiB, 16 clients'],
  ['unicode', 'Unicode, 16 clients'],
  ['multiline', 'Mixed CR/LF, 16 clients']
].map(([name, label]) => {
  const stem = `tuned-web-all-${name}-2026-11-02`;
  const report = JSON.parse(readFileSync(new URL(`../../benchmarks/results/${stem}.json`, import.meta.url), 'utf8'));
  return { name, label, stem, report };
});

export const benchmarkArtifacts = [
  ...benchmarkCases.flatMap(({ stem }) => [`${stem}.md`, `${stem}.json`]),
  ...['tuned-web-final-control-16k', 'tuned-web-final-control-large64k', 'tuned-web-default-zero-control', 'coalescing-sweep-2026-11-02']
    .flatMap(stem => [`${stem}.md`, `${stem}.json`]),
  'mixed-newline-validation-2026-11-02.json',
  'mixed-newline-failed-run-2026-11-02.log',
  'mixed-newline-valid-smoke-failed-2026-11-02.log'
];

const projects = [
  ['native', 'Native Node HTTP'], ['minksse', 'MinkSSE'], ['better-sse', 'Better SSE'],
  ['fastify', 'Fastify SSE'], ['hono', 'Hono'], ['sveltekit-sse', 'sveltekit-sse']
];
const format = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
export const benchmarkRows = projects.map(([key, label]) => [label, ...benchmarkCases.map(({ report }) => {
  const summary = report.summary[key];
  return summary ? format.format(summary.eventsPerSecond.median) : 'Failed†';
})]);
