# SSE HTTP benchmark results

Generated 2026-11-02T00:30:55.509Z. Setup: **optimized**, effective strategies {"native":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"hono":{"bridge":"hono-node","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"fastify":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"better-sse":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"sveltekit-sse":{"bridge":"kit","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"minksse":{"bridge":"minksse-node","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384}}. 16 concurrent clients × 20000 events; 128-byte ASCII payload per event, batch 16, interval 0 ms.

7 measured repeats, 1 full warmup pass(es) per fresh server. v24.12.0, Apple M4 Pro, darwin/arm64.

| Candidate | Median events/s | Mean events/s (95% CI) | Median completion ms | Median first event ms | Median per-trial p95 first event ms | Median server CPU ms | Median RSS after MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| native | 1,879,555.72 | 1,856,705.04 (1,793,038.06–1,920,372.02) | 170.25 | 0.72 | 1 | 182.38 | 81.8 |
| hono | 339,057.53 | 329,737.75 (305,835.45–353,640.06) | 943.79 | 1.51 | 2.02 | 1,007.1 | 255.61 |
| fastify | 777,609.07 | 776,039.94 (761,006.84–791,073.04) | 411.52 | 1.05 | 1.48 | 421.48 | 110.22 |
| better-sse | 1,327,718.19 | 1,276,170.76 (1,188,888.23–1,363,453.29) | 241.01 | 1.36 | 1.57 | 254.62 | 84.28 |
| sveltekit-sse | 332,424.62 | 328,412.15 (310,587.93–346,236.38) | 962.62 | 2.27 | 2.8 | 1,022.86 | 114.25 |
| minksse | 1,499,828.34 | 1,443,470.76 (1,334,702.02–1,552,239.49) | 213.36 | 1.56 | 2.07 | 226.05 | 84.52 |

All recorded streams passed exact event-count, order, payload and HTTP validation. Any error aborts the run without writing a successful report.

Throughput includes connection/request overhead, socket delivery and independent client validation. Both processes share this machine; client CPU and scheduler contention can cap results. Small samples and wide confidence intervals do not establish a reliable ranking. The Student-t interval describes mean throughput across these repeats, not a production guarantee.

The native baseline uses Node HTTP writes. Hono includes its router; Fastify includes its router and plugin. Hono, sveltekit-sse and MinkSSE use the selected per-candidate Web Response → Node HTTP adapter (effective strategies above). sveltekit-sse uses its real published producer bundled by esbuild; SvelteKit routing and the package clients are outside this measurement. Native/Hono/Fastify await exposed write backpressure; producer APIs cannot be made identical in that respect. See README.md for scope and reproducibility.

Package versions: @hono/node-server 2.1.5, hono 4.13.16, fastify 5.12.7, @fastify/sse 0.6.1, better-sse 0.16.1, sveltekit-sse 0.15.1, svelte 5.57.3, @sveltejs/kit 2.70.3, esbuild 0.28.2.

Raw samples and environment: fresh-all-four-loader-2026-11-02.json. Local MinkSSE source commit 8868f9001c4d21c71cdcc94315f7d2d946f5b5e4; dirty checkout: true. The JSON includes the local compiled server and dependency lock hashes.
