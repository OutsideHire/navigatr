import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { toast } from "sonner";
import { ActivePathView } from "./ActivePathView";

const setStatus = vi.fn();
const remove = vi.fn();
const clear = vi.fn();
let complete = false;

const todayState = {
  current: {
    stops: [
      {
        merchantId: "m1",
        name: "Uratex",
        address: "Rd",
        phone: null,
        lat: 30.3,
        lng: -97.7,
        category: "manufacturing_wholesale",
        primaryType: null,
        status: "pending",
        disposition: null,
        dealCreated: false,
        addedAt: "t1",
      },
      {
        merchantId: "m2",
        name: "Amkor",
        address: "Rd2",
        phone: null,
        lat: 30.4,
        lng: -97.7,
        category: "manufacturing_wholesale",
        primaryType: null,
        status: "visited",
        disposition: "met_dm",
        dealCreated: true,
        addedAt: "t2",
      },
    ],
    setStatus,
    remove,
    clear,
    isComplete: () => complete,
  },
};

vi.mock("../hooks/useTodayPath", () => ({ useTodayPath: () => todayState.current }));
vi.mock("./MerchantMap", () => ({ MerchantMap: () => <div data-testid="map" /> }));
vi.mock("./PathSummary", () => ({ PathSummary: () => <div data-testid="summary" /> }));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

function renderView(props?: Partial<{ onAddStops: () => void; onStartRoute: () => void }>) {
  return render(
    <MemoryRouter>
      <ActivePathView
        origin={{ lat: 30, lng: -97 }}
        onAddStops={props?.onAddStops ?? vi.fn()}
        onStartRoute={props?.onStartRoute ?? vi.fn()}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  setStatus.mockClear();
  remove.mockClear();
  clear.mockClear();
  vi.mocked(toast).mockClear();
  vi.mocked(toast.success).mockClear();
  complete = false;
});

describe("ActivePathView", () => {
  it("renders rich rows with name, category · address, and a leg line", () => {
    renderView();
    expect(screen.getByText("Uratex")).toBeInTheDocument();
    expect(screen.getByText(/Manufacturing & Wholesale · Rd$/)).toBeInTheDocument();
    expect(screen.getByText(/From start/i)).toBeInTheDocument();
  });

  it("marks a pending stop visited via setStatus", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /mark visited/i }));
    expect(setStatus).toHaveBeenCalledWith("m1", "visited");
  });

  it("toasts on mark visited", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /mark visited/i }));
    expect(toast.success).toHaveBeenCalledWith("Marked Uratex as visited");
  });

  it("skips a pending stop via setStatus", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /^skip$/i }));
    expect(setStatus).toHaveBeenCalledWith("m1", "skipped");
  });

  it("removes a pending stop via remove", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /^remove$/i }));
    expect(remove).toHaveBeenCalledWith("m1");
  });

  it("reopens a resolved stop via setStatus pending", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /reopen/i }));
    expect(setStatus).toHaveBeenCalledWith("m2", "pending");
  });

  it("clears the path after confirm", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /clear path/i }));
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it("does not clear the path when confirm is declined", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /clear path/i }));
    expect(clear).not.toHaveBeenCalled();
  });

  it("shows Start route when a stop is pending and calls onStartRoute", () => {
    const onStartRoute = vi.fn();
    renderView({ onStartRoute });
    fireEvent.click(screen.getByRole("button", { name: /start route/i }));
    expect(onStartRoute).toHaveBeenCalledTimes(1);
  });

  it("shows the remaining-stops summary on the Start route hero (singular)", () => {
    // Fixture has one pending stop (m1) and one visited (m2).
    renderView();
    expect(screen.getByText("1 stop to go")).toBeInTheDocument();
  });

  it("renders the summary and no stop rows when complete", () => {
    complete = true;
    renderView();
    expect(screen.getByTestId("summary")).toBeInTheDocument();
    expect(screen.queryByText("Uratex")).not.toBeInTheDocument();
  });
});
