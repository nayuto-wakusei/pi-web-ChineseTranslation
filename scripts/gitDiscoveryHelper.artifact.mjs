import { execFile } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const execute = promisify(execFile);

it("ships a standalone Git notification helper that fails open", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-web-git-helper-artifact-"));
  try {
    const helper = join(directory, "workspace-discovery-notify.cjs");
    await copyFile(resolve("dist/pi-web-plugins/git/workspace-discovery-notify.cjs"), helper);
    const marker = join(directory, "notification-attempted");
    const command = [process.execPath, "-e", 'require("node:fs").writeFileSync(process.argv[1], "attempted"); process.exit(17);', marker];
    const checkout = ["0".repeat(40), "2".repeat(40), "1"];
    await execute(process.execPath, [helper, JSON.stringify(command), ...checkout], { cwd: directory, timeout: 5000 });
    expect(await readFile(marker, "utf8")).toBe("attempted");
    await expect(execute(process.execPath, [helper, JSON.stringify([join(directory, "missing-command")]), ...checkout], { cwd: directory, timeout: 5000 }))
      .resolves.toMatchObject({ stdout: "" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
