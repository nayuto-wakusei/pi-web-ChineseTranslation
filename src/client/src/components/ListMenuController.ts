import type { ReactiveController, ReactiveControllerHost } from "lit";
import { AnchoredPopupController } from "./anchoredPopup";

type ListMenuHost = ReactiveControllerHost & HTMLElement;

export class ListMenuController implements ReactiveController {
  openId: string | undefined;
  menuStyle = "";
  private anchor: HTMLElement | undefined;

  constructor(private readonly host: ListMenuHost) {
    host.addController(this);
    new AnchoredPopupController(host, () => {
      const panel = host.shadowRoot?.querySelector<HTMLElement>(".action-menu-panel");
      return this.openId !== undefined && this.anchor !== undefined && panel
        ? { anchor: this.anchor, panel, onClose: () => { this.close(); }, options: { minWidth: 120 } }
        : undefined;
    });
  }

  hostDisconnected(): void {
    this.close();
  }

  isOpen(id: string): boolean {
    return this.openId === id;
  }

  toggle(id: string, target: EventTarget | null): void {
    if (this.openId === id) {
      this.close();
      return;
    }
    this.anchor = target instanceof HTMLElement ? target : undefined;
    this.openId = id;
    this.host.requestUpdate();
  }

  close(): void {
    if (this.openId === undefined && this.menuStyle === "") return;
    this.openId = undefined;
    this.menuStyle = "";
    this.anchor = undefined;
    this.host.requestUpdate();
  }

  closeIfOpenIdMissing(exists: (id: string) => boolean): void {
    if (this.openId !== undefined && !exists(this.openId)) this.close();
  }

  closeIf(condition: boolean): void {
    if (condition) this.close();
  }

  closeForEscape(event: KeyboardEvent, id: string): boolean {
    if (event.key !== "Escape" || this.openId !== id) return false;
    event.preventDefault();
    event.stopPropagation();
    this.close();
    return true;
  }

}
