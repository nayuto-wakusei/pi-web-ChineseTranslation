import { ReadStream } from "node:fs";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerPluginPeerResourceContextV5, ServerPluginResourceResponse } from "@chainingintention/pi-web-cn/server-plugin-api";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import plugin from "./server.js";

const resource = plugin.activate().peer.resource;
let directory: string;
let workspace: string;
const data = Buffer.from("0123456789abcdef");
function request(path = "clip.mp3", range?: string, signal = new AbortController().signal): ServerPluginPeerResourceContextV5 {
  return {
    operation: "audio.read", input: { path }, signal, ...(range === undefined ? {} : { range }),
    scope: {
      kind: "workspace", project: { id: "project", name: "Project", path: workspace },
      workspace: { id: "workspace", projectId: "project", path: workspace, label: "Workspace", isMain: true },
    },
  };
}
async function bytes(response: ServerPluginResourceResponse): Promise<Buffer> {
  if (response.body instanceof Uint8Array) return Buffer.from(response.body);
  const chunks: Uint8Array[] = [];
  for await (const chunk of response.body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "pi-web-audio-"));
  workspace = join(directory, "workspace");
  await mkdir(workspace);
  await writeFile(join(workspace, "clip.mp3"), data);
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe("audio resource callback", () => {
  it("streams the selected descriptor and extension MIME without text conversion", async () => {
    const response = await resource(request());
    expect(response).toMatchObject({ statusCode: 200, contentType: "audio/mpeg", contentLength: 16, acceptRanges: "bytes" });
    expect(response.body).not.toBeInstanceOf(Uint8Array);
    expect(await bytes(response)).toEqual(data);
  });

  it("accepts absolute paths contained in the workspace, including internal links", async () => {
    await symlink(join(workspace, "clip.mp3"), join(workspace, "inside.mp3"));
    for (const path of [join(workspace, "clip.mp3"), join(workspace, "inside.mp3")]) {
      const response = await resource(request(path, "bytes=2-5"));
      expect(response).toMatchObject({ statusCode: 206, contentLength: 4, contentRange: "bytes 2-5/16" });
      expect((await bytes(response)).toString()).toBe("2345");
    }
  });

  it.each([
    ["bytes=2-5", "2345", "bytes 2-5/16"],
    ["bytes=12-", "cdef", "bytes 12-15/16"],
    ["bytes=-4", "cdef", "bytes 12-15/16"],
    ["bytes=14-999", "ef", "bytes 14-15/16"],
  ])("serves bounded bytes for %s", async (range, expected, contentRange) => {
    const response = await resource(request("clip.mp3", range));
    expect(response).toMatchObject({ statusCode: 206, contentRange, contentLength: expected.length, acceptRanges: "bytes" });
    expect((await bytes(response)).toString()).toBe(expected);
  });

  it.each(["bytes=16-", "bytes=0-1,4-5", "bytes=-0"])("returns empty 416 for %s", async (range) => {
    const response = await resource(request("clip.mp3", range));
    expect(response).toMatchObject({ statusCode: 416, contentRange: "bytes */16", contentLength: 0, acceptRanges: "bytes" });
    expect(await bytes(response)).toHaveLength(0);
  });

  it("closes empty file responses with or without a range", async () => {
    await writeFile(join(workspace, "empty.wav"), "");
    for (const range of [undefined, "bytes=0-"]) {
      const response = await resource(request("empty.wav", range));
      expect(response.statusCode).toBe(range === undefined ? 200 : 416);
      expect(await bytes(response)).toHaveLength(0);
    }
  });

  it("allows in-workspace links but rejects traversal, outside symlinks and bad selectors", async () => {
    await writeFile(join(directory, "outside.mp3"), "private");
    await symlink(join(directory, "outside.mp3"), join(workspace, "outside.mp3"));
    await symlink(directory, join(workspace, "escape"));
    await symlink(join(workspace, "clip.mp3"), join(workspace, "inside.MP3"));
    expect(await bytes(await resource(request("inside.MP3")))).toEqual(data);
    for (const path of [join(directory, "outside.mp3"), join(workspace, "outside.mp3"), join(workspace, "escape", "outside.mp3"), `${workspace}/../outside.mp3`, "../outside.mp3", "escape/outside.mp3", "outside.mp3", "/outside.mp3", "missing.mp3", "clip.txt", "", "clip.mp3\0", "sub/../clip.mp3"]) {
      await expect(resource(request(path))).rejects.toThrow();
    }
    for (const input of [null, [], { path: "clip.mp3", root: directory }, { path: 42 }]) {
      await expect(resource({ ...request(), input })).rejects.toThrow("Invalid audio path");
    }
    await expect(resource({ ...request(), scope: { kind: "machine" } })).rejects.toThrow("workspace");
    await expect(resource({ ...request(), operation: "other" })).rejects.toThrow("workspace");
  });

  it("rejects directories and FIFOs without blocking", async () => {
    await mkdir(join(workspace, "folder.mp3"));
    await expect(resource(request("folder.mp3"))).rejects.toThrow("regular file");
    if (process.platform !== "win32") {
      execFileSync("mkfifo", [join(workspace, "pipe.mp3")]);
      await expect(resource(request("pipe.mp3"))).rejects.toThrow("regular file");
    }
  });

  it("bounds full responses to the size validated before later appends", async () => {
    const response = await resource(request());
    await writeFile(join(workspace, "clip.mp3"), Buffer.concat([data, Buffer.from("extra")]));
    expect(await bytes(response)).toEqual(data);
  });

  it("cancels streams even before consumption and closes their descriptor", async () => {
    const controller = new AbortController();
    const response = await resource(request("clip.mp3", undefined, controller.signal));
    // ReadStream's close event proves descriptor release, not just iterator rejection.
    const stream = response.body;
    if (!(stream instanceof ReadStream)) throw new Error("Expected a file stream");
    const closed = new Promise<void>((resolve) => stream.once("close", resolve));
    controller.abort();
    await closed;
    expect(stream.closed).toBe(true);
    await expect(bytes(response)).rejects.toThrow();
    await expect(resource(request("clip.mp3", undefined, controller.signal))).rejects.toThrow();
  });
});
