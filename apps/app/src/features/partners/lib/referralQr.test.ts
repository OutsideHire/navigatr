import { describe, it, expect, vi } from "vitest";

const toDataURL = vi.hoisted(() => vi.fn());
vi.mock("qrcode", () => ({ default: { toDataURL } }));

import { referralQrDataUrl, referralQrFileName } from "./referralQr";

describe("referralQrDataUrl", () => {
  it("draws a 512px PNG for the address", async () => {
    toDataURL.mockResolvedValueOnce("data:image/png;base64,AAAA");
    await expect(referralQrDataUrl("https://app.getnavigatr.io/p/acme/refer/tok")).resolves.toBe("data:image/png;base64,AAAA");
    expect(toDataURL).toHaveBeenCalledWith("https://app.getnavigatr.io/p/acme/refer/tok", {
      width: 512,
      margin: 2,
      errorCorrectionLevel: "M",
    });
  });
});

describe("referralQrDataUrl without a default export", () => {
  it("uses the namespace's own toDataURL", async () => {
    const named = vi.fn(async () => "data:image/png;base64,BBBB");
    vi.resetModules();
    vi.doMock("qrcode", () => ({ toDataURL: named }));
    const fresh = await import("./referralQr");
    await expect(fresh.referralQrDataUrl("https://x.example/p/a/refer/t")).resolves.toBe("data:image/png;base64,BBBB");
    expect(named).toHaveBeenCalledTimes(1);
    vi.doUnmock("qrcode");
  });
});

describe("referralQrFileName", () => {
  it("names the personal and the company QR images", () => {
    expect(referralQrFileName("user")).toBe("my-referral-qr.png");
    expect(referralQrFileName("tenant")).toBe("company-referral-qr.png");
  });
});
