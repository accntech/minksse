import { expect, spyOn, test } from 'bun:test';
import { produce, SSE_MAX_BUFFER_BYTES } from '../src/server.js';

const decoder = new TextDecoder();
const expectedWire = (event, values, start = 1) => values.map((value, index) =>
  `id: ${start + index}\nevent: ${event}\ndata: ${value.replace(/\r\n|\r|\n/g, '\ndata: ')}\n\n`
).join('');
const normalized = value => decoder.decode(new TextEncoder().encode(value));
function open(options = {}) {
  let controls;
  let stops = 0;
  const response = produce(value => { controls = value; return () => stops++; }, { coalesceBytes: 16384, ...options });
  return { controls, response, reader: response.body.getReader(), stops: () => stops };
}

const cases = [
  ['first BMP character', 'tick', ['é' + 'x'.repeat(120), 'last']],
  ['rare final BMP character', 'tick', ['first', 'x'.repeat(120) + 'é']],
  ['emoji in a nonfinal member', 'tick', ['first', 'x'.repeat(50) + '😀' + 'y'.repeat(50), 'last']],
  ['lone high surrogate', 'tick', ['first', '\uD800', 'last']],
  ['lone low surrogate', 'tick', ['first', '\uDC00', 'last']],
  ['separate surrogate halves', 'tick', ['\uD800', '\uDC00']],
  ['Unicode event metadata', '更新😀', ['first', 'last']]
];
for (const [name, event, values] of cases) {
  test(`initial bounded Unicode group uses one complete encoding (${name})`, async () => {
    const expected = normalized(expectedWire(event, values));
    const { controls, reader } = open();
    const into = spyOn(TextEncoder.prototype, 'encodeInto');
    const encode = spyOn(TextEncoder.prototype, 'encode');
    try {
      expect(controls.emitBatch(event, values).error).toBe(false);
      expect(into).not.toHaveBeenCalled();
      expect(encode).toHaveBeenCalledTimes(1);
      controls.lock.set(false);
      const first = await reader.read();
      expect(first.value.buffer.byteLength).toBe(first.value.byteLength);
      expect(decoder.decode(first.value)).toBe(expected);
      expect((await reader.read()).done).toBe(true);
    } finally { into.mockRestore(); encode.mockRestore(); await reader.cancel(); reader.releaseLock(); }
  });
}

test('late invalid Unicode batch members reject before either encoding method runs', async () => {
  const { controls, reader, stops } = open();
  const into = spyOn(TextEncoder.prototype, 'encodeInto');
  const encode = spyOn(TextEncoder.prototype, 'encode');
  let laterRead = false;
  const values = ['é😀', 123, 'later'];
  Object.defineProperty(values, 2, { get() { laterRead = true; return 'later'; } });
  try {
    expect(controls.emitBatch('更新', values).error).toBeInstanceOf(Error);
    expect(into).not.toHaveBeenCalled();
    expect(encode).not.toHaveBeenCalled();
    expect(laterRead).toBe(false);
    expect(stops()).toBe(1);
    await expect(reader.read()).rejects.toThrow('strings');
  } finally { into.mockRestore(); encode.mockRestore(); await reader.cancel().catch(() => {}); reader.releaseLock(); }
});

test('Unicode output buffers remain exactly owned after mutation and transfer', async () => {
  const { controls, reader } = open();
  const values = ['😀' + 'é'.repeat(40), '\uD800'];
  const expected = normalized(expectedWire('tick', values, 3));
  try {
    expect(controls.emitBatch('tick', values).error).toBe(false);
    const first = (await reader.read()).value;
    expect(first.buffer.byteLength).toBe(first.byteLength);
    first.fill(0);
    structuredClone(first.buffer, { transfer: [first.buffer] });
    expect(controls.emitBatch('tick', values).error).toBe(false);
    controls.lock.set(false);
    const next = (await reader.read()).value;
    expect(next.buffer.byteLength).toBe(next.byteLength);
    expect(decoder.decode(next)).toBe(expected);
    expect((await reader.read()).done).toBe(true);
  } finally { await reader.cancel(); reader.releaseLock(); }
});

