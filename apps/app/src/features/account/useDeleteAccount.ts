/**
 * useDeleteAccount — calls the request_account_deletion RPC and signs
 * the user out on success.
 *
 * The RPC anonymizes the user's profile + auth metadata (see migration
 * 20260529000002_account_deletion). After it returns, the JWT in the
 * browser is still valid but points at a now-anonymized profile. We
 * call supabase.auth.signOut() to drop the session, then redirect to
 * /login. The next sign-in attempt with the original email will fail
 * (the email was changed to deleted+rand@deleted.local).
 */
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";

interface DeletionResult {
  status: string;
  anonymized_at: string;
}

export function useDeleteAccount() {
  const navigate = useNavigate();
  const signOut = useAuth((s) => s.signOut);

  return useMutation<DeletionResult, Error, void>({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("request_account_deletion");
      if (error) throw new Error(error.message);
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) throw new Error("request_account_deletion returned no row");
      return row as DeletionResult;
    },
    onSuccess: async () => {
      // Drop the session, then bounce to /login. The user can't sign
      // back in — their email has been anonymized.
      try {
        await signOut();
      } catch {
        // Sign-out can fail if the JWT is already invalid (rare); the
        // navigate below still gets them off the protected screens.
      }
      navigate("/login", { replace: true });
    },
  });
}
