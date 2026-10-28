import type { MessageDefinition, MessageValues } from "@chainingintention/pi-web-cn/plugin-api";

function text<Values extends MessageValues = Record<string, never>>(message: string, description: string): MessageDefinition<Values> {
  return { message, description };
}

export default {
  relays: text("Relays", "Relay browser: relays; placeholders are unchanged paths, filenames or user metadata"),
  openRelays: text("Open Workspace Relays", "Relay browser: openRelays; placeholders are unchanged paths, filenames or user metadata"),
  openDescription: text<{ path: string }>("Open the workspace Relays tab. Relays live in {path}.", "Relay browser: openDescription; placeholders are unchanged paths, filenames or user metadata"),
  workspace: text("Workspace", "Relay browser: workspace; placeholders are unchanged paths, filenames or user metadata"),
  openRelay: text<{ name: string; leg: string }>("Open Relay {name}, leg {leg}", "Relay browser: openRelay; placeholders are unchanged paths, filenames or user metadata"),
  relayLabel: text("relay", "Relay browser: relayLabel; placeholders are unchanged paths, filenames or user metadata"),
  documents: text("Relay documents", "Relay browser: documents; placeholders are unchanged paths, filenames or user metadata"),
  selectWorkspace: text("Select a workspace.", "Relay browser: selectWorkspace; placeholders are unchanged paths, filenames or user metadata"),
  refresh: text("Refresh", "Relay browser: refresh; placeholders are unchanged paths, filenames or user metadata"),
  relay: text("Relay", "Relay browser: relay; placeholders are unchanged paths, filenames or user metadata"),
  containsOpen: text("Contains the open document", "Relay browser: containsOpen; placeholders are unchanged paths, filenames or user metadata"),
  scanFailed: text("Could not scan workspace relays.", "Relay browser: scanFailed; placeholders are unchanged paths, filenames or user metadata"),
  scanning: text<{ path: string }>("Scanning {path}…", "Relay browser: scanning; placeholders are unchanged paths, filenames or user metadata"),
  loadingDocuments: text("Loading relay documents…", "Relay browser: loadingDocuments; placeholders are unchanged paths, filenames or user metadata"),
  listFailed: text("Could not list this relay's documents.", "Relay browser: listFailed; placeholders are unchanged paths, filenames or user metadata"),
  relayMissing: text("This relay no longer exists.", "Relay browser: relayMissing; placeholders are unchanged paths, filenames or user metadata"),
  rescanRoot: text<{ path: string }>("Click Refresh to rescan {path}.", "Relay browser: rescanRoot; placeholders are unchanged paths, filenames or user metadata"),
  partial: text("Some nested content is not listed — this relay tree is deeper or larger than the panel lists.", "Relay browser: partial; placeholders are unchanged paths, filenames or user metadata"),
  noDocuments: text("This relay has no documents yet.", "Relay browser: noDocuments; placeholders are unchanged paths, filenames or user metadata"),
  packetHelp: text<{ charter: string; status: string; log: string; decisions: string }>("Relay packets contain {charter} (goal), {status} (current baton), and {log} (history). An optional {decisions} keeps consequential decisions and their reasons.", "Relay browser: packetHelp; placeholders are unchanged paths, filenames or user metadata"),
  selectDocument: text("Select a document.", "Relay browser: selectDocument; placeholders are unchanged paths, filenames or user metadata"),
  loadingDocument: text<{ name: string }>("Loading {name}…", "Relay browser: loadingDocument; placeholders are unchanged paths, filenames or user metadata"),
  readFailed: text("Could not read this document.", "Relay browser: readFailed; placeholders are unchanged paths, filenames or user metadata"),
  documentMissing: text("This document no longer exists.", "Relay browser: documentMissing; placeholders are unchanged paths, filenames or user metadata"),
  rescanRelay: text("Click Refresh to rescan the relay.", "Relay browser: rescanRelay; placeholders are unchanged paths, filenames or user metadata"),
  binary: text<{ name: string }>("Binary file: {name}", "Relay browser: binary; placeholders are unchanged paths, filenames or user metadata"),
  binaryHelp: text("Binary documents have no text preview.", "Relay browser: binaryHelp; placeholders are unchanged paths, filenames or user metadata"),
  truncated: text("This document is truncated — only the beginning is shown.", "Relay browser: truncated; placeholders are unchanged paths, filenames or user metadata"),
  noRelays: text("No relays in this workspace.", "Relay browser: noRelays; placeholders are unchanged paths, filenames or user metadata"),
  emptyHelp: text<{ path: string }>("Relay packets live in {path}. This workspace has none yet.", "Relay browser: emptyHelp; placeholders are unchanged paths, filenames or user metadata"),
  invalidLink: text("Relay links must select a normalized workspace-relative packet directory.", "Relay browser: invalidLink; placeholders are unchanged paths, filenames or user metadata"),
  table: text("Table", "Relay browser: table; placeholders are unchanged paths, filenames or user metadata"),
};
