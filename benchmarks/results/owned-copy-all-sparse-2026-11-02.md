# SSE HTTP benchmark results

Generated 2026-11-02T01:58:05.868Z. Setup: **optimized**, effective strategies {"native":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"hono":{"bridge":"hono-node","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"fastify":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"better-sse":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"sveltekit-sse":{"bridge":"kit","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"minksse":{"bridge":"minksse-node","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384}}. 16 concurrent clients × 100 events; 128-byte ASCII payload per event, batch 1, interval 1 ms.

5 measured repeats, 1 full warmup pass(es) per fresh server. v24.12.0, Apple M4 Pro, darwin/arm64.

| Candidate | Median events/s | Mean events/s (95% CI) | Median completion ms | Median first event ms | Median per-trial p95 first event ms | Median server CPU ms | Median RSS after MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| native | 12,229.08 | 12,282.24 (12,004.46–12,560.01) | 130.84 | 0.7 | 0.94 | 34.73 | 65.59 |
| hono | 11,505.31 | 11,628.53 (11,218–12,039.05) | 139.07 | 1.08 | 1.25 | 43.32 | 75.28 |
| fastify | 12,497.31 | 12,453.53 (12,184.63–12,722.43) | 128.03 | 0.72 | 0.88 | 25.1 | 87.06 |
| better-sse | 12,375.65 | 12,312.11 (12,054.72–12,569.5) | 129.29 | 1.38 | 1.6 | 29.83 | 70.11 |
| sveltekit-sse | 11,955.6 | 12,053.88 (11,813.95–12,293.81) | 133.83 | 1.37 | 1.63 | 32.67 | 83.91 |
| minksse | 11,612.72 | 11,756.44 (11,294.17–12,218.71) | 137.78 | 1.66 | 2.08 | 41 | 72.02 |

All recorded streams passed exact event-count, order, payload and HTTP validation. Any error aborts the run without writing a successful report.

Throughput includes connection/request overhead, socket delivery and independent client validation. Both processes share this machine; client CPU and scheduler contention can cap results. Small samples and wide confidence intervals do not establish a reliable ranking. The Student-t interval describes mean throughput across these repeats, not a production guarantee.

The native baseline uses Node HTTP writes. Hono includes its router; Fastify includes its router and plugin. Hono, sveltekit-sse and MinkSSE use the selected per-candidate Web Response → Node HTTP adapter (effective strategies above). sveltekit-sse uses its real published producer bundled by esbuild; SvelteKit routing and the package clients are outside this measurement. Native/Hono/Fastify await exposed write backpressure; producer APIs cannot be made identical in that respect. See README.md for scope and reproducibility.

Package versions: @hono/node-server 2.1.5, hono 4.13.16, fastify 5.12.7, @fastify/sse 0.6.1, better-sse 0.16.1, sveltekit-sse 0.15.1, svelte 5.57.3, @sveltejs/kit 2.70.3, esbuild 0.28.2.

Raw samples and environment: owned-copy-all-sparse-2026-11-02.json. Local MinkSSE source commit 8868f9001c4d21c71cdcc94315f7d2d946f5b5e4; dirty checkout: true. The JSON includes the local compiled server and dependency lock hashes.
