import type { ReactiveController, ReactiveControllerHost } from "lit";
import { actionMenuPanelStyle } from "./actionMenu";

type ListMenuHost = ReactiveControllerHost & HTMLElement;

export class ListMenuController implements ReactiveController {
  openId: string | undefined;
  menuStyle = "";

  constructor(private readonly host: ListMenuHost) {
    host.addController(this);
  }

  hostConnected(): void {
    document.addEventListener("click", this.onDocumentClick);
  }

  hostDisconnected(): void {
    document.removeEventListener("click", this.onDocumentClick);
  }

  isOpen(id: string): boolean {
    return this.openId === id;
  }

  toggle(id: string, target: EventTarget | null): void {
    if (this.openId === id) {
      this.close();
      return;
    }
    this.menuStyle = actionMenuPanelStyle(target, { constrainTo: "viewport" });
    this.openId = id;
    this.host.requestUpdate();
  }

  close(): void {
    if (this.openId === undefined && this.menuStyle === "") return;
    this.openId = undefined;
    this.menuStyle = "";
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

  private readonly onDocumentClick = (event: MouseEvent) => {
    if (event.composedPath().includes(this.host)) return;
    this.close();
  };
}
