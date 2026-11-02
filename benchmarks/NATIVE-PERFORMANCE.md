# Native-gap optimization pass

November 1, 2026 (Asia/Manila) · Node v24.12.0 · Apple M4 Pro · macOS arm64.

## Outcome

MinkSSE's explicit batch API reaches **1,583,792 events/s** in the original
single-loader, 16-client workload versus **1,646,825 events/s**
for native SSE: **96.2% of that measured rate**.
That improves upon the fresh scalar control by about
28%.

**General native parity has not been achieved.** With four independent client
workers reducing the single-loader bottleneck, MinkSSE measures
**1,369,540/s** versus native **1,910,729/s**, or
71.7% of native. Server CPU remains higher.
The original-style 96% result must not be presented as equivalent server capacity.

The four-worker batch path is **31% faster** than
the frozen pre-pass scalar implementation and uses about
**25% less server CPU**.
Default scalar behavior, framing, byte limits and lifecycle guarantees remain.

## Implementation changes

1. **Group queued frames on admission.** Coalescing stores bounded tail groups
   rather than one queue object per event and a separate pull-time grouping pass.
   Closed groups are detached safely; pull still encodes only requested output.
2. **Public `emitBatch(event, readonly string[])`.** Supplied strings are validated
   synchronously before new batch frames are published. With positive coalescing,
   the first available batch group can use one output chunk, avoiding the scalar
   first-event-plus-remainder split. No timer or wait for future events is added.
3. **Stage ownership once per retained group.** Raw strings remain temporary during
   synchronous validation. Immediate groups are encoded directly; queued groups
   acquire owned compact storage at commit. Raw slices never enter the retained
   scalar cache. Both Node and Bun retained-parent regressions pass.
4. **Reduce bookkeeping allocation.** Private formatting returns an error or
   undefined, eliminating per-item batch success objects. Public scalar and batch
   results remain fresh caller-owned objects. Stateless regexes are reused.

```js
const response = produce(({ emitBatch, lock }) => {
  const result = emitBatch('update', [
    JSON.stringify({ value: 1 }),
    JSON.stringify({ value: 2 })
  ]);
  if (!result.error) lock.set(false);
}, { coalesceBytes: 16_384 });
```

A batch must fit the available 256 KiB wire budget, including existing queued and
prefetched output. Empty arrays consume no ID. Coalescing 0 retains individual
chunks. Invalid/throwing/reentrant array input terminates without publishing a
staged prefix; abort/finish during access drops staging and drains earlier
accepted frames normally. Validation atomicity does not mean atomic network
delivery. Scalar `emit()` retains immediate first-event behavior.

The Node adapter is unchanged. No private transport bypass, runtime dependency,
unbounded queue, shared mutable output buffer, or relaxed validation was added.

## Fresh throughput results

128-byte ASCII payload plus JSON/SSE framing, 20,000 events per connection,
batch size 16, five fresh server processes per candidate/workload, one complete
warmup each. MinkSSE uses public `emitBatch()` and 16 KiB coalescing. Native uses
one framed write per same-sized batch; Better SSE uses its public batch API.
Batch arrays, framing and validation remain inside timed work. All event IDs,
counts, order and payloads are independently checked.

| Implementation | 1 client, 1 loader | 16 clients, 1 loader | 16 clients, 4 loaders |
| --- | ---: | ---: | ---: |
| Native Node | 623,927 | 1,646,825 | 1,910,729 |
| Hono | 247,900 | 337,257 | 344,664 |
| Fastify SSE | 416,569 | 831,012 | 771,078 |
| Better SSE | 525,675 | 1,467,956 | 1,367,173 |
| sveltekit-sse | 249,001 | 322,959 | 336,888 |
| MinkSSE emitBatch | 513,635 | 1,583,792 | 1,369,540 |

All values are median validated events/second. Reports with raw adjacent JSON:
[one client](results/native-pass-clients-1.md),
[original-style 16 clients](results/native-pass-clients-16.md),
[four-loader 16 clients](results/native-pass-parallel.md).
Hono includes its official Node integration; sveltekit-sse measures the producer
with Kit's response writer, excluding full application routing/browser stores.

### Server and client CPU: four loaders

Same 320,000-event workload, five repeats. CPU is process user+system time;
server and client processes are measured separately.

| Configuration | Events/s | Server CPU | Aggregate client CPU |
| --- | ---: | ---: | ---: |
| Before: scalar + coalescing | 1,045,168 | 341.9 ms | 684.3 ms |
| Current scalar + coalescing | 1,068,967 | 331.0 ms | 676.9 ms |
| Current emitBatch + coalescing | 1,369,540 | 256.0 ms | 588.4 ms |
| Native batch writer | 1,910,729 | 178.3 ms | 564.8 ms |

The before/current scalar path differs only modestly; most throughput gain comes
from explicitly supplying batches. Batch mode lowers server CPU from
341.9 to 256.0 ms against the
pre-pass scalar baseline, while native requires 178.3 ms.
This remaining CPU gap is material even where original-style throughput looks
similar. These results do not establish equal efficiency.

[Before scalar](results/native-pass-before.md),
[current scalar](results/native-pass-scalar.md),
[single-loader scalar control](results/native-pass-scalar-single-loader.md).

### Larger payload and sparse traffic

Three repeats per candidate, four loader workers. Large payload: 8 clients ×
5,000 events, 1 KiB payload, batch 16, MinkSSE 32 KiB target so a complete supplied
batch can fit in one group. Sparse: 16 clients × 100 events, 128-byte payload,
one event per batch and 1 ms spacing, 16 KiB coalescing target.

