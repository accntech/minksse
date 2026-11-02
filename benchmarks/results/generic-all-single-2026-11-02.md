# SSE HTTP benchmark results

Generated 2026-11-02T02:46:15.869Z. Setup: **optimized**, effective strategies {"native":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"hono":{"bridge":"hono-node","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"fastify":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"better-sse":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"sveltekit-sse":{"bridge":"kit","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"minksse":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384}}. 1 concurrent clients × 20000 events; 128-byte ASCII payload per event, batch 16, interval 0 ms.

7 measured repeats, 1 full warmup pass(es) per fresh server. v24.12.0, Apple M4 Pro, darwin/arm64.

| Candidate | Median events/s | Mean events/s (95% CI) | Median completion ms | Median first event ms | Median per-trial p95 first event ms | Median server CPU ms | Median RSS after MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| native | 609,313.36 | 606,094.43 (595,364.78–616,824.08) | 32.82 | 0.48 | 0.48 | 28.07 | 78.98 |
| hono | 238,618.04 | 239,552.34 (236,043.42–243,061.25) | 83.82 | 0.84 | 0.84 | 105.6 | 103.05 |
| fastify | 411,615.09 | 410,509.05 (406,478.17–414,539.93) | 48.59 | 0.58 | 0.58 | 47.37 | 93.58 |
| better-sse | 517,908.3 | 522,737.29 (506,265.7–539,208.89) | 38.62 | 0.72 | 0.72 | 27.86 | 81.28 |
| sveltekit-sse | 240,519.28 | 242,982.19 (239,112.03–246,852.35) | 83.15 | 0.95 | 0.95 | 95.56 | 95.39 |
| minksse | 510,210.59 | 522,461.24 (504,088.66–540,833.83) | 39.2 | 0.8 | 0.8 | 31.02 | 84.64 |

All recorded streams passed exact event-count, order, payload and HTTP validation. Any error aborts the run without writing a successful report.

Throughput includes connection/request overhead, socket delivery and independent client validation. Both processes share this machine; client CPU and scheduler contention can cap results. Small samples and wide confidence intervals do not establish a reliable ranking. The Student-t interval describes mean throughput across these repeats, not a production guarantee.

The native baseline uses Node HTTP writes. Hono includes its router; Fastify includes its router and plugin. Hono, sveltekit-sse and MinkSSE use the selected per-candidate Web Response → Node HTTP adapter (effective strategies above). sveltekit-sse uses its real published producer bundled by esbuild; SvelteKit routing and the package clients are outside this measurement. Native/Hono/Fastify await exposed write backpressure; producer APIs cannot be made identical in that respect. See README.md for scope and reproducibility.

Package versions: @hono/node-server 2.1.5, hono 4.13.16, fastify 5.12.7, @fastify/sse 0.6.1, better-sse 0.16.1, sveltekit-sse 0.15.1, svelte 5.57.3, @sveltejs/kit 2.70.3, esbuild 0.28.2.

Raw samples and environment: generic-all-single-2026-11-02.json. Local MinkSSE source commit 59e781d027a0d27bb93540b7c8125406feeae078; dirty checkout: true. The JSON includes the local compiled server and dependency lock hashes.
