import { parentPort, workerData, threadId } from 'node:worker_threads';
import { measureClients } from './harness.mjs';

// This module runs only in a loader thread. Keeping the thread alive across
// passes preserves fetch pools and runtime warmup before the measured pass.
parentPort.on('message', async message => {
  if (message.type !== 'measure') return;
  try {
    const sample = await measureClients(message.url, workerData.options);
    parentPort.postMessage({ type: 'sample', id: message.id, sample, threadId });
  } catch (cause) {
    parentPort.postMessage({ type: 'failure', id: message.id,
      error: cause instanceof Error ? cause.message : String(cause) });
  }
});
parentPort.postMessage({ type: 'ready', threadId });
