/** Physical overflow edges for the browser's negative RTL scrollLeft model. */
export function horizontalScrollEdges(scrollLeft: number, maxScroll: number, direction: "ltr" | "rtl") {
  return direction === "rtl"
    ? { left: maxScroll + scrollLeft > 1, right: -scrollLeft > 1 }
    : { left: scrollLeft > 1, right: maxScroll - scrollLeft > 1 };
}
