import { describe, it, expect, vi } from "vitest";
import {
  PUBLIC_FORM_FIELDS,
  PUBLIC_FORM_LIMITS,
  PUBLIC_FORM_MAX_AGE_MS,
  PUBLIC_FORM_MIN_AGE_MS,
  TURNSTILE_VERIFY_URL,
  checkFormToken,
  fakeRef,
  isPublicFormField,
  signFormToken,
  validatePublicSubmission,
  verifyTurnstile,
} from "./portalPublicForm";

const GOOD = {
  companyName: "  Fresh Bakery ",
  contactName: " Ann Owner ",
  email: " ANN@Bakery.Example ",
  phone: " (555) 010-0100 ",
  notes: " Needs a new terminal. ",
  referredBy: " Joe at the bank ",
  referrerEmail: " Joe@Bank.Example ",
  consent: true,
  consentVersion: 2,
};

describe("validatePublicSubmission", () => {
  it("trims every field, lowercases the email and keeps who referred", () => {
    expect(validatePublicSubmission(GOOD)).toEqual({
      ok: true,
      value: {
        companyName: "Fresh Bakery",
        contactName: "Ann Owner",
        email: "ann@bakery.example",
        phone: "(555) 010-0100",
        notes: "Needs a new terminal.",
        referredBy: "Joe at the bank",
        referrerEmail: "joe@bank.example",
        consentVersion: 2,
      },
    });
  });

  it("turns a blank or missing 'who referred' into null", () => {
    const blank = validatePublicSubmission({ ...GOOD, referredBy: "   " });
    expect(blank.ok && blank.value.referredBy).toBeNull();
    const { referredBy: _omit, ...rest } = GOOD;
    const missing = validatePublicSubmission(rest);
    expect(missing.ok && missing.value.referredBy).toBeNull();
  });

  it("turns a blank or missing referrer email into null (no confirmation email)", () => {
    const blank = validatePublicSubmission({ ...GOOD, referrerEmail: "  " });
    expect(blank.ok && blank.value.referrerEmail).toBeNull();
    const { referrerEmail: _omit, ...rest } = GOOD;
    const missing = validatePublicSubmission(rest);
    expect(missing.ok && missing.value.referrerEmail).toBeNull();
  });

  it.each([
    ["companyName", { companyName: "  " }],
    ["companyName", { companyName: "x".repeat(PUBLIC_FORM_LIMITS.companyName + 1) }],
    ["contactName", { contactName: "" }],
    ["contactName", { contactName: "x".repeat(PUBLIC_FORM_LIMITS.contactName + 1) }],
    ["email", { email: "" }],
    ["email", { email: "nope" }],
    ["email", { email: `${"a".repeat(250)}@b.co` }],
    ["phone", { phone: "" }],
    ["phone", { phone: "555-01" }],
    ["phone", { phone: "5".repeat(PUBLIC_FORM_LIMITS.phone + 1) }],
    ["notes", { notes: "  " }],
    ["notes", { notes: "n".repeat(PUBLIC_FORM_LIMITS.notes + 1) }],
    ["referredBy", { referredBy: "r".repeat(PUBLIC_FORM_LIMITS.referredBy + 1) }],
    ["referrerEmail", { referrerEmail: "not-an-email" }],
    ["referrerEmail", { referrerEmail: `${"a".repeat(250)}@b.co` }],
    ["referrerEmail", { referrerEmail: 42 }],
    ["consent", { consent: false }],
    ["consent", { consent: "true" }],
    ["consent", { consentVersion: "2" }],
    ["consent", { consentVersion: 1.5 }],
  ])("points at %s", (field, patch) => {
    expect(validatePublicSubmission({ ...GOOD, ...patch })).toEqual({ ok: false, field });
  });

  it("accepts every field at its cap", () => {
    const atCap = validatePublicSubmission({
      ...GOOD,
      companyName: "c".repeat(PUBLIC_FORM_LIMITS.companyName),
      contactName: "n".repeat(PUBLIC_FORM_LIMITS.contactName),
      phone: "5".repeat(PUBLIC_FORM_LIMITS.phone),
      notes: "x".repeat(PUBLIC_FORM_LIMITS.notes),
      referredBy: "r".repeat(PUBLIC_FORM_LIMITS.referredBy),
    });
    expect(atCap.ok).toBe(true);
  });

  it("treats an empty body as a missing company", () => {
    expect(validatePublicSubmission({})).toEqual({ ok: false, field: "companyName" });
  });

  it("knows its own field names and nothing else", () => {
    for (const f of PUBLIC_FORM_FIELDS) expect(isPublicFormField(f)).toBe(true);
    expect(isPublicFormField("address")).toBe(false);
    expect(isPublicFormField(7)).toBe(false);
  });
});

