import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { PathOrigin } from "../hooks/usePathOrigin";
import type { Merchant } from "../mockData";

// --- jsdom polyfills for Radix Dialog/Select portals + pointer ------------
if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {};
if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

// --- Origin layer ---------------------------------------------------------
const originState = { current: {} as PathOrigin };
vi.mock("../hooks/usePathOrigin", () => ({
  usePathOrigin: () => originState.current,
}));

// --- Merchants layer ------------------------------------------------------
const merchantsState = {
  current: { merchants: [] as Merchant[], isLoading: false, isError: false, refetch: vi.fn() },
};
vi.mock("../hooks/useMerchants", async (orig) => {
  const actual = await orig<typeof import("../hooks/useMerchants")>();
  return { ...actual, useMerchants: () => merchantsState.current };
});

// --- Mutations ------------------------------------------------------------
const createPathMutate = vi.fn(async (_input: unknown) => "path-123");
const addStopsMutate = vi.fn(async (_input: unknown) => undefined);
vi.mock("../hooks/usePathMutations", () => ({
  usePathMutations: () => ({
    createPath: { mutateAsync: createPathMutate },
    addStops: { mutateAsync: addStopsMutate },
  }),
}));

// DropInSheet reaches into useTodayPath / pipeline hooks — stub it out.
vi.mock("../components/DropInSheet", () => ({ DropInSheet: () => null }));

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

import { PlanPathWizard } from "./PlanPathWizard";

function m(id: string, name: string): Merchant {
  return {
    id,
    name,
    category: "retail",
    address: "1 Main St",
    lat: 30 + Math.random() * 0.01,
    lng: -97 + Math.random() * 0.01,
    phone: "",
    employeeCountRange: "",
    status: "untouched",
    lastActivity: null,
    primaryType: null,
  };
}

const NO_ORIGIN: PathOrigin = {
  origin: null,
  originSource: null,
  originLabel: null,
  geoStatus: "unavailable",
  searching: false,
  searchError: null,
  searchLocation: vi.fn(),
  useMyLocation: vi.fn(),
};

const WITH_ORIGIN: PathOrigin = {
  ...NO_ORIGIN,
  origin: { lat: 30, lng: -97 },
  originSource: "manual",
  originLabel: "Austin, TX",
};

const onOpenChangeMock = vi.fn();

function renderWizard() {
  return render(<PlanPathWizard open onOpenChange={onOpenChangeMock} />);
}

beforeEach(() => {
  onOpenChangeMock.mockClear();
  createPathMutate.mockClear();
  addStopsMutate.mockClear();
  originState.current = NO_ORIGIN;
  merchantsState.current = { merchants: [], isLoading: false, isError: false, refetch: vi.fn() };
});

