# Node adapter and output coalescing: implementation and rerun

November 1, 2026. Node v24.12.0, Apple M4 Pro, macOS arm64.

This report captures the initial adapter/coalescing implementation before the
explicit batch API. See the [subsequent native-gap pass](NATIVE-PERFORMANCE.md)
for current source changes and fresh scalar/batch/multi-loader comparisons.

## Implemented APIs

- **`writeSseResponse(response, destination, { signal }?)` from `minksse/node`.**
  Direct Web reader to Node HTTP/1 response, immediate header flush, status and
  separate Set-Cookie preservation, backpressure, and completion after `finish`.
  It rejects/cancels on abort, premature disconnect, external premature end,
  invalid headers, or source failure. Cancellation does not await an
  uncooperative source cancel promise. All paths release the reader lock and
  adapter listeners. Browser entry points do not re-export the Node helper.
- **`produce(start, { coalesceBytes })`.** Default **0/off** preserves existing
  per-event output chunks. A positive integer through 262,144 combines only
  already queued complete frames when the consumer pulls. A larger single event
  stays whole. No timer or wait-for-batch behavior is added, and the first sparse
  event remains immediate. The 256 KiB total queued/prefetched wire budget,
  cleanup, cancellation behavior and independently owned output bytes remain.

```js
import { produce } from 'minksse/server';
import { writeSseResponse } from 'minksse/node';

// Inside a Node HTTP request handler, before sending destination headers:
const response = produce(({ emit, lock }) => {
  emit('ready', JSON.stringify({ connected: true }));
  lock.set(false);
}, { coalesceBytes: 16_384 });
await writeSseResponse(response, destination); // Catch disconnect/source errors.
```

