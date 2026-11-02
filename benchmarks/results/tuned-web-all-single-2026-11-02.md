# SSE HTTP benchmark results

Generated 2026-11-02T06:17:04.411Z. Setup: **optimized**, effective strategies {"native":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"hono":{"bridge":"hono-node","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"fastify":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"better-sse":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"sveltekit-sse":{"bridge":"kit","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"minksse":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384}}. 1 concurrent clients × 20000 events; 128-byte ASCII payload per event, batch 16, interval 0 ms.

7 measured repeats, 1 full warmup pass(es) per fresh server. v24.12.0, Apple M4 Pro, darwin/arm64.

| Candidate | Median events/s | Mean events/s (95% CI) | Median completion ms | Median first event ms | Median per-trial p95 first event ms | Median server CPU ms | Median RSS after MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| native | 607,605.69 | 598,449.21 (581,417.24–615,481.18) | 32.92 | 0.51 | 0.51 | 28.39 | 78.98 |
| hono | 231,218.33 | 231,069.42 (227,044.11–235,094.72) | 86.5 | 0.83 | 0.83 | 107.81 | 103.06 |
| fastify | 401,918.49 | 400,785.94 (391,152.35–410,419.52) | 49.76 | 0.6 | 0.6 | 48.82 | 94.02 |
| better-sse | 508,343.18 | 511,060.31 (497,751.98–524,368.64) | 39.34 | 0.75 | 0.75 | 28.2 | 81.38 |
| sveltekit-sse | 236,516.23 | 237,955.35 (233,905.41–242,005.28) | 84.56 | 0.98 | 0.98 | 97.11 | 95.67 |
| minksse | 564,247.84 | 569,920.9 (541,607.87–598,233.93) | 35.45 | 0.76 | 0.76 | 24.93 | 84.27 |

All recorded streams passed exact event-count, order, payload and HTTP validation. Any error aborts the run without writing a successful report.

Throughput includes connection/request overhead, socket delivery and independent client validation. Both processes share this machine; client CPU and scheduler contention can cap results. Small samples and wide confidence intervals do not establish a reliable ranking. The Student-t interval describes mean throughput across these repeats, not a production guarantee.

The native baseline uses Node HTTP writes. Hono includes its router; Fastify includes its router and plugin. Hono, sveltekit-sse and MinkSSE use the selected per-candidate Web Response → Node HTTP adapter (effective strategies above). sveltekit-sse uses its real published producer bundled by esbuild; SvelteKit routing and the package clients are outside this measurement. Native/Hono/Fastify await exposed write backpressure; producer APIs cannot be made identical in that respect. See README.md for scope and reproducibility.

Package versions: @hono/node-server 2.1.5, hono 4.13.16, fastify 5.12.7, @fastify/sse 0.6.1, better-sse 0.16.1, sveltekit-sse 0.15.1, svelte 5.57.3, @sveltejs/kit 2.70.3, esbuild 0.28.2.

Raw samples and environment: tuned-web-all-single-2026-11-02.json. Local MinkSSE source commit 59e781d027a0d27bb93540b7c8125406feeae078; dirty checkout: true. The JSON includes the local compiled server and dependency lock hashes.