test('missing encodeInto retains complete ASCII and Unicode delivery', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(TextEncoder.prototype, 'encodeInto');
  Object.defineProperty(TextEncoder.prototype, 'encodeInto', { ...descriptor, value: undefined });
  const { controls, reader } = open();
  const encode = spyOn(TextEncoder.prototype, 'encode');
  try {
    expect(controls.emitBatch('tick', ['ASCII']).error).toBe(false);
    expect(decoder.decode((await reader.read()).value)).toBe(expectedWire('tick', ['ASCII']));
    expect(controls.emitBatch('tick', ['é😀']).error).toBe(false);
    controls.lock.set(false);
    expect(decoder.decode((await reader.read()).value)).toBe(expectedWire('tick', ['é😀'], 2));
    expect(encode).toHaveBeenCalledTimes(2);
    expect((await reader.read()).done).toBe(true);
  } finally {
    encode.mockRestore();
    Object.defineProperty(TextEncoder.prototype, 'encodeInto', descriptor);
    await reader.cancel(); reader.releaseLock();
  }
});

for (const extra of [0, 1]) {
  test(`Unicode wire preflight preserves the exact global byte limit plus ${extra}`, async () => {
    const header = new TextEncoder().encode(expectedWire('更新', [''])).length;
    const value = 'é'.repeat(5000) + 'x'.repeat(SSE_MAX_BUFFER_BYTES - header - 10_000 + extra);
    const { controls, response, reader } = open({ coalesceBytes: SSE_MAX_BUFFER_BYTES });
    reader.releaseLock();
    const into = spyOn(TextEncoder.prototype, 'encodeInto');
    const encode = spyOn(TextEncoder.prototype, 'encode');
    try {
      const result = controls.emitBatch('更新', [value]);
      if (extra) {
        expect(result.error).toBeInstanceOf(Error);
        expect(into).not.toHaveBeenCalled();
        expect(encode).not.toHaveBeenCalled();
        await expect(response.text()).rejects.toThrow('buffer');
      } else {
        expect(result.error).toBe(false);
        controls.lock.set(false);
        expect((await response.arrayBuffer()).byteLength).toBe(SSE_MAX_BUFFER_BYTES);
      }
    } finally { into.mockRestore(); encode.mockRestore(); await response.body.cancel().catch(() => {}); }
  });
}

test('steady ASCII groups reuse their response-local encoding strategy', async () => {
  const { controls, reader } = open();
  expect(controls.emitBatch('tick', ['warm']).error).toBe(false);
  await reader.read();
  const regex = spyOn(RegExp.prototype, 'test');
  const into = spyOn(TextEncoder.prototype, 'encodeInto');
  const encode = spyOn(TextEncoder.prototype, 'encode');
  try {
    expect(controls.emitBatch('tick', ['next']).error).toBe(false);
    // Only event-name validation remains; payload classification is amortized.
    expect(regex).toHaveBeenCalledTimes(1);
    expect(into).toHaveBeenCalledTimes(1);
    expect(encode).not.toHaveBeenCalled();
    expect(decoder.decode((await reader.read()).value)).toBe(expectedWire('tick', ['next'], 2));
  } finally { regex.mockRestore(); into.mockRestore(); encode.mockRestore(); await reader.cancel(); reader.releaseLock(); }
});

test('an unexpected Unicode group switches an ASCII stream once without repeating discovery', async () => {
  const { controls, reader } = open();
  expect(controls.emitBatch('tick', ['warm']).error).toBe(false);
  await reader.read();
  const into = spyOn(TextEncoder.prototype, 'encodeInto');
  const encode = spyOn(TextEncoder.prototype, 'encode');
  try {
    const first = ['ASCII prefix', 'x'.repeat(120) + 'é'];
    expect(controls.emitBatch('tick', first).error).toBe(false);
    // Unknown mixed streams may discover Unicode through one partial attempt.
    expect(into).toHaveBeenCalledTimes(1);
    expect(encode).toHaveBeenCalledTimes(1);
    expect(decoder.decode((await reader.read()).value)).toBe(expectedWire('tick', first, 2));
    into.mockClear(); encode.mockClear();
    expect(controls.emitBatch('tick', ['😀later']).error).toBe(false);
    expect(into).not.toHaveBeenCalled();
    expect(encode).toHaveBeenCalledTimes(1);
    expect(decoder.decode((await reader.read()).value)).toBe(expectedWire('tick', ['😀later'], 4));
  } finally { into.mockRestore(); encode.mockRestore(); await reader.cancel(); reader.releaseLock(); }
});

test('Unicode event metadata avoids a discovery attempt after ASCII warmup', async () => {
  const { controls, reader } = open();
  expect(controls.emitBatch('tick', ['warm']).error).toBe(false);
  await reader.read();
  const into = spyOn(TextEncoder.prototype, 'encodeInto');
  const encode = spyOn(TextEncoder.prototype, 'encode');
  try {
    expect(controls.emitBatch('更新😀', ['data']).error).toBe(false);
    expect(into).not.toHaveBeenCalled();
    expect(encode).toHaveBeenCalledTimes(1);
    expect(decoder.decode((await reader.read()).value)).toBe(expectedWire('更新😀', ['data'], 2));
  } finally { into.mockRestore(); encode.mockRestore(); await reader.cancel(); reader.releaseLock(); }
});

