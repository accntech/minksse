# SSE package HTTP benchmarks

Compare native Node HTTP SSE, Hono `streamSSE`, `@fastify/sse`, Better SSE,
`sveltekit-sse`, and the local built MinkSSE server using actual loopback HTTP
streams. The comparison is isolated from the library's runtime dependencies and
its existing parser/producer microbenchmark in `scripts/benchmark.mjs`.

## Run

Use Node 24 or newer. From the repository root:

```sh
npm run build
npm --prefix benchmarks ci --ignore-scripts
npm --prefix benchmarks test
npm --prefix benchmarks run smoke
npm --prefix benchmarks run bench
```

Or use the root shortcut, after installing benchmark dependencies:

```sh
npm run bench:compare
```

The default comparison uses 16 clients, 1,000 events per client, 128 payload
bytes, batches of 16 events, one full warmup workload per fresh server, and five
measured repeats. Outputs are `benchmarks/results/latest.json` and `.md` when
invoked through npm. Each complete comparison usually takes seconds to a minute,
depending on the machine and chosen workload.

Every argument uses `--name=value`:

```sh
npm --prefix benchmarks run bench -- --clients=1 --events=20000 --repeats=5 --output=results/clients-1.json
npm --prefix benchmarks run bench -- --clients=16 --events=20000 --repeats=5 --output=results/clients-16.json
npm --prefix benchmarks run bench -- --targets=native,hono --bytes=1024 --batch=8 --interval=1
```

| Option | Meaning |
| --- | --- |
| `clients` | Concurrent finite HTTP streams per workload pass |
| `events` | Number of events delivered on each stream |
| `bytes` | ASCII `x` characters in the JSON payload field; excludes JSON and SSE framing |
| `batch` | Events per producer batch before yielding the event loop |
| `interval` | Delay in milliseconds between batches; zero uses `setImmediate` |
| `warmup` | Full validated passes before measurement in each fresh server process; may be zero |
| `repeats` | Independent measured trials per candidate |
| `timeout` | Milliseconds allowed for a workload or server control response |
| `targets` | Comma-separated subset: `native,hono,fastify,better-sse,sveltekit-sse,minksse` |
| `output` | JSON path relative to the command's working directory; sibling Markdown also written |

The server binds an ephemeral port on `127.0.0.1`. The harness kills and reaps
the child server after each sample, including timeout and correctness failures.
If any stream has an incorrect status, MIME type, event count, order, JSON,
payload, or incomplete frame, the command fails instead of recording a score.
The test suite exercises each real package and failure paths.

## What is measured

All candidates run on the same Node executable and receive HTTP/1.1 POST
requests from the same Node `fetch` client. The client runs outside the server
process and independently parses and validates every delivered event. Each
connection receives named `message` events with IDs `1..events` and JSON
`{ "sequence": 0, "payload": "xxx..." }`. JSON strings are prepared before
timing for every candidate; framing and delivery remain inside timing.

Each repeat starts a fresh server, imports dependencies, precomputes JSON,
performs full warmup passes, and measures one pass. Startup, module import,
bundling, and warmup time are excluded from throughput and CPU deltas. Candidate
order rotates between repeats; candidates are measured sequentially.
The fetch connection pool may reuse sockets from the warmup pass, so these are
warmed HTTP measurements; first-event times are not cold connection times.

All producers yield after the same event batch. This keeps finite workloads
below MinkSSE's bounded 256 KiB queue with the defaults. Native Node, Hono and
Fastify await write backpressure where exposed by their APIs. Better SSE and
the two `produce()` APIs expose different queue behavior. Increasing payloads,
batch size or clients may trigger transport limits; a failed run is a workload
failure, not a valid zero-throughput sample.

