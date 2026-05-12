/**
 * Configured axios instance + interceptors.
 *
 * One axios instance is shared by the generated hey-api SDK and by anything
 * that needs to make a raw HTTP call (rare — prefer the typed SDK). The
 * generated client is rebound to this instance at module load, so calling
 * e.g. `Deals.listDeals()` goes through our interceptors automatically.
 *
 * Boot order: this module is imported by `src/api/index.ts`, which is
 * imported by feature hooks. The first import triggers the SDK rebind exactly
 * once.
 */

import axios, {
  type AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from "axios";
import { client as generatedClient } from "@/api/generated/client.gen";
import type { ApiError } from "@/api/generated/types.gen";

// ---------------------------------------------------------------------------
// Auth token plumbing
// ---------------------------------------------------------------------------

/**
 * Stub for the auth-token getter. Session 5 wires this to the real Supabase
 * auth store; today it always returns null so requests go out unauthenticated
 * (which is fine for the local dev API stub).
 */
let authTokenGetter: () => string | null = () => null;

/** Called by the auth store once it's mounted (Session 5). */
export function setAuthTokenGetter(fn: () => string | null): void {
  authTokenGetter = fn;
}

// ---------------------------------------------------------------------------
// Unauthorized-handler plumbing (decoupled from React Router)
// ---------------------------------------------------------------------------

let onUnauthorized: () => void = () => {
  // Default: hard redirect to /login. Session 5 replaces this with a soft
  // navigation via React Router that preserves the current location.
  if (typeof window !== "undefined" && window.location.pathname !== "/login") {
    window.location.assign("/login");
  }
};

export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

// ---------------------------------------------------------------------------
// Axios instance
// ---------------------------------------------------------------------------

export const apiClient: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? "http://localhost:5000",
  timeout: 15_000,
  headers: { "Content-Type": "application/json" },
});

// Request: attach JWT if available.
apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = authTokenGetter();
  if (token) {
    config.headers.set("Authorization", `Bearer ${token}`);
  }
  return config;
});

// ---------------------------------------------------------------------------
// Normalized error shape
// ---------------------------------------------------------------------------

/**
 * Surface every failed HTTP call as one of these. Components and TanStack
 * Query callbacks can switch on `kind` rather than poking at `response.status`.
 */
export type NormalizedError =
  | { kind: "unauthorized"; status: 401; api: ApiError | null }
  | { kind: "forbidden"; status: 403; api: ApiError | null }
  | { kind: "not_found"; status: 404; api: ApiError | null }
  | { kind: "validation"; status: 400 | 422; api: ApiError | null }
  | { kind: "server"; status: number; api: ApiError | null; traceId: string | null }
  | { kind: "network"; status: 0; api: null }
  | { kind: "unknown"; status: number; api: ApiError | null };

export class NavigatrApiError extends Error {
  readonly normalized: NormalizedError;
  readonly cause?: unknown;
  constructor(normalized: NormalizedError, message: string, cause?: unknown) {
    super(message);
    this.name = "NavigatrApiError";
    this.normalized = normalized;
    this.cause = cause;
  }
}

function normalize(err: AxiosError<ApiError>): NormalizedError {
  // No response at all → network/CORS/offline.
  if (!err.response) {
    return { kind: "network", status: 0, api: null };
  }
  const status = err.response.status;
  const api = (err.response.data ?? null) as ApiError | null;

  if (status === 401) return { kind: "unauthorized", status: 401, api };
  if (status === 403) return { kind: "forbidden", status: 403, api };
  if (status === 404) return { kind: "not_found", status: 404, api };
  if (status === 400 || status === 422) return { kind: "validation", status, api };
  if (status >= 500) {
    return { kind: "server", status, api, traceId: api?.traceId ?? null };
  }
  return { kind: "unknown", status, api };
}

// Response: normalize errors and trigger global side effects.
apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ApiError>) => {
    const normalized = normalize(error);

    if (normalized.kind === "unauthorized") {
      // Fire and forget — the handler does navigation. We still reject so the
      // calling code (TanStack Query, etc.) can clean up its own state.
      onUnauthorized();
    } else if (normalized.kind === "server") {
      // Surface trace IDs in DevTools so screen captures can be debugged.
      console.error(
        `[api] ${normalized.status} server error`,
        normalized.traceId ? `(trace ${normalized.traceId})` : "",
        normalized.api?.message ?? error.message,
      );
    }

    return Promise.reject(
      new NavigatrApiError(
        normalized,
        normalized.api?.message ?? error.message ?? "API request failed",
        error,
      ),
    );
  },
);

// ---------------------------------------------------------------------------
// Wire the generated hey-api client to use our configured axios instance.
//
// This is a *module-level side effect* — running it on first import means
// every call site using the generated SDK (Me, Deals, Activities) automatically
// gets our interceptors, our base URL, and our auth header. There is no other
// place to configure the client.
// ---------------------------------------------------------------------------

generatedClient.setConfig({ axios: apiClient });

// ---------------------------------------------------------------------------
// Re-export for raw use (rare)
// ---------------------------------------------------------------------------

/**
 * For the rare case you need to make a request that isn't in the generated
 * SDK (uploading a binary, calling a non-OpenAPI endpoint, etc.).
 * Prefer the typed SDK whenever possible.
 */
export function rawRequest<T = unknown>(config: AxiosRequestConfig): Promise<T> {
  return apiClient.request<T>(config).then((r) => r.data);
}
