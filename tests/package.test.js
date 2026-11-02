import { expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
const root = new URL("../", import.meta.url);
test("native JavaScript source imports in Node and matches the public package API", () => {
  expect(readdirSync(new URL("src/", root)).sort()).toEqual(["client.js", "index.js", "node.js", "parser.js", "producer-capabilities.js", "server.js"]);
  const result = spawnSync("node", ["--input-type=module", "--eval", `
    import assert from 'node:assert/strict';
    const source = await import('./src/index.js');
    const packaged = await import('minksse');
    assert.deepEqual(Object.keys(source), Object.keys(packaged));
    const messages = [];
    source.createSseParser(message => messages.push(message)).push('data: native\\n\\n');
    assert.deepEqual(messages, [{ event: 'message', data: 'native', id: '' }]);
    const response = source.produce(({ emit, lock }) => {
      emit('ready', 'native');
      lock.set(false);
    });
    assert.equal(await response.text(), 'id: 1\\nevent: ready\\ndata: native\\n\\n');
    const connection = source.createSseConnection('/unused');
    connection.close();
    assert.equal(connection.closed, true);
  `], { cwd: root, encoding: "utf8" });
  expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: "" });
});
test("build emits the public ESM entry points and declarations", () => {
  for (const entry of ["index", "client", "server", "parser", "node"]) {
    expect(existsSync(new URL(`dist/${entry}.js`, root))).toBe(true);
    expect(existsSync(new URL(`dist/${entry}.d.ts`, root))).toBe(true);
  }
});
test("Node imports the root and all public subpaths without a TypeScript loader", () => {
  const result = spawnSync("node", ["--input-type=module", "--eval", `
    import assert from 'node:assert/strict';
    const root = await import('minksse');
    const client = await import('minksse/client');
    const server = await import('minksse/server');
    const parser = await import('minksse/parser');
    const node = await import('minksse/node');
    assert.equal(typeof node.writeSseResponse, 'function');
    assert.equal('writeSseResponse' in root, false);
    assert.equal(root.createSseConnection, client.createSseConnection);
    assert.equal(root.produce, server.produce);
    assert.equal(root.createSseParser, parser.createSseParser);
    assert.equal(root.SSE_MAX_BUFFER_BYTES, 256 * 1024);
    const messages = [];
    parser.createSseParser(message => messages.push(message)).push('data: {"ok":true}\\n\\n');
    assert.deepEqual(messages, [{ event: 'message', data: '{"ok":true}', id: '' }]);
    const response = server.produce(({ emit, lock }) => {
      emit('ready', JSON.stringify({ ok: true }));
      lock.set(false);
    });
    assert.equal(await response.text(), 'id: 1\\nevent: ready\\ndata: {"ok":true}\\n\\n');
  `], { cwd: root, encoding: "utf8" });
  expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: "" });
});
