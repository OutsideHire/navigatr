/**
 * usePersistenceBenchmarks: peer benchmarks + sub-component peer averages for
 * the Persistence Index detail page, computed client-side across the reps the
 * viewer can see (RLS-scoped via usePerRepPersistence). A rep sees only
 * themselves -> "solo" (no peer benchmark); managers/admins get team/company
 * benchmarks. True tenant-wide server benchmarks are a later slice.
 */
import * as React from "react";
import { useProfile } from "@/features/auth/useProfile";
import { usePerRepPersistence } from "./usePerRepPersistence";
import {
  persistenceBenchmarks,
  subComponentPeerAverages,
  benchmarkAvgLabel,
  type BenchmarkResult,
} from "../lib/persistenceIndex";

export interface PersistenceBenchmarks extends BenchmarkResult {
  followUpAvgPct: number | null;
  cadenceAvgPct: number | null;
  avgLabel: string;
}

export function usePersistenceBenchmarks(): PersistenceBenchmarks {
  const rows = usePerRepPersistence();
  const role = useProfile().data?.role;
  return React.useMemo(() => {
    const base = persistenceBenchmarks(rows.map((r) => r.composite));
    const sub = subComponentPeerAverages(rows);
    return {
      ...base,
      followUpAvgPct: sub.followUpAvgPct,
      cadenceAvgPct: sub.cadenceAvgPct,
      avgLabel: benchmarkAvgLabel(role),
    };
  }, [rows, role]);
}
