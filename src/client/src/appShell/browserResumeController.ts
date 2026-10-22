import { TrailingRefreshCoordinator } from "../controllers/trailingRefreshCoordinator";

interface BrowserEventTarget {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

interface ScheduledFrame {
  cancel(): void;
}

export interface BrowserResumeCallbacks {
  onResumeSignal(): void;
  refreshAfterResume(): void | Promise<void>;
  onRefreshError(error: unknown): void;
}

export interface BrowserResumeControllerOptions {
  windowTarget?: BrowserEventTarget | undefined;
  documentTarget?: BrowserEventTarget | undefined;
  isDocumentVisible?: (() => boolean) | undefined;
  scheduleFrame?: ((callback: () => void) => ScheduledFrame) | undefined;
}

/** Owns browser resume listeners and batches refreshes within one connection. */
export class BrowserResumeController {
  private readonly windowTarget: BrowserEventTarget | undefined;
  private readonly documentTarget: BrowserEventTarget | undefined;
  private readonly isDocumentVisible: () => boolean;
  private readonly scheduleFrame: (callback: () => void) => ScheduledFrame;
  private refreshes = new TrailingRefreshCoordinator<"browser-resume">();
  private scheduledRefresh: ScheduledFrame | undefined;
  private connected = false;
  private connectionEpoch = 0;

  constructor(private readonly callbacks: BrowserResumeCallbacks, options: BrowserResumeControllerOptions = {}) {
    this.windowTarget = options.windowTarget ?? browserWindowTarget();
    this.documentTarget = options.documentTarget ?? browserDocumentTarget();
    this.isDocumentVisible = options.isDocumentVisible ?? documentIsVisible;
    this.scheduleFrame = options.scheduleFrame ?? scheduleBrowserFrame;
  }

  connect(): void {
    if (this.connected) return;
    this.connected = true;
    this.connectionEpoch += 1;
    this.refreshes = new TrailingRefreshCoordinator<"browser-resume">();
    for (const type of ["focus", "pageshow", "online"]) this.windowTarget?.addEventListener(type, this.onResume);
    this.documentTarget?.addEventListener("visibilitychange", this.onResume);
  }

  disconnect(): void {
    if (!this.connected) return;
    this.connected = false;
    this.connectionEpoch += 1;
    for (const type of ["focus", "pageshow", "online"]) this.windowTarget?.removeEventListener(type, this.onResume);
    this.documentTarget?.removeEventListener("visibilitychange", this.onResume);
    this.scheduledRefresh?.cancel();
    this.scheduledRefresh = undefined;
  }

  private readonly onResume: EventListener = () => {
    this.handleResumeSignal();
  };

  private handleResumeSignal(): void {
    if (!this.connected || !this.isDocumentVisible()) return;
    this.callbacks.onResumeSignal();
    if (this.scheduledRefresh !== undefined) return;
    const epoch = this.connectionEpoch;
    const refreshes = this.refreshes;
    const isCurrent = () => this.connected && epoch === this.connectionEpoch;
    this.scheduledRefresh = this.scheduleFrame(() => {
      if (!isCurrent()) return;
      this.scheduledRefresh = undefined;
      void refreshes.request("browser-resume", async () => {
        if (isCurrent() && this.isDocumentVisible()) await this.callbacks.refreshAfterResume();
      }).catch((error: unknown) => { if (isCurrent()) this.callbacks.onRefreshError(error); });
    });
  }
}

function browserWindowTarget(): BrowserEventTarget | undefined {
  return typeof window === "undefined" ? undefined : window;
}

function browserDocumentTarget(): BrowserEventTarget | undefined {
  return typeof document === "undefined" ? undefined : document;
}

function documentIsVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

function scheduleBrowserFrame(callback: () => void): ScheduledFrame {
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    const frame = window.requestAnimationFrame(() => { callback(); });
    return { cancel: () => { window.cancelAnimationFrame(frame); } };
  }
  const timer = globalThis.setTimeout(callback, 0);
  return { cancel: () => { globalThis.clearTimeout(timer); } };
}
