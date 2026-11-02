# Tuned SSE setups and MinkSSE improvement analysis

November 1, 2026. Node v24.12.0, Apple M4 Pro, macOS arm64.

This is the investigation before the producer/API changes. The Node adapter and
opt-in output coalescing have since been implemented; see the
[implementation and fresh benchmark report](IMPLEMENTATION.md). Statements below
about unchanged source describe the investigation's original snapshot.

## Outcome and scope

The largest confirmed MinkSSE improvement is its Node integration. Replacing
`Readable.fromWeb()` plus `pipeline()` with a direct Web reader to Node response
loop improved delivery without changing `src/server.js`. The server library,
its queue limit, framing rules and public API are unchanged by this work.

These are the best supported setups tested here, not a proof of a universal
optimum. This investigation covers server event production and HTTP delivery;
it does not establish client or parser performance, production capacity, Bun
performance, or browser behavior. Both measured processes share the machine.

## Selected setup for each implementation

| Implementation | Optimized setup | Evidence and tradeoff |
| --- | --- | --- |
| Native Node | Format and join each common batch inside the request, then one `res.write()`; await drain | Explicit corking lost to ordinary writes, but true batching won against individual writes. This adds no timer: all events in a batch are already available. |
| Hono | `streamSSE()` with official `@hono/node-server` `getRequestListener()` | Custom direct and official Kit/Hono bridges beat the original pipeline. Official Hono was within about 5% of custom direct in selection trials, so deployment fidelity determined the default. The official listener also substitutes its lightweight global Request/Response implementations; this is a whole supported setup, not a bridge-only ablation. |
| Fastify + @fastify/sse | Per-event `reply.sse.send()`, identity serializer for pre-serialized JSON | Tested async iterable and Node stream inputs lost to direct sends. The setup is retained unchanged; small before/after differences are noise. |
| Better SSE | Public `session.batch()` once per common batch, identity serializer | Its batching API combines frames into one output chunk. This is library behavior, not handwritten framing that bypasses the package. |
| sveltekit-sse | Real bundled `produce()` with SvelteKit's public Node `setResponse()` | Kit's writer performed similarly to a custom direct reader and avoids the generic Node stream conversion. Full SvelteKit routing is still outside the benchmark. |
| MinkSSE | Unmodified `produce()` with direct `getReader()` → `res.write()` and drain handling | The direct bridge removes a second stream abstraction; the 256 KiB producer budget still applies. |

Original setup remains available as `--setup=baseline`. Default is now
`--setup=optimized`; every report records resolved strategies per candidate.
Explicit strategy overrides allow repeatable experiments. Identity serialization,
heartbeats and common IDs/payloads are controlled consistently with the first
benchmark. Other than native framing and library serializers, all JSON preparation
occurs before timing.

Selection data: [57 initial strategy samples](results/setup-selection.json) and
[12 native write-versus-batch samples](results/native-selection.json), three
repeats per strategy at each tested workload. Selection was followed by fresh
five-repeat comparisons rather than promoting selection numbers as final scores.

## Fresh results

Median validated events/second, 20,000 events per client, 128 ASCII payload
bytes plus JSON/SSE overhead, batch size 16, five fresh server processes per
candidate/setup. Each process receives a complete warmup before measurement.

| Implementation | Baseline, 1 client | Optimized, 1 client | Baseline, 16 clients | Optimized, 16 clients | 16-client ratio |
| --- | ---: | ---: | ---: | ---: | ---: |
| Native Node | 465,390 | 625,895 | 1,099,791 | 1,740,674 | 1.58× |
| Hono | 131,615 | 251,029 | 200,140 | 359,337 | 1.80× |
| Fastify + @fastify/sse | 416,200 | 415,893 | 889,097 | 905,530 | 1.02× |
| Better SSE | 385,696 | 540,413 | 854,175 | 1,561,693 | 1.83× |
| sveltekit-sse | 90,803 | 248,955 | 118,084 | 346,656 | 2.94× |
| MinkSSE | 176,089 | 332,251 | 292,091 | 636,079 | 2.18× |

MinkSSE server CPU for the 320,000-event workload fell from **1,134 ms to
541 ms** (about **52% lower**), or
3.54 to 1.69 CPU microseconds per event.
This measured CPU reduction supports the throughput result; it is not just an
inference from a flame graph.

