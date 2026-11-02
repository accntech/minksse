# Native EventSource client benchmark

Native Node EventSource (--experimental-eventsource), optimized wrapper GET, previous wrapper GET, historical Fetch POST. Same isolated Node HTTP server, preframed identical JSON events; yield every batch. Exact count/order/payload validation and completion sentinel. Close immediately on done; no retries. Sequential rotated candidates; full warmup passes. Throughput includes connection startup and independent JSON validation. Completion is final validated sentinel, not EOF. CPU is client process only. Loopback Node measurements do not establish browser performance, server improvements, replay or WAN latency.

16 clients × 20000 events × 128 payload bytes; batch 16; 2 warmups; 20 measured repeats. v24.12.0, Apple M4 Pro, darwin/arm64.

| Client | Median events/s | Mean events/s (95% CI) | Median completion ms | Median client CPU ms |
| --- | ---: | ---: | ---: | ---: |
| native | 704,629.59 | 703,693.04 (700,435.75–706,950.34) | 454.14 | 470.99 |
| wrapper | 685,794.59 | 684,803.04 (681,308.26–688,297.82) | 466.61 | 484.92 |
| wrapper-before | 680,193.88 | 679,100.31 (675,916.35–682,284.27) | 470.45 | 490.44 |
| fetch-before | 992,300.33 | 992,637.46 (985,139.15–1,000,135.77) | 322.48 | 349.19 |

Wrapper versus each control within repeat blocks (mean percent throughput difference; Student-t 95% interval):
- native: -2.67% (-3.39–-1.96%).
- wrapper-before: 0.85% (0.27–1.42%).

All measured and warmup streams passed count, order, payload and completion-sentinel validation. Any failure aborts without writing a successful report. Small samples, scheduling noise and overlapping intervals do not establish a ranking. Native EventSource is experimental in this Node version; this benchmark uses no polyfill.
