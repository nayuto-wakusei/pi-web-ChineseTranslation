// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandPicker } from "./CommandPicker";
import { ModelPicker } from "./ModelPicker";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe.each([CommandPicker, ModelPicker])("%s default saving", (Picker) => {
  it("blocks repeat saves until the host finishes, then unlocks on success", async () => {
    let finish!: () => void;
    const save = new Promise<void>((resolve) => { finish = resolve; });
    const callback = vi.fn(() => save);
    const picker = new Picker();
    picker.options = [{ value: "fixture/model", label: "Model" }];
    picker.onSetDefault = callback;
    document.body.append(picker);
    await picker.updateComplete;
    const pin = picker.shadowRoot?.querySelector<HTMLButtonElement>(".default-pin");
    if (pin === undefined || pin === null) throw new Error("Missing default pin");
    pin.click();
    pin.click();
    await picker.updateComplete;
    expect(callback).toHaveBeenCalledOnce();
    expect(pin.disabled).toBe(true);
    finish();
    await save;
    await picker.updateComplete;
    expect(pin.disabled).toBe(false);
  });

  it("unlocks after a rejected host save without an unhandled rejection", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const picker = new Picker();
    picker.options = [{ value: "fixture/model", label: "Model" }];
    picker.onSetDefault = () => Promise.reject(new Error("save failed"));
    document.body.append(picker);
    await picker.updateComplete;
    const pin = picker.shadowRoot?.querySelector<HTMLButtonElement>(".default-pin");
    if (pin === undefined || pin === null) throw new Error("Missing default pin");
    pin.click();
    await picker.updateComplete;
    await picker.updateComplete;
    expect(pin.disabled).toBe(false);
    expect(warning).toHaveBeenCalledOnce();
  });
});
