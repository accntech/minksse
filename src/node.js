import { Buffer } from 'node:buffer';
import { nextTick } from 'node:process';
import { claimProducerQueue } from './producer-capabilities.js';

const nativeByteLength = Buffer.byteLength;
const allocateOwned = Buffer.allocUnsafeSlow;
const writeUtf8 = Buffer.prototype.write;
/** @type {import('./producer-capabilities.js').ProducerCapabilities} */
const nodeCapabilities = Object.freeze({
    byteLength: value => nativeByteLength(value, 'utf8'),
    scheduleReady: callback => nextTick(callback),
    encodeOwned(value, bytes) {
        // Exact unpooled storage cannot retain caller string parents or share a
        // slab with later output. The producer already validated this byte size.
        const output = allocateOwned(bytes);
        if (writeUtf8.call(output, value, 0, bytes, 'utf8') !== bytes)
            throw new Error('SSE native output length did not match its validated budget.');
        return output;
    }
});

/**
 * @typedef {object} SseNodeOptions
 * @property {AbortSignal} [signal] Cancels delivery and destroys the unfinished destination.
 */

/**
 * Stream a Web Response to a Node HTTP/1 response without a second stream adapter.
 * Resolves after the destination finishes. Premature close, abort and read/write
 * errors reject and cancel the Web reader. The destination must not have sent headers.
 * Import this helper from `minksse/node`; browser entry points do not load Node code.
 *
 * @param {Response} response
 * @param {import('node:http').ServerResponse} res
 * @param {SseNodeOptions} [options]
 * @returns {Promise<void>}
 */
