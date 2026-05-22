// Stub — full implementation lands in Task 5.
export const ORG_AGENTS_QUERY_KEY = (userId: string | undefined) =>
  ["admin", "agents", userId ?? "anon"] as const;
