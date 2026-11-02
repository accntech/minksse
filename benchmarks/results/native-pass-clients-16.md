# SSE HTTP benchmark results

Generated 2026-11-01T15:49:04.823Z. Setup: **optimized**, effective strategies {"native":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"hono":{"bridge":"hono-node","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"fastify":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"better-sse":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"sveltekit-sse":{"bridge":"kit","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384},"minksse":{"bridge":"minksse-node","fastify":"send","better":"batch","cork":"off","native":"batch","minkApi":"batch","coalesceBytes":16384}}. 16 concurrent clients × 20000 events; 128-byte ASCII payload per event, batch 16, interval 0 ms.

5 measured repeats, 1 full warmup pass(es) per fresh server. v24.12.0, Apple M4 Pro, darwin/arm64.

| Candidate | Median events/s | Mean events/s (95% CI) | Median completion ms | Median first event ms | Median per-trial p95 first event ms | Median server CPU ms | Median RSS after MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| native | 1,646,825.42 | 1,644,270.24 (1,549,505.18–1,739,035.29) | 194.31 | 0.57 | 1.29 | 154.24 | 98.89 |
| hono | 337,257.33 | 337,472.07 (332,958.56–341,985.58) | 948.83 | 1.35 | 2.05 | 1,045.41 | 254.03 |
| fastify | 831,011.62 | 834,167.96 (811,502.42–856,833.49) | 385.07 | 0.72 | 1.21 | 395.45 | 94.13 |
| better-sse | 1,467,955.56 | 1,475,411.01 (1,435,526.64–1,515,295.38) | 217.99 | 1.09 | 1.28 | 231.32 | 83.11 |
| sveltekit-sse | 322,959.43 | 322,257.13 (317,483.06–327,031.21) | 990.84 | 1.49 | 1.87 | 1,055.35 | 111.73 |
| minksse | 1,583,791.55 | 1,571,538.49 (1,521,751.64–1,621,325.34) | 202.05 | 1.2 | 1.33 | 218.14 | 86.91 |

All recorded streams passed exact event-count, order, payload and HTTP validation. Any error aborts the run without writing a successful report.

Throughput includes connection/request overhead, socket delivery and independent client validation. Both processes share this machine; client CPU and scheduler contention can cap results. Small samples and wide confidence intervals do not establish a reliable ranking. The Student-t interval describes mean throughput across these repeats, not a production guarantee.

The native baseline uses Node HTTP writes. Hono includes its router; Fastify includes its router and plugin. Hono, sveltekit-sse and MinkSSE use the selected per-candidate Web Response → Node HTTP adapter (effective strategies above). sveltekit-sse uses its real published producer bundled by esbuild; SvelteKit routing and the package clients are outside this measurement. Native/Hono/Fastify await exposed write backpressure; producer APIs cannot be made identical in that respect. See README.md for scope and reproducibility.

Package versions: @hono/node-server 2.1.5, hono 4.13.16, fastify 5.12.7, @fastify/sse 0.6.1, better-sse 0.16.1, sveltekit-sse 0.15.1, svelte 5.57.3, @sveltejs/kit 2.70.3, esbuild 0.28.2.

Raw samples and environment: native-pass-clients-16.json. Local MinkSSE source commit 8868f9001c4d21c71cdcc94315f7d2d946f5b5e4; dirty checkout: true. The JSON includes the local compiled server and dependency lock hashes.