describe("PlanPathWizard", () => {
  it("starts on the search step at Step 1 of 5", () => {
    renderWizard();
    expect(screen.getByText(/step 1 of 5/i)).toBeInTheDocument();
    expect(screen.getByText("Where do you want to prospect?")).toBeInTheDocument();
  });

  it("X closes the slide-out", () => {
    renderWizard();
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onOpenChangeMock).toHaveBeenCalledWith(false);
  });

  it("guards search Continue until an origin resolves", () => {
    const { rerender } = renderWizard();
    // First step is search — no origin yet → Continue disabled.
    expect(screen.getByText(/step 1 of 5/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
    // Resolve an origin and re-render.
    originState.current = WITH_ORIGIN;
    rerender(<PlanPathWizard open onOpenChange={onOpenChangeMock} />);
  });

  it("runs the Plan happy path: search → results → review → schedule → saved", async () => {
    originState.current = WITH_ORIGIN;
    merchantsState.current = {
      merchants: [m("a", "Alpha Cafe"), m("b", "Beta Bakery")],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
    renderWizard();

    // Step 1: search — origin already resolved → continue to results.
    expect(screen.getByText(/step 1 of 5/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));

    // Step 2: results — add a stop, then Review path.
    expect(screen.getByText(/step 2 of 5/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /review path/i })).toBeDisabled();
    fireEvent.click(screen.getAllByRole("button", { name: /add to today's path/i })[0]!);
    expect(screen.getByText(/1 stop added/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /review path/i }));

    // Step 3: review — advance to schedule (no save yet).
    expect(screen.getByText(/step 3 of 5/i)).toBeInTheDocument();
    expect(createPathMutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /schedule path/i }));

    // Step 4: schedule — save.
    expect(screen.getByText(/step 4 of 5/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /save path/i }));

    // Save calls createPath (scheduled date) + addStops in order.
    await waitFor(() => expect(createPathMutate).toHaveBeenCalled());
    expect(addStopsMutate).toHaveBeenCalled();
    const addArg = addStopsMutate.mock.calls[0]![0] as {
      basePosition: number;
      stops: unknown[];
    };
    expect(addArg.basePosition).toBe(0);
    expect(addArg.stops).toHaveLength(1);

    // Step 5: saved confirmation.
    await waitFor(() => expect(screen.getByText(/step 5 of 5/i)).toBeInTheDocument());
    expect(screen.getByText(/is ready/i)).toBeInTheDocument();
  });

  it("Back navigates to the previous step", () => {
    originState.current = WITH_ORIGIN;
    renderWizard();
    // Search (step 1) has no Back; advance to results, then Back returns to search.
    expect(screen.getByText(/step 1 of 5/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    expect(screen.getByText(/step 2 of 5/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(screen.getByText(/step 1 of 5/i)).toBeInTheDocument();
  });

  it('"Build another" resets the wizard to search', async () => {
    originState.current = WITH_ORIGIN;
    merchantsState.current = {
      merchants: [m("a", "Alpha Cafe")],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
    renderWizard();
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    fireEvent.click(screen.getByRole("button", { name: /add to today's path/i }));
    fireEvent.click(screen.getByRole("button", { name: /review path/i }));
    fireEvent.click(screen.getByRole("button", { name: /schedule path/i }));
    fireEvent.click(screen.getByRole("button", { name: /save path/i }));
    await waitFor(() => expect(screen.getByText(/step 5 of 5/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /build another/i }));
    expect(screen.getByText(/step 1 of 5/i)).toBeInTheDocument();
  });

  it("save uses the scheduled date + name + reminder_at, and runs exactly once", async () => {
    originState.current = WITH_ORIGIN;
    merchantsState.current = {
      merchants: [m("a", "Alpha Cafe")],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
    renderWizard();
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    fireEvent.click(screen.getByRole("button", { name: /add to today's path/i }));
    fireEvent.click(screen.getByRole("button", { name: /review path/i }));
    fireEvent.click(screen.getByRole("button", { name: /schedule path/i }));

    // Default schedule = tomorrow, default reminder 08:30, auto name from origin.
    fireEvent.click(screen.getByRole("button", { name: /save path/i }));
    await waitFor(() => expect(createPathMutate).toHaveBeenCalledTimes(1));

    const arg = createPathMutate.mock.calls[0]![0] as {
      date: string;
      name: string;
      reminderAt: string | null;
    };
    // Tomorrow, not today.
    const today = new Date();
    const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    const y = tomorrow.getFullYear();
    const mth = String(tomorrow.getMonth() + 1).padStart(2, "0");
    const d = String(tomorrow.getDate()).padStart(2, "0");
    expect(arg.date).toBe(`${y}-${mth}-${d}`);
    expect(arg.name).toContain("Austin, TX");
    expect(arg.reminderAt).toBeTruthy();

    // Landed on saved; createPath was not called a second time.
    await waitFor(() => expect(screen.getByText(/step 5 of 5/i)).toBeInTheDocument());
    expect(createPathMutate).toHaveBeenCalledTimes(1);
  });

  it("lets the rep pick Today and derives + overrides the name", async () => {
    originState.current = WITH_ORIGIN;
    merchantsState.current = {
      merchants: [m("a", "Alpha Cafe")],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
    renderWizard();
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    fireEvent.click(screen.getByRole("button", { name: /add to today's path/i }));
    fireEvent.click(screen.getByRole("button", { name: /review path/i }));
    fireEvent.click(screen.getByRole("button", { name: /schedule path/i }));

    // Name defaults from origin, then override it.
    const nameInput = screen.getByLabelText(/name this path/i) as HTMLInputElement;
    expect(nameInput.value).toContain("Austin, TX");
    fireEvent.change(nameInput, { target: { value: "My custom run" } });

    // Pick Today.
    fireEvent.click(screen.getByRole("button", { name: /^today/i }));
    fireEvent.click(screen.getByRole("button", { name: /save path/i }));

    await waitFor(() => expect(createPathMutate).toHaveBeenCalledTimes(1));
    const arg = createPathMutate.mock.calls[0]![0] as { date: string; name: string };
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    expect(arg.date).toBe(iso);
    expect(arg.name).toBe("My custom run");
  });
});
