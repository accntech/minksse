# SSE HTTP benchmark results

Generated 2026-11-01T14:41:04.923Z. Setup: **optimized**, effective strategies {"native":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch"},"hono":{"bridge":"hono-node","fastify":"send","better":"batch","cork":"off","native":"batch"},"fastify":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch"},"better-sse":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch"},"sveltekit-sse":{"bridge":"kit","fastify":"send","better":"batch","cork":"off","native":"batch"},"minksse":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch"}}. 16 concurrent clients × 100 events; 128-byte ASCII payload per event, batch 1, interval 1 ms.

3 measured repeats, 1 full warmup pass(es) per fresh server. v24.12.0, Apple M4 Pro, darwin/arm64.

| Candidate | Median events/s | Mean events/s (95% CI) | Median completion ms | Median first event ms | Median per-trial p95 first event ms | Median server CPU ms | Median RSS after MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| native | 12,361.57 | 12,457.08 (11,770.16–13,144) | 129.43 | 0.61 | 0.71 | 29.67 | 65.33 |
| hono | 12,091.12 | 11,917.58 (10,996.32–12,838.83) | 132.33 | 0.64 | 0.92 | 32.59 | 74.73 |
| fastify | 12,556.66 | 12,580.67 (11,805.85–13,355.5) | 127.42 | 0.8 | 0.86 | 27.78 | 87.23 |
| better-sse | 12,056.51 | 12,117.79 (11,534.92–12,700.65) | 132.71 | 1.2 | 1.55 | 36.08 | 70.09 |
| sveltekit-sse | 11,583.53 | 11,650.82 (11,257.79–12,043.85) | 138.13 | 1.1 | 1.16 | 39.35 | 83.84 |
| minksse | 11,998.82 | 12,032.25 (11,182.62–12,881.88) | 133.35 | 1.22 | 1.4 | 33.66 | 72.63 |

All recorded streams passed exact event-count, order, payload and HTTP validation. Any error aborts the run without writing a successful report.

Throughput includes connection/request overhead, socket delivery and independent client validation. Both processes share this machine; client CPU and scheduler contention can cap results. Small samples and wide confidence intervals do not establish a reliable ranking. The Student-t interval describes mean throughput across these repeats, not a production guarantee.

The native baseline uses Node HTTP writes. Hono includes its router; Fastify includes its router and plugin. Hono, sveltekit-sse and MinkSSE use the selected per-candidate Web Response → Node HTTP adapter (effective strategies above). sveltekit-sse uses its real published producer bundled by esbuild; SvelteKit routing and the package clients are outside this measurement. Native/Hono/Fastify await exposed write backpressure; producer APIs cannot be made identical in that respect. See README.md for scope and reproducibility.

Package versions: @hono/node-server 2.1.5, hono 4.13.16, fastify 5.12.7, @fastify/sse 0.6.1, better-sse 0.16.1, sveltekit-sse 0.15.1, svelte 5.57.3, @sveltejs/kit 2.70.3, esbuild 0.28.2.

Raw samples and environment: optimized-sparse.json. Local MinkSSE source commit 8868f9001c4d21c71cdcc94315f7d2d946f5b5e4; dirty checkout: true. The JSON includes the local compiled server and dependency lock hashes.
