/**
 * Private, browser-safe producer capabilities. Only the owning Node adapter
 * supplies these; no user-provided counters are accepted by public APIs.
 * @typedef {{ readonly wire: string, readonly bytes: number, readonly output?: Uint8Array }} WireFrame
 * @typedef {object} NativeQueueControl
 * @property {() => boolean} tryAttach Succeeds only after exclusive reader ownership with no pending byte delivery.
 * @property {() => WireFrame | undefined} take Transfers an owned frame exactly once; only legal after attachment.
 * @property {(callback: () => void) => void} whenReady Schedules one consumer callback after output or termination.
 * @property {() => Promise<void>} wait Wakes for queued output or termination, without asserting successful completion.
 * @property {() => boolean} isDone The terminal Web reader determines success versus error.
 * @property {() => void} dispose Idempotently cancels pending output and clears waiters.
 * @typedef {object} ProducerCapabilities
 * @property {(value: string) => number} [byteLength]
 * @property {(value: string, bytes: number) => Uint8Array} [encodeOwned]
 * @property {(callback: () => void) => void} [scheduleReady]
 * @typedef {ProducerCapabilities & { control?: NativeQueueControl }} ProducerState
 */

/** @type {WeakMap<ReadableStream<Uint8Array>, ProducerState>} */
const producers = new WeakMap();

/**
 * @param {ReadableStream<Uint8Array>} body
 * @param {ProducerState} state
 */
export function registerProducerCapabilities(body, state) {
    // Never retain an installer closure: its surrounding producer context can
    // include caller-owned resources even after the stream has completed.
    producers.set(body, state);
}

/**
 * The adapter must acquire the body's reader lock before calling this function.
 * Unrecognized, cloned or transformed bodies keep their generic Web API path.
 * @param {ReadableStream<Uint8Array>} body
 * @param {ProducerCapabilities} capabilities
 * @returns {boolean}
 */
export function installProducerCapabilities(body, capabilities) {
    const state = producers.get(body);
    if (!state || !body.locked)
        return false;
    producers.delete(body);
    state.byteLength = capabilities.byteLength;
    state.encodeOwned = capabilities.encodeOwned;
    state.scheduleReady = capabilities.scheduleReady;
    return true;
}

/**
 * Claim one producer for its terminal Node consumer. The adapter must first
 * capture this exact body and acquire a native reader. Destination callbacks
 * never enter the registry, and producer termination clears unclaimed controls.
 * @param {ReadableStream<Uint8Array>} body
 * @param {ProducerCapabilities} capabilities
 * @returns {NativeQueueControl | undefined}
 */
export function claimProducerQueue(body, capabilities) {
    const state = producers.get(body);
    if (!state || !body.locked)
        return undefined;
    producers.delete(body);
    state.byteLength = capabilities.byteLength;
    state.encodeOwned = capabilities.encodeOwned;
    state.scheduleReady = capabilities.scheduleReady;
    const control = state.control;
    state.control = undefined;
    return control;
}
