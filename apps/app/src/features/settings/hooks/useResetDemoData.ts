/**
 * useResetDemoData — wipes + reseeds a demo account via the
 * reset_demo_data RPC (gated server-side on the demo_reset org_features
 * flag + admin role). On success, clears the entire query cache so every
 * screen refetches the freshly reseeded data.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export function useResetDemoData() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<void> => {
      const { error } = await supabase.rpc("reset_demo_data");
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.clear();
    },
  });
}
