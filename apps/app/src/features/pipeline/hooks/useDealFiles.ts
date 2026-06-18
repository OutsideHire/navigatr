import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { uploadDealFile, removeDealFile } from "../lib/dealFileStorage";
import { validateFile } from "../lib/dealFileValidation";

export interface DealFile {
  id: string;
  dealId: string;
  path: string;
  name: string;
  sizeBytes: number;
  contentType: string | null;
  uploadedBy: string;
  createdAt: string;
}
interface DealFileRow {
  id: string;
  deal_id: string;
  path: string;
  name: string;
  size_bytes: number;
  content_type: string | null;
  uploaded_by: string;
  created_at: string;
}
const toFile = (r: DealFileRow): DealFile => ({
  id: r.id,
  dealId: r.deal_id,
  path: r.path,
  name: r.name,
  sizeBytes: r.size_bytes,
  contentType: r.content_type,
  uploadedBy: r.uploaded_by,
  createdAt: r.created_at,
});
export const DEAL_FILES_KEY = (dealId: string) => ["deal-files", dealId] as const;

export function useDealFiles(dealId: string) {
  return useQuery({
    queryKey: DEAL_FILES_KEY(dealId),
    queryFn: async (): Promise<DealFile[]> => {
      const { data, error } = await supabase
        .from("deal_files")
        .select("*")
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data as DealFileRow[]).map(toFile);
    },
    enabled: !!dealId,
  });
}

export function useUploadDealFile() {
  const qc = useQueryClient();
  const userId = useAuth((s) => s.user?.id);
  return useMutation({
    mutationFn: async ({ dealId, file }: { dealId: string; file: File }) => {
      if (!userId) throw new Error("Not signed in");
      const v = validateFile(file);
      if (!v.ok) throw new Error(v.reason);
      const path = await uploadDealFile(file, dealId);
      const { error } = await supabase.from("deal_files").insert({
        deal_id: dealId,
        path,
        name: file.name,
        size_bytes: file.size,
        content_type: file.type || null,
        uploaded_by: userId,
      });
      if (error) {
        try {
          await removeDealFile(path);
        } catch {
          /* best-effort orphan cleanup */
        }
        throw error;
      }
    },
    onSuccess: (_r, v) => {
      void qc.invalidateQueries({ queryKey: DEAL_FILES_KEY(v.dealId) });
    },
  });
}

export function useDeleteDealFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, path }: { id: string; dealId: string; path: string }) => {
      const { error } = await supabase.from("deal_files").delete().eq("id", id);
      if (error) throw error;
      await removeDealFile(path);
    },
    onSuccess: (_r, v) => {
      void qc.invalidateQueries({ queryKey: DEAL_FILES_KEY(v.dealId) });
    },
  });
}
