import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

const fake = vi.hoisted(() => ({
  load: vi.fn(),
  render: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("../lib/turnstile", () => ({ loadTurnstile: () => fake.load() }));

import { TurnstileWidget } from "./TurnstileWidget";

beforeEach(() => {
  fake.load.mockReset();
  fake.render.mockReset();
  fake.remove.mockReset();
  fake.render.mockReturnValue("w1");
  fake.load.mockResolvedValue({ render: fake.render, remove: fake.remove });
});

describe("TurnstileWidget", () => {
  it("renders the check with the site key and passes the token on", async () => {
    const onToken = vi.fn();
    render(<TurnstileWidget siteKey="1x00000000000000000000AA" onToken={onToken} onError={vi.fn()} />);
    await waitFor(() => expect(fake.render).toHaveBeenCalledTimes(1));
    const [container, options] = fake.render.mock.calls[0];
    expect(container).toBeInstanceOf(HTMLElement);
    expect(options).toMatchObject({ sitekey: "1x00000000000000000000AA", theme: "auto" });
    options.callback("tt-1");
    expect(onToken).toHaveBeenCalledWith("tt-1");
  });

  it("reports a check error and a script that will not load", async () => {
    const onError = vi.fn();
    render(<TurnstileWidget siteKey="k" onToken={vi.fn()} onError={onError} />);
    await waitFor(() => expect(fake.render).toHaveBeenCalled());
    fake.render.mock.calls[0][1]["error-callback"]();
    expect(onError).toHaveBeenCalledTimes(1);

    fake.load.mockRejectedValueOnce(new Error("turnstile_load_failed"));
    const second = vi.fn();
    render(<TurnstileWidget siteKey="k" onToken={vi.fn()} onError={second} />);
    await waitFor(() => expect(second).toHaveBeenCalledTimes(1));
  });

  it("removes the widget on unmount, and renders nothing after an early unmount", async () => {
    const { unmount } = render(<TurnstileWidget siteKey="k" onToken={vi.fn()} onError={vi.fn()} />);
    await waitFor(() => expect(fake.render).toHaveBeenCalled());
    unmount();
    expect(fake.remove).toHaveBeenCalledWith("w1");

    fake.render.mockClear();
    const early = render(<TurnstileWidget siteKey="k" onToken={vi.fn()} onError={vi.fn()} />);
    early.unmount();
    await Promise.resolve();
    await Promise.resolve();
    expect(fake.render).not.toHaveBeenCalled();
  });
});
