# SSE HTTP benchmark results

Generated 2026-11-01T15:50:09.151Z. Setup: **optimized**, effective strategies {"native":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":32768},"hono":{"bridge":"hono-node","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":32768},"fastify":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":32768},"better-sse":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":32768},"sveltekit-sse":{"bridge":"kit","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":32768},"minksse":{"bridge":"minksse-node","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":32768}}. 8 concurrent clients × 5000 events; 1024-byte ASCII payload per event, batch 16, interval 0 ms.

3 measured repeats, 1 full warmup pass(es) per fresh server. v24.12.0, Apple M4 Pro, darwin/arm64.

| Candidate | Median events/s | Mean events/s (95% CI) | Median completion ms | Median first event ms | Median per-trial p95 first event ms | Median server CPU ms | Median RSS after MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| native | 737,385.53 | 729,851.14 (690,965.92–768,736.35) | 54.25 | 0.89 | 1.05 | 59.81 | 83.06 |
| hono | 271,296.42 | 271,329.85 (262,654.14–280,005.56) | 147.44 | 1.48 | 1.73 | 181.98 | 110.81 |
| fastify | 483,301.19 | 481,043.12 (470,833.59–491,252.65) | 82.76 | 1.1 | 1.27 | 95.07 | 108.73 |
| better-sse | 524,863.78 | 521,453.26 (498,277.52–544,628.99) | 76.21 | 1.47 | 1.59 | 82.03 | 84.73 |
| sveltekit-sse | 274,535.46 | 272,984.26 (260,109.89–285,858.63) | 145.7 | 1.82 | 2.09 | 169.51 | 98.77 |
| minksse | 479,092.84 | 476,550.35 (464,843.03–488,257.66) | 83.49 | 1.66 | 1.89 | 90.29 | 93.64 |

All recorded streams passed exact event-count, order, payload and HTTP validation. Any error aborts the run without writing a successful report.

Throughput includes connection/request overhead, socket delivery and independent client validation. Both processes share this machine; client CPU and scheduler contention can cap results. Small samples and wide confidence intervals do not establish a reliable ranking. The Student-t interval describes mean throughput across these repeats, not a production guarantee.

The native baseline uses Node HTTP writes. Hono includes its router; Fastify includes its router and plugin. Hono, sveltekit-sse and MinkSSE use the selected per-candidate Web Response → Node HTTP adapter (effective strategies above). sveltekit-sse uses its real published producer bundled by esbuild; SvelteKit routing and the package clients are outside this measurement. Native/Hono/Fastify await exposed write backpressure; producer APIs cannot be made identical in that respect. See README.md for scope and reproducibility.

Package versions: @hono/node-server 2.1.5, hono 4.13.16, fastify 5.12.7, @fastify/sse 0.6.1, better-sse 0.16.1, sveltekit-sse 0.15.1, svelte 5.57.3, @sveltejs/kit 2.70.3, esbuild 0.28.2.

Raw samples and environment: native-pass-large.json. Local MinkSSE source commit 8868f9001c4d21c71cdcc94315f7d2d946f5b5e4; dirty checkout: true. The JSON includes the local compiled server and dependency lock hashes.
