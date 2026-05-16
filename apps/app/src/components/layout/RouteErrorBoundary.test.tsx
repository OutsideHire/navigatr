// Tests the route error boundary catches render errors AND auto-resets
// on route change. The auto-reset behavior is the one most likely to
// regress silently — if someone refactors away the `resetKey` prop, the
// boundary still works but a stuck-error UX appears that tests will catch.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route, Link } from "react-router-dom";
import { RouteErrorBoundary } from "./RouteErrorBoundary";

function Bomb(): React.ReactElement {
  throw new Error("kaboom from Bomb");
}

function Safe() {
  return <div>safe page content</div>;
}

function NavToSafe() {
  return (
    <div>
      <Link to="/safe">go safe</Link>
    </div>
  );
}

describe("RouteErrorBoundary", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // React + our boundary both log errors. Silence them so the test
    // output stays readable; we don't care about console noise here,
    // just behavior.
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("catches a render error and shows the fallback", () => {
    render(
      <MemoryRouter initialEntries={["/bomb"]}>
        <Routes>
          <Route
            path="/bomb"
            element={
              <RouteErrorBoundary>
                <Bomb />
              </RouteErrorBoundary>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Try again/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Back to dashboard/i })).toBeInTheDocument();
  });

  it("auto-resets when the route changes (real navigation bite)", () => {
    // We need a Link rendered OUTSIDE the failing boundary, otherwise the
    // boundary's fallback replaces it and the user can't click. Put the
    // NavToSafe link in a sibling route so it's always reachable, then
    // simulate navigation via a programmatic Link click.
    function Layout() {
      return (
        <>
          <NavToSafe />
          <Routes>
            <Route
              path="/bomb"
              element={
                <RouteErrorBoundary>
                  <Bomb />
                </RouteErrorBoundary>
              }
            />
            <Route
              path="/safe"
              element={
                <RouteErrorBoundary>
                  <Safe />
                </RouteErrorBoundary>
              }
            />
          </Routes>
        </>
      );
    }

    render(
      <MemoryRouter initialEntries={["/bomb"]}>
        <Layout />
      </MemoryRouter>,
    );

    // Boundary caught the bomb.
    expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
    expect(screen.queryByText("safe page content")).not.toBeInTheDocument();

    // Navigate via the sibling Link. The pathname change should flip
    // resetKey on the boundary at /safe, clearing any captured error
    // before its child renders.
    fireEvent.click(screen.getByRole("link", { name: /go safe/i }));

    // /safe's boundary renders Safe cleanly — no fallback.
    expect(screen.getByText("safe page content")).toBeInTheDocument();
    expect(screen.queryByText(/Something went wrong/i)).not.toBeInTheDocument();
  });

  it("Try again button resets the boundary (then re-throws if the bug persists)", () => {
    // First render → bomb → fallback shows.
    // Click Try again → boundary clears state → re-renders Bomb → throws
    // again → fallback shows again. The button at minimum doesn't crash
    // the outer tree.
    render(
      <MemoryRouter initialEntries={["/bomb"]}>
        <Routes>
          <Route
            path="/bomb"
            element={
              <RouteErrorBoundary>
                <Bomb />
              </RouteErrorBoundary>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Try again/i }));
    // Bomb still throws → boundary catches again → fallback still visible.
    expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
  });

  it("renders children unchanged when nothing throws", () => {
    render(
      <MemoryRouter initialEntries={["/safe"]}>
        <Routes>
          <Route
            path="/safe"
            element={
              <RouteErrorBoundary>
                <Safe />
              </RouteErrorBoundary>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("safe page content")).toBeInTheDocument();
    expect(screen.queryByText(/Something went wrong/i)).not.toBeInTheDocument();
  });
});
