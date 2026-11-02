# SSE HTTP benchmark results

Generated 2026-11-01T14:40:52.920Z. Setup: **baseline**, effective strategies {"native":{"bridge":"pipeline","fastify":"send","better":"push","cork":"off","native":"write"},"hono":{"bridge":"pipeline","fastify":"send","better":"push","cork":"off","native":"write"},"fastify":{"bridge":"pipeline","fastify":"send","better":"push","cork":"off","native":"write"},"better-sse":{"bridge":"pipeline","fastify":"send","better":"push","cork":"off","native":"write"},"sveltekit-sse":{"bridge":"pipeline","fastify":"send","better":"push","cork":"off","native":"write"},"minksse":{"bridge":"pipeline","fastify":"send","better":"push","cork":"off","native":"write"}}. 16 concurrent clients × 100 events; 128-byte ASCII payload per event, batch 1, interval 1 ms.

3 measured repeats, 1 full warmup pass(es) per fresh server. v24.12.0, Apple M4 Pro, darwin/arm64.

| Candidate | Median events/s | Mean events/s (95% CI) | Median completion ms | Median first event ms | Median per-trial p95 first event ms | Median server CPU ms | Median RSS after MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| native | 10,327.88 | 10,496.68 (7,642.86–13,350.49) | 154.92 | 0.41 | 0.5 | 62.52 | 65.59 |
| hono | 10,030.34 | 10,329.24 (8,647.82–12,010.66) | 159.52 | 0.95 | 1.7 | 53.15 | 77.09 |
| fastify | 11,038.62 | 11,017.68 (10,370.24–11,665.11) | 144.95 | 0.78 | 0.87 | 39.08 | 87.02 |
| better-sse | 10,375.23 | 10,471.2 (9,124.25–11,818.14) | 154.21 | 1.02 | 1.37 | 55.85 | 68.5 |
| sveltekit-sse | 9,357.07 | 9,329.29 (9,110.87–9,547.7) | 170.99 | 1.48 | 2.2 | 77.48 | 83.84 |
| minksse | 10,418.65 | 10,434.79 (9,616.44–11,253.14) | 153.57 | 1.37 | 1.39 | 45.49 | 72.52 |

All recorded streams passed exact event-count, order, payload and HTTP validation. Any error aborts the run without writing a successful report.

Throughput includes connection/request overhead, socket delivery and independent client validation. Both processes share this machine; client CPU and scheduler contention can cap results. Small samples and wide confidence intervals do not establish a reliable ranking. The Student-t interval describes mean throughput across these repeats, not a production guarantee.

The native baseline uses Node HTTP writes. Hono includes its router; Fastify includes its router and plugin. Hono, sveltekit-sse and MinkSSE use the selected per-candidate Web Response → Node HTTP adapter (effective strategies above). sveltekit-sse uses its real published producer bundled by esbuild; SvelteKit routing and the package clients are outside this measurement. Native/Hono/Fastify await exposed write backpressure; producer APIs cannot be made identical in that respect. See README.md for scope and reproducibility.

Package versions: @hono/node-server 2.1.5, hono 4.13.16, fastify 5.12.7, @fastify/sse 0.6.1, better-sse 0.16.1, sveltekit-sse 0.15.1, svelte 5.57.3, @sveltejs/kit 2.70.3, esbuild 0.28.2.

Raw samples and environment: baseline-sparse.json. Local MinkSSE source commit 8868f9001c4d21c71cdcc94315f7d2d946f5b5e4; dirty checkout: true. The JSON includes the local compiled server and dependency lock hashes.
