import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom lacks these browser APIs that components touch on mount/render.
// Stub them so render() never throws on a missing global.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = globalThis.ResizeObserver || (ResizeObserverStub as unknown as typeof ResizeObserver);

// jsdom does not implement scrollIntoView; components call it in effects.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}

class EventSourceStub {
  close() {}
  addEventListener() {}
  removeEventListener() {}
}
globalThis.EventSource = globalThis.EventSource || (EventSourceStub as unknown as typeof EventSource);

// jsdom lacks sendBeacon; ApiClient.logClientEvent prefers it for observability.
// Without this stub it falls back to fetch() and pollutes per-test fetch spies.
if (typeof navigator !== 'undefined' && !navigator.sendBeacon) {
  navigator.sendBeacon = (() => true) as unknown as typeof navigator.sendBeacon;
}

// Default fetch: empty-ok JSON. Per-test mocks override via vi.spyOn / helpers.mockFetch.
// Prevents unmocked mount fetches from rejecting and crashing render.
if (!globalThis.fetch || !('mockReturnValue' in (globalThis.fetch as object))) {
  globalThis.fetch = vi.fn(async () =>
    new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
  ) as unknown as typeof fetch;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
