/**
 * QualificationTab — FR-PIPE-08 read view.
 *
 * Renders the Merchant Services qualification captured on
 * deals.profession_data as labelled rows (text-caption uppercase label +
 * text-body-md value), mirroring the other Deal-Detail cards. When no
 * qualification is present, shows an empty state. Always offers an
 * "Edit qualification" CTA that opens the edit sheet (wired by the page).
 */

import { Button, Card } from "@/components/navigatr";
import {
  ACCEPTANCE_METHOD_LABELS,
  readMerchantQualification,
} from "../lib/merchantQualification";
import type { Deal } from "../mockData";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-caption uppercase text-text-subtle">{label}</span>
      <span className="text-body-md text-text-default">{children}</span>
    </div>
  );
}

export function QualificationTab({ deal, onEdit }: { deal: Deal; onEdit: () => void }) {
  const q = readMerchantQualification(deal.professionData);

  if (!q) {
    return (
      <Card padding="md" className="flex flex-col gap-4">
        <p className="text-body-md text-text-muted">No qualification captured yet.</p>
        <Button variant="secondary" onClick={onEdit}>Edit qualification</Button>
      </Card>
    );
  }

  return (
    <Card padding="md" className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Row label="Annual volume">
          {q.annualVolume !== undefined ? `$${q.annualVolume.toLocaleString()}` : "—"}
        </Row>
        <Row label="Acceptance methods">
          {q.acceptanceMethods.length > 0 ? (
            <span className="flex flex-wrap gap-1.5">
              {q.acceptanceMethods.map((m) => (
                <span
                  key={m}
                  className="rounded-radius-full bg-surface-sunken px-2 py-0.5 text-caption text-text-default"
                >
                  {ACCEPTANCE_METHOD_LABELS[m] ?? m}
                </span>
              ))}
            </span>
          ) : (
            "—"
          )}
        </Row>
        <Row label="Current processor">{q.currentProcessor ?? "—"}</Row>
        <Row label="Current effective rate">
          {q.currentEffectiveRate !== undefined ? `${q.currentEffectiveRate}%` : "—"}
        </Row>
        <Row label="POS / terminal">{q.posTerminal ?? "—"}</Row>
        <Row label="Avg ticket size">
          {q.avgTicketSize !== undefined ? `$${q.avgTicketSize}` : "—"}
        </Row>
      </div>
      <Button variant="secondary" onClick={onEdit}>Edit qualification</Button>
    </Card>
  );
}

export default QualificationTab;
