import { svg, type TemplateResult } from "lit";

function icon(paths: TemplateResult): TemplateResult {
  return svg`
    <svg class="file-action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      ${paths}
    </svg>
  `;
}

export function renderAgentsInstructionsIcon(): TemplateResult {
  return icon(svg`<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"></path><path d="M14 2v6h6"></path><path d="M8 13h8"></path><path d="M8 17h6"></path>`);
}
