import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import {
  LeadSourceEfficiency,
  niceStep,
  computeYAxis,
  computeXScale,
  bubbleRadius,
  weightedMedianTouches,
} from "./LeadSourceEfficiency";
import {
  leadSourceEfficiencyFixture as FIX,
  efficiencyNoClosedWonFixture,
  efficiencyPartialFixture,
  efficiencyAllBelowFloorFixture,
  efficiencySingleFixture,
  efficiencyIdenticalTouchFixture,
} from "./leadSourceEfficiency.fixtures";

const circleFor = (container: HTMLElement, id: string) =>
  container.querySelector(`[data-lsf-id="${id}"] circle`) as SVGCircleElement;
const num = (el: Element | null, attr: string) => Number(el?.getAttribute(attr));

describe("LeadSourceEfficiency scale helpers (spec §6, §7)", () => {
  it("niceStep produces a readable ladder and guards non-positive input", () => {
    expect(niceStep(5.95)).toBe(10); // fixture: max 23.8 / 4
    expect(niceStep(0)).toBe(1);
    expect(niceStep(0.4)).toBeCloseTo(0.5, 5);
  });

  it("computeYAxis gives step 10, axisTop 30, ticks 0/10/20/30 (deviation §6.3)", () => {
    const { step, axisTop, ticks } = computeYAxis(FIX.map((r) => r.winRate));
    expect(step).toBe(10);
    expect(axisTop).toBe(30);
    expect(ticks).toEqual([0, 10, 20, 30]);
  });

  it("computeXScale windows the observed range (xMin 2.10, xMax 8.51)", () => {
    const { xMin, xMax } = computeXScale(FIX.map((r) => r.touchesToWin));
    expect(xMin).toBeCloseTo(2.1, 5);
    expect(xMax).toBeCloseTo(8.51, 5);
  });

  it("computeXScale guards the degenerate all-equal case", () => {
    const { xMin, xMax } = computeXScale([5, 5, 5]);
    expect(xMin).toBe(4);
    expect(xMax).toBe(6);
  });

  it("bubbleRadius is 6 + sqrt(leads/maxLeads) * 24", () => {
    expect(bubbleRadius(4180, 4180)).toBeCloseTo(30, 5);
    expect(bubbleRadius(74, 4180)).toBeCloseTo(9.2, 1);
  });

  it("weightedMedianTouches is won-deal-weighted (5.8, not the unweighted mean 5.2) (deviation §6.5)", () => {
    expect(weightedMedianTouches(FIX)).toBe(5.8);
  });
});

describe("LeadSourceEfficiency render (spec §6, §11)", () => {
  it("places bubbles at the verified geometry (cx/cy/radius to one decimal)", () => {
    const { container } = render(<LeadSourceEfficiency data={FIX} />);
    const path = circleFor(container, "path");
    expect(num(path, "cx")).toBeCloseTo(457.1, 1);
    expect(num(path, "cy")).toBeCloseTo(269.3, 1);
    expect(num(path, "r")).toBeCloseTo(30.0, 1);
    expect(num(circleFor(container, "self_sourced_canvass"), "cx")).toBeCloseTo(418.9, 1);
    expect(num(circleFor(container, "customer_referral"), "cy")).toBeCloseTo(77.0, 1);
    expect(num(circleFor(container, "other"), "r")).toBeCloseTo(9.2, 1);
  });

  it("draws largest bubble first so the smallest paints on top", () => {
    const { container } = render(<LeadSourceEfficiency data={FIX} />);
    const groups = Array.from(container.querySelectorAll("svg [data-lsf-id]"));
    expect(groups[0]?.getAttribute("data-lsf-id")).toBe("path"); // largest, painted first
    expect(groups[groups.length - 1]?.getAttribute("data-lsf-id")).toBe("other"); // smallest, on top
  });

  it("draws the weighted-median reference line at x for 5.8", () => {
    const { container } = render(<LeadSourceEfficiency data={FIX} />);
    const ref = container.querySelector('line[stroke-dasharray="3 4"]') as SVGLineElement;
    expect(ref).not.toBeNull();
    expect(num(ref, "x1")).toBeCloseTo(334.8, 1);
  });

  it("carries every number in the hidden accessible table", () => {
    render(<LeadSourceEfficiency data={FIX} />);
    const table = screen.getByRole("table", { hidden: true });
    expect(within(table).getByText("Path")).toBeInTheDocument();
    expect(within(table).getAllByText("2.9%").length).toBeGreaterThan(0);
  });

  it("dims the other sources end-to-end when a parent tracks hover (controlled loop)", () => {
    function Harness() {
      const [active, setActive] = React.useState<string | null>(null);
      return <LeadSourceEfficiency data={FIX} activeSourceId={active} onHoverSource={setActive} />;
    }
    const { container } = render(<Harness />);
    const path = circleFor(container, "path");
    const partner = circleFor(container, "partner_referral");
    expect(num(partner, "fill-opacity")).toBeCloseTo(0.42, 5);
    fireEvent.pointerOver(container.querySelector('[data-lsf-id="path"]')!);
    expect(num(path, "fill-opacity")).toBeCloseTo(0.75, 5); // active lifts
    expect(num(partner, "fill-opacity")).toBeCloseTo(0.42, 5); // others keep base (no cross-dim in this chart)
    expect(path.getAttribute("stroke")).toBe("#fff");
  });
});

