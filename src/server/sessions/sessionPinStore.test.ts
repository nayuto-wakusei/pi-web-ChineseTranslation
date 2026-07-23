import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionPinStore, type SessionPinScope } from "./sessionPinStore.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "pi-web-session-pins-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("SessionPinStore", () => {
  it("shares normal-mode pins by workspace and isolates management users", async () => {
    const filePath = join(tempDir, "session-pins.json");
    const normal = { mode: "normal", cwd: "/workspace" } as const;
    const otherWorkspace = { mode: "normal", cwd: "/other" } as const;
    const userA = managementScope("root", "a", "/workspace");
    const userB = managementScope("root", "b", "/workspace");
    const store = new SessionPinStore(filePath);

    await store.set(normal, "normal-session", true);
    await store.set(userA, "user-a-session", true);

    expect(await new SessionPinStore(filePath).list(normal)).toEqual(["normal-session"]);
    expect(await store.list(otherWorkspace)).toEqual([]);
    expect(await store.list(userA)).toEqual(["user-a-session"]);
    expect(await store.list(userB)).toEqual([]);
  });

  it("survives a new store instance, ignores malformed files, and prunes deleted ids", async () => {
    const filePath = join(tempDir, "session-pins.json");
    const scope = { mode: "normal", cwd: "/workspace" } as const;
    const store = new SessionPinStore(filePath);
    await store.set(scope, "kept", true);
    await store.set(scope, "deleted", true);

    expect(await new SessionPinStore(filePath).prune(scope, new Set(["kept"]))).toEqual(["kept"]);
    await writeFile(filePath, "not json", "utf8");
    expect(await new SessionPinStore(filePath).list(scope)).toEqual([]);
  });
});

function managementScope(rootUserId: string, userId: string, cwd: string): SessionPinScope {
  return { mode: "management", rootUserId, userId, cwd };
}
