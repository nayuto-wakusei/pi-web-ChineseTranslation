import type { SpeechTranscriptionRequest } from "./apiTypes.js";
import { base64ByteLength } from "./promptAttachments.js";

/**
 * Recorded containers accepted by the transcription upstream. This mirrors the
 * OpenAI transcription API's documented set and covers every container a
 * browser MediaRecorder produces (WebM/Opus, Ogg/Opus, MP4/AAC).
 */
const SUPPORTED_SPEECH_AUDIO_MIME_TYPES = [
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/m4a",
  "audio/wav",
  "audio/mpeg",
] as const;

const supportedSpeechMimeTypes: ReadonlySet<string> = new Set(SUPPORTED_SPEECH_AUDIO_MIME_TYPES);
const base64Pattern = /^[A-Za-z0-9+/]*={0,2}$/;

/** Longest single utterance accepted by the composer; also the client auto-stop limit. */
export const MAX_SPEECH_RECORDING_MS = 10 * 60_000;

/** Strip MediaRecorder codec parameters, e.g. `audio/webm;codecs=opus` to `audio/webm`. */
export function normalizeSpeechMimeType(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const [essence] = value.split(";", 1);
  const normalized = essence?.trim().toLowerCase();
  return normalized === undefined || normalized === "" ? undefined : normalized;
}

export function isSupportedSpeechMimeType(value: unknown): boolean {
  const normalized = normalizeSpeechMimeType(value);
  return normalized !== undefined && supportedSpeechMimeTypes.has(normalized);
}

const SPEECH_AUDIO_FILENAMES: Readonly<Record<string, string>> = {
  "audio/webm": "audio.webm",
  "audio/ogg": "audio.ogg",
  "audio/mp4": "audio.m4a",
  "audio/m4a": "audio.m4a",
  "audio/mpeg": "audio.mp3",
  "audio/wav": "audio.wav",
};

/** Filename extension the upstream service uses to pick a decoder. */
export function speechAudioFilename(mimeType: string): string {
  const normalized = normalizeSpeechMimeType(mimeType);
  return normalized === undefined ? "audio.wav" : SPEECH_AUDIO_FILENAMES[normalized] ?? "audio.wav";
}

export interface SpeechTranscriptionValidationOptions {
  maxAudioBytes: number;
}

/**
 * Validate an untrusted transcription request body. Throws on malformed,
 * unsupported, or oversized input so routes can return a 400/413.
 */
export function parseSpeechTranscriptionRequest(
  value: unknown,
  options: SpeechTranscriptionValidationOptions,
): SpeechTranscriptionRequest {
  if (!isRecord(value)) throw new Error("transcription request must be an object");
  const cwd = value["cwd"];
  if (typeof cwd !== "string" || cwd.trim() === "") throw new Error("cwd must be a non-empty string");
  const audio = value["audio"];
  if (!isRecord(audio)) throw new Error("audio must be an object");
  const mimeType = normalizeSpeechMimeType(audio["mimeType"]);
  if (mimeType === undefined || !isSupportedSpeechMimeType(mimeType)) {
    throw new Error("audio.mimeType must be a supported recorded audio type");
  }
  const data = audio["data"];
  if (typeof data !== "string" || data === "" || !base64Pattern.test(data)) {
    throw new Error("audio.data must be non-empty base64");
  }
  const bytes = base64ByteLength(data);
  if (bytes > options.maxAudioBytes) throw new Error("audio exceeds the configured size limit");
  const durationMs = value["durationMs"];
  if (durationMs !== undefined && (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs < 0 || durationMs > MAX_SPEECH_RECORDING_MS)) {
    throw new Error("durationMs must be a non-negative number within the recording limit");
  }
  return {
    cwd,
    audio: { mimeType, data },
    ...(durationMs === undefined ? {} : { durationMs }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
