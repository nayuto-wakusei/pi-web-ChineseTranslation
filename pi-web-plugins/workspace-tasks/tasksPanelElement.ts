import { t } from "./i18n.js";
import type { StylesheetIntegrationCapabilityV1, WorkspacePanelContext } from "@chainingintention/pi-web-cn/plugin-api";
import { TASKS_CONFIG_PATH, type WorkspaceTask } from "./config.js";
import { runWorkspaceTaskInTerminal } from "./taskRunner.js";
import { loadWorkspaceTasksConfig, tasksConfigRefreshHint, tasksConfigUnavailableMessage, type WorkspaceTasksConfigLoadResult } from "./workspaceTasksClient.js";

export const tasksPanelTagName = "pi-web-workspace-tasks-panel";

const configChangedEvent = "pi-web-workspace-tasks-config-changed";

type ConfigState =
  | { kind: "loading" }
  | WorkspaceTasksConfigLoadResult;

interface TaskStatus {
  kind: "info" | "success" | "error";
  message: string;
  detail?: string;
}

const configCache = new Map<string, ConfigState>();

export function defineTasksPanelElement(): void {
  if (!customElements.get(tasksPanelTagName)) customElements.define(tasksPanelTagName, PiWebTasksPanel);
}

export function tasksPanelBadge(context: WorkspacePanelContext): string | undefined {
  const state = getCachedWorkspaceConfig(context);
  return state?.kind === "unavailable" ? "!" : undefined;
}

export class PiWebTasksPanel extends HTMLElement {
  private integration: StylesheetIntegrationCapabilityV1 | undefined;
  private releaseStyles: (() => void) | undefined;

  set stylesheetIntegration(value: StylesheetIntegrationCapabilityV1 | undefined) {
    if (value === this.integration) return;
    this.releaseStyles?.();
    this.releaseStyles = undefined;
    this.integration = value;
    if (this.isConnected) this.releaseStyles = value?.registerRoot(this.root, { sharedUi: true });
  }

  private contextValue: WorkspacePanelContext | undefined;
  private runningTaskId: string | undefined;
  private status: TaskStatus | undefined;
  private readonly root: ShadowRoot;
  private readonly localStyle = document.createElement("style");
  private readonly onConfigChanged = () => {
    this.render();
  };

  constructor() {
    super();
    this.root = this.attachShadow({ mode: "open" });
    this.localStyle.textContent = taskStyles();
    this.root.append(this.localStyle);
  }

  private setContent(markup: string): void {
    const template = document.createElement("template");
    template.innerHTML = markup;
    this.root.replaceChildren(this.localStyle, template.content);
  }

  set context(value: WorkspacePanelContext | undefined) {
    const previousKey = this.contextValue === undefined ? undefined : cacheKeyForContext(this.contextValue);
    const nextKey = value === undefined ? undefined : cacheKeyForContext(value);
    this.contextValue = value;
    // Parent app updates should not rebuild this shadow DOM for the same workspace:
    // doing so resets the mobile scroll position and can replace buttons mid-click.
    if (previousKey === nextKey) return;
    this.runningTaskId = undefined;
    this.status = undefined;
    this.render();
  }

  connectedCallback(): void {
    this.releaseStyles ??= this.integration?.registerRoot(this.root, { sharedUi: true });
    window.addEventListener(configChangedEvent, this.onConfigChanged);
    this.render();
  }

  disconnectedCallback(): void {
    this.releaseStyles?.();
    this.releaseStyles = undefined;
    window.removeEventListener(configChangedEvent, this.onConfigChanged);
  }

