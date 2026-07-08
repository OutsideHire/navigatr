import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { vi } from "vitest";

import { usePathReminders } from "./usePathReminders";
import type { Path } from "../lib/pathTypes";

let pathsData: Path[] = [];
vi.mock("./usePaths", () => ({
  usePaths: () => ({ data: pathsData, isLoading: false }),
  PATHS_QUERY_KEY: ["paths", "list"],
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function makePath(overrides: Partial<Path> = {}): Path {
  return {
    id: "p1",
    date: "2026-07-01",
    name: "Downtown run",
    originLabel: "Austin, TX",
    originLat: 30,
    originLng: -97,
    status: "planned",
    reminderAt: null,
    startedAt: null,
    stopCount: 3,
    pathCalendarSyncStatus: null,
    ...overrides,
  };
}

beforeEach(() => {
  pathsData = [];
});

describe("usePathReminders", () => {
  it("marks a path due when its reminder_at is in the past", () => {
    pathsData = [makePath({ id: "due", reminderAt: "2026-07-01T13:00:00.000Z" })];
    const { result } = renderHook(
      () => usePathReminders(new Date("2026-07-01T14:00:00.000Z")),
      { wrapper },
    );
    expect(result.current.due.map((p) => p.id)).toEqual(["due"]);
    expect(result.current.count).toBe(1);
  });

  it("does NOT mark a path due when its reminder_at is still in the future", () => {
    pathsData = [makePath({ id: "later", reminderAt: "2026-07-01T15:00:00.000Z" })];
    const { result } = renderHook(
      () => usePathReminders(new Date("2026-07-01T14:00:00.000Z")),
      { wrapper },
    );
    expect(result.current.count).toBe(0);
  });

  it("marks a path due on its date when it has no reminder_at", () => {
    // Use local-day construction so the today-comparison is tz-stable.
    const now = new Date(2026, 6, 1, 9, 0, 0); // Jul 1 2026 local
    pathsData = [makePath({ id: "today", date: "2026-07-01", reminderAt: null })];
    const { result } = renderHook(() => usePathReminders(now), { wrapper });
    expect(result.current.due.map((p) => p.id)).toEqual(["today"]);
  });

  it("does not mark a future-dated path with no reminder due", () => {
    const now = new Date(2026, 6, 1, 9, 0, 0);
    pathsData = [makePath({ id: "future", date: "2026-07-05", reminderAt: null })];
    const { result } = renderHook(() => usePathReminders(now), { wrapper });
    expect(result.current.count).toBe(0);
  });

  it("excludes completed paths even when otherwise due", () => {
    pathsData = [
      makePath({ id: "done", status: "completed", reminderAt: "2026-07-01T13:00:00.000Z" }),
    ];
    const { result } = renderHook(
      () => usePathReminders(new Date("2026-07-01T14:00:00.000Z")),
      { wrapper },
    );
    expect(result.current.count).toBe(0);
  });

  it("falls back to origin label then a generic when unnamed", () => {
    pathsData = [
      makePath({ id: "x", name: null, originLabel: "Edmond, OK", reminderAt: "2026-07-01T13:00:00.000Z" }),
    ];
    const { result } = renderHook(
      () => usePathReminders(new Date("2026-07-01T14:00:00.000Z")),
      { wrapper },
    );
    expect(result.current.due[0].name).toBe("Edmond, OK");
  });
});
