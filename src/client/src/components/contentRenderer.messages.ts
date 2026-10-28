import { message } from "../localization/service";

export default {
  controls: message("Code block controls", "Accessible name for the rendered-source view and copy controls"),
  raw: message("Raw", "View button that shows unmodified source instead of a rendered preview"),
  rawSource: message("Raw source", "Accessible name of the keyboard-focusable unmodified source region"),
  renderedContent: message("Rendered content", "Accessible name of the keyboard-focusable preview region"),
  previewFailed: message("Preview failed. Raw source is shown below.", "Status when a content renderer fails; the original source remains available"),
  copySource: message("Copy source", "Copy the original source, not the rendered preview"),
  copiedSource: message("Copied source", "Accessible confirmation after copying the original source"),
  copyFailed: message("Failed to copy source", "Accessible status when copying the original source fails"),
};
