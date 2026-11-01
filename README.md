# MinkSSE

Dependency-free Server-Sent Events transport written in native JavaScript using Web APIs. A small ESM package with a POST client, incremental parser, and streaming `Response` producer, with TypeScript declarations generated from JSDoc.

The runtime has no framework, Node-specific, or third-party imports. It uses `fetch`, `ReadableStream`, `Response`, `AbortController`, `TextEncoder`, and `TextDecoder`. Use a modern browser or server runtime that provides those APIs; the test suite runs with Bun and includes Node.js interoperability checks.

## Local installation

This checkout is prepared for publication as `minksse@0.1.0`. Publication has not been performed. Build and install it from the local directory:

```sh
cd /path/to/minksse
bun install
bun run build

# From the consuming application:
npm install /absolute/path/to/minksse
```

For a portable package archive, run `npm pack` in this checkout, then install the resulting `minksse-0.1.0.tgz` in your application.

```js
import { produce, SSE_MAX_BUFFER_BYTES } from 'minksse/server';
import { createSseConnection } from 'minksse/client';
import { createSseParser } from 'minksse/parser';
```

All public functions and types are also exported from `minksse`. The package ships ESM JavaScript and generated declarations under `dist/`; CommonJS output is not provided.

## Server

Return the producer's `Response` from a POST route in your server framework:

```js
import { produce } from 'minksse/server';

export function handleEvents(request) {
  // Authenticate and authorize the request before creating the stream.
  return produce(({ emit }) => {
    const timer = setInterval(() => {
      emit('tick', JSON.stringify({ time: Date.now() }));
    }, 1_000);
    return () => clearInterval(timer);
  }, { signal: request.signal });
}
```

`produce(start, options?)` runs synchronous setup and accepts an optional returned cleanup function. Setup receives:

| Control | Behavior |
| --- | --- |
| `emit(event, data)` | Accepts strings; returns `{ error: false }` or `{ error: Error }`. Serialize application payloads with `JSON.stringify` for the bundled client. |
| `lock.set(false)` | Finishes the stream and drains accepted frames before EOF. |

| Option | Default | Behavior |
| --- | --- | --- |
| `signal` | — | Aborts the stream and releases resources when cancelled. |
| `ping` | `30_000` | Heartbeat interval in milliseconds; integer from 1 through 2,147,483,647. |
| `headers` | — | Additional response headers. |
| `onStop` | — | Caller cleanup on every terminal path, including preaborted requests, invalid configuration, and failed setup. |

Cleanup runs exactly once on normal finish, abort, reader cancellation, setup failure, invalid emits, and queue overflow. A cleanup returned after synchronous termination still runs. Cleanup and `onStop` may return promises; termination does not await them, and failures produce console diagnostics without preventing the other finalizer.

Normal finish and abort drain previously accepted frames. Errors and reader cancellation discard the backlog. Invalid heartbeat values throw `RangeError` before setup and still invoke `onStop`.

## Client

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

const unsubscribe = connection.subscribe('tick', value => {
  console.log(value); // Parsed JSON; narrow or validate before use.
});

// Call when the owning page or component is disposed.
function dispose() {
  clearTimeout(retry);
  unsubscribe();
  connection.close();
}
```

Connections start in a microtask so listeners can register first. The client sends POST with `Accept: text/event-stream` and `cache: no-store`. Each named event's data is parsed as JSON. Empty `ping` heartbeats are delivered as `''`; malformed application JSON is reported through `onerror` and skipped.

Each `subscribe(name, listener)` call returns an independent disposer, even when registrations share a callback. Identical consecutive events are delivered individually. Delivery snapshots registrations per event; newly registered listeners receive subsequent events, and registrations removed before their turn are skipped.

`connection.closed` indicates permanent local closure. `close()` aborts the request, cancels the reader, clears listeners and timers, and suppresses future recovery callbacks. Always close a connection when its owner is disposed.

| Client option | Behavior |
| --- | --- |
| `fetch` | Optional replacement for global `fetch`; useful for runtime integration and testing. |
| `idleTimeoutMs` | Maximum byte-idle time, default 75,000 ms. Same integer range as server `ping`. Empty chunks do not extend it. |
| `onopen` | Observes a successful response with SSE content type. |
| `onclose({ connect })` | Runs after nonlocal termination. The caller controls retry timing. `connect()` resolves when that attempt ends; `onopen` signals readiness. |
| `onerror(cause)` | Receives transport, parser, JSON, and callback failures. Error-observer failures produce console diagnostics. |

Only one request is active at a time. Transport termination aborts before cancelling the reader, and retry readiness does not wait for an underlying cancellation promise. Retry policy, authentication, authorization, session expiry, and durable catch-up belong to the application. There is no replay or `Last-Event-ID` resume behavior.

## Parser

```js
import { createSseParser } from 'minksse/parser';

