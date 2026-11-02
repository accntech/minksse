# SSE HTTP benchmark results

Generated 2026-11-01T14:38:51.162Z. Setup: **baseline**, effective strategies {"native":{"bridge":"pipeline","fastify":"send","better":"push","cork":"off","native":"write"},"hono":{"bridge":"pipeline","fastify":"send","better":"push","cork":"off","native":"write"},"fastify":{"bridge":"pipeline","fastify":"send","better":"push","cork":"off","native":"write"},"better-sse":{"bridge":"pipeline","fastify":"send","better":"push","cork":"off","native":"write"},"sveltekit-sse":{"bridge":"pipeline","fastify":"send","better":"push","cork":"off","native":"write"},"minksse":{"bridge":"pipeline","fastify":"send","better":"push","cork":"off","native":"write"}}. 1 concurrent clients × 20000 events; 128-byte ASCII payload per event, batch 16, interval 0 ms.

5 measured repeats, 1 full warmup pass(es) per fresh server. v24.12.0, Apple M4 Pro, darwin/arm64.

| Candidate | Median events/s | Mean events/s (95% CI) | Median completion ms | Median first event ms | Median per-trial p95 first event ms | Median server CPU ms | Median RSS after MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| native | 465,389.56 | 464,715.76 (456,921.68–472,509.84) | 42.97 | 0.59 | 0.59 | 40.35 | 79.78 |
| hono | 131,614.92 | 134,015.42 (127,966.49–140,064.35) | 151.96 | 0.99 | 0.99 | 189.52 | 86.81 |
| fastify | 416,200.24 | 418,939.69 (404,128.45–433,750.93) | 48.05 | 0.57 | 0.57 | 47.23 | 93.25 |
| better-sse | 385,696.45 | 387,862.38 (380,800–394,924.76) | 51.85 | 0.81 | 0.81 | 54.46 | 80.95 |
| sveltekit-sse | 90,803.17 | 89,308.2 (83,641.85–94,974.56) | 220.26 | 0.94 | 0.94 | 249.27 | 94.73 |
| minksse | 176,088.89 | 175,570.23 (172,875.3–178,265.16) | 113.58 | 0.98 | 0.98 | 144.32 | 85.05 |

All recorded streams passed exact event-count, order, payload and HTTP validation. Any error aborts the run without writing a successful report.

Throughput includes connection/request overhead, socket delivery and independent client validation. Both processes share this machine; client CPU and scheduler contention can cap results. Small samples and wide confidence intervals do not establish a reliable ranking. The Student-t interval describes mean throughput across these repeats, not a production guarantee.

The native baseline uses Node HTTP writes. Hono includes its router; Fastify includes its router and plugin. Hono, sveltekit-sse and MinkSSE use the selected per-candidate Web Response → Node HTTP adapter (effective strategies above). sveltekit-sse uses its real published producer bundled by esbuild; SvelteKit routing and the package clients are outside this measurement. Native/Hono/Fastify await exposed write backpressure; producer APIs cannot be made identical in that respect. See README.md for scope and reproducibility.

Package versions: @hono/node-server 2.1.5, hono 4.13.16, fastify 5.12.7, @fastify/sse 0.6.1, better-sse 0.16.1, sveltekit-sse 0.15.1, svelte 5.57.3, @sveltejs/kit 2.70.3, esbuild 0.28.2.

Raw samples and environment: baseline-clients-1.json. Local MinkSSE source commit 8868f9001c4d21c71cdcc94315f7d2d946f5b5e4; dirty checkout: true. The JSON includes the local compiled server and dependency lock hashes.
