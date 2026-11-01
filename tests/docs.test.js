import { expect, test } from 'bun:test';
import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const output = fileURLToPath(new URL('../build/docs/', import.meta.url));

test('README JavaScript examples parse in Node without a TypeScript loader', async () => {
  const { spawnSync } = await import('node:child_process');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  const examples = [...readme.matchAll(/```js\n([\s\S]*?)```/g)];
  expect(examples.length).toBeGreaterThan(0);
  for (const [, source] of examples) {
    const result = spawnSync('node', ['--input-type=module', '--check'], { input: source, encoding: 'utf8' });
    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
  }
});

async function htmlFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? htmlFiles(resolve(dir, entry.name)) : entry.name.endsWith('.html') ? [resolve(dir, entry.name)] : []))).flat();
}
test('documentation builds navigable pages with valid local links and fragments', async () => {
  expect(await Bun.file(resolve(output, 'index.html')).exists()).toBe(true);
  const files = await htmlFiles(output);
  expect(files.length).toBeGreaterThanOrEqual(8);
  for (const file of files) {
    const html = await readFile(file, 'utf8');
    expect(html).toContain('MinkSSE');
    expect(html).not.toMatch(/minkexcel|@grabm\/sse|workbook|exceljs/i);
    for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      if (/^[a-z]+:|^\/\//i.test(match[1])) continue;
      const [path, fragment] = match[1].split('#');
      let target = path ? resolve(dirname(file), path) : file;
      if ((await stat(target)).isDirectory()) target = resolve(target, 'index.html');
      expect(await Bun.file(target).exists()).toBe(true);
      if (fragment) expect(await readFile(target, 'utf8')).toContain(`id="${fragment}"`);
    }
  }
});
test('primary navigation selects the current documentation section', async () => {
  for (const [slug, selected] of [
    ['index', 'Docs'], ['getting-started', 'Get started'],
    ['server', 'Reference'], ['client', 'Reference'], ['parser', 'Reference'],
    ['types', 'Reference'], ['lifecycle', 'Docs'], ['frameworks', 'Docs'],
    ['deployment', 'Docs'], ['faq', 'Docs']
  ]) {
    const html = await readFile(resolve(output, slug === 'index' ? 'index.html' : `${slug}/index.html`), 'utf8');
    const nav = html.match(/<nav class="primary-nav"[^>]*>([\s\S]*?)<\/nav>/)[1];
    const active = [...nav.matchAll(/<a\b[^>]*aria-current="page"[^>]*>([^<]+)<\/a>/g)];
    expect(active.map(match => match[1])).toEqual([selected]);
  }
});

test('search points to built pages and source-derived API declarations ship with docs', async () => {
  const search = await Bun.file(resolve(output, 'search.json')).json();
  expect(search.some((item) => item.title.includes('Reconnection'))).toBe(true);
  for (const item of search) {
    const target = resolve(output, item.href.split('#')[0], 'index.html');
    expect(await Bun.file(target).exists()).toBe(true);
  }
  const types = await readFile(resolve(output, 'types/index.d.ts'), 'utf8');
  expect(types).toContain('produce');
  expect(types).toContain('createSseConnection');
});

test('the published parser example executes against the real API', async () => {
  const { pages } = await import(new URL('../docs/site/content.mjs', import.meta.url).href);
  const parserPage = pages({ types: '' }).find((page) => page.slug === 'parser');
  const encoded = parserPage.body.match(/<pre[^>]*><code>([\s\S]*?)<\/code><\/pre>/)[1];
  const source = encoded.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync('node', ['--input-type=module', '--eval', source], { cwd: new URL('../', import.meta.url), encoding: 'utf8' });
  expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
  expect(result.stdout).toContain('update {"count":1}');
});

test('the quick-start client connects before explicit disposal', async () => {
  const { pages } = await import(new URL('../docs/site/content.mjs', import.meta.url).href);
  const page = pages({ types: '' }).find((item) => item.slug === 'getting-started');
  const blocks = [...page.body.matchAll(/<pre[^>]*><code>([\s\S]*?)<\/code><\/pre>/g)];
  const source = blocks[blocks.length - 1][1].replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  const { spawnSync } = await import('node:child_process');
  const fixture = `
    import assert from 'node:assert/strict';
    let requests = 0;
    globalThis.fetch = async () => {
      requests++;
      return new Response('event: tick\\ndata: {"time":123}\\n\\n', { headers: { 'Content-Type': 'text/event-stream' } });
    };
    ${source}
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(requests, 1);
    dispose();
    assert.equal(connection.closed, true);
  `;
  const result = spawnSync('node', ['--input-type=module', '--eval', fixture], { cwd: new URL('../', import.meta.url), encoding: 'utf8' });
  expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
  expect(result.stdout).toContain('123');
});
