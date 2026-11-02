# Portable Web-stream producer control

Status: **complete**. Generated 2026-11-02T03:07:34.869Z. v24.12.0, Apple M4 Pro, darwin/arm64.

Fixed native/before-generic/after-generic candidates rotate within each repeat, and workload order rotates between repeat blocks. Current unmodified benchmark harness/native target/scoring; generic direct Web bridge. Fresh server and loader pool; one complete warmup. Exact HTTP status, event name, ID, payload, sequence, count and wire-byte equivalence checks. Sequential trials, no automatic retries or exclusions. Throughput includes request/socket delivery and independent client validation; startup and warmup are excluded.

| Workload | Repeats per candidate | Native median events/s | Before generic | After generic | After/before | After/native |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| primary | 3 | 1,945,599.22 | 1,394,751.56 | 1,732,314.93 | 24.2% | 89.04% |
| single | 3 | 604,009.12 | 517,077.57 | 598,462.7 | 15.74% | 99.08% |
| unicode | 3 | 1,456,690.49 | 1,065,234.22 | 1,086,142.1 | 1.96% | 74.56% |

Paired mean throughput differences (after versus reference), with Student-t 95% intervals:

| Workload | Versus before generic | Versus native | Native parity supported¹ |
| --- | ---: | ---: | --- |
| primary | 23.61% [21.11%, 26.1%] | -10.84% [-15.24%, -6.44%] | No |
| single | 13% [6.31%, 19.7%] | -4.68% [-16.12%, 6.76%] | No |
| unicode | 2.15% [-1.43%, 5.73%] | -26.14% [-29.03%, -23.24%] | No |

¹ Defined narrowly as the lower bound of the paired mean after/native throughput difference being at least zero. This repeat-level criterion does not establish equivalence across machines or production workloads.

Validated measured events: 5,940,000. Errors: 0. No retries or sample exclusions. A failed trial invalidates this control.

Default primary workload: sixteen streams, four loaders, 20,000 events per stream, 128-byte ASCII payload, batch sixteen. Single uses one stream/loader; large uses 1 KiB payloads and 5,000 events per stream; Unicode and multiline retain the primary layout. All use a fresh server and loader pool per trial, one full warmup, public batch API and opt-in 16 KiB coalescing for both MinkSSE versions.

The native baseline is unchanged Node HTTP SSE. Both MinkSSE builds use the same generic Web reader bridge; no private adapter, native producer capability, custom counter or alternate scorer is used. Native has fewer validation/queue semantics than MinkSSE. These are finite loopback measurements on a shared machine, not browser or production capacity results.

JSON contains every raw sample, CPU measurements, workload settings, source hashes and paired statistics. Source hashes are checked again after measurement; changing inputs invalidate the report.
