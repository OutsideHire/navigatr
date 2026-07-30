import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { ReferralPreviewSheet } from "./ReferralPreviewSheet";
import { formatMoney, formatShortDate, STAGE_LABEL, type Deal } from "@/features/pipeline/mockData";

const navigateSpy = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigateSpy };
});

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

beforeEach(() => navigateSpy.mockReset());

function deal(overrides: Partial<Deal> = {}): Deal {
  return {
    id: "d-1",
    companyName: "Acme Corp",
    contactName: "Jane Doe",
    phone: "+15125552222",
    email: "jane@acme.com",
    valueCents: 4_200_000,
    stage: "qualified",
    probability: 60,
    lastActivity: "2026-07-10T12:00:00.000Z",
    nextFollowup: "2026-07-20T12:00:00.000Z",
    address: null,
    employeeCountRange: "10-49",
    leadSource: "partner_referral",
    updatedAt: "2026-07-10T12:00:00.000Z",
    owner_id: null,
    lostReasonCategory: null,
    lostReasonNotes: null,
    ...overrides,
  };
}

function renderSheet(d: Deal | null, open = true) {
  const onOpenChange = vi.fn();
  render(
    <MemoryRouter>
      <ReferralPreviewSheet deal={d} open={open} onOpenChange={onOpenChange} />
    </MemoryRouter>,
  );
  return { onOpenChange };
}

describe("ReferralPreviewSheet", () => {
  it("renders the deal's key details", () => {
    renderSheet(deal());
    expect(screen.getByText("Acme Corp")).toBeInTheDocument();
    expect(screen.getByText(STAGE_LABEL.qualified)).toBeInTheDocument();
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(screen.getByText(formatMoney(4_200_000))).toBeInTheDocument();
    expect(screen.getByText("60%")).toBeInTheDocument();
    expect(screen.getByText("Partner Referral")).toBeInTheDocument();
    expect(screen.getByText(formatShortDate("2026-07-20T12:00:00.000Z"))).toBeInTheDocument();
  });

  it("'Open in Pipeline' navigates to the deal's pipeline record", () => {
    renderSheet(deal({ id: "d-77" }));
    fireEvent.click(screen.getByRole("button", { name: /Open in Pipeline/i }));
    expect(navigateSpy).toHaveBeenCalledWith("/pipeline/d-77");
  });

  it("Close invokes onOpenChange(false)", () => {
    const { onOpenChange } = renderSheet(deal());
    // Two "Close"-named buttons exist (header icon has aria-label="Close",
    // footer has visible text). getByText targets the footer button uniquely.
    fireEvent.click(screen.getByText("Close"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows a dash for a missing follow-up", () => {
    renderSheet(deal({ nextFollowup: null }));
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("falls back to a generic title and hides the body when deal is null (panel open)", () => {
    // open=true so Radix actually mounts the content and the null guards run
    // (a closed dialog mounts nothing, which wouldn't exercise them).
    renderSheet(null, true);
    expect(screen.getByText("Referral")).toBeInTheDocument();
    expect(screen.queryByText("Jane Doe")).not.toBeInTheDocument();
    expect(screen.queryByText(formatMoney(4_200_000))).not.toBeInTheDocument();
  });
});