Full reports include confidence intervals, first-event observations, CPU/RSS,
effective strategies, exact dependencies and source hashes:
[baseline 1](results/baseline-clients-1.md),
[optimized 1](results/optimized-clients-1.md),
[baseline 16](results/baseline-clients-16.md),
[optimized 16](results/optimized-clients-16.md). Adjacent JSON files contain raw
samples. Do not interpret Fastify's small variation as an optimization: its
selected code path did not change.

### Held-out workloads

These were not used to select the transport strategies. Three repeats each.
First-event values below are medians of the per-trial p95 across clients.

| MinkSSE workload | Baseline events/s | Optimized events/s | Baseline first event p95 | Optimized first event p95 |
| --- | ---: | ---: | ---: | ---: |
| 1 KiB payload; 8 clients × 5,000 events | 199,339 | 339,323 | 2.35 ms | 1.77 ms |
| 1 ms between single-event batches; 16 clients × 100 events | 10,419 | 11,999 | 1.39 ms | 1.40 ms |

The larger-payload result supports an adapter improvement beyond the original
128-byte case. Sparse traffic is timer-limited, and unchanged Fastify also
varies between runs. Do not attribute those throughput differences to tuning or
claim a meaningful sparse-latency improvement. Native batching also does not
improve large-payload throughput in this run, despite lower CPU; client/network
copying and contention can cap an end-to-end score.

All-package held-out reports: [baseline 1 KiB](results/baseline-large-payload.md),
[optimized 1 KiB](results/optimized-large-payload.md),
[baseline sparse](results/baseline-sparse.md),
[optimized sparse](results/optimized-sparse.md).

Setups ran sequentially, while candidate order rotated within repeats. This
reduces candidate-order bias but does not eliminate thermal, scheduler, client
or setup-order effects. Large repeated gains across workloads are stronger
evidence than close rankings or tiny latency differences.

## What the MinkSSE profiles establish

Three separate V8 CPU profiles were collected: native baseline and MinkSSE with
both bridges, 16 clients × 50,000 events with one warmup pass. Profiles include
startup, warmup and the measured pass, so these are **full-lifetime sampled leaf
frames**, not measured-window CPU percentages. Profile throughput is excluded
from ranking. The profiles predate the final native batching change; each
profile-run JSON retains the actual benchmark hashes and effective strategies.
MinkSSE's producer and its direct bridge did not change between these revisions.

| Sampled leaf category | MinkSSE pipeline | MinkSSE direct |
| --- | ---: | ---: |
| writev/writevGeneric | 58.6% | 33.7% |
| UTF-8 encoding | 9.6% | 15.9% |
| regular expressions | 3.0% | 7.6% |
| Node Web Streams (own leaf samples) | 5.5% | 9.3% |
| MinkSSE source (own leaf samples) | 3.3% | 6.2% |
| garbage collection | 0.8% | 1.3% |

The pipeline profile contains 4,873 samples and the direct profile 2,287. A
higher percentage in the shorter direct profile does not mean a category became
slower. Categories use disjoint leaf-frame counts, not inclusive stack totals;
promise/stream work with other labels appears in “other”. Sampling cannot supply
an exact causal CPU breakdown. The bridge A/B and measured CPU reduction are
stronger evidence for the integration change than the percentages alone.

[Profile summary, SHA-256 hashes and top leaf frames](results/profile-summary.json).
Raw files remain locally in `benchmarks/profiles/` and are ignored by Git.
Reproduce them with `--targets=minksse --setup=baseline|optimized --events=50000
--clients=16 --repeats=1 --profile=profiles`. Warmup defaults to one full pass.
The summary groups all nodes by their leaf function name and URL; writev and
writevGeneric are grouped, encoder functions are grouped, and every regex leaf
is grouped. It does not sum ancestor and child samples together.

## Where MinkSSE should improve

### 1. Offer a tested Node integration — confirmed opportunity

The package currently leaves Node response adaptation to its caller. Document a
supported direct-reader recipe, or consider an optional Node subpath without
adding Node imports to browser-facing entry points. The benchmark contains the
working experiment; it should not simply be copied into production as-is.
Before promoting an adapter, add real-candidate disconnect tests while blocked
on `drain`, early cancellation, response errors, and verification that the
producer cleanup runs exactly once. Existing transport failure tests use mock
servers and do not prove every real adapter's disconnect behavior.

This is the lowest-risk performance opportunity because the producer need not
change. Its gain is already measured on one and sixteen clients and 1 KiB data.

### 2. Experiment with opt-in bounded output coalescing — strongest next hypothesis

