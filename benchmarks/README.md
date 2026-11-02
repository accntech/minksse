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
| `bridge` | Web producer transport: `auto`, `pipeline`, `direct`, `hono-node`, or `kit` |
| `fastify` | `auto`, per-event `send`, `iterable`, or `stream` |
| `better` | `auto`, per-event `push`, or public `batch` |
| `cork` | Native output: `auto`, `on`, or `off` |
| `native` | `auto`, per-event `write`, or one framed `batch` write |
| `coalesce` | MinkSSE output target in bytes: `auto`, or integer 0–262,144. `auto` selects 16,384 for optimized and 0 for baseline. The library itself defaults to 0 (off). |
| `minkapi` | `auto`, `emit`, or `batch`. Optimized auto uses public `emitBatch()`, baseline auto uses scalar `emit()`. Batch array assembly remains inside timing. |
| `minkbuild` | Optional directory containing a different compiled `server.js`; actual selected source hashes are recorded. Use `--minkapi=emit` with builds predating the batch API. |
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
  queue bound. Optimized mode opts into `coalesceBytes: 16_384`, uses public
  `emitBatch()` for each common production batch, and forwards the returned
  Web Response through the harness's generic reader loop with Node socket
  backpressure. This bridge belongs to the benchmark, not the MinkSSE package.
  Baseline disables coalescing and uses `Readable.fromWeb()` with `pipeline()`.
  Add `--coalesce=0` or `--minkapi=emit` for uncoalesced or scalar comparisons.
  New reports hash the compiled producer; Node adapter/private capability
  modules are no longer required or shipped.

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

## Native client wrapper comparison

The producer comparison above does **not** measure `createSseConnection()`.
Run the separate client benchmark from the repository root with Node 24:

```sh
node --experimental-eventsource benchmarks/client-benchmark.mjs --clients=1 --output=benchmarks/results/native-client-1.json
node --experimental-eventsource benchmarks/client-benchmark.mjs --clients=16 --output=benchmarks/results/native-client-16.json
```

It compares direct native Node `EventSource`, the current source wrapper, the
pre-optimization native wrapper captured under `fixtures/pre-wrapper-optimization/`,
and the unmodified former POST Fetch client under
`fixtures/pre-eventsource-client/`. All native paths use GET. All clients
receive identical preframed named JSON events from a separate loopback HTTP
server. Every stream validates exact event count, JSON payload and sequence
before a completion sentinel closes it. Failed validation or timeout aborts
without a successful report. The server holds streams open after the sentinel,
so automatic retries and EOF handling are outside the timed workload.

Defaults: 20,000 events per client, 128-byte ASCII payload, batches of 16,
two full warmup passes and seven measured repeats. Candidate order rotates.
Options use `--name=value`: `clients`, `events`, `bytes`, `batch`, `warmup`,
`repeats`, `timeout` (milliseconds), `output`. JSON includes all samples,
source hashes and mean throughput Student-t 95% intervals; Markdown reports
medians. Completion spans connection launch through final validated sentinel;
client CPU excludes the separate server process. Each candidate parses JSON
and runs the same payload/sequence validation.

Node 24's implementation is experimental and needs the runtime flag; no
polyfill is used. These observations cannot establish browser performance,
server producer improvements, replay behavior or production capacity. The
historical Fetch client uses POST and its own parser, so that comparison
measures the entire client change rather than isolated wrapper overhead.
Direct native versus wrapped native is the wrapper-overhead control. The previous
wrapper is a same-run before/after control. Reports include percent throughput
differences within each repeat block and their Student-t 95% mean intervals;
an interval crossing zero does not establish an improvement or regression.

## Tuned Web API producer (November 2, 2026)

The producer remains pure Web APIs. Encoding now learns an ASCII/Unicode preference per response: steady ASCII uses exact-capacity `encodeInto()`, while Unicode uses one `encode()` call. The first unexpected Unicode group after ASCII can incur a partial encoding attempt before switching permanently to `encode()` for that response. No payload cache is retained. Multiline batches use a conservative wire-size bound before normalization; batches unlikely to fit take exact staging immediately. The first-member size heuristic can miss an optimization for heterogeneous batches with a large first member, without changing wire output or byte limits.

