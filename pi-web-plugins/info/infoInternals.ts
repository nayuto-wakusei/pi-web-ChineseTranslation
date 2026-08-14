// Implementation details of the bundled Info plugin.
//
// This file is NOT part of the plugin skeleton. If you copied the Info plugin
// as a starting point for your own plugin, replace everything here with your
// own content — the plugin contract (metadata and contribution definitions)
// lives in pi-web-plugin.ts.

import type { TemplateResult } from "lit";
import type { HtmlTemplateTag, MachineKind, PiWebComponentStatus, PiWebInstallationInfo, PiWebReleaseStatus, PiWebStatusResponse, PluginMachine, PluginRuntimeContext, Workspace, WorkspacePanelContext } from "@chainingintention/pi-web-cn/plugin-api";

export type ComponentHealth = "current" | "restart needed" | "unavailable";

export function componentHealth(component: PiWebComponentStatus): ComponentHealth {
  if (!component.available) return "unavailable";
  if (component.stale) return "restart needed";
  return "current";
}

function componentHealthLabel(health: ComponentHealth): string {
  if (health === "current") return "当前版本";
  if (health === "restart needed") return "需要重启";
  return "不可用";
}

function componentDisplayLabel(component: PiWebComponentStatus): string {
  if (component.component === "web") return "Web/界面";
  return "会话守护进程";
}

export function formatVersion(version: string | undefined): string {
  return version === undefined || version === "" ? "未知" : version;
}

export function installationLabel(installation: PiWebInstallationInfo | undefined): string {
  if (installation === undefined) return "安装方式未知";
  if (installation.kind === "pi-package") {
    const scope = installation.scope === undefined ? "" : ` · ${installationScopeLabel(installation.scope)}`;
    const source = installation.source ?? "Pi 包";
    return `${source}${scope}`;
  }
  if (installation.kind === "npm-global") return "全局 npm 包";
  if (installation.kind === "local") return "本地检出";
  if (installation.kind === "docker") return installation.dockerMode === "dev" ? "Docker 开发运行时" : "Docker 运行时";
  return "安装方式未知";
}

function installationScopeLabel(scope: "user" | "project"): string {
  return scope === "user" ? "用户范围" : "项目范围";
}

export function machineKindLabel(kind: MachineKind): string {
  return kind === "local" ? "本地机器" : "远程机器";
}

export function releaseSummary(release: PiWebReleaseStatus): string {
  if (release.updateAvailable) {
    return release.latestVersion === undefined || release.latestVersion === ""
      ? "有可用更新"
      : `有可用更新：${release.latestVersion}`;
  }
  if (release.error !== undefined && release.error !== "") return `更新检查失败：${release.error}`;
  if (release.skipped === true) return "已跳过更新检查";
  return "已是最新版本";
}

/** One-line component summary used by the panel rows and the clipboard diagnostics. */
export function componentDetails(component: PiWebComponentStatus): string {
  const parts = [
    `运行版本 ${formatVersion(component.runtimeVersion)}`,
    `安装版本 ${formatVersion(component.installedVersion)}`,
    componentHealthLabel(componentHealth(component)),
    installationLabel(component.installation),
  ];
  if (component.installation?.path !== undefined && component.installation.path !== "") parts.push(component.installation.path);
  if (component.error !== undefined && component.error !== "") parts.push(`错误：${component.error}`);
  return parts.join(" · ");
}

export function workspaceFlags(workspace: Workspace): string[] {
  return [
    workspace.branch === undefined || workspace.branch === "" ? undefined : `分支 ${workspace.branch}`,
    workspace.isGitWorktree === true ? "Git 工作树" : workspace.isGitRepo === true ? "Git 仓库" : "非 Git 仓库",
    workspace.isMain ? "主工作区" : undefined,
  ].filter((flag): flag is string => flag !== undefined);
}

export interface DiagnosticsInput {
  status: PiWebStatusResponse | undefined;
  machine?: PluginMachine | undefined;
  workspace?: Workspace | undefined;
}

/** Plain-text status block suitable for pasting into a bug report. */
export function diagnosticsSummary({ status, machine, workspace }: DiagnosticsInput): string {
  const lines: string[] = ["PI WEB 诊断信息"];
  if (status === undefined) {
    lines.push("状态：不可用");
  } else {
    lines.push(`包：${status.packageName}`);
    lines.push(`${componentDisplayLabel(status.components.web)}：${componentDetails(status.components.web)}`);
    lines.push(`${componentDisplayLabel(status.components.sessiond)}：${componentDetails(status.components.sessiond)}`);
    const checked = status.release.checkedAt === undefined || status.release.skipped === true ? "" : `（检查于 ${status.release.checkedAt}）`;
    lines.push(`发布状态：${releaseSummary(status.release)}${checked}`);
    lines.push(`状态生成时间：${status.generatedAt}`);
  }
  if (machine !== undefined) lines.push(`机器：${machine.name}（${machineKindLabel(machine.kind)}）`);
  if (workspace === undefined) {
    lines.push("工作区：未选择");
  } else {
    lines.push(`工作区：${workspace.label} - ${workspace.path}（${workspaceFlags(workspace).join("、")}）`);
  }
  return lines.join("\n");
}