The adapter's `finish` resolution means Node handed bytes to the operating
system; it does not prove remote receipt. The helper does not implement routing
or construct a Web request. Full usage and errors are documented in the
[project README](../README.md#node-http-adapter) and generated producer reference.

## Fresh all-package comparison

Five independent fresh server processes per candidate, one complete warmup each,
20,000 events per client, 128 ASCII payload bytes plus JSON/SSE framing, common
batch size 16. Every stream passed independent HTTP/MIME/count/order/payload
validation. Candidate order rotates between repeats. Higher throughput is better.

| Implementation and setup | 1 client events/s | 16 clients events/s |
| --- | ---: | ---: |
| Native Node (batched) | 621,819 | 1,653,594 |
| Hono + official Node adapter | 241,095 | 337,417 |
| Fastify + @fastify/sse | 414,398 | 872,570 |
| Better SSE (batch API) | 524,868 | 1,547,472 |
| sveltekit-sse + Kit response writer | 251,025 | 321,513 |
| MinkSSE + Node adapter + 16 KiB coalescing | 471,979 | 1,131,042 |

Raw samples, confidence intervals, CPU/RSS and source/lock hashes:
[1 client](results/implemented-clients-1.md),
[16 clients](results/implemented-clients-16.md), with adjacent JSON.
Other packages retain the tuned APIs from the preceding investigation; MinkSSE
now uses the public adapter and explicitly opts into 16 KiB coalescing. The
library default remains off. SvelteKit's full router and browser stores remain
outside this producer comparison.

## Isolate the two changes

Same 16-client × 20,000-event workload, five repeats per path. First-event p95
is the median of each trial's nearest-rank p95 across clients.

| MinkSSE setup | Median events/s | Median server CPU | First event p95 |
| --- | ---: | ---: | ---: |
| Old pipeline bridge; coalescing off | 280,488 | 1,177 ms | 3.01 ms |
| Previous minimal direct bridge; coalescing off | 606,297 | 565 ms | 1.86 ms |
| Supported Node adapter; coalescing off | 612,574 | 567 ms | 1.95 ms |
| Supported Node adapter; 16 KiB coalescing | 1,131,042 | 313 ms | 1.27 ms |

The supported adapter with coalescing off performs similarly to the prior direct
bridge, while adding eager headers, tested disconnect/abort behavior and an
awaited finish contract. That comparison does not isolate each lifecycle check,
but it shows no material throughput penalty in this workload.

With the same supported adapter, coalescing improves throughput
**1.85×** and reduces server CPU from
**567 ms to 313 ms**
(about **45% lower**).
Against the original pipeline integration, the combined improvement is
**4.03×**. This is an end-to-end local HTTP result,
not a claim that framing alone became that much faster.

Ablations:
[pipeline off](results/mink-pipeline-unbatched.md),
[old direct off](results/mink-direct-unbatched.md),
[public adapter off](results/mink-node-unbatched-16.md).

## Payload and sparse-traffic checks

Coalescing off/on below uses the **same public adapter**. Bulk single-client
runs use five repeats; larger payload and sparse runs use three.

| Workload | Off events/s | On events/s | Ratio |
| --- | ---: | ---: | ---: |
| 1 client × 20,000 events, 128-byte payload | 333,978 | 471,979 | 1.41× |
| 8 clients × 5,000 events, 1 KiB payload | 315,020 | 433,940 | 1.38× |
| 16 clients × 100 events, 1 ms between individual events | 11,571 | 10,746 | 0.93× |

Coalescing improves the larger-payload workload by about
38% in this run. Sparse traffic has almost
no queued backlog to combine, and the first sparse comparison was slower with
coalescing. It should not be sold as a sparse-traffic optimization.

To investigate that observation, an additional alternating off/on experiment
used **seven fresh processes per variant**, one warmup each, with 16 clients ×
100 events and 1 ms spacing. Median throughput was
10,671/s off versus
10,560/s on.
The per-trial first-event p95 medians were
1.20 ms off and
1.67 ms on. Mean paired
p95 difference was 0.19 ms, with a descriptive
95% Student-t interval of
[-0.13, 0.52] ms.
The interval includes zero: neither latency equivalence nor a reliable latency
regression is established. Tests prove no intentional batching wait; they do
not guarantee identical operating-system scheduling. Leave coalescing off for
sparse-only streams unless your own workload benefits.

[Paired sparse raw samples and order](results/mink-sparse-paired.json).
Full all-package checks: [1 KiB payload](results/implemented-large-payload.md),
[sparse](results/implemented-sparse.md). Off controls:
[single client](results/mink-node-unbatched-1.md),
[1 KiB](results/mink-node-unbatched-large.md),
[sparse](results/mink-node-unbatched-sparse.md).

## Default-path regression check and profile

The pre-change compiled producer was saved before implementation. Its SHA-256
matches the preceding investigation's source hash. The existing alternating
microbenchmark used seven samples after three warmups, with coalescing **off**:

| Task | Before | After |
| --- | ---: | ---: |
| Parser, batched | 32.48 ms | 32.40 ms |
| Parser, fragmented | 7.27 ms | 7.04 ms |
| Producer, drained | 5.99 ms | 5.95 ms |

These small differences are noise-level, supporting unchanged default behavior
without establishing a speedup. [Recorded microbenchmark](results/default-path-microbenchmark.json).

A separate full-lifetime V8 profile of the public adapter plus coalescing includes
startup and warmup; its instrumented throughput is excluded from ranking.
[Profile summary and raw-file hash](results/profile-coalesced-summary.json),
[profile workload/source metadata](results/profile-mink-coalesced.json).
It still samples socket writes, encoding and producer framing/queue work.
Sampled leaf shares are not exact CPU accounting, and changed proportions after
speedup cannot be treated as per-function regressions. No speculative encoder
or ownership changes were included in this implementation.

## Correctness and packaging verification

Tests were written and observed failing before implementation, then passed.
Integration caught and fixed a real normal-finish/abort race. Independent review
also checked the subsequent premature-external-end regression and final fix.

Checks run after integration:

- `npm run check`: generated ESM/declarations and strict type/consumer checks pass.
- `bun run test:transport`: **98 tests pass**, including the existing suite,
  **14 real Node HTTP adapter cases** and **16 coalescing cases**.
- `npm --prefix benchmarks test`: **13 tests pass**, all six real packages,
  all public adapters, coalescing variants, failure paths and profile flushing.
- `npm run test:docs`: **8 tests pass**, including parsed README examples,
  generated links and published source-derived declarations.
- A packed tarball installed in a fresh temporary consumer with no runtime
  dependencies; `minksse/node` and coalescing work outside the checkout.
- `git diff --check`: passes.

Adapter coverage includes actual socket backpressure/close, abort during pending
reads, exact-once producer cleanup, early/external finish, original body errors,
pre-aborted/preclosed destinations, invalid headers, separate cookies, eager
headers and finish/close/abort races. Coalescing covers default compatibility,
UTF-8/multiline framing, target boundaries and oversized individual events,
unencoded unread backlog, queue/prefetch budgets, final partial groups,
finish/abort/cancel/error cleanup, independent transferable buffers, and retained
slice memory in **both Node and Bun**. Tests use more generous timeout deadlines
and event synchronization where a reviewer identified a small CI timing risk.

Two implementation specialists owned the independent adapter and producer
changes. A Code Reviewer independently reviewed both and reran all 30 focused
feature cases without participating in measured timings.

## Reproduce

```sh
npm run build
npm --prefix benchmarks ci --ignore-scripts
npm run bench:compare -- --clients=16 --events=20000 --repeats=5
npm run bench:compare -- --targets=minksse --coalesce=0 --clients=16 --events=20000 --repeats=5
npm run bench:compare -- --targets=minksse --bridge=pipeline --coalesce=0 --clients=16 --events=20000 --repeats=5
```

Results are workload-specific. Both processes share one machine; client parsing,
loopback sockets, timer granularity, scheduler/thermal state and setup-order
bias can influence scores. These finite tests do not prove production capacity,
slow-consumer longevity or a universal best coalescing target. Package
implementations, framing and backpressure policies differ. Every report records
configuration and hashes so future runs can be distinguished from these.