The [coalescing sweep](results/coalescing-sweep-2026-11-02.md) tested 16/32/64 KiB against the same frozen source. For 1 KiB events, 64 KiB raised median throughput from 483,574 to 756,351 events/s (**56.4%**); paired mean improvement was 58.52% (95% CI 55.74–61.31%). Median first-event p95 was 1.55 versus 1.73 ms, and whole-process RSS-after was 96.12 versus 94.72 MiB. These observations do not establish memory retention or production latency. Other workloads did not support a universal 64 KiB recommendation. The public default stays **0**, and the benchmark default stays **16 KiB**.

[Matched source controls at 16 KiB](results/tuned-web-final-control-16k.md) used the frozen `fixtures/pre-unicode-optimization/server.js` baseline, with 18 primary repeats and six repeats per other workload:

| Workload | Before median events/s | After median events/s | Median change | Paired mean change (95% CI) |
| --- | ---: | ---: | ---: | ---: |
| ASCII, 16 clients | 1,625,579 | 1,649,055 | +1.44% | +1.21% (−1.62–4.03%) |
| ASCII, 1 client | 582,547 | 575,752 | −1.17% | +3.09% (−9.88–16.06%) |
| 1 KiB, 16 clients | 471,259 | 468,869 | −0.51% | +0.53% (−4.26–5.32%) |
| Unicode, 16 clients | 1,053,487 | 1,205,832 | **+14.46%** | **+12.75% (7.91–17.59%)** |
| Mixed CR/LF, 16 clients | 907,193 | 1,279,382 | **+41.03%** | **+39.46% (36.46–42.47%)** |

ASCII changes are inconclusive. The [18-repeat 64 KiB large-event control](results/tuned-web-final-control-large64k.md) found no established source gain at fixed 64 KiB (paired +0.05%, CI −1.38–1.49%): its benefit comes from configuration. The [default-zero single-client batch control](results/tuned-web-default-zero-control.md) also found no established change (paired −0.03%, CI −3.92–3.87%). This does not measure every scalar/default API path. Controls totaled 198 validated trials and 35.28 million measured events. The earlier contended `unicode-selection-a` experiment remains recorded as inconclusive; no samples were silently excluded.

Fresh cross-project results follow. Values are median validated events/s, Node v24.12.0 on Apple M4 Pro, macOS arm64. All use batches of 16 and a full warmup per fresh server. ASCII columns use seven repeats; others use six. Sixteen-client columns use four loader workers. **MinkSSE explicitly uses 64 KiB for the 1 KiB column and 16 KiB elsewhere**. Other integrations and the independent validator are unchanged. These are separate runs from the matched source controls above.

| Project | ASCII, 1 client | ASCII, 16 clients | 1 KiB, 16 clients | Unicode, 16 clients | Mixed CR/LF, 16 clients |
| --- | ---: | ---: | ---: | ---: | ---: |
| Native Node HTTP | 607,606 | 1,873,650 | 786,661 | 1,396,654 | 1,531,046 |
| MinkSSE | 564,248 | 1,661,741 | 761,475 | 1,245,703 | 1,308,942 |
| Better SSE | 508,343 | 1,313,566 | 546,618 | 961,753 | Failed† |
| Fastify SSE | 401,918 | 760,532 | 491,757 | 621,791 | Failed† |
| Hono | 231,218 | 341,875 | 273,532 | 322,399 | 329,728 |
| sveltekit-sse | 236,516 | 340,643 | 274,399 | 312,845 | Failed† |

MinkSSE reached 92.9%, 88.7%, 96.8%, 89.2%, and 85.5% of native median throughput respectively. These results do not establish native parity. The 1 KiB median first-event p95 was 1.62 ms for MinkSSE versus 1.03 ms native; RSS-after was 96.23 versus 84.15 MiB. Full latency, CPU, RSS, confidence intervals, environment and raw samples are included in each report. This measures finite loopback HTTP delivery and independent client validation, with differing framework and backpressure semantics; it is not a production capacity guarantee.

† Previously captured failures apply specifically to pre-serialized JSON containing raw mixed CRLF/CR/LF with identity serialization. Those three configurations were excluded from the successful mixed-newline run, not assigned zero throughput. Their ordinary compact JSON workloads passed. See [raw wire/native EventSource validation](results/mixed-newline-validation-2026-11-02.json).

