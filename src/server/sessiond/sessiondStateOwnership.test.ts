import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { claimSessiondStateOwnership, parseOwnershipRecord, SESSIOND_OWNER_MARKER_FILENAME, SessiondStateOwnershipConflictError } from "./sessiondStateOwnership.js";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("session daemon state ownership", () => {
  it("claims and releases one data directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-web-owner-"));
    dirs.push(dir);
    const owner = await claimSessiondStateOwnership({ env: { PI_WEB_DATA_DIR: dir }, ownPid: 101, isAlive: () => false });
    const marker = await readFile(join(dir, SESSIOND_OWNER_MARKER_FILENAME), "utf8");
    expect(parseOwnershipRecord(marker)).toMatchObject({ pid: 101, endpoint: join(dir, "sessiond.sock") });
    await owner.release();
    await expect(readFile(join(dir, SESSIOND_OWNER_MARKER_FILENAME), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a live different owner after the grace window", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-web-owner-"));
    dirs.push(dir);
    const first = await claimSessiondStateOwnership({ env: { PI_WEB_DATA_DIR: dir }, ownPid: 101, isAlive: () => false });
    await expect(claimSessiondStateOwnership({
      env: { PI_WEB_DATA_DIR: dir },
      ownPid: 202,
      isAlive: () => true,
      graceMs: 0,
      pollIntervalMs: 0,
    })).rejects.toBeInstanceOf(SessiondStateOwnershipConflictError);
    await first.release();
  });
});
