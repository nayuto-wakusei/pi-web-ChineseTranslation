const SVG_TAG = /<\/?svg\b/iu;
const ALLOWED_TAGS = new Set(["svg", "g", "rect", "text", "line", "defs", "marker", "path"]);

export function sanitizeMermaidSvg(svg: string): string {
  const start = svg.search(/<svg\b/iu);
  const end = svg.toLowerCase().lastIndexOf("</svg>");
  if (start < 0 || end < start) throw new Error("图表引擎没有返回 SVG");
  const template = document.createElement("template");
  template.innerHTML = svg.slice(start, end + "</svg>".length);
  const root = template.content.querySelector("svg");
  const elements = [...template.content.querySelectorAll("*")];
  if (root === null || elements.some((element) => !ALLOWED_TAGS.has(element.tagName.toLowerCase()))) {
    throw new Error("图表引擎返回了不受支持的 SVG");
  }
  if (SVG_TAG.test(root.innerHTML)) throw new Error("图表引擎返回了嵌套 SVG");
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
