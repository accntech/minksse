export const SSE_MAX_BUFFER_BYTES = 256 * 1024;
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
function compactString(value) {
    return (' ' + [value, ''].join('')).slice(1);
}
export function produce(start, { signal, ping = 30_000, coalesceBytes = 0, headers, onStop } = {}) {
    let stopped = false;
    let cleanup;
    let interval;
    let controller;
    let id = 1;
    const encoder = new TextEncoder();
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
            let bytes = frame.bytes;
            let wire = frame.wire;
            if (coalesceBytes > bytes) {
                let parts;
                while (head < frames.length) {
                    const next = frames[head];
                    if (!next || bytes + next.bytes > coalesceBytes)
                        break;
                    (parts ??= [wire]).push(next.wire);
                    bytes += next.bytes;
                    frames[head++] = undefined;
                }
                if (parts)
                    wire = parts.join('');
            }
            queuedBytes -= bytes;
            if (head === frames.length)
                discardFrames();
            else if (head >= 128 && head * 2 >= frames.length) {
                frames = frames.slice(head);
                head = 0;
            }
            try {
                controller.enqueue(encoder.encode(wire));
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
                const owned = direct ? data : compactString(data);
                framedData = multiline ? owned.replace(/\r\n|\r|\n/g, '\ndata: ') : owned;
                lastData = undefined;
                lastFramedData = '';
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
        if (!Number.isInteger(coalesceBytes) || coalesceBytes < 0 || coalesceBytes > SSE_MAX_BUFFER_BYTES) {
            throw new RangeError(`coalesceBytes must be an integer between 0 and ${SSE_MAX_BUFFER_BYTES}`);
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
                    cleanup = start({ emit, lock: { set: (value) => {
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
        }, new ByteLengthQueuingStrategy({ highWaterMark: 0 }));
        return new Response(body, { headers: responseHeaders });
    }
    catch (cause) {
        stop(cause instanceof Error ? cause : new Error(String(cause)));
        throw cause;
    }
}
//# sourceMappingURL=server.js.map