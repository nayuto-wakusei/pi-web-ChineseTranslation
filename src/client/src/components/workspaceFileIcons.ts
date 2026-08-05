import { svg, type TemplateResult } from "lit";

function icon(paths: TemplateResult): TemplateResult {
  return svg`
    <svg class="file-action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      ${paths}
    </svg>
  `;
}

export function renderNewFileIcon(): TemplateResult {
  return icon(svg`<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"></path><path d="M14 2v6h6"></path><path d="M12 12v6"></path><path d="M9 15h6"></path>`);
}

export function renderNewFolderIcon(): TemplateResult {
  return icon(svg`<path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"></path><path d="M12 10v6"></path><path d="M9 13h6"></path>`);
}

export function renderUploadIcon(): TemplateResult {
  return icon(svg`<path d="M12 16V4"></path><path d="m7 9 5-5 5 5"></path><path d="M5 20h14"></path>`);
}

export function renderDownloadIcon(): TemplateResult {
  return icon(svg`<path d="M12 4v12"></path><path d="m7 11 5 5 5-5"></path><path d="M5 20h14"></path>`);
}

export function renderRenameIcon(): TemplateResult {
  return icon(svg`<path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"></path>`);
}

export function renderDeleteIcon(): TemplateResult {
  return icon(svg`<path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="m19 6-1 14H6L5 6"></path><path d="M10 11v5"></path><path d="M14 11v5"></path>`);
}

export function renderRefreshIcon(): TemplateResult {
  return icon(svg`<path d="M20 6v5h-5"></path><path d="M20 11a8 8 0 1 0-2.34 5.66"></path>`);
}
