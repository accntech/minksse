# Changelog

## 0.2.0 — 2026-11-02

### Breaking changes

- The client now wraps native `EventSource` over GET instead of using a POST Fetch transport. Serve a GET SSE endpoint. Custom Fetch overrides and POST request options are no longer supported.
- The client requires a native `EventSource` implementation or a compatible constructor supplied through `eventSource`. Configure credentials through `withCredentials` and payload decoding through `decode`.
- Removed the development Node adapter’s `minksse/node` entry point, `writeSseResponse()`, and private Node adapter hooks. Return `produce()`'s streaming Web `Response` through your runtime or framework and propagate request aborts or response cancellation.

- Idle timeouts now observe subscribed events and the configured heartbeat event rather than raw bytes. Comment-only heartbeats do not refresh the deadline. Native EventSource owns client framing, so the former client parser frame limit no longer applies.

### Features and improvements

- Added atomic `emitBatch()` production and opt-in `coalesceBytes` for fewer output chunks during bursts. Coalescing defaults to 0 (off); the queued serialized UTF-8 wire limit remains 256 KiB per stream.
- Optimized portable batch staging, Unicode encoding, and multiline normalization using standard Web APIs. No runtime-specific HTTP adapter or runtime dependencies are included.
- Added configurable native EventSource subscriptions, listener isolation, event-idle detection, cleanup, and application-controlled reconnection. Subscriptions survive reconnects; missed-event replay is not included.
- Added a benchmark guide to the documentation site, including six-project comparisons, downloadable reports and raw samples, settings, and reproduction commands.

### Validation and performance

- Updated producer, client, package, resource, and migration tests; portability checks cover Node, Bun, and Deno.
- Matched 16 KiB controls measured 14.46% higher median Unicode throughput and 41.03% higher multiline throughput. A separate coalescing sweep measured a 56.4% median gain for 1 KiB events when choosing 64 KiB instead of 16 KiB; this is a configuration gain, not a default change.
- MinkSSE reached 96.8% of native Node's median throughput in the tuned 1 KiB workload. Native Node remains faster in the measured comparisons. These are finite Node-hosted loopback results, not production capacity guarantees.

See [benchmark methodology and raw results](https://github.com/accntech/minksse/blob/main/benchmarks/README.md#tuned-web-api-producer-november-2-2026) and the [migration guide](https://github.com/accntech/minksse/blob/main/README.md).
