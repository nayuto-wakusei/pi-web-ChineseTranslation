import { expect, it } from "vitest";
import { gatewayServerConfigFromDraft, gatewayServerDraftFromConfig } from "./settingsConfigDraft";

it.each(["steer", "followUp"] as const)("preserves defaultStreamingBehavior %s during gateway edits", (defaultStreamingBehavior) => {
  const base = { defaultStreamingBehavior, defaultTheme: { themeId: "themes:pi-web-light", auto: true }, sessionArchive: { directory: "/archive" } };
  const draft = gatewayServerDraftFromConfig(base);
  expect(gatewayServerConfigFromDraft(draft, base)).toMatchObject(base);
  expect(gatewayServerConfigFromDraft(draft)).not.toHaveProperty("defaultStreamingBehavior");
});
