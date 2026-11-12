import { html, type TemplateResult } from "lit";
import { localization } from "../localization/browser";
import definitions from "./copyId.messages";
import type { DetailCopyController } from "./detailCopy";

const messages = localization.registerMessages("core.copyId", definitions);

/** Offer ID copying in Details without displaying the opaque value. */
export function renderCopyIdAction(kind: "session" | "workspace" | "project" | "machine", id: string, copy: DetailCopyController): TemplateResult {
  return html`<div data-id-detail>${copy.render(JSON.stringify([kind, id]), id, messages.t(kind), "menu-item")}</div>`;
}
