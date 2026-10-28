// @vitest-environment happy-dom
import { html, render, svg } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import type { FilePreviewerInput, PluginActivationContextV5 } from "@chainingintention/pi-web-cn/plugin-api";
import { LocalizationService } from "../../src/client/src/localization/service";
import { createPluginLocalization } from "../../src/client/src/plugins/localization";
import plugin from "./pi-web-plugin.js";

const lifetime = new AbortController();
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });
function activation() {
  const service = new LocalizationService({ development: true, preferences: { language: "en", formatLocale: "en-US" }, diagnostic: () => undefined });
  const context: PluginActivationContextV5 = {
    apiVersion: 5, pluginId: "audio", runtimePluginId: "remote.audio", html, svg,
    localization: createPluginLocalization(service, "audio", "remote.audio", lifetime.signal),
    signal: new AbortController().signal, lifetimeSignal: lifetime.signal,
  };
  const previewer = plugin.activate(context).contributions.filePreviewers[0];
  if (previewer === undefined) throw new Error("Missing audio previewer");
  return previewer;
}
function input(): FilePreviewerInput {
  return {
    machineId: "remote", projectId: "project", workspaceId: "workspace",
    file: { path: "music/clip.MP3", encoding: "utf8", size: 123, modifiedAt: "", content: "", truncated: false, binary: true },
    files: {
      readFile: vi.fn(), listFiles: vi.fn(), writeFile: vi.fn(), deleteFile: vi.fn(), moveFile: vi.fn(),
    }, signal: new AbortController().signal, fail: vi.fn(),
  };
}

it("contributes only automatic audio formats and uses its own workspace resource URL", () => {
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  const contribution = activation();
  expect(contribution).toMatchObject({ title: "Audio", renderMode: "automatic", fileExtensions: ["mp3", "wav", "ogg", "m4a", "aac", "flac", "opus"] });
  const resourceUrl = vi.fn(() => "https://example.test/authenticated-resource");
  const forScope = vi.fn(() => ({ resourceUrl }));
  const request = { ...input(), backend: { machineId: "remote", forScope } };
  const container = document.createElement("div");
  document.body.append(container);
  render(contribution.render(request), container);
  expect(forScope).toHaveBeenCalledWith({ kind: "workspace", projectId: "project", workspaceId: "workspace" });
  expect(resourceUrl).toHaveBeenCalledWith("audio.read", { path: "music/clip.MP3" });
  expect(container.querySelector("audio")?.src).toBe("https://example.test/authenticated-resource");
  expect(request.fail).not.toHaveBeenCalled();
});

it("shows actionable fallback when resource support is missing or URL construction fails", () => {
  const contribution = activation();
  for (const backend of [undefined, { machineId: "remote", forScope: () => ({ resourceUrl: () => { throw new Error("unavailable"); } }) }]) {
    const request = { ...input(), ...(backend === undefined ? {} : { backend }) };
    const container = document.createElement("div");
    render(contribution.render(request), container);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Download the file or open it externally");
    expect(request.fail).toHaveBeenCalledOnce();
  }
});
