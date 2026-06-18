import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { ReferralSection } from "./ReferralSection";
import { MOCK_DEALS, formatMoney } from "@/features/pipeline/mockData";

// Capture navigate calls from the row's onClick.
const navigateSpy = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigateSpy };
});

// Radix Select needs these in jsdom:
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
    Element.prototype.scrollIntoView = () => {};
  }
});

beforeEach(() => {
  navigateSpy.mockReset();
});

const dealA = MOCK_DEALS[0];
const dealB = MOCK_DEALS[1];
const eligible = MOCK_DEALS.slice(2, 5).map((d) => ({
  value: d.id,
  label: `${d.companyName} · ${formatMoney(d.valueCents)}`,
}));

function renderSection(props: Partial<React.ComponentProps<typeof ReferralSection>> = {}) {
  const onAdd = props.onAdd ?? vi.fn().mockResolvedValue(undefined);
  const onRemove = props.onRemove ?? vi.fn().mockResolvedValue(undefined);
  render(
    <MemoryRouter>
      <ReferralSection
        title="Referrals"
        deals={[dealA, dealB]}
        eligibleOptions={eligible}
        addLabel="Attach deal"
        onAdd={onAdd}
        onRemove={onRemove}
        {...props}
      />
    </MemoryRouter>,
  );
  return { onAdd, onRemove };
}

describe("ReferralSection", () => {
  it("renders the title and a row per deal with company name + formatted value", () => {
    renderSection();
    expect(screen.getByText(/Referrals · 2/)).toBeInTheDocument();
    expect(screen.getByText(dealA.companyName)).toBeInTheDocument();
    expect(screen.getByText(dealB.companyName)).toBeInTheDocument();
    expect(screen.getByText(formatMoney(dealA.valueCents))).toBeInTheDocument();
    expect(screen.getByText(formatMoney(dealB.valueCents))).toBeInTheDocument();
  });

  it("shows emptyText when deals is empty", () => {
    renderSection({ deals: [], emptyText: "Nothing here yet." });
    expect(screen.getByText("Nothing here yet.")).toBeInTheDocument();
  });

  it("clicking the add button reveals the picker; selecting a value + confirming calls onAdd(value)", () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    renderSection({ onAdd });

    fireEvent.click(screen.getByRole("button", { name: /attach deal/i }));

    // Picker is now visible: open the Radix select and pick the first option.
    const combobox = screen.getByRole("combobox");
    fireEvent.click(combobox);
    fireEvent.click(screen.getByRole("option", { name: eligible[0].label }));

    // Confirm button labelled "Attach" / "Attaching…"
    fireEvent.click(screen.getByRole("button", { name: /^attach/i }));

    expect(onAdd).toHaveBeenCalledWith(eligible[0].value);
  });

  it("clicking a deal row's remove button calls onRemove(deal.id)", () => {
    const onRemove = vi.fn().mockResolvedValue(undefined);
    renderSection({ onRemove });

    const removeBtn = screen.getByRole("button", {
      name: new RegExp(`remove .*${dealA.companyName}`, "i"),
    });
    fireEvent.click(removeBtn);

    expect(onRemove).toHaveBeenCalledWith(dealA.id);
  });

  it("clicking a deal row navigates to /pipeline/:id", () => {
    renderSection();
    const row = screen.getByText(dealA.companyName).closest("button")!;
    fireEvent.click(row);
    expect(navigateSpy).toHaveBeenCalledWith(`/pipeline/${dealA.id}`);
  });
});
