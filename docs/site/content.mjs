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
const section = (id, title, body) => `<section id="${id}"><h2>${title}<a class="anchor" href="#${id}" aria-label="Link to ${title}">#</a></h2>${body}</section>`;
const signature = text => `<code>${escape(text)}</code>`;
const apiTable = rows => table(['Member', 'Behavior'], rows.map(([member, behavior]) => [signature(member), behavior])).replace('class="table-wrap"', 'class="table-wrap api-table"');

export function pages({ types }) {
  const producer = `import { produce } from 'minksse/server';

// Return this Response from your server's /events POST handler.
export function POST({ request }) {
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
      ${section('built-on-the-web', 'Built on the web', `<p>The server returns a standard <code>Response</code> backed by a <code>ReadableStream</code>. The client uses <code>fetch</code> and <code>AbortController</code>. There are no Svelte stores, framework hooks, or server adapters inside the package.</p><p>Use it in React, Vue, Svelte, or vanilla JavaScript. On the server, connect it to a runtime or framework that supports streaming Web Responses.</p>`)}
      ${note('A deliberate transport contract', 'The built-in client connects with <strong>POST</strong> and parses application payloads as <strong>JSON</strong>. Reconnection is controlled by your application. <a href="client/">Read the client contract</a> before integrating.')}
      ${section('where-to-start', 'Where to start', `<div class="guide-links"><a href="getting-started/"><strong>Your first stream ${icon('arrow-right')}</strong><span>Connect a producer to a browser.</span></a><a href="frameworks/"><strong>Use your framework ${icon('arrow-right')}</strong><span>Own connections in React, Vue, and Svelte.</span></a><a href="lifecycle/"><strong>Manage the lifecycle ${icon('arrow-right')}</strong><span>Clean up, retry, and handle errors.</span></a></div>`)}
    ` },
    { slug: 'getting-started', label: 'Getting started', title: 'Your first event stream', category: 'Introduction', description: 'Set up a producer and a client, then give the connection a clear owner.', body:
      section('before-you-start', 'Before you start', `<p>You need a server that supports streaming <code>Response</code> bodies and a browser with Fetch and Streams support. The package ships JavaScript ESM and TypeScript declarations.</p><p>This checkout has not been published to npm. Build it and install the local directory from your application:</p>` + code(`cd /path/to/minksse
bun install
bun run build

# From your application directory:
npm install /path/to/minksse`, 'Terminal')) +
      section('create-an-endpoint', 'Create an endpoint', `<p>Expose a <code>POST /events</code> route. The example below uses SvelteKit's handler shape; in another server, pass the incoming request signal and return the same Response.</p>` + code(producer)) +
      section('subscribe-to-events', 'Subscribe to events', `<p>Create the connection in the browser. Register listeners immediately; the first request starts in a microtask. Application payloads are decoded from JSON.</p>` + code(client)) +
      section('own-the-connection', 'Own the connection', `<p>Keep one connection for each explicit owner. Removing a listener only removes that registration. Call <code>close()</code> when the component, view, or application is disposed.</p><p>For automatic recovery, provide an <code>onclose</code> callback and own the retry timer too. See <a href="lifecycle/">Reconnection and cleanup</a>.</p>`) },
    { slug: 'server', label: 'Producer', title: 'produce', category: 'API reference', description: 'Create an SSE response with bounded buffering, heartbeats, and explicit cleanup.', body:
      section('signature', 'Signature', code(`import { produce, SSE_MAX_BUFFER_BYTES } from 'minksse/server';

produce(start, { signal, ping, headers, onStop });`, 'Signatures') + `<p><code>start</code> runs synchronously and receives <code>emit</code> and <code>lock</code>. Return a cleanup function to release resources when the stream ends. The result is a standard <code>Response</code>.</p>`) +
      section('emit', 'Emit an event', code(`const response = produce(({ emit, lock }) => {
  emit('notification', JSON.stringify({ message: 'Connected' }));
  lock.set(false); // Finish after accepted frames drain.
});`) + `<p><code>emit(event, data)</code> accepts a string event name and string payload. It returns <code>{ error: false }</code> on success or <code>{ error: Error }</code> on failure. Serialize application payloads with <code>JSON.stringify</code> for the built-in client.</p><p>Event IDs start at 1 for each response. Multiline data is framed safely. Event names containing CR or LF are rejected and terminate the stream.</p>`) +
      section('options', 'Options', apiTable([
        ['signal?: AbortSignal', 'Pass the incoming request signal to propagate cancellation.'],
        ['ping?: number', 'Heartbeat interval in milliseconds. Default: 30,000. Positive integer up to 2,147,483,647.'],
        ['headers?: HeadersInit', 'Additional response headers. Preserve text/event-stream for this client.'],
        ['onStop?: () => unknown', 'Finalizer for caller-owned resources, including skipped setup and invalid options.']
      ])) +
      section('cleanup', 'Cleanup', `<p>Returned cleanup and <code>onStop</code> cover explicit completion, abort, reader cancellation, failed setup, and overflow. They run at most once each. A cleanup function returned after synchronous termination still runs.</p><p>Cleanup may return a promise. Rejections are reported to the console; they do not block other finalizers. Termination does not wait for asynchronous cleanup.</p>`) +
      section('buffering', 'Bounded buffering', `<p><code>SSE_MAX_BUFFER_BYTES</code> is 262,144 bytes (256 KiB) of queued serialized UTF-8 wire data per stream. Oversized events and slow consumers terminate the stream. This limit does not include adapter or TCP buffers and is not a total heap limit.</p><p>Normal completion drains accepted frames. Errors and reader cancellation discard the backlog.</p>`) },
    { slug: 'client', label: 'Connection', title: 'createSseConnection', category: 'API reference', description: 'Subscribe to JSON events over a single, explicitly owned POST stream.', body:
      section('signature', 'Signature', code(client)) +
      section('requests', 'Request and response', `<p>The client makes a POST request with <code>Accept: text/event-stream</code> and <code>cache: no-store</code>. A successful response must have a 2xx status, an SSE content type, and a readable body.</p><p>Named application events are parsed with <code>JSON.parse</code>. Empty named <code>ping</code> events are delivered as <code>''</code>. Malformed JSON is reported through <code>onerror</code> and skipped.</p>`) +
      section('methods', 'Connection methods', apiTable([
        ['subscribe(name, listener)', 'Register a listener; returns a function that removes only this registration. Each call owns a distinct registration, even with the same callback.'],
        ['close()', 'Permanently close this connection, abort its request, cancel its reader, and release listeners and timers.'],
        ['closed', 'Whether the connection was permanently closed locally. A network disconnect alone does not set this flag.']
      ])) +
      section('options', 'Options', apiTable([
        ['fetch?: typeof fetch', 'Override the fetch implementation, for example in tests.'],
        ['idleTimeoutMs?: number', 'Byte-idle deadline. Default: 75,000 ms. Positive integer up to 2,147,483,647. Empty chunks do not reset it.'],
        ['onopen?: () => unknown', 'Called after a valid streaming response is accepted.'],
        ['onclose?: ({ connect }) => unknown', 'Called after nonlocal termination. Schedule connect() to recover; it resolves when that attempt ends.'],
        ['onerror?: (cause: unknown) => unknown', 'Observe transport, parsing, and listener failures.']
      ])) +
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
      section('reconnection', 'Reconnection', `<p>The client offers recovery through <code>onclose</code>; it does not schedule retries itself. Keep the retry timer alongside the connection and clear both when the owner is disposed.</p>` + code(`import { createSseConnection } from 'minksse/client';

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
      note('Reconnect does not replay', 'IDs restart with each response. The client does not send Last-Event-ID or replay missed events. Refresh application state after reconnect, or implement durable catch-up in your application.') +
      section('heartbeats', 'Heartbeats and idle timeouts', `<p>The producer sends an empty named ping every 30 seconds by default. The client uses a 75-second byte-idle deadline. Keep the producer heartbeat shorter than the client's timeout, and account for your proxy's idle limit.</p>`) +
      section('errors', 'Errors', `<p>Invalid options throw synchronously. Transport and payload errors go to <code>onerror</code>. Nonlocal stream termination offers <code>connect()</code> through <code>onclose</code>. Permanent local closure suppresses recovery callbacks.</p><p>The client API does not expose response status metadata to the recovery callback. If you need authentication-aware retry decisions, provide application policy around a custom fetch implementation or a separate session check.</p>`) +
      section('server-resources', 'Server resources', `<p>Return a finalizer for intervals, pub/sub registrations, and other resources allocated inside setup. Use <code>onStop</code> for resources owned before setup. Always forward the request's abort signal.</p>`) },
    { slug: 'frameworks', label: 'Framework integration', title: 'Bring your framework', category: 'Guides', description: 'Keep the transport independent and bind its lifetime to your component.', body:
      section('react', 'React', `<p>Create the connection inside an effect and close it in the effect cleanup. This also gives development remounts an explicit cleanup path.</p>` + code(`import { useEffect, useState } from 'react';
import { createSseConnection } from 'minksse/client';

export function useTick() {
  const [tick, setTick] = useState(null);
  useEffect(() => {
    const connection = createSseConnection('/events');
    connection.subscribe('tick', setTick);
    return () => connection.close();
  }, []);
  return tick;
}`) + `<p><a href="https://react.dev/reference/react/useEffect">React effect lifecycle</a></p>`) +
      section('vue', 'Vue', `<p>Create the stream after mounting and close it before unmounting. Keep browser connections outside server rendering.</p>` + code(`import { ref, onMounted, onUnmounted } from 'vue';
import { createSseConnection } from 'minksse/client';

export function useTick() {
  const tick = ref(null);
  let connection;
  onMounted(() => {
    connection = createSseConnection('/events');
    connection.subscribe('tick', (value) => { tick.value = value; });
  });
  onUnmounted(() => connection?.close());
  return tick;
}`) + `<p><a href="https://vuejs.org/api/composition-api-lifecycle.html">Vue lifecycle hooks</a></p>`) +
      section('svelte', 'Svelte', `<p>Start the connection in a synchronous mount callback and return its cleanup function.</p>` + code(`import { onMount } from 'svelte';
import { createSseConnection } from 'minksse/client';

onMount(() => {
  const connection = createSseConnection('/events');
  connection.subscribe('tick', (value) => console.log(value));
  return () => connection.close();
});`) + `<p><a href="https://svelte.dev/docs/svelte/lifecycle-hooks">Svelte lifecycle hooks</a></p>`) +
      section('servers', 'Servers', `<p>A SvelteKit <code>+server.ts</code> POST handler can return the producer Response directly. Other servers need to accept or adapt a streaming Web Response. MinkSSE does not include a Node HTTP response adapter.</p>` + code(producer) + `<p><a href="https://svelte.dev/docs/kit/routing#server">SvelteKit streaming endpoints</a></p>`) },
    { slug: 'deployment', label: 'Deployment', title: 'Keep the stream flowing', category: 'Guides', description: 'Verify streaming behavior across your server, reverse proxy, and browser.', body:
      section('streaming', 'Streaming support', `<p>Deploy to a runtime that supports long-lived streaming responses. Some platforms buffer response bodies or impose request-duration limits. Verify your deployed endpoint with a real client; a successful local stream does not establish production streaming support.</p>`) +
      section('proxies', 'Reverse proxies', `<p>Disable buffering for the SSE route in your proxy and keep its idle timeout longer than the heartbeat interval. The producer sets SSE headers, but proxy and adapter configuration remains part of your application.</p>`) +
      section('authentication', 'Authentication', `<p>Authorize before creating the stream. The built-in client uses same-origin fetch defaults. The client options do not provide arbitrary headers, body, method, or an external signal; use a custom fetch wrapper where your application requires additional request policy.</p><p>For SvelteKit, keep origin and CSRF settings correct for the chosen adapter. Enforce session expiry and revocation on active streams in your application.</p>`) +
      section('verify', 'Verify the endpoint', code(`curl -N -X POST \\
  -H 'Accept: text/event-stream' \\
  http://localhost:3000/events`, 'Terminal') + `<p>For an unauthenticated development endpoint, the example should show events as they arrive. Add your application's authentication when required. Stop the request and verify that the server releases its interval or subscription.</p>`) },
    { slug: 'types', label: 'TypeScript', title: 'Types from the source', category: 'API reference', description: 'The public API declarations are generated from JavaScript JSDoc during the library build.', body:
      section('imports', 'Type imports', code(`import type {
  SseConnection,
  SseConnectionOptions,
  SseMessage,
  SseStreamControls,
  SseStreamOptions
} from 'minksse';`, 'TypeScript')) +
      section('declarations', 'Public declarations', `<p>This reference is included directly from the generated declarations, so it stays tied to the built library.</p>` + code(types, 'TypeScript')) },
    { slug: 'faq', label: 'Questions and answers', title: 'Good questions', category: 'Introduction', description: 'Understand the boundaries before choosing a transport.', body:
      section('sveltekit', 'Do I need SvelteKit?', `<p>No. MinkSSE has no runtime or peer dependency on SvelteKit, Svelte, React, or Vue. Its server uses Web Responses and its client uses Fetch and Streams.</p>`) +
      section('eventsource', 'Can I use EventSource?', `<p>The browser's EventSource API makes GET requests, while the built-in connection client makes POST requests. A GET endpoint returning <code>produce()</code> can use SSE wire framing with EventSource, but the documented POST examples need the MinkSSE fetch client.</p>`) +
      section('websockets', 'Is this a WebSocket replacement?', `<p>SSE carries a stream from server to client over HTTP. Use ordinary HTTP requests for client actions. If your application needs continuous bidirectional transport, evaluate that requirement separately.</p>`) +
      section('compatibility', 'How does the client handle events and reconnection?', `<p>The client parses application data as JSON and delivers it to subscription callbacks. Connections are explicitly owned by the application, which also schedules retries through the <code>onclose</code> callback.</p>`) +
      section('publishing', 'Is it on npm?', `<p>This checkout is prepared for local installation. No npm publication or hosted documentation deployment has been performed. Use the local installation steps in <a href="getting-started/">Getting started</a>.</p>`) }
  ];
}
