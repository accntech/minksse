# Native EventSource wrapper overhead — November 2, 2026

The optimized wrapper reached 98.2% of direct native EventSource median
throughput with one client and 97.3% with sixteen clients in this Node loopback
workload. Its default event-idle watchdog remained enabled. There is no API or
retry-policy change.

## Changes

- Copy subscription arrays when registrations change, instead of allocating
  snapshots and checking Set membership for every event. Invalidating removed
  records preserves reentrant unsubscribe, replacement and close behavior.
- Invoke event callbacks directly, eliminating per-listener closure creation.
- Skip Promise work for primitive return values. Pass object/function results
  directly to Promise.resolve so stateful thenable getters are read exactly once.
- Avoid clock reads when the caller disables idle detection.

This moves copying work to registration/disposal. Subscription churn is not
measured here and may cost more than the previous Set-based registration path.
The default watchdog still reads the monotonic clock for observed events.

## Same-run HTTP comparison

Node v24.12.0 native EventSource (`--experimental-eventsource`), Apple M4 Pro,
macOS arm64. A separate HTTP server sends identical preframed JSON events to
four rotated candidates: direct native, optimized wrapper, captured previous
wrapper, and historical Fetch client. Each workload uses 20,000 events per
client, 128-byte payloads, batch 16, two full warmups and twenty measured repeats.
The native wrappers both use their default 75,000 ms watchdog. Trials were
sequential; project tests and the diagnostic did not run during HTTP timing.

| Clients | Direct native events/s | Previous wrapper events/s | Optimized wrapper events/s | Median gain vs previous | Median gap to native |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 659,568 | 633,984 | 647,858 | +2.2% | -1.8% |
| 16 | 704,630 | 680,194 | 685,795 | +0.8% | -2.7% |

These are ratios of medians, not averages of per-repeat ratios. The mean
within-repeat throughput differences and Student-t 95% intervals were:

| Clients | Optimized vs direct native | Optimized vs previous wrapper |
| --- | ---: | ---: |
| 1 | -2.29% [-3.46%, -1.12%] | +3.63% [+0.09%, +7.17%] |
| 16 | -2.67% [-3.39%, -1.96%] | +0.85% [+0.27%, +1.42%] |

The one-client before/after mean is sensitive to a slow previous-wrapper sample
(+34.1% within that repeat), so the median improvement is a more conservative
headline. No samples were removed. These intervals describe the observed repeat
blocks; they do not capture all systematic machine or workload variability.

All 160 measured samples passed exact count, order, payload and completion
validation: **27,200,000 measured events**, or **29,920,000 including warmups**.
The harness rejects missing, duplicate, reordered, extra and corrupt events.
Reports record source and harness hashes; independent review recomputed the
metrics and confirmed all hashes match the measured implementation and fixtures.

The historical Fetch control remains faster: 799,369 events/s at one client and
992,300 events/s at sixteen. Native EventSource parsing and networking dominate
these HTTP timings. These are Node experimental EventSource observations, not
browser measurements or evidence of a server producer improvement.

Raw samples and CPU/throughput summaries:
[one client](results/optimized-native-client-1.json),
[sixteen clients](results/optimized-native-client-16.json).
Readable tables:
[one client](results/optimized-native-client-1.md),
[sixteen clients](results/optimized-native-client-16.md).
The prior historical runs are retained separately.

## Delivery-path diagnostic

A separate in-memory EventTarget experiment isolates wrapper delivery work from
HTTP and SSE parsing. It reuses a native MessageEvent containing JSON value 1,
checks the delivered sum, forces GC before timing, and rotates before/after
order. Each configuration has 500,000 dispatches per repeat, two warmups and nine
measured repeats. These timings must not be presented as network throughput.

| Configuration | Previous median ms | Optimized median ms | Time reduction |
| --- | ---: | ---: | ---: |
| Default watchdog, one listener | 43.815 | 36.101 | 17.6% |
| Watchdog disabled, one listener | 44.744 | 29.741 | 33.5% |
| Default watchdog, four listeners | 58.802 | 40.256 | 31.5% |

[Diagnostic raw samples, summaries and source hashes](results/wrapper-dispatch.json).

## Reproduce

From the repository root:

```sh
node --experimental-eventsource --disable-warning=UNDICI-ES benchmarks/client-benchmark.mjs --clients=1 --repeats=20 --output=benchmarks/results/optimized-native-client-1.json
node --experimental-eventsource --disable-warning=UNDICI-ES benchmarks/client-benchmark.mjs --clients=16 --repeats=20 --output=benchmarks/results/optimized-native-client-16.json
node --expose-gc benchmarks/wrapper-dispatch.mjs > benchmarks/results/wrapper-dispatch.json
bun run test
bun run check
npm --prefix benchmarks test
```

Keep timing runs sequential and avoid concurrent test workloads.

Final validation passed: 230 project tests (including real native HTTP integration
and seven new performance/reentrancy/thenable regressions), 33 benchmark tests,
TypeScript declaration/consumer checks, documentation generation and diff checks.
Software Architect review verified subscription behavior and the single-read
thenable fix; Performance Benchmarker review independently checked the HTTP
harness, raw samples, calculations and hashes.
