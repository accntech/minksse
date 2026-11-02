# Portable Web-stream producer control

Status: **complete**. Generated 2026-11-02T03:34:44.960Z. v24.12.0, Apple M4 Pro, darwin/arm64.

Fixed native/before-generic/after-generic candidates rotate within each repeat, and workload order rotates between repeat blocks. Current unmodified benchmark harness/native target/scoring; generic direct Web bridge. Fresh server and loader pool; one complete warmup. Exact HTTP status, event name, ID, payload, sequence, count and wire-byte equivalence checks. Sequential trials, no automatic retries or exclusions. Throughput includes request/socket delivery and independent client validation; startup and warmup are excluded.

| Workload | Repeats per candidate | Native median events/s | Before generic | After generic | After/before | After/native |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| primary | 18 | 1,873,879.19 | 1,372,808.22 | 1,675,646.85 | 22.06% | 89.42% |
| single | 6 | 609,753.81 | 510,895.94 | 584,631.3 | 14.43% | 95.88% |
| large | 6 | 781,404.3 | 476,859.42 | 479,105.93 | 0.47% | 61.31% |
| unicode | 6 | 1,435,290.05 | 1,026,330.94 | 1,067,374.45 | 4% | 74.37% |
| multiline | 6 | 1,513,078.63 | 894,918.2 | 931,108.18 | 4.04% | 61.54% |

Paired mean throughput differences (after versus reference), with Student-t 95% intervals:

| Workload | Versus before generic | Versus native | Native parity supported¹ |
| --- | ---: | ---: | --- |
| primary | 21.19% [18.9%, 23.49%] | -11.16% [-13.15%, -9.17%] | No |
| single | 12.89% [8.9%, 16.88%] | -5.89% [-9.2%, -2.59%] | No |
| large | 1.32% [-1.7%, 4.35%] | -38.55% [-40.22%, -36.88%] | No |
| unicode | 3.9% [2%, 5.79%] | -25.46% [-27.58%, -23.35%] | No |
| multiline | 4.45% [2.48%, 6.42%] | -38.16% [-38.87%, -37.46%] | No |

¹ Defined narrowly as the lower bound of the paired mean after/native throughput difference being at least zero. This repeat-level criterion does not establish equivalence across machines or production workloads.

Validated measured events: 30,600,000. Errors: 0. No retries or sample exclusions. A failed trial invalidates this control.

Default primary workload: sixteen streams, four loaders, 20,000 events per stream, 128-byte ASCII payload, batch sixteen. Single uses one stream/loader; large uses 1 KiB payloads and 5,000 events per stream; Unicode and multiline retain the primary layout. All use a fresh server and loader pool per trial, one full warmup, public batch API and opt-in 16 KiB coalescing for both MinkSSE versions.

The native baseline is unchanged Node HTTP SSE. Both MinkSSE builds use the same generic Web reader bridge; no private adapter, native producer capability, custom counter or alternate scorer is used. Native has fewer validation/queue semantics than MinkSSE. These are finite loopback measurements on a shared machine, not browser or production capacity results.

JSON contains every raw sample, CPU measurements, workload settings, source hashes and paired statistics. Source hashes are checked again after measurement; changing inputs invalidate the report.
