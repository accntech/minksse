# SSE HTTP benchmark results

Generated 2026-11-01T14:23:35.315Z. 16 concurrent clients × 20000 events; 128-byte ASCII payload per event, batch 16, interval 0 ms.

5 measured repeats, 1 full warmup pass(es) per fresh server. v24.12.0, Apple M4 Pro, darwin/arm64.

| Candidate | Median events/s | Mean events/s (95% CI) | Median completion ms | Median first event ms | Median per-trial p95 first event ms | Median server CPU ms | Median RSS after MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| native | 1,065,783.55 | 1,019,687.29 (920,041.26–1,119,333.33) | 300.25 | 0.56 | 1.09 | 308.39 | 80.67 |
| hono | 191,765.84 | 187,050.06 (173,969.88–200,130.25) | 1,668.7 | 2.25 | 3.92 | 1,717.41 | 132.55 |
| fastify | 852,254.38 | 850,907.36 (811,653.2–890,161.52) | 375.47 | 0.73 | 1.11 | 385.97 | 94.19 |
| better-sse | 824,482.05 | 816,487.53 (765,230.06–867,745) | 388.12 | 1.21 | 1.41 | 396.97 | 82.23 |
| sveltekit-sse | 104,775.24 | 106,271.49 (97,997.63–114,545.35) | 3,054.16 | 3.64 | 5.09 | 3,107.92 | 111.44 |
| minksse | 281,616.47 | 280,410.94 (271,581.84–289,240.04) | 1,136.3 | 2.18 | 3.13 | 1,171.47 | 101.52 |

All recorded streams passed exact event-count, order, payload and HTTP validation. Any error aborts the run without writing a successful report.

Throughput includes connection/request overhead, socket delivery and independent client validation. Both processes share this machine; client CPU and scheduler contention can cap results. Small samples and wide confidence intervals do not establish a reliable ranking. The Student-t interval describes mean throughput across these repeats, not a production guarantee.

The native baseline uses Node HTTP writes. Hono includes its router; Fastify includes its router and plugin. Hono, sveltekit-sse and MinkSSE use the same Web Response → Node HTTP adapter. sveltekit-sse uses its real published producer bundled by esbuild; SvelteKit routing and the package clients are outside this measurement. Native/Hono/Fastify await exposed write backpressure; producer APIs cannot be made identical in that respect. See README.md for scope and reproducibility.

Package versions: hono 4.13.16, fastify 5.12.7, @fastify/sse 0.6.1, better-sse 0.16.1, sveltekit-sse 0.15.1, svelte 5.57.3, @sveltejs/kit 2.70.3, esbuild 0.28.2.

Raw samples and environment: clients-16.json. Local MinkSSE source commit 4240dda29cc4695e5b8234d5bc24324d9f2b81d0; dirty checkout: true. The JSON includes the local compiled server and dependency lock hashes.
