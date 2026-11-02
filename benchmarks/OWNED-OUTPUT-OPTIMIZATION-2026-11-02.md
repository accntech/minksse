# Owned native output: four-loader optimization and benchmarks

November 2, 2026 (Asia/Manila). Node v24.12.0, V8 13.6.233.17-node.37,
Apple M4 Pro, macOS arm64. Local uncommitted working tree.

## Result

The 18-repeat four-loader control improves median throughput from
**1,596,888 to 1,661,442 events/s (+4.04%)**.
Native measures 1,894,912 events/s, so MinkSSE
reaches **87.7% of native**, up from
84.3% in the same control.
Median server CPU falls from 217.58 to 211.91 ms.
Native parity has not been reached.

The new build wins 17 of 18 paired repeats. Mean paired throughput change is
4.41%, with a Student-t 95% mean interval of 3.30% to 5.53%.
All samples, including the one regression, are retained; no retries.

The independent all-project run measures **1,682,747 events/s**
for MinkSSE against **1,913,497 native**, or
**87.9% of native throughput**.
Historical reports fluctuate with host speed; the contemporaneous control above
isolates this pass from that variation.

## Profile and implementation

A fresh starting V8 profile samples string ownership copying in compactString
at 73.0 ms (3.6% of total samples) and queueFrame at 25.6 ms (1.3%). The prior
path copies each retained batch group into an owned string, then Node encodes
that string again when writing it. The public validation and exact byte counting
already run before these ownership operations.

The retained changes are limited to attached native batch output:

- A private Node capability allocates an exact, unpooled Buffer using the validated byte size and writes UTF-8 into it. It checks the written byte count. It is used only after every batch member and queue bound passes, when the live native queue is empty. Each frame drops its string reference before publication.
- The Node pump writes that owned byte buffer directly. Byte storage is independent for every frame, so later emissions and sibling chunks cannot overwrite it. Scalar output and batches appended behind a nonempty queue retain the existing owned-string path.
- The native staging loop accumulates its open coalescing group in local variables and creates a frame when the group closes. Groups destined for immediate owned-byte sealing avoid an intermediate string ownership copy. Closed fallback string groups still detach caller parents.
- Encoded frames are closed to further coalescing. A subsequent scalar or batch starts a new group, preserving bytes, event order, IDs and maximum chunk target rules. Chunk boundaries may differ when output appends behind a sealed group.

The queued byte count remains exact for both representations. The 262,144-byte
queue limit, atomic validation, sequential getter access, UTF-8/lone-surrogate
handling, newline normalization, deferred writes, backpressure, authoritative
terminal reader and exactly-once cleanup remain intact. No public option or
default coalescing target changed. Generic Web, cloned and transformed bodies
retain their byte-stream fallback; browser entry points do not load Buffer.

In the final profile, compactString and queueFrame no longer appear among the
45 largest sampled locations. Work is now visible in utf8Write (222.3 ms),
FastBuffer allocation (68.5 ms) and stageNativeBatch (128.5 ms). This makes the
remaining encoding/allocation and validation costs explicit; socket writes
remain substantial. Profile time includes imports, warmup, measurement and
shutdown, so these samples diagnose work placement rather than establish
individual function speedups or benchmark rankings.

Artifacts: [before profile run](results/owned-copy-before-profile.json),
[after profile run](results/owned-copy-after-profile.json),
[profile samples summary](results/owned-copy-profile-summary.json),
[owned-buffer selection](results/owned-copy-selection.json), and
[local-group selection](results/owned-copy-local-groups-selection.json).
The final control, not the exploratory selections, is the acceptance evidence.

## Controlled before/after

The [frozen prior build](fixtures/pre-owned-copy/README.md) includes the preceding
batch-loop/callback-writer pass. Each trial has a fresh server and loader pool,
one full warmup and rotated candidate order. Primary uses eighteen repeats;
held-out workloads use six. All three variants deliver identical wire byte
counts in every workload; every stream is independently validated.

| Workload | Before events/s | After events/s | Native events/s | Median change | Before CPU ms | After CPU ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| primary | 1,596,888 | 1,661,442 | 1,894,912 | 4.04% | 217.58 | 211.91 |
| single | 549,178 | 569,161 | 616,758 | 3.64% | 36.31 | 34.78 |
| large | 625,970 | 676,957 | 775,468 | 8.15% | 144.02 | 142.79 |
| unicode | 1,177,991 | 1,287,556 | 1,438,521 | 9.30% | 287.02 | 266.34 |
| multiline | 1,266,037 | 1,330,707 | 1,534,561 | 5.11% | 268.92 | 259.39 |

Primary: four loaders, sixteen streams, 20,000 events/stream, 128-byte ASCII
payloads, batch sixteen. Single uses one loader and stream. Large uses sixteen
streams, four loaders, 5,000 events/stream and 1 KiB payloads. Unicode and multiline
use the primary layout. These held-out samples support improvements across
payloads but are smaller than the main control.

[Raw control](results/owned-copy-final-control.json) ·
[paired statistics](results/owned-copy-final-paired.json) ·
[held-out controls](results/owned-copy-held-out.json).

## Fresh results for all six projects

Four loaders, sixteen streams, 20,000 events per stream, 128-byte ASCII payloads,
batch sixteen, seven measured repeats. Figures are medians.