  private render(): void {
    const context = this.contextValue;
    if (context === undefined) {
      this.setContent(`<section class="empty">${escapeHtml(t("bundled.workspace-tasks.select.a.workspace.95796d", "Select a workspace."))}</section>`);
      return;
    }

    const state = getOrLoadWorkspaceConfig(context);
    this.setContent(`

      <section class="toolbar ui-toolbar">
        <strong class="ui-toolbar-title toolbar-title">${escapeHtml(t("bundled.workspace-tasks.workspace.tasks.b4ef49", "Workspace tasks"))}</strong>
        <span class="ui-toolbar-group">
          <button type="button" class="ui-button" data-refresh-config ${state.kind === "loading" ? "disabled" : ""}>${escapeHtml(t("bundled.workspace-tasks.refresh.aee887", "Refresh"))}</button>
          <button type="button" class="ui-button" data-open-terminal>${escapeHtml(t("bundled.workspace-tasks.open.terminal.b89a0e", "Open terminal"))}</button>
        </span>
      </section>
      ${this.renderStatus()}
      <section class="viewer tasks-viewer">
        ${this.renderConfigState(state)}
      </section>
    `);

    this.root.querySelector("button[data-refresh-config]")?.addEventListener("click", () => {
      void this.refreshConfig(context);
    });

    for (const button of this.root.querySelectorAll("button[data-task-id]")) {
      button.addEventListener("click", () => {
        void this.dispatchTaskById(context, button.getAttribute("data-task-id"));
      });
    }

    this.root.querySelector("button[data-open-terminal]")?.addEventListener("click", () => {
      this.openWorkspaceTerminal();
    });
  }

  private dispatchTaskById(context: WorkspacePanelContext, taskId: string | null): Promise<void> {
    if (!this.isCurrentContext(context)) return Promise.resolve();
    const task = taskFromConfigState(getCachedWorkspaceConfig(context), taskId);
    if (task === undefined) {
      this.status = { kind: "error", message: t("bundled.workspace-tasks.this.task.is.no.longer.available.click.refresh.and.try.again.158c41", "This task is no longer available. Click Refresh and try again.") };
      this.render();
      return Promise.resolve();
    }
    return this.dispatchTask(context, task);
  }

  private isCurrentContext(context: WorkspacePanelContext): boolean {
    return this.contextValue !== undefined && cacheKeyForContext(this.contextValue) === cacheKeyForContext(context);
  }

  private renderConfigState(state: ConfigState): string {
    if (state.kind === "loading") return `<p class="muted">${escapeHtml(t("bundled.workspace-tasks.loading.9f624f", "Loading {value1}...", { value1: TASKS_CONFIG_PATH }))}</p>`;
    if (state.kind === "missing") return renderMissingState(state);
    if (state.kind === "unavailable") return renderUnavailableState(state);

    if (state.config.tasks.length === 0) return `<p class="muted">${escapeHtml(t("bundled.workspace-tasks.no.tasks.defined.in.add.tasks.to.the.file.then.click.refresh.3af272", "No tasks defined in {value1}. Add tasks to the file, then click Refresh.", { value1: state.path }))}</p>`;
    return `
      <p class="muted">${escapeHtml(t("bundled.workspace-tasks.tasks.run.in.a.dedicated.workspace.terminal.and.switch.to.it.edit.3188f4", "Tasks run in a dedicated workspace terminal and switch to it. Edit {value1}, then click Refresh to reload.", { value1: state.path }))}</p>
      ${renderTaskGroups(state.config.tasks, this.runningTaskId)}
    `;
  }

  private renderStatus(): string {
    if (this.status === undefined) return "";
    const detail = this.status.detail === undefined ? "" : `<pre>${escapeHtml(this.status.detail)}</pre>`;
    return `<div class="status panel-status ${escapeAttr(this.status.kind)}">${escapeHtml(this.status.message)}${detail}</div>`;
  }

  private async refreshConfig(context: WorkspacePanelContext): Promise<void> {
    this.status = { kind: "info", message: t("bundled.workspace-tasks.refreshing.b85709", "Refreshing {value1}...", { value1: TASKS_CONFIG_PATH }) };
    configCache.set(cacheKeyForContext(context), { kind: "loading" });
    this.render();

    const state = await refreshWorkspaceConfig(context);
    if (!this.isCurrentContext(context)) return;
    this.status = state.kind === "loaded"
      ? { kind: "success", message: t("bundled.workspace-tasks.loaded.tasks.cc36a1", "Loaded {value1} tasks.", { value1: String(state.config.tasks.length) }) }
      : undefined;
    this.render();
  }

