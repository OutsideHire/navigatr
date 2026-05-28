/**
 * AppLayout: the white-label glue.
 *
 * AppLayout reads useBrand() and threads tenant_logo + product_name into
 * TopBar, and gates the "Powered by" footer on org_branding.show_powered_by.
 * Heavy children (TopBar, SidebarNav, BottomNav) are stubbed so this stays
 * a focused integration test for the brand wiring — not for those
 * components' internals, which have their own tests.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// Stub the layout children — we're testing AppLayout's prop forwarding
// + footer gating, not the children themselves.
vi.mock("./TopBar", () => ({
  TopBar: (props: { tenantAppName?: string; tenantLogo?: string }) => (
    <div data-testid="topbar">
      <span data-testid="topbar-name">{props.tenantAppName ?? "(no name)"}</span>
      <span data-testid="topbar-logo">{props.tenantLogo ?? "(no logo)"}</span>
    </div>
  ),
}));
vi.mock("./BottomNav", () => ({ BottomNav: () => <div data-testid="bottomnav" /> }));
vi.mock("./SidebarNav", () => ({ SidebarNav: () => <div data-testid="sidebar" /> }));

// useBrand drives the test. Each case overrides brandReturn before render.
let brandReturn: { data?: {
  productName: string;
  primaryColor: string | null;
  logoUrl: string | null;
  showPoweredBy: boolean;
} } = {};
vi.mock("@/features/branding/useBrand", () => ({
  useBrand: () => brandReturn,
}));

// Import after mocks so the module picks up the mocked dependencies.
import { AppLayout } from "./AppLayout";

function makeWrapper() {
  const qc = new QueryClient();
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  brandReturn = {};
});

describe("AppLayout", () => {
  it("defaults to 'navigatr' name and no logo when brand has no data", () => {
    render(
      <AppLayout>
        <div>page</div>
      </AppLayout>,
      { wrapper: makeWrapper() },
    );
    expect(screen.getByTestId("topbar-name")).toHaveTextContent("navigatr");
    expect(screen.getByTestId("topbar-logo")).toHaveTextContent("(no logo)");
  });

  it("forwards brand productName and logoUrl to TopBar", () => {
    brandReturn = {
      data: {
        productName: "Acme Sales",
        primaryColor: "#2456e6",
        logoUrl: "https://cdn.acme.example/logo.png",
        showPoweredBy: true,
      },
    };
    render(
      <AppLayout>
        <div>page</div>
      </AppLayout>,
      { wrapper: makeWrapper() },
    );
    expect(screen.getByTestId("topbar-name")).toHaveTextContent("Acme Sales");
    expect(screen.getByTestId("topbar-logo")).toHaveTextContent(
      "https://cdn.acme.example/logo.png",
    );
  });

  it("explicit props override the brand query (storybook/preview use case)", () => {
    brandReturn = {
      data: {
        productName: "Acme Sales",
        primaryColor: null,
        logoUrl: "https://acme.example/logo.png",
        showPoweredBy: true,
      },
    };
    render(
      <AppLayout tenantAppName="OverrideName" tenantLogo="https://override.example/o.png">
        <div>page</div>
      </AppLayout>,
      { wrapper: makeWrapper() },
    );
    expect(screen.getByTestId("topbar-name")).toHaveTextContent("OverrideName");
    expect(screen.getByTestId("topbar-logo")).toHaveTextContent(
      "https://override.example/o.png",
    );
  });

  it("renders the 'Powered by' footer when showPoweredBy is true", () => {
    brandReturn = {
      data: {
        productName: "X",
        primaryColor: null,
        logoUrl: null,
        showPoweredBy: true,
      },
    };
    render(
      <AppLayout>
        <div>page</div>
      </AppLayout>,
      { wrapper: makeWrapper() },
    );
    expect(screen.getByText(/powered by/i)).toBeInTheDocument();
  });

  it("hides the footer when showPoweredBy is false", () => {
    brandReturn = {
      data: {
        productName: "X",
        primaryColor: null,
        logoUrl: null,
        showPoweredBy: false,
      },
    };
    render(
      <AppLayout>
        <div>page</div>
      </AppLayout>,
      { wrapper: makeWrapper() },
    );
    expect(screen.queryByText(/powered by/i)).not.toBeInTheDocument();
  });

  it("defaults to showing the footer when brand data hasn't loaded yet", () => {
    // No brand data (initial query state). Default-open matches what an
    // ISO sees before customizing — the safe default.
    brandReturn = {};
    render(
      <AppLayout>
        <div>page</div>
      </AppLayout>,
      { wrapper: makeWrapper() },
    );
    expect(screen.getByText(/powered by/i)).toBeInTheDocument();
  });
});
