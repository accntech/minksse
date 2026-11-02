import { benchmarkCases, benchmarkRows } from './benchmarks.mjs';
import { icon } from "./icons.mjs";
export const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function highlight(text, language) {
  if (!language.includes('TypeScript') && language !== 'JavaScript' && language !== 'Signatures') return escape(text);
  const tokens = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`[^`]*`)|(\/\/[^\n]*)|\b(import|from|export|const|let|new|await|async|function|return|if|else|throw|try|catch|for|of|type|interface|extends|readonly|true|false|null|undefined|void|number|string|boolean)\b|\b(\d+(?:\.\d+)?)\b/g;
  let output = '', position = 0;
  for (const match of text.matchAll(tokens)) {
    output += escape(text.slice(position, match.index));
    const kind = match[1] ? 'string' : match[2] ? 'comment' : match[3] ? 'keyword' : 'number';
    output += `<span class="syntax-${kind}">${escape(match[0])}</span>`;
    position = match.index + match[0].length;
  }
  return output + escape(text.slice(position));
}
export const code = (text, language = 'JavaScript') => `<div class="code-block"><div class="code-heading"><span>${language}</span><button type="button" class="copy" aria-label="Copy code" hidden>${icon('copy')}<span>Copy</span></button></div><pre tabindex="0" aria-label="${language} code"><code>${highlight(text.trim(), language)}</code></pre></div>`;
const note = (title, text) => `<aside class="note">${icon("document-text")}<div><strong>${title}</strong><p>${text}</p></div></aside>`;
const table = (headers, rows) => `<div class="table-wrap" tabindex="0" role="region" aria-label="Data table; scroll horizontally if needed"><table role="table"><thead><tr>${headers.map(h => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map((cell, i) => `<${i ? 'td' : 'th scope="row"'}>${cell}</${i ? 'td' : 'th'}>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const section = (id, title, body, framework = false) => `<section id="${id}"><h2>${title}${framework ? `<img class="framework-heading-logo" src="assets/frameworks/${id}.svg" width="24" height="24" alt="">` : ''}<a class="anchor" href="#${id}" aria-label="Link to ${title}">#</a></h2>${body}</section>`;
const frameworkPanel = (id, title, body) => `<div id="${id}" class="framework-panel"><h3>${title}</h3>${body}</div>`;
const frameworkTabs = body => `<div data-framework-tabs><div class="framework-tabs" aria-label="Framework examples" hidden>${['React', 'Vue', 'Svelte'].map(name => `<button type="button" id="tab-${name.toLowerCase()}" aria-controls="${name.toLowerCase()}"><img class="framework-logo" src="assets/frameworks/${name.toLowerCase()}.svg" width="20" height="20" alt="">${name}</button>`).join('')}</div>${body}</div>`;
const signature = text => `<code>${escape(text)}</code>`;
const apiTable = rows => table(['Member', 'Behavior'], rows.map(([member, behavior]) => [signature(member), behavior])).replace('class="table-wrap"', 'class="table-wrap api-table"');

export function pages({ types }) {
  const producer = `import { produce } from 'minksse/server';

// Return this Response from your server's /events GET handler.
export function GET({ request }) {
  return produce(({ emit }) => {
    const timer = setInterval(() => {
      emit('tick', JSON.stringify({ time: Date.now() }));
    }, 1000);

    return () => clearInterval(timer);
  }, { signal: request.signal });
}`;
  const client = `import { createSseConnection } from 'minksse/client';

const connection = createSseConnection('/events', {
  onerror: (error) => console.error(error)
});

const unsubscribe = connection.subscribe('tick', (value) => {
  console.log(value); // { time: ... }
});

// Call this when the owner is disposed:
function dispose() {
  unsubscribe();
  connection.close();
}`;
  const reactExample = `import { useEffect, useState } from 'react';
import { createSseConnection } from 'minksse/client';

export default function Tick() {
  const [time, setTime] = useState(null);
  const [status, setStatus] = useState('Connecting…');

  useEffect(() => {
    const connection = createSseConnection('/events', {
      onopen: () => setStatus('Waiting for events…'),
      onerror: (error) => {
        console.error(error);
        setStatus('Event or connection error. See console.');
      },
      onclose: () => setStatus('Stream ended. Reload to reconnect.')
    });
    connection.subscribe('tick', (value) => {
      if (value === null || typeof value !== 'object' || !Number.isFinite(value.time)) {
        throw new Error('Expected a tick with a finite time');
      }
      setTime(value.time);
      setStatus('Receiving events.');
    });
    return () => connection.close();
  }, []);

  return (
    <>
      <p role="status">{status}</p>
      <p>Latest tick: {time ?? 'None yet'}</p>
    </>
  );
}`;
  const vueExample = `<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { createSseConnection } from 'minksse/client';

const time = ref(null);
const status = ref('Connecting…');
let connection;

onMounted(() => {
  connection = createSseConnection('/events', {
    onopen: () => { status.value = 'Waiting for events…'; },
    onerror: (error) => {
      console.error(error);
      status.value = 'Event or connection error. See console.';
    },
    onclose: () => { status.value = 'Stream ended. Reload to reconnect.'; }
  });
  connection.subscribe('tick', (value) => {
    if (value === null || typeof value !== 'object' || !Number.isFinite(value.time)) {
      throw new Error('Expected a tick with a finite time');
    }
    time.value = value.time;
    status.value = 'Receiving events.';
  });
});

onUnmounted(() => connection?.close());
</script>

<template>
  <p role="status">{{ status }}</p>
  <p>Latest tick: {{ time ?? 'None yet' }}</p>
</template>`;
  const svelteExample = `<script>
  import { onMount } from 'svelte';
  import { createSseConnection } from 'minksse/client';

  let time = $state(null);
  let status = $state('Connecting…');

  onMount(() => {
    const connection = createSseConnection('/events', {
      onopen: () => { status = 'Waiting for events…'; },
      onerror: (error) => {
        console.error(error);
        status = 'Event or connection error. See console.';
      },
      onclose: () => { status = 'Stream ended. Reload to reconnect.'; }
    });
    connection.subscribe('tick', (value) => {
      if (value === null || typeof value !== 'object' || !Number.isFinite(value.time)) {
        throw new Error('Expected a tick with a finite time');
      }
      time = value.time;
      status = 'Receiving events.';
    });
    return () => connection.close();
  });
</script>

<p role="status">{status}</p>
<p>Latest tick: {time ?? 'None yet'}</p>`;
  const exampleContract = `<p>These JavaScript components connect to <code>GET /events</code> on your application’s origin and display the <code>{ time: number }</code> ticks from <a href="getting-started/#create-an-endpoint">the example endpoint</a>. Serve or proxy that route from your app; a frontend dev server alone does not provide it.</p><p>JSON decoding does not validate an event’s shape. Each listener checks for a finite numeric <code>time</code> before changing the display. The client forwards thrown listener errors to <code>onerror</code>; a later valid event can still arrive. The last valid tick stays visible if an error occurs or the stream ends.</p><p>These examples show connection status but do not retry. When the stream ends, reload the page to reconnect, or add the retry policy from <a href="lifecycle/">Reconnection and cleanup</a>. Calling <code>close()</code> releases all subscriptions and suppresses <code>onclose</code> during local cleanup.</p>`;
  return [
    { slug: 'index', label: 'Overview', title: 'Server-sent events.\nWithout the framework.', category: 'Introduction', description: 'A small, dependency-free SSE toolkit built on the Web APIs you already use. Produce events on the server. Subscribe to them anywhere.', body: `
      <div class="hero-actions"><a class="button primary" href="getting-started/">Get started ${icon('arrow-right')}</a><a class="text-link" href="server/">Explore the API ${icon('arrow-right')}</a></div>
      <div class="package-facts"><span>${icon('check-circle')} Zero runtime dependencies</span><span>${icon('code-square')} JavaScript + types</span><span>${icon('transfer-horizontal')} Any framework</span></div>
      ${section('a-small-api', 'One stream. Three small pieces.', `<p>MinkSSE connects a server that emits named events to a client that listens for them. It handles SSE framing, heartbeats, incremental parsing, and resource cleanup through a focused API.</p><div class="stream-diagram" aria-label="The server produces events, HTTP streams them, and the client subscribes"><span><small>SERVER</small><code>produce()</code></span><i aria-hidden="true">→</i><span><small>TRANSPORT</small><code>text/event-stream</code></span><i aria-hidden="true">→</i><span><small>CLIENT</small><code>subscribe()</code></span></div>` + code(`import { createSseConnection } from 'minksse/client';

const stream = createSseConnection('/events');
stream.subscribe('notification', (notification) => {
  console.log(notification);
});

// Close when your component or application is disposed.
// stream.close();`))}
      ${section('built-on-the-web', 'Built on the web', `<p>The server returns a standard <code>Response</code> backed by a <code>ReadableStream</code>. The client wraps native <code>EventSource</code>, which handles SSE framing and UTF-8 decoding. The library uses standard Web APIs throughout, with no Svelte stores, framework hooks, or runtime-specific HTTP adapter.</p><p>Use it in React, Vue, Svelte, or vanilla JavaScript. On the server, connect it to a runtime or framework that supports streaming Web Responses.</p>`)}
      ${note('A deliberate transport contract', 'The built-in client wraps native <strong>EventSource</strong> over <strong>GET</strong> and decodes application payloads as JSON by default. Reconnection is controlled by your application. <a href="client/">Read the client contract</a> before integrating.')}
      ${section('performance', 'Performance you can inspect', `<p>Compare the portable producer against native Node HTTP, Better SSE, Fastify SSE, Hono, and sveltekit-sse. <a href="benchmarks/">View the benchmarks</a>, workload settings, and downloadable raw results.</p>`)}
      ${section('where-to-start', 'Where to start', `<div class="guide-links"><a href="getting-started/"><strong>Your first stream ${icon('arrow-right')}</strong><span>Connect a producer to a browser.</span></a><a href="frameworks/"><strong>Use your framework ${icon('arrow-right')}</strong><span>Own connections in React, Vue, and Svelte.</span></a><a href="lifecycle/"><strong>Manage the lifecycle ${icon('arrow-right')}</strong><span>Clean up, retry, and handle errors.</span></a></div>`)}
    ` },
    { slug: 'getting-started', label: 'Getting started', title: 'Your first event stream', category: 'Introduction', description: 'Set up a producer and a client, then give the connection a clear owner.', body:
      section('before-you-start', 'Before you start', `<p>You need a server that supports streaming <code>Response</code> bodies and a browser with native <code>EventSource</code> support. The package ships JavaScript ESM and TypeScript declarations.</p><p>Install MinkSSE from npm in your application directory:</p>` + code(`npm install minksse`, 'Terminal')) +
      section('create-an-endpoint', 'Create an endpoint', `<p>Expose a <code>GET /events</code> route. The example below uses SvelteKit's handler shape; in another server, pass the incoming request signal and return the same Response.</p>` + code(producer)) +
      section('subscribe-to-events', 'Subscribe to events', `<p>Choose the React, Vue, or Svelte example below to display ticks from the endpoint above. Each component owns its connection and closes it on unmount. The equivalent plain JavaScript setup is:</p><p>Create the connection in the browser. Register listeners immediately; the first request starts in a microtask. Application payloads are decoded from JSON.</p>` + code(client)) +
      section('framework-examples', 'Choose your framework', exampleContract + frameworkTabs(
      frameworkPanel('react', 'React', `<p>Save this as <code>Tick.jsx</code> in your React application. For Next.js App Router, add <code>'use client';</code> at the top of the file. The effect opens the stream after mounting and closes it during cleanup.</p>` + code(reactExample, 'JavaScript (React JSX)')) +
      frameworkPanel('vue', 'Vue', `<p>Save this as <code>Tick.vue</code> in a Vue 3 application. Open the stream after mounting and close it when the component unmounts.</p>` + code(vueExample, 'Vue')) +
      frameworkPanel('svelte', 'Svelte', `<p>Save this as <code>Tick.svelte</code> in a Svelte 5 application. The synchronous <code>onMount</code> callback opens the stream in the browser and returns its cleanup function.</p>` + code(svelteExample, 'Svelte')))) +
      section('own-the-connection', 'Own the connection', `<p>Keep one connection for each explicit owner. Removing a listener only removes that registration. Call <code>close()</code> when the component, view, or application is disposed.</p><p>For automatic recovery, provide an <code>onclose</code> callback and own the retry timer too. See <a href="lifecycle/">Reconnection and cleanup</a>.</p>`) },
    { slug: 'server', label: 'Producer', title: 'produce', category: 'API reference', description: 'Create an SSE response with bounded buffering, heartbeats, and explicit cleanup.', body:
      section('signature', 'Signature', code(`import { produce, SSE_MAX_BUFFER_BYTES } from 'minksse/server';

produce(start, { signal, ping, coalesceBytes, headers, onStop });`, 'Signatures') + `<p><code>start</code> runs synchronously and receives <code>emit</code> and <code>lock</code>. Return a cleanup function to release resources when the stream ends. The result is a standard <code>Response</code>.</p>`) +
      section('emit', 'Emit an event', code(`const response = produce(({ emit, lock }) => {
  emit('notification', JSON.stringify({ message: 'Connected' }));
  lock.set(false); // Finish after accepted frames drain.
});`) + `<p><code>emit(event, data)</code> accepts a string event name and string payload. It returns <code>{ error: false }</code> on success or <code>{ error: Error }</code> on failure. Serialize application payloads with <code>JSON.stringify</code> for the built-in client.</p><p>Event IDs start at 1 for each response. Multiline data is framed safely. Event names containing CR or LF are rejected and terminate the stream.</p>`) +
      section('batches', 'Available batches', code(`const response = produce(({ emitBatch, lock }) => {
  const result = emitBatch('update', [
    JSON.stringify({ value: 1 }),
    JSON.stringify({ value: 2 })
  ]);
  if (!result.error) lock.set(false);
}, { coalesceBytes: 16_384 });`) + `<p><code>emitBatch(event, readonlyStringArray)</code> validates all values before publishing any new batch frames. With coalescing enabled, its first available group can use one output chunk. It adds no timer and does not wait for future values. The batch must fit the available 256 KiB wire budget.</p><p>Invalid input, overflow, throwing getters or reentrant emission fail the stream without publishing a staged prefix. Abort or finish during array access drops staging and preserves the normal drain of earlier accepted events. This is validation atomicity, not atomic network delivery. Empty batches consume no ID; coalescing off keeps individual event chunks. Scalar <code>emit()</code> retains immediate delivery.</p>`) +
      section('options', 'Options', apiTable([
        ['signal?: AbortSignal', 'Pass the incoming request signal to propagate cancellation.'],
        ['ping?: number', 'Heartbeat interval in milliseconds. Default: 30,000. Positive integer up to 2,147,483,647.'],
        ['coalesceBytes?: number', 'Default 0 (off). Integer up to 262,144. Combine only already queued complete frames on a read, without waiting for a batch. A larger single event remains whole.'],
        ['headers?: HeadersInit', 'Additional response headers. Preserve text/event-stream for this client.'],
        ['onStop?: () => unknown', 'Finalizer for caller-owned resources, including skipped setup and invalid options.']
      ])) +
      section('cleanup', 'Cleanup', `<p>Returned cleanup and <code>onStop</code> cover explicit completion, abort, reader cancellation, failed setup, and overflow. They run at most once each. A cleanup function returned after synchronous termination still runs.</p><p>Cleanup may return a promise. Rejections are reported to the console; they do not block other finalizers. Termination does not wait for asynchronous cleanup.</p>`) +
      section('buffering', 'Bounded buffering', `<p><code>SSE_MAX_BUFFER_BYTES</code> is 262,144 bytes (256 KiB) of queued serialized UTF-8 wire data per stream. Oversized events and slow consumers terminate the stream. This limit does not include adapter or TCP buffers and is not a total heap limit.</p><p>Normal completion drains accepted frames. Errors and reader cancellation discard the backlog. <code>coalesceBytes: 16_384</code> can reduce output chunks during bursts; it preserves immediate sparse delivery and the 256 KiB limit. Coalescing is off by default. See the <a href="benchmarks/#improvements">coalescing sweep and tuning results</a> for larger batches.</p>`) +
      section('server-integration', 'Server integration', `<p>Return the producer’s <code>Response</code> through a server or framework that supports streaming Web Responses. Its HTTP integration must send status and headers, stream with backpressure, and propagate client disconnection to the request signal or response-body cancellation. Pass the request’s abort signal to <code>produce()</code> and verify that disconnecting a client releases your intervals and subscriptions.</p><p>The producer uses the same Web Streams path in every runtime. Configure your server and proxy to avoid buffering the SSE route.</p>`) +
      section('node-migration', 'Migrate from the Node adapter', `<p>The <code>minksse/node</code> entry point and <code>writeSseResponse()</code> have been removed. Remove those imports and use your server framework’s streaming Web Response support. The private Node queue, byte-counting, encoding, and scheduling hooks are removed as well. The public producer’s framing, byte limit, batching, coalescing, and cleanup behavior remain available through Web APIs.</p>`) },
    { slug: 'client', label: 'Connection', title: 'createSseConnection', category: 'API reference', description: 'Subscribe to JSON events over a single, explicitly owned native EventSource GET stream.', body:
      section('signature', 'Signature', code(client)) +
      section('requests', 'Request and response', `<p>The client creates a native <code>EventSource</code>, which opens a GET request and handles SSE framing and UTF-8 decoding. The endpoint must return <code>text/event-stream</code>. Native error events do not expose HTTP status or response bodies.</p><p>Subscribed application events are parsed with <code>JSON.parse</code> by default. Empty named <code>ping</code> events are delivered as <code>''</code>. Malformed JSON is reported through <code>onerror</code> and skipped. Set <code>decode: data =&gt; data</code> for raw text, or provide your own synchronous decoder.</p>`) +
      section('methods', 'Connection methods', apiTable([
        ['subscribe(name, listener)', 'Register a listener; returns a function that removes only this registration. Each call owns a distinct registration, even with the same callback.'],
        ['close()', 'Permanently close this connection and its native EventSource, and release listeners and timers.'],
        ['closed', 'Whether the connection was permanently closed locally. A network disconnect alone does not set this flag.']
      ])) +
      section('options', 'Options', apiTable([
        ['eventSource?: typeof EventSource', 'Override the native EventSource constructor with a compatible implementation.'],
        ['withCredentials?: boolean', 'Default false. Include credentials in cross-origin requests; the server must allow credentialed CORS.'],
        ['decode?: (data: string, event: MessageEvent) => unknown', 'Default JSON.parse, except empty named ping events become an empty string. Receives the native event; use data => data for raw text.'],
        ['heartbeatEvent?: string', 'Default ping. Observe this named event for idle detection even without a subscription.'],
        ['idleTimeoutMs?: number', 'Event-idle deadline. Default 75,000 ms. Integer from 0 through 2,147,483,647; 0 disables it. Open, subscribed events, and the configured heartbeat reset it. Raw bytes, comments, and other event names do not.'],
        ['onopen?: () => unknown', 'Called when native EventSource opens.'],
        ['onclose?: ({ connect }) => unknown', 'Called after nonlocal termination. Schedule connect() to recover; it resolves when that attempt ends.'],
        ['onerror?: (cause: unknown) => unknown', 'Observe native transport events, decoding failures, and callback failures.']
      ])) +
      section('migration', 'Migrate from the Fetch client', `<p>Change the SSE route from POST to GET and remove the <code>fetch</code> option. Use an EventSource-compatible session mechanism for authentication; arbitrary request headers are unavailable. Supply an <code>eventSource</code> constructor if your runtime needs one.</p><p>Subscriptions, disposers, and <code>onclose({ connect })</code> retain their roles. The idle deadline now follows subscribed events and named heartbeats instead of bytes, so comment-only heartbeats do not reset it. The standalone parser’s frame limit does not apply to native EventSource.</p>`) +
      section('delivery', 'Delivery behavior', `<p>Identical consecutive payloads are delivered individually. Listener delivery snapshots the registration set for each event: additions receive subsequent events, and removals before their turn are skipped.</p><p>Listener and lifecycle callback failures are contained and reported. If <code>onerror</code> itself fails, a console diagnostic is emitted. Only one request is active at a time.</p>`) },
    { slug: 'parser', label: 'Parser', title: 'createSseParser', category: 'API reference', description: 'Parse incrementally decoded SSE text without choosing a transport or framework.', body:
      section('usage', 'Usage', code(`import { createSseParser } from 'minksse/parser';

const parser = createSseParser((message) => {
  console.log(message.event, message.data, message.id);
});
parser.push('event: update\\ndata: {"count":1}\\n\\n');`)) +
      section('messages', 'Messages', `<p>The callback receives <code>{ event: string, data: string, id: string }</code>. Unlike the connection client, the parser delivers raw string data. It does not parse JSON.</p><p>Feed text decoded through one persistent <code>TextDecoder</code>, using streaming decoding across byte chunks. The parser handles split line endings, BOM, comments, empty data, and multiline events.</p>`) +
      section('limits', 'Frame limit', code(`const parser = createSseParser(onMessage, 1_048_576);`) + `<p>The default frame budget is 1,048,576 Unicode code points. A custom budget must be a positive safe integer; invalid values throw <code>RangeError</code>. Exceeding the frame budget throws. This is a parsing bound, not a total heap limit.</p>`) +
      section('completion', 'Completion', `<p>The parser exposes only <code>push()</code>. At EOF, release the parser; do not append a synthetic separator. Unterminated event data is not dispatched. Reconnection, transport cancellation, UTF-8 decoding, and application payload decoding belong to the caller.</p>`) },
    { slug: 'lifecycle', label: 'Reconnection and cleanup', title: 'Own the lifecycle', category: 'Guides', description: 'Make connection ownership, retry timing, and cleanup explicit.', body:
      section('reconnection', 'Reconnection', `<p>The wrapper closes native EventSource on error, including EOF, to suppress its built-in automatic retries. It then offers recovery through <code>onclose</code>; it does not schedule retries itself. Keep the retry timer alongside the connection and clear both when the owner is disposed.</p>` + code(`import { createSseConnection } from 'minksse/client';

let retry;
const connection = createSseConnection('/events', {
  onclose({ connect }) {
    retry = setTimeout(() => { void connect(); }, 1000);
  },
  onerror(error) { console.error(error); }
});

function dispose() {
  clearTimeout(retry);
  connection.close();
}`)) +
      note('Reconnect does not replay', 'IDs restart with each response. Explicit reconnect creates a fresh EventSource, so the previous attempt’s Last-Event-ID is not carried forward and missed events are not replayed. Refresh application state after reconnect, or implement durable catch-up in your application.') +
      section('heartbeats', 'Heartbeats and idle timeouts', `<p>The producer sends an empty named ping every 30 seconds by default. The client uses a 75-second event-idle deadline and observes ping even without a subscription. Change <code>heartbeatEvent</code> for a different named heartbeat, or set <code>idleTimeoutMs: 0</code> to disable detection. Comments and other unsubscribed event names do not refresh the deadline. Keep the producer heartbeat shorter than the client's timeout, and account for your proxy's idle limit.</p>`) +
      section('errors', 'Errors', `<p>Invalid options throw synchronously. Transport and payload errors go to <code>onerror</code>. Nonlocal stream termination offers <code>connect()</code> through <code>onclose</code>. Permanent local closure suppresses recovery callbacks.</p><p>The client API does not expose response status metadata to the recovery callback. If you need authentication-aware retry decisions, check session state separately; native EventSource does not expose HTTP status or response bodies.</p>`) +
      section('server-resources', 'Server resources', `<p>Return a finalizer for intervals, pub/sub registrations, and other resources allocated inside setup. Use <code>onStop</code> for resources owned before setup. Always forward the request's abort signal.</p>`) },
    { slug: 'frameworks', label: 'Framework integration', title: 'Bring your framework', category: 'Guides', description: 'Keep the transport independent and bind its lifetime to your component.', body:
      section('example-contract', 'Before you connect', exampleContract) +
      section('react', 'React', `<p>Save this as <code>Tick.jsx</code>. For Next.js App Router, add <code>'use client';</code> at the top. Create the connection inside <code>useEffect</code> and close it in the cleanup. React Strict Mode runs an extra setup/cleanup cycle in development; each setup must create a fresh connection. Effects do not run during server rendering.</p>` + code(reactExample, 'JavaScript (React JSX)') + `<p><a href="https://react.dev/reference/react/useEffect">React effect lifecycle</a></p>`, true) +
      section('vue', 'Vue', `<p>Save this as <code>Tick.vue</code> in a Vue 3 application. Register both lifecycle hooks synchronously in <code>setup</code>. <code>onMounted</code> starts the stream only in the browser, and <code>onUnmounted</code> closes it. The connection is a plain local variable because it does not drive the template; only the displayed values need refs.</p>` + code(vueExample, 'Vue') + `<p><a href="https://vuejs.org/api/composition-api-lifecycle.html">Vue lifecycle hooks</a></p>`, true) +
      section('svelte', 'Svelte', `<p>Save this as <code>Tick.svelte</code> in a Svelte 5 application. <code>onMount</code> does not run during server rendering. Keep its callback synchronous so Svelte receives the returned cleanup function; an async callback would return a promise instead. The displayed values use <code>$state</code>.</p>` + code(svelteExample, 'Svelte') + `<p><a href="https://svelte.dev/docs/svelte/lifecycle-hooks">Svelte lifecycle hooks</a></p>`, true) +
      section('servers', 'Servers', `<p>A SvelteKit <code>+server.ts</code> GET handler can return the producer Response directly. Other servers need to accept a streaming Web Response through their framework’s HTTP integration. Make sure client disconnection aborts the request or cancels the response body; see <a href="server/#server-integration">Server integration</a>.</p>` + code(producer) + `<p><a href="https://svelte.dev/docs/kit/routing#server">SvelteKit streaming endpoints</a></p>`) },
    { slug: 'deployment', label: 'Deployment', title: 'Keep the stream flowing', category: 'Guides', description: 'Verify streaming behavior across your server, reverse proxy, and browser.', body:
      section('streaming', 'Streaming support', `<p>Deploy to a runtime that supports long-lived streaming responses. Some platforms buffer response bodies or impose request-duration limits. Verify your deployed endpoint with a real client; a successful local stream does not establish production streaming support.</p>`) +
      section('proxies', 'Reverse proxies', `<p>Disable buffering for the SSE route in your proxy and keep its idle timeout longer than the heartbeat interval. The producer sets SSE headers, but proxy and adapter configuration remains part of your application.</p>`) +
      section('authentication', 'Authentication', `<p>Authorize before creating the stream. The built-in client uses native EventSource credentials behavior. Set <code>withCredentials: true</code> to include credentials across origins and configure credentialed CORS on the server. Native EventSource supports GET and has no options for arbitrary request headers or a request body; use an appropriate session mechanism such as cookies.</p><p>For SvelteKit, keep origin and CSRF settings correct for the chosen adapter. Enforce session expiry and revocation on active streams in your application.</p>`) +
      section('verify', 'Verify the endpoint', code(`curl -N \\
  -H 'Accept: text/event-stream' \\
  http://localhost:3000/events`, 'Terminal') + `<p>For an unauthenticated development endpoint, the example should show events as they arrive. Add your application's authentication when required. Stop the request and verify that the server releases its interval or subscription.</p>`) },
    { slug: 'benchmarks', label: 'Benchmarks', title: 'Measured streaming performance', category: 'Guides', description: 'Compare the portable Web API producer with native Node HTTP and other SSE projects, with validated results and reproducible settings.', body:
      section('comparison', 'HTTP producer comparison', `<p>November 2, 2026 · Node v24.12.0 · Apple M4 Pro · macOS arm64. Values below are <strong>median validated events per second</strong>. These measurements cover the server producer and HTTP delivery; they do not measure the EventSource client wrapper.</p>` + table(['Project', ...benchmarkCases.map(item => item.label)], benchmarkRows) + `<p>MinkSSE reached 92.9%, 88.7%, 96.8%, 89.2%, and 85.5% of native median throughput across these columns. Native Node remains faster. All 174 measured trials and 34.44 million measured events passed exact HTTP, count, ordering, and payload validation.</p>` + note('Explicit coalescing settings', 'MinkSSE uses <code>coalesceBytes: 65_536</code> for the 1 KiB column and <code>16_384</code> elsewhere. The library default remains <strong>0 (off)</strong>. The benchmark harness default remains 16 KiB.')) +
      section('methodology', 'Workloads and measurement', `<p>All workloads use batches of 16 events, sequential candidate trials, a fresh server per trial, and one full warmup pass before measurement. ASCII columns use seven measured repeats; the others use six. Sixteen-client workloads use four loader workers. Each stream delivers 20,000 events, except the 1 KiB workload, which delivers 5,000. Other payloads contain 128 UTF-8 bytes before JSON and SSE framing.</p><p>Throughput includes loopback HTTP delivery and independent client validation. Native uses Node HTTP writes; MinkSSE uses its public batch API and a generic Web Streams bridge owned by the benchmark. Framework routing and backpressure semantics differ across integrations. These are finite local workloads, not production capacity or cross-runtime performance guarantees.</p><p>For 1 KiB events, MinkSSE’s median per-trial p95 first-event time was 1.62 ms versus native’s 1.03 ms. Whole-process RSS-after was 96.23 versus 84.15 MiB. The individual reports include CPU, latency, RSS, confidence intervals, dependency versions, source hashes, and all raw samples.</p><p>† Better SSE, Fastify SSE, and sveltekit-sse previously failed the specific pre-serialized JSON configuration containing mixed raw CRLF, CR, and LF with identity serialization. They were excluded from the successful mixed-newline run and were not assigned zero throughput. Their compact JSON workloads passed. <a href="benchmark-results/mixed-newline-validation-2026-11-02.json">Raw captures and native EventSource validation</a> document the failures.</p>`) +
      section('improvements', 'What changed', `<p>At the same 16 KiB setting, matched before/after controls measured <strong>14.46% higher median Unicode throughput</strong> and <strong>41.03% higher multiline throughput</strong>. Paired mean gains were 12.75% (95% CI 7.91–17.59%) and 39.46% (36.46–42.47%). ASCII differences were inconclusive. See the <a href="benchmark-results/tuned-web-final-control-16k.md">source control report</a>.</p><p>A separate frozen-source 16/32/64 KiB sweep measured a <strong>56.4% median gain for 1 KiB events at 64 KiB</strong>. That is a configuration gain: the <a href="benchmark-results/tuned-web-final-control-large64k.md">fixed-64-KiB source control</a> found no established additional source gain. The sweep observed about 1.4 MiB higher whole-process RSS-after. It did not establish a universal benefit for 64 KiB. Compare settings on your own workload before choosing one.</p><p>The producer uses adaptive encoding, bounded multiline normalization, and early batch eligibility checks through standard Web APIs. The 256 KiB queued wire-byte limit, immediate first output, and cleanup remain covered by tests. The same portability fixture passes under Node, Bun, and Deno; the timings above are Node-hosted measurements.</p>`) +
      section('reports', 'Reports and raw samples', `<ul>${benchmarkCases.map(({ label, stem }) => `<li>${label}: <a href="benchmark-results/${stem}.md">full report</a> · <a href="benchmark-results/${stem}.json">raw JSON</a></li>`).join('')}<li>Coalescing sweep: <a href="benchmark-results/coalescing-sweep-2026-11-02.md">report</a> · <a href="benchmark-results/coalescing-sweep-2026-11-02.json">raw JSON</a></li><li>Matched 16 KiB source control: <a href="benchmark-results/tuned-web-final-control-16k.md">report</a> · <a href="benchmark-results/tuned-web-final-control-16k.json">raw JSON</a></li><li>Matched 64 KiB large-event source control: <a href="benchmark-results/tuned-web-final-control-large64k.md">report</a> · <a href="benchmark-results/tuned-web-final-control-large64k.json">raw JSON</a></li><li>Default-zero single-client batch control: <a href="benchmark-results/tuned-web-default-zero-control.md">report</a> · <a href="benchmark-results/tuned-web-default-zero-control.json">raw JSON</a></li></ul><p>All reports are included in this static site. For the complete methodology, matched control samples, and reproduction commands, see the <a href="https://github.com/accntech/minksse/blob/main/benchmarks/README.md#tuned-web-api-producer-november-2-2026">benchmark documentation</a>.</p>`) +
      section('reproduce', 'Run the comparison', `<p>From a checkout with Node 24 or newer:</p>` + code(`npm run build
npm --prefix benchmarks ci --ignore-scripts
npm --prefix benchmarks test
npm --prefix benchmarks run bench -- --loaders=4 --clients=16 --events=20000 --repeats=7 --coalesce=16384 --output=results/comparison.json`, 'Shell') + `<p>Replace the example’s workload options as follows. For the 1 KiB column, use <code>--bytes=1024 --events=5000 --repeats=6 --coalesce=65536</code>. For Unicode, use <code>--payload=unicode --repeats=6</code>. For mixed newlines, use <code>--payload=multiline --repeats=6 --targets=native,hono,minksse</code>. Run timing experiments sequentially.</p>`) },
    { slug: 'types', label: 'TypeScript', title: 'Types from the source', category: 'API reference', description: 'The public API declarations are generated from JavaScript JSDoc during the library build.', body:
      section('imports', 'Type imports', code(`import type {
  SseConnection,
  SseConnectionOptions,
  SseMessage,
  SseStreamControls,
  SseStreamOptions
} from 'minksse';`, 'TypeScript')) +
      section('declarations', 'Public declarations', `<p>This reference is included directly from the generated declarations, so it stays tied to the built library.</p>` + code(types, 'TypeScript')) },
    { slug: 'faq', label: 'Questions and answers', title: 'Questions and answers', category: 'Introduction', description: 'What you need to run MinkSSE, how events are delivered, and what happens when a connection ends.', body:
      section('requirements', 'What do I need to run MinkSSE?', `<p>MinkSSE has zero runtime dependencies and does not require a particular framework. The client needs native <code>EventSource</code> or a compatible constructor supplied through <code>eventSource</code>. The producer needs Streams, <code>Response</code>, and <code>TextEncoder</code>; the standalone parser consumes strings. Your server must support streaming Web Responses and propagate disconnection to the request signal or response-body cancellation. MinkSSE has no runtime-specific HTTP adapter.</p>`) +
      section('eventsource', 'Can I use the browser’s EventSource API?', `<p>Yes. The bundled client wraps native EventSource and connects over GET. It adds independent subscriptions, configurable decoding, event-idle detection, cleanup, and application-controlled recovery. You can also use EventSource directly with a GET endpoint that returns <code>produce()</code>.</p>`) +
      section('websockets', 'How is SSE different from WebSockets?', `<p>SSE streams events from server to client over HTTP. Client actions can use separate HTTP requests. WebSockets support ongoing communication in both directions over the same connection.</p>`) +
      section('compatibility', 'How are event payloads delivered?', `<p>The bundled client parses subscribed event data as JSON and passes the result to your callback. Serialize server payloads with <code>JSON.stringify()</code> and validate received values before using them. For raw text events, configure <code>decode: data =&gt; data</code>. Use <code>createSseParser()</code> when you already read and decode SSE bytes yourself.</p>`) +
      section('reconnection', 'Does the client reconnect automatically?', `<p>No. Use <code>onclose</code> to schedule retries with the supplied <code>connect()</code> function. Subscriptions survive reconnects, but missed events are not replayed automatically. Call <code>close()</code> when the connection’s owner is disposed to stop the stream and release its resources.</p>`) +
      section('publishing', 'How do I install MinkSSE?', `<p>Run <code>npm install minksse</code> in your application directory. Follow <a href="getting-started/">Getting started</a> to create an endpoint and subscribe to events.</p>`) }
  ];
}
