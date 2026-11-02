const producers = new WeakMap();
export function registerProducerCapabilities(body, state) {
    producers.set(body, state);
}
export function installProducerCapabilities(body, capabilities) {
    const state = producers.get(body);
    if (!state || !body.locked)
        return false;
    producers.delete(body);
    state.byteLength = capabilities.byteLength;
    return true;
}
export function claimProducerQueue(body, capabilities) {
    const state = producers.get(body);
    if (!state || !body.locked)
        return undefined;
    producers.delete(body);
    state.byteLength = capabilities.byteLength;
    const control = state.control;
    state.control = undefined;
    return control;
}
//# sourceMappingURL=producer-capabilities.js.map