describe("form token", () => {
  const SECRET = "test-signing-secret";
  const ISSUED = Date.parse("2026-10-18T12:00:00Z");

  it("signs the issue time and accepts the token once it is old enough", async () => {
    const t = await signFormToken(SECRET, "acme", "tok123", ISSUED);
    expect(t).toMatch(/^\d+\.[0-9a-f]{64}$/);
    expect(t.startsWith(`${ISSUED}.`)).toBe(true);
    expect(await checkFormToken(SECRET, "acme", "tok123", t, ISSUED + PUBLIC_FORM_MIN_AGE_MS)).toBe("ok");
    expect(await checkFormToken(SECRET, "acme", "tok123", t, ISSUED + PUBLIC_FORM_MAX_AGE_MS)).toBe("ok");
  });

  it("calls a token younger than 3 seconds, or from the future, too fast", async () => {
    const t = await signFormToken(SECRET, "acme", "tok123", ISSUED);
    expect(await checkFormToken(SECRET, "acme", "tok123", t, ISSUED + PUBLIC_FORM_MIN_AGE_MS - 1)).toBe("too_fast");
    expect(await checkFormToken(SECRET, "acme", "tok123", t, ISSUED - 60_000)).toBe("too_fast");
  });

  it("rejects an expired, forged, moved or malformed token", async () => {
    const t = await signFormToken(SECRET, "acme", "tok123", ISSUED);
    expect(await checkFormToken(SECRET, "acme", "tok123", t, ISSUED + PUBLIC_FORM_MAX_AGE_MS + 1)).toBe("invalid");
    expect(await checkFormToken("other-secret", "acme", "tok123", t, ISSUED + 10_000)).toBe("invalid");
    expect(await checkFormToken(SECRET, "other", "tok123", t, ISSUED + 10_000)).toBe("invalid");
    expect(await checkFormToken(SECRET, "acme", "tok999", t, ISSUED + 10_000)).toBe("invalid");
    const earlier = `${ISSUED - 10_000}.${t.split(".")[1]}`;
    expect(await checkFormToken(SECRET, "acme", "tok123", earlier, ISSUED + 10_000)).toBe("invalid");
    for (const bad of ["", "abc", `${ISSUED}.`, `${ISSUED}.zz`, `x.${"0".repeat(64)}`]) {
      expect(await checkFormToken(SECRET, "acme", "tok123", bad, ISSUED + 10_000)).toBe("invalid");
    }
  });
});

describe("fakeRef", () => {
  it("looks exactly like a real reference and is random", () => {
    const a = fakeRef();
    const b = fakeRef();
    expect(a).toMatch(/^REF-[0-9A-F]{8}$/);
    expect(b).toMatch(/^REF-[0-9A-F]{8}$/);
    expect(a).not.toBe(b);
  });
});

