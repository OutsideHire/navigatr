import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { SellerFilter, ALL_SELLERS } from "./SellerFilter";

// Radix Select uses pointer APIs jsdom lacks; only needed if we open the menu.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

const sellers = [
  { id: "s1", name: "Dana Lopez" },
  { id: "s2", name: "Priya Shah" },
];

describe("SellerFilter", () => {
  it("shows 'All sellers' on the trigger when nothing is selected", () => {
    render(<SellerFilter sellers={sellers} value={null} onChange={vi.fn()} />);
    expect(screen.getByText("All sellers")).toBeInTheDocument();
  });

  it("shows the selected seller's name on the trigger", () => {
    render(<SellerFilter sellers={sellers} value="s1" onChange={vi.fn()} />);
    expect(screen.getByText("Dana Lopez")).toBeInTheDocument();
  });

  it("exposes ALL_SELLERS as the clear sentinel (mapped to null by the page)", () => {
    // The component maps the sentinel back to null in onValueChange; the page
    // never receives the sentinel string. Guard the contract value here.
    expect(ALL_SELLERS).toBe("__all_sellers__");
  });
});
