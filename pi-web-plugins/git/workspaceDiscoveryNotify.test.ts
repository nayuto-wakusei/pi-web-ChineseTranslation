import { execFileSync } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "pi-git-notification-helper-"));
  directories.push(directory);
  const helper = join(directory, "notification-helper.cjs");
  await copyFile(new URL("./workspace-discovery-notify.cjs", import.meta.url), helper);
  const marker = join(directory, "notification.json");
  const command = [process.execPath, "-e", 'require("node:fs").writeFileSync(process.argv[1], JSON.stringify(process.argv.slice(2))); process.exit(17);', marker, "project with spaces", "opaque'argument"];
  return { directory, helper, marker, command };
}

it.each([40, 64])("executes the standalone helper for initial %s-character checkout OIDs without a shell and preserves notifier failure as Git success", async (length) => {
  const { directory, helper, marker, command } = await fixture();
  expect(execFileSync(process.execPath, [helper, JSON.stringify(command), "0".repeat(length), "1".repeat(length), "1"], { cwd: directory, encoding: "utf8", timeout: 5_000 })).toBe("");
  expect(JSON.parse(await readFile(marker, "utf8"))).toEqual(["project with spaces", "opaque'argument"]);
});

it.each([
  { args: ["1".repeat(40), "2".repeat(40), "1"] },
  { args: ["0".repeat(40), "2".repeat(40), "0"] },
  { args: ["0".repeat(40), "2".repeat(40), "1", "extra"] },
])("does not notify for ordinary switches, file checkouts or unexpected hook arguments: %j", async ({ args }) => {
  const { directory, helper, marker, command } = await fixture();
  expect(execFileSync(process.execPath, [helper, JSON.stringify(command), ...args], { cwd: directory, encoding: "utf8", timeout: 5_000 })).toBe("");
  await expect(stat(marker)).rejects.toMatchObject({ code: "ENOENT" });
});

it("fails open for invalid notifier data and an uninstalled notification executable", async () => {
  const { directory, helper, marker } = await fixture();
  for (const notifier of ["not JSON", JSON.stringify([join(directory, "missing-executable")])]) {
    expect(execFileSync(process.execPath, [helper, notifier, "0".repeat(40), "2".repeat(40), "1"], { cwd: directory, encoding: "utf8", timeout: 5_000 })).toBe("");
  }
  await expect(stat(marker)).rejects.toMatchObject({ code: "ENOENT" });
});
