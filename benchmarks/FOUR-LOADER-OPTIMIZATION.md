# Four-loader Node optimization

November 2, 2026 (Asia/Manila) · Node v24.12.0 · Apple M4 Pro · macOS arm64.

## Results

Across all **14 completed primary trials per implementation**, the final build
measures **1,464,188 events/s**, versus **1,348,558 before** and **1,905,892 native**:
**8.6% more throughput**, **7.5% less median server CPU**, and
**76.8% of native throughput** (before: 70.8%). Native still leads.

The [combined primary data](results/four-loader-primary-combined.json) includes
every completed four-loader trial from both final-code runs, including the first
run that later stopped during its separate single-loader control. Implementation
and harness hashes match between runs; no successful primary trial was removed.

| Primary run | Before events/s | After events/s | Native events/s | After vs before |
| --- | ---: | ---: | ---: | ---: |
| First seven trials | 1,372,091 | 1,499,126 | 1,920,542 | +9.3% |
| Second seven trials | 1,334,372 | 1,393,000 | 1,887,656 | +4.4% |
| All fourteen | 1,348,558 | 1,464,188 | 1,905,892 | +8.6% |

Combined median server CPU per 320,000-event workload is 259.11 ms before,
239.57 ms after and 180.09 ms native. The median paired throughput change is
9.6%; the paired mean 95% interval is
3.2%–24.2%.
Timing varied substantially, including slow control outliers; the individual run
medians above show that uncertainty. Treat the direction of improvement as stronger
evidence than a precise portable percentage. Native parity is not established.

The [complete final run](results/four-loader-final.json) has seven primary repeats
and five repeats for each held-out workload. All rates and CPU figures below are
medians; wire-byte totals matched for every implementation in every workload.

| Workload | Before events/s | After events/s | Native events/s | After change | Server CPU before / after / native (ms) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Four loaders, 16 streams, ASCII 128 B | 1,334,372 | 1,393,000 | 1,887,656 | +4.4% | 261.07 / 252.87 / 182.11 |
| Four loaders, Unicode 128 B | 938,434 | 990,235 | 1,332,017 | +5.5% | 360.86 / 338.83 / 249.37 |
| Four loaders, mixed newlines | 832,745 | 1,118,096 | 1,482,438 | +34.3% | 397.99 / 307.31 / 228.55 |
| Four loaders, 1 KiB payload | 481,006 | 573,397 | 788,508 | +19.2% | 187.09 / 162.97 / 108.35 |
| One loader, one stream | 562,923 | 547,367 | 628,877 | -2.8% | 29.29 / 29.68 / 27.20 |
| Four loaders, sparse 1 ms | 12,124 | 12,503 | 11,440 | +3.1% | 64.49 / 49.29 / 77.42 |

The single-stream workload regressed 2.8% in median throughput (server CPU rose
about 0.4 ms); no single-stream speedup is claimed. Sparse throughput is governed
by timers and scheduling and does not show that MinkSSE exceeds native capacity.
The substantial multiline improvement follows the newline-jump change; Unicode
and larger payload improvements support keeping native byte counting.

## Scope and implementation

The Node adapter privately supplies `Buffer.byteLength(value, 'utf8')` to the
producer after acquiring the exact response body's reader lock. Emissions after
attachment use the native counter, removing the combined ASCII/newline regular
expression from that path. Multiline accounting jumps between CR/LF positions,
adds the exact normalized SSE prefix cost, and rejects over-budget data before
allocating expanded strings. The generic Web path remains available.

No public option or API was added. Synchronous emissions inside `produce()` run
before the adapter attaches and retain generic counting. Cloned and transformed
bodies have different identities and retain generic behavior. Byte output still
uses the existing `TextEncoder`; the encoder experiment was rejected.

The registry is a private, browser-safe WeakMap containing only a small capability
state object. An early installer-closure implementation failed a retained-response
GC regression by retaining approximately 16.8 MB of setup data. Replacing the
closure with plain state fixed that regression. Neither the state nor its native
counter captures a producer callback, reader, destination, or user resource.

## Diagnosis and selection

