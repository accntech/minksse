# SSE HTTP benchmark results

Generated 2026-11-02T01:57:04.900Z. Setup: **optimized**, effective strategies {"native":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"hono":{"bridge":"hono-node","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"fastify":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"better-sse":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"sveltekit-sse":{"bridge":"kit","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"minksse":{"bridge":"minksse-node","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384}}. 16 concurrent clients × 20000 events; 128-byte ASCII payload per event, batch 16, interval 0 ms.

7 measured repeats, 1 full warmup pass(es) per fresh server. v24.12.0, Apple M4 Pro, darwin/arm64.

| Candidate | Median events/s | Mean events/s (95% CI) | Median completion ms | Median first event ms | Median per-trial p95 first event ms | Median server CPU ms | Median RSS after MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| native | 1,913,496.98 | 1,906,304.65 (1,883,689.9–1,928,919.4) | 167.23 | 0.71 | 0.87 | 179.23 | 81.69 |
| hono | 343,663.23 | 342,904.51 (336,813.65–348,995.38) | 931.14 | 1.57 | 2.01 | 980.95 | 253.28 |
| fastify | 782,156.64 | 784,338.97 (779,870.49–788,807.45) | 409.13 | 1 | 1.42 | 419.16 | 110.14 |
| better-sse | 1,336,326.62 | 1,331,015.79 (1,319,755.64–1,342,275.95) | 239.46 | 1.36 | 1.67 | 252.11 | 84.34 |
| sveltekit-sse | 341,539.47 | 342,404.08 (339,298.97–345,509.19) | 936.93 | 2.03 | 2.3 | 1,002.85 | 114.17 |
| minksse | 1,682,746.62 | 1,665,994.82 (1,625,065.76–1,706,923.88) | 190.17 | 1.3 | 1.66 | 208.95 | 88.59 |

All recorded streams passed exact event-count, order, payload and HTTP validation. Any error aborts the run without writing a successful report.

Throughput includes connection/request overhead, socket delivery and independent client validation. Both processes share this machine; client CPU and scheduler contention can cap results. Small samples and wide confidence intervals do not establish a reliable ranking. The Student-t interval describes mean throughput across these repeats, not a production guarantee.

The native baseline uses Node HTTP writes. Hono includes its router; Fastify includes its router and plugin. Hono, sveltekit-sse and MinkSSE use the selected per-candidate Web Response → Node HTTP adapter (effective strategies above). sveltekit-sse uses its real published producer bundled by esbuild; SvelteKit routing and the package clients are outside this measurement. Native/Hono/Fastify await exposed write backpressure; producer APIs cannot be made identical in that respect. See README.md for scope and reproducibility.

Package versions: @hono/node-server 2.1.5, hono 4.13.16, fastify 5.12.7, @fastify/sse 0.6.1, better-sse 0.16.1, sveltekit-sse 0.15.1, svelte 5.57.3, @sveltejs/kit 2.70.3, esbuild 0.28.2.

Raw samples and environment: owned-copy-all-four-loader-2026-11-02.json. Local MinkSSE source commit 8868f9001c4d21c71cdcc94315f7d2d946f5b5e4; dirty checkout: true. The JSON includes the local compiled server and dependency lock hashes.
