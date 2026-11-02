# SSE HTTP benchmark results

Generated 2026-11-02T00:57:18.550Z. Setup: **optimized**, effective strategies {"native":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"hono":{"bridge":"hono-node","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"fastify":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"better-sse":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"sveltekit-sse":{"bridge":"kit","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"minksse":{"bridge":"minksse-node","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384}}. 16 concurrent clients × 100 events; 128-byte ASCII payload per event, batch 1, interval 1 ms.

5 measured repeats, 1 full warmup pass(es) per fresh server. v24.12.0, Apple M4 Pro, darwin/arm64.

| Candidate | Median events/s | Mean events/s (95% CI) | Median completion ms | Median first event ms | Median per-trial p95 first event ms | Median server CPU ms | Median RSS after MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| native | 11,672.58 | 11,570.36 (11,084–12,056.73) | 137.07 | 0.7 | 0.91 | 24.9 | 65.53 |
| hono | 10,341.77 | 10,404.18 (10,120.21–10,688.15) | 154.71 | 1.13 | 1.48 | 46.36 | 75.19 |
| fastify | 10,787.06 | 10,944.88 (10,500.24–11,389.51) | 148.33 | 0.79 | 0.94 | 36.31 | 87.14 |
| better-sse | 10,776.8 | 10,887.08 (10,498.32–11,275.85) | 148.47 | 1.52 | 1.78 | 39.81 | 70.17 |
| sveltekit-sse | 10,508.03 | 10,733.76 (10,207.07–11,260.46) | 152.26 | 1.46 | 1.73 | 41.7 | 83.69 |
| minksse | 11,549.94 | 11,500.25 (11,190.45–11,810.06) | 138.53 | 1.21 | 1.55 | 26.85 | 71.05 |

All recorded streams passed exact event-count, order, payload and HTTP validation. Any error aborts the run without writing a successful report.

Throughput includes connection/request overhead, socket delivery and independent client validation. Both processes share this machine; client CPU and scheduler contention can cap results. Small samples and wide confidence intervals do not establish a reliable ranking. The Student-t interval describes mean throughput across these repeats, not a production guarantee.

The native baseline uses Node HTTP writes. Hono includes its router; Fastify includes its router and plugin. Hono, sveltekit-sse and MinkSSE use the selected per-candidate Web Response → Node HTTP adapter (effective strategies above). sveltekit-sse uses its real published producer bundled by esbuild; SvelteKit routing and the package clients are outside this measurement. Native/Hono/Fastify await exposed write backpressure; producer APIs cannot be made identical in that respect. See README.md for scope and reproducibility.

Package versions: @hono/node-server 2.1.5, hono 4.13.16, fastify 5.12.7, @fastify/sse 0.6.1, better-sse 0.16.1, sveltekit-sse 0.15.1, svelte 5.57.3, @sveltejs/kit 2.70.3, esbuild 0.28.2.

Raw samples and environment: optimized-all-sparse-2026-11-02.json. Local MinkSSE source commit 8868f9001c4d21c71cdcc94315f7d2d946f5b5e4; dirty checkout: true. The JSON includes the local compiled server and dependency lock hashes.
