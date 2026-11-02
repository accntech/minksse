# Native EventSource wrapper validation — November 2, 2026

The replacement client delegates SSE parsing and HTTP GET to native EventSource.
This is a simplification and native-API integration change; these measurements
**do not show a throughput improvement** over the former Fetch client.

Node v24.12.0 with `--experimental-eventsource`, Apple M4 Pro, macOS arm64.
Each client receives 20,000 events with 128-byte ASCII payloads, batch 16.
Two full warmup passes precede seven measured repeats; candidate order rotates.
The server runs in a separate process. All candidates receive the same
preframed bytes and perform identical JSON sequence/payload validation.

| Concurrent clients | Direct native median events/s | Native wrapper median events/s | Former Fetch median events/s |
| --- | ---: | ---: | ---: |
| 1 | 661,744 | 618,830 | 790,582 |
| 16 | 684,991 | 663,384 | 956,411 |

The wrapper's observed median throughput is 6.5% lower than direct native at one
client and 3.2% lower at sixteen. The single-client mean confidence intervals
overlap, so that run does not establish a reliable wrapper-overhead ranking.
Against the former Fetch implementation, wrapper median throughput is 21.7%
lower at one client and 30.6% lower at sixteen. The comparison includes the
entire change from Fetch POST/custom parser to native EventSource GET, rather
than attributing this difference to wrapper code alone.

Across both workloads, 42 measured samples validated 7,140,000 delivered events;
including full warmups, 9,180,000 events passed exact count/order/payload checks.
A named completion sentinel verifies count before closing each stream. Streams
stay open until the client closes, keeping reconnect and EOF handling outside
the timing. The harness aborts on transport error, malformed data, incorrect
sequence/count/payload or timeout, without recording a successful report.
The validator's test explicitly rejects missing, duplicate, extra, reordered
and corrupt events. The full benchmark test suite passes 33/33.

These are Node native runtime measurements, not browser results. EventSource is
experimental in this Node release. No polyfill was used. Loopback scheduling,
connection overhead, JSON work and the Node native parser all contribute to
throughput. The existing all-package benchmark measures server producers with
an independent Fetch consumer; it cannot establish wrapper performance. Server
producer code is unchanged by this client comparison.

Reproduction commands and methodology are in [README](README.md#native-client-wrapper-comparison).
Raw repeat scores, Student-t 95% mean intervals, CPU timing, environment and
source SHA-256 hashes are in [one-client JSON](results/native-client-1.json) and
[sixteen-client JSON](results/native-client-16.json); readable summaries are
[one client](results/native-client-1.md) and
[sixteen clients](results/native-client-16.md). Both reports' wrapper hashes
matched the final source file after measurement, including the cross-realm
MessageEvent classification fix. These runs replace the initial measurements.

After measurement, the harness default output path was anchored to its own
directory so both root and `npm --prefix benchmarks run bench:client` invocations
write under `benchmarks/results/`. Only the URL import and default destination
changed; measured logic, wrapper source and raw timings are unchanged. JSON
retains `measuredHarnessSha256` and records the current `harnessSha256` plus
this change. The validator test and a ten-event npm-script smoke run passed.
