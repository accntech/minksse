# Four-loader hot path optimization and fresh benchmarks

November 2, 2026 (Asia/Manila). Node v24.12.0, V8 13.6.233.17-node.37,
Apple M4 Pro, macOS arm64. Local uncommitted build.

## Outcome

The 18-repeat contemporaneous control improved four-loader median throughput
from **1,541,968 to 1,579,954 events/s (+2.46%)**.
Native measured 1,876,300 events/s: the new build
achieves **84.2% of native**, versus
82.2% before. Native parity has not been reached.

Every paired repeat favored the new build. Mean within-repeat improvement was
3.40%, with a Student-t 95% mean interval of
1.77% to 5.03%. Two unusually slow old-build trials increase the mean;
the median improvement above is the main result. All samples are retained.
Server CPU changed little; this is a modest throughput gain, not a large CPU reduction.

The separate all-project comparison measured MinkSSE at
**1,604,725 events/s**, **85.2% of native**.
Comparisons with old reports are affected by host-speed variation; use the
contemporaneous control to attribute improvement to this change.

## Profile and changes

The starting V8 profile identified repeated scalar dispatch in batches:
`emitValue` sampled 136.0 ms and `emitBatch` 89.2 ms, compared with
853.3 ms in `writev` and `writevGeneric`. An actual V8 inlining trace showed
`emitValue` had 1,636 bytecode bytes and was not considered for inlining.
The native queue also created/resolved a readiness promise for every empty-to-ready batch.

The final implementation:

- Uses a dedicated batch staging loop only after exclusive native queue attachment. It snapshots the trusted UTF-8 counter, fixed available budget and metadata once, and still validates each getter result before touching the next member. No partial batch or IDs publish before success.
- Uses one connection completion promise and a reusable pump for both queue readiness and socket drain. Producer notifications detach the pending callback before scheduling it. The Node adapter supplies `nextTick`; portable internal consumers retain `queueMicrotask`. Writes stay outside producer acceptance and reentrant getters.
- Keeps the terminal Web reader authoritative for successful completion versus errors; failures reject the pump directly, and cancellation clears the queue, pending readiness and drain listeners.

The final profile samples `stageNativeBatch` at 140.5 ms and `emitBatch`
at 58.2 ms. Socket vector writes still account for about 44% of sampled time;
owned string compaction and queue framing remain visible. Exact validation,
UTF-8/newline byte accounting, atomic staging and retained-string ownership
still add work beyond the minimal native writer. No safety check was removed.
Profiles include imports, warmup, measurement and shutdown, and are diagnostic,
not throughput rankings or repeatable estimates of individual function speedups.
See [profile summary](results/four-loader-hotpath-profile-summary.json),
[starting profile run](results/four-loader-scan-profile.json),
[final profile run](results/four-loader-hotpath-final-profile.json), and
[V8 inlining trace](results/four-loader-inlining-diagnostic.txt).

Selection controls are retained for the [batch loop](results/four-loader-tight-loop-selection.json),
[callback pump](results/four-loader-callback-selection.json), and
[Node scheduler](results/four-loader-scheduler-selection.json). Individual gains
were small and noisy; the combined 18-repeat control is the acceptance evidence.
A regex-based ASCII scan shortcut was rejected by the
[scan diagnostic](results/four-loader-scan-diagnostic.json). No shared payload cache was added.

## Controlled before/after

The [frozen prior build](fixtures/pre-scan-pass/README.md) and current build
use the same harness, workload and worker layout. Fresh server and loader pool
per trial, one full warmup, rotating candidate order, no retries or failed samples.
The primary workload uses 18 repeats; held-out workloads use six.
All three implementations deliver identical wire byte counts in each workload.

| Workload | Before events/s | After events/s | Native events/s | Median change | Before CPU ms | After CPU ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| primary | 1,541,968 | 1,579,954 | 1,876,300 | 2.46% | 220.58 | 219.88 |
| single | 574,775 | 564,055 | 622,666 | -1.87% | 35.42 | 35.28 |
| large | 610,643 | 628,342 | 781,435 | 2.90% | 145.63 | 143.80 |
| unicode | 1,163,914 | 1,171,488 | 1,422,087 | 0.65% | 286.63 | 289.03 |
| multiline | 1,249,769 | 1,270,881 | 1,534,183 | 1.69% | 267.63 | 267.44 |

Primary: four loaders, sixteen streams, 20,000 events/stream, 128-byte payload,
batch sixteen. Single: one loader and stream, otherwise identical. Large:
four loaders, sixteen streams, 5,000 events/stream, 1 KiB payload. Unicode and
multiline use the primary layout. Single-stream median throughput decreased
1.87% in this short held-out control, although server CPU was nearly unchanged;
this pass targets four-loader throughput and does not establish a single-stream improvement.
Unicode was nearly flat. Larger payloads and multiline improved modestly.

Raw: [primary control](results/four-loader-hotpath-final-control.json),
[paired statistics](results/four-loader-hotpath-final-paired.json),
[held-out controls](results/four-loader-hotpath-held-out.json).

## All-project comparison

Four loaders, sixteen streams, 20,000 events per stream, 128-byte ASCII payload,
batch sixteen, seven repeats. Figures are medians.

| Implementation | Events/s | Server CPU ms | RSS after MiB | First-event p95 ms |
| --- | ---: | ---: | ---: | ---: |
| Native Node SSE | 1,883,773 | 181.51 | 81.83 | 0.90 |
| MinkSSE (local) | 1,604,725 | 215.71 | 85.81 | 1.54 |
| Better SSE | 1,319,474 | 254.24 | 84.39 | 1.60 |
| Fastify SSE | 782,614 | 419.29 | 110.03 | 1.62 |
| Hono | 342,158 | 986.48 | 254.97 | 1.95 |
| sveltekit-sse | 344,979 | 997.44 | 114.78 | 2.26 |

