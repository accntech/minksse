# Native queue optimization and fresh project benchmarks

November 2, 2026 (Asia/Manila) · Node v24.12.0 · Apple M4 Pro · macOS arm64.

## Outcome

The retained implementation removes duplicate native batch-frame allocation and
commit-time Web queue queries, and reuses an emptied native queue array. All
validation, exact byte limits, atomic staging, and cleanup remain in the shared
producer. There is no new public API or larger queue.

The all-project run measured **1,592,618 events/s**
for MinkSSE versus **1,944,372 native**, or
**81.9% of native throughput**.
This does not establish a capacity improvement over the preceding build: the
contemporaneous before/after control below did not confirm a four-loader gain.
Native parity has not been achieved. Single-stream and larger-payload controls
showed better median throughput and lower server CPU.

## Controlled before/after

[Raw control trials](results/native-gap-final-control.json) compare the frozen
[pre-pass build](fixtures/pre-final-gap/README.md), final build, and native SSE.
Twelve rotated repeats per workload; fresh servers and worker pools; one full
warmup each. No failed samples or retries. These trials isolate this pass from
the earlier Node queue prototype and host-speed changes between runs.

| Workload | Before events/s | After events/s | Native events/s | Before CPU ms | After CPU ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| Four loaders, 16 streams, 128 B | 1,595,689 | 1,582,161 | 1,940,973 | 214.17 | 214.18 |
| One stream, 20,000 events | 559,698 | 575,750 | 624,978 | 36.48 | 34.96 |
| Four loaders, 16 streams, 1 KiB | 612,075 | 623,757 | 797,605 | 147.10 | 142.87 |

[Paired changes and uncertainty](results/native-gap-final-paired.json) retain every sample.

| Workload | Mean paired throughput change | 95% mean interval |
| --- | ---: | ---: |
| Four loaders, 16 streams, 128 B | -0.46% | -1.70% to 0.78% |
| One stream, 20,000 events | 1.72% | -0.53% to 3.97% |
| Four loaders, 16 streams, 1 KiB | 3.52% | 0.37% to 6.66% |

Earlier selections were noisier and gave larger apparent gains. They are not
substituted for this final control. The change deterministically reduces queue
commit work, but the final four-loader throughput advantage remains unproven.

## Fresh all-project results

Seven repeats, sixteen concurrent streams, four persistent loader workers,
20,000 events per stream, 128-byte ASCII payloads, batch sixteen, one full warmup.
All figures are medians. RSS includes imports and warmup. First-event p95 is the
median of request-to-first-validated-event p95 across trials, not per-event latency.

| Implementation | Events/s | Server CPU ms | RSS MiB | First-event p95 ms |
| --- | ---: | ---: | ---: | ---: |
| Native Node SSE | 1,944,372 | 176.07 | 81.84 | 0.89 |
| MinkSSE (local working tree) | 1,592,618 | 213.51 | 83.95 | 1.57 |
| Better SSE | 1,351,551 | 249.93 | 84.19 | 1.35 |
| Fastify SSE | 792,225 | 415.44 | 109.52 | 1.43 |
| Hono | 354,959 | 979.08 | 255.27 | 1.93 |
| sveltekit-sse | 350,452 | 978.28 | 114.02 | 2.23 |

Other throughput workloads:

| Implementation | Single stream | 1 KiB payload | Sparse 1 ms |
| --- | ---: | ---: | ---: |
| Native Node SSE | 637,631 | 722,861 | 11,673 |
| MinkSSE (local working tree) | 553,537 | 579,793 | 11,550 |
| Better SSE | 535,655 | 521,187 | 10,777 |
| Fastify SSE | 433,735 | 483,839 | 10,787 |
| Hono | 252,276 | 269,503 | 10,342 |
| sveltekit-sse | 257,473 | 274,104 | 10,508 |

Single-stream uses 20,000 events, one loader and seven repeats. The all-project
1 KiB test uses eight streams, four loaders, 5,000 events per stream and five
repeats (the controlled 1 KiB test above uses sixteen streams). Sparse uses
sixteen streams, four loaders, 100 events per stream, batch one, 1 ms interval
and five repeats. Sparse rates are timer-limited; one loader can be client-limited.

## Implementation and invariants

