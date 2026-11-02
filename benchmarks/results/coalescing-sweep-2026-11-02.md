# Explicit coalescing sweep

Status: **complete**. v24.12.0, Apple M4 Pro, darwin/arm64.

Same frozen baseline producer at explicit 16/32/64 KiB targets, rotated setting order within repeat and workload order between repeats. Six repeats per setting by default. Fresh server and loader pool per trial, one complete warmup, unchanged generic Web reader/scorer/native implementation, public emitBatch API. Strict CR/LF/CRLF-aware HTTP/status/name/ID/count/order/payload validation and equal wire bytes. No native target is measured in this sweep; no native-parity conclusion follows.

| Workload | Setting | Median events/s | Median server CPU ms | Median first-event p95 ms | Median RSS after MiB | Paired mean throughput vs 16 KiB (95% CI) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| primary | 16 KiB | 1,675,427.85 | 210.01 | 1.44 | 88.39 | 0% [0%, 0%] |
| primary | 32 KiB | 1,647,316.51 | 214.65 | 1.48 | 88.38 | -1.95% [-3.18%, -0.71%] |
| primary | 64 KiB | 1,646,261.79 | 214.19 | 1.52 | 88.22 | -6.34% [-17.85%, 5.16%] |
| single | 16 KiB | 595,695.73 | 23.2 | 0.76 | 84.02 | 0% [0%, 0%] |
| single | 32 KiB | 593,408.15 | 23.8 | 0.8 | 83.96 | 0.43% [-5.58%, 6.43%] |
| single | 64 KiB | 592,267.64 | 23.82 | 0.73 | 84.05 | 1.69% [-7.2%, 10.57%] |
| large | 16 KiB | 483,574.02 | 186.97 | 1.73 | 94.72 | 0% [0%, 0%] |
| large | 32 KiB | 489,196.75 | 182.93 | 1.93 | 94.84 | -3.95% [-17.3%, 9.39%] |
| large | 64 KiB | 756,350.99 | 121.33 | 1.55 | 96.12 | 58.52% [55.74%, 61.31%] |
| unicode | 16 KiB | 1,053,586.55 | 324.49 | 1.67 | 91.43 | 0% [0%, 0%] |
| unicode | 32 KiB | 1,052,374.76 | 326.18 | 1.63 | 91.34 | -2.68% [-31.22%, 25.85%] |
| unicode | 64 KiB | 1,059,267.27 | 323.55 | 1.55 | 91.31 | 9.39% [-8.46%, 27.24%] |
| multiline | 16 KiB | 919,869.48 | 370.89 | 1.57 | 96.41 | 0% [0%, 0%] |
| multiline | 32 KiB | 925,318.39 | 370.51 | 1.9 | 96.47 | -3.14% [-14.13%, 7.85%] |
| multiline | 64 KiB | 925,193.38 | 370.51 | 1.63 | 96.3 | 5.84% [-9.55%, 21.23%] |

| Workload | Setting | Paired mean first-event p95 delta ms (95% CI) | Paired mean RSS-after delta MiB (95% CI) |
| --- | ---: | ---: | ---: |
| primary | 16 KiB | 0 [0, 0] | 0 [0, 0] |
| primary | 32 KiB | -0.09 [-0.42, 0.24] | 0.12 [-0.24, 0.48] |
| primary | 64 KiB | 0.13 [-0.33, 0.59] | -0.14 [-0.25, -0.02] |
| single | 16 KiB | 0 [0, 0] | 0 [0, 0] |
| single | 32 KiB | -0 [-0.14, 0.13] | -0.25 [-0.63, 0.14] |
| single | 64 KiB | -0.06 [-0.2, 0.09] | -0.05 [-0.39, 0.29] |
| large | 16 KiB | 0 [0, 0] | 0 [0, 0] |
| large | 32 KiB | 0.23 [-0.11, 0.56] | 0.3 [-0.39, 1] |
| large | 64 KiB | -0.2 [-0.39, -0.02] | 1.43 [0.98, 1.88] |
| unicode | 16 KiB | 0 [0, 0] | 0 [0, 0] |
| unicode | 32 KiB | 0.11 [-0.22, 0.43] | -0.13 [-0.5, 0.24] |
| unicode | 64 KiB | 0 [-0.46, 0.46] | -0.04 [-0.6, 0.51] |
| multiline | 16 KiB | 0 [0, 0] | 0 [0, 0] |
| multiline | 32 KiB | 0.51 [-0.48, 1.5] | 0.05 [-0.41, 0.51] |
| multiline | 64 KiB | -0.06 [-0.42, 0.31] | -0.06 [-0.28, 0.16] |

Validated measured events: 19,080,000; errors: 0. No retries or exclusions.

These are explicit settings, not default changes. Public coalescing remains off by default; the shared comparison harness retains its 16 KiB setting. A larger target can alter chunk count and fast-path eligibility simultaneously. Any proposed setting must retain its 16 KiB control in subsequent acceptance measurements.

The separately isolated untimed diagnostic records initial 16-event batch geometry, emitted chunk sizes, encode/encodeInto calls and incomplete encodeInto attempts. It is not throughput evidence and does not instrument timed server/scorer processes.

First-event p95 is request-to-first-validated-event latency across concurrent clients, not per-event latency. RSS-after and process peak RSS include imports/warmup; they do not establish per-connection allocation or sustained slow-reader retention.

Finite loopback results on one Node host do not establish browser/runtime portability, long-lived slow-consumer memory behavior or a universally optimal target. JSON retains every sample, paired intervals, exact settings, diagnostics and before/after source hashes.
