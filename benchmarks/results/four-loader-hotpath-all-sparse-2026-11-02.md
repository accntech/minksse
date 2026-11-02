# SSE HTTP benchmark results

Generated 2026-11-02T01:45:01.187Z. Setup: **optimized**, effective strategies {"native":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"hono":{"bridge":"hono-node","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"fastify":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"better-sse":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"sveltekit-sse":{"bridge":"kit","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"minksse":{"bridge":"minksse-node","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384}}. 16 concurrent clients × 100 events; 128-byte ASCII payload per event, batch 1, interval 1 ms.

5 measured repeats, 1 full warmup pass(es) per fresh server. v24.12.0, Apple M4 Pro, darwin/arm64.

| Candidate | Median events/s | Mean events/s (95% CI) | Median completion ms | Median first event ms | Median per-trial p95 first event ms | Median server CPU ms | Median RSS after MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| native | 12,124.39 | 12,177.32 (11,674.62–12,680.02) | 131.97 | 0.71 | 0.91 | 34.71 | 65.55 |
| hono | 11,573.82 | 11,493 (11,258.07–11,727.92) | 138.24 | 1 | 1.39 | 43.21 | 74.91 |
| fastify | 12,065.5 | 12,234.97 (11,809.34–12,660.6) | 132.61 | 0.73 | 0.93 | 33.63 | 87.14 |
| better-sse | 12,056.17 | 12,230.63 (11,752.63–12,708.62) | 132.71 | 1.37 | 1.6 | 37 | 70.17 |
| sveltekit-sse | 11,986.66 | 11,936.79 (11,454.85–12,418.73) | 133.48 | 1.19 | 1.4 | 29.52 | 84.17 |
| minksse | 12,367.45 | 12,194.6 (11,641.04–12,748.17) | 129.37 | 1.23 | 1.64 | 30.02 | 71.63 |

All recorded streams passed exact event-count, order, payload and HTTP validation. Any error aborts the run without writing a successful report.

Throughput includes connection/request overhead, socket delivery and independent client validation. Both processes share this machine; client CPU and scheduler contention can cap results. Small samples and wide confidence intervals do not establish a reliable ranking. The Student-t interval describes mean throughput across these repeats, not a production guarantee.

The native baseline uses Node HTTP writes. Hono includes its router; Fastify includes its router and plugin. Hono, sveltekit-sse and MinkSSE use the selected per-candidate Web Response → Node HTTP adapter (effective strategies above). sveltekit-sse uses its real published producer bundled by esbuild; SvelteKit routing and the package clients are outside this measurement. Native/Hono/Fastify await exposed write backpressure; producer APIs cannot be made identical in that respect. See README.md for scope and reproducibility.

Package versions: @hono/node-server 2.1.5, hono 4.13.16, fastify 5.12.7, @fastify/sse 0.6.1, better-sse 0.16.1, sveltekit-sse 0.15.1, svelte 5.57.3, @sveltejs/kit 2.70.3, esbuild 0.28.2.

Raw samples and environment: four-loader-hotpath-all-sparse-2026-11-02.json. Local MinkSSE source commit 8868f9001c4d21c71cdcc94315f7d2d946f5b5e4; dirty checkout: true. The JSON includes the local compiled server and dependency lock hashes.