- After full batch validation, an empty attached native queue takes ownership of the already staged frame array. It no longer allocates duplicate live frames or asks the Web controller for every committed group. The open final group is still copied; coalescing-off still copies every retained event.
- A detached last frame leaves a reusable empty private array for later scalar emissions. The transferred frame is already removed, so reentrant emission cannot modify or merge into it. Generic Web delivery and error/cancellation discard paths retain their previous behavior.
- Batch getter validation, IDs, native UTF-8/newline counting, the exact 262,144-byte queued-plus-prefetched limit, independent byte buffers, and immediate exactly-once cleanup are unchanged.
- Nonempty queues retain their previous tail-coalescing path. No timer, delayed flush, global payload cache, skipped ownership copy, or validation bypass was introduced.

The first regression observed 259 Web budget reads for a native 1,024-event
batch; the new complexity test requires at most two. New native tests cover exact
limits and one-byte overflow, empty/backlogged queues, coalescing on/off, late
invalid input, final waiter disposal, and 32 MiB event/data parents. Node and Bun
retention tests keep retained heap below 4 MiB after GC.

Reusable compaction scratch and both header/data-fragment and complete-event
string-join staging were measured and rejected: none consistently improved the
main workload. Their code is not in the final implementation. Selection artifacts
remain under results/final-gap-*.json.

## Verification and method

`npm run check`, **193 transport tests**, **32 benchmark tests**, and **eight
documentation tests** pass: **233 tests total**. The native queue tests are now
included in the transport script. Current browser bundles contain no Node adapter
or `node:buffer` import; a freshly packed consumer delivered deferred Unicode
and mixed-newline batch events through a real Node HTTP server. The Performance Benchmarker specialist helped
identify candidates, the API Tester added native limit/retention cases, and a
Code Reviewer independently reviewed transfer, aliasing and cleanup; no blockers
were found.

The **144 all-project measured trials** and **108 controlled trials** completed
without validation errors or server fatal flags. Every measured stream validates
HTTP status/content type, UTF-8 JSON payloads, IDs, order and exact event count.
Three built MinkSSE module hashes match every final report. Candidate trials run
sequentially with rotated order; no tests or CPU profiles run alongside timings.

These measure the selected router/adapter/API stacks. Native/Better/Mink use
batch APIs; Mink enables opt-in 16 KiB coalescing. SvelteKit routing/build is
excluded. Better SSE omits optional spaces after three field colons, producing
three fewer wire bytes per logical event. Results are not a universal ranking.
MinkSSE is the uncommitted local working tree, not a newly published release.

## Raw artifacts and reproduction

- four-loader: [summary](results/optimized-all-four-loader-2026-11-02.md), [samples, versions, hashes and configuration](results/optimized-all-four-loader-2026-11-02.json).
- single: [summary](results/optimized-all-single-2026-11-02.md), [samples, versions, hashes and configuration](results/optimized-all-single-2026-11-02.json).
- large: [summary](results/optimized-all-large-2026-11-02.md), [samples, versions, hashes and configuration](results/optimized-all-large-2026-11-02.json).
- sparse: [summary](results/optimized-all-sparse-2026-11-02.md), [samples, versions, hashes and configuration](results/optimized-all-sparse-2026-11-02.json).

Diagnostic [CPU profile summary](results/native-queue-gap-profile-summary.json) includes startup/warmup and is not used for rankings.

```sh
npm run check
bun run test:transport
npm --prefix benchmarks test
bun run test:docs
CASES=primary,single,large REPEATS=12 OUTPUT=results/native-gap-final-control.json node --conditions=svelte benchmarks/experiments/native-gap.mjs
npm --prefix benchmarks run bench -- --loaders=4 --clients=16 --events=20000 --bytes=128 --batch=16 --interval=0 --repeats=7 --warmup=1 --output=results/optimized-all-four-loader-2026-11-02.json
npm --prefix benchmarks run bench -- --loaders=1 --clients=1 --events=20000 --bytes=128 --batch=16 --interval=0 --repeats=7 --warmup=1 --output=results/optimized-all-single-2026-11-02.json
npm --prefix benchmarks run bench -- --loaders=4 --clients=8 --events=5000 --bytes=1024 --batch=16 --interval=0 --repeats=5 --warmup=1 --output=results/optimized-all-large-2026-11-02.json
npm --prefix benchmarks run bench -- --loaders=4 --clients=16 --events=100 --bytes=128 --batch=1 --interval=1 --repeats=5 --warmup=1 --output=results/optimized-all-sparse-2026-11-02.json
```

No commit was made.
