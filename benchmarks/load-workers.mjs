import { Worker } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { measureClients } from './harness.mjs';

/** Reusable, validated load generation. Startup is outside measured windows. */
export async function createLoadGenerator(options) {
  const loaders = options.loaders ?? 1;
  if (!Number.isSafeInteger(loaders) || loaders < 1 || loaders > options.clients) {
    throw new Error('loaders must be a positive integer no greater than clients');
  }
  const loaderClients = Array.from({ length: loaders }, (_, index) =>
    Math.floor(options.clients / loaders) + (index < options.clients % loaders ? 1 : 0));
  const states = [];
  let closed = false;
  let active = false;
  let closing;
  let nextId = 1;
  let singleController;

  async function close() {
    if (closing) return closing;
    closed = true;
    singleController?.abort(new Error('Load generator closed'));
    const reason = new Error('Load generator closed');
    for (const state of states) {
      state.pending?.reject(reason);
      state.pending = undefined;
      state.rejectReady?.(reason);
    }
    closing = Promise.allSettled(states.map(async state => {
      await state.worker.terminate();
      state.worker.removeAllListeners();
    })).then(() => undefined);
    return closing;
  }

  function spawn(clients) {
    const worker = new Worker(new URL('./load-worker.mjs', import.meta.url), {
      workerData: { options: { ...options, clients, loaders: 1 } }, execArgv: []
    });
    const state = { worker, pending: undefined, failure: undefined, threadId: undefined,
      resolveReady: undefined, rejectReady: undefined };
    state.ready = new Promise((resolve, reject) => {
      state.resolveReady = resolve;
      state.rejectReady = reject;
    });
    function fail(cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      state.failure = error;
      state.rejectReady?.(error);
      state.pending?.reject(error);
      state.pending = undefined;
    }
    worker.on('error', fail);
    worker.on('exit', code => { if (!closed) fail(new Error(`Load worker exited (${code})`)); });
    worker.on('message', message => {
      if (message.type === 'ready') {
        state.threadId = message.threadId;
        state.resolveReady();
      } else if (state.pending?.id === message.id) {
        const pending = state.pending;
        state.pending = undefined;
        if (message.type === 'sample') pending.resolve(message.sample);
        else if (message.type === 'failure') pending.reject(new Error(message.error));
      }
    });
    states.push(state);
    return state;
  }

  if (loaders > 1) {
    let timer;
    try {
      const ready = Promise.all(loaderClients.map(clients => spawn(clients).ready));
      await Promise.race([ready, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Load worker readiness timeout')), Math.max(1000, options.timeout));
      })]);
    } catch (cause) { await close(); throw cause; }
    finally { clearTimeout(timer); }
  }

  return {
    loaderClients: [...loaderClients],
    async measure(url) {
      if (closed) throw new Error('Load generator closed');
      if (active) throw new Error('Load generator measurement already active');
      active = true;
      let timer;
      try {
        if (loaders === 1) {
          singleController = new AbortController();
          const sample = await measureClients(url, options, singleController.signal);
          return { ...sample, loaderClients: [...loaderClients], loaderThreadIds: [] };
        }
        const start = performance.now();
        const before = process.cpuUsage();
        // All workers passed the ready barrier before a common dispatch window.
        const requests = states.map(state => new Promise((resolve, reject) => {
          if (state.failure) { reject(state.failure); return; }
          const id = nextId++;
          state.pending = { id, resolve, reject };
          state.worker.postMessage({ type: 'measure', id, url });
        }));
        const rows = await Promise.race([Promise.all(requests), new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Load generator measurement timeout')), options.timeout);
        })]);
        const elapsedMs = performance.now() - start;
        // process.cpuUsage covers the entire client process, including all
        // loader threads. Summing worker CPU samples would count it repeatedly.
        const cpu = process.cpuUsage(before);
        const events = rows.reduce((sum, row) => sum + row.events, 0);
        const wireBytes = rows.reduce((sum, row) => sum + row.wireBytes, 0);
        return { elapsedMs, clientCpuMs: (cpu.user + cpu.system) / 1000,
          events, wireBytes, eventsPerSecond: events / elapsedMs * 1000,
          wireMiBPerSecond: wireBytes / 1048576 / elapsedMs * 1000,
          firstEventMs: rows.flatMap(row => row.firstEventMs),
          loaderClients: [...loaderClients], loaderThreadIds: states.map(state => state.threadId) };
      } catch (cause) { await close(); throw cause; }
      finally { clearTimeout(timer); singleController = undefined; active = false; }
    },
    close
  };
}
