# SSE HTTP benchmark results

Generated 2026-11-01T14:55:06.738Z. Setup: **optimized**, effective strategies {"native":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","coalesceBytes":16384},"hono":{"bridge":"hono-node","fastify":"send","better":"batch","cork":"off","native":"batch","coalesceBytes":16384},"fastify":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","coalesceBytes":16384},"better-sse":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","coalesceBytes":16384},"sveltekit-sse":{"bridge":"kit","fastify":"send","better":"batch","cork":"off","native":"batch","coalesceBytes":16384},"minksse":{"bridge":"minksse-node","fastify":"send","better":"batch","cork":"off","native":"batch","coalesceBytes":16384}}. 16 concurrent clients × 100 events; 128-byte ASCII payload per event, batch 1, interval 1 ms.

3 measured repeats, 1 full warmup pass(es) per fresh server. v24.12.0, Apple M4 Pro, darwin/arm64.

| Candidate | Median events/s | Mean events/s (95% CI) | Median completion ms | Median first event ms | Median per-trial p95 first event ms | Median server CPU ms | Median RSS after MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| native | 11,287.04 | 11,202.78 (9,781.07–12,624.49) | 141.76 | 0.68 | 0.77 | 31.96 | 65.41 |
| hono | 10,926.72 | 10,600.55 (8,506.73–12,694.37) | 146.43 | 0.62 | 0.83 | 37.5 | 74.69 |
| fastify | 11,156.78 | 11,220 (10,571.75–11,868.24) | 143.41 | 0.52 | 0.59 | 31.99 | 87.27 |
| better-sse | 10,462.81 | 10,340.83 (8,983.43–11,698.24) | 152.92 | 1.16 | 1.59 | 41.63 | 69.88 |
| sveltekit-sse | 10,741.49 | 10,693.88 (10,223.96–11,163.8) | 148.96 | 1.28 | 1.32 | 44.64 | 83.66 |
| minksse | 10,745.74 | 10,619.05 (10,015.99–11,222.12) | 148.9 | 1.29 | 1.81 | 44.47 | 72.83 |

All recorded streams passed exact event-count, order, payload and HTTP validation. Any error aborts the run without writing a successful report.

Throughput includes connection/request overhead, socket delivery and independent client validation. Both processes share this machine; client CPU and scheduler contention can cap results. Small samples and wide confidence intervals do not establish a reliable ranking. The Student-t interval describes mean throughput across these repeats, not a production guarantee.

The native baseline uses Node HTTP writes. Hono includes its router; Fastify includes its router and plugin. Hono, sveltekit-sse and MinkSSE use the selected per-candidate Web Response → Node HTTP adapter (effective strategies above). sveltekit-sse uses its real published producer bundled by esbuild; SvelteKit routing and the package clients are outside this measurement. Native/Hono/Fastify await exposed write backpressure; producer APIs cannot be made identical in that respect. See README.md for scope and reproducibility.

Package versions: @hono/node-server 2.1.5, hono 4.13.16, fastify 5.12.7, @fastify/sse 0.6.1, better-sse 0.16.1, sveltekit-sse 0.15.1, svelte 5.57.3, @sveltejs/kit 2.70.3, esbuild 0.28.2.

Raw samples and environment: implemented-sparse.json. Local MinkSSE source commit 8868f9001c4d21c71cdcc94315f7d2d946f5b5e4; dirty checkout: true. The JSON includes the local compiled server and dependency lock hashes.