Full reports (adjacent JSON contains all raw samples): [single client](results/tuned-web-all-single-2026-11-02.md), [sixteen clients](results/tuned-web-all-four-loader-2026-11-02.md), [1 KiB](results/tuned-web-all-large-2026-11-02.md), [Unicode](results/tuned-web-all-unicode-2026-11-02.md), [mixed newlines](results/tuned-web-all-multiline-2026-11-02.md). All 174 measured trials and 34.44 million measured events passed validation.

Validation: 206 project tests, 41 benchmark tests, type checking, browser bundling, and the same pure-Web conformance fixture under Node, Bun, and Deno passed. Coverage includes Unicode/surrogates, CR/LF/CRLF, encoding fallback, transferred output buffers, immediate first output, blocked-consumer byte limits and cleanup.

Reproduce sequentially from the repository root after building and installing benchmark dependencies:

```sh
BUILD=benchmarks/fixtures/pre-unicode-optimization OUTPUT=benchmarks/results/coalescing-sweep.json node benchmarks/experiments/coalescing-sweep.mjs
BEFORE_BUILD=benchmarks/fixtures/pre-unicode-optimization COALESCE=16384 OUTPUT=benchmarks/results/tuned-control.json node --conditions=svelte benchmarks/experiments/portable-performance.mjs
CASES=large REPEATS=18 BEFORE_BUILD=benchmarks/fixtures/pre-unicode-optimization COALESCE=65536 OUTPUT=benchmarks/results/tuned-large64k.json node --conditions=svelte benchmarks/experiments/portable-performance.mjs
CASES=single REPEATS=6 BEFORE_BUILD=benchmarks/fixtures/pre-unicode-optimization COALESCE=0 OUTPUT=benchmarks/results/tuned-zero.json node --conditions=svelte benchmarks/experiments/portable-performance.mjs
npm --prefix benchmarks run bench -- --loaders=1 --clients=1 --events=20000 --repeats=7 --coalesce=16384 --output=results/tuned-single.json
npm --prefix benchmarks run bench -- --loaders=4 --clients=16 --events=20000 --repeats=7 --coalesce=16384 --output=results/tuned-four-loader.json
npm --prefix benchmarks run bench -- --loaders=4 --clients=16 --events=5000 --bytes=1024 --repeats=6 --coalesce=65536 --output=results/tuned-large.json
npm --prefix benchmarks run bench -- --loaders=4 --clients=16 --events=20000 --payload=unicode --repeats=6 --coalesce=16384 --output=results/tuned-unicode.json
npm --prefix benchmarks run bench -- --loaders=4 --clients=16 --events=20000 --payload=multiline --repeats=6 --coalesce=16384 --targets=native,hono,minksse --output=results/tuned-multiline.json
node tests/fixtures/portable-runtime-check.mjs
bun tests/fixtures/portable-runtime-check.mjs
deno run --quiet tests/fixtures/portable-runtime-check.mjs
```

The sweep command above reproduces the frozen pre-Unicode source selection directly; it intentionally uses that snapshot rather than the current build. Selection reports `unicode-selection-*`, `multiline-selection-c` and `eligibility-selection-d` are exploratory; final acceptance uses the matched controls above. Historical controls follow for provenance.

## Cross-project comparison with the optimized portable producer

Fresh Node v24.12.0 loopback runs on Apple M4 Pro, macOS arm64. Values are median validated events/s. These use the optimized portable build and a corrected independent CR/LF/CRLF validator. They are a separate experiment from the preceding three-way optimization control.

| Project | 1 client | 16 clients | 1 KiB | Unicode | Mixed CR/LF |
| --- | ---: | ---: | ---: | ---: | ---: |
| Native Node HTTP | 590,155 | 1,801,866 | 757,394 | 1,343,377 | 1,480,023 |
| MinkSSE | 557,104 | 1,596,428 | 479,070 | 1,027,448 | 896,509 |
| Better SSE | 504,156 | 1,269,965 | 537,880 | 972,853 | Failed validation† |
| Fastify SSE | 395,838 | 778,428 | 483,400 | 630,702 | Failed validation† |
| Hono | 233,939 | 332,926 | 271,125 | 315,857 | 323,804 |
| sveltekit-sse | 239,667 | 325,607 | 270,407 | 315,925 | Failed validation† |