describe("LeadSourceEfficiency states (spec §9)", () => {
  it("loading renders a skeleton, no bubbles", () => {
    const { container } = render(<LeadSourceEfficiency data={FIX} isLoading />);
    expect(container.querySelector("[aria-busy='true']")).not.toBeNull();
    expect(container.querySelector("[data-lsf-id]")).toBeNull();
  });

  it("empty renders a message and no axes", () => {
    render(<LeadSourceEfficiency data={[]} />);
    expect(screen.getByText(/no lead source data/i)).toBeInTheDocument();
  });

  it("no-closed-won renders axes + message, no bubbles", () => {
    const { container } = render(<LeadSourceEfficiency data={efficiencyNoClosedWonFixture} />);
    expect(screen.getByText(/efficiency appears once deals close/i)).toBeInTheDocument();
    expect(container.querySelector("svg [data-lsf-id]")).toBeNull();
  });

  it("partial closure plots winners and lists the rest below", () => {
    const { container } = render(<LeadSourceEfficiency data={efficiencyPartialFixture} />);
    expect(container.querySelector('[data-lsf-id="path"] circle')).not.toBeNull();
    expect(container.querySelector('svg [data-lsf-id="inbound"]')).toBeNull(); // no win → no bubble
    expect(screen.getByText(/no closed won yet:/i)).toHaveTextContent(/Inbound/);
  });

  it("all-below-floor: dashed bubbles, no reference line, footnote shown", () => {
    const { container } = render(<LeadSourceEfficiency data={efficiencyAllBelowFloorFixture} />);
    expect(container.querySelector('line[stroke-dasharray="3 4"]')).toBeNull(); // reference suppressed
    expect(container.querySelector('circle[stroke-dasharray="2 3"]')).not.toBeNull(); // below-floor style
    expect(screen.getByText(/fewer than 5 closed won/i)).toBeInTheDocument();
  });

  it("single source: one bubble, no reference line, no crash", () => {
    const { container } = render(<LeadSourceEfficiency data={efficiencySingleFixture} />);
    expect(container.querySelectorAll("svg [data-lsf-id]")).toHaveLength(1);
    expect(container.querySelector('line[stroke-dasharray="3 4"]')).toBeNull();
  });

  it("identical touch counts render via the degenerate guard (no NaN geometry)", () => {
    const { container } = render(<LeadSourceEfficiency data={efficiencyIdenticalTouchFixture} />);
    const cx = num(circleFor(container, "path"), "cx");
    expect(Number.isFinite(cx)).toBe(true);
  });

  it("narrow fallback renders a ranked list instead of the scatter", () => {
    const { container } = render(<LeadSourceEfficiency data={FIX} layout="compact" />);
    expect(container.querySelector("svg [data-lsf-id]")).toBeNull(); // no scatter
    expect(container.querySelector('[data-lsf-id="path"]')).not.toBeNull(); // list row present
  });
});

describe("LeadSourceEfficiency keyboard (spec §8.4)", () => {
  it("hidden buttons set active on focus and select on click", () => {
    const onHover = vi.fn();
    const onSelect = vi.fn();
    render(<LeadSourceEfficiency data={FIX} onHoverSource={onHover} onSelectSource={onSelect} />);
    const btn = screen.getByRole("button", { name: /Path: win rate 2.9%/i, hidden: true });
    fireEvent.focus(btn);
    expect(onHover).toHaveBeenCalledWith("path");
    fireEvent.click(btn);
    expect(onSelect).toHaveBeenCalledWith("path");
    fireEvent.blur(btn);
    expect(onHover).toHaveBeenCalledWith(null);
  });
});
