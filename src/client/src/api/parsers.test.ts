import { describe, expect, it } from "vitest";
import { PI_WEB_CAPABILITIES } from "../../../shared/capabilities";
import { parseAborted, parseAccepted, parseArchived, parseClosed, parseCommandResult, parseDeleted, parseDetached, parseFileContentResponse, parseFileSuggestion, parseGitStatusResponse, parseMachineHealth, parseMachineRuntime, parseMessagePage, parsePiWebConfigResponse, parsePiWebPluginsResponse, parsePiWebRuntimeResponse, parsePiWebStatusResponse, parseReloaded, parseRestored, parseSessionStatus, parseSlashCommand, parseStopped, parseTerminalCommandRun, parseTerminalInfo, parseWorkspaceActivityResponse } from "./parsers";

describe("API parsers", () => {
  it("parses PI WEB config responses", () => {
    expect(parsePiWebConfigResponse({
      path: "/tmp/config.json",
      exists: true,
      config: { host: "0.0.0.0", port: 8504, allowedHosts: ["example.local"], shortcuts: { "core:view.chat": "mod+1", "core:session.stop": null }, plugins: { info: { enabled: false, settings: { compact: true } } } },
      effectiveConfig: { host: "127.0.0.1", port: 8504, allowedHosts: true },
      envOverrides: { host: true, port: false, allowedHosts: false, spawnSessions: false, subsessions: false },
    })).toEqual({
      path: "/tmp/config.json",
      exists: true,
      config: { host: "0.0.0.0", port: 8504, allowedHosts: ["example.local"], shortcuts: { "core:view.chat": "mod+1", "core:session.stop": null }, plugins: { info: { enabled: false, settings: { compact: true } } } },
      effectiveConfig: { host: "127.0.0.1", port: 8504, allowedHosts: true },
      envOverrides: { host: true, port: false, allowedHosts: false, spawnSessions: false, subsessions: false },
    });
  });

  it("parses PI WEB runtime responses", () => {
    expect(parsePiWebRuntimeResponse({
      packageName: "@jmfederico/pi-web",
      generatedAt: "now",
      components: {
        web: { component: "web", label: "Web/UI", runtimeVersion: "1.0.0", available: true, capabilities: [PI_WEB_CAPABILITIES.sessionsDeleteArchived] },
        sessiond: { component: "sessiond", label: "Session daemon", runtimeVersion: "1.0.0", available: true, capabilities: [PI_WEB_CAPABILITIES.sessionsDeleteArchived] },
      },
      capabilities: [PI_WEB_CAPABILITIES.sessionsDeleteArchived],
    })).toMatchObject({ capabilities: [PI_WEB_CAPABILITIES.sessionsDeleteArchived] });
  });

  it("parses PI WEB status responses including installation, release, commands, and messages", () => {
    const response = {
      packageName: "@jmfederico/pi-web",
      generatedAt: "now",
      components: {
        web: {
          component: "web",
          label: "Web/UI",
          runtimeVersion: "1.2.3",
          installedVersion: "1.2.2",
          stale: true,
          available: true,
          installation: {
            kind: "npm-global",
            path: "/usr/local/lib/node_modules/@jmfederico/pi-web",
            source: "@jmfederico/pi-web",
            scope: "user",
            npmRoot: "/usr/local/lib/node_modules",
          },
        },
        sessiond: {
          component: "sessiond",
          label: "Session daemon",
          runtimeVersion: "1.2.3",
          installedVersion: "1.2.3",
          stale: false,
          available: false,
          error: "not running",
        },
      },
      release: {
        packageName: "@jmfederico/pi-web",
        latestVersion: "1.3.0",
        updateAvailable: true,
        checkedAt: "later",
      },
      commands: {
        update: "npm install -g @jmfederico/pi-web@latest",
        restart: "systemctl --user restart pi-web.target",
        restartWeb: "systemctl --user restart pi-web-ui-dev.service",
        restartSessiond: "systemctl --user restart pi-web-sessiond.service",
        status: "systemctl --user status pi-web.target",
      },
      messages: [
        {
          id: "update-available",
          severity: "warning",
          title: "Update available",
          body: "Install the latest release.",
          command: "npm install -g @jmfederico/pi-web@latest",
        },
      ],
    };

    expect(parsePiWebStatusResponse(response)).toEqual(response);
  });

  it("parses PI WEB plugin status responses", () => {
    expect(parsePiWebPluginsResponse({
      plugins: [{ id: "info", module: "/pi-web-plugins/info/pi-web-plugin.js?v=1", source: "bundled", scope: "bundled", machineSpecific: true, enabled: false }],
    })).toEqual({
      plugins: [{ id: "info", module: "/pi-web-plugins/info/pi-web-plugin.js?v=1", source: "bundled", scope: "bundled", machineSpecific: true, enabled: false }],
    });
  });

  it("parses machine health responses with nested PI WEB component status", () => {
    const response = {
      machineId: "machine-1",
      ok: false,
      checkedAt: "now",
      status: "error",
      web: {
        component: "web",
        label: "Web/UI",
        runtimeVersion: "1.2.3",
        installedVersion: "1.2.2",
        stale: true,
        available: true,
        installation: {
          kind: "local",
          path: "/srv/pi-web",
        },
      },
      sessiond: {
        component: "sessiond",
        label: "Session daemon",
        runtimeVersion: "1.2.3",
        installedVersion: "1.2.3",
        stale: false,
        available: false,
        error: "not running",
      },
      error: "session daemon unavailable",
    };

    expect(parseMachineHealth(response)).toEqual(response);
  });

  it("parses machine runtime responses with nested runtime components and capabilities", () => {
    const response = {
      machineId: "machine-1",
      ok: true,
      checkedAt: "now",
      packageName: "@jmfederico/pi-web",
      generatedAt: "later",
      components: {
        web: {
          component: "web",
          label: "Web/UI",
          runtimeVersion: "1.2.3",
          available: true,
          capabilities: [PI_WEB_CAPABILITIES.sessionsDeleteArchived, PI_WEB_CAPABILITIES.promptAttachments],
        },
        sessiond: {
          component: "sessiond",
          label: "Session daemon",
          available: false,
          capabilities: [PI_WEB_CAPABILITIES.sessionsReload],
          error: "socket missing",
        },
      },
      capabilities: [PI_WEB_CAPABILITIES.sessionsDeleteArchived, PI_WEB_CAPABILITIES.promptAttachments],
    };

    expect(parseMachineRuntime(response)).toEqual(response);
  });

  it("accepts legacy array message pages and paged message responses", () => {
    expect(parseMessagePage(["a", "b"])).toEqual({ messages: ["a", "b"], start: 0, total: 2 });
    expect(parseMessagePage({ messages: ["c"], start: 3, total: 9 })).toEqual({ messages: ["c"], start: 3, total: 9 });
  });

  it("validates session status including optional model and nullable context usage", () => {
    expect(parseSessionStatus({
      sessionId: "s1",
      isStreaming: false,
      isCompacting: true,
      isBashRunning: false,
      pendingMessageCount: 2,
      queuedMessages: [{ kind: "steer", text: "adjust this", imageCount: 2 }, { kind: "followUp", text: "then do that" }],
      messageCount: 7,
      tokens: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 },
      cost: 0.12,
      model: { provider: "p", id: "m", contextWindow: 100, reasoning: { effort: "low" }, input: ["text", "image"] },
      contextUsage: { tokens: null, contextWindow: 100, percent: 0.5 },
      thinkingLevel: "medium",
    })).toEqual({
      sessionId: "s1",
      isStreaming: false,
      isCompacting: true,
      isBashRunning: false,
      pendingMessageCount: 2,
      queuedMessages: [{ kind: "steer", text: "adjust this", imageCount: 2 }, { kind: "followUp", text: "then do that" }],
      messageCount: 7,
      tokens: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 },
      cost: 0.12,
      model: { provider: "p", id: "m", contextWindow: 100, reasoning: { effort: "low" }, input: ["text", "image"] },
      contextUsage: { tokens: null, contextWindow: 100, percent: 0.5 },
      thinkingLevel: "medium",
    });
  });

  it("parses workspace activity snapshots", () => {
    expect(parseWorkspaceActivityResponse({
      generatedAt: "now",
      workspaces: [{ cwd: "/repo", hasSessionActivity: true, hasTerminalActivity: false, updatedAt: "later" }],
    })).toEqual({
      generatedAt: "now",
      workspaces: [{ cwd: "/repo", hasSessionActivity: true, hasTerminalActivity: false, updatedAt: "later" }],
    });
  });

  it("rejects invalid enum-like fields", () => {
    expect(() => parseSlashCommand({ name: "bad", source: "remote" })).toThrow("Invalid command source");
    expect(() => parseFileSuggestion({ path: "a", kind: "deleted" })).toThrow("Invalid file kind");
    expect(() => parseGitStatusResponse({ isGitRepo: true, hash: "h", files: [{ path: "a", index: "weird", workingTree: "modified" }] })).toThrow("Invalid git file state");
  });

  it("validates file content responses", () => {
    const textFile = {
      path: "README.md",
      language: "markdown",
      encoding: "utf8",
      size: 4,
      modifiedAt: "now",
      content: "text",
      truncated: false,
      binary: false,
    };

    expect(parseFileContentResponse(textFile)).toMatchObject({ path: "README.md", language: "markdown", content: "text" });
    expect(parseFileContentResponse({ ...textFile, path: "logo.png", mediaType: "image", mimeType: "image/png", content: "", binary: true })).toMatchObject({ path: "logo.png", mediaType: "image", mimeType: "image/png" });

    expect(() => parseFileContentResponse({ encoding: "base64" })).toThrow("Invalid file encoding");
    expect(() => parseFileContentResponse({ ...textFile, mediaType: "video" })).toThrow("Invalid file media type");
  });

  it("parses terminal info with optional command-run ownership", () => {
    expect(parseTerminalInfo({
      id: "t1",
      cwd: "/repo",
      name: "Build",
      createdAt: "now",
      exited: false,
      commandRunId: "run1",
    })).toMatchObject({ id: "t1", commandRunId: "run1" });
  });

  it("parses terminal command runs", () => {
    expect(parseTerminalCommandRun({
      id: "run1",
      origin: "core",
      projectId: "p1",
      workspaceId: "w1",
      terminalId: "t1",
      title: "Build",
      command: "npm run build",
      status: "succeeded",
      exitCode: 0,
      createdAt: "now",
      startedAt: "then",
      completedAt: "later",
      metadata: { "pi.operation": "test" },
    })).toEqual({
      id: "run1",
      origin: "core",
      projectId: "p1",
      workspaceId: "w1",
      terminalId: "t1",
      title: "Build",
      command: "npm run build",
      status: "succeeded",
      exitCode: 0,
      createdAt: "now",
      startedAt: "then",
      completedAt: "later",
      metadata: { "pi.operation": "test" },
    });
    expect(() => parseTerminalCommandRun({
      id: "run1",
      origin: "core",
      projectId: "p1",
      workspaceId: "w1",
      terminalId: "t1",
      title: "Build",
      command: "npm run build",
      status: "done",
      createdAt: "now",
      metadata: {},
    })).toThrow("Invalid terminal command run status");
  });

  it("parses command result variants", () => {
    expect(parseCommandResult({ type: "unsupported", message: "nope" })).toEqual({ type: "unsupported", message: "nope" });
    expect(parseCommandResult({ type: "select", requestId: "r1", title: "Pick", options: [{ value: "v", label: "Label", description: "desc" }] })).toEqual({ type: "select", requestId: "r1", title: "Pick", options: [{ value: "v", label: "Label", description: "desc" }] });
    expect(parseCommandResult({ type: "done", message: "ok", promptDraft: "resend me" })).toEqual({ type: "done", message: "ok", promptDraft: "resend me" });
    expect(() => parseCommandResult({ type: "later" })).toThrow("Invalid command result type");
  });

  it("parses simple command acknowledgement responses", () => {
    expect(parseAccepted({ accepted: true })).toEqual({ accepted: true });
    expect(parseClosed({ closed: true })).toEqual({ closed: true });
    expect(parseAborted({ aborted: true })).toEqual({ aborted: true });
    expect(parseStopped({ stopped: true })).toEqual({ stopped: true });
    expect(parseRestored({ restored: true })).toEqual({ restored: true });
    expect(parseDeleted({ deleted: true })).toEqual({ deleted: true });
    expect(parseDetached({ detached: true })).toEqual({ detached: true });
    expect(parseReloaded({ reloaded: true })).toEqual({ reloaded: true });
    expect(parseArchived({ archived: true, sessionIds: ["s1"], archivedCount: 1, skippedAlreadyArchivedCount: 2 })).toEqual({ archived: true, sessionIds: ["s1"], archivedCount: 1, skippedAlreadyArchivedCount: 2 });
    expect(() => parseAccepted({ accepted: false })).toThrow("Expected accepted response");
    expect(() => parseArchived({ archived: true, sessionIds: [1] })).toThrow("Expected string array field: sessionIds");
  });
});
