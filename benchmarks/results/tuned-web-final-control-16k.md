# Portable Web-stream producer control

Status: **complete**. Generated 2026-11-02T06:10:08.123Z. v24.12.0, Apple M4 Pro, darwin/arm64.

Fixed native/before-generic/after-generic candidates rotate within each repeat, and workload order rotates between repeat blocks. Current unmodified benchmark harness/native target/scoring; generic direct Web bridge. Fresh server and loader pool; one complete warmup. Exact HTTP status, event name, ID, payload, sequence, count and wire-byte equivalence checks. Sequential trials, no automatic retries or exclusions. Throughput includes request/socket delivery and independent client validation; startup and warmup are excluded.

| Workload | Repeats per candidate | Native median events/s | Before generic | After generic | After/before | After/native |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| primary | 18 | 1,820,093.69 | 1,625,578.54 | 1,649,054.5 | 1.44% | 90.6% |
| single | 6 | 600,916.03 | 582,547.07 | 575,751.86 | -1.17% | 95.81% |
| large | 6 | 776,346.39 | 471,258.56 | 468,868.57 | -0.51% | 60.39% |
| unicode | 6 | 1,405,645.39 | 1,053,486.95 | 1,205,832.04 | 14.46% | 85.78% |
| multiline | 6 | 1,490,320.98 | 907,193.01 | 1,279,382.3 | 41.03% | 85.85% |

Paired mean throughput differences (after versus reference), with Student-t 95% intervals:

| Workload | Versus before generic | Versus native | Native parity supported¹ |
| --- | ---: | ---: | --- |
| primary | 1.21% [-1.62%, 4.03%] | -11.01% [-12.53%, -9.49%] | No |
| single | 3.09% [-9.88%, 16.06%] | -6.13% [-12.51%, 0.25%] | No |
| large | 0.53% [-4.26%, 5.32%] | -39.49% [-41.23%, -37.75%] | No |
| unicode | 12.75% [7.91%, 17.59%] | -14.6% [-18.36%, -10.84%] | No |
| multiline | 39.46% [36.46%, 42.47%] | -13.81% [-17.57%, -10.05%] | No |

¹ Defined narrowly as the lower bound of the paired mean after/native throughput difference being at least zero. This repeat-level criterion does not establish equivalence across machines or production workloads.

Validated measured events: 30,600,000. Errors: 0. No retries or sample exclusions. A failed trial invalidates this control.

Default primary workload: sixteen streams, four loaders, 20,000 events per stream, 128-byte ASCII payload, batch sixteen. Single uses one stream/loader; large uses 1 KiB payloads and 5,000 events per stream; Unicode and multiline retain the primary layout. All use a fresh server and loader pool per trial, one full warmup, public batch API and the same explicit coalescing target for both MinkSSE versions.
Coalescing target: 16,384 bytes. Before build: /Users/ogie/WebProjects/minksse/benchmarks/fixtures/pre-unicode-optimization.

The native baseline is unchanged Node HTTP SSE. Both MinkSSE builds use the same generic Web reader bridge; no private adapter, native producer capability, custom counter or alternate scorer is used. Native has fewer validation/queue semantics than MinkSSE. These are finite loopback measurements on a shared machine, not browser or production capacity results.

JSON contains every raw sample, CPU measurements, workload settings, source hashes and paired statistics. Source hashes are checked again after measurement; changing inputs invalidate the report.