`src/server.js` encodes/enqueues one event at a time. `flush()` emits one queued
frame per pull, and the stream uses a zero high-water mark. Under a backlog this
means one read/pull/encoding path per event. The direct profile still samples
encoding and stream work, while native and Better SSE batching demonstrate the
value of reducing output chunks in their own implementations.

Prototype a mode that joins only **already queued** frames into a bounded chunk,
for example a 16–32 KiB target, when the consumer pulls. Keep the first sparse
event immediate; do not wait for a batch to fill or add a timer by default.
Count every queued/prefetched wire byte toward the existing 256 KiB limit.
The native/Better gains motivate this experiment but do not predict its gain
for MinkSSE.

Keep this opt-in initially. Tests currently assert individual frame reads and
unencoded unread backlog. Preserve default behavior, then add explicit batching
cases for exact framing/order, partial final chunks, byte boundaries, finishing,
abort, cancellation and mutation/transfer isolation. Benchmark lower chunk count,
CPU/event and throughput; reject the change if it adds sparse-event delay or
weakens bounded memory. This task does not implement that public API change.

### 3. Optimize encoding only after a controlled prototype

UTF-8 encoder leaves account for about 16% of direct-profile samples. Compare
`encode()` against `encodeInto()` with accurately sized, independently owned
buffers and the coalesced-output prototype. Test ASCII, Unicode, CR/LF and
payload sizes separately. Reusing a shared backing buffer would violate the
existing mutation/transfer isolation test. There is no measured evidence here
that `encodeInto()` itself wins, so it is an experiment rather than a promised
fix.

The ASCII/newline scan also appears in the profile. Consider a fused framing /
length / encoding path only if profiling a prototype shows a gain. Preserve
exact UTF-8 accounting, CRLF normalization and the budget boundary tests.

### 4. Keep ownership/queue safeguards; defer speculative micro-optimizations

`compactString()` and queue objects add work, but removing string compaction can
retain a 16 MiB caller string through a tiny slice. The existing Node and Bun
retention tests protect against this. Garbage-collection samples are small in
these profiles, so allocation cleanup is a lower priority than transport/chunk
work. Do not enlarge the queue, pre-encode an unread backlog, or relax checks
to obtain a benchmark gain.

An awaitable demand/drain API could later help callers pace production instead
of guessing a `setImmediate` batch size. That is an API/overload-control decision,
not an existing configuration knob and not proven to improve this workload.

## Verification and remaining limits

The tuned harness passed tests for invalid options, UTF-8 fragmentation and
corrupt/missing/duplicate events, both setups for all six real packages, official
Node writers, timeout cleanup, parent disconnect, native write counts, and CPU
profile flushing. Clean isolated dependency installation was also checked.
MinkSSE's original source and behavior remain unchanged.

Checks actually run after final tuning:

- `npm --prefix benchmarks ci --ignore-scripts`: clean installation succeeded.
- `npm --prefix benchmarks test`: all 11 benchmark tests passed.
- `npm run check`: build and strict type checking passed.
- `bun run test:transport`: all 68 existing transport/resource/package tests passed.
- `git diff --check`: passed.

The isolated benchmark dependency installation reported five low-severity npm
advisories. Dependency updates outside the pinned comparison were not applied.

For any producer optimization, acceptance requires existing producer/resource
checks plus the new mode's tests: no dropped or corrupted events; exact byte
limits; immediate sparse delivery; normal finish/abort drain; cancellation drops
backlog; cleanup exactly once; independent buffer ownership; and Node/Bun
retained-memory behavior. Require repeated gains beyond run-to-run variation at
one and sixteen clients and larger payloads. A bulk-throughput gain alone does
not establish a worthwhile tradeoff if latency or memory regresses.

A Performance Benchmarker specialist implemented and selected the setups, a
second specialist independently examined producer contracts, and a Code Reviewer
reviewed the tuned harness and native batching without participating in timings.
The coordinating agent independently ran the final benchmark suites and checks.

Primary API references:
[Node HTTP writes/corking](https://nodejs.org/api/http.html),
[Node stream adaptation](https://nodejs.org/api/stream.html),
[Hono Node adapter](https://hono.dev/docs/getting-started/nodejs),
[Fastify SSE](https://github.com/fastify/sse),
[Better SSE](https://github.com/MatthewWid/better-sse),
[SvelteKit Node API](https://svelte.dev/docs/kit/@sveltejs-kit-node),
[sveltekit-sse](https://github.com/razshare/sveltekit-sse).
