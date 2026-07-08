import { describe, it, expect } from "vitest";
import { getProvider } from "../../../../../../supabase/functions/_shared/calendarProviders/index";

describe("getProvider", () => {
  it("returns google + microsoft providers with the right id", () => {
    expect(getProvider("google").id).toBe("google");
    expect(getProvider("microsoft").id).toBe("microsoft");
  });
  it("throws on an unknown provider", () => {
    // @ts-expect-error deliberate
    expect(() => getProvider("nope")).toThrow(/unknown calendar provider/);
  });
});
