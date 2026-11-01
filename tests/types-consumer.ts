/** Compile-only consumer of the built public declarations. */
import { createSseConnection, createSseParser, produce, SSE_MAX_BUFFER_BYTES } from 'minksse';
import type { SseConnection, SseConnectionOptions } from 'minksse/client';
import type { SseMessage } from 'minksse/parser';
import type { SseStreamControls, SseStreamOptions } from 'minksse/server';
import type {
  SseConnection as RootConnection,
  SseConnectionOptions as RootConnectionOptions,
  SseMessage as RootMessage,
  SseStreamControls as RootControls,
  SseStreamOptions as RootStreamOptions
} from 'minksse';

// Both import paths must keep the same public contracts after JS declaration generation.
type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type PublicTypeParity = [
  Assert<Equal<RootConnection, SseConnection>>,
  Assert<Equal<RootConnectionOptions, SseConnectionOptions>>,
  Assert<Equal<RootMessage, SseMessage>>,
  Assert<Equal<RootControls, SseStreamControls>>,
  Assert<Equal<RootStreamOptions, SseStreamOptions>>
];

// Negative cases catch declarations that silently widen to any during migration.
// @ts-expect-error The idle timeout remains numeric.
const invalidOptions: SseConnectionOptions = { idleTimeoutMs: '75000' };
// @ts-expect-error Parser callbacks receive strings, not numbers.
createSseParser((message: { data: number }) => message.data);
// @ts-expect-error Emit continues to require string data.
produce(controls => { controls.emit('tick', 123); });

const options: SseConnectionOptions = { idleTimeoutMs: 75_000 };
const connection: SseConnection = createSseConnection('/events', options);
const unsubscribe: () => void = connection.subscribe('tick', (value: unknown) => value);
unsubscribe();
connection.close();
createSseParser((message: SseMessage) => message.id);
const streamOptions: SseStreamOptions = { ping: 30_000 };
const response: Response = produce((controls: SseStreamControls) => {
  const result: { error?: Error | false } = controls.emit('limit', String(SSE_MAX_BUFFER_BYTES));
  controls.lock.set(false);
  return () => result;
}, streamOptions);
void response;
