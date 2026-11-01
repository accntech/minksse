/** Maximum queued SSE bytes per connection. Slow clients disconnect and reconnect normally. */
export const SSE_MAX_BUFFER_BYTES = 256 * 1024;
/**
 * @typedef {{ error?: Error | false }} EmitResult
 * @typedef {object} SseStreamControls
 * @property {(event: string, data: string) => EmitResult} emit
 * @property {{ set(value: boolean): void }} lock
 * @typedef {object} SseStreamOptions
 * @property {AbortSignal} [signal]
 * @property {number} [ping=30000]
 * @property {HeadersInit} [headers]
 * @property {() => unknown} [onStop] Runs on every terminal path, including failed setup.
 */

/**
 * UTF-8 length without allocating an encoded copy; lone surrogates encode as U+FFFD.
 * @param {string} value
 * @returns {number}
 */
function utf8Length(value) {
    if (!/[^\x00-\x7f]/.test(value))
        return value.length;
    let bytes = 0;
    for (let index = 0; index < value.length; index++) {
        const code = value.charCodeAt(index);
        if (code < 0x80)
            bytes++;
        else if (code < 0x800)
            bytes += 2;
        else if (code >= 0xD800 && code <= 0xDBFF &&
            value.charCodeAt(index + 1) >= 0xDC00 && value.charCodeAt(index + 1) <= 0xDFFF) {
            bytes += 4;
            index++;
        }
        else
            bytes += 3;
    }
    return bytes;
}
/** Detach small slices from potentially large caller-owned backing strings.
 * The combined join/slice avoids retained parents on both V8 and JavaScriptCore.
 * @param {string} value
 * @returns {string}
 */
function compactString(value) {
    return (' ' + [value, ''].join('')).slice(1);
}
/**
 * Produce an SSE Response using only native Web APIs.
 * @param {(controls: SseStreamControls) => void | (() => unknown)} start
 * @param {SseStreamOptions} [options]
 * @returns {Response}
 */
