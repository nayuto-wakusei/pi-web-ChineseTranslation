import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

let clientDist: string;

beforeEach(async () => {
  clientDist = await mkdtemp(join(tmpdir(), "pi-web-static-cache-"));
  await mkdir(join(clientDist, "assets"));
  await writeFile(join(clientDist, "index.html"), "<pi-web-app></pi-web-app>");
  await writeFile(join(clientDist, "assets", "index-Abc123_x.js"), "export {};");
  await writeFile(join(clientDist, "robots.txt"), "User-agent: *\nDisallow: /\n");
});

afterEach(async () => {
  await rm(clientDist, { recursive: true, force: true });
});

describe("client static caching", () => {
  it("marks content-hashed assets immutable", async () => {
    const app = await buildApp({ clientDist, logger: false });
    try {
      const asset = await app.inject({ method: "GET", url: "/assets/index-Abc123_x.js" });

      expect(asset.statusCode).toBe(200);
      expect(asset.body).toBe("export {};");
      expect(asset.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    } finally {
      await app.close();
    }
  });

  it.each(["/", "/sessions/example"])("keeps the app shell revalidating at %s", async (url) => {
    const app = await buildApp({ clientDist, logger: false });
    try {
      const shell = await app.inject({ method: "GET", url, headers: { accept: "text/html" } });

      expect(shell.statusCode).toBe(200);
      expect(shell.headers["content-type"]).toContain("text/html");
      expect(shell.body).toBe("<pi-web-app></pi-web-app>");
      expect(shell.headers["cache-control"]).toBe("public, max-age=0");
    } finally {
      await app.close();
    }
  });

  it("does not cache a missing asset as immutable or return the app shell", async () => {
    const app = await buildApp({ clientDist, logger: false });
    try {
      const missing = await app.inject({ method: "GET", url: "/assets/missing-old-hash.js", headers: { accept: "text/html" } });
      expect(missing.statusCode).toBe(404);
      expect(missing.headers["content-type"]).not.toContain("text/html");
      expect(missing.headers["cache-control"] ?? "").not.toContain("immutable");
    } finally {
      await app.close();
    }
  });

  it("keeps unhashed static files revalidating", async () => {
    const app = await buildApp({ clientDist, logger: false });
    try {
      const file = await app.inject({ method: "GET", url: "/robots.txt" });

      expect(file.statusCode).toBe(200);
      expect(file.body).toBe("User-agent: *\nDisallow: /\n");
      expect(file.headers["cache-control"]).toBe("public, max-age=0");
    } finally {
      await app.close();
    }
  });
});
