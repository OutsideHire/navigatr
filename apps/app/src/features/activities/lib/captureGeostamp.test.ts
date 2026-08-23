import { describe, it, expect, vi, afterEach } from "vitest";
import { readPositionOnce, isGeostampEnabled, captureAndStoreGeostamp } from "./captureGeostamp";
import type { SupabaseClient } from "@supabase/supabase-js";

const origNavigator = globalThis.navigator;
afterEach(() => {
  // restore navigator between tests
  Object.defineProperty(globalThis, "navigator", { value: origNavigator, configurable: true });
  vi.restoreAllMocks();
});

function setGeolocation(impl: Partial<Geolocation> | undefined) {
  Object.defineProperty(globalThis, "navigator", {
    value: impl === undefined ? {} : { geolocation: impl },
    configurable: true,
  });
}

describe("readPositionOnce", () => {
  it("maps a fix to 'captured' with coords + accuracy", async () => {
    setGeolocation({
      getCurrentPosition: (ok) =>
        ok({ coords: { latitude: 30.2, longitude: -97.7, accuracy: 9 } } as GeolocationPosition),
    } as Geolocation);
    expect(await readPositionOnce()).toEqual({
      status: "captured", latitude: 30.2, longitude: -97.7, accuracyM: 9,
    });
  });
  it("maps error code 1 -> permission_denied, 3 -> timed_out, else unavailable", async () => {
    for (const [code, status] of [[1, "permission_denied"], [3, "timed_out"], [2, "unavailable"]] as const) {
      setGeolocation({
        getCurrentPosition: (_ok, err) => err!({ code } as GeolocationPositionError),
      } as Geolocation);
      expect((await readPositionOnce()).status).toBe(status);
    }
  });
  it("is 'unsupported' when geolocation is absent", async () => {
    setGeolocation(undefined);
    expect((await readPositionOnce()).status).toBe("unsupported");
  });
});

function fakeSupabase(over: { settingsRow?: { activity_geostamp_enabled: boolean } | null; settingsError?: boolean } = {}) {
  const inserts: Array<Record<string, unknown>> = [];
  const client = {
    from: (table: string) => {
      if (table === "user_location_settings") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () =>
                over.settingsError
                  ? { data: null, error: { message: "boom" } }
                  : { data: over.settingsRow ?? null, error: null },
            }),
          }),
        };
      }
      // activity_locations
      return { insert: async (row: Record<string, unknown>) => { inserts.push(row); return { error: null }; } };
    },
    _inserts: inserts,
  };
  return client as unknown as SupabaseClient & { _inserts: Array<Record<string, unknown>> };
}

describe("isGeostampEnabled", () => {
  it("defaults ON when no row exists", async () => {
    expect(await isGeostampEnabled(fakeSupabase({ settingsRow: null }), "u1")).toBe(true);
  });
  it("respects an explicit opt-out", async () => {
    expect(await isGeostampEnabled(fakeSupabase({ settingsRow: { activity_geostamp_enabled: false } }), "u1")).toBe(false);
  });
  it("fails open to ON on a read error", async () => {
    expect(await isGeostampEnabled(fakeSupabase({ settingsError: true }), "u1")).toBe(true);
  });
});

describe("captureAndStoreGeostamp", () => {
  it("writes a geostamp row when consent is on (even a denial)", async () => {
    setGeolocation({ getCurrentPosition: (_ok, err) => err!({ code: 1 } as GeolocationPositionError) } as Geolocation);
    const supabase = fakeSupabase({ settingsRow: null });
    await captureAndStoreGeostamp({ supabase, userId: "u1", orgId: "o1", activityId: "a1", dealId: "d1" });
    expect(supabase._inserts).toHaveLength(1);
    expect(supabase._inserts[0]).toMatchObject({
      activity_id: "a1", org_id: "o1", deal_id: "d1", capture_status: "permission_denied",
      latitude: null, longitude: null,
    });
  });
  it("writes nothing when the rep opted out", async () => {
    setGeolocation({ getCurrentPosition: (ok) => ok({ coords: { latitude: 1, longitude: 2, accuracy: 3 } } as GeolocationPosition) } as Geolocation);
    const supabase = fakeSupabase({ settingsRow: { activity_geostamp_enabled: false } });
    await captureAndStoreGeostamp({ supabase, userId: "u1", orgId: "o1", activityId: "a1", dealId: null });
    expect(supabase._inserts).toHaveLength(0);
  });
  it("never throws even if geolocation is unsupported", async () => {
    setGeolocation(undefined);
    const supabase = fakeSupabase({ settingsRow: null });
    await expect(
      captureAndStoreGeostamp({ supabase, userId: "u1", orgId: "o1", activityId: "a1", dealId: null }),
    ).resolves.toBeUndefined();
    expect(supabase._inserts[0]).toMatchObject({ capture_status: "unsupported" });
  });
});
