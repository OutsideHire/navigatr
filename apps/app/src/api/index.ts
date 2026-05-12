/**
 * Curated public API for the typed client.
 *
 * Feature code should import from `@/api` — NEVER from `@/api/generated/*`
 * directly. That gives us one seam to swap if the generator ever changes,
 * and keeps unintentional surface area (raw types, internal helpers) hidden.
 *
 * Generated entry points:
 *   - Service classes: Me, Deals, Activities (one per OpenAPI tag)
 *   - Domain types:    Deal, Activity, User, Tenant, …
 *   - Enums:           DealStage, ActivityType, Disposition, UserRole, Profession
 *   - Error envelope:  ApiError (from the spec)
 *
 * Hand-authored entry points:
 *   - apiClient          — the configured axios instance
 *   - NavigatrApiError   — what every failed call rejects with
 *   - NormalizedError    — discriminated union of error categories
 *   - setAuthTokenGetter — Session 5: wires Supabase JWT into the request interceptor
 *   - setUnauthorizedHandler — Session 5: wires Router-based redirect on 401
 *
 * Importing this module is what binds the generated SDK to our axios instance
 * (the side effect lives in `./client.ts`). Don't tree-shake this away.
 */

// Side-effect import: configures the generated client + interceptors.
// This MUST run before any service-class method is called.
import "./client";

// ---- Service classes (one per OpenAPI tag) --------------------------------
export { Me, Deals, Activities } from "./generated/sdk.gen";
export type { Options } from "./generated/sdk.gen";

// ---- Domain types ---------------------------------------------------------
export type {
  // Identity
  Tenant,
  User,
  MeResponse,
  // Deals
  Deal,
  CreateDealRequest,
  UpdateDealRequest,
  SetDealStageRequest,
  DealList,
  // Activities
  Activity,
  LogActivityRequest,
  ActivityList,
  TodaysTasksResponse,
  // Errors
  ApiError,
} from "./generated/types.gen";

// ---- Enums (re-exported as both value and type) ---------------------------
export {
  DealStage,
  ActivityType,
  Disposition,
  UserRole,
  Profession,
} from "./generated/types.gen";

// ---- Hand-authored runtime helpers ----------------------------------------
export {
  apiClient,
  rawRequest,
  setAuthTokenGetter,
  setUnauthorizedHandler,
  NavigatrApiError,
  type NormalizedError,
} from "./client";

import { Activities, Deals, Me } from "./generated/sdk.gen";

/**
 * Per-call API factory bound to a specific token.
 *
 * **Most code should NOT use this.** The SDK service classes (`Me`, `Deals`,
 * `Activities`) are already wired through the singleton axios instance and
 * pick up the current user's JWT from `setAuthTokenGetter()`. Just import
 * them directly from `@/api` and call `Deals.listDeals(...)`.
 *
 * Reach for `createApiClient(token)` only when the singleton's token isn't
 * the right one for the call — examples:
 *   - Validating an invitation token before login
 *   - Calling the API with a service-account token from a one-off script
 *   - Tests that need per-call token isolation
 *
 * Returned object keeps the generated service method signatures intact;
 * the only difference is the `Authorization` header is forced on every call.
 *
 * Usage in a TanStack Query hook:
 *
 *   const api = useMemo(() => createApiClient(token), [token]);
 *   return useQuery({
 *     queryKey: ["deals", token],
 *     queryFn: () => api.deals.list(),
 *   });
 */
export function createApiClient(token: string | null) {
  const authHeader = token ? { Authorization: `Bearer ${token}` } : {};

  // Inner helper: merges authHeader into whatever `headers` the caller passes.
  // Typed loosely against `unknown` because hey-api's per-method Options
  // types are deep generics — pinning them precisely here adds friction
  // without catching real bugs.
  type WithHeaders = { headers?: Record<string, unknown> };
  const withAuth = <T extends WithHeaders>(opts: T = {} as T): T => ({
    ...opts,
    headers: { ...authHeader, ...(opts.headers ?? {}) },
  });

  return {
    me: {
      getMe: (opts: Parameters<typeof Me.getMe>[0] = {}) => Me.getMe(withAuth(opts)),
    },
    deals: {
      list: (opts: Parameters<typeof Deals.listDeals>[0] = {}) =>
        Deals.listDeals(withAuth(opts)),
      get: (opts: Parameters<typeof Deals.getDeal>[0]) => Deals.getDeal(withAuth(opts)),
      create: (opts: Parameters<typeof Deals.createDeal>[0]) =>
        Deals.createDeal(withAuth(opts)),
      update: (opts: Parameters<typeof Deals.updateDeal>[0]) =>
        Deals.updateDeal(withAuth(opts)),
      setStage: (opts: Parameters<typeof Deals.setDealStage>[0]) =>
        Deals.setDealStage(withAuth(opts)),
    },
    activities: {
      list: (opts: Parameters<typeof Activities.listActivities>[0] = {}) =>
        Activities.listActivities(withAuth(opts)),
      log: (opts: Parameters<typeof Activities.logActivity>[0]) =>
        Activities.logActivity(withAuth(opts)),
      today: (opts: Parameters<typeof Activities.getTodaysTasks>[0] = {}) =>
        Activities.getTodaysTasks(withAuth(opts)),
    },
  };
}

export type NavigatrApi = ReturnType<typeof createApiClient>;