| Implementation | 1 KiB payload events/s | Sparse events/s |
| --- | ---: | ---: |
| Native Node | 737,386 | 11,721 |
| Hono | 271,296 | 11,164 |
| Fastify SSE | 483,301 | 11,415 |
| Better SSE | 524,864 | 10,908 |
| sveltekit-sse | 274,535 | 10,749 |
| MinkSSE emitBatch | 479,093 | 10,678 |

[Large-payload report](results/native-pass-large.md) ·
[Sparse report](results/native-pass-sparse.md).
Batching has no useful backlog to combine for sparse-only streams. Prefer
scalar `emit()` for isolated events. No sparse-latency improvement is claimed.
Additional before/scalar controls:
[before one client](results/native-pass-before-one.md),
[scalar one client](results/native-pass-scalar-one.md),
[before 1 KiB](results/native-pass-before-large.md),
[scalar 1 KiB](results/native-pass-scalar-large.md).

## Benchmark rigor

Calibration showed the original client process could consume roughly one CPU
core at native rates. Added optional persistent WorkerThread loaders to reduce
this limitation. Workers pass a ready barrier before timing and preserve their
fetch pools/JIT warmup through all warmup and measured passes. Client CPU is
counted once across the whole client process, not summed repeatedly from workers.
Worker startup is excluded; dispatch-to-completion wall time is included.
Failures invalidate the sample and close workers/sockets. Tests cover these
paths and cancellation of pending reads.

Every new report records the exact producer/adapter, harness, core, loader,
worker and dependency hashes, plus resolved scalar/batch/coalescing settings.
`--minkbuild` compares immutable compiled snapshots without overwriting current
source. The pre-pass source is archived under
[fixtures/pre-native-pass](fixtures/pre-native-pass/README.md), matching earlier
report hashes. Historical absolute scores use a less strict validator and cannot
be substituted for this pass's fresh controls.

Candidate selection used rotated variants in five-repeat experiments:
[grouping](results/native-gap-selection.json),
[grouping/copy refinement](results/native-gap-selection2.json),
[batch API and parallel-load comparison](results/native-gap-batch-selection.json),
[ownership refinement](results/native-gap-ownership-selection.json).
A separate profile identified remaining framing scans, encoding and write work:
[profile snapshot metadata](results/native-gap-batch-profile.json). Profiles
include startup/warmup and are excluded from throughput rankings.

The final report suites rotate candidate order within repeats but run workloads
and before/after configurations sequentially. Timer granularity, thermal state,
client CPU and operating-system scheduling still affect results. The four-loader
run reduces one observed bottleneck; it is not a universal production capacity
measurement. Server-specific validation and Web Stream costs remain in MinkSSE.

## Memory and rejected experiments

Three fresh Node processes per implementation, 7,000 tiny queued events and an
8 KiB coalescing target, with repeated GC after a warmed Response baseline:

| Producer | Median retained heap delta |
| --- | ---: |
| Before pass | 1,471,152 bytes |
| Current grouped queue | 379,080 bytes |

This diagnostic is about **74% lower**
retained queue heap in that workload, not a total-process heap guarantee.
[Raw memory samples](results/native-pass-queue-memory.json).

Rejected experiments:

- Simple concat/slice or join-only copies retained 16 MiB caller strings in Bun or
  Node. The safe detachment path remains.
- Snapshotting and joining batch data for one ASCII scan added complexity and
  temporary storage without a measured win: roughly 1.355M/s versus 1.371M/s in
  its preceding candidate. It was removed, and only meaningful behavior tests
  were retained. [Selection data](results/native-gap-preflight-selection.json).
- Scalar queue grouping improved memory but alone did not materially improve
  HTTP throughput. It is not credited with the batch API's gain.

Default-path microbenchmark: parser code is unchanged; the existing 7-sample,
3-warmup comparison measured producer drained 5.91 ms before versus 6.07 ms after
(about 3% slower in that one microbenchmark), while fresh scalar HTTP results
were similar. No default-path speedup or zero-overhead claim is made.
[Raw microbenchmark](results/native-pass-default-micro.json).

## Verification and reproduction

- Strict build, declarations and readonly-array type consumer checks pass.
- **126 transport/resource/package tests pass**, including batch atomic
  validation, reentrant getters/proxies, stop/abort, exact byte accounting,
  independently transferable buffers and Node/Bun retained-slice cases.
- **28 benchmark tests pass**, including strict IDs, baseline-build selection,
  parallel worker lifecycle, cancellation and load balancing.
- **8 documentation tests pass**.
- Fresh packed-package installation outside the checkout verifies `emitBatch()`
  and the isolated `minksse/node` entry point without runtime dependencies.
- Independent Code Reviewer found no blocking issue in final batch ownership,
  staging, queue accounting, worker loading or lifecycle cleanup.

```sh
npm run bench:compare -- --clients=16 --events=20000 --repeats=5
npm run bench:compare -- --clients=16 --loaders=4 --events=20000 --repeats=5
npm run bench:compare -- --targets=minksse --minkapi=emit --clients=16 --loaders=4 --events=20000 --repeats=5
npm --prefix benchmarks run bench -- --targets=minksse --minkapi=emit --minkbuild=fixtures/pre-native-pass --clients=16 --loaders=4 --events=20000 --repeats=5
```

Two Performance Benchmarker specialists contributed producer optimization and
parallel-load validation; a Software Architect reviewed the approach; a Code
Reviewer independently checked correctness. The coordinating agent performed
selection/final timings and integration verification. No native-parity claim is
made beyond the explicitly qualified original-style throughput observation.
