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

The default comparison uses the **optimized** setup, 16 clients, 1,000 events per client, 128 payload
bytes, batches of 16 events, one full warmup workload per fresh server, and five
measured repeats. Outputs are `benchmarks/results/latest.json` and `.md` when
invoked through npm. Each complete comparison usually takes seconds to a minute,
depending on the machine and chosen workload.

Every argument uses `--name=value`:

```sh
npm --prefix benchmarks run bench -- --clients=1 --events=20000 --repeats=5 --output=results/clients-1.json
npm --prefix benchmarks run bench -- --clients=16 --events=20000 --repeats=5 --output=results/clients-16.json
npm --prefix benchmarks run bench -- --targets=native,hono --bytes=1024 --batch=8 --interval=1
npm --prefix benchmarks run bench -- --setup=baseline --clients=16 --events=20000
npm --prefix benchmarks run bench -- --targets=minksse --profile=profiles --events=50000 --repeats=1
```

| Option | Meaning |
| --- | --- |
| `clients` | Concurrent finite HTTP streams per workload pass |
| `events` | Number of events delivered on each stream |
| `bytes` | Raw UTF-8 bytes in the JSON payload field; excludes JSON and SSE framing |
| `payload` | `ascii` (default), `unicode` (`é😀` plus ASCII remainder), or `multiline` (mixed CRLF/CR/LF JSON whitespace) |
| `batch` | Events per producer batch before yielding the event loop |
| `interval` | Delay in milliseconds between batches; zero uses `setImmediate` |
| `warmup` | Full validated passes before measurement in each fresh server process; may be zero |
| `repeats` | Independent measured trials per candidate |
| `timeout` | Milliseconds allowed for a workload or server control response |
| `targets` | Comma-separated subset: `native,hono,fastify,better-sse,sveltekit-sse,minksse` |
| `output` | JSON path relative to the command's working directory; sibling Markdown also written |
| `setup` | `optimized` (default) or original `baseline` setup |
| `bridge` | Web producer transport: `auto`, `pipeline`, `direct`, `hono-node`, `kit`, or `minksse-node` |
| `fastify` | `auto`, per-event `send`, `iterable`, or `stream` |
| `better` | `auto`, per-event `push`, or public `batch` |
| `cork` | Native output: `auto`, `on`, or `off` |
| `native` | `auto`, per-event `write`, or one framed `batch` write |
| `coalesce` | MinkSSE output target in bytes: `auto`, or integer 0–262,144. `auto` selects 16,384 for optimized and 0 for baseline. The library itself defaults to 0 (off). |
| `minkapi` | `auto`, `emit`, or `batch`. Optimized auto uses public `emitBatch()`, baseline auto uses scalar `emit()`. Batch array assembly remains inside timing. |
| `minkbuild` | Optional directory containing a different compiled `server.js` and `node.js`; actual selected source hashes are recorded. Use `--minkapi=emit` with builds predating the batch API. |
| `loaders` | 1 by default; up to 32 client workers, never more than clients. Workers persist through warmup and measured pass; startup is excluded. Client CPU is counted once for the entire process. |
| `profile` | Directory for V8 CPU profiles; includes startup/warmup and uses graceful shutdown |

`auto` resolves per candidate and setup. JSON reports record the effective
settings and benchmark source hashes. Explicit overrides are experiments; they
are not automatically faster. See [optimization analysis](OPTIMIZATION.md) for
selection evidence, fresh comparisons, and MinkSSE recommendations.

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
timing for every candidate; framing and delivery remain inside timing. Unicode
payloads have the requested exact UTF-8 size. Multiline mode adds mixed JSON
whitespace line endings; each candidate performs its SSE newline escaping during
measurement, including native.

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
  `drain` when necessary. Optimized mode frames and joins each shared batch
  inside timing and performs one write. Baseline uses individual writes.
  Explicit per-batch corking lost in selection trials and remains off.
- **Hono:** A real Hono POST route and `streamSSE().writeSSE()`, using official
  `@hono/node-server` in optimized mode. Its default listener also replaces
  global `Request`/`Response` with the adapter's lightweight implementations;
  this is a whole supported Node setup, not a bridge-only ablation.
- **Fastify:** A real Fastify POST route registered with the official SSE
  plugin, using `reply.sse.send()`. The `fastify` label means Fastify plus
  `@fastify/sse`. Per-event send beat the tested iterable and Node stream paths.
