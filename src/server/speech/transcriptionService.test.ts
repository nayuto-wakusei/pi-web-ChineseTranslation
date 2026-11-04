import { describe, expect, it, vi } from "vitest";
import type { PiWebSpeechConfig } from "../../shared/apiTypes";
import {
  parseChatTranscript,
  SPEECH_TRANSCRIPTION_RESPONSE_MAX_BYTES,
  SpeechTranscriptionFailure,
  SpeechTranscriptionService,
  speechRequestUrl,
  transcriptFromResponse,
} from "./transcriptionService";

const audio = { mimeType: "audio/webm", data: Buffer.from("recorded").toString("base64") };
type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

function config(overrides: PiWebSpeechConfig = {}): PiWebSpeechConfig {
  return { endpoint: "http://gpu.example.test:8080", model: "qwen3-asr-0.6b", ...overrides };
}

function service(overrides: PiWebSpeechConfig = config(), env: NodeJS.ProcessEnv = {}, fetchImpl: typeof fetch = vi.fn()) {
  return new SpeechTranscriptionService({ config: overrides, env, fetch: fetchImpl });
}

async function failure(promise: Promise<unknown>): Promise<SpeechTranscriptionFailure> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof SpeechTranscriptionFailure) return error;
    throw error;
  }
  throw new Error("expected a speech transcription failure");
}

function urlOf(input: FetchInput): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function initOf(init: FetchInit): RequestInit {
  return init ?? {};
}

function formOf(init: FetchInit): FormData {
  const body = initOf(init).body;
  if (!(body instanceof FormData)) throw new Error("expected a multipart body");
  return body;
}

function stringBody(init: FetchInit): string {
  const body = initOf(init).body;
  if (typeof body !== "string") throw new Error("expected a JSON body");
  return body;
}

function headerOf(init: FetchInit, name: string): string | null {
  return new Headers(initOf(init).headers).get(name);
}