test('encoding strategies are isolated between fresh producer responses', async () => {
  const first = open();
  expect(first.controls.emitBatch('tick', ['é']).error).toBe(false);
  await first.reader.read();
  await first.reader.cancel(); first.reader.releaseLock();
  const second = open();
  const into = spyOn(TextEncoder.prototype, 'encodeInto');
  const encode = spyOn(TextEncoder.prototype, 'encode');
  try {
    expect(second.controls.emitBatch('tick', ['ASCII']).error).toBe(false);
    expect(into).toHaveBeenCalledTimes(1);
    expect(encode).not.toHaveBeenCalled();
    expect(decoder.decode((await second.reader.read()).value)).toBe(expectedWire('tick', ['ASCII']));
  } finally { into.mockRestore(); encode.mockRestore(); await second.reader.cancel(); second.reader.releaseLock(); }
});

test('accepted queued Unicode wire teaches the later direct encoding path', async () => {
  const { controls, reader } = open();
  expect(controls.emit('prefetch', 'ASCII').error).toBe(false);
  expect(controls.emitBatch('tick', ['é']).error).toBe(false);
  await reader.read();
  await reader.read();
  const regex = spyOn(RegExp.prototype, 'test');
  const into = spyOn(TextEncoder.prototype, 'encodeInto');
  const encode = spyOn(TextEncoder.prototype, 'encode');
  try {
    expect(controls.emitBatch('tick', ['😀']).error).toBe(false);
    expect(regex).toHaveBeenCalledTimes(1);
    expect(into).not.toHaveBeenCalled();
    expect(encode).toHaveBeenCalledTimes(1);
    expect(decoder.decode((await reader.read()).value)).toBe(expectedWire('tick', ['😀'], 3));
  } finally { regex.mockRestore(); into.mockRestore(); encode.mockRestore(); await reader.cancel(); reader.releaseLock(); }
});

for (const values of [
  ['tail\r', '\nhead'],
  ['é\r\n😀\rlone\uD800\n', '\uDC00\nlast'],
  ['first\r\nsecond', '\n', '\r', 'last']
]) {
  test(`bounded multiline encoding preserves separate Unicode/event boundaries (${JSON.stringify(values)})`, async () => {
    const expected = normalized(expectedWire('更新😀', values));
    const { controls, reader } = open();
    try {
      expect(controls.emitBatch('更新😀', values).error).toBe(false);
      controls.lock.set(false);
      const part = (await reader.read()).value;
      expect(part.buffer.byteLength).toBe(part.byteLength);
      expect(decoder.decode(part)).toBe(expected);
      expect((await reader.read()).done).toBe(true);
    } finally { await reader.cancel(); reader.releaseLock(); }
  });
}

for (const action of ['invalid', 'throw', 'finish', 'abort', 'cancel', 'reenter']) {
  test(`multiline staging has no encoded prefix when a later getter invokes ${action}`, async () => {
    const abort = new AbortController();
    const { controls, reader, stops } = open({ signal: abort.signal });
    const pending = reader.read(); pending.catch(() => {});
    const values = ['é\r\nfirst', 'placeholder'];
    Object.defineProperty(values, 1, { get() {
      if (action === 'invalid') return 123;
      if (action === 'throw') throw Error('late getter');
      if (action === 'finish') controls.lock.set(false);
      if (action === 'abort') abort.abort();
      if (action === 'cancel') void reader.cancel();
      if (action === 'reenter') controls.emit('nested', 'data');
      return 'ignored';
    } });
    const into = spyOn(TextEncoder.prototype, 'encodeInto');
    const encode = spyOn(TextEncoder.prototype, 'encode');
    try {
      expect(controls.emitBatch('tick', values).error).toBeInstanceOf(Error);
      expect(into).not.toHaveBeenCalled();
      expect(encode).not.toHaveBeenCalled();
      expect(stops()).toBe(1);
      if (['finish', 'abort', 'cancel'].includes(action)) expect((await pending).done).toBe(true);
      else await expect(pending).rejects.toThrow();
    } finally { into.mockRestore(); encode.mockRestore(); await reader.cancel().catch(() => {}); reader.releaseLock(); }
  });
}