The fresh four-loader V8 profile identified the combined data regular expression
and `TextEncoder` encoding as material costs alongside Node socket writes. The
[profile summary](results/four-loader-profile-summary.json) contains sampled self
times; this instrumented startup/warmup-inclusive run is diagnostic, not a ranking.

[Seven rotated selection trials](results/four-loader-capability-selection.json)
compared frozen pre-pass, capability installation off, counter-only, encoder-only,
combined, and native SSE. A subsequent
[five-repeat held-out comparison](results/four-loader-confirmation.json) tested
Unicode, mixed-newline JSON, 1 KiB, single-loader, and sparse workloads. The encoder
added only a small primary-workload improvement over counting alone and performed
worse on several held-out workloads. It was removed, including its unsafe buffer
allocation and private encoding hook. Final output ownership uses the existing
encoding path.

## Reproduction

```sh
npm run build
node --conditions=svelte benchmarks/experiments/four-loader.mjs
```

The runner rotates the frozen before build, current build, and native implementation
within each repeat. The main workload uses seven repeats, 16 concurrent streams,
four persistent loader workers, 20,000 events per stream, 128 payload bytes,
batches of 16, and 16 KiB opt-in coalescing for MinkSSE. Each trial starts a fresh
server and worker pool, then completes one full warmup pass before measurement.
The native control frames the same events into one write per producer batch.

Held-out workloads use five repeats: exact-size UTF-8 Unicode, mixed CRLF/CR/LF
whitespace within JSON, 1 KiB payloads (5,000 events per stream), one stream with one loader,
and batch-one sparse delivery (200 events per stream, 1 ms interval).
JSON serialization occurs before timing for all candidates; SSE escaping stays
inside timing, including native multiline formatting. Each loader validates HTTP
status, content type, payload, exact IDs, order and final event count. The runner
also requires identical delivered wire-byte counts across builds and native.

Raw samples retain server CPU, client CPU, wall time, first-event times and memory
statistics, together with selected implementation and harness SHA-256 hashes.
Intervals in the results describe sample variability, not portability to another
machine or production network. Sparse delivery is timer-limited and the single
loader can bottleneck parsing; neither establishes server capacity.

## Single-loader overload control

A 16-stream, single-loader control aborted with a closed socket. A separate
[diagnostic reproduction](results/four-loader-single-diagnosis.json) confirmed
`SSE client exceeded the stream buffer limit`: the faster producer can outrun
this one parsing thread and correctly closes the stream at its existing bound.
The [aborted run](results/four-loader-aborted.json) and
[error log](results/four-loader-aborted.log) are retained; it is not a successful
throughput sample. The final single-loader held-out test uses one stream and is
labelled accordingly. The primary four-loader workload is unchanged. The queue
was not enlarged and the failure was not retried into a passing sample.

## Guarantees and verification

Validation remains synchronous for event names, types, every batch member and
all wire-byte limits. Both paths enforce the existing 262,144-byte combined queued
and prefetched budget before expanded framing or publication. Batch atomicity,
getter reentrancy handling, cancellation, abort, finish races and backpressure
still use the same producer and adapter lifecycle. No unbounded cache, delayed
flush, timer, transport bypass or larger queue was introduced.

Regression tests cover ASCII, BMP/astral Unicode, lone surrogates, mixed newlines,
exact-byte limits and one-byte overflow, long multiline data, independent output
buffers, synchronous attachment transitions, clone fallback, helper failure and
completed-response setup retention. Actual HTTP tests exercise the owning Node
adapter and scalar/batch native and MinkSSE implementations with parallel loaders.

The Performance Benchmarker specialists implemented producer counting and the
held-out payload/loader checks. A Code Reviewer independently reviewed exact byte
accounting, body ownership, fallback behavior and cleanup, with no blocking
findings in the final counter-only implementation. The coordinating agent
selected the final variant and ran the performance comparisons.

Final checks: `npm run check`, 142 transport tests, 32 benchmark tests and eight
documentation tests pass (182 tests total). Browser bundles of both Web entry
points contain no Node adapter or `node:buffer` import. A fresh packed-package
consumer successfully delivered deferred Unicode and mixed-newline batch events
through a real Node HTTP server. `git diff --check` passes. No commit was made.
