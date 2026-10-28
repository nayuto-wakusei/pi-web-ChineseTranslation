import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createPiWebCustomToolDefinitions } from "./piSessionService.js";
import { stubExtensionToolContext } from "./piSessionService.testSupport.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

it("marks only the owned edit preview update, retaining English content and final tool output", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-edit-progress-"));
  dirs.push(cwd);
  await writeFile(join(cwd, "raw.ts"), "old\n");
  const edit = createPiWebCustomToolDefinitions(cwd, false).find((tool) => tool.name === "edit");
  if (edit === undefined) throw new Error("Expected edit tool");
  const updates: unknown[] = [];
  const result = await edit.execute("edit-1", { path: "raw.ts", edits: [{ oldText: "old", newText: "new" }] }, undefined, (update) => { updates.push(update); }, stubExtensionToolContext({ cwd }));
  expect(updates[0]).toMatchObject({
    content: [{ type: "text", text: "Edit preview computed." }],
    details: { presentation: { kind: "editPreviewComputed" } },
  });
  expect(updates[0]).toHaveProperty("details.preview.diff", expect.any(String));
  expect(result.details).not.toHaveProperty("presentation");
  expect(await readFile(join(cwd, "raw.ts"), "utf8")).toBe("new\n");

  const missingUpdates: unknown[] = [];
  await expect(edit.execute("edit-2", { path: "missing.ts", edits: [{ oldText: "old", newText: "new" }] }, undefined, (update) => { missingUpdates.push(update); }, stubExtensionToolContext({ cwd }))).rejects.toThrow();
  expect(missingUpdates[0]).toMatchObject({
    content: [{ type: "text", text: "Edit preview computed." }],
    details: { presentation: { kind: "editPreviewComputed" } },
  });
  expect(missingUpdates[0]).toHaveProperty("details.preview.error", expect.stringContaining("missing.ts"));
});
