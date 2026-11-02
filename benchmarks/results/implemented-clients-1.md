# SSE HTTP benchmark results

Generated 2026-11-01T14:54:24.088Z. Setup: **optimized**, effective strategies {"native":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","coalesceBytes":16384},"hono":{"bridge":"hono-node","fastify":"send","better":"batch","cork":"off","native":"batch","coalesceBytes":16384},"fastify":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","coalesceBytes":16384},"better-sse":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","coalesceBytes":16384},"sveltekit-sse":{"bridge":"kit","fastify":"send","better":"batch","cork":"off","native":"batch","coalesceBytes":16384},"minksse":{"bridge":"minksse-node","fastify":"send","better":"batch","cork":"off","native":"batch","coalesceBytes":16384}}. 1 concurrent clients × 20000 events; 128-byte ASCII payload per event, batch 16, interval 0 ms.

5 measured repeats, 1 full warmup pass(es) per fresh server. v24.12.0, Apple M4 Pro, darwin/arm64.

| Candidate | Median events/s | Mean events/s (95% CI) | Median completion ms | Median first event ms | Median per-trial p95 first event ms | Median server CPU ms | Median RSS after MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| native | 621,818.85 | 626,733.97 (610,353.15–643,114.78) | 32.16 | 0.47 | 0.47 | 20.76 | 78.64 |
| hono | 241,094.69 | 242,831.45 (237,147.57–248,515.33) | 82.95 | 0.83 | 0.83 | 104.78 | 101.36 |
| fastify | 414,397.91 | 414,912.48 (411,857.22–417,967.75) | 48.26 | 0.56 | 0.56 | 46.62 | 92.89 |
| better-sse | 524,868.37 | 544,599.11 (503,281.63–585,916.6) | 38.1 | 0.77 | 0.77 | 26.44 | 80.66 |
| sveltekit-sse | 251,025.41 | 247,978.23 (240,762.77–255,193.68) | 79.67 | 0.86 | 0.86 | 92.18 | 94.78 |
| minksse | 471,979.19 | 472,551.23 (469,874.59–475,227.86) | 42.37 | 0.73 | 0.73 | 41.74 | 83.64 |

All recorded streams passed exact event-count, order, payload and HTTP validation. Any error aborts the run without writing a successful report.

Throughput includes connection/request overhead, socket delivery and independent client validation. Both processes share this machine; client CPU and scheduler contention can cap results. Small samples and wide confidence intervals do not establish a reliable ranking. The Student-t interval describes mean throughput across these repeats, not a production guarantee.

The native baseline uses Node HTTP writes. Hono includes its router; Fastify includes its router and plugin. Hono, sveltekit-sse and MinkSSE use the selected per-candidate Web Response → Node HTTP adapter (effective strategies above). sveltekit-sse uses its real published producer bundled by esbuild; SvelteKit routing and the package clients are outside this measurement. Native/Hono/Fastify await exposed write backpressure; producer APIs cannot be made identical in that respect. See README.md for scope and reproducibility.

Package versions: @hono/node-server 2.1.5, hono 4.13.16, fastify 5.12.7, @fastify/sse 0.6.1, better-sse 0.16.1, sveltekit-sse 0.15.1, svelte 5.57.3, @sveltejs/kit 2.70.3, esbuild 0.28.2.

Raw samples and environment: implemented-clients-1.json. Local MinkSSE source commit 8868f9001c4d21c71cdcc94315f7d2d946f5b5e4; dirty checkout: true. The JSON includes the local compiled server and dependency lock hashes.
