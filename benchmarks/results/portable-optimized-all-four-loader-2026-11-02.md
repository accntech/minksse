# SSE HTTP benchmark results

Generated 2026-11-02T05:13:19.068Z. Setup: **optimized**, effective strategies {"native":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"hono":{"bridge":"hono-node","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"fastify":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"better-sse":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"sveltekit-sse":{"bridge":"kit","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"minksse":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384}}. 16 concurrent clients × 20000 events; 128-byte ASCII payload per event, batch 16, interval 0 ms.

7 measured repeats, 1 full warmup pass(es) per fresh server. v24.12.0, Apple M4 Pro, darwin/arm64.

| Candidate | Median events/s | Mean events/s (95% CI) | Median completion ms | Median first event ms | Median per-trial p95 first event ms | Median server CPU ms | Median RSS after MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| native | 1,801,865.64 | 1,745,897.96 (1,564,143.61–1,927,652.31) | 177.59 | 0.73 | 0.88 | 189.62 | 81.55 |
| hono | 332,926.45 | 328,870.15 (317,929.66–339,810.63) | 961.17 | 1.64 | 2.2 | 1,059.28 | 255.17 |
| fastify | 778,428.21 | 776,374.08 (759,019.39–793,728.77) | 411.08 | 1.1 | 1.46 | 421.73 | 110.28 |
| better-sse | 1,269,964.53 | 1,265,598.26 (1,237,223.16–1,293,973.35) | 251.98 | 1.41 | 1.57 | 266.03 | 84.27 |
| sveltekit-sse | 325,607.3 | 325,499.76 (318,623.08–332,376.44) | 982.78 | 2.3 | 2.6 | 1,045.99 | 114.27 |
| minksse | 1,596,427.67 | 1,599,757.27 (1,558,046.85–1,641,467.69) | 200.45 | 1.34 | 1.55 | 221.31 | 88.33 |

All recorded streams passed exact event-count, order, payload and HTTP validation. Any error aborts the run without writing a successful report.

Throughput includes connection/request overhead, socket delivery and independent client validation. Both processes share this machine; client CPU and scheduler contention can cap results. Small samples and wide confidence intervals do not establish a reliable ranking. The Student-t interval describes mean throughput across these repeats, not a production guarantee.

The native baseline uses Node HTTP writes. Hono includes its router; Fastify includes its router and plugin. Hono, sveltekit-sse and MinkSSE use the selected per-candidate Web Response → Node HTTP adapter (effective strategies above). sveltekit-sse uses its real published producer bundled by esbuild; SvelteKit routing and the package clients are outside this measurement. Native/Hono/Fastify await exposed write backpressure; producer APIs cannot be made identical in that respect. See README.md for scope and reproducibility.

Package versions: @hono/node-server 2.1.5, hono 4.13.16, fastify 5.12.7, @fastify/sse 0.6.1, better-sse 0.16.1, sveltekit-sse 0.15.1, svelte 5.57.3, @sveltejs/kit 2.70.3, esbuild 0.28.2.

Raw samples and environment: portable-optimized-all-four-loader-2026-11-02.json. Local MinkSSE source commit 59e781d027a0d27bb93540b7c8125406feeae078; dirty checkout: true. The JSON includes the local compiled server and dependency lock hashes.