All columns except single use sixteen connections and four client workers. Single and primary ASCII use seven repeats; held-out cases use six. Each fresh server gets one full warmup. Batch size is sixteen; the payload is 128 raw UTF-8 bytes except the 1 KiB case. Each connection receives 20,000 events, or 5,000 in the 1 KiB case. MinkSSE uses the generic direct Web reader bridge, public batch API and opt-in 16 KiB coalescing. Other projects retain their selected public integrations.

Published valid results comprise **174 measured trials and 34,440,000 events**. No speed is assigned to a setup that fails delivery validation. Package versions are pinned: Hono 4.13.16 / Node adapter 2.1.5, Fastify 5.12.7 / @fastify/sse 0.6.1, Better SSE 0.16.1, and sveltekit-sse 0.15.1.

† The mixed-newline column uses pre-serialized JSON containing CRLF, standalone CR and LF, with identity serialization where applicable. Better SSE, Fastify SSE and sveltekit-sse failed payload delivery under this configuration. Raw captures and independent native EventSource decoding confirm the failures. This does not mean their ordinary compact JSON workloads failed. See [failure evidence](results/mixed-newline-validation-2026-11-02.json), [initial failed run](results/mixed-newline-failed-run-2026-11-02.log), and [strict-validation failed smoke](results/mixed-newline-valid-smoke-failed-2026-11-02.log).

