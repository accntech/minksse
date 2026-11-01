# SSE HTTP benchmark results

Generated 2026-11-01T14:22:31.821Z. 1 concurrent clients × 20000 events; 128-byte ASCII payload per event, batch 16, interval 0 ms.

5 measured repeats, 1 full warmup pass(es) per fresh server. v24.12.0, Apple M4 Pro, darwin/arm64.

| Candidate | Median events/s | Mean events/s (95% CI) | Median completion ms | Median first event ms | Median per-trial p95 first event ms | Median server CPU ms | Median RSS after MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| native | 465,213.65 | 462,085.6 (451,092.39–473,078.8) | 42.99 | 0.52 | 0.52 | 39.85 | 79.69 |
| hono | 133,523.79 | 132,205.01 (128,917.69–135,492.33) | 149.79 | 1.02 | 1.02 | 188.2 | 86.61 |
| fastify | 406,902.42 | 403,415.4 (391,101–415,729.81) | 49.15 | 0.58 | 0.58 | 47.9 | 93.06 |
| better-sse | 391,540.13 | 392,554.9 (389,247.48–395,862.32) | 51.08 | 0.84 | 0.84 | 56.9 | 81.17 |
| sveltekit-sse | 92,235.16 | 91,009.89 (88,146.33–93,873.45) | 216.84 | 0.92 | 0.92 | 249.33 | 94.52 |
| minksse | 175,182.03 | 175,930.03 (172,471.35–179,388.71) | 114.17 | 0.91 | 0.91 | 145.14 | 85.11 |

All recorded streams passed exact event-count, order, payload and HTTP validation. Any error aborts the run without writing a successful report.

Throughput includes connection/request overhead, socket delivery and independent client validation. Both processes share this machine; client CPU and scheduler contention can cap results. Small samples and wide confidence intervals do not establish a reliable ranking. The Student-t interval describes mean throughput across these repeats, not a production guarantee.

The native baseline uses Node HTTP writes. Hono includes its router; Fastify includes its router and plugin. Hono, sveltekit-sse and MinkSSE use the same Web Response → Node HTTP adapter. sveltekit-sse uses its real published producer bundled by esbuild; SvelteKit routing and the package clients are outside this measurement. Native/Hono/Fastify await exposed write backpressure; producer APIs cannot be made identical in that respect. See README.md for scope and reproducibility.

Package versions: hono 4.13.16, fastify 5.12.7, @fastify/sse 0.6.1, better-sse 0.16.1, sveltekit-sse 0.15.1, svelte 5.57.3, @sveltejs/kit 2.70.3, esbuild 0.28.2.

Raw samples and environment: clients-1.json. Local MinkSSE source commit 4240dda29cc4695e5b8234d5bc24324d9f2b81d0; dirty checkout: true. The JSON includes the local compiled server and dependency lock hashes.
