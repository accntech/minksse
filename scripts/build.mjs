// Packaging structure adapted from MinkExcel. Copyright (c) 2026 MinkExcel contributors.
// MIT licensed; see LICENSE. Emit separate JavaScript modules to preserve tree shaking.
import { readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
if (manifest.type !== 'module' || manifest.sideEffects !== false) {
  throw new Error('The package must retain tree-shakeable ESM metadata.');
}
await rm(new URL('dist/', root), { recursive: true, force: true });
const compiler = fileURLToPath(new URL('node_modules/typescript/bin/tsc', root));
const result = spawnSync(process.execPath, [compiler, '-p', 'tsconfig.build.json'], {
  cwd: root,
  stdio: 'inherit'
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
console.log('Built JavaScript ESM modules and JSDoc-derived declarations → dist');
