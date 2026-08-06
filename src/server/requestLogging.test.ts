import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { redactRequestUrl, requestLoggerOptions } from "./requestLogging.js";

describe("request logging", () => {
  it("redacts token query values without changing other logged URL fields", () => {
    expect(redactRequestUrl("/api/sessions?cwd=%2Frepo&token=signed.secret&view=chat#anchor")).toBe(
      "/api/sessions?cwd=%2Frepo&token=%5BREDACTED%5D&view=chat#anchor",
    );
    expect(redactRequestUrl("/api/sessions?token=first&token=second")).toBe("/api/sessions?token=%5BREDACTED%5D");
    expect(redactRequestUrl("/api/sessions?tokenized=public")).toBe("/api/sessions?tokenized=public");
    expect(redactRequestUrl("/_internal/workbench/access-states/opaque-handle?view=active")).toBe(
      "/_internal/workbench/access-states/[REDACTED]?view=active",
    );
  });

  it("keeps management query tokens and sensitive headers out of Fastify logs", async () => {
    const lines: string[] = [];
    const app = Fastify({
      logger: requestLoggerOptions({ write: (line) => { lines.push(line); } }),
    });
    app.get("/logged", (request) => {
      request.log.info({ headers: request.headers }, "header audit");
      return { ok: true };
    });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/logged?embed=management&token=signed-query-secret&view=chat",
        headers: {
          authorization: "Bearer authorization-secret",
          cookie: "pi_web_management_session=cookie-secret",
          "x-pi-web-embed-token": "bridge-token-secret",
          "x-pi-web-management-context": "encoded-context-secret",
          "x-pi-web-workbench-access-handle": "opaque-handle-secret",
          "x-visible-header": "visible-value",
        },
      });

      expect(response.statusCode).toBe(200);
      const logOutput = lines.join("");
      expect(logOutput).toContain("token=%5BREDACTED%5D");
      expect(logOutput).toContain("visible-value");
      expect(logOutput).not.toContain("signed-query-secret");
      expect(logOutput).not.toContain("authorization-secret");
      expect(logOutput).not.toContain("cookie-secret");
      expect(logOutput).not.toContain("bridge-token-secret");
      expect(logOutput).not.toContain("encoded-context-secret");
      expect(logOutput).not.toContain("opaque-handle-secret");
    } finally {
      await app.close();
    }
  });
});
