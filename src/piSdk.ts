import { loadPiSdk } from "./piRuntime.js";

// Runtime values share the hosting Pi installation; canonical imports supply development types only.
const sdk = await loadPiSdk();

export const {
  AgentSession,
  CONFIG_DIR_NAME,
  CredentialSynchronizationError,
  DefaultPackageManager,
  DefaultResourceLoader,
  ModelRuntime,
  ProjectTrustStore,
  SessionManager,
  SettingsManager,
  Theme,
  VERSION,
  createAgentSession,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  createCodemodeExtension,
  createEditToolDefinition,
  createEventBus,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createMcpExtension,
  createReadToolDefinition,
  createToolSearchExtension,
  createWriteToolDefinition,
  defineTool,
  formatDimensionNote,
  getAgentDir,
  hasTrustRequiringProjectResources,
  loadSkills,
  readStoredCredential,
  resizeImage,
  resolveModelScopeWithDiagnostics,
  withFileMutationQueue,
} = sdk;

export type * from "@earendil-works/pi-coding-agent";

// Value bindings shadow wildcard type exports for classes.
export type AgentSession = import("@earendil-works/pi-coding-agent").AgentSession;
export type CredentialSynchronizationError = import("@earendil-works/pi-coding-agent").CredentialSynchronizationError;
export type DefaultPackageManager = import("@earendil-works/pi-coding-agent").DefaultPackageManager;
export type DefaultResourceLoader = import("@earendil-works/pi-coding-agent").DefaultResourceLoader;
export type ModelRuntime = import("@earendil-works/pi-coding-agent").ModelRuntime;
export type ProjectTrustStore = import("@earendil-works/pi-coding-agent").ProjectTrustStore;
export type SessionManager = import("@earendil-works/pi-coding-agent").SessionManager;
export type SettingsManager = import("@earendil-works/pi-coding-agent").SettingsManager;
export type Theme = import("@earendil-works/pi-coding-agent").Theme;
