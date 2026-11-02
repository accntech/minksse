# SSE HTTP benchmark results

Generated 2026-11-02T05:14:24.090Z. Setup: **optimized**, effective strategies {"native":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"hono":{"bridge":"hono-node","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"fastify":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"better-sse":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"sveltekit-sse":{"bridge":"kit","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"minksse":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384}}. 16 concurrent clients × 20000 events; 128-byte ASCII payload per event, batch 16, interval 0 ms.

6 measured repeats, 1 full warmup pass(es) per fresh server. v24.12.0, Apple M4 Pro, darwin/arm64.

| Candidate | Median events/s | Mean events/s (95% CI) | Median completion ms | Median first event ms | Median per-trial p95 first event ms | Median server CPU ms | Median RSS after MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| native | 1,343,377.05 | 1,348,107.99 (1,295,871.95–1,400,344.02) | 238.24 | 0.79 | 1.07 | 247.29 | 82.71 |
| hono | 315,856.94 | 310,012.01 (289,966.14–330,057.88) | 1,013.31 | 1.65 | 2.08 | 1,086.82 | 255.13 |
| fastify | 630,701.96 | 626,651.49 (610,181.34–643,121.64) | 507.37 | 1.18 | 2.15 | 518.64 | 109.62 |
| better-sse | 972,853.13 | 896,002.82 (684,088.97–1,107,916.67) | 328.93 | 1.4 | 1.76 | 342.95 | 84.91 |
| sveltekit-sse | 315,924.82 | 305,158.87 (272,283.57–338,034.18) | 1,013.16 | 2.05 | 2.29 | 1,074.18 | 115.49 |
| minksse | 1,027,448.42 | 998,092.59 (910,448.42–1,085,736.76) | 311.45 | 1.33 | 1.66 | 331.61 | 91.36 |

All recorded streams passed exact event-count, order, payload and HTTP validation. Any error aborts the run without writing a successful report.

Throughput includes connection/request overhead, socket delivery and independent client validation. Both processes share this machine; client CPU and scheduler contention can cap results. Small samples and wide confidence intervals do not establish a reliable ranking. The Student-t interval describes mean throughput across these repeats, not a production guarantee.

The native baseline uses Node HTTP writes. Hono includes its router; Fastify includes its router and plugin. Hono, sveltekit-sse and MinkSSE use the selected per-candidate Web Response → Node HTTP adapter (effective strategies above). sveltekit-sse uses its real published producer bundled by esbuild; SvelteKit routing and the package clients are outside this measurement. Native/Hono/Fastify await exposed write backpressure; producer APIs cannot be made identical in that respect. See README.md for scope and reproducibility.

Package versions: @hono/node-server 2.1.5, hono 4.13.16, fastify 5.12.7, @fastify/sse 0.6.1, better-sse 0.16.1, sveltekit-sse 0.15.1, svelte 5.57.3, @sveltejs/kit 2.70.3, esbuild 0.28.2.

Raw samples and environment: portable-optimized-all-unicode-2026-11-02.json. Local MinkSSE source commit 59e781d027a0d27bb93540b7c8125406feeae078; dirty checkout: true. The JSON includes the local compiled server and dependency lock hashes.