| Implementation | Single stream events/s | 1 KiB events/s | Sparse events/s |
| --- | ---: | ---: | ---: |
| Native Node SSE | 611,801 | 705,489 | 12,124 |
| MinkSSE (local) | 551,093 | 566,419 | 12,367 |
| Better SSE | 524,729 | 506,536 | 12,056 |
| Fastify SSE | 432,827 | 468,462 | 12,066 |
| Hono | 245,598 | 266,046 | 11,574 |
| sveltekit-sse | 253,704 | 266,657 | 11,987 |

Single uses one loader, one stream, 20,000 events and seven repeats. The all-project
large workload uses four loaders, eight streams, 5,000 events and five repeats
(the controlled large workload uses sixteen streams). Sparse uses four loaders,
sixteen streams, 100 events, batch one, a 1 ms interval and five repeats. Sparse
is timer-limited; small throughput differences, including MinkSSE above native,
do not demonstrate higher sustained capacity.

All 144 measured all-project trials passed exact HTTP status, event count,
sequence, ID, event name and payload validation. No retries. One full warmup per
fresh server. Raw data include mean confidence intervals, every trial, package
versions, effective options, CPU/RSS, environment and source hashes:

- [Four-loader results](results/four-loader-hotpath-all-four-loader-2026-11-02.md) · [JSON](results/four-loader-hotpath-all-four-loader-2026-11-02.json)
- [Single-stream results](results/four-loader-hotpath-all-single-2026-11-02.md) · [JSON](results/four-loader-hotpath-all-single-2026-11-02.json)
- [Large-payload results](results/four-loader-hotpath-all-large-2026-11-02.md) · [JSON](results/four-loader-hotpath-all-large-2026-11-02.json)
- [Sparse results](results/four-loader-hotpath-all-sparse-2026-11-02.md) · [JSON](results/four-loader-hotpath-all-sparse-2026-11-02.json)

## Guarantees and verification

Validation, sequential getter access, atomic publication, exact 262,144-byte
queued-plus-prefetched limits, coalescing bounds, owned retained strings and
exactly-once cleanup remain enforced. No public API, default coalescing target,
queue capacity or payload cache changed. Generic Web streams, clones and
transforms retain their existing byte delivery path. Node wakeup ordering now
uses nextTick, so relative ordering versus Promise reactions differs; the pump
does not continuously reschedule itself while idle.

The new tests first observed missing readiness support, five per-batch waits,
1,024 capability reads for a 1,024-member batch, and use of the portable scheduler.
They now check deferred writes, no lost rearm wakeups, idle termination,
inline/reentrant destination failures, drain cleanup, exact byte counts,
Unicode/lone-surrogate/control-character normalization, queue backlog and
coalescing on/off. Existing exact-limit, overflow, ownership/GC, getter reentry,
reader lock and error cleanup tests also pass.

Passed: `npm run check`, **209 transport tests**, **32 benchmark harness tests**,
and **8 documentation tests** (249 tests total). Browser bundles of the root and
server entries exclude the Node adapter; the packed npm artifact passed a real
Node HTTP smoke with deferred Unicode/multiline events and exactly-once cleanup.
All final benchmark hashes match the current three compiled implementation modules.
`git diff --check` passes. No commit was created.

A Senior Developer implemented the bounded callback pump, an API Tester added
readiness/error regression cases, and an independent code reviewer checked the
final scheduling and native staging guards. Root integrated, expanded tests,
profiled and ran all measurements.

## Scope and reproduction

These are local loopback finite-stream benchmarks on a shared host. They measure
framing and HTTP delivery with independent client validation, not production
network capacity, replay, broadcasts, package clients, slow readers or SvelteKit
routing/build. Hono and Fastify include their routers. First-event p95 is the
median per-trial request-to-first-validated-event p95, not per-event latency.
RSS includes imports and warmup. Better SSE uses three fewer optional SSE spaces
per event, so all-project byte counts differ while logical messages are equal.
MinkSSE uses its opt-in 16 KiB coalescing and public batch API. Native and Better
also batch; Hono/Fastify use their selected per-event APIs. See effective setups
and pinned dependency versions in JSON; these are installed-version comparisons,
not a claim about the latest published versions.

```sh
npm run build
CASES=primary REPEATS=18 OUTPUT=results/four-loader-hotpath-final-control.json node --conditions=svelte benchmarks/experiments/four-loader-hotpath.mjs
npm --prefix benchmarks run bench -- --loaders=4 --clients=16 --events=20000 --repeats=7 --output=results/four-loader-hotpath-all-four-loader-2026-11-02.json
npm --prefix benchmarks run bench -- --loaders=1 --clients=1 --events=20000 --repeats=7 --output=results/four-loader-hotpath-all-single-2026-11-02.json
npm --prefix benchmarks run bench -- --loaders=4 --clients=8 --events=5000 --bytes=1024 --repeats=5 --output=results/four-loader-hotpath-all-large-2026-11-02.json
npm --prefix benchmarks run bench -- --loaders=4 --clients=16 --events=100 --batch=1 --interval=1 --repeats=5 --output=results/four-loader-hotpath-all-sparse-2026-11-02.json
```

Final compiled SHA-256:

    server.js f654ec35debd37f86e0cb88c4a9c795cc23787e3496a9cb034e2459d861de042
    node.js 22f067485cc08cbe761c5cdfebe97195d766fe2d26cc01c15e36688b09084fdd
    producer-capabilities.js 3c54d52ebc7ee5cef22c1f4d3d620c6b29447ed3c5ae36ca6bda23c6cd7fcab5
