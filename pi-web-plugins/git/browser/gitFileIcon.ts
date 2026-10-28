const tag = "pi-web-git-file-icon";

/** Git consumes alpha masks, not artwork colours or another plugin's elements. */
export function defineGitFileIconElement(): void {
  if (typeof customElements === "undefined" || typeof HTMLElement === "undefined" || customElements.get(tag) !== undefined) return;
  class GitFileIcon extends HTMLElement {
    private value: string | undefined;
    private image: HTMLImageElement | undefined;
    private readonly root = this.attachShadow({ mode: "open" });
    private readonly content = document.createElement("span");

    constructor() {
      super();
      const style = document.createElement("style");
      style.textContent = ":host { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; color: var(--pi-muted, currentColor); } .content { display: contents; } .mask { display: block; width: 16px; height: 16px; background-color: currentColor; mask-size: contain; mask-repeat: no-repeat; mask-position: center; }";
      this.content.className = "content";
      this.root.append(style, this.content);
      this.showFallback();
    }

    set url(value: string | undefined) {
      if (value === this.value) return;
      this.value = value;
      this.showFallback();
      if (value === undefined) return;
      const image = document.createElement("img");
      image.alt = "";
      image.hidden = true;
      image.draggable = false;
      image.crossOrigin = "anonymous";
      image.referrerPolicy = "no-referrer";
      image.addEventListener("load", () => {
        if (this.image !== image) return;
        const mask = document.createElement("span");
        mask.className = "mask";
        mask.setAttribute("aria-hidden", "true");
        mask.style.maskImage = `url(${JSON.stringify(value)})`;
        this.content.querySelector("svg")?.replaceWith(mask);
      }, { once: true });
      image.addEventListener("error", () => {
        if (this.image !== image) return;
        console.warn("Failed to load Git file icon", value);
        this.showFallback();
      }, { once: true });
      this.content.append(image);
      this.image = image;
      image.src = value;
    }

    private showFallback(): void {
      this.image = undefined;
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("width", "14");
      svg.setAttribute("height", "14");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("fill", "none");
      svg.setAttribute("stroke", "currentColor");
      svg.setAttribute("stroke-width", "1.6");
      svg.setAttribute("aria-hidden", "true");
      for (const d of ["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z", "M14 2v6h6"]) {
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", d);
        svg.append(path);
      }
      this.content.replaceChildren(svg);
    }
  }
  customElements.define(tag, GitFileIcon);
}
