// apps/app/src/features/admin/pages/AgentsPage.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { AgentsPage } from "./AgentsPage";

vi.mock("../hooks/useOrgAgents", () => ({
  useOrgAgents: () => ({
    data: {
      rows: [
        { id: "p1", kind: "profile", email: "a@x.com", fullName: "Alice",
          role: "rep", status: "active", detail: null,
          openDealCount: 3, pipelineValueCents: 100_000, lastActivity: null },
      ],
      totalCount: 1,
    },
    isLoading: false,
  }),
  ORG_AGENTS_QUERY_KEY: () => ["admin", "agents", "u"],
}));
vi.mock("../hooks/useResendInvite", () => ({ useResendInvite: () => ({ mutateAsync: vi.fn() }) }));
vi.mock("../hooks/useRevokeMember", () => ({ useRevokeMember: () => ({ mutateAsync: vi.fn() }) }));
vi.mock("../hooks/useSeatUsage", () => ({ useSeatUsage: () => ({ data: { used: 1, limit: 10, remaining: 9 }, isLoading: false }) }));

describe("AgentsPage", () => {
  it("renders agent rows and seat usage", () => {
    render(
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient()}>
          <AgentsPage />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("a@x.com")).toBeInTheDocument();
    expect(screen.getByText("1 / 10")).toBeInTheDocument();
  });
});
