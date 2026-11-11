import type { ReactiveController, ReactiveControllerHost } from "lit";

/** Register a nonessential element only while its UI is requested. */
export class DeferredElementController implements ReactiveController {
  private pending: Promise<boolean> | undefined;
  private loaded = false;
  private failed = false;

  constructor(
    private readonly host: ReactiveControllerHost & HTMLElement,
    private readonly requested: () => boolean,
    private readonly load: () => Promise<unknown>,
    private readonly reportError: (error: unknown) => void,
  ) {
    host.addController(this);
  }

  hostUpdated(): void {
    if (!this.requested()) {
      this.failed = false;
      return;
    }
    if (!this.loaded && !this.failed) void this.ensureLoaded();
  }

  get loadFailed(): boolean { return this.failed; }

  ensureLoaded(): Promise<boolean> {
    if (this.loaded) return Promise.resolve(true);
    if (this.pending !== undefined) return this.pending;
    if (this.failed) return Promise.resolve(false);
    this.pending = this.load().then(() => {
      this.loaded = true;
      this.host.requestUpdate();
      return true;
    }, (error: unknown) => {
      this.failed = true;
      if (this.host.isConnected && this.requested()) {
        this.reportError(error);
        this.host.requestUpdate();
      }
      return false;
    }).finally(() => { this.pending = undefined; });
    return this.pending;
  }
}
