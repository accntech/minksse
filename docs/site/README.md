# MinkSSE documentation

A static documentation site for MinkSSE, with grouped navigation, API references, and runnable examples. Public type declarations are included directly from the library build. The Benchmarks guide includes the latest six-project producer comparison, explicit coalescing settings, matched-control findings, methodology, and reproduction commands.

```sh
bun install
bun run docs:build
bun run docs:preview
```

Open http://127.0.0.1:4173/minksse/. Set `DOCS_PORT` to use another port. Output is `build/docs/`; it can be served at a root or subdirectory because page links and assets are relative. No hosting or publishing account is configured.

`bun run test` builds the JavaScript library and docs, runs transport tests, checks internal links and anchors, and executes the parser and quick-start client examples against the real package. `bun run check` strictly checks the JavaScript source through JSDoc and the compile-only JavaScript declaration consumer in `tests/types-consumer.js`. Search, theme switching, code copying, and the mobile navigation drawer enhance the static pages; primary page content and links work without JavaScript.

## Assets

- Local Geist fonts and their OFL license are included in `assets/`.
- Third-party icon licenses and attribution are in `assets/licenses/`.
- The project icon is stored in `../../assets/icon.png` and copied to the docs output during the build.

## Verification limits

The React, Vue, and Svelte examples follow their official lifecycle documentation but have not been mounted in separate framework applications. Production streaming depends on the consuming server, proxy, and host. The local docs preview serves static documentation only.

## Benchmark results

After `bun run docs:preview`, open http://127.0.0.1:4173/minksse/benchmarks/. The built site includes `benchmarks/index.html`, linked from the overview, producer reference, navigation, search, and documentation indexes. Its comparison table reads the recorded JSON summaries through `benchmarks.mjs` when the site is built. The build copies an explicit list of final reports, raw JSON samples, controls, the coalescing sweep, and mixed-newline failure evidence into `build/docs/benchmark-results/`, so result links work on standalone static hosting. Building the site does not rerun timing experiments.

See [benchmark methodology and commands](../../benchmarks/README.md#tuned-web-api-producer-november-2-2026). When updating measurements, update the selected report names in `benchmarks.mjs` and review the accompanying settings, date, and interpretation in `content.mjs` and the root README.
