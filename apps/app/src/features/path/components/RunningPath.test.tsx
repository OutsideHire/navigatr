import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RunningPath } from "./RunningPath";
import type { TodayStop } from "../hooks/useTodayPath";

const setStatus = vi.fn(async () => {});
const clear = vi.fn(async () => {});
let stops: TodayStop[] = [];
vi.mock("../hooks/useTodayPath", () => ({
  useTodayPath: () => ({ stops, setStatus, clear }),
}));
vi.mock("./DropInSheet", () => ({
  DropInSheet: ({ open, merchant, onLogged, onOpenChange }: any) =>
    open ? (
      <div data-testid="dropin">
        <span>sheet:{merchant?.name}</span>
        <button onClick={() => { onLogged?.("met_dm"); onOpenChange(false); }}>save-log</button>
      </div>
    ) : null,
}));
vi.mock("./PathSummary", () => ({ PathSummary: () => <div data-testid="summary">summary</div> }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

function stop(id: string, over: Partial<TodayStop> = {}): TodayStop {
  return { merchantId: id, name: id, address: "1 Main", lat: 35, lng: -97, category: "manufacturing",
    primaryType: null, phone: "+15551230000", status: "pending", disposition: null, dealCreated: false, addedAt: "t", ...over };
}
const ORIGIN = { lat: 35, lng: -97 };
beforeEach(() => { setStatus.mockClear(); clear.mockClear(); });

describe("RunningPath", () => {
  it("starts at the first pending stop", () => {
    stops = [stop("A", { status: "visited" }), stop("B"), stop("C")];
    render(<RunningPath origin={ORIGIN} onPause={vi.fn()} onViewPipeline={vi.fn()} onExit={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "B" })).toBeInTheDocument();
    expect(screen.getByText(/stop 2 of 3/i)).toBeInTheDocument();
  });
  it("hides Call when the stop has no phone, shows Directions always", () => {
    stops = [stop("A", { phone: null })];
    render(<RunningPath origin={ORIGIN} onPause={vi.fn()} onViewPipeline={vi.fn()} onExit={vi.fn()} />);
    expect(screen.queryByRole("link", { name: /call/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /directions/i })).toHaveAttribute("href", expect.stringContaining("maps/dir"));
  });
  it("Skip marks the stop skipped and advances", () => {
    stops = [stop("A"), stop("B")];
    render(<RunningPath origin={ORIGIN} onPause={vi.fn()} onViewPipeline={vi.fn()} onExit={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /skip/i }));
    expect(setStatus).toHaveBeenCalledWith("A", "skipped");
    expect(screen.getByRole("heading", { name: "B" })).toBeInTheDocument();
  });
  it("logging a drop-in advances to the next pending stop", () => {
    stops = [stop("A"), stop("B")];
    render(<RunningPath origin={ORIGIN} onPause={vi.fn()} onViewPipeline={vi.fn()} onExit={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /log drop-in/i }));
    fireEvent.click(screen.getByText("save-log"));
    expect(screen.getByRole("heading", { name: "B" })).toBeInTheDocument();
  });
  it("Prev is disabled on the first shown stop", () => {
    stops = [stop("A"), stop("B")];
    render(<RunningPath origin={ORIGIN} onPause={vi.fn()} onViewPipeline={vi.fn()} onExit={vi.fn()} />);
    expect(screen.getByRole("button", { name: /prev/i })).toBeDisabled();
  });
  it("shows the summary when no stops are pending", () => {
    stops = [stop("A", { status: "visited" }), stop("B", { status: "skipped" })];
    render(<RunningPath origin={ORIGIN} onPause={vi.fn()} onViewPipeline={vi.fn()} onExit={vi.fn()} />);
    expect(screen.getByTestId("summary")).toBeInTheDocument();
  });
  it("Pause calls onPause", () => {
    stops = [stop("A")];
    const onPause = vi.fn();
    render(<RunningPath origin={ORIGIN} onPause={onPause} onViewPipeline={vi.fn()} onExit={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /pause/i }));
    expect(onPause).toHaveBeenCalled();
  });
  it("shows summary after logging the last pending stop", () => {
    stops = [stop("A")]; // only one pending
    const { rerender } = render(
      <RunningPath origin={ORIGIN} onPause={vi.fn()} onViewPipeline={vi.fn()} onExit={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /log drop-in/i }));
    fireEvent.click(screen.getByText("save-log"));
    // Simulate the query refetch flipping the logged stop to visited:
    stops = [stop("A", { status: "visited" })];
    rerender(<RunningPath origin={ORIGIN} onPause={vi.fn()} onViewPipeline={vi.fn()} onExit={vi.fn()} />);
    expect(screen.getByTestId("summary")).toBeInTheDocument();
  });
});