describe("verifyTurnstile", () => {
  const ok = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  it("posts the secret, the token and the IP and trusts only success: true", async () => {
    const fetchFn = vi.fn(async (_url: string, _init: RequestInit) => ok({ success: true }));
    expect(await verifyTurnstile(fetchFn, "sek", "tt-1", "203.0.113.5")).toBe(true);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(TURNSTILE_VERIFY_URL);
    expect(init.method).toBe("POST");
    const form = new URLSearchParams(String(init.body));
    expect(form.get("secret")).toBe("sek");
    expect(form.get("response")).toBe("tt-1");
    expect(form.get("remoteip")).toBe("203.0.113.5");
  });

  it("leaves the IP out when there is none", async () => {
    const fetchFn = vi.fn(async (_url: string, _init: RequestInit) => ok({ success: true }));
    await verifyTurnstile(fetchFn, "sek", "tt-1", null);
    expect(new URLSearchParams(String(fetchFn.mock.calls[0][1].body)).has("remoteip")).toBe(false);
  });

  it("fails closed without a secret, a token or a fetch, and never calls out", async () => {
    const fetchFn = vi.fn(async () => ok({ success: true }));
    expect(await verifyTurnstile(fetchFn, "", "tt-1", null)).toBe(false);
    expect(await verifyTurnstile(fetchFn, null, "tt-1", null)).toBe(false);
    expect(await verifyTurnstile(fetchFn, "sek", "", null)).toBe(false);
    expect(await verifyTurnstile(undefined, "sek", "tt-1", null)).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("fails on success: false, a non-2xx answer, bad JSON or a network error", async () => {
    expect(await verifyTurnstile(async () => ok({ success: false }), "sek", "tt", null)).toBe(false);
    expect(await verifyTurnstile(async () => ok({ success: true }, 500), "sek", "tt", null)).toBe(false);
    expect(await verifyTurnstile(async () => new Response("not json"), "sek", "tt", null)).toBe(false);
    expect(
      await verifyTurnstile(async () => {
        throw new Error("offline");
      }, "sek", "tt", null),
    ).toBe(false);
  });
});

describe("validatePublicSubmission control characters (R4)", () => {
  const CONTROLS: [string, string][] = [
    ["NUL", "\u0000"],
    ["BEL", "\u0007"],
    ["TAB", "\t"],
    ["LF", "\n"],
    ["CR", "\r"],
    ["ESC", "\u001b"],
    ["DEL", "\u007f"],
  ];
  const SINGLE_LINE = ["companyName", "contactName", "phone", "referredBy"] as const;

  for (const field of SINGLE_LINE) {
    it.each(CONTROLS)(`rejects %s inside ${field}`, (_name, ch) => {
      expect(validatePublicSubmission({ ...GOOD, [field]: `ab${ch}cd 5550100` })).toEqual({ ok: false, field });
    });
  }

  for (const field of ["email", "referrerEmail"] as const) {
    it.each(CONTROLS)(`rejects %s inside ${field}`, (_name, ch) => {
      expect(validatePublicSubmission({ ...GOOD, [field]: `ann${ch}@bakery.example` })).toEqual({ ok: false, field });
    });
    it(`rejects a space inside ${field}`, () => {
      expect(validatePublicSubmission({ ...GOOD, [field]: "an n@bakery.example" })).toEqual({ ok: false, field });
    });
  }

  it("still trims leading and trailing whitespace before checking", () => {
    expect(validatePublicSubmission({ ...GOOD, companyName: "\t Fresh Bakery \n" }).ok).toBe(true);
  });

  it("lets notes keep LF, CR and tab", () => {
    const r = validatePublicSubmission({ ...GOOD, notes: "line one\r\nline two\tend" });
    expect(r.ok && r.value.notes).toBe("line one\r\nline two\tend");
  });

  it.each(CONTROLS.filter(([n]) => !["TAB", "LF", "CR"].includes(n)))("rejects %s inside notes", (_n, ch) => {
    expect(validatePublicSubmission({ ...GOOD, notes: `a${ch}b` })).toEqual({ ok: false, field: "notes" });
  });
});
