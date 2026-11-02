# SSE HTTP benchmark results

Generated 2026-11-01T14:40:12.046Z. Setup: **optimized**, effective strategies {"native":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch"},"hono":{"bridge":"hono-node","fastify":"send","better":"batch","cork":"off","native":"batch"},"fastify":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch"},"better-sse":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch"},"sveltekit-sse":{"bridge":"kit","fastify":"send","better":"batch","cork":"off","native":"batch"},"minksse":{"bridge":"direct","fastify":"send","better":"batch","cork":"off","native":"batch"}}. 16 concurrent clients × 20000 events; 128-byte ASCII payload per event, batch 16, interval 0 ms.

5 measured repeats, 1 full warmup pass(es) per fresh server. v24.12.0, Apple M4 Pro, darwin/arm64.

| Candidate | Median events/s | Mean events/s (95% CI) | Median completion ms | Median first event ms | Median per-trial p95 first event ms | Median server CPU ms | Median RSS after MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| native | 1,740,674.41 | 1,727,367.15 (1,689,419.12–1,765,315.17) | 183.84 | 0.57 | 1.12 | 147.68 | 98.67 |
| hono | 359,337.05 | 358,763.27 (354,267.9–363,258.65) | 890.53 | 1.42 | 2.18 | 955.39 | 254.06 |
| fastify | 905,529.89 | 900,323.99 (874,337.2–926,310.78) | 353.38 | 0.77 | 1.31 | 364.7 | 93.92 |
| better-sse | 1,561,692.98 | 1,561,199.57 (1,502,652.88–1,619,746.26) | 204.91 | 1.06 | 1.17 | 216.28 | 83.02 |
| sveltekit-sse | 346,655.81 | 346,556.46 (342,201.17–350,911.75) | 923.11 | 1.5 | 1.95 | 991.11 | 111.61 |
| minksse | 636,078.58 | 639,545.25 (628,713.31–650,377.19) | 503.08 | 1.15 | 1.41 | 540.82 | 99.66 |

All recorded streams passed exact event-count, order, payload and HTTP validation. Any error aborts the run without writing a successful report.

Throughput includes connection/request overhead, socket delivery and independent client validation. Both processes share this machine; client CPU and scheduler contention can cap results. Small samples and wide confidence intervals do not establish a reliable ranking. The Student-t interval describes mean throughput across these repeats, not a production guarantee.

The native baseline uses Node HTTP writes. Hono includes its router; Fastify includes its router and plugin. Hono, sveltekit-sse and MinkSSE use the selected per-candidate Web Response → Node HTTP adapter (effective strategies above). sveltekit-sse uses its real published producer bundled by esbuild; SvelteKit routing and the package clients are outside this measurement. Native/Hono/Fastify await exposed write backpressure; producer APIs cannot be made identical in that respect. See README.md for scope and reproducibility.

Package versions: @hono/node-server 2.1.5, hono 4.13.16, fastify 5.12.7, @fastify/sse 0.6.1, better-sse 0.16.1, sveltekit-sse 0.15.1, svelte 5.57.3, @sveltejs/kit 2.70.3, esbuild 0.28.2.

Raw samples and environment: optimized-clients-16.json. Local MinkSSE source commit 8868f9001c4d21c71cdcc94315f7d2d946f5b5e4; dirty checkout: true. The JSON includes the local compiled server and dependency lock hashes.
