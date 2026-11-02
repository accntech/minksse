# SSE HTTP benchmark results

Generated 2026-11-02T01:44:52.263Z. Setup: **optimized**, effective strategies {"native":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"hono":{"bridge":"hono-node","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"fastify":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"better-sse":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"sveltekit-sse":{"bridge":"kit","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"minksse":{"bridge":"minksse-node","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384}}. 8 concurrent clients × 5000 events; 1024-byte ASCII payload per event, batch 16, interval 0 ms.

5 measured repeats, 1 full warmup pass(es) per fresh server. v24.12.0, Apple M4 Pro, darwin/arm64.

| Candidate | Median events/s | Mean events/s (95% CI) | Median completion ms | Median first event ms | Median per-trial p95 first event ms | Median server CPU ms | Median RSS after MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| native | 705,488.64 | 707,474.46 (690,977.57–723,971.35) | 56.7 | 0.95 | 1.11 | 62.05 | 83.22 |
| hono | 266,046.19 | 266,937.23 (261,207.1–272,667.36) | 150.35 | 1.61 | 1.92 | 185.43 | 112.36 |
| fastify | 468,461.79 | 469,707.05 (463,065.96–476,348.15) | 85.39 | 1.19 | 1.36 | 98.08 | 98.95 |
| better-sse | 506,536.17 | 509,557.77 (503,191.6–515,923.95) | 78.97 | 1.48 | 1.73 | 84.54 | 85.27 |
| sveltekit-sse | 266,656.67 | 264,613.39 (260,438.34–268,788.44) | 150.01 | 1.98 | 2.19 | 175.42 | 101.09 |
| minksse | 566,418.8 | 564,053.32 (552,937.67–575,168.97) | 70.62 | 1.72 | 1.99 | 80.72 | 85.36 |

All recorded streams passed exact event-count, order, payload and HTTP validation. Any error aborts the run without writing a successful report.

Throughput includes connection/request overhead, socket delivery and independent client validation. Both processes share this machine; client CPU and scheduler contention can cap results. Small samples and wide confidence intervals do not establish a reliable ranking. The Student-t interval describes mean throughput across these repeats, not a production guarantee.

The native baseline uses Node HTTP writes. Hono includes its router; Fastify includes its router and plugin. Hono, sveltekit-sse and MinkSSE use the selected per-candidate Web Response → Node HTTP adapter (effective strategies above). sveltekit-sse uses its real published producer bundled by esbuild; SvelteKit routing and the package clients are outside this measurement. Native/Hono/Fastify await exposed write backpressure; producer APIs cannot be made identical in that respect. See README.md for scope and reproducibility.

Package versions: @hono/node-server 2.1.5, hono 4.13.16, fastify 5.12.7, @fastify/sse 0.6.1, better-sse 0.16.1, sveltekit-sse 0.15.1, svelte 5.57.3, @sveltejs/kit 2.70.3, esbuild 0.28.2.

Raw samples and environment: four-loader-hotpath-all-large-2026-11-02.json. Local MinkSSE source commit 8868f9001c4d21c71cdcc94315f7d2d946f5b5e4; dirty checkout: true. The JSON includes the local compiled server and dependency lock hashes.
