/**
 * When the session ends, the data layer must stop: no refetch, no retry, no
 * error report for a query that only failed because the session vanished
 * under it (prod 2026-10-22: three 42501s in the second after a rep was sent
 * to /login). And when a held session reconnects, the screens that failed
 * while it was reconnecting should load again on their own.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { QueryClient, QueryCache, QueryObserver } from "@tanstack/react-query";
import { bindQueryClient, haltQueriesForSignOut, refetchFailedQueries } from "./sessionQueries";

afterEach(() => bindQueryClient(null));

function client(onError = vi.fn()) {
  return {
    onError,
    qc: new QueryClient({
      queryCache: new QueryCache({ onError }),
      defaultOptions: { queries: { retry: 1, retryDelay: 1 } },
    }),
  };
}

describe("haltQueriesForSignOut", () => {
  it("cancels an in-flight query without reporting it as an error", async () => {
    const { qc, onError } = client();
    bindQueryClient(qc);
    let reject!: (e: unknown) => void;
    const fetching = qc
      .fetchQuery({
        queryKey: ["paths"],
        queryFn: () => new Promise((_r, j) => { reject = j; }),
      })
      .catch(() => undefined);

    haltQueriesForSignOut();
    // The request it was waiting on comes back denied after the session ended.
    reject({ code: "42501", message: "permission denied for table paths", details: null, hint: null });
    await fetching;

    expect(onError).not.toHaveBeenCalled();
  });

  it("empties the query cache so nothing refetches and no data outlives the session", async () => {
    const { qc } = client();
    bindQueryClient(qc);
    qc.setQueryData(["deals"], [{ id: 1 }]);

    haltQueriesForSignOut();

    expect(qc.getQueryCache().getAll()).toHaveLength(0);
  });

  it("does nothing (and does not throw) before a client is bound", () => {
    expect(() => haltQueriesForSignOut()).not.toThrow();
  });
});

describe("refetchFailedQueries", () => {
  it("refetches only the queries that ended in error", async () => {
    const { qc } = client();
    bindQueryClient(qc);
    const failed = vi.fn().mockRejectedValueOnce(new Error("anon")).mockResolvedValue("ok");
    const fine = vi.fn().mockResolvedValue("fine");
    // Both are on screen (observed), as they would be under a mounted page.
    const a = new QueryObserver(qc, { queryKey: ["failed"], queryFn: failed, retry: 0 });
    const b = new QueryObserver(qc, { queryKey: ["fine"], queryFn: fine });
    const unsubA = a.subscribe(() => {});
    const unsubB = b.subscribe(() => {});
    await vi.waitFor(() => expect(a.getCurrentResult().status).toBe("error"));
    await vi.waitFor(() => expect(b.getCurrentResult().status).toBe("success"));

    await refetchFailedQueries();

    expect(failed).toHaveBeenCalledTimes(2);
    expect(fine).toHaveBeenCalledTimes(1);
    expect(qc.getQueryData(["failed"])).toBe("ok");
    unsubA();
    unsubB();
  });
});
