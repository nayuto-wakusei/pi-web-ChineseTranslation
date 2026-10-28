import { LocalizationController } from "../localization/browser";
import { imageMessages } from "../imageMessages";
import { stylesheetIntegrationCapability } from "../plugins/styles";
import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { SessionRef } from "../../../shared/apiTypes";
import { isSessionMediaId, validImageDimensions } from "../../../shared/sessionMedia";
import { sessionMediaUrl } from "../api/urls";
import type { ChatImagePart } from "../chatTypes";

import "./ImagePresentation";

export function transcriptImageSource(part: ChatImagePart, session?: SessionRef, machineId = "local"): { src: string; alt: string } | undefined {
  if (part.mediaId !== undefined) {
    if (session === undefined || !isSessionMediaId(part.mediaId)) return undefined;
    return { src: sessionMediaUrl(session, part.mediaId, machineId), get alt() { return imageMessages.t("attachedImage"); } };
  }
  return { src: `data:${part.mimeType};base64,${part.data}`, get alt() { return imageMessages.t("attachedImage"); } };
}

@customElement("pi-web-transcript-image")
export class TranscriptImage extends LitElement {
  constructor() {
    super();
    stylesheetIntegrationCapability.createController(this);
    new LocalizationController(this);
  }

  @property({ attribute: false }) imagePart: ChatImagePart | undefined;
  @property({ attribute: false }) session: SessionRef | undefined;
  @property() machineId = "local";
  @property({ type: Boolean }) loadingDisabled = false;
  @property({ type: Boolean, reflect: true }) thumbnail = false;
  @property() description: string | (() => string) = () => imageMessages.t("attachedImage");

  override render() {
    const source = this.loadingDisabled || this.imagePart === undefined ? undefined : transcriptImageSource(this.imagePart, this.session, this.machineId)?.src;
    return html`<pi-web-image-presentation
      .source=${source} .requestDisabled=${true} .thumbnail=${this.thumbnail}
      .dimensions=${validImageDimensions(this.imagePart?.width, this.imagePart?.height)}
      .pendingLabel=${this.loadingDisabled ? imageMessages.t("loadingDisabled") : imageMessages.t("unavailable")}
      .description=${this.description} .label=${typeof this.description === "function" ? this.description() : this.description}
    ></pi-web-image-presentation>`;
  }

  static override styles = css`:host { display: block; max-width: 100%; min-width: 0; }`;
}
