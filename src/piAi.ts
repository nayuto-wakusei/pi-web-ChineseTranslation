import { loadPiAi } from "./piRuntime.js";

const ai = await loadPiAi();

export const { createAssistantMessageEventStream, getCurrentTools, InMemoryCredentialStore, normalizeContext, modelsAreEqual } = ai;
export type * from "@earendil-works/pi-ai";
export type InMemoryCredentialStore = import("@earendil-works/pi-ai").InMemoryCredentialStore;
