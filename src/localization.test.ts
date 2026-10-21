import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cliHelp } from "./cli.js";
import { loadNodeTranslator } from "./localization.js";
import { builtinCommands } from "./server/sessions/builtinCommands.js";
import { formatNodePtyNativeModuleCheck, NODE_PTY_GLOBAL_REINSTALL_COMMAND } from "./server/diagnostics/nodePtyNativeModule.js";
import { formatNativeServiceDoctorResult } from "./nativeServices/serviceDoctor.js";

describe("machine-local language dictionaries", () => {
  it("defaults to Chinese and keeps the command identifiers unchanged", () => {
    const t = loadNodeTranslator("server", {});
    expect(t("session.notFound", "Session not found")).toBe("未找到会话");
    expect(builtinCommands(t).find((command) => command.name === "settings")).toEqual({
      name: "settings", source: "builtin", description: "打开设置菜单",
    });
  });

  it("keeps independently configured machines isolated", () => {
    const chinese = loadNodeTranslator("server", {});
    const english = loadNodeTranslator("server", { plugins: { "zh-cn": { enabled: false } } });
    expect(chinese("session.notFound", "Session not found")).toBe("未找到会话");
    expect(english("session.notFound", "Session not found")).toBe("Session not found");
    expect(chinese("session.notFound", "Session not found")).toBe("未找到会话");
    expect(english("missing.key", "Missing {name}", { name: "用户原文" })).toBe("Missing 用户原文");
  });

  it("formats only its own text, preserving user values and missing-key fallbacks", () => {
    const t = loadNodeTranslator("server", {});
    expect(t("command.named", "Session named: {value0}", { value0: "<script>用户</script>" }))
      .toBe("会话已命名：<script>用户</script>");
    expect(t("thirdParty.error", "Unchanged provider error: {error}", { error: "Access denied" }))
      .toBe("Unchanged provider error: Access denied");
  });

  it("localizes CLI help without translating commands and config paths", () => {
    const chinese = cliHelp(loadNodeTranslator("cli", {}));
    const english = cliHelp(loadNodeTranslator("cli", { plugins: { "zh-cn": { enabled: false } } }));
    expect(chinese).toContain("用法：");
    expect(english).toContain("Usage:");
    for (const help of [chinese, english]) {
      expect(help).toContain("pi-web install [--dev]");
      expect(help).toContain("~/.config/pi-web/config.json");
    }
  });

  it("uses the machine config for CLI failures while preserving the exit code and unknown command", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-web-cli-i18n-"));
    const path = join(directory, "config.json");
    const cliPath = fileURLToPath(new URL("./cli.ts", import.meta.url));
    try {
      for (const enabled of [true, false]) {
        await writeFile(path, JSON.stringify({ plugins: { "zh-cn": { enabled } } }));
        const result = spawnSync(process.execPath, ["--import", "tsx", cliPath, "unknown-user-command"], {
          env: { ...process.env, PI_WEB_CONFIG: path },
          encoding: "utf8",
        });
        expect(result.status).toBe(1);
        expect(result.stderr).toContain(enabled ? "未知命令：unknown-user-command" : "Unknown command: unknown-user-command");
        const recovery = spawnSync(process.execPath, ["--import", "tsx", cliPath, "plugins", "safe-start", "show", "--config", path], {
          env: { ...process.env, PI_WEB_CONFIG: path },
          encoding: "utf8",
        });
        expect(recovery.status).toBe(0);
        expect(recovery.stdout).toContain(enabled ? "服务端插件安全启动：off" : "Server plugin safe start: off");
        expect(recovery.stdout).toContain(path);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("translates CLI diagnostics without changing underlying errors or repair commands", () => {
    const t = loadNodeTranslator("cli", {});
    const native = formatNodePtyNativeModuleCheck({ status: "load-failed", message: "MODULE_NOT_FOUND: original provider text" }, t);
    expect(native.ok).toBe(false);
    expect(native.lines).toContain("  无法加载 node-pty：MODULE_NOT_FOUND: original provider text");
    expect(native.lines).toContain(`    ${NODE_PTY_GLOBAL_REINSTALL_COMMAND}`);
    const report = formatNativeServiceDoctorResult({ kind: "inspection-failure", message: "raw inspection detail" }, t);
    expect(report.failureKind).toBe("inspection");
    expect(report.lines[0]).toBe("✗ 无法检查已安装的原生服务计划：raw inspection detail");
  });
});
