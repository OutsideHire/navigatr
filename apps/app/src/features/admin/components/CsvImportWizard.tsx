/**
 * CsvImportWizard — 4-step flow for inviting 100s-1000s of agents.
 *
 * Steps:
 *  1. Upload — drag/drop or file-picker. Client-side parse.
 *  2. Preview — show counts of valid / invalid rows.
 *  3. Submit — chunk into 200-row batches; POST to admin_bulk_invite;
 *              kick off email sends; show progress.
 *  4. Done — summary with downloadable error list.
 *
 * Keeping the steps in one file (rather than separate routes) because
 * the parsed CSV state needs to survive between them and routing
 * persistence is overkill.
 */
import * as React from "react";
import { Upload, Check, X, AlertTriangle, Download } from "lucide-react";
import { Button } from "@/components/navigatr";
import { parseAgentsCsv, type ParsedAgent, type ParseError } from "../utils/parseAgentsCsv";
import { useAdminBulkInvite, type InviteResult, type InviteInput } from "../hooks/useAdminBulkInvite";
import { useSendInviteEmails } from "../hooks/useSendInviteEmails";
import { RoleMappingReview } from "./RoleMappingReview";

const CHUNK_SIZE = 200;

type Step = "upload" | "review" | "submitting" | "done";

interface FinalResult {
  invited: number;
  skipped: number;
  failed: number;
  emailsFailed: number;
  failedRows: Array<{ email: string; error: string }>;
}

export function CsvImportWizard() {
  const [step, setStep] = React.useState<Step>("upload");
  const [parsed, setParsed] = React.useState<{ valid: ParsedAgent[]; errors: ParseError[] }>({ valid: [], errors: [] });
  const [progress, setProgress] = React.useState({ done: 0, total: 0 });
  const [finalResult, setFinalResult] = React.useState<FinalResult | null>(null);

  const bulkInvite = useAdminBulkInvite();
  const sendEmails = useSendInviteEmails();

  const onFile = async (file: File) => {
    const text = await file.text();
    const result = parseAgentsCsv(text);
    setParsed(result);
    setStep("review");
  };

  // Receives the invite rows after the admin has mapped every role to a level.
  const onConfirm = async (rows: InviteInput[]) => {
    setStep("submitting");
    const total = rows.length;
    setProgress({ done: 0, total });

    const allResults: InviteResult[] = [];
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      try {
        const r = await bulkInvite.mutateAsync(chunk);
        allResults.push(...r);
      } catch (err) {
        // Treat all rows in this chunk as failed if the RPC throws.
        for (const row of chunk) {
          allResults.push({ email: row.email, id: null, ok: false, error: (err instanceof Error ? err.message : "rpc_failed") });
        }
      }
      setProgress({ done: Math.min(i + chunk.length, total), total });
    }

    // Fire emails for successful inserts. Delivery is best-effort: a throw
    // (edge function down) means none of them emailed; otherwise count the
    // ids whose result came back ok:false or missing. The invites still exist.
    const ids = allResults.filter((r) => r.ok && r.id).map((r) => r.id!);
    let emailsFailed = 0;
    if (ids.length > 0) {
      try {
        const emailResults = await sendEmails.mutateAsync(ids);
        const okIds = new Set(emailResults.filter((e) => e.ok).map((e) => e.id));
        emailsFailed = ids.filter((id) => !okIds.has(id)).length;
      } catch {
        emailsFailed = ids.length; // admin can resend from the Team page
      }
    }

    const invited = allResults.filter((r) => r.ok).length;
    const failedRows = allResults.filter((r) => !r.ok).map((r) => ({ email: r.email, error: r.error ?? "unknown" }));
    setFinalResult({ invited, skipped: parsed.errors.length, failed: failedRows.length, emailsFailed, failedRows });
    setStep("done");
  };

  // ---- step renderers ----
  if (step === "upload") {
    return (
      <div className="rounded-radius-md border border-dashed border-border-default p-8 text-center">
        <Upload className="mx-auto h-8 w-8 text-text-muted" aria-hidden />
        <h2 className="mt-3 text-heading-sm">Upload an agents CSV</h2>
        <p className="mt-1 text-body-md text-text-muted">
          Required column: <code>email</code>. Optional: <code>full_name</code>,{" "}
          <code>role_level</code> (one of the 7 role levels),{" "}
          <code>reports_to_email</code> (an existing member's email).
        </p>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }}
          className="mt-4 block mx-auto"
        />
        <a href="/sample-agents.csv" download className="mt-3 inline-flex items-center gap-1 text-brand-primary underline">
          <Download className="h-4 w-4" /> Sample template
        </a>
      </div>
    );
  }

  if (step === "review") {
    return (
      <RoleMappingReview
        valid={parsed.valid}
        errors={parsed.errors}
        onBack={() => setStep("upload")}
        onConfirm={onConfirm}
      />
    );
  }

  if (step === "submitting") {
    const pct = progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100);
    return (
      <div className="rounded-radius-md border border-border-default p-6 text-center">
        <h2 className="text-heading-sm">Sending invites…</h2>
        <div className="mx-auto mt-4 h-3 max-w-md overflow-hidden rounded-radius-full bg-surface-sunken">
          <div className="h-full bg-brand-primary" style={{ width: `${pct}%` }} aria-hidden />
        </div>
        <p className="mt-2 text-body-md text-text-muted">{progress.done} / {progress.total}</p>
      </div>
    );
  }

  // done
  const r = finalResult!;
  const downloadFailures = () => {
    const csv = "email,error\n" + r.failedRows.map((f) => `${f.email},${f.error}`).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = "import-failures.csv"; a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="space-y-3 rounded-radius-md border border-border-default p-6">
      <h2 className="text-heading-sm">Import complete</h2>
      <ul className="space-y-1 text-body-md">
        <li className="flex items-center gap-2"><Check className="h-4 w-4 text-status-success" /> {r.invited} invites sent</li>
        {r.skipped > 0 && <li className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-status-warning" /> {r.skipped} skipped (invalid rows in CSV)</li>}
        {r.failed > 0 && <li className="flex items-center gap-2"><X className="h-4 w-4 text-status-danger" /> {r.failed} failed at server (already-invited / over cap)</li>}
        {r.emailsFailed > 0 && <li className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-status-warning" /> {r.emailsFailed} invite(s) created but their emails could not be sent - resend from the Team page.</li>}
      </ul>
      <div className="flex gap-2">
        {r.failed > 0 && <Button variant="secondary" size="md" onClick={downloadFailures}>Download failures CSV</Button>}
        <Button variant="primary" size="md" onClick={() => { setStep("upload"); setParsed({ valid: [], errors: [] }); setFinalResult(null); }}>
          Import another file
        </Button>
      </div>
    </div>
  );
}
