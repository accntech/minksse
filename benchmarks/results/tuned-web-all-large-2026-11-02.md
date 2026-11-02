# SSE HTTP benchmark results

Generated 2026-11-02T06:17:57.745Z. Setup: **optimized**, effective strategies {"native":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":65536},"hono":{"bridge":"hono-node","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":65536},"fastify":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":65536},"better-sse":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":65536},"sveltekit-sse":{"bridge":"kit","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":65536},"minksse":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":65536}}. 16 concurrent clients × 5000 events; 1024-byte ASCII payload per event, batch 16, interval 0 ms.

6 measured repeats, 1 full warmup pass(es) per fresh server. v24.12.0, Apple M4 Pro, darwin/arm64.

| Candidate | Median events/s | Mean events/s (95% CI) | Median completion ms | Median first event ms | Median per-trial p95 first event ms | Median server CPU ms | Median RSS after MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| native | 786,661.35 | 784,348.97 (775,430.94–793,267) | 101.7 | 0.84 | 1.03 | 108.55 | 84.15 |
| hono | 273,531.9 | 273,234.26 (269,057.01–277,411.51) | 292.47 | 1.67 | 2.31 | 335.9 | 148.03 |
| fastify | 491,757.41 | 491,292.46 (489,038.84–493,546.07) | 162.68 | 1.14 | 1.42 | 174.92 | 111.35 |
| better-sse | 546,617.99 | 549,663.51 (541,037.96–558,289.05) | 146.36 | 1.76 | 2.12 | 153.51 | 85.46 |
| sveltekit-sse | 274,398.99 | 273,263.28 (267,996.35–278,530.2) | 291.55 | 2.02 | 2.44 | 330.72 | 103.63 |
| minksse | 761,475.38 | 757,000.33 (747,159.73–766,840.94) | 105.06 | 1.38 | 1.62 | 120.72 | 96.23 |

All recorded streams passed exact event-count, order, payload and HTTP validation. Any error aborts the run without writing a successful report.

Throughput includes connection/request overhead, socket delivery and independent client validation. Both processes share this machine; client CPU and scheduler contention can cap results. Small samples and wide confidence intervals do not establish a reliable ranking. The Student-t interval describes mean throughput across these repeats, not a production guarantee.

The native baseline uses Node HTTP writes. Hono includes its router; Fastify includes its router and plugin. Hono, sveltekit-sse and MinkSSE use the selected per-candidate Web Response → Node HTTP adapter (effective strategies above). sveltekit-sse uses its real published producer bundled by esbuild; SvelteKit routing and the package clients are outside this measurement. Native/Hono/Fastify await exposed write backpressure; producer APIs cannot be made identical in that respect. See README.md for scope and reproducibility.

Package versions: @hono/node-server 2.1.5, hono 4.13.16, fastify 5.12.7, @fastify/sse 0.6.1, better-sse 0.16.1, sveltekit-sse 0.15.1, svelte 5.57.3, @sveltejs/kit 2.70.3, esbuild 0.28.2.

Raw samples and environment: tuned-web-all-large-2026-11-02.json. Local MinkSSE source commit 59e781d027a0d27bb93540b7c8125406feeae078; dirty checkout: true. The JSON includes the local compiled server and dependency lock hashes.
