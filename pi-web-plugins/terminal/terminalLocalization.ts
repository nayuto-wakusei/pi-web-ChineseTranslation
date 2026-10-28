import type { PluginLocalization } from "@chainingintention/pi-web-cn/plugin-api";
import type { ReactiveController, ReactiveControllerHost } from "lit";
import definitions from "./terminal.messages";

export function createTerminalContent(localization: PluginLocalization) {
  return { localization, messages: localization.registerMessages("terminal", definitions) };
}

export type TerminalContent = ReturnType<typeof createTerminalContent>;

/** Elements can be reused across portable activations; observers follow the current owner. */
export class TerminalLocalizationController implements ReactiveController {
  private current: TerminalContent | undefined;
  private connected = false;
  private unsubscribe: (() => void) | undefined;

  constructor(private readonly host: ReactiveControllerHost) { host.addController(this); }

  get content(): TerminalContent | undefined { return this.current; }
  set content(value: TerminalContent | undefined) {
    if (value === this.current) return;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.current = value;
    this.subscribe();
    this.host.requestUpdate();
  }

  get messages(): TerminalContent["messages"] {
    if (this.current === undefined) throw new Error("Terminal localization is unavailable");
    return this.current.messages;
  }

  hostConnected(): void { this.connected = true; this.subscribe(); }
  hostDisconnected(): void {
    this.connected = false;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  private subscribe(): void {
    if (this.connected && this.unsubscribe === undefined) {
      this.unsubscribe = this.current?.localization.subscribe(() => { this.host.requestUpdate(); });
    }
  }
}
