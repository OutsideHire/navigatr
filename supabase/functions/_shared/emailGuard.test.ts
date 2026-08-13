import { describe, it, expect } from "vitest";
import { shouldSend } from "./emailGuard";

describe("shouldSend", () => {
  it("sends to anyone in production", () => {
    expect(shouldSend("production", "", "stranger@example.com")).toBe(true);
    expect(shouldSend("production", "ceo@outsidehire.com", "stranger@example.com")).toBe(true);
  });

  it("sends to an allowlisted address outside production", () => {
    expect(shouldSend("staging", "ceo@outsidehire.com,robert@outsidehire.com", "ceo@outsidehire.com")).toBe(true);
    expect(shouldSend("staging", "ceo@outsidehire.com,robert@outsidehire.com", "robert@outsidehire.com")).toBe(true);
  });

  it("drops a non-allowlisted address outside production", () => {
    expect(shouldSend("staging", "ceo@outsidehire.com", "customer@realbusiness.com")).toBe(false);
  });

  it("ignores case and surrounding whitespace on both sides", () => {
    expect(shouldSend("staging", " CEO@OutsideHire.com , x@y.com ", "ceo@outsidehire.com")).toBe(true);
    expect(shouldSend("staging", "ceo@outsidehire.com", "  CEO@OUTSIDEHIRE.COM  ")).toBe(true);
  });

  it("drops everything when the allowlist is empty, which is how demo is configured", () => {
    expect(shouldSend("demo", "", "ceo@outsidehire.com")).toBe(false);
    expect(shouldSend("demo", "   ", "ceo@outsidehire.com")).toBe(false);
    expect(shouldSend("demo", ",,,", "ceo@outsidehire.com")).toBe(false);
  });

  // The dangerous case. An unset APP_ENV must NOT be treated as production:
  // a new environment that nobody remembered to configure would otherwise mail
  // real customers. Fail closed.
  it("drops when APP_ENV is unset, rather than assuming production", () => {
    expect(shouldSend(undefined, "", "stranger@example.com")).toBe(false);
    expect(shouldSend(undefined, "stranger@example.com", "stranger@example.com")).toBe(true);
    expect(shouldSend("", "", "stranger@example.com")).toBe(false);
  });

  // Guards against a near-miss env value silently behaving as production.
  it("treats anything that is not exactly 'production' as non-production", () => {
    expect(shouldSend("Production", "", "stranger@example.com")).toBe(false);
    expect(shouldSend("prod", "", "stranger@example.com")).toBe(false);
    expect(shouldSend("production ", "", "stranger@example.com")).toBe(false);
  });

  it("does not treat an allowlist entry as a substring match", () => {
    // "evil-ceo@outsidehire.com.attacker.test" must not pass because
    // "ceo@outsidehire.com" appears inside it.
    expect(shouldSend("staging", "ceo@outsidehire.com", "evil-ceo@outsidehire.com.attacker.test")).toBe(false);
  });

  it("handles a single-entry allowlist with no commas", () => {
    expect(shouldSend("staging", "ceo@outsidehire.com", "ceo@outsidehire.com")).toBe(true);
  });
});
