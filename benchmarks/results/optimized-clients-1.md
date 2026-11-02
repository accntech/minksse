# SSE HTTP benchmark results

Generated 2026-11-01T14:38:59.543Z. Setup: **optimized**, effective strategies {"native":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch"},"hono":{"bridge":"hono-node","fastify":"send","better":"batch","cork":"off","native":"batch"},"fastify":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch"},"better-sse":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch"},"sveltekit-sse":{"bridge":"kit","fastify":"send","better":"batch","cork":"off","native":"batch"},"minksse":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch"}}. 1 concurrent clients × 20000 events; 128-byte ASCII payload per event, batch 16, interval 0 ms.

5 measured repeats, 1 full warmup pass(es) per fresh server. v24.12.0, Apple M4 Pro, darwin/arm64.

| Candidate | Median events/s | Mean events/s (95% CI) | Median completion ms | Median first event ms | Median per-trial p95 first event ms | Median server CPU ms | Median RSS after MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| native | 625,894.83 | 632,342.41 (612,607.19–652,077.63) | 31.95 | 0.45 | 0.45 | 20.66 | 78.73 |
| hono | 251,029.48 | 243,941.44 (223,103.8–264,779.08) | 79.67 | 0.84 | 0.84 | 100.98 | 101.19 |
| fastify | 415,893.36 | 415,618.52 (408,890.06–422,346.97) | 48.09 | 0.54 | 0.54 | 46.81 | 92.86 |
| better-sse | 540,413.35 | 540,780.12 (503,113.5–578,446.74) | 37.01 | 0.77 | 0.77 | 26.13 | 80.63 |
| sveltekit-sse | 248,954.52 | 250,015.37 (246,969.06–253,061.68) | 80.34 | 0.86 | 0.86 | 92.9 | 94.78 |
| minksse | 332,250.98 | 332,524.46 (326,981.38–338,067.53) | 60.2 | 0.85 | 0.85 | 74.1 | 83.41 |

All recorded streams passed exact event-count, order, payload and HTTP validation. Any error aborts the run without writing a successful report.

Throughput includes connection/request overhead, socket delivery and independent client validation. Both processes share this machine; client CPU and scheduler contention can cap results. Small samples and wide confidence intervals do not establish a reliable ranking. The Student-t interval describes mean throughput across these repeats, not a production guarantee.

The native baseline uses Node HTTP writes. Hono includes its router; Fastify includes its router and plugin. Hono, sveltekit-sse and MinkSSE use the selected per-candidate Web Response → Node HTTP adapter (effective strategies above). sveltekit-sse uses its real published producer bundled by esbuild; SvelteKit routing and the package clients are outside this measurement. Native/Hono/Fastify await exposed write backpressure; producer APIs cannot be made identical in that respect. See README.md for scope and reproducibility.

Package versions: @hono/node-server 2.1.5, hono 4.13.16, fastify 5.12.7, @fastify/sse 0.6.1, better-sse 0.16.1, sveltekit-sse 0.15.1, svelte 5.57.3, @sveltejs/kit 2.70.3, esbuild 0.28.2.

Raw samples and environment: optimized-clients-1.json. Local MinkSSE source commit 8868f9001c4d21c71cdcc94315f7d2d946f5b5e4; dirty checkout: true. The JSON includes the local compiled server and dependency lock hashes.
