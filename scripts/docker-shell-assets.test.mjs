import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";

it.each([
  "docker/pi-web-docker",
  "docker/internal/image/install-opensuse-base",
  "docker/internal/dev/compose",
  "docker/internal/dev/sync-node-modules",
  "docker/internal/bin/hostexec",
  "docker/internal/host-profile.sh",
])("keeps the Docker shell asset %s executable with a POSIX shebang", async (path) => {
  const bytes = await readFile(new URL(`../${path}`, import.meta.url));
  expect(bytes.includes(13)).toBe(false);
  expect(bytes.toString("utf8").startsWith("#!/")).toBe(true);
});
