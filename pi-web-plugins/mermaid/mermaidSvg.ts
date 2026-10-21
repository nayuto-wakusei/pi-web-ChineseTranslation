import { t } from "./i18n.js";
const SVG_TAG = /<\/?svg\b/iu;
const ALLOWED_TAGS = new Set(["svg", "g", "rect", "text", "line", "defs", "marker", "path"]);

export function sanitizeMermaidSvg(svg: string): string {
  const start = svg.search(/<svg\b/iu);
  const end = svg.toLowerCase().lastIndexOf("</svg>");
  if (start < 0 || end < start) throw new Error(t("ui.main.396c8304a05e", "The diagram engine did not return SVG"));
  const template = document.createElement("template");
  template.innerHTML = svg.slice(start, end + "</svg>".length);
  const root = template.content.querySelector("svg");
  const elements = [...template.content.querySelectorAll("*")];
  if (root === null || elements.some((element) => !ALLOWED_TAGS.has(element.tagName.toLowerCase()))) {
    throw new Error(t("ui.main.336e15ab2af4", "The diagram engine returned unsupported SVG"));
  }
  if (SVG_TAG.test(root.innerHTML)) throw new Error(t("ui.main.d470a466f3af", "The diagram engine returned nested SVG"));
  for (const element of elements) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on") || name === "href" || name === "xlink:href" || attribute.value.trim().toLowerCase().startsWith("javascript:")) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  return root.outerHTML;
}
