import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { ExtensionUIDialogOptions } from "../../piSdk.js";
import type { McpAuthServerOption, OAuthFlowState } from "../../shared/apiTypes.js";
import { createTranslator, UserFacingError, userFacingErrorMessage, type Translator } from "../../shared/i18n.js";
import { normalizeRequestCwd } from "../workingDirectory.js";

const execution = new AsyncLocalStorage<{ service: McpAuthFlowService; token: symbol; discovery?: boolean }>();
const MAX_TEXT = 32 * 1024;
const MAX_PROGRESS = 100;

export interface McpAuthFlowOwner {
  scope: string;
  sessionId: string;
  cwd: string;
  projectPath?: string;
}

function normalizeOwner(owner: McpAuthFlowOwner): McpAuthFlowOwner {
  return { ...owner, cwd: normalizeRequestCwd(owner.cwd), ...(owner.projectPath === undefined ? {} : { projectPath: normalizeRequestCwd(owner.projectPath) }) };
}

function ownerKey(owner: McpAuthFlowOwner): string {
  const normalized = normalizeOwner(owner);
  return JSON.stringify([normalized.scope, normalized.sessionId, normalized.cwd, normalized.projectPath]);
}

interface Pending {
  id: string;
  values?: readonly string[];
  settle(value: string | undefined): void;
}
interface Flow {
  state: OAuthFlowState;
  identity: object;
  owner: McpAuthFlowOwner;
  token: symbol;
  isCurrent(): boolean;
  pending?: Pending;
  timer?: ReturnType<typeof setTimeout>;
  commandError?: string;
}

/** Operation transport only. Pi owns config, credentials, OAuth and reconnect. */
export class McpAuthFlowService {
  private readonly flows = new Map<string, Flow>();
  private readonly active = new Map<symbol, Flow>();
  private readonly sessions = new Map<string, Flow>();
  private disposed = false;

  private readonly t: Translator;

  constructor(private readonly options: { runningTtlMs?: number; terminalTtlMs?: number; translator?: Translator } = {}) {
    this.t = options.translator ?? createTranslator("en", {});
  }

  start(options: { owner: McpAuthFlowOwner; identity: object; isCurrent(): boolean; mode?: "login" | "logout"; run(): Promise<void> }): OAuthFlowState {
    if (this.disposed) throw new UserFacingError("mcpAuth.disposed", "MCP authentication service is disposed");
    const owner = normalizeOwner(options.owner);
    if (this.sessions.has(ownerKey(owner))) throw new UserFacingError("mcpAuth.sessionAlreadyRunning", "MCP authentication is already running for this session");
    // Pi persisted OAuth state is shared across sessions. Do not race two scoped logins against the same credentials.
    if (this.sessions.size > 0) throw new UserFacingError("mcpAuth.machineBusy", "Another MCP authentication operation is running on this machine. Finish it before starting another.");
    if (this.flows.size >= 100) throw new UserFacingError("mcpAuth.tooManyFlows", "Too many MCP authentication flows");
    const flow: Flow = {
      state: { flowId: randomUUID(), target: "mcp", providerId: "mcp", providerName: this.t("mcpAuth.server", "MCP server"), status: "running", progress: [], ...(options.mode === undefined ? {} : { mcpMode: options.mode }) },
      identity: options.identity, owner, token: Symbol(), isCurrent: () => options.isCurrent(),
    };
    this.flows.set(flow.state.flowId, flow);
    this.active.set(flow.token, flow);
    this.sessions.set(ownerKey(flow.owner), flow);
    flow.timer = setTimeout(() => { this.requestCancel(flow); }, this.options.runningTtlMs ?? 30 * 60_000);
    flow.timer.unref();
    // Keep the real command promise in this scope, not its submission receipt.
    void execution.run({ service: this, token: flow.token }, async () => {
      try {
        await options.run();
        if (flow.commandError !== undefined) throw new Error(flow.commandError);
        flow.state.status = "complete";
      } catch (error) {
        flow.state.status = "error";
        flow.state.error = userFacingErrorMessage(error, this.t).slice(0, MAX_TEXT);
      } finally {
        this.active.delete(flow.token);
        this.sessions.delete(ownerKey(flow.owner));
        flow.pending?.settle(undefined);
        clearTimeout(flow.timer);
        if (!this.disposed) {
          flow.timer = setTimeout(() => { this.flows.delete(flow.state.flowId); }, this.options.terminalTtlMs ?? 5 * 60_000);
          flow.timer.unref();
        }
      }
    });
    return this.snapshot(flow);
  }

