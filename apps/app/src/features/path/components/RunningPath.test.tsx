import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { RunningPath } from "./RunningPath";
import type { TodayStop } from "../hooks/useTodayPath";

const setStatus = vi.fn(async () => {});
const clear = vi.fn(async () => {});
let stops: TodayStop[] = [];
let pathId: string | null = "today-1";
let pendingCount = () => stops.filter((s) => s.status === "pending").length;
vi.mock("../hooks/useTodayPath", () => ({
  useTodayPath: () => ({ stops, setStatus, clear, pathId, pendingCount }),
}));
const carryMutate = vi.fn();
const finalizeMutate = vi.fn();
vi.mock("../hooks/usePathMutations", () => ({
  usePathMutations: () => ({
    carryToTomorrow: { mutateAsync: carryMutate, isPending: false },
    finalizeCurrentPath: { mutateAsync: finalizeMutate, isPending: false },
  }),
}));
vi.mock("./EndRouteSheet", () => ({
  EndRouteSheet: (p: { open: boolean; pendingCount: number; onCarry: () => void; onClear: () => void; onComplete: () => void; onOpenChange: (o: boolean) => void }) =>
    p.open ? (
      <div data-testid="end-sheet"><span>{p.pendingCount} pending</span>
        <button onClick={p.onComplete}>mark-complete</button>
        <button onClick={p.onCarry}>carry</button><button onClick={p.onClear}>clear</button>
        <button onClick={() => p.onOpenChange(false)}>cancel</button></div>
    ) : null,
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
vi.mock("./PathSummary", () => ({ PathSummary: (p: { skippedCount: number }) => <div data-testid="summary" data-skipped={p.skippedCount}>summary</div> }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

function stop(id: string, over: Partial<TodayStop> = {}): TodayStop {
  return { merchantId: id, name: id, address: "1 Main", lat: 35, lng: -97, category: "manufacturing_wholesale",
    primaryType: null, phone: "+15551230000", status: "pending", disposition: null, dealCreated: false, addedAt: "t", ...over };
}
const ORIGIN = { lat: 35, lng: -97 };
beforeEach(() => {
  setStatus.mockClear();
  clear.mockClear();
  carryMutate.mockReset();
  finalizeMutate.mockReset();
  pathId = "today-1";
  pendingCount = () => stops.filter((s) => s.status === "pending").length;
});

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

  it("End route with pending stops opens the sheet", () => {
    stops = [stop("A"), stop("B")];
    pendingCount = () => 2;
    pathId = "today-1";
    const onExitSpy = vi.fn();
    render(<RunningPath origin={ORIGIN} onPause={vi.fn()} onViewPipeline={vi.fn()} onExit={onExitSpy} />);
    fireEvent.click(screen.getByRole("button", { name: /end route/i }));
    expect(screen.getByTestId("end-sheet")).toBeInTheDocument();
    expect(onExitSpy).not.toHaveBeenCalled();
  });
  it("Carry to tomorrow calls carryToTomorrow then exits", async () => {
    stops = [stop("A"), stop("B")];
    pendingCount = () => 2;
    pathId = "today-1";
    carryMutate.mockResolvedValueOnce(undefined);
    const onExitSpy = vi.fn();
    render(<RunningPath origin={ORIGIN} onPause={vi.fn()} onViewPipeline={vi.fn()} onExit={onExitSpy} />);
    fireEvent.click(screen.getByRole("button", { name: /end route/i }));
    await act(async () => { fireEvent.click(screen.getByText("carry")); });
    expect(carryMutate).toHaveBeenCalledWith({ pathId: "today-1", pathDate: expect.any(String) });
    expect(onExitSpy).toHaveBeenCalled();
    expect(screen.queryByTestId("end-sheet")).not.toBeInTheDocument();
  });
  it("Carry failure keeps the sheet open and does not exit", async () => {
    stops = [stop("A"), stop("B")];
    pendingCount = () => 2;
    pathId = "today-1";
    carryMutate.mockRejectedValueOnce(new Error("network"));
    const onExitSpy = vi.fn();
    const { toast } = await import("sonner");
    render(<RunningPath origin={ORIGIN} onPause={vi.fn()} onViewPipeline={vi.fn()} onExit={onExitSpy} />);
    fireEvent.click(screen.getByRole("button", { name: /end route/i }));
    await act(async () => { fireEvent.click(screen.getByText("carry")); });
    expect(toast.error).toHaveBeenCalled();
    expect(onExitSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId("end-sheet")).toBeInTheDocument();
  });
  it("Clear & start over (confirmed) clears and exits", async () => {
    stops = [stop("A"), stop("B")];
    pendingCount = () => 2;
    pathId = "today-1";
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const onExitSpy = vi.fn();
    render(<RunningPath origin={ORIGIN} onPause={vi.fn()} onViewPipeline={vi.fn()} onExit={onExitSpy} />);
    fireEvent.click(screen.getByRole("button", { name: /end route/i }));
    await act(async () => { fireEvent.click(screen.getByText("clear")); });
    expect(clear).toHaveBeenCalled();
    expect(onExitSpy).toHaveBeenCalled();
  });
  it("Clear failure keeps the sheet open and does not exit", async () => {
    stops = [stop("A"), stop("B")];
    pendingCount = () => 2;
    pathId = "today-1";
    vi.spyOn(window, "confirm").mockReturnValue(true);
    clear.mockRejectedValueOnce(new Error("delete failed"));
    const onExitSpy = vi.fn();
    const { toast } = await import("sonner");
    render(<RunningPath origin={ORIGIN} onPause={vi.fn()} onViewPipeline={vi.fn()} onExit={onExitSpy} />);
    fireEvent.click(screen.getByRole("button", { name: /end route/i }));
    await act(async () => { fireEvent.click(screen.getByText("clear")); });
    expect(toast.error).toHaveBeenCalled();
    expect(onExitSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId("end-sheet")).toBeInTheDocument();
  });
  it("Mark route complete finalizes and shows the report without exiting", async () => {
    stops = [stop("A"), stop("B", { status: "visited" })];
    pendingCount = () => 1;
    pathId = "today-1";
    finalizeMutate.mockResolvedValueOnce(undefined);
    const onExitSpy = vi.fn();
    render(<RunningPath origin={ORIGIN} onPause={vi.fn()} onViewPipeline={vi.fn()} onExit={onExitSpy} />);
    fireEvent.click(screen.getByRole("button", { name: /end route/i }));
    await act(async () => { fireEvent.click(screen.getByText("mark-complete")); });
    expect(finalizeMutate).toHaveBeenCalledWith("today-1");
    const summary = screen.getByTestId("summary");
    expect(summary).toBeInTheDocument();
    // pending-as-skipped: already-skipped (0) + pending (1 = stop A) = 1
    expect(summary).toHaveAttribute("data-skipped", "1");
    expect(onExitSpy).not.toHaveBeenCalled();
  });
  it("Mark complete failure toasts and keeps the sheet open (no report)", async () => {
    stops = [stop("A")];
    pendingCount = () => 1;
    pathId = "today-1";
    finalizeMutate.mockRejectedValueOnce(new Error("boom"));
    const onExitSpy = vi.fn();
    const { toast } = await import("sonner");
    render(<RunningPath origin={ORIGIN} onPause={vi.fn()} onViewPipeline={vi.fn()} onExit={onExitSpy} />);
    fireEvent.click(screen.getByRole("button", { name: /end route/i }));
    await act(async () => { fireEvent.click(screen.getByText("mark-complete")); });
    expect(toast.error).toHaveBeenCalled();
    expect(screen.queryByTestId("summary")).not.toBeInTheDocument();
    expect(onExitSpy).not.toHaveBeenCalled();
  });
  it("Cancel closes the sheet without mutating or exiting", () => {
    stops = [stop("A"), stop("B")];
    pendingCount = () => 2;
    pathId = "today-1";
    const onExitSpy = vi.fn();
    render(<RunningPath origin={ORIGIN} onPause={vi.fn()} onViewPipeline={vi.fn()} onExit={onExitSpy} />);
    fireEvent.click(screen.getByRole("button", { name: /end route/i }));
    fireEvent.click(screen.getByText("cancel"));
    expect(screen.queryByTestId("end-sheet")).not.toBeInTheDocument();
    expect(carryMutate).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    expect(onExitSpy).not.toHaveBeenCalled();
  });

  // ─── runOverlay (S3: meeting-aware overlay) ──────────────────────────
  const OVERLAY = {
    arrive: "2026-07-08T15:00:00.000Z",
    dwellMin: 20,
    currentStopName: "A",
    nextMeeting: { title: "Acme sync", start: "2026-07-08T16:00:00.000Z", located: true },
    stopsUntilNextMeeting: 2,
    fits: true,
  };

  it("renders the next meeting title and stops-to-go when a runOverlay is given", () => {
    stops = [stop("A"), stop("B")];
    render(
      <RunningPath origin={ORIGIN} onPause={vi.fn()} onViewPipeline={vi.fn()} onExit={vi.fn()} runOverlay={OVERLAY} />,
    );
    expect(screen.getByText(/Acme sync/)).toBeInTheDocument();
    expect(screen.getByText(/2 stops to go/i)).toBeInTheDocument();
  });

  it("renders a role=alert warning when the current stop won't fit (fits:false)", () => {
    stops = [stop("A")];
    render(
      <RunningPath
        origin={ORIGIN}
        onPause={vi.fn()}
        onViewPipeline={vi.fn()}
        onExit={vi.fn()}
        runOverlay={{ ...OVERLAY, fits: false }}
      />,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("renders no meeting or alert text when runOverlay is null (existing behavior preserved)", () => {
    stops = [stop("A")];
    render(
      <RunningPath origin={ORIGIN} onPause={vi.fn()} onViewPipeline={vi.fn()} onExit={vi.fn()} runOverlay={null} />,
    );
    expect(screen.queryByText(/Acme sync/)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders no meeting or alert text when runOverlay is omitted (existing behavior preserved)", () => {
    stops = [stop("A")];
    render(<RunningPath origin={ORIGIN} onPause={vi.fn()} onViewPipeline={vi.fn()} onExit={vi.fn()} />);
    expect(screen.queryByText(/Acme sync/)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
