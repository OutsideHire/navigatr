import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PartnerProfileChange } from "../hooks/usePartnerProfileChanges";

const state: { data: PartnerProfileChange[] | undefined } = { data: undefined };
vi.mock("../hooks/usePartnerProfileChanges", () => ({ usePartnerProfileChanges: () => state }));

import { PartnerProfileChanges, describeProfileChange } from "./PartnerProfileChanges";

beforeEach(() => {
  state.data = undefined;
});

describe("describeProfileChange", () => {
  it("says what the partner changed in the portal", () => {
    const base = { id: "c", oldValue: null, changedAt: "2026-10-16T12:00:00Z" };
    expect(describeProfileChange({ ...base, field: "name", newValue: "Jane Smith" })).toBe(
      "Partner changed their name to Jane Smith in the portal",
    );
    expect(describeProfileChange({ ...base, field: "phone", newValue: "(555) 010-0100" })).toBe(
      "Partner changed their phone to (555) 010-0100 in the portal",
    );
    expect(describeProfileChange({ ...base, field: "phone", newValue: null })).toBe("Partner removed their phone in the portal");
  });
});

describe("PartnerProfileChanges", () => {
  it("is hidden when the partner changed nothing", () => {
    state.data = [];
    const { container } = render(<PartnerProfileChanges partnerId="p-1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists the latest changes with their dates", () => {
    state.data = [
      { id: "c-1", field: "name", oldValue: "Jane CPA", newValue: "Jane Smith", changedAt: "2026-10-16T12:00:00Z" },
    ];
    render(<PartnerProfileChanges partnerId="p-1" />);
    expect(screen.getByText("Partner changed their name to Jane Smith in the portal · Oct 16")).toBeInTheDocument();
  });

  it("skips changes whose values were erased with the portal data", () => {
    state.data = [{ id: "c-1", field: "name", oldValue: null, newValue: null, changedAt: "2026-10-16T12:00:00Z" }];
    const { container } = render(<PartnerProfileChanges partnerId="p-1" />);
    expect(container).toBeEmptyDOMElement();
  });
});
