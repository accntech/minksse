/** Maximum queued SSE bytes per connection. Slow clients disconnect and reconnect normally. */
export const SSE_MAX_BUFFER_BYTES = 256 * 1024;
const NON_ASCII = /[^\x00-\x7f]/;
const LINE_BREAKS = /[\r\n]/;
const COMPLEX_DATA = /[\r\n\u0080-\uFFFF]/;
const DEFAULT_HEADERS = {
    'Cache-Control': 'no-store',
    'Content-Type': 'text/event-stream',
    Connection: 'keep-alive'
};
/**
 * @typedef {{ error?: Error | false }} EmitResult
 * @typedef {object} SseStreamControls
 * @property {(event: string, data: string) => EmitResult} emit
 * @property {(event: string, values: readonly string[]) => EmitResult} emitBatch Validates an entire synchronously available batch before publishing frames.
 * @property {{ set(value: boolean): void }} lock
 * @typedef {object} SseStreamOptions
 * @property {AbortSignal} [signal]
 * @property {number} [ping=30000]
 * @property {number} [coalesceBytes=0] Target bytes per queued output chunk; 0 disables coalescing. A single larger event remains whole.
 * @property {HeadersInit} [headers]
 * @property {() => unknown} [onStop] Runs on every terminal path, including failed setup.
 */

/**
 * UTF-8 length without allocating an encoded copy; lone surrogates encode as U+FFFD.
 * @param {string} value
 * @returns {number}
 */