The former LF-only validator could falsely accept standalone-CR corruption from Fastify and sveltekit-sse. It now handles CRLF, CR and LF incrementally, including CRLF split across chunks and empty decoder output, following the [SSE line-ending rules](https://html.spec.whatwg.org/multipage/server-sent-events.html#parsing-an-event-stream). Regression tests failed before the fix and pass now; all 38 benchmark tests pass. All five columns above were rerun with the corrected scorer. The old scorer is preserved at `fixtures/pre-cr-validator/core.mjs` for source-hash auditing. Earlier native/MinkSSE-only controls used correctly LF-normalized wire and remain valid; their recorded scores used that earlier scorer version.

Raw samples, versions, effective settings, CPU/RSS/first-event summaries and confidence intervals are in the JSON beside each readable report:

- 1 client: [report](results/portable-optimized-all-single-2026-11-02.md) · [raw samples](results/portable-optimized-all-single-2026-11-02.json)
- 16 clients: [report](results/portable-optimized-all-four-loader-2026-11-02.md) · [raw samples](results/portable-optimized-all-four-loader-2026-11-02.json)
- 1 KiB: [report](results/portable-optimized-all-large-2026-11-02.md) · [raw samples](results/portable-optimized-all-large-2026-11-02.json)
- Unicode: [report](results/portable-optimized-all-unicode-2026-11-02.md) · [raw samples](results/portable-optimized-all-unicode-2026-11-02.json)
- Mixed CR/LF: [report](results/portable-optimized-all-multiline-2026-11-02.md) · [raw samples](results/portable-optimized-all-multiline-2026-11-02.json)

Native retains the highest median in every workload. MinkSSE has the highest packaged-library median for the ASCII and Unicode cases; Better SSE leads the 1 KiB case. Unicode confidence intervals overlap widely between MinkSSE and Better SSE, so there is no clear winner there; the 1 KiB MinkSSE/Fastify intervals also overlap. Overlap with native in a small all-project run does not establish parity. The selected router/adapter/queue behavior differs among projects, and logical events rather than byte-for-byte framing are compared across libraries. These are finite Node loopback observations, not browser results or production capacity guarantees.

## Recorded runs

**Earlier portable producer optimization:** [controlled results](results/portable-final-control.md) and [raw samples](results/portable-final-control.json). The fixed native, frozen generic baseline, and optimized generic producer rotate within each repeat. Primary uses eighteen repeats; single-client, 1 KiB, Unicode, and multiline workloads use six each. All 126 samples and 30.6 million measured events passed exact wire/count/order/payload validation.

| Workload | Before events/s | Optimized events/s | Native events/s | Gain | Optimized/native |
| --- | ---: | ---: | ---: | ---: | ---: |
| Sixteen clients / four workers | 1,372,808 | 1,675,647 | 1,873,879 | +22.1% | 89.4% |
| One client | 510,896 | 584,631 | 609,754 | +14.4% | 95.9% |

**The native target was not reached.** All five paired native comparisons have strictly negative 95% intervals. The 1 KiB result is inconclusive versus baseline; other held-out gains are reported in the linked tables. These are measured improvements, not a native-parity claim.

The retained code specializes batch staging, proves a conservative UTF-8 bound before skipping per-member counting, encodes only after every value/getter validates, uses owned ASCII `encodeInto` output with Unicode/API fallback, and avoids idle-pull/default-header setup work. Exact byte-limit and newline paths remain for batches that cannot prove the bound. No Node imports, adapter, private transport hooks, changed public defaults, global payload cache, or altered native control were introduced.

The frozen baseline is `fixtures/pre-portable-performance/server.js`. It is raw source; compiling with the existing ES2022/NodeNext/removeComments/sourceMap build settings reproduces the original generic benchmark compiled SHA-256 `62ecc4c6630dce8b420ca449b030ae70d134a393741f60061a9b0e316d81e5a4`. Raw and compiled hashes therefore intentionally differ. Benchmark provenance and calculations were independently verified.

Reproduce from the repository root, without concurrent test/profile loads:

```sh
bun run build
OUTPUT=benchmarks/results/portable-final-control.json node --conditions=svelte benchmarks/experiments/portable-performance.mjs
```

The runner also supports `CASES=primary,single,large,unicode,multiline` and `REPEATS=<positive integer>`; default repeat counts above apply when `REPEATS` is omitted. Timing selections `portable-selection-1` through `portable-selection-4` are exploratory, not acceptance scores. Slower byte-assembly and join-layout variants were rejected and are not part of the final source.

**Generic baseline after adapter removal (November 2, 2026):** [one client](results/generic-all-single-2026-11-02.md) and [sixteen clients / four workers](results/generic-all-four-loader-2026-11-02.md), with adjacent raw JSON. Seven repeats per project, 20,000 events per connection, 128-byte payloads, batch sixteen, and one full warmup per trial. MinkSSE uses the generic direct reader with opt-in 16 KiB coalescing; other projects retain their selected integrations.

MinkSSE measured 510,211 events/s at one client and 1,359,479 at sixteen. This is 5.77% and 19.11% lower than the immediately preceding adapter-based runs. It is effectively tied with Better SSE in both workloads (overlapping confidence intervals). All 84 measured samples passed validation, totaling 14.28 million events. Source hashes and calculations were independently verified. These are Node-hosted loopback measurements of the portable producer, not cross-runtime performance guarantees.

Earlier server reports predating the generic-streaming removal retain their original results,
source hashes, options and adapter names as historical evidence. Their optimized
MinkSSE path used the now-removed Node adapter and private producer hooks; they
do not describe the current generic Web streaming path. The current harness
rejects `--bridge=minksse-node` and records schema version 5 without removed-module
hash fields. Historical optimization experiment scripts under `experiments/`
remain snapshots of those earlier investigations and may require their frozen
builds or historical harness revision.

- **Latest client wrapper optimization:** [Native wrapper overhead](NATIVE-CLIENT-OPTIMIZATION-2026-11-02.md), with same-run previous-wrapper/native controls, twenty repeats, delivery-path diagnostics and raw results.

- **Native client wrapper:** [November 2 client validation](NATIVE-CLIENT-WRAPPER-2026-11-02.md), with direct native EventSource and historical Fetch controls at one and sixteen clients. This measures clients separately from the producer comparisons below.
- **Historical Node adapter optimization and all-project comparison:** [Owned native output](OWNED-OUTPUT-OPTIMIZATION-2026-11-02.md), with an 18-repeat before/after control, profiles, ownership/queue safety checks and fresh results for all six implementations.
- [Earlier four-loader hot path](FOUR-LOADER-HOTPATH-2026-11-02.md), including the preceding batch-loop/callback-writer pass.
- [Earlier native queue allocation pass](NATIVE-QUEUE-OPTIMIZATION-2026-11-02.md), including controlled before/after results and verification.
- [Earlier November 2 all-project run](FRESH-COMPARISON-2026-11-02.md), using the preceding Node queue build.
- [Four-loader optimization report](FOUR-LOADER-OPTIMIZATION.md), with native UTF-8 counting, repeated controls and held-out payloads.
- [Previous native-gap report](NATIVE-PERFORMANCE.md), including explicit batch/scalar results and client-CPU controls.
- Earlier all-package results: [one client](results/native-pass-clients-1.md), [16 clients / one loader](results/native-pass-clients-16.md), [16 clients / four loaders](results/native-pass-parallel.md), [1 KiB](results/native-pass-large.md), [sparse](results/native-pass-sparse.md).
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
