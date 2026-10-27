import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  PUBLIC_FORM_FIELDS,
  PUBLIC_FORM_LIMITS,
  PUBLIC_FORM_MAX_AGE_MS,
  PUBLIC_FORM_MIN_AGE_MS,
  PUBLIC_HONEYPOT_FIELD,
  TURNSTILE_VERIFY_URL,
  checkFormToken,
  fakeRef,
  handlePublicFormAction,
  isPublicFormField,
  signFormToken,
  validatePublicSubmission,
  verifyTurnstile,
  type PublicFormDeps,
} from "./portalPublicForm";

const GOOD = {
  companyName: "  Fresh Bakery ",
  contactName: " Ann Owner ",
  email: " ANN@Bakery.Example ",
  phone: " (555) 010-0100 ",
  notes: " Needs a new terminal. ",
  referredBy: " Joe at the bank ",
  referrerEmail: " Joe@Bank.Example ",
  employeeCount: " 51-200 ",
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
        employeeCount: "51-200",
        consentVersion: 2,
      },
    });
  });

  it("keeps the employee count optional (FR-PORT-35)", () => {
    const blank = validatePublicSubmission({ ...GOOD, employeeCount: "" });
    expect(blank.ok && blank.value.employeeCount).toBeNull();
    const { employeeCount: _omit, ...rest } = GOOD;
    const missing = validatePublicSubmission(rest);
    expect(missing.ok && missing.value.employeeCount).toBeNull();
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
    ["employeeCount", { employeeCount: "50-249" }],
    ["employeeCount", { employeeCount: "many" }],
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

  it("rejects a non-canonical timestamp with a leading zero, even with a valid signature for it", async () => {
    const t = await signFormToken(SECRET, "acme", "tok123", ISSUED);
    const mac = t.split(".")[1];
    expect(await checkFormToken(SECRET, "acme", "tok123", `0${ISSUED}.${mac}`, ISSUED + 10_000)).toBe("invalid");
    expect(await checkFormToken(SECRET, "acme", "tok123", `0.${"0".repeat(64)}`, ISSUED + 10_000)).toBe("invalid");
  });

  it("keeps the slug and the link token apart, so moving a separator never yields the same signature", async () => {
    // With "." as the delimiter, ("a.b", "c") and ("a", "b.c") signed the same message.
    const a = await signFormToken(SECRET, "a.b", "c", ISSUED);
    expect(await checkFormToken(SECRET, "a", "b.c", a, ISSUED + 10_000)).toBe("invalid");
    expect(await checkFormToken(SECRET, "a.b", "c", a, ISSUED + 10_000)).toBe("ok");
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

describe("verifyTurnstile timeout", () => {
  it("returns false when the check hangs past the timeout", async () => {
    const hang = (_u: string, init: RequestInit) =>
      new Promise<Response>((_res, rej) => {
        init.signal?.addEventListener("abort", () => rej(new Error("aborted")));
      });
    expect(await verifyTurnstile(hang, "sek", "tt", null, 20)).toBe(false);
  });

  it("passes an abort signal to fetch by default", async () => {
    const fetchFn = vi.fn(async (_u: string, _i: RequestInit) => new Response(JSON.stringify({ success: true })));
    expect(await verifyTurnstile(fetchFn, "sek", "tt", null)).toBe(true);
    expect(fetchFn.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
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

describe("handlePublicFormAction", () => {
  const SECRET = "test-signing-secret";
  const NOW = Date.parse("2026-10-18T12:00:00Z");
  const FORM_ROW = {
    org_name: "Acme ISO",
    rep_name: "Rita Rep",
    consent_text: "I may share this.",
    consent_version: 2,
    org_id: "secret-org",
    user_id: "secret-user",
  };
  const SUBMIT_ROW = {
    id: "1a2b3c4d-0000-0000-0000-000000000000",
    ref: "REF-1A2B3C4D",
    org_name: "Acme ISO",
    logo_url: null,
    primary_color: "#0f766e",
  };
  type Rpc = (name: string, args: Record<string, unknown>) => { data: unknown; error: { message: string } | null };

  function setup(rpcImpl: Rpc, env: Partial<PublicFormDeps["env"]> = {}, fetchOk = true) {
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => rpcImpl(name, args));
    const sendEmail = vi.fn(async (_m: { from: string; to: string; subject: string; html: string; text: string }) => {});
    const background = vi.fn();
    const fetchFn = vi.fn(async (_u: string, _i: RequestInit) => new Response(JSON.stringify({ success: fetchOk })));
    const deps: PublicFormDeps = {
      rpc,
      sendEmail,
      background,
      fetch: fetchFn,
      now: () => new Date(NOW),
      env: {
        fromAddress: "navigatr <invites@send.getnavigatr.io>",
        appEnv: "production",
        emailAllowlist: "",
        publicFormSigningSecret: SECRET,
        turnstileSecretKey: "turnstile-secret",
        ...env,
      },
    };
    return { deps, rpc, sendEmail, background, fetchFn };
  }

  const routes = (
    recent: number,
    submit: { data: unknown; error: { message: string } | null } = { data: [SUBMIT_ROW], error: null },
    linkCount = 0,
  ): Rpc =>
    (name) => {
      if (name === "portal_public_counts") return { data: [{ ip_count: recent, link_count: linkCount }], error: null };
      if (name === "portal_public_submit") return submit;
      return { data: null, error: { message: `unexpected ${name}` } };
    };

  async function body(overrides: Record<string, unknown> = {}, ageMs = 10_000) {
    return {
      companyName: "Fresh Bakery",
      contactName: "Ann Owner",
      email: "ann@bakery.example",
      phone: "(555) 010-0100",
      notes: "Needs a new terminal.",
      referredBy: "Joe at the bank",
      referrerEmail: "joe@bank.example",
      employeeCount: "51-200",
      consent: true,
      consentVersion: 2,
      formToken: await signFormToken(SECRET, "acme", "tok123", NOW - ageMs),
      [PUBLIC_HONEYPOT_FIELD]: "",
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("public_form", () => {
    it("answers only the allowlisted fields with a form token signed now", async () => {
      const { deps, rpc } = setup(() => ({ data: [FORM_ROW], error: null }));
      const res = await handlePublicFormAction("public_form", "acme", "tok123", {}, null, deps);
      expect(rpc).toHaveBeenCalledWith("portal_public_form", { p_slug: "acme", p_token: "tok123" });
      expect(res.status).toBe(200);
      const form = (res.body as { form: Record<string, unknown> }).form;
      expect(Object.keys(form).sort()).toEqual(["consentText", "consentVersion", "formToken", "orgName", "repName"]);
      expect(form).toMatchObject({ orgName: "Acme ISO", repName: "Rita Rep", consentText: "I may share this.", consentVersion: 2 });
      expect(String(form.formToken).startsWith(`${NOW}.`)).toBe(true);
      expect(await checkFormToken(SECRET, "acme", "tok123", String(form.formToken), NOW + 5_000)).toBe("ok");
    });

    it("passes a missing rep name as null", async () => {
      const { deps } = setup(() => ({ data: [{ ...FORM_ROW, rep_name: null }], error: null }));
      const res = await handlePublicFormAction("public_form", "acme", "tok123", {}, null, deps);
      expect((res.body as { form: { repName: unknown } }).form.repName).toBeNull();
    });

    it("answers one generic not_available for every unavailable link", async () => {
      const { deps } = setup(() => ({ data: [], error: null }));
      const res = await handlePublicFormAction("public_form", "acme", "tok123", {}, null, deps);
      expect(res).toEqual({ status: 404, body: { error: "not_available" } });
    });

    it("fails closed without a signing secret, before any database call", async () => {
      const { deps, rpc } = setup(() => ({ data: [FORM_ROW], error: null }), { publicFormSigningSecret: "" });
      expect(await handlePublicFormAction("public_form", "acme", "tok123", {}, null, deps)).toEqual({
        status: 503,
        body: { error: "not_available" },
      });
      expect(rpc).not.toHaveBeenCalled();
    });

    it("answers not_available for a blank slug or token without a database call", async () => {
      const { deps, rpc } = setup(() => ({ data: [FORM_ROW], error: null }));
      expect((await handlePublicFormAction("public_form", "", "tok123", {}, null, deps)).status).toBe(404);
      expect((await handlePublicFormAction("public_form", "acme", "", {}, null, deps)).status).toBe(404);
      expect(rpc).not.toHaveBeenCalled();
    });

    it("500s on a database error", async () => {
      const { deps } = setup(() => ({ data: null, error: { message: "boom" } }));
      expect((await handlePublicFormAction("public_form", "acme", "tok123", {}, null, deps)).status).toBe(500);
    });
  });

  describe("public_submit", () => {
    it("stores the referral, emails only the ISO name and reference to the referrer, and answers the reference", async () => {
      const { deps, rpc, sendEmail, background } = setup(routes(0));
      const res = await handlePublicFormAction("public_submit", "acme", "tok123", await body(), "203.0.113.5", deps);
      expect(res).toEqual({ status: 200, body: { submission: { ref: "REF-1A2B3C4D" } } });
      expect(rpc).toHaveBeenNthCalledWith(1, "portal_public_counts", { p_slug: "acme", p_token: "tok123", p_ip: "203.0.113.5" });
      expect(rpc).toHaveBeenNthCalledWith(2, "portal_public_submit", {
        p_slug: "acme",
        p_token: "tok123",
        p_company: "Fresh Bakery",
        p_contact_name: "Ann Owner",
        p_contact_email: "ann@bakery.example",
        p_contact_phone: "(555) 010-0100",
        p_notes: "Needs a new terminal.",
        p_referred_by: "Joe at the bank",
        p_referrer_email: "joe@bank.example",
        p_consent_version: 2,
        p_ip: "203.0.113.5",
        p_captcha_passed: false,
        p_employee_count: "51-200",
      });
      expect(sendEmail).toHaveBeenCalledTimes(1);
      expect(background).toHaveBeenCalledTimes(1);
      const msg = sendEmail.mock.calls[0][0];
      expect(msg.to).toBe("joe@bank.example");
      expect(msg.from).toBe('"Acme ISO" <invites@send.getnavigatr.io>');
      expect(msg.subject).toBe("Acme ISO received your referral");
      expect(msg.text).toContain("REF-1A2B3C4D");
      // The brand accent only paints a button, and this email has none, so the color is not asserted here.
      for (const typed of ["Fresh Bakery", "Ann Owner", "51-200", "ann@bakery.example", "Needs a new terminal.", "Joe at the bank", "555"]) {
        expect(msg.text).not.toContain(typed);
        expect(msg.html).not.toContain(typed);
      }
    });

    it("sends no confirmation without a referrer email, and never to the business contact", async () => {
      const { deps, rpc, sendEmail } = setup(routes(0));
      const res = await handlePublicFormAction("public_submit", "acme", "tok123", await body({ referrerEmail: "" }), "203.0.113.5", deps);
      expect(res).toEqual({ status: 200, body: { submission: { ref: "REF-1A2B3C4D" } } });
      expect(rpc).toHaveBeenCalledWith("portal_public_submit", expect.objectContaining({ p_referrer_email: null }));
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it("points at a malformed referrer email", async () => {
      const { deps, rpc } = setup(routes(0));
      expect(
        await handlePublicFormAction("public_submit", "acme", "tok123", await body({ referrerEmail: "joe@" }), "203.0.113.5", deps),
      ).toEqual({ status: 400, body: { error: "invalid_body", field: "referrerEmail" } });
      expect(rpc).not.toHaveBeenCalled();
    });

    it("answers a too-fast post or a filled honeypot exactly like success, writing and sending nothing", async () => {
      for (const b of [await body({}, 1_000), await body({ [PUBLIC_HONEYPOT_FIELD]: "http://spam.example" })]) {
        const { deps, rpc, sendEmail } = setup(routes(0));
        const res = await handlePublicFormAction("public_submit", "acme", "tok123", b, "203.0.113.5", deps);
        expect(res.status).toBe(200);
        expect(Object.keys(res.body as object)).toEqual(["submission"]);
        expect(Object.keys((res.body as { submission: object }).submission)).toEqual(["ref"]);
        expect((res.body as { submission: { ref: string } }).submission.ref).toMatch(/^REF-[0-9A-F]{8}$/);
        expect(rpc).not.toHaveBeenCalled();
        expect(sendEmail).not.toHaveBeenCalled();
      }
    });

    it("asks for a reload when the form token is missing, forged or a day old", async () => {
      for (const b of [
        await body({ formToken: "" }),
        await body({ formToken: `${NOW - 10_000}.${"0".repeat(64)}` }),
        await body({}, 25 * 60 * 60 * 1000),
      ]) {
        const { deps, rpc } = setup(routes(0));
        expect(await handlePublicFormAction("public_submit", "acme", "tok123", b, "203.0.113.5", deps)).toEqual({
          status: 409,
          body: { error: "form_expired" },
        });
        expect(rpc).not.toHaveBeenCalled();
      }
    });

    it("points at the first bad field before any database call", async () => {
      const { deps, rpc } = setup(routes(0));
      expect(await handlePublicFormAction("public_submit", "acme", "tok123", await body({ phone: "12" }), "203.0.113.5", deps)).toEqual({
        status: 400,
        body: { error: "invalid_body", field: "phone" },
      });
      expect(await handlePublicFormAction("public_submit", "acme", "tok123", await body({ consent: false }), "203.0.113.5", deps)).toEqual({
        status: 400,
        body: { error: "invalid_body", field: "consent" },
      });
      expect(rpc).not.toHaveBeenCalled();
    });

    it("asks for the check past 5 in an hour, and stores nothing without it", async () => {
      const { deps, rpc, fetchFn } = setup(routes(5));
      expect(await handlePublicFormAction("public_submit", "acme", "tok123", await body(), "203.0.113.5", deps)).toEqual({
        status: 429,
        body: { error: "captcha_required" },
      });
      expect(rpc).toHaveBeenCalledTimes(1);
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it("lets a passed check through and refuses a failed one", async () => {
      const passed = setup(routes(7));
      const res = await handlePublicFormAction(
        "public_submit", "acme", "tok123", await body({ captchaToken: "tt-ok" }), "203.0.113.5", passed.deps,
      );
      expect(res.status).toBe(200);
      expect(passed.fetchFn).toHaveBeenCalledTimes(1);
      expect(passed.rpc).toHaveBeenCalledWith("portal_public_submit", expect.objectContaining({ p_captcha_passed: true }));

      const failed = setup(routes(7), {}, false);
      expect(
        await handlePublicFormAction("public_submit", "acme", "tok123", await body({ captchaToken: "tt-bad" }), "203.0.113.5", failed.deps),
      ).toEqual({ status: 429, body: { error: "captcha_required" } });
      expect(failed.rpc).not.toHaveBeenCalledWith("portal_public_submit", expect.anything());
    });

    it("treats an unresolvable client IP as over the per-IP limit (R3)", async () => {
      const none = setup(routes(0));
      expect(await handlePublicFormAction("public_submit", "acme", "tok123", await body(), null, none.deps)).toEqual({
        status: 429,
        body: { error: "captcha_required" },
      });
      expect(none.rpc).not.toHaveBeenCalledWith("portal_public_submit", expect.anything());
      expect(none.fetchFn).not.toHaveBeenCalled();

      const passed = setup(routes(0));
      const res = await handlePublicFormAction("public_submit", "acme", "tok123", await body({ captchaToken: "tt-ok" }), null, passed.deps);
      expect(res.status).toBe(200);
      expect(passed.fetchFn).toHaveBeenCalledTimes(1);
      expect(passed.rpc).toHaveBeenCalledWith("portal_public_submit", expect.objectContaining({ p_ip: null }));

      const failed = setup(routes(0), {}, false);
      expect(
        await handlePublicFormAction("public_submit", "acme", "tok123", await body({ captchaToken: "tt-bad" }), "  ", failed.deps),
      ).toEqual({ status: 429, body: { error: "captcha_required" } });
    });

    it("asks for the check once the link has 10 an hour, for everyone on it", async () => {
      const { deps, rpc, fetchFn } = setup(routes(0, undefined, 10));
      expect(await handlePublicFormAction("public_submit", "acme", "tok123", await body(), "203.0.113.5", deps)).toEqual({
        status: 429,
        body: { error: "captcha_required" },
      });
      expect(rpc).not.toHaveBeenCalledWith("portal_public_submit", expect.anything());
      const below = setup(routes(0, undefined, 9));
      expect((await handlePublicFormAction("public_submit", "acme", "tok123", await body(), "203.0.113.5", below.deps)).status).toBe(200);
      const passed = setup(routes(0, undefined, 10));
      expect(
        (await handlePublicFormAction("public_submit", "acme", "tok123", await body({ captchaToken: "tt-ok" }), "203.0.113.5", passed.deps)).status,
      ).toBe(200);
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it("fails closed on a malformed count result", async () => {
      for (const data of [null, "x", [], [{ ip_count: "abc", link_count: 0 }], [{ ip_count: 0 }], [{ ip_count: -1, link_count: 0 }], 3]) {
        const { deps, rpc } = setup((name) =>
          name === "portal_public_counts" ? { data, error: null } : { data: [SUBMIT_ROW], error: null },
        );
        expect(await handlePublicFormAction("public_submit", "acme", "tok123", await body(), "203.0.113.5", deps)).toEqual({
          status: 429,
          body: { error: "captcha_required" },
        });
        expect(rpc).not.toHaveBeenCalledWith("portal_public_submit", expect.anything());
      }
    });

    it("treats any present non-empty honeypot value as a bot, including non-strings", async () => {
      for (const v of ["x", 1, true, ["a"], { a: 1 }, 0, false]) {
        const { deps, rpc, sendEmail } = setup(routes(0));
        const res = await handlePublicFormAction("public_submit", "acme", "tok123", await body({ [PUBLIC_HONEYPOT_FIELD]: v }), "203.0.113.5", deps);
        expect(res.status).toBe(200);
        expect(rpc).not.toHaveBeenCalled();
        expect(sendEmail).not.toHaveBeenCalled();
      }
      for (const v of [undefined, null, ""]) {
        const { deps, rpc } = setup(routes(0));
        await handlePublicFormAction("public_submit", "acme", "tok123", await body({ [PUBLIC_HONEYPOT_FIELD]: v }), "203.0.113.5", deps);
        expect(rpc).toHaveBeenCalledWith("portal_public_submit", expect.anything());
      }
    });

    it("fails the check closed when the Turnstile secret is unset", async () => {
      const { deps, fetchFn } = setup(routes(5), { turnstileSecretKey: "" });
      expect(
        await handlePublicFormAction("public_submit", "acme", "tok123", await body({ captchaToken: "tt-ok" }), "203.0.113.5", deps),
      ).toEqual({ status: 429, body: { error: "captcha_required" } });
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it("refuses past 30 in an hour, even with a check", async () => {
      const { deps, fetchFn } = setup(routes(30));
      expect(
        await handlePublicFormAction("public_submit", "acme", "tok123", await body({ captchaToken: "tt-ok" }), "203.0.113.5", deps),
      ).toEqual({ status: 429, body: { error: "rate_limited" } });
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it("tells the database a check passed only when Turnstile verified a token in this request", async () => {
      // Under the soft limits with a token in the body: no check runs, so nothing is claimed.
      const unchecked = setup(routes(0));
      await handlePublicFormAction("public_submit", "acme", "tok123", await body({ captchaToken: "tt-ok" }), "203.0.113.5", unchecked.deps);
      expect(unchecked.fetchFn).not.toHaveBeenCalled();
      expect(unchecked.rpc).toHaveBeenCalledWith("portal_public_submit", expect.objectContaining({ p_captcha_passed: false }));
      // Over the link limit with a verified token: claimed.
      const verified = setup(routes(0, undefined, 10));
      await handlePublicFormAction("public_submit", "acme", "tok123", await body({ captchaToken: "tt-ok" }), "203.0.113.5", verified.deps);
      expect(verified.fetchFn).toHaveBeenCalledTimes(1);
      expect(verified.rpc).toHaveBeenCalledWith("portal_public_submit", expect.objectContaining({ p_captcha_passed: true }));
    });

    it("answers captcha_required when the database's own soft limit trips (a parallel burst)", async () => {
      const { deps, sendEmail } = setup(routes(0, { data: null, error: { message: "captcha_required" } }));
      expect(await handlePublicFormAction("public_submit", "acme", "tok123", await body(), "203.0.113.5", deps)).toEqual({
        status: 429,
        body: { error: "captcha_required" },
      });
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it("maps database refusals", async () => {
      const cases: Array<[string, unknown]> = [
        ["rate_limited", { status: 429, body: { error: "rate_limited" } }],
        ["captcha_required", { status: 429, body: { error: "captcha_required" } }],
        ["consent_changed", { status: 409, body: { error: "consent_changed" } }],
        ["invalid_input:phone", { status: 400, body: { error: "invalid_body", field: "phone" } }],
        ["invalid_input:referrerEmail", { status: 400, body: { error: "invalid_body", field: "referrerEmail" } }],
        ["invalid_input:address", { status: 500, body: { error: "server_error" } }],
        ["boom", { status: 500, body: { error: "server_error" } }],
      ];
      for (const [message, expected] of cases) {
        const { deps } = setup(routes(0, { data: null, error: { message } }));
        expect(await handlePublicFormAction("public_submit", "acme", "tok123", await body(), "203.0.113.5", deps)).toEqual(expected);
      }
    });

    it("answers not_available when the link died after the form loaded, sending nothing", async () => {
      const { deps, sendEmail } = setup(routes(0, { data: [], error: null }));
      expect(await handlePublicFormAction("public_submit", "acme", "tok123", await body(), "203.0.113.5", deps)).toEqual({
        status: 404,
        body: { error: "not_available" },
      });
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it("500s when the rate count fails", async () => {
      const { deps } = setup(() => ({ data: null, error: { message: "boom" } }));
      expect((await handlePublicFormAction("public_submit", "acme", "tok123", await body(), "203.0.113.5", deps)).status).toBe(500);
    });

    it("keeps the reference when the allowlist drops the email or the send fails", async () => {
      const staging = setup(routes(0), { appEnv: "staging", emailAllowlist: "someone@else.example" });
      expect((await handlePublicFormAction("public_submit", "acme", "tok123", await body(), "203.0.113.5", staging.deps)).status).toBe(200);
      expect(staging.sendEmail).not.toHaveBeenCalled();

      const failing = setup(routes(0));
      failing.sendEmail.mockRejectedValueOnce(new Error("resend down"));
      expect((await handlePublicFormAction("public_submit", "acme", "tok123", await body(), "203.0.113.5", failing.deps)).status).toBe(200);

      const throwing = setup(routes(0));
      throwing.sendEmail.mockImplementationOnce(() => {
        throw new Error("sync throw");
      });
      expect((await handlePublicFormAction("public_submit", "acme", "tok123", await body(), "203.0.113.5", throwing.deps)).status).toBe(200);
    });
  });
});
