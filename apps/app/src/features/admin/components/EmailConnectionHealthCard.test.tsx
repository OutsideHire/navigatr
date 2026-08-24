import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmailConnectionHealthCard } from "./EmailConnectionHealthCard";
import type { EmailConnectionHealthRow } from "../lib/emailConnectionHealth";

let rows: EmailConnectionHealthRow[];
let loading: boolean;
vi.mock("../hooks/useEmailConnectionHealth", () => ({
  useEmailConnectionHealth: () => ({ data: rows, isLoading: loading }),
  EMAIL_CONNECTION_HEALTH_QUERY_KEY: (u: string | undefined) => ["email-connection-health", u ?? "anon"],
}));

function row(over: Partial<EmailConnectionHealthRow> & { user_id: string }): EmailConnectionHealthRow {
  return {
    rep_name: "Jane Rep",
    provider: "outlook",
    health: "ok",
    last_poll_at: new Date().toISOString(),
    capture_start_date: new Date().toISOString(),
    last_error: null,
    ...over,
  };
}

beforeEach(() => {
  loading = false;
  rows = [];
});

describe("EmailConnectionHealthCard", () => {
  it("shows the empty state when no reps have connected", () => {
    render(<EmailConnectionHealthCard />);
    expect(screen.getByText(/no reps have connected outlook/i)).toBeInTheDocument();
  });

  it("shows healthy/total and lists each rep with a status", () => {
    rows = [
      row({ user_id: "u1", rep_name: "Jane Rep", health: "ok" }),
      row({ user_id: "u2", rep_name: "Bob Rep", health: "needs_reauth" }),
    ];
    render(<EmailConnectionHealthCard />);
    expect(screen.getByText("1/2")).toBeInTheDocument();
    expect(screen.getByText(/1 need attention/i)).toBeInTheDocument();
    expect(screen.getByText("Jane Rep")).toBeInTheDocument();
    expect(screen.getByText("Bob Rep")).toBeInTheDocument();
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByText("Needs reconnect")).toBeInTheDocument();
  });

  it("shows a loading state", () => {
    loading = true;
    render(<EmailConnectionHealthCard />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });
});
