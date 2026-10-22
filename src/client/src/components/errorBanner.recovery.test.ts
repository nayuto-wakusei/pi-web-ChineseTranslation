// @vitest-environment happy-dom
import { render } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import { errorBanner } from "./errorBanner";

afterEach(() => { document.body.replaceChildren(); });

it("offers an independent retry command only for an explicitly recoverable banner", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const retry = vi.fn();
  const dismiss = vi.fn();
  render(errorBanner("Conversation unavailable", dismiss, "error", retry), host);
  const button = host.querySelector<HTMLButtonElement>(".error-retry");
  expect(button?.textContent).toBe("重试");
  expect(button?.type).toBe("button");
  button?.click();
  expect(retry).toHaveBeenCalledOnce();
  expect(dismiss).not.toHaveBeenCalled();
  host.querySelector<HTMLButtonElement>(".error-dismiss")?.click();
  expect(dismiss).toHaveBeenCalledOnce();
});

it.each(["warning", "info", "error"] as const)("does not infer retry from a %s notice or mutation failure", (severity) => {
  const host = document.createElement("div");
  document.body.append(host);
  render(errorBanner("Server-owned notice", vi.fn(), severity), host);
  expect(host.querySelector(".error-retry")).toBeNull();
});
