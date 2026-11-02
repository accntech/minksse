# Native EventSource client benchmark

Native Node EventSource (--experimental-eventsource), native wrapper GET, historical Fetch POST. Same isolated Node HTTP server, preframed identical JSON events; yield every batch. Exact count/order/payload validation and completion sentinel. Close immediately on done; no retries. Sequential rotated candidates; full warmup passes. Throughput includes connection startup and independent JSON validation. Completion is final validated sentinel, not EOF. CPU is client process only. Loopback Node measurements do not establish browser performance, server improvements, replay or WAN latency.

16 clients × 20000 events × 128 payload bytes; batch 16; 2 warmups; 7 measured repeats. v24.12.0, Apple M4 Pro, darwin/arm64.

| Client | Median events/s | Mean events/s (95% CI) | Median completion ms | Median client CPU ms |
| --- | ---: | ---: | ---: | ---: |
| native | 684,991.25 | 687,624.29 (681,551.72–693,696.87) | 467.16 | 482.94 |
| wrapper | 663,383.95 | 662,560.67 (658,129.38–666,991.96) | 482.38 | 505.67 |
| fetch-before | 956,411.19 | 956,583.94 (943,293.23–969,874.65) | 334.58 | 363.25 |

All measured and warmup streams passed count, order, payload and completion-sentinel validation. Any failure aborts without writing a successful report. Small samples, scheduling noise and overlapping intervals do not establish a ranking. Native EventSource is experimental in this Node version; this benchmark uses no polyfill.
