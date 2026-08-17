import { describe, expect, it } from "vitest";
import type { OAuthFlowState } from "../api";
import type { AuthDialogTarget } from "../appState";
import { isBrowserRemoteOAuthMachine, isLoopbackHostname, oauthPromptInputType, shouldShowRemoteOAuthPasteNote } from "./AuthDialog";

describe("oauthPromptInputType", () => {
  it("renders additive secret prompts as password inputs and defaults legacy prompts to text", () => {
    expect(oauthPromptInputType("secret")).toBe("password");
    expect(oauthPromptInputType("text")).toBe("text");
    expect(oauthPromptInputType("manual_code")).toBe("text");
    expect(oauthPromptInputType(undefined)).toBe("text");
  });
});

describe("remote OAuth paste guidance", () => {
  it("recognizes loopback browser hosts including bracketed IPv6", () => {
    expect(isLoopbackHostname("localhost")).toBe(true);
    expect(isLoopbackHostname("127.0.0.1")).toBe(true);
    expect(isLoopbackHostname("[::1]")).toBe(true);
    expect(isLoopbackHostname("pi.example.test")).toBe(false);
  });

  it("shows guidance only for browser-remote manual-code prompts", () => {
    expect(isBrowserRemoteOAuthMachine("remote-1", "localhost")).toBe(true);
    expect(shouldShowRemoteOAuthPasteNote(oauthState(remoteTarget(), "manual_code"), "localhost")).toBe(true);
    expect(shouldShowRemoteOAuthPasteNote(oauthState(localTarget(), "manual_code"), "localhost")).toBe(false);
    expect(shouldShowRemoteOAuthPasteNote(oauthState(remoteTarget(), "text"), "pi.example.test")).toBe(false);
  });
});

function oauthState(target: AuthDialogTarget, promptType: "text" | "secret" | "manual_code") {
  const flow: OAuthFlowState = {
    flowId: "flow-1",
    providerId: "openai",
    providerName: "OpenAI",
    status: "running",
    progress: [],
    prompt: { requestId: "request-1", message: "Paste callback", kind: "manual", promptType },
  };
  return { step: "oauth" as const, flow, target };
}

function localTarget(): AuthDialogTarget {
  return { machineId: "local", projectId: "project-1" };
}

function remoteTarget(): AuthDialogTarget {
  return { machineId: "remote-1", machineKind: "remote", projectId: "project-1" };
}
