/**
 * Test-only stub for the `virtual:pwa-register` module that vite-plugin-pwa
 * synthesizes at build time. Vitest's transform pipeline resolves imports
 * before `vi.mock` can intercept the virtual id, so vitest.config.ts aliases
 * `virtual:pwa-register` to this file. Tests still `vi.mock("virtual:pwa-register")`
 * to swap in spies — this stub only has to make the import resolve.
 */
export function registerSW(
  _options?: unknown,
): (reloadPage?: boolean) => Promise<void> {
  return async () => {};
}
