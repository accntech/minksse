import { registerProducerCapabilities } from './producer-capabilities.js';
export const SSE_MAX_BUFFER_BYTES = 256 * 1024;
const NON_ASCII = /[^\x00-\x7f]/;
const LINE_BREAKS = /[\r\n]/;
const COMPLEX_DATA = /[\r\n\u0080-\uFFFF]/;
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
function compactString(value) {
    return [' ', value].join('').slice(1);
}
export function produce(start, { signal, ping = 30_000, coalesceBytes = 0, headers, onStop } = {}) {
    let activeBatch;
    let stopped = false;
    let cleanup;
    let interval;
    let controller;
    let id = 1;
    const encoder = new TextEncoder();
    const nativeCapabilities = {};
    let lastEvent;
    let eventBytes = 0;
    let eventSuffix = '';
    let lastData;
    let lastFramedData = '';
    let lastDataBytes = 0;
    let frames = [];
    let head = 0;
    let queuedBytes = 0;
    let bodyEnded = false;
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
    function discardFrames() {
        frames = [];
        head = 0;
        queuedBytes = 0;
    }
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
        catch { }
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
    function runCleanup(fn) {
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
    function emitValue(event, data, stage) {
        if (stopped)
            return new Error('Client disconnected from the stream.');
        const nativeByteLength = nativeCapabilities.byteLength;
        try {
            if (typeof event !== 'string' || typeof data !== 'string') {
                throw new Error('Event name and data must be strings.');
            }
            if (event.length + data.length > SSE_MAX_BUFFER_BYTES) {
                throw new Error('SSE client exceeded the stream buffer limit.');
            }
            if (event !== lastEvent) {
                if (LINE_BREAKS.test(event))
                    throw new Error('Event name must not contain new line characters.');
                eventBytes = nativeByteLength ? nativeByteLength(event) : utf8Length(event);
                lastEvent = compactString(event);
                eventSuffix = `\nevent: ${lastEvent}\ndata: `;
            }
            const idText = String(stage ? stage.nextId : id);
            const nativeQueuedBytes = Math.max(0, -(controller.desiredSize ?? 0));
            const available = SSE_MAX_BUFFER_BYTES - queuedBytes - nativeQueuedBytes - (stage?.bytes ?? 0);
            const direct = !stage && !queuedBytes && nativeQueuedBytes === 0;
            let wireBytes = 21 + idText.length + eventBytes;
            let framedData;
            if (data === lastData) {
                wireBytes += lastDataBytes;
                if (wireBytes > available)
                    throw new Error('SSE client exceeded the stream buffer limit.');
                framedData = lastFramedData;
            }
            else {
                const headerBytes = wireBytes;
                if (wireBytes + data.length > available)
                    throw new Error('SSE client exceeded the stream buffer limit.');
                let multiline = false;
                if (nativeByteLength) {
                    wireBytes += nativeByteLength(data);
                    if (wireBytes > available)
                        throw new Error('SSE client exceeded the stream buffer limit.');
                    let cr = data.indexOf('\r');
                    let lf = data.indexOf('\n');
                    multiline = cr >= 0 || lf >= 0;
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
                }
                else {
                    const simpleData = !COMPLEX_DATA.test(data);
                    if (simpleData)
                        wireBytes += data.length;
                    else {
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
                }
                const owned = direct || stage ? data : compactString(data);
                framedData = multiline ? owned.replace(/\r\n|\r|\n/g, '\ndata: ') : owned;
                if (!stage) {
                    lastData = undefined;
                    lastFramedData = '';
                    if (!direct && owned.length <= 4096 && wireBytes - headerBytes <= 4096) {
                        lastData = owned;
                        lastFramedData = framedData;
                        lastDataBytes = wireBytes - headerBytes;
                    }
                }
            }
            const wire = `id: ${idText}${eventSuffix}${framedData}\n\n`;
            if (eventBytes > 4096) {
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
    function reentrantBatch() {
        const error = new Error('Cannot emit reentrantly while validating an SSE batch.');
        if (activeBatch)
            activeBatch.error = error;
        stop(error);
        return { error };
    }
    function emit(event, data) {
        if (activeBatch && !stopped)
            return reentrantBatch();
        return { error: emitValue(event, data) ?? false };
    }
    function emitBatch(event, values) {
        if (stopped)
            return { error: new Error('Client disconnected from the stream.') };
        if (activeBatch)
            return reentrantBatch();
        const stage = { frames: [], bytes: 0, nextId: id };
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
            for (let index = 0; index < length; index++) {
                const value = values[index];
                if (stopped)
                    return { error: stage.error ?? new Error('SSE stream stopped before batch delivery.') };
                const error = emitValue(event, value, stage);
                if (error)
                    return { error };
            }
            id = stage.nextId;
            const lastFrame = stage.frames[stage.frames.length - 1];
            for (const frame of stage.frames) {
                if (!frame)
                    continue;
                const nativeQueuedBytes = Math.max(0, -(controller.desiredSize ?? 0));
                if (!queuedBytes && nativeQueuedBytes === 0)
                    controller.enqueue(encoder.encode(frame.wire));
                else {
                    const owned = coalesceBytes && frame !== lastFrame ? frame.wire : compactString(frame.wire);
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
        const responseHeaders = new Headers({
            'Cache-Control': 'no-store',
            'Content-Type': 'text/event-stream',
            Connection: 'keep-alive'
        });
        new Headers(headers).forEach((value, key) => responseHeaders.set(key, value));
        const body = new ReadableStream(({
            start(streamController) {
                controller = streamController;
                if (signal?.aborted) {
                    stop();
                    return;
                }
                signal?.addEventListener('abort', abort, { once: true });
                try {
                    cleanup = start({ emit, emitBatch, lock: { set: (value) => {
                                if (!value)
                                    stop();
                            } } });
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
        }), new ByteLengthQueuingStrategy({ highWaterMark: 0 }));
        registerProducerCapabilities(body, nativeCapabilities);
        return new Response(body, { headers: responseHeaders });
    }
    catch (cause) {
        stop(cause instanceof Error ? cause : new Error(String(cause)));
        throw cause;
    }
}
//# sourceMappingURL=server.js.map