- **Better SSE:** `createSession(req, res)` and `session.push()`, with an identity
  serializer to avoid double JSON encoding; optimized mode uses the public
  `session.batch()` API for each common production batch. Random UUID IDs, retry preambles
  and keepalive output are disabled in favor of the shared ID/workload policy.
- **sveltekit-sse:** The real published `produce()` API. Its published package
  exposes a `svelte` export condition and extensionless imports. The harness
  bundles the public export with esbuild before starting the server, as a
  bundler would; it does not rewrite or replace the package implementation.
  This measures the producer, excluding SvelteKit routing, generated application
  code, browser stores and the package's `source()` client. Optimized mode uses
  SvelteKit's public Node `setResponse()` writer.
- **MinkSSE:** `produce()` from this checkout's `dist/server.js`, including its
  queue bound. Optimized mode opts into `coalesceBytes: 16_384` and uses the
  supported `writeSseResponse()` from `minksse/node` and public `emitBatch()` for
  each common production batch; baseline disables
  coalescing and retains the old pipeline. `--coalesce=0` measures the adapter
  independently. Add `--minkapi=emit` for the prior scalar producer path.
  SHA-256 hashes identify both compiled modules in new reports.

In baseline mode Hono, sveltekit-sse and MinkSSE share the identical Web Response
→ Node HTTP adapter, implemented with `Readable.fromWeb()` and `pipeline()`.
Optimized mode uses the per-candidate adapters above; `--bridge=direct` applies
the same direct-reader bridge to all three for a producer comparison.
With MinkSSE add `--coalesce=0` to reproduce the previous unbatched producer comparison.
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

- **Latest optimization and all-project comparison:** [Owned native output](OWNED-OUTPUT-OPTIMIZATION-2026-11-02.md), with an 18-repeat before/after control, profiles, ownership/queue safety checks and fresh results for all six implementations.
- [Earlier four-loader hot path](FOUR-LOADER-HOTPATH-2026-11-02.md), including the preceding batch-loop/callback-writer pass.
- [Earlier native queue allocation pass](NATIVE-QUEUE-OPTIMIZATION-2026-11-02.md), including controlled before/after results and verification.
- [Earlier November 2 all-project run](FRESH-COMPARISON-2026-11-02.md), using the preceding Node queue build.
- [Four-loader optimization report](FOUR-LOADER-OPTIMIZATION.md), with native UTF-8 counting, repeated controls and held-out payloads.
- [Previous native-gap report](NATIVE-PERFORMANCE.md), including explicit batch/scalar results and client-CPU controls.
- Latest all-package results: [one client](results/native-pass-clients-1.md), [16 clients / one loader](results/native-pass-clients-16.md), [16 clients / four loaders](results/native-pass-parallel.md), [1 KiB](results/native-pass-large.md), [sparse](results/native-pass-sparse.md).
- [Implemented features and rerun analysis](IMPLEMENTATION.md): Node adapter, opt-in coalescing, fresh all-package results and isolated ablations.
- Implemented optimized results: [one client](results/implemented-clients-1.md), [sixteen clients](results/implemented-clients-16.md), [1 KiB](results/implemented-large-payload.md), and [sparse](results/implemented-sparse.md).
- Original run: [one client](results/clients-1.md) and [sixteen clients](results/clients-16.md).
- Fresh baseline: [one client](results/baseline-clients-1.md) and [sixteen clients](results/baseline-clients-16.md).
- Optimized: [one client](results/optimized-clients-1.md) and [sixteen clients](results/optimized-clients-16.md).
- Held-out workloads: [1 KiB payloads](results/optimized-large-payload.md) and [sparse events](results/optimized-sparse.md), with adjacent baseline reports.
- [Setup selection samples](results/setup-selection.json): three repeats per tested strategy.
- [Native batching selection](results/native-selection.json): three repeats at one and sixteen clients.

Profile runs are diagnostic only; instrumentation changes performance. Profile
throughput must not be used as an uninstrumented score. Raw `.cpuprofile` files
are local ignored artifacts in `profiles/`; the analysis records their hashes
and sampled-stack summaries.

Raw `.json` files beside the reports include every trial, versions, CPU/OS/
runtime metadata, workload options, dependency lock hash, source commit and local
compiled server hash. Results are observations on that machine and checkout;
rerun under your own deployment conditions before drawing capacity conclusions.

Primary API references: [Hono streaming](https://hono.dev/docs/helpers/streaming),
[@fastify/sse](https://github.com/fastify/sse),
[Better SSE](https://github.com/MatthewWid/better-sse), and
[sveltekit-sse](https://github.com/razshare/sveltekit-sse).
