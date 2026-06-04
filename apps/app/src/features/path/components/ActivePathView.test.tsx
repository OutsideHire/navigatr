import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ActivePathView } from "./ActivePathView";

const setStatus = vi.fn(); const remove = vi.fn();
const todayState = { current: {
  stops: [
    { merchantId: "m1", name: "Uratex", address: "Rd", lat: 30.3, lng: -97.7, category: "manufacturing", primaryType: null, status: "pending", disposition: null, dealCreated: false, addedAt: "t1" },
    { merchantId: "m2", name: "Amkor", address: "Rd2", lat: 30.4, lng: -97.7, category: "manufacturing", primaryType: null, status: "visited", disposition: "met_dm", dealCreated: true, addedAt: "t2" },
  ],
  setStatus, remove, isComplete: () => false,
} };
vi.mock("../hooks/useTodayPath", () => ({ useTodayPath: () => todayState.current }));
vi.mock("./MerchantMap", () => ({ MerchantMap: () => <div data-testid="map" /> }));

beforeEach(() => { setStatus.mockClear(); remove.mockClear(); });

describe("ActivePathView", () => {
  it("lists the stops in order with names and a stop count", () => {
    render(<ActivePathView origin={{ lat: 30, lng: -97 }} onAddStops={vi.fn()} onStartRoute={vi.fn()} />);
    expect(screen.getByText("Uratex")).toBeInTheDocument();
    expect(screen.getByText("Amkor")).toBeInTheDocument();
    expect(screen.getByText(/2 stops/i)).toBeInTheDocument();
  });

  it("marks a stop visited via setStatus", () => {
    render(<ActivePathView origin={{ lat: 30, lng: -97 }} onAddStops={vi.fn()} onStartRoute={vi.fn()} />);
    fireEvent.click(screen.getAllByRole("button", { name: /visited/i })[0]);
    expect(setStatus).toHaveBeenCalledWith("m1", "visited");
  });

  it("fires onAddStops from the Add stops button", () => {
    const onAddStops = vi.fn();
    render(<ActivePathView origin={{ lat: 30, lng: -97 }} onAddStops={onAddStops} onStartRoute={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /add stops/i }));
    expect(onAddStops).toHaveBeenCalledTimes(1);
  });

  it("shows Start route when a stop is pending and calls onStartRoute", () => {
    const onStartRoute = vi.fn();
    render(<ActivePathView origin={{ lat: 30, lng: -97 }} onAddStops={vi.fn()} onStartRoute={onStartRoute} />);
    fireEvent.click(screen.getByRole("button", { name: /start route/i }));
    expect(onStartRoute).toHaveBeenCalledTimes(1);
  });

  it("removes a stop via the remove button", () => {
    render(<ActivePathView origin={{ lat: 30, lng: -97 }} onAddStops={vi.fn()} onStartRoute={vi.fn()} />);
    fireEvent.click(screen.getAllByRole("button", { name: /remove from path/i })[0]);
    expect(remove).toHaveBeenCalledWith("m1");
  });
});
