import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';

test('native EventSource wrapper works against real Node HTTP streams', () => {
  const result = spawnSync('node', ['--experimental-eventsource', '--disable-warning=UNDICI-ES', 'tests/fixtures/native-client-check.mjs'], {
    cwd: new URL('../', import.meta.url), encoding: 'utf8', timeout: 10_000
  });
  expect({ status: result.status, stderr: result.stderr, error: result.error?.message }).toEqual({ status: 0, stderr: '', error: undefined });
  expect(JSON.parse(result.stdout)).toHaveLength(5);
});
