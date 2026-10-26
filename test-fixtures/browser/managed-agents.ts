import type { ManagedAgentsStatus, WorkspaceFilesCapabilityV1 } from "../../src/plugin-api";
import { stylesheetIntegrationCapability } from "../../src/client/src/plugins/styles";
import { createWorkspacePanelContext } from "../../src/testSupport/plugin";
import { createTranslator } from "../../src/shared/i18n";
import messages from "../../pi-web-plugins/zh-cn/files.json";
import bundledMessages from "../../pi-web-plugins/zh-cn/bundled.json";
import { setTranslator } from "../../pi-web-plugins/files/i18n";
import { WorkspaceFilesPanel } from "../../pi-web-plugins/files/FilesPanel";
import { FilesRuntime } from "../../pi-web-plugins/files/FilesRuntime";

setTranslator(createTranslator("zh-CN", { ...messages, ...bundledMessages }));
customElements.define("fixture-files-panel", WorkspaceFilesPanel);
let status: Extract<ManagedAgentsStatus, { available: true }> = {
  available: true, pending: true, revision: "snapshot", modifiedAt: "2026-10-20T00:00:00.000Z",
  templateModifiedAt: "2026-10-26T01:00:00.000Z", templateRevision: "organization-20261026",
};
const files: WorkspaceFilesCapabilityV1 = {
  capabilityVersion: 1, defaultUploadFolder: "", maxInlinePreviewBytes: 512_000,
  listFiles: (path) => Promise.resolve({ path, entries: [
    { name: "AGENTS.md", path: "AGENTS.md", type: "file" },
    { name: "exports", path: "exports", type: "directory" },
  ], scannedAt: "2026-10-26T01:00:00.000Z", truncated: false }),
  readFile: () => Promise.reject(new Error("Unused fixture read")),
  writeFile: () => Promise.reject(new Error("Unused fixture write")),
  deleteFile: () => Promise.reject(new Error("Unused fixture delete")),
  moveFile: () => Promise.reject(new Error("Unused fixture move")),
  previewUrl: () => "about:blank", downloadUrl: () => "about:blank",
  uploadFile: () => { throw new Error("Unused fixture upload"); },
  managedAgents: {
    status: () => Promise.resolve(status),
    decide: (decision) => {
      document.body.dataset["decision"] = decision.action;
      status = { ...status, pending: false };
      return Promise.resolve(status);
    },
  },
};
const panel = new WorkspaceFilesPanel();
panel.context = createWorkspacePanelContext({ files, navigation: {
  version: 1, contributionId: "pi-web.files:workspace.files", query: {},
  set: () => undefined,
} });
panel.runtime = new FilesRuntime();
panel.stylesheetIntegration = stylesheetIntegrationCapability;
document.querySelector("#workspace")?.append(panel);
await panel.updateComplete;
document.body.dataset["ready"] = "true";
