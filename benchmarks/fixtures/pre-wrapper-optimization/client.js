/**
 * @typedef {(value: unknown) => unknown} Listener
 * @typedef {{ listener?: Listener }} Subscription
 * @typedef {object} SseConnectionOptions
 * @property {typeof EventSource} [eventSource] Native constructor override for runtimes without a global EventSource.
 * @property {boolean} [withCredentials=false] Include cross-origin credentials.
 * @property {(data: string, event: MessageEvent<string>) => unknown} [decode] Defaults to JSON.parse, except empty ping events.
 * @property {number} [idleTimeoutMs=75000] Recover when no observed event arrives; 0 disables the timer.
 * @property {string} [heartbeatEvent='ping'] Observe this named event even without a subscription.
 * @property {() => unknown} [onopen]
 * @property {(event: { connect: () => Promise<void> }) => unknown} [onclose]
 * @property {(cause: unknown) => unknown} [onerror]
 * @typedef {object} Attempt
 * @property {EventSource | undefined} source
 * @property {Promise<void>} done
 * @property {() => void} resolve
 * @property {ReturnType<typeof setTimeout> | undefined} timer
 * @property {number} deadline
 * @property {Set<string>} names
 * @property {EventListener} receive
 * @property {EventListener} open
 * @property {EventListener} error
 */

/** @param {Event} event @returns {event is MessageEvent<string>} */
function isMessage(event) {
    // Constructor overrides may create events in another Window's realm.
    return 'data' in event && typeof event.data === 'string';
}

/**
 * One owned native GET EventSource; reconnect scheduling belongs to the caller.
 * @param {string} url
 * @param {SseConnectionOptions} [options]
 */
export function createSseConnection(url, options = {}) {
    const idleTimeoutMs = options.idleTimeoutMs ?? 75_000;
    if (!Number.isInteger(idleTimeoutMs) || idleTimeoutMs < 0 || idleTimeoutMs > 2_147_483_647)
        throw new RangeError('idleTimeoutMs must be an integer between 0 and 2147483647');
    const heartbeatEvent = options.heartbeatEvent ?? 'ping';
    const decode = options.decode ?? ((data, event) => event.type === 'ping' && data === '' ? '' : JSON.parse(data));
    /** @type {Map<string, Set<Subscription>>} */
    const listeners = new Map();
    let closed = false;
    /** @type {Attempt | undefined} */
    let active;

    /** @param {unknown} cause */
    function report(cause) {
        /** @param {unknown} error */
        const failed = error => console.error('[sse] error observer failed', error);
        try {
            const result = options.onerror?.(cause);
            if (result) void Promise.resolve(result).catch(failed);
        } catch (error) { failed(error); }
    }
    /** @param {() => unknown} callback */
    function observe(callback) {
        try {
            const result = callback();
            if (result) void Promise.resolve(result).catch(report);
        } catch (cause) { report(cause); }
    }
    /** @param {Attempt} attempt */
    function dispose(attempt) {
        clearTimeout(attempt.timer);
        const source = attempt.source;
        if (source) {
            source.removeEventListener('open', attempt.open);
            source.removeEventListener('error', attempt.error);
            for (const name of attempt.names) source.removeEventListener(name, attempt.receive);
            source.close();
        }
        attempt.names.clear();
        attempt.source = undefined;
        attempt.resolve();
    }
    /** @param {Attempt} attempt @param {unknown} [cause] */
    function finish(attempt, cause) {
        if (active !== attempt) return;
        active = undefined;
        // Close before notifying observers: native automatic retries must never race caller recovery.
        dispose(attempt);
        if (cause !== undefined) report(cause);
        if (!closed) observe(() => options.onclose?.({ connect }));
    }
    /** @param {Attempt} attempt @param {string} name */
    function attach(attempt, name) {
        if (!attempt.names.has(name)) {
            attempt.source?.addEventListener(name, attempt.receive);
            attempt.names.add(name);
        }
    }
    /** @returns {Promise<void>} */
    function connect() {
        if (closed) return Promise.resolve();
        if (active) return active.done;
        /** @type {() => void} */
        let resolve = () => {};
        /** @type {Promise<void>} */
        const done = new Promise(complete => { resolve = complete; });
        /** @type {Attempt} */
        const attempt = { source: undefined, done, resolve, timer: undefined, deadline: 0, names: new Set(), receive, open, error };
        active = attempt;
        function touch() { attempt.deadline = performance.now() + idleTimeoutMs; }
        function checkIdle() {
            if (active !== attempt) return;
            const remaining = attempt.deadline - performance.now();
            if (remaining > 0) attempt.timer = setTimeout(checkIdle, Math.ceil(remaining));
            else finish(attempt);
        }
        /** @param {Event} event */
        function receive(event) {
            if (active !== attempt || !(isMessage(event))) return;
            touch();
            const subscribers = listeners.get(event.type);
            if (!subscribers?.size) return;
            const snapshot = [...subscribers];
            let value;
            try { value = decode(event.data, event); }
            catch (cause) { report(cause); return; }
            for (const subscription of snapshot) {
                if (active !== attempt || closed) break;
                if (subscribers.has(subscription) && subscription.listener)
                    observe(() => subscription.listener?.(value));
            }
        }
        /** @param {Event} event */
        function open(event) {
            if (active !== attempt || isMessage(event)) return;
            touch();
            observe(() => options.onopen?.());
        }
        /** @param {Event} event */
        function error(event) {
            if (!(isMessage(event))) finish(attempt, event);
        }
        try {
            const Source = options.eventSource ?? globalThis.EventSource;
            if (!Source) throw new Error('EventSource is unavailable; provide options.eventSource or use a runtime with native EventSource.');
            attempt.source = new Source(url, { withCredentials: options.withCredentials ?? false });
            attempt.source.addEventListener('open', open);
            attempt.source.addEventListener('error', error);
            for (const name of listeners.keys()) attach(attempt, name);
            attach(attempt, heartbeatEvent);
            if (idleTimeoutMs > 0) {
                touch();
                attempt.timer = setTimeout(checkIdle, idleTimeoutMs);
            }
        } catch (cause) { finish(attempt, cause); }
        return done;
    }
    queueMicrotask(() => { if (!closed) void connect(); });
    return {
        get closed() { return closed; },
        /** @param {string} name @param {Listener} listener */
        subscribe(name, listener) {
            if (closed) return () => {};
            const subscribers = listeners.get(name) ?? new Set();
            /** @type {Subscription} */
            const subscription = { listener };
            subscribers.add(subscription);
            listeners.set(name, subscribers);
            if (active) attach(active, name);
            return () => {
                if (!subscription.listener) return;
                subscription.listener = undefined;
                subscribers.delete(subscription);
                if (!subscribers.size && listeners.get(name) === subscribers) {
                    listeners.delete(name);
                    if (active && name !== heartbeatEvent) {
                        active.source?.removeEventListener(name, active.receive);
                        active.names.delete(name);
                    }
                }
            };
        },
        close() {
            if (closed) return;
            closed = true;
            for (const subscribers of listeners.values()) {
                for (const subscription of subscribers) subscription.listener = undefined;
                subscribers.clear();
            }
            listeners.clear();
            if (active) {
                const attempt = active;
                active = undefined;
                dispose(attempt);
            }
        }
    };
}
/** @typedef {ReturnType<typeof createSseConnection>} SseConnection */