  private async dispatchTask(context: WorkspacePanelContext, task: WorkspaceTask): Promise<void> {
    if (this.runningTaskId !== undefined) {
      this.status = { kind: "info", message: t("bundled.workspace-tasks.another.task.is.starting.wait.for.dispatch.to.finish.and.try.agai.e4971f", "Another task is starting. Wait for dispatch to finish and try again.") };
      this.render();
      return;
    }
    if (task.confirm && !window.confirm(t("bundled.workspace-tasks.run.e5ba41", "Run {value1}?\n\n{value2}", { value1: task.title, value2: task.command }))) {
      this.status = { kind: "info", message: t("bundled.workspace-tasks.cancelled.1a65c2", "Cancelled {value1}.", { value1: task.title }) };
      this.render();
      return;
    }

    this.runningTaskId = task.id;
    this.status = { kind: "info", message: t("bundled.workspace-tasks.starting.80ae5c", "Starting {value1}...", { value1: task.title }) };
    this.render();

    try {
      const handle = await runWorkspaceTaskInTerminal(context.terminal, task);
      if (!this.isCurrentContext(context)) return;
      this.status = {
        kind: "success",
        message: t("bundled.workspace-tasks.started.terminal.command.318e6c", "Started terminal command \"{value1}\".", { value1: handle.run.title }),
        detail: task.command,
      };
      this.runningTaskId = undefined;
      this.render();
    } catch (error) {
      if (!this.isCurrentContext(context)) return;
      this.runningTaskId = undefined;
      this.status = { kind: "error", message: error instanceof Error ? error.message : String(error) };
      this.render();
    }
  }

  private openWorkspaceTerminal(terminalId?: string): void {
    const context = this.contextValue;
    if (context === undefined) {
      this.status = { kind: "error", message: t("bundled.workspace-tasks.select.a.workspace.before.opening.a.terminal.1f87b4", "Select a workspace before opening a terminal.") };
      this.render();
      return;
    }
    if (terminalId === undefined) context.terminal.open();
    else context.terminal.open({ terminalId });
  }
}

function getCachedWorkspaceConfig(context: WorkspacePanelContext): ConfigState | undefined {
  return configCache.get(cacheKeyForContext(context));
}

function getOrLoadWorkspaceConfig(context: WorkspacePanelContext): ConfigState {
  const cached = getCachedWorkspaceConfig(context);
  if (cached !== undefined) return cached;

  const loading: ConfigState = { kind: "loading" };
  configCache.set(cacheKeyForContext(context), loading);
  void refreshWorkspaceConfig(context);
  return loading;
}

async function refreshWorkspaceConfig(context: WorkspacePanelContext): Promise<ConfigState> {
  const key = cacheKeyForContext(context);
  const state = await loadWorkspaceTasksConfig(context.files).catch((error: unknown): ConfigState => ({
    kind: "unavailable",
    message: tasksConfigUnavailableMessage(),
    hint: tasksConfigRefreshHint(),
    detail: error instanceof Error ? error.message : String(error),
  }));
  configCache.set(key, state);
  context.host.requestRender();
  window.dispatchEvent(new Event(configChangedEvent));
  return state;
}

function cacheKeyForContext(context: WorkspacePanelContext): string {
  return `${context.machine.id}:${context.workspace.projectId}:${context.workspace.id}`;
}

function renderMissingState(state: Extract<ConfigState, { kind: "missing" }>): string {
  return `<div class="empty-state"><strong class="ui-toolbar-title toolbar-title">${escapeHtml(state.message)}</strong><p>${escapeHtml(state.hint)}</p></div>`;
}

function renderUnavailableState(state: Extract<ConfigState, { kind: "unavailable" }>): string {
  const detail = state.detail === undefined ? "" : `<pre>${escapeHtml(state.detail)}</pre>`;
  return `<div class="status error"><strong class="ui-toolbar-title toolbar-title">${escapeHtml(state.message)}</strong><p>${escapeHtml(state.hint)}</p>${detail}</div>`;
}

function renderTaskGroups(tasks: WorkspaceTask[], runningTaskId: string | undefined): string {
  return `<div class="tasks">${groupTasks(tasks).map((group) => renderTaskGroup(group, runningTaskId)).join("")}</div>`;
}

