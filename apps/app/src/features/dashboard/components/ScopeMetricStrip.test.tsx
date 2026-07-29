import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScopeMetricStrip } from "./ScopeMetricStrip";

describe("ScopeMetricStrip", () => {
  it("renders each card's label, value, and sub-label", () => {
    render(
      <ScopeMetricStrip
        cards={[
          { label: "Revenue won", value: "$486K", sub: "6 deals closed" },
          { label: "Touches per win", value: "10.5", sub: "All activity divided by wins" },
        ]}
      />,
    );
    expect(screen.getByText("Revenue won")).toBeInTheDocument();
    expect(screen.getByText("$486K")).toBeInTheDocument();
    expect(screen.getByText("6 deals closed")).toBeInTheDocument();
    expect(screen.getByText("Touches per win")).toBeInTheDocument();
    expect(screen.getByText("10.5")).toBeInTheDocument();
  });

  it("renders a flagged card (effort not converted)", () => {
    render(<ScopeMetricStrip cards={[{ label: "Effort not converted", value: "29", sub: "46% of all activity", flag: true }]} />);
    expect(screen.getByText("Effort not converted")).toBeInTheDocument();
    expect(screen.getByText("29")).toBeInTheDocument();
  });
});
