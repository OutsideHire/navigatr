import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { usePersistenceBenchmarks } from "./usePersistenceBenchmarks";

let mockRows: any[] = [];
let mockRole: string | undefined = "manager";
vi.mock("./usePerRepPersistence", () => ({ usePerRepPersistence: () => mockRows }));
vi.mock("@/features/auth/useProfile", () => ({ useProfile: () => ({ data: { role: mockRole } }) }));

describe("usePersistenceBenchmarks", () => {
  it("derives benchmarks, peer sub-component averages, and a scope label", () => {
    mockRows = [
      { ownerId: "a", composite: 60, followUpPoints: 20, cadencePoints: 15 },
      { ownerId: "b", composite: 80, followUpPoints: 40, cadencePoints: 30 },
    ];
    mockRole = "manager";
    const { result } = renderHook(() => usePersistenceBenchmarks());
    expect(result.current.peerAvg).toBe(70);
    expect(result.current.strategy).toBe("small");
    expect(result.current.followUpAvgPct).toBe(75);
    expect(result.current.avgLabel).toBe("Team average");
  });
  it("solo for a single rep (rep scope)", () => {
    mockRows = [{ ownerId: "a", composite: 70, followUpPoints: 30, cadencePoints: 20 }];
    const { result } = renderHook(() => usePersistenceBenchmarks());
    expect(result.current.strategy).toBe("solo");
  });
});
