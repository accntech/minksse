import { Buffer } from 'node:buffer';
import { installProducerCapabilities } from './producer-capabilities.js';
const nativeByteLength = Buffer.byteLength;
const nodeCapabilities = Object.freeze({
    byteLength: value => nativeByteLength(value, 'utf8')
});
export async function writeSseResponse(response, res, { signal } = {}) {
    let reader;
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
        reader = response.body?.getReader();
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
        if (reader && response.body)
            installProducerCapabilities(response.body, nodeCapabilities);
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
            const { done, value } = await reader.read();
            if (failure)
                throw failure;
            if (done)
                break;
            if (!res.write(value)) {
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
        signal?.removeEventListener('abort', onAbort);
        res.off('error', onError);
        res.off('finish', onFinish);
        res.off('close', onClose);
        wakeDrain?.();
        reader?.releaseLock();
    }
}
//# sourceMappingURL=node.js.map