function utf8Length(value) {
    if (!NON_ASCII.test(value))
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
 * @param {string} value
 * @returns {string}
 */
function compactString(value) {
    return [' ', value].join('').slice(1);
}

/**
 * Produce an SSE Response using only native Web APIs.
 * @param {(controls: SseStreamControls) => void | (() => unknown)} start
 * @param {SseStreamOptions} [options]
 * @returns {Response}
 */
export function produce(start, { signal, ping = 30_000, coalesceBytes = 0, headers, onStop } = {}) {
    /** @typedef {{ wire: string, bytes: number }} Frame */
    /** @typedef {{ frames: Array<Frame | undefined>, bytes: number, available: number, nextId: number, error?: Error }} StagedBatch */
    /** @type {StagedBatch | undefined} */
    let activeBatch;
    let stopped = false;
    /** @type {void | (() => unknown)} */
    let cleanup;
    /** @type {ReturnType<typeof setInterval> | undefined} */
    let interval;
    /** @type {ReadableStreamDefaultController<Uint8Array>} */
    let controller;
    let id = 1;
    const encoder = new TextEncoder();
    // 0: unclassified, 1: ASCII so far, 2: Unicode observed in this response.
    let encodingMode = 0;
    let webFlushing = false;
    /** @type {string | undefined} */
    let lastEvent;
    let eventBytes = 0;
    let eventSuffix = '';
    /** @type {string | undefined} */
    let lastData;
    let lastFramedData = '';
    let lastDataBytes = 0;
    /** @type {Array<Frame | undefined>} */
    let frames = [];
    let head = 0;
    let queuedBytes = 0;
    let bodyEnded = false;
    /**
     * @param {Array<Frame | undefined>} queue
     * @param {string} wire
     * @param {number} bytes
     */
    function queueFrame(queue, wire, bytes) {
        const tail = coalesceBytes ? queue[queue.length - 1] : undefined;
        if (tail && tail.bytes + bytes <= coalesceBytes) {
            tail.wire += wire;
            tail.bytes += bytes;
        }
        else {
            if (tail)
                tail.wire = compactString(tail.wire);
            queue.push({ wire, bytes });
        }
    }
    /**
     * Staging cannot add live output. A value getter may consume earlier output,
     * so a cached budget is conservative; refresh only before rejecting a value.
     * @param {StagedBatch} stage
     * @returns {number}
     */
    function refreshStageBudget(stage) {
        stage.available = SSE_MAX_BUFFER_BYTES - queuedBytes - Math.max(0, -(controller.desiredSize ?? 0));
        return stage.available - stage.bytes;
    }
    function discardFrames() {
        frames = [];
        head = 0;
        queuedBytes = 0;
    }
    /** @returns {Frame | undefined} */
    function popFrame() {
        const frame = frames[head];
        if (!frame)
            return undefined;
        frames[head++] = undefined;
        queuedBytes -= frame.bytes;
        if (head === frames.length)
            discardFrames();
        else if (head >= 128 && head * 2 >= frames.length) {
            frames = frames.slice(head);
            head = 0;
        }
        return frame;
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
        if (!queuedBytes || bodyEnded || webFlushing || (controller.desiredSize ?? 0) < 0)
            return;
        webFlushing = true;
        try {
            const frame = popFrame();
            if (frame) {
                try {
                    if (frame.bytes > frame.wire.length) encodingMode = 2;
                    controller.enqueue(encoder.encode(frame.wire));
                }
                catch (cause) {
                    stop(cause instanceof Error ? cause : new Error(String(cause)));
                }
            }
            if (stopped && !queuedBytes)
                endBody();
        }
        finally {
            webFlushing = false;
        }
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
    function cancelBody() {
        discardFrames();
        endBody();
        stop();
    }
    /**
     * @param {string} event
     * @param {string} data
     * @param {StagedBatch} [stage]
     * @returns {Error | undefined}
     */
    function emitValue(event, data, stage) {
        if (stopped)
            return new Error('Client disconnected from the stream.');
        try {
            if (typeof data !== 'string' || (!stage && typeof event !== 'string')) {
                throw new Error('Event name and data must be strings.');
            }
            if (event.length + data.length > SSE_MAX_BUFFER_BYTES) {
                throw new Error('SSE client exceeded the stream buffer limit.');
            }
            if ((!stage || stage.bytes === 0) && event !== lastEvent) {
                if (LINE_BREAKS.test(event))
                    throw new Error('Event name must not contain new line characters.');
                eventBytes = utf8Length(event);
                lastEvent = compactString(event);
                eventSuffix = ['\nevent: ', lastEvent, '\ndata: '].join('');
            }
            const idText = String(stage ? stage.nextId : id);
            // Account for the one encoded prefetch frame as well as the unencoded backlog.
            const prefetchedBytes = stage ? 0 : Math.max(0, -(controller.desiredSize ?? 0));
            let available = stage ? stage.available - stage.bytes : SSE_MAX_BUFFER_BYTES - queuedBytes - prefetchedBytes;
            const direct = !stage && !queuedBytes && prefetchedBytes === 0;
            let wireBytes = 21 + idText.length + eventBytes;
            let framedData;
            if (data === lastData) {
                wireBytes += lastDataBytes;
                if (wireBytes > available && (!stage || wireBytes > (available = refreshStageBudget(stage))))
                    throw new Error('SSE client exceeded the stream buffer limit.');
                framedData = lastFramedData;
            }
            else {
                const headerBytes = wireBytes;
                if (wireBytes + data.length > available && (!stage || wireBytes + data.length > (available = refreshStageBudget(stage))))
                    throw new Error('SSE client exceeded the stream buffer limit.');
                let multiline = false;
                const simpleData = !COMPLEX_DATA.test(data);
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
                        if (wireBytes > available && (!stage || wireBytes > (available = refreshStageBudget(stage))))
                            throw new Error('SSE client exceeded the stream buffer limit.');
                    }
                }
                // Immediate delivery and isolated batch staging retain no raw
                // payload after return. Live queued scalar payloads must own
                // compact storage; batch groups acquire ownership on commit.
                const owned = direct || stage ? data : compactString(data);
                framedData = multiline ? owned.replace(/\r\n|\r|\n/g, '\ndata: ') : owned;
                // Never install a raw staged slice in the retained scalar cache.
                if (!stage) {
                    lastData = undefined;
                    lastFramedData = '';
                    // One small immutable entry helps repeated events without growing per-stream caches.
                    if (!direct && owned.length <= 4096 && wireBytes - headerBytes <= 4096) {
                        lastData = owned;
                        lastFramedData = framedData;
                        lastDataBytes = wireBytes - headerBytes;
                    }
                }
            }
            const wire = `id: ${idText}${eventSuffix}${framedData}\n\n`;
            if (!stage && eventBytes > 4096) {
                lastEvent = undefined;
                eventSuffix = '';
                eventBytes = 0;
            }
            if (stage) {
                queueFrame(stage.frames, wire, wireBytes);
                stage.bytes += wireBytes;
                stage.nextId++;
            }
            else if (direct) {
                controller.enqueue(encoder.encode(wire));
            }
            else {
                queueFrame(frames, wire, wireBytes);
                queuedBytes += wireBytes;
            }
            if (!stage)
                id++;
            return undefined;
        }
        catch (cause) {
            const error = cause instanceof Error ? cause : new Error(String(cause));
            if (stage)
                stage.error = error;
            stop(error);
            return error;
        }
    }
    /** @returns {EmitResult} */
    function reentrantBatch() {
        const error = new Error('Cannot emit reentrantly while validating an SSE batch.');
        if (activeBatch)
            activeBatch.error = error;
        stop(error);
        return { error };
    }
    /** @param {string} event @param {string} data @returns {EmitResult} */
    function emit(event, data) {
        if (activeBatch && !stopped)
            return reentrantBatch();
        const error = emitValue(event, data);
        return { error: error ?? false };
    }
    /** @param {string} event @param {readonly string[]} values @returns {EmitResult} */
    function emitBatch(event, values) {
        if (stopped)
            return { error: new Error('Client disconnected from the stream.') };
        if (activeBatch)
            return reentrantBatch();
        /** @type {StagedBatch} */
        const stage = { frames: [], bytes: 0, available: 0, nextId: id };
        activeBatch = stage;
        try {
            if (typeof event !== 'string' || LINE_BREAKS.test(event))
                throw new Error('Event name must be a string without new line characters.');
            if (!Array.isArray(values))
                throw new TypeError('SSE batch values must be an array of strings.');
            const length = values.length;
            if (!Number.isSafeInteger(length) || length < 0)
                throw new RangeError('SSE batch length must be a nonnegative safe integer.');
            if (stopped)
                return { error: stage.error ?? new Error('SSE stream stopped before batch delivery.') };
            if (length)
                refreshStageBudget(stage);
            let suffix = eventSuffix;
            let nameBytes = eventBytes;
            let nextId = id;
            let batchBytes = 0;
            let available = stage.available;
            let groupWire = '';
            let groupBytes = 0;
            // Three UTF-8 bytes per UTF-16 unit is a safe upper bound (pairs
            // use four bytes for two units). A complete framed batch that fits
            // this bound needs no separate payload scan before its one encode.
            let bounded = coalesceBytes > 0 && !queuedBytes && (controller.desiredSize ?? 0) >= 0;
            let upperBytes = 0;
            /** @type {string[]} */
            const captured = [];
            for (let index = 0; index < length; index++) {
                const value = index < captured.length ? captured[index] : values[index];
                if (stopped)
                    return { error: stage.error ?? new Error('SSE stream stopped before batch delivery.') };
                if (typeof value !== 'string')
                    throw new Error('Event name and data must be strings.');
                if (event.length + value.length > SSE_MAX_BUFFER_BYTES)
                    throw new Error('SSE client exceeded the stream buffer limit.');
                if (event !== lastEvent) {
                    eventBytes = utf8Length(event);
                    lastEvent = compactString(event);
                    eventSuffix = ['\nevent: ', lastEvent, '\ndata: '].join('');
                    suffix = eventSuffix;
                    nameBytes = eventBytes;
                }
                if (bounded) {
                    captured.push(value);
                    let wire = `id: ${nextId}${suffix}${value}\n\n`;
                    let bound = upperBytes + wire.length * 3;
                    let cr = value.indexOf('\r');
                    let lf = value.indexOf('\n');
                    if (cr >= 0 || lf >= 0) {
                        // UTF-8 of the raw frame costs at most 3×UTF-16 units.
                        // SSE adds six bytes per CR/LF break (five for CRLF).
                        // Count first; never allocate expanded data until proven safe.
                        if (bound <= coalesceBytes && bound <= available) {
                            while (cr >= 0 || lf >= 0) {
                                bound += 6;
                                if (bound > coalesceBytes || bound > available) break;
                                if (cr >= 0 && (lf < 0 || cr < lf)) {
                                    const pair = lf === cr + 1;
                                    const next = cr + (pair ? 2 : 1);
                                    cr = value.indexOf('\r', next);
                                    if (pair) lf = value.indexOf('\n', next);
                                }
                                else lf = value.indexOf('\n', lf + 1);
                            }
                        }
                        if (bound <= coalesceBytes && bound <= available)
                            wire = `id: ${nextId}${suffix}${value.replace(/\r\n|\r|\n/g, '\ndata: ')}\n\n`;
                    }
                    if (bound <= coalesceBytes && bound <= available) {
                        upperBytes = bound;
                        groupWire += wire;
                        nextId++;
                        continue;
                    }
                    // Resume exact staging from captured values. No user getter
                    // is evaluated twice, and exact overflow is checked before
                    // another value can be read.
                    bounded = false;
                    nextId = id;
                    groupWire = '';
                    index = -1;
                    continue;
                }
                const idText = String(nextId);
                let wireBytes = 21 + idText.length + nameBytes;
                let remaining = available - batchBytes;
                if (wireBytes + value.length > remaining) {
                    stage.bytes = batchBytes;
                    remaining = refreshStageBudget(stage);
                    available = stage.available;
                    if (wireBytes + value.length > remaining)
                        throw new Error('SSE client exceeded the stream buffer limit.');
                }
                let multiline = false;
                if (!COMPLEX_DATA.test(value))
                    wireBytes += value.length;
                else {
                    for (let offset = 0; offset < value.length; offset++) {
                        const code = value.charCodeAt(offset);
                        if (code === 13 || code === 10) {
                            multiline = true;
                            wireBytes += 7;
                            if (code === 13 && value.charCodeAt(offset + 1) === 10) offset++;
                        }
                        else if (code < 0x80) wireBytes++;
                        else if (code < 0x800) wireBytes += 2;
                        else if (code >= 0xD800 && code <= 0xDBFF &&
                            value.charCodeAt(offset + 1) >= 0xDC00 && value.charCodeAt(offset + 1) <= 0xDFFF) {
                            wireBytes += 4;
                            offset++;
                        }
                        else wireBytes += 3;
                        if (wireBytes > remaining) {
                            stage.bytes = batchBytes;
                            remaining = refreshStageBudget(stage);
                            available = stage.available;
                            if (wireBytes > remaining)
                                throw new Error('SSE client exceeded the stream buffer limit.');
                        }
                    }
                }
                const framed = multiline ? value.replace(/\r\n|\r|\n/g, '\ndata: ') : value;
                const wire = `id: ${idText}${suffix}${framed}\n\n`;
                if (groupBytes && (!coalesceBytes || groupBytes + wireBytes > coalesceBytes)) {
                    stage.frames.push({ wire: groupWire, bytes: groupBytes });
                    groupWire = wire;
                    groupBytes = wireBytes;
                }
                else {
                    groupWire += wire;
                    groupBytes += wireBytes;
                }
                batchBytes += wireBytes;
                nextId++;
            }
            if (bounded && length) {
                // Classify once per response. Unicode streams avoid a partial
                // pass; ASCII streams avoid rescanning every completed group.
                let chunk;
                if (typeof encoder.encodeInto === 'function') {
                    if (nameBytes !== event.length) encodingMode = 2;
                    else if (encodingMode === 0)
                        encodingMode = NON_ASCII.test(groupWire) ? 2 : 1;
                    if (encodingMode === 2) chunk = encoder.encode(groupWire);
                    else {
                        const destination = new Uint8Array(groupWire.length);
                        const result = encoder.encodeInto(groupWire, destination);
                        if (result.read === groupWire.length) chunk = destination;
                        else {
                            // An ASCII stream may later contain Unicode. Pay
                            // discovery once, then use complete encodings.
                            encodingMode = 2;
                            chunk = encoder.encode(groupWire);
                        }
                    }
                }
                else chunk = encoder.encode(groupWire);
                controller.enqueue(chunk);
                id = nextId;
                return { error: false };
            }
            if (groupBytes) stage.frames.push({ wire: groupWire, bytes: groupBytes });
            stage.bytes = batchBytes;
            stage.nextId = nextId;
            // No live queue, body chunk, or ID was published while reading the
            // array. Getters may abort/cancel/reenter; only a valid batch commits.
            id = stage.nextId;
            for (const frame of stage.frames) {
                if (!frame)
                    continue;
                if (frame.bytes > frame.wire.length) encodingMode = 2;
                const prefetchedBytes = Math.max(0, -(controller.desiredSize ?? 0));
                if (!queuedBytes && prefetchedBytes === 0)
                    controller.enqueue(encoder.encode(frame.wire));
                else {
                    // Only retained wire groups need ownership copies; staging
                    // that is encoded immediately never retains caller strings.
                    const owned = compactString(frame.wire);
                    queueFrame(frames, owned, frame.bytes);
                    queuedBytes += frame.bytes;
                }
            }
            return { error: false };
        }
        catch (cause) {
            const error = stage.error ?? (cause instanceof Error ? cause : new Error(String(cause)));
            if (!stopped)
                stop(error);
            return { error };
        }
        finally {
            // Large metadata is useful only during this synchronous batch.
            if (eventBytes > 4096) {
                lastEvent = undefined;
                eventSuffix = '';
                eventBytes = 0;
            }
            activeBatch = undefined;
        }
    }
    try {
        if (!Number.isInteger(ping) || ping < 1 || ping > 2_147_483_647) {
            throw new RangeError('ping must be an integer between 1 and 2147483647');
        }
        if (!Number.isInteger(coalesceBytes) || coalesceBytes < 0 || coalesceBytes > SSE_MAX_BUFFER_BYTES) {
            throw new RangeError(`coalesceBytes must be an integer between 0 and ${SSE_MAX_BUFFER_BYTES}`);
        }
        /** @type {HeadersInit} */
        let responseHeaders = DEFAULT_HEADERS;
        if (headers !== undefined) {
            const overrides = new Headers(DEFAULT_HEADERS);
            new Headers(headers).forEach((value, key) => overrides.set(key, value));
            responseHeaders = overrides;
        }
        const body = new ReadableStream(/** @type {UnderlyingDefaultSource<Uint8Array>} */ ({
            start(streamController) {
                controller = streamController;
                if (signal?.aborted) {
                    stop();
                    return;
                }
                signal?.addEventListener('abort', abort, { once: true });
                try {
                    cleanup = start({ emit, emitBatch, lock: { set: (value) => { if (!value)
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
            cancel() { cancelBody(); }
        }), new ByteLengthQueuingStrategy({ highWaterMark: 0 }));
        return new Response(body, { headers: responseHeaders });
    }
    catch (cause) {
        stop(cause instanceof Error ? cause : new Error(String(cause)));
        throw cause;
    }
}
