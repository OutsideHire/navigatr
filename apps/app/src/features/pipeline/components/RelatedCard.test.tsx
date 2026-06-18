import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { RelatedCard } from "./RelatedCard";
import { MOCK_DEALS, type Deal } from "../mockData";

function d(over: Partial<Deal>): Deal {
  return { ...MOCK_DEALS[0], ...over };
}

const dealsRef: { list: Deal[] } = { list: [] };
vi.mock("../hooks/useDeals", () => ({ useDeals: () => ({ data: dealsRef.list }) }));

function renderCard(deal: Deal, list: Deal[]) {
  dealsRef.list = list;
  render(<MemoryRouter><RelatedCard deal={deal} /></MemoryRouter>);
}

describe("RelatedCard", () => {
  it("shows other deals for the same company", () => {
    const a = d({ id: "a", companyName: "Acme" });
    const b = d({ id: "b", companyName: "Acme" });
    renderCard(a, [a, b]);
    expect(screen.getByText(/Acme.*other deals \(1\)/i)).toBeInTheDocument();
  });
  it("renders without crashing and shows the playbook row when there are no sibling deals", () => {
    const a = d({ id: "a", companyName: "Acme" });
    renderCard(a, [a]);
    expect(screen.getByText(/playbook/i)).toBeInTheDocument();
    expect(screen.queryByText(/other deals/i)).toBeNull();
  });
});
