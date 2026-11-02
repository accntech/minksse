# SSE HTTP benchmark results

Generated 2026-11-02T01:43:53.700Z. Setup: **optimized**, effective strategies {"native":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"hono":{"bridge":"hono-node","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"fastify":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"better-sse":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"sveltekit-sse":{"bridge":"kit","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"minksse":{"bridge":"minksse-node","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384}}. 16 concurrent clients × 20000 events; 128-byte ASCII payload per event, batch 16, interval 0 ms.

7 measured repeats, 1 full warmup pass(es) per fresh server. v24.12.0, Apple M4 Pro, darwin/arm64.

| Candidate | Median events/s | Mean events/s (95% CI) | Median completion ms | Median first event ms | Median per-trial p95 first event ms | Median server CPU ms | Median RSS after MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| native | 1,883,772.7 | 1,880,330.89 (1,835,834.87–1,924,826.91) | 169.87 | 0.7 | 0.9 | 181.51 | 81.83 |
| hono | 342,157.77 | 343,441.64 (338,085.72–348,797.56) | 935.24 | 1.49 | 1.95 | 986.48 | 254.97 |
| fastify | 782,614.38 | 779,179.33 (761,028.1–797,330.55) | 408.89 | 1.12 | 1.62 | 419.29 | 110.03 |
| better-sse | 1,319,473.59 | 1,301,017.97 (1,249,903.67–1,352,132.27) | 242.52 | 1.34 | 1.6 | 254.24 | 84.39 |
| sveltekit-sse | 344,978.64 | 340,821.03 (333,182.79–348,459.27) | 927.59 | 1.95 | 2.26 | 997.44 | 114.78 |
| minksse | 1,604,724.57 | 1,567,474.05 (1,509,063.45–1,625,884.66) | 199.41 | 1.23 | 1.54 | 215.71 | 85.81 |

All recorded streams passed exact event-count, order, payload and HTTP validation. Any error aborts the run without writing a successful report.

Throughput includes connection/request overhead, socket delivery and independent client validation. Both processes share this machine; client CPU and scheduler contention can cap results. Small samples and wide confidence intervals do not establish a reliable ranking. The Student-t interval describes mean throughput across these repeats, not a production guarantee.

The native baseline uses Node HTTP writes. Hono includes its router; Fastify includes its router and plugin. Hono, sveltekit-sse and MinkSSE use the selected per-candidate Web Response → Node HTTP adapter (effective strategies above). sveltekit-sse uses its real published producer bundled by esbuild; SvelteKit routing and the package clients are outside this measurement. Native/Hono/Fastify await exposed write backpressure; producer APIs cannot be made identical in that respect. See README.md for scope and reproducibility.

Package versions: @hono/node-server 2.1.5, hono 4.13.16, fastify 5.12.7, @fastify/sse 0.6.1, better-sse 0.16.1, sveltekit-sse 0.15.1, svelte 5.57.3, @sveltejs/kit 2.70.3, esbuild 0.28.2.

Raw samples and environment: four-loader-hotpath-all-four-loader-2026-11-02.json. Local MinkSSE source commit 8868f9001c4d21c71cdcc94315f7d2d946f5b5e4; dirty checkout: true. The JSON includes the local compiled server and dependency lock hashes.
