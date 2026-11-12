import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { checkManagementInput, checkManagementMaterial, checkManagementTool, checkManagementUninspectableMaterial, startManagementGuardrails } from "./managementGuardrails.js";

const identity = { user: { id: "u", rootUserId: "r", roles: [], permissions: [] }, projects: [{ id: "p", name: "project" }] };
const scope = { managementContext: identity, cwd: process.cwd(), projectId: "p", sessionId: "personal-session-42" };
let directory: string;
let env: NodeJS.ProcessEnv;
let close: () => Promise<void>;
let decisionAction = "allow";
let responseStatus = 200;
let ack = true;
const events: string[] = [];
let semanticCalls = 0;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "guardrail-host-"));
  const module = join(directory, "module.mjs");
  await writeFile(module, `
export const POLICY_VERSION = "pi-embed-v1";
export function checkInput(text) { return text === "explicit" ? "instruction_override" : null; }
export function checkTool({tool}) { return tool === "bash" ? "shell_not_permitted" : null; }
export function createGuardExtension() { return () => {}; }
`);
  env = { PI_WEB_DATA_DIR: directory, PI_GUARDRAIL_ENABLED: "1", PI_GUARDRAIL_MODULE: module,
    PI_GUARDRAIL_TOKEN: "detector-fixture", GUARDRAIL_AUDIT_TOKEN: "audit-fixture",
    PI_GUARDRAIL_AUDIT_URL: "http://audit.test/events", PI_GUARDRAIL_ENDPOINT: "http://detector.test/v1/decisions" };
  semanticCalls = 0;
  events.length = 0;
  ack = true;
  responseStatus = 200;
  decisionAction = "allow";
  vi.stubGlobal("fetch", vi.fn<typeof fetch>((url, init) => {
    if (url === env["PI_GUARDRAIL_AUDIT_URL"]) {
      if (typeof init?.body !== "string") throw new Error("Expected serialized audit document");
      events.push(init.body);
      return Promise.resolve(Response.json({ accepted: ack }));
    }
    semanticCalls++;
    return Promise.resolve(Response.json({action:decisionAction, reasonCode:"model_clear", policyVersion:"pi-embed-v1",
      detectorVersion:"fixture-1", decisionId:randomUUID()}, {status:responseStatus}));
  }));
  close = startManagementGuardrails(env);
});

afterEach(async () => {
  await close();
  vi.unstubAllGlobals();
  await rm(directory, {recursive: true, force:true});
});

