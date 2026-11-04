import type { PiWebSpeechConfig } from "../../shared/apiTypes.js";
import { speechAudioFilename } from "../../shared/speechTranscription.js";
import { DEFAULT_SPEECH_MAX_AUDIO_BYTES } from "../../config.js";

/** Upstream failures surfaced to the composer with their HTTP status. */
export type SpeechTranscriptionFailureStatus = 409 | 413 | 502 | 504;

export class SpeechTranscriptionFailure extends Error {
  constructor(readonly status: SpeechTranscriptionFailureStatus, message: string) {
    super(message);
    this.name = "SpeechTranscriptionFailure";
  }
}

/** Transcripts are small; bound the response so a misconfigured endpoint cannot exhaust memory. */
export const SPEECH_TRANSCRIPTION_RESPONSE_MAX_BYTES = 1024 * 1024;

const ASR_TEXT_TAG = "<asr_text>";

export interface SpeechTranscriptionInput {
  mimeType: string;
  /** Base64 payload without a data: URL prefix. */
  data: string;
}

export interface SpeechTranscriptionServiceOptions {
  /** Effective settings; absent means dictation is off for this daemon. */
  config?: PiWebSpeechConfig | undefined;
  /** Environment used to resolve `apiKeyEnv`; the token never enters config or logs. */
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
}

/**
 * Forwards one recorded utterance to an OpenAI-compatible speech service. Two
 * upstream shapes are supported because speech deployments differ: the OpenAI
 * transcription endpoint, and chat completions with an `audio_url` content part
 * (which Qwen3-ASR also serves, but with the language embedded in the content).
 */
export class SpeechTranscriptionService {
  readonly #config: PiWebSpeechConfig | undefined;
  readonly #env: NodeJS.ProcessEnv;
  readonly #fetch: typeof fetch;

  constructor(options: SpeechTranscriptionServiceOptions = {}) {
    this.#config = options.config;
    this.#env = options.env ?? process.env;
    this.#fetch = options.fetch ?? fetch;
  }

  get configured(): boolean {
    return this.#config?.endpoint !== undefined;
  }

  get maxAudioBytes(): number {
    return this.#config?.maxAudioBytes ?? DEFAULT_SPEECH_MAX_AUDIO_BYTES;
  }

  async transcribe(input: SpeechTranscriptionInput, signal?: AbortSignal): Promise<string> {
    const config = this.#requireConfig();
    const body = this.#requestBody(config, input);
    const timeoutMs = config.timeoutMs ?? 60_000;
    const timeout = AbortSignal.timeout(timeoutMs);
    const requestSignal = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
    // The response body belongs to the same deadline as the headers: a service
    // that sends headers and then stalls must still surface as a timeout.
    try {
      const response = await this.#fetch(speechRequestUrl(config), {
        method: "POST",
        headers: this.#headers(config),
        body,
        signal: requestSignal,
      });
      const text = await readBoundedText(response);
      if (!response.ok) {
        throw new SpeechTranscriptionFailure(response.status === 413 ? 413 : 502, upstreamFailureMessage(response, text));
      }
      return transcriptFromResponse(config.api ?? "transcriptions", text);
    } catch (error) {
      if (error instanceof SpeechTranscriptionFailure) throw error;
      if (signal?.aborted === true) throw error;
      if (isAbortError(error)) throw new SpeechTranscriptionFailure(504, `Speech recognition timed out after ${String(timeoutMs)} ms`);
      throw new SpeechTranscriptionFailure(502, `Speech recognition service is unreachable: ${errorText(error)}`);
    }
  }

  #requireConfig(): PiWebSpeechConfig & { endpoint: string; model: string } {
    const config = this.#config;
    if (config?.endpoint === undefined) throw new SpeechTranscriptionFailure(409, "Speech recognition is not configured");
    if (config.model === undefined || config.model === "") throw new SpeechTranscriptionFailure(409, "Speech recognition requires a configured model");
    return { ...config, endpoint: config.endpoint, model: config.model };
  }

  #headers(config: PiWebSpeechConfig): Record<string, string> {
    const headers: Record<string, string> = { accept: "application/json" };
    // Multipart bodies must keep undici's generated boundary, so only chat
    // requests declare their content type explicitly.
    if ((config.api ?? "transcriptions") === "chat") headers["content-type"] = "application/json";
    if (config.apiKeyEnv === undefined || config.apiKeyEnv === "") return headers;
    const token = this.#env[config.apiKeyEnv];
    if (token === undefined || token === "") {
      throw new SpeechTranscriptionFailure(409, `Speech recognition API key environment variable ${config.apiKeyEnv} is empty`);
    }
    headers["authorization"] = `Bearer ${token}`;
    return headers;
  }

  #requestBody(config: PiWebSpeechConfig, input: SpeechTranscriptionInput): FormData | string {
    if ((config.api ?? "transcriptions") === "chat") {
      return JSON.stringify({
        model: config.model,
        messages: [{
          role: "user",
          content: [{ type: "audio_url", audio_url: { url: `data:${input.mimeType};base64,${input.data}` } }],
        }],
      });
    }
    const form = new FormData();
    const bytes = Buffer.from(input.data, "base64");
    form.append("file", new Blob([bytes], { type: input.mimeType }), speechAudioFilename(input.mimeType));
    form.append("model", config.model ?? "");
    if (config.language !== undefined && config.language !== "") form.append("language", config.language);
    form.append("response_format", "json");
    return form;
  }
}

