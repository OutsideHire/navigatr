import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScopeMetricStrip } from "./ScopeMetricStrip";

describe("ScopeMetricStrip", () => {
  it("renders each metric label and value", () => {
    render(<ScopeMetricStrip metrics={[{ label: "Revenue won", value: "$486K" }, { label: "Touches per win", value: "10.5" }]} />);
    expect(screen.getByText("Revenue won")).toBeInTheDocument();
    expect(screen.getByText("$486K")).toBeInTheDocument();
    expect(screen.getByText("10.5")).toBeInTheDocument();
  });
});