export async function writeSseResponse(response, res, { signal } = {}) {
    /** @type {ReadableStreamDefaultReader<Uint8Array> | undefined} */
    let reader;
    /** @type {import('./producer-capabilities.js').NativeQueueControl | undefined} */
    let queue;
    /** @type {Promise<unknown> | undefined} */
    let terminalRead;
    /** @type {Error | undefined} */
    let failure;
    let finished = false;
    let ending = false;
    let cancelled = false;
    /** @type {(() => void) | undefined} */
    let wakeDrain;
    /** @type {((error: Error) => void) | undefined} */
    let failNative;
    /** @type {() => void} */
    let wakeFinish = () => {};
    const completion = new Promise(resolve => { wakeFinish = () => resolve(undefined); });
    const aborted = () => new DOMException('SSE destination closed before finishing.', 'AbortError');
    /** @param {unknown} reason */
    function cancel(reason) {
        if (!reader || cancelled)
            return;
        cancelled = true;
        // Cancellation closes pending reads immediately, but an underlying
        // cancel callback may never settle. Do not let that retain the adapter.
        void reader.cancel(reason).catch(() => {});
    }
    /** @param {Error} error */
    function fail(error) {
        if (!failure)
            failure = error;
        cancel(failure);
        failNative?.(failure);
        wakeDrain?.();
        wakeFinish();
    }
    const onFinish = () => {
        if (!ending) {
            fail(aborted());
            return;
        }
        finished = true;
        wakeFinish();
    };
    const onClose = () => { if (!finished && !res.writableFinished) fail(aborted()); };
    /** @param {Error} error */
    const onError = error => { if (!finished && !res.writableFinished) fail(error); };
    const onAbort = () => {
        if (!finished && !res.writableFinished)
            fail(signal?.reason instanceof Error
                ? signal.reason
                : new DOMException('SSE delivery was aborted.', 'AbortError'));
    };
    try {
        const body = response.body;
        reader = body ? new ReadableStreamDefaultReader(body) : undefined;
        res.on('error', onError);
        res.once('finish', onFinish);
        res.once('close', onClose);
        signal?.addEventListener('abort', onAbort, { once: true });
        if (signal?.aborted)
            onAbort();
        else if (res.destroyed || res.writableEnded)
            fail(aborted());
        else if (res.headersSent)
            fail(new Error('SSE destination has already sent headers.'));
        if (failure)
            throw failure;

        if (reader && body)
            queue = claimProducerQueue(body, nodeCapabilities);

        for (const [name, value] of response.headers) {
            if (name !== 'set-cookie')
                res.setHeader(name, value);
        }
        const cookies = response.headers.getSetCookie();
        if (cookies.length)
            res.setHeader('set-cookie', cookies);
        res.writeHead(response.status, response.statusText || undefined);
        // An idle SSE connection must open before its first application event.
        res.flushHeaders();

        while (reader) {
            // Attach only after headers and any earlier byte read/write/drain
            // have completed. The locked Web reader then watches termination;
            // all actual output comes from the same bounded producer queue.
            if (!terminalRead && queue?.tryAttach()) {
                const watch = reader.read();
                terminalRead = watch;
                void watch.then(result => {
                    if (!result.done)
                        fail(new Error('SSE byte delivery continued after native queue attachment.'));
                }, fail);
            }
            if (terminalRead && queue) {
                // One completion promise and one reusable callback per native
                // connection replace a wait promise for every production batch.
                const nativeQueue = queue;
                const watch = terminalRead;
                await new Promise((resolve, reject) => {
                    let settled = false;
                    let running = false;
                    let awaitingTerminal = false;
                    const clearDrain = () => {
                        res.off('drain', ready);
                        if (wakeDrain === ready)
                            wakeDrain = undefined;
                    };
                    /** @param {unknown} cause */
                    const rejectNative = cause => {
                        clearDrain();
                        if (settled)
                            return;
                        settled = true;
                        failNative = undefined;
                        reject(failure ?? (cause instanceof Error ? cause : new Error(String(cause))));
                    };
                    const resolveNative = () => {
                        clearDrain();
                        if (settled)
                            return;
                        if (failure) {
                            rejectNative(failure);
                            return;
                        }
                        settled = true;
                        failNative = undefined;
                        resolve(undefined);
                    };
                    const ready = () => {
                        clearDrain();
                        pump();
                    };
                    const pump = () => {
                        if (settled || running)
                            return;
                        running = true;
                        try {
                            if (failure)
                                throw failure;
                            while (!settled) {
                                const frame = nativeQueue.take();
                                if (!frame) {
                                    if (nativeQueue.isDone()) {
                                        if (!awaitingTerminal) {
                                            awaitingTerminal = true;
                                            void watch.then(resolveNative, rejectNative);
                                        }
                                    }
                                    else
                                        nativeQueue.whenReady(pump);
                                    return;
                                }
                                const writable = res.write(frame.output ?? frame.wire, 'utf8');
                                // A destination can abort or emit an error from
                                // write(). Recheck before waiting or taking more.
                                if (failure)
                                    throw failure;
                                if (!writable) {
                                    wakeDrain = ready;
                                    res.once('drain', ready);
                                    // EventEmitter newListener hooks can fail
                                    // during registration, before once() returns.
                                    if (failure || settled) {
                                        clearDrain();
                                        if (failure)
                                            throw failure;
                                    }
                                    return;
                                }
                            }
                        }
                        catch (cause) {
                            rejectNative(cause);
                        }
                        finally {
                            running = false;
                        }
                    };
                    failNative = rejectNative;
                    pump();
                });
                break;
            }
            const part = await reader.read();
            if (failure)
                throw failure;
            if (part.done)
                break;
            const writable = res.write(part.value);
            if (!writable) {
                await new Promise(resolve => {
                    const ready = () => { res.off('drain', ready); wakeDrain = undefined; resolve(undefined); };
                    wakeDrain = ready;
                    res.once('drain', ready);
                    if (failure)
                        ready();
                });
                if (failure)
                    throw failure;
            }
        }
        if (failure)
            throw failure;
        ending = true;
        res.end();
        await completion;
        if (failure)
            throw failure;
    }
    catch (cause) {
        const error = failure ?? (cause instanceof Error ? cause : new Error(String(cause)));
        cancel(error);
        // Passing an error to destroy() could emit it after our listeners have
        // been released. Rejection carries the original failure to the caller.
        if (!res.destroyed)
            res.destroy();
        throw error;
    }
    finally {
        failNative = undefined;
        queue?.dispose();
        queue = undefined;
        signal?.removeEventListener('abort', onAbort);
        res.off('error', onError);
        res.off('finish', onFinish);
        res.off('close', onClose);
        wakeDrain?.();
        reader?.releaseLock();
    }
}
