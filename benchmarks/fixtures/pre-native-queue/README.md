# Native queue control baseline

Frozen compiled producer, Node adapter, private registry and parser after the
single-stream budget/header pass and native reader ownership fixes. This build
uses byte-only Web delivery through TextEncoder and the existing Node reader
pump. It precedes the private Node-owned pull queue experiment. The project MIT
license applies. Use --minkapi=batch with this directory as --minkbuild.
