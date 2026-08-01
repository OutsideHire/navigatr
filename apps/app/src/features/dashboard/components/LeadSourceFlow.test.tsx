import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import {
  LeadSourceFlow,
  roundedShares,
  groupLongTail,
  computeFlowLayout,
  ribbonPath,
} from "./LeadSourceFlow";
import {
  leadSourceFlowFixture,
  leadSourceFlowEmptyFixture,
  leadSourceFlowNoRevenueFixture,
  leadSourceFlowLeadsNoRevenueFixture,
  leadSourceFlowRevenueNoLeadsFixture,
  leadSourceFlowSingleFixture,
  leadSourceFlowLongTailFixture,
  leadSourceFlowThreeFixture,
} from "./leadSourceFlow.fixtures";

describe("share math + rounding-remainder rule (§6.6, §10)", () => {
  it("rounds lead shares and absorbs the remainder into the largest (Path)", () => {
    const shares = roundedShares(leadSourceFlowFixture.map((r) => r.leads));
    expect(shares).toEqual([65, 19, 6, 3, 5, 1, 1]); // naive rounds to 99; leftover → Path
    expect(shares.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("revenue shares already sum to 100", () => {
    const shares = roundedShares(leadSourceFlowFixture.map((r) => r.wonRevenue));
    expect(shares).toEqual([31, 10, 28, 16, 8, 6, 1]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("exact shares match the verified expected-output table to one decimal", () => {
    const { totalLeads, totalRevenue } = computeFlowLayout(leadSourceFlowFixture);
    const path = leadSourceFlowFixture[0]!;
    const partner = leadSourceFlowFixture[2]!;
    expect((path.leads / totalLeads) * 100).toBeCloseTo(64.4, 1);
    expect((path.wonRevenue / totalRevenue) * 100).toBeCloseTo(31.0, 1);
    expect((partner.leads / totalLeads) * 100).toBeCloseTo(5.9, 1);
    expect((partner.wonRevenue / totalRevenue) * 100).toBeCloseTo(28.1, 1);
  });
});

describe("layout geometry (§6.2)", () => {
  it("computes independent-sort segment widths matching the expected table", () => {
    const { pos } = computeFlowLayout(leadSourceFlowFixture);
    expect(Math.round(pos.get("path")!.tw)).toBe(644);
    expect(Math.round(pos.get("path")!.bw)).toBe(310);
    expect(Math.round(pos.get("partner_referral")!.tw)).toBe(59);
    expect(Math.round(pos.get("partner_referral")!.bw)).toBe(281);
    expect(Math.round(pos.get("event_association")!.tw)).toBe(47);
    expect(Math.round(pos.get("event_association")!.bw)).toBe(80);
  });

  it("ribbon end widths equal the band segment widths (shared tw/bw)", () => {
    const { pos } = computeFlowLayout(leadSourceFlowFixture);
    const p = pos.get("path")!;
    // The ribbon top edge runs tx→tx+tw and bottom edge bx→bx+bw, i.e. the same
    // widths the band rects use.
    expect(ribbonPath(p)).toContain(`L${p.tx + p.tw},58`); // top edge end
    expect(ribbonPath(p)).toContain(`${p.bx + p.bw},172`); // bottom edge end
  });
});

describe("edge-case geometry", () => {
  it("guards the divide when total revenue is 0 (all bottom widths 0, no NaN)", () => {
    const { pos, totalRevenue } = computeFlowLayout(leadSourceFlowNoRevenueFixture);
    expect(totalRevenue).toBe(0);
    for (const p of pos.values()) {
      expect(p.bw).toBe(0);
      expect(Number.isFinite(p.tw)).toBe(true);
    }
  });

  it("tapers a zero-revenue source's ribbon to a point and still closes the path", () => {
    const { pos } = computeFlowLayout(leadSourceFlowLeadsNoRevenueFixture);
    expect(pos.get("path")!.bw).toBe(0); // Path has leads but no revenue
    const d = ribbonPath(pos.get("path")!);
    expect(d.startsWith("M")).toBe(true);
    expect(d.trim().endsWith("Z")).toBe(true);
  });
});

describe("long-tail grouping (§8)", () => {
  it("does not group at or below 9 rows (the 7-row fixture keeps 'other')", () => {
    const { rows, groupedMembers } = groupLongTail(leadSourceFlowFixture);
    expect(rows).toHaveLength(7);
    expect(rows.some((r) => r.sourceId === "other")).toBe(true);
    expect(groupedMembers).toHaveLength(0);
  });

  it("groups sub-2%-of-both rows into other_sources past the threshold", () => {
    const { rows, groupedMembers } = groupLongTail(leadSourceFlowLongTailFixture);
    const grouped = rows.find((r) => r.sourceId === "other_sources");
    expect(grouped).toBeTruthy();
    expect(groupedMembers.length).toBeGreaterThanOrEqual(2);
    // Summed, not dropped.
    const smallLeads = leadSourceFlowLongTailFixture
      .filter((r) => groupedMembers.includes(r.label))
      .reduce((a, r) => a + r.leads, 0);
    expect(grouped!.leads).toBe(smallLeads);
  });
});

describe("hidden accessible table (§11)", () => {
  it("carries source, leads, lead share, won revenue, revenue share per row", () => {
    render(<LeadSourceFlow data={leadSourceFlowFixture} />);
    const table = screen.getByRole("table");
    const pathRow = within(table).getByText("Path").closest("tr")!;
    const cells = within(pathRow).getAllByRole("cell");
    expect(cells[0]).toHaveTextContent("Path");
    expect(cells[1]).toHaveTextContent("4180");
    expect(cells[2]).toHaveTextContent("65%");
    expect(cells[3]).toHaveTextContent("14300000"); // raw minor units, never formatted
    expect(cells[4]).toHaveTextContent("31%");
  });
});

describe("interaction (§7)", () => {
  it("hovering a legend item and a band segment produce the identical active source", () => {
    const onHover = vi.fn();
    const { container } = render(<LeadSourceFlow data={leadSourceFlowFixture} onHoverSource={onHover} />);
    fireEvent.pointerOver(screen.getByRole("button", { name: "Path" }));
    expect(onHover).toHaveBeenLastCalledWith("path");
    onHover.mockClear();
    fireEvent.pointerOver(container.querySelector('rect[data-lsf-id="path"]')!);
    expect(onHover).toHaveBeenLastCalledWith("path");
  });

  it("clears the hover only when the pointer leaves the whole container", () => {
    const onHover = vi.fn();
    const { container } = render(<LeadSourceFlow data={leadSourceFlowFixture} onHoverSource={onHover} />);
    fireEvent.pointerLeave(container.firstElementChild!);
    expect(onHover).toHaveBeenLastCalledWith(null);
  });

  it("clicking a segment selects that source", () => {
    const onSelect = vi.fn();
    const { container } = render(<LeadSourceFlow data={leadSourceFlowFixture} onSelectSource={onSelect} />);
    fireEvent.click(container.querySelector('rect[data-lsf-id="partner_referral"]')!);
    expect(onSelect).toHaveBeenCalledWith("partner_referral");
  });

  it("dims the other sources end-to-end when a parent tracks hover (controlled loop)", () => {
    function Harness() {
      const [active, setActive] = React.useState<string | null>(null);
      return <LeadSourceFlow data={leadSourceFlowFixture} activeSourceId={active} onHoverSource={setActive} />;
    }
    const { container } = render(<Harness />);
    const pathRect = container.querySelector('rect[data-lsf-id="path"]') as HTMLElement;
    const partnerRect = container.querySelector('rect[data-lsf-id="partner_referral"]') as HTMLElement;
    expect(partnerRect.style.opacity).toBe("1");
    fireEvent.pointerOver(pathRect);
    expect(partnerRect.style.opacity).toBe("0.16"); // others dim
    expect(pathRect.style.opacity).toBe("1"); // hovered stays lit
    fireEvent.pointerLeave(container.firstElementChild!);
    expect(partnerRect.style.opacity).toBe("1"); // cleared on container leave
  });

  it("keyboard: legend focus sets active, blur clears, Enter/Space select", () => {
    const onHover = vi.fn();
    const onSelect = vi.fn();
    render(<LeadSourceFlow data={leadSourceFlowFixture} onHoverSource={onHover} onSelectSource={onSelect} />);
    const btn = screen.getByRole("button", { name: "Path" });
    fireEvent.focus(btn);
    expect(onHover).toHaveBeenLastCalledWith("path");
    fireEvent.blur(btn);
    expect(onHover).toHaveBeenLastCalledWith(null);
    fireEvent.click(btn); // Enter/Space on a button dispatch click
    expect(onSelect).toHaveBeenCalledWith("path");
  });
});

describe("states (§8) render without error", () => {
  it("loading shows a skeleton, no table", () => {
    render(<LeadSourceFlow data={[]} isLoading />);
    expect(screen.getByLabelText(/loading lead source flow/i)).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("empty shows a message, not a blank box", () => {
    render(<LeadSourceFlow data={leadSourceFlowEmptyFixture} />);
    expect(screen.getByText(/no lead source data/i)).toBeInTheDocument();
  });

  it("revenue-not-earned shows the top band + caption, no revenue axis label", () => {
    render(<LeadSourceFlow data={leadSourceFlowNoRevenueFixture} />);
    expect(screen.getByText(/revenue share appears once deals close/i)).toBeInTheDocument();
    expect(screen.queryByText("Share of won revenue")).toBeNull();
    expect(screen.getByText("Share of leads created")).toBeInTheDocument();
  });

  it("renders the single, revenue-no-leads, three, and long-tail cases", () => {
    for (const data of [
      leadSourceFlowSingleFixture,
      leadSourceFlowRevenueNoLeadsFixture,
      leadSourceFlowThreeFixture,
      leadSourceFlowLongTailFixture,
    ]) {
      const { unmount } = render(<LeadSourceFlow data={data} />);
      expect(screen.getByRole("table")).toBeInTheDocument();
      unmount();
    }
  });

  it("compact layout renders the ranked fallback (no ribbon svg)", () => {
    render(<LeadSourceFlow data={leadSourceFlowFixture} layout="compact" />);
    // The fallback shows the paired "lead% / rev%" readout and no role=img svg.
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText(/65% \/ 31%/)).toBeInTheDocument();
  });
});
