/**
 * sessionQueries: the auth store's handle on the react-query client.
 *
 * The client is created in main.tsx and the auth store must not import it (the
 * store is imported first, as a side effect, before the client exists), so
 * main.tsx binds it here and the store calls these two functions.
 *
 * Why the data layer has to stop when the session ends (prod 2026-10-22): a rep
 * tapped Start driving, the SDK ended the session, and the queries that were
 * waiting on the token came back 42501 "permission denied" a moment later. They
 * were reported as errors, and with `retry: 1` they would have gone out again.
 */
import type { QueryClient } from "@tanstack/react-query";

let client: QueryClient | null = null;

export function bindQueryClient(next: QueryClient | null): void {
  client = next;
}

/**
 * Call at the moment a session definitively ends. Cancelling with revert makes
 * react-query ignore whatever the in-flight requests return (no onError, so no
 * Sentry event, and no retry). Clearing the query cache then drops every query,
 * so nothing refetches and no rep's data stays in memory for the next sign-in.
 * Mutations are left alone: a write the rep asked for is not ours to forget.
 */
export function haltQueriesForSignOut(): void {
  if (!client) return;
  void client.cancelQueries();
  client.getQueryCache().clear();
}

/**
 * Call when a held session reconnects. Screens that failed while the token
 * could not be refreshed load again on their own instead of leaving the rep on
 * an error state with a working connection. Only errored, active queries:
 * nothing that already has good data is refetched.
 */
export async function refetchFailedQueries(): Promise<void> {
  if (!client) return;
  await client.refetchQueries({
    type: "active",
    predicate: (q) => q.state.status === "error",
  });
}
