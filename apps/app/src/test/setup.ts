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
