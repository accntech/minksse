<img src="assets/icon.png" alt="MinkSSE icon" width="96" height="96">

# MinkSSE

[![npm version](https://img.shields.io/npm/v/minksse?style=plastic&color=orange)](https://www.npmjs.com/package/minksse)
[![npm monthly downloads](https://img.shields.io/npm/dm/minksse?style=plastic&label=downloads&color=brightgreen)](https://www.npmjs.com/package/minksse)
[![Runtime dependencies: 0](https://img.shields.io/badge/runtime_dependencies-0-217346?style=plastic)](#install)
[![Documentation](https://img.shields.io/badge/docs-MinkSSE-217346?style=plastic)](https://accntech.github.io/minksse/)
[![GitHub stars](https://img.shields.io/github/stars/accntech/minksse?style=social&label=Stars)](https://github.com/accntech/minksse/stargazers)

Server-Sent Events for JavaScript applications: produce a streaming Web `Response`, subscribe to named events through native `EventSource`, or parse SSE text directly. Zero runtime dependencies, native JavaScript ESM, and TypeScript declarations generated from JSDoc.

MinkSSE uses Web APIs and works independently of a frontend or server framework. Use the producer, client, and parser together, or import just the part your application needs.

## Features

- **Streaming responses with explicit cleanup.** Send named events, finish after accepted events drain, and release timers or subscriptions on termination. Abort signals, configurable heartbeats, and an `onStop` hook support long-lived connections.
- **Bounded server buffering.** Each producer limits queued serialized UTF-8 wire data to 256 KiB. Oversized events and slow consumers terminate the stream instead of growing the queue indefinitely.
- **Burst delivery without a batching timer.** `emitBatch()` validates an entire array of payloads before publishing its frames. Opt-in `coalesceBytes` combines queued complete events into fewer output chunks while keeping the first event immediate.
- **Configurable native EventSource wrapper.** Connect over GET, configure credentials and decoding, and dispose of each subscription independently. Malformed subscribed JSON and listener failures reach `onerror`; a failing listener does not block other listeners.
- **Connection recovery you control.** Observe readiness with `onopen`, detect stalled streams with an idle timeout, and schedule retries through `onclose({ connect })`. Subscriptions survive reconnects; automatic retries and missed-event replay are not included.
- **Raw incremental parsing.** Parse SSE text across chunk boundaries, including split line endings, multiline data, comments, IDs, and Unicode. Receive raw strings without JSON decoding, with a configurable frame limit.
- **Focused ESM imports.** Zero runtime dependencies, tree-shakeable ESM entry points, and TypeScript declarations generated from JSDoc. The library uses standard Web APIs throughout.

| API | Purpose |
| --- | --- |
| [`produce()`](#server-api) | Send named events from a server as an SSE `Response`. |
| [`createSseConnection()`](#client-options) | Wrap a native EventSource GET stream and decode subscribed events. |
| [`createSseParser()`](#parser-api) | Parse incremental SSE text into raw event, data, and ID strings. |

## Install

```sh
npm install minksse
```

### Install from a local checkout

Build the package before installing it into your application:

```sh
# In the MinkSSE checkout:
bun install
bun run build

# In your application:
npm install /absolute/path/to/minksse
```

For a portable archive, run `npm pack` in the checkout, then install the generated `.tgz` file in your application. Packing builds the package automatically.

The package ships ESM JavaScript and declarations under `dist/`. Web functions and types are available from `minksse`, or from the focused `minksse/server`, `minksse/client`, and `minksse/parser` entry points. CommonJS output is not provided.

The client requires native `EventSource`, or a compatible constructor supplied through `eventSource`. The producer requires Streams, `Response`, and `TextEncoder`; the standalone parser consumes strings. Your server or framework must send streaming Web Responses and propagate client disconnection to the request signal or response-body cancellation. MinkSSE has no runtime-specific HTTP adapter. Tests run with Bun and include real HTTP checks.

## Quick start

### Serve events

Register this handler for `GET /events` using your server framework's routing API. It accepts a Web `Request` and returns a Web `Response`; it does not register a route by itself.

```js
import { produce } from 'minksse/server';

export function handleEvents(request) {
  return produce(({ emit }) => {
    const timer = setInterval(() => {
      emit('tick', JSON.stringify({ time: Date.now() }));
    }, 1_000);

    return () => clearInterval(timer);
  }, { signal: request.signal });
}
```

`emit()` accepts string event names and string data. Serialize payloads with `JSON.stringify()` for the bundled client. Return a cleanup function from synchronous setup to release timers or subscriptions when the stream stops. Pass the request's abort signal so disconnection can release those resources.

### Subscribe to events

```js
import { createSseConnection } from 'minksse/client';

const connection = createSseConnection('/events', {
  onerror(cause) { console.error(cause); }
});

const unsubscribe = connection.subscribe('tick', value => {
  console.log(value); // Parsed JSON, for example { time: 1793491200000 }.
});

// Call when the owning page or component is disposed.
function dispose() {
  unsubscribe();
  connection.close();
}
```

The connection starts automatically in a microtask, allowing subscriptions to register first. Native `EventSource` opens a GET request and handles SSE framing and UTF-8 decoding.

Subscribed event data is parsed as JSON and delivered as an unknown value: validate its shape before using it. Malformed JSON is reported through `onerror` and skipped. Empty `ping` heartbeats are delivered as `''` if subscribed to. Set `decode: data => data` when you need raw text.

Each subscription returns an independent disposer. `close()` permanently closes the connection, closes its native EventSource, and clears all listeners and internal timers. `connection.closed` reports permanent local closure, rather than whether a request is currently connected.

### Reconnect when needed

MinkSSE does not retry automatically. Add `onclose` to your connection options to schedule recovery:

```js
import { createSseConnection } from 'minksse/client';

let retry;
const connection = createSseConnection('/events', {
  onopen() { console.log('Connected'); },
  onclose({ connect }) {
    retry = setTimeout(() => { void connect(); }, 1_000);
  },
  onerror(cause) { console.error(cause); }
});

function dispose() {
  clearTimeout(retry);
  connection.close();
}
```

This example uses a fixed delay. Choose a retry policy appropriate to your application. The wrapper closes native EventSource on its error event, including EOF, to prevent built-in automatic retries, then calls `onclose`. Calling `close()` locally suppresses `onclose`. Only one attempt is active at a time. `connect()` resolves when its attempt ends; use `onopen` to observe readiness. Subscriptions survive reconnects.

Each explicit reconnect creates a fresh EventSource, so it does not carry the previous attempt's `Last-Event-ID`. Authentication, session expiry, and catching up on missed events belong to the application.

## Server API

`produce(start, options?)` returns a streaming `Response`. `start` runs synchronously and may return a cleanup function; it must not be an async function.

| Control | Behavior |
| --- | --- |
| `emit(event, data)` | Returns `{ error: false }` on acceptance or `{ error: Error }` on failure. Invalid input or queue overflow terminates the stream. |
| `emitBatch(event, values)` | Validate a readonly array of string payloads before publishing its frames. Returns the same result shape as `emit()`. Use with coalescing for already-available bursts. |
| `lock.set(false)` | Finishes the stream after accepted frames drain. Cleanup runs immediately. |

| Option | Default | Behavior |
| --- | --- | --- |
| `signal` | — | Stops the stream on abort. |
| `ping` | `30_000` | Sends an empty named `ping` event at this interval in milliseconds. |
| `coalesceBytes` | `0` | Opt-in target size for combining already queued events into an output chunk. Integer from 0 through 262,144; 0 preserves individual event chunks. |
| `headers` | — | Overrides or adds response headers. Preserve `Content-Type: text/event-stream` for the bundled client. |
| `onStop` | — | Caller cleanup on every terminal path, including a preaborted request, invalid configuration, or failed setup. |

The returned cleanup function and `onStop` each run once. Normal finish, abort, reader cancellation, setup failure, invalid emits, and queue overflow release resources. A cleanup returned after synchronous termination still runs. Finalizers may return promises, but termination does not await them; failures are logged without blocking the other finalizer.

Normal finish and abort drain accepted frames. Errors and reader cancellation discard the backlog. `ping` must be an integer from 1 through 2,147,483,647; invalid values throw `RangeError` before setup and still invoke `onStop`.

For batches of larger events, measure `coalesceBytes: 65_536` against 16 KiB in your workload. The local 1 KiB-event sweep benefited from 64 KiB, with about 1.4 MiB higher median whole-process RSS. This is an explicit tuning choice; coalescing remains off by default.

Set `coalesceBytes: 16_384` to combine queued complete frames when the consumer reads. This reduces output chunks during bursts without waiting for more events or adding a timer. The first event remains immediate. A single event larger than the target stays whole, subject to the existing 256 KiB queue limit. Invalid coalescing values throw `RangeError` before setup and still invoke `onStop`. Network chunk boundaries are independent of SSE event boundaries; the client and parser continue to deliver events individually.

For a burst already available as an array, `emitBatch()` can put its first group into one output chunk as well:

```js
const response = produce(({ emitBatch, lock }) => {
  const result = emitBatch('update', [
    JSON.stringify({ value: 1 }),
    JSON.stringify({ value: 2 })
  ]);
  if (result.error) return; // Invalid input already terminates the stream.
  lock.set(false);
}, { coalesceBytes: 16_384 });
```

All values are validated synchronously before any new batch frame is published. An empty array consumes no event ID. Invalid input, overflow, throwing getters, or reentrant emission during validation terminates the stream without publishing a staged prefix. Abort or finish during array access discards staging and retains the usual drain behavior for earlier accepted events. This is validation atomicity, not network-atomic delivery. The batch must fit the available 256 KiB wire budget; divide larger inputs into paced batches. Coalescing off still produces individual event chunks. Scalar `emit()` retains immediate first-event delivery and does not wait for a batch.

## Server integration

Return the `Response` from `produce()` through a server or framework that supports streaming Web Responses. Pass the incoming request's abort signal as `signal` and return a cleanup function for resources allocated inside setup. Verify that disconnecting the client aborts the request or cancels the response body, so those resources are released.

Your framework's HTTP integration is responsible for sending status and headers, streaming the body with backpressure, and propagating socket errors and disconnects. Keep response buffering disabled for the SSE route. The producer itself uses the same Web Streams path in every runtime.

### Migrate from the Node adapter

The `minksse/node` entry point and `writeSseResponse()` have been removed. Remove those imports and use your server framework's streaming Web Response support. The private Node-specific queue, UTF-8 counting, encoding, and scheduling hooks are also removed; `produce()` retains its byte limit, framing, batching, coalescing, and cleanup behavior through Web APIs.

## Client options

`createSseConnection(url, options?)` returns an object with `subscribe(name, listener)`, `close()`, and a read-only `closed` property.

| Option | Default | Behavior |
| --- | --- | --- |
| `eventSource` | Global `EventSource` | Supply a compatible EventSource constructor for another runtime or testing. |
| `withCredentials` | `false` | Include credentials for cross-origin EventSource requests. The server must allow credentialed CORS. |
| `decode(data, event)` | JSON decoding | Decode subscribed data with access to its native `MessageEvent`. Empty named `ping` events default to `''`. |
| `idleTimeoutMs` | `75_000` | End an attempt after this duration without an open event, subscribed event, or configured heartbeat. Set `0` to disable. |
| `heartbeatEvent` | `'ping'` | Observe this event name for idle detection even without an application subscription. |
| `onopen` | — | Called when native EventSource opens. |
| `onclose({ connect })` | — | Called after an attempt ends; lets the application schedule another attempt. |
| `onerror(cause)` | — | Receive native transport events, decoding failures, and callback failures. Error-observer failures are logged. |

`idleTimeoutMs` must be an integer from 0 through 2,147,483,647. An idle timeout triggers `onclose`; it is not reported through `onerror`. Native EventSource hides raw bytes, comments, and event names without listeners. These do not refresh the deadline. Keep the server's heartbeat interval below the timeout, or disable idle detection for streams without observable heartbeats.

```js
const connection = createSseConnection('/events', {
  withCredentials: true,
  idleTimeoutMs: 90_000,
  heartbeatEvent: 'ping',
  decode: data => data // Deliver raw text instead of JSON.
});
```

The client has no connection cache or visibility handling. Native EventSource uses GET and provides no options for request bodies or arbitrary headers; authenticate with an appropriate session mechanism. Native error events do not expose HTTP status or response bodies. Identical consecutive events are delivered individually, and a failing listener does not prevent delivery to other listeners.

### Migrate from the Fetch client

Change the SSE route from POST to GET and remove the `fetch` option. Move request-header authentication to a mechanism supported by EventSource, such as session cookies; use `withCredentials` for credentialed cross-origin requests. Supply an `eventSource` constructor if your runtime does not provide one. Existing subscriptions, disposers, and `onclose({ connect })` retry policies retain their roles.

The idle timeout now observes subscribed events and the configured heartbeat instead of raw bytes. Comment-only heartbeats no longer keep an attempt alive. The standalone parser's frame limit does not apply to the native client; the browser or injected implementation owns parsing.

## Parser API

`createSseParser(dispatch, maxFrameSize?)` accepts incremental string chunks through `push()`:

```js
import { createSseParser } from 'minksse/parser';

const parser = createSseParser(({ event, data, id }) => {
  console.log(event, data, id); // Raw strings; no JSON decoding.
});
parser.push('event: tick\ndata: {"time":1}\n\n');
```

The parser handles CR, LF, CRLF, split line endings, an initial BOM, comments, IDs, multiline and empty data, and Unicode boundaries. If you read network bytes directly, decode them with a streaming `TextDecoder` before calling `push()`. An unterminated event is not dispatched at EOF.

## Limits

- `SSE_MAX_BUFFER_BYTES`, exported from `minksse/server` and `minksse`, is **256 KiB** of queued serialized UTF-8 wire bytes per connection, including prefetched data. Oversized events and slow consumers terminate the stream. Network and adapter buffers are separate.
- The parser's default frame limit is **1,048,576 Unicode code points**. A custom limit must be a positive safe integer; invalid limits throw `RangeError`. Exceeding the limit throws an error.
- These are transport budgets, not total process memory limits.
- Producer IDs start at `1` for each response. Heartbeats share the same ID sequence.
- Event names containing CR or LF are rejected. CR, LF, and CRLF in data are framed as separate data lines.

## Development and documentation

```sh
bun install
bun run build          # ESM JavaScript, source maps, and declarations
bun run check          # Strict JSDoc and public declaration checks
bun run test           # Build library and docs, then run all tests
bun run test:transport # Transport and package checks
bun run docs:build     # Build documentation
bun run docs:preview   # Serve documentation locally
bun run test:docs      # Documentation checks
bun run bench          # Parser and producer timing benchmarks
```

Read the [documentation](https://accntech.github.io/minksse/) for API references, framework lifecycle examples, and the [benchmark guide](https://accntech.github.io/minksse/benchmarks/). See the [site instructions](docs/site/README.md) to build and preview the documentation locally.

Source and executable tests are JavaScript. TypeScript is a development tool for checking JSDoc and generating declarations; `tests/types-consumer.js` verifies the types exposed to consumers. No TypeScript loader is needed at runtime.

Tests cover framing, parser boundaries, connection lifecycle, cleanup, byte budgets, resource retention, and Node imports of all public entry points. Some resource tests use Bun GC and fresh subprocesses. Benchmark results vary by runtime and machine and are not CI thresholds; pass an earlier build directory to `node scripts/benchmark.mjs` to compare it with `dist/`.

For HTTP comparisons against native SSE and other packages, follow the [comparison benchmark instructions](benchmarks/README.md). The [latest pure Web API comparison](benchmarks/README.md#tuned-web-api-producer-november-2-2026) covers all six projects across ASCII, 1 KiB, Unicode, and mixed-newline delivery. Matched before/after controls measured 14.5% higher median Unicode throughput and 41.0% higher multiline throughput. An explicit 64 KiB coalescing target improved the 1 KiB workload by 56.4% in a separate configuration sweep; the library default remains 0. Native Node remains faster in these measurements. Earlier reports involving the removed Node adapter and private hooks are historical.

## Benchmarks

Median validated **events per second**, November 2, 2026, Node v24.12.0 on Apple M4 Pro (macOS arm64). The producer remains pure Web APIs.

| Project | ASCII, 1 client | ASCII, 16 clients | 1 KiB, 16 clients | Unicode, 16 clients | Mixed CR/LF, 16 clients |
| --- | ---: | ---: | ---: | ---: | ---: |
| Native Node HTTP | 607,606 | 1,873,650 | 786,661 | 1,396,654 | 1,531,046 |
| MinkSSE | 564,248 | 1,661,741 | 761,475 | 1,245,703 | 1,308,942 |
| Better SSE | 508,343 | 1,313,566 | 546,618 | 961,753 | Failed† |
| Fastify SSE | 401,918 | 760,532 | 491,757 | 621,791 | Failed† |
| Hono | 231,218 | 341,875 | 273,532 | 322,399 | 329,728 |
| sveltekit-sse | 236,516 | 340,643 | 274,399 | 312,845 | Failed† |

MinkSSE uses **64 KiB coalescing for 1 KiB events and 16 KiB elsewhere**; the library default is **0 (off)**. Sixteen-client cases use four loader workers, batches of 16, and six or seven measured repeats. MinkSSE reached 96.8% of native median throughput for 1 KiB events; native remains faster. These finite loopback HTTP producer measurements include independent client validation and differing framework integrations. They do not measure client-wrapper overhead or establish production capacity.

† Failures concern the specific raw mixed-newline JSON configuration; compact JSON workloads passed. Failed configurations are excluded from that column’s successful run and are not scored as zero.

Read the [site benchmark guide](https://accntech.github.io/minksse/benchmarks/) for methodology, tuning, and downloadable reports, or the [repository benchmark documentation](benchmarks/README.md#tuned-web-api-producer-november-2-2026) for confidence intervals, raw samples, and reproduction commands.

## License

MinkSSE is [MIT licensed](LICENSE).
