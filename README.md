<img src="assets/icon.png" alt="MinkSSE icon" width="96" height="96">

# MinkSSE

Server-Sent Events for JavaScript applications: produce a streaming Web `Response`, subscribe to named events over POST, or parse SSE text directly. Zero runtime dependencies, native JavaScript ESM, and TypeScript declarations generated from JSDoc.

MinkSSE uses Web APIs and works independently of a frontend or server framework. You own each connection, its cleanup, and its retry policy.

| API | Purpose |
| --- | --- |
| `produce()` | Send named events from a server as an SSE `Response`. |
| `createSseConnection()` | Open a POST stream and deliver subscribed events as parsed JSON. |
| `createSseParser()` | Parse incremental SSE text into raw event, data, and ID strings. |

## Install from this checkout

Build the package before installing it into your application:

```sh
# In the MinkSSE checkout:
bun install
bun run build

# In your application:
npm install /absolute/path/to/minksse
```

For a portable archive, run `npm pack` in the checkout, then install the generated `.tgz` file in your application. Packing builds the package automatically.

The package ships ESM JavaScript and declarations under `dist/`. All public functions and types are available from `minksse`, or from the focused `minksse/server`, `minksse/client`, and `minksse/parser` entry points. CommonJS output is not provided.

Use a runtime with Fetch, Streams, `Response`, `AbortController`, `TextEncoder`, and `TextDecoder` support. The server must support streaming Web Responses; Node HTTP servers need an adapter. Tests run with Bun and include Node.js interoperability checks.

## Quick start

### Serve events

Register this handler for `POST /events` using your server framework's routing API. It accepts a Web `Request` and returns a Web `Response`; it does not register a route by itself.

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

The connection starts automatically in a microtask, allowing subscriptions to register first. It sends POST with `Accept: text/event-stream` and `cache: no-store`.

Subscribed event data is parsed as JSON and delivered as an unknown value: validate its shape before using it. Malformed JSON is reported through `onerror` and skipped. Empty `ping` heartbeats are delivered as `''` if subscribed to. Use the parser directly when you need raw text.

Each subscription returns an independent disposer. `close()` permanently closes the connection, cancels its request and reader, and clears all listeners and internal timers. `connection.closed` reports permanent local closure, rather than whether a request is currently connected.

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

This example uses a fixed delay. Choose a retry policy appropriate to your application. `onclose` runs when an attempt ends, including normal EOF and failures, unless you called `close()`. Only one request is active at a time. `connect()` resolves when its attempt ends; use `onopen` to observe readiness. Subscriptions survive reconnects.

There is no replay or `Last-Event-ID` resume behavior. Authentication, session expiry, and catching up on missed events belong to the application. The browser's `EventSource` uses GET and cannot replace this POST client directly.

## Server API

`produce(start, options?)` returns a streaming `Response`. `start` runs synchronously and may return a cleanup function; it must not be an async function.

| Control | Behavior |
| --- | --- |
| `emit(event, data)` | Returns `{ error: false }` on acceptance or `{ error: Error }` on failure. Invalid input or queue overflow terminates the stream. |
| `lock.set(false)` | Finishes the stream after accepted frames drain. Cleanup runs immediately. |

| Option | Default | Behavior |
| --- | --- | --- |
| `signal` | — | Stops the stream on abort. |
| `ping` | `30_000` | Sends an empty named `ping` event at this interval in milliseconds. |
| `headers` | — | Overrides or adds response headers. Preserve `Content-Type: text/event-stream` for the bundled client. |
| `onStop` | — | Caller cleanup on every terminal path, including a preaborted request, invalid configuration, or failed setup. |

The returned cleanup function and `onStop` each run once. Normal finish, abort, reader cancellation, setup failure, invalid emits, and queue overflow release resources. A cleanup returned after synchronous termination still runs. Finalizers may return promises, but termination does not await them; failures are logged without blocking the other finalizer.

Normal finish and abort drain accepted frames. Errors and reader cancellation discard the backlog. `ping` must be an integer from 1 through 2,147,483,647; invalid values throw `RangeError` before setup and still invoke `onStop`.

## Client options

`createSseConnection(url, options?)` returns an object with `subscribe(name, listener)`, `close()`, and a read-only `closed` property.

| Option | Default | Behavior |
| --- | --- | --- |
| `fetch` | Global `fetch` | Replace the fetch implementation for request customization or testing. |
| `idleTimeoutMs` | `75_000` | Ends an attempt when no bytes arrive within this duration. Empty chunks do not extend it. |
| `onopen` | — | Called after a successful response with SSE content type and a readable body. |
| `onclose({ connect })` | — | Called after an attempt ends; lets the application schedule another attempt. |
| `onerror(cause)` | — | Receives transport, parser, subscribed JSON, and callback failures. Error-observer failures are logged. |

`idleTimeoutMs` must be an integer from 1 through 2,147,483,647. An idle timeout triggers `onclose`; it is not reported through `onerror`.

The client has no connection cache, visibility handling, or options for request method, body, or headers. Use a custom `fetch` implementation if you need to add request headers. Identical consecutive events are delivered individually, and a failing listener does not prevent delivery to other listeners.

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

Read the [documentation site instructions](docs/site/README.md) for preview details. The site includes framework lifecycle examples and the generated API declarations.

Source and executable tests are JavaScript. TypeScript is a development tool for checking JSDoc and generating declarations; `tests/types-consumer.js` verifies the types exposed to consumers. No TypeScript loader is needed at runtime.

Tests cover framing, parser boundaries, connection lifecycle, cleanup, byte budgets, resource retention, and Node imports of all public entry points. Some resource tests use Bun GC and fresh subprocesses. Benchmark results vary by runtime and machine and are not CI thresholds; pass an earlier build directory to `node scripts/benchmark.mjs` to compare it with `dist/`.

## License

MinkSSE is [MIT licensed](LICENSE).
