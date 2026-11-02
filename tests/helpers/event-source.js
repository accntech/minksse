// A controllable native-API boundary for lifecycle tests; HTTP tests use real EventSource.
export function transport() {
  const sources = [];
  class Source extends EventTarget {
    closed = false;
    closeCalls = 0;
    constructor(url, options) {
      super();
      this.url = url;
      this.options = options;
      sources.push(this);
    }
    close() { this.closed = true; this.closeCalls++; }
  }
  return {
    eventSource: Source,
    sources,
    get source() { return sources.at(-1); },
    open() { this.source.dispatchEvent(new Event('open')); },
    send(name, data) { this.source.dispatchEvent(new MessageEvent(name, { data })); },
    end() { this.source.dispatchEvent(new Event('error')); }
  };
}
