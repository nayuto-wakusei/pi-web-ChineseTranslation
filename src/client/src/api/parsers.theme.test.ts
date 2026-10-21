import { expect, it } from "vitest";
import { parsePiWebConfigResponse } from "./parsers";
it("preserves theme defaults and rejects malformed theme data", () => {
    const defaultTheme = { themeId: "themes:pi-web-light", auto: false };
    const response = {
      path: "/tmp/config.json", exists: true,
      config: { defaultTheme }, effectiveConfig: { defaultTheme },
      envOverrides: { host: false, port: false, allowedHosts: false, spawnSessions: false, subsessions: false, askUser: false },
    };
    expect(parsePiWebConfigResponse(response)).toMatchObject({ config: { defaultTheme }, effectiveConfig: { defaultTheme } });
    expect(() => parsePiWebConfigResponse({ ...response, config: { defaultTheme: "dark" } })).toThrow("PI WEB config defaultTheme");
  });