export function produce(start, { signal, ping = 30_000, headers, onStop } = {}) {
    let stopped = false;
    /** @type {void | (() => unknown)} */
    let cleanup;
    /** @type {ReturnType<typeof setInterval> | undefined} */
    let interval;
    /** @type {ReadableStreamDefaultController<Uint8Array>} */
    let controller;
    let id = 1;
    const encoder = new TextEncoder();
    /** @type {string | undefined} */
    let lastEvent;
    let eventBytes = 0;
    let eventSuffix = '';
    /** @type {string | undefined} */
    let lastData;
    let lastFramedData = '';
    let lastDataBytes = 0;
    /** @type {Array<{ wire: string, bytes: number } | undefined>} */
    let frames = [];
    let head = 0;
    let queuedBytes = 0;
    let bodyEnded = false;
    function discardFrames() {
        frames = [];
        head = 0;
        queuedBytes = 0;
    }
    /** @param {Error} [error] */
    function endBody(error) {
        if (bodyEnded)
            return;
        bodyEnded = true;
        try {
            if (error)
                controller?.error(error);
            else
                controller?.close();
        }
        catch { /* Reader cancellation already closes the controller. */ }
    }
    function flush() {
        if (bodyEnded || (controller.desiredSize ?? 0) < 0)
            return;
        const frame = frames[head];
        if (frame) {
            frames[head++] = undefined;
            queuedBytes -= frame.bytes;
            if (head === frames.length)
                discardFrames();
            else if (head >= 128 && head * 2 >= frames.length) {
                frames = frames.slice(head);
                head = 0;
            }
            try {
                controller.enqueue(encoder.encode(frame.wire));
            }
            catch (cause) {
                stop(cause instanceof Error ? cause : new Error(String(cause)));
            }
        }
        if (stopped && !queuedBytes)
            endBody();
    }
    /** @param {void | (() => unknown)} fn */
    function runCleanup(fn) {
        /** @param {unknown} cause */
        const failed = (cause) => console.error('[sse] cleanup failed', cause);
        try {
            const result = fn?.();
            if (result)
                void Promise.resolve(result).catch(failed);
        }
        catch (cause) {
            failed(cause);
        }
    }
    /** @param {Error} [error] */
    function stop(error) {
        if (error) {
            discardFrames();
            endBody(error);
        }
        if (stopped)
            return;
        stopped = true;
        lastEvent = undefined;
        eventSuffix = '';
        lastData = undefined;
        lastFramedData = '';
        if (interval !== undefined)
            clearInterval(interval);
        signal?.removeEventListener('abort', abort);
        if (!queuedBytes)
            endBody();
        const pendingCleanup = cleanup;
        cleanup = undefined;
        runCleanup(pendingCleanup);
        runCleanup(onStop);
    }
    function abort() {
        stop();
    }
    /**
     * @param {string} event
     * @param {string} data
     * @returns {EmitResult}
     */
    function emit(event, data) {
        if (stopped)
            return { error: new Error('Client disconnected from the stream.') };
        try {
            if (typeof event !== 'string' || typeof data !== 'string') {
                throw new Error('Event name and data must be strings.');
            }
            if (event.length + data.length > SSE_MAX_BUFFER_BYTES) {
                throw new Error('SSE client exceeded the stream buffer limit.');
            }
            if (event !== lastEvent) {
                if (/[\r\n]/.test(event))
                    throw new Error('Event name must not contain new line characters.');
                eventBytes = utf8Length(event);
                lastEvent = compactString(event);
                eventSuffix = `\nevent: ${lastEvent}\ndata: `;
            }
            const idText = String(id);
            // Account for the one encoded prefetch frame as well as the unencoded backlog.
            const nativeQueuedBytes = Math.max(0, -(controller.desiredSize ?? 0));
            const available = SSE_MAX_BUFFER_BYTES - queuedBytes - nativeQueuedBytes;
            const direct = !queuedBytes && nativeQueuedBytes === 0;
            let wireBytes = 21 + idText.length + eventBytes;
            let framedData;
            if (data === lastData) {
                wireBytes += lastDataBytes;
                if (wireBytes > available)
                    throw new Error('SSE client exceeded the stream buffer limit.');
                framedData = lastFramedData;
            }
            else {
                const simpleData = !/[\r\n\u0080-\uFFFF]/.test(data);
                const headerBytes = wireBytes;
                if (wireBytes + data.length > available)
                    throw new Error('SSE client exceeded the stream buffer limit.');
                let multiline = false;
                if (simpleData)
                    wireBytes += data.length;
                else {
                    // Count UTF-8 and normalized line prefixes without expanded strings.
                    for (let index = 0; index < data.length; index++) {
                        const code = data.charCodeAt(index);
                        if (code === 13 || code === 10) {
                            multiline = true;
                            wireBytes += 7;
                            if (code === 13 && data.charCodeAt(index + 1) === 10)
                                index++;
                        }
                        else if (code < 0x80)
                            wireBytes++;
                        else if (code < 0x800)
                            wireBytes += 2;
                        else if (code >= 0xD800 && code <= 0xDBFF &&
                            data.charCodeAt(index + 1) >= 0xDC00 && data.charCodeAt(index + 1) <= 0xDFFF) {
                            wireBytes += 4;
                            index++;
                        }
                        else
                            wireBytes += 3;
                        if (wireBytes > available)
                            throw new Error('SSE client exceeded the stream buffer limit.');
                    }
                }
                // Immediate delivery retains no string. Queued payloads must own compact storage.
                const owned = direct ? data : compactString(data);
                framedData = multiline ? owned.replace(/\r\n|\r|\n/g, '\ndata: ') : owned;
                lastData = undefined;
                lastFramedData = '';
                // One small immutable entry helps repeated events without growing per-stream caches.
                if (!direct && owned.length <= 4096 && wireBytes - headerBytes <= 4096) {
                    lastData = owned;
                    lastFramedData = framedData;
                    lastDataBytes = wireBytes - headerBytes;
                }
            }
            const wire = `id: ${idText}${eventSuffix}${framedData}\n\n`;
            if (eventBytes > 4096) {
                lastEvent = undefined;
                eventSuffix = '';
                eventBytes = 0;
            }
            if (direct) {
                controller.enqueue(encoder.encode(wire));
            }
            else {
                frames.push({ wire, bytes: wireBytes });
                queuedBytes += wireBytes;
            }
            id++;
            return { error: false };
        }
        catch (cause) {
            const error = cause instanceof Error ? cause : new Error(String(cause));
            stop(error);
            return { error };
        }
    }
    try {
        if (!Number.isInteger(ping) || ping < 1 || ping > 2_147_483_647) {
            throw new RangeError('ping must be an integer between 1 and 2147483647');
        }
        const responseHeaders = new Headers({
            'Cache-Control': 'no-store',
            'Content-Type': 'text/event-stream',
            Connection: 'keep-alive'
        });
        new Headers(headers).forEach((value, key) => responseHeaders.set(key, value));
        const body = new ReadableStream({
            start(streamController) {
                controller = streamController;
                if (signal?.aborted) {
                    stop();
                    return;
                }
                signal?.addEventListener('abort', abort, { once: true });
                try {
                    cleanup = start({ emit, lock: { set: (value) => { if (!value)
                                stop(); } } });
                    if (stopped) {
                        const pendingCleanup = cleanup;
                        cleanup = undefined;
                        runCleanup(pendingCleanup);
                    }
                    else {
                        interval = setInterval(() => { emit('ping', ''); }, ping);
                    }
                }
                catch (cause) {
                    stop(cause instanceof Error ? cause : new Error(String(cause)));
                }
            },
            pull() { flush(); },
            cancel() { discardFrames(); bodyEnded = true; stop(); }
        }, new ByteLengthQueuingStrategy({ highWaterMark: 0 }));
        return new Response(body, { headers: responseHeaders });
    }
    catch (cause) {
        stop(cause instanceof Error ? cause : new Error(String(cause)));
        throw cause;
    }
}
