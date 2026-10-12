import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";

const api = vi.hoisted(() => ({
  brand: vi.fn(),
  publicForm: vi.fn(),
  publicSubmit: vi.fn(),
}));
const turnstile = vi.hoisted(() => ({ siteKey: "1x00000000000000000000AA", render: vi.fn() }));
const timing = vi.hoisted(() => ({ wait: vi.fn() }));

vi.mock("../lib/portalApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/portalApi")>();
  return { ...actual, portalApi: api };
});
vi.mock("../lib/turnstile", () => ({
  turnstileSiteKey: () => turnstile.siteKey,
  loadTurnstile: () => Promise.resolve({ render: turnstile.render, remove: vi.fn() }),
}));
vi.mock("../lib/publicFormTiming", () => ({ waitForFormAge: (...a: unknown[]) => timing.wait(...a) }));

import { PortalRoot } from "./PortalRoot";
import { PortalApiError } from "../lib/portalApi";

const BRAND = { orgName: "Acme ISO", productName: "Acme", primaryColor: null, logoUrl: null, darkLogoUrl: null };
const FORM = {
  orgName: "Acme ISO",
  repName: "Rita Rep",
  consentText: "I may share this business's details.",
  consentVersion: 2,
  formToken: "1760788800000.abc",
};

function renderAt(path = "/p/acme/refer/tok123") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/p/:slug/*" element={<PortalRoot />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function fill(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText(/^Business name/), "Fresh Bakery");
  await user.type(screen.getByLabelText(/^Contact name/), "Ann Owner");
  await user.type(screen.getByLabelText(/^Email/), "ann@bakery.example");
  await user.type(screen.getByLabelText(/^Phone/), "555 010 0100");
  await user.type(screen.getByLabelText(/^Notes/), "Needs a new terminal.");
  await user.click(screen.getByRole("checkbox", { name: FORM.consentText }));
}

const SENT = {
  companyName: "Fresh Bakery",
  contactName: "Ann Owner",
  email: "ann@bakery.example",
  phone: "555 010 0100",
  notes: "Needs a new terminal.",
  referredBy: "",
  referrerEmail: "",
  website: "",
  consent: true,
  consentVersion: 2,
  formToken: FORM.formToken,
};

// Node 25 ships a broken global localStorage: install an in-memory Storage per test.
const origLocalStorage = (() => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
})();

function memoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    removeItem: (k: string) => void store.delete(k),
    setItem: (k: string, v: string) => void store.set(k, v),
  };
}

beforeEach(() => {
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), writable: true, configurable: true });
  Object.values(api).forEach((fn) => fn.mockReset());
  turnstile.render.mockReset();
  turnstile.siteKey = "1x00000000000000000000AA";
  timing.wait.mockReset();
  timing.wait.mockResolvedValue(undefined);
  api.brand.mockResolvedValue(BRAND);
  api.publicForm.mockResolvedValue(FORM);
});

afterEach(() => {
  focusManager.setFocused(undefined);
  Object.defineProperty(window, "localStorage", { value: origLocalStorage, writable: true, configurable: true });
});

describe("PortalPublicFormPage", () => {
  it("shows the ISO and the rep, sends the referral, and shows the reference", async () => {
    const user = userEvent.setup();
    api.publicSubmit.mockResolvedValue({ ref: "REF-1A2B3C4D" });
    renderAt();
    expect(await screen.findByRole("heading", { name: "Refer a business to Acme ISO" })).toBeInTheDocument();
    expect(screen.getByText("Your referral goes to Rita Rep at Acme ISO.")).toBeInTheDocument();
    expect(api.publicForm).toHaveBeenCalledWith("acme", "tok123");

    await fill(user);
    await user.type(screen.getByLabelText("Who referred this business? (optional)"), "Joe");
    await user.click(screen.getByRole("button", { name: "Send referral" }));

    expect(await screen.findByRole("heading", { name: "Thanks for the referral" })).toBeInTheDocument();
    expect(screen.getByText("Acme ISO has it. Your reference is REF-1A2B3C4D.")).toBeInTheDocument();
    expect(screen.queryByText("A confirmation email is on its way.")).toBeNull();
    expect(api.publicSubmit).toHaveBeenCalledWith("acme", "tok123", { ...SENT, referredBy: "Joe" });
    expect(timing.wait).toHaveBeenCalledWith(expect.any(Number));
    expect(document.body.textContent).not.toMatch(/navigatr/i);
  });

  it("asks for the sender's own email as optional and promises a confirmation only when given", async () => {
    const user = userEvent.setup();
    api.publicSubmit.mockResolvedValue({ ref: "REF-1A2B3C4D" });
    renderAt();
    await fill(user);
    expect(screen.getByText("For a confirmation. Optional.")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Your email (optional)"), "joe@bank.example");
    await user.click(screen.getByRole("button", { name: "Send referral" }));
    expect(await screen.findByText("A confirmation email is on its way.")).toBeInTheDocument();
    expect(api.publicSubmit).toHaveBeenCalledWith("acme", "tok123", { ...SENT, referrerEmail: "joe@bank.example" });
  });

  it("points at a malformed referrer email before sending", async () => {
    const user = userEvent.setup();
    renderAt();
    await fill(user);
    await user.type(screen.getByLabelText("Your email (optional)"), "joe@");
    await user.click(screen.getByRole("button", { name: "Send referral" }));
    expect(screen.getByText("Check your email address, or leave it blank.")).toBeInTheDocument();
    expect(screen.getByLabelText("Your email (optional)")).toHaveFocus();
    expect(api.publicSubmit).not.toHaveBeenCalled();
  });

  it("speaks for the ISO when the link has no rep", async () => {
    api.publicForm.mockResolvedValue({ ...FORM, repName: null });
    renderAt();
    expect(await screen.findByText("Tell Acme ISO about a business they can help.")).toBeInTheDocument();
  });

  it("says the form is not available for a dead link, and offers a retry for a network failure", async () => {
    api.publicForm.mockResolvedValue(null);
    const dead = renderAt();
    expect(await screen.findByRole("heading", { name: "This form isn't available" })).toBeInTheDocument();
    dead.unmount();

    api.publicForm.mockRejectedValue(new PortalApiError(0, "network_error"));
    renderAt();
    expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("checks the fields before sending and moves focus to the first problem", async () => {
    const user = userEvent.setup();
    renderAt();
    await user.click(await screen.findByRole("button", { name: "Send referral" }));
    expect(screen.getByText("Add the business name.")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Business name/)).toHaveFocus();
    expect(api.publicSubmit).not.toHaveBeenCalled();
  });

  it("hides the honeypot from people and sends it empty", async () => {
    renderAt();
    const trap = (await screen.findByLabelText("Website", { selector: "input" })) as HTMLInputElement;
    expect(trap.name).toBe("website");
    expect(trap.tabIndex).toBe(-1);
    expect(trap.autocomplete).toBe("off");
    expect(trap.closest("[aria-hidden='true']")).not.toBeNull();
  });

  it("shows the check when asked, then sends again with its token", async () => {
    const user = userEvent.setup();
    api.publicSubmit
      .mockRejectedValueOnce(new PortalApiError(429, "captcha_required"))
      .mockResolvedValueOnce({ ref: "REF-00000001" });
    turnstile.render.mockImplementation((_el: HTMLElement, opts: { callback: (t: string) => void }) => {
      queueMicrotask(() => opts.callback("captcha-ok"));
      return "w1";
    });
    renderAt();
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Send referral" }));
    expect(await screen.findByRole("heading", { name: "Thanks for the referral" })).toBeInTheDocument();
    expect(turnstile.render).toHaveBeenCalledTimes(1);
    expect(api.publicSubmit).toHaveBeenLastCalledWith("acme", "tok123", { ...SENT, captchaToken: "captcha-ok" });
  });

  it("says try later, with no check, when this site has no Turnstile key", async () => {
    const user = userEvent.setup();
    turnstile.siteKey = "";
    api.publicSubmit.mockRejectedValue(new PortalApiError(429, "captcha_required"));
    renderAt();
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Send referral" }));
    expect(await screen.findByText("Too many referrals from this connection right now. Try again later.")).toBeInTheDocument();
    expect(turnstile.render).not.toHaveBeenCalled();
  });

  it("says try later when the hard limit is reached", async () => {
    const user = userEvent.setup();
    api.publicSubmit.mockRejectedValue(new PortalApiError(429, "rate_limited"));
    renderAt();
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Send referral" }));
    expect(await screen.findByText("Too many referrals from this connection right now. Try again later.")).toBeInTheDocument();
  });

  it("shows the unavailable card when the link died after the form loaded", async () => {
    const user = userEvent.setup();
    api.publicSubmit.mockRejectedValue(new PortalApiError(404, "not_available"));
    renderAt();
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Send referral" }));
    expect(await screen.findByRole("heading", { name: "This form isn't available" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Thanks for the referral" })).toBeNull();
  });

  it("reloads the form and asks again when it was open too long or the wording changed", async () => {
    const user = userEvent.setup();
    api.publicSubmit.mockRejectedValueOnce(new PortalApiError(409, "form_expired"));
    renderAt();
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Send referral" }));
    expect(await screen.findByText("This page was open for a while. Check your details and send it again.")).toBeInTheDocument();
    await waitFor(() => expect(api.publicForm).toHaveBeenCalledTimes(2));

    api.publicSubmit.mockRejectedValueOnce(new PortalApiError(409, "consent_changed"));
    await user.click(screen.getByRole("button", { name: "Send referral" }));
    expect(await screen.findByText("The wording changed. Please review it and tick the box again.")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: FORM.consentText })).not.toBeChecked();
  });

  it("points at the field the server named", async () => {
    const user = userEvent.setup();
    api.publicSubmit.mockRejectedValue(new PortalApiError(400, "invalid_body", "phone"));
    renderAt();
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Send referral" }));
    expect(await screen.findByText("Add a phone number with at least 7 digits.")).toBeInTheDocument();
  });

  it("does not refetch the form when the window regains focus", async () => {
    renderAt();
    await screen.findByLabelText(/^Business name/);
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await Promise.resolve();
    expect(api.publicForm).toHaveBeenCalledTimes(1);
  });

  it("Send another clears the form and loads a fresh one", async () => {
    const user = userEvent.setup();
    api.publicSubmit.mockResolvedValue({ ref: "REF-1A2B3C4D" });
    renderAt();
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Send referral" }));
    await user.click(await screen.findByRole("button", { name: "Send another" }));
    expect(await screen.findByLabelText(/^Business name/)).toHaveValue("");
    await waitFor(() => expect(api.publicForm).toHaveBeenCalledTimes(2));
  });

  it("remounts the check after a token was used and failed, without resending on its own", async () => {
    const user = userEvent.setup();
    api.publicSubmit
      .mockRejectedValueOnce(new PortalApiError(429, "captcha_required"))
      .mockRejectedValueOnce(new PortalApiError(429, "captcha_required"))
      .mockResolvedValueOnce({ ref: "REF-00000002" });
    let n = 0;
    turnstile.render.mockImplementation((_el: HTMLElement, opts: { callback: (t: string) => void }) => {
      const token = `captcha-${++n}`;
      queueMicrotask(() => opts.callback(token));
      return `w${n}`;
    });
    renderAt();
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Send referral" }));
    await waitFor(() => expect(turnstile.render).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("That check didn't go through. Try it again.")).toBeInTheDocument();
    // The second token is held, not sent on its own: no loop.
    expect(api.publicSubmit).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole("button", { name: "Send referral" }));
    expect(await screen.findByRole("heading", { name: "Thanks for the referral" })).toBeInTheDocument();
    expect(api.publicSubmit).toHaveBeenLastCalledWith("acme", "tok123", { ...SENT, captchaToken: "captcha-2" });
  });

  it("does not send, or set state, when the page is left during the wait", async () => {
    const user = userEvent.setup();
    let release: () => void = () => {};
    timing.wait.mockReturnValue(new Promise<void>((r) => (release = r)));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const view = renderAt();
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Send referral" }));
    view.unmount();
    release();
    await Promise.resolve();
    await Promise.resolve();
    expect(api.publicSubmit).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("tells the person the check could not load", async () => {
    const user = userEvent.setup();
    api.publicSubmit.mockRejectedValue(new PortalApiError(429, "captcha_required"));
    turnstile.render.mockImplementation((_el: HTMLElement, opts: { "error-callback": () => void }) => {
      queueMicrotask(() => opts["error-callback"]());
      return "w1";
    });
    renderAt();
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Send referral" }));
    expect(await screen.findByText("The check couldn't load. Try again later.")).toBeInTheDocument();
  });
  it("marks the five required fields and the consent box, with 44px inputs", async () => {
    renderAt();
    await screen.findByLabelText(/^Business name/);
    for (const name of [/^Business name/, /^Contact name/, /^Email/, /^Phone/, /^Notes/]) {
      const field = screen.getByLabelText(name);
      expect(field).toHaveAttribute("aria-required", "true");
      const label = document.querySelector(`label[for="${field.id}"]`);
      expect(label?.textContent).toMatch(/\*$/);
    }
    for (const name of ["Who referred this business? (optional)", "Your email (optional)"]) {
      expect(screen.getByLabelText(name)).not.toHaveAttribute("aria-required");
    }
    expect(screen.getByRole("checkbox", { name: FORM.consentText })).toHaveAttribute("aria-required", "true");
    for (const name of [/^Business name/, /^Contact name/, /^Email/, /^Phone/, "Who referred this business? (optional)", "Your email (optional)"]) {
      expect(screen.getByLabelText(name).parentElement).toHaveClass("h-12");
    }
    expect(screen.getByLabelText(/^Notes/).parentElement).toHaveClass("min-h-11");
  });

  it("moves focus and re-announces the problem again when the same field is still wrong", async () => {
    const user = userEvent.setup();
    renderAt();
    await user.click(await screen.findByRole("button", { name: "Send referral" }));
    const first = screen.getByText("Add the business name.");
    expect(screen.getByLabelText(/^Business name/)).toHaveFocus();
    await user.click(screen.getByLabelText(/^Contact name/));
    await user.click(screen.getByRole("button", { name: "Send referral" }));
    expect(screen.getByLabelText(/^Business name/)).toHaveFocus();
    const second = screen.getByText("Add the business name.");
    expect(second).toHaveAttribute("role", "alert");
    expect(second).not.toBe(first);
  });

  it("keeps a check token that arrives while the form has a problem, and sends it next time", async () => {
    const user = userEvent.setup();
    api.publicSubmit
      .mockRejectedValueOnce(new PortalApiError(429, "captcha_required"))
      .mockResolvedValueOnce({ ref: "REF-00000003" });
    let pass: (t: string) => void = () => {};
    turnstile.render.mockImplementation((_el: HTMLElement, opts: { callback: (t: string) => void }) => {
      pass = opts.callback;
      return "w1";
    });
    renderAt();
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Send referral" }));
    await waitFor(() => expect(turnstile.render).toHaveBeenCalledTimes(1));
    await user.clear(screen.getByLabelText(/^Business name/));
    pass("captcha-early");
    expect(await screen.findByText("Add the business name.")).toBeInTheDocument();
    expect(api.publicSubmit).toHaveBeenCalledTimes(1);
    await user.type(screen.getByLabelText(/^Business name/), "Fresh Bakery");
    await user.click(screen.getByRole("button", { name: "Send referral" }));
    expect(await screen.findByRole("heading", { name: "Thanks for the referral" })).toBeInTheDocument();
    expect(api.publicSubmit).toHaveBeenLastCalledWith("acme", "tok123", { ...SENT, captchaToken: "captcha-early" });
  });

  it("shows the new consent wording after it changed, unticked", async () => {
    const user = userEvent.setup();
    api.publicForm
      .mockResolvedValueOnce(FORM)
      .mockResolvedValueOnce({ ...FORM, consentText: "New wording: I may share this and be contacted.", consentVersion: 3 });
    api.publicSubmit.mockRejectedValueOnce(new PortalApiError(409, "consent_changed"));
    renderAt();
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Send referral" }));
    expect(await screen.findByText("The wording changed. Please review it and tick the box again.")).toBeInTheDocument();
    const box = await screen.findByRole("checkbox", { name: "New wording: I may share this and be contacted." });
    expect(box).not.toBeChecked();
    expect(screen.queryByRole("checkbox", { name: FORM.consentText })).toBeNull();
  });
});