describe("management guardrail host", () => {
  it("blocks hard prohibitions before classification and records no user material or cleartext identity", async () => {
    await expect(checkManagementInput(scope, "explicit")).rejects.toMatchObject({status:403, reasonCode:"instruction_override"});
    await expect(checkManagementTool(scope, "bash", {command:"sensitive-tool-args"})).rejects.toMatchObject({status:403});
    expect(semanticCalls).toBe(0);
    await vi.waitFor(() => { expect(events).toHaveLength(2); });
    expect(events.join("")).not.toMatch(/explicit|personal-session-42|sensitive-tool-args|audit-fixture/u);
  });
  it("preserves material in shadow and isolates in enforce, including uninspectable bytes", async () => {
    decisionAction = "isolate";
    const text = "external sentinel";
    expect(await checkManagementMaterial(scope, text)).toEqual({text,isolated:false});
    env["PI_GUARDRAIL_MATERIAL_MODE"] = "enforce";
    const inspected = await checkManagementMaterial(scope, text);
    expect(inspected.isolated).toBe(true);
    expect(inspected.text).not.toContain(text);
    await expect(checkManagementUninspectableMaterial(scope)).rejects.toMatchObject({reasonCode:"material_requires_text"});
    await vi.waitFor(() => { expect(events).toHaveLength(3); });
    expect(events.join("")).toContain("shadow_hit");
    expect(events.join("")).not.toContain(text);
  });
  it("pauses on a missing detector or malformed allow decision and allows an explicit retry", async () => {
    env["PI_GUARDRAIL_INPUT_MODE"] = "enforce";
    responseStatus = 503;
    await expect(checkManagementInput(scope, "normal")).rejects.toMatchObject({status:503});
    responseStatus = 200;
    decisionAction = "unknown";
    await expect(checkManagementInput(scope, "normal")).rejects.toMatchObject({status:503});
    decisionAction = "block";
    await expect(checkManagementInput(scope, "normal")).rejects.toMatchObject({status:403});
    decisionAction = "allow";
    await expect(checkManagementInput(scope, "normal")).resolves.toBeUndefined();
    expect(semanticCalls).toBe(4);
  });
  it("can keep eight shadow checks pending without delaying the business call", async () => {
    const transport = fetch;
    let finish!: () => void;
    const release = new Promise<void>(resolve => { finish = resolve; });
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (url, init) => {
      if (url === env["PI_GUARDRAIL_ENDPOINT"]) await release;
      return transport(url, init);
    }));
    try {
      const results = await Promise.all(Array.from({length:9}, () => checkManagementMaterial(scope, "unmodified")));
      expect(results.every(result => result.text === "unmodified" && !result.isolated)).toBe(true);
      await vi.waitFor(() => { expect(events.join("")).toContain("shadow_capacity"); });
      expect(semanticCalls).toBe(0);
    } finally { finish(); }
    await vi.waitFor(() => { expect(semanticCalls).toBe(8); });
  });

  it("pauses a required detector request on its real deadline and permits a subsequent healthy call", async () => {
    env["PI_GUARDRAIL_INPUT_MODE"] = "enforce";
    env["PI_GUARDRAIL_TIMEOUT_MS"] = "30";
    const transport = fetch;
    let stall = true;
    vi.stubGlobal("fetch", vi.fn<typeof fetch>((url, init) => {
      if (url !== env["PI_GUARDRAIL_ENDPOINT"] || !stall) return transport(url, init);
      const signal = init?.signal;
      if (!signal) throw new Error("Expected a bounded detector request");
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => { reject(new Error("deadline")); }, {once:true});
      });
    }));
    await expect(checkManagementInput(scope, "normal")).rejects.toMatchObject({status:503, reasonCode:"detector_unavailable"});
    stall = false;
    await expect(checkManagementInput(scope, "normal")).resolves.toBeUndefined();
  });

  it("resends the same durable event after losing its acknowledgement and restarting", async () => {
    ack = false;
    await checkManagementTool(scope, "read", {});
    await vi.waitFor(() => { expect(events).toHaveLength(1); });
    await close();
    ack = true;
    close = startManagementGuardrails(env);
    await vi.waitFor(() => { expect(events).toHaveLength(2); });
    expect(events[0]).toBe(events[1]);
    expect(semanticCalls).toBe(0);
  });
  it("keeps daemon startup available and pauses protected actions while local audit storage is unwritable", async () => {
    await close();
    const blockedPath = join(directory, "unwritable");
    await writeFile(blockedPath, "file where directory expected");
    env["PI_WEB_DATA_DIR"] = blockedPath;
    close = startManagementGuardrails(env);
    await expect(checkManagementTool(scope, "read", {})).rejects.toMatchObject({status:503, reasonCode:"audit_storage_unavailable"});
    expect(semanticCalls).toBe(0);
    await rm(blockedPath);
    await expect(checkManagementTool(scope, "read", {})).resolves.toBeUndefined();
    await vi.waitFor(() => {expect(events).toHaveLength(1);});
  });

  it("denies missing policy even with both privilege grants", async () => {
    env["PI_GUARDRAIL_MODULE"] = join(directory, "unavailable.mjs");
    await expect(checkManagementTool({ ...scope, managementContext: { ...identity, privileged: {bash:true,network:true} } },
      "read", {})).rejects.toMatchObject({reasonCode:"rules_unavailable",status:503});
  });
});
