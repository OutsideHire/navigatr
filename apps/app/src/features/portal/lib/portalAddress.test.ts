import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { portalAddress, portalOrigin, portalPath, referralFormAddress } from "./portalAddress";

describe("portalPath", () => {
  it("builds the relative portal path", () => {
    expect(portalPath("acme")).toBe("/p/acme");
  });

  it("appends a sub-path as given", () => {
    expect(portalPath("acme", "/home")).toBe("/p/acme/home");
    expect(portalPath("acme", "/r/abc-1")).toBe("/p/acme/r/abc-1");
  });
});

describe("portalOrigin", () => {
  it("is the current origin today", () => {
    expect(portalOrigin()).toBe(window.location.origin);
  });
});

describe("one builder for every portal link", () => {
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return sources(full);
      return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
    });
  }

  it("no portal source hand-builds a /p/ link outside portalAddress.ts", () => {
    const root = join(__dirname, "..");
    const offenders = sources(root).filter(
      (f) => !f.endsWith(join("lib", "portalAddress.ts")) && readFileSync(f, "utf8").includes("/p/${"),
    );
    expect(offenders).toEqual([]);
  });
});

describe("portalAddress", () => {
  it("builds the shareable portal address from an origin and slug", () => {
    expect(portalAddress("acme", "https://app.getnavigatr.io/")).toBe("https://app.getnavigatr.io/p/acme");
  });

  it("defaults to the current origin", () => {
    expect(portalAddress("acme")).toBe(`${window.location.origin}/p/acme`);
  });
});

describe("referralFormAddress", () => {
  it("builds the public form address for a link", () => {
    expect(referralFormAddress("acme", "aB3_-xYz", "https://app.getnavigatr.io/")).toBe(
      "https://app.getnavigatr.io/p/acme/refer/aB3_-xYz",
    );
  });

  it("defaults to the current origin and encodes the parts", () => {
    expect(referralFormAddress("acme co", "t/1")).toBe(`${window.location.origin}/p/acme%20co/refer/t%2F1`);
  });
});
