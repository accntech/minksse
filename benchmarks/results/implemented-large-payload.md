# SSE HTTP benchmark results

Generated 2026-11-01T14:55:01.769Z. Setup: **optimized**, effective strategies {"native":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","coalesceBytes":16384},"hono":{"bridge":"hono-node","fastify":"send","better":"batch","cork":"off","native":"batch","coalesceBytes":16384},"fastify":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","coalesceBytes":16384},"better-sse":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","coalesceBytes":16384},"sveltekit-sse":{"bridge":"kit","fastify":"send","better":"batch","cork":"off","native":"batch","coalesceBytes":16384},"minksse":{"bridge":"minksse-node","fastify":"send","better":"batch","cork":"off","native":"batch","coalesceBytes":16384}}. 8 concurrent clients × 5000 events; 1024-byte ASCII payload per event, batch 16, interval 0 ms.

3 measured repeats, 1 full warmup pass(es) per fresh server. v24.12.0, Apple M4 Pro, darwin/arm64.

| Candidate | Median events/s | Mean events/s (95% CI) | Median completion ms | Median first event ms | Median per-trial p95 first event ms | Median server CPU ms | Median RSS after MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| native | 582,705.3 | 573,074.6 (458,061.56–688,087.65) | 68.65 | 0.59 | 0.81 | 55.77 | 97.64 |
| hono | 263,221.32 | 263,191.26 (260,777.6–265,604.92) | 151.96 | 1.22 | 1.65 | 185.2 | 111.5 |
| fastify | 520,000.52 | 522,693.01 (500,720.24–544,665.79) | 76.92 | 0.74 | 0.91 | 88.23 | 108.47 |
| better-sse | 556,410.13 | 555,758.15 (502,357.61–609,158.68) | 71.89 | 1.17 | 1.31 | 75.55 | 84.59 |
| sveltekit-sse | 264,064.24 | 265,751.65 (250,655.45–280,847.85) | 151.48 | 1.47 | 1.64 | 176.17 | 100.64 |
| minksse | 433,940.28 | 439,812.77 (399,738.16–479,887.38) | 92.18 | 1.51 | 1.56 | 108.87 | 88.63 |

All recorded streams passed exact event-count, order, payload and HTTP validation. Any error aborts the run without writing a successful report.

Throughput includes connection/request overhead, socket delivery and independent client validation. Both processes share this machine; client CPU and scheduler contention can cap results. Small samples and wide confidence intervals do not establish a reliable ranking. The Student-t interval describes mean throughput across these repeats, not a production guarantee.

The native baseline uses Node HTTP writes. Hono includes its router; Fastify includes its router and plugin. Hono, sveltekit-sse and MinkSSE use the selected per-candidate Web Response → Node HTTP adapter (effective strategies above). sveltekit-sse uses its real published producer bundled by esbuild; SvelteKit routing and the package clients are outside this measurement. Native/Hono/Fastify await exposed write backpressure; producer APIs cannot be made identical in that respect. See README.md for scope and reproducibility.

Package versions: @hono/node-server 2.1.5, hono 4.13.16, fastify 5.12.7, @fastify/sse 0.6.1, better-sse 0.16.1, sveltekit-sse 0.15.1, svelte 5.57.3, @sveltejs/kit 2.70.3, esbuild 0.28.2.

Raw samples and environment: implemented-large-payload.json. Local MinkSSE source commit 8868f9001c4d21c71cdcc94315f7d2d946f5b5e4; dirty checkout: true. The JSON includes the local compiled server and dependency lock hashes.