  /** Public /mcp waits for startup; its status UI must never escape into chat. */
  async discover<T>(options: { owner: McpAuthFlowOwner; identity: object; isCurrent(): boolean; run(): Promise<T> }): Promise<T> {
    if (this.disposed) throw new UserFacingError("mcpAuth.disposed", "MCP authentication service is disposed");
    const owner = normalizeOwner(options.owner);
    const scope = execution.getStore();
    const own = scope?.service === this ? this.active.get(scope.token) : undefined;
    if (own && (own.identity !== options.identity || ownerKey(own.owner) !== ownerKey(owner) || !own.isCurrent())) throw new UserFacingError("mcpAuth.ownerChanged", "MCP authentication owner is no longer current");
    if (!own && this.sessions.size > 0) throw new UserFacingError("mcpAuth.machineBusyShort", "Another MCP authentication operation is running on this machine");
    const flow: Flow = own ?? {
      state: { flowId: randomUUID(), providerId: "mcp", providerName: this.t("mcpAuth.server", "MCP server"), status: "running", progress: [] },
      identity: options.identity, owner, token: Symbol(), isCurrent: () => options.isCurrent(),
    };
    if (!own) {
      this.active.set(flow.token, flow);
      this.sessions.set(ownerKey(flow.owner), flow);
    }
    try {
      return await execution.run({ service: this, token: flow.token, discovery: true }, async () => {
        const result = await options.run();
        if (flow.commandError !== undefined) throw new UserFacingError("mcpAuth.discoveryFailed", "MCP server discovery failed");
        return result;
      });
    } finally {
      if (!own) {
        this.active.delete(flow.token);
        this.sessions.delete(ownerKey(flow.owner));
      }
    }
  }

  assertSessionAvailable(owner: McpAuthFlowOwner): void {
    const active = this.sessions.get(ownerKey(owner));
    const scope = execution.getStore();
    if (active && (scope?.service !== this || scope.token !== active.token)) throw new UserFacingError("mcpAuth.sessionBusy", "MCP authentication operation is running for this session");
  }

  owner(flowId: string, scope: string): McpAuthFlowOwner {
    const flow = this.flows.get(flowId);
    if (flow?.owner.scope !== scope) throw new UserFacingError("mcpAuth.flowNotFound", "MCP authentication flow not found");
    return structuredClone(flow.owner);
  }

  get(flowId: string, owner: McpAuthFlowOwner): OAuthFlowState { return this.snapshot(this.requireFlow(flowId, owner)); }

  respond(flowId: string, requestId: string, value: string, owner: McpAuthFlowOwner): OAuthFlowState {
    const flow = this.requireFlow(flowId, owner);
    const pending = flow.pending;
    if (flow.state.status !== "running" || pending?.id !== requestId) throw new UserFacingError("mcpAuth.requestNotPending", "MCP authentication request is no longer pending");
    if (typeof value !== "string" || value.length > MAX_TEXT || (pending.values?.includes(value) === false)) throw new UserFacingError("mcpAuth.invalidResponse", "Invalid MCP authentication response");
    pending.settle(value);
    return this.snapshot(flow);
  }

  cancel(flowId: string, owner: McpAuthFlowOwner): OAuthFlowState {
    const flow = this.requireFlow(flowId, owner);
    if (flow.state.status === "running") this.requestCancel(flow);
    return this.snapshot(flow);
  }

  cancelSession(owner: McpAuthFlowOwner): void {
    const flow = this.sessions.get(ownerKey(owner));
    if (flow) this.requestCancel(flow);
  }

  dispose(): void {
    this.disposed = true;
    for (const flow of new Set([...this.flows.values(), ...this.active.values()])) {
      this.requestCancel(flow);
      clearTimeout(flow.timer);
    }
    this.flows.clear();
  }

  /** Invocation-time lookup: stale socket ancestry must use the ordinary bridge. */
  static current(identity?: object): McpAuthDispatcher | undefined {
    const scope = execution.getStore();
    const flow = scope?.service.active.get(scope.token);
    if (!scope || !flow || (identity !== undefined && identity !== flow.identity)) return undefined;
    const isCurrent = () => {
      if (scope.service.disposed || !flow.isCurrent()) {
        scope.service.requestCancel(flow);
        return false;
      }
      return true;
    };
    // An active command must retain its private sink even after its runtime is
    // closed; falling back to the ordinary bridge can expose late OAuth data.
    isCurrent();
    return new McpAuthDispatcher(scope.service, flow, scope.discovery === true, isCurrent, scope.service.t);
  }

  private requireFlow(id: string, owner: McpAuthFlowOwner): Flow {
    const flow = this.flows.get(id);
    if (!flow || ownerKey(flow.owner) !== ownerKey(owner)) throw new UserFacingError("mcpAuth.flowNotFound", "MCP authentication flow not found");
    return flow;
  }

  private snapshot(flow: Flow): OAuthFlowState { return structuredClone(flow.state); }

  private requestCancel(flow: Flow): void {
    flow.state.cancelRequested = true;
    flow.pending?.settle(undefined);
  }