function groupTasks(tasks: WorkspaceTask[]): { title: string | undefined; tasks: WorkspaceTask[] }[] {
  const groups: { title: string | undefined; tasks: WorkspaceTask[] }[] = [];
  for (const task of tasks) {
    const title = task.group;
    let group = groups.find((candidate) => candidate.title === title);
    if (group === undefined) {
      group = { title, tasks: [] };
      groups.push(group);
    }
    group.tasks.push(task);
  }
  return groups;
}

function renderTaskGroup(group: { title: string | undefined; tasks: WorkspaceTask[] }, runningTaskId: string | undefined): string {
  const title = group.title === undefined ? "" : `<h3>${escapeHtml(group.title)}</h3>`;
  return `<section class="task-group">${title}${group.tasks.map((task) => renderTask(task, runningTaskId)).join("")}</section>`;
}

function renderTask(task: WorkspaceTask, runningTaskId: string | undefined): string {
  const running = runningTaskId === task.id;
  const disabled = runningTaskId !== undefined;
  const description = task.description === undefined ? "" : `<span>${escapeHtml(task.description)}</span>`;
  return `
    <article class="task-card">
      <div class="task-copy">
        <strong class="ui-toolbar-title toolbar-title">${escapeHtml(task.title)}</strong>
        ${description}
        <code>${escapeHtml(task.command)}</code>
      </div>
      <button type="button" class="ui-button ui-button--primary" data-task-id="${escapeAttr(task.id)}" ${disabled ? "disabled" : ""}>${escapeHtml(running ? t("bundled.workspace-tasks.dispatching.f0ad17", "Dispatching...") : t("bundled.workspace-tasks.run.75b269", "Run"))}</button>
    </article>
  `;
}

function taskFromConfigState(state: ConfigState | undefined, taskId: string | null): WorkspaceTask | undefined {
  if (state?.kind !== "loaded" || taskId === null) return undefined;
  return state.config.tasks.find((task) => task.id === taskId);
}

function taskStyles(): string {
  return `
      :host { display: contents; }
      .toolbar { border-bottom: 1px solid var(--pi-border-muted); }
      .toolbar-title { padding-inline: 10px; }
      .viewer { box-sizing: border-box; min-height: 0; overflow: auto; padding: 12px; }
      .tasks-viewer { display: grid; align-content: start; gap: 12px; }
      .tasks { display: grid; gap: 14px; }
      .task-group { display: grid; gap: 10px; }
      .task-group h3 { margin: 4px 0 0; color: var(--pi-text-secondary); font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em; }
      .task-card { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: center; border: 1px solid var(--pi-border); border-radius: 10px; background: var(--pi-surface); padding: 12px; }
      .task-copy { display: grid; min-width: 0; gap: 5px; }
      .task-copy span, .muted { color: var(--pi-muted); }
      code, pre { border: 1px solid var(--pi-border-muted); border-radius: 6px; background: var(--pi-bg); color: var(--pi-text-secondary); font: 12px var(--pi-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); }
      code { overflow: auto; padding: 5px 7px; white-space: nowrap; }
      pre { margin: 8px 0 0; overflow: auto; padding: 8px; white-space: pre-wrap; }
      .empty-state { border: 1px dashed var(--pi-border-muted); border-radius: 8px; color: var(--pi-muted); padding: 12px; }
      .empty-state p { margin: 6px 0 0; }
      .panel-status { margin: 12px 12px 0; }
      .status { border: 1px solid var(--pi-border); border-radius: 8px; padding: 10px; }
      .status.info { border-color: var(--pi-accent-border); background: var(--pi-bg-overlay-soft); }
      .status.success { border-color: var(--pi-success-border); background: var(--pi-success-surface); color: var(--pi-success); }
      .status.error { border-color: var(--pi-danger); color: var(--pi-danger); }
      .empty { padding: 16px; color: var(--pi-muted); }
      @media (max-width: 760px) {
        .task-card { grid-template-columns: 1fr; }
        .task-card button { justify-self: start; }
      }
  `;
}

function escapeHtml(value: unknown): string {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttr(value: unknown): string {
  return escapeHtml(value).replaceAll('"', "&quot;");
}
