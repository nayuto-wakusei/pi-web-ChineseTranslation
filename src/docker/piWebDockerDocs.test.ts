import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PI_WEB_DOCKER_USER_COMMANDS } from "./piWebDockerCommandPlan.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("pi-web-docker documentation", () => {
  it("keeps the Docker command matrix aligned with the canonical user command surface", async () => {
    const [dockerReadme, dockerEntrypoint] = await Promise.all([
      readRepoFile("docker/README.md"),
      readRepoFile("docker/pi-web-docker"),
    ]);

    const documentedCommands = readDockerCommandMatrix(dockerReadme);
    expect(new Set(documentedCommands)).toEqual(readEntrypointCommandCases(dockerEntrypoint));
    // The application only needs a subset of the standalone Docker CLI.
    for (const command of PI_WEB_DOCKER_USER_COMMANDS) expect(documentedCommands).toContain(command);

  });
});

function readDockerCommandMatrix(dockerReadme: string): string[] {
  const normalizedReadme = normalizeLineEndings(dockerReadme);
  const commandMatrixSection = normalizedReadme.split("### Command matrix\n")[1]?.split("\n### Installer options")[0] ?? "";
  return Array.from(commandMatrixSection.matchAll(/^\| `([^`]+)` \|/gm), (match) => {
    const command = match[1];
    if (command === undefined) throw new Error("Docker command matrix row did not include a command");
    return command;
  });
}

function readEntrypointCommandCases(dockerEntrypoint: string): Set<string> {
  const normalizedEntrypoint = normalizeLineEndings(dockerEntrypoint);
  const commandCaseBlock = normalizedEntrypoint.slice(normalizedEntrypoint.indexOf('case "$command_name" in'));
  const commandCases = new Set<string>();
  for (const line of commandCaseBlock.split("\n")) {
    const match = /^ {2}([a-z][a-z-]*(?:\|[a-z][a-z-]*)*)(?:\|__run-detached)?\)$/.exec(line);
    if (match?.[1] === undefined) continue;
    for (const command of match[1].split("|")) commandCases.add(command);
  }
  return commandCases;
}

function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n?/g, "\n");
}

async function readRepoFile(relativePath: string): Promise<string> {
  return await readFile(join(repoRoot, relativePath), "utf8");
}
