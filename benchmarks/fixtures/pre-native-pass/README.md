# Before-native-pass baseline

Frozen compiled MinkSSE producer, parser and Node adapter from before the native-gap optimization pass. These modules match the SHA-256 hashes recorded in the earlier implemented benchmark results. They are benchmark reference artifacts, not production entry points. The project MIT license applies.

Use from the benchmarks directory with `--minkbuild=fixtures/pre-native-pass --minkapi=emit`. Do not update this snapshot when changing current source.

```json
{
  "server.js": "7d28be63fe45d280c4835a72ab17bb3a7f0b9324500fac677f7b139c5875e096",
  "node.js": "b960db3ec55c11f366707a23353f2fd4034f90f89cb4bd6470c330870060674c"
}
```
