import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { CronHealthCard } from "./CronHealthCard";
import type { CronHealthFacts } from "../lib/cronHealth";

let facts: CronHealthFacts;
let loading: boolean;
vi.mock("../hooks/useCronHealth", () => ({
  useCronHealth: () => ({ data: facts, isLoading: loading }),
  CRON_HEALTH_QUERY_KEY: (u: string | undefined) => ["cron-health", u ?? "anon"],
}));

const today = new Date().toISOString().slice(0, 10);

beforeEach(() => {
  loading = false;
  facts = {};
});

describe("CronHealthCard", () => {
  it("renders nothing for a non-admin (RPC returned {})", () => {
    facts = {};
    const { container } = render(<CronHealthCard />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists each job with a status for an admin result", () => {
    facts = {
      persistence: { latest_date: today, rows: 4 },
      coverage: { latest_date: today, rows: 4 },
      email_capture: { connections: 0, freshest_poll_at: null, unhealthy: 0 },
    };
    render(<CronHealthCard />);
    expect(screen.getByText("Scheduled jobs")).toBeInTheDocument();
    expect(screen.getByText(/Persistence Index/)).toBeInTheDocument();
    expect(screen.getByText(/Coverage rollup/)).toBeInTheDocument();
    expect(screen.getByText(/Email capture poll/)).toBeInTheDocument();
  });

  it("surfaces a stale job with the attention hint", () => {
    facts = {
      persistence: { latest_date: "2026-01-01", rows: 4 }, // very old -> stale
      coverage: { latest_date: today, rows: 4 },
      email_capture: { connections: 0, freshest_poll_at: null, unhealthy: 0 },
    };
    render(<CronHealthCard />);
    expect(screen.getByText(/needs attention/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Stale/).length).toBeGreaterThan(0);
  });
});
