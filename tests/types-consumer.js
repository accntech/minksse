/** Compile-only consumer of the built public declarations. */
import { createSseConnection, createSseParser, produce, SSE_MAX_BUFFER_BYTES } from 'minksse';
/**
 * @typedef {import('minksse/client').SseConnection} SseConnection
 * @typedef {import('minksse/client').SseConnectionOptions} SseConnectionOptions
 * @typedef {import('minksse/parser').SseMessage} SseMessage
 * @typedef {import('minksse/server').SseStreamControls} SseStreamControls
 * @typedef {import('minksse/server').SseStreamOptions} SseStreamOptions
 * @typedef {import('minksse').SseConnection} RootConnection
 * @typedef {import('minksse').SseConnectionOptions} RootConnectionOptions
 * @typedef {import('minksse').SseMessage} RootMessage
 * @typedef {import('minksse').SseStreamControls} RootControls
 * @typedef {import('minksse').SseStreamOptions} RootStreamOptions
 */

// Root and subpath imports must expose the same public types.
/**
 * @template {true} T
 * @typedef {T} Assert
 */
/**
 * @template A, B
 * @typedef {(<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false} Equal
 */
/**
 * @typedef {[
 *   Assert<Equal<RootConnection, SseConnection>>,
 *   Assert<Equal<RootConnectionOptions, SseConnectionOptions>>,
 *   Assert<Equal<RootMessage, SseMessage>>,
 *   Assert<Equal<RootControls, SseStreamControls>>,
 *   Assert<Equal<RootStreamOptions, SseStreamOptions>>
 * ]} PublicTypeParity
 */

// Negative cases catch declarations that silently widen to any.
/** @type {SseConnectionOptions} */
// @ts-expect-error The idle timeout remains numeric.
const invalidOptions = { idleTimeoutMs: '75000' };
// @ts-expect-error Parser callbacks receive strings, not numbers.
createSseParser((/** @type {{ data: number }} */ message) => message.data);
// @ts-expect-error Emit continues to require string data.
produce(controls => { controls.emit('tick', 123); });

/** @type {SseConnectionOptions} */
const options = { idleTimeoutMs: 75_000 };
/** @type {SseConnection} */
const connection = createSseConnection('/events', options);
/** @type {() => void} */
const unsubscribe = connection.subscribe('tick', (/** @type {unknown} */ value) => value);
unsubscribe();
connection.close();
createSseParser((/** @type {SseMessage} */ message) => message.id);
/** @type {SseStreamOptions} */
const streamOptions = { ping: 30_000 };
/** @type {Response} */
const response = produce((/** @type {SseStreamControls} */ controls) => {
  /** @type {{ error?: Error | false }} */
  const result = controls.emit('limit', String(SSE_MAX_BUFFER_BYTES));
  controls.lock.set(false);
  return () => result;
}, streamOptions);
void response;
