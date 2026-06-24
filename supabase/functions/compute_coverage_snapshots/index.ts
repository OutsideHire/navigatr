/**
 * compute_coverage_snapshots — nightly Activity Logging Coverage snapshot job
 * (SP1). Invoked by pg_cron via pg_net. Uses the service-role key to read every
 * rep's dials + calls and upsert coverage_snapshot (bypassing RLS). All logic
 * is in the unit-tested _shared/coverage modules; this file is just I/O.
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveCoverageConfig } from "../_shared/coverage/config.ts";
import { runSnapshots, type SnapshotDeps } from "../_shared/coverage/runSnapshots.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function makeDeps(db: SupabaseClient): SnapshotDeps {
  return {
    async listOrgs() {
      const { data, error } = await db.from("organizations").select("id, coverage_config");
      if (error) throw error;
      return (data ?? []).map((o) => ({ id: o.id as string, config: resolveCoverageConfig(o.coverage_config) }));
    },
    async listRepIdsWithDials(orgId, windowStartDate) {
      const { data, error } = await db
        .from("coverage_signal")
        .select("user_id")
        .eq("org_id", orgId)
        .eq("channel", "phone")
        .eq("signal_type", "dial")
        .gte("detected_at", windowStartDate);
      if (error) throw error;
      return [...new Set((data ?? []).map((r) => r.user_id as string))];
    },
    async fetchRepDials(userId, windowStartDate) {
      const { data, error } = await db
        .from("coverage_signal")
        .select("deal_id, detected_at")
        .eq("user_id", userId)
        .eq("channel", "phone")
        .eq("signal_type", "dial")
        .gte("detected_at", windowStartDate);
      if (error) throw error;
      return (data ?? []).map((r) => ({ dealId: r.deal_id as string, detectedAt: r.detected_at as string }));
    },
    async fetchRepCalls(userId, windowStartDate) {
      const { data, error } = await db
        .from("activities")
        .select("deal_id, occurred_at")
        .eq("logged_by", userId)
        .eq("type", "call")
        .gte("occurred_at", windowStartDate);
      if (error) throw error;
      return (data ?? []).map((r) => ({ dealId: r.deal_id as string, occurredAt: r.occurred_at as string }));
    },
    async upsertSnapshot(row) {
      const { error } = await db.from("coverage_snapshot").upsert(row, { onConflict: "user_id,snapshot_date" });
      if (error) throw error;
    },
    log(message) {
      console.log(message);
    },
  };
}

Deno.serve(async () => {
  try {
    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const summary = await runSnapshots(makeDeps(db), new Date());
    return new Response(JSON.stringify(summary), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
