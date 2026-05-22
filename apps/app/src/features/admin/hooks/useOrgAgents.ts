/**
 * useOrgAgents — paginated merged view of the org's members.
 *
 * "Member" here = anything that occupies a seat: an active profile, a
 * deactivated (revoked) profile still visible to admins, or a pending
 * invite. Stitched together into a single AgentRow list so the admin
 * agents page can render one table.
 *
 * Deal aggregates (open count + pipeline value) are fetched in a
 * separate query and joined client-side. Reps don't see this page; the
 * admin already has manager-RLS visibility, so the deals query reads
 * org-wide.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";

export const ORG_AGENTS_QUERY_KEY = (
  userId: string | undefined,
  page?: number,
) =>
  page === undefined
    ? (["admin", "agents", userId ?? "anon"] as const)
    : (["admin", "agents", userId ?? "anon", page] as const);

export type AgentStatus = "active" | "invited" | "revoked";

export interface AgentRow {
  id: string;                 // profile id OR invite id
  kind: "profile" | "invite";
  email: string;
  fullName: string | null;
  role: "rep" | "manager" | "admin";
  status: AgentStatus;
  /** For invites: expires_at. For profiles: deactivated_at or null. */
  detail: string | null;
  openDealCount: number;
  pipelineValueCents: number;
  /** ISO timestamp — last activity for profiles, created_at for invites. */
  lastActivity: string | null;
}

export interface UseOrgAgentsResult {
  rows: AgentRow[];
  totalCount: number;
}

const PAGE_SIZE_DEFAULT = 50;

interface ProfileRow {
  id: string;
  email: string;
  full_name: string | null;
  role: "rep" | "manager" | "admin";
  deactivated_at: string | null;
  created_at: string;
}

interface InviteRow {
  id: string;
  email: string;
  full_name: string | null;
  role: "rep" | "manager";
  expires_at: string;
  created_at: string;
}

export function useOrgAgents(opts: { page?: number; pageSize?: number } = {}) {
  const userId = useAuth((s) => s.user?.id);
  const page = opts.page ?? 0;
  const pageSize = opts.pageSize ?? PAGE_SIZE_DEFAULT;

  return useQuery({
    queryKey: ORG_AGENTS_QUERY_KEY(userId, page),
    enabled: Boolean(userId),
    queryFn: async (): Promise<UseOrgAgentsResult> => {
      // 1. Profiles for this page — RLS scopes to caller's org.
      const { data: profiles, error: pErr } = await supabase
        .from("profiles")
        .select("id, email, full_name, role, deactivated_at, created_at")
        .order("created_at", { ascending: false })
        .range(page * pageSize, page * pageSize + pageSize - 1);
      if (pErr) throw pErr;

      // 2. Pending invites — RLS already filters to manager/admin org.
      const { data: invites, error: iErr } = await supabase
        .from("org_invites")
        .select("id, email, full_name, role, expires_at, created_at")
        .is("accepted_at", null)
        .is("revoked_at", null)
        .order("created_at", { ascending: false });
      if (iErr) throw iErr;

      // 3. Deal aggregates per owner. We read all org deals (RLS gives
      //    the admin full view) and aggregate client-side.
      const { data: deals, error: dErr } = await supabase
        .from("deals")
        .select("owner_id, value_cents, stage")
        .neq("stage", "won");
      if (dErr) throw dErr;

      const aggMap = new Map<string, { count: number; total: number }>();
      for (const d of (deals ?? []) as Array<{ owner_id: string; value_cents: number; stage: string }>) {
        const a = aggMap.get(d.owner_id) ?? { count: 0, total: 0 };
        a.count += 1;
        a.total += d.value_cents;
        aggMap.set(d.owner_id, a);
      }

      const rows: AgentRow[] = [];

      for (const p of (profiles ?? []) as unknown as ProfileRow[]) {
        const agg = aggMap.get(p.id) ?? { count: 0, total: 0 };
        rows.push({
          id: p.id,
          kind: "profile",
          email: p.email,
          fullName: p.full_name,
          role: p.role,
          status: p.deactivated_at ? "revoked" : "active",
          detail: p.deactivated_at,
          openDealCount: agg.count,
          pipelineValueCents: agg.total,
          lastActivity: null, // filled later when we add last_active_at column
        });
      }

      for (const i of (invites ?? []) as unknown as InviteRow[]) {
        rows.push({
          id: i.id,
          kind: "invite",
          email: i.email,
          fullName: i.full_name,
          role: i.role,
          status: "invited",
          detail: i.expires_at,
          openDealCount: 0,
          pipelineValueCents: 0,
          lastActivity: i.created_at,
        });
      }

      return { rows, totalCount: rows.length };
    },
    staleTime: 30_000,
  });
}
