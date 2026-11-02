// Node's native implementation requires --experimental-eventsource on Node 24.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fork, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { cpus, platform, arch } from 'node:os';
import { dirname, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { summarize } from './core.mjs';

export function createClientValidator(expected, payload) {
  let count = 0;
  return {
    accept(value) {
      assert.ok(count < expected && value.sequence === count, `Invalid sequence at ${count}`);
      assert.equal(value.payload, payload, `Corrupted payload at ${count}`);
      count++;
    },
    finish(value) {
      assert.equal(value.count, expected, 'Invalid completion sentinel');
      assert.equal(count, expected, `Expected ${expected} events, received ${count}`);
      return count;
    }
  };
}

async function serve(options) {
  const payload = 'x'.repeat(options.bytes);
  const frames = Array.from({ length: options.events }, (_, sequence) =>
    `id: ${sequence + 1}\nevent: tick\ndata: ${JSON.stringify({ sequence, payload })}\n\n`);
  const server = createServer((req, res) => {
    if (req.url !== '/events' || !['GET', 'POST'].includes(req.method)) {
      res.writeHead(404).end(); return;
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
    res.flushHeaders();
    void (async () => {
      for (let first = 0; first < frames.length && !res.destroyed; first += options.batch) {
        if (!res.write(frames.slice(first, first + options.batch).join(''))) {
          // Abort waiting for drain if a client fails or disconnects.
          const controller = new AbortController();
          const abort = () => controller.abort();
          res.once('close', abort);
          try { await once(res, 'drain', { signal: controller.signal }); }
          finally { res.off('close', abort); }
        }
        await yieldTurn();
      }
      if (!res.destroyed) res.write(`event: done\ndata: {"count":${options.events}}\n\n`);
      // Leave open until the client validates done and closes. Native retries and
      // server EOF handling therefore cannot contaminate the completion metric.
    })().catch(error => { if (!res.destroyed) res.destroy(error); });
  });
  process.on('disconnect', () => process.exit(0));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  process.send({ port: server.address().port });
}

export async function measureClient(target, options, url, factories) {
  const connections = [];
  const firstEvents = [];
  const started = performance.now();
  const cpuStart = process.cpuUsage();
  try {
    await Promise.all(Array.from({ length: options.clients }, (_, index) => new Promise((resolve, reject) => {
      const validator = createClientValidator(options.events, 'x'.repeat(options.bytes));
      const clientStart = performance.now();
      let seen = false;
      const timer = setTimeout(() => reject(new Error(`${target} client ${index} timed out`)), options.timeout);
      const fail = cause => { clearTimeout(timer); reject(cause instanceof Error ? cause : new Error(`${target} transport error`)); };
      const accept = value => {
        try {
          validator.accept(value);
          if (!seen) { seen = true; firstEvents.push(performance.now() - clientStart); }
        } catch (error) { fail(error); }
      };
      const finish = value => {
        try { validator.finish(value); connection.close(); clearTimeout(timer); resolve(); }
        catch (error) { fail(error); }
      };
      let connection;
      if (target === 'native') {
        connection = new EventSource(url);
        connection.addEventListener('tick', event => { try { accept(JSON.parse(event.data)); } catch (error) { fail(error); } });
        connection.addEventListener('done', event => { try { finish(JSON.parse(event.data)); } catch (error) { fail(error); } });
        connection.onerror = fail;
      } else {
        connection = factories[target](url, { onerror: fail });
        connection.subscribe('tick', accept);
        connection.subscribe('done', finish);
      }
      connections.push({ connection, timer });
    })));
    const elapsedMs = performance.now() - started;
    const cpu = process.cpuUsage(cpuStart);
    return { elapsedMs, eventsPerSecond: options.clients * options.events / (elapsedMs / 1000),
      clientCpuMs: (cpu.user + cpu.system) / 1000, firstEventMs: firstEvents,
      validatedEvents: options.clients * options.events };
  } finally {
    for (const { connection, timer } of connections) { clearTimeout(timer); connection.close(); }
  }
}

async function main(args) {
  if (typeof EventSource !== 'function') throw new Error('Run Node with --experimental-eventsource; no polyfill is used.');
  const options = { clients: 1, events: 20000, bytes: 128, batch: 16, repeats: 7, warmup: 2, timeout: 30000,
    output: fileURLToPath(new URL('./results/native-client-1.json', import.meta.url)) };
  for (const arg of args) {
    const match = /^--([a-z]+)=(.+)$/.exec(arg);
    if (!match || !(match[1] in options)) throw new Error(`Unknown option ${arg}`);
    const [, key, value] = match;
    if (key === 'output') options[key] = value;
    else {
      const number = Number(value);
      if (!Number.isSafeInteger(number) || number < (key === 'warmup' ? 0 : 1)) throw new Error(`Invalid ${key}`);
      options[key] = number;
    }
  }
  const { createSseConnection } = await import('../src/client.js');
  const { createSseConnection: fetchBaseline } = await import('./fixtures/pre-eventsource-client/client.js');
  const { createSseConnection: wrapperBefore } = await import('./fixtures/pre-wrapper-optimization/client.js');
  const factories = { wrapper: createSseConnection, 'wrapper-before': wrapperBefore, 'fetch-before': fetchBaseline };
  const child = fork(new URL(import.meta.url), ['--server', JSON.stringify(options)], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  let startupTimer;
  try {
    const ready = await Promise.race([
      once(child, 'message').then(([value]) => value),
      once(child, 'exit').then(([code]) => { throw new Error(`Server exited ${code}`); }),
      new Promise((_, reject) => { startupTimer = setTimeout(() => reject(new Error('Server startup timeout')), options.timeout); })
    ]);
    clearTimeout(startupTimer);
    const url = `http://127.0.0.1:${ready.port}/events`;
    const targets = ['native', 'wrapper', 'wrapper-before', 'fetch-before'];
    const samples = [];
    for (let pass = -options.warmup; pass < options.repeats; pass++) {
      const rotation = (pass + options.warmup) % targets.length;
      for (let offset = 0; offset < targets.length; offset++) {
        const target = targets[(offset + rotation) % targets.length];
        const sample = await measureClient(target, options, url, factories);
        if (pass >= 0) {
          samples.push({ target, repeat: pass + 1, ...sample });
          process.stderr.write(`${target} ${pass + 1}/${options.repeats}: ${Math.round(sample.eventsPerSecond)} events/s\n`);
        }
      }
    }
    const sha = async path => createHash('sha256').update(await readFile(new URL(path, import.meta.url))).digest('hex');
    const report = {
      createdAt: new Date().toISOString(), options,
      environment: { node: process.version, v8: process.versions.v8, cpu: cpus()[0].model, os: platform(), arch: arch() },
      source: { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        wrapperSha256: await sha('../src/client.js'), wrapperBeforeSha256: await sha('./fixtures/pre-wrapper-optimization/client.js'), baselineSha256: await sha('./fixtures/pre-eventsource-client/client.js'),
        baselineParserSha256: await sha('./fixtures/pre-eventsource-client/parser.js'), harnessSha256: await sha('./client-benchmark.mjs') },
      methodology: 'Native Node EventSource (--experimental-eventsource), optimized wrapper GET, previous wrapper GET, historical Fetch POST. Same isolated Node HTTP server, preframed identical JSON events; yield every batch. Exact count/order/payload validation and completion sentinel. Close immediately on done; no retries. Sequential rotated candidates; full warmup passes. Throughput includes connection startup and independent JSON validation. Completion is final validated sentinel, not EOF. CPU is client process only. Loopback Node measurements do not establish browser performance, server improvements, replay or WAN latency.',
      samples,
      comparisons: Object.fromEntries(['native', 'wrapper-before'].map(reference => [reference, {
        metric: 'wrapper throughput percent difference within each repeat block',
        ...summarize(samples.filter(sample => sample.target === 'wrapper').map(sample => {
          const control = samples.find(other => other.target === reference && other.repeat === sample.repeat);
          return 100 * (sample.eventsPerSecond / control.eventsPerSecond - 1);
        }))
      }])),
      summary: Object.fromEntries(targets.map(target => {
        const selected = samples.filter(sample => sample.target === target);
        return [target, Object.fromEntries(['eventsPerSecond', 'elapsedMs', 'clientCpuMs'].map(metric => [metric, summarize(selected.map(sample => sample[metric]))]))];
      }))
    };
    const lines = ['# Native EventSource client benchmark', '', report.methodology, '',
      `${options.clients} clients × ${options.events} events × ${options.bytes} payload bytes; batch ${options.batch}; ${options.warmup} warmups; ${options.repeats} measured repeats. ${report.environment.node}, ${report.environment.cpu}, ${report.environment.os}/${report.environment.arch}.`, '',
      '| Client | Median events/s | Mean events/s (95% CI) | Median completion ms | Median client CPU ms |',
      '| --- | ---: | ---: | ---: | ---: |'];
    const f = number => number.toLocaleString('en-US', { maximumFractionDigits: 2 });
    for (const target of targets) {
      const s = report.summary[target];
      lines.push(`| ${target} | ${f(s.eventsPerSecond.median)} | ${f(s.eventsPerSecond.mean)} (${s.eventsPerSecond.ci95?.map(f).join('–') ?? 'insufficient repeats'}) | ${f(s.elapsedMs.median)} | ${f(s.clientCpuMs.median)} |`);
    }
    lines.push('', 'Wrapper versus each control within repeat blocks (mean percent throughput difference; Student-t 95% interval):');
    for (const [reference, comparison] of Object.entries(report.comparisons))
      lines.push(`- ${reference}: ${f(comparison.mean)}% (${comparison.ci95.map(f).join('–')}%).`);
    lines.push('', 'All measured and warmup streams passed count, order, payload and completion-sentinel validation. Any failure aborts without writing a successful report. Small samples, scheduling noise and overlapping intervals do not establish a ranking. Native EventSource is experimental in this Node version; this benchmark uses no polyfill.', '');
    const output = resolve(options.output);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(report, null, 2) + '\n');
    await writeFile(output.replace(/\.json$/, '') + '.md', lines.join('\n'));
    console.log(lines.join('\n'));
  } finally {
    clearTimeout(startupTimer);
    if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
  }
}

if (process.argv[2] === '--server') await serve(JSON.parse(process.argv[3]));
else if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main(process.argv.slice(2));