const parser = createSseParser(({ event, data, id }) => {
  console.log(event, data, id); // Raw strings; no JSON decoding here.
});
parser.push('event: tick\ndata: {"time":1}\n\n');
```

`createSseParser(dispatch, maxFrameSize?)` accepts incremental string chunks. It handles CR, LF, CRLF, split line endings, an initial BOM, comments, IDs, multiline data, empty data, and Unicode boundaries. If processing network byte chunks directly, use a streaming `TextDecoder` before calling `push`. EOF does not dispatch an unterminated event.

## Limits and behavior

- Producer IDs start at 1 for each response. Heartbeats are named empty `ping` events in the same sequence.
- Event names containing CR or LF are rejected. CR/LF/CRLF data lines are framed safely.
- `SSE_MAX_BUFFER_BYTES` is 256 KiB of queued serialized UTF-8 wire bytes per connection, including prefetched data. Oversized events and slow consumers terminate the stream. Network and adapter buffers are separate.
- Demand-driven encoding keeps at most one encoded frame ahead of reader demand. Remaining frames use compact owned strings; exposed byte buffers are independent.
- The parser's default frame budget is 1,048,576 Unicode code points. A custom limit must be a positive safe integer. Invalid limits throw `RangeError`; exceeding a limit throws an error.
- Queue and frame budgets are transport limits, not total process heap limits.
- This is a focused transport API, not the complete `sveltekit-sse` API. It has no Svelte stores, connection cache, visibility handling, configurable client method/body/headers, or automatic retry scheduler.

## Development

```sh
bun install
bun run build          # Comment-free ESM JavaScript, source maps, and declarations
bun run check          # Strict JSDoc source and declaration-consumer type check
bun run test:transport # Self-contained transport and package checks
bun run test           # Build library and docs, then run all tests
bun run docs:build     # Build the local documentation website
bun run docs:preview   # Preview the documentation website
bun run test:docs      # Documentation checks
```

`bun run test` builds the package and documentation, then runs all tests. Tests cover streaming and framing, parser boundaries, client lifecycle and failure recovery, cleanup, byte budgets, demand-driven encoding, retained resources, and Node imports of all four public entry points. Some resource tests deliberately use Bun GC and fresh subprocesses; they are regression checks rather than production capacity benchmarks.

Source modules in `src/` and executable tests are native JavaScript. Node can import `src/index.js` directly without a build or TypeScript loader. The build retains separate ESM modules for tree shaking and strips comments from runtime output. TypeScript is a development-only tool for strict JSDoc checking and declaration generation; `tests/types-consumer.ts` is an intentional compile-only compatibility fixture.

The implementation retains bounded parser compaction, one live idle timer per request, demand-driven encoding, compact owned queue strings, and bounded framing caches. Converting source syntax alone does not imply faster execution. Run `bun run bench` (or `node scripts/benchmark.mjs`) for parser and producer timing medians; pass a directory containing an earlier build to compare it with `dist/`. Results vary by runtime and machine and are not CI thresholds.

To rebuild the icon, run `python3 scripts/build-icon.py` with Pillow installed. The script preserves the white mink and SSE artwork from `assets/icon-artwork.png`, applies solid Svelte orange (`#FF3E00`), and creates a symmetric fourth-power squircle with transparent exterior corners. Pass `--preview /path/to/review.png` to inspect the icon on white, dark, and checkerboard backgrounds at several sizes.

## Origin and license

Extracted from the dependency-free `packages/sse` transport in the local GRABM project. The extraction preserves the transport implementation and its self-contained regression tests; package imports and build output are adapted for standalone ESM consumption.

Package and documentation tooling patterns were adapted from the local MinkExcel project. Its MIT copyright attribution is retained in [LICENSE](LICENSE). MinkSSE is MIT licensed.
