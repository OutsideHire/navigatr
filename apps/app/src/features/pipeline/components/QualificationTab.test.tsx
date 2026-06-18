import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QualificationTab } from "./QualificationTab";
import { MOCK_DEALS, type Deal } from "../mockData";

function deal(over: Partial<Deal> = {}): Deal { return { ...MOCK_DEALS[0], ...over }; }

describe("QualificationTab", () => {
  it("renders merchant fields when profession_data is present", () => {
    render(<QualificationTab onEdit={vi.fn()} deal={deal({ professionData: {
      profession: "merchant_services", annualVolume: 500000, acceptanceMethods: ["card_present"],
      currentProcessor: "Square", currentEffectiveRate: 2.6, posTerminal: "Clover", avgTicketSize: 45,
    } })} />);
    expect(screen.getByText(/current processor/i)).toBeInTheDocument();
    expect(screen.getByText("Square")).toBeInTheDocument();
    expect(screen.getByText(/card present/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /edit qualification/i })).toBeInTheDocument();
  });
  it("renders an empty state when there is no qualification", () => {
    render(<QualificationTab onEdit={vi.fn()} deal={deal({ professionData: null })} />);
    expect(screen.getByText(/no qualification captured/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /edit qualification/i })).toBeInTheDocument();
  });
});
