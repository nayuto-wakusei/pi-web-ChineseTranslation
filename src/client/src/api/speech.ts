import type { SpeechTranscriptionRequest, SpeechTranscriptionResponse } from "../../../shared/apiTypes";
import { request } from "./http";

/** Client-side transport deadline; the daemon enforces the real upstream timeout. */
const SPEECH_REQUEST_TIMEOUT_MS = 120_000;

export function parseSpeechTranscription(value: unknown): SpeechTranscriptionResponse {
  if (!isRecord(value)) throw new Error("Invalid speech transcription response");
  const text = value["text"];
  if (typeof text !== "string") throw new Error("Invalid speech transcription response");
  return { text };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function speechTranscriptionPath(machineId: string): string {
  return `api/machines/${encodeURIComponent(machineId)}/speech/transcriptions`;
}

export const speechApi = {
  transcribe: (body: SpeechTranscriptionRequest, machineId = "local", options?: { readonly signal?: AbortSignal }) =>
    request(speechTranscriptionPath(machineId), parseSpeechTranscription, {
      method: "POST",
      body: JSON.stringify(body),
      timeoutMs: SPEECH_REQUEST_TIMEOUT_MS,
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
    }),
};
