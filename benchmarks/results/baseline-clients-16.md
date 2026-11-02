# SSE HTTP benchmark results

Generated 2026-11-01T14:39:04.978Z. Setup: **baseline**, effective strategies {"native":{"bridge":"pipeline","fastify":"send","better":"push","cork":"off","native":"write"},"hono":{"bridge":"pipeline","fastify":"send","better":"push","cork":"off","native":"write"},"fastify":{"bridge":"pipeline","fastify":"send","better":"push","cork":"off","native":"write"},"better-sse":{"bridge":"pipeline","fastify":"send","better":"push","cork":"off","native":"write"},"sveltekit-sse":{"bridge":"pipeline","fastify":"send","better":"push","cork":"off","native":"write"},"minksse":{"bridge":"pipeline","fastify":"send","better":"push","cork":"off","native":"write"}}. 16 concurrent clients × 20000 events; 128-byte ASCII payload per event, batch 16, interval 0 ms.

5 measured repeats, 1 full warmup pass(es) per fresh server. v24.12.0, Apple M4 Pro, darwin/arm64.

| Candidate | Median events/s | Mean events/s (95% CI) | Median completion ms | Median first event ms | Median per-trial p95 first event ms | Median server CPU ms | Median RSS after MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| native | 1,099,790.52 | 1,100,845.55 (1,087,635.85–1,114,055.25) | 290.96 | 0.58 | 1.06 | 298.68 | 80.67 |
| hono | 200,139.94 | 198,807.79 (193,395.51–204,220.08) | 1,598.88 | 2.21 | 3.8 | 1,648.58 | 132.34 |
| fastify | 889,097.37 | 888,251.56 (866,946.06–909,557.07) | 359.92 | 0.72 | 1.26 | 369.89 | 93.89 |
| better-sse | 854,174.88 | 850,579.57 (828,582.78–872,576.37) | 374.63 | 1.15 | 1.39 | 384.77 | 82.3 |
| sveltekit-sse | 118,084.07 | 117,160.12 (115,063.52–119,256.73) | 2,709.93 | 2.99 | 4.34 | 2,773.51 | 111 |
| minksse | 292,091.17 | 290,746.15 (283,884.93–297,607.37) | 1,095.55 | 2.18 | 2.94 | 1,133.53 | 101.48 |

All recorded streams passed exact event-count, order, payload and HTTP validation. Any error aborts the run without writing a successful report.

Throughput includes connection/request overhead, socket delivery and independent client validation. Both processes share this machine; client CPU and scheduler contention can cap results. Small samples and wide confidence intervals do not establish a reliable ranking. The Student-t interval describes mean throughput across these repeats, not a production guarantee.

The native baseline uses Node HTTP writes. Hono includes its router; Fastify includes its router and plugin. Hono, sveltekit-sse and MinkSSE use the selected per-candidate Web Response → Node HTTP adapter (effective strategies above). sveltekit-sse uses its real published producer bundled by esbuild; SvelteKit routing and the package clients are outside this measurement. Native/Hono/Fastify await exposed write backpressure; producer APIs cannot be made identical in that respect. See README.md for scope and reproducibility.

Package versions: @hono/node-server 2.1.5, hono 4.13.16, fastify 5.12.7, @fastify/sse 0.6.1, better-sse 0.16.1, sveltekit-sse 0.15.1, svelte 5.57.3, @sveltejs/kit 2.70.3, esbuild 0.28.2.

Raw samples and environment: baseline-clients-16.json. Local MinkSSE source commit 8868f9001c4d21c71cdcc94315f7d2d946f5b5e4; dirty checkout: true. The JSON includes the local compiled server and dependency lock hashes.
