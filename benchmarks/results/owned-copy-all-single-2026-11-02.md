# SSE HTTP benchmark results

Generated 2026-11-02T01:57:49.731Z. Setup: **optimized**, effective strategies {"native":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"hono":{"bridge":"hono-node","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"fastify":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"better-sse":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"sveltekit-sse":{"bridge":"kit","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"minksse":{"bridge":"minksse-node","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384}}. 1 concurrent clients × 20000 events; 128-byte ASCII payload per event, batch 16, interval 0 ms.

7 measured repeats, 1 full warmup pass(es) per fresh server. v24.12.0, Apple M4 Pro, darwin/arm64.

| Candidate | Median events/s | Mean events/s (95% CI) | Median completion ms | Median first event ms | Median per-trial p95 first event ms | Median server CPU ms | Median RSS after MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| native | 606,598.27 | 610,217.87 (599,451.29–620,984.45) | 32.97 | 0.53 | 0.53 | 27.89 | 79.05 |
| hono | 241,036.09 | 241,476.9 (238,158.25–244,795.55) | 82.98 | 0.81 | 0.81 | 104.13 | 102.94 |
| fastify | 427,660.74 | 427,396.71 (420,324.09–434,469.34) | 46.77 | 0.62 | 0.62 | 46.32 | 93.83 |
| better-sse | 548,806.64 | 545,312.36 (530,390.2–560,234.51) | 36.44 | 0.78 | 0.78 | 25.71 | 81.48 |
| sveltekit-sse | 251,872.51 | 251,746.53 (248,276.18–255,216.89) | 79.41 | 0.95 | 0.95 | 92.3 | 95.5 |
| minksse | 549,158.88 | 553,661.44 (539,010.17–568,312.72) | 36.42 | 0.7 | 0.7 | 35.34 | 85.02 |

All recorded streams passed exact event-count, order, payload and HTTP validation. Any error aborts the run without writing a successful report.

Throughput includes connection/request overhead, socket delivery and independent client validation. Both processes share this machine; client CPU and scheduler contention can cap results. Small samples and wide confidence intervals do not establish a reliable ranking. The Student-t interval describes mean throughput across these repeats, not a production guarantee.

The native baseline uses Node HTTP writes. Hono includes its router; Fastify includes its router and plugin. Hono, sveltekit-sse and MinkSSE use the selected per-candidate Web Response → Node HTTP adapter (effective strategies above). sveltekit-sse uses its real published producer bundled by esbuild; SvelteKit routing and the package clients are outside this measurement. Native/Hono/Fastify await exposed write backpressure; producer APIs cannot be made identical in that respect. See README.md for scope and reproducibility.

Package versions: @hono/node-server 2.1.5, hono 4.13.16, fastify 5.12.7, @fastify/sse 0.6.1, better-sse 0.16.1, sveltekit-sse 0.15.1, svelte 5.57.3, @sveltejs/kit 2.70.3, esbuild 0.28.2.

Raw samples and environment: owned-copy-all-single-2026-11-02.json. Local MinkSSE source commit 8868f9001c4d21c71cdcc94315f7d2d946f5b5e4; dirty checkout: true. The JSON includes the local compiled server and dependency lock hashes.
