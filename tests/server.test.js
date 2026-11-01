import { describe, expect, test } from 'bun:test';
import { produce, SSE_MAX_BUFFER_BYTES } from '../src/server.js';

const decoder = new TextDecoder();

describe('native SSE producer', () => {
	test('carriage returns in data cannot inject another SSE event', async () => {
		const response = produce(({ emit, lock }) => {
			emit('notice', 'first\revent: injected\r\ndata: unexpected');
			lock.set(false);
		});
		expect(await response.text()).toBe('id: 1\nevent: notice\ndata: first\ndata: event: injected\ndata: data: unexpected\n\n');
	});
	test('preserves wire framing, IDs, multiline and empty data, and custom headers', async () => {
		const response = produce(({ emit, lock }) => {
			emit('resource:customers:updated', 'first\nsecond\n');
			emit('ping', '');
			lock.set(false);
		}, { headers: { 'access-control-allow-origin': 'https://pos.example' } });
		expect(await response.text()).toBe('id: 1\nevent: resource:customers:updated\ndata: first\ndata: second\ndata: \n\nid: 2\nevent: ping\ndata: \n\n');
		expect(response.headers.get('content-type')).toBe('text/event-stream');
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(response.headers.get('connection')).toBe('keep-alive');
		expect(response.headers.get('access-control-allow-origin')).toBe('https://pos.example');
	});

	test('emits named empty ping frames in the same ID sequence', async () => {
		const response = produce(({ emit }) => { emit('ready', '{}'); }, { ping: 5 });
		const reader = response.body .getReader();
		expect(decoder.decode((await reader.read()).value)).toBe('id: 1\nevent: ready\ndata: {}\n\n');
		expect(decoder.decode((await reader.read()).value)).toBe('id: 2\nevent: ping\ndata: \n\n');
		await reader.cancel();
	});

	test('abort and cancel immediately clean up exactly once and reject later emits', async () => {
		const abort = new AbortController();
		let stops = 0;
		let externalStops = 0;
		let send;
		const response = produce(({ emit }) => { send = emit; return () => { stops++; }; }, {
			signal: abort.signal, onStop: () => { externalStops++; }
		});
		abort.abort();
		expect(stops).toBe(1);
		expect(externalStops).toBe(1);
		expect(send('late', '{}').error).toBeInstanceOf(Error);
		await response.body .cancel();
		expect(stops).toBe(1);
	});

	test('reader cancellation unsubscribes synchronously', async () => {
		let stops = 0;
		const response = produce(() => () => { stops++; });
		await response.body .getReader().cancel();
		expect(stops).toBe(1);
	});

	test('preaborted requests skip subscriptions and release the caller resource', async () => {
		const abort = new AbortController();
		abort.abort();
		let releases = 0;
		const release = () => { releases++; };
		let starts = 0;
		const response = produce(() => { starts++; }, { signal: abort.signal, onStop: release });
		expect(starts).toBe(0);
		expect(await response.text()).toBe('');
		expect(releases).toBe(1);
	});

	test('runs a late-returned cleanup when start stops or aborts synchronously', async () => {
		for (const mode of ['lock', 'abort']) {
			const abort = new AbortController();
			let stops = 0;
			const response = produce(({ lock }) => {
				if (mode === 'lock') lock.set(false);
				else abort.abort();
				return () => { stops++; };
			}, { signal: abort.signal });
			expect(stops).toBe(1);
			expect(await response.text()).toBe('');
		}
	});

	test('setup failures release resources and error the response', async () => {
		let stops = 0;
		const response = produce(() => { throw new Error('setup failed'); }, { onStop: () => { stops++; } });
		expect(stops).toBe(1);
		await expect(response.text()).rejects.toThrow('setup failed');
	});

	test('invalid emits disconnect and run late cleanup', async () => {
		let stops = 0;
		let emitError;
		const response = produce(({ emit }) => {
			emitError = emit('injected\nevent', '{}').error;
			return () => { stops++; };
		});
		expect(emitError).toBeInstanceOf(Error);
		expect(stops).toBe(1);
		await expect(response.text()).rejects.toThrow();
	});

	test('slow clients cannot accumulate more than the byte budget', async () => {
		let stops = 0;
		let count = 0;
		const response = produce(({ emit }) => {
			while (!emit('update', 'x'.repeat(1024)).error) count++;
			return () => { stops++; };
		});
		expect(count).toBeGreaterThan(1);
		expect(count * 1024).toBeLessThanOrEqual(SSE_MAX_BUFFER_BYTES);
		expect(stops).toBe(1);
		await expect(response.text()).rejects.toThrow('buffer');
	});
});