/** Endpoint as configured; `/v1` is appended when the user pasted a bare service root. */
export function speechRequestUrl(config: PiWebSpeechConfig, api: "transcriptions" | "chat" = config.api ?? "transcriptions"): string {
  const base = (config.endpoint ?? "").replace(/\/+$/u, "");
  const versioned = /\/v\d+$/u.test(base) ? base : `${base}/v1`;
  return api === "chat" ? `${versioned}/chat/completions` : `${versioned}/audio/transcriptions`;
}

/**
 * Chat-mode transcripts carry the detected language in the content:
 * `language Chinese<asr_text>正文</asr_text>`. Return just the speech text.
 */
export function transcriptFromResponse(api: "transcriptions" | "chat", body: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new SpeechTranscriptionFailure(502, "Speech recognition service returned malformed JSON");
  }
  if (!isRecord(parsed)) throw new SpeechTranscriptionFailure(502, "Speech recognition service returned an unexpected response");
  if (api === "transcriptions") {
    const text = parsed["text"];
    if (typeof text !== "string") throw new SpeechTranscriptionFailure(502, "Speech recognition service returned no transcript");
    return text.trim();
  }
  return parseChatTranscript(parsed);
}

export function parseChatTranscript(parsed: Record<string, unknown>): string {
  const choices = parsed["choices"];
  const first = isUnknownArray(choices) ? choices[0] : undefined;
  const message = isRecord(first) ? first["message"] : undefined;
  const content = isRecord(message) ? message["content"] : undefined;
  const raw = typeof content === "string" ? content : textParts(content);
  if (raw === undefined) throw new SpeechTranscriptionFailure(502, "Speech recognition service returned no transcript");
  const tagIndex = raw.indexOf(ASR_TEXT_TAG);
  const body = tagIndex === -1 ? raw : raw.slice(tagIndex + ASR_TEXT_TAG.length);
  const endIndex = body.indexOf("</asr_text>");
  return (endIndex === -1 ? body : body.slice(0, endIndex)).trim();
}

function textParts(content: unknown): string | undefined {
  if (!isUnknownArray(content)) return undefined;
  const text = content
    .map((part) => (isRecord(part) && part["type"] === "text" && typeof part["text"] === "string" ? part["text"] : ""))
    .join("");
  return text === "" ? undefined : text;
}

async function readBoundedText(response: Response): Promise<string> {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > SPEECH_TRANSCRIPTION_RESPONSE_MAX_BYTES) {
        throw new SpeechTranscriptionFailure(502, "Speech recognition service returned an oversized response");
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function upstreamFailureMessage(response: Response, body: string): string {
  const detail = body.trim().slice(0, 200);
  const status = `HTTP ${String(response.status)}${response.statusText === "" ? "" : ` ${response.statusText}`}`;
  return detail === "" ? `Speech recognition service failed: ${status}` : `Speech recognition service failed: ${status}: ${detail}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `Array.isArray` narrows to `any[]`; this keeps untrusted elements `unknown`. */
function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
