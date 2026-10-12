import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { ReviewStore, reviewScope } from "../../../examples/session-bridge-plugin/src/store.js";
import type { Review } from "../../../examples/session-bridge-plugin/src/browser/protocol.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("serializes real record replacements with concurrent readers and captures each save", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-review-store-race-"));
  roots.push(root);
  const scope = reviewScope("project", "workspace");
  const store = new ReviewStore(root);
  const reader = new ReviewStore(root);
  const record: Review = { id: randomUUID(), createdAt: new Date().toISOString(), sessionId: "session", status: "running", text: "initial" };
  await store.save(scope, record);
  const pending: Promise<unknown>[] = [];
  for (let i = 0; i < 40; i++) {
    record.text = `revision-${String(i)}`;
    pending.push(store.save(scope, record));
    pending.push(reader.read(scope, record.id).then((saved) => {
      expect(saved.text).toBe(`revision-${String(i)}`);
    }));
  }
  record.text = "caller mutation must not reach queued writes";
  await Promise.all(pending);
  expect(await store.read(scope, record.id)).toMatchObject({ text: "revision-39" });
  expect(JSON.parse(await readFile(join(root, scope, `${record.id}.json`), "utf8"))).toMatchObject({ text: "revision-39" });
});

it("propagates a failed save without poisoning later record reads or another scope", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-review-store-failure-"));
  roots.push(root);
  const scope = reviewScope("project", "workspace");
  const store = new ReviewStore(root);
  const record: Review = { id: randomUUID(), createdAt: new Date().toISOString(), sessionId: "session", status: "running", text: "initial" };
  await mkdir(join(root, scope), { recursive: true });
  await mkdir(join(root, scope, `${record.id}.json`));
  await expect(store.save(scope, record)).rejects.toThrow();
  await rm(join(root, scope, `${record.id}.json`), { recursive: true });
  await writeFile(join(root, scope, `${record.id}.json`), JSON.stringify(record));
  await expect(store.read(scope, record.id)).resolves.toEqual(record);
  const otherScope = reviewScope("other-project", "workspace");
  await expect(store.save(otherScope, record)).resolves.toBeUndefined();
  await expect(store.read(otherScope, record.id)).resolves.toEqual(record);
});
