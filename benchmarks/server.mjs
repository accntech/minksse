import { createPayload, serializeData, resolveSetup } from './core.mjs';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setImmediate as yieldTurn, setTimeout as pause } from 'node:timers/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const target = process.argv[2];
const options = JSON.parse(process.argv[3]);
const minkDirectory = options.minkbuild ? pathToFileURL(resolve(options.minkbuild) + '/') : new URL('../dist/', import.meta.url);
const setup = resolveSetup(options, target);
const payload = createPayload(options.bytes, options.payload);
const data = Array.from({ length: options.events }, (_, sequence) => serializeData(sequence, payload, options.payload));
// Select once; multiline escaping stays within each timed native write.
const nativeFrame = options.payload === 'multiline'
  ? (value, id) => `id: ${id}\nevent: message\ndata: ${value.replace(/\r\n|\r|\n/g, '\ndata: ')}\n\n`
  : (value, id) => `id: ${id}\nevent: message\ndata: ${value}\n\n`;
const identity = value => value;
const headers = { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' };
let fatal;
let baseline;
let kitSetResponse;
let nativeWrites = 0;
// Parent interruption closes IPC; do not leave a benchmark listener behind.
process.on('disconnect', () => process.exit(0));

// One common production schedule: yield after each batch for every candidate.
async function pump(send, alive = () => true) {
  for (let sequence = 0; sequence < data.length; sequence++) {
    if (!alive()) return;
    const pending = send(data[sequence], String(sequence + 1));
    if (pending && typeof pending.then === 'function') await pending;
    if ((sequence + 1) % options.batch === 0 && sequence + 1 < data.length) {
      if (options.interval) await pause(options.interval);
      else await yieldTurn();
    }
  }
}

async function* messages(alive = () => true) {
  for (let sequence = 0; sequence < data.length; sequence++) {
    if (!alive()) return;
    yield { event: 'message', id: String(sequence + 1), data: data[sequence] };
    if ((sequence + 1) % options.batch === 0 && sequence + 1 < data.length) {
      if (options.interval) await pause(options.interval);
      else await yieldTurn();
    }
  }
}

// All Web producers use the same selected transport; framing stays in package.

async function webHandler(handle, req, res) {
  const controller = new AbortController();
  const abort = () => { if (!res.writableFinished) controller.abort(); };
  res.once('close', abort);
  try {
    const request = new Request(`http://127.0.0.1${req.url}`, { method: req.method, signal: controller.signal });
    const response = await handle(request);
    if (setup.bridge === 'kit') { await kitSetResponse(res, response); return; }
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (setup.bridge === 'pipeline') await pipeline(Readable.fromWeb(response.body), res);
    else {
      const reader = response.body.getReader();
      const cancel = () => { void reader.cancel().catch(() => {}); };
      res.once('close', cancel);
      try {
        while (!res.destroyed) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!res.write(value)) await once(res, 'drain', { signal: controller.signal });
        }
        res.end();
      } finally {
        res.off('close', cancel);
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    }
  } finally {
    res.removeListener('close', abort);
  }
}

function producerHandler(produce, local) {
  return request => produce(({ emit, emitBatch, lock }) => {
    let active = true;
    // Deferral lets the consumer attach before the first production batch.
    void yieldTurn().then(async () => {
      try {
        if (local && setup.minkApi === 'batch') {
          for (let first = 0; first < data.length && active; first += options.batch) {
            // Batch-array preparation and all package framing stay inside timing.
            const result = emitBatch('message', data.slice(first, first + options.batch));
            if (result.error) throw result.error;
            if (first + options.batch < data.length) {
              if (options.interval) await pause(options.interval); else await yieldTurn();
            }
          }
        } else {
          await pump(value => {
            const result = emit('message', value);
            if (result.error) throw result.error;
          }, () => active);
        }
      } catch (error) {
        if (active) fatal = String(error?.stack ?? error);
      } finally {
        lock.set(false);
      }
    });
    return () => { active = false; };
  }, { ping: 2147483647, ...(local ? { signal: request.signal, coalesceBytes: setup.coalesceBytes } : {}) });
}

