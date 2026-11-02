# Native EventSource client benchmark

Native Node EventSource (--experimental-eventsource), optimized wrapper GET, previous wrapper GET, historical Fetch POST. Same isolated Node HTTP server, preframed identical JSON events; yield every batch. Exact count/order/payload validation and completion sentinel. Close immediately on done; no retries. Sequential rotated candidates; full warmup passes. Throughput includes connection startup and independent JSON validation. Completion is final validated sentinel, not EOF. CPU is client process only. Loopback Node measurements do not establish browser performance, server improvements, replay or WAN latency.

1 clients × 20000 events × 128 payload bytes; batch 16; 2 warmups; 20 measured repeats. v24.12.0, Apple M4 Pro, darwin/arm64.

| Client | Median events/s | Mean events/s (95% CI) | Median completion ms | Median client CPU ms |
| --- | ---: | ---: | ---: | ---: |
| native | 659,567.88 | 663,852.28 (656,269.17–671,435.4) | 30.32 | 30.91 |
| wrapper | 647,858.09 | 648,623.93 (638,527.7–658,720.16) | 30.87 | 31.38 |
| wrapper-before | 633,983.92 | 628,388.42 (608,851.82–647,925.01) | 31.55 | 31.91 |
| fetch-before | 799,368.64 | 801,074.84 (790,534.15–811,615.53) | 25.02 | 26.24 |

Wrapper versus each control within repeat blocks (mean percent throughput difference; Student-t 95% interval):
- native: -2.29% (-3.46–-1.12%).
- wrapper-before: 3.63% (0.09–7.17%).

All measured and warmup streams passed count, order, payload and completion-sentinel validation. Any failure aborts without writing a successful report. Small samples, scheduling noise and overlapping intervals do not establish a ranking. Native EventSource is experimental in this Node version; this benchmark uses no polyfill.
