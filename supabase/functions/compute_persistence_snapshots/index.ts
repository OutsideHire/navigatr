/**
 * compute_persistence_snapshots: nightly Persistence Index snapshot job
 * (SP-B). Invoked by pg_cron via pg_net. Uses the service-role key to read
 * every org's deals + activities and upsert persistence_index_snapshot /
 * persistence_company_snapshot (bypassing RLS). All logic is in the
 * unit-tested _shared/persistence modules; this file is just I/O. Mirrors
 * compute_coverage_snapshots/index.ts.
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolvePersistenceConfig } from "../_shared/persistence/config.ts";
import { runSnapshots, type SnapshotDeps } from "../_shared/persistence/runSnapshots.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function makeDeps(db: SupabaseClient): SnapshotDeps {
  return {
    async listOrgs() {
      const { data, error } = await db.from("organizations").select("id, persistence_index_config");
      if (error) throw error;
      return (data ?? []).map((o) => ({
        id: o.id as string,
        config: resolvePersistenceConfig(o.persistence_index_config),
      }));
    },
    async listRepIds(orgId) {
      const { data, error } = await db.from("deals").select("owner_id").eq("org_id", orgId);
      if (error) throw error;
      return [
        ...new Set(
          (data ?? [])
            .map((r) => r.owner_id as string | null)
            .filter((x): x is string => x != null),
        ),
      ];
    },
    async fetchOrgDeals(orgId) {
      const { data, error } = await db.from("deals").select("id, owner_id, stage").eq("org_id", orgId);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id as string,
        owner_id: r.owner_id as string | null,
        stage: r.stage as string,
      }));
    },
    async fetchOrgActivities(orgId) {
      // activities.org_id is trigger-enforced to mirror the parent deal's org
      // (activities_enforce_org_consistency_trg), so we can filter directly.
      const { data, error } = await db
        .from("activities")
        .select("deal_id, occurred_at, follow_up_date")
        .eq("org_id", orgId);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        dealId: r.deal_id as string,
        occurredAt: r.occurred_at as string,
        followUpDate: r.follow_up_date as string | null,
      }));
    },
    async upsertRepSnapshot(row) {
      const { error } = await db
        .from("persistence_index_snapshot")
        .upsert(row, { onConflict: "user_id,snapshot_date" });
      if (error) throw error;
    },
    async upsertCompanySnapshot(row) {
      const { error } = await db
        .from("persistence_company_snapshot")
        .upsert(row, { onConflict: "org_id,snapshot_date" });
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
