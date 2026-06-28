import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { commandWithVersionCheck, isCliEntrypoint } from "./cli.js";

const originalShell = process.env["SHELL"];

afterEach(() => {
  if (originalShell === undefined) {
    delete process.env["SHELL"];
  } else {
    process.env["SHELL"] = originalShell;
  }
});

describe("commandWithVersionCheck", () => {
  it("emits a POSIX subshell group for bash", () => {
    process.env["SHELL"] = "/bin/bash";
    expect(commandWithVersionCheck("npm")).toBe("command -v npm && (npm --version 2>&1 || true)");
  });

  it("emits a POSIX subshell group for zsh", () => {
    process.env["SHELL"] = "/bin/zsh";
    expect(commandWithVersionCheck("pi")).toBe("command -v pi && (pi --version 2>&1 || true)");
  });

  it("uses fish begin/end grouping instead of a POSIX subshell", () => {
    process.env["SHELL"] = "/usr/local/bin/fish";
    const command = commandWithVersionCheck("npm");
    expect(command).toBe("command -v npm && begin; npm --version 2>&1 || true; end");
    expect(command).not.toContain("(");
  });
});

describe("isCliEntrypoint", () => {
  it("matches direct execution paths", () => {
    expect(isCliEntrypoint("/tmp/pi-web-cli.js", "/tmp/pi-web-cli.js")).toBe(true);
  });

  it("matches npm-style symlinked bin entrypoints", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-web-cli-test-"));
    try {
      const target = join(dir, "dist", "cli.js");
      const symlink = join(dir, "bin", "pi-web");
      mkdirSync(join(dir, "dist"));
      mkdirSync(join(dir, "bin"));
      writeFileSync(target, "#!/usr/bin/env node\n", { mode: 0o755 });
      symlinkSync(target, symlink);

      expect(isCliEntrypoint(symlink, target)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not match unrelated paths", () => {
    expect(isCliEntrypoint("/tmp/pi-web", "/tmp/other-pi-web")).toBe(false);
  });
});
