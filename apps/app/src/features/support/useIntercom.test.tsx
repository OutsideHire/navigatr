// useIntercom. Verifies the ship-dark gate, the verified-identity boot, and
// the sign-out shutdown for the Intercom Messenger.
//
// The SDK (default Intercom + named shutdown) and supabase.functions.invoke
// are mocked so no script is injected and no network is hit. useProfile is
// mocked to a fixed profile; useAuth is the real store, driven via setState.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const { intercom, shutdown, update, invoke } = vi.hoisted(() => ({
  intercom: vi.fn(),
  shutdown: vi.fn(),
  update: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("@intercom/messenger-js-sdk", () => ({
  default: intercom,
  shutdown,
  update,
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke },
    // The auth store (imported transitively) hydrates from getSession and
    // subscribes via onAuthStateChange at module load. Stub both so the
    // import doesn't blow up; the tests drive user state via setState.
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  },
}));

let profileReturn: { data: unknown } = { data: null };
vi.mock("@/features/auth/useProfile", () => ({
  useProfile: () => profileReturn,
}));

import { useAuth } from "@/stores/auth";
import { useIntercom } from "./useIntercom";

const fakeUser = {
  id: "user-1",
  email: "jane@navigatr.app",
  user_metadata: { profession: "payroll" },
} as never;

const fakeProfile = {
  full_name: "Jane Rep",
  created_at: "2024-01-02T03:04:05.000Z",
  role: "manager",
  role_level: "sales_manager",
  org_id: "org-9",
};

beforeEach(() => {
  intercom.mockReset();
  shutdown.mockReset();
  update.mockReset();
  invoke.mockReset();
  profileReturn = { data: null };
  useAuth.setState({ user: null });
  delete (import.meta.env as Record<string, unknown>).VITE_INTERCOM_APP_ID;
});

afterEach(() => {
  useAuth.setState({ user: null });
});

describe("useIntercom (ship-dark gate)", () => {
  it("does nothing when VITE_INTERCOM_APP_ID is unset, even with a signed-in user", async () => {
    useAuth.setState({ user: fakeUser });
    profileReturn = { data: fakeProfile };

    renderHook(() => useIntercom());

    // Give any (unexpected) async work a chance to run.
    await Promise.resolve();
    expect(intercom).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(shutdown).not.toHaveBeenCalled();
  });
});

describe("useIntercom (boot)", () => {
  beforeEach(() => {
    (import.meta.env as Record<string, unknown>).VITE_INTERCOM_APP_ID = "app-xyz";
  });

  it("boots with verified identity + flattened attributes for a signed-in user", async () => {
    invoke.mockResolvedValueOnce({ data: { user_hash: "hmac-123" }, error: null });
    useAuth.setState({ user: fakeUser });
    profileReturn = { data: fakeProfile };

    renderHook(() => useIntercom());

    await waitFor(() => expect(intercom).toHaveBeenCalledTimes(1));
    expect(invoke).toHaveBeenCalledWith("intercom_user_hash", { body: {} });
    expect(intercom).toHaveBeenCalledWith({
      app_id: "app-xyz",
      user_id: "user-1",
      name: "Jane Rep",
      email: "jane@navigatr.app",
      created_at: 1704164645,
      user_hash: "hmac-123",
      role: "manager",
      role_level: "sales_manager",
      org_id: "org-9",
      profession: "payroll",
    });
  });

  it("boots without a user_hash key when the identity fetch fails", async () => {
    invoke.mockResolvedValueOnce({ data: null, error: { message: "down" } });
    useAuth.setState({ user: fakeUser });
    profileReturn = { data: fakeProfile };

    renderHook(() => useIntercom());

    await waitFor(() => expect(intercom).toHaveBeenCalledTimes(1));
    const settings = intercom.mock.calls[0][0] as Record<string, unknown>;
    expect("user_hash" in settings).toBe(false);
    expect(settings.app_id).toBe("app-xyz");
  });

  it("shuts down when the user signs out after having booted", async () => {
    invoke.mockResolvedValueOnce({ data: { user_hash: null }, error: null });
    useAuth.setState({ user: fakeUser });
    profileReturn = { data: fakeProfile };

    const { rerender } = renderHook(() => useIntercom());
    await waitFor(() => expect(intercom).toHaveBeenCalledTimes(1));

    // Sign out.
    useAuth.setState({ user: null });
    rerender();

    await waitFor(() => expect(shutdown).toHaveBeenCalledTimes(1));
  });

  it("does not shut down on mount when there was never a signed-in user", async () => {
    renderHook(() => useIntercom());
    await Promise.resolve();
    expect(shutdown).not.toHaveBeenCalled();
    expect(intercom).not.toHaveBeenCalled();
  });

  it("user set first, profile resolves later: booted Messenger carries the profile attributes", async () => {
    invoke.mockResolvedValue({ data: { user_hash: "hmac-123" }, error: null });

    // Mount with a signed-in user but the profile query still pending.
    useAuth.setState({ user: fakeUser });
    profileReturn = { data: null };

    const { rerender } = renderHook(() => useIntercom());

    // The Messenger boots even before the profile resolves.
    await waitFor(() => expect(intercom).toHaveBeenCalledTimes(1));

    // Now the profile query resolves; a re-render feeds the resolved data in.
    profileReturn = { data: fakeProfile };
    rerender();

    // Whatever the final applied settings are (boot or a follow-up update),
    // they must carry the profile attributes now that the profile resolved.
    await waitFor(() => {
      const applied = [...intercom.mock.calls, ...update.mock.calls].map(
        (c) => c[0] as Record<string, unknown>,
      );
      const withProfile = applied.find((s) => s.name === "Jane Rep");
      expect(withProfile).toBeDefined();
      expect(withProfile).toMatchObject({
        user_id: "user-1",
        name: "Jane Rep",
        role: "manager",
        role_level: "sales_manager",
        org_id: "org-9",
        created_at: 1704164645,
      });
    });
  });

  it("user switch re-boots with the new identity (shutdown for A, boot carrying B)", async () => {
    const userA = { id: "user-A", email: "a@navigatr.app", user_metadata: {} } as never;
    const userB = { id: "user-B", email: "b@navigatr.app", user_metadata: {} } as never;

    // Distinct hash per user: A first, then B.
    invoke
      .mockResolvedValueOnce({ data: { user_hash: "hash-A" }, error: null })
      .mockResolvedValueOnce({ data: { user_hash: "hash-B" }, error: null });

    useAuth.setState({ user: userA });
    profileReturn = { data: fakeProfile };

    const { rerender } = renderHook(() => useIntercom());

    await waitFor(() => expect(intercom).toHaveBeenCalledTimes(1));
    expect(intercom.mock.calls[0][0]).toMatchObject({
      user_id: "user-A",
      user_hash: "hash-A",
    });

    // Switch to user B without a sign-out in between.
    useAuth.setState({ user: userB });
    rerender();

    // A's session is torn down and B boots with B's identity + hash.
    await waitFor(() => expect(shutdown).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(intercom).toHaveBeenCalledTimes(2));
    expect(intercom.mock.calls[1][0]).toMatchObject({
      user_id: "user-B",
      user_hash: "hash-B",
    });
    // The second boot must not carry A's hash.
    expect((intercom.mock.calls[1][0] as Record<string, unknown>).user_hash).not.toBe("hash-A");
  });
});
