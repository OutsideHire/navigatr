import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { UnloggedCallsSection, relativeTime } from "./UnloggedCallsSection";

let dials: Array<{ dealId: string; companyName: string; lastDetectedAt: string; dialCount: number }>;
vi.mock("../hooks/useUnloggedDials", () => ({
  useUnloggedDials: () => ({ data: dials }),
  UNLOGGED_DIALS_QUERY_KEY: (userId: string | undefined) => ["coverage", "unlogged-dials", userId ?? "anon"],
}));
const matchMutate = vi.fn();
vi.mock("../hooks/useMatchUnloggedDials", () => ({
  useMatchUnloggedDials: () => ({ mutate: matchMutate }),
}));
// Stub the heavy sheet so the section test stays focused. Exposes an
// onLogged trigger button so tests can simulate a completed log.
vi.mock("./LogActivitySheet", () => ({
  LogActivitySheet: (p: {
    open: boolean;
    dealId: string;
    defaultType?: string;
    onLogged?: (activityId: string) => void;
  }) =>
    p.open ? (
      <div data-testid="log-sheet">
        {`${p.dealId}:${p.defaultType}`}
        <button type="button" onClick={() => p.onLogged?.("act-1")}>
          simulate-logged
        </button>
      </div>
    ) : null,
}));

function wrap(ui: ReactNode) {
  return render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  dials = [
    { dealId: "d1", companyName: "Acme Co", lastDetectedAt: new Date().toISOString(), dialCount: 2 },
  ];
  matchMutate.mockReset();
});

describe("UnloggedCallsSection", () => {
  it("lists each unlogged-call deal with a Log outcome action", () => {
    wrap(<UnloggedCallsSection />);
    expect(screen.getByText(/unlogged calls \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText("Acme Co")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /log outcome/i })).toBeInTheDocument();
  });

  it("opens LogActivitySheet prefilled to call for the tapped deal", () => {
    wrap(<UnloggedCallsSection />);
    fireEvent.click(screen.getByRole("button", { name: /log outcome/i }));
    expect(screen.getByTestId("log-sheet")).toHaveTextContent("d1:call");
  });

  it("renders nothing when there are no unlogged calls", () => {
    dials = [];
    const { container } = wrap(<UnloggedCallsSection />);
    expect(container).toBeEmptyDOMElement();
  });

  it("stamps the explicit match for the tapped deal when the sheet reports a logged activity", () => {
    wrap(<UnloggedCallsSection />);
    fireEvent.click(screen.getByRole("button", { name: /log outcome/i }));
    fireEvent.click(screen.getByRole("button", { name: /simulate-logged/i }));
    expect(matchMutate).toHaveBeenCalledWith({ dealId: "d1", activityId: "act-1" });
    // Sheet closes after logging.
    expect(screen.queryByTestId("log-sheet")).not.toBeInTheDocument();
  });
});

describe("relativeTime", () => {
  const base = new Date("2026-06-24T12:00:00.000Z");
  const ago = (ms: number) => new Date(base.getTime() - ms).toISOString();
  const SEC = 1000, MIN = 60 * SEC, HOUR = 60 * MIN, DAY = 24 * HOUR;

  it("returns 'just now' under a minute", () => {
    expect(relativeTime(ago(30 * SEC), base)).toBe("just now");
  });
  it("floors to whole minutes under an hour", () => {
    expect(relativeTime(ago(59 * MIN), base)).toBe("59m ago");
  });
  it("floors to whole hours under a day (89m → 1h)", () => {
    expect(relativeTime(ago(89 * MIN), base)).toBe("1h ago");
    expect(relativeTime(ago(23 * HOUR), base)).toBe("23h ago");
  });
  it("floors to whole days at a day or more (47h → 1d)", () => {
    expect(relativeTime(ago(47 * HOUR), base)).toBe("1d ago");
    expect(relativeTime(ago(2 * DAY), base)).toBe("2d ago");
  });
});