async function start() {
  if (target === 'fastify') {
    const { default: Fastify } = await import('fastify');
    const { default: sse } = await import('@fastify/sse');
    const app = Fastify({ logger: false });
    await app.register(sse, { serializer: identity, heartbeatInterval: 2147483647 });
    app.post('/events', { sse: true }, async (_, reply) => {
      try {
        const alive = () => reply.sse.isConnected;
        if (setup.fastify === 'stream') await reply.sse.send(Readable.from(messages(alive)));
        else if (setup.fastify === 'iterable') await reply.sse.send(messages(alive));
        else await pump((value, id) => reply.sse.send({ event: 'message', id, data: value }), alive);
      } catch (error) {
        fatal = String(error?.stack ?? error);
        throw error;
      }
    });
    await app.listen({ host: '127.0.0.1', port: 0 });
    return app.server;
  }

  let handle;
  if (target === 'native') {
    handle = async (_, res) => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      res.once('close', abort);
      const write = frame => { nativeWrites++; return res.write(frame); };
      const drain = () => once(res, 'drain', { signal: controller.signal });
      try {
        res.writeHead(200, headers);
        if (setup.native === 'write' && setup.cork === 'off') {
          await pump((value, id) => {
            if (!write(nativeFrame(value, id))) return drain();
          }, () => !res.destroyed);
        } else {
          for (let first = 0; first < data.length && !res.destroyed; first += options.batch) {
            let writable = true;
            if (setup.cork === 'on') res.cork();
            try {
              if (setup.native === 'batch') {
                // Format and join inside the timed request, never preframe data.
                const frames = [];
                for (let sequence = first; sequence < Math.min(first + options.batch, data.length); sequence++) {
                  frames.push(nativeFrame(data[sequence], sequence + 1));
                }
                writable = write(frames.join(''));
              } else {
                for (let sequence = first; sequence < Math.min(first + options.batch, data.length); sequence++) {
                  writable = write(nativeFrame(data[sequence], sequence + 1)) && writable;
                }
              }
            } finally { if (setup.cork === 'on') res.uncork(); }
            if (!writable) await drain();
            if (first + options.batch < data.length) {
              if (options.interval) await pause(options.interval); else await yieldTurn();
            }
          }
        }
        res.end();
      } finally { res.off('close', abort); }
    };
  } else if (target === 'better-sse') {
    const { createSession } = await import('better-sse');
    handle = async (req, res) => {
      const session = await createSession(req, res, { serializer: identity, keepAlive: null, retry: null });
      if (setup.better === 'push') await pump((value, id) => session.push(value, 'message', id), () => session.isConnected);
      else {
        for (let first = 0; first < data.length && session.isConnected; first += options.batch) {
          await session.batch(buffer => {
            for (let sequence = first; sequence < Math.min(first + options.batch, data.length); sequence++) {
              buffer.push(data[sequence], 'message', String(sequence + 1));
            }
          });
          if (first + options.batch < data.length) {
            if (options.interval) await pause(options.interval); else await yieldTurn();
          }
        }
      }
      res.end();
    };
  } else {
    let web;
    if (target === 'hono') {
      const { Hono } = await import('hono');
      const { streamSSE } = await import('hono/streaming');
      const app = new Hono();
      app.post('/events', c => streamSSE(c, stream => pump(
        (value, id) => stream.writeSSE({ event: 'message', id, data: value }), () => !stream.aborted
      )));
      web = request => app.fetch(request);
    } else if (target === 'sveltekit-sse') {
      // Published package has bundler-only extensionless imports. Resolve its
      // genuine public `svelte` export with esbuild, as a SvelteKit build does.
      const { build } = await import('esbuild');
      const bundle = await build({ stdin: { contents: "export { produce } from 'sveltekit-sse'", resolveDir: import.meta.dirname },
        bundle: true, write: false, platform: 'node', format: 'esm', conditions: ['svelte'], target: 'node24' });
      const { produce } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
      web = producerHandler(produce, false);
    } else if (target === 'minksse') {
      const { produce } = await import(new URL('server.js', minkDirectory));
      web = producerHandler(produce, true);
    } else throw new Error(`Unknown target: ${target}`);
    if (setup.bridge === 'hono-node') {
      const { getRequestListener } = await import('@hono/node-server');
      handle = getRequestListener(web);
    } else {
      if (setup.bridge === 'kit') ({ setResponse: kitSetResponse } = await import('@sveltejs/kit/node'));
      handle = (req, res) => webHandler(web, req, res);
    }
  }
  const server = createServer((req, res) => {
    req.socket.setNoDelay(true);
    if (req.method !== 'POST' || req.url !== '/events') { res.writeHead(404).end(); return; }
    Promise.resolve(handle(req, res)).catch(error => {
      fatal = String(error?.stack ?? error);
      res.destroy(error);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server;
}

try {
  const server = await start();
  process.on('message', message => {
    if (message.type === 'shutdown') { process.exit(0); }
    else if (message.type === 'start') {
      baseline = { cpu: process.cpuUsage(), rss: process.memoryUsage().rss, nativeWrites };
      process.send({ type: 'started' });
    } else if (message.type === 'stats') {
      const cpu = process.cpuUsage(baseline.cpu);
      process.send({ type: 'stats', stats: {
        cpuMs: (cpu.user + cpu.system) / 1000,
        rssBeforeBytes: baseline.rss,
        rssAfterBytes: process.memoryUsage().rss,
        processPeakRssBytes: process.resourceUsage().maxRSS * 1024,
        fatal: fatal ?? null, setup, nativeWrites: target === 'native' ? nativeWrites - baseline.nativeWrites : null
      } });
    }
  });
  process.send({ type: 'ready', port: server.address().port });
} catch (error) {
  console.error(error);
  process.exit(1);
}
