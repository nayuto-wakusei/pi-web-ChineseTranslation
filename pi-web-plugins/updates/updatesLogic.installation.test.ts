import { expect, it } from "vitest";
import { fallbackDockerStatus } from "./updatesLogic";

it.each([
  ["dev", "node /workspace/dist/cli.js update", "pi-web-docker --dev"],
  ["runtime", "pi-web update", "pi-web-docker"],
] as const)("routes %s Docker updates through the installation-aware CLI while retaining maintenance commands", (dockerMode, update, maintenance) => {
  const status = fallbackDockerStatus({ dockerMode });
  expect(status?.packageName).toBe("@chainingintention/pi-web-cn");
  expect(status?.commands).toEqual({
    update,
    restart: `${maintenance} restart`,
    restartWeb: `${maintenance} restart-web`,
    restartSessiond: `${maintenance} restart-sessiond`,
    status: `${maintenance} status`,
  });
});
