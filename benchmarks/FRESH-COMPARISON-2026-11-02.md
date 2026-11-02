# Fresh SSE project comparison — November 2, 2026

All six implementations were rerun against the same installed dependency graph.
MinkSSE uses the current **uncommitted native queue prototype**, compiled before
measurement. This is not a published-release ranking. No optimization source was
changed during this benchmark request.

Node v24.12.0 · Apple M4 Pro · macOS arm64
(Darwin 27.2.0) · HTTP/1.1 over loopback.
Primary run started 02/11/2026, 08:30:55 Asia/Manila.

## Four-loader result

16 concurrent streams, 20,000 events each (320,000 total), 128-byte ASCII payload,
batches of 16, seven measured repeats. Each fresh server completes one full
warmup first. Figures below are medians. Server CPU is per measured workload;
RSS includes loaded dependencies and warmup.

| Implementation | Events/s ↑ | Server CPU ms ↓ | RSS after MiB | First-event p95 ms |
| --- | ---: | ---: | ---: | ---: |
| Native Node SSE | 1,879,556 | 182.38 | 81.80 | 1.00 |
| MinkSSE (local prototype) | 1,499,828 | 226.05 | 84.52 | 2.07 |
| Better SSE | 1,327,718 | 254.62 | 84.28 | 1.57 |
| Fastify SSE | 777,609 | 421.48 | 110.22 | 1.48 |
| Hono | 339,058 | 1007.10 | 255.61 | 2.02 |
| sveltekit-sse | 332,425 | 1022.86 | 114.25 | 2.80 |

MinkSSE measured 79.8% of native throughput and 13.0% above Better SSE. It had the highest median throughput among the libraries in this run. MinkSSE and Better SSE mean confidence intervals overlap slightly, so the 13% median difference is an observation rather than a statistically established universal ranking. This comparison alone does not prove a regression or speedup over another MinkSSE build, since no earlier MinkSSE build was included as a concurrent control.

## Other workloads

Rates are median events/s. Single-stream uses 20,000 events, one loader, and seven
repeats. Large payload uses eight streams, four loaders, 5,000 events each, 1,024
payload bytes and five repeats. Sparse uses sixteen streams, four loaders, 100
events each, batch one, 1 ms between batches and five repeats. Sparse rates are
timer-limited; single-loader rates can be client-limited.

| Implementation | Single stream | 1 KiB payload | Sparse, 1 ms |
| --- | ---: | ---: | ---: |
| Native Node SSE | 603,698 | 674,503 | 12,747 |
| MinkSSE (local prototype) | 552,263 | 508,672 | 12,324 |
| Better SSE | 532,479 | 493,927 | 12,355 |
| Fastify SSE | 425,308 | 448,535 | 12,332 |
| Hono | 243,510 | 258,705 | 11,647 |
| sveltekit-sse | 249,092 | 253,831 | 12,237 |

Server CPU medians for these workloads:

| Implementation | Single stream ms | 1 KiB payload ms | Sparse ms |
| --- | ---: | ---: | ---: |
| Native Node SSE | 28.13 | 64.96 | 25.25 |
| MinkSSE (local prototype) | 36.57 | 92.88 | 27.66 |
| Better SSE | 26.62 | 87.60 | 28.17 |
| Fastify SSE | 46.11 | 101.49 | 28.75 |
| Hono | 102.53 | 192.52 | 37.98 |
| sveltekit-sse | 93.65 | 184.33 | 31.30 |

## Setup and verification

- Sequential trials with rotated candidate order; no concurrent benchmark or test processes.
- Four persistent loader workers in each four-loader trial, warmed before measurement.
- Pre-serialized JSON payloads for all implementations; framing and delivery remain inside timing.
- Native uses batch writes; Better SSE uses its public batch API; MinkSSE uses public `emitBatch()` and its public Node adapter with opt-in 16 KiB coalescing. Hono and Fastify use their selected public SSE APIs.
- The current private MinkSSE queue is reached through public APIs; ordinary Web responses and wrapped/clone fallback paths remain byte streams.
- SvelteKit routing and application build time are excluded; its published SSE producer is exercised.
- Independent validation checks HTTP status/content type, UTF-8 JSON payload, event IDs, order, and exact final count. Better SSE omits optional spaces after field colons and sends three fewer bytes per event; the logical events match, but wire sizes are not identical.
- All **144 measured trials passed**: 42 primary, 42 single-stream, 30 large-payload, 30 sparse. No server fatal errors were reported. Warmup passes were validated too.
- `npm run check`, 158 transport tests, eight explicitly invoked native-queue tests, and 32 benchmark tests passed before measurement (198 tests). The native-queue file is explicitly invoked because it is not yet in `test:transport`.
- The three built MinkSSE module hashes match those recorded in every report.

First-event p95 is the median across trials of request-to-first-validated-event p95 over the streams, using warmed connections. It is not per-event latency. Report confidence intervals describe sample variability; these local results are not universal capacity guarantees.

The Performance Benchmarker specialist independently recomputed the medians and checked trial counts, event totals, server errors and formatting differences. Its audit found no discrepancies.

## Versions

- hono: 4.13.16
- @hono/node-server: 2.1.5
- fastify: 5.12.7
- @fastify/sse: 0.6.1
- better-sse: 0.16.1
- sveltekit-sse: 0.15.1
- svelte: 5.57.3
- @sveltejs/kit: 2.70.3

## Artifacts

- four-loader: [summary](results/fresh-all-four-loader-2026-11-02.md), [raw samples, environment, hashes and effective setup](results/fresh-all-four-loader-2026-11-02.json).
- single: [summary](results/fresh-all-single-2026-11-02.md), [raw samples, environment, hashes and effective setup](results/fresh-all-single-2026-11-02.json).
- large: [summary](results/fresh-all-large-2026-11-02.md), [raw samples, environment, hashes and effective setup](results/fresh-all-large-2026-11-02.json).
- sparse: [summary](results/fresh-all-sparse-2026-11-02.md), [raw samples, environment, hashes and effective setup](results/fresh-all-sparse-2026-11-02.json).

## Reproduce

With the checked-out source and dependencies installed:

```sh
npm run check
bun run test:transport
bun test tests/native-queue.test.js
npm --prefix benchmarks test
npm --prefix benchmarks run bench -- --loaders=4 --clients=16 --events=20000 --bytes=128 --batch=16 --interval=0 --repeats=7 --warmup=1 --output=results/fresh-all-four-loader-2026-11-02.json
npm --prefix benchmarks run bench -- --loaders=1 --clients=1 --events=20000 --bytes=128 --batch=16 --interval=0 --repeats=7 --warmup=1 --output=results/fresh-all-single-2026-11-02.json
npm --prefix benchmarks run bench -- --loaders=4 --clients=8 --events=5000 --bytes=1024 --batch=16 --interval=0 --repeats=5 --warmup=1 --output=results/fresh-all-large-2026-11-02.json
npm --prefix benchmarks run bench -- --loaders=4 --clients=16 --events=100 --bytes=128 --batch=1 --interval=1 --repeats=5 --warmup=1 --output=results/fresh-all-sparse-2026-11-02.json
```
