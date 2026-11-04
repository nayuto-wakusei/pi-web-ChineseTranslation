import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PiWebSpeechConfig } from "../../shared/apiTypes";
import { createTranslator } from "../../shared/i18n";
import { SpeechTranscriptionService } from "./transcriptionService";
import { registerSpeechRoutes } from "./speechRoutes";

const audio = { mimeType: "audio/webm", data: Buffer.from("recorded").toString("base64") };
const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function buildApp(fetchImpl: typeof fetch, config: PiWebSpeechConfig = { endpoint: "http://gpu.example.test:8080", model: "qwen3-asr-0.6b", maxAudioBytes: 1024 }) {
  const app = Fastify();
  apps.push(app);
  registerSpeechRoutes(app, { speech: new SpeechTranscriptionService({ config, env: {}, fetch: fetchImpl }) }, "", createTranslator("en", {}));
  return app;
}

function errorOf(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("expected a JSON error body");
  const error: unknown = Object.getOwnPropertyDescriptor(value, "error")?.value;
  if (typeof error !== "string") throw new Error("expected a string error field");
  return error;
}

describe("speech transcription route", () => {
  it("returns the transcript for a valid utterance", async () => {
    const app = buildApp(vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify({ text: "你好世界" }), { status: 200 }))));
    const response = await app.inject({
      method: "POST",
      url: "/speech/transcriptions",
      payload: { cwd: "/repo", audio, durationMs: 800 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ text: "你好世界" });
  });

  it("rejects malformed payloads before calling the service", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const app = buildApp(fetchImpl);
    const response = await app.inject({ method: "POST", url: "/speech/transcriptions", payload: { cwd: "/repo", audio: { mimeType: "video/mp4", data: audio.data } } });
    expect(response.statusCode).toBe(400);
    expect(errorOf(response.json())).toContain("audio.mimeType");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports an unconfigured speech service as a client-visible conflict", async () => {
    const app = buildApp(vi.fn<typeof fetch>(), { model: "qwen3-asr-0.6b" });
    const response = await app.inject({ method: "POST", url: "/speech/transcriptions", payload: { cwd: "/repo", audio } });
    expect(response.statusCode).toBe(409);
  });

  it("surfaces upstream failures with their mapped status", async () => {
    const app = buildApp(vi.fn<typeof fetch>(() => Promise.resolve(new Response("boom", { status: 503 }))));
    const response = await app.inject({ method: "POST", url: "/speech/transcriptions", payload: { cwd: "/repo", audio } });
    expect(response.statusCode).toBe(502);
    expect(errorOf(response.json())).toContain("boom");
  });
});
