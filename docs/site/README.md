# Minksse documentation

A static documentation site adapted from the local MinkExcel docs project. The layout follows the grouped navigation, central reading column, sticky header, and page outline of [Svelte's documentation](https://svelte.dev/docs/svelte/overview). The SSE API content comes from this project's source, with type declarations included directly from the library build.

```sh
bun install
bun run docs:build
bun run docs:preview
```

Open http://127.0.0.1:4173/minksse/. Set `DOCS_PORT` to use another port. Output is `build/docs/`; it can be served at a root or subdirectory because page links and assets are relative. No hosting or publishing account is configured.

`bun run test` builds the JavaScript library and docs, runs transport tests, checks internal links and anchors, and executes the parser and quick-start client examples against the real package. `bun run check` strictly checks the JavaScript source through JSDoc and the compile-only TypeScript declaration consumer. Search, theme switching, code copying, and the mobile navigation drawer enhance the static pages; primary page content and links work without JavaScript.

## Assets and provenance

- Local Geist fonts and their OFL license are retained from the MinkExcel base.
- Solar icons and the retained Octicons license/attribution are in `assets/licenses/`.
- The runtime was extracted from `grabm/packages/sse`; no benchmark claims or monorepo dependencies were carried into this site.
- The orange mink sibling icon is saved in `../../assets/icon.png` and copied to the docs output by the build. It was generated using the built-in image generation tool from MinkExcel's original icon, inspected visually, and checked in the rendered header at desktop and mobile sizes. Image-generation output is an approximate visual match, not an exact vector recoloring.

Final image prompt:

> Use case: logo-brand. Create a sibling app icon for Minksse using the supplied MinkExcel icon as the reference. Keep the same simple friendly white line-art mink head facing right, same proportions, rounded square silhouette and flat crisp style. Change the green rounded square to Svelte-like vivid orange #ff3e00. Replace XL under the chin with SSE in simple rounded white uppercase lettering, carefully spell S S E. No other text. The rounded square fills the canvas like the reference; transparent only outside its rounded corners. High-resolution square icon, flat colors, no shadow, no gradients, no Svelte S logo. This is a new sibling icon, do not modify the source asset.

## Verification limits

The React, Vue, and Svelte examples follow their official lifecycle documentation but have not been mounted in separate framework applications. Production streaming depends on the consuming server, proxy, and host. The local docs preview serves static documentation only.
