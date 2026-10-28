import type { PluginLocalization } from "@chainingintention/pi-web-cn/plugin-api";
import type { ReactiveController, ReactiveControllerHost } from "lit";
import definitions from "./files.messages";

export function createFilesContent(localization: PluginLocalization) {
  return { localization, messages: localization.registerMessages("files", definitions) };
}

export type FilesContent = ReturnType<typeof createFilesContent>;

/** Portable elements follow the localization owner passed by their current activation. */
export class FilesLocalizationController implements ReactiveController {
  private current: FilesContent | undefined;
  private connected = false;
  private unsubscribe: (() => void) | undefined;

  constructor(private readonly host: ReactiveControllerHost) { host.addController(this); }

  get content(): FilesContent | undefined { return this.current; }
  set content(value: FilesContent | undefined) {
    if (value === this.current) return;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.current = value;
    this.subscribe();
    this.host.requestUpdate();
  }

  get messages(): FilesContent["messages"] {
    if (this.current === undefined) throw new Error("Files localization is unavailable");
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

export function formatFileSize(size: number, content: FilesContent): string {
  const safe = Number.isFinite(size) && size >= 0 ? size : 0;
  const exponent = Math.min(3, Math.floor(Math.log2(Math.max(1, safe)) / 10));
  const value = safe / 1024 ** exponent;
  const unit = ["byte", "kilobyte", "megabyte", "gigabyte"][exponent];
  const digits = exponent > 0 && value < 10 ? 1 : 0;
  return content.localization.number(value, { style: "unit", unit, unitDisplay: "short", minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatPercent(value: number, content: FilesContent): string {
  return content.localization.number(Math.max(0, Math.min(1, value)), { style: "percent", maximumFractionDigits: 0 });
}
