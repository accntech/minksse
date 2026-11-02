import { createSseParser } from './parser.js';
/**
 * @typedef {(value: unknown) => unknown} Listener
 * @typedef {{ listener?: Listener }} Subscription
 * @typedef {object} SseConnectionOptions
 * @property {typeof fetch} [fetch]
 * @property {number} [idleTimeoutMs=75000] Recover if no bytes arrive within this duration.
 * @property {() => unknown} [onopen]
 * @property {(event: { connect: () => Promise<void> }) => unknown} [onclose]
 * @property {(cause: unknown) => unknown} [onerror]
 * @typedef {object} RequestState
 * @property {AbortController} controller
 * @property {ReadableStreamDefaultReader<Uint8Array>} [reader]
 * @property {ReturnType<typeof setTimeout>} [idleTimer]
 */

/**
 * One explicitly owned POST stream; reconnect scheduling belongs to the caller.
 * @param {string} url
 * @param {SseConnectionOptions} [options]
 */
export function createSseConnection(url, options = {}) {
    const idleTimeoutMs = options.idleTimeoutMs ?? 75_000;
    if (!Number.isInteger(idleTimeoutMs) || idleTimeoutMs < 1 || idleTimeoutMs > 2_147_483_647) {
        throw new RangeError('idleTimeoutMs must be an integer between 1 and 2147483647');
    }
    /** @type {Map<string, Set<Subscription>>} */
    const listeners = new Map();
    let closed = false;
    /** @type {RequestState | undefined} */
    let active;
    /** @type {Promise<void> | undefined} */
    let running;
    /** @param {unknown} cause */
    function report(cause) {
        /** @param {unknown} error */
        const failed = (error) => console.error('[sse] error observer failed', error);
        try {
            const result = options.onerror?.(cause);
            if (result)
                void Promise.resolve(result).catch(failed);
        }
        catch (error) {
            failed(error);
        }
    }
    /** @param {unknown} result */
    function observe(result) {
        if (result && typeof (/** @type {PromiseLike<unknown>} */ (result)).then === 'function') {
            void Promise.resolve(result).catch(report);
        }
    }
    /** @returns {Promise<void>} */
    function connect() {
        if (closed)
            return Promise.resolve();
        if (running)
            return running;
        /** @type {RequestState} */
        const request = {
            controller: new AbortController(),
            reader: undefined,
            idleTimer: undefined
        };
        active = request;
        let idleDeadline = 0;
        function checkIdleDeadline() {
            const remaining = idleDeadline - performance.now();
            if (remaining > 0) {
                request.idleTimer = setTimeout(checkIdleDeadline, Math.ceil(remaining));
                return;
            }
            request.controller.abort(new Error('Event stream idle timeout'));
            void request.reader?.cancel().catch(() => { });
        }
        function resetIdleDeadline() {
            idleDeadline = performance.now() + idleTimeoutMs;
            if (request.idleTimer === undefined) {
                request.idleTimer = setTimeout(checkIdleDeadline, idleTimeoutMs);
            }
        }
        running = Promise.resolve().then(async () => {
            try {
                if (closed)
                    return;
                resetIdleDeadline();
                const response = await (options.fetch ?? fetch)(url, {
                    method: 'POST',
                    headers: { accept: 'text/event-stream' },
                    cache: 'no-store',
                    signal: request.controller.signal
                });
                if (closed) {
                    void response.body?.cancel().catch(() => { });
                    return;
                }
                if (!response.ok || response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'text/event-stream') {
                    void response.body?.cancel().catch(() => { });
                    throw new Error(`Event stream rejected: ${response.status} ${response.statusText}`);
                }
                if (!response.body)
                    throw new Error('Event stream has no response body');
                request.reader = response.body.getReader();
                const decoder = new TextDecoder();
                const parser = createSseParser(({ event, data }) => {
                    if (closed || !listeners.has(event))
                        return;
                    let value;
                    try {
                        value = event === 'ping' && data === '' ? '' : JSON.parse(data);
                    }
                    catch (cause) {
                        report(cause);
                        return;
                    }
                    const subscribers = listeners.get(event);
                    for (const subscription of [...(subscribers ?? [])]) {
                        if (closed)
                            break;
                        if (!subscribers?.has(subscription))
                            continue;
                        const listener = subscription.listener;
                        if (!listener)
                            continue;
                        try {
                            observe(listener(value));
                        }
                        catch (cause) {
                            report(cause);
                        }
                    }
                });
                try {
                    observe(options.onopen?.());
                }
                catch (cause) {
                    report(cause);
                }
                while (!closed) {
                    const result = await request.reader.read();
                    if (closed || result.done)
                        break;
                    if (result.value.byteLength)
                        resetIdleDeadline();
                    parser.push(decoder.decode(result.value, { stream: true }));
                }
                if (!closed)
                    parser.push(decoder.decode());
            }
            catch (cause) {
                if (!closed && !request.controller.signal.aborted)
                    report(cause);
            }
            finally {
                clearTimeout(request.idleTimer);
                request.controller.abort();
                // An underlying source may never settle cancellation. Recovery must not await it.
                void request.reader?.cancel().catch(() => { });
                request.reader?.releaseLock();
                active = undefined;
                running = undefined;
                if (!closed) {
                    try {
                        observe(options.onclose?.({ connect }));
                    }
                    catch (cause) {
                        report(cause);
                    }
                }
            }
        });
        return running;
    }
    queueMicrotask(() => { if (!closed)
        void connect(); });
    return {
        get closed() { return closed; },
        /**
         * @param {string} name
         * @param {Listener} listener
         */
        subscribe(name, listener) {
            if (closed)
                return () => { };
            const subscribers = listeners.get(name) ?? new Set();
            /** @type {Subscription} */
            const subscription = { listener };
            subscribers.add(subscription);
            listeners.set(name, subscribers);
            let subscribed = true;
            return () => {
                if (!subscribed)
                    return;
                subscribed = false;
                subscription.listener = undefined;
                subscribers.delete(subscription);
                if (!subscribers.size && listeners.get(name) === subscribers)
                    listeners.delete(name);
            };
        },
        close() {
            if (closed)
                return;
            closed = true;
            for (const subscribers of listeners.values()) {
                for (const subscription of subscribers)
                    subscription.listener = undefined;
                subscribers.clear();
            }
            listeners.clear();
            clearTimeout(active?.idleTimer);
            active?.controller.abort();
            void active?.reader?.cancel().catch(() => { });
        }
    };
}

/** @typedef {ReturnType<typeof createSseConnection>} SseConnection */
