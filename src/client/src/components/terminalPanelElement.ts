import { html, LitElement, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { Workspace } from "../api";
import "./TerminalPanel";

export const TERMINAL_PANEL_HOST_ELEMENT = "pi-web-terminal-host";

export interface TerminalPanelRenderInput {
  workspace: Workspace;
  machineId: string;
  selectedTerminalId: string | undefined;
  autoStart: boolean;
  onSelectTerminal: (terminalId: string | undefined, options?: { replace?: boolean | undefined }) => void;
}

/**
 * Host element the bundled terminal plugin renders.
 *
 * Plugin packages cannot import client internals, so the plugin emits this tag
 * and the host fills it with the existing Chinese `<terminal-panel>`.
 */
export interface TerminalPanelHostElement extends LitElement {
  panel: TerminalPanelRenderInput | undefined;
}

@customElement(TERMINAL_PANEL_HOST_ELEMENT)
export class TerminalPanelHost extends LitElement implements TerminalPanelHostElement {
  @property({ attribute: false }) panel: TerminalPanelRenderInput | undefined;

  override createRenderRoot(): HTMLElement {
    const root = super.createRenderRoot();
    if (root instanceof ShadowRoot) {
      const style = document.createElement("style");
      style.textContent = ":host { display: flex; flex: 1 1 auto; min-height: 0; }";
      root.append(style);
    }
    return root;
  }

  override render(): TemplateResult {
    const panel = this.panel;
    if (panel === undefined) return html``;
    return html`<terminal-panel .workspace=${panel.workspace} .machineId=${panel.machineId} .selectedTerminalId=${panel.selectedTerminalId} .autoStart=${panel.autoStart} .onSelectTerminal=${panel.onSelectTerminal}></terminal-panel>`;
  }
}
