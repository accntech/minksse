import { registerProducerCapabilities } from './producer-capabilities.js';

/** Maximum queued SSE bytes per connection. Slow clients disconnect and reconnect normally. */
export const SSE_MAX_BUFFER_BYTES = 256 * 1024;
const NON_ASCII = /[^\x00-\x7f]/;
const LINE_BREAKS = /[\r\n]/;
const COMPLEX_DATA = /[\r\n\u0080-\uFFFF]/;
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
    /** @typedef {{ wire: string, bytes: number, output?: Uint8Array }} Frame */
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
    /** @type {import('./producer-capabilities.js').ProducerState} */
    const nativeCapabilities = {};
    let nativeAttached = false;
    let emittingDepth = 0;
    let webFlushing = false;
    /** @type {Promise<void> | undefined} */
    let nativeWait;
    /** @type {(() => void) | undefined} */
    let resolveNativeWait;
    /** @type {(() => void) | undefined} */
    let nativeReady;
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
        if (tail && !tail.output && tail.bytes + bytes <= coalesceBytes) {
            tail.wire += wire;
            tail.bytes += bytes;
        }
        else {
            if (tail && !tail.output)
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
        if (head === frames.length) {
            if (nativeAttached) {
                // The detached frame belongs to the adapter. Keep the now-empty
                // private array for scalar reuse; a new batch may replace it.
                frames.length = 0;
                head = 0;
                queuedBytes = 0;
            }
            else
                discardFrames();
        }
        else if (head >= 128 && head * 2 >= frames.length) {
            frames = frames.slice(head);
            head = 0;
        }
        return frame;
    }
    function wakeNative() {
        const resolve = resolveNativeWait;
        const ready = nativeReady;
        resolveNativeWait = undefined;
        nativeWait = undefined;
        nativeReady = undefined;
        resolve?.();
        // Delivery remains outside producer acceptance and reentrant getters.
        if (ready)
            (nativeCapabilities.scheduleReady ?? queueMicrotask)(ready);
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
        finally {
            // A retained completed Web body must not retain producer context
            // through the private registry's native queue control closures.
            nativeCapabilities.control = undefined;
            wakeNative();
        }
    }
    function flush() {
        if (nativeAttached || bodyEnded || webFlushing || (controller.desiredSize ?? 0) < 0)
            return;
        webFlushing = true;
        try {
            const frame = popFrame();
            if (frame) {
                try {
                    const chunk = encoder.encode(frame.wire);
                    // tryAttach() also rejects during this synchronous flush.
                    // A scheduled Web pull can never enqueue in native mode.
                    if (!nativeAttached)
                        controller.enqueue(chunk);
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
        if (queuedBytes)
            wakeNative();
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
        const nativeByteLength = nativeCapabilities.byteLength;
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
                eventBytes = nativeByteLength ? nativeByteLength(event) : utf8Length(event);
                lastEvent = compactString(event);
                eventSuffix = ['\nevent: ', lastEvent, '\ndata: '].join('');
            }
            const idText = String(stage ? stage.nextId : id);
            // Account for the one encoded prefetch frame as well as the unencoded backlog.
            const nativeQueuedBytes = stage ? 0 : Math.max(0, -(controller.desiredSize ?? 0));
            let available = stage ? stage.available - stage.bytes : SSE_MAX_BUFFER_BYTES - queuedBytes - nativeQueuedBytes;
            const direct = !nativeAttached && !stage && !queuedBytes && nativeQueuedBytes === 0;
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
                if (nativeByteLength) {
                    wireBytes += nativeByteLength(data);
                    if (wireBytes > available && (!stage || wireBytes > (available = refreshStageBudget(stage))))
                        throw new Error('SSE client exceeded the stream buffer limit.');
                    let cr = data.indexOf('\r');
                    let lf = data.indexOf('\n');
                    multiline = cr >= 0 || lf >= 0;
                    // Raw UTF-8 already includes each CR/LF byte. Normalized
                    // SSE adds six bytes per break, minus one for a CRLF pair.
                    while (cr >= 0 || lf >= 0) {
                        if (cr >= 0 && (lf < 0 || cr < lf)) {
                            const pair = lf === cr + 1;
                            wireBytes += pair ? 5 : 6;
                            if (wireBytes > available && (!stage || wireBytes > (available = refreshStageBudget(stage))))
                                throw new Error('SSE client exceeded the stream buffer limit.');
                            const next = cr + (pair ? 2 : 1);
                            cr = data.indexOf('\r', next);
                            if (pair)
                                lf = data.indexOf('\n', next);
                        }
                        else {
                            wireBytes += 6;
                            if (wireBytes > available && (!stage || wireBytes > (available = refreshStageBudget(stage))))
                                throw new Error('SSE client exceeded the stream buffer limit.');
                            lf = data.indexOf('\n', lf + 1);
                        }
                    }
                }
                else {
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
    /**
     * Native attachment excludes Web prefetch, and activeBatch prevents queue
     * consumption. Keep this fixed budget and per-batch metadata local while
     * validating each getter result before accessing the next array element.
     * @param {string} event
     * @param {readonly string[]} values
     * @param {number} length
     * @param {StagedBatch} stage
     * @param {(value: string) => number} byteLength
     * @returns {Error | undefined}
     */
    function stageNativeBatch(event, values, length, stage, byteLength) {
        let nextId = stage.nextId;
        let bytes = 0;
        let available = stage.available;
        let headerEventBytes = eventBytes;
        let suffix = eventSuffix;
        const eventLength = event.length;
        const cachedData = lastData;
        const cachedFramedData = lastFramedData;
        const cachedDataBytes = lastDataBytes;
        const stagedFrames = stage.frames;
        // These groups cannot escape until the entire atomic batch succeeds.
        // Keep the open group local rather than mutating a tail for each event.
        const willEncode = !queuedBytes && !!nativeCapabilities.encodeOwned;
        let groupWire = '';
        let groupBytes = 0;
        for (let index = 0; index < length; index++) {
            const data = values[index];
            if (stopped)
                return stage.error ?? new Error('SSE stream stopped before batch delivery.');
            if (typeof data !== 'string')
                throw new Error('Event name and data must be strings.');
            if (eventLength + data.length > SSE_MAX_BUFFER_BYTES)
                throw new Error('SSE client exceeded the stream buffer limit.');
            if (index === 0 && event !== lastEvent) {
                headerEventBytes = byteLength(event);
                lastEvent = compactString(event);
                suffix = ['\nevent: ', lastEvent, '\ndata: '].join('');
                eventBytes = headerEventBytes;
                eventSuffix = suffix;
            }
            const idText = String(nextId);
            let wireBytes = 21 + idText.length + headerEventBytes;
            let framedData;
            if (data === cachedData) {
                wireBytes += cachedDataBytes;
                if (wireBytes > available)
                    throw new Error('SSE client exceeded the stream buffer limit.');
                framedData = cachedFramedData;
            }
            else {
                if (wireBytes + data.length > available)
                    throw new Error('SSE client exceeded the stream buffer limit.');
                wireBytes += byteLength(data);
                if (wireBytes > available)
                    throw new Error('SSE client exceeded the stream buffer limit.');
                let cr = data.indexOf('\r');
                let lf = data.indexOf('\n');
                const multiline = cr >= 0 || lf >= 0;
                // Match emitValue's exact normalized UTF-8 accounting: raw
                // bytes already include CR/LF, so add six, or five for CRLF.
                while (cr >= 0 || lf >= 0) {
                    if (cr >= 0 && (lf < 0 || cr < lf)) {
                        const pair = lf === cr + 1;
                        wireBytes += pair ? 5 : 6;
                        if (wireBytes > available)
                            throw new Error('SSE client exceeded the stream buffer limit.');
                        const next = cr + (pair ? 2 : 1);
                        cr = data.indexOf('\r', next);
                        if (pair)
                            lf = data.indexOf('\n', next);
                    }
                    else {
                        wireBytes += 6;
                        if (wireBytes > available)
                            throw new Error('SSE client exceeded the stream buffer limit.');
                        lf = data.indexOf('\n', lf + 1);
                    }
                }
                framedData = multiline ? data.replace(/\r\n|\r|\n/g, '\ndata: ') : data;
            }
            const wire = `id: ${idText}${suffix}${framedData}\n\n`;
            if (!coalesceBytes)
                stagedFrames.push({ wire, bytes: wireBytes });
            else if (groupBytes && groupBytes + wireBytes <= coalesceBytes) {
                groupWire += wire;
                groupBytes += wireBytes;
            }
            else {
                if (groupBytes)
                    stagedFrames.push({ wire: willEncode ? groupWire : compactString(groupWire), bytes: groupBytes });
                groupWire = wire;
                groupBytes = wireBytes;
            }
            available -= wireBytes;
            bytes += wireBytes;
            nextId++;
        }
        if (groupBytes)
            stagedFrames.push({ wire: groupWire, bytes: groupBytes });
        stage.bytes = bytes;
        stage.nextId = nextId;
        return undefined;
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
        let accepted = false;
        emittingDepth++;
        try {
            const error = emitValue(event, data);
            accepted = !error;
            return { error: error ?? false };
        }
        finally {
            emittingDepth--;
            if (accepted && nativeAttached && queuedBytes && !emittingDepth)
                wakeNative();
        }
    }
    /** @param {string} event @param {readonly string[]} values @returns {EmitResult} */
    function emitBatch(event, values) {
        if (stopped)
            return { error: new Error('Client disconnected from the stream.') };
        if (activeBatch)
            return reentrantBatch();
        /** @type {StagedBatch} */
        const stage = { frames: [], bytes: 0, available: 0, nextId: id };
        let committed = false;
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
            const nativeByteLength = nativeAttached ? nativeCapabilities.byteLength : undefined;
            if (nativeByteLength) {
                const error = stageNativeBatch(event, values, length, stage, nativeByteLength);
                if (error)
                    return { error };
            }
            else {
                for (let index = 0; index < length; index++) {
                    const value = values[index];
                    if (stopped)
                        return { error: stage.error ?? new Error('SSE stream stopped before batch delivery.') };
                    const error = emitValue(event, value, stage);
                    if (error)
                        return { error };
                }
            }
            // No live queue, body chunk, or ID was published while reading the
            // array. Getters may abort/cancel/reenter; only a valid batch commits.
            id = stage.nextId;
            if (nativeAttached && !queuedBytes && stage.bytes) {
                // Seal every raw group into owned bytes when Node supports it;
                // otherwise detach the remaining string tail(s). Transfer the
                // validated queue without allocating duplicate frame objects.
                const lastFrame = stage.frames[stage.frames.length - 1];
                const encodeOwned = nativeCapabilities.encodeOwned;
                if (encodeOwned) {
                    // Seal only after every getter and byte bound has passed.
                    // Encoded groups are closed; later output starts a new group.
                    for (const frame of stage.frames) {
                        if (frame) {
                            frame.output = encodeOwned(frame.wire, frame.bytes);
                            frame.wire = '';
                        }
                    }
                }
                else if (coalesceBytes) {
                    if (lastFrame)
                        lastFrame.wire = compactString(lastFrame.wire);
                }
                else {
                    for (const frame of stage.frames) {
                        if (frame)
                            frame.wire = compactString(frame.wire);
                    }
                }
                frames = stage.frames;
                head = 0;
                queuedBytes = stage.bytes;
            }
            else {
                const lastFrame = stage.frames[stage.frames.length - 1];
                for (const frame of stage.frames) {
                    if (!frame)
                        continue;
                    const nativeQueuedBytes = Math.max(0, -(controller.desiredSize ?? 0));
                    if (!nativeAttached && !queuedBytes && nativeQueuedBytes === 0)
                        controller.enqueue(encoder.encode(frame.wire));
                    else {
                        // Closed positive-target groups were already compacted by
                        // queueFrame. Copy a still-raw final group (or each scalar
                        // group with coalescing off) only when live storage retains it.
                        const owned = coalesceBytes && frame !== lastFrame ? frame.wire : compactString(frame.wire);
                        queueFrame(frames, owned, frame.bytes);
                        queuedBytes += frame.bytes;
                    }
                }
            }
            committed = true;
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
            if (committed && nativeAttached && queuedBytes)
                wakeNative();
        }
    }
    // Construct the control before ReadableStream.start(): synchronous finish,
    // abort or setup failure must clear it before the body is registered.
    nativeCapabilities.control = {
        tryAttach() {
            if (nativeAttached || bodyEnded || activeBatch || emittingDepth || webFlushing ||
                (controller.desiredSize ?? 0) < 0)
                return false;
            nativeAttached = true;
            return true;
        },
        take() {
            if (!nativeAttached || bodyEnded || activeBatch || emittingDepth || webFlushing)
                return undefined;
            const frame = popFrame();
            if (stopped && !queuedBytes)
                endBody();
            return frame;
        },
        whenReady(callback) {
            if (!nativeAttached || bodyEnded || queuedBytes)
                (nativeCapabilities.scheduleReady ?? queueMicrotask)(callback);
            else
                nativeReady = callback;
        },
        wait() {
            if (!nativeAttached || bodyEnded || queuedBytes)
                return Promise.resolve();
            if (!nativeWait) {
                nativeWait = new Promise(resolve => { resolveNativeWait = resolve; });
            }
            return nativeWait;
        },
        isDone() { return bodyEnded; },
        dispose() { cancelBody(); }
    };
    try {
        if (!Number.isInteger(ping) || ping < 1 || ping > 2_147_483_647) {
            throw new RangeError('ping must be an integer between 1 and 2147483647');
        }
        if (!Number.isInteger(coalesceBytes) || coalesceBytes < 0 || coalesceBytes > SSE_MAX_BUFFER_BYTES) {
            throw new RangeError(`coalesceBytes must be an integer between 0 and ${SSE_MAX_BUFFER_BYTES}`);
        }
        const responseHeaders = new Headers({
            'Cache-Control': 'no-store',
            'Content-Type': 'text/event-stream',
            Connection: 'keep-alive'
        });
        new Headers(headers).forEach((value, key) => responseHeaders.set(key, value));
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
        registerProducerCapabilities(body, nativeCapabilities);
        return new Response(body, { headers: responseHeaders });
    }
    catch (cause) {
        stop(cause instanceof Error ? cause : new Error(String(cause)));
        throw cause;
    }
}
