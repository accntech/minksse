export const targets = ['native', 'hono', 'fastify', 'better-sse', 'sveltekit-sse', 'minksse'];

export function parseOptions(args) {
  const options = { events: 1000, clients: 16, bytes: 128, batch: 16, interval: 0,
    repeats: 5, warmup: 1, timeout: 30000, loaders: 1, payload: 'ascii', targets: [...targets], output: 'results/latest.json', setup: 'optimized', bridge: 'auto', fastify: 'auto', better: 'auto', cork: 'auto', native: 'auto', minkapi: 'auto', coalesce: 'auto', profile: '', minkbuild: '' };
  for (const argument of args) {
    const match = /^--([a-z]+)=(.+)$/.exec(argument);
    if (!match || !(match[1] in options)) throw new Error(`Unknown option: ${argument}; use --name=value`);
    const [, key, value] = match;
    if (['output', 'profile', 'minkbuild'].includes(key)) options[key] = value;
    else if (key === 'coalesce') {
      if (value === 'auto') options.coalesce = value;
      else {
        const number = Number(value);
        if (!Number.isSafeInteger(number) || number < 0 || number > 262144) throw new Error('coalesce must be auto or an integer from 0 through 262144');
        options.coalesce = number;
      }
    }
    else if (['setup', 'bridge', 'fastify', 'better', 'cork', 'native', 'minkapi', 'payload'].includes(key)) {
      const allowed = { payload: ['ascii', 'unicode', 'multiline'], setup: ['baseline', 'optimized'], bridge: ['auto', 'pipeline', 'direct', 'hono-node', 'kit', 'minksse-node'],
        fastify: ['auto', 'send', 'iterable', 'stream'], better: ['auto', 'push', 'batch'], cork: ['auto', 'on', 'off'], native: ['auto', 'write', 'batch'], minkapi: ['auto', 'emit', 'batch'] };
      if (!allowed[key].includes(value)) throw new Error(`Invalid ${key}: ${value}`);
      options[key] = value;
    }
    else if (key === 'targets') {
      options.targets = [...new Set(value.split(','))];
      if (options.targets.some(target => !targets.includes(target))) throw new Error(`Unknown target: ${value}`);
    } else {
      const number = Number(value);
      if (!Number.isSafeInteger(number) || number < (['warmup', 'interval'].includes(key) ? 0 : 1)) {
        throw new Error(`${key} must be a ${['warmup', 'interval'].includes(key) ? 'nonnegative' : 'positive'} safe integer`);
      }
      options[key] = number;
    }
  }
  if (options.loaders > options.clients || options.loaders > 32) throw new Error('loaders must not exceed clients or 32');
  return options;
}

// Payload bytes exclude the JSON envelope and SSE framing in every mode.
export function createPayload(bytes, kind = 'ascii') {
  return kind === 'unicode' ? 'é😀'.repeat(Math.floor(bytes / 6)) + 'x'.repeat(bytes % 6) : 'x'.repeat(bytes);
}

export function serializeData(sequence, payload, kind = 'ascii') {
  if (kind === 'multiline') {
    // JSON whitespace exercises CRLF, standalone CR and LF in package framing.
    return `{\r\n  "sequence": ${sequence},\r  "payload": ${JSON.stringify(payload)}\n}`;
  }
  return JSON.stringify({ sequence, payload });
}

// Independent benchmark validator: no candidate's parser is used to score its server.
export function createValidator(expected, payload) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '';
  let count = 0;
  function parse() {
    let index;
    while ((index = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      let event = 'message';
      let id;
      const data = [];
      for (const line of frame.split('\n')) {
        if (line.startsWith(':') || !line) continue;
        const separator = line.indexOf(':');
        const field = separator === -1 ? line : line.slice(0, separator);
        let value = separator === -1 ? '' : line.slice(separator + 1);
        if (value.startsWith(' ')) value = value.slice(1);
        if (field === 'event') event = value;
        if (field === 'data') data.push(value);
        if (field === 'id') id = value;
      }
      if (!data.length) continue;
      if (event !== 'message') throw new Error(`Unexpected event: ${event}`);
      const value = JSON.parse(data.join('\n'));
      if (count >= expected || value.sequence !== count) throw new Error(`Invalid sequence: expected ${count}, got ${value.sequence}`);
      if (value.payload !== payload) throw new Error(`Corrupted payload at sequence ${count}`);
      if (id !== String(count + 1)) throw new Error(`Invalid ID: expected ${count + 1}, got ${id}`);
      count++;
    }
  }
  return {
    get count() { return count; },
    push(bytes) { buffer += decoder.decode(bytes, { stream: true }); parse(); },
    finish() {
      buffer += decoder.decode();
      parse();
      if (buffer.trim()) throw new Error('Unterminated SSE frame');
      if (count !== expected) throw new Error(`Expected ${expected} events, received ${count}`);
      return count;
    }
  };
}

export function summarize(values) {
  if (!values.length) throw new Error('Cannot summarize no samples');
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  const variance = values.length > 1 ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1) : 0;
  // Two-sided Student-t critical values for df=1..30, normal approximation thereafter.
  const critical = [0, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262,
    2.228, 2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086,
    2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042];
  const margin = (critical[values.length - 1] ?? 1.96) * Math.sqrt(variance / values.length);
  return { count: values.length, mean, median, min: sorted[0], max: sorted.at(-1),
    ci95: values.length > 1 ? [mean - margin, mean + margin] : null };
}

export function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

export function resolveSetup(options, target) {
  const optimized = options.setup === 'optimized';
  const pick = (key, baseline, tuned) => options[key] && options[key] !== 'auto' ? options[key] : optimized ? tuned : baseline;
  const preferredBridge = target === 'hono' ? 'hono-node' : target === 'sveltekit-sse' ? 'kit' : target === 'minksse' ? 'minksse-node' : 'direct';
  return { bridge: pick('bridge', 'pipeline', preferredBridge), fastify: pick('fastify', 'send', 'send'),
    better: pick('better', 'push', 'batch'), cork: pick('cork', 'off', 'off'), native: pick('native', 'write', 'batch'),
    minkApi: pick('minkapi', 'emit', 'batch'),
    coalesceBytes: options.coalesce === undefined || options.coalesce === 'auto' ? optimized ? 16384 : 0 : options.coalesce };
}
