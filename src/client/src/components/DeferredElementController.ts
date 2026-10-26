import type { ReactiveController, ReactiveControllerHost } from "lit";

/** Register a nonessential element only while its UI is requested. */
export class DeferredElementController implements ReactiveController {
  private loading = false;
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
    if (this.loaded || this.loading || this.failed) return;
    this.loading = true;
    void this.load().then(() => { this.loaded = true; }).catch((error: unknown) => {
      this.failed = true;
      if (this.host.isConnected) this.reportError(error);
    }).finally(() => { this.loading = false; });
  }
}
