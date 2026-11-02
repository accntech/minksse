# Native wrapper before delivery optimization

Captured from the working tree immediately before optimizing `src/client.js`.
It preserves the native GET wrapper, including the cross-realm MessageEvent fix,
subscription snapshots, error handling, and default event-idle timeout.

The client benchmark runs this fixture as `wrapper-before` in the same process
and rotated repeat blocks as direct native EventSource and the optimized wrapper.
Reports record its SHA-256; this is a working-tree baseline rather than a
claim that the wrapper existed in the repository's current HEAD commit.