describe("speech transcription service", () => {
  it("appends /v1 only when the configured base lacks a version segment", () => {
    expect(speechRequestUrl(config())).toBe("http://gpu.example.test:8080/v1/audio/transcriptions");
    expect(speechRequestUrl(config({ endpoint: "http://gpu.example.test:8080/v1/" }))).toBe("http://gpu.example.test:8080/v1/audio/transcriptions");
    expect(speechRequestUrl(config({ endpoint: "http://gpu.example.test:8080/v1", api: "chat" }))).toBe("http://gpu.example.test:8080/v1/chat/completions");
  });

  it("forwards a multipart transcription request without an authorization header when no key is configured", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify({ text: " 你好 " }), { status: 200 })));
    const text = await service(config({ language: "zh", timeoutMs: 5_000 }), {}, fetchImpl).transcribe(audio);

    expect(text).toBe("你好");
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(urlOf(url ?? "")).toBe("http://gpu.example.test:8080/v1/audio/transcriptions");
    expect(initOf(init).method).toBe("POST");
    expect(headerOf(init, "authorization")).toBeNull();

    const fields = formOf(init);
    expect(fields.get("model")).toBe("qwen3-asr-0.6b");
    expect(fields.get("language")).toBe("zh");
    expect(fields.get("response_format")).toBe("json");
    const file = fields.get("file");
    if (!(file instanceof File)) throw new Error("expected a named audio part");
    expect(file.name).toBe("audio.webm");
    expect(file.type).toBe("audio/webm");
  });

  it("omits the language hint when the service should auto-detect", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify({ text: "" }), { status: 200 })));
    await service(config({ language: "" }), {}, fetchImpl).transcribe(audio);
    expect(formOf(fetchImpl.mock.calls[0]?.[1]).has("language")).toBe(false);
  });

  it("adds a bearer token from the configured environment variable and refuses an empty one", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify({ text: "ok" }), { status: 200 })));
    await service(config({ apiKeyEnv: "SPEECH_TOKEN" }), { SPEECH_TOKEN: "secret" }, fetchImpl).transcribe(audio);
    expect(headerOf(fetchImpl.mock.calls[0]?.[1], "authorization")).toBe("Bearer secret");

    const error = await failure(service(config({ apiKeyEnv: "SPEECH_TOKEN" }), {}).transcribe(audio));
    expect(error.status).toBe(409);
    expect(error.message).toContain("SPEECH_TOKEN");
  });

  it("reports a missing endpoint or model as an unconfigured feature", async () => {
    const unconfigured = new SpeechTranscriptionService({ config: undefined, env: {}, fetch: vi.fn() });
    expect((await failure(unconfigured.transcribe(audio))).status).toBe(409);
    expect((await failure(service(config({ model: "" })).transcribe(audio))).status).toBe(409);
    expect(unconfigured.configured).toBe(false);
    expect(service(config()).configured).toBe(true);
  });

  it("maps upstream and transport failures to distinct statuses", async () => {
    const upstream = await failure(service(config(), {}, vi.fn<typeof fetch>(() => Promise.resolve(new Response("model not found", { status: 404 })))).transcribe(audio));
    expect(upstream.status).toBe(502);
    expect(upstream.message).toContain("model not found");

    const tooLarge = await failure(service(config(), {}, vi.fn<typeof fetch>(() => Promise.resolve(new Response("too large", { status: 413 })))).transcribe(audio));
    expect(tooLarge.status).toBe(413);

    const timeout = await failure(service(config(), {}, vi.fn<typeof fetch>(() => Promise.reject(new DOMException("timed out", "TimeoutError")))).transcribe(audio));
    expect(timeout.status).toBe(504);

    const unreachable = await failure(service(config(), {}, vi.fn<typeof fetch>(() => Promise.reject(new TypeError("fetch failed")))).transcribe(audio));
    expect(unreachable.status).toBe(502);
  });

  it("bounds the upstream response body", async () => {
    const oversized = () => Promise.resolve(new Response(new Uint8Array(SPEECH_TRANSCRIPTION_RESPONSE_MAX_BYTES + 1), { status: 200 }));
    const error = await failure(service(config(), {}, vi.fn<typeof fetch>(oversized)).transcribe(audio));
    expect(error.status).toBe(502);
    expect(error.message).toMatch(/oversized/u);
  });

  it("applies the deadline to the response body, not just the headers", async () => {
    // Headers arrive, then the body stalls past the timeout.
    const stalledBody = () => {
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.error(new DOMException("timed out", "TimeoutError"));
        },
      });
      return Promise.resolve(new Response(body, { status: 200 }));
    };
    const error = await failure(service(config(), {}, vi.fn<typeof fetch>(stalledBody)).transcribe(audio));
    expect(error.status).toBe(504);
  });

  it("parses chat mode audio_url transcripts, which embed the detected language", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify({
      choices: [{ message: { content: "language Chinese<asr_text>今天天气不错。</asr_text>" } }],
    }), { status: 200 })));
    const text = await service(config({ api: "chat" }), {}, fetchImpl).transcribe(audio);

    expect(text).toBe("今天天气不错。");
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(urlOf(url ?? "")).toBe("http://gpu.example.test:8080/v1/chat/completions");
    expect(headerOf(init, "content-type")).toBe("application/json");
    expect(JSON.parse(stringBody(init))).toEqual({
      model: "qwen3-asr-0.6b",
      messages: [{ role: "user", content: [{ type: "audio_url", audio_url: { url: `data:audio/webm;base64,${audio.data}` } }] }],
    });
  });

  it("keeps plain chat content and rejects responses without a transcript", () => {
    expect(parseChatTranscript({ choices: [{ message: { content: " 纯文本 " } }] })).toBe("纯文本");
    expect(parseChatTranscript({ choices: [{ message: { content: [{ type: "text", text: "数组文本" }] } }] })).toBe("数组文本");
    expect(() => parseChatTranscript({ choices: [] })).toThrow(SpeechTranscriptionFailure);
    expect(() => transcriptFromResponse("transcriptions", "not json")).toThrow(/malformed/u);
    expect(() => transcriptFromResponse("transcriptions", JSON.stringify({}))).toThrow(/no transcript/u);
  });
});
