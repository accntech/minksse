# Native EventSource client benchmark

Native Node EventSource (--experimental-eventsource), native wrapper GET, historical Fetch POST. Same isolated Node HTTP server, preframed identical JSON events; yield every batch. Exact count/order/payload validation and completion sentinel. Close immediately on done; no retries. Sequential rotated candidates; full warmup passes. Throughput includes connection startup and independent JSON validation. Completion is final validated sentinel, not EOF. CPU is client process only. Loopback Node measurements do not establish browser performance, server improvements, replay or WAN latency.

1 clients × 20000 events × 128 payload bytes; batch 16; 2 warmups; 7 measured repeats. v24.12.0, Apple M4 Pro, darwin/arm64.

| Client | Median events/s | Mean events/s (95% CI) | Median completion ms | Median client CPU ms |
| --- | ---: | ---: | ---: | ---: |
| native | 661,744.02 | 652,336.82 (629,809.69–674,863.96) | 30.22 | 32.79 |
| wrapper | 618,830.22 | 624,902.41 (604,086.27–645,718.55) | 32.32 | 33.27 |
| fetch-before | 790,581.55 | 783,967.44 (765,305.69–802,629.19) | 25.3 | 27.94 |

All measured and warmup streams passed count, order, payload and completion-sentinel validation. Any failure aborts without writing a successful report. Small samples, scheduling noise and overlapping intervals do not establish a ranking. Native EventSource is experimental in this Node version; this benchmark uses no polyfill.
