const producers = new WeakMap();
export function registerProducerCapabilities(body, state) {
    producers.set(body, state);
}
export function installProducerCapabilities(body, capabilities) {
    const state = producers.get(body);
    if (!state)
        return false;
    producers.delete(body);
    state.byteLength = capabilities.byteLength;
    return true;
}
//# sourceMappingURL=producer-capabilities.js.map