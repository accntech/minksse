# SSE HTTP benchmark results

Generated 2026-11-01T14:40:59.717Z. Setup: **optimized**, effective strategies {"native":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch"},"hono":{"bridge":"hono-node","fastify":"send","better":"batch","cork":"off","native":"batch"},"fastify":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch"},"better-sse":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch"},"sveltekit-sse":{"bridge":"kit","fastify":"send","better":"batch","cork":"off","native":"batch"},"minksse":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch"}}. 8 concurrent clients × 5000 events; 1024-byte ASCII payload per event, batch 16, interval 0 ms.

3 measured repeats, 1 full warmup pass(es) per fresh server. v24.12.0, Apple M4 Pro, darwin/arm64.

| Candidate | Median events/s | Mean events/s (95% CI) | Median completion ms | Median first event ms | Median per-trial p95 first event ms | Median server CPU ms | Median RSS after MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| native | 546,688.94 | 555,106.37 (453,188.73–657,024.02) | 73.17 | 0.55 | 0.62 | 58.75 | 97.5 |
| hono | 273,316.3 | 274,541.42 (256,157.02–292,925.82) | 146.35 | 1.16 | 1.53 | 181.21 | 111.3 |
| fastify | 513,993.47 | 500,236.44 (424,281.99–576,190.89) | 77.82 | 0.74 | 0.89 | 89.43 | 108.64 |
| better-sse | 561,171.49 | 551,081.31 (485,847.36–616,315.26) | 71.28 | 1.24 | 1.34 | 77.28 | 84.5 |
| sveltekit-sse | 272,525.2 | 273,313.52 (267,900.54–278,726.5) | 146.78 | 1.57 | 1.79 | 173.58 | 101.06 |
| minksse | 339,323.45 | 339,799.98 (336,898.02–342,701.95) | 117.88 | 1.64 | 1.77 | 143.05 | 89.77 |

All recorded streams passed exact event-count, order, payload and HTTP validation. Any error aborts the run without writing a successful report.

Throughput includes connection/request overhead, socket delivery and independent client validation. Both processes share this machine; client CPU and scheduler contention can cap results. Small samples and wide confidence intervals do not establish a reliable ranking. The Student-t interval describes mean throughput across these repeats, not a production guarantee.

The native baseline uses Node HTTP writes. Hono includes its router; Fastify includes its router and plugin. Hono, sveltekit-sse and MinkSSE use the selected per-candidate Web Response → Node HTTP adapter (effective strategies above). sveltekit-sse uses its real published producer bundled by esbuild; SvelteKit routing and the package clients are outside this measurement. Native/Hono/Fastify await exposed write backpressure; producer APIs cannot be made identical in that respect. See README.md for scope and reproducibility.

Package versions: @hono/node-server 2.1.5, hono 4.13.16, fastify 5.12.7, @fastify/sse 0.6.1, better-sse 0.16.1, sveltekit-sse 0.15.1, svelte 5.57.3, @sveltejs/kit 2.70.3, esbuild 0.28.2.

Raw samples and environment: optimized-large-payload.json. Local MinkSSE source commit 8868f9001c4d21c71cdcc94315f7d2d946f5b5e4; dirty checkout: true. The JSON includes the local compiled server and dependency lock hashes.
