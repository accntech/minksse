import { Buffer } from 'node:buffer';
import { claimProducerQueue } from './producer-capabilities.js';
const nativeByteLength = Buffer.byteLength;
const nodeCapabilities = Object.freeze({
    byteLength: value => nativeByteLength(value, 'utf8')
});
export async function writeSseResponse(response, res, { signal } = {}) {
    let reader;
    let queue;
    let terminalRead;
    let failure;
    let finished = false;
    let ending = false;
    let cancelled = false;
    let wakeDrain;
    let wakeFinish = () => { };
    const completion = new Promise(resolve => { wakeFinish = () => resolve(undefined); });
    const aborted = () => new DOMException('SSE destination closed before finishing.', 'AbortError');
    function cancel(reason) {
        if (!reader || cancelled)
            return;
        cancelled = true;
        void reader.cancel(reason).catch(() => { });
    }
    function fail(error) {
        if (!failure)
            failure = error;
        cancel(failure);
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
    const onClose = () => { if (!finished && !res.writableFinished)
        fail(aborted()); };
    const onError = error => { if (!finished && !res.writableFinished)
        fail(error); };
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
        res.flushHeaders();
        while (reader) {
            if (!terminalRead && queue?.tryAttach()) {
                const watch = reader.read();
                terminalRead = watch;
                void watch.then(result => {
                    if (!result.done)
                        fail(new Error('SSE byte delivery continued after native queue attachment.'));
                }, fail);
            }
            let value;
            if (terminalRead && queue) {
                if (failure)
                    throw failure;
                const frame = queue.take();
                if (frame)
                    value = frame.wire;
                else {
                    if (queue.isDone()) {
                        await terminalRead;
                        if (failure)
                            throw failure;
                        break;
                    }
                    await queue.wait();
                    continue;
                }
            }
            else {
                const part = await reader.read();
                if (failure)
                    throw failure;
                if (part.done)
                    break;
                value = part.value;
            }
            const writable = typeof value === 'string' ? res.write(value, 'utf8') : res.write(value);
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
        if (!res.destroyed)
            res.destroy();
        throw error;
    }
    finally {
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
//# sourceMappingURL=node.js.map