/** Action body: copy the diagnostics summary for the current runtime context. */
export async function copyDiagnostics(context: PluginRuntimeContext): Promise<void> {
  const summary = diagnosticsSummary({
    status: context.state.piWebStatus,
    machine: context.state.selectedMachine,
    workspace: context.state.selectedWorkspace,
  });
  await navigator.clipboard.writeText(summary);
}

function renderComponent(html: HtmlTemplateTag, component: PiWebComponentStatus): TemplateResult {
  const health = componentHealth(component);
  return html`
    <div class="info-component">
      <strong>${componentDisplayLabel(component)}</strong>
      <span class=${health === "current" ? "info-health-ok" : "info-health-attention"}>${componentHealthLabel(health)}</span>
      <small>${componentDetails(component)}</small>
    </div>
  `;
}

function renderStatusSection(html: HtmlTemplateTag, status: PiWebStatusResponse | undefined): TemplateResult {
  if (status === undefined) {
    return html`
      <section>
        <strong>PI WEB</strong>
        <p class="muted">PI WEB 状态暂不可用，后台会自动刷新。</p>
      </section>
    `;
  }
  const web = status.components.web;
  const messageCount = status.messages.length;
  return html`
    <section>
      <strong>PI WEB</strong>
      <div class="info-row">
        <span>版本</span>
        <span>${formatVersion(web.runtimeVersion)}</span>
        ${web.installedVersion === undefined || web.installedVersion === web.runtimeVersion ? null : html`<small>已安装 ${formatVersion(web.installedVersion)}</small>`}
      </div>
      <div class="info-row">
        <span>包</span>
        <span>${status.packageName}</span>
      </div>
      <div class="info-row">
        <span>安装方式</span>
        <span>${installationLabel(web.installation)}</span>
        ${web.installation?.path === undefined || web.installation.path === "" ? null : html`<small>${web.installation.path}</small>`}
      </div>
      <div class="info-row">
        <span>发布状态</span>
        <span>${releaseSummary(status.release)}</span>
        ${status.release.checkedAt === undefined || status.release.skipped === true ? null : html`<small>检查于 ${status.release.checkedAt}</small>`}
      </div>
      ${messageCount === 0 ? null : html`<p class="muted">${String(messageCount)} 条状态消息，请打开“更新”标签页查看详情。</p>`}
      <p class="muted">状态生成于 ${status.generatedAt}</p>
    </section>
    <section>
      <strong>服务</strong>
      ${renderComponent(html, status.components.web)}
      ${renderComponent(html, status.components.sessiond)}
    </section>
  `;
}

function renderMachineSection(html: HtmlTemplateTag, machine: PluginMachine): TemplateResult {
  return html`
    <section>
      <strong>机器</strong>
      <div class="info-row">
        <span>名称</span>
        <span>${machine.name}</span>
      </div>
      <div class="info-row">
        <span>类型</span>
        <span>${machineKindLabel(machine.kind)}</span>
      </div>
    </section>
  `;
}

function renderWorkspaceSection(html: HtmlTemplateTag, workspace: Workspace): TemplateResult {
  return html`
    <section>
      <strong>工作区</strong>
      <div class="info-row">
        <span>名称</span>
        <span>${workspace.label}</span>
      </div>
      <div class="info-row">
        <span>路径</span>
        <span class="info-path">${workspace.path}</span>
        ${workspaceFlags(workspace).length === 0 ? null : html`<small>${workspaceFlags(workspace).join(" · ")}</small>`}
      </div>
    </section>
  `;
}

/** Panel body: render the Info tab for the current workspace panel context. */
export function renderInfoPanel(html: HtmlTemplateTag, context: WorkspacePanelContext): TemplateResult {
  return html`
    <style>
      .viewer.info-status { flex: 1 1 auto; min-height: 0; box-sizing: border-box; display: flex; flex-direction: column; gap: 14px; padding: 12px; overflow-y: auto; overflow-x: hidden; }
      .viewer.info-status section { flex: 0 0 auto; min-width: 0; display: grid; gap: 8px; align-content: start; }
      .viewer.info-status p { margin: 0; }
      .info-row { display: grid; grid-template-columns: minmax(90px, auto) minmax(0, 1fr); gap: 3px 10px; border-bottom: 1px solid var(--pi-border-muted); padding: 6px 0; overflow-wrap: anywhere; }
      .info-row small { grid-column: 1 / -1; color: var(--pi-muted); }
      .info-component { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 3px 10px; border-bottom: 1px solid var(--pi-border-muted); padding: 6px 0; }
      .info-component small { grid-column: 1 / -1; color: var(--pi-muted); overflow-wrap: anywhere; }
      .info-health-ok { color: var(--pi-success); }
      .info-health-attention { color: var(--pi-warning); }
    </style>
    <section class="toolbar"><strong>信息</strong></section>
    <section class="viewer info-status">
      ${renderStatusSection(html, context.state?.piWebStatus)}
      ${renderMachineSection(html, context.machine)}
      ${renderWorkspaceSection(html, context.workspace)}
    </section>
  `;
}
