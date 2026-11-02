# Portable Web-stream producer control

Status: **complete**. Generated 2026-11-02T05:39:56.427Z. v24.12.0, Apple M4 Pro, darwin/arm64.

Fixed native/before-generic/after-generic candidates rotate within each repeat, and workload order rotates between repeat blocks. Current unmodified benchmark harness/native target/scoring; generic direct Web bridge. Fresh server and loader pool; one complete warmup. Exact HTTP status, event name, ID, payload, sequence, count and wire-byte equivalence checks. Sequential trials, no automatic retries or exclusions. Throughput includes request/socket delivery and independent client validation; startup and warmup are excluded.

| Workload | Repeats per candidate | Native median events/s | Before generic | After generic | After/before | After/native |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| primary | 6 | 1,287,953.52 | 1,320,326.92 | 1,011,710.48 | -23.37% | 78.55% |
| unicode | 6 | 1,230,669.83 | 595,630.04 | 794,347.91 | 33.36% | 64.55% |

Paired mean throughput differences (after versus reference), with Student-t 95% intervals:

| Workload | Versus before generic | Versus native | Native parity supported¹ |
| --- | ---: | ---: | --- |
| primary | -26.18% [-55.59%, 3.24%] | -27.85% [-69.7%, 13.99%] | No |
| unicode | 23.27% [-26.74%, 73.28%] | -24.9% [-58.7%, 8.9%] | No |

¹ Defined narrowly as the lower bound of the paired mean after/native throughput difference being at least zero. This repeat-level criterion does not establish equivalence across machines or production workloads.

Validated measured events: 11,520,000. Errors: 0. No retries or sample exclusions. A failed trial invalidates this control.

Default primary workload: sixteen streams, four loaders, 20,000 events per stream, 128-byte ASCII payload, batch sixteen. Single uses one stream/loader; large uses 1 KiB payloads and 5,000 events per stream; Unicode and multiline retain the primary layout. All use a fresh server and loader pool per trial, one full warmup, public batch API and the same explicit coalescing target for both MinkSSE versions.
Coalescing target: 16,384 bytes. Before build: /Users/ogie/WebProjects/minksse/benchmarks/fixtures/pre-unicode-optimization.

The native baseline is unchanged Node HTTP SSE. Both MinkSSE builds use the same generic Web reader bridge; no private adapter, native producer capability, custom counter or alternate scorer is used. Native has fewer validation/queue semantics than MinkSSE. These are finite loopback measurements on a shared machine, not browser or production capacity results.

JSON contains every raw sample, CPU measurements, workload settings, source hashes and paired statistics. Source hashes are checked again after measurement; changing inputs invalidate the report.
