# SSE HTTP benchmark results

Generated 2026-11-02T05:13:11.696Z. Setup: **optimized**, effective strategies {"native":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"hono":{"bridge":"hono-node","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"fastify":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"better-sse":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"sveltekit-sse":{"bridge":"kit","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"minksse":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384}}. 1 concurrent clients × 20000 events; 128-byte ASCII payload per event, batch 16, interval 0 ms.

7 measured repeats, 1 full warmup pass(es) per fresh server. v24.12.0, Apple M4 Pro, darwin/arm64.

| Candidate | Median events/s | Mean events/s (95% CI) | Median completion ms | Median first event ms | Median per-trial p95 first event ms | Median server CPU ms | Median RSS after MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| native | 590,154.74 | 597,005.12 (582,076.54–611,933.7) | 33.89 | 0.51 | 0.51 | 28.99 | 78.91 |
| hono | 233,938.99 | 233,852.16 (227,576.48–240,127.84) | 85.49 | 0.87 | 0.87 | 106.75 | 103.13 |
| fastify | 395,838.42 | 403,542.32 (389,038.64–418,046) | 50.53 | 0.63 | 0.63 | 49.74 | 94.16 |
| better-sse | 504,155.62 | 509,297.48 (497,886.82–520,708.14) | 39.67 | 0.81 | 0.81 | 28.14 | 81.47 |
| sveltekit-sse | 239,667.34 | 239,844.81 (236,452.57–243,237.05) | 83.45 | 0.97 | 0.97 | 96.12 | 95.53 |
| minksse | 557,103.7 | 563,195.99 (536,559.57–589,832.42) | 35.9 | 0.74 | 0.74 | 25.91 | 84.31 |

All recorded streams passed exact event-count, order, payload and HTTP validation. Any error aborts the run without writing a successful report.

Throughput includes connection/request overhead, socket delivery and independent client validation. Both processes share this machine; client CPU and scheduler contention can cap results. Small samples and wide confidence intervals do not establish a reliable ranking. The Student-t interval describes mean throughput across these repeats, not a production guarantee.

The native baseline uses Node HTTP writes. Hono includes its router; Fastify includes its router and plugin. Hono, sveltekit-sse and MinkSSE use the selected per-candidate Web Response → Node HTTP adapter (effective strategies above). sveltekit-sse uses its real published producer bundled by esbuild; SvelteKit routing and the package clients are outside this measurement. Native/Hono/Fastify await exposed write backpressure; producer APIs cannot be made identical in that respect. See README.md for scope and reproducibility.

Package versions: @hono/node-server 2.1.5, hono 4.13.16, fastify 5.12.7, @fastify/sse 0.6.1, better-sse 0.16.1, sveltekit-sse 0.15.1, svelte 5.57.3, @sveltejs/kit 2.70.3, esbuild 0.28.2.

Raw samples and environment: portable-optimized-all-single-2026-11-02.json. Local MinkSSE source commit 59e781d027a0d27bb93540b7c8125406feeae078; dirty checkout: true. The JSON includes the local compiled server and dependency lock hashes.
