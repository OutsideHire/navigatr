import { describe, it, expect, vi } from "vitest";
import {
  isExpired,
  mapTokenResponse,
  getFreshAccessToken,
  type TokenBundle,
} from "../../../../../../supabase/functions/_shared/googleToken";

const NOW = Date.parse("2026-07-04T12:00:00.000Z");

describe("isExpired", () => {
  it("is true when expiry is in the past", () => {
    expect(isExpired("2026-07-04T11:00:00.000Z", NOW)).toBe(true);
  });

  it("is false when expiry is comfortably in the future", () => {
    expect(isExpired("2026-07-04T13:00:00.000Z", NOW)).toBe(false);
  });

  it("treats a token within the skew window as expired", () => {
    // 30s ahead, default skew is 60s → counts as expired.
    expect(isExpired("2026-07-04T12:00:30.000Z", NOW)).toBe(true);
    // 90s ahead, outside the 60s skew → not expired.
    expect(isExpired("2026-07-04T12:01:30.000Z", NOW)).toBe(false);
  });

  it("treats an unparseable expiry as expired", () => {
    expect(isExpired("not-a-date", NOW)).toBe(true);
    expect(isExpired("", NOW)).toBe(true);
  });

  it("honours a custom skew", () => {
    expect(isExpired("2026-07-04T12:04:00.000Z", NOW, 5 * 60 * 1000)).toBe(true);
    expect(isExpired("2026-07-04T12:04:00.000Z", NOW, 60 * 1000)).toBe(false);
  });
});

describe("mapTokenResponse", () => {
  it("maps access_token + expires_in to an absolute ISO expiry", () => {
    const out = mapTokenResponse({ access_token: "new-tok", expires_in: 3600 }, NOW);
    expect(out.access_token).toBe("new-tok");
    expect(out.expiry).toBe(new Date(NOW + 3600 * 1000).toISOString());
  });
});

describe("getFreshAccessToken", () => {
  const deps = { clientId: "cid", clientSecret: "sec", now: () => NOW };

  it("returns the cached token unchanged when it is still fresh", async () => {
    const bundle: TokenBundle = {
      access_token: "cached",
      refresh_token: "r1",
      expiry: "2026-07-04T13:00:00.000Z",
    };
    const fetchImpl = vi.fn();
    const res = await getFreshAccessToken(bundle, { ...deps, fetchImpl });
    expect(res.accessToken).toBe("cached");
    expect(res.refreshed).toBe(false);
    expect(res.bundle).toBe(bundle);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refreshes via the token endpoint when expired, keeping the refresh_token", async () => {
    const bundle: TokenBundle = {
      access_token: "old",
      refresh_token: "r1",
      expiry: "2026-07-04T11:00:00.000Z", // past
    };
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "fresh", expires_in: 3600 }),
    });
    const res = await getFreshAccessToken(bundle, { ...deps, fetchImpl });
    expect(res.refreshed).toBe(true);
    expect(res.accessToken).toBe("fresh");
    expect(res.bundle.refresh_token).toBe("r1"); // preserved
    expect(res.bundle.expiry).toBe(new Date(NOW + 3600 * 1000).toISOString());
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(String(init.body)).toContain("grant_type=refresh_token");
    expect(String(init.body)).toContain("refresh_token=r1");
  });

  it("adopts a rotated refresh_token when Google returns one", async () => {
    const bundle: TokenBundle = {
      access_token: "old",
      refresh_token: "r1",
      expiry: "2026-07-04T11:00:00.000Z",
    };
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "fresh", expires_in: 3600, refresh_token: "r2" }),
    });
    const res = await getFreshAccessToken(bundle, { ...deps, fetchImpl });
    expect(res.bundle.refresh_token).toBe("r2");
  });

  it("throws when the refresh request fails", async () => {
    const bundle: TokenBundle = {
      access_token: "old",
      refresh_token: "r1",
      expiry: "2026-07-04T11:00:00.000Z",
    };
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({}) });
    await expect(getFreshAccessToken(bundle, { ...deps, fetchImpl })).rejects.toThrow(/refresh failed/);
  });
});
