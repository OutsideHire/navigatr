import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PersistenceStatsGrid } from "./PersistenceStatsGrid";

const stats = { high: 76, low: 64, periodAvg: 70, dailyActivityAvg: 5.2, daysAboveAvg: 18, scoredDays: 30 };

describe("PersistenceStatsGrid", () => {
  it("shows index + activity stats always", () => {
    render(<PersistenceStatsGrid stats={stats} peerAvg={61} topLabel="Top 10%" topValue={84} showBenchmarks />);
    expect(screen.getByText("76 / 64")).toBeInTheDocument();
    expect(screen.getByText("70")).toBeInTheDocument();
    expect(screen.getByText("5.2")).toBeInTheDocument();
  });
  it("hides benchmark cells when showBenchmarks is false (rep scope)", () => {
    render(<PersistenceStatsGrid stats={{ ...stats, daysAboveAvg: null }} peerAvg={null} topLabel="Top 10%" topValue={null} showBenchmarks={false} />);
    expect(screen.queryByText("Peer average")).not.toBeInTheDocument();
    expect(screen.queryByText("Days above average")).not.toBeInTheDocument();
    expect(screen.getByText("Period average")).toBeInTheDocument();
  });
});