| Implementation | Events/s | Server CPU ms | RSS after MiB | First-event p95 ms |
| --- | ---: | ---: | ---: | ---: |
| Native Node SSE | 1,913,497 | 179.23 | 81.69 | 0.87 |
| MinkSSE (local) | 1,682,747 | 208.94 | 88.59 | 1.66 |
| Better SSE | 1,336,327 | 252.11 | 84.34 | 1.67 |
| Fastify SSE | 782,157 | 419.16 | 110.14 | 1.42 |
| Hono | 343,663 | 980.95 | 253.28 | 2.01 |
| sveltekit-sse | 341,539 | 1002.85 | 114.17 | 2.30 |

| Implementation | Single stream events/s | 1 KiB events/s | Sparse events/s |
| --- | ---: | ---: | ---: |
| Native Node SSE | 606,598 | 710,221 | 12,229 |
| MinkSSE (local) | 549,159 | 607,087 | 11,613 |
| Better SSE | 548,807 | 509,395 | 12,376 |
| Fastify SSE | 427,661 | 469,830 | 12,497 |
| Hono | 241,036 | 272,845 | 11,505 |
| sveltekit-sse | 251,873 | 262,958 | 11,956 |

Single: one loader and stream, 20,000 events, seven repeats. Large: four loaders,
eight streams, 5,000 events, 1 KiB payload, five repeats (the controlled large
case above uses sixteen streams). Sparse: four loaders, sixteen streams,
100 events/stream, batch one, 1 ms interval and five repeats. Sparse is timer-limited;
small rankings in that column do not establish sustained throughput capacity.

All **144 measured all-project trials** passed exact status, count, sequence,
IDs, event name and payload validation, with no retries. Every fresh server
receives one complete warmup. Each raw report contains all samples, confidence
intervals, environment, versions, effective options and source hashes:

- [Four-loader report](results/owned-copy-all-four-loader-2026-11-02.md) · [JSON](results/owned-copy-all-four-loader-2026-11-02.json)
- [Single-stream report](results/owned-copy-all-single-2026-11-02.md) · [JSON](results/owned-copy-all-single-2026-11-02.json)
- [Large-payload report](results/owned-copy-all-large-2026-11-02.md) · [JSON](results/owned-copy-all-large-2026-11-02.json)
- [Sparse report](results/owned-copy-all-sparse-2026-11-02.md) · [JSON](results/owned-copy-all-sparse-2026-11-02.json)

## Verification and limits

Passed npm run check, **216 transport tests**, **32 benchmark harness tests** and
**8 documentation tests**: **256 tests total**. Browser bundles of root/server
entries exclude the Node adapter. A packed npm artifact passed real Node HTTP
delivery of deferred Unicode/multiline batches as owned bytes. All final control,
all-project and profile hashes match the current compiled implementation.
The initial profile matches the frozen before build. git diff --check passes.
No commit was created.

New tests first failed because native output was still strings. They now cover
exact independent buffer backing, coalescing on/off, Unicode/lone surrogates,
mixed newlines, invalid late members, blocked drain, abort, immutable sibling
output, scalar/batch appends behind sealed buffers, exact queue capacity and
one-byte overflow. A real adapter blocked-output GC test queues slices from a
32 MiB caller string through both owned-byte and backlogged-string paths; heap
growth stays below 4 MiB after collection. Existing queue/getter/cleanup tests
continue to pass.

A Software Architect analyzed the profile and ownership design, an API Tester
added the initial ownership/error regression cases, and an independent Code
Reviewer checked publication, budget stability, encoded-tail handling and
cleanup. Root integrated the implementation, expanded coverage and performed
all measurements and package checks.

These are finite loopback HTTP benchmarks on one shared host, not production
network capacity. The minimal native writer does not implement all MinkSSE
validation and queue ownership semantics. Hono/Fastify include their routers;
SvelteKit routing/build, package clients, broadcast/replay and slow readers are
outside this comparison. First-event p95 is the median per-trial request-to-first
validated event p95, not per-event latency. RSS includes imports and warmup.
MinkSSE uses public emitBatch and opt-in 16 KiB coalescing; native and Better SSE
also batch. Hono/Fastify use selected per-event APIs. Better SSE uses three fewer
optional framing spaces per event; logical events are equal, all-project wire
sizes differ. Pinned installed versions are recorded; this is not a claim about
latest published package versions.

## Reproduce

```sh
npm run build
CASES=primary REPEATS=18 OUTPUT=results/owned-copy-final-control.json node --conditions=svelte benchmarks/experiments/owned-copy.mjs
CASES=single,large,unicode,multiline REPEATS=6 OUTPUT=results/owned-copy-held-out.json node --conditions=svelte benchmarks/experiments/owned-copy.mjs
npm --prefix benchmarks run bench -- --loaders=4 --clients=16 --events=20000 --repeats=7 --output=results/owned-copy-all-four-loader-2026-11-02.json
npm --prefix benchmarks run bench -- --loaders=1 --clients=1 --events=20000 --repeats=7 --output=results/owned-copy-all-single-2026-11-02.json
npm --prefix benchmarks run bench -- --loaders=4 --clients=8 --events=5000 --bytes=1024 --repeats=5 --output=results/owned-copy-all-large-2026-11-02.json
npm --prefix benchmarks run bench -- --loaders=4 --clients=16 --events=100 --batch=1 --interval=1 --repeats=5 --output=results/owned-copy-all-sparse-2026-11-02.json
```

Final compiled SHA-256:

    server.js 5f0978bc480ad974372581c44f4c781dfbc638ab4f9bf943acd7c8ab958209ee
    node.js 8aff65ed594d6c55658ff513fbfc5731889ecc5dfdfca402cb1da527743b221c
    producer-capabilities.js 9998eeed252d64c2789582d756d6be3d222a6aa96c07a6aa75513dea1de3b8a7
