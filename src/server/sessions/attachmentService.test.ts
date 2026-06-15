import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_ATTACHMENT_FOLDER, saveAttachmentsToWorkspace } from "./attachmentService.js";

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "pi-web-attachments-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const pngBase64 = pngBytes.toString("base64");

describe("saveAttachmentsToWorkspace", () => {
  it("writes attachments into the default folder and returns relative paths", async () => {
    const fixedNow = () => new Date("2026-06-13T12:05:01.123Z");
    const saved = await saveAttachmentsToWorkspace(
      workspace,
      [
        { kind: "image", mimeType: "image/png", data: pngBase64, name: "a.png" },
        { kind: "image", mimeType: "image/webp", data: pngBase64, name: "b.webp" },
      ],
      { now: fixedNow },
    );

    expect(saved).toHaveLength(2);
    expect(saved[0]?.path.startsWith(`${DEFAULT_ATTACHMENT_FOLDER}/paste-`)).toBe(true);
    expect(saved[0]?.path.endsWith(".png")).toBe(true);
    expect(saved[1]?.path.endsWith(".webp")).toBe(true);
    expect(saved[0]?.size).toBe(pngBytes.byteLength);

    const folderEntries = await readdir(join(workspace, ".pi-web", "paste"));
    expect(folderEntries).toHaveLength(2);

    const firstPath = saved[0]?.path ?? "";
    const written = await readFile(join(workspace, firstPath));
    expect(written.equals(pngBytes)).toBe(true);
  });

  it("honors a custom folder", async () => {
    const saved = await saveAttachmentsToWorkspace(
      workspace,
      [{ kind: "image", mimeType: "image/png", data: pngBase64 }],
      { folder: "uploads/images" },
    );
    expect(saved[0]?.path.startsWith("uploads/images/")).toBe(true);
  });

  it("returns empty for no attachments", async () => {
    expect(await saveAttachmentsToWorkspace(workspace, [])).toEqual([]);
  });
});
