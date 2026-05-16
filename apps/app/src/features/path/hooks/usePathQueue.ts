/**
 * usePathQueue — the rep's queued drop-in route.
 *
 * Persisted in localStorage so a refresh / accidental nav-away doesn't
 * lose the queue mid-route. Zustand's `persist` middleware handles
 * hydration; we explicitly version the key so a schema change in
 * Sprint 2 (e.g. adding `arrivedAt` per stop) can bump the version
 * and discard stale state instead of crashing.
 *
 * State machine per stop:
 *   pending   — added to the queue, not yet visited or skipped
 *   visited   — rep walked in and logged the visit
 *   skipped   — rep chose not to stop (no answer, closed, etc.)
 *
 * Once every stop is resolved (no pending), the UI can show an
 * end-of-path summary. Adding a new merchant after that re-enters
 * planning mode automatically.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type StopStatus = "pending" | "visited" | "skipped";

export interface PathStop {
  merchantId: string;
  status: StopStatus;
  /** ISO timestamp when the merchant was added to the queue. */
  addedAt: string;
  /** ISO timestamp when status flipped from pending. null while pending. */
  resolvedAt: string | null;
}

interface PathQueueState {
  stops: PathStop[];

  add: (merchantId: string) => void;
  remove: (merchantId: string) => void;
  setStatus: (merchantId: string, status: StopStatus) => void;
  clear: () => void;

  // Selectors (cheap, can be called from render)
  has: (merchantId: string) => boolean;
  pendingCount: () => number;
  isComplete: () => boolean;
}

const STORAGE_KEY = "navigatr-path-queue-v1";

export const usePathQueue = create<PathQueueState>()(
  persist(
    (set, get) => ({
      stops: [],

      add: (merchantId) =>
        set((s) => {
          if (s.stops.some((x) => x.merchantId === merchantId)) return s; // idempotent
          return {
            stops: [
              ...s.stops,
              {
                merchantId,
                status: "pending",
                addedAt: new Date().toISOString(),
                resolvedAt: null,
              },
            ],
          };
        }),

      remove: (merchantId) =>
        set((s) => ({ stops: s.stops.filter((x) => x.merchantId !== merchantId) })),

      setStatus: (merchantId, status) =>
        set((s) => ({
          stops: s.stops.map((x) =>
            x.merchantId === merchantId
              ? {
                  ...x,
                  status,
                  resolvedAt: status === "pending" ? null : new Date().toISOString(),
                }
              : x,
          ),
        })),

      clear: () => set({ stops: [] }),

      has: (merchantId) => get().stops.some((x) => x.merchantId === merchantId),
      pendingCount: () => get().stops.filter((x) => x.status === "pending").length,
      isComplete: () => {
        const stops = get().stops;
        return stops.length > 0 && stops.every((x) => x.status !== "pending");
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      version: 1,
      // No-op for v1 (no prior version exists), but registering the function
      // now means future bumps (v2+) can write a real upgrader without
      // touching this file's structure. If we returned undefined / threw,
      // Zustand would discard state silently — bad UX.
      migrate: (state, _fromVersion) => {
        return (state as PathQueueState) ?? { stops: [] };
      },
      // If localStorage JSON is corrupted (quota eviction, browser bug,
      // dev-tools tampering), JSON.parse throws inside Zustand. Without
      // this hook the exception can bubble to the render tree and trip
      // RouteErrorBoundary — the rep loses their path AND sees a generic
      // error screen. Catch it here, reset to an empty queue, and let
      // them keep working.
      onRehydrateStorage: () => (_state, error) => {
        if (error) {
          // eslint-disable-next-line no-console
          console.warn("[usePathQueue] rehydrate failed, resetting:", error);
          try {
            localStorage.removeItem(STORAGE_KEY);
          } catch {
            /* ignore — quota errors, private mode, etc. */
          }
        }
      },
    },
  ),
);
