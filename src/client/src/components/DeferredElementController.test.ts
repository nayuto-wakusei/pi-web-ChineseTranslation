// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { LitElement } from "lit";
import { DeferredElementController } from "./DeferredElementController";

class DeferredTestHost extends LitElement {}
customElements.define("deferred-test-host", DeferredTestHost);
afterEach(() => { document.body.replaceChildren(); });

it("defers optional code, shares an in-flight load and keeps successful registration", async () => {
  const host = new DeferredTestHost();
  document.body.append(host);
  await host.updateComplete;
  let requested = false;
  let finish: () => void = () => undefined;
  const load = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
  const report = vi.fn();
  const controller = new DeferredElementController(host, () => requested, load, report);
  controller.hostUpdated();
  expect(load).not.toHaveBeenCalled();
  requested = true;
  controller.hostUpdated();
  controller.hostUpdated();
  expect(load).toHaveBeenCalledTimes(1);
  finish();
  await vi.waitFor(() => { controller.hostUpdated(); expect(load).toHaveBeenCalledTimes(1); });
  expect(report).not.toHaveBeenCalled();
});

it("reports failure once, retries only after reopening, and stays quiet after disconnect", async () => {
  const host = new DeferredTestHost();
  document.body.append(host);
  await host.updateComplete;
  let requested = true;
  const error = new Error("Module unavailable");
  const load = vi.fn(() => Promise.reject(error));
  const report = vi.fn();
  const controller = new DeferredElementController(host, () => requested, load, report);
  controller.hostUpdated();
  await vi.waitFor(() => { expect(report).toHaveBeenCalledTimes(1); });
  controller.hostUpdated();
  expect(load).toHaveBeenCalledTimes(1);
  requested = false;
  controller.hostUpdated();
  requested = true;
  host.remove();
  controller.hostUpdated();
  await vi.waitFor(() => { expect(load).toHaveBeenCalledTimes(2); });
  expect(report).toHaveBeenCalledTimes(1);
});
