export interface AudioModel {
  url: string;
  signal: AbortSignal;
  fail(error: unknown): void;
  label: string;
  errorMessage: string;
}

/** Native media owns decoding and accessible playback controls, never autoplay. */
export class AudioPreviewElement extends HTMLElement {
  #model: AudioModel | undefined;
  #cleanup: (() => void) | undefined;

  set model(value: AudioModel) {
    if (this.#model === value) return;
    this.#cleanup?.();
    this.#model = value;
    if (this.isConnected) this.#mount();
  }

  connectedCallback(): void {
    Object.assign(this.style, {
      display: "flex", flex: "1 1 auto", minHeight: "0", minWidth: "0",
      alignItems: "center", justifyContent: "center", boxSizing: "border-box", padding: "24px",
    });
    this.#mount();
  }
  disconnectedCallback(): void { this.#cleanup?.(); }

  #mount(): void {
    this.#cleanup?.();
    const model = this.#model;
    if (model === undefined || model.signal.aborted) return;
    const audio = document.createElement("audio");
    audio.controls = true;
    audio.autoplay = false;
    audio.preload = "metadata";
    audio.setAttribute("aria-label", model.label);
    audio.style.maxWidth = "100%";
    let active = true;
    const onError = (): void => {
      // MEDIA_ERR_ABORTED is deliberate cancellation, not a codec/network failure.
      if (active && !model.signal.aborted && audio.error?.code !== 1) model.fail(new Error(model.errorMessage));
    };
    const cleanup = (): void => {
      if (!active) return;
      active = false;
      model.signal.removeEventListener("abort", cleanup);
      audio.removeEventListener("error", onError);
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      audio.remove();
      this.#cleanup = undefined;
    };
    this.#cleanup = cleanup;
    audio.addEventListener("error", onError);
    model.signal.addEventListener("abort", cleanup, { once: true });
    audio.src = model.url;
    this.replaceChildren(audio);
  }
}

export function registerAudioPreviewElement(): void {
  if (customElements.get("pi-web-audio-preview") === undefined) customElements.define("pi-web-audio-preview", AudioPreviewElement);
}
