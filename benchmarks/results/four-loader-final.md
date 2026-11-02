# Four-loader final results

Across all **14 completed primary trials per implementation**, the final build
measures **1,464,188 events/s**, versus **1,348,558 before** and **1,905,892 native**:
**8.6% more throughput**, **7.5% less median server CPU**, and
**76.8% of native throughput** (before: 70.8%). Native still leads.

The [combined primary data](four-loader-primary-combined.json) includes
every completed four-loader trial from both final-code runs, including the first
run that later stopped during its separate single-loader control. Implementation
and harness hashes match between runs; no successful primary trial was removed.

| Primary run | Before events/s | After events/s | Native events/s | After vs before |
| --- | ---: | ---: | ---: | ---: |
| First seven trials | 1,372,091 | 1,499,126 | 1,920,542 | +9.3% |
| Second seven trials | 1,334,372 | 1,393,000 | 1,887,656 | +4.4% |
| All fourteen | 1,348,558 | 1,464,188 | 1,905,892 | +8.6% |

Combined median server CPU per 320,000-event workload is 259.11 ms before,
239.57 ms after and 180.09 ms native. The median paired throughput change is
9.6%; the paired mean 95% interval is
3.2%–24.2%.
Timing varied substantially, including slow control outliers; the individual run
medians above show that uncertainty. Treat the direction of improvement as stronger
evidence than a precise portable percentage. Native parity is not established.

The [complete final run](four-loader-final.json) has seven primary repeats
and five repeats for each held-out workload. All rates and CPU figures below are
medians; wire-byte totals matched for every implementation in every workload.

| Workload | Before events/s | After events/s | Native events/s | After change | Server CPU before / after / native (ms) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Four loaders, 16 streams, ASCII 128 B | 1,334,372 | 1,393,000 | 1,887,656 | +4.4% | 261.07 / 252.87 / 182.11 |
| Four loaders, Unicode 128 B | 938,434 | 990,235 | 1,332,017 | +5.5% | 360.86 / 338.83 / 249.37 |
| Four loaders, mixed newlines | 832,745 | 1,118,096 | 1,482,438 | +34.3% | 397.99 / 307.31 / 228.55 |
| Four loaders, 1 KiB payload | 481,006 | 573,397 | 788,508 | +19.2% | 187.09 / 162.97 / 108.35 |
| One loader, one stream | 562,923 | 547,367 | 628,877 | -2.8% | 29.29 / 29.68 / 27.20 |
| Four loaders, sparse 1 ms | 12,124 | 12,503 | 11,440 | +3.1% | 64.49 / 49.29 / 77.42 |

The single-stream workload regressed 2.8% in median throughput (server CPU rose
about 0.4 ms); no single-stream speedup is claimed. Sparse throughput is governed
by timers and scheduling and does not show that MinkSSE exceeds native capacity.
The substantial multiline improvement follows the newline-jump change; Unicode
and larger payload improvements support keeping native byte counting.


See [implementation and verification](../FOUR-LOADER-OPTIMIZATION.md).
