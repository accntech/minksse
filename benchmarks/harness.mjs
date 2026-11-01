import { fork } from 'node:child_process';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import { createValidator } from './core.mjs';

export async function measureClients(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Benchmark request timeout')), options.timeout);
  const start = performance.now();
  const requests = Array.from({ length: options.clients }, async () => {
    const requested = performance.now();
    const validator = createValidator(options.events, 'x'.repeat(options.bytes));
    let firstEventMs;
    let bytes = 0;
    const response = await fetch(`${url}/events`, {
      method: 'POST', headers: { accept: 'text/event-stream' }, signal: controller.signal
    });
    if (response.status !== 200 || !/^text\/event-stream(?:;|$)/i.test(response.headers.get('content-type') ?? '')) {
      await response.body?.cancel();
      throw new Error(`Invalid HTTP response: ${response.status} ${response.headers.get('content-type')}`);
    }
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      validator.push(chunk);
      if (firstEventMs === undefined && validator.count > 0) firstEventMs = performance.now() - requested;
    }
    return { events: validator.finish(), bytes, firstEventMs };
  });
  try {
    const streams = await Promise.all(requests);
    const elapsedMs = performance.now() - start;
    const events = streams.reduce((sum, stream) => sum + stream.events, 0);
    const wireBytes = streams.reduce((sum, stream) => sum + stream.bytes, 0);
    return { elapsedMs, events, wireBytes, eventsPerSecond: events / elapsedMs * 1000,
      wireMiBPerSecond: wireBytes / 1048576 / elapsedMs * 1000,
      firstEventMs: streams.map(stream => stream.firstEventMs) };
  } finally {
    clearTimeout(timer);
    controller.abort();
    await Promise.allSettled(requests);
  }
}

export async function measureTarget(target, options) {
  const child = fork(new URL('./server.mjs', import.meta.url), [target, JSON.stringify(options)], {
    execArgv: [], stdio: ['ignore', 'ignore', 'pipe', 'ipc']
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-16000); });
  function waitFor(type) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error(`${target}: server ${type} timeout`)), options.timeout);
      const message = value => { if (value.type === type) finish(null, value); };
      const exit = code => finish(new Error(`${target}: server exited (${code})\n${stderr}`));
      const error = cause => finish(cause);
      function finish(cause, value) {
        clearTimeout(timer);
        child.off('message', message); child.off('exit', exit); child.off('error', error);
        if (cause) reject(cause); else resolve(value);
      }
      child.on('message', message); child.once('exit', exit); child.once('error', error);
    });
  }
  try {
    const ready = await waitFor('ready');
    const url = `http://127.0.0.1:${ready.port}`;
    for (let warmup = 0; warmup < options.warmup; warmup++) await measureClients(url, options);
    const started = waitFor('started');
    child.send({ type: 'start' });
    await started;
    const sample = await measureClients(url, options);
    const stats = waitFor('stats');
    child.send({ type: 'stats' });
    const { stats: server } = await stats;
    if (server.fatal) throw new Error(`${target}: server error\n${server.fatal}`);
    return { ...sample, server };
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
    }
  }
}
