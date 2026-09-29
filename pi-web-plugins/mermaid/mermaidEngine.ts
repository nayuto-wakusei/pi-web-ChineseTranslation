/**
 * Small sandboxed diagram engine. It is not the upstream Mermaid parser:
 * only `graph`/`flowchart` TD/LR with quoted or bare node labels and `-->` edges.
 * The host still runs it in an opaque iframe and sanitizes the returned SVG.
 */
export const MERMAID_ENGINE_SOURCE = String.raw`
const MAX_TEXT = 100000;
const MAX_EDGES = 500;
let started = false;
window.addEventListener("message", (event) => {
  if (event.source !== parent || started) return;
  const data = event.data;
  if (typeof data !== "object" || data === null || data.type !== "mermaid-render" || typeof data.text !== "string" || data.text.length > MAX_TEXT) return;
  started = true;
  try {
    document.body.innerHTML = renderDiagram(data.text);
    parent.postMessage({ type: "mermaid-rendered", height: document.body.scrollHeight }, "*");
  } catch (error) {
    document.body.replaceChildren();
    parent.postMessage({ type: "mermaid-error" }, "*");
  }
});
parent.postMessage({ type: "mermaid-ready" }, "*");

function renderDiagram(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n").map((line) => line.trim()).filter((line) => line !== "" && !line.startsWith("%%"));
  const header = /^(?:graph|flowchart)\s+(TD|TB|LR|RL)\b/i.exec(lines[0] ?? "");
  if (header === null) throw new Error("unsupported diagram");
  const direction = header[1].toUpperCase() === "LR" || header[1].toUpperCase() === "RL" ? "LR" : "TD";
  const nodes = new Map();
  const edges = [];
  for (const line of lines.slice(1)) {
    const match = /^([A-Za-z][\w-]*)(?:\[(?:"([^"]*)"|([^\]]+))\])?\s*-->(?:\s*\|(?:"([^"]*)"|([^|]*))\|)?\s*([A-Za-z][\w-]*)(?:\[(?:"([^"]*)"|([^\]]+))\])?$/.exec(line);
    if (match === null) throw new Error("unsupported statement");
    const from = node(nodes, match[1], match[2] ?? match[3]);
    const to = node(nodes, match[6], match[7] ?? match[8]);
    edges.push({ from, to, label: (match[4] ?? match[5] ?? "").trim() });
    if (edges.length > MAX_EDGES) throw new Error("too many edges");
  }
  if (nodes.size === 0) throw new Error("empty diagram");
  return direction === "LR" ? layoutRows(nodes, edges) : layoutColumns(nodes, edges);
}

function node(nodes, id, label) {
  const existing = nodes.get(id);
  const text = (label ?? existing?.label ?? id).trim();
  if (existing === undefined) nodes.set(id, { id, label: text === "" ? id : text });
  else if (label !== undefined && text !== "") existing.label = text;
  return id;
}

function layoutColumns(nodes, edges) {
  const rank = ranks(nodes, edges, false);
  const columns = group(nodes, rank);
  const width = Math.max(240, columns.length * 180);
  const height = Math.max(...columns.map((column) => column.length)) * 72 + 24;
  return svg(width, height, columns.flatMap((column, columnIndex) => column.map((item, row) => box(24 + columnIndex * 180, 24 + row * 72, item.label))).concat(edgeLines(edges, columns, false)));
}

function layoutRows(nodes, edges) {
  const rank = ranks(nodes, edges, true);
  const rows = group(nodes, rank);
  const height = Math.max(120, rows.length * 72 + 24);
  const width = Math.max(...rows.map((row) => row.length)) * 180 + 24;
  return svg(width, height, rows.flatMap((row, rowIndex) => row.map((item, column) => box(24 + column * 180, 24 + rowIndex * 72, item.label))).concat(edgeLines(edges, rows, true)));
}

function ranks(nodes, edges, reverse) {
  const rank = new Map([...nodes.keys()].map((id) => [id, 0]));
  for (let pass = 0; pass < nodes.size; pass += 1) {
    for (const edge of edges) {
      const from = reverse ? edge.to : edge.from;
      const to = reverse ? edge.from : edge.to;
      rank.set(to, Math.max(rank.get(to) ?? 0, (rank.get(from) ?? 0) + 1));
    }
  }
  return rank;
}

function group(nodes, rank) {
  const grouped = new Map();
  for (const item of nodes.values()) {
    const key = rank.get(item.id) ?? 0;
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }
  return [...grouped.keys()].sort((left, right) => left - right).map((key) => grouped.get(key));
}

function box(x, y, label) {
  const text = escapeXml(label).slice(0, 80);
  return '<g><rect x="' + x + '" y="' + y + '" width="140" height="40" rx="6" fill="#f8fafc" stroke="#334155"></rect><text x="' + (x + 70) + '" y="' + (y + 25) + '" text-anchor="middle" font-family="sans-serif" font-size="13" fill="#0f172a">' + text + "</text></g>";
}

function edgeLines(edges, groups, horizontal) {
  const position = new Map();
  groups.forEach((group, outer) => group.forEach((item, inner) => position.set(item.id, horizontal ? { x: 24 + inner * 180, y: 24 + outer * 72 } : { x: 24 + outer * 180, y: 24 + inner * 72 })));
  return edges.map((edge) => {
    const from = position.get(edge.from);
    const to = position.get(edge.to);
    if (from === undefined || to === undefined) return "";
    const x1 = from.x + (horizontal ? 140 : 70);
    const y1 = from.y + (horizontal ? 20 : 40);
    const x2 = to.x + (horizontal ? 0 : 70);
    const y2 = to.y + (horizontal ? 20 : 0);
    return '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="#334155" stroke-width="1.5" marker-end="url(#arrow)"></line>';
  });
}

function svg(width, height, parts) {
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + width + " " + height + '" width="' + width + '" height="' + height + '"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6" fill="#334155"></path></marker></defs>' + parts.join("") + "</svg>";
}

function escapeXml(value) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}
`;

export function mermaidFrameDocument(engine = MERMAID_ENGINE_SOURCE): string {
  const script = engine.replace(/<\/script/giu, "<\\/script");
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>body{margin:0}svg{max-width:100%;height:auto;display:block;margin:auto}</style></head><body><script>${script}</script></body></html>`;
}
