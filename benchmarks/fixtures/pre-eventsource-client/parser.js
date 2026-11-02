/** @typedef {{ event: string, data: string, id: string }} SseMessage */

/**
 * Incremental SSE framing. EOF does not dispatch an unterminated event.
 * @param {(message: SseMessage) => void} dispatch
 * @param {number} [maxFrameSize=1048576] Unicode code-point budget per frame.
 */
export function createSseParser(dispatch, maxFrameSize = 1_048_576) {
    if (!Number.isSafeInteger(maxFrameSize) || maxFrameSize < 1) {
        throw new RangeError('maxFrameSize must be a positive safe integer');
    }
    /** @type {string[]} */
    let parts = [];
    /** @type {string[]} */
    let pending = [];
    let tail = '';
    /** @type {string[]} */
    let data = [];
    let event = '';
    let id = '';
    let skipLf = false;
    let first = true;
    let size = 0;
    let previousHighSurrogate = false;
    /** @param {string} value */
    function append(value) {
        if (!value)
            return;
        pending.push(value);
        // Compact tiny fragments so one-byte input cannot create one retained object per byte.
        if (pending.length === 64) {
            parts.push(pending.join(''));
            pending = [];
        }
    }
    function finishLine() {
        const line = parts.length ? parts.join('') + pending.join('') + tail
            : pending.length ? pending.join('') + tail : tail;
        parts = [];
        pending = [];
        tail = '';
        if (line === '') {
            const message = data.length ? { event: event || 'message', data: data.join('\n'), id } : null;
            data = [];
            event = '';
            size = 0;
            if (message)
                dispatch(message);
        }
        else if (!line.startsWith(':')) {
            const colon = line.indexOf(':');
            const field = colon < 0 ? line : line.slice(0, colon);
            let value = colon < 0 ? '' : line.slice(colon + 1);
            if (value.startsWith(' '))
                value = value.slice(1);
            if (field === 'data')
                data.push(value);
            else if (field === 'event')
                event = value;
            else if (field === 'id' && !value.includes('\0'))
                id = value;
        }
    }
    return {
        /** @param {string} chunk */
        push(chunk) {
            // Tiny ASCII reads need no slicing or general Unicode/segment bookkeeping.
            // Keep append's bounded compaction, including for very long unfinished lines.
            if (chunk.length === 1 && chunk.charCodeAt(0) < 0x80) {
                const code = chunk.charCodeAt(0);
                first = false;
                if (skipLf) {
                    skipLf = false;
                    if (code === 10)
                        return;
                }
                previousHighSurrogate = false;
                if (++size > maxFrameSize)
                    throw new Error('SSE frame exceeds the configured size limit');
                if (code === 13 || code === 10) {
                    finishLine();
                    skipLf = code === 13;
                }
                else {
                    tail += chunk;
                    if (tail.length === 128) {
                        append(tail);
                        tail = '';
                    }
                }
                return;
            }
            if (chunk.length && tail) {
                append(tail);
                tail = '';
            }
            let start = 0;
            if (first && chunk.length) {
                first = false;
                if (chunk.charCodeAt(0) === 0xFEFF)
                    start = 1;
            }
            if (skipLf && start < chunk.length) {
                skipLf = false;
                if (chunk.charCodeAt(start) === 10)
                    start++;
            }
            let segment = start;
            for (let index = start; index < chunk.length; index++) {
                const code = chunk.charCodeAt(index);
                const continuation = previousHighSurrogate && code >= 0xDC00 && code <= 0xDFFF;
                previousHighSurrogate = code >= 0xD800 && code <= 0xDBFF;
                if (!continuation && ++size > maxFrameSize)
                    throw new Error('SSE frame exceeds the configured size limit');
                if (code === 13 || code === 10) {
                    append(chunk.slice(segment, index));
                    finishLine();
                    if (code === 13) {
                        if (chunk.charCodeAt(index + 1) === 10)
                            index++;
                        else if (index + 1 === chunk.length)
                            skipLf = true;
                    }
                    segment = index + 1;
                }
            }
            append(chunk.slice(segment));
        }
    };
}
