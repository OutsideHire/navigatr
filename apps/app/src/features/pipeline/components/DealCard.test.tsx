import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DealCard } from "./DealCard";
import { MOCK_DEALS, type Deal } from "../mockData";

const navigate = vi.fn();
vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
}));

vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: { id: "user-1" } }),
}));
vi.mock("@/features/auth/useProfile", () => ({
  useProfile: () => ({ data: { org_id: "org-1" } }),
}));

function deal(over: Partial<Deal> = {}): Deal {
  return { ...MOCK_DEALS[0], ...over };
}

function renderCard(d: Deal) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <DealCard deal={d} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => navigate.mockClear());

describe("DealCard", () => {
  it("renders company, value, stage pill, contact, and probability", () => {
    renderCard(deal({ companyName: "Acme Corporation", stage: "qualified", probability: 75, contactName: "John Smith" }));
    expect(screen.getByText("Acme Corporation")).toBeInTheDocument();
    expect(screen.getByText("Qualified")).toBeInTheDocument();
    expect(screen.getByText("John Smith")).toBeInTheDocument();
    expect(screen.getByText(/PROBABILITY · 75%/i)).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "75");
  });

  it("renders an email mailto link when email is present", () => {
    renderCard(deal({ email: "john@acme.com" }));
    const mail = screen.getByRole("link", { name: /john@acme\.com/i });
    expect(mail).toHaveAttribute("href", "mailto:john@acme.com");
  });

  it("omits the email link when email is empty", () => {
    renderCard(deal({ email: "" }));
    expect(screen.queryByRole("link", { name: /@/ })).not.toBeInTheDocument();
  });

  it("footer shows the next-step verb plus date when a follow-up is set", () => {
    renderCard(deal({ stage: "contacted", nextFollowup: "2026-04-28" }));
    expect(screen.getByText(/Call back/i)).toBeInTheDocument();
    expect(screen.getByText(/Next:/i)).toBeInTheDocument();
  });

  it("footer shows the verb only when no follow-up date is set", () => {
    renderCard(deal({ stage: "new", nextFollowup: null }));
    expect(screen.getByText(/Reach out/i)).toBeInTheDocument();
  });

  it("shows a 'Follow up: {date}' indicator when a follow-up date is set", () => {
    renderCard(deal({ stage: "contacted", nextFollowup: "2026-08-14T12:00:00.000Z" }));
    // "Follow up:" text is unique to the chip; the date also appears in the
    // footer's "Next: verb · date", so assert the date shows at least once.
    expect(screen.getByText(/Follow up:/i)).toBeInTheDocument();
    expect(screen.getAllByText("Aug 14").length).toBeGreaterThanOrEqual(1);
  });

  it("omits the 'Follow up:' indicator when no follow-up date is set", () => {
    renderCard(deal({ stage: "new", nextFollowup: null }));
    expect(screen.queryByText(/Follow up:/i)).not.toBeInTheDocument();
  });

  it("hides the contact line when it duplicates the company name", () => {
    renderCard(deal({ companyName: "Northwind Traders", contactName: "Northwind Traders" }));
    expect(screen.getAllByText("Northwind Traders")).toHaveLength(1);
  });

  it("renders both company and a distinct contact name", () => {
    renderCard(deal({ companyName: "Northwind Traders", contactName: "Dana Lopez" }));
    expect(screen.getByText("Northwind Traders")).toBeInTheDocument();
    expect(screen.getByText("Dana Lopez")).toBeInTheDocument();
  });

  it("clicking the card navigates to the deal detail", () => {
    renderCard(deal({ id: "d-123", companyName: "Acme Corporation" }));
    fireEvent.click(screen.getByText("Acme Corporation"));
    expect(navigate).toHaveBeenCalledWith("/pipeline/d-123");
  });

  it("clicking the email link does NOT navigate into the card", () => {
    renderCard(deal({ id: "d-123", email: "john@acme.com" }));
    fireEvent.click(screen.getByRole("link", { name: /john@acme\.com/i }));
    expect(navigate).not.toHaveBeenCalled();
  });

  it("clicking the call button does NOT navigate into the card", () => {
    renderCard(deal({ id: "d-123", phone: "+15125550100" }));
    // PhoneWithClickToCall renders a call button labelled "Call <formatted number>".
    fireEvent.click(screen.getByRole("button", { name: /call/i }));
    expect(navigate).not.toHaveBeenCalled();
  });
});
