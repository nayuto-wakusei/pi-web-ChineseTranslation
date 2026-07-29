import { describe, expect, it, vi } from "vitest";
import type { PiWebStatusResponse } from "../shared/apiTypes.js";
import { buildApp } from "./app.js";
import { installTestAuth } from "./app.testSupport.js";
import type { PiWebConfigValues } from "../shared/apiTypes.js";

describe("PI WEB status routes", () => {
  it("forces a fresh status load when refresh is requested", async () => {
    const get = vi.fn(() => Promise.resolve(status("cached")));
    const refresh = vi.fn(() => Promise.resolve(status("forced")));
    const invalidate = vi.fn();
    let config: PiWebConfigValues = {};
    const configResponse = () => ({
      path: "/tmp/config.json",
      exists: false,
      config,
      effectiveConfig: config,
      envOverrides: { host: false, port: false, allowedHosts: false, spawnSessions: false, subsessions: false, askUser: false, agentCommand: false, agentDir: false, agentSessionDir: false },
    });
    const app = await buildApp({
      piWebStatusCache: { get, refresh, invalidate },
      config: {
        read: () => configResponse(),
        write: (next) => {
          config = { ...config, ...next };
          return configResponse();
        },
      },
      clientDist: false,
      logger: false,
    });
    await installTestAuth(app);

    try {
      const cachedResponse = await app.inject({ method: "GET", url: "/api/pi-web/status" });
      const forcedResponse = await app.inject({ method: "GET", url: "/api/pi-web/status?refresh=1" });

      expect(cachedResponse.json<PiWebStatusResponse>().generatedAt).toBe("cached");
      expect(forcedResponse.json<PiWebStatusResponse>().generatedAt).toBe("forced");
      expect(get).toHaveBeenCalledOnce();
      expect(refresh).toHaveBeenCalledOnce();
      expect(refresh).toHaveBeenCalledWith({ force: true });
    } finally {
      await app.close();
    }
  });
});

function status(generatedAt: string): PiWebStatusResponse {
  return {
    packageName: "@chainingintention/pi-web-cn",
    generatedAt,
    components: {
      web: { component: "web", label: "Web/UI", stale: false, available: true },
      sessiond: { component: "sessiond", label: "Session daemon", stale: false, available: true },
    },
    release: { packageName: "@chainingintention/pi-web-cn", updateAvailable: false },
    commands: {},
    messages: [],
  };
}
