/**
 * TopBar — covers the mobile-only admin shortcuts in the avatar menu.
 *
 * A manager/admin on mobile has no BottomNav entry to Team (/admin/agents)
 * or Insights (/admin/insights) — the desktop SidebarNav has them but the
 * mobile bar doesn't. AvatarMenu surfaces them, mobile-only + role-gated.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Capture navigation from the menu items.
const navigateSpy = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigateSpy };
});

// Profile drives the role gate. Each case overrides profileReturn before render.
let profileReturn: { data?: { role: "rep" | "manager" | "admin" } } = {};
vi.mock("@/features/auth/useProfile", () => ({
  useProfile: () => profileReturn,
}));

// Auth store: TopBar only reads signOut here.
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { signOut: () => Promise<void> }) => unknown) =>
    selector({ signOut: vi.fn().mockResolvedValue(undefined) }),
}));

// NotificationsBell pulls its own data; stub it out of the unit under test.
vi.mock("./NotificationsBell", () => ({ NotificationsBell: () => null }));

import { TopBar } from "./TopBar";

// Radix DropdownMenu needs these in jsdom to open via pointer events:
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
    Element.prototype.scrollIntoView = () => {};
  }
});

beforeEach(() => {
  navigateSpy.mockReset();
  profileReturn = {};
});

const user = { fullName: "Casey Manager", email: "casey@example.com" };

function renderTopBar() {
  render(
    <MemoryRouter>
      <TopBar user={user} />
    </MemoryRouter>,
  );
}

/**
 * Open the avatar menu. The mobile and desktop chrome each render an
 * "Account menu" trigger, so `index` selects which one to open.
 */
async function openMenu(index: number) {
  const triggers = screen.getAllByRole("button", { name: /account menu/i });
  fireEvent.pointerDown(
    triggers[index],
    new MouseEvent("pointerdown", { bubbles: true, button: 0 } as PointerEventInit),
  );
  fireEvent.click(triggers[index]);
  await waitFor(() => expect(screen.getByRole("menu")).toBeInTheDocument());
}

describe("TopBar AvatarMenu admin shortcuts", () => {
  it("shows Team + Insights in the mobile menu for a manager and navigates on click", async () => {
    profileReturn = { data: { role: "manager" } };
    renderTopBar();

    // Index 0 = the md:hidden mobile chrome's avatar trigger.
    await openMenu(0);

    const team = screen.getByRole("menuitem", { name: /team/i });
    const insights = screen.getByRole("menuitem", { name: /insights/i });
    expect(team).toBeInTheDocument();
    expect(insights).toBeInTheDocument();

    fireEvent.click(team);
    expect(navigateSpy).toHaveBeenCalledWith("/admin/agents");

    await openMenu(0);
    fireEvent.click(screen.getByRole("menuitem", { name: /insights/i }));
    expect(navigateSpy).toHaveBeenCalledWith("/admin/insights");
  });

  it("does NOT show Team + Insights in the mobile menu for a rep", async () => {
    profileReturn = { data: { role: "rep" } };
    renderTopBar();

    await openMenu(0);

    expect(screen.queryByRole("menuitem", { name: /team/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /insights/i })).not.toBeInTheDocument();
  });

  it("does NOT show Team + Insights in the desktop menu for a manager", async () => {
    profileReturn = { data: { role: "manager" } };
    renderTopBar();

    // Index 1 = the md:flex desktop chrome's avatar trigger (desktop prop).
    await openMenu(1);

    expect(screen.queryByRole("menuitem", { name: /team/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /insights/i })).not.toBeInTheDocument();
  });
});
