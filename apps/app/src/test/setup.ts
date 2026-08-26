import "@testing-library/jest-dom/vitest";

// jsdom doesn't polyfill matchMedia. Theme store reads
// prefers-color-scheme at module load via window.matchMedia, which
// throws without this shim. Default to light mode for tests.
if (typeof window !== "undefined" && !window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

// jsdom doesn't implement ResizeObserver. Radix primitives (e.g. the Checkbox
// bubble input used for native form submission) construct one on render, which
// throws in tests without this shim. A no-op observer is enough for jsdom.
if (typeof globalThis !== "undefined" && !("ResizeObserver" in globalThis)) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
}
