import type { JsonObject, JsonValue, PluginPeer, PluginRuntimeContextV5, Translator } from "@chainingintention/pi-web-cn/plugin-api";

type DialogContext = Pick<PluginRuntimeContextV5, "state" | "catalog" | "navigate">;

/** Plugin-owned UI; all machine operations go through the captured public backend. */
export function openWorktreeDialog(context: DialogContext, peer: PluginPeer, onClose: () => void, translate: Translator = (_key, fallback, parameters = {}) => fallback.replace(/\{([a-zA-Z]+)\}/gu, (placeholder: string, key: string) => String(parameters[key] ?? placeholder))): () => void {
  const machineId = context.catalog.machineId;
  const project = context.state.selectedProject;
  if (!project) throw new Error(translate("bundled.workflows.project.required", "Select a project first."));
  if (!peer.request) throw new Error(translate("bundled.workflows.backend.required", "Workflows backend does not support requests."));
  const request = peer.request.bind(peer);
  const previousFocus = document.activeElement;
  const host = document.createElement("div");
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      dialog { color:var(--pi-text, #eee); background:var(--pi-bg, #202124); border:1px solid var(--pi-border, #666); border-radius:8px; padding:24px; width:min(480px, calc(100vw - 64px)); font:14px system-ui; }
      dialog::backdrop { background:rgb(0 0 0 / .55); }
      h2 { margin-top:0; font-size:20px; } p { line-height:1.5; overflow-wrap:anywhere; }
      label { display:block; margin:16px 0 6px; font-weight:600; }
      input, textarea { box-sizing:border-box; width:100%; padding:10px; font:inherit; color:inherit; background:var(--pi-bg, #202124); border:1px solid var(--pi-border, #888); border-radius:6px; }
      textarea { resize:vertical; min-height:100px; } button { font:inherit; padding:8px 14px; cursor:pointer; border-radius:6px; }
      button:disabled { cursor:default; opacity:.6; } footer { display:flex; justify-content:flex-end; gap:10px; margin-top:20px; }
      [role=alert] { color:var(--pi-error, #ffaaaa); } small { display:block; margin-top:6px; line-height:1.5; }
    </style>
    <dialog aria-labelledby="title" aria-describedby="target">
      <h2 id="title">Create worktree</h2>
      <p id="target"></p>
      <p id="status" role="status">Loading branches…</p>
      <form>
        <label for="base">Base branch</label>
        <input id="base" name="base" list="branches" required maxlength="512" disabled>
        <datalist id="branches"></datalist>
        <small id="base-help">Choose a local or remote branch. HEAD uses the main workspace’s current commit.</small>
        <label for="description">Purpose or description</label>
        <textarea id="description" name="description" required maxlength="8000" disabled aria-describedby="description-help"></textarea>
        <small id="description-help">The agent uses this to name the branch and worktree.</small>
        <p id="error" role="alert" hidden></p>
        <footer><button type="button" id="cancel">Cancel</button><button type="submit" disabled>Create worktree</button></footer>
      </form>
    </dialog>`;
  function element<T extends Element>(selector: string, constructor: new () => T): T {
    const value = root.querySelector(selector);
    if (!(value instanceof constructor)) throw new Error(`Missing Workflows control: ${selector}`);
    return value;
  }
  const dialog = element("dialog", HTMLDialogElement);
  const form = element("form", HTMLFormElement);
  const base = element("#base", HTMLInputElement);
  const description = element("#description", HTMLTextAreaElement);
  const submit = element("button[type=submit]", HTMLButtonElement);
  const cancel = element("#cancel", HTMLButtonElement);
  const status = element("#status", HTMLParagraphElement);
  const error = element("#error", HTMLParagraphElement);
  element("#title", HTMLHeadingElement).textContent = translate("bundled.workflows.dialog.title", "Create worktree");
  element('label[for="base"]', HTMLLabelElement).textContent = translate("bundled.workflows.base", "Base branch");
  element('label[for="description"]', HTMLLabelElement).textContent = translate("bundled.workflows.purpose", "Purpose or description");
  element("#base-help", HTMLElement).textContent = translate("bundled.workflows.base.help", "Choose a local or remote branch. HEAD uses the main workspace's current commit.");
  element("#description-help", HTMLElement).textContent = translate("bundled.workflows.purpose.help", "The agent uses this to name the branch and worktree.");
  status.textContent = translate("bundled.workflows.loading", "Loading branches...");
  cancel.textContent = translate("bundled.workflows.cancel", "Cancel");
  submit.textContent = translate("bundled.workflows.dialog.title", "Create worktree");
  const controller = new AbortController();
  let dispatching = false;
  let dispatched: { workspaceId: string; sessionId: string } | undefined;
  element("#target", HTMLParagraphElement).textContent = translate("bundled.workflows.target", "Project: {project}. Starts a new conversation in its main workspace; your current conversation and draft stay unchanged.", { project: project.name });
  base.setAttribute("aria-describedby", "base-help");
  function close() {
    if (controller.signal.aborted) return;
    controller.abort();
    host.remove();
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    onClose();
  }
  function showError(message: string) { error.textContent = message; error.hidden = false; }
  cancel.addEventListener("click", close);
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); if (!dispatching) close(); });
  dialog.addEventListener("close", close);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (submit.disabled || controller.signal.aborted || dispatching) return;
    if (!description.value.trim() || !base.value.trim()) { showError(translate("bundled.workflows.input.required", "Enter a base branch and a purpose or description.")); return; }
    dispatching = true;
    submit.disabled = true;
    cancel.disabled = true;
    base.disabled = true;
    description.disabled = true;
    error.hidden = true;
    status.textContent = translate("bundled.workflows.starting", "Starting a new conversation...");
    void (async () => {
      try {
        const result = object(await request("dispatch", { base: base.value.trim(), description: description.value.trim() }, { signal: controller.signal }), translate);
        dispatched = { workspaceId: text(result["workspaceId"], translate), sessionId: text(result["sessionId"], translate) };
        if (controller.signal.aborted) return;
        status.textContent = translate("bundled.workflows.opening", "Conversation started. Opening it...");
        await context.navigate({ machineId, projectId: project.id, workspaceId: dispatched.workspaceId, sessionId: dispatched.sessionId, view: "chat" });
        close();
      } catch (cause) {
        if (controller.signal.aborted) return;
        status.textContent = dispatched
          ? translate("bundled.workflows.started", "Conversation started.")
          : translate("bundled.workflows.uncertain", "Dispatch could not be confirmed.");
        const recovery = dispatched
          ? translate("bundled.workflows.recover.session", "Open conversation {sessionId} in Sessions.", { sessionId: dispatched.sessionId })
          : translate("bundled.workflows.recover.uncertain", "Check Sessions before trying again; a conversation may already have started.");
        showError(`${message(cause)} ${recovery}`);
        // Do not retry an uncertain submission automatically or from this dialog.
        cancel.textContent = translate("bundled.workflows.close", "Close");
      } finally { dispatching = false; cancel.disabled = false; }
    })();
  });
  document.body.append(host);
  dialog.showModal();
  void (async () => {
    try {
      const result = object(await request("prepare", null, { signal: controller.signal }), translate);
      const branches = result["branches"];
      if (!Array.isArray(branches) || !branches.every((branch) => typeof branch === "string")) throw new Error(translate("bundled.workflows.branches.invalid", "Invalid branch list from Workflows."));
      const defaultBase = text(result["defaultBase"], translate);
      const workspacePath = text(result["workspacePath"], translate);
      text(result["workspaceId"], translate);
      if (controller.signal.aborted) return;
      const options = branches.map((branch) => { const option = document.createElement("option"); option.value = branch; return option; });
      element("#branches", HTMLDataListElement).replaceChildren(...options);
      base.value = defaultBase;
      base.disabled = false;
      description.disabled = false;
      submit.disabled = false;
      status.textContent = translate("bundled.workflows.main.workspace", "Main workspace: {path}", { path: workspacePath });
      description.focus();
    } catch (cause) {
      if (controller.signal.aborted) return;
      status.textContent = translate("bundled.workflows.prepare.failed", "Could not load worktree options.");
      showError(message(cause));
    }
  })();
  return close;
}

function isObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function object(value: JsonValue, translate: Translator): JsonObject {
  if (!isObject(value)) throw new Error(translate("bundled.workflows.response.invalid", "Invalid response from Workflows."));
  return value;
}
function text(value: JsonValue | undefined, translate: Translator): string {
  if (typeof value !== "string" || value === "") throw new Error(translate("bundled.workflows.response.invalid", "Invalid response from Workflows."));
  return value;
}
function message(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause); }