  wait(flow: Flow, title: string, options: ExtensionUIDialogOptions | undefined, values?: string[], placeholder?: string): Promise<string | undefined> {
    if (flow.state.cancelRequested === true || options?.signal?.aborted === true) return Promise.resolve(undefined);
    if (flow.pending) return Promise.reject(new UserFacingError("mcpAuth.promptPending", "An MCP authentication request is already pending"));
    if (title.length > MAX_TEXT || (placeholder?.length ?? 0) > MAX_TEXT || (values && (values.length > 200 || values.some((value) => value.length > MAX_TEXT)))) return Promise.reject(new UserFacingError("mcpAuth.promptTooLarge", "MCP authentication prompt is too large"));
    const id = randomUUID();
    if (values) flow.state.select = { requestId: id, message: title, options: values.map((value) => ({ value, label: value })) };
    else flow.state.prompt = { requestId: id, message: title, promptType: "text", ...(placeholder === undefined ? {} : { placeholder }) };
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const settle = (value: string | undefined) => {
        if (flow.pending?.id !== id) return;
        clearTimeout(timer);
        options?.signal?.removeEventListener("abort", abort);
        delete flow.pending;
        delete flow.state.prompt;
        delete flow.state.select;
        resolve(value);
      };
      // Pi aborts the losing input when its browser callback wins. This only
      // dismisses the prompt; it is not cancellation of the auth operation.
      const abort = () => { settle(undefined); };
      flow.pending = { id, settle, ...(values === undefined ? {} : { values }) };
      if (options?.timeout !== undefined && options.timeout > 0) {
        timer = setTimeout(abort, options.timeout);
        timer.unref();
      }
      options?.signal?.addEventListener("abort", abort, { once: true });
      if (options?.signal?.aborted === true) abort();
    });
  }
}

/** Narrow adapter used by the stable session proxy and builtin openUrl hook. */
class McpAuthDispatcher {
  constructor(private readonly service: McpAuthFlowService, private readonly flow: Flow, private readonly discovery: boolean, private readonly isCurrent: () => boolean, private readonly t: Translator) {}
  selectServer(servers: McpAuthServerOption[]): Promise<string | undefined> {
    const result = this.select(this.t("mcpAuth.chooseServer", "Choose an MCP server"), servers.map((server) => server.name));
    if (this.flow.state.select) this.flow.state.select.options = servers.map((server) => ({ value: server.name, label: server.name, ...(server.description === undefined ? {} : { description: server.description }) }));
    return result;
  }
  setServer(name: string): void { if (this.isCurrent()) this.flow.state.providerName = name; }
  isCancelled(): boolean { return !this.isCurrent() || this.flow.state.cancelRequested === true; }
  notify(message: string): void {
    if (!this.isCurrent() || this.discovery) return;
    const url = this.flow.state.auth?.url;
    if (url !== undefined && message.includes(url)) return;
    this.flow.state.progress.push(message.slice(0, MAX_TEXT));
    this.flow.state.progress = this.flow.state.progress.slice(-MAX_PROGRESS);
  }
  openUrl(url: string): void {
    if (!this.isCurrent() || this.discovery) return;
    if (url.length > MAX_TEXT) throw new UserFacingError("mcpAuth.authUrlTooLarge", "MCP authorization URL is too large");
    let parsed: URL;
    try { parsed = new URL(url); }
    catch { throw new UserFacingError("mcpAuth.invalidAuthUrl", "Invalid MCP authorization URL"); }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new UserFacingError("mcpAuth.authUrlProtocol", "Unsupported MCP authorization URL");
    this.flow.state.auth = { url };
    this.flow.state.progress = this.flow.state.progress.filter((message) => !message.includes(url));
  }
  error(message: string): void { if (this.isCurrent()) { this.flow.commandError = message.slice(0, MAX_TEXT); this.notify(message); } }
  input(title: string, placeholder?: string, options?: ExtensionUIDialogOptions): Promise<string | undefined> {
    if (!this.isCurrent()) return Promise.resolve(undefined);
    if (this.discovery) { this.flow.commandError = "MCP discovery cannot request input"; return Promise.reject(new UserFacingError("mcpAuth.discoveryInput", "MCP discovery cannot request input")); }
    return this.service.wait(this.flow, title, options, undefined, placeholder);
  }
  select(title: string, values: string[], options?: ExtensionUIDialogOptions): Promise<string | undefined> {
    if (!this.isCurrent()) return Promise.resolve(undefined);
    if (this.discovery) { this.flow.commandError = "MCP discovery cannot request input"; return Promise.reject(new UserFacingError("mcpAuth.discoveryInput", "MCP discovery cannot request input")); }
    return this.service.wait(this.flow, title, options, values);
  }
  async confirm(title: string, message: string, options?: ExtensionUIDialogOptions): Promise<boolean> {
    const selected = this.select(`${title}\n${message}`, ["Yes", "No"], options);
    if (this.flow.state.select) this.flow.state.select.options = [
      { value: "Yes", label: this.t("mcpAuth.yes", "Yes") },
      { value: "No", label: this.t("mcpAuth.no", "No") },
    ];
    return await selected === "Yes";
  }
}