| Metric | Definition |
| --- | --- |
| Events/s | Total validated events divided by elapsed time from launching concurrent requests to all bodies reaching EOF |
| Completion ms | That entire concurrent workload's elapsed time |
| First event ms | Per-client time from starting its request until processing the first chunk containing a complete validated event; includes connection and chunk parsing overhead |
| Per-trial p95 first event | Nearest-rank p95 across clients in that repeat; the report then shows the median across repeats |
| Server CPU ms | Server process user + system CPU delta for the measured pass and stats IPC |
| RSS before/after | Server resident memory snapshots surrounding the measured pass; raw JSON contains both |
| Process peak RSS | Lifetime high-water mark, including imports, precomputed messages, warmup and sveltekit-sse bundling; raw JSON and summary label it explicitly |
| Wire MiB/s | Actual received SSE body bytes per second, including package-specific formatting; raw JSON only |

Median throughput is the primary comparison. The report also gives mean
throughput with a two-sided Student-t 95% interval over independent repeat
scores (normal approximation above 30 degrees of freedom). A single repeat has
no confidence interval. These intervals assume repeat scores are approximately
independent and do not account for systematic machine or harness bias. Wide
intervals and small sample counts cannot establish a reliable ranking.

## Adapter differences and limits

- **Native:** Handwritten SSE framing on Node `http.ServerResponse`, awaiting
  `drain` when necessary. This is the zero-library server baseline.
- **Hono:** A real Hono POST route and `streamSSE().writeSSE()`.
- **Fastify:** A real Fastify POST route registered with the official SSE
  plugin, using `reply.sse.send()`. The `fastify` label means Fastify plus
  `@fastify/sse`.
- **Better SSE:** `createSession(req, res)` and `session.push()`, with an identity
  serializer to avoid double JSON encoding. Random UUID IDs, retry preambles
  and keepalive output are disabled in favor of the shared ID/workload policy.
- **sveltekit-sse:** The real published `produce()` API. Its published package
  exposes a `svelte` export condition and extensionless imports. The harness
  bundles the public export with esbuild before starting the server, as a
  bundler would; it does not rewrite or replace the package implementation.
  This measures the producer, excluding SvelteKit routing, generated application
  code, browser stores and the package's `source()` client.
- **MinkSSE:** `produce()` from this checkout's `dist/server.js`, including its
  queue bound. A SHA-256 hash identifies that compiled file in each report.

Hono, sveltekit-sse and MinkSSE share the identical Web Response → Node HTTP
adapter in `server.mjs`, implemented with `Readable.fromWeb()` and `pipeline()`.
Fastify uses its own HTTP integration; Better SSE uses its native Node
integration. The results include these integration costs, so they are not a
pure encoder microbenchmark or an interchangeable-framework overhead estimate.

Heartbeat output is disabled where possible, or set to the maximum timer
interval for finite test runs. Do not use these adapters as production server
examples. They intentionally omit authentication, recovery and application work.

The client and server share a machine, so client parsing, CPU contention,
scheduler effects and loopback sockets can limit throughput. Wire bytes differ
slightly because libraries choose field ordering, spacing and initial comments.
This benchmark does not measure browser clients, TLS, proxies, WAN latency,
broadcast fan-out, reconnection/replay, long-lived idle connections, slow
consumers, memory leaks or maximum server capacity. First-event numbers are
neither per-event latency nor emission-to-reception latency. RSS is whole
process memory, not per-connection allocation.

## Recorded runs

- [One client](results/clients-1.md): 20,000 events, five repeats.
- [Sixteen clients](results/clients-16.md): 20,000 events per client, five repeats.

Raw `.json` files beside the reports include every trial, versions, CPU/OS/
runtime metadata, workload options, dependency lock hash, source commit and local
compiled server hash. Results are observations on that machine and checkout;
rerun under your own deployment conditions before drawing capacity conclusions.

Primary API references: [Hono streaming](https://hono.dev/docs/helpers/streaming),
[@fastify/sse](https://github.com/fastify/sse),
[Better SSE](https://github.com/MatthewWid/better-sse), and
[sveltekit-sse](https://github.com/razshare/sveltekit-